import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { getContextualDopamineQuestion } from './dopamineQuestionEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

function turn(id: string, speaker: 'agent' | 'client', text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'dopamine-context',
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

describe('dopamine Sochi context regression', () => {
  it('does not treat a bare Sochi search mention as permission for tourism rapport', () => {
    const turns = [
      turn('a1', 'agent', 'Сергей, очень приятно.', 1),
      turn('c1', 'client', 'Периодически подглядываю на Сочи, пока не спешу, просто смотрю.', 2),
    ];
    const state = buildState(turns);

    expect(getContextualDopamineQuestion(state, turns, turns[1].text)).toBeNull();
  });

  it('allows a Sochi rapport question when the client actually opens personal experience', () => {
    const turns = [
      turn('c1', 'client', 'Был в Сочи прошлым летом, понравился ритм города и район у моря.', 1),
    ];
    const state = buildState(turns);
    const suggestion = getContextualDopamineQuestion(state, turns, turns[0].text);

    expect(suggestion?.category).toBe('sochi');
    expect(suggestion?.text).toBeTruthy();
  });

  it('closes the nostalgia branch when the client says the old trip is not remembered', () => {
    const turns = [
      turn('c1', 'client', 'Был в Сочи лет десять назад.', 1),
      turn('a1', 'agent', 'Что тогда запомнилось больше всего?', 2),
      turn('c2', 'client', 'Честно, не помню, давно было, сейчас ничего не вспомню.', 3),
    ];
    const state = buildState(turns);

    expect(getContextualDopamineQuestion(state, turns, turns[2].text)).toBeNull();
  });

  it('keeps the early live call on buying-task discovery instead of asking about old Sochi memories', () => {
    const turns = [
      turn('a1', 'agent', 'Добрый день. Как я могу к вам обращаться?', 1),
      turn('c1', 'client', 'Сергей.', 2),
      turn('a2', 'agent', 'Сергей, очень приятно.', 3),
      turn('c2', 'client', 'Периодически подглядываю на Сочи, пока не спешу, просто смотрю.', 4),
    ];
    const state = buildState(turns);
    const result = buildLocalAnalysisResponse({
      sessionId: 'dopamine-context',
      revision: 4,
      newTurns: [turns[3]],
      recentTurns: turns,
      currentState: state,
    });

    expect(result.suggestedReply).not.toMatch(/когда\s+вы\s+были\s+в\s+сочи|что\s+запомнилось|в\s+каких\s+районах.*побывать/iu);
    expect(result.suggestedReply).toMatch(/сейчас|именно сейчас|подтолкнул|актуальн|задач/iu);
  });
});
