import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { chooseDialoguePolicyTarget } from './dialoguePolicyEngine';
import { extractDeterministicFacts } from './deterministicFacts';
import { advanceLocalConversation } from './localAnalysisEngine';

function clientTurn(text: string, id = 'timeline-client', revision = 1): TranscriptTurn {
  return {
    id,
    sessionId: 'purchase-timeline-regression',
    source: 'call_audio',
    speaker: 'client',
    text,
    timestamp: 1000 + revision,
    isFinal: true,
    revision,
  };
}

function analyze(text: string) {
  const turn = clientTurn(text);
  const extracted = extractDeterministicFacts(text, turn.id);
  const advanced = advanceLocalConversation(createInitialState(), turn, [turn]);
  const state: ConversationState = advanced.state;
  const policy = chooseDialoguePolicyTarget(state, [turn], state.scriptProgress);
  const activeTimelineFacts = (state.confirmedFacts || []).filter(
    (fact) => fact.category === 'timeline' && !['superseded', 'rejected'].includes(String(fact.lifecycleStatus)),
  );
  return { turn, extracted, advanced, state, policy, activeTimelineFacts };
}

function expectTimeline(text: string, expected: RegExp) {
  const result = analyze(text);
  const extracted = result.extracted.find((fact) => fact.field === 'purchaseTimeline');
  expect(extracted).toMatchObject({ evidenceQuote: expect.any(String), status: 'confirmed' });
  expect(extracted?.value || '').toMatch(expected);
  expect(text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')).toContain(
    (extracted?.evidenceQuote || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е'),
  );
  expect(result.state.purchaseTimeline.value || '').toMatch(expected);
  expect(result.activeTimelineFacts).toEqual(expect.arrayContaining([
    expect.objectContaining({ value: expect.stringMatching(expected), turnId: result.turn.id }),
  ]));
  expect(result.state.scriptProgress?.metrics.urgency).toMatchObject({
    status: 'confirmed',
    value: expect.stringMatching(expected),
  });
  expect(result.policy?.semanticKey).not.toBe('ask_timeline');
  return result;
}

describe('purchase timeline extraction regression', () => {
  it('confirms a word-number within-duration and closes the timeline question', () => {
    expectTimeline('Планирую купить в течение трёх месяцев.', /в\s+течение\s+3\s+месяц/iu);
  });

  it('normalizes two months without losing within-duration semantics', () => {
    expectTimeline('В течение двух месяцев.', /в\s+течение\s+2\s+месяц/iu);
  });

  it('keeps through-duration semantics distinct', () => {
    const result = expectTimeline('Через три месяца.', /через\s+3\s+месяц/iu);
    expect(result.state.purchaseTimeline.value).not.toMatch(/в\s+течение/iu);
  });

  it.each([
    ['До конца года.', /до\s+конца\s+года/iu],
    ['До Нового года.', /до\s+нового\s+года/iu],
  ])('preserves a relative calendar deadline without inventing a date: %s', (text, expected) => {
    const result = expectTimeline(text, expected);
    expect(result.state.purchaseTimeline.value || '').not.toMatch(/\d{1,2}[./-]\d{1,2}/u);
  });

  it('does not add unsupported seasonal temporal NLP', () => {
    const result = analyze('Весной.');
    expect(result.state.purchaseTimeline.value).toBeNull();
    expect(result.activeTimelineFacts).toHaveLength(0);
    expect(result.state.scriptProgress?.metrics.urgency.status).toBe('not_confirmed');
  });

  it('preserves a flexible numeric range', () => {
    const result = expectTimeline('Где-то через 2–3 месяца.', /где-то\s+через\s+2\s*[-–—]\s*3\s+месяц/iu);
    expect(result.state.purchaseTimeline.isFlexible).toBe(true);
    expect(result.activeTimelineFacts[0]).toMatchObject({ isFlexible: true });
  });

  it('does not create a positive timeline from explicit absence', () => {
    const result = analyze('Пока сроков нет.');
    expect(result.state.purchaseTimeline.value).toBeNull();
    expect(result.activeTimelineFacts).toHaveLength(0);
    expect(result.state.scriptProgress?.metrics.urgency.status).toBe('not_confirmed');
  });

  it('preserves a lower bound instead of strengthening it to exact six months', () => {
    const result = expectTimeline('Не раньше чем через полгода.', /не\s+раньше\s+чем\s+через\s+полгода/iu);
    expect(result.state.purchaseTimeline.comment).toMatch(/нижняя\s+граница/iu);
    expect(result.state.purchaseTimeline.value).not.toBe('6 месяцев');
  });

  it('preserves an upper bound instead of converting it to an exact duration', () => {
    const result = expectTimeline('Максимум через три месяца.', /максимум\s+через\s+3\s+месяц/iu);
    expect(result.state.purchaseTimeline.comment).toMatch(/верхняя\s+граница/iu);
  });

  it('supersedes an earlier timeline on a genuine accelerated-plan correction', () => {
    const first = clientTurn('Покупать будем примерно через полгода.', 'timeline-old', 1);
    const second = clientTurn('Нет, планы ускорились, хотим в течение двух месяцев.', 'timeline-new', 2);
    const turns = [first, second];
    const afterFirst = advanceLocalConversation(createInitialState(), first, [first]).state;
    const advanced = advanceLocalConversation(afterFirst, second, turns);
    const state = advanced.state;
    const facts = (state.confirmedFacts || []).filter((fact) => fact.category === 'timeline');
    const oldFact = facts.find((fact) => fact.turnId === first.id);
    const newFact = facts.find((fact) => fact.turnId === second.id);

    expect(state.purchaseTimeline.value).toMatch(/в\s+течение\s+2\s+месяц/iu);
    expect(oldFact?.lifecycleStatus).toBe('superseded');
    expect(newFact).toMatchObject({
      lifecycleStatus: 'confirmed',
      supersedesFactId: oldFact?.id,
      evidenceQuote: expect.stringMatching(/в\s+течение\s+двух\s+месяц/iu),
    });
    expect(state.scriptProgress?.metrics.urgency).toMatchObject({
      status: 'confirmed',
      value: expect.stringMatching(/в\s+течение\s+2\s+месяц/iu),
    });
    expect(advanced.event?.type).toBe('FACT_CORRECTION');
  });

  it('does not confuse age with a purchase timeline', () => {
    const result = expectTimeline('Мне 35 лет, квартиру хочу купить через три месяца.', /через\s+3\s+месяц/iu);
    expect(result.state.purchaseTimeline.value || '').not.toContain('35');
    expect(result.activeTimelineFacts.every((fact) => !fact.value.includes('35'))).toBe(true);
  });

  it('keeps budget and year-end timeline in separate canonical fields', () => {
    const result = expectTimeline('Бюджет 20 млн, покупка до конца года.', /до\s+конца\s+года/iu);
    expect(result.state.budget.value).toMatch(/20/iu);
    expect(result.state.purchaseTimeline.value || '').not.toMatch(/20\s*млн/iu);
  });
});
