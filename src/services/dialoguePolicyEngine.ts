import type { ConversationState, FirstCallScriptProgress, TranscriptTurn } from '../types';
import { isMetricClosed } from '../types';

export type DialogueBranch =
  | 'orientation'
  | 'goal'
  | 'criteria'
  | 'property_format'
  | 'experience'
  | 'finance'
  | 'timing_decision'
  | 'next_step';

export interface DialoguePolicyDecision {
  branch: DialogueBranch;
  metric: string | null;
  semanticKey: string;
  reason: string;
  priority: number;
}

const normalize = (value: string): string =>
  (value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

const closed = (progress: FirstCallScriptProgress | undefined, metric: string): boolean =>
  isMetricClosed(progress?.metrics?.[metric]?.status);

const agentAsked = (turns: TranscriptTurn[], pattern: RegExp): boolean =>
  turns.some((turn) => turn.speaker === 'agent' && pattern.test(normalize(turn.text)));

const agentAskedInSession = (
  state: ConversationState,
  turns: TranscriptTurn[],
  pattern: RegExp,
): boolean =>
  agentAsked(turns, pattern) ||
  (state.askedQuestions || []).some((question) => pattern.test(normalize(question)));

const latestClientText = (turns: TranscriptTurn[]): string =>
  normalize([...turns].reverse().find((turn) => turn.speaker === 'client')?.text || '');

const latestAgentBeforeLatestClient = (turns: TranscriptTurn[]): string => {
  const latestClientIndex = [...turns].map((turn) => turn.speaker).lastIndexOf('client');
  if (latestClientIndex <= 0) return '';
  for (let i = latestClientIndex - 1; i >= 0; i -= 1) {
    if (turns[i].speaker === 'agent') return normalize(turns[i].text);
  }
  return '';
};

const clientHasNoConcreteExperience = (text: string): boolean =>
  /(?:ничего\s+конкретн\p{L}*\s+не\s+(?:смотрел\p{L}*|видел\p{L}*)|(?:пока\s+)?конкретн\p{L}*\s+не\s+(?:смотрел\p{L}*|видел\p{L}*)|не\s+могу\s+(?:ничего\s+)?выделить|нечего\s+выделить|ничего\s+не\s+зацепило|ярк\p{L}*\s+пример\p{L}*\s+(?:пока\s+)?нет|только\s+(?:смотрю|изучаю|присматриваюсь)[^.!?]{0,70}ничего\s+конкретн)/iu.test(text);

const searchOrientationPattern = /(?:как\s+вообще[^?]{0,40}рынк|давно.*(?:рассматрива|присматрива|отслежива)|интерес\s+появил\p{L}*\s+недавно|только.*(?:начал|начала|начали|изуча).*рын|на\s+каком.*этап.*рын|уже\s+сравниваете\s+конкретн.*вариант)/iu;
const motiveNowPattern = /(?:что.*(?:причин|изменил).*сейчас|почему.*именно.*сейчас|что\s+сейчас\s+подтолкнул|тема\s+недвижимости.*актуаль|почему\s+к\s+вопросу.*верну|какую\s+задачу[^?]{0,70}именно\s+на\s+этом\s+этапе)/iu;
const goalQuestionPattern = /(?:для\s+чего|цель\s+покупк|для\s+жизни|отдых.*инвест|постоянн.*жизн|какую\s+задачу\s+(?:должна|должен)\s+решить\s+покупк|что\s+должно\s+измениться.*покупк)/iu;

const latestLooksLikePassiveSearch = (text: string): boolean =>
  /(?:только\s+(?:начал\p{L}*|смотрю|изучаю)|присматрива\p{L}*|пока\s+(?:смотрю|изучаю|интересуюсь)|ничего\s+конкретн|в\s+общих\s+черт|давно\s+(?:смотрю|присматриваюсь)|просто\s+(?:смотрю|изучаю))/iu.test(text);

const clientAlreadyExplainedWhyNow = (turns: TranscriptTurn[]): boolean =>
  turns
    .filter((turn) => turn.speaker === 'client')
    .some((turn) => {
      const text = normalize(turn.text);
      return /(?:потому\s+что|так\s+как|из-за|после\s+того|сейчас[^.!?]{0,45}(?:появил\p{L}*|нужн\p{L}*|решил\p{L}*|решили|стало\p{L}*\s+актуаль)|недавно[^.!?]{0,45}(?:продал\p{L}*|получил\p{L}*|переехал\p{L}*)|переезжа\p{L}*|переезд\p{L}*|родил\p{L}*\s+ребен|ребен\p{L}*\s+родил\p{L}*|продал\p{L}*[^.!?]{0,45}квартир|освободил\p{L}*[^.!?]{0,35}(?:деньг|средств)|накопил\p{L}*|наследств\p{L}*|устал\p{L}*[^.!?]{0,35}(?:снимать|аренд)|деньг\p{L}*[^.!?]{0,55}(?:депозит|банк)[^.!?]{0,40}(?:перелож|влож)|инфляц\p{L}*[^.!?]{0,45}(?:сохран|защит))/iu.test(text);
    });

const dismissedPolicyIntent = (
  state: ConversationState,
  intent: 'search_orientation' | 'motive_now' | 'goal' | 'experience',
): boolean => {
  const dismissed = (state.dismissedSuggestionTexts || []).map(normalize);
  if (intent === 'search_orientation') {
    return dismissed.some((text) => searchOrientationPattern.test(text));
  }
  if (intent === 'motive_now') {
    return dismissed.some((text) => motiveNowPattern.test(text));
  }
  if (intent === 'goal') {
    return dismissed.some((text) =>
      /(?:какую\s+задачу\s+должна\s+решить\s+покупка|недвижимост\p{L}*[^.!?]{0,80}(?:постоянн\p{L}*\s+жизн|отдых|инвестиц)|что\s+должно\s+измениться\s+после\s+покупки)/iu.test(text)
    );
  }
  return dismissed.some((text) =>
    /(?:что\s+из\s+того[^.!?]{0,60}(?:смотрел|увидел)|какие\s+варианты\s+уже\s+успели\s+посмотреть|после\s+прошлых\s+просмотров)/iu.test(text)
  );
};

function candidate(
  branch: DialogueBranch,
  metric: string | null,
  semanticKey: string,
  reason: string,
  priority: number,
): DialoguePolicyDecision {
  return { branch, metric, semanticKey, reason, priority };
}

/**
 * Chooses one conversational micro-goal.
 *
 * Methodology is represented as priorities, not as a fixed questionnaire:
 * - first orient in the client's search only while the call has no substantive facts;
 * - after orientation, understand why the topic became relevant now;
 * - real past behaviour and current evidence outrank hypothetical questions;
 * - explicit pain keeps SPIN continuity in the specialized engine;
 * - criteria/anti-criteria, economics, timing and decision process are opened
 *   only when they can change the next action;
 * - a skipped policy hint is not immediately resurrected by this layer.
 *
 * Orientation and "why now" are micro-goals, not quality metrics. They guide
 * the next turn but do not create a fake 13th mandatory criterion.
 */
export function chooseDialoguePolicyTarget(
  state: ConversationState,
  turns: TranscriptTurn[],
  progress: FirstCallScriptProgress | undefined = state.scriptProgress,
): DialoguePolicyDecision | null {
  if (!progress?.metrics) return null;

  // Once the client has agreed the next step, discovery is over for this first
  // call. New direct questions / objections are handled by the event layer.
  if (state.nextStepAgreement?.status === 'agreed' || Boolean(state.agreedNextStep?.value)) {
    return null;
  }

  const latest = latestClientText(turns);
  const latestAgent = latestAgentBeforeLatestClient(turns);
  const decisions: DialoguePolicyDecision[] = [];
  const goalKnown = closed(progress, 'goal') || Boolean(state.goal?.value);
  const criteriaKnown = closed(progress, 'criteria') || Boolean(state.criteria?.value || state.criteria?.items?.length);
  const locationKnown = closed(progress, 'location') || Boolean(state.location?.value);
  const propertyTypeKnown = closed(progress, 'propertyType') || Boolean(state.propertyType?.value);
  const budgetKnown = closed(progress, 'budget') || Boolean(state.budget?.value);
  const paymentKnown = closed(progress, 'paymentMethod') || Boolean(state.paymentMethod?.value && !state.paymentMethod.needsClarification);
  const urgencyKnown = closed(progress, 'urgency') || Boolean(state.purchaseTimeline?.value || state.urgency?.value);
  const decisionMakerKnown = closed(progress, 'decisionMaker') || Boolean(state.decisionMakers?.value);
  const researchMode = Boolean(
    state.dialogueControl?.researchMode ||
    state.spin?.researchMode ||
    state.spinState?.researchMode
  );
  const recentPassiveSearchKnown = turns.some(
    (turn) => turn.speaker === 'client' && latestLooksLikePassiveSearch(normalize(turn.text))
  );
  const searchExperienceKnown = Boolean(state.searchExperience?.value) || recentPassiveSearchKnown;
  const pastExperienceClosedBySpin = Boolean(
    state.spin?.pastExperienceQuestionClosed ||
    state.spinState?.pastExperienceQuestionClosed
  );
  const noConcreteExperienceKnown = turns.some(
    (turn) => turn.speaker === 'client' && clientHasNoConcreteExperience(normalize(turn.text))
  );
  const experienceClosed =
    closed(progress, 'experience') ||
    progress.metrics.experience?.status === 'declined_to_disclose' ||
    pastExperienceClosedBySpin ||
    noConcreteExperienceKnown;
  const financingUncertain =
    /(?:не\s+(?:знаю|решил|решила|определил|определила)|дума\p{L}*|сомнева\p{L}*)[^.!?]{0,70}(?:ипотек|свои|собственн.*средств|рассроч)|ипотек\p{L}*[^.!?]{0,55}или[^.!?]{0,35}(?:свои|собственн.*средств)|(?:свои|собственн.*средств)[^.!?]{0,55}или[^.!?]{0,35}ипотек/iu.test(latest);
  const affordabilityIntent =
    /(?:(?:что|сколько)[^.!?]{0,35}(?:могу|можем)[^.!?]{0,20}(?:себе\s+)?позволить|на\s+что[^.!?]{0,20}(?:хватит|хватает)|(?:какой\s+)?бюджет[^.!?]{0,25}(?:доступен|реален|потяну))/iu.test(latest);

  const latestAnswersPastExperience =
    /(?:что\s+из.*(?:видел|смотрел)|что.*не\s+устроил|что.*понрав|что.*оттолкнул|уже\s+успели\s+посмотреть|из\s+уже\s+увиденного)/iu.test(latestAgent) &&
    clientHasNoConcreteExperience(latest);

  // A dedicated SPIN research move owns this exact transition. Returning null
  // prevents generic Goal/Experience policy from masking that answer.
  if (latestAnswersPastExperience && (researchMode || pastExperienceClosedBySpin)) {
    return null;
  }

  if (!criteriaKnown && /тишин|шум|логист|дорог|далеко|море|вид|магазин|инфраструкт|ликвид|перепрод|важн|критери|компромисс|точно\s+не|не\s+хочу|исключа\p{L}*/iu.test(latest)) {
    decisions.push(candidate('criteria', 'criteria', 'ask_criteria', 'Клиент уже описывает критерии, анти-критерии или компромиссы: развиваем именно эту ветку.', 96));
  }
  if (!budgetKnown && (/бюджет|цен|стоимост|миллион|дорог/iu.test(latest) || affordabilityIntent)) {
    decisions.push(candidate(
      'finance',
      'budget',
      'ask_budget',
      affordabilityIntent
        ? 'Клиент хочет понять доступный ему диапазон: фиксируем рабочий бюджет вместо встречного общего уточнения.'
        : 'Клиент перевёл разговор в деньги: сначала фиксируем рабочий диапазон.',
      affordabilityIntent ? 95 : 94,
    ));
  }
  if (financingUncertain) {
    decisions.push(candidate('finance', 'paymentMethod', 'ask_payment_method', 'Клиент сам обозначил неопределённость по способу покупки: остаёмся в финансовой ветке.', 98));
  } else if (!paymentKnown && /ипотек|рассроч|взнос|банк|собственн.*средств|наличн/iu.test(latest)) {
    decisions.push(candidate('finance', 'paymentMethod', 'ask_payment_method', 'Клиент затронул способ покупки: уточняем финансовую схему без смены темы.', 93));
  }
  if (!urgencyKnown && /срок|месяц|квартал|когда.*(?:покуп|сделк)|как\s+скоро/iu.test(latest)) {
    decisions.push(candidate('timing_decision', 'urgency', 'ask_timeline', 'Клиент заговорил о сроках: фиксируем реальный горизонт решения.', 91));
  }

  const searchOrientationAsked = agentAskedInSession(state, turns, searchOrientationPattern);
  const orientationHintDismissed = dismissedPolicyIntent(state, 'search_orientation');
  const hasSubstantiveQualification = Boolean(
    goalKnown || criteriaKnown || locationKnown || propertyTypeKnown || budgetKnown || paymentKnown || urgencyKnown
  );
  if (
    !researchMode &&
    !searchExperienceKnown &&
    !searchOrientationAsked &&
    !orientationHintDismissed &&
    !hasSubstantiveQualification
  ) {
    decisions.push(candidate(
      'orientation',
      null,
      'ask_search_experience',
      'В начале звонка сначала ориентируемся, насколько клиент уже погружён в рынок. Это не критерий качества и не анкета.',
      92,
    ));
  }

  const motiveAsked = agentAskedInSession(state, turns, motiveNowPattern);
  const motiveHintDismissed = dismissedPolicyIntent(state, 'motive_now');
  const triggerAlreadyKnown = clientAlreadyExplainedWhyNow(turns);
  const latestFollowsOrientation = searchOrientationPattern.test(latestAgent);
  if (
    (!researchMode || latestFollowsOrientation) &&
    !triggerAlreadyKnown &&
    !motiveAsked &&
    !motiveHintDismissed &&
    (latestFollowsOrientation || latestLooksLikePassiveSearch(latest))
  ) {
    decisions.push(candidate(
      'orientation',
      null,
      'ask_motive_now',
      'Этап поиска понятен, теперь выясняем, почему вопрос стал актуален именно сейчас. Это помогает выбрать следующую ветку, а не просто собрать ещё один факт.',
      90,
    ));
  }

  const goalHintDismissed = dismissedPolicyIntent(state, 'goal');
  if (
    !goalKnown &&
    !goalHintDismissed &&
    !agentAsked(turns, goalQuestionPattern)
  ) {
    decisions.push(candidate('goal', 'goal', 'ask_goal', 'Сначала выясняем реальную задачу/желаемый результат покупки, иначе квалификация превращается в анкету.', 88));
  }

  if (
    goalKnown && !propertyTypeKnown && (criteriaKnown || locationKnown || /постоян|для\s+себя|тишин|логист/iu.test(latest)) &&
    !agentAsked(turns, /формат\s+жилья|квартир.*апартамент|тип\s+недвижим/iu)
  ) {
    decisions.push(candidate('property_format', 'propertyType', 'ask_property_type', 'Задача и контекст уже понятны, теперь формат объекта реально влияет на подбор.', 86));
  }

  if (goalKnown && !criteriaKnown && !agentAsked(turns, /критери|без\s+чего|что\s+важнее|компромисс|точно.*готов.*уступ/iu)) {
    decisions.push(candidate('criteria', 'criteria', 'ask_criteria', 'После цели выясняем решающие критерии и ограничения, а не перебираем карточки по очереди.', 82));
  }

  if (goalKnown && !locationKnown && criteriaKnown && !agentAsked(turns, /район|локац|где.*сочи|часть\s+сочи/iu)) {
    decisions.push(candidate('criteria', 'location', 'ask_location', 'Критерии уже известны, связываем их с подходящей локацией.', 78));
  }

  const experienceHintDismissed = dismissedPolicyIntent(state, 'experience');
  if (
    !experienceClosed && !searchExperienceKnown && !experienceHintDismissed &&
    !clientHasNoConcreteExperience(latest) &&
    !agentAsked(turns, /что\s+из.*(?:видел|смотрел)|что.*не\s+устроил|из\s+уже\s+увиденного|главный\s+компромисс/iu)
  ) {
    decisions.push(candidate('experience', 'experience', 'ask_experience', 'Прошлый опыт полезен только пока он реально существует и ещё не раскрыт.', 54));
  }

  if (goalKnown && (criteriaKnown || propertyTypeKnown)) {
    if (!budgetKnown && !agentAsked(turns, /бюджет|максимальн.*сумм|предел.*стоимост/iu)) {
      decisions.push(candidate('finance', 'budget', 'ask_budget', 'Есть контекст задачи, можно квалифицировать бюджет без ощущения анкеты.', 70));
    }
    if (budgetKnown && !paymentKnown && !agentAsked(turns, /ипотек.*рассроч|способ\s+покупк|форма\s+оплаты|собственн.*средств/iu)) {
      decisions.push(candidate('finance', 'paymentMethod', 'ask_payment_method', 'После бюджета уточняем рабочую схему покупки.', 68));
    }
  }

  if (goalKnown && (criteriaKnown || propertyTypeKnown) && !urgencyKnown && !agentAsked(turns, /к\s+какому\s+срок|как\s+скоро|когда.*(?:покуп|сделк)|по\s+срокам/iu)) {
    decisions.push(candidate('timing_decision', 'urgency', 'ask_timeline', 'Срок нужен, когда уже понятно, что именно клиент пытается решить.', 62));
  }

  if (goalKnown && budgetKnown && !decisionMakerKnown && !agentAsked(turns, /кто.*участв.*выбор|решение.*сам|советоваться|финальн.*решен/iu)) {
    decisions.push(candidate('timing_decision', 'decisionMaker', 'ask_decision_makers', 'Проверяем процесс принятия решения только когда он влияет на следующий шаг.', 58));
  }

  if (decisions.length === 0) return null;
  decisions.sort((a, b) => b.priority - a.priority);
  return decisions[0];
}
