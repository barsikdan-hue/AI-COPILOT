import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

const makeTurn = (speaker: 'agent' | 'client', text: string, index: number): TranscriptTurn => ({
  id: `fix35-${index}`, sessionId: 'fix35', speaker,
  source: speaker === 'agent' ? 'microphone' : 'call_audio',
  text, timestamp: index * 1000, revision: index, isFinal: true,
});

function step(state: ConversationState, turns: TranscriptTurn[], speaker: 'agent' | 'client', text: string) {
  const turn = makeTurn(speaker, text, turns.length + 1);
  const recentTurns = [...turns, turn];
  const result = advanceLocalConversation(state, turn, recentTurns);
  const response = speaker === 'client' ? buildLocalAnalysisResponse({
    sessionId: turn.sessionId, revision: turn.revision || recentTurns.length,
    newTurns: [turn], recentTurns, currentState: result.state,
  }) : null;
  return { ...result, turn, turns: recentTurns, response };
}

function client(text: string) { return step(createInitialState(), [], 'client', text); }

describe('FIX 35 client boundary semantics', () => {
  it.each([
    'Времени немного.',
    'Пять минут есть.',
    'Давайте пять минут, только быстро.',
    'Пару минут могу.',
    'Я сейчас, честно говоря, никак не могу так долго разговаривать.',
    'Только времени не очень много, да, сейчас деталями разговаривать.',
    'Ну пять сейчас, давайте пять сейчас, только оперативно, да.',
  ])('keeps a short active window: %s', text => {
    const result = client(text);
    expect(result.event?.type).toBe('TIME_CONSTRAINT');
    expect(result.state.dialogueControl?.boundaryMode).toBe('limited_active_window');
    expect(result.response?.actionType).toBe('CLARIFY');
    expect((result.response?.suggestedReply?.match(/\?/gu) || []).length).toBeLessThanOrEqual(1);
    expect(result.response?.suggestedReply).not.toMatch(/верн[её]мся|перезвоню/iu);
  });

  it.each(['Сейчас совсем не могу.', 'Мне неудобно говорить.'])('stops on unavailable client: %s', text => {
    const result = client(text);
    expect(result.state.dialogueControl?.boundaryMode).toBe('hard_stop');
    expect(result.response?.actionType).not.toBe('CLARIFY');
  });

  it('does not confuse construction speed with a short call window', () => {
    expect(client('Дом быстро построят.').state.dialogueControl?.boundaryMode).toBe('none');
  });

  it.each(['Перезвоните после обеда.', 'Попробуйте позвонить после обеда.'])('defers to requested callback: %s', text => {
    const result = client(text);
    expect(result.event?.type).toBe('TIME_CONSTRAINT');
    expect(result.state.dialogueControl?.boundaryMode).toBe('defer');
    expect(result.response?.suggestedReply).toMatch(/после обеда/iu);
    expect(result.response?.suggestedReply).not.toMatch(/\?/u);
  });

  it.each([
    'Сейчас не актуально.', 'Передумали.', 'А уже не актуально.',
    'Сейчас не актуально, зимой может быть.', 'Было дело, сейчас же не актуально.',
  ])('closes current interest: %s', text => {
    const result = client(text);
    expect(result.event?.type).toBe('NOT_ACTUAL');
    expect(result.state.dialogueControl?.boundaryMode).toBe('not_actual');
    expect(result.response?.actionType).toBe('RESPECT_STOP');
    expect(result.response?.suggestedReply).not.toMatch(/\?/u);
  });

  it('keeps the limited window through a useful answer', () => {
    let result = client('Времени немного, давайте быстро.');
    result = step(result.state, result.turns, 'agent', 'Для какой задачи рассматриваете недвижимость?');
    result = step(result.state, result.turns, 'client', 'Для жизни.');
    expect(result.state.dialogueControl?.boundaryMode).toBe('limited_active_window');
    expect(result.response?.actionType).toBe('CLARIFY');
    expect((result.response?.suggestedReply?.match(/\?/gu) || []).length).toBeLessThanOrEqual(1);
  });

  it('closes limited window on a clear callback agreement', () => {
    let result = client('Пять минут есть.');
    result = step(result.state, result.turns, 'agent', 'Когда созвонимся для продолжения?');
    result = step(result.state, result.turns, 'client', 'Давайте созвонимся завтра вечером.');
    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.state.dialogueControl?.boundaryMode).toBe('limited_active_window');
    expect(result.state.dialogueControl?.clientBoundaryActive).toBe(true);
    expect(result.state.nextStepAgreement?.status).toBe('agreed');
  });

  it('does not reopen discovery after farewell on agreed next step', () => {
    let result = client('Перезвоните завтра вечером.');
    result = step(result.state, result.turns, 'agent', 'Хорошо, позвоню завтра вечером.');
    result = step(result.state, result.turns, 'client', 'Хорошо, спасибо, до связи.');
    expect(result.response?.suggestedReply).not.toMatch(/какая цель|что для вас важно|бюджет|что смотрели/iu);
  });

  it('reopens an inactive-interest boundary only when the client explicitly resumes', () => {
    let result = client('Было дело, сейчас же не актуально.');
    result = step(result.state, result.turns, 'agent', 'А не актуально почему? Купили уже?');
    result = step(result.state, result.turns, 'client', 'Нет, передумали.');
    result = step(result.state, result.turns, 'agent', 'Передумали. Может быть, не такие выгодные предложения были, как сейчас?');
    result = step(result.state, result.turns, 'client', 'Не знаю.');
    expect(result.state.dialogueControl?.boundaryMode).toBe('not_actual');
    result = step(result.state, result.turns, 'agent', 'Может быть, послушаете пару минут, у меня есть Горячее предложение для вас, может быть, заинтересует вас.');
    result = step(result.state, result.turns, 'client', 'Давайте посмотрим.');
    expect(result.state.dialogueControl?.boundaryMode).toBe('none');
    expect(result.state.dialogueControl?.clientBoundaryActive).toBe(false);
    expect(result.response?.actionType).not.toBe('RESPECT_STOP');
  });

  it.each([
    'Передумали: теперь рассматриваем как инвестицию.',
    'Передумал: квартира нужна мне самому.',
    'Передумал, рассматриваю апартаменты.',
    'Ипотеку сейчас не рассматриваю.',
    'Видео сейчас не актуально.',
    'Сейчас не интересует рассрочка.',
  ])('does not turn a concrete changed requirement into a stop boundary: %s', text => {
    expect(client(text).event?.type).not.toBe('NOT_ACTUAL');
  });
});
