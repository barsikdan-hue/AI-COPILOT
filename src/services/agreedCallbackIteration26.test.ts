import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { applyConversationEvent, detectConversationEvent } from './conversationEventEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { isSuggestionAllowedByState } from './suggestionLifecycle';

const turn = (
  id: string,
  speaker: 'agent' | 'client',
  text: string,
  revision: number,
  sessionId = 'fix-26-agreed-callback',
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

function boundaryState(): ConversationState {
  const state = createInitialState();
  state.dialogueControl = {
    ...state.dialogueControl!,
    clientBoundaryActive: true,
    lastEventType: 'TIME_CONSTRAINT',
  };
  return state;
}

function detectCallback(clientText: string, agentText = 'Когда вам будет удобно продолжить?') {
  const agent = turn('a1', 'agent', agentText, 1);
  const client = turn('c2', 'client', clientText, 2);
  const state = boundaryState();
  const event = detectConversationEvent(client, [agent, client], state);
  const next = event ? applyConversationEvent(state, event, client) : state;
  return { agent, client, event, next };
}

describe('FIX 26 agreed callback / next-step contract', () => {
  it('captures the exact live callback under the active FIX 25 boundary', () => {
    const result = detectCallback(
      'Давайте вечером после семи минут 10.',
      'Понял, не буду расширять разговор, зафиксирую сказанное и вернемся к одному из следующему шагу, когда вам будет удобно.',
    );

    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.event?.meetingConsentQuality).toBe('clear');
    expect(result.next.nextStepAgreement?.status).toBe('agreed');
    expect(result.next.nextStepAgreement?.action).toMatch(/созвон|звонок/iu);
    expect(result.next.nextStepAgreement?.action).toMatch(/10\s*минут/iu);
    expect(result.next.nextStepAgreement?.timeOrDeadline).toMatch(/после\s+19:00/iu);
    expect(result.next.nextStepAgreement?.timeOrDeadline).not.toMatch(/сегодня/iu);
    expect(result.next.agreedNextStep?.value).toMatch(/созвон|звонок/iu);
    expect(result.next.agreedNextStep?.value).toMatch(/после\s+19:00/iu);
    expect(result.next.agreedNextStep?.evidenceTurnIds).toContain(result.client.id);
    expect(result.event?.suggestedReply).toMatch(/созвон|звонок|зафиксир/iu);
    expect(result.event?.suggestedReply).toMatch(/день|дат/iu);
    expect(result.event?.suggestedReply).not.toMatch(/сегодня/iu);
    expect(result.event?.suggestedReply).not.toMatch(/критери|формат\s+жилья|важнее\s+всего/iu);
  });

  it('replays all six live turns and closes qualification with one confirmation', () => {
    const turns = [
      turn('a1', 'agent', 'Добрый день, Данил, Элитный Сочи. Как я могу к вам обращаться?', 1),
      turn('c2', 'client', 'Здравствуйте, Андрей. Я сейчас на работе, так что, если можно, коротко и по делу.', 2),
      turn('a3', 'agent', 'Понял. Тогда коротко, для какой задачи рассматриваете недвижимость: для жизни, отдыха или инвестиций?', 3),
      turn('c4', 'client', 'Для жизни, но у меня правда сейчас мало времени, буквально пару минут.', 4),
      turn('a5', 'agent', 'Понял, не буду расширять разговор, зафиксирую сказанное и вернемся к одному из следующему шагу, когда вам будет удобно.', 5),
      turn('c6', 'client', 'Давайте вечером после семи минут 10.', 6),
    ];
    let state = createInitialState();
    let finalEvent: ReturnType<typeof detectConversationEvent> = null;
    for (let index = 0; index < turns.length; index += 1) {
      const advanced = advanceLocalConversation(state, turns[index], turns.slice(0, index + 1));
      state = advanced.state;
      finalEvent = advanced.event;
    }

    const analysis = buildLocalAnalysisResponse({
      sessionId: turns[0].sessionId,
      revision: 6,
      newTurns: [turns[5]],
      recentTurns: turns,
      currentState: state,
    });

    expect(finalEvent?.type).toBe('MEETING_CONTRACT');
    expect(state.dialogueControl?.clientBoundaryActive).toBe(true);
    expect(state.nextStepAgreement?.status).toBe('agreed');
    expect(state.agreedNextStep?.value).toMatch(/после\s+19:00/iu);
    expect(analysis.eventType).toBe('MEETING_CONTRACT');
    expect(analysis.suggestedReply).not.toMatch(/критери|формат\s+жилья|spin/iu);
    expect(isSuggestionAllowedByState({
      basedOnRevision: 6,
      text: finalEvent?.suggestedReply || '',
      closesMetric: finalEvent?.closesMetric,
      actionType: finalEvent?.actionType,
      priority: finalEvent?.priority,
      eventType: finalEvent?.type,
      stage: finalEvent?.stage,
    }, state, 6)).toBe(true);
  });

  it('keeps explicit client consent clear despite an earlier time boundary', () => {
    const result = detectCallback('Давайте созвонимся сегодня после 19:00 на 10 минут.');

    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.event?.meetingConsentQuality).toBe('clear');
    expect(result.next.nextStepAgreement?.status).toBe('agreed');
    expect(result.next.nextStepAgreement?.timeOrDeadline).toMatch(/сегодня.*после\s+19:00/iu);
    expect(result.next.nextStepAgreement?.action).toMatch(/10\s*минут/iu);
  });

  it.each([
    ['сегодня вечером после семи', /сегодня.*после\s+19:00/iu],
    ['Давайте после 19.', /после\s+19:00/iu],
    ['Давайте после 19:00.', /после\s+19:00/iu],
    ['Давайте часов после семи.', /после\s+19:00/iu],
    ['После семи.', /после\s+19:00/iu],
  ])('normalizes contextual callback time: %s', (text, expected) => {
    const result = detectCallback(text);

    expect(result.event?.type, text).toBe('MEETING_CONTRACT');
    expect(result.next.nextStepAgreement?.status, text).toBe('agreed');
    expect(result.next.nextStepAgreement?.timeOrDeadline, text).toMatch(expected);
    if (!/сегодня/iu.test(text)) {
      expect(result.next.nextStepAgreement?.timeOrDeadline, text).not.toMatch(/сегодня/iu);
    }
    expect(result.next.nextStepAgreement?.timeOrDeadline, text).not.toMatch(/07:00|07:10/iu);
  });

  it.each([
    'Давайте после семи на 10 минут.',
    'Давайте после семи минут на десять.',
    'Давайте после семи минут 10.',
    'Давайте после семи, десять минут.',
  ])('keeps callback duration separate from clock time: %s', (text) => {
    const result = detectCallback(text);

    expect(result.next.nextStepAgreement?.timeOrDeadline, text).toMatch(/после\s+19:00/iu);
    expect(result.next.nextStepAgreement?.timeOrDeadline, text).not.toMatch(/19:10|07:10/iu);
    expect(result.next.nextStepAgreement?.action, text).toMatch(/10\s*минут/iu);
  });

  it.each([
    'Может быть вечером после семи.',
    'Наверное, после семи получится.',
  ])('keeps uncertain callback timing unconfirmed: %s', (text) => {
    const result = detectCallback(text);

    expect(result.event?.type, text).toBe('MEETING_CONTRACT');
    expect(result.event?.meetingConsentQuality, text).toBe('tentative');
    expect(result.next.nextStepAgreement?.status, text).toBe('discussing');
    expect(result.next.agreedNextStep?.value, text).toBeNull();
  });

  it.each([
    'После семи не могу.',
    'Сегодня вечером точно не получится.',
  ])('does not create an agreement from negated availability: %s', (text) => {
    const result = detectCallback(text);

    expect(result.event, text).toBeNull();
    expect(result.next.nextStepAgreement, text).toBeUndefined();
    expect(result.next.agreedNextStep?.value, text).toBeNull();
  });

  it('preserves FIX 25 business/time boundary detection', () => {
    const state = createInitialState();
    const client = turn('c1', 'client', 'Я сейчас на работе, так что, если можно, коротко и по делу.', 1);
    const event = detectConversationEvent(client, [client], state);
    const next = event ? applyConversationEvent(state, event, client) : state;

    expect(event?.type).toBe('TIME_CONSTRAINT');
    expect(next.dialogueControl?.clientBoundaryActive).toBe(true);
    expect(event?.suggestedReply).toMatch(/коротко|задач/iu);
  });
});
