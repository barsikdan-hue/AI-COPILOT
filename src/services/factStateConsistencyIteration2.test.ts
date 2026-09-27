import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation } from './localAnalysisEngine';

function clientTurn(id: string, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'fact-state-consistency-iteration-2',
    source: 'call_audio',
    speaker: 'client',
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

function advance(state: ConversationState, turns: TranscriptTurn[], next: TranscriptTurn) {
  const history = [...turns, next];
  return { history, result: advanceLocalConversation(state, next, history) };
}

const isActive = (status: string | undefined) => !['superseded', 'rejected'].includes(status || '');

describe('FIX ITERATION 2 fact-state consistency', () => {
  it('GOAL: supersedes living with investment across canonical and derived state', () => {
    const living = clientTurn('goal-1', 'Покупаю для жизни.', 1);
    const first = advance(createInitialState(), [], living);
    expect(first.result.state.goal.value).toMatch(/личн|для себя|жизн|прожив/iu);
    expect(first.result.state.primaryGoal?.value).toMatch(/личн|для себя|жизн|прожив/iu);

    const investment = clientTurn('goal-2', 'Нет, планы поменялись, теперь рассматриваю как инвестицию.', 2);
    const second = advance(first.result.state, first.history, investment);
    const oldGoal = second.result.state.confirmedFacts.find((fact) => fact.category === 'goal' && fact.turnId === living.id);
    const newGoal = second.result.state.confirmedFacts.find((fact) => fact.category === 'goal' && fact.turnId === investment.id);
    const activeGoals = second.result.state.confirmedFacts.filter((fact) => fact.category === 'goal' && isActive(fact.lifecycleStatus));

    expect(second.result.state.goal.value).toMatch(/инвест/iu);
    expect(second.result.state.primaryGoal?.value).toMatch(/инвест/iu);
    expect(oldGoal?.lifecycleStatus).toBe('superseded');
    expect(newGoal).toMatchObject({ lifecycleStatus: 'confirmed', turnId: investment.id });
    expect(newGoal?.supersedesFactId).toBe(oldGoal?.id);
    expect(newGoal?.evidenceQuote).toMatch(/как инвестицию/iu);
    expect(activeGoals).toHaveLength(1);
    expect(second.result.state.scriptProgress?.metrics.goal).toMatchObject({ status: 'confirmed', evidenceTurnId: investment.id });
    expect(second.result.state.scriptProgress?.metrics.goal.value).toMatch(/инвест/iu);
  });

  it('CHILDREN: keeps the required explicit no-children correction consistent', () => {
    const hasChildren = clientTurn('children-1', 'У меня двое детей.', 1);
    const first = advance(createInitialState(), [], hasChildren);
    const noChildren = clientTurn('children-2', 'Нет, это я про брата говорил, у меня детей нет.', 2);
    const second = advance(first.result.state, first.history, noChildren);
    const oldFact = second.result.state.confirmedFacts.find((fact) => fact.category === 'familyMortgage' && fact.turnId === hasChildren.id);
    const newFact = second.result.state.confirmedFacts.find((fact) => fact.category === 'familyMortgage' && fact.turnId === noChildren.id);
    const active = second.result.state.confirmedFacts.filter((fact) => fact.category === 'familyMortgage' && isActive(fact.lifecycleStatus));

    expect(second.result.state.familyMortgage?.value).toMatch(/детей нет|не примен/iu);
    expect(oldFact?.lifecycleStatus).toBe('superseded');
    expect(newFact).toMatchObject({ lifecycleStatus: 'confirmed', turnId: noChildren.id });
    expect(newFact?.supersedesFactId).toBe(oldFact?.id);
    expect(active).toHaveLength(1);
    expect(second.result.state.scriptProgress?.metrics.familyMortgage.value).toMatch(/детей нет|не примен/iu);
  });

  it('PAYMENT: records cash and a true correction for the shorthand wording', () => {
    const mortgage = clientTurn('payment-1', 'Рассматриваю ипотеку.', 1);
    const first = advance(createInitialState(), [], mortgage);
    const cash = clientTurn('payment-2', 'Ипотеку всё-таки не хочу, куплю за свои.', 2);
    const second = advance(first.result.state, first.history, cash);
    const oldFact = second.result.state.confirmedFacts.find((fact) => fact.category === 'paymentMethod' && fact.turnId === mortgage.id);
    const newFact = second.result.state.confirmedFacts.find((fact) => fact.category === 'paymentMethod' && fact.turnId === cash.id);
    const active = second.result.state.confirmedFacts.filter((fact) => fact.category === 'paymentMethod' && isActive(fact.lifecycleStatus));

    expect.soft(second.result.state.paymentMethod.value).toMatch(/собствен|свои|налич/iu);
    expect.soft(oldFact?.lifecycleStatus).toBe('superseded');
    expect.soft(newFact).toMatchObject({ lifecycleStatus: 'confirmed', turnId: cash.id });
    expect.soft(newFact?.supersedesFactId).toBe(oldFact?.id);
    expect.soft(active).toHaveLength(1);
    expect.soft(second.result.event?.type).toBe('FACT_CORRECTION');
    expect.soft(second.result.state.scriptProgress?.metrics.paymentMethod.value).toMatch(/собствен|свои|налич/iu);
  });

  it('NEGATION CONTROL: does not create mortgage or correction without an old payment fact', () => {
    const rejection = clientTurn('negation-1', 'Ипотеку не рассматриваю.', 1);
    const result = advance(createInitialState(), [], rejection).result;
    const activeMortgage = result.state.confirmedFacts.filter((fact) =>
      fact.category === 'paymentMethod' && isActive(fact.lifecycleStatus) && /ипотек/iu.test(fact.value)
    );

    expect(result.state.paymentMethod.value).toBeNull();
    expect(activeMortgage).toHaveLength(0);
    expect(result.event?.type).not.toBe('FACT_CORRECTION');
  });
});
