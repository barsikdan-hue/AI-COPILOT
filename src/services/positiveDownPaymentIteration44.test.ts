import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState, mergeFactsDelta } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

function replay(texts: string[]) {
  let state = createInitialState();
  const turns: TranscriptTurn[] = [];
  for (const [index, text] of texts.entries()) {
    const turn: TranscriptTurn = {
      id: `fix44-${index}`, sessionId: 'fix44', source: 'call_audio', speaker: 'client',
      text, timestamp: (index + 1) * 1000, isFinal: true, revision: index + 1,
    };
    turns.push(turn);
    state = advanceLocalConversation(state, turn, turns).state;
  }
  return { state, turns };
}

describe('FIX44 explicit positive downPayment amounts', () => {
  // Catch losing explicitly bound quantities before merge, or routing the
  // same money into budget. Expectations are independent financial amounts.
  it.each([
    ['На первый взнос выделено три миллиона.', '3 млн руб'],
    ['Первоначальный платёж будет 7 000 000 рублей.', '7 млн руб'],
    ['Первоначальный платёж будет 7\u00a0000\u00a0000 рублей.', '7 млн руб'],
    ['Первоначальный  платёж  будет  7  000  000  рублей.', '7 млн руб'],
    ['Могу внести тридцать процентов первоначально.', '30%'],
    ['Первоначально готов внести 10 млн.', '10 млн руб'],
    ['На взнос есть 6 млн.', '6 млн руб'],
    ['Первый взнос двадцать пять процентов.', '25%'],
    ['Первый взнос двадцать  пять процентов.', '25%'],
    ['Пять миллионов на первый взнос.', '5 млн руб'],
    ['На первый взнос выделено 3 млн.', '3 млн руб'],
  ])('projects the explicit amount without inventing budget: %s', (text, value) => {
    const facts = extractDeterministicFacts(text, 'amount');
    const dp = facts.filter(fact => fact.field === 'downPayment');
    expect(dp).toEqual([expect.objectContaining({ value, status: 'confirmed', evidenceTurnId: 'amount' })]);
    expect(text.toLowerCase()).toContain(dp[0].evidenceQuote.toLowerCase());
    expect(facts.filter(fact => fact.field === 'budget')).toHaveLength(0);
    const { state } = replay([text]);
    expect(state.downPayment?.value).toBe(value);
    expect(state.budget.value).toBeNull();
    expect(state.scriptProgress?.metrics.downPayment.value).toBe(value);
    expect(state.scriptProgress?.metrics.downPayment.status).toBe('confirmed');
  });

  it.each([
    ['Общий бюджет 20 миллионов, из них пять — первый взнос.', '20 млн руб', '5 млн руб'],
    ['Покупка до 30 млн, первоначально готов внести 10 млн.', 'До 30 млн руб', '10 млн руб'],
    ['Ищу в диапазоне 18–22 млн, на взнос есть 6 млн.', '18–22 млн руб', '6 млн руб'],
    ['Бюджет 18 млн, на первый взнос выделено три миллиона.', '18 млн руб', '3 млн руб'],
    ['На первый взнос выделено три миллиона, бюджет 18 млн.', '18 млн руб', '3 млн руб'],
    ['Общий бюджет 20 млн, из них пять — первый взнос, ежемесячный платёж 80 тыс руб.', '20 млн руб', '5 млн руб'],
  ])('keeps budget and DP evidence independent: %s', (text, budget, dp) => {
    const { state, turns } = replay([text]);
    expect(state.budget.value).toBe(budget);
    expect(state.downPayment?.value).toBe(dp);
    const response = buildLocalAnalysisResponse({
      sessionId: 'fix44', revision: 1, newTurns: turns, recentTurns: turns, currentState: state,
    });
    expect(response.factsDelta.find(fact => fact.field === 'budget')?.value).toBe(budget);
    expect(response.factsDelta.find(fact => fact.field === 'downPayment')?.value).toBe(dp);
  });

  it.each([
    'Бюджет 30 млн.',
    'На ремонт выделено три миллиона.',
    'Ежемесячный платёж будет 7 000 000 рублей.',
    'Могу потратить тридцать процентов на ремонт.',
    'Взнос за парковку 6 млн.',
    'На членский взнос есть 6 млн.',
    'Первоначально бюджет 10 млн.',
    'Первый взнос обсудим позже, на ремонт выделено три миллиона.',
    'Общий бюджет 20 млн, из них пять — на ремонт, первый взнос обсудим позже.',
    'Могу внести тридцать процентов ежемесячно.',
    'Не могу внести тридцать процентов первоначально.',
    'Не на первый взнос выделено три миллиона, а на ремонт.',
    'Первоначально готов внести 10 млн за парковку.',
    'На взнос есть 6 млн за парковку.',
    'Первоначально готов внести 10 млн рублей за парковку.',
    'На взнос есть 6 млн рублей за парковку.',
    'Могу внести тридцать процентов первоначально на ремонт.',
  ])('does not promote another money role or a denied offer to DP: %s', text => {
    expect(extractDeterministicFacts(text, 'other').filter(fact => fact.field === 'downPayment')).toHaveLength(0);
  });

  it('preserves cancellation and historical chronology for an expanded amount', () => {
    const positive = 'На первый взнос выделено три миллиона.';
    const { state, turns } = replay([positive, 'Первоначального взноса сейчас нет', 'Спасибо']);
    expect(state.downPayment?.value).toBeNull();
    expect(state.confirmedFacts.find(fact => fact.value === '3 млн руб')?.lifecycleStatus).toBe('superseded');
    const after = mergeFactsDelta(state, extractDeterministicFacts(positive, turns[0].id), state.stage, undefined, 4,
      Object.fromEntries(turns.map(turn => [turn.id, turn.text])));
    expect(after.downPayment?.value).toBeNull();
    expect(state.scriptProgress?.metrics.downPayment.value).toBeNull();
  });

  it('reconfirms an expanded amount after cancellation without reviving old evidence', () => {
    const { state } = replay(['Первый взнос 4 млн', 'Первоначального взноса сейчас нет', 'На первый взнос выделено три миллиона.']);
    expect(state.downPayment?.value).toBe('3 млн руб');
    expect(state.scriptProgress?.metrics.downPayment.value).toBe('3 млн руб');
    expect(state.confirmedFacts.find(fact => fact.value === '4 млн руб')?.lifecycleStatus).toBe('superseded');
  });

  it('keeps a same-turn expanded correction after explicit cancellation', () => {
    const { state } = replay(['Первый взнос 4 млн', 'Первоначального взноса сейчас нет, точнее, на первый взнос выделено три миллиона.']);
    expect(state.downPayment?.value).toBe('3 млн руб');
    expect(state.scriptProgress?.metrics.downPayment.value).toBe('3 млн руб');
  });

  it('selects a later explicit DP correction over an earlier expanded amount', () => {
    const text = 'На первый взнос выделено три миллиона, точнее, первоначальный взнос 5 млн.';
    expect(extractDeterministicFacts(text, 'correction').find(fact => fact.field === 'downPayment')?.value).toBe('5 млн руб');
    const { state } = replay([text]);
    expect(state.downPayment?.value).toBe('5 млн руб');
    expect(state.scriptProgress?.metrics.downPayment.value).toBe('5 млн руб');
  });
});
