import { describe, expect, it } from 'vitest';
import type { SuggestedReply } from '../types';
import { createInitialState } from './conversationStore';
import {
  applyLiveSuggestionPresentationPolicy,
  isSuggestionAllowedByState,
} from './suggestionLifecycle';

function candidate(overrides: Partial<SuggestedReply> = {}): SuggestedReply {
  return {
    id: 'reply_s17',
    sessionId: 'session_s17',
    basedOnRevision: 1,
    candidateRuleId: null,
    actionType: 'CLARIFY',
    text: 'Что из того, что вы уже видели или пробовали, вас не устроило больше всего?',
    shortReason: 'test',
    evidenceTurnIds: [],
    createdAt: 1,
    stage: 'contact',
    confidenceStatus: 'high',
    lifecycleStatus: 'candidate',
    priority: 60,
    source: 'local_engine',
    ...overrides,
  };
}

describe('session 17 suggestion delivery regression', () => {
  it('removes the word “пробовали” from live hint wording', () => {
    const state = createInitialState();
    state.revision = 2;
    state.askedQuestions = ['Добрый день'];
    const item = candidate({ basedOnRevision: 2 });

    applyLiveSuggestionPresentationPolicy(item, state);

    expect(item.text).toBe('Что из того, что вы уже видели, вас не устроило больше всего?');
    expect(item.text).not.toMatch(/пробовали/iu);
  });

  it('turns the first ordinary hint into a short greeting', () => {
    const state = createInitialState();
    state.revision = 1;
    const item = candidate();

    applyLiveSuggestionPresentationPolicy(item, state);

    expect(item.text).toBe('Добрый день! Данил, «Элитный Сочи». Как могу к вам обращаться?');
    expect(item.text.length).toBeLessThan(80);
    expect(item.candidateRuleId).toBe('opening_greeting');
    expect(item.priority).toBe(90);
  });

  it('never replaces a first-turn P0/control event with the greeting', () => {
    const state = createInitialState();
    state.revision = 1;
    const item = candidate({
      text: 'Понял вас. Больше беспокоить не будем.',
      eventType: 'CLIENT_STOP',
      actionType: 'RESPECT_STOP',
      priority: 120,
    });

    applyLiveSuggestionPresentationPolicy(item, state);

    expect(item.text).toBe('Понял вас. Больше беспокоить не будем.');
    expect(item.candidateRuleId).not.toBe('opening_greeting');
  });

  it('does not black-hole criteria hint when only derived progress falsely closed criteria', () => {
    const state = createInitialState();
    state.revision = 10;
    state.scriptProgress = {
      metrics: {
        criteria: {
          id: 'criteria',
          field: 'criteria',
          name: 'Важные критерии',
          category: 'needs',
          status: 'confirmed',
          isCoreCriteria: false,
          value: 'Тишина / отсутствие дорожного шума',
          semanticReason: 'false derived criterion',
          confidence: 0.85,
          agentQuestionAsked: false,
          agentQuestionQuote: null,
        },
      },
    } as any;
    state.criteria = { value: null, items: [], evidenceTurnIds: [] };

    const item = candidate({
      basedOnRevision: 10,
      text: 'Если оставить только два критерия, по которым вы точно будете отсекать варианты, что это будет?',
      closesMetric: 'criteria',
      priority: 50,
    });

    expect(isSuggestionAllowedByState(item, state, 10)).toBe(true);
  });

  it('still blocks a repeated criteria hint when canonical criteria are actually known', () => {
    const state = createInitialState();
    state.revision = 10;
    state.scriptProgress = {
      metrics: {
        criteria: {
          id: 'criteria',
          field: 'criteria',
          name: 'Важные критерии',
          category: 'needs',
          status: 'confirmed',
          isCoreCriteria: false,
          value: 'Юридическая чистота',
          semanticReason: 'confirmed',
          confidence: 0.9,
          agentQuestionAsked: true,
          agentQuestionQuote: 'Что важно?',
        },
      },
    } as any;
    state.criteria = {
      value: 'Юридическая чистота',
      items: [{ text: 'Юридическая чистота', evidenceTurnId: 'c1' } as any],
      evidenceTurnIds: ['c1'],
    };

    const item = candidate({
      basedOnRevision: 10,
      text: 'Если оставить только два критерия, по которым вы точно будете отсекать варианты, что это будет?',
      closesMetric: 'criteria',
      priority: 50,
    });

    expect(isSuggestionAllowedByState(item, state, 10)).toBe(false);
  });
});
