import { describe, expect, it } from 'vitest';
import {
  arbitrateRecommendationCandidates,
  RecommendationCandidate,
} from './recommendationArbiter';

function candidate(
  id: string,
  priority: number,
  source: RecommendationCandidate['source'],
  overrides: Partial<RecommendationCandidate> = {}
): RecommendationCandidate {
  return {
    id,
    source,
    text: id,
    shortReason: id,
    actionType: 'CLARIFY',
    suggestionMode: 'WAIT',
    priority,
    ...overrides,
  };
}

describe('recommendationArbiter', () => {
  it('prefers objection guidance over generic script at similar priority', () => {
    const result = arbitrateRecommendationCandidates([
      candidate('script', 70, 'script'),
      candidate('objection', 70, 'objection'),
    ]);
    expect(result.winner?.id).toBe('objection');
  });

  it('does not let rapport displace an active SPIN chain', () => {
    const result = arbitrateRecommendationCandidates([
      candidate('spin', 60, 'spin', { continuesActiveThread: true }),
      candidate('rapport', 62, 'rapport'),
    ]);
    expect(result.winner?.id).toBe('spin');
  });

  it('hard-supersedes with a stop/boundary event', () => {
    const current = candidate('spin', 78, 'spin', { semanticKey: 'spin_problem' });
    const stop = candidate('stop', 110, 'event', {
      actionType: 'RESPECT_STOP',
      suppressesLowerPriority: true,
      semanticKey: 'client_stop',
    });
    const result = arbitrateRecommendationCandidates([stop], current);
    expect(result.winner?.id).toBe('stop');
  });

  it('uses hysteresis and keeps current card for a small score difference', () => {
    const current = candidate('current', 70, 'script', { semanticKey: 'budget' });
    const next = candidate('next', 75, 'script', { semanticKey: 'timeline' });
    const result = arbitrateRecommendationCandidates([next], current);
    expect(result.winner?.id).toBe('current');
  });

  it('allows a materially stronger candidate to supersede current card', () => {
    const current = candidate('current', 60, 'script', { semanticKey: 'budget' });
    const next = candidate('next', 85, 'objection', { semanticKey: 'price_objection' });
    const result = arbitrateRecommendationCandidates([next], current);
    expect(result.winner?.id).toBe('next');
  });

  it('filters blocked and stale candidates', () => {
    const result = arbitrateRecommendationCandidates([
      candidate('blocked', 120, 'event', { blocked: true }),
      candidate('stale', 110, 'objection', { stale: true }),
      candidate('valid', 50, 'fallback'),
    ]);
    expect(result.winner?.id).toBe('valid');
    expect(result.ranked.map((item) => item.id)).toEqual(['valid']);
  });

  it('keeps the current card when a new candidate means the same thing', () => {
    const current = candidate('current', 60, 'script', { semanticKey: 'goal' });
    const reworded = candidate('reworded', 90, 'objection', { semanticKey: 'goal' });
    const result = arbitrateRecommendationCandidates([reworded], current);
    expect(result.winner?.id).toBe('current');
  });
});
