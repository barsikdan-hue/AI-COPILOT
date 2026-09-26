import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { classifyAgentAction, createInitialSpinState, evaluateSpinAndHpb } from './spinEngine';

function turn(
  id: string,
  speaker: 'agent' | 'client',
  text: string,
  revision: number,
): TranscriptTurn {
  return {
    id,
    sessionId: 'session_1790408417210_7w9s',
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
  return state;
}

describe('P0 why-now must not become SPIN Need-Payoff', () => {
  const whyNow = 'Что изменилось сейчас, что тема недвижимости стала для вас актуальнее?';
  const clientAnswer = 'Да просто хочется понять, на что вообще сейчас могу рассчитывать.';

  it('classifies why-now as a dialogue micro-goal, not a Need-Payoff question', () => {
    expect(classifyAgentAction(whyNow)).toBe('none');

    const client = turn('c1', 'client', clientAnswer, 2);
    const spin = evaluateSpinAndHpb(
      client,
      createInitialSpinState(),
      classifyAgentAction(whyNow),
      whyNow,
      createInitialState(),
    );

    expect(spin.suggestionMode).not.toBe('HPB_PRESENTATION');
    expect(spin.updatedSpin.needPayoff).toHaveLength(0);
  });

  it('does not show the premature 2-3 options comparison card on the live-call path', () => {
    const turns = [
      turn('a1', 'agent', 'Очень приятно. А на каком вы сейчас этапе? Присматриваетесь или уже ездите, смотрите конкретные объекты?', 1),
      turn('c1', 'client', 'Пока только присматриваюсь.', 2),
      turn('a2', 'agent', whyNow, 3),
      turn('c2', 'client', clientAnswer, 4),
    ];

    const state = buildState(turns);
    expect(state.spin.needPayoff).toHaveLength(0);
    expect(state.spinState?.needPayoff || []).toHaveLength(0);

    const latest = turns.at(-1)!;
    const response = buildLocalAnalysisResponse({
      sessionId: latest.sessionId,
      revision: latest.revision || turns.length,
      newTurns: [latest],
      recentTurns: turns,
      currentState: state,
    });

    expect(response.suggestionMode).not.toBe('HPB_PRESENTATION');
    expect(response.actionType).not.toBe('SHOW_EVIDENCE');
    expect(response.suggestedReply || '').not.toMatch(/сравним\s+2[–-]3\s+вариант|подтвержденн\p{L}*\s+критери/iu);
  });
});
