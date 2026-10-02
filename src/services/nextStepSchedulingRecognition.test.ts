import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './test-support/nextStepSchedulingRecognition.json';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation } from './localAnalysisEngine';
import { suggestionFromEvent } from './conversationEventEngine';
import { checkSemanticAntiRepeat, extractSemanticKey } from './semanticAntiRepeat';
import { isSuggestionAllowedByState } from './suggestionLifecycle';

const u531 = fixture.find(s => s.sessionId.endsWith('_u531'))!;
const gjy4 = fixture.find(s => s.sessionId.endsWith('_gjy4'))!;
const canonical = 'Понял, не отвлекаю. Когда конкретно вернуться к разговору — сегодня вечером или завтра?';
const natural = 'Когда конкретно вернемся к разговору?';

function replay(turns: TranscriptTurn[], initial = createInitialState()) {
  let state = initial;
  let event: ReturnType<typeof advanceLocalConversation>['event'] = null;
  const clock = vi.spyOn(Date, 'now');
  for (let i = 0; i < turns.length; i++) {
    clock.mockReturnValue(turns[i].timestamp);
    const advanced = advanceLocalConversation(state, turns[i], turns.slice(0, i + 1));
    state = advanced.state;
    event = advanced.event;
  }
  const last = turns.at(-1)!;
  const candidate = event && suggestionFromEvent(event, last.sessionId, last.revision!, last.timestamp);
  return { state, event, candidate, turns };
}

function live(session: typeof u531, revision: number, agentText?: string, clientText?: string) {
  return replay(session.turns.filter(t => t.revision <= revision).map(t => ({ ...t,
    ...(t.revision === revision - 1 && agentText ? { text: agentText } : {}),
    ...(t.revision === revision && clientText ? { text: clientText } : {}),
  })) as TranscriptTurn[]);
}

function pair(agent: string, client: string, state = createInitialState()) {
  return replay([agent, client].map((text, i) => ({
    id: `scheduling-${i}`, sessionId: 'scheduling-recognition', source: i ? 'call_audio' : 'microphone',
    speaker: i ? 'client' : 'agent', text, timestamp: 1790943500000 + i * 1000,
    isFinal: true, revision: i + 1,
  })) as TranscriptTurn[], state);
}

function callbackState(): ConversationState {
  const state = createInitialState();
  state.nextStepAgreement = { action: 'Созвон', channel: 'созвон', timeOrDeadline: 'завтра', status: 'discussing' };
  state.dialogueControl = { ...state.dialogueControl!, clientBoundaryActive: true, boundaryMode: 'defer' };
  return state;
}

function expectCandidate(result: ReturnType<typeof replay>) {
  expect(result.candidate).toBeTruthy();
  const candidate = result.candidate!;
  expect(isSuggestionAllowedByState(candidate, result.state, result.turns.at(-1)!.revision)).toBe(true);
  expect(checkSemanticAntiRepeat(candidate, result.state, result.turns.slice(-6)).accepted).toBe(true);
  return candidate;
}

afterEach(() => vi.restoreAllMocks());

describe('current callback scheduling recognition and progression', () => {
  it('advances original u531 rev21 without repeating the day or inventing an hour', () => {
    const result = live(u531, 21);
    const candidate = expectCandidate(result);
    expect(candidate.text).toMatch(/завтра/iu);
    expect(candidate.text).toMatch(/во сколько|в какое время/iu);
    expect(candidate.text).toMatch(/5\s*минут/iu);
    expect(candidate.text).toMatch(/без допросов/iu);
    expect(candidate.text).not.toMatch(/вечером|\d{1,2}:\d{2}/iu);
    expect(extractSemanticKey(candidate.text)).not.toBe('custom_понял_не_отвлекаю_когда_конкре');
    expect(result.state.nextStepAgreement).toMatchObject({ timeOrDeadline: 'завтра', durationMinutes: 5, status: 'discussing' });
    expect(result.state.nextStepAgreement?.expectedResult).toMatch(/без допросов/iu);
    expect(result.state.dialogueControl?.timeContract).toBeNull();
  });

  it.each([undefined, canonical])('captures original gjy4 rev8 clock with proposal %s', agent => {
    const result = live(gjy4, 8, agent);
    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement).toMatchObject({ channel: 'созвон', timeOrDeadline: 'завтра в 14:05', status: 'agreed' });
    expectCandidate(result);
  });

  it('progresses the original gjy4 conversation through approximate time and closes the current call', () => {
    const atTime = live(gjy4, 12);
    expect(atTime.event?.type).toBe('MEETING_CONTRACT');
    expect(atTime.state.nextStepAgreement?.timeOrDeadline).toBe('завтра после обеда ближе к 15:00');
    expect(atTime.state.nextStepAgreement?.expectedResult).toMatch(/коротко и по делу/iu);
    expectCandidate(atTime);
    const final = live(gjy4, 14);
    const candidate = expectCandidate(final);
    expect(candidate.text).toMatch(/завтра.*ближе к 15:00/iu);
    expect(candidate.text).not.toMatch(/сегодня.*или.*завтра|для какой задачи/iu);
    expect(final.state.nextStepAgreement?.timeOrDeadline).toBe('завтра после обеда ближе к 15:00');
  });

  it('publishes the gjy4 time update within cooldown of the new rev8 confirmation', () => {
    const first = live(gjy4, 8);
    const update = live(gjy4, 12);
    expect(update.candidate!.createdAt - first.candidate!.createdAt).toBeLessThan(30000);
    // A changed appointment needs an update card; repeating the same confirmation
    // prefix would make the unchanged UI semantic cooldown swallow this update.
    expect(extractSemanticKey(update.candidate!.text)).not.toBe(extractSemanticKey(first.candidate!.text));
    expect(update.candidate!.text).toMatch(/ближе к 15:00/iu);
  });

  it.each([natural, canonical])('keeps day-only selection incomplete under %s', agent => {
    const result = pair(agent, 'Завтра коротко.');
    expect(result.event?.type).toBe('TIME_CONSTRAINT');
    expect(result.candidate?.text).toMatch(/во сколько|в какое время/iu);
    expect(result.state.nextStepAgreement).toMatchObject({ status: 'discussing', timeOrDeadline: 'завтра' });
    expect(result.state.agreedNextStep.value).toBeNull();
    expect(result.candidate?.text).not.toMatch(/вечером|\d{1,2}:\d{2}/iu);
  });

  it.each([
    ['Завтра, минут на пять.', 5, undefined],
    ['Завтра, только без допросов.', undefined, /без допросов/iu],
    ['Завтра коротко, 5 минут, без допросов.', 5, /без допросов/iu],
  ] as const)('keeps day, duration and constraints across the subsequent time answer: %s', (text, duration, constraint) => {
    const first = pair(canonical, text);
    expect(first.event?.type).toBe('TIME_CONSTRAINT');
    expect(first.state.nextStepAgreement?.timeOrDeadline).toBe('завтра');
    if (duration) expect(first.state.nextStepAgreement?.durationMinutes).toBe(duration);
    if (constraint) expect(first.state.nextStepAgreement?.expectedResult).toMatch(constraint);
    const second = pair('Во сколько удобно коротко созвониться?', 'В 18:00.', first.state);
    expect(second.event?.type).toBe('MEETING_CONTRACT');
    expect(second.state.nextStepAgreement?.timeOrDeadline).toBe('завтра в 18:00');
    if (duration) expect(second.state.nextStepAgreement?.durationMinutes).toBe(duration);
    if (constraint) expect(second.state.nextStepAgreement?.expectedResult).toMatch(constraint);
    const active = second.state.confirmedFacts.filter(f => f.category === 'next_step' && !['superseded', 'rejected'].includes(f.lifecycleStatus || ''));
    expect(active).toHaveLength(1);
    expect(active[0].value).toBe(second.state.agreedNextStep.value);
    expect(second.state.dialogueControl?.timeContract).toBeNull();
  });

  it.each([
    ['После обеда ближе к трём, если коротко и по делу.', 'завтра после обеда ближе к 15:00'],
    ['После трёх, если коротко и по делу.', 'завтра после 15:00'],
    ['Завтра в 15:00, если коротко и по делу.', 'завтра в 15:00'],
  ])('updates the existing callback before a competing time-boundary candidate: %s', (text, slot) => {
    const result = pair('Уточним время созвона — какой вариант удобен?', text, callbackState());
    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement?.timeOrDeadline).toBe(slot);
    expect(result.state.agreedNextStep.value).toContain(slot);
    expect(result.candidate?.text).not.toMatch(/для какой задачи/iu);
    expect(result.state.nextStepAgreement?.expectedResult).toMatch(/коротко и по делу/iu);
  });

  it.each([
    'Завтра не могу, минут на пять.',
    'Завтра или послезавтра, без допросов.',
    'Завтра можно? Только без допросов.',
    'Завтра у меня праздник, минут на пять.',
    'Завтра можно, но завтра не смогу. Коротко.',
  ])('does not select a rejected, ambiguous or unrelated day: %s', text => {
    const result = pair(canonical, text);
    expect(result.candidate?.text || '').not.toMatch(/во сколько|в какое время/iu);
    expect(result.state.nextStepAgreement?.status).not.toBe('agreed');
  });

  it('does not consume a current active window as tomorrow callback timing', () => {
    const result = pair('Уточним время созвона?', 'Сейчас пять минут есть, завтра занят. Давайте коротко.', callbackState());
    expect(result.event?.type).toBe('TIME_CONSTRAINT');
    expect(result.state.nextStepAgreement?.timeOrDeadline).toBe('завтра');
  });

  it.each([
    'Сейчас в три свободен, коротко и по делу.',
    'Сейчас свободен, после трёх уже занят. Коротко и по делу.',
    'Сейчас пять минут есть, завтра в дороге после трёх. Давайте коротко.',
  ])('does not inherit tomorrow for explicitly current availability: %s', text => {
    const result = pair('Уточним время созвона?', text, callbackState());
    expect(result.event?.type).toBe('TIME_CONSTRAINT');
    expect(result.state.nextStepAgreement?.timeOrDeadline).toBe('завтра');
    expect(result.state.nextStepAgreement?.status).toBe('discussing');
    expect(result.state.nextStepAgreement?.durationMinutes).toBeUndefined();
  });

  it('does not claim the agreed callback is preserved when the client rejects it', () => {
    const state = callbackState();
    state.nextStepAgreement = { ...state.nextStepAgreement!, status: 'agreed', timeOrDeadline: 'завтра в 18:00' };
    state.agreedNextStep = { value: 'Созвон завтра в 18:00', evidenceTurnIds: [] };
    const result = pair('Уточним время созвона?', 'Завтра коротко не подходит.', state);
    expect(result.candidate?.text || '').not.toMatch(/сохраняем/iu);
  });

  it('keeps an explicit stop ahead of existing callback progression', () => {
    const result = pair('Уточним время созвона?', 'После трёх не звоните. Больше не звоните.', callbackState());
    expect(result.event?.type).toBe('CLIENT_STOP');
    expect(result.state.nextStepAgreement?.timeOrDeadline).toBe('завтра');
  });

  it.each([
    'Не ближе к трём, если коротко и по делу.',
    'Только не ближе к трём, если коротко и по делу.',
    'Только не после трёх, если коротко и по делу.',
    'После трёх не надо, если коротко и по делу.',
    'После трёх? Если коротко и по делу.',
    'Ближе к трём дням, если коротко и по делу.',
    'Ближе к трём или к четырём, если коротко и по делу.',
  ])('does not advance the callback from negated or questioned timing: %s', text => {
    const result = pair('Уточним время созвона — какой вариант удобен?', text, callbackState());
    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement?.timeOrDeadline).toBe('завтра');
    expect(result.state.agreedNextStep.value).toBeNull();
  });

  it('does not treat a stale callback as context for an unrelated time answer', () => {
    const result = pair('Во сколько дети приходят из школы?', 'После трёх, если коротко и по делу.', callbackState());
    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement?.timeOrDeadline).toBe('завтра');
  });

  it('advances an explicit future slot when the client cannot speak now', () => {
    const result = pair('Уточним время созвона?', 'Сейчас не могу, завтра в 18:00, если коротко и по делу.', callbackState());
    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement?.timeOrDeadline).toBe('завтра в 18:00');
  });

  it.each(['Ближе к трём или к четырём.', 'Ближе к трём?'])('does not invent a confirmed approximate slot from %s', text => {
    const result = pair('Уточним время созвона?', text, callbackState());
    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement?.timeOrDeadline).toBe('завтра');
  });
});
