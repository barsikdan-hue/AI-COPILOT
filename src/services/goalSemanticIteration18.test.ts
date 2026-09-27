import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { chooseDialoguePolicyTarget } from './dialoguePolicyEngine';
import { getContextualDopamineQuestion } from './dopamineQuestionEngine';
import { advanceLocalConversation } from './localAnalysisEngine';

function clientTurn(id: string, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'goal-semantic-iteration-18',
    source: 'call_audio',
    speaker: 'client',
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

function analyze(text: string) {
  const turn = clientTurn('goal-1', text, 1);
  const result = advanceLocalConversation(createInitialState(), turn, [turn]);
  const policy = chooseDialoguePolicyTarget(result.state, [turn], result.state.scriptProgress);
  const dopamine = getContextualDopamineQuestion(result.state, [turn], text);
  return { ...result, turn, policy, dopamine };
}

function activeGoalFacts(state: ConversationState) {
  return (state.confirmedFacts || []).filter(
    (fact) => fact.category === 'goal' && !['superseded', 'rejected'].includes(String(fact.lifecycleStatus)),
  );
}

function expectConfirmedGoal(text: string, expected: RegExp) {
  const result = analyze(text);
  expect(result.state.goal.value).toMatch(expected);
  expect(result.state.primaryGoal?.value).toMatch(expected);
  expect(result.state.goal.needsClarification).not.toBe(true);
  expect(result.state.scriptProgress?.metrics.goal).toMatchObject({ status: 'confirmed' });
  expect(result.state.scriptProgress?.metrics.goal.value || '').toMatch(expected);
  expect(activeGoalFacts(result.state)).toEqual([
    expect.objectContaining({
      value: expect.stringMatching(expected),
      turnId: result.turn.id,
      lifecycleStatus: 'confirmed',
    }),
  ]);
  expect(result.policy?.semanticKey).not.toBe('ask_goal');
  return result;
}

describe('FIX 18: goal semantic extraction and precedence', () => {
  it.each([
    'Квартиру беру себе, жить буду сам.',
    'Покупаю для себя.',
    'Буду жить сам.',
    'Это жильё мне для жизни.',
  ])('confirms explicit personal use without strengthening it to investment: %s', (text) => {
    const result = expectConfirmedGoal(text, /личн|для себя|жизн/iu);
    expect(result.state.goal.value || '').not.toMatch(/инвест|смеш/iu);
    expect(result.dopamine?.category).not.toBe('investor');
  });

  it('keeps explicit permanent residence as the stronger permanent goal', () => {
    expectConfirmedGoal('Нужно для постоянного проживания.', /постоян/iu);
    expectConfirmedGoal('Планирую переехать и жить постоянно.', /постоян/iu);
  });

  it.each([
    'Для личных поездок.',
    'Буду приезжать сюда отдыхать.',
    'Нужна квартира для себя на лето.',
    'Не под аренду, а приезжать самому.',
  ])('confirms seasonal personal use and does not create investment: %s', (text) => {
    const result = expectConfirmedGoal(text, /отдых|сезон|личн/iu);
    expect(result.state.goal.value || '').not.toMatch(/инвест/iu);
  });

  it.each([
    'Беру под аренду.',
    'Нужна доходная недвижимость.',
    'Хочу получать доход.',
    'Рассматриваю как инвестицию.',
  ])('confirms an explicit investment use: %s', (text) => {
    expectConfirmedGoal(text, /инвест|аренд|доход/iu);
  });

  it('respects self-use negation before a positive investment purpose', () => {
    const result = expectConfirmedGoal('Для себя не беру, нужна только доходная недвижимость.', /инвест|доход/iu);
    expect(result.state.goal.value || '').not.toMatch(/личн|для себя/iu);
  });

  it('respects rental negation before a positive seasonal purpose', () => {
    const result = expectConfirmedGoal('Не под аренду, а для личных поездок.', /отдых|сезон|личн/iu);
    expect(result.state.goal.value || '').not.toMatch(/инвест/iu);
  });

  it('does not confirm unresolved alternatives as either goal or mixed use', () => {
    const result = analyze('Пока выбираю: оставить для себя или сдавать.');
    expect(result.state.goal.value).toBeNull();
    expect(result.state.primaryGoal?.value).toBeNull();
    expect(activeGoalFacts(result.state)).toHaveLength(0);
    expect(['not_confirmed', 'needs_clarification']).toContain(result.state.scriptProgress?.metrics.goal.status);
    expect(result.dopamine?.category).not.toBe('investor');
  });

  it.each([
    'Иногда будем жить сами, остальное время сдавать.',
    'Для отдыха семьи и иногда под аренду.',
  ])('confirms mixed use only when both uses are positively intended: %s', (text) => {
    const result = analyze(text);
    expect(result.state.goal.value).toMatch(/инвест.*личн|личн.*инвест|смеш/iu);
    expect(result.state.primaryGoal?.value).toMatch(/инвест/iu);
    expect(result.state.secondaryUse?.value).toMatch(/личн|отдых/iu);
    expect(result.state.scriptProgress?.metrics.goal).toMatchObject({ status: 'confirmed' });
    expect(result.state.scriptProgress?.metrics.goal.value || '').toMatch(/инвест.*личн|личн.*инвест|смеш/iu);
  });

  it('supersedes personal use with an explicit investment correction', () => {
    const firstTurn = clientTurn('goal-personal', 'Беру для постоянной жизни.', 1);
    const secondTurn = clientTurn('goal-investment', 'Нет, планы поменялись, решил брать под аренду.', 2);
    const first = advanceLocalConversation(createInitialState(), firstTurn, [firstTurn]);
    const second = advanceLocalConversation(first.state, secondTurn, [firstTurn, secondTurn]);
    const facts = second.state.confirmedFacts.filter((fact) => fact.category === 'goal');
    const oldFact = facts.find((fact) => fact.turnId === firstTurn.id);
    const newFact = facts.find((fact) => fact.turnId === secondTurn.id);

    expect(second.state.goal.value).toMatch(/инвест|аренд/iu);
    expect(second.state.scriptProgress?.metrics.goal.value || '').toMatch(/инвест|аренд/iu);
    expect(oldFact?.lifecycleStatus).toBe('superseded');
    expect(newFact).toMatchObject({ lifecycleStatus: 'confirmed', supersedesFactId: oldFact?.id });
    expect(second.event?.type).toBe('FACT_CORRECTION');
  });

  it('supersedes investment with an explicit personal-use correction', () => {
    const firstTurn = clientTurn('goal-investment', 'Смотрю для сдачи.', 1);
    const secondTurn = clientTurn('goal-personal', 'Нет, сдавать не буду, решил оставить себе.', 2);
    const first = advanceLocalConversation(createInitialState(), firstTurn, [firstTurn]);
    const second = advanceLocalConversation(first.state, secondTurn, [firstTurn, secondTurn]);
    const facts = second.state.confirmedFacts.filter((fact) => fact.category === 'goal');
    const oldFact = facts.find((fact) => fact.turnId === firstTurn.id);
    const newFact = facts.find((fact) => fact.turnId === secondTurn.id);

    expect(second.state.goal.value).toMatch(/личн|для себя/iu);
    expect(oldFact?.lifecycleStatus).toBe('superseded');
    expect(newFact).toMatchObject({ lifecycleStatus: 'confirmed', supersedesFactId: oldFact?.id });
    expect(activeGoalFacts(second.state)).toHaveLength(1);
    expect(second.event?.type).toBe('FACT_CORRECTION');
  });

  it('does not emit a correction for a first-turn contrast', () => {
    const result = analyze('Не для себя, а под аренду.');
    expect(result.state.goal.value).toMatch(/инвест|аренд/iu);
    expect(result.event?.type).not.toBe('FACT_CORRECTION');
    expect(activeGoalFacts(result.state)[0]?.supersedesFactId).toBeNull();
  });

  it.each([
    'Покупаю для себя, но доходность тоже интересна.',
    'Жить буду сам, инвестиционная привлекательность тоже важна.',
  ])('keeps profitability context secondary to explicit personal use: %s', (text) => {
    const result = expectConfirmedGoal(text, /личн|для себя/iu);
    expect(result.state.goal.value || '').not.toMatch(/инвест|смеш/iu);
    expect(result.dopamine?.category).not.toBe('investor');
  });
});
