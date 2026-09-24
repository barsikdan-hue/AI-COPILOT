import { describe, expect, it } from 'vitest';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { classifyClientTurnIntent, detectLocalObjection, REAL_OBJECTION_CATEGORIES } from './objectionEngine';
import { ConversationState, TranscriptTurn } from '../types';
import { isSuggestionAllowedByState } from './suggestionLifecycle';

export function replay(initial: ConversationState = createInitialState()) {
  let state = initial;
  const turns: TranscriptTurn[] = [];
  return {
    get state() { return state; }, turns,
    add(text: string, speaker: 'agent' | 'client' = 'client') {
      const turn: TranscriptTurn = { id: `t${turns.length}`, sessionId: 'test', speaker, source: speaker === 'client' ? 'call_audio' : 'microphone', text, timestamp: turns.length * 10000, revision: turns.length + 1, isFinal: true };
      turns.push(turn);
      const result = advanceLocalConversation(state, turn, turns);
      state = result.state;
      return result;
    },
    hint() { return buildLocalAnalysisResponse({ sessionId: 'test', revision: turns.length, newTurns: [turns.at(-1)!], recentTurns: turns, currentState: state }); },
  };
}

describe('4.0.2 objection resistance acceptance', () => {
  it('T01 positive consideration never rejects a branch', () => {
    const r = replay();
    expect(r.add('Вполне рассматриваю.').event?.type).not.toBe('EXPLICIT_REJECTION');
    expect(classifyClientTurnIntent('Вполне рассматриваю.').type).not.toBe('objection');
    expect(r.state.dialogueControl?.rejectedBranches).toEqual([]);
    expect(r.add('Вполне рассматриваю квартиру, но дом не хочу.').event?.type).toBe('EXPLICIT_REJECTION');
  });
  it('T02 first PPV resistance isolates the reason and records an objection', () => {
    const r = replay();
    const result = r.add('Пока не готов назначать время показа. Сначала хочу определиться с вариантами.');
    expect(result.event?.type).toBe('NEXT_STEP_RESISTANCE');
    expect(r.state.dialogueControl?.nextStepResistance).toMatchObject({ target: 'ppv', count: 1, status: 'detected' });
    expect(r.state.objections.items).toContain('next_step_ppv');
    expect(r.hint().suggestedReply).toMatch(/сначала|что.*прояснить|понял/iu);
    expect(r.hint().suggestedReply).not.toMatch(/сегодня|завтра|18:00/iu);
  });
  it('T03 repeated PPV resistance blocks the branch without completing QA', () => {
    const r = replay();
    r.add('Пока не готов назначать время показа. Сначала хочу определиться с вариантами.');
    r.add('А потом уже решим по времени.');
    expect(r.state.dialogueControl?.nextStepResistance).toMatchObject({ target: 'ppv', count: 2, status: 'blocked' });
    expect(r.state.dialogueControl?.blockedNextSteps).toContain('ppv');
    expect(r.hint().suggestedReply).toMatch(/видеопоказ пока не фиксируем|верн[её]мся.*комфорт/iu);
    expect(r.state.scriptProgress?.metrics.ppv.status).not.toBe('confirmed');
  });
  it('T04 first PPI resistance distinguishes mortgage from consulting readiness', () => {
    const r = replay();
    const result = r.add('Давайте пока не будем торопиться. Сначала определимся с вариантами, а уже потом подключим брокера.');
    expect(result.clientIntent.type).toBe('objection');
    expect(result.event?.nextStepTarget).toBe('ppi');
    expect(r.state.objections.items).toContain('next_step_ppi');
    expect(r.hint().suggestedReply).toMatch(/брокера пока не подключаем|подходящие объекты|что.*сравнить/iu);
  });
  it('T05 repeated contextual PPI deferral removes PPI from immediate priority', () => {
    const r = replay();
    r.add('Сначала определимся с объектами.');
    r.add('Когда варианты будут ясны, тогда подключим специалиста.');
    r.add('Сейчас это преждевременно.');
    expect(r.state.dialogueControl?.blockedNextSteps).toContain('ppi');
    expect(r.state.scriptProgress?.quality.immediatePriorityMetric).not.toBe('ppi');
    expect(r.state.scriptProgress?.metrics.ppi.status).not.toBe('confirmed');
  });
  it('T06 conditional statement is a deferred branch, genuine question remains a question', () => {
    const r = replay();
    expect(r.add('Когда варианты будут ясны, тогда подключим специалиста.').event?.type).toBe('NEXT_STEP_RESISTANCE');
    expect(r.add('Когда будет готов дом?').event?.type).toBe('DIRECT_QUESTION');
  });
  it('T14 detection, actual agent response and client clarification have separate statuses', () => {
    const r = replay();
    r.add('Пока не готов к показу.');
    expect(r.state.scriptProgress?.metrics.objections.status).toBe('needs_clarification');
    r.add('Правильно понимаю, пока рано выбирать время до отбора конкретных вариантов?', 'agent');
    expect(r.state.scriptProgress?.metrics.objections.status).toBe('partially_confirmed');
    r.add('Да, именно так.');
    expect(r.state.activeObjection?.status).toBe('deferred');
    expect(r.state.scriptProgress?.metrics.objections.status).toBe('partially_confirmed');
    expect(r.state.scriptProgress?.metrics.ppv.status).not.toBe('confirmed');
  });
  it('T15 explicit client initiative reopens a blocked PPI branch', () => {
    const r = replay();
    r.add('Брокера потом.'); r.add('Сейчас это преждевременно.');
    expect(r.state.dialogueControl?.blockedNextSteps).toContain('ppi');
    r.add('Хорошо, по этим двум объектам уже можно подключить брокера и сравнить ипотеку.');
    expect(r.state.dialogueControl?.blockedNextSteps).not.toContain('ppi');
    expect(r.state.dialogueControl?.nextStepResistance?.status).toBe('handled');
    expect(isSuggestionAllowedByState({ text: 'Подключим ипотечного брокера по выбранным объектам.' }, r.state)).toBe(true);
  });
  it.each(['Надо подумать.', 'Не сейчас.', 'Сначала продам свою квартиру.', 'Неудобная локация.', 'Не верю в окупаемость.', 'Дорого, у нас бюджет 15 млн.'])('taxonomy is shared for %s', text => {
    const objection = detectLocalObjection(text)!;
    expect(REAL_OBJECTION_CATEGORIES.has(objection.category)).toBe(true);
    expect(classifyClientTurnIntent(text).type).toBe('objection');
  });
  it('an agent cannot create client resistance or clear a client boundary', () => {
    const r = replay(); r.add('Брокера потом.', 'agent');
    expect(r.state.objections.items).toEqual([]);
    r.add('Брокера потом.'); r.add('Сейчас преждевременно.');
    r.add('Можно подключить брокера по этим объектам.', 'agent');
    expect(r.state.dialogueControl?.blockedNextSteps).toContain('ppi');
  });
  it('first resistance with polite agreement words does not count as consent', () => {
    const r = replay();
    r.add('Предлагаю ипотечного специалиста: без первоначального взноса, аренда перекрывает платеж, ремонт в подарок.', 'agent');
    r.add('Давайте пока не будем торопиться с брокером.');
    expect(r.state.scriptProgress?.metrics.ppi.status).not.toBe('confirmed');
    expect(r.state.scriptProgress?.ppi.explainedOpportunities).toHaveLength(3);
    expect(r.state.scriptProgress?.ppi.status).toBe('partially_confirmed');
  });
  it('developer specialist belongs to PPV; unrelated refusals do not inherit the previous branch', () => {
    const r = replay();
    r.add('Пока не готов подключать специалиста застройщика для видеопоказа.');
    expect(r.state.dialogueControl?.nextStepResistance?.target).toBe('ppv');
    r.add('Не хочу дом, рассматриваю квартиру.');
    expect(r.state.dialogueControl?.nextStepResistanceHistory?.ppv?.count).toBe(1);
  });
  it('resistance lifecycle records the actual isolation and client deferral', () => {
    const r = replay(); r.add('Пока не готов к показу.');
    r.add('Правильно понимаю, сначала хотите выбрать объекты?', 'agent');
    expect(r.state.dialogueControl?.nextStepResistance?.status).toBe('isolating');
    r.add('Да, именно так.');
    expect(r.state.dialogueControl?.nextStepResistance?.status).toBe('deferred');
  });
  it('uses the previous proposal only for a contextual short answer', () => {
    const r = replay(); r.add('Подключим ипотечного брокера?', 'agent');
    expect(r.add('Не хочу дом, рассматриваю квартиру.').event?.type).not.toBe('NEXT_STEP_RESISTANCE');
    expect(r.add('Пока не готов.').event?.nextStepTarget).toBe('ppi');
  });
  it.each([['Материалы пока не надо.', 'materials'], ['Созвон пока не нужен, потом.', 'callback'], ['Следующий шаг пока не готов обсуждать.', 'other']])('supports non-PPI/PPV resistance: %s', (text, target) => {
    const r = replay(); expect(r.add(text).event?.nextStepTarget).toBe(target);
  });
});
