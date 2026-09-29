import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation } from './localAnalysisEngine';

type Line = ['agent' | 'client', string];

function replay(lines: Line[], initialState: ConversationState = createInitialState()) {
  let state = initialState;
  const turns: TranscriptTurn[] = [];
  let event: ReturnType<typeof advanceLocalConversation>['event'] = null;

  for (let index = 0; index < lines.length; index += 1) {
    const [speaker, text] = lines[index];
    const turn: TranscriptTurn = {
      id: `t${index + 1}`,
      sessionId: 'fix-32-final-next-step-date-time',
      source: speaker === 'agent' ? 'microphone' : 'call_audio',
      speaker,
      text,
      timestamp: (index + 1) * 1000,
      isFinal: true,
      revision: index + 1,
    };
    turns.push(turn);
    const advanced = advanceLocalConversation(state, turn, turns);
    state = advanced.state;
    if (speaker === 'client') event = advanced.event;
  }

  return { state, event, turns };
}

function activeNextStepFacts(state: ConversationState) {
  return state.confirmedFacts.filter((fact) =>
    fact.category === 'next_step' && !['superseded', 'rejected'].includes(String(fact.lifecycleStatus))
  );
}

function expectSlot(state: ConversationState, date: RegExp, time: RegExp, timezone?: RegExp) {
  expect(state.nextStepAgreement?.status).toBe('agreed');
  expect(state.nextStepAgreement?.timeOrDeadline).toMatch(date);
  expect(state.nextStepAgreement?.timeOrDeadline).toMatch(time);
  if (timezone) expect(state.nextStepAgreement?.timeOrDeadline).toMatch(timezone);
  expect(state.agreedNextStep.value).toContain(state.nextStepAgreement!.timeOrDeadline!);
  const active = activeNextStepFacts(state);
  expect(active).toHaveLength(1);
  expect(active[0].value).toBe(state.agreedNextStep.value);
  expect(active[0].turnId).toBe(state.nextStepAgreement?.basisTurnId);
}

const juneTenAtTen: Line[] = [
  ['agent', 'Давайте 10 июня.'],
  ['client', 'Да.'],
  ['agent', 'Во сколько?'],
  ['client', 'В 10 по Москве.'],
];

