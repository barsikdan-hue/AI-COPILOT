import { beforeEach, describe, expect, it } from 'vitest';
import type { AnalysisResponse, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import {
  applyLearnedSuggestion,
  clearLearnedSuggestionCacheForTests,
  getLearnedSuggestionCardsForTests,
  rememberLateGeminiSuggestion,
  type LearnedSuggestionPayload,
} from './learnedSuggestionCache';

const clientTurn = (id: string, text: string, revision = 1): TranscriptTurn => ({
  id,
  sessionId: 's',
  source: 'call_audio',
  speaker: 'client',
  text,
  timestamp: revision * 1000,
  isFinal: true,
  revision,
});

const payload = (text: string): LearnedSuggestionPayload => {
  const turn = clientTurn('c1', text);
  return { newTurns: [turn], recentTurns: [turn], currentState: createInitialState() };
};

const response = (overrides: Partial<AnalysisResponse> = {}): AnalysisResponse => ({
  sessionId: 's',
  basedOnRevision: 1,
  stage: 'diagnostics',
  factsDelta: [],
  objection: null,
  candidateRuleId: 'gemini_semantic',
  suggestedReply: 'Если выбирать между тишиной и доступностью, какой компромисс для вас допустим?',
  shortReason: 'Уточняем реальный баланс критериев.',
  evidenceTurnIds: ['c1'],
  missingCriticalField: null,
  shouldSuggest: true,
  actionType: 'CLARIFY',
  closesMetric: 'criteria',
  modelUsed: 'gemini-3.1-flash-lite',
  suggestionExpired: true,
  priority: 70,
  eventType: null,
  ...overrides,
});

beforeEach(() => clearLearnedSuggestionCacheForTests());

describe('late Gemini teacher cache', () => {
  it('reuses a late Gemini card instantly for an analogous client meaning', () => {
    const now = Date.now();
    const learnedFrom = payload('Мне важна тишина, но не хочу быть отрезанным от цивилизации, нужна нормальная логистика.');
    expect(rememberLateGeminiSuggestion(learnedFrom, response(), now)).toBe(true);

    const future = payload('Хочу тихий район, но с нормальной логистикой и магазинами рядом.');
    const local = response({
      modelUsed: 'local-deterministic',
      suggestionExpired: false,
      suggestedReply: 'По каким двум признакам вы сразу поймёте, что вариант подходит?',
      shortReason: 'Локально уточняем критерии.',
    });
    const reused = applyLearnedSuggestion(future, local, now + 1000);

    expect(reused.suggestedReply).toBe('Если выбирать между тишиной и доступностью, какой компромисс для вас допустим?');
    expect(reused.fallbackReason).toBe('learned_semantic_card');
    expect(getLearnedSuggestionCardsForTests()[0].useCount).toBe(1);
  });

  it('does not reuse a learned card for an unrelated client meaning', () => {
    const now = Date.now();
    expect(rememberLateGeminiSuggestion(
      payload('Мне важна тишина и нормальная логистика.'),
      response(),
      now,
    )).toBe(true);

    const local = response({
      modelUsed: 'local-deterministic',
      suggestionExpired: false,
      suggestedReply: 'По каким двум признакам вы сразу поймёте, что вариант подходит?',
    });
    const unrelated = applyLearnedSuggestion(payload('Бюджет пока около двадцати миллионов.'), local, now + 1000);

    expect(unrelated.suggestedReply).toBe(local.suggestedReply);
    expect(unrelated.fallbackReason).not.toBe('learned_semantic_card');
  });

  it('learns only late reusable semantic suggestions, not fresh or control answers', () => {
    const now = Date.now();
    const p = payload('Сравниваю варианты, важны тишина и логистика.');

    expect(rememberLateGeminiSuggestion(p, response({ suggestionExpired: false }), now)).toBe(false);
    expect(rememberLateGeminiSuggestion(p, response({ actionType: 'ANSWER' }), now)).toBe(false);
    expect(rememberLateGeminiSuggestion(p, response({ eventType: 'DIRECT_QUESTION', actionType: 'CLARIFY' }), now)).toBe(false);
    expect(getLearnedSuggestionCardsForTests()).toHaveLength(0);
  });

  it('does not persist raw client transcript and strips a likely client-name vocative', () => {
    const now = Date.now();
    const rawClient = 'Секретная фраза клиента про тихий район и нормальную логистику.';
    const p = payload(rawClient);
    expect(rememberLateGeminiSuggestion(
      p,
      response({ suggestedReply: 'Сергей, что важнее сохранить без компромисса: тишину или доступность?' }),
      now,
    )).toBe(true);

    const stored = getLearnedSuggestionCardsForTests();
    expect(stored).toHaveLength(1);
    expect(stored[0].text).not.toContain('Сергей');
    expect(JSON.stringify(stored)).not.toContain('Секретная фраза клиента');
  });

  it('rejects reusable cards that contain transaction-specific numbers or money', () => {
    const now = Date.now();
    expect(rememberLateGeminiSuggestion(
      payload('По бюджету пока сравниваю варианты.'),
      response({
        closesMetric: 'budget',
        suggestedReply: 'При бюджете 25 млн руб лучше смотреть два конкретных проекта.',
      }),
      now,
    )).toBe(false);
    expect(getLearnedSuggestionCardsForTests()).toHaveLength(0);
  });
});
