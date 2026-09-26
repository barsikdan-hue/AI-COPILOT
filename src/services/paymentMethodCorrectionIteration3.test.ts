import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation } from './localAnalysisEngine';

function clientTurn(id: string, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'payment-method-correction-iteration-3',
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
const isOwnFunds = (value: string | null | undefined) => /собствен|свои|налич/iu.test(value || '');

describe('FIX ITERATION 3 payment-method correction', () => {
  it('A: records a first own-funds statement without a correction event', () => {
    const cash = clientTurn('cash-first', 'Буду покупать за свои.', 1);
    const result = advance(createInitialState(), [], cash).result;
    const fact = result.state.confirmedFacts.find((item) => item.category === 'paymentMethod');

    expect(isOwnFunds(result.state.paymentMethod.value)).toBe(true);
    expect(fact).toMatchObject({ lifecycleStatus: 'confirmed', turnId: cash.id, supersedesFactId: null });
    expect(fact?.evidenceQuote).toMatch(/покупать за свои/iu);
    expect(result.event?.type).not.toBe('FACT_CORRECTION');
    expect(isOwnFunds(result.state.scriptProgress?.metrics.paymentMethod.value)).toBe(true);
  });

  it('B: supersedes mortgage with own funds and emits a genuine correction', () => {
    const mortgage = clientTurn('mortgage-old', 'Рассматриваю ипотеку.', 1);
    const first = advance(createInitialState(), [], mortgage);
    const cash = clientTurn('cash-new', 'Нет, ипотеку всё-таки не хочу, куплю за свои.', 2);
    const second = advance(first.result.state, first.history, cash).result;
    const oldFact = second.state.confirmedFacts.find((item) => item.category === 'paymentMethod' && item.turnId === mortgage.id);
    const newFact = second.state.confirmedFacts.find((item) => item.category === 'paymentMethod' && item.turnId === cash.id);
    const active = second.state.confirmedFacts.filter((item) => item.category === 'paymentMethod' && isActive(item.lifecycleStatus));

    expect(isOwnFunds(second.state.paymentMethod.value)).toBe(true);
    expect(oldFact?.lifecycleStatus).toBe('superseded');
    expect(newFact).toMatchObject({ lifecycleStatus: 'confirmed', turnId: cash.id });
    expect(newFact?.supersedesFactId).toBe(oldFact?.id);
    expect(newFact?.evidenceQuote).toMatch(/куплю за свои/iu);
    expect(active).toHaveLength(1);
    expect(second.event?.type).toBe('FACT_CORRECTION');
    expect(isOwnFunds(second.state.scriptProgress?.metrics.paymentMethod.value)).toBe(true);
  });

  it('C: keeps a first mortgage negation negative and non-corrective', () => {
    const rejection = clientTurn('mortgage-negation', 'Ипотеку не рассматриваю.', 1);
    const result = advance(createInitialState(), [], rejection).result;

    expect(result.state.paymentMethod.value).toBeNull();
    expect(result.state.confirmedFacts.some((item) => item.category === 'paymentMethod' && /ипотек/iu.test(item.value) && isActive(item.lifecycleStatus))).toBe(false);
    expect(result.event?.type).not.toBe('FACT_CORRECTION');
  });

  it('D: preserves an undecided mortgage/installment choice as unresolved', () => {
    const undecided = clientTurn('payment-undecided', 'Пока сравниваю ипотеку и рассрочку, ещё не решил.', 1);
    const result = advance(createInitialState(), [], undecided).result;

    expect(result.state.paymentMethod.value).toBeNull();
    expect(result.state.paymentMethod.needsClarification).toBe(true);
    expect(result.state.confirmedFacts.some((item) => item.category === 'paymentMethod' && isActive(item.lifecycleStatus))).toBe(false);
    expect(result.state.scriptProgress?.metrics.paymentMethod.status).toBe('needs_clarification');
  });

  it('E: does not collapse partial own funds plus possible mortgage into a confirmed method', () => {
    const mixed = clientTurn('payment-mixed', 'Часть денег есть, остальное, возможно, ипотека.', 1);
    const result = advance(createInitialState(), [], mixed).result;

    expect(result.state.paymentMethod.value).toBeNull();
    expect(result.state.paymentMethod.needsClarification).toBe(true);
    expect(result.state.confirmedFacts.some((item) => item.category === 'paymentMethod' && isActive(item.lifecycleStatus))).toBe(false);
    expect(result.state.scriptProgress?.metrics.paymentMethod.status).toBe('needs_clarification');
    expect(result.state.downPayment?.value ?? null).toBeNull();
  });

  it.each([
    ['Куплю за наличные.', true],
    ['Куплю за свои.', true],
    ['Куплю за собственные средства.', true],
    ['Буду покупать без ипотеки.', false],
    ['Ипотека не нужна, деньги есть.', false],
  ])('F: handles own-funds wording without inventing a positive mortgage: %s', (text, expectsOwnFunds) => {
    const turn = clientTurn(`variant-${text}`, text, 1);
    const result = advance(createInitialState(), [], turn).result;
    const active = result.state.confirmedFacts.filter((item) => item.category === 'paymentMethod' && isActive(item.lifecycleStatus));

    expect(active.some((item) => /ипотек/iu.test(item.value))).toBe(false);
    expect(result.event?.type).not.toBe('FACT_CORRECTION');
    expect(isOwnFunds(result.state.paymentMethod.value)).toBe(expectsOwnFunds);
  });
});
