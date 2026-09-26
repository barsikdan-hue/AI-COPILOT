import * as legacy from './localAnalysisEngineLegacy';
import type { AnalysisResponse, ConversationState, TranscriptTurn } from '../types';
import { chooseDialoguePolicyTarget } from './dialoguePolicyEngine';
import { evaluateFirstCallScript } from './firstCallScriptEngine';

export * from './localAnalysisEngineLegacy';

const normalize = (value: string): string =>
  (value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

const stableHash = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const isClosed = (status: string | null | undefined): boolean =>
  status === 'confirmed' || status === 'not_applicable';

const semanticKey = (text: string): string => {
  const lower = normalize(text);
  if (/давно.*(?:рассматрива|присматрива)|только.*(?:изуча|рынок)|на каком.*этап.*рын/iu.test(lower)) return 'ask_search_experience';
  if (/что.*(?:причин|изменил).*сейчас|почему.*именно.*сейчас|тема недвижимости.*актуаль/iu.test(lower)) return 'ask_motive_now';
  if (/что из.*(?:видел|смотрел|просмотр)|что.*не устроил|что.*точно не подош|из уже увиденного/iu.test(lower)) return 'ask_experience';
  if (/для чего|цель покупк|для жизни|отдых.*инвест|жить самому/iu.test(lower)) return 'ask_goal';
  if (/формат жилья|квартир.*апартамент|тип недвижим/iu.test(lower)) return 'ask_property_type';
  if (/район|локац|часть сочи|где.*сочи/iu.test(lower)) return 'ask_location';
  if (/критери|важнее|обязательн|отсекать вариант/iu.test(lower)) return 'ask_criteria';
  if (/бюджет|максимальн.*сумм|предел.*стоимост/iu.test(lower)) return 'ask_budget';
  if (/ипотек.*рассроч|собственн.*средств|способ покупк|форма оплаты/iu.test(lower)) return 'ask_payment_method';
  if (/первоначальн.*взнос|перв.*платеж|средства.*доступ/iu.test(lower)) return 'ask_down_payment';
  if (/срок|как скоро|когда.*покуп/iu.test(lower)) return 'ask_timeline';
  if (/кто.*участв.*выбор|решение.*сам|советоваться.*сем|с кем.*обсужд|финальн.*решен.*(?:за вами|за мной)|сверя.*вариант.*сем/iu.test(lower)) return 'ask_decision_makers';
  return 'other';
};

function previousAgentBefore(turn: TranscriptTurn, turns: TranscriptTurn[]): TranscriptTurn | null {
  const before = turns.filter((candidate) => {
    if (candidate.speaker !== 'agent' || candidate.id === turn.id) return false;
    if (typeof candidate.revision === 'number' && typeof turn.revision === 'number') return candidate.revision < turn.revision;
    return candidate.timestamp <= turn.timestamp;
  });
  return before.at(-1) || null;
}

function isPassiveMarketComparison(text: string): boolean {
  const lower = normalize(text);
  const mentionsComparison = /(?:сравнива\p{L}*|сопоставля\p{L}*)[^.!?]{0,80}(?:депозит|вклад|банк)|(?:депозит|вклад|банк)[^.!?]{0,80}(?:сравнива\p{L}*|сопоставля\p{L}*)/iu.test(lower);
  const realBarrier = /(?:не\s+меньше|не\s+ниже|хуже|меньше|ниже|не\s+верю|сомнева\p{L}*|зачем[^.!?]{0,30}менять|смысла[^.!?]{0,30}нет)/iu.test(lower);
  return mentionsComparison && !realBarrier;
}

function isMortgageUncertain(text: string): boolean {
  const lower = normalize(text);
  if (!/ипотек/iu.test(lower)) return false;
  const explicitUncertainty = /(?:не\s+(?:знаю|решил\p{L}*|определил\p{L}*)|сомнева\p{L}*|дума\p{L}*[^.!?]{0,45}(?:надо|нужно)\s+ли|(?:надо|нужно)\s+ли[^.!?]{0,40}ипотек|ипотек\p{L}*[^.!?]{0,45}или\s+не\s+(?:надо|нужно|брать|использовать))/iu.test(lower);
  const schemeNotChosen = /(?:схем\p{L}*|вариант\p{L}*)[^.!?]{0,45}(?:пока\s+)?не\s+(?:выбран\p{L}*|определен\p{L}*|определён\p{L}*)|(?:окончательн\p{L}*|пока)[^.!?]{0,35}(?:схем\p{L}*|вариант\p{L}*)[^.!?]{0,35}не\s+(?:выбран\p{L}*|определен\p{L}*|определён\p{L}*)/iu.test(lower);
  const alternativeChoice = /(?:либо|или)[^.!?]{0,35}ипотек\p{L}*[^.!?]{0,45}(?:либо|или)[^.!?]{0,35}рассроч\p{L}*|ипотек\p{L}*[^.!?]{0,45}(?:либо|или)[^.!?]{0,35}рассроч\p{L}*/iu.test(lower);
  return explicitUncertainty || schemeNotChosen || (alternativeChoice && /(?:возможн\p{L}*|рассматрива\p{L}*|пока|схем\p{L}*|вариант\p{L}*)/iu.test(lower));
}

function hasAvailableDownPaymentWithoutAmount(text: string): boolean {
  const lower = normalize(text);
  if (!/перв\p{L}*\s+взнос\p{L}*/iu.test(lower)) return false;
  if (/\d+(?:[.,]\d+)?\s*(?:млн|миллион\p{L}*|тыс\p{L}*|%)/iu.test(lower)) return false;
  return /(?:часть\s+средств|средств\p{L}*|деньг\p{L}*)[^.!?]{0,55}(?:уже\s+)?(?:есть|доступн\p{L}*|на\s+руках)[^.!?]{0,55}перв\p{L}*\s+взнос\p{L}*|перв\p{L}*\s+взнос\p{L}*[^.!?]{0,55}(?:средств\p{L}*|деньг\p{L}*)[^.!?]{0,35}(?:есть|доступн\p{L}*|на\s+руках)/iu.test(lower);
}

function isJointDecisionAnswer(text: string): boolean {
  const lower = normalize(text);
  const mentionsOtherDecisionMaker = /(?:супруг\p{L}*|жен\p{L}*|муж\p{L}*|семь\p{L}*|партнер\p{L}*|партнёр\p{L}*)/iu.test(lower);
  if (!mentionsOtherDecisionMaker) return false;
  return /(?:буд\p{L}*\s+обсужда\p{L}*|обсужда\p{L}*)[^.!?]{0,35}(?:вместе|с\s+(?:супруг\p{L}*|жен\p{L}*|муж\p{L}*|семь\p{L}*|партнер\p{L}*|партнёр\p{L}*))|решен\p{L}*[^.!?]{0,18}совместн\p{L}*|совместн\p{L}*[^.!?]{0,18}решен\p{L}*|не\s+только\s+за\s+мной/iu.test(lower);
}

function isDistancePreferenceNotObjection(text: string): boolean {
  const lower = normalize(text);
  const explicitBarrier = /(?:слишком\s+далеко|далеко\s+ехать|далеко\s+добират\p{L}*|далеко\s+от\s+моря|неудобн\p{L}*\s+локац\p{L}*)/iu.test(lower);
  if (explicitBarrier) return false;
  return /(?:не\s+слишком\s+далеко|пешком[^.!?]{0,55}(?:важн\p{L}*|хоч\p{L}*|удобн\p{L}*|не\s+слишком\s+далеко)|(?:важн\p{L}*|хоч\p{L}*)[^.!?]{0,55}пешком)/iu.test(lower);
}

function isNoExperienceAnswer(text: string): boolean {
  const lower = normalize(text);
  return /(?:не\s+могу\s+(?:ответить|ничего\s+выделить|выделить\s+(?:что-то|что\s+то|ничего)|сказать[^.!?]{0,40}(?:понрав|подош|ближе))|реально\s+не\s+могу\s+ничего\s+выделить|нечего\s+выделить|ничего\s+не\s+зацепило|ничего\s+конкретн\p{L}*\s+не\s+(?:смотрел\p{L}*|видел\p{L}*)|ярк\p{L}*\s+пример\p{L}*\s+(?:пока\s+)?нет)/iu.test(lower);
}

function hasMaterialsResistanceContext(
  clientText: string,
  agentText: string,
  current: ConversationState,
): boolean {
  const client = normalize(clientText);
  const agent = normalize(agentText);
  const clientExplicit = /(?:пришл\p{L}*|скин\p{L}*|отправ\p{L}*|присыл\p{L}*|материал\p{L}*|подборк\p{L}*)/iu.test(client) ||
    /(?:не\s+(?:надо|нужно|хочу)|пока\s+не\s+(?:надо|нужно))[^.!?]{0,35}информац\p{L}*/iu.test(client);
  const agentProposal = /(?:пришл\p{L}*|скин\p{L}*|отправ\p{L}*|присыл\p{L}*|материал\p{L}*|подборк\p{L}*)/iu.test(agent);
  const remembered = current.dialogueControl?.nextStepResistanceHistory?.materials;
  const rememberedActive = Boolean(remembered && !['handled', 'resolved'].includes(String(remembered.status)));
  return clientExplicit || agentProposal || rememberedActive;
}

function sanitizeFalseMaterialsResistance(
  result: any,
  current: ConversationState,
  turn: TranscriptTurn,
  turns: TranscriptTurn[],
): any {
  if (turn.speaker !== 'client' || !result?.state) return result;
  const previousAgent = previousAgentBefore(turn, turns);
  const currentTurnCreatedMaterialsObjection = Boolean(
    result.localObjection?.category === 'next_step_materials' ||
    result.clientIntent?.category === 'next_step_materials' ||
    (
      result.state.activeObjection?.category === 'next_step_materials' &&
      (result.state.activeObjection?.evidenceTurnIds || []).includes(turn.id)
    )
  );
  if (!currentTurnCreatedMaterialsObjection) return result;
  if (hasMaterialsResistanceContext(turn.text, previousAgent?.text || '', current)) return result;

  const state: any = result.state;
  const previousControl: any = current.dialogueControl || {};
  const currentControl: any = state.dialogueControl || {};
  const nextHistory = { ...(currentControl.nextStepResistanceHistory || {}) };
  const priorMaterialsHistory = previousControl.nextStepResistanceHistory?.materials;
  if (priorMaterialsHistory) nextHistory.materials = priorMaterialsHistory;
  else delete nextHistory.materials;

  const falseCurrentResistance =
    currentControl.nextStepResistance?.target === 'materials' &&
    currentControl.nextStepResistance?.lastEvidenceTurnId === turn.id;
  const falseCurrentEvent =
    currentControl.lastEventType === 'NEXT_STEP_RESISTANCE' &&
    currentControl.lastEventTurnId === turn.id;

  const nextControl = {
    ...currentControl,
    nextStepResistance: falseCurrentResistance ? previousControl.nextStepResistance : currentControl.nextStepResistance,
    nextStepResistanceHistory: nextHistory,
    blockedNextSteps: (currentControl.blockedNextSteps || []).filter(
      (target: string) => target !== 'materials' || (previousControl.blockedNextSteps || []).includes('materials')
    ),
    lastEventType: falseCurrentEvent ? previousControl.lastEventType : currentControl.lastEventType,
    lastEventTurnId: falseCurrentEvent ? previousControl.lastEventTurnId : currentControl.lastEventTurnId,
  };

  const falseObjectionInState =
    state.objections?.items?.includes('next_step_materials') &&
    (state.objections?.evidenceTurnIds || []).includes(turn.id);
  const falseActiveObjection =
    state.activeObjection?.category === 'next_step_materials' &&
    (state.activeObjection?.evidenceTurnIds || []).includes(turn.id);

  let cleanedState: any = {
    ...state,
    dialogueControl: nextControl,
    events: (state.events || []).filter(
      (event: any) => !(event.turnId === turn.id && event.type === 'NEXT_STEP_RESISTANCE')
    ),
    objections: falseObjectionInState ? current.objections : state.objections,
    activeObjection: falseActiveObjection ? current.activeObjection : state.activeObjection,
  };
  cleanedState.scriptProgress = evaluateFirstCallScript(turns, cleanedState);

  return {
    ...result,
    state: cleanedState,
    event: result.event?.type === 'NEXT_STEP_RESISTANCE' && result.event?.nextStepTarget === 'materials'
      ? null
      : result.event,
    localObjection: null,
    clientIntent: {
      type: 'fact',
      category: 'research_status',
      text: turn.text,
      confidence: 0.94,
    },
  };
}

function sanitizeLiveState(
  result: any,
  turn: TranscriptTurn,
  turns: TranscriptTurn[],
  current: ConversationState,
): any {
  if (turn.speaker !== 'client') return result;
  let state: any = result.state;
  if (!state) return result;

  if (isPassiveMarketComparison(turn.text) && state.activeObjection?.category === 'objection_compare') {
    const objectionEvidence = state.activeObjection?.evidenceTurnIds || [];
    if (objectionEvidence.includes(turn.id)) {
      state = {
        ...state,
        objections: state.objections?.value === 'objection_compare'
          ? { value: null, items: [], evidenceTurnIds: [] }
          : state.objections,
        activeObjection: undefined,
      };
    }
  }

  const distancePreference = isDistancePreferenceNotObjection(turn.text);
  if (distancePreference && state.activeObjection?.category === 'objection_location') {
    const objectionEvidence = state.activeObjection?.evidenceTurnIds || [];
    if (objectionEvidence.includes(turn.id)) {
      state = {
        ...state,
        objections: current.objections,
        activeObjection: current.activeObjection,
      };
    }
  }

  if (isMortgageUncertain(turn.text)) {
    state = {
      ...state,
      paymentMethod: {
        value: 'Ипотека / рассрочка (схема не выбрана)',
        evidenceTurnIds: Array.from(new Set([...(state.paymentMethod?.evidenceTurnIds || []), turn.id])),
        needsClarification: true,
      },
      confirmedFacts: (state.confirmedFacts || []).map((fact: any) =>
        fact.category === 'paymentMethod' && fact.turnId === turn.id
          ? {
              ...fact,
              value: 'Ипотека / рассрочка (схема не выбрана)',
              needsClarification: true,
              status: 'needs_clarification',
              lifecycleStatus: 'needs_verification' as const,
            }
          : fact
      ),
    };
  }

  if (hasAvailableDownPaymentWithoutAmount(turn.text)) {
    state = {
      ...state,
      downPayment: {
        value: 'Средства на первый взнос доступны; точный размер не назван',
        evidenceTurnIds: Array.from(new Set([...(state.downPayment?.evidenceTurnIds || []), turn.id])),
        needsClarification: true,
      },
      confirmedFacts: (state.confirmedFacts || []).map((fact: any) =>
        fact.category === 'downPayment' && fact.turnId === turn.id
          ? {
              ...fact,
              value: 'Средства на первый взнос доступны; точный размер не назван',
              needsClarification: true,
              status: 'needs_clarification',
              lifecycleStatus: 'needs_verification' as const,
            }
          : fact
      ),
    };
  }

  if (isJointDecisionAnswer(turn.text)) {
    state = {
      ...state,
      decisionMakers: {
        value: 'Совместно с супругом / семьёй',
        evidenceTurnIds: Array.from(new Set([...(state.decisionMakers?.evidenceTurnIds || []), turn.id])),
        needsClarification: false,
      },
    };
  }

  const previousAgent = previousAgentBefore(turn, turns);
  if (previousAgent && semanticKey(previousAgent.text) === 'ask_experience' && isNoExperienceAnswer(turn.text)) {
    const progress = state.scriptProgress;
    if (progress?.metrics?.experience) {
      state = {
        ...state,
        scriptProgress: {
          ...progress,
          metrics: {
            ...progress.metrics,
            experience: {
              ...progress.metrics.experience,
              status: 'not_applicable',
              value: 'Клиент пока не выделяет удачные или неудачные просмотренные варианты',
              evidenceQuote: turn.text,
              evidenceTurnId: turn.id,
              semanticReason: 'Клиент прямо сообщил, что не может выделить пример. Не повторяем тот же вопрос в этом звонке.',
              confidence: 0.95,
              needsClarification: false,
            },
          },
        },
      };
    }
  }

  let sanitized = sanitizeFalseMaterialsResistance({ ...result, state }, current, turn, turns);
  state = sanitized.state;
  const progress = evaluateFirstCallScript(turns, state);
  state = {
    ...state,
    scriptProgress: progress,
    trustEvaluation: progress.trust,
    qualityResult: progress.quality,
  };

  if (distancePreference) {
    sanitized = {
      ...sanitized,
      localObjection: sanitized.localObjection?.category === 'objection_location' ? null : sanitized.localObjection,
      clientIntent: sanitized.clientIntent?.category === 'objection_location'
        ? {
            type: 'preference',
            category: 'location_preference',
            text: turn.text,
            confidence: 0.98,
          }
        : sanitized.clientIntent,
    };
  }

  return { ...sanitized, state };
}

export function advanceLocalConversation(
  ...args: Parameters<typeof legacy.advanceLocalConversation>
): ReturnType<typeof legacy.advanceLocalConversation> {
  const [current, turn, turns] = args;
  const raw: any = legacy.advanceLocalConversation(current, turn, turns);
  const sanitized: any = sanitizeLiveState(raw, turn, turns, current);

  if (turn.speaker === 'client' && isPassiveMarketComparison(turn.text)) {
    sanitized.localObjection = null;
    sanitized.clientIntent = {
      type: 'fact',
      category: 'market_comparison',
      text: turn.text,
      confidence: 0.96,
    };
  }

  return sanitized as ReturnType<typeof legacy.advanceLocalConversation>;
}

const genericVariants: Record<string, string[]> = {
  ask_search_experience: [
    'Сочи уже давно присматриваете или только начали изучать рынок?',
    'Вы уже сравниваете конкретные варианты в Сочи или пока просто изучаете рынок?',
    'На каком вы сейчас этапе: присматриваетесь или уже ездите смотреть конкретные объекты?',
    'Рынок Сочи давно отслеживаете или интерес появился недавно?',
  ],
  ask_motive_now: [
    'Что изменилось сейчас, что тема недвижимости стала для вас актуальнее?',
    'Почему к вопросу покупки решили вернуться именно сейчас?',
    'Что сейчас подтолкнуло перейти от наблюдения к более предметному выбору?',
    'Какую задачу хочется решить покупкой именно на этом этапе?',
  ],
  ask_experience: [
    'Что из того, что уже смотрели, оказалось ближе к вашей задаче, а что сразу отпало?',
    'Из уже увиденного что вам понравилось больше всего, а что точно не хотите повторять?',
    'Какие варианты уже успели посмотреть и где был главный компромисс?',
    'После прошлых просмотров что стало понятнее про ваш идеальный вариант?',
  ],
};

interface QualificationCard {
  metric: string | null;
  key: string;
  variants: string[];
  base: number;
  reason: string;
}

const qualificationCards: QualificationCard[] = [
  {
    metric: null, key: 'ask_search_experience', base: 32,
    reason: 'Коротко определяем глубину поиска до квалификационной анкеты.',
    variants: genericVariants.ask_search_experience,
  },
  {
    metric: null, key: 'ask_motive_now', base: 30,
    reason: 'Выясняем причину актуальности сейчас как conversational trigger, а не как обязательную метрику.',
    variants: genericVariants.ask_motive_now,
  },
  {
    metric: 'goal', key: 'ask_goal', base: 28,
    reason: 'Уточняем реальную задачу покупки, если она ещё не подтверждена.',
    variants: [
      'Какую задачу должна решить покупка: жить самому, приезжать на отдых или сохранить капитал?',
      'Для вас эта недвижимость в первую очередь про постоянную жизнь, отдых или инвестицию?',
      'Что должно измениться после покупки: переезд, свой формат отдыха или работа капитала?',
    ],
  },
  {
    metric: 'propertyType', key: 'ask_property_type', base: 22,
    reason: 'Формат объекта ещё не подтверждён.',
    variants: [
      'Какой формат вам ближе: квартира или апартаменты?',
      'По формату уже определились: квартира, апартаменты или готовы сравнить оба?',
      'Что рассматриваете по типу объекта: квартиру или апартаменты?',
    ],
  },
  {
    metric: 'location', key: 'ask_location', base: 26,
    reason: 'Локацию лучше уточнять через ограничения клиента, а не идти по анкете.',
    variants: [
      'Какие районы Сочи для вас приоритетны, а какие сразу исключаете?',
      'Если выбирать между тишиной и близостью к центру, в какую сторону готовы сместиться по району?',
      'По локации что важнее: центр событий, море рядом или более тихий район с нормальной логистикой?',
      'Где в Сочи вы себя реально представляете каждый день, а не только на отдыхе?',
    ],
  },
  {
    metric: 'criteria', key: 'ask_criteria', base: 25,
    reason: 'Фиксируем решающие критерии клиента вместо общего продолжения анкеты.',
    variants: [
      'Если оставить только два обязательных критерия, без чего вариант сразу отпадает?',
      'Что для вас важнее всего сохранить без компромисса при выборе?',
      'По каким двум признакам вы сразу поймёте: этот вариант стоит смотреть дальше?',
      'Какой компромисс допустим, а на чём вы точно не готовы уступать?',
    ],
  },
  {
    metric: 'experience', key: 'ask_experience', base: 18,
    reason: 'Уточняем прошлый опыт только если он действительно ещё не раскрыт.',
    variants: genericVariants.ask_experience,
  },
  {
    metric: 'budget', key: 'ask_budget', base: 20,
    reason: 'Бюджет уточняется после появления контекста, а не потому что он следующий в списке.',
    variants: [
      'Какой бюджет для вас комфортный, а где уже начинается жёсткий потолок?',
      'По сумме какой ориентир держим и выше какой границы точно не идём?',
      'В какой диапазон хотите уложиться без натяжки?',
      'Какой максимум по покупке имеет смысл рассматривать, если вариант действительно сильный?',
    ],
  },
  {
    metric: 'paymentMethod', key: 'ask_payment_method', base: 16,
    reason: 'Способ оплаты выясняем только когда финансовая ветка стала актуальна.',
    variants: [
      'Покупку планируете за собственные средства, с ипотекой или готовы сравнить схемы?',
      'По оплате какой сценарий рассматриваете: свои средства, ипотека или рассрочка?',
      'Финансирование уже определили или хотите сначала увидеть сильный вариант и потом выбрать схему?',
    ],
  },
  {
    metric: 'downPayment', key: 'ask_down_payment', base: 15,
    reason: 'Первый платёж уточняем в финансовом контексте.',
    variants: [
      'Средства на первый платёж уже доступны или размер будет зависеть от схемы?',
      'По первоначальному взносу уже есть понятный объём или его лучше считать под конкретный вариант?',
      'Какой первый платёж для вас комфортен без лишней нагрузки?',
    ],
  },
  {
    metric: 'urgency', key: 'ask_timeline', base: 17,
    reason: 'Срок нужен для реального следующего шага, но не повторяется разными словами.',
    variants: [
      'К какому сроку хотите уже принять решение по покупке?',
      'Если подходящий вариант найдётся, когда реально готовы выходить на сделку?',
      'По срокам это вопрос ближайших месяцев или пока без конкретной даты?',
      'Какой срок для вас реалистичен от выбора до сделки?',
    ],
  },
  {
    metric: 'decisionMaker', key: 'ask_decision_makers', base: 14,
    reason: 'Проверяем участников решения тогда, когда это влияет на следующий шаг.',
    variants: [
      'Решение по вариантам принимаете сами или ещё кто-то будет участвовать?',
      'Кого ещё важно подключить к выбору, чтобы потом не пересобирать всё заново?',
      'Финальное решение за вами или будете сверять варианты с семьёй?',
    ],
  },
];

function uniqueTurns(input: any): TranscriptTurn[] {
  const map = new Map<string, TranscriptTurn>();
  for (const turn of [...(input.recentTurns || []), ...(input.newTurns || [])]) {
    if (turn?.id) map.set(turn.id, turn);
  }
  return Array.from(map.values()).sort((a, b) => (a.revision || 0) - (b.revision || 0));
}

function chooseVariant(sessionId: string, key: string, variants: string[]): string {
  return variants[stableHash(`${sessionId}:${key}`) % variants.length];
}

function selectPolicyQualification(
  input: any,
  result: any,
  turns: TranscriptTurn[],
): { card: QualificationCard; text: string; score: number; branch: string; reason: string } | null {
  const state: ConversationState = {
    ...(input.currentState || {}),
    scriptProgress: result.scriptProgress || input.currentState?.scriptProgress,
  } as ConversationState;
  const decision = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);
  if (!decision) return null;
  const card = qualificationCards.find((item) => item.metric === decision.metric && item.key === decision.semanticKey);
  if (!card) return null;
  const text = chooseVariant(input.sessionId || 'session', card.key, card.variants);
  return { card, text, score: decision.priority, branch: decision.branch, reason: decision.reason };
}

