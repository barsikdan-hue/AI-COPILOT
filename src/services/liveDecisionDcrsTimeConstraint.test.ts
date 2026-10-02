import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './test-support/liveDecisionXitaDcrs.json';
import type { SuggestedReply, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { checkSemanticAntiRepeat, extractSemanticKey } from './semanticAntiRepeat';
import { isSuggestionAllowedByState, shouldReplaceSuggestion } from './suggestionLifecycle';

const dcrs = fixture.find(r => r.sessionId === 'session_1790932299340_dcrs')!;
const originalTurns = dcrs.turns as TranscriptTurn[];

function replay(turns: TranscriptTurn[] = originalTurns) {
  let state = createInitialState();
  const clock = vi.spyOn(Date, 'now');
  for (let i = 0; i < turns.length; i++) {
    clock.mockReturnValue(turns[i].timestamp);
    state = advanceLocalConversation(state, turns[i], turns.slice(0, i + 1)).state;
  }
  const latest = turns.at(-1)!;
  const response = buildLocalAnalysisResponse({
    sessionId: dcrs.sessionId, revision: latest.revision!, newTurns: [latest], recentTurns: turns, currentState: state,
  });
  return { state, response, latest };
}

function withAnswer(text: string, previousAgentText?: string) {
  return originalTurns.map(t => t.revision === 5 ? { ...t, text }
    : t.revision === 4 && previousAgentText ? { ...t, text: previousAgentText } : t);
}

afterEach(() => vi.restoreAllMocks());

describe('dcrs TIME_CONSTRAINT progresses after selected callback day', () => {
  // Returning the old today-or-tomorrow choice makes the real rev5 silent.
  it('selects a valid time clarification from the real session instead of repeating day selection', () => {
    const { state, response, latest } = replay();
    expect(response.shouldSuggest).toBe(true);
    expect(response.recommendationOutcome).toBe('NEW_RECOMMENDATION');
    expect(response.eventType).toBe('TIME_CONSTRAINT');
    expect(response.suggestedReply).toMatch(/завтра/iu);
    expect(response.suggestedReply).toMatch(/во сколько|в какое время/iu);
    expect(response.suggestedReply).toMatch(/коротк/iu);
    expect(response.suggestedReply).not.toMatch(/сегодня.*или.*завтра|вечером|\d{1,2}:\d{2}/iu);
    expect(state.nextStepAgreement?.status).not.toBe('agreed');
    const candidate: SuggestedReply = {
      id: 'dcrs-time', sessionId: dcrs.sessionId, basedOnRevision: 5,
      candidateRuleId: response.candidateRuleId, text: response.suggestedReply!,
      shortReason: response.shortReason!, evidenceTurnIds: response.evidenceTurnIds,
      createdAt: latest.timestamp, stage: response.stage, actionType: response.actionType,
      eventType: response.eventType, priority: response.priority, source: 'local_event',
      semanticKey: extractSemanticKey(response.suggestedReply!),
    };
    const previous = dcrs.suggestedRepliesHistory[0] as SuggestedReply;
    expect(isSuggestionAllowedByState(candidate, state, 5)).toBe(true);
    expect(checkSemanticAntiRepeat(candidate, state, originalTurns).accepted).toBe(true);
    expect(candidate.semanticKey).not.toBe(previous.semanticKey);
    expect(shouldReplaceSuggestion(previous, candidate, latest.timestamp, originalTurns)).toBe(true);
  });

  it('completes the existing callback contract when the client supplies the requested time', () => {
    const { response } = replay();
    expect(response.shouldSuggest).toBe(true);
    const turns: TranscriptTurn[] = [...originalTurns,
      { ...originalTurns[3], id: 'a-time', revision: 6, timestamp: originalTurns[4].timestamp + 1000, text: response.suggestedReply! },
      { ...originalTurns[4], id: 'c-time', revision: 7, timestamp: originalTurns[4].timestamp + 2000, text: 'В 18:00.' },
    ];
    const next = replay(turns);
    expect(next.state.nextStepAgreement?.status).toBe('agreed');
    expect(next.state.nextStepAgreement?.timeOrDeadline).toMatch(/завтра.*18:00/iu);
    expect(next.response.eventType).toBe('MEETING_CONTRACT');
    expect(next.response.shouldSuggest).toBe(true);
  });

  it('keeps duplicate suppression after the time clarification was already spoken', () => {
    const { response } = replay();
    expect(response.shouldSuggest).toBe(true);
    const turns: TranscriptTurn[] = [...originalTurns,
      { ...originalTurns[3], id: 'a-time', revision: 6, timestamp: originalTurns[4].timestamp + 1000, text: response.suggestedReply! },
      { ...originalTurns[4], id: 'c-repeat', revision: 7, timestamp: originalTurns[4].timestamp + 2000 },
    ];
    const next = replay(turns);
    expect(next.response.shouldSuggest).toBe(false);
    expect(next.response.recommendationOutcome).toBe('NO_NEW_RECOMMENDATION');
  });

  it.each([
    ['Завтра можно но коротко.', 'завтра'],
    ['Не завтра, а послезавтра можно, но коротко.', 'послезавтра'],
  ])('uses the positive selected day without inventing a time: %s', (text, day) => {
    const { response } = replay(withAnswer(text));
    expect(response.shouldSuggest).toBe(true);
    expect(response.suggestedReply).toContain(day);
    expect(response.suggestedReply).toMatch(/во сколько|в какое время/iu);
    expect(response.suggestedReply).not.toMatch(/вечером|\d{1,2}:\d{2}/iu);
  });

  it('preserves the original day-selection prompt when no day has been chosen', () => {
    const { response } = replay(originalTurns.slice(0, 3));
    expect(response.shouldSuggest).toBe(true);
    expect(response.suggestedReply).toMatch(/сегодня.*или.*завтра/iu);
  });

  it.each([
    ['Завтра не могу, но коротко.', undefined],
    ['Завтра или послезавтра, но коротко.', undefined],
    ['Завтра можно? Но коротко.', undefined],
    ['Завтра у меня праздник, но коротко.', undefined],
    ['Завтра можно, но коротко.', 'Для какой задачи рассматриваете недвижимость?'],
    ['Завтра можно, но завтра не смогу. Коротко.', undefined],
    ['Завтра, но я не смогу, коротко.', undefined],
    ['Завтра, к сожалению, не могу. Коротко.', undefined],
    ['Завтра, послезавтра, но коротко.', undefined],
    ['Завтра можно, но коротко.', 'Когда вам удобно встретиться в офисе?'],
  ])('does not treat an unchosen or unrelated day as callback selection: %s', (text, agent) => {
    expect(replay(withAnswer(text, agent)).response.suggestedReply || '').not.toMatch(/во сколько|в какое время/iu);
  });

  it('keeps the exact-time callback ahead of day-only clarification', () => {
    const { response } = replay(withAnswer('Завтра в 18:00 можно, но коротко.'));
    expect(response.shouldSuggest).toBe(true);
    expect(response.suggestedReply).toMatch(/завтра.*18:00/iu);
    expect(response.suggestedReply).not.toMatch(/во сколько|в какое время/iu);
  });

  it('keeps a current short active window instead of arranging a callback', () => {
    const { response } = replay(withAnswer('Сейчас две минуты есть, завтра занят. Давайте коротко.'));
    expect(response.suggestedReply || '').not.toMatch(/во сколько|в какое время|на завтра/iu);
  });

  it('preserves material delivery precedence', () => {
    const { response } = replay(withAnswer('Завтра можно, но коротко. Пришлите планы.'));
    expect(response.suggestedReply).toMatch(/Отправлю.*материал/iu);
    expect(response.suggestedReply).not.toMatch(/во сколько|в какое время/iu);
  });

  it('preserves explicit stop priority', () => {
    const { response } = replay(withAnswer('Завтра не звоните. Больше не звоните.'));
    expect(response.eventType).toBe('CLIENT_STOP');
    expect(response.actionType).toBe('RESPECT_STOP');
    expect(response.suggestedReply).not.toMatch(/во сколько|в какое время/iu);
  });
});
