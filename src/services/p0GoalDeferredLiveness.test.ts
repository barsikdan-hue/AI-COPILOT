import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { evaluateFirstCallScript } from './firstCallScriptEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { chooseDialoguePolicyTarget } from './dialoguePolicyEngine';

function turn(
  id: string,
  speaker: 'agent' | 'client',
  text: string,
  revision: number,
): TranscriptTurn {
  return {
    id,
    sessionId: 'session_1790407189471_qw7x',
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

describe('P0 goal-deferred recommendation liveness', () => {
  it('does not repeat Goal or go silent after client says they have not decided the use case yet', () => {
    const turns = [
      turn('a1', 'agent', 'А вы уже сравниваете конкретные варианты в Сочи или пока просто изучаете рынок?', 1),
      turn('c1', 'client', 'Да пока только присматриваюсь.', 2),
      turn('a2', 'agent', 'А почему к вопросу покупки решили вернуться именно сейчас?', 3),
      turn('c2', 'client', 'Хочу понять вообще, что я могу себе позволить на данный момент.', 4),
      turn('a3', 'agent', 'По сумме какой ориентир держим и выше какой границы точно не идём?', 5),
      turn('c3', 'client', 'Ну, в районе 15-25 миллионов.', 6),
      turn(
        'a4',
        'agent',
        'Понял вас. Чтобы сориентироваться по рынку, подскажите, рассматриваете покупку для отдыха, сезонных визитов или планируете переезд для постоянного проживания?',
        7,
      ),
      turn('c4', 'client', 'Пока ещё не решил, просто смотрю.', 8),
    ];

    const state = buildState(turns);
    const decision = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);

    expect(state.goal.value).toBeNull();
    expect(decision).not.toBeNull();
    expect(decision?.semanticKey).not.toBe('ask_goal');
    expect(decision?.branch).toBe('experience');
    expect(decision?.metric).toBe('experience');

    const latest = turns.at(-1)!;
    const response = buildLocalAnalysisResponse({
      sessionId: latest.sessionId,
      revision: latest.revision || turns.length,
      newTurns: [latest],
      recentTurns: turns,
      currentState: state,
    });

    expect(response.shouldSuggest).toBe(true);
    expect(response.suggestedReply).toBeTruthy();
    expect(response.closesMetric).toBe('experience');
    expect(response.candidateRuleId).toContain('dialogue_policy_experience_ask_experience');
    expect(response.suggestedReply || '').not.toMatch(/два обязательных критерия|без чего вариант сразу отпад/iu);
  });
});
