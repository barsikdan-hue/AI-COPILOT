import { ConversationState, DiagnosticsData, SuggestedReply, isMetricClosed } from '../types';
import { extractDeterministicFacts } from './deterministicFacts';

export const DEFAULT_SUGGESTION_PRIORITY = 50;

/**
 * Final presentation policy for live cards. This intentionally runs at the
 * single display boundary so wording fixes cannot drift between SPIN, fallback
 * and event sources.
 */
export function applyLiveSuggestionPresentationPolicy(
  candidate: Partial<SuggestedReply>,
  state: ConversationState
): void {
  if (candidate.text) {
    candidate.text = candidate.text
      .replace(/\s+или\s+пробовали/giu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // If the client speaks before the agent's greeting is captured, the very
  // first ordinary hint should still help the agent open the call naturally.
  // Never override a P0/control event such as stop, resistance or direct answer.
  const isSafeOpeningCandidate =
    candidate.basedOnRevision === 1 &&
    !candidate.eventType &&
    (candidate.priority || DEFAULT_SUGGESTION_PRIORITY) < 100 &&
    state.stage === 'contact' &&
    (state.askedQuestions?.length || 0) === 0;

  if (isSafeOpeningCandidate) {
    candidate.text = 'Добрый день! Данил, «Элитный Сочи». Как могу к вам обращаться?';
    candidate.candidateRuleId = 'opening_greeting';
    candidate.selectedRuleId = 'opening_greeting';
    candidate.actionType = 'CLARIFY';
    candidate.closesMetric = null;
    candidate.closesMetricLabel = null;
    candidate.immediatePriority = 'Коротко представиться и узнать имя клиента';
    candidate.shortReason = 'Первая подсказка звонка: короткое приветствие без длинной вводной.';
    candidate.priority = 90;
    candidate.semanticKey = 'opening_greeting';
  }
}

export function isPendingSuggestionSuperseded(
  pendingRevision: number,
  lastSubstantiveRevision: number
): boolean {
  return pendingRevision < lastSubstantiveRevision;
}

export function shouldReplaceSuggestion(
  current: SuggestedReply | null,
  candidate: SuggestedReply,
  now = Date.now()
): boolean {
  if (!current) return true;
  if (current.sessionId !== candidate.sessionId) return true;
  if (candidate.basedOnRevision < current.basedOnRevision) return false;

  const currentStatus = current.lifecycleStatus || 'shown';
  if (currentStatus === 'expired' || currentStatus === 'superseded' || currentStatus === 'suppressed') {
    return true;
  }

  const currentPriority = current.priority ?? DEFAULT_SUGGESTION_PRIORITY;
  const candidatePriority = candidate.priority ?? DEFAULT_SUGGESTION_PRIORITY;
  const currentTtl = current.ttlMs ?? 15000;
  const currentIsFresh = now - current.createdAt <= currentTtl;

  if (candidatePriority > currentPriority) return true;
  if (candidatePriority < currentPriority && currentIsFresh &&
      !(['local_engine', 'local_event'].includes(candidate.source || '') && candidate.basedOnRevision > current.basedOnRevision && currentPriority < 100)) return false;

  const currentKey = current.semanticKey || current.text.trim().toLocaleLowerCase('ru-RU');
  const candidateKey = candidate.semanticKey || candidate.text.trim().toLocaleLowerCase('ru-RU');
  if (currentKey === candidateKey) return false;

  const sameRevisionLocalCorrection =
    candidate.basedOnRevision === current.basedOnRevision &&
    ['local_engine', 'local_event'].includes(candidate.source || '') &&
    ['local_engine', 'local_event'].includes(current.source || '') &&
    candidate.createdAt > current.createdAt;

  return sameRevisionLocalCorrection || candidate.basedOnRevision > current.basedOnRevision || !currentIsFresh;
}

/** Branch constraints apply to both local and cloud candidates before display. */
export function isSuggestionAllowedByState(candidate: Partial<SuggestedReply>, state: ConversationState, latestRevision = state.revision): boolean {
  applyLiveSuggestionPresentationPolicy(candidate, state);

  if (candidate.basedOnRevision != null && candidate.basedOnRevision < latestRevision) return false;
  const text = candidate.text || '';
  const lower = text.toLocaleLowerCase('ru-RU');
  const blocked = state.dialogueControl?.blockedNextSteps || [];
  if (candidate.closesMetric && blocked.includes(candidate.closesMetric)) return false;
  const proposes = /давайте|предлагаю|подключ|назнач|провед|провести|запиш|удобн|готов|сравним|подойд|рассмотр|рекоменд/iu.test(text);
  if (blocked.includes('ppi') && proposes && /брокер|специалист|ипотечн.*консультац/iu.test(text) && !/видео|показ|специалист.{0,5}застройщик/iu.test(text)) return false;
  if (blocked.includes('ppv') && proposes && /видео|показ/iu.test(text)) return false;
  const confirmationEvent = ['MEETING_CONTRACT', 'NEXT_STEP_REOPENED'].includes(String(candidate.eventType || ''));

  // Session 17 exposed a state-drift edge case: the derived first-call metric
  // could mark criteria as closed from the word "тишина" in the meaning
  // "the agent went silent", while canonical client criteria were still empty.
  // A derived-only false positive must not black-hole the next hint.
  const derivedOnlyCriteriaClosure =
    candidate.closesMetric === 'criteria' &&
    !state.criteria?.value &&
    !(state.criteria?.items?.length);

  if (
    candidate.closesMetric &&
    isMetricClosed(state.scriptProgress?.metrics[candidate.closesMetric]?.status || 'not_confirmed') &&
    !confirmationEvent &&
    !derivedOnlyCriteriaClosure
  ) return false;
  if (state.dialogueControl?.clientBoundaryActive) {
    const boundarySafeEvent = [
      'CLIENT_STOP',
      'TIME_CONSTRAINT',
      'SOFT_RESISTANCE',
      'NEXT_STEP_RESISTANCE',
      'NEXT_STEP_REOPENED',
      'EXPLICIT_REJECTION',
      'DIRECT_QUESTION',
      'MEETING_CONTRACT',
    ].includes(String(candidate.eventType || ''));
    const boundarySafeAction = ['RESPECT_STOP', 'OBJECTION_CLARIFICATION', 'ANSWER', 'WAIT'].includes(candidate.actionType || '');
    const boundarySafeStage = candidate.stage === 'objection_clarification';
    const highPriorityOverride = (candidate.priority || 0) >= 110;

    // A client boundary must stop the questionnaire, not the copilot itself.
    // Objection handling / respectful stop / direct answers still need to reach the agent.
    if (!boundarySafeEvent && !boundarySafeAction && !boundarySafeStage && !highPriorityOverride) return false;
  }
  if (state.paymentMethod.value?.includes('Ипотека') && /(?:покупаете|оплачиваете|покупаем).*(?:наличн|без ипотеки)/iu.test(text)) return false;
  if (/наличные|собственные средства/iu.test(state.paymentMethod.value || '') && /(?:покупаете|оплачиваете|покупаем).*в ипотеку/iu.test(text)) return false;
  if (/ваш.{0,15}бюджет|у вас.*реб[её]нок|вы.*(?:покупаете|оплачиваете)/iu.test(text)) {
    for (const fact of extractDeterministicFacts(text, 'candidate')) {
      if (!['budget', 'paymentMethod', 'familyMortgage'].includes(fact.field)) continue;
      const canonical = (state as any)[fact.field];
      if (canonical?.value && !canonical.needsClarification && !fact.needsClarification && canonical.value !== fact.value) return false;
    }
  }
  for (const branch of state.dialogueControl?.rejectedBranches || []) {
    const stem = branch.toLocaleLowerCase('ru-RU').slice(0, Math.max(3, branch.length - 2));
    if (proposes && lower.includes(stem) && !/не предлага|исключ|не рассматрива/iu.test(lower)) return false;
  }
  return true;
}

export function recordAnalysisLatency<T extends Pick<DiagnosticsData, 'analysisLatencyMs' | 'firstHintLatencyMs' | 'geminiLatencyMs' | 'localDecisionLatencyMs'>>(current: T, result: { modelUsed?: string; latencyMs?: number; aiResponseElapsedMs?: number }): T {
  return result.modelUsed === 'local-deterministic'
    ? { ...current, localDecisionLatencyMs: result.latencyMs ?? current.localDecisionLatencyMs }
    : { ...current, geminiLatencyMs: result.aiResponseElapsedMs ?? result.latencyMs ?? current.geminiLatencyMs };
}