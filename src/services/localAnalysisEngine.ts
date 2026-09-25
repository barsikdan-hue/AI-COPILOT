import {
  ActionType,
  AnalysisResponse,
  ConversationState,
  SuggestionMode,
  TranscriptTurn,
} from '../types';
import { applyConversationEvent, detectConversationEvent } from './conversationEventEngine';
import { createInitialState, mergeFactsDelta } from './conversationStore';
import { classifyClientTurnIntent, detectLocalObjection, getActiveObjectionGuidance, updateObjectionLifecycle } from './objectionEngine';
import { extractDeterministicFacts } from './deterministicFacts';
import { evaluateFirstCallScript, getFirstCallSuggestion } from './firstCallScriptEngine';
import { checkSemanticAntiRepeat, extractSemanticKey } from './semanticAntiRepeat';
import { isSuggestionAllowedByState } from './suggestionLifecycle';
import { classifyAgentAction, evaluateSpinAndHpb } from './spinEngine';
import { getContextualDopamineQuestion } from './dopamineQuestionEngine';


function previousMeaningfulAgentTurn(turn: TranscriptTurn, turns: TranscriptTurn[]): TranscriptTurn | undefined {
  const idx = turns.findIndex((candidate) => candidate.id === turn.id);
  const agents = turns.slice(0, idx < 0 ? turns.length : idx).filter((candidate) => candidate.speaker === 'agent');
  for (let i = agents.length - 1; i >= 0; i -= 1) {
    const text = agents[i].text.trim();
    if (!text) continue;
    const meaningful = text.includes('?') || /(?:первоначальн|взнос|бюджет|ипотек|брокер|видеопоказ|формат|срок|локац|занятост|кто.*решен|для чего|что важно)/iu.test(text);
    if (meaningful) return agents[i];
    if (text.length > 70) return agents[i];
  }
  return agents.at(-1);
}

