import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './test-support/liveDecisionXitaDcrs.json';
import type { SuggestedReply, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { detectConversationEvent } from './conversationEventEngine';
import { checkSemanticAntiRepeat, extractSemanticKey } from './semanticAntiRepeat';
import { isSuggestionAllowedByState, shouldReplaceSuggestion } from './suggestionLifecycle';

const xita = fixture.find(r => r.sessionId === 'session_1790931643421_xita')!;

function replay(revision: number) {
  const turns = (xita.turns as TranscriptTurn[]).filter(t => t.revision! <= revision);
  let state = createInitialState();
  const clock = vi.spyOn(Date, 'now');
  for (let i = 0; i < turns.length; i++) {
    clock.mockReturnValue(turns[i].timestamp);
    state = advanceLocalConversation(state, turns[i], turns.slice(0, i + 1)).state;
  }
  const latest = turns.at(-1)!;
  const response = buildLocalAnalysisResponse({
    sessionId: xita.sessionId, revision, newTurns: [latest], recentTurns: turns.slice(-10), currentState: state,
  });
  return { turns, state, latest, response };
}

function eventFor(text: string) {
  const client = { ...(xita.turns[12] as TranscriptTurn), text };
  return detectConversationEvent(client, [client], createInitialState());
}

afterEach(() => vi.restoreAllMocks());

describe('live liquidity decision (2026-10-02 xita)', () => {
  // Routing back to general must fail: the client has already specified resale,
  // and asking them to repeat the topic is not an answer to their actual question.
  it.each([11, 13])('answers the current resale question at real revision %s', revision => {
    const { state, response, latest, turns } = replay(revision);
    expect(state.criteria.value).toMatch(/Ликвидность/iu);
    expect(state.criteria.evidenceTurnIds.length).toBeGreaterThan(0);
    expect(response.shouldSuggest).toBe(true);
    expect(response.recommendationOutcome).toBe('NEW_RECOMMENDATION');
    expect(response.eventType).toBe('DIRECT_QUESTION');
    expect(response.suggestedReply).toMatch(/сделк.*аналог|аналог.*сделк/iu);
    expect(response.suggestedReply).toMatch(/срок.*продаж/iu);
    expect(response.suggestedReply).not.toMatch(/какой именно момент|какую задачу|для жизни/iu);
    expect(response.evidenceTurnIds).toEqual([latest.id]);
    const candidate = {
      id: `liquidity-${revision}`, candidateRuleId: response.candidateRuleId,
      shortReason: response.shortReason!, createdAt: latest.timestamp,
      text: response.suggestedReply!, actionType: response.actionType,
      suggestionMode: response.suggestionMode, eventType: response.eventType,
      stage: response.stage, priority: response.priority, closesMetric: response.closesMetric,
      sessionId: xita.sessionId, basedOnRevision: revision, source: 'local_event',
      semanticKey: extractSemanticKey(response.suggestedReply!), evidenceTurnIds: response.evidenceTurnIds,
    } as SuggestedReply;
    expect(isSuggestionAllowedByState(candidate, state, revision)).toBe(true);
    expect(checkSemanticAntiRepeat(candidate, state, turns).accepted).toBe(true);
    if (revision === 13) {
      const current = xita.suggestedRepliesHistory.find(t => t.basedOnRevision === 11)! as SuggestedReply;
      expect(shouldReplaceSuggestion(current, candidate, latest.timestamp, turns)).toBe(true);
    }
  });

  it('does not create another hint after the verification answer was already spoken', () => {
    const { response } = replay(13);
    expect(response.shouldSuggest).toBe(true);
    const turns = (xita.turns as TranscriptTurn[]).map(t => t.revision === 12
      ? { ...t, text: response.suggestedReply! } : t);
    let state = createInitialState();
    for (let i = 0; i < turns.length; i++) state = advanceLocalConversation(state, turns[i], turns.slice(0, i + 1)).state;
    const latest = turns.at(-1)!;
    const repeated = buildLocalAnalysisResponse({
      sessionId: xita.sessionId, revision: 13, newTurns: [latest], recentTurns: turns.slice(-10), currentState: state,
    });
    expect(repeated.shouldSuggest).toBe(false);
    expect(repeated.recommendationOutcome).toBe('NO_NEW_RECOMMENDATION');
    expect(repeated.suggestedReply).toBeNull();
  });

  it.each([
    ['Мне важна ликвидность. Что конкретно вы хотите уточнить?', 'direct_question_general'],
    ['Хочу потом спокойно продать. Какая цена этой квартиры?', 'direct_question_price'],
    ['Ликвидность важна. Какая ставка по ипотеке?', 'direct_question_financing'],
    ['Хочу ликвидный объект. Какие документы есть?', 'direct_question_documents'],
    ['Хочу потом перепродать. Как проверить качество ремонта?', 'direct_question_property_details'],
    ['Ликвидность важна. Как подтвердить время встречи?', 'direct_question_general'],
    ['Как ликвидировать протечку в квартире?', 'direct_question_general'],
    ['Нужна ликвидность. Где реальность по сроку сдачи?', 'direct_question_general'],
    ['Перепродажу потом обсудим. А где реальность по качеству ремонта?', 'direct_question_property_details'],
    ['Есть ремонт в ликвидной квартире?', 'direct_question_property_details'],
    ['Есть вид на море у ликвидных квартир?', 'direct_question_property_details'],
    ['Есть паркинг в ликвидном объекте?', 'direct_question_property_details'],
  ])('keeps the current question ahead of earlier resale context: %s', (text, rule) => {
    expect(eventFor(text)?.ruleId).toBe(rule);
  });

  it('does not turn a resale criterion with a rhetorical tag into a direct answer', () => {
    expect(eventFor('Мне важна ликвидность, чтобы можно было перепродать, да?')?.type).not.toBe('DIRECT_QUESTION');
  });

  it.each([
    'Сейчас вообще есть что-то ликвидное?',
    'Насколько ликвидна эта квартира?',
    'Как проверить ликвидность объекта?',
  ])('answers an explicit question about purchase liquidity: %s', text => {
    expect(eventFor(text)?.suggestedReply).toMatch(/сделк.*аналог|аналог.*сделк/iu);
  });

  it.each([
    'Можно продать мою квартиру, чтобы купить у вас?',
    'Можно сначала купить у вас, а потом продать свою квартиру?',
    'Когда можно потом продать мою старую квартиру?',
  ])('does not conflate selling existing housing with resale of the purchase: %s', text => {
    expect(eventFor(text)?.ruleId).not.toBe('direct_question_liquidity');
  });
});
