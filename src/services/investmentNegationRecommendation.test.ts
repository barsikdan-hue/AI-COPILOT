import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { getContextualDopamineQuestion } from './dopamineQuestionEngine';
import { chooseDialoguePolicyTarget } from './dialoguePolicyEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

const narrowInvestmentRecommendation =
  /какой\s+результат\s+от\s+инвестиц|доход,\s*рост\s+капитала\s+или\s+ликвидност|если\s+смотреть\s+как\s+на\s+инвест/iu;

function analyze(text: string) {
  const turn: TranscriptTurn = {
    id: 'investment-intent',
    sessionId: 'investment-negation',
    source: 'call_audio',
    speaker: 'client',
    text,
    timestamp: 1000,
    isFinal: true,
    revision: 1,
  };
  const state = advanceLocalConversation(createInitialState(), turn, [turn]).state;
  const policy = chooseDialoguePolicyTarget(state, [turn], state.scriptProgress);
  const dopamine = getContextualDopamineQuestion(state, [turn], text);
  const response = buildLocalAnalysisResponse({
    sessionId: turn.sessionId,
    revision: 1,
    newTurns: [turn],
    recentTurns: [turn],
    currentState: state,
  });
  return { state, policy, dopamine, response };
}

const expectNoInvestmentRecommendation = (result: ReturnType<typeof analyze>) => {
  expect(result.dopamine?.category).not.toBe('investor');
  expect(result.response.suggestedReply || '').not.toMatch(narrowInvestmentRecommendation);
};

describe('negation-safe investment recommendation', () => {
  it('uses the real open policy branch for negated investment plus self-use', () => {
    const result = analyze('Не для инвестиций, хочу жить сам.');

    expect(result.state.goal).toMatchObject({
      value: 'Для себя (формат уточняется)',
      needsClarification: true,
    });
    expect(result.state.primaryGoal?.value).toBe('Для себя (формат уточняется)');
    expect(result.policy?.semanticKey).toBe('ask_search_experience');
    expect(result.response.candidateRuleId).toBe('dialogue_policy_orientation_ask_search_experience');
    expectNoInvestmentRecommendation(result);
  });

  it.each([
    'Инвестиции не рассматриваю.',
    'Мне инвестиции не интересны.',
  ])('does not activate investment from explicit rejection: %s', (text) => {
    const result = analyze(text);

    expect(result.state.goal.value).toBeNull();
    expect(result.state.scriptProgress?.metrics.goal.status).not.toBe('confirmed');
    expectNoInvestmentRecommendation(result);
  });

  it('does not activate rental or investment from negated rental intent', () => {
    const result = analyze('Не хочу сдавать, беру для себя.');

    expect(result.state.goal.value).toBe('Для себя (формат уточняется)');
    expectNoInvestmentRecommendation(result);
  });

  it.each([
    'Хочу именно для инвестиций.',
    'Рассматриваю как инвестицию, нужен пассивный доход.',
  ])('keeps legitimate investment recommendations active: %s', (text) => {
    const result = analyze(text);

    expect(result.state.goal.value).toMatch(/инвест/iu);
    expect(result.state.scriptProgress?.metrics.goal.status).toBe('confirmed');
    expect(result.dopamine?.category).toBe('investor');
    expect(result.response.suggestedReply || '').toMatch(narrowInvestmentRecommendation);
  });

  it('keeps self-use versus investment uncertainty unresolved', () => {
    const result = analyze('Пока не решил: для себя или как инвестицию.');

    expect(result.state.goal.value).toBeNull();
    expect(result.state.primaryGoal?.value).toBeNull();
    expect(result.state.scriptProgress?.metrics.goal).toMatchObject({
      status: 'needs_clarification',
      needsClarification: true,
    });
    expectNoInvestmentRecommendation(result);
  });

  it('preserves mixed investment plus personal-use semantics', () => {
    const result = analyze('Не только для инвестиций: иногда хочу жить сам.');

    expect(result.state.goal.value).toMatch(/инвест.*личн.*использ/iu);
    expect(result.state.primaryGoal?.value).toMatch(/инвест/iu);
    expect(result.state.secondaryUse?.value).toMatch(/личн.*приезд|отдых/iu);
    expect(result.state.scriptProgress?.metrics.goal.status).toBe('confirmed');
    expect(result.dopamine?.category).toBe('investor');
  });

  it('keeps rejected investment separate from yield comparison interest', () => {
    const result = analyze('Для инвестиций не хочу, но доходность всё равно интересно сравнить.');

    expect(result.state.goal.value).toBeNull();
    expect(result.state.scriptProgress?.metrics.goal.status).not.toBe('confirmed');
    expectNoInvestmentRecommendation(result);
  });
});
