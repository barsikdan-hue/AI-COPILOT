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

  if (turn.speaker === 'client' && isRhetoricalTagQuestion(turn.text)) {
    const withoutTag = turn.text.replace(/(?:,|—|-)\s*(?:да|верно|правильно)\s*\?\s*$/iu, '.');
    const result = legacy.detectConversationEvent({ ...turn, text: withoutTag }, recentTurns, state, now);
    return result ? { ...result, evidenceTurnId: turn.id, evidenceQuote: turn.text } : null;
  }

  return legacy.detectConversationEvent(turn, recentTurns, state, now);
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