function normalizeClientText(text: string): string {
  return (text || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Acknowledgement of the agent's question is not an answer to that question.
 * This guard is deliberately narrow: it only suppresses standalone reaction
 * phrases and never swallows a phrase that also contains business meaning.
 */
function isConversationalAcknowledgement(text: string): boolean {
  const clean = normalizeClientText(text);
  return /^(?:хм\s+|мм\s+|ну\s+)?(?:хороший|интересный|неплохой)\s+вопрос$/iu.test(clean);
}

/**
 * "Для себя решил/понял" is a metacognitive phrase ("I decided for myself"),
 * not a statement that the property is being purchased for personal use.
 */
function isDecisionalForMyselfPhrase(text: string): boolean {
  const clean = normalizeClientText(text);
  return /(?:^|\s)(?:я\s+)?для\s+себя\s+(?:уже\s+)?(?:решил|решила|определил|определила|понял|поняла|зафиксировал|зафиксировала)(?:\s|$)/iu.test(clean);
}

function sanitizeLiveFacts(
  text: string,
  facts: ReturnType<typeof extractDeterministicFacts>
): ReturnType<typeof extractDeterministicFacts> {
  const lower = (text || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const flatQuote = text.match(/квартир(?:а|у|ы|е|ой|ам|ами|ах)?/iu)?.[0] || null;
  const apartmentStatusConcern =
    /апартамент\p{L}*[\s\S]{0,140}(?:сер(?:ых|ые)\s+зон|непонятн\p{L}*[\s\S]{0,30}статус|статус[\s\S]{0,30}непонятн\p{L}*)/iu.test(lower);
  const apartmentDirectRejection =
    /(?:не\s+(?:хочу|рассматрива\p{L}*|нужн\p{L}*|подход\p{L}*)\s+(?:эти\s+)?апартамент\p{L}*|апартамент\p{L}*(?:\s+мне)?\s+не\s+(?:нужн\p{L}*|подход\p{L}*|хочу|рассматрива\p{L}*))/iu.test(lower);
  const rejectsApartments = apartmentStatusConcern || apartmentDirectRejection;

  if (!rejectsApartments || !flatQuote) return facts;

  return facts.map((fact) => {
    if (fact.category !== 'property_type' && fact.field !== 'propertyType') return fact;
    if (!/апартамент/iu.test(fact.value || '')) return fact;
    return {
      ...fact,
      value: 'Квартира',
      evidenceQuote: flatQuote,
      confidence: Math.max(fact.confidence, 0.98),
      comment: 'Клиент положительно выбрал квартиру и отдельно описал апартаменты как нежелательный формат.',
    };
  });
}

/** Recompute amended evidence without undoing the agent's manual use/skip actions. */
export function restoreStateForAmendedTurn(beforeTurn: ConversationState, current: ConversationState): ConversationState {
  return { ...beforeTurn, askedQuestions: current.askedQuestions, dismissedSuggestionTexts: current.dismissedSuggestionTexts };
}

/** Deterministic state transition shared by live STT, simulator and replay tests. */
export function advanceLocalConversation(current: ConversationState, turn: TranscriptTurn, turns: TranscriptTurn[]) {
  const previousAgent = previousMeaningfulAgentTurn(turn, turns);
  const priorBoundaryEvent = current.dialogueControl?.lastEventType || null;
  let state = current;
  const acknowledgementOnly = turn.speaker === 'client' && isConversationalAcknowledgement(turn.text);
  const decisionalForMyself = turn.speaker === 'client' && isDecisionalForMyselfPhrase(turn.text);

  if (turn.speaker === 'client') {
    const lookup = Object.fromEntries(turns.filter(t => t.speaker === 'client').map(t => [t.id, t.text]));
    const extractedFacts = sanitizeLiveFacts(
      turn.text,
      extractDeterministicFacts(turn.text, turn.id, previousAgent?.text)
    );
    state = mergeFactsDelta(state, extractedFacts, state.stage, undefined, turn.revision, lookup);
    const lowerClient = turn.text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
    const rejectsMortgage = /(?:без\s+ипотек\w*|ипотек\w*[^.!?]{0,40}(?:не\s*(?:рассматрива\w*|собира\w*|хочу|нужн\w*))|не\s*(?:рассматрива\w*|собира\w*|хочу|нужн\w*)[^.!?]{0,30}ипотек\w*)/iu.test(lowerClient);
    if (rejectsMortgage && /ипотек/iu.test(state.paymentMethod?.value || '')) {
      state = {
        ...state,
        paymentMethod: { value: null, evidenceTurnIds: Array.from(new Set([...(state.paymentMethod?.evidenceTurnIds || []), turn.id])) },
        confirmedFacts: (state.confirmedFacts || []).map((fact) =>
          fact.category === 'paymentMethod' && fact.lifecycleStatus !== 'superseded'
            ? { ...fact, lifecycleStatus: 'superseded' as const }
            : fact
        ),
      };
    }
  } else if (turn.speaker === 'agent' && turn.text.includes('?')) {
    state = { ...state, askedQuestions: Array.from(new Set([...state.askedQuestions, turn.text])) };
  }
  const event = detectConversationEvent(turn, turns, state);
  if (event) state = applyConversationEvent(state, event, turn);
  const clientIntent = classifyClientTurnIntent(turn.text, state, previousAgent?.text);
  const localObjection = turn.speaker === 'client' ? detectLocalObjection(turn.text, state, previousAgent?.text) : null;

  // Soft resistance is a temporary mode, not a permanent mute switch. If the
  // client later gives a real answer/preference/fact, reopen normal guidance.
  if (
    turn.speaker === 'client' &&
    state.dialogueControl?.clientBoundaryActive &&
    priorBoundaryEvent === 'SOFT_RESISTANCE' &&
    clientIntent.type !== 'objection' &&
    !['TIME_CONSTRAINT', 'CLIENT_STOP', 'COMPLIANCE_STOP'].includes(String(event?.type || ''))
  ) {
    state = {
      ...state,
      dialogueControl: { ...state.dialogueControl, clientBoundaryActive: false },
    };
  }

  state = updateObjectionLifecycle(state, turn, clientIntent.type === 'objection' ? localObjection?.category : undefined, event?.nextStepTarget);
  if (turn.speaker === 'client') {
    const controlEventBlocksSpin = Boolean(
      event && [
        'DIRECT_QUESTION',
        'EXPLICIT_REJECTION',
        'FACT_CORRECTION',
        'NEXT_STEP_RESISTANCE',
        'NEXT_STEP_REOPENED',
        'MEETING_CONTRACT',
        'AMBIGUOUS_CONFIRMATION',
        'CLIENT_STOP',
        'TIME_CONSTRAINT',
        'COMPLIANCE_STOP',
      ].includes(event.type)
    );
    if (!controlEventBlocksSpin && !acknowledgementOnly && !decisionalForMyself) {
      const previousAgentAction = previousAgent ? classifyAgentAction(previousAgent.text) : 'none';
      const spin = evaluateSpinAndHpb(turn, state.spin, previousAgentAction, previousAgent?.text || '', state);
      state = { ...state, spin: spin.updatedSpin, spinState: spin.updatedSpin };
    }
  }
  const progress = evaluateFirstCallScript(turns, state);
  state = { ...state, scriptProgress: progress, trustEvaluation: progress.trust, qualityResult: progress.quality };
  return { state, event, clientIntent, localObjection };
}

export interface LocalAnalysisInput {
  sessionId: string;
  revision: number;
  newTurns: TranscriptTurn[];
  recentTurns: TranscriptTurn[];
  currentState: ConversationState;
  fallbackReason?: string | null;
}

function uniqueTurns(...groups: TranscriptTurn[][]): TranscriptTurn[] {
  const byId = new Map<string, TranscriptTurn>();
  for (const turn of groups.flat()) {
    if (turn?.id) byId.set(turn.id, turn);
  }
  return Array.from(byId.values()).sort((a, b) => {
    const revisionDelta = (a.revision ?? 0) - (b.revision ?? 0);
    return revisionDelta || a.timestamp - b.timestamp;
  });
}

function actionForSuggestionMode(mode: SuggestionMode): ActionType {
  if (mode === 'HPB_PRESENTATION') return 'SHOW_EVIDENCE';
  if (mode === 'SPIN_IMPLICATION' || mode === 'SPIN_NEED_PAYOFF') return 'DEEPEN';
  if (mode === 'OBJECTION_CLARIFICATION') return 'OBJECTION_CLARIFICATION';
  if (mode === 'NEXT_STEP') return 'PROPOSE_NEXT_STEP';
  if (mode === 'WAIT') return 'WAIT';
  return 'CLARIFY';
}

function getBoundarySafeFallback(state: ConversationState, clientText: string): { text: string; reason: string } {
  const lower = clientText.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const blocked = state.dialogueControl?.blockedNextSteps || [];

  if (blocked.includes('ppv')) {
    return {
      text: 'Понял. Видео пока не предлагаю. Отправлю только подходящие варианты по уже названным критериям, а после просмотра коротко сверим, что оставить.',
      reason: 'Клиент повторно отказался от видео: не молчим, но уважаем границу и даём следующий безопасный ход.',
    };
  }
  if (blocked.includes('ppi')) {
    return {
      text: 'Понял. Брокера пока не подключаем. Сначала разберёмся с объектами, а к ставкам вернёмся только по вашему сигналу.',
      reason: 'Клиент повторно отложил брокера: сохраняем полезный следующий ход без давления.',
    };
  }
  if (/нет времени|некогда|не могу говорить|перезвон/iu.test(lower)) {
    return {
      text: 'Понял, не задерживаю. Зафиксирую то, что уже есть. Когда коротко вернуться — сегодня вечером или завтра?',
      reason: 'Граница времени не должна выключать суфлёра: только короткий возврат вместо анкеты.',
    };
  }
  if (/скинь|пришл|отправ|планиров|цен|материал|подборк/iu.test(lower)) {
    return {
      text: 'Понял. Отправлю без лишнего: только 2–3 варианта по уже названным критериям. После просмотра коротко сверим, что оставить.',
      reason: 'Повторный запрос материалов: подтверждаем действие и не продолжаем длинный опрос.',
    };
  }
  return {
    text: 'Понял. Не буду расширять разговор: зафиксирую сказанное и вернёмся к одному следующему шагу, когда вам будет удобно.',
    reason: 'Boundary-safe fallback: клиент ограничил разговор, но агент всё равно получает готовую реплику.',
  };
}

/**
 * Deterministic analysis used for P0 events and whenever Gemini is unavailable.
 * It intentionally owns policy, facts and lifecycle decisions; an LLM is only an
 * optional semantic/wording enhancement on top of this result.
 */
export function buildLocalAnalysisResponse(input: LocalAnalysisInput): AnalysisResponse {
  const startedAt = Date.now();
  const allTurns = uniqueTurns(input.recentTurns || [], input.newTurns || []);
  const clientTurns = (input.newTurns || []).filter(
    (turn) => turn.speaker === 'client' && turn.isFinal !== false
  );
  const lastClientTurn = clientTurns.at(-1) || allTurns.filter((turn) => turn.speaker === 'client').at(-1);
  const lastAgentTurn = allTurns.filter((turn) => turn.speaker === 'agent').at(-1);
  const acknowledgementOnly = lastClientTurn ? isConversationalAcknowledgement(lastClientTurn.text) : false;
  const decisionalForMyself = lastClientTurn ? isDecisionalForMyselfPhrase(lastClientTurn.text) : false;

  // One authoritative state for this analysis cycle. Runtime callers may send a
  // partial state, and replay/simulator callers may not have advanced the last
  // client turn yet. Normalize first, then apply the new facts before any
  // event/SPIN/policy decision.
  const initialState = createInitialState();
  const incomingState = input.currentState || initialState;
  const normalizedState: ConversationState = {
    ...initialState,
    ...incomingState,
    dialogueControl: {
      ...initialState.dialogueControl!,
      ...(incomingState.dialogueControl || {}),
      rejectedBranches: Array.isArray(incomingState.dialogueControl?.rejectedBranches)
        ? incomingState.dialogueControl!.rejectedBranches
        : [],
      blockedNextSteps: Array.isArray(incomingState.dialogueControl?.blockedNextSteps)
        ? incomingState.dialogueControl!.blockedNextSteps
        : [],
    },
    confirmedFacts: Array.isArray(incomingState.confirmedFacts) ? incomingState.confirmedFacts : [],
    askedQuestions: Array.isArray(incomingState.askedQuestions) ? incomingState.askedQuestions : [],
    dismissedSuggestionTexts: Array.isArray(incomingState.dismissedSuggestionTexts) ? incomingState.dismissedSuggestionTexts : [],
    criteria: {
      ...initialState.criteria,
      ...(incomingState.criteria || {}),
      items: Array.isArray(incomingState.criteria?.items) ? incomingState.criteria!.items : [],
      evidenceTurnIds: Array.isArray(incomingState.criteria?.evidenceTurnIds) ? incomingState.criteria!.evidenceTurnIds : [],
    },
    objections: {
      ...initialState.objections,
      ...(incomingState.objections || {}),
      items: Array.isArray(incomingState.objections?.items) ? incomingState.objections!.items : [],
      evidenceTurnIds: Array.isArray(incomingState.objections?.evidenceTurnIds) ? incomingState.objections!.evidenceTurnIds : [],
    },
    spin: {
      ...initialState.spin,
      ...(incomingState.spin || incomingState.spinState || {}),
      situation: Array.isArray((incomingState.spin || incomingState.spinState)?.situation) ? (incomingState.spin || incomingState.spinState)!.situation : [],
      problem: Array.isArray((incomingState.spin || incomingState.spinState)?.problem) ? (incomingState.spin || incomingState.spinState)!.problem : [],
      implication: Array.isArray((incomingState.spin || incomingState.spinState)?.implication) ? (incomingState.spin || incomingState.spinState)!.implication : [],
      needPayoff: Array.isArray((incomingState.spin || incomingState.spinState)?.needPayoff) ? (incomingState.spin || incomingState.spinState)!.needPayoff : [],
      completedStages: Array.isArray((incomingState.spin || incomingState.spinState)?.completedStages) ? (incomingState.spin || incomingState.spinState)!.completedStages : [],
    },
  };

  const factsDelta = clientTurns.flatMap((turn) => {
    const previousAgent = previousMeaningfulAgentTurn(turn, allTurns);
    return sanitizeLiveFacts(
      turn.text,
      extractDeterministicFacts(turn.text, turn.id, previousAgent?.text || null)
    );
  });
  const clientTurnLookup = Object.fromEntries(allTurns.filter(turn => turn.speaker === 'client').map(turn => [turn.id, turn.text]));
  const workingState = mergeFactsDelta(
    normalizedState,
    factsDelta,
    normalizedState.stage,
    undefined,
    input.revision,
    clientTurnLookup
  );

  const events = clientTurns
    .map((turn) => detectConversationEvent(turn, allTurns, workingState))
    .filter((event): event is NonNullable<typeof event> => Boolean(event))
    .sort((a, b) => b.priority - a.priority);
  const dominantEvent = events[0] || null;
  const activeObjectionGuidance = getActiveObjectionGuidance(workingState);
  const activeCategory = workingState.activeObjection?.category || '';
  const latestClientText = (lastClientTurn?.text || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const latestRelatesToActiveObjection =
    activeCategory === 'objection_yield'
      ? /(?:доходност|депозит|сдава|аренд|ликвид|продат|рост\s+(?:цен|стоим)|окупаем)/iu.test(latestClientText)
      : activeCategory === 'objection_market'
        ? /(?:рынок|цен\p{L}*\s+упад|подожд|через\s+год|момент\s+покуп)/iu.test(latestClientText)
        : activeCategory === 'objection_compare' || activeCategory === 'objection_bad_experience'
          ? /(?:сравн|вариант|презентац|агент|не\s+понима)/iu.test(latestClientText)
          : false;
  const autoObjectionGuidance = activeObjectionGuidance && lastClientTurn &&
    (
      workingState.activeObjection?.evidenceTurnIds?.includes(lastClientTurn.id) ||
      latestRelatesToActiveObjection
    )
      ? activeObjectionGuidance
      : null;

  const scriptProgress = evaluateFirstCallScript(allTurns, workingState);
  const calculatedAgentAction = lastAgentTurn ? classifyAgentAction(lastAgentTurn.text) : 'none';

  if (acknowledgementOnly) {
    return {
      sessionId: input.sessionId,
      basedOnRevision: input.revision,
      stage: workingState.stage,
      dealStage: workingState.dealStage || 'qualification',
      conversationTask: workingState.conversationTask || 'understand_motive',
      clientIntent: undefined,
      actionType: 'WAIT',
      suggestionMode: 'WAIT',
      agentAction: calculatedAgentAction,
      selectedRuleId: null,
      factsDelta,
      fact_updates: factsDelta,
      activeConcern: null,
      objection: null,
      candidateRuleId: null,
      suggestedReply: null,
      shortReason: 'Клиент только оценил вопрос, но не ответил по существу. Не двигаем SPIN и не создаём новую подсказку.',
      expectedClientMeaning: null,
      evidenceTurnIds: lastClientTurn ? [lastClientTurn.id] : [],
      missingCriticalField: scriptProgress.quality?.immediatePriorityMetric || null,
      shouldSuggest: false,
      spinDelta: workingState.spin,
      hpb: null,
      scriptProgress,
      qualityResult: scriptProgress.quality,
      closesMetric: null,
      closesMetricLabel: null,
      immediatePriority: null,
      latencyMs: Date.now() - startedAt,
      modelUsed: 'local-deterministic',
      priority: 0,
      eventType: null,
      fallbackReason: input.fallbackReason || null,
    };
  }

  const spin = lastClientTurn && !decisionalForMyself
    ? evaluateSpinAndHpb(
        lastClientTurn,
        workingState.spin || workingState.spinState!,
        calculatedAgentAction,
        lastAgentTurn?.text || '',
        workingState
      )
    : null;
  const dopamine = lastClientTurn
    ? getContextualDopamineQuestion({ ...workingState, scriptProgress }, allTurns, lastClientTurn.text)
    : null;
  const personalContextTurn = lastClientTurn
    ? /(?:семь|супруг|дет|сочи|отдых|путеше|хобби|увлека|работ|професс|инвест|доход)/iu.test(lastClientTurn.text)
    : false;
  const spinPausedForTopicShift =
    spin?.suggestionMode === 'WAIT' && /сменил тему|приостановлена/iu.test(spin.shortReason || '');
  const canUseDopamine = Boolean(
    dopamine && personalContextTurn &&
    (scriptProgress.trust?.openPersonalQuestionsCount || 0) < 2 &&
    !workingState.activeObjection &&
    (spinPausedForTopicShift || !['asked_implication_question', 'asked_need_payoff_question'].includes(calculatedAgentAction))
  );

  let suggestedReply: string | null = null;
  let shortReason: string | null = null;
  let candidateRuleId: string | null = null;
  let actionType: ActionType = 'WAIT';
  let suggestionMode: SuggestionMode = 'WAIT';
  let closesMetric: string | null = null;
  let closesMetricLabel: string | null = null;
  let immediatePriority: string | null = null;
  let expectedClientMeaning: string | null = null;
  let priority = 50;

  const objectionShouldOwnReply = Boolean(
    autoObjectionGuidance &&
    (!dominantEvent || ['RESEARCH_MODE'].includes(dominantEvent.type))
  );

  const researchFutureRiskReady = Boolean(
    lastClientTurn &&
    (workingState.spin?.researchMode || workingState.dialogueControl?.researchMode) &&
    (workingState.spin?.problem?.length || 0) === 0 &&
    /(?:ничего\s+не\s+(?:смотрел|смотрели)|неудобств\s+не\s+было|проблем\s+не\s+было|только\s+начал\p{L}*\s+изуча)/iu.test(
      lastClientTurn.text
    )
  );

  const goalStillOpen = !['confirmed', 'not_applicable'].includes(
    scriptProgress.metrics['goal']?.status || 'not_confirmed'
  );

  if (objectionShouldOwnReply && autoObjectionGuidance) {
    suggestedReply = autoObjectionGuidance.text;
    shortReason = autoObjectionGuidance.reason;
    candidateRuleId = 'active_objection_guidance';
    actionType = 'OBJECTION_CLARIFICATION';
    suggestionMode = 'OBJECTION_CLARIFICATION';
    closesMetric = 'objections';
    closesMetricLabel = 'Отработка возражений';
    immediatePriority = autoObjectionGuidance.title;
    expectedClientMeaning = autoObjectionGuidance.goal;
    priority = Math.max(76, dominantEvent?.priority || 0);
  } else if (dominantEvent) {
    suggestedReply = dominantEvent.suggestedReply;
    shortReason = dominantEvent.shortReason;
    candidateRuleId = dominantEvent.ruleId;
    actionType = dominantEvent.actionType;
    closesMetric = dominantEvent.closesMetric || null;
    closesMetricLabel = dominantEvent.closesMetricLabel || null;
    immediatePriority = `P0: ${dominantEvent.type}`;
    priority = dominantEvent.priority;
  } else if (decisionalForMyself && goalStillOpen) {
    suggestedReply = 'Чтобы не додумывать цель по формулировке: саму покупку рассматриваете для проживания, отдыха или как инвестицию?';
    shortReason = '«Для себя решил» означает, что клиент принял решение по формату, а не сообщил сценарий использования. Цель покупки уточняем отдельно.';
    candidateRuleId = 'clarify_goal_after_decisional_for_myself';
    actionType = 'CLARIFY';
    suggestionMode = 'SPIN_SITUATION';
    closesMetric = 'goal';
    closesMetricLabel = 'Цель покупки';
    immediatePriority = 'Уточнить реальную цель покупки без ложной трактовки «для себя»';
    expectedClientMeaning = 'Клиент называет реальную цель: проживание, отдых, инвестиции или сочетание сценариев.';
    priority = 63;
  } else if (researchFutureRiskReady) {
    suggestedReply = 'Если смотреть вперёд, какой ошибки при выборе вы больше всего хотите избежать?';
    shortReason = 'Клиент ещё изучает рынок и не назвал прошлую боль: исследуем будущий риск вместо повторного вопроса об опыте.';
    candidateRuleId = 'research_future_risk';
    actionType = 'CLARIFY';
    suggestionMode = 'SPIN_PROBLEM';
    expectedClientMeaning = 'Клиент называет риск или ошибку, которую хочет исключить.';
    priority = 61;
  } else if (
    spin &&
    spin.suggestedText &&
    !['WAIT', 'SPIN_SITUATION'].includes(spin.suggestionMode)
  ) {
    // Once a real Problem/Implication/Need-payoff chain is active, keep its
    // causal continuity. A generic rapport/trust question must not interrupt
    // the chain immediately after the client disclosed a meaningful pain.
    suggestedReply = spin.suggestedText;
    shortReason = spin.shortReason;
    suggestionMode = spin.suggestionMode;
    actionType = actionForSuggestionMode(spin.suggestionMode);
    expectedClientMeaning = spin.expectedClientMeaning;
    priority = 60;
  } else if (canUseDopamine && dopamine) {
    suggestedReply = dopamine.text;
    shortReason = dopamine.reason;
    suggestionMode = 'CHECK_ALIGNMENT';
    actionType = 'CLARIFY';
    closesMetric = 'trust';
    closesMetricLabel = 'Доверие';
    immediatePriority = 'Контекстный личный вопрос';
    expectedClientMeaning = 'Клиент раскрывает личный контекст, связанный с уже обсуждаемой темой.';
    priority = 58;
  } else if (spin && spin.suggestedText) {
    suggestedReply = spin.suggestedText;
    shortReason = spin.shortReason;
    suggestionMode = spin.suggestionMode;
    actionType = actionForSuggestionMode(spin.suggestionMode);
    expectedClientMeaning = spin.expectedClientMeaning;
    priority = 55;
  }

  const silentEventCanContinue =
    dominantEvent?.type === 'FACT_CORRECTION' || dominantEvent?.type === 'EXPLICIT_REJECTION';

  if ((!dominantEvent || silentEventCanContinue) && lastClientTurn) {
    const fallback = getFirstCallSuggestion(scriptProgress, lastClientTurn, {
      ...workingState,
      scriptProgress,
    }, allTurns);
    const wrongForMyselfFallback = decisionalForMyself && /для\s+себя[^?]{0,60}(?:отдых|сезон|постоянно)/iu.test(fallback?.suggestedReply || '');
    if (fallback && !wrongForMyselfFallback && !suggestedReply) {
      suggestedReply = fallback.suggestedReply;
      shortReason = fallback.shortReason;
      closesMetric = fallback.closesMetric;
      closesMetricLabel = fallback.closesMetricLabel;
      immediatePriority = fallback.immediatePriority;
      expectedClientMeaning = fallback.expectedClientMeaning;
      actionType = 'CLARIFY';
      priority = 50;
    }
  }

  // Liveness invariant: a client boundary blocks the questionnaire, not the assistant.
  // Keep one short, ready-to-say line alive even during repeated resistance.
  if (workingState.dialogueControl?.clientBoundaryActive && lastClientTurn) {
    const boundaryCandidateIsSafe =
      actionType === 'RESPECT_STOP' ||
      actionType === 'OBJECTION_CLARIFICATION' ||
      actionType === 'ANSWER' ||
      dominantEvent?.type === 'SOFT_RESISTANCE' ||
      dominantEvent?.type === 'TIME_CONSTRAINT' ||
      dominantEvent?.type === 'NEXT_STEP_RESISTANCE' ||
      dominantEvent?.type === 'DIRECT_QUESTION';

    if (!suggestedReply || !boundaryCandidateIsSafe) {
      const fallback = getBoundarySafeFallback(workingState, lastClientTurn.text);
      suggestedReply = fallback.text;
      shortReason = fallback.reason;
      candidateRuleId = 'boundary_safe_liveness';
      actionType = 'RESPECT_STOP';
      suggestionMode = 'WAIT';
      closesMetric = null;
      closesMetricLabel = null;
      immediatePriority = 'P0: CLIENT_BOUNDARY_LIVENESS';
      expectedClientMeaning = null;
      priority = 112;
    }
  }

  if (dominantEvent?.type === 'DIRECT_QUESTION' && !suggestedReply) {
    suggestedReply = 'Проверю точные данные по актуальным документам выбранного объекта и вернусь с ответом.';
  }
  const allowed = (text: string, metric?: string | null) =>
    isSuggestionAllowedByState({
      text,
      closesMetric: metric,
      actionType,
      priority,
      eventType: dominantEvent?.type || null,
      stage: dominantEvent?.stage || workingState.stage,
    }, workingState) &&
    checkSemanticAntiRepeat(text, workingState, allTurns).accepted;
  if ((!suggestedReply || !allowed(suggestedReply, closesMetric)) && !dominantEvent?.suppressesAnalysis) {
    const objectionAlternative = autoObjectionGuidance ? getActiveObjectionGuidance(workingState, 1) : null;
    if (objectionAlternative && allowed(objectionAlternative.text, 'objections')) {
      suggestedReply = objectionAlternative.text;
      shortReason = objectionAlternative.reason;
      candidateRuleId = 'active_objection_guidance_variant';
      actionType = 'OBJECTION_CLARIFICATION';
      suggestionMode = 'OBJECTION_CLARIFICATION';
      closesMetric = 'objections';
      closesMetricLabel = 'Отработка возражений';
      immediatePriority = objectionAlternative.title;
      expectedClientMeaning = objectionAlternative.goal;
      priority = 75;
    } else {
    const alternatives: Array<[string, string]> = [
      ['goal', 'Для чего выбираете недвижимость: отдых, постоянная жизнь или инвестиции?'],
      ['propertyType', 'Какой формат жилья вам подходит — квартира или апартаменты?'],
      ['criteria', 'Если оставить только два критерия, по которым вы точно будете отсекать варианты, что это будет?'],
      ['experience', 'Что из уже просмотренного оказалось ближе всего к вашей задаче, а что точно не подошло?'],
      ['budget', 'До какой максимальной суммы рассматриваете покупку?'],
      ['downPayment', 'Средства для первого платежа уже доступны или сумма зависит от выбранной схемы?'],
      ['urgency', 'К какому сроку планируете определиться с покупкой?'],
    ];
    const alternative = alternatives.find(([metric, text]) => allowed(text, metric));
    if (alternative) {
      closesMetric = alternative[0];
      closesMetricLabel = scriptProgress.metrics[alternative[0]]?.name || null;
      suggestedReply = alternative[1];
      shortReason = `Fallback по открытому смысловому intent: ${closesMetricLabel || alternative[0]}.`;
      candidateRuleId = `qualification_fallback_${alternative[0]}`;
      actionType = 'CLARIFY';
      suggestionMode = 'WAIT';
      immediatePriority = closesMetricLabel ? `Уточнить: ${closesMetricLabel}` : 'Уточнить недостающий факт';
      expectedClientMeaning = null;
      priority = 50;
    } else suggestedReply = null;
    }
  }

  // Final liveness invariant: every substantive final client turn should leave
  // the agent with a useful next line unless the event explicitly suppresses
  // conversation (hard stop/compliance). This prevents the “Суфлёр готов” blank
  // state that appeared in RC4.1.
  if (!suggestedReply && lastClientTurn && !dominantEvent?.suppressesAnalysis) {
    const guidance = autoObjectionGuidance;
    if (guidance) {
      suggestedReply = guidance.text;
      shortReason = guidance.reason;
      candidateRuleId = 'liveness_active_objection';
      actionType = 'OBJECTION_CLARIFICATION';
      suggestionMode = 'OBJECTION_CLARIFICATION';
      closesMetric = 'objections';
      closesMetricLabel = 'Отработка возражений';
      immediatePriority = guidance.title;
      expectedClientMeaning = guidance.goal;
      priority = 74;
    } else {
      suggestedReply = 'Понял. Тогда зафиксирую это как критерий и дальше буду сравнивать варианты именно через него.';
      shortReason = 'Liveness fallback: содержательная реплика клиента не должна оставлять агента без следующей линии.';
      candidateRuleId = 'semantic_ack_liveness';
      actionType = 'SUMMARIZE';
      suggestionMode = 'WAIT';
      closesMetric = null;
      closesMetricLabel = null;
      immediatePriority = 'Сохранить текущий смысл клиента';
      expectedClientMeaning = null;
      priority = 45;
    }
  }

  return {
    sessionId: input.sessionId,
    basedOnRevision: input.revision,
    stage: dominantEvent?.stage || workingState.stage,
    dealStage: workingState.dealStage || 'qualification',
    conversationTask: workingState.conversationTask || 'understand_motive',
    clientIntent: dominantEvent?.type,
    actionType,
    suggestionMode,
    agentAction: calculatedAgentAction,
    selectedRuleId: candidateRuleId,
    factsDelta,
    fact_updates: factsDelta,
    activeConcern: null,
    objection: dominantEvent?.type === 'SOFT_RESISTANCE' ? 'soft_resistance' : null,
    candidateRuleId,
    suggestedReply,
    shortReason,
    expectedClientMeaning,
    evidenceTurnIds: dominantEvent
      ? [dominantEvent.evidenceTurnId]
      : lastClientTurn
        ? [lastClientTurn.id]
        : [],
    missingCriticalField: scriptProgress.quality?.immediatePriorityMetric || null,
    shouldSuggest: Boolean(suggestedReply),
    spinDelta: spin?.updatedSpin,
    hpb: spin?.hpb || null,
    scriptProgress,
    qualityResult: scriptProgress.quality,
    closesMetric,
    closesMetricLabel,
    immediatePriority,
    latencyMs: Date.now() - startedAt,
    modelUsed: 'local-deterministic',
    priority,
    eventType: dominantEvent?.type || null,
    fallbackReason: input.fallbackReason || null,
  };
}

/** Bounded Gemini context. Local state retains the full evidence ledger. */
export function buildCompactAnalysisContext(state: Partial<ConversationState>, turns: TranscriptTurn[] = []) {
  const fields = ['goal', 'primaryGoal', 'location', 'budget', 'paymentMethod', 'downPayment', 'downPaymentSource', 'familyMortgage', 'purchaseTimeline', 'decisionMakers', 'criteria', 'propertyType', 'searchExperience'];
  const facts = Object.fromEntries(fields.flatMap(field => {
    const entry = (state as any)[field];
    return entry?.value ? [[field, { value: entry.value, needsClarification: !!entry.needsClarification }]] : [];
  }));
  const activeFacts = new Map<string, object>();
  for (const fact of state.confirmedFacts || []) {
    if (fact.lifecycleStatus === 'superseded' || fact.lifecycleStatus === 'rejected') continue;
    activeFacts.set(fact.category, { category: fact.category, value: fact.value, evidenceQuote: fact.evidenceQuote, turnId: fact.turnId });
  }
  const uniqueTurns = new Map(turns.map(turn => [turn.id, turn]));
  return {
    stage: state.stage, task: state.conversationTask, revision: state.revision,
    facts, confirmedFacts: [...activeFacts.values()].slice(-20),
    openCoreMetrics: Object.values(state.scriptProgress?.metrics || {}).filter(metric => metric.isCoreCriteria && !['confirmed', 'not_applicable'].includes(metric.status)).map(metric => ({ id: metric.id, status: metric.status })),
    activeObjection: state.activeObjection ? { ...state.activeObjection, evidenceTurnIds: state.activeObjection.evidenceTurnIds.slice(-3) } : null,
    resistance: state.dialogueControl?.nextStepResistance ? { ...state.dialogueControl.nextStepResistance, evidenceTurnIds: state.dialogueControl.nextStepResistance.evidenceTurnIds.slice(-3) } : null,
    blockedNextSteps: state.dialogueControl?.blockedNextSteps || [],
    rejectedBranches: state.dialogueControl?.rejectedBranches || [],
    clientBoundaryActive: state.dialogueControl?.clientBoundaryActive || false,
    researchMode: state.dialogueControl?.researchMode || state.spin?.researchMode || false,
    spin: state.spin ? { currentStage: state.spin.currentStage, completedStages: state.spin.completedStages, lastClientEvidence: state.spin.lastClientEvidence,
      problem: state.spin.problem.slice(-2), implication: state.spin.implication.slice(-2), needPayoff: state.spin.needPayoff.slice(-2) } : null,
    nextStep: state.nextStepAgreement,
    semanticKeys: [...new Set((state.askedQuestions || []).map(extractSemanticKey))].slice(-8),
    recentTurns: [...uniqueTurns.values()].slice(-6).map(({ id, speaker, text }) => ({ id, speaker, text })),
  };
}