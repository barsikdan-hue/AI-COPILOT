import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './test-support/liveDecisionS2wh.json';
import type { SuggestedReply, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { checkSemanticAntiRepeat, extractSemanticKey } from './semanticAntiRepeat';
import { isSuggestionAllowedByState, shouldReplaceSuggestion } from './suggestionLifecycle';
import { classifyAgentAction, evaluateSpinAndHpb } from './spinEngine';

const originalTurns = fixture.turns as TranscriptTurn[];
const originalCurrent = fixture.originalCurrent as SuggestedReply;

function replay(turns = originalTurns) {
  const clock = vi.spyOn(Date, 'now');
  let state = createInitialState();
  for (let i = 0; i < turns.length; i++) {
    clock.mockReturnValue(turns[i].timestamp);
    state = advanceLocalConversation(state, turns[i], turns.slice(0, i + 1)).state;
  }
  const latest = turns.at(-1)!;
  const response = buildLocalAnalysisResponse({
    sessionId: fixture.sessionId, revision: latest.revision!,
    newTurns: [latest], recentTurns: turns, currentState: state,
  });
  const candidate: SuggestedReply = {
    id: 's2wh-next', sessionId: fixture.sessionId, source: 'local_engine',
    basedOnRevision: response.basedOnRevision, text: response.suggestedReply || '',
    shortReason: response.shortReason || '', createdAt: latest.timestamp,
    evidenceTurnIds: response.evidenceTurnIds, actionType: response.actionType,
    suggestionMode: response.suggestionMode, eventType: response.eventType,
    closesMetric: response.closesMetric, stage: response.stage,
    priority: response.priority, semanticKey: extractSemanticKey(response.suggestedReply || ''),
    candidateRuleId: response.candidateRuleId,
  };
  return { state, response, latest, candidate };
}

function withLastAnswer(text: string) {
  return originalTurns.map(t => t.revision === 7 ? { ...t, text } : t);
}

afterEach(() => vi.restoreAllMocks());

describe('s2wh limited-window candidate suppression', () => {
  // Catch selecting a deep SPIN question, then losing the meaningful turn at the state guard.
  it('selects one brief concern-priority action from the real final client signal', () => {
    const { state, response } = replay();
    expect(state.dialogueControl?.boundaryMode).toBe('limited_active_window');
    expect(state.criteria.value).toMatch(/ликвидность/iu);
    expect(response.shouldSuggest).toBe(true);
    expect(response.recommendationOutcome).toBe('NEW_RECOMMENDATION');
    expect(response.actionType).toBe('CLARIFY');
    expect(response.suggestionMode).not.toBe('SPIN_IMPLICATION');
    expect(response.suggestedReply).toMatch(/главн|первую очередь|важнее/iu);
    expect(response.suggestedReply).not.toMatch(/сон|страдает|бюджет|сумм|диапазон|ипотек/iu);
    expect((response.suggestedReply?.match(/\?/gu) || []).length).toBe(1);
    expect(response.closesMetric).toBeNull();
    expect(response.evidenceTurnIds).toContain(originalTurns[6].id);
  });

  it('passes publication guards and supersedes the real used, expired budget card', () => {
    const { state, candidate } = replay();
    expect(candidate.text).not.toBe('');
    expect(isSuggestionAllowedByState(candidate, state, 7)).toBe(true);
    expect(checkSemanticAntiRepeat(candidate, state, originalTurns).accepted).toBe(true);
    expect(shouldReplaceSuggestion(originalCurrent, candidate, fixture.lastAnalysisTime, originalTurns)).toBe(true);
  });

  it('preserves the earlier live protection for the fresh unspoken budget question', () => {
    const turns = originalTurns.slice(0, 5);
    const { state, candidate } = replay(turns);
    const current = { ...originalCurrent, used: false, usedAt: undefined, lifecycleStatus: 'shown' } as SuggestedReply;
    const rejected = fixture.originalTrace.find(t => t.basedOnRevision === 5)!;
    expect(isSuggestionAllowedByState(candidate, state, 5)).toBe(true);
    expect(checkSemanticAntiRepeat(candidate, state, turns).accepted).toBe(true);
    expect(shouldReplaceSuggestion(current, candidate, rejected.timestamp, turns)).toBe(false);
  });

  it('continues to reject the original deep SPIN candidate under the short window', () => {
    const { state } = replay();
    const agent = originalTurns[5];
    const spin = evaluateSpinAndHpb(originalTurns[6], state.spin!, classifyAgentAction(agent.text), agent.text, state);
    expect(spin.suggestionMode).toBe('SPIN_IMPLICATION');
    expect(isSuggestionAllowedByState({
      text: spin.suggestedText!, actionType: 'DEEPEN', suggestionMode: spin.suggestionMode,
      priority: 60, basedOnRevision: 7, stage: state.stage,
    }, state, 7)).toBe(false);
  });

  it('keeps normal implication when the client has not limited the call', () => {
    const turns = originalTurns.map(t => t.revision === 2 ? {
      ...t, text: 'Да, Кирилл, я заявку оставлял, да. Сейчас могу говорить.',
    } : t);
    const { state, response } = replay(turns);
    expect(state.dialogueControl?.boundaryMode).toBe('none');
    expect(response.shouldSuggest).toBe(true);
    expect(response.actionType).toBe('DEEPEN');
    expect(response.suggestionMode).toBe('SPIN_IMPLICATION');
  });

  it('keeps stale revision protection for the new brief candidate', () => {
    const { state, candidate } = replay();
    expect(candidate.text).not.toBe('');
    expect(isSuggestionAllowedByState(candidate, state, 8)).toBe(false);
  });

  it('does not publish the same brief question again after the agent spoke it', () => {
    const first = replay();
    expect(first.response.shouldSuggest).toBe(true);
    const turns: TranscriptTurn[] = [...originalTurns,
      { ...originalTurns[5], id: 'a-priority', revision: 8, timestamp: originalTurns[6].timestamp + 1000, text: first.candidate.text },
      { ...originalTurns[6], id: 'c-repeat', revision: 9, timestamp: originalTurns[6].timestamp + 2000 },
    ];
    const next = replay(turns);
    expect(next.response.shouldSuggest).toBe(false);
    expect(next.response.recommendationOutcome).toBe('NO_NEW_RECOMMENDATION');
  });

  it('keeps same-meaning replacement suppression while the brief card is fresh', () => {
    const { candidate } = replay();
    expect(candidate.text).not.toBe('');
    const current = { ...candidate, lifecycleStatus: 'shown' } as SuggestedReply;
    expect(shouldReplaceSuggestion(current, {
      ...candidate, id: 'duplicate', basedOnRevision: 8, createdAt: candidate.createdAt + 1000,
    }, candidate.createdAt + 1000, originalTurns)).toBe(false);
  });

  it.each([
    ['Больше не звоните. Мне это не нужно.', 'CLIENT_STOP'],
    ['Сейчас не могу говорить, перезвоните завтра в 18:00.', 'TIME_CONSTRAINT'],
    ['Какие документы у проекта, который я смотрел?', 'DIRECT_QUESTION'],
  ])('keeps the current control event ahead of the short-window SPIN move: %s', (text, event) => {
    const { response } = replay(withLastAnswer(text));
    expect(response.eventType).toBe(event);
    expect(response.candidateRuleId).not.toBe('limited_window_problem_priority');
  });

  it('preserves intentional silence for a standalone reaction to the question', () => {
    const { response } = replay(withLastAnswer('Хороший вопрос.'));
    expect(response.shouldSuggest).toBe(false);
    expect(response.recommendationOutcome).toBe('NO_NEW_RECOMMENDATION');
  });

  it('requires an active boundary, not just a historical limited-window mode', () => {
    const { state } = replay();
    state.dialogueControl = { ...state.dialogueControl!, clientBoundaryActive: false };
    const response = buildLocalAnalysisResponse({
      sessionId: fixture.sessionId, revision: 7, newTurns: [originalTurns[6]],
      recentTurns: originalTurns, currentState: state,
    });
    expect(response.candidateRuleId).not.toBe('limited_window_problem_priority');
    expect(response.suggestedReply).not.toMatch(/стоп-фактор/iu);
  });

  it.each(['Не знаю пока.', 'Меня интересуют апартаменты в Адлере.'])(
    'does not borrow an old problem to create the brief priority question: %s', text => {
      const turns: TranscriptTurn[] = [...originalTurns,
        { ...originalTurns[5], id: 'a-implication', revision: 8, timestamp: originalTurns[6].timestamp + 1000, text: 'Что именно больше всего страдает из-за этого — отдых, сон или общее состояние?' },
        { ...originalTurns[6], id: 'c-topic', revision: 9, timestamp: originalTurns[6].timestamp + 2000, text },
      ];
      const { response } = replay(turns);
      expect(response.candidateRuleId).not.toBe('limited_window_problem_priority');
      expect(response.suggestedReply || '').not.toMatch(/стоп-фактор/iu);
    },
  );

  it('keeps material delivery ahead of a simultaneous pain disclosure', () => {
    const { state } = replay(originalTurns.slice(0, 6));
    const turns = withLastAnswer('Смотрел пару проектов — всё шумно. Пришлите планировки этих проектов.');
    const transition = advanceLocalConversation(state, turns[6], turns);
    // App publishes the event first and skips the secondary policy pass.
    const event = transition.event!;
    expect(event.type).toBe('MATERIAL_REQUEST');
    expect(event.actionType).toBe('ANSWER');
    expect(event.suppressesAnalysis).toBe(true);
    expect(event.suggestedReply).toMatch(/отправлю.*материал/iu);
    expect(isSuggestionAllowedByState({
      text: event.suggestedReply!, actionType: event.actionType, eventType: event.type,
      priority: event.priority, basedOnRevision: 7, stage: event.stage,
    }, transition.state, 7)).toBe(true);
  });

  it('keeps the existing compressed qualification path when the goal is already known', () => {
    const turns = originalTurns.map(t => t.revision === 4 ? { ...t, text: 'Для постоянного проживания.' } : t);
    const { response, state, candidate } = replay(turns);
    expect(state.goal.value).toBeTruthy();
    expect(response.shouldSuggest).toBe(true);
    expect((candidate.text.match(/\?/gu) || []).length).toBe(1);
    expect(isSuggestionAllowedByState(candidate, state, 7)).toBe(true);
  });
});
