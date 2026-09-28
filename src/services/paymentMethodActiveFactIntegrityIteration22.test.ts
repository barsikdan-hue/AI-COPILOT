import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation } from './localAnalysisEngine';

const ACTIVE = (status: string | undefined) => !['superseded', 'rejected'].includes(status || '');

function makeTurn(
  sessionId: string,
  index: number,
  text: string,
  speaker: 'agent' | 'client' = 'client',
): TranscriptTurn {
  return {
    id: `${sessionId}-t${index + 1}`,
    sessionId,
    source: speaker === 'client' ? 'call_audio' : 'microphone',
    speaker,
    text,
    timestamp: (index + 1) * 1000,
    isFinal: true,
    revision: index + 1,
  };
}

function replay(
  entries: Array<string | { speaker: 'agent' | 'client'; text: string }>,
  sessionId = 'payment-integrity',
): ConversationState {
  let state = createInitialState();
  const turns: TranscriptTurn[] = [];
  entries.forEach((entry, index) => {
    const item = typeof entry === 'string' ? { speaker: 'client' as const, text: entry } : entry;
    const turn = makeTurn(sessionId, index, item.text, item.speaker);
    turns.push(turn);
    state = advanceLocalConversation(state, turn, turns).state;
  });
  return state;
}

const paymentFacts = (state: ConversationState) =>
  state.confirmedFacts.filter((fact) => fact.category === 'paymentMethod');

const activePaymentFacts = (state: ConversationState) =>
  paymentFacts(state).filter((fact) => ACTIVE(fact.lifecycleStatus));

function expectSingleCurrentPayment(state: ConversationState, expected: RegExp) {
  const active = activePaymentFacts(state);
  expect(active).toHaveLength(1);
  expect(active[0].value).toMatch(expected);
  expect(state.paymentMethod.value).toMatch(expected);
  expect(state.scriptProgress?.metrics.paymentMethod.value).toBe(state.paymentMethod.value);
}

describe('FIX ITERATION 22: paymentMethod active-fact integrity', () => {
  it.each([
    [
      'mortgage',
      ['Рассматриваю ипотеку.', 'Да, ипотека.'],
      /ипотек/iu,
    ],
    [
      'cash',
      ['Куплю полностью за свои средства.', 'Да, полностью оплачу собственными средствами.'],
      /собствен|налич/iu,
    ],
    [
      'mixed',
      ['Часть оплачу своими, остаток возьму в ипотеку.', 'Да, часть своими, остальное в ипотеку.'],
      /смешан|собствен.*ипотек/iu,
    ],
  ])('keeps one active fact after repeated %s assertions', (_name, texts, expected) => {
    const state = replay(texts as string[], `repeat-${_name}`);

    expectSingleCurrentPayment(state, expected as RegExp);
    expect(paymentFacts(state)).toHaveLength(2);
    expect(paymentFacts(state).filter((fact) => fact.lifecycleStatus === 'superseded')).toHaveLength(1);
  });

  it('keeps one active fact after three identical assertions', () => {
    const state = replay([
      'Рассматриваю ипотеку.',
      'Да, ипотека.',
      'Подтверждаю: ипотека.',
    ], 'repeat-three');

    expectSingleCurrentPayment(state, /ипотек/iu);
    expect(paymentFacts(state)).toHaveLength(3);
    expect(paymentFacts(state).filter((fact) => fact.lifecycleStatus === 'superseded')).toHaveLength(2);
  });

  it('supersedes every duplicate mortgage fact when the scheme becomes mixed', () => {
    const state = replay([
      'Рассматриваю ипотеку.',
      'Да, ипотека.',
      'Часть оплачу своими, остальное возьму в ипотеку.',
    ], 'mortgage-to-mixed');

    expectSingleCurrentPayment(state, /смешан|собствен.*ипотек/iu);
    expect(paymentFacts(state).filter((fact) => fact.lifecycleStatus === 'superseded')).toHaveLength(2);
  });

  it.each([
    [
      'cash to mortgage',
      ['Куплю полностью за свои средства.', 'Нет, схема изменилась: всё-таки беру ипотеку.'],
      /ипотек/iu,
    ],
    [
      'mortgage to cash',
      ['Рассматриваю ипотеку.', 'Ипотека отпала, куплю полностью за свои средства.'],
      /собствен|налич/iu,
    ],
    [
      'mixed to mortgage',
      ['Часть оплачу своими, остаток возьму в ипотеку.', 'Теперь буду брать ипотеку.'],
      /ипотек/iu,
    ],
  ])('keeps only the new current value for %s', (_name, texts, expected) => {
    const state = replay(texts as string[], `transition-${_name}`);

    expectSingleCurrentPayment(state, expected as RegExp);
    const facts = paymentFacts(state);
    expect(facts).toHaveLength(2);
    expect(facts[0].lifecycleStatus).toBe('superseded');
    expect(facts[1].supersedesFactId).toBe(facts[0].id);
  });

  it('does not supersede budget, down-payment amount or down-payment source', () => {
    const state = replay([
      'Бюджет 20 миллионов.',
      'Первоначальный взнос 5 млн.',
      'Взнос будет из продажи квартиры.',
      'Рассматриваю ипотеку.',
      'Ипотека отпала, оплачу наличными.',
    ], 'unrelated-facts');

    expectSingleCurrentPayment(state, /собствен|налич/iu);
    for (const category of ['budget', 'downPayment', 'downPaymentSource']) {
      const facts = state.confirmedFacts.filter((fact) => fact.category === category);
      expect(facts.length, category).toBeGreaterThan(0);
      expect(facts.every((fact) => ACTIVE(fact.lifecycleStatus)), category).toBe(true);
    }
  });

  it('does not contaminate payment facts between sessions', () => {
    const mortgage = replay(['Рассматриваю ипотеку.', 'Да, ипотека.'], 'session-mortgage');
    const cash = replay(['Куплю полностью за свои средства.', 'Да, полностью оплачу собственными средствами.'], 'session-cash');

    expectSingleCurrentPayment(mortgage, /ипотек/iu);
    expectSingleCurrentPayment(cash, /собствен|налич/iu);
    expect(paymentFacts(mortgage).every((fact) => fact.turnId.startsWith('session-mortgage'))).toBe(true);
    expect(paymentFacts(cash).every((fact) => fact.turnId.startsWith('session-cash'))).toBe(true);
  });

  it('replays the exact external mortgage-question to mixed-financing failure', () => {
    const state = replay([
      { speaker: 'client', text: 'Ипотека... это кредит, что ли?' },
      { speaker: 'agent', text: 'Да, ипотека — это кредит на покупку недвижимости.' },
      { speaker: 'client', text: 'Понятно. А какие сейчас проценты по этим... ипотекам?' },
      { speaker: 'agent', text: 'Процентные ставки зависят от программы.' },
      { speaker: 'agent', text: 'Как планируете оплачивать? Наличные, ипотека или рассрочка?' },
      { speaker: 'client', text: 'Оплата... Ну, родители помогают. Остальное - ипотека, наверное.' },
    ], 'external-run-1341');

    expectSingleCurrentPayment(state, /смешан|собствен.*ипотек/iu);
    expect(paymentFacts(state)).toHaveLength(3);
    expect(paymentFacts(state).filter((fact) => fact.lifecycleStatus === 'superseded')).toHaveLength(2);
  });
});
