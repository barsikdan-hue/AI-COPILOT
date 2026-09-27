import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { chooseDialoguePolicyTarget } from './dialoguePolicyEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

const clientTurn = (text: string, id = 'client-goal'): TranscriptTurn => ({
  id,
  sessionId: 'personal-living-goal',
  source: 'call_audio',
  speaker: 'client',
  text,
  timestamp: 1000,
  isFinal: true,
  revision: 1,
});

function analyze(text: string) {
  const turn = clientTurn(text);
  const advanced = advanceLocalConversation(createInitialState(), turn, [turn]);
  const state: ConversationState = advanced.state;
  const policy = chooseDialoguePolicyTarget(state, [turn], state.scriptProgress);
  const response = buildLocalAnalysisResponse({
    sessionId: turn.sessionId,
    revision: turn.revision ?? 1,
    newTurns: [turn],
    recentTurns: [turn],
    currentState: state,
  });
  const currentGoalFacts = (state.confirmedFacts || []).filter(
    (fact) =>
      ['goal', 'goal_primary', 'goal_secondary'].includes(fact.category) &&
      !['superseded', 'rejected'].includes(String(fact.lifecycleStatus)),
  );
  return { turn, state, policy, response, currentGoalFacts };
}

const expectConfirmedSelfUse = (result: ReturnType<typeof analyze>) => {
  expect(result.state.goal).toMatchObject({
    value: 'Для себя (личное использование)',
  });
  expect(result.state.primaryGoal).toMatchObject({
    value: 'Для себя (личное использование)',
  });
  expect(result.state.goal.needsClarification).not.toBe(true);
  expect(result.state.primaryGoal?.needsClarification).not.toBe(true);
  expect(result.currentGoalFacts).toEqual(expect.arrayContaining([
    expect.objectContaining({
      category: 'goal',
      value: 'Для себя (личное использование)',
      lifecycleStatus: 'confirmed',
    }),
    expect.objectContaining({
      category: 'goal_primary',
      value: 'Для себя (личное использование)',
      lifecycleStatus: 'confirmed',
    }),
  ]));
  expect(result.state.scriptProgress?.metrics.goal).toMatchObject({
    status: 'confirmed',
    needsClarification: false,
  });
  expect(result.state.scriptProgress?.metrics.goal.value || '').not.toMatch(/постоянн.*прожив|переезд/iu);
  expect(result.policy?.semanticKey).not.toBe('ask_goal');
};

const expectPermanentLiving = (result: ReturnType<typeof analyze>) => {
  expect(result.state.goal).toMatchObject({
    value: 'Постоянное личное проживание',
  });
  expect(result.state.goal.needsClarification).not.toBe(true);
  expect(result.state.primaryGoal).toMatchObject({
    value: 'Постоянное личное проживание',
  });
  expect(result.state.primaryGoal?.needsClarification).not.toBe(true);
  expect(result.currentGoalFacts).toEqual(expect.arrayContaining([
    expect.objectContaining({ category: 'goal', value: 'Постоянное личное проживание', lifecycleStatus: 'confirmed' }),
    expect.objectContaining({ category: 'goal_primary', value: 'Постоянное личное проживание', lifecycleStatus: 'confirmed' }),
  ]));
  expect(result.state.scriptProgress?.metrics.goal).toMatchObject({
    status: 'confirmed',
    value: expect.stringMatching(/постоян|переезд/iu),
    needsClarification: false,
  });
  expect(result.policy?.semanticKey).not.toBe('ask_goal');
};

describe('self-use versus permanent residence regression', () => {
  it.each([
    'Хочу жить сам.',
    'Хочу сам там жить.',
    'Покупаю для себя, буду там жить.',
  ])('confirms self-use without strengthening it to permanent residence: %s', (text) => {
    const result = analyze(text);
    expectConfirmedSelfUse(result);
  });

  it('keeps self-use separate from negated investment', () => {
    const result = analyze('Не для инвестиций, хочу жить сам.');

    expectConfirmedSelfUse(result);
    expect(result.currentGoalFacts.map((fact) => fact.value).join(' ')).not.toMatch(/инвест/iu);
    expect(result.state.scriptProgress?.metrics.goal.value || '').not.toMatch(/инвест/iu);
  });

  it.each([
    'Планирую переехать и жить постоянно.',
    'Буду жить сам постоянно.',
  ])('confirms permanent residence only from explicit permanent evidence: %s', (text) => {
    expectPermanentLiving(analyze(text));
  });

  it('does not collapse time-limited self-use into permanent residence', () => {
    const result = analyze('Буду жить сам пару месяцев в году.');

    expect(result.state.goal.value || '').not.toMatch(/постоянн.*прожив/iu);
    expect(result.state.primaryGoal?.value || '').not.toMatch(/постоянн.*прожив/iu);
    expect(result.state.scriptProgress?.metrics.goal.value || '').not.toMatch(/постоянн.*прожив|переезд/iu);
  });

  it('does not collapse summer visits into permanent residence', () => {
    const result = analyze('Для себя, приезжать на лето.');

    expect(result.state.goal.value || '').not.toMatch(/постоянн.*прожив/iu);
    expect(result.state.primaryGoal?.value || '').not.toMatch(/постоянн.*прожив/iu);
    expect(result.state.scriptProgress?.metrics.goal.value || '').not.toMatch(/постоянн.*прожив|переезд/iu);
  });

  it('does not create self-use or permanent residence from negated living', () => {
    const result = analyze('Сам там жить не буду, хочу сдавать.');
    const currentValues = result.currentGoalFacts.map((fact) => fact.value).join(' ');

    expect(result.state.goal.value || '').not.toMatch(/для себя|личн.*прожив|постоянн.*прожив/iu);
    expect(currentValues).not.toMatch(/для себя|личн.*прожив|постоянн.*прожив/iu);
  });

  it('keeps self-use versus rental uncertainty unconfirmed', () => {
    const result = analyze('Пока не знаю, жить самому или сдавать.');

    expect(result.state.goal.value).toBeNull();
    expect(result.state.primaryGoal?.value).toBeNull();
    expect(result.state.scriptProgress?.metrics.goal.status).not.toBe('confirmed');
  });
});
