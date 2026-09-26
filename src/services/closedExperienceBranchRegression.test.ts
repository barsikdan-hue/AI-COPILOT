import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { chooseDialoguePolicyTarget } from './dialoguePolicyEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

const turn = (
  id: string,
  speaker: 'agent' | 'client',
  text: string,
  revision: number,
): TranscriptTurn => ({
  id,
  sessionId: 'closed-experience-branch',
  source: speaker === 'agent' ? 'microphone' : 'call_audio',
  speaker,
  text,
  timestamp: revision * 1000,
  isFinal: true,
  revision,
});

function replay(dialogue: TranscriptTurn[]) {
  let state: ConversationState = createInitialState();
  for (let index = 0; index < dialogue.length; index += 1) {
    state = advanceLocalConversation(state, dialogue[index], dialogue.slice(0, index + 1)).state;
  }
  const latest = dialogue.at(-1)!;
  const policy = chooseDialoguePolicyTarget(state, dialogue, state.scriptProgress);
  const analysis = buildLocalAnalysisResponse({
    sessionId: latest.sessionId,
    revision: latest.revision ?? dialogue.length,
    newTurns: [latest],
    recentTurns: dialogue,
    currentState: state,
  });
  return { state, policy, analysis };
}

const expectNoRepeatedExperienceQuestion = (result: ReturnType<typeof replay>) => {
  expect(result.policy?.semanticKey).not.toBe('ask_experience');
  expect(result.policy?.semanticKey).not.toBe('ask_search_experience');
  expect(result.analysis.candidateRuleId || '').not.toMatch(/ask_(?:search_)?experience/iu);
  expect(result.analysis.suggestedReply || '').not.toMatch(/что\s+уже\s+смотрел|какие\s+варианты\s+смотрел|ездили\s+смотреть|на\s+каком[^?]{0,30}этапе/iu);
};

describe('closed experience branch regression', () => {
  it('closes the branch after a direct no-viewings answer and selects another open target', () => {
    const result = replay([
      turn('a1', 'agent', 'Что уже успели посмотреть?', 1),
      turn('c1', 'client', 'Пока ничего конкретного не смотрел.', 2),
    ]);

    expect(result.state.scriptProgress?.metrics.experience.status).toBe('not_applicable');
    expectNoRepeatedExperienceQuestion(result);
    expect(result.analysis.suggestedReply).toBeTruthy();
  });

  it('uses an early search-stage answer without asking about viewed objects again', () => {
    const result = replay([
      turn('c1', 'client', 'Только начал смотреть рынок, конкретных объектов ещё не смотрел.', 1),
    ]);

    expect(result.state.searchExperience?.value).toMatch(/рынок|процесс\s+выбора/iu);
    expectNoRepeatedExperienceQuestion(result);
  });

  it('keeps positive viewing experience available for a legitimate next step', () => {
    const result = replay([
      turn('c1', 'client', 'Смотрел пару вариантов, но ничего не понравилось.', 1),
    ]);

    expect(result.state.searchExperience?.value).toMatch(/просмотр|сравнен/iu);
    expect(result.state.scriptProgress?.metrics.experience.status).toBe('confirmed');
    expectNoRepeatedExperienceQuestion(result);
  });

  it('preserves online versus in-person experience without repeating orientation', () => {
    const result = replay([
      turn('c1', 'client', 'В интернете смотрел, вживую ещё нет.', 1),
    ]);

    expect(result.state.searchExperience?.value).toMatch(/онлайн|очн/iu);
    expect(result.state.scriptProgress?.metrics.experience.status).toBe('confirmed');
    expectNoRepeatedExperienceQuestion(result);
  });

  it('allows a later voluntary experience fact to replace the closed-empty state', () => {
    const first = replay([
      turn('a1', 'agent', 'Что уже успели посмотреть?', 1),
      turn('c1', 'client', 'Ничего не смотрел.', 2),
    ]);
    expect(first.state.scriptProgress?.metrics.experience.status).toBe('not_applicable');

    const updated = replay([
      turn('a1', 'agent', 'Что уже успели посмотреть?', 1),
      turn('c1', 'client', 'Ничего не смотрел.', 2),
      turn('c2', 'client', 'Кстати, вчера увидел один вариант в Сириусе.', 3),
    ]);
    expect(updated.state.searchExperience?.value).toMatch(/просмотр|сравнен/iu);
    expect(updated.state.scriptProgress?.metrics.experience.status).toBe('confirmed');
    expect(updated.state.searchExperience?.evidenceTurnIds).toContain('c2');
    expectNoRepeatedExperienceQuestion(updated);
  });

  it('falls through to the normal priority of another open block without hardcoding it', () => {
    const result = replay([
      turn('a1', 'agent', 'Для чего выбираете недвижимость?', 1),
      turn('c1', 'client', 'Для постоянной жизни.', 2),
      turn('a2', 'agent', 'Что уже успели посмотреть?', 3),
      turn('c2', 'client', 'Пока ничего конкретного не смотрел.', 4),
    ]);

    expect(result.state.scriptProgress?.metrics.experience.status).toBe('not_applicable');
    expect(result.analysis.suggestedReply).toBeTruthy();
    expectNoRepeatedExperienceQuestion(result);
  });
});
