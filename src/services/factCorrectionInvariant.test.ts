import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

function clientTurn(id: string, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'fact-correction-invariant',
    source: 'call_audio',
    speaker: 'client',
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

describe('FACT_CORRECTION requires a confirmed superseded fact', () => {
  it.each([
    'Не для жизни, а как инвестицию.',
    'Я сейчас не для жизни смотрю, а как вложение, чтобы работало без моего постоянного участия.',
  ])('A: treats first contrastive investment goal as a new fact, not a correction: %s', (text) => {
    const first = clientTurn('a1', text, 1);
    const result = advanceLocalConversation(createInitialState(), first, [first]);

    expect(result.state.goal.value).toMatch(/инвест/iu);
    expect(result.event?.type).not.toBe('FACT_CORRECTION');
    expect(result.state.confirmedFacts.find((fact) => fact.category === 'goal')?.supersedesFactId).toBeNull();
    const analysis = buildLocalAnalysisResponse({
      sessionId: first.sessionId,
      revision: first.revision!,
      newTurns: [first],
      recentTurns: [first],
      currentState: result.state,
    });
    expect(analysis.eventType).not.toBe('FACT_CORRECTION');
    expect(analysis.suggestedReply).not.toMatch(/принял поправку|дальше опираемся/iu);
  });

  it('B: preserves a genuine goal correction and its supersede lineage', () => {
    const original = clientTurn('b1', 'Покупаю для постоянной жизни.', 1);
    const corrected = clientTurn('b2', 'Нет, всё-таки беру как инвестицию, для жизни уже не рассматриваю.', 2);
    const first = advanceLocalConversation(createInitialState(), original, [original]);
    const result = advanceLocalConversation(first.state, corrected, [original, corrected]);

    expect(first.state.goal.value).toMatch(/жизн|прожив/iu);
    expect(result.state.goal.value).toMatch(/инвест/iu);
    expect(result.event?.type).toBe('FACT_CORRECTION');
    const oldGoal = result.state.confirmedFacts.find((fact) => fact.category === 'goal' && fact.turnId === original.id);
    const newGoal = result.state.confirmedFacts.find((fact) => fact.category === 'goal' && fact.turnId === corrected.id);
    expect(oldGoal?.lifecycleStatus).toBe('superseded');
    expect(newGoal?.lifecycleStatus).toBe('confirmed');
    expect(newGoal?.supersedesFactId).toBe(oldGoal?.id);
  });

  it('C: does not turn an unrelated negative construction into a correction', () => {
    const first = clientTurn('c1', 'Не хочу превращать это во вторую работу.', 1);
    const result = advanceLocalConversation(createInitialState(), first, [first]);

    expect(result.event?.type).not.toBe('FACT_CORRECTION');
    expect(result.state.confirmedFacts.some((fact) => fact.supersedesFactId)).toBe(false);
  });
});
