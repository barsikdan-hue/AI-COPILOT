import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

function replay(texts: (string | { speaker: 'agent'; text: string })[]) {
  let state = createInitialState();
  const turns: TranscriptTurn[] = [];
  const states: ConversationState[] = [];
  for (const [index, item] of texts.entries()) {
    const text = typeof item === 'string' ? item : item.text;
    const turn: TranscriptTurn = {
      id: `fix45-${index}`, sessionId: 'fix45', source: 'call_audio', speaker: typeof item === 'string' ? 'client' : item.speaker,
      text, timestamp: (index + 1) * 1000, isFinal: true, revision: index + 1,
    };
    turns.push(turn);
    state = advanceLocalConversation(state, turn, turns).state;
    states.push(state);
  }
  return { state, states, turns };
}

const activeBudget = (state: ConversationState) => state.confirmedFacts.filter(
  fact => fact.category === 'budget' && !['superseded', 'rejected'].includes(fact.lifecycleStatus || ''),
);

describe('FIX45 word budget and explicit ceiling correction', () => {
  // Catch missing or truncated word quantities before merge; literal values
  // are the client's financial amount, independently derived from the text.
  it.each([
    ['Бюджет до двадцати миллионов.', 'До 20 млн руб'],
    ['Могу потратить тридцать миллионов.', '30 млн руб'],
    ['Бюджет двадцать пять миллионов.', '25 млн руб'],
    ['Бюджет до двадцати пяти миллионов.', 'До 25 млн руб'],
    ['Бюджет двадцать  пять миллионов.', '25 млн руб'],
    ['Бюджет от пятнадцати миллионов.', 'От 15 млн руб'],
    ['Бюджет пятьдесят миллионов.', '50 млн руб'],
    ['Бюджет два миллиарда.', '2 млрд руб'],
    ['Бюджет двадцать пять тысяч.', '25 тыс руб'],
    ['Бюджет от двадцати миллионов до двадцати пяти миллионов.', '20–25 млн руб'],
    ['Жёсткий потолок теперь 22–25 млн.', '22–25 млн руб'],
    ['Жёсткий потолок теперь двадцать два-тридцать миллионов.', '22–30 млн руб'],
  ])('normalizes only the budget quantity and preserves the source quote: %s', (text, value) => {
    const facts = extractDeterministicFacts(text, 'word-amount');
    const budget = facts.filter(fact => fact.field === 'budget');
    expect(budget).toEqual([expect.objectContaining({ value, evidenceTurnId: 'word-amount' })]);
    expect(text.toLowerCase()).toContain(budget[0].evidenceQuote.toLowerCase());
    expect(budget[0].evidenceQuote).toMatch(/[а-я]/iu);
    expect(facts.filter(fact => fact.field === 'downPayment')).toHaveLength(0);
    const { state } = replay([text]);
    expect(state.budget.value).toBe(value);
    expect(state.scriptProgress?.metrics.budget.value).toBe(value);
  });

  it.each([
    ['Бюджет до двадцати миллионов.', 'Поднял лимит до двадцати пяти миллионов.', 'До 25 млн руб'],
    ['Могу потратить тридцать миллионов.', 'Нет, жёсткий потолок теперь двадцать два.', 'До 22 млн руб'],
    ['Бюджет до 20 млн.', 'Поднял лимит до двадцати пяти миллионов.', 'До 25 млн руб'],
    ['Бюджет 30 млн.', 'Нет, жёсткий потолок теперь 22.', 'До 22 млн руб'],
    ['Бюджет 30 млн.', 'Нет, жёсткий потолок теперь двадцать два миллиона.', 'До 22 млн руб'],
    ['Бюджет 30 млн.', 'Не тридцать миллионов, а двадцать два.', '22 млн руб'],
    ['Бюджет 30 млн.', 'Не тридцать миллионов, а двадцать.', '20 млн руб'],
    ['Бюджет 35 млн.', 'Бюджет тридцать миллионов, не тридцать миллионов, а двадцать два.', '22 млн руб'],
    ['Бюджет 35 млн.', 'Жёсткий потолок теперь двадцать два, точнее, бюджет тридцать миллионов.', '30 млн руб'],
    ['Бюджет 35 млн.', 'Бюджет тридцать миллионов, не 30 млн, а 22 млн.', '22 млн руб'],
    ['Бюджет 30 млн.', 'Бюджет 20–25 млн, нет, жёсткий потолок теперь двадцать два.', 'До 22 млн руб'],
    ['Бюджет 35 млн.', 'Бюджет тридцать миллионов, точнее, бюджет 25 млн.', '25 млн руб'],
    ['Бюджет 35 млн.', 'Бюджет теперь 25 млн.', '25 млн руб'],
    ['Бюджет 35 млн.', 'Бюджет теперь двадцать пять миллионов.', '25 млн руб'],
    ['Бюджет 35 млн.', 'Бюджет теперь до двадцати пяти миллионов.', 'До 25 млн руб'],
  ])('supersedes the old budget through the unchanged merge: %s → %s', (seed, correction, value) => {
    const { state, states, turns } = replay([seed, correction]);
    expect(states[0].budget.value).not.toBeNull();
    const old = state.confirmedFacts.find(fact => fact.category === 'budget' && fact.turnId === turns[0].id);
    expect(old?.lifecycleStatus).toBe('superseded');
    expect(activeBudget(state)).toEqual([expect.objectContaining({
      value, turnId: turns[1].id, supersedesFactId: old?.id, lifecycleStatus: 'confirmed',
    })]);
    expect(state.budget.value).toBe(value);
    expect(state.budget.isFlexible).toBe(false);
    expect(state.budget.evidenceTurnIds).toContain(turns[1].id);
    expect(state.scriptProgress?.metrics.budget.value).toBe(value);
    const response = buildLocalAnalysisResponse({
      sessionId: 'fix45', revision: 2, newTurns: [turns[1]], recentTurns: turns, currentState: state,
    });
    const fact = response.factsDelta.find(item => item.field === 'budget');
    expect(fact?.value).toBe(value);
    expect(correction.toLowerCase()).toContain(fact!.evidenceQuote.toLowerCase());
  });

  it.each([
    ['Бюджет до двадцати миллионов, первый взнос 5 млн.', 'До 20 млн руб', '5 млн руб'],
    ['Первый взнос 5 млн, бюджет двадцать пять миллионов.', '25 млн руб', '5 млн руб'],
    ['Бюджет двадцать пять миллионов, на первый взнос выделено три миллиона.', '25 млн руб', '3 млн руб'],
    ['Могу потратить тридцать миллионов, первоначально готов внести 10 млн.', '30 млн руб', '10 млн руб'],
  ])('preserves independent budget and DP spans: %s', (text, budget, dp) => {
    const facts = extractDeterministicFacts(text, 'mixed', 'Какой первоначальный взнос планируете?');
    expect(facts.find(fact => fact.field === 'budget')?.value).toBe(budget);
    expect(facts.find(fact => fact.field === 'downPayment')?.value).toBe(dp);
    const { state } = replay([text]);
    expect(state.budget.value).toBe(budget);
    expect(state.downPayment?.value).toBe(dp);
  });

  it.each([
    'На первый взнос выделено три миллиона.',
    'Первоначальный платёж будет 7 000 000 рублей.',
    'Могу внести тридцать процентов первоначально.',
    'На ремонт выделено тридцать миллионов.',
    'Могу потратить тридцать миллионов на ремонт.',
    'Цена за метр тридцать тысяч.',
    'Годовой доход двадцать пять миллионов.',
    'Ежемесячный платёж двадцать пять тысяч.',
    'Жёсткий потолок теперь двадцать два процента.',
    'Жёсткий потолок теперь двадцать два метра.',
    'Лимит сообщений теперь двадцать два.',
    'У брата бюджет тридцать миллионов.',
    'Если бы бюджет тридцать миллионов, я бы купил.',
    'Если бы у меня был бюджет двадцать пять миллионов, я бы купил.',
    'У брата был бюджет двадцать пять миллионов.',
    'Могу потратить тридцать тысяч в месяц на ипотеку.',
    'Могу потратить двадцать пять тысяч рублей в месяц на ипотеку.',
    'Жёсткий потолок теперь двадцать два или двадцать пять миллионов.',
    'Жёсткий потолок теперь двадцать два, или двадцать пять миллионов.',
  ])('does not turn another role or a hypothetical amount into budget: %s', text => {
    expect(extractDeterministicFacts(text, 'not-budget').filter(fact => fact.field === 'budget')).toHaveLength(0);
  });

  it.each([
    ['Не тридцать миллионов, а двадцать два.', '35 млн руб'],
    ['Бюджет не тридцать миллионов, а двадцать два.', '22 млн руб'],
  ])('respects the DP question while allowing explicit budget attribution: %s', (answer, expected) => {
    const question = 'Какой первоначальный взнос планируете?';
    const facts = extractDeterministicFacts(answer, 'dp-answer', question).filter(fact => fact.field === 'budget');
    expect(facts).toHaveLength(expected === '35 млн руб' ? 0 : 1);
    const { state } = replay(['Бюджет 35 млн.', { speaker: 'agent', text: question }, answer]);
    expect(state.budget.value).toBe(expected);
    expect(state.scriptProgress?.metrics.budget.value).toBe(expected);
    expect(activeBudget(state)).toEqual([expect.objectContaining({ value: expected })]);
  });

  it('keeps FIX43 cancellation independent of a later word-budget correction', () => {
    const { state } = replay([
      'Бюджет 30 млн, первый взнос 4 млн.', 'Первоначального взноса сейчас нет',
      'Поднял лимит до двадцати пяти миллионов.',
    ]);
    expect(state.budget.value).toBe('До 25 млн руб');
    expect(state.downPayment?.value).toBeNull();
    expect(state.scriptProgress?.metrics.downPayment.value).toBeNull();
    expect(state.confirmedFacts.filter(fact => fact.category === 'downPayment').every(fact => fact.lifecycleStatus === 'superseded')).toBe(true);
  });
});
