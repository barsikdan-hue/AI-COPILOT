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
  sessionId: 'fix-27-agreement-stability',
  source: speaker === 'agent' ? 'microphone' : 'call_audio',
  speaker,
  text,
  timestamp: revision * 1000,
  isFinal: true,
  revision,
});

function advance(
  state: ConversationState,
  turns: TranscriptTurn[],
  speaker: 'agent' | 'client',
  text: string,
) {
  const nextTurn = turn(`t${turns.length + 1}`, speaker, text, turns.length + 1);
  const nextTurns = [...turns, nextTurn];
  const result = advanceLocalConversation(state, nextTurn, nextTurns);
  return { state: result.state, event: result.event, turn: nextTurn, turns: nextTurns };
}

function agreedCallback(agentEcho = 'Отлично, тогда созвонимся сегодня после 19:00 на 10 минут. Зафиксировал.') {
  let state = createInitialState();
  state.dialogueControl = {
    ...state.dialogueControl!,
    clientBoundaryActive: true,
    lastEventType: 'TIME_CONSTRAINT',
  };
  let turns: TranscriptTurn[] = [];

  let result = advance(state, turns, 'agent', 'Когда вам будет удобно продолжить?');
  state = result.state;
  turns = result.turns;
  result = advance(state, turns, 'client', 'Давайте вечером после семи минут 10.');
  state = result.state;
  turns = result.turns;
  expect(result.event?.type).toBe('MEETING_CONTRACT');
  expect(state.nextStepAgreement?.status).toBe('agreed');
  expect(state.nextStepAgreement?.timeOrDeadline).toMatch(/после\s+19:00/iu);

  result = advance(state, turns, 'agent', agentEcho);
  return { state: result.state, turns: result.turns };
}

function canonicalSnapshot(state: ConversationState) {
  return {
    agreement: state.nextStepAgreement,
    agreedNextStep: state.agreedNextStep,
    quality: state.dialogueControl?.meetingConsentQuality,
  };
}

describe('FIX 27 agreement stability and reaffirmation guard', () => {
  it.each([
    'Хорошо, договорились.',
    'Да, всё верно.',
    'Так и оставляем.',
    'Да, так и оставляю, спасибо.',
    'Да, после семи.',
    'Мы уже договорились.',
  ])('keeps a confirmed callback unchanged after generic reaffirmation: %s', (text) => {
    const seeded = agreedCallback();
    const before = canonicalSnapshot(seeded.state);
    const result = advance(seeded.state, seeded.turns, 'client', text);

    expect(result.event, text).toBeNull();
    expect(canonicalSnapshot(result.state), text).toEqual(before);
  });

  it.each([
    'Мы уже договорились, не надо новых вариантов.',
    'Мы уже это согласовали сегодня после семи на 10 минут. Больше ничего не нужно.',
    'Я же сказал, созвон после семи. Пожалуйста, не надо сейчас новых вариантов.',
    'Я же сказал, созвон после семи.',
  ])('treats defence of the agreed callback as reaffirmation, not resistance: %s', (text) => {
    const seeded = agreedCallback();
    const before = canonicalSnapshot(seeded.state);
    const result = advance(seeded.state, seeded.turns, 'client', text);

    expect(result.event?.type, text).not.toBe('NEXT_STEP_RESISTANCE');
    expect(result.state.activeObjection, text).toBeUndefined();
    expect(canonicalSnapshot(result.state), text).toEqual(before);
  });

  it.each([
    'Отлично, тогда созвонимся сегодня после 7:00 на 10 минут. Зафиксировал.',
    'Отлично, тогда созвонимся сегодня после 19:10. Зафиксировал.',
  ])('does not let a conflicting agent echo rewrite the client contract: %s', (agentEcho) => {
    const seeded = agreedCallback(agentEcho);
    const before = canonicalSnapshot(seeded.state);
    const result = advance(seeded.state, seeded.turns, 'client', 'Хорошо, договорились.');

    expect(result.event).toBeNull();
    expect(canonicalSnapshot(result.state)).toEqual(before);
    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/после\s+19:00/iu);
    expect(result.state.nextStepAgreement?.timeOrDeadline).not.toMatch(/07:00|19:10/iu);
    expect(result.state.nextStepAgreement?.action).toMatch(/10\s*минут/iu);
  });

  it('allows an explicit client reschedule and preserves the other agreed fields', () => {
    const seeded = agreedCallback();
    const result = advance(seeded.state, seeded.turns, 'client', 'Нет, давайте лучше в восемь.');

    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.event?.meetingConsentQuality).toBe('clear');
    expect(result.state.nextStepAgreement?.status).toBe('agreed');
    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/20:00/iu);
    expect(result.state.nextStepAgreement?.action).toMatch(/10\s*минут/iu);
  });

  it('cancels the confirmed callback on an explicit availability rejection', () => {
    const seeded = agreedCallback();
    const result = advance(seeded.state, seeded.turns, 'client', 'Сегодня не получится.');

    expect(result.event?.type).toBe('NEXT_STEP_RESISTANCE');
    expect(result.event?.nextStepTarget).toBe('callback');
    expect(result.state.nextStepAgreement?.status).not.toBe('agreed');
    expect(result.state.agreedNextStep?.value).toBeNull();
  });

  it('updates only duration on an explicit duration correction', () => {
    const seeded = agreedCallback();
    const result = advance(seeded.state, seeded.turns, 'client', 'Давайте не 10, а 15 минут.');

    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement?.status).toBe('agreed');
    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/после\s+19:00/iu);
    expect(result.state.nextStepAgreement?.durationMinutes).toBe(15);
    expect(result.state.nextStepAgreement?.action).toMatch(/15\s*минут/iu);
  });

  it('updates channel/action on an explicit channel correction', () => {
    const seeded = agreedCallback();
    const result = advance(seeded.state, seeded.turns, 'client', 'Лучше не звонок, а видео.');

    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement?.status).toBe('agreed');
    expect(result.state.nextStepAgreement?.channel).toMatch(/видео/iu);
    expect(result.state.nextStepAgreement?.action).toMatch(/видео/iu);
    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/после\s+19:00/iu);
    expect(result.state.nextStepAgreement?.durationMinutes).toBe(10);
  });

  it('does not emit a usefulness re-check or clarification loop after reaffirmation', () => {
    const seeded = agreedCallback();
    const client = turn(`t${seeded.turns.length + 1}`, 'client', 'Хорошо, договорились.', seeded.turns.length + 1);
    const turns = [...seeded.turns, client];
    const analysis = buildLocalAnalysisResponse({
      sessionId: client.sessionId,
      revision: client.revision || turns.length,
      newTurns: [client],
      recentTurns: turns,
      currentState: seeded.state,
    });

    expect(analysis.eventType).toBeNull();
    expect(analysis.suggestedReply).toBeNull();
    expect(analysis.suggestedReply || '').not.toMatch(/встреча действительно полезна|что нужно прояснить/iu);
  });
});
