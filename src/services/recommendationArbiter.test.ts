import { describe, expect, it } from 'vitest';
import { createInitialState } from './conversationStore';
import { isSuggestionAllowedByState, shouldReplaceSuggestion } from './suggestionLifecycle';
import {
  arbitrateRecommendationCandidates,
  RecommendationCandidate,
} from './recommendationArbiter';
import type { SuggestedReply } from '../types';

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

function reply(overrides: Partial<SuggestedReply>): SuggestedReply {
  return {
    id: 'reply_default',
    sessionId: 'session_test',
    basedOnRevision: 1,
    candidateRuleId: null,
    selectedRuleId: null,
    actionType: 'CLARIFY',
    text: 'Тестовая подсказка',
    shortReason: 'test',
    expectedClientMeaning: null,
    closesMetric: null,
    closesMetricLabel: null,
    immediatePriority: null,
    suggestionMode: 'WAIT',
    evidenceTurnIds: [],
    createdAt: 1000,
    stage: 'contact',
    confidenceStatus: 'high',
    lifecycleStatus: 'shown',
    semanticKey: 'test',
    priority: 60,
    eventType: null,
    source: 'local_engine',
    ttlMs: 15000,
    used: false,
    ...overrides,
  } as SuggestedReply;
}

describe('recommendation arbitration', () => {
  it('prefers objection guidance over generic script at similar priority', () => {
    const result = arbitrateRecommendationCandidates([
      candidate('script', 70, 'script'),
      candidate('objection', 70, 'objection'),
    ]);
    expect(result.winner?.id).toBe('objection');
  });

  it('keeps the current card when a slightly stronger generic candidate appears', () => {
    const current = candidate('current', 70, 'script', { semanticKey: 'budget' });
    const next = candidate('next', 75, 'script', { semanticKey: 'timeline' });
    const result = arbitrateRecommendationCandidates([next], current);
    expect(result.winner?.id).toBe('current');
  });

  it('allows stop/boundary guidance to supersede immediately', () => {
    const current = candidate('spin', 78, 'spin', { semanticKey: 'spin_problem' });
    const stop = candidate('stop', 110, 'event', {
      actionType: 'RESPECT_STOP',
      suppressesLowerPriority: true,
      semanticKey: 'client_stop',
    });
    const result = arbitrateRecommendationCandidates([stop], current);
    expect(result.winner?.id).toBe('stop');
  });

  it('uses arbiter hysteresis at the live display boundary', () => {
    const current = reply({
      id: 'current',
      priority: 70,
      semanticKey: 'budget',
      suggestionMode: 'WAIT',
      createdAt: 1000,
    });
    const next = reply({
      id: 'next',
      basedOnRevision: 2,
      priority: 75,
      semanticKey: 'timeline',
      suggestionMode: 'WAIT',
      createdAt: 1100,
    });
    expect(shouldReplaceSuggestion(current, next, 1200)).toBe(false);
  });

  it('does not let a second SPIN micro-chain outrank an still-open purchase goal', () => {
    const state = createInitialState();
    state.revision = 10;
    state.spin = {
      ...state.spin,
      problem: [
        { text: 'Шум мешает спать', evidenceQuote: 'шум', evidenceTurnId: 'c1', source: 'client', confidence: 0.95 },
        { text: 'Тихо, но неудобно добираться', evidenceQuote: 'тихо, но далеко', evidenceTurnId: 'c2', source: 'client', confidence: 0.95 },
      ],
      currentStage: 'IMPLICATION',
    };
    state.scriptProgress = {
      routeStage: 'client_research',
      metrics: {
        goal: {
          id: 'goal', field: 'goal', name: 'Цель покупки', category: 'needs',
          status: 'not_confirmed', isCoreCriteria: true, value: null, confidence: 0.5,
          semanticReason: 'Цель покупки не определена', agentQuestionAsked: false, agentQuestionQuote: null,
        },
      },
      trust: undefined as any,
      ppi: undefined as any,
      ppv: undefined as any,
      quality: {
        isQualityCall: false,
        passedCoreCriteriaCount: 1,
        totalCoreCriteria: 12,
        mandatoryTrustPassed: false,
        mandatoryPpvPassed: false,
        verdict: 'NEEDS_WORK',
        verdictReason: 'test',
        immediatePriorityMetric: 'goal',
        immediatePriorityHint: 'Разграничить отдых, ПМЖ или инвестиции без домыслов',
        nextScriptStep: 'Исследование клиента (Goal)',
      },
      purchaseDependency: null,
    } as any;

    const spinCandidate = reply({
      basedOnRevision: 10,
      text: 'Сколько времени сейчас уходит на дорогу и что из-за этого приходится откладывать?',
      suggestionMode: 'SPIN_IMPLICATION',
      actionType: 'DEEPEN',
      priority: 60,
      semanticKey: 'traffic_implication',
      closesMetric: null,
    });

    expect(isSuggestionAllowedByState(spinCandidate, state, 10)).toBe(false);

    const goalCandidate = reply({
      basedOnRevision: 10,
      text: 'Для чего выбираете недвижимость: отдых, постоянная жизнь или инвестиции?',
      suggestionMode: 'WAIT',
      actionType: 'CLARIFY',
      priority: 50,
      semanticKey: 'goal',
      closesMetric: 'goal',
    });
    expect(isSuggestionAllowedByState(goalCandidate, state, 10)).toBe(true);
  });
});
