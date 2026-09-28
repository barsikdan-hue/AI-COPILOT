import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

const turn = (
  id: string,
  speaker: 'agent' | 'client',
  text: string,
  revision: number,
): TranscriptTurn => ({
  id,
  sessionId: 'fix-28-limited-window',
  source: speaker === 'agent' ? 'microphone' : 'call_audio',
  speaker,
  text,
  timestamp: revision * 1000,
  revision,
  isFinal: true,
});

function add(
  state: ConversationState,
  turns: TranscriptTurn[],
  speaker: 'agent' | 'client',
  text: string,
) {
  const nextTurn = turn(`t${turns.length + 1}`, speaker, text, turns.length + 1);
  const nextTurns = [...turns, nextTurn];
  const result = advanceLocalConversation(state, nextTurn, nextTurns);
  return { ...result, turn: nextTurn, turns: nextTurns };
}

function analyze(state: ConversationState, turns: TranscriptTurn[], client: TranscriptTurn) {
  return buildLocalAnalysisResponse({
    sessionId: client.sessionId,
    revision: client.revision || turns.length,
    newTurns: [client],
    recentTurns: turns,
    currentState: state,
  });
}

function singleClient(text: string) {
  const initial = createInitialState();
  const result = add(initial, [], 'client', text);
  const response = analyze(result.state, result.turns, result.turn);
  return { ...result, response };
}

describe('FIX 28 limited active window versus hard stop', () => {
  it.each([
    'Есть две минуты.',
    'Могу пару минут.',
    'Пару минут у меня есть.',
    'Давайте быстро и по делу.',
    'Времени мало, но пару вопросов можно.',
    'Сейчас могу говорить минуты две.',
    'Я на работе, давайте коротко.',
  ])('persists a limited active window and continues briefly: %s', (text) => {
    const result = singleClient(text);

    expect(result.event?.type, text).toBe('TIME_CONSTRAINT');
    expect(result.state.dialogueControl?.boundaryMode, text).toBe('limited_active_window');
    expect(result.state.dialogueControl?.clientBoundaryActive, text).toBe(true);
    expect(result.response.actionType, text).toBe('CLARIFY');
    expect(result.response.suggestedReply, text).toMatch(/\?$/u);
    expect((result.response.suggestedReply?.match(/\?/gu) || []).length, text).toBe(1);
    expect(result.response.suggestedReply, text).not.toMatch(/не\s+буду|верн[её]мся|перезвон|когда\s+удобно/iu);
  });

  it('continues the exact live call with one highest-value unresolved question', () => {
    let state = createInitialState();
    let turns: TranscriptTurn[] = [];
    let result = add(state, turns, 'agent', 'Как я могу к вам обращаться?');
    state = result.state; turns = result.turns;
    result = add(state, turns, 'client', 'Я сейчас на работе, так что, если можно, коротко и по делу.');
    state = result.state; turns = result.turns;
    result = add(state, turns, 'agent', 'Тогда коротко: для какой задачи рассматриваете недвижимость?');
    state = result.state; turns = result.turns;
    result = add(state, turns, 'client', 'Для жизни, но у меня правда сейчас мало времени, буквально пару минут.');
    state = result.state; turns = result.turns;
    const response = analyze(state, turns, result.turn);

    expect(result.event?.type).toBe('TIME_CONSTRAINT');
    expect(state.dialogueControl?.boundaryMode).toBe('limited_active_window');
    expect(state.dialogueControl?.clientBoundaryActive).toBe(true);
    expect(state.goal?.value).toBeTruthy();
    expect(response.actionType).toBe('CLARIFY');
    expect(response.closesMetric).toBe('criteria');
    expect(response.suggestedReply).toMatch(/важно|критери|признак|без\s+компромисс|отсекать/iu);
    expect((response.suggestedReply?.match(/\?/gu) || []).length).toBe(1);
    expect(response.suggestedReply).not.toMatch(/не\s+буду|верн[её]мся|перезвон|работ|професси|хобби|увлека/iu);
  });

  it.each([
    ['Не могу говорить.', 'hard_stop'],
    ['Сейчас вообще неудобно.', 'hard_stop'],
    ['Мне некогда.', 'hard_stop'],
    ['Перезвоните вечером.', 'defer'],
    ['Давайте позже.', 'defer'],
    ['Позвоните после семи.', 'defer'],
    ['Сейчас не могу, наберите через час.', 'defer'],
  ] as const)('keeps stop/defer semantics separate: %s', (text, mode) => {
    const result = singleClient(text);

    expect(result.event?.type, text).toMatch(/TIME_CONSTRAINT|CLIENT_STOP/u);
    expect(result.state.dialogueControl?.boundaryMode, text).toBe(mode);
    expect(result.state.dialogueControl?.clientBoundaryActive, text).toBe(true);
    expect(result.response.suggestedReply, text).not.toMatch(/квартир|апартамент|дом|какой\s+формат/iu);
  });

  it.each([
    'До работы ехать две минуты.',
    'Ремонт займёт пару минут.',
    'До покупки осталось два месяца.',
    'Работа будет закончена через неделю.',
    'Две минуты пешком до моря.',
  ])('does not create a boundary from incidental time wording: %s', (text) => {
    const result = singleClient(text);

    expect(['TIME_CONSTRAINT', 'CLIENT_STOP'], text).not.toContain(result.event?.type);
    expect(result.state.dialogueControl?.boundaryMode, text).toBe('none');
    expect(result.state.dialogueControl?.clientBoundaryActive, text).toBe(false);
  });

  it('keeps limited mode across the next answer and asks only one qualification question', () => {
    let state = createInitialState();
    let turns: TranscriptTurn[] = [];
    let result = add(state, turns, 'client', 'Есть две минуты.');
    state = result.state; turns = result.turns;
    result = add(state, turns, 'agent', 'Для какой задачи рассматриваете недвижимость?');
    state = result.state; turns = result.turns;
    result = add(state, turns, 'client', 'Для жизни.');
    const response = analyze(result.state, result.turns, result.turn);

    expect(result.state.dialogueControl?.boundaryMode).toBe('limited_active_window');
    expect(response.closesMetric).toBe('criteria');
    expect((response.suggestedReply?.match(/\?/gu) || []).length).toBe(1);
    expect(response.suggestedReply).not.toMatch(/работ|професси|хобби|увлека/iu);
  });

  it('does not reopen qualification after a next step is already agreed', () => {
    const state = createInitialState();
    state.dialogueControl = {
      ...state.dialogueControl!,
      clientBoundaryActive: true,
      boundaryMode: 'limited_active_window',
      meetingConsentQuality: 'clear',
    };
    state.nextStepAgreement = {
      action: 'Созвон на 10 минут',
      durationMinutes: 10,
      timeOrDeadline: 'сегодня после 19:00',
      channel: 'созвон',
      status: 'agreed',
    };
    state.agreedNextStep = { value: 'Созвон на 10 минут сегодня после 19:00', evidenceTurnIds: ['c1'] };
    const client = turn('c2', 'client', 'Хорошо, договорились.', 2);
    const response = analyze(state, [client], client);

    expect(response.suggestedReply).toBeNull();
    expect(response.eventType).toBeNull();
  });
});
