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

  // "Давайте" is not consent by itself. In live calls it often starts a refusal:
  // "давайте поставим паузу", "давайте потом", etc. These phrases must win
  // over MEETING_CONTRACT detection before any agreement is persisted.
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
  const deferredMeeting = detectDeferredMeeting(turn, recentTurns, state);
  if (deferredMeeting) return deferredMeeting;
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

  // A refusal/deferral can arrive immediately after a time-slot proposal. Never
  // preserve an "agreed" next step or a synthetic next_step fact from that same
  // negative client turn.
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
