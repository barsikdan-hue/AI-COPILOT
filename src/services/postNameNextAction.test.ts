import { describe, expect, it } from 'vitest';
import type { SpeakerRole, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { isSubstantiveClientTurn } from './objectionEngine';
import { evaluateSpinAndHpb, isSubstantiveSpinAnswer } from './spinEngine';

const greeting = 'Добрый день, меня зовут Данил, специалист по недвижимости компании Элитный Сочи. Как я могу обращаться к вам?';
const evasiveReason = 'Клиент дал общий или уклончивый ответ («не знаю»). Требуется мягкое уточнение без давления.';

function replay(sequence: Array<[SpeakerRole, string]>) {
  const turns: TranscriptTurn[] = sequence.map(([speaker, text], index) => ({
    id: `turn_${index + 1}`, sessionId: 'session_1791014209914_sl21', speaker, text,
    source: speaker === 'agent' ? 'microphone' : 'call_audio',
    timestamp: 1791014226606 + index * 3000, revision: index + 1, isFinal: true,
  }));
  let state = createInitialState();
  for (const [index, turn] of turns.entries()) {
    state = advanceLocalConversation(state, turn, turns.slice(0, index + 1)).state;
  }
  const response = buildLocalAnalysisResponse({
    sessionId: turns[0].sessionId, revision: turns.length,
    newTurns: [turns.at(-1)!], recentTurns: turns, currentState: state,
  });
  return { state, response, turns };
}

describe('post-name next action', () => {
  it('routes exact sl21 with two agent finals to existing orientation without SPIN evidence', () => {
    const { state, response, turns } = replay([
      ['agent', greeting], ['agent', greeting], ['client', 'Марина.'],
    ]);
    expect(state.revision).toBe(3);
    expect(state.stage).toBe('contact');
    expect(response).toMatchObject({
      candidateRuleId: 'dialogue_policy_orientation_ask_search_experience',
      actionType: 'CLARIFY', shouldSuggest: true, eventType: null,
    });
    expect(response.shortReason).not.toContain('уклончив');
    expect(state.spin.situation).toEqual([]);
    expect(state.spin.problem).toEqual([]);
    expect(state.spin.lastClientEvidence).toBe('');
    expect(response.spinDelta).toBeUndefined();
    expect(response.factsDelta).toEqual([]);
    expect(turns.at(-1)?.text).toBe('Марина.');
  });

  it.each([
    ['Как я могу к вам обращаться?', 'Анфиса.'],
    ['Как я могу обращаться к вам?', 'Илья.'],
    ['Как к вам обращаться?', 'Глеб'],
    ['Как обращаться к вам?', 'Ли'],
    ['Как вас зовут?', 'Рен.'],
    ['Скажите, пожалуйста, ваше имя.', 'Алекс'],
    ['Как вас зовут?', 'Женя.'],
    ['Как я могу обращаться к вам?', 'Доминика.'],
  ])('advances %s / %s through orientation and retains the client answer', (question, answer) => {
    const { state, response, turns } = replay([['agent', question], ['client', answer]]);
    expect(isSubstantiveClientTurn(answer, question, true)).toBe(true);
    expect(response.candidateRuleId).toBe('dialogue_policy_orientation_ask_search_experience');
    expect(response.shortReason).not.toContain('уклончив');
    expect(state.spin.situation).toEqual([]);
    expect(state.stage).toBe('contact');
    expect(turns.at(-1)?.text).toBe(answer);
  });

  it.each([
    [undefined, true],
    ['Как вас зовут?', false],
    ['«Как обращаться к вам?»', true],
    ['Раньше спрашивали, как я могу обращаться к вам?', true],
    ['Не спрашиваю, как обращаться к вам.', true],
    ['Как вас зовут? Какой вариант понравился?', true],
    ['Что из просмотренного понравилось?', true],
  ] as const)('preserves one-word filtering after %s (immediate=%s)', (question, immediate) => {
    expect(isSubstantiveClientTurn('Марина.', question, immediate)).toBe(false);
  });

  it('does not reuse an earlier name question for a later one-word client turn', () => {
    const { response } = replay([
      ['agent', 'Как вас зовут?'], ['client', 'Меня зовут Алекс'], ['client', 'Марина.'],
    ]);
    expect(response.shortReason).toBe(evasiveReason);
  });

  it('does not bypass SPIN when the immediate question is unrelated to the earlier name question', () => {
    const { response } = replay([
      ['agent', 'Как вас зовут?'], ['agent', 'Что для вас важно в локации?'], ['client', 'Марина.'],
    ]);
    expect(response.shortReason).toBe(evasiveReason);
  });

  it.each([
    ['«Как вас зовут?»', 'Женя.'],
    ['Раньше спрашивали, как я могу обращаться к вам?', 'Доминика.'],
    ['Не спрашиваю, как вас зовут.', 'Женя.'],
    ['Что для вас важно в локации?', 'Доминика.'],
  ])('does not give a name exemption to business-substring answer %s / %s', (question, answer) => {
    const { response } = replay([['agent', question], ['client', answer]]);
    expect(response.spinDelta).toBeDefined();
  });

  it.each(['Взаимно.', 'спасибо', 'угу', 'эмм', 'кхм', '...'])('keeps %s filtered after a name question', answer => {
    expect(isSubstantiveClientTurn(answer, 'Как вас зовут?', true)).toBe(false);
  });

  it.each(['не знаю', 'пока не знаю', 'без понятия'])('preserves generic/evasive handling for %s after a business question', answer => {
    const { state, response, turns } = replay([['agent', 'Что для вас важно в локации?'], ['client', answer]]);
    expect(isSubstantiveSpinAnswer(answer)).toBe(false);
    expect(evaluateSpinAndHpb(turns.at(-1)!, state.spin, 'asked_situation_question', turns[0].text, state).shortReason).toBe(evasiveReason);
    expect(response.shortReason).toBe(evasiveReason);
    expect(state.spin.situation).toEqual([]);
  });

  it.each(['да', 'нет', 'хорошо', 'конечно', 'договорились', 'удобно', 'давайте', 'окей', 'подходит'])('does not promote the contextual acknowledgement %s to a name', answer => {
    const { response } = replay([['agent', 'Как вас зовут?'], ['client', answer]]);
    expect(response.shortReason).toBe(evasiveReason);
  });
});
