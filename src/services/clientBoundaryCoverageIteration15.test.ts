import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { detectConversationEvent } from './conversationEventEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

const turn = (text: string, revision = 1): TranscriptTurn => ({
  id: `boundary-${revision}`,
  sessionId: 'client-boundary-iteration-15',
  source: 'call_audio',
  speaker: 'client',
  text,
  timestamp: revision * 1000,
  isFinal: true,
  revision,
});

const analyze = (text: string) => {
  const client = turn(text);
  const initial = createInitialState();
  const event = detectConversationEvent(client, [client], initial);
  const advanced = advanceLocalConversation(initial, client, [client]);
  const response = buildLocalAnalysisResponse({
    sessionId: client.sessionId,
    revision: client.revision || 1,
    newTurns: [client],
    recentTurns: [client],
    currentState: advanced.state,
  });
  return { event, state: advanced.state, response };
};

describe('FIX ITERATION 15: client boundary coverage', () => {
  it.each([
    'Не звоните.',
    'Не звоните мне больше.',
    'Не связывайтесь со мной.',
    'Удалите мой номер.',
    'Уберите мой номер из базы.',
    'Больше не звоните.',
  ])('treats %s as a hard stop', (text) => {
    const { event, state, response } = analyze(text);

    expect(event?.type).toBe('CLIENT_STOP');
    expect(event?.actionType).toBe('RESPECT_STOP');
    expect(event?.suppressesAnalysis).toBe(true);
    expect(state.dialogueControl?.clientBoundaryActive).toBe(true);
    expect(response.eventType).toBe('CLIENT_STOP');
    expect(response.actionType).toBe('RESPECT_STOP');
    expect(response.suggestedReply).not.toMatch(/бюджет|срок|видеовстреч|видеопоказ/iu);
  });

  it.each([
    'Сейчас нет времени.',
    'Давайте позже.',
    'Давайте потом.',
    'Я занят, наберите вечером.',
    'Я сейчас в поезде, говорить неудобно.',
    'Сейчас говорить не могу, перезвоните вечером.',
    'У меня начинается встреча, на разговор времени нет.',
  ])('keeps %s temporary', (text) => {
    const { event, state, response } = analyze(text);

    expect(event?.type).toBe('TIME_CONSTRAINT');
    expect(event?.type).not.toBe('CLIENT_STOP');
    expect(event?.suppressesAnalysis).toBe(true);
    expect(state.dialogueControl?.clientBoundaryActive).toBe(true);
    expect(response.eventType).toBe('TIME_CONSTRAINT');
    expect(response.actionType).toBe('PROPOSE_NEXT_STEP');
    expect(response.suggestedReply).not.toMatch(/какой\s+бюджет|срок\s+покупки|видеовстреч|видеопоказ/iu);
  });

  it.each([
    'Не хочу сейчас обсуждать.',
    'Не хочу сейчас это обсуждать.',
    'Давайте не будем пока углубляться.',
  ])('stops the current discussion branch for %s without a permanent stop', (text) => {
    const { event, state, response } = analyze(text);

    expect(event?.type).toBe('SOFT_RESISTANCE');
    expect(event?.ruleId).toBe('soft_resistance_discussion');
    expect(state.dialogueControl?.clientBoundaryActive).toBe(false);
    expect(response.eventType).toBe('SOFT_RESISTANCE');
    expect(response.suggestedReply).toMatch(/не\s+углубляемся|верн[её]мся/iu);
    expect(response.suggestedReply).not.toContain('?');
  });

  it.each([
    'Я сам посмотрю.',
    'Я сам изучу.',
    'Сначала сам разберусь.',
  ])('keeps %s as a client preference, not resistance or a hard stop', (text) => {
    const { event, state, response } = analyze(text);

    expect(event?.type).toBe('CLIENT_PREFERENCE');
    expect(event?.ruleId).toBe('client_preference_self_service');
    expect(state.dialogueControl?.clientBoundaryActive).toBe(false);
    expect(response.eventType).toBe('CLIENT_PREFERENCE');
    expect(response.suggestedReply).toMatch(/удобном\s+темпе|если\s+понадобится/iu);
    expect(response.suggestedReply).not.toContain('?');
  });

  it.each([
    'Просто пришлите цены, дальше сам посмотрю.',
    'Скиньте планировки, созваниваться не хочу.',
    'Планировки пришлите, дальше я сам разберусь.',
    'Только прайс пришлите, встречу пока не назначаем.',
  ])('preserves material routing together with the boundary for %s', (text) => {
    const { event, response } = analyze(text);

    expect(event?.type).toBe('MATERIAL_REQUEST');
    expect(event?.ruleId).toBe('material_request');
    expect(response.eventType).toBe('MATERIAL_REQUEST');
    expect(response.suggestedReply).toMatch(/отправлю|пришл/iu);
    expect(response.suggestedReply).not.toMatch(/видеовстреч|видеопоказ|созвон/iu);
  });

  it.each([
    'Позвоните мне вечером.',
    'Свяжитесь со мной завтра.',
    'Я сам принимаю решение.',
    'Сам объект посмотрю в субботу.',
    'Времени на покупку у меня три месяца.',
  ])('does not overmatch the neutral control %s', (text) => {
    const { event } = analyze(text);
    expect(event).toBeNull();
  });
});
