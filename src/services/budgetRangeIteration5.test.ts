import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation } from './localAnalysisEngine';

function clientTurn(id: string, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'budget-range-iteration-5',
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

const activeBudgetFacts = (state: ConversationState) => state.confirmedFacts.filter(
  (fact) => fact.category === 'budget' && !['superseded', 'rejected'].includes(fact.lifecycleStatus || '')
);

function single(text: string, id: string) {
  const turn = clientTurn(id, text, 1);
  return { turn, result: advance(createInitialState(), [], turn).result };
}

describe('FIX ITERATION 5 budget range extraction', () => {
  it('A: preserves both limits of an explicit from-to range', () => {
    const { result } = single('Бюджет от 15 до 25 миллионов.', 'closed-range');
    expect(result.state.budget.value).toMatch(/15\D+25\s*млн/iu);
    expect(result.state.budget.value).not.toBe('25 млн руб');
    expect(activeBudgetFacts(result.state)).toHaveLength(1);
    expect(result.state.scriptProgress?.metrics.budget.value).toBe(result.state.budget.value);
    expect(result.event?.type).not.toBe('FACT_CORRECTION');
  });

  it('B: preserves an en-dash range', () => {
    const { result } = single('Рассматриваю 15–25 млн.', 'dash-range');
    expect(result.state.budget.value).toBe('15–25 млн руб');
    expect(result.state.scriptProgress?.metrics.budget.value).toBe('15–25 млн руб');
  });

  it('C: preserves an approximate range and its uncertainty marker', () => {
    const { result } = single('Где-то 15–20 миллионов.', 'approx-range');
    expect(result.state.budget.value).toMatch(/около\s+15\D+20\s*млн/iu);
    expect(result.state.budget.isFlexible).toBe(true);
    expect(result.state.scriptProgress?.metrics.budget.status).toBe('partially_confirmed');
  });

  it('D: keeps an upper bound distinct from an exact amount', () => {
    const { result } = single('До 20 миллионов.', 'upper-bound');
    expect(result.state.budget.value).toBe('До 20 млн руб');
    expect(result.state.budget.value).not.toBe('20 млн руб');
  });

  it('E: keeps a lower bound distinct from an exact amount', () => {
    const { result } = single('От 15 миллионов.', 'lower-bound');
    expect(result.state.budget.value).toBe('От 15 млн руб');
    expect(result.state.budget.value).not.toBe('15 млн руб');
  });

  it('F: keeps an exact budget exact', () => {
    const { result } = single('Бюджет 18 миллионов.', 'exact-budget');
    expect(result.state.budget.value).toBe('18 млн руб');
    expect(result.state.budget.value).not.toMatch(/[–-]/u);
  });

  it('G: preserves a decimal without rounding', () => {
    const { result } = single('Примерно 17,5 миллиона.', 'decimal-budget');
    expect(result.state.budget.value).toContain('17.5 млн руб');
    expect(result.state.budget.value).not.toMatch(/(?:^|\D)(?:17|18)\s*млн/iu);
  });

  it.each(['18 млн', '18 миллионов', '18 000 000', '18000000'])('H: normalizes equivalent units: %s', (text) => {
    const { result } = single(text, `unit-${text}`);
    expect(result.state.budget.value).toBe('18 млн руб');
    expect(result.state.scriptProgress?.metrics.budget.value).toBe('18 млн руб');
  });

  it('I: does not merge budget and down-payment amounts into a range', () => {
    const { result } = single('Бюджет 20 миллионов, первоначальный взнос 5 миллионов.', 'budget-and-down-payment');
    expect(result.state.budget.value).toBe('20 млн руб');
    expect(result.state.budget.value).not.toMatch(/5/iu);
  });

  it('J: preserves a budget range independently of uncertain financing', () => {
    const { result } = single('Смотрю 15–20 миллионов, часть средств есть, остальное возможно ипотека.', 'range-and-financing');
    expect(result.state.budget.value).toBe('15–20 млн руб');
    expect(result.state.paymentMethod.value).toBeNull();
    expect(result.state.paymentMethod.needsClarification).toBe(true);
    expect(result.state.downPayment?.value ?? null).toBeNull();
  });

  it.each([
    'Стоимость квадратного метра 0,5–1 млн.',
    'Доход за год 15 миллионов.',
    'Можем подняться до 20–22 этажей.',
  ])('does not turn non-budget numbers into budget: %s', (text) => {
    const { result } = single(text, `non-budget-${text}`);
    expect(result.state.budget.value).toBeNull();
    expect(activeBudgetFacts(result.state)).toHaveLength(0);
  });

  it('K: supersedes the old amount with a corrected current range', () => {
    const oldTurn = clientTurn('budget-old', 'Бюджет около 15 миллионов.', 1);
    const first = advance(createInitialState(), [], oldTurn);
    const newTurn = clientTurn('budget-new', 'Нет, можем подняться до 20–22.', 2);
    const second = advance(first.result.state, first.history, newTurn).result;
    const oldFact = second.state.confirmedFacts.find((fact) => fact.category === 'budget' && fact.turnId === oldTurn.id);
    const newFact = second.state.confirmedFacts.find((fact) => fact.category === 'budget' && fact.turnId === newTurn.id);

    expect(second.state.budget.value).toBe('20–22 млн руб');
    expect(oldFact?.lifecycleStatus).toBe('superseded');
    expect(newFact).toMatchObject({ lifecycleStatus: 'confirmed', turnId: newTurn.id });
    expect(newFact?.supersedesFactId).toBe(oldFact?.id);
    expect(newFact?.evidenceQuote).toMatch(/подняться до 20–22/iu);
    expect(activeBudgetFacts(second.state)).toHaveLength(1);
    expect(second.state.scriptProgress?.metrics.budget.value).toBe('20–22 млн руб');
    expect(second.event?.type).toBe('FACT_CORRECTION');
  });
});
