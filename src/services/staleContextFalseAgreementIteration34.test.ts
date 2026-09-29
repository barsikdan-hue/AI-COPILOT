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
      sessionId: 'fix-34-stale-context-false-agreement',
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

function expectNoAgreement(result: ReturnType<typeof replay>) {
  expect(result.event?.type).not.toBe('MEETING_CONTRACT');
  expect(result.state.nextStepAgreement?.status).not.toBe('agreed');
  expect(result.state.agreedNextStep.value).toBeNull();
  expect(activeNextStepFacts(result.state)).toHaveLength(0);
}

function expectVideoAgreement(result: ReturnType<typeof replay>) {
  expect(result.event?.type).toBe('MEETING_CONTRACT');
  expect(result.state.nextStepAgreement?.status).toBe('agreed');
  expect(result.state.nextStepAgreement?.channel).toBe('видео');
  expect(result.state.agreedNextStep.value).toMatch(/видео/iu);
  expect(activeNextStepFacts(result.state)).toHaveLength(1);
}

describe('FIX 34 stale-context false agreement', () => {
  it('1: exact Nadezhda trust explanation does not accept an older video proposal', () => {
    expectNoAgreement(replay([
      ['agent', 'Я в Сочи, в центре Сочи. Если, как говорится, будет у вас желание, в дальнейшем я выйду на видео с вами, покажу вам наш офис, то есть как бы мы открыты.'],
      ['client', 'А можете мне просто инфу бросить в WhatsApp, пока хотя бы про вашу компанию почитать?'],
      ['agent', 'Конечно, безусловно.'],
      ['client', 'Потому что методом тыка вас определила по всплывающему окну, да, поэтому, прежде чем продолжать разговор, я бы про вас хотела поговорить.'],
    ]));
  });

  it('2: rejected video plus an answer to a newer Sochi question is not agreement', () => {
    expectNoAgreement(replay([
      ['agent', 'Давайте по видео.'],
      ['client', 'Нет, сначала пришлите информацию.'],
      ['agent', 'Хорошо. Вы раньше Сочи рассматривали?'],
      ['client', 'Да.'],
    ]));
  });

  it('2b: rejected video is not revived by a later budget acknowledgement', () => {
    expectNoAgreement(replay([
      ['agent', 'Хотите видеопрезентацию?'],
      ['client', 'Нет.'],
      ['agent', 'Цена до 10 миллионов подойдёт?'],
      ['client', 'Да.'],
    ]));
  });

  it('2c: rejected video stays stale across consecutive client turns', () => {
    expectNoAgreement(replay([
      ['agent', 'Хотите видеопрезентацию?'],
      ['client', 'Нет, сначала пришлите информацию.'],
      ['client', 'Да, материалы сначала.'],
    ]));
  });

  it('3: material-first state plus unrelated acknowledgement is not agreement', () => {
    expectNoAgreement(replay([
      ['agent', 'Можем завтра подробно выйти по видео: покажу офис, варианты и отвечу на ваши вопросы по объектам.'],
      ['client', 'Я сначала посмотрю материалы.'],
      ['agent', 'Хорошо.'],
      ['client', 'Да, понял.'],
    ]));
  });

  it('4: several unrelated turns make an old video proposal stale', () => {
    expectNoAgreement(replay([
      ['agent', 'Тогда видео оставим на потом: отдельно покажу офис, варианты и отвечу на вопросы по объектам.'],
      ['client', 'Сначала хочу понять район.'],
      ['agent', 'Понятно.'],
      ['client', 'Мне важна тишина.'],
      ['agent', 'Хорошо.'],
      ['client', 'Да.'],
    ]));
  });

  it('5: a newer financing topic owns the acknowledgement', () => {
    expectNoAgreement(replay([
      ['agent', 'Можем завтра по видео.'],
      ['client', 'Я сначала посмотрю материалы.'],
      ['agent', 'А ипотека интересна?'],
      ['client', 'Да.'],
    ]));
  });

  it('6: a newer callback proposal supersedes the old video proposal', () => {
    const result = replay([
      ['agent', 'Можем завтра по видео.'],
      ['client', 'Я сначала посмотрю материалы.'],
      ['agent', 'Тогда просто созвонимся завтра в 18:00, удобно?'],
      ['client', 'Да.'],
    ]);

    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement?.channel).toBe('созвон');
    expect(result.state.agreedNextStep.value).toMatch(/созвон/iu);
    expect(result.state.agreedNextStep.value).not.toMatch(/видео/iu);
    expect(activeNextStepFacts(result.state)).toHaveLength(1);
  });

  it('7: immediate yes still accepts a current video proposal', () => {
    expectVideoAgreement(replay([
      ['agent', 'Тогда завтра по видео удобно?'],
      ['client', 'Да.'],
    ]));
  });

  it('7b: deterministic projection accepts a current video proposal with a slot', () => {
    const result = replay([
      ['agent', 'Можем сегодня в 18:00 по видео.'],
      ['client', 'Хорошо.'],
    ]);

    expect(result.state.agreedNextStep.value).toMatch(/видео.*сегодня.*18:00/iu);
    expect(activeNextStepFacts(result.state)).toHaveLength(1);
  });

  it('8: explicit current slot still accepts video after materials', () => {
    const result = replay([
      ['agent', 'После материалов можем выйти на видео.'],
      ['client', 'Хорошо, тогда завтра в 18:00.'],
    ]);

    expectVideoAgreement(result);
    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/завтра.*18:00/iu);
  });

  it('9: Natalia conditional price phrase remains safe', () => {
    expectNoAgreement(replay([
      ['agent', 'Тогда не видеопрезентация, а разговор с представителем застройщика конкретно по цене. Если вас это устроит, могу отправить варианты.'],
      ['client', 'Цена не повысится в результате разговора застройщика, то да, меня это устроит вполне.'],
    ]));
  });

  it('10: an immediate callback agreement keeps callback type and final slot', () => {
    const result = replay([
      ['agent', 'Тогда просто созвонимся завтра в 18:00, удобно?'],
      ['client', 'Хорошо, завтра в 18:00 удобно.'],
    ]);

    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement).toMatchObject({
      channel: 'созвон',
      status: 'agreed',
    });
    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/завтра.*18:00/iu);
    expect(result.state.agreedNextStep.value).toMatch(/созвон.*завтра.*18:00/iu);
    expect(activeNextStepFacts(result.state)).toHaveLength(1);
  });
});
