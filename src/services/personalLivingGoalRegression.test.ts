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
  const activeGoalFacts = (state.confirmedFacts || []).filter(
    (fact) =>
      ['goal', 'goal_primary', 'goal_secondary'].includes(fact.category) &&
      fact.lifecycleStatus === 'confirmed',
  );
  return { state, policy, response, activeGoalFacts };
}

const expectConfirmedPersonalLiving = (result: ReturnType<typeof analyze>) => {
  expect(result.state.goal.value).toMatch(/личн.*прожив/iu);
  expect(result.state.primaryGoal?.value).toMatch(/личн.*прожив/iu);
  expect(result.state.goal.value).toBe(result.state.primaryGoal?.value);
  expect(result.activeGoalFacts).toEqual(expect.arrayContaining([
    expect.objectContaining({ category: 'goal', value: expect.stringMatching(/личн.*прожив/iu) }),
    expect.objectContaining({ category: 'goal_primary', value: expect.stringMatching(/личн.*прожив/iu) }),
  ]));
  expect(result.state.scriptProgress?.metrics.goal).toMatchObject({
    status: 'confirmed',
    value: expect.stringMatching(/прожив/iu),
  });
  expect(result.policy?.semanticKey).not.toBe('ask_goal');
  expect(result.response.candidateRuleId || '').not.toMatch(/ask_goal/iu);
};

describe('personal living goal regression', () => {
  it('keeps positive personal living separate from negated investment', () => {
    const result = analyze('Не для инвестиций, хочу жить сам.');

    expectConfirmedPersonalLiving(result);
    expect(result.activeGoalFacts.map((fact) => fact.value).join(' ')).not.toMatch(/инвест/iu);
    expect(result.state.scriptProgress?.metrics.goal.value).not.toMatch(/инвест/iu);
  });

  it.each([
    'Хочу сам там жить.',
    'Покупаю для себя, буду там жить.',
  ])('recognizes explicit self-living intent: %s', (text) => {
    expectConfirmedPersonalLiving(analyze(text));
  });

  it('does not turn negated self-living into a positive living goal', () => {
    const result = analyze('Сам там жить не буду, хочу сдавать.');

    expect(result.state.goal.value || '').not.toMatch(/личн.*прожив|постоянн.*прожив/iu);
    expect(result.activeGoalFacts.map((fact) => fact.value).join(' ')).not.toMatch(/личн.*прожив|постоянн.*прожив/iu);
  });

  it('preserves vacation semantics when permanent living is rejected', () => {
    const result = analyze('Не хочу там жить постоянно, только приезжать на отдых.');

    expect(result.state.goal.value).toMatch(/отдых|сезон/iu);
    expect(result.state.goal.value).not.toMatch(/постоянн.*прожив/iu);
    expect(result.state.scriptProgress?.metrics.goal.value).toMatch(/отдых|сезон/iu);
  });

  it('does not collapse time-limited living plus rental into permanent personal living', () => {
    const result = analyze('Буду жить там пару месяцев в году и остальное время сдавать.');

    expect(result.state.goal.value || '').not.toMatch(/^постоянное личное проживание$/iu);
    expect(result.state.scriptProgress?.metrics.goal.value || '').not.toMatch(/^постоянное проживание/u);
  });

  it('does not assign third-party living to the client', () => {
    const result = analyze('Квартиру беру маме, жить будет она.');

    expect(result.state.goal.value || '').not.toMatch(/личн.*прожив|постоянн.*прожив/iu);
    expect(result.activeGoalFacts.map((fact) => fact.value).join(' ')).not.toMatch(/личн.*прожив|постоянн.*прожив/iu);
  });

  it('keeps self-living versus rental uncertainty unconfirmed', () => {
    const result = analyze('Пока не знаю, жить самому или сдавать.');

    expect(result.state.goal.value).toBeNull();
    expect(result.state.primaryGoal?.value).toBeNull();
    expect(result.state.scriptProgress?.metrics.goal.status).not.toBe('confirmed');
  });
});