function selectContextualQualification(
  input: any,
  result: any,
  turns: TranscriptTurn[],
): { card: QualificationCard; text: string; score: number } | null {
  const progress = result.scriptProgress;
  if (!progress?.metrics) return null;

  const state: ConversationState = input.currentState || ({} as ConversationState);
  const latestClient = [...turns].reverse().find((turn) => turn.speaker === 'client');
  const latest = normalize(latestClient?.text || '');
  const agentKeys = new Set(
    turns.filter((turn) => turn.speaker === 'agent').map((turn) => semanticKey(turn.text)).filter((key) => key !== 'other')
  );
  const immediate = progress.quality?.immediatePriorityMetric || null;
  const route = progress.routeStage || '';

  let best: { card: QualificationCard; text: string; score: number } | null = null;
  for (const card of qualificationCards) {
    if (!card.metric) continue;
    const metric = progress.metrics[card.metric];
    if (metric && isClosed(metric.status)) continue;
    if (card.metric === 'experience' && (state.searchExperience?.value || isClosed(progress.metrics.experience?.status))) continue;
    if (agentKeys.has(card.key)) continue;

    let score = card.base;
    if (card.metric === immediate) score += 85;
    if (metric?.agentQuestionAsked) score -= 30;

    if (route === 'financial_qualification' && ['budget', 'paymentMethod', 'downPayment'].includes(card.metric)) score += 24;
    if (route === 'lpr_check' && card.metric === 'decisionMaker') score += 30;
    if (route === 'client_research' && ['goal', 'propertyType', 'location', 'criteria', 'experience'].includes(card.metric)) score += 14;

    if (/тишин|шум|дорог|далеко|локац|район|море|магазин|логист|вид/iu.test(latest)) {
      if (card.metric === 'criteria') score += 38;
      if (card.metric === 'location') score += 34;
    }
    if (/цен|дорог|миллион|бюджет|стоимост/iu.test(latest) && card.metric === 'budget') score += 36;
    if (/ипотек|рассроч|платеж|взнос|банк/iu.test(latest)) {
      if (card.metric === 'paymentMethod') score += 34;
      if (card.metric === 'downPayment') score += 26;
    }
    if (/срок|месяц|квартал|год|когда/iu.test(latest) && card.metric === 'urgency') score += 32;
    if (/семь|жен|муж|сам(?:остоятельн)?|партнер/iu.test(latest) && card.metric === 'decisionMaker') score += 28;
    if (/смотрел|смотрю|ездил|рынок|вариант|присматрива/iu.test(latest) && card.metric === 'experience') score += 20;
    if (/для себя|постоян|отдых|инвест|сдач/iu.test(latest) && card.metric === 'goal') score += 28;

    if (state.criteria?.value && !state.location?.value && card.metric === 'location') score += 22;
    if (state.goal?.value && state.propertyType?.value && !state.location?.value && card.metric === 'location') score += 18;

    const text = chooseVariant(input.sessionId || latestClient?.sessionId || 'session', card.key, card.variants);
    if (!best || score > best.score) best = { card, text, score };
  }
  return best;
}

