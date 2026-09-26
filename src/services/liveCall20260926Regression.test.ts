import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { detectConversationEvent } from './conversationEventEngine';
import { evaluateFirstCallScript } from './firstCallScriptEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { chooseDialoguePolicyTarget } from './dialoguePolicyEngine';

function turn(id: string, speaker: 'agent' | 'client', text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'live-2026-09-26',
    source: speaker === 'agent' ? 'microphone' : 'call_audio',
    speaker,
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

function buildState(turns: TranscriptTurn[]) {
  let state = createInitialState();
  for (let i = 0; i < turns.length; i += 1) {
    state = advanceLocalConversation(state, turns[i], turns.slice(0, i + 1)).state;
  }
  const progress = evaluateFirstCallScript(turns, state);
  return { ...state, scriptProgress: progress };
}

function analyze(turns: TranscriptTurn[]) {
  const state = buildState(turns);
  const latest = turns.at(-1)!;
  return buildLocalAnalysisResponse({
    sessionId: latest.sessionId,
    revision: latest.revision || turns.length,
    newTurns: [latest],
    recentTurns: turns.slice(-10),
    currentState: state,
  });
}

describe('2026-09-26 live-call routing regression', () => {
  it('does not misread an affordability answer as a DIRECT_QUESTION', () => {
    const turns = [
      turn('a1', 'agent', 'Рынок Сочи давно отслеживаете или интерес появился недавно?', 1),
      turn('c1', 'client', 'Да пока только начал присматриваться.', 2),
      turn('a2', 'agent', 'А какую задачу хочется решить покупкой именно на этом этапе?', 3),
    ];
    const state = buildState(turns);
    const client = turn('c2', 'client', 'Хочу понять вообще, что могу себе позволить на данный момент.', 4);
    const event = detectConversationEvent(client, [...turns, client], state);

    expect(event?.type).not.toBe('DIRECT_QUESTION');
  });

  it('routes affordability intent directly to budget instead of a generic clarification', () => {
    const result = analyze([
      turn('a1', 'agent', 'Рынок Сочи давно отслеживаете или интерес появился недавно?', 1),
      turn('c1', 'client', 'Да пока только начал присматриваться.', 2),
      turn('a2', 'agent', 'А какую задачу хочется решить покупкой именно на этом этапе?', 3),
      turn('c2', 'client', 'Хочу понять вообще, что могу себе позволить на данный момент.', 4),
    ]);

    expect(result.eventType).not.toBe('DIRECT_QUESTION');
    expect(result.candidateRuleId).toContain('dialogue_policy_finance_ask_budget');
    expect(result.closesMetric).toBe('budget');
    expect(result.suggestedReply).toMatch(/бюджет|максимум|сумм|диапазон/iu);
  });

  it('does not count the why-now wording as the actual Goal question', () => {
    const turns = [
      turn('a1', 'agent', 'Рынок Сочи давно отслеживаете или интерес появился недавно?', 1),
      turn('c1', 'client', 'Да пока только начал присматриваться.', 2),
      turn('a2', 'agent', 'А какую задачу хочется решить покупкой именно на этом этапе?', 3),
      turn('c2', 'client', 'Хочу понять вообще, что могу себе позволить на данный момент.', 4),
      turn('a3', 'agent', 'Уточните, пожалуйста, какой именно момент вы хотите сейчас прояснить?', 5),
      turn('c3', 'client', 'Интересуют цены, локация, формат сделки, вот чтобы без головной боли.', 6),
      turn('a4', 'agent', 'А какой максимум по покупке имеет смысл рассматривать, если вариант действительно сильный?', 7),
      turn('c4', 'client', 'Ну в районе, наверное, 15-25 млн.', 8),
    ];
    const state = buildState(turns);
    const decision = chooseDialoguePolicyTarget(state, turns.slice(-10), state.scriptProgress);

    expect(state.goal.value).toBeNull();
    expect(decision?.semanticKey).toBe('ask_goal');
    expect(decision?.metric).toBe('goal');
    expect(decision?.semanticKey).not.toBe('ask_experience');
  });

  it('treats "Пока конкретные не смотрел" as no concrete viewing history', () => {
    const turns = [
      turn('a1', 'agent', 'Какие варианты уже успели посмотреть и где был главный компромисс?', 1),
      turn('c1', 'client', 'Пока конкретные не смотрел.', 2),
      turn('a2', 'agent', 'Какой бюджет рассматриваете?', 3),
      turn('c2', 'client', 'До 20 млн.', 4),
    ];
    const state = buildState(turns);
    const decision = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);

    expect(decision?.semanticKey).not.toBe('ask_experience');
  });
});
