import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { chooseDialoguePolicyTarget } from './dialoguePolicyEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

const makeTurn = (
  sessionId: string,
  id: string,
  speaker: 'agent' | 'client',
  text: string,
  revision: number,
): TranscriptTurn => ({
  id,
  sessionId,
  source: speaker === 'agent' ? 'microphone' : 'call_audio',
  speaker,
  text,
  timestamp: revision * 1000,
  isFinal: true,
  revision,
});

function replay(sessionId: string, dialogue: Array<[speaker: 'agent' | 'client', text: string]>) {
  const turns = dialogue.map(([speaker, text], index) =>
    makeTurn(sessionId, `${speaker[0]}${index + 1}`, speaker, text, index + 1));
  let state: ConversationState = createInitialState();
  for (let index = 0; index < turns.length; index += 1) {
    state = advanceLocalConversation(state, turns[index], turns.slice(0, index + 1)).state;
  }
  const latest = turns.at(-1)!;
  const analysis = buildLocalAnalysisResponse({
    sessionId,
    revision: latest.revision ?? turns.length,
    newTurns: [latest],
    recentTurns: turns,
    currentState: state,
  });
  const policy = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);
  return { state, analysis, policy };
}

const expectClosedExperience = (question: string, answer: string) => {
  const result = replay(`fix-24-${question}-${answer}`, [
    ['agent', question],
    ['client', answer],
  ]);
  const metric = result.state.scriptProgress?.metrics.experience;

  expect(metric?.status, `${question} -> ${answer}`).toBe('not_applicable');
  expect(metric?.evidenceQuote, `${question} -> ${answer}`).toBe(answer);
  expect(result.policy?.semanticKey || '', `${question} -> ${answer}`).not.toMatch(/ask_(?:search_)?experience/iu);
  expect(result.analysis.candidateRuleId || '', `${question} -> ${answer}`).not.toMatch(/ask_(?:search_)?experience/iu);
  expect(result.analysis.suggestedReply || '', `${question} -> ${answer}`).not.toMatch(/что.*смотрел|какие.*вариант|ездили.*смотр/iu);
  return result;
};

describe('FIX 24 contextual no-experience branch closure', () => {
  it('closes the branch for short empty answers only after an experience question', () => {
    for (const [question, answer] of [
      ['Что уже смотрели?', 'Ничего.'],
      ['Уже успели что-нибудь посмотреть?', 'Пока нет.'],
      ['Смотрели уже какие-то объекты?', 'Нет, ещё не успел.'],
      ['Что из объектов успели посмотреть?', 'Ещё ничего.'],
    ] as const) {
      expectClosedExperience(question, answer);
    }
  });

  it('recognizes natural no-viewing variants in the same narrow context', () => {
    for (const [question, answer] of [
      ['Какие варианты уже сравнили?', 'Нет, только начал искать.'],
      ['На просмотры уже ездили?', 'Пока только изучаю рынок.'],
      ['Что понравилось из просмотренного?', 'До просмотров ещё не дошёл.'],
      ['Что уже смотрели?', 'Пока ничего не видел.'],
    ] as const) {
      expectClosedExperience(question, answer);
    }
  });

  it('does not mutate experience for identical short answers to unrelated questions', () => {
    for (const [question, answer] of [
      ['Ипотека нужна?', 'Нет.'],
      ['В Сочи давно?', 'Пока нет.'],
      ['Планировки посмотрели?', 'Нет.'],
      ['Какой район исключаете?', 'Ничего.'],
    ] as const) {
      const result = replay(`fix-24-control-${question}`, [
        ['agent', question],
        ['client', answer],
      ]);
      expect(result.state.searchExperience, `${question} -> ${answer}`).toBeUndefined();
      expect(result.state.scriptProgress?.metrics.experience.status, `${question} -> ${answer}`).not.toBe('not_applicable');
    }
  });

  it('reopens the closed branch when later voluntary positive evidence appears', () => {
    const result = replay('fix-24-reopen', [
      ['agent', 'Что уже смотрели?'],
      ['client', 'Пока ничего.'],
      ['client', 'Кстати, вчера всё же посмотрел две квартиры.'],
    ]);

    expect(result.state.searchExperience?.value).toMatch(/просмотр|сравнен/iu);
    expect(result.state.searchExperience?.evidenceTurnIds).toContain('c3');
    expect(result.state.scriptProgress?.metrics.experience.status).toBe('confirmed');
    expect(result.policy?.semanticKey || '').not.toMatch(/ask_(?:search_)?experience/iu);
  });

  it('lets current positive evidence win over historical negative evidence in one answer', () => {
    const result = replay('fix-24-mixed', [
      ['agent', 'Что уже смотрели?'],
      ['client', 'До вчерашнего дня ничего, а вчера посмотрел два ЖК.'],
    ]);

    expect(result.state.searchExperience?.value).toMatch(/просмотр|сравнен/iu);
    expect(result.state.scriptProgress?.metrics.experience.status).toBe('confirmed');
  });

  it('keeps contextual closure isolated between sessions', () => {
    const closed = expectClosedExperience('Что уже смотрели?', 'Ничего.');
    const unrelated = replay('fix-24-independent-session', [
      ['agent', 'Ипотека нужна?'],
      ['client', 'Нет.'],
    ]);

    expect(closed.state.scriptProgress?.metrics.experience.status).toBe('not_applicable');
    expect(unrelated.state.searchExperience).toBeUndefined();
    expect(unrelated.state.scriptProgress?.metrics.experience.status).toBe('not_confirmed');
  });
});