function rewriteStableGenericCard(input: any, result: any): void {
  if (!result.suggestedReply) return;
  const key = semanticKey(result.suggestedReply);
  const variants = genericVariants[key];
  if (!variants) return;
  const chosen = chooseVariant(input.sessionId || 'session', key, variants);
  result.suggestedReply = chosen;
  result.shortReason = `${result.shortReason || 'Контекстный вопрос.'} Формулировка выбрана из смыслового пула ${key}, а не из одной фиксированной карточки.`;
}

function applyContextualCard(result: any, selected: { card: QualificationCard; text: string; score: number }, policy?: { branch: string; reason: string }): void {
  const metric = selected.card.metric;
  const metricInfo = metric ? result.scriptProgress?.metrics?.[metric] : null;
  const targetLabel = metricInfo?.name || (
    selected.card.key === 'ask_search_experience'
      ? 'Этап и глубина поиска'
      : selected.card.key === 'ask_motive_now'
        ? 'Причина актуальности сейчас'
        : metric || selected.card.key
  );
  result.suggestedReply = selected.text;
  result.shortReason = policy
    ? `${policy.reason} Dialogue branch=${policy.branch}; priority=${selected.score}.`
    : `${selected.card.reason} Контекстный score=${selected.score}; фиксированная очередь анкеты не используется.`;
  result.candidateRuleId = policy
    ? `dialogue_policy_${policy.branch}_${selected.card.key}`
    : `contextual_v2_${metric || selected.card.key}`;
  result.selectedRuleId = result.candidateRuleId;
  result.closesMetric = metric;
  result.closesMetricLabel = metric ? targetLabel : null;
  result.immediatePriority = policy
    ? `Активная ветка: ${policy.branch}; цель: ${targetLabel}`
    : `Контекстный приоритет: ${targetLabel}`;
  result.actionType = 'CLARIFY';
  result.suggestionMode = 'WAIT';
  result.priority = policy ? Math.max(58, selected.score) : 57;
  result.expectedClientMeaning = null;
  result.eventType = null;
}

