import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation } from './localAnalysisEngine';

function clientTurn(id: string, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'decision-maker-iteration-20',
    source: 'call_audio',
    speaker: 'client',
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

function replay(texts: string[]) {
  let state: ConversationState = createInitialState();
  const turns: TranscriptTurn[] = [];
  for (const [index, text] of texts.entries()) {
    const turn = clientTurn(`decision-${index + 1}`, text, index + 1);
    turns.push(turn);
    state = advanceLocalConversation(state, turn, turns).state;
  }
  return state;
}

const facts = (state: ConversationState) => state.confirmedFacts.filter(
  (fact) => fact.category === 'decision_makers',
);

function expectAuthority(text: string, expected: RegExp) {
  const state = replay([text]);
  expect(state.decisionMakers.value).toMatch(expected);
  expect(state.scriptProgress?.metrics.decisionMaker).toMatchObject({
    status: 'confirmed',
    value: state.decisionMakers.value,
  });
  expect(facts(state).filter((fact) => fact.lifecycleStatus === 'confirmed')).toHaveLength(1);
  expect(text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')).toContain(
    (facts(state)[0]?.evidenceQuote || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е'),
  );
  return state;
}

describe('FIX 20: decision authority semantic extraction', () => {
  it.each([
    ['Финальное слово при выборе квартиры остаётся за мной.', /самостоятель/iu],
    ['Ничьё одобрение не требуется, покупку утверждаю лично.', /самостоятель/iu],
    ['По доверенности окончательное решение принимаю только я.', /самостоятель/iu],
    ['Выбор обсуждаем, но решать в итоге буду я сам.', /самостоятель/iu],
  ])('recognizes explicit sole authority: %s', (text, expected) => {
    expectAuthority(text, expected);
  });

  it.each([
    ['Окончательно выбирать будем вдвоём с супругом.', /совмест|супруг|семь/iu],
    ['Без одобрения жены объект не утверждаем.', /совмест|супруг|семь/iu],
    ['Финальное решение примем всей семьёй.', /совмест|супруг|семь/iu],
    ['Я и деловой партнёр вместе утверждаем объект.', /совмест|супруг|семь/iu],
  ])('recognizes explicit joint authority: %s', (text, expected) => {
    expectAuthority(text, expected);
  });

  it.each([
    ['Последнее слово по объекту будет за супругой.', /супруг|другой участник/iu],
    ['Отец финансирует покупку и окончательно утвердит вариант.', /другой участник/iu],
  ])('recognizes explicit third-party authority: %s', (text, expected) => {
    expectAuthority(text, expected);
  });

  it.each([
    'Пока не определились, кто будет утверждать объект.',
    'Состав тех, кто примет решение, ещё обсуждаем.',
    'Не знаю, потребуется ли чьё-то согласие.',
  ])('keeps uncertain authority unresolved: %s', (text) => {
    const state = replay([text]);
    expect(state.decisionMakers.value).toBeNull();
    expect(facts(state)).toHaveLength(0);
  });

  it('uses authority, not who merely views or pays', () => {
    expectAuthority('С женой смотрим вместе, но окончательное решение принимаю я.', /самостоятель/iu);
    expectAuthority('Деньги перечислит отец, однако решение по объекту принимаю я сам.', /самостоятель/iu);
  });

  it('respects negation around another participant', () => {
    expectAuthority('Муж в решении не участвует, утверждаю покупку самостоятельно.', /самостоятель/iu);
    expectAuthority('Я сам не утверждаю: финальное слово за супругой.', /супруг|другой участник/iu);
  });

  it.each([
    'Сам посмотрю несколько вариантов.',
    'Жена работает в строительной компании.',
    'Квартиру покупаю для родителей.',
  ])('does not invent authority from unrelated participant wording: %s', (text) => {
    expect(replay([text]).decisionMakers.value).toBeNull();
  });

  it('supersedes joint authority with a newly explicit sole authority', () => {
    const state = replay([
      'Решение принимаем вместе с супругой.',
      'Супруга передала выбор мне, теперь финальное слово за мной.',
    ]);
    const [oldFact, newFact] = facts(state);
    expect(state.decisionMakers.value).toMatch(/самостоятель/iu);
    expect(oldFact.lifecycleStatus).toBe('superseded');
    expect(newFact).toMatchObject({ lifecycleStatus: 'confirmed', supersedesFactId: oldFact.id });
  });

  it('supersedes sole authority when partner approval becomes mandatory', () => {
    const state = replay([
      'Решение о покупке принимаю самостоятельно.',
      'Теперь без согласия делового партнёра объект не утверждаю.',
    ]);
    const [oldFact, newFact] = facts(state);
    expect(state.decisionMakers.value).toMatch(/совмест|супруг|семь/iu);
    expect(oldFact.lifecycleStatus).toBe('superseded');
    expect(newFact.supersedesFactId).toBe(oldFact.id);
  });

  it('preserves a real participant change from family to business partner', () => {
    const state = replay([
      'Окончательное решение принимаем всей семьёй.',
      'Теперь в сделке остаёмся только я и деловой партнёр.',
    ]);
    const [oldFact, newFact] = facts(state);
    expect(state.decisionMakers.value).toMatch(/партн/iu);
    expect(oldFact.lifecycleStatus).toBe('superseded');
    expect(newFact).toMatchObject({ lifecycleStatus: 'confirmed', supersedesFactId: oldFact.id });
  });

  it('protects FIX 18 unresolved mixed-goal semantics', () => {
    const state = replay(['Пока выбираю: оставить для себя или сдавать.']);
    expect(state.goal.value).toBeNull();
    expect(state.decisionMakers.value).toBeNull();
  });

  it('protects FIX 19 purchase-timeline extraction', () => {
    const state = replay(['Покупку планирую закрыть за три-четыре месяца.']);
    expect(state.purchaseTimeline.value).toMatch(/3.*4.*месяц/iu);
    expect(state.decisionMakers.value).toBeNull();
  });
});
