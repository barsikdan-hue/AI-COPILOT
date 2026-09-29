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
      sessionId: 'fix-33-false-video-agreement',
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

  return { state, event };
}

function activeNextStepFacts(state: ConversationState) {
  return state.confirmedFacts.filter((fact) =>
    fact.category === 'next_step' && !['superseded', 'rejected'].includes(String(fact.lifecycleStatus))
  );
}

function expectNoVideoAgreement(result: ReturnType<typeof replay>) {
  expect(result.event?.type).not.toBe('MEETING_CONTRACT');
  expect(result.state.nextStepAgreement?.status).not.toBe('agreed');
  expect(result.state.agreedNextStep.value).toBeNull();
  expect(activeNextStepFacts(result.state)).toHaveLength(0);
}

function expectAgreedVideo(result: ReturnType<typeof replay>) {
  expect(result.event?.type).toBe('MEETING_CONTRACT');
  expect(result.event?.meetingContract?.channel).toBe('видео');
  expect(result.state.nextStepAgreement?.status).toBe('agreed');
  expect(result.state.nextStepAgreement?.channel).toBe('видео');
  expect(result.state.agreedNextStep.value).toMatch(/видео/iu);
  expect(activeNextStepFacts(result.state)).toHaveLength(1);
}

describe('FIX 33 false video agreement', () => {
  it('A: explicit rejection does not create a video agreement', () => {
    expectNoVideoAgreement(replay([
      ['agent', 'Давайте проведём видеопрезентацию.'],
      ['client', 'Нет, мне она не нужна.'],
    ]));
  });

  it('B: a material-first request is not a video agreement', () => {
    expectNoVideoAgreement(replay([
      ['agent', 'Давайте проведём видеопрезентацию.'],
      ['client', 'Сначала пришлите информацию.'],
    ]));
  });

  it('C: future openness after self-review is not a current agreement', () => {
    expectNoVideoAgreement(replay([
      ['agent', 'Давайте проведём видеопрезентацию.'],
      ['client', 'Я посмотрю, потом можно по видео.'],
    ]));
  });

  it('D: conditional video openness after interest is not a current agreement', () => {
    expectNoVideoAgreement(replay([
      ['agent', 'Давайте проведём видеопрезентацию.'],
      ['client', 'Если понравится, тогда можно созвониться по видео.'],
    ]));
  });

  it('E: explicit agreement to tomorrow video creates a contract', () => {
    const result = replay([
      ['agent', 'Давайте проведём видеопрезентацию.'],
      ['client', 'Хорошо, давайте завтра по видео.'],
    ]);

    expectAgreedVideo(result);
    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/завтра/iu);
  });

  it('F: explicit agreement to video at a concrete time creates a contract', () => {
    const result = replay([
      ['agent', 'Можем сегодня провести видеопрезентацию.'],
      ['client', 'Да, можно сегодня в 18:00.'],
    ]);

    expectAgreedVideo(result);
    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/сегодня.*18:00/iu);
  });

  it('G: generic acknowledgement is not an agreement', () => {
    expectNoVideoAgreement(replay([
      ['agent', 'Можно будет провести видеопрезентацию.'],
      ['client', 'Ну, буду иметь в виду.'],
    ]));
  });

  it('H: promise to review and write later is not an agreement', () => {
    expectNoVideoAgreement(replay([
      ['agent', 'Давайте проведём видеопрезентацию.'],
      ['client', 'Посмотрю и напишу.'],
    ]));
  });

  it('I: unrelated acknowledgement does not resurrect a rejected video proposal', () => {
    const rejected = replay([
      ['agent', 'Давайте проведём видеопрезентацию.'],
      ['client', 'Нет, видео не нужно.'],
    ]);
    const result = replay([
      ['agent', 'Хорошо, тогда отправлю информацию.'],
      ['client', 'Да, хорошо.'],
    ], rejected.state);

    expectNoVideoAgreement(result);
  });

  it('J: explicit later acceptance can create video agreement after material-first state', () => {
    const materialFirst = replay([
      ['agent', 'Давайте проведём видеопрезентацию.'],
      ['client', 'Сначала пришлите информацию.'],
    ]);
    const result = replay([
      ['agent', 'Материалы отправил. Если подходят, можем завтра провести видеопрезентацию.'],
      ['client', 'Материалы подходят. Хорошо, давайте завтра в 18:00 по видео.'],
    ], materialFirst.state);

    expectAgreedVideo(result);
    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/завтра.*18:00/iu);
  });

  it('replays Natalia’s conditional price phrase without creating video agreement', () => {
    expectNoVideoAgreement(replay([
      ['agent', 'Тогда не видеопрезентация, а разговор с представителем застройщика конкретно по цене. Если вас это устроит, могу отправить варианты.'],
      ['client', 'Цена не повысится в результате разговора застройщика, то да, меня это устроит вполне.'],
    ]));
  });

  it.each([
    'Если цена не повысится после разговора с застройщиком, то да.',
    'Сначала пришлите, потом можно созвониться.',
    'Если понравится, тогда по видео.',
    'Я сама посмотрю, потом обратимся за видео.',
    'Ну да, может быть потом.',
    'Да, но сейчас видео не нужно.',
    'Хорошо, информацию пришлите.',
  ])('does not project a deterministic agreement from non-current meaning: %s', (clientText) => {
    expectNoVideoAgreement(replay([
      ['agent', 'Предлагаю провести видеопрезентацию.'],
      ['client', clientText],
    ]));
  });

  it.each([
    'Да, давайте завтра по видео.',
    'Хорошо, сегодня в 18:00.',
    'Договорились, созвонимся завтра.',
    'Да, можно.',
  ])('preserves explicit current agreement with a relevant proposal: %s', (clientText) => {
    expectAgreedVideo(replay([
      ['agent', 'Предлагаю провести видеопрезентацию.'],
      ['client', clientText],
    ]));
  });

  it('does not invent a video contract from standalone “Да, можно”', () => {
    expectNoVideoAgreement(replay([
      ['client', 'Да, можно.'],
    ]));
  });
});