describe('FIX 32 final next-step date/time preservation', () => {
  it('replays the exact Natalia final callback and preserves date, time and timezone context', () => {
    const result = replay([
      ['agent', 'А когда мы можем с вами созвониться, Наталья, уже тогда договориться там о следующих действиях?'],
      ['client', 'Вы, получается, в воскресенье работаете? Тогда 10 июня.'],
      ['agent', 'Могу 9 вам позвонить, если хотите, но 10 тоже удобно.'],
      ['client', 'Да, давайте 10.'],
      ['agent', 'А 10 в какое время?'],
      ['client', 'Вот в это же самое. А, ну нет, получается в 10 по Москве.'],
    ]);

    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.event?.meetingContract?.dateOrDay).toMatch(/10\s+июня/iu);
    expect(result.event?.meetingContract?.time).toMatch(/10:00.*по\s+москве/iu);
    expectSlot(result.state, /10\s+июня/iu, /10:00/iu, /по\s+москве/iu);
  });

  it('combines a date agreed first with a later time answer', () => {
    const result = replay(juneTenAtTen);

    expectSlot(result.state, /10\s+июня/iu, /10:00/iu, /по\s+москве/iu);
  });

  it('combines an agent-proposed time with a later client date', () => {
    const result = replay([
      ['agent', 'В 10 утра удобно?'],
      ['client', 'Да, но давайте 10 июня.'],
    ]);

    expectSlot(result.state, /10\s+июня/iu, /10:00/iu);
  });

  it('inherits an unchanged concrete slot from “в это же время”', () => {
    const result = replay([
      ...juneTenAtTen,
      ['agent', 'Оставляем этот слот?'],
      ['client', 'В это же время.'],
    ]);

    expectSlot(result.state, /10\s+июня/iu, /10:00/iu, /по\s+москве/iu);
  });

  it('gives an explicit correction priority over “в это же время”', () => {
    const result = replay([
      ['agent', 'Давайте 10 июня в 12:00 по Москве.'],
      ['client', 'Да, договорились.'],
      ['agent', 'Время оставляем прежнее?'],
      ['client', 'Вот в это же самое. А, ну нет, получается в 10 по Москве.'],
    ]);

    expectSlot(result.state, /10\s+июня/iu, /10:00/iu, /по\s+москве/iu);
    expect(result.state.nextStepAgreement?.timeOrDeadline).not.toMatch(/12:00/iu);
  });

  it('updates only the date and retains the existing time and month context', () => {
    const result = replay([
      ...juneTenAtTen,
      ['agent', 'Оставляем договорённость?'],
      ['client', 'Лучше 11-го.'],
    ]);

    expectSlot(result.state, /11\s+июня/iu, /10:00/iu, /по\s+москве/iu);
    expect(result.state.nextStepAgreement?.timeOrDeadline).not.toMatch(/10\s+июня/iu);
  });

  it('updates only the time and retains the existing date', () => {
    const result = replay([
      ...juneTenAtTen,
      ['agent', 'Оставляем договорённость?'],
      ['client', 'Давайте лучше в 12.'],
    ]);

    expectSlot(result.state, /10\s+июня/iu, /12:00/iu, /по\s+москве/iu);
  });

  it('replaces both date and time in one explicit correction', () => {
    const result = replay([
      ...juneTenAtTen,
      ['agent', 'Оставляем договорённость?'],
      ['client', 'Давайте 11-го в 15:00.'],
    ]);

    expectSlot(result.state, /11\s+июня/iu, /15:00/iu, /по\s+москве/iu);
    expect(result.state.nextStepAgreement?.timeOrDeadline).not.toMatch(/10\s+июня|10:00/iu);
  });

  it('preserves the complete slot on reaffirmation without a duplicate fact', () => {
    const result = replay([
      ...juneTenAtTen,
      ['agent', 'Отлично, 10 июня в 10:00 по Москве.'],
      ['client', 'Да, договорились.'],
    ]);

    expect(result.event).toBeNull();
    expectSlot(result.state, /10\s+июня/iu, /10:00/iu, /по\s+москве/iu);
  });

  it('clears the active contract after explicit cancellation', () => {
    const result = replay([
      ...juneTenAtTen,
      ['agent', 'Отлично, 10 июня в 10:00 по Москве.'],
      ['client', 'Нет, давайте отменим созвон.'],
    ]);

    expect(result.state.nextStepAgreement?.status).not.toBe('agreed');
    expect(result.state.agreedNextStep.value).toBeNull();
    expect(activeNextStepFacts(result.state)).toHaveLength(0);
  });

  it('does not turn an unrelated number into a callback time', () => {
    const result = replay([
      ...juneTenAtTen,
      ['agent', 'Какой бюджет рассматриваете?'],
      ['client', 'Около 10 миллионов.'],
    ]);

    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expectSlot(result.state, /10\s+июня/iu, /10:00/iu, /по\s+москве/iu);
  });

  it('does not inherit a stale slot through an unrelated intervening question', () => {
    const result = replay([
      ['agent', 'Давайте 10 июня в 10 утра.'],
      ['client', 'Я сначала посмотрю материалы.'],
      ['agent', 'Какой бюджет рассматриваете?'],
      ['client', 'Да.'],
    ]);

    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement?.status).not.toBe('agreed');
    expect(result.state.agreedNextStep.value).toBeNull();
    expect(activeNextStepFacts(result.state)).toHaveLength(0);
  });

  it('does not treat an unrelated “давайте как поступим” workday question as a dated proposal', () => {
    const result = replay([
      ['agent', 'Знаете, давайте как поступим. Как у вас сегодня: рабочий день или выходной?'],
      ['client', 'Я выходная сегодня.'],
    ]);

    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement).toBeUndefined();
    expect(result.state.agreedNextStep.value).toBeNull();
    expect(activeNextStepFacts(result.state)).toHaveLength(0);
  });
});
