import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation } from './localAnalysisEngine';
import { classifyGoalIntent } from './semanticEvidence';

const turn = (id: string, text: string, revision: number): TranscriptTurn => ({
  id,
  sessionId: 'goal-polarity-iteration-36',
  source: 'call_audio',
  speaker: 'client',
  text,
  timestamp: revision * 1000,
  isFinal: true,
  revision,
});

function replay(texts: string[]) {
  let state = createInitialState();
  const turns: TranscriptTurn[] = [];
  let lastEvent: string | null = null;
  texts.forEach((text, index) => {
    const current = turn(`goal-36-${index + 1}`, text, index + 1);
    turns.push(current);
    const result = advanceLocalConversation(state, current, turns);
    state = result.state;
    lastEvent = result.event?.type || null;
  });
  return { state, lastEvent };
}

function activePermanentFacts(state: ConversationState) {
  return state.confirmedFacts.filter((fact) =>
    fact.category === 'goal' &&
    !['superseded', 'rejected'].includes(String(fact.lifecycleStatus)) &&
    /постоянн.*прожив|пмж/iu.test(fact.value),
  );
}

describe('FIX 36: negated permanent-residence span', () => {
  it.each([
    'Для редкого пребывания. Не для постоянного проживания.',
    'Не для постоянного проживания.',
    'Для постоянного проживания не рассматриваю.',
    'Не для ПМЖ, только приезжать отдыхать.',
    'Не для постоянного проживания, а для отдыха.',
    'Не хочу там жить постоянно.',
    'Жить там постоянно не планирую.',
    'Не собираюсь жить там постоянно, только летом приезжать.',
    'Жить там постоянно не планирую, только летом приезжать.',
    'Переезжать в Сочи не планирую, только летом приезжать.',
    'Не планирую в Сочи переезжать, только летом приезжать.',
    'Для постоянного проживания пока не рассматриваю.',
    'Для постоянного проживания я не рассматриваю.',
    'Не рассматриваю для постоянного проживания, только для отдыха.',
    'Не подходит для постоянного проживания, только для отдыха.',
    'Я не рассматриваю для постоянного проживания.',
    'Переезжать на ПМЖ не планирую.',
    'ПМЖ не для меня, только для отдыха.',
    'ПМЖ исключаю, только для отдыха.',
    'Для ПМЖ не подходит, только для отдыха.',
    'ПМЖ, не планирую, только для отдыха.',
    'ПМЖ: не планирую, только для отдыха.',
    'ПМЖ — не планирую, только для отдыха.',
    'Для постоянного проживания, не рассматриваю — только отдых.',
    'Для постоянного проживания не рассматриваю сейчас.',
    'Не для постоянного проживания, скорее приезжать несколько раз в год.',
  ])('does not turn a rejected residence span into a positive goal: %s', (text) => {
    expect(classifyGoalIntent(text).kind).not.toBe('permanent');
    const { state } = replay([text]);
    expect(state.goal.value || '').not.toMatch(/постоянн.*прожив|пмж/iu);
    expect(state.primaryGoal?.value || '').not.toMatch(/постоянн.*прожив|пмж/iu);
    expect(activePermanentFacts(state)).toHaveLength(0);
    expect(state.scriptProgress?.metrics.goal.value || '').not.toMatch(/постоянн.*прожив|пмж/iu);
  });

  it('keeps positive rental intent in a negated-residence contrast', () => {
    const text = 'Не для постоянного проживания, а для сдачи.';
    expect(classifyGoalIntent(text).kind).toBe('investment');
    const { state } = replay([text]);
    expect(state.goal.value).toMatch(/инвест/iu);
    expect(activePermanentFacts(state)).toHaveLength(0);
  });

  it('does not create a canonical goal from a negated relocation with a location adjunct', () => {
    const text = 'Переезд в Сочи не планирую.';
    expect(classifyGoalIntent(text).kind).not.toBe('permanent');
    const { state } = replay([text]);
    expect(state.goal.value).toBeNull();
    expect(activePermanentFacts(state)).toHaveLength(0);
    // The separate legacy metric fallback on raw transcript text is outside this classifier-only fix.
  });

  it.each([
    'Для постоянного проживания.',
    'Планирую жить там постоянно.',
    'Для себя, для постоянного проживания.',
    'Не только для постоянного проживания, но и для отдыха.',
    'Не хочу ипотеку, для постоянного проживания.',
    'Для постоянного проживания ипотеку не рассматриваю.',
    'Для постоянного проживания, а ипотеку не рассматриваю.',
    'Для постоянного проживания я не рассматриваю ипотеку.',
    'Для постоянного проживания пока не планирую сдавать.',
    'Ипотеку не рассматриваю для постоянного проживания.',
    'Не рассматриваю ипотеку для постоянного проживания.',
  ])('preserves a genuinely positive residence goal despite unrelated or additive negation: %s', (text) => {
    expect(classifyGoalIntent(text).kind).toBe('permanent');
    const { state } = replay([text]);
    expect(state.goal.value).toMatch(/постоянн.*прожив/iu);
    expect(activePermanentFacts(state)).toHaveLength(1);
  });

  it('does not let an earlier rejected goal negate a later positive assertion', () => {
    const { state, lastEvent } = replay([
      'Не для постоянного проживания.',
      'Теперь рассматриваю для постоянного проживания.',
    ]);
    expect(state.goal.value).toMatch(/постоянн.*прожив/iu);
    expect(activePermanentFacts(state)).toHaveLength(1);
    expect(lastEvent).not.toBe('FACT_CORRECTION');
  });

  it('uses the corrected positive residence span later in the same turn', () => {
    const text = 'Не для постоянного проживания. Нет, оговорился: для постоянного проживания.';
    expect(classifyGoalIntent(text).kind).toBe('permanent');
    expect(replay([text]).state.goal.value).toMatch(/постоянн.*прожив/iu);
  });

  it('lets a later explicit rejection correct a positive residence span in the same turn', () => {
    const text = 'Для постоянного проживания. Нет, оговорился: не для постоянного проживания.';
    expect(classifyGoalIntent(text).kind).not.toBe('permanent');
    expect(activePermanentFacts(replay([text]).state)).toHaveLength(0);
  });

  it('does not let a later unrelated negation erase a confirmed residence goal', () => {
    const { state } = replay([
      'Для постоянного проживания.',
      'Ипотеку не рассматриваю.',
    ]);
    expect(state.goal.value).toMatch(/постоянн.*прожив/iu);
    expect(activePermanentFacts(state)).toHaveLength(1);
  });
});
