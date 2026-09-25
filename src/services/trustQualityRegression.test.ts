import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation } from './localAnalysisEngine';
import { evaluateFirstCallScript, getFirstCallSuggestion } from './firstCallScriptEngine';

function turn(id: string, speaker: 'agent' | 'client', text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'trust-quality',
    source: speaker === 'agent' ? 'microphone' : 'call_audio',
    speaker,
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

function replay(turns: TranscriptTurn[]) {
  let state = createInitialState();
  for (let i = 0; i < turns.length; i += 1) {
    state = advanceLocalConversation(state, turns[i], turns.slice(0, i + 1)).state;
  }
  return state;
}

describe('trust quality without personal-question quota', () => {
  it('confirms a healthy advisory dialogue with zero personal questions', () => {
    const turns = [
      turn('a1', 'agent', 'Для чего рассматриваете покупку и что хотите получить в результате?', 1),
      turn('c1', 'client', 'Для постоянной жизни. Хочу переехать в Сочи и жить там большую часть года.', 2),
      turn('a2', 'agent', 'Что для вас важнее всего при выборе и без чего вариант сразу отпадает?', 3),
      turn('c2', 'client', 'Нужны тишина, нормальная логистика и чтобы район не был отрезан от города.', 4),
      turn('a3', 'agent', 'В какой бюджет хотите уложиться?', 5),
      turn('c3', 'client', 'Ориентир около 20 миллионов, до 25 рассмотрю сильный вариант.', 6),
    ];
    const state = replay(turns);
    const progress = evaluateFirstCallScript(turns, state);

    expect(progress.trust.openPersonalQuestionsCount).toBe(0);
    expect(progress.trust.openTechnicalQuestionsCount).toBeGreaterThanOrEqual(1);
    expect(progress.trust.status).toBe('confirmed');
    expect(progress.metrics.trust.status).toBe('confirmed');
    expect(progress.metrics.trust.semanticReason).toMatch(/личные вопросы не являются обязательным условием/iu);
  });

  it('does not select a personal trust question merely because the personal counter is below two', () => {
    const turns = [
      turn('a1', 'agent', 'Для чего рассматриваете покупку и что хотите получить в результате?', 1),
      turn('c1', 'client', 'Для постоянной жизни. Хочу переехать в Сочи и жить там большую часть года.', 2),
      turn('a2', 'agent', 'Что для вас важнее всего при выборе и без чего вариант сразу отпадает?', 3),
      turn('c2', 'client', 'Нужны тишина, нормальная логистика и чтобы район не был отрезан от города.', 4),
      turn('a3', 'agent', 'В какой бюджет хотите уложиться?', 5),
      turn('c3', 'client', 'Ориентир около 20 миллионов, до 25 рассмотрю сильный вариант.', 6),
    ];
    const state = replay(turns);
    const progress = evaluateFirstCallScript(turns, state);
    const suggestion = getFirstCallSuggestion(progress, turns[5], state, turns);

    expect(progress.trust.status).toBe('confirmed');
    expect(progress.trust.openPersonalQuestionsCount).toBe(0);
    expect(suggestion?.closesMetric).not.toBe('trust');
    expect(suggestion?.suggestedReply || '').not.toMatch(/отдых|професс|увлека|семь|когда.*были.*сочи/iu);
  });

  it('keeps trust open when the client has not actually engaged in the dialogue', () => {
    const turns = [
      turn('a1', 'agent', 'Для чего рассматриваете покупку?', 1),
      turn('c1', 'client', 'Не знаю.', 2),
      turn('a2', 'agent', 'Что для вас важно?', 3),
      turn('c2', 'client', 'Пока ничего.', 4),
    ];
    const state = replay(turns);
    const progress = evaluateFirstCallScript(turns, state);

    expect(progress.trust.status).not.toBe('confirmed');
  });
});
