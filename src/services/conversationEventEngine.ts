import * as legacy from './conversationEventEngineLegacy';
import type { ConversationEventDetection } from './conversationEventEngineLegacy';
import type { ConversationState, TranscriptTurn } from '../types';

export * from './conversationEventEngineLegacy';

const normalize = (value: string): string =>
  (value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

function lastAgentBefore(turn: TranscriptTurn, recentTurns: TranscriptTurn[]): TranscriptTurn | null {
  const before = recentTurns.filter((candidate) => {
    if (candidate.id === turn.id || candidate.speaker !== 'agent') return false;
    if (typeof candidate.revision === 'number' && typeof turn.revision === 'number') {
      return candidate.revision < turn.revision;
    }
    return candidate.timestamp <= turn.timestamp;
  });
  return before.at(-1) || null;
}

function isRhetoricalTagQuestion(text: string): boolean {
  const normalized = normalize(text);
  if (normalized.length < 18) return false;
  return /(?:,|—|-)\s*(?:да|верно|правильно)\s*\?\s*$/iu.test(text) &&
    !/^(?:да|верно|правильно)\s*\?\s*$/iu.test(normalized);
}

function isAffirmativeAcknowledgement(text: string): boolean {
  if (!text.includes('?')) return false;
  const normalized = normalize(text)
    .replace(/[.,!?;:—-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = normalized.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 9) return false;
  const hasInterrogativeIntent = /(?:^|\s)(?:кто|что|где|когда|почему|зачем|какой|какая|какие|сколько|можно\s+ли|есть\s+ли|подскажите|скажите|уточните)(?:$|\s)/iu.test(normalized);
  if (hasInterrogativeIntent) return false;
  const hasAffirmative = /(?:^|\s)(?:да|угу|ага|хорошо|ладно|понял|понятно|согласен|согласна|договорились|окей|давайте)(?:$|\s)/iu.test(normalized);
  const hasCommitment = /(?:давайте\s+(?:так|сделаем)|хорошо|согласен|согласна|договорились|окей)/iu.test(normalized);
  return hasAffirmative && hasCommitment;
}

function isQualificationAnswerMisreadAsDirectQuestion(
  result: ConversationEventDetection | null,
  turn: TranscriptTurn,
  recentTurns: TranscriptTurn[],
): boolean {
  if (result?.type !== 'DIRECT_QUESTION' || turn.speaker !== 'client' || turn.text.includes('?')) return false;
  const previousAgent = lastAgentBefore(turn, recentTurns);
  const agentText = normalize(previousAgent?.text || '');
  const clientText = normalize(turn.text);

  const askedMotiveOrGoal =
    /(?:какую\s+задачу|для\s+чего|цель\s+покупк|что\s+должно\s+измениться|почему[^.!?]{0,45}(?:сейчас|покуп)|что[^.!?]{0,45}(?:подтолкнул|актуаль))/iu.test(agentText);
  const affordabilityAnswer =
    /(?:хочу|хотел\p{L}*|нужно|надо)[^.!?]{0,30}(?:понять|разобраться|узнать)[^.!?]{0,55}(?:(?:что|сколько)[^.!?]{0,35}(?:могу|можем)[^.!?]{0,20}(?:себе\s+)?позволить|(?:какой\s+)?бюджет[^.!?]{0,25}(?:доступен|реален|потяну))/iu.test(clientText);

  return askedMotiveOrGoal && affordabilityAnswer;
}

function hasClientMaterialsContext(text: string): boolean {
  const lower = normalize(text);
  return /(?:пришл\p{L}*|скин\p{L}*|отправ\p{L}*|присыл\p{L}*|материал\p{L}*|подборк\p{L}*)/iu.test(lower) ||
    /(?:не\s+(?:надо|нужно|хочу)|пока\s+не\s+(?:надо|нужно))[^.!?]{0,35}информац\p{L}*/iu.test(lower);
}

function hasAgentMaterialsProposal(text: string): boolean {
  const lower = normalize(text);
  return /(?:пришл\p{L}*|скин\p{L}*|отправ\p{L}*|присыл\p{L}*|материал\p{L}*|подборк\p{L}*)/iu.test(lower);
}

function isFalseMaterialsResistance(
  result: ConversationEventDetection | null,
  turn: TranscriptTurn,
  recentTurns: TranscriptTurn[],
  state: ConversationState,
): boolean {
  if (result?.type !== 'NEXT_STEP_RESISTANCE' || result.nextStepTarget !== 'materials') return false;
  const previousAgent = lastAgentBefore(turn, recentTurns);
  const remembered = state.dialogueControl?.nextStepResistanceHistory?.materials;
  const rememberedActive = Boolean(remembered && !['handled', 'resolved'].includes(String(remembered.status)));
  return !hasClientMaterialsContext(turn.text) &&
    !hasAgentMaterialsProposal(previousAgent?.text || '') &&
    !rememberedActive;
}

function isLateResearchMode(
  result: ConversationEventDetection | null,
  turn: TranscriptTurn,
  state: ConversationState,
): boolean {
  if (result?.type !== 'RESEARCH_MODE') return false;
  if (state.dialogueControl?.researchMode) return true;

  const goalKnown = Boolean(state.goal?.value || state.primaryGoal?.value);
  const criteriaKnown = Boolean(state.criteria?.value || state.criteria?.items?.length);
  const budgetKnown = Boolean(state.budget?.value);
  const propertyTypeKnown = Boolean(state.propertyType?.value);
  const alreadyQualified = goalKnown && (criteriaKnown || budgetKnown || propertyTypeKnown);
  if (!alreadyQualified) return false;

  const lower = normalize(turn.text);
  const passiveCueOnly = /(?:пока\s+присматриваюсь|только\s+изучаю|просто\s+изучаю|изучаю\s+рынок)/iu.test(lower);
  return passiveCueOnly;
}

function contextualizeLegacyResult(
  result: ConversationEventDetection | null,
  turn: TranscriptTurn,
  recentTurns: TranscriptTurn[],
  state: ConversationState,
): ConversationEventDetection | null {
  if (!result) return null;
  if (isQualificationAnswerMisreadAsDirectQuestion(result, turn, recentTurns)) return null;
  if (isFalseMaterialsResistance(result, turn, recentTurns, state)) return null;
  if (isLateResearchMode(result, turn, state)) return null;
  return result;
}

function detectNextStepQuestion(
  turn: TranscriptTurn,
  state: ConversationState,
): ConversationEventDetection | null {
  if (turn.speaker !== 'client') return null;
  const text = normalize(turn.text);
  const asksNextStep = /(?:какой|что)\s+(?:у\s+нас\s+)?следующ(?:ий|его)\s+шаг|следующ(?:ий|его)\s+шаг\s+(?:какой|что)|что\s+(?:делаем\s+)?дальше|как\s+(?:идем|идём|двигаемся)\s+дальше/iu.test(text);
  if (!asksNextStep) return null;

  const criteriaKnown = Boolean(state.criteria?.value);
  const budgetKnown = Boolean(state.budget?.value);
  const paymentKnown = Boolean(state.paymentMethod?.value);
  const suggestedReply = !budgetKnown || !paymentKnown
    ? 'Следующий шаг: уточним бюджет и способ покупки, затем я отберу 2–3 варианта по вашим критериям и сравним их по существу.'
    : criteriaKnown
      ? 'Следующий шаг: я отберу 2–3 варианта по вашим критериям и покажу, где сильнее ликвидность, риски и условия. После этого решим, что смотреть дальше.'
      : 'Следующий шаг: зафиксируем 2–3 решающих критерия, после чего я отберу только подходящие варианты для сравнения.';

  return {
    type: 'DIRECT_QUESTION',
    priority: 106,
    actionType: 'ANSWER',
    ruleId: 'direct_question_next_step',
    suggestedReply,
    shortReason: 'Клиент прямо спросил о следующем шаге: отвечаем планом действий вместо встречного общего вопроса.',
    evidenceTurnId: turn.id,
    evidenceQuote: turn.text,
    suppressesAnalysis: true,
    stage: state.stage,
  };
}

function detectDeferredMeeting(
  turn: TranscriptTurn,
  recentTurns: TranscriptTurn[],
  state: ConversationState,
): ConversationEventDetection | null {
  if (turn.speaker !== 'client') return null;

  const text = normalize(turn.text);
  const previousAgent = lastAgentBefore(turn, recentTurns);
  const agentText = normalize(previousAgent?.text || '');
  const meetingContext = /(?:видеовстреч|видеопоказ|видео|созвон|зум|zoom|встреч|показ)/iu.test(agentText);
  if (!meetingContext) return null;

  const deferral = /(?:поставим\s+паузу|возьм[её]м\s+паузу|взять\s+время\s+на\s+размышлен|хочу\s+(?:сначала\s+)?подумать|я\s+подумаю|мне\s+надо\s+подумать|давайте\s+(?:пока\s+)?(?:потом|позже)|не\s+готов\p{L}*\s+(?:сейчас\s+)?(?:назначать|фиксировать|созваниваться|встречаться)|через\s+(?:какое-то|некоторое)\s+время\s+(?:мы\s+)?(?:с\s+вами\s+)?свяжемся)/iu.test(text);
  if (!deferral) return null;

  const priorCount = state.dialogueControl?.nextStepResistanceHistory?.ppv?.count || 0;
  const repeated = priorCount >= 1;

  return {
    type: 'NEXT_STEP_RESISTANCE',
    priority: repeated ? 98 : 96,
    actionType: repeated ? 'RESPECT_STOP' : 'OBJECTION_CLARIFICATION',
    ruleId: 'next_step_resistance_ppv_deferral',
    suggestedReply: repeated
      ? 'Понял, встречу не фиксирую. Отправлю 2–3 варианта под ваши критерии, а к созвону вернёмся только если будет смысл.'
      : 'Понимаю. Чтобы не давить: вы хотите подумать о самом решении, бюджете или формате объекта?',
    shortReason: repeated
      ? 'Клиент повторно отложил видеовстречу: границу уважаем и не возвращаемся к назначению слота.'
      : 'Клиент отложил видеовстречу. Сначала изолируем реальную причину паузы, встречу не считаем согласованной.',
    evidenceTurnId: turn.id,
    evidenceQuote: turn.text,
    suppressesAnalysis: repeated,
    stage: 'objection_clarification',
    nextStepTarget: 'ppv',
  };
}

export function detectConversationEvent(
  turn: TranscriptTurn,
  recentTurns: TranscriptTurn[],
  state: ConversationState,
  now = Date.now(),
): ConversationEventDetection | null {
  const nextStepQuestion = detectNextStepQuestion(turn, state);
  if (nextStepQuestion) return nextStepQuestion;

  const deferredMeeting = detectDeferredMeeting(turn, recentTurns, state);
  if (deferredMeeting) return deferredMeeting;

  if (turn.speaker === 'client' && isAffirmativeAcknowledgement(turn.text)) {
    const withoutQuestionMark = turn.text.replace(/\?/gu, '.');
    const result = legacy.detectConversationEvent({ ...turn, text: withoutQuestionMark }, recentTurns, state, now);
    if (result?.type === 'DIRECT_QUESTION') return null;
    const contextual = contextualizeLegacyResult(result, turn, recentTurns, state);
    return contextual ? { ...contextual, evidenceTurnId: turn.id, evidenceQuote: turn.text } : null;
  }

  if (turn.speaker === 'client' && isRhetoricalTagQuestion(turn.text)) {
    const withoutTag = turn.text.replace(/(?:,|—|-)\s*(?:да|верно|правильно)\s*\?\s*$/iu, '.');
    const result = legacy.detectConversationEvent({ ...turn, text: withoutTag }, recentTurns, state, now);
    const contextual = contextualizeLegacyResult(result, turn, recentTurns, state);
    return contextual ? { ...contextual, evidenceTurnId: turn.id, evidenceQuote: turn.text } : null;
  }

  return contextualizeLegacyResult(
    legacy.detectConversationEvent(turn, recentTurns, state, now),
    turn,
    recentTurns,
    state,
  );
}

export function applyConversationEvent(
  current: ConversationState,
  event: ConversationEventDetection,
  turn: TranscriptTurn,
  now = Date.now(),
): ConversationState {
  const next = legacy.applyConversationEvent(current, event, turn, now);

  if (event.type !== 'NEXT_STEP_RESISTANCE' || event.nextStepTarget !== 'ppv') return next;

  return {
    ...next,
    agreedNextStep: {
      value: null,
      evidenceTurnIds: next.agreedNextStep?.evidenceTurnIds || [],
      needsClarification: true,
    },
    nextStepAgreement: next.nextStepAgreement
      ? { ...next.nextStepAgreement, status: 'none' }
      : next.nextStepAgreement,
    confirmedFacts: (next.confirmedFacts || []).map((fact) =>
      fact.category === 'next_step' && fact.turnId === turn.id
        ? { ...fact, lifecycleStatus: 'rejected' as const }
        : fact
    ),
  };
}
