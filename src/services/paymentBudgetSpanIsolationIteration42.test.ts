import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

function replay(texts: string[]) {
  let state: ConversationState = createInitialState();
  const turns: TranscriptTurn[] = [];
  for (const [index, text] of texts.entries()) {
    const turn: TranscriptTurn = {
      id: `fix42-${index}`, sessionId: 'fix42', source: 'call_audio', speaker: 'client',
      text, timestamp: (index + 1) * 1000, isFinal: true, revision: index + 1,
    };
    turns.push(turn);
    state = advanceLocalConversation(state, turn, turns).state;
  }
  return { state, turns };
}

const active = (state: ConversationState, category: string) => state.confirmedFacts.filter(
  fact => fact.category === category && !['superseded', 'rejected'].includes(fact.lifecycleStatus || ''),
);

describe('FIX42 payment and budget money span isolation', () => {
  // These tests catch routing a first-payment amount into budget and rejecting
  // an independent budget solely because another amount is a down payment.
  it.each([
    'Первый платёж 4,5 млн',
    'Первый платёж — 4,5 млн.',
    'Первоначальный платеж: 4,5 млн',
    '4,5 млн на первый платёж',
    'Первый взнос 4,5 млн',
  ])('extracts the first payment without a budget candidate: %s', text => {
    const facts = extractDeterministicFacts(text, 'payment');
    expect(facts.filter(f => f.field === 'budget')).toHaveLength(0);
    expect(facts.filter(f => f.field === 'downPayment')).toEqual([
      expect.objectContaining({ category: 'downPayment', value: '4.5 млн руб', evidenceTurnId: 'payment' }),
    ]);
  });

  it('preserves the earlier budget when a first-payment amount arrives', () => {
    const { state, turns } = replay(['Бюджет 15 млн', 'Первый платёж 4,5 млн']);
    expect(state.budget.value).toBe('15 млн руб');
    expect(state.downPayment?.value).toBe('4.5 млн руб');
    expect(active(state, 'budget')).toEqual([
      expect.objectContaining({ turnId: turns[0].id, value: '15 млн руб', lifecycleStatus: 'confirmed' }),
    ]);
    expect(active(state, 'downPayment')).toHaveLength(1);
    expect(state.scriptProgress?.metrics.budget.value).toBe('15 млн руб');
    expect(state.scriptProgress?.metrics.downPayment.value).toBe('4.5 млн руб');
    const last = turns.at(-1)!;
    const response = buildLocalAnalysisResponse({sessionId:'fix42',revision:2,newTurns:[last],recentTurns:turns,currentState:state});
    expect(response.factsDelta.filter(f => f.field === 'budget')).toHaveLength(0);
    expect(response.factsDelta.find(f => f.field === 'downPayment')?.value).toBe('4.5 млн руб');
  });

  it.each([
    'Всего рассчитываю на 18 млн, первый взнос 5 млн',
    'Бюджет 18 млн, первый взнос 5 млн',
    'Первый взнос 5 млн, всего рассчитываю на 18 млн',
    'Всего рассчитываю на 18 млн. Первый платёж — 5 млн.',
    'Первый платёж 5 млн; бюджет 18 млн',
    'Всего рассчитываю на 18 млн, 5 млн на первый платёж',
  ])('preserves independent budget and payment evidence: %s', text => {
    const facts = extractDeterministicFacts(text, 'mixed');
    expect(facts.filter(f => f.field === 'budget')).toEqual([
      expect.objectContaining({ value: '18 млн руб', evidenceQuote: expect.stringMatching(/18\s*млн/iu) }),
    ]);
    expect(facts.filter(f => f.field === 'downPayment')).toEqual([
      expect.objectContaining({ value: '5 млн руб', evidenceQuote: expect.stringMatching(/первый\s+(?:взнос|плат[её]ж)/iu) }),
    ]);
    const { state } = replay([text]);
    expect(state.budget.value).toBe('18 млн руб');
    expect(state.downPayment?.value).toBe('5 млн руб');
    expect(active(state, 'budget')).toHaveLength(1);
    expect(active(state, 'downPayment')).toHaveLength(1);
    expect(state.scriptProgress?.metrics.budget.value).toBe('18 млн руб');
    expect(state.scriptProgress?.metrics.downPayment.value).toBe('5 млн руб');
  });

  it.each([
    ['Бюджет 15 млн', '15 млн руб'],
    ['Всего рассчитываю на 18 млн', '18 млн руб'],
    ['Рассматриваю до 20 миллионов', 'До 20 млн руб'],
    ['Рассматриваю до 20 миллионов, первый взнос 5 млн', 'До 20 млн руб'],
    ['Рассматриваю 15–20 млн, первый взнос 5 млн', '15–20 млн руб'],
    ['Бюджет около 17,5 млн, первый платёж 4,5 млн', '17.5 млн руб'],
    ['Не 15 млн, а 18 млн, первый взнос 5 млн', '18 млн руб'],
  ])('preserves the budget contract: %s', (text, value) => {
    expect(replay([text]).state.budget.value).toBe(value);
  });

  it('lets the existing merge supersede budget independently of payment', () => {
    const { state, turns } = replay(['Бюджет 15 млн', 'Всего рассчитываю на 18 млн, первый взнос 5 млн']);
    const old = state.confirmedFacts.find(f => f.category === 'budget' && f.turnId === turns[0].id);
    expect(old?.lifecycleStatus).toBe('superseded');
    expect(active(state, 'budget')).toEqual([
      expect.objectContaining({value:'18 млн руб',supersedesFactId:old?.id}),
    ]);
    expect(state.budget.value).toBe('18 млн руб');
    expect(state.downPayment?.value).toBe('5 млн руб');
  });

  it('retains a contextual short down-payment answer', () => {
    const facts = extractDeterministicFacts('4,5 млн', 'contextual', 'Какую сумму первоначального взноса можете внести?');
    expect(facts.filter(f => f.field === 'budget')).toHaveLength(0);
    expect(facts.find(f => f.field === 'downPayment')?.value).toBe('4.5 млн руб');
  });

  it('preserves an explicit total even after a down-payment question', () => {
    const facts = extractDeterministicFacts(
      'Всего рассчитываю на 18 млн, первый взнос 5 млн', 'contextual-mixed',
      'Какую сумму первоначального взноса можете внести?',
    );
    expect(facts.find(f => f.field === 'budget')?.value).toBe('18 млн руб');
    expect(facts.find(f => f.field === 'downPayment')?.value).toBe('5 млн руб');
  });

  it.each(['Ежемесячный платёж 80 тыс руб', 'Ипотечный платёж 80 тыс руб'])('does not treat another payment role as a down payment: %s', text => {
    expect(extractDeterministicFacts(text, 'other-payment').filter(f => f.field === 'downPayment')).toHaveLength(0);
  });

  it.each([
    'Первый взнос 5 млн, ежемесячный платёж 80 тыс руб',
    'Первый взнос 5 млн, остаток 10 млн в ипотеку',
    'Первый взнос 5 млн или 7 млн',
    'Первый взнос 5 млн, максимум 7 млн',
    'Первый взнос 5 млн руб или 7 млн руб',
    'Первый взнос 5 млн, ежемесячный платёж около 80 тыс руб',
    'Первый взнос 5 млн, остаток 10 млн возьму в ипотеку',
    'Первый взнос 5 млн или 7 млн, максимум 8 млн',
    'Первый взнос 5 млн руб или 7 млн руб, максимум 8 млн руб',
    'Первый взнос 5 млн, ежемесячный платёж 80 тыс, максимум 100 тыс',
    'Первый взнос 5 млн, ежемесячный платёж 80 тыс или 100 тыс',
  ])('does not promote another financing amount into budget: %s', text => {
    const facts = extractDeterministicFacts(text, 'financing');
    expect(facts.filter(f => f.field === 'budget')).toHaveLength(0);
    expect(facts.find(f => f.field === 'downPayment')?.value).toBe('5 млн руб');
  });

  it('keeps budget separate from down payment and monthly payment', () => {
    const facts = extractDeterministicFacts(
      'Всего рассчитываю на 18 млн, первый взнос 5 млн, ежемесячный платёж 80 тыс руб', 'three-amounts',
    );
    expect(facts.find(f => f.field === 'budget')?.value).toBe('18 млн руб');
    expect(facts.find(f => f.field === 'downPayment')?.value).toBe('5 млн руб');
  });

  it.each([
    'Первый взнос 5 млн, ежемесячный платёж 80 тыс руб',
    'Первый взнос 5 млн, остаток 10 млн в ипотеку',
    'Первый взнос 5 млн или 7 млн',
    'Первый взнос 5 млн, максимум 7 млн',
  ])('preserves an earlier budget across payment-only amounts: %s', text => {
    const { state } = replay(['Бюджет 15 млн', text]);
    expect(state.budget.value).toBe('15 млн руб');
    expect(active(state, 'budget')).toEqual([
      expect.objectContaining({turnId:'fix42-0',value:'15 млн руб',lifecycleStatus:'confirmed'}),
    ]);
  });

  it('does not exclude the independent budget after a payment ceiling', () => {
    const facts = extractDeterministicFacts('Первый взнос 5 млн, максимум 7 млн; бюджет 18 млн', 'ceiling-mixed');
    expect(facts.filter(f => f.field === 'budget')).toEqual([
      expect.objectContaining({value:'18 млн руб'}),
    ]);
    expect(facts.find(f => f.field === 'downPayment')?.value).toBe('5 млн руб');
  });

  it.each([
    'Первый взнос 5 млн, максимум 18 млн весь бюджет',
    '5 млн на первый взнос, до 18 млн общий бюджет',
    'Первый взнос 5 млн, максимум 18 млн — весь бюджет',
    '5 млн на первый взнос, до 18 млн — общий бюджет',
    'Первый взнос 5 млн или 7 млн, максимум 18 млн весь бюджет',
    'Первый взнос 5 млн, ежемесячный платёж 80 тыс, максимум 18 млн весь бюджет',
  ])('preserves an amount labelled as overall budget after its value: %s', text => {
    const facts = extractDeterministicFacts(text, 'budget-suffix');
    expect(facts.find(f => f.field === 'budget')?.value).toBe('До 18 млн руб');
    expect(facts.find(f => f.field === 'downPayment')?.value).toBe('5 млн руб');
  });
});