export function buildLocalAnalysisResponse(
  ...args: Parameters<typeof legacy.buildLocalAnalysisResponse>
): ReturnType<typeof legacy.buildLocalAnalysisResponse> {
  const input: any = args[0];
  const result: any = legacy.buildLocalAnalysisResponse(...args);
  const turns = uniqueTurns(input);
  const latestClient = [...turns].reverse().find((turn) => turn.speaker === 'client');
  const latestAgent = latestClient ? previousAgentBefore(latestClient, turns) : null;

  if (latestClient && isPassiveMarketComparison(latestClient.text) && result.closesMetric === 'objections') {
    result.suggestedReply = 'Когда сравниваете с депозитом, что для вас важнее в недвижимости: ликвидность, доходность или сохранение капитала?';
    result.shortReason = 'Сравнение с депозитом описывает способ оценки рынка, а не сопротивление покупке.';
    result.candidateRuleId = 'contextual_market_comparison';
    result.selectedRuleId = result.candidateRuleId;
    result.closesMetric = 'criteria';
    result.closesMetricLabel = result.scriptProgress?.metrics?.criteria?.name || 'Важные критерии';
    result.immediatePriority = 'Уточнить критерий сравнения';
    result.actionType = 'CLARIFY';
    result.suggestionMode = 'WAIT';
    result.priority = 62;
    result.eventType = null;
  }

  if (
    latestClient && latestAgent && semanticKey(latestAgent.text) === 'ask_experience' &&
    isNoExperienceAnswer(latestClient.text) && semanticKey(result.suggestedReply || '') === 'ask_experience'
  ) {
    if (result.scriptProgress?.metrics?.experience) {
      result.scriptProgress.metrics.experience = {
        ...result.scriptProgress.metrics.experience,
        status: 'not_applicable',
        value: 'Клиент пока не выделяет удачные или неудачные просмотренные варианты',
        evidenceQuote: latestClient.text,
        evidenceTurnId: latestClient.id,
        semanticReason: 'Клиент прямо сообщил, что не может выделить пример. Ветку не повторяем в этом звонке.',
        confidence: 0.95,
        needsClarification: false,
      };
    }
  }

  const researchMode = Boolean(input.currentState?.dialogueControl?.researchMode);
  const protectedReply = Boolean(
    researchMode ||
    result.eventType ||
    result.candidateRuleId === 'contextual_market_comparison' ||
    ['OBJECTION_CLARIFICATION', 'RESPECT_STOP', 'ANSWER', 'SHOW_EVIDENCE', 'PROPOSE_NEXT_STEP'].includes(result.actionType) ||
    ['SPIN_IMPLICATION', 'SPIN_NEED_PAYOFF', 'HPB_PRESENTATION'].includes(result.suggestionMode)
  );

  let policyApplied = false;
  if (!protectedReply && result.shouldSuggest && result.suggestedReply) {
    const policySelection = selectPolicyQualification(input, result, turns);
    const existingKey = semanticKey(result.suggestedReply);
    const qualificationLike =
      String(result.candidateRuleId || '').startsWith('qualification_fallback_') ||
      String(result.candidateRuleId || '').startsWith('contextual_v2_') ||
      result.candidateRuleId === 'semantic_ack_liveness' ||
      [
        'ask_search_experience',
        'ask_motive_now',
        'ask_experience',
        'ask_goal',
        'ask_property_type',
        'ask_location',
        'ask_criteria',
        'ask_budget',
        'ask_payment_method',
        'ask_down_payment',
        'ask_timeline',
        'ask_decision_makers',
      ].includes(existingKey);

    const earlyTriggerBridge = Boolean(
      policySelection?.card.key === 'ask_motive_now' &&
      result.candidateRuleId === 'research_future_risk'
    );
    const policyAlreadyTargetsCurrent = Boolean(
      policySelection &&
      policySelection.card.metric === result.closesMetric &&
      policySelection.card.key === existingKey
    );

    // Policy owns which branch is active, not every sentence. Preserve a
    // specialized legacy wording when it already targets the same micro-goal.
    // The only deliberate exception is early research mode: after a search-
    // orientation answer, "why now" must bridge before the future-risk probe.
    // After a real past-experience question Dialogue Policy returns null, so
    // the existing research_future_risk handoff remains protected.
    if (
      policySelection &&
      (qualificationLike || earlyTriggerBridge) &&
      !policyAlreadyTargetsCurrent
    ) {
      applyContextualCard(result, policySelection, {
        branch: policySelection.branch,
        reason: policySelection.reason,
      });
      policyApplied = true;
    } else {
      rewriteStableGenericCard(input, result);
    }
  }

  const fallbackLike = !protectedReply && !policyApplied && result.shouldSuggest && Boolean(result.suggestedReply) && Boolean(
    String(result.candidateRuleId || '').startsWith('qualification_fallback_') ||
    result.candidateRuleId === 'semantic_ack_liveness' ||
    (result.priority <= 50 && result.closesMetric)
  );

  if (fallbackLike) {
    const selected = selectContextualQualification(input, result, turns);
    if (selected && selected.card.metric !== result.closesMetric) applyContextualCard(result, selected);
  }

  return result as AnalysisResponse;
}
