import { ActionType, SuggestionMode } from '../types';

export type RecommendationSource =
  | 'event'
  | 'objection'
  | 'spin'
  | 'script'
  | 'rule'
  | 'rapport'
  | 'fallback';

export interface RecommendationCandidate {
  id: string;
  source: RecommendationSource;
  text: string;
  shortReason: string;
  actionType: ActionType;
  suggestionMode: SuggestionMode;
  priority: number;
  semanticKey?: string | null;
  closesMetric?: string | null;
  closesMetricLabel?: string | null;
  immediatePriority?: string | null;
  expectedClientMeaning?: string | null;
  evidenceTurnIds?: string[];
  eventType?: string | null;
  suppressesLowerPriority?: boolean;
  freshEvidence?: boolean;
  continuesActiveThread?: boolean;
  blocked?: boolean;
  stale?: boolean;
}

export interface ArbitrationResult {
  winner: RecommendationCandidate | null;
  ranked: Array<RecommendationCandidate & { score: number }>;
}

const SOURCE_BONUS: Record<RecommendationSource, number> = {
  event: 12,
  objection: 10,
  spin: 7,
  script: 5,
  rule: 4,
  rapport: 1,
  fallback: -8,
};

export const DEFAULT_SUPERSEDE_MARGIN = 12;

export function scoreRecommendationCandidate(candidate: RecommendationCandidate): number {
  if (!candidate.text?.trim() || candidate.blocked || candidate.stale) return Number.NEGATIVE_INFINITY;

  let score = candidate.priority + SOURCE_BONUS[candidate.source];
  if (candidate.freshEvidence) score += 4;
  if (candidate.continuesActiveThread) score += 5;
  if (candidate.suppressesLowerPriority) score += 8;
  return score;
}

export function arbitrateRecommendationCandidates(
  candidates: RecommendationCandidate[],
  current?: RecommendationCandidate | null,
  supersedeMargin = DEFAULT_SUPERSEDE_MARGIN
): ArbitrationResult {
  const ranked = candidates
    .map((candidate) => ({ ...candidate, score: scoreRecommendationCandidate(candidate) }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((a, b) => b.score - a.score || b.priority - a.priority || a.id.localeCompare(b.id));

  const best = ranked[0] || null;
  if (!best) return { winner: null, ranked };
  if (!current) return { winner: best, ranked };

  const currentScore = scoreRecommendationCandidate(current);
  if (!Number.isFinite(currentScore)) return { winner: best, ranked };

  const sameMeaning = Boolean(
    current.semanticKey && best.semanticKey && current.semanticKey === best.semanticKey
  );
  if (sameMeaning) return { winner: current, ranked };

  const hardSupersede = best.suppressesLowerPriority || best.actionType === 'RESPECT_STOP';
  if (hardSupersede || best.score >= currentScore + supersedeMargin) {
    return { winner: best, ranked };
  }

  return { winner: current, ranked };
}
