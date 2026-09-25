import { ConversationState, DiagnosticsData, SuggestedReply, isMetricClosed } from '../types';
import { extractDeterministicFacts } from './deterministicFacts';
import {
  arbitrateRecommendationCandidates,
  RecommendationCandidate,
  RecommendationSource,
} from './recommendationArbiter';

export const DEFAULT_SUGGESTION_PRIORITY = 50;

function sourceForSuggestion(reply: Partial<SuggestedReply>): RecommendationSource {
  if (reply.eventType || reply.source === 'local_event') return 'event';
  if (reply.actionType === 'OBJECTION_CLARIFICATION' || reply.suggestionMode === 'OBJECTION_CLARIFICATION') return 'objection';
  if (String(reply.suggestionMode || '').startsWith('SPIN_') || reply.suggestionMode === 'HPB_PRESENTATION') return 'spin';
  if (reply.closesMetric) return 'script';
  if (reply.source === 'rule_engine') return 'rule';
  return 'fallback';
}

function asRecommendationCandidate(reply: SuggestedReply): RecommendationCandidate {
  return {
    id: reply.id,
    source: sourceForSuggestion(reply),
    text: reply.text,
    shortReason: reply.shortReason || '',
    actionType: reply.actionType || 'CLARIFY',
    suggestionMode: reply.suggestionMode || 'WAIT',
    priority: reply.priority ?? DEFAULT_SUGGESTION_PRIORITY,
    semanticKey: reply.semanticKey,
    closesMetric: reply.closesMetric,
    closesMetricLabel: reply.closesMetricLabel,
    immediatePriority: reply.immediatePriority,
    expectedClientMeaning: reply.expectedClientMeaning,
    evidenceTurnIds: reply.evidenceTurnIds,
    eventType: reply.eventType,
    suppressesLowerPriority: reply.actionType === 'RESPECT_STOP' || reply.priority >= 110,
    freshEvidence: true,
    continuesActiveThread: String(reply.suggestionMode || '').startsWith('SPIN_'),
    blocked: reply.lifecycleStatus === 'suppressed',
    stale: reply.lifecycleStatus === 'expired' || reply.lifecycleStatus === 'superseded',
  };
}

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
  if (currentStatus === 'expired' || currentStatus === 'superseded' || currentStatus === 'suppressed') return true;

  const currentTtl = current.ttlMs ?? 15000;
  const currentIsFresh = now - current.createdAt <= currentTtl;
  if (!currentIsFresh) return true;

  const arbitration = arbitrateRecommendationCandidates(
    [asRecommendationCandidate(candidate)],
    asRecommendationCandidate(current)
  );
  return arbitration.winner?.id === candidate.id;
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

  // A second SPIN micro-chain must not keep drilling while the first-call engine
  // still lacks the client's basic purchase goal. This is exactly the failure
  // from the 2026-09-25 live call: after one meaningful pain was explored, a new
  // logistics problem displaced the more important Goal step.
  const goalOpen = !isMetricClosed(state.scriptProgress?.metrics?.goal?.status || 'not_confirmed');
  const secondProblemChain = (state.spin?.problem?.length || 0) >= 2;
  const genericSpinFollowUp =
    !candidate.eventType &&
    !candidate.closesMetric &&
    ['SPIN_PROBLEM', 'SPIN_IMPLICATION'].includes(String(candidate.suggestionMode || ''));
  const qualityWantsGoal = state.scriptProgress?.quality?.immediatePriorityMetric === 'goal';
  if (goalOpen && secondProblemChain && genericSpinFollowUp && qualityWantsGoal) return false;

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
