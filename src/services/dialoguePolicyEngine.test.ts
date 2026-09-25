import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { evaluateFirstCallScript } from './firstCallScriptEngine';
import { advanceLocalConversation } from './localAnalysisEngine';
import { chooseDialoguePolicyTarget } from './dialoguePolicyEngine';

function turn(id: string, speaker: 'agent' | 'client', text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'dialogue-policy-v1',
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

describe('Dialogue Policy Engine V1', () => {
  it('moves to property format after permanent-living goal and quiet/logistics criteria instead of past experience', () => {
    const turns = [
      turn('a1', 'agent', 'А для себя это больше про отдых, сезонное проживание или планируете жить постоянно?', 1),
      turn('c1', 'client', 'Для постоянной жизни, для себя.', 2),
      turn('a2', 'agent', 'Что по локации для вас важнее?', 3),
      turn('c2', 'client', 'Больше тишина, но чтобы не быть отрезанным от цивилизации и с нормальной логистикой.', 4),
    ];
    const state = buildState(turns);
    const decision = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);

    expect(decision?.branch).toBe('property_format');
    expect(decision?.metric).toBe('propertyType');
  });

  it('never reopens experience after the client says there is nothing to highlight', () => {
    const turns = [
      turn('a1', 'agent', 'Что из уже увиденного вам понравилось больше всего, а что точно не хотите повторять?', 1),
      turn('c1', 'client', 'Я пока не могу ничего выделить, яркого примера нет.', 2),
      turn('a2', 'agent', 'Для чего выбираете недвижимость?', 3),
      turn('c2', 'client', 'Для постоянной жизни.', 4),
    ];
    const state = buildState(turns);
    const decision = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);

    expect(decision?.metric).not.toBe('experience');
  });

  it('follows a finance turn instead of jumping to an unrelated branch', () => {
    const turns = [
      turn('a1', 'agent', 'Для чего выбираете недвижимость?', 1),
      turn('c1', 'client', 'Для постоянной жизни.', 2),
      turn('a2', 'agent', 'Что для вас важно в выборе?', 3),
      turn('c2', 'client', 'Тишина и нормальная логистика.', 4),
      turn('c3', 'client', 'По деньгам пока думаю, ипотека или свои средства.', 5),
    ];
    const state = buildState(turns);
    const decision = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);

    expect(decision?.branch).toBe('finance');
    expect(['budget', 'paymentMethod']).toContain(decision?.metric);
  });
});
