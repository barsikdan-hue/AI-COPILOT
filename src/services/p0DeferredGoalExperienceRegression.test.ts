import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
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
    sessionId: 'session_1790409677863_ntfi',
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

describe('P0 deferred goal should route through real search experience', () => {
  const turns = [
    turn('a1', 'agent', 'Доброе утро, меня зовут Данил, специалист по недвижимости компании Элитный Сочи. Как я могу к вам обращаться?', 1),
    turn('c1', 'client', 'Добрый, меня Алексей.', 2),
    turn('a2', 'agent', 'Алексей, очень приятно.', 3),
    turn('a3', 'agent', 'На каком сейчас этапе? Присматриваетесь или уже ездите смотреть конкретные объекты?', 4),
    turn('c2', 'client', 'Да пока только присматриваюсь.', 5),
    turn('a4', 'agent', 'Что изменилось сейчас, что тема недвижимости стала для вас актуальнее?', 6),
    turn('c3', 'client', 'Да просто хочется понять, на что вообще сейчас могу рассчитывать.', 7),
    turn('a5', 'agent', 'Понял вас. Чтобы сориентироваться по рынку, подскажите, рассматриваете покупку для отдыха, сезонных визитов или планируете переезд для постоянного проживания?', 8),
    turn('c4', 'client', 'Нет, пока ещё не решил, просто смотрю.', 9),
  ];

  it('does not treat passive orientation as completed past-experience discovery', () => {
    const state = buildState(turns);
    const decision = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);

    expect(state.searchExperience?.value).toBeTruthy();
    expect(state.goal?.value).toMatch(/не определ/iu);
    expect(decision?.branch).toBe('experience');
    expect(decision?.semanticKey).toBe('ask_experience');
    expect(decision?.metric).toBe('experience');
  });

  it('shows a viewed-options / likes-dislikes question before abstract criteria', () => {
    const state = buildState(turns);
    const latest = turns.at(-1)!;
    const response = buildLocalAnalysisResponse({
      sessionId: latest.sessionId,
      revision: latest.revision || turns.length,
      newTurns: [latest],
      recentTurns: turns,
      currentState: state,
    });

    expect(response.candidateRuleId).toBe('dialogue_policy_experience_ask_experience');
    expect(response.closesMetric).toBe('experience');
    expect(response.suggestedReply || '').toMatch(/смотрел|увиденн|просмотр|вариант/iu);
    expect(response.suggestedReply || '').not.toMatch(/два обязательных критерия|без чего вариант сразу отпад/iu);
  });
});
