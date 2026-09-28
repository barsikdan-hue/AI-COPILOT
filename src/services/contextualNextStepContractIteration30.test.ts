import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

const makeTurn = (
  id: string,
  speaker: 'agent' | 'client',
  text: string,
  revision: number,
  sessionId = 'fix-30-contextual-next-step',
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

function replay(lines: Array<['agent' | 'client', string]>, initialState: ConversationState = createInitialState()) {
  let state = initialState;
  const turns: TranscriptTurn[] = [];
  let event: ReturnType<typeof advanceLocalConversation>['event'] = null;

  for (let index = 0; index < lines.length; index += 1) {
    const [speaker, text] = lines[index];
    const turn = makeTurn(`t${index + 1}`, speaker, text, index + 1);
    turns.push(turn);
    const result = advanceLocalConversation(state, turn, turns);
    state = result.state;
    if (speaker === 'client') event = result.event;
  }

  return { state, turns, event };
}

function lastAnalysis(result: ReturnType<typeof replay>) {
  const client = [...result.turns].reverse().find((turn) => turn.speaker === 'client')!;
  return buildLocalAnalysisResponse({
    sessionId: client.sessionId,
    revision: client.revision || result.turns.length,
    newTurns: [client],
    recentTurns: result.turns,
    currentState: result.state,
  });
}

describe('FIX 30 contextual next-step contract', () => {
  it('accepts a callback proposal without requiring the client to repeat the action type', () => {
    const result = replay([
      ['agent', 'Давайте завтра созвонимся после шести.'],
      ['client', 'Хорошо, после шести удобно.'],
    ]);

    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement?.status).toBe('agreed');
    expect(result.state.nextStepAgreement?.action).toMatch(/созвон/iu);
    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/завтра.*после\s+18:00/iu);
  });

  it('inherits the proposed slot from a contextual acceptance', () => {
    const result = replay([
      ['agent', 'Могу набрать вам завтра утром?'],
      ['client', 'Да, давайте.'],
    ]);

    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement?.status).toBe('agreed');
    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/завтра.*утром/iu);
  });

  it('uses a client-provided daypart as a contextual reschedule', () => {
    const result = replay([
      ['agent', 'Тогда сегодня в 18:00.'],
      ['client', 'Лучше завтра утром.'],
    ]);

    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement?.status).toBe('agreed');
    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/завтра.*утром/iu);
    expect(result.state.nextStepAgreement?.timeOrDeadline).not.toMatch(/сегодня|18:00/iu);
  });

  it('updates a contextual time window without changing the next-step type', () => {
    const result = replay([
      ['agent', 'Завтра после двух удобно?'],
      ['client', 'Лучше с четырёх до шести.'],
    ]);

    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement?.status).toBe('agreed');
    expect(result.state.nextStepAgreement?.action).toMatch(/созвон/iu);
    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/завтра.*с\s+16:00\s+до\s+18:00/iu);
  });

  it('does not turn a qualification answer into a next-step agreement', () => {
    const result = replay([
      ['agent', 'Для жизни рассматриваете?'],
      ['client', 'Да.'],
    ]);

    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement).toBeUndefined();
  });

  it('does not turn an acknowledgement without a proposal into an agreement', () => {
    const result = replay([
      ['client', 'Хорошо, понял.'],
    ]);

    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement).toBeUndefined();
  });

  it('keeps explicit callback resistance out of agreement state', () => {
    const result = replay([
      ['agent', 'Давайте созвонимся вечером.'],
      ['client', 'Нет, созваниваться не хочу.'],
    ]);

    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement?.status).not.toBe('agreed');
    expect(result.state.agreedNextStep?.value).toBeNull();
  });

  it('keeps an existing contract stable on reaffirmation without another event or card', () => {
    const agreed = replay([
      ['agent', 'Давайте завтра созвонимся после шести.'],
      ['client', 'Хорошо, после шести удобно.'],
    ]);
    const before = {
      agreement: agreed.state.nextStepAgreement,
      agreedNextStep: agreed.state.agreedNextStep,
      eventCount: agreed.state.events?.length,
    };
    const reaffirmed = replay([
      ['agent', 'Отлично, договорились: завтра после шести.'],
      ['client', 'Хорошо, договорились.'],
    ], agreed.state);

    expect(reaffirmed.event).toBeNull();
    expect(reaffirmed.state.nextStepAgreement).toEqual(before.agreement);
    expect(reaffirmed.state.agreedNextStep).toEqual(before.agreedNextStep);
    expect(reaffirmed.state.events?.length).toBe(before.eventCount);
    expect(lastAnalysis(reaffirmed).suggestedReply).toBeNull();
  });

  it('preserves explicit cancellation of an agreed callback', () => {
    const agreed = replay([
      ['agent', 'Давайте завтра созвонимся после шести.'],
      ['client', 'Хорошо, после шести удобно.'],
    ]);
    const cancelled = replay([
      ['agent', 'Отлично, договорились: завтра после шести.'],
      ['client', 'Нет, давайте отменим созвон.'],
    ], agreed.state);

    expect(cancelled.event?.type).not.toBe('MEETING_CONTRACT');
    expect(cancelled.state.nextStepAgreement?.status).not.toBe('agreed');
    expect(cancelled.state.agreedNextStep?.value).toBeNull();
  });

  const evidence: Array<{ id: string; lines: Array<['agent' | 'client', string]> }> = [
    {
      id: 'RCB-V1-005',
      lines: [
        ['agent', 'Всё, в течение 5-10 минут я вам напишу на Макс со своего личного номера. Скажите, вы завтра по времени как расположены? Ну, свободное время есть у вас завтра? Ну, буквально минут 30.'],
        ['client', 'Да, позвоните, напишите предварительный номер.'],
      ],
    },
    {
      id: 'RCB-V1-077',
      lines: [
        ['agent', 'Все, тогда будем на связи, Елен. Мы в режиме диалога, в режиме звонков завтра с вами будем. Договорились? А так планируем на 11.'],
        ['client', 'Договорились.'],
      ],
    },
    {
      id: 'RCB-V1-078',
      lines: [
        ['agent', 'А тогда завтра мы с вами в 10 утра встретимся. Предварительно вам напишу утром.'],
        ['client', 'Договорились, Софья.'],
      ],
    },
    {
      id: 'RCB-V1-079',
      lines: [
        ['agent', 'Ну давайте в понедельник по вашему времени, когда вам будет удобно, вот так вот созвониться на 20-30 минут.'],
        ['client', 'В понедельник, наверное, не получится, а во вторник, потому что понедельник день не успешный.'],
        ['agent', 'Понял. Ну давайте во вторник. В какое время?'],
        ['client', 'Ну, после четырех в Москве.'],
      ],
    },
    {
      id: 'RCB-V1-081',
      lines: [
        ['agent', 'Ну давайте в понедельник по вашему времени, когда вам будет удобно, вот так вот созвониться на 20-30 минут.'],
        ['client', 'В понедельник, наверное, не получится, а во вторник, потому что понедельник день не успешный.'],
      ],
    },
    {
      id: 'RCB-V1-082',
      lines: [
        ['agent', 'Мы можем сегодня где-то в районе через час созвониться по видеосвязи. Во сколько у вас есть время?'],
        ['client', 'Сегодня вот не получается.'],
        ['agent', 'Давайте тогда согласуем во сколько удобнее завтра. И в это время будем на связи, я вам отправлю ссылочку на Яндекс Телемост, мы с вами там встретимся.'],
        ['client', 'Сегодня не получится, через два дня только.'],
      ],
    },
  ];

  it.each(evidence)('replays the event-classification evidence case $id', ({ lines }) => {
    const result = replay(lines);

    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement).toBeDefined();
    if (lines.at(-1)?.[1].includes('во вторник')) {
      expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/вторник/iu);
      expect(result.state.nextStepAgreement?.timeOrDeadline).not.toMatch(/понедельник/iu);
    }
    if (lines.at(-1)?.[1].includes('через два дня')) {
      expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/через два дня/iu);
      expect(result.state.nextStepAgreement?.timeOrDeadline).not.toMatch(/сегодня/iu);
    }
  });
});
