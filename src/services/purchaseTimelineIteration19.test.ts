import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { advanceLocalConversation } from './localAnalysisEngine';

function clientTurn(id: string, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'purchase-timeline-iteration-19',
    source: 'call_audio',
    speaker: 'client',
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

function analyze(text: string) {
  const turn = clientTurn('timeline-1', text, 1);
  const extracted = extractDeterministicFacts(text, turn.id);
  const result = advanceLocalConversation(createInitialState(), turn, [turn]);
  return { ...result, turn, extracted };
}

function expectTimeline(text: string, expected: RegExp) {
  const result = analyze(text);
  const fact = result.extracted.find((item) => item.category === 'timeline');
  expect(fact).toMatchObject({
    field: 'purchaseTimeline',
    value: expect.stringMatching(expected),
    evidenceQuote: expect.any(String),
  });
  expect(text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')).toContain(
    (fact?.evidenceQuote || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е'),
  );
  expect(result.state.purchaseTimeline.value || '').toMatch(expected);
  expect(result.state.scriptProgress?.metrics.urgency).toMatchObject({
    status: expect.stringMatching(/confirmed|partially_confirmed/),
    value: expect.stringMatching(expected),
  });
  return result;
}

describe('FIX 19: purchase timeline semantic extraction', () => {
  it.each([
    ['Рассчитываю купить за три-четыре месяца.', /3.*4.*месяц/iu],
    ['Решение приму в следующем квартале.', /следующ.*квартал/iu],
    ['Купить нужно к началу лета.', /начал.*лет/iu],
    ['Если найдём подходящее, готов купить на этой неделе.', /этой.*недел/iu],
    ['Вопрос срочный, на сделку выхожу сразу.', /сроч|сразу/iu],
    ['Закрыть покупку надо максимум за месяц.', /максимум.*месяц/iu],
    ['Не тороплюсь, ориентир — в течение года.', /не тороп|течение.*год/iu],
    ['Покупка не срочная.', /не сроч/iu],
    ['Покупка не горит, жёсткой даты нет.', /не горит|даты нет/iu],
    ['Срок изменился: нужно купить за месяц.', /за 1 месяц|за месяц/iu],
    ['Уточню точнее: до 15 ноября.', /15.*ноябр/iu],
  ])('extracts a purchase-scoped timeline: %s', (text, expected) => {
    expectTimeline(text, expected);
  });

  it('keeps purchase and move-in dates separate in one utterance', () => {
    const result = expectTimeline('Купить хочу весной, а переехать только осенью.', /весн/iu);
    expect(result.state.purchaseTimeline.value || '').not.toMatch(/осен/iu);
  });

  it('uses the positive side of a first-turn contrast without emitting correction', () => {
    const result = expectTimeline('Не через год, а в ближайшие два месяца.', /2.*месяц/iu);
    expect(result.state.purchaseTimeline.value || '').not.toMatch(/через год/iu);
    expect(result.event?.type).not.toBe('FACT_CORRECTION');
  });

  it.each([
    'Пока вообще не понимаю, когда буду покупать.',
    'Срок покупки пока не определял.',
    'Если когда-нибудь перееду, тогда и подумаю о покупке.',
    'Покупать в этом году не планирую.',
  ])('does not strengthen absent, uncertain or hypothetical timing: %s', (text) => {
    const result = analyze(text);
    expect(result.state.purchaseTimeline.value).toBeNull();
    expect(result.extracted.some((item) => item.category === 'timeline')).toBe(false);
  });

  it.each([
    'Ребёнку три года.',
    'Ремонт займёт три месяца.',
    'В отпуск поеду летом.',
    'Переехать планирую осенью, срок покупки пока не решил.',
  ])('does not extract unrelated age, repair, travel or move-in timing: %s', (text) => {
    expect(analyze(text).state.purchaseTimeline.value).toBeNull();
  });

  it('supersedes a recognized year horizon with the new month horizon', () => {
    const firstTurn = clientTurn('timeline-old', 'Покупка примерно через год.', 1);
    const secondTurn = clientTurn('timeline-new', 'Срок изменился: нужно купить за месяц.', 2);
    const first = advanceLocalConversation(createInitialState(), firstTurn, [firstTurn]);
    const second = advanceLocalConversation(first.state, secondTurn, [firstTurn, secondTurn]);
    const facts = second.state.confirmedFacts.filter((fact) => fact.category === 'timeline');
    const oldFact = facts.find((fact) => fact.turnId === firstTurn.id);
    const newFact = facts.find((fact) => fact.turnId === secondTurn.id);

    expect(second.state.purchaseTimeline.value).toMatch(/за 1 месяц|за месяц/iu);
    expect(oldFact?.lifecycleStatus).toBe('superseded');
    expect(newFact).toMatchObject({ lifecycleStatus: 'confirmed', supersedesFactId: oldFact?.id });
  });

  it('supersedes one purchase season with another without changing generic supersede', () => {
    const firstTurn = clientTurn('timeline-old', 'Сделка будет весной.', 1);
    const secondTurn = clientTurn('timeline-new', 'Нет, перенесли на осень.', 2);
    const first = advanceLocalConversation(createInitialState(), firstTurn, [firstTurn]);
    const second = advanceLocalConversation(first.state, secondTurn, [firstTurn, secondTurn]);
    const facts = second.state.confirmedFacts.filter((fact) => fact.category === 'timeline');

    expect(second.state.purchaseTimeline.value).toMatch(/осен/iu);
    expect(facts.find((fact) => fact.turnId === firstTurn.id)?.lifecycleStatus).toBe('superseded');
    expect(facts.find((fact) => fact.turnId === secondTurn.id)?.supersedesFactId).toBe(
      facts.find((fact) => fact.turnId === firstTurn.id)?.id,
    );
  });

  it('keeps a low-urgency fact until an exact calendar deadline replaces it', () => {
    const firstTurn = clientTurn('timeline-calm', 'Покупка не срочная.', 1);
    const secondTurn = clientTurn('timeline-deadline', 'Точный срок — до конца ноября.', 2);
    const first = advanceLocalConversation(createInitialState(), firstTurn, [firstTurn]);
    const second = advanceLocalConversation(first.state, secondTurn, [firstTurn, secondTurn]);

    expect(first.state.purchaseTimeline.value).toMatch(/не сроч/iu);
    expect(second.state.purchaseTimeline.value).toMatch(/до конца ноября/iu);
  });

  it('does not regress FIX 18 unresolved goal semantics', () => {
    const result = analyze('Пока выбираю: оставить для себя или сдавать.');
    expect(result.state.goal.value).toBeNull();
    expect(result.state.purchaseTimeline.value).toBeNull();
    expect(result.event?.type).not.toBe('FACT_CORRECTION');
  });
});
