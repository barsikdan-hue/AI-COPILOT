import { describe, expect, it } from 'vitest';
import fixture from './test-support/liveHintSilenceClhj.json';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { isSubstantiveClientTurn } from './objectionEngine';
import { checkSemanticAntiRepeat, extractSemanticKey } from './semanticAntiRepeat';
import { isSuggestionAllowedByState, shouldReplaceSuggestion } from './suggestionLifecycle';
import type { SuggestedReply, TranscriptTurn } from '../types';

const turns = fixture.turns as TranscriptTurn[];
// At rejection time this card had not yet been clicked "used" (usedAt is later).
const current = { ...fixture.current, lifecycleStatus: 'shown', used: false, usedAt: undefined } as SuggestedReply;
const now = fixture.rejected.timestamp;
const candidate = {
  ...current, id: fixture.rejected.candidateId, basedOnRevision: 8,
  text: fixture.rejected.text, semanticKey: fixture.rejected.semanticKey,
  priority: 88, closesMetric: 'goal', createdAt: now, evidenceTurnIds: [turns[7].id],
} as SuggestedReply;

describe('live hint continues after an answered active question (2026-10-02 clhj)', () => {
  it('publishes the real next decision before the old card is manually marked used', () => {
    let state = createInitialState();
    for (let i = 0; i < turns.length; i++) state = advanceLocalConversation(state, turns[i], turns.slice(0, i + 1)).state;
    const response = buildLocalAnalysisResponse({
      sessionId: fixture.sessionId, revision: 8, newTurns: [turns[7]], recentTurns: turns, currentState: state,
    });
    expect(response.shouldSuggest).toBe(true);
    expect(response.closesMetric).toBe('goal');
    const next: SuggestedReply = {
      ...candidate, text: response.suggestedReply!, semanticKey: extractSemanticKey(response.suggestedReply!),
      basedOnRevision: response.basedOnRevision, actionType: response.actionType,
      suggestionMode: response.suggestionMode, evidenceTurnIds: response.evidenceTurnIds,
      priority: response.priority, eventType: response.eventType, closesMetric: response.closesMetric,
    };
    expect(isSuggestionAllowedByState(next, state, 8)).toBe(true);
    expect(checkSemanticAntiRepeat(next, state, turns).accepted).toBe(true);
    expect(shouldReplaceSuggestion(current, next, now, turns)).toBe(true);
  });

  it('retains the useful active question across two rapid client turns without an agent using it', () => {
    const clientOnly = [turns[5], { ...turns[7], revision: 7 }, { ...turns[7], id: 'rapid-2', revision: 8 }];
    expect(shouldReplaceSuggestion(current, { ...candidate, evidenceTurnIds: ['rapid-2'] }, now, clientOnly)).toBe(false);
  });

  it('does not replace the active question when the agent asked something else', () => {
    const unrelated = turns.map(t => t.revision === 7 ? { ...t, text: 'В какой диапазон хотите уложиться?' } : t);
    expect(shouldReplaceSuggestion(current, candidate, now, unrelated)).toBe(false);
  });

  it('keeps filler silence and the current card even after the question was spoken', () => {
    const filler = { ...turns[7], text: 'Не знаю пока.' };
    expect(isSubstantiveClientTurn(filler.text, turns[6].text)).toBe(false);
    expect(shouldReplaceSuggestion(current, candidate, now, [...turns.slice(0, 7), filler])).toBe(false);
  });

  it('protects duplicate meaning and stale revisions after the client responds', () => {
    expect(shouldReplaceSuggestion(current, { ...candidate, semanticKey: current.semanticKey }, now, turns)).toBe(false);
    expect(shouldReplaceSuggestion(current, { ...candidate, basedOnRevision: 5 }, now, turns)).toBe(false);
  });

  it('does not use another session or missing candidate evidence to release the card', () => {
    expect(shouldReplaceSuggestion(current, candidate, now, turns.map(t => ({ ...t, sessionId: 'other' })))).toBe(false);
    expect(shouldReplaceSuggestion(current, { ...candidate, evidenceTurnIds: ['missing'] }, now, turns)).toBe(false);
  });

  it('requires final speech and an agent revision after the active card', () => {
    for (const changedTurns of [
      turns.map(t => t.revision === 7 ? { ...t, isFinal: false } : t),
      turns.map(t => t.revision === 8 ? { ...t, isFinal: false } : t),
      turns.map(t => t.revision === 7 ? { ...t, revision: 6 } : t),
    ]) expect(shouldReplaceSuggestion(current, candidate, now, changedTurns)).toBe(false);
  });

  it('keeps event cards and late Gemini candidates under normal priority arbitration', () => {
    expect(shouldReplaceSuggestion({ ...current, eventType: 'TIME_CONSTRAINT', source: 'local_event', priority: 115 }, candidate, now, turns)).toBe(false);
    expect(shouldReplaceSuggestion(current, { ...candidate, source: 'gemini' }, now, turns)).toBe(false);
  });
});
