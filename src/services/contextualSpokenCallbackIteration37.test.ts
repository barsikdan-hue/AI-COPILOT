import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation } from './localAnalysisEngine';

type Line = ['agent' | 'client', string];

function replay(lines: Line[]) {
  let state = createInitialState();
  const turns: TranscriptTurn[] = [];
  const clientSteps: Array<{ event: ReturnType<typeof advanceLocalConversation>['event']; state: ConversationState }> = [];
  lines.forEach(([speaker, text], index) => {
    const revision = index + 1;
    const turn: TranscriptTurn = {
      id: `fix37-t${revision}`,
      sessionId: 'fix37-spoken-callback',
      source: speaker === 'client' ? 'call_audio' : 'microphone',
      speaker,
      text,
      timestamp: revision * 1000,
      isFinal: true,
      revision,
    };
    turns.push(turn);
    const advanced = advanceLocalConversation(state, turn, turns);
    state = advanced.state;
    if (speaker === 'client') clientSteps.push({ event: advanced.event, state });
  });
  return { state, clientSteps, event: clientSteps.at(-1)?.event || null };
}

function activeNextStepFacts(state: ConversationState) {
  return state.confirmedFacts.filter((fact) =>
    fact.category === 'next_step' && !['superseded', 'rejected'].includes(String(fact.lifecycleStatus)),
  );
}

function expectCallback(state: ConversationState, day: RegExp, time: RegExp) {
  expect(state.nextStepAgreement?.status).toBe('agreed');
  expect(state.nextStepAgreement?.channel).toBe('созвон');
  expect(state.nextStepAgreement?.timeOrDeadline).toMatch(day);
  expect(state.nextStepAgreement?.timeOrDeadline).toMatch(time);
  expect(state.agreedNextStep.value).toMatch(/созвон/iu);
  expect(state.agreedNextStep.value).toContain(state.nextStepAgreement!.timeOrDeadline!);
  expect(activeNextStepFacts(state)).toHaveLength(1);
  expect(activeNextStepFacts(state)[0].value).toBe(state.agreedNextStep.value);
}

const nadezhdaExchange: Line[] = [
  ['client', 'Давайте по времени еще секунду.'],
  ['agent', 'Давайте.'],
  ['client', 'Наверное, завтра вечером.'],
  ['agent', 'Какое время?'],
  ['client', 'После семнадцати, давайте попробуем.'],
  ['agent', 'В восемнадцать, семнадцать тридцать, как вам удобно.'],
  ['client', 'Давайте в восемнадцать вот так накрутимся.'],
];

describe('FIX 37: active contextual spoken callback', () => {
  it('keeps Nadezhda’s tentative tomorrow, refines the window, then agrees an 18:00 callback', () => {
    const { clientSteps, state, event } = replay(nadezhdaExchange);
    expect(clientSteps[1].event?.type).toBe('MEETING_CONTRACT');
    expect(clientSteps[1].state.nextStepAgreement).toMatchObject({
      channel: 'созвон',
      status: 'discussing',
    });
    expect(clientSteps[1].state.nextStepAgreement?.timeOrDeadline).toMatch(/завтра.*вечером/iu);
    expect(clientSteps[1].state.agreedNextStep.value).toBeNull();

    expect(clientSteps[2].event?.type).toBe('MEETING_CONTRACT');
    expect(clientSteps[2].state.nextStepAgreement?.timeOrDeadline).toMatch(/завтра.*после\s+17:00/iu);
    expect(clientSteps[2].state.nextStepAgreement?.status).toBe('discussing');

    expect(event?.type).toBe('MEETING_CONTRACT');
    expectCallback(state, /завтра/iu, /(?:^|\s)в\s+18:00/iu);
    expect(state.nextStepAgreement?.timeOrDeadline).not.toMatch(/сегодня|17:00|видео/iu);
  });

  it('inherits only the immediately active callback question for tomorrow evening', () => {
    const result = replay([
      ['agent', 'Когда вам удобно созвониться?'],
      ['client', 'Наверное, завтра вечером.'],
      ['agent', 'Какое время?'],
      ['client', 'Давайте в восемнадцать.'],
    ]);
    expect(result.clientSteps[0].state.nextStepAgreement?.timeOrDeadline).toMatch(/завтра.*вечером/iu);
    expectCallback(result.state, /завтра/iu, /18:00/iu);
  });

  it.each([
    ['в восемнадцать', /в\s+18:00/iu],
    ['к восемнадцати', /18:00/iu],
    ['часов в восемнадцать', /в\s+18:00/iu],
    ['после семнадцати', /после\s+17:00/iu],
  ])('parses the spoken hour and its temporal relation: %s', (answer, time) => {
    const result = replay([
      ['agent', 'Давайте завтра созвонимся. Во сколько удобно?'],
      ['client', `Да, ${answer}.`],
    ]);
    expectCallback(result.state, /завтра/iu, time);
  });

  it('preserves an active explicit tomorrow when only the time window changes', () => {
    const result = replay([
      ['agent', 'Давайте завтра созвонимся.'],
      ['client', 'Хорошо, завтра вечером.'],
      ['agent', 'Во сколько?'],
      ['client', 'После 17, давайте попробуем.'],
    ]);
    expectCallback(result.state, /завтра/iu, /после\s+17:00/iu);
    expect(result.state.nextStepAgreement?.timeOrDeadline).not.toMatch(/сегодня/iu);
  });

  it('does not invent today for a first time-only answer with no explicit date', () => {
    const result = replay([
      ['agent', 'Когда вам удобно созвониться?'],
      ['client', 'После семнадцати.'],
    ]);
    expect(result.event?.type).toBe('MEETING_CONTRACT');
    expect(result.event?.meetingContract?.dateOrDay).toBeNull();
    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/после\s+17:00/iu);
    expect(result.state.nextStepAgreement?.timeOrDeadline).not.toMatch(/сегодня/iu);
  });

  it('does not invent today for evening-only scheduling', () => {
    const result = replay([
      ['agent', 'Когда вам удобно созвониться?'],
      ['client', 'Вечером.'],
    ]);
    expect(result.event?.meetingContract?.dateOrDay).toBeNull();
    expect(result.state.nextStepAgreement?.timeOrDeadline).not.toMatch(/сегодня/iu);
  });

  it('does not agree to a spoken hour explicitly ruled out by the client', () => {
    const result = replay([
      ['agent', 'Когда вам удобно созвониться?'],
      ['client', 'В восемнадцать никак, у меня работа.'],
    ]);
    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expect(result.state.agreedNextStep.value).toBeNull();
  });

  it.each([
    'В восемнадцать я не могу.',
    'В восемнадцать мне не подходит.',
  ])('does not agree to a declined hour with an intervening pronoun: %s', (answer) => {
    const result = replay([
      ['agent', 'Когда вам удобно созвониться?'],
      ['client', answer],
    ]);
    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expect(result.state.agreedNextStep.value).toBeNull();
  });

  it('takes the replacement hour in a spoken contrast rather than the rejected hour', () => {
    const result = replay([
      ['agent', 'Давайте завтра созвонимся. Во сколько удобно?'],
      ['client', 'Не в восемнадцать, а в девятнадцать.'],
    ]);
    expectCallback(result.state, /завтра/iu, /19:00/iu);
    expect(result.state.nextStepAgreement?.timeOrDeadline).not.toMatch(/18:00/iu);
  });

  it.each([
    'В восемнадцать я не могу, лучше в девятнадцать.',
    'В восемнадцать никак, давайте в девятнадцать.',
  ])('keeps a positive replacement even when the first hour is refused: %s', (answer) => {
    const result = replay([
      ['agent', 'Давайте завтра созвонимся. Во сколько удобно?'],
      ['client', answer],
    ]);
    expectCallback(result.state, /завтра/iu, /19:00/iu);
    expect(result.state.nextStepAgreement?.timeOrDeadline).not.toMatch(/18:00/iu);
  });

  it.each([
    'В восемнадцать миллионов не уложусь.',
    'В восемнадцать лет я переехала.',
    'В восемнадцать минут не уложимся.',
    'В восемнадцать объектов я уже вложилась.',
  ])('does not read a spoken non-clock quantity as the callback hour: %s', (answer) => {
    const result = replay([
      ['agent', 'Когда вам удобно созвониться?'],
      ['client', answer],
    ]);
    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expect(result.state.agreedNextStep.value).toBeNull();
  });

  it('lets a later explicit today override inherited tomorrow', () => {
    const result = replay([
      ['agent', 'Давайте завтра созвонимся.'],
      ['client', 'Хорошо, завтра вечером.'],
      ['agent', 'Во сколько?'],
      ['client', 'Нет, давайте сегодня в восемнадцать.'],
    ]);
    expectCallback(result.state, /сегодня/iu, /18:00/iu);
    expect(result.state.nextStepAgreement?.timeOrDeadline).not.toMatch(/завтра/iu);
  });

  it('lets a later explicit day-after-tomorrow override inherited tomorrow', () => {
    const result = replay([
      ['agent', 'Давайте завтра созвонимся.'],
      ['client', 'Хорошо, завтра вечером.'],
      ['agent', 'Во сколько?'],
      ['client', 'Лучше послезавтра в восемнадцать.'],
    ]);
    expectCallback(result.state, /послезавтра/iu, /18:00/iu);
    expect(result.state.nextStepAgreement?.timeOrDeadline).not.toMatch(/^завтра/iu);
  });

  it('uses the replacement date after rejecting a previously agreed calendar date', () => {
    const result = replay([
      ['agent', 'Давайте 10 июня созвонимся.'],
      ['client', 'Да, 10 июня.'],
      ['agent', 'Во сколько?'],
      ['client', 'Нет, 10 июня не получается, лучше завтра в восемнадцать.'],
    ]);
    expectCallback(result.state, /завтра/iu, /18:00/iu);
    expect(result.state.nextStepAgreement?.timeOrDeadline).not.toMatch(/10\s+июня/iu);
  });

  it('retains callback type through a time-only refinement despite an older video mention', () => {
    const result = replay([
      ['agent', 'Позже обсудим видеовстречу.'],
      ['client', 'Сначала пришлите материалы.'],
      ...nadezhdaExchange,
    ]);
    expectCallback(result.state, /завтра/iu, /18:00/iu);
    expect(result.state.agreedNextStep.value).not.toMatch(/видео/iu);
  });

  it('does not reuse a distant video action after an active callback contract', () => {
    const result = replay([
      ['agent', 'Давайте завтра созвонимся.'],
      ['client', 'Да, завтра вечером.'],
      ['agent', 'Позже можем выйти по видео.'],
      ['client', 'Нет, оставим созвон.'],
      ['agent', 'Что ещё важно при выборе?'],
      ['client', 'Тишина.'],
      ['agent', 'Какой бюджет рассматриваете?'],
      ['client', 'Пока не решил.'],
      ['agent', 'Есть пожелания по району?'],
      ['client', 'Обсудим позже.'],
      ['agent', 'Во сколько?'],
      ['client', 'Давайте в восемнадцать.'],
    ]);
    expectCallback(result.state, /завтра/iu, /18:00/iu);
    expect(result.state.agreedNextStep.value).not.toMatch(/видео/iu);
  });

  it('does not treat a budget question as callback scheduling or revive a stale video channel', () => {
    const result = replay([
      ['agent', 'Давайте завтра созвонимся.'],
      ['client', 'Хорошо, завтра вечером.'],
      ['agent', 'Позже обсудим видеовстречу.'],
      ['client', 'Сначала пришлите материалы.'],
      ['agent', 'Какая площадь нужна?'],
      ['client', 'Около 80 квадратных метров.'],
      ['agent', 'Во сколько оцениваете бюджет?'],
      ['client', 'В восемнадцать.'],
    ]);
    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement?.channel).toBe('созвон');
    expect(result.state.agreedNextStep.value).not.toMatch(/видео/iu);
  });

  it('does not treat a client time preface as acceptance of a video proposal interrupted by materials', () => {
    const result = replay([
      ['agent', 'Позже можем выйти по видео.'],
      ['client', 'Сначала пришлите материалы.'],
      ['client', 'Давайте по времени еще секунду.'],
    ]);
    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement?.status).not.toBe('agreed');
    expect(result.state.agreedNextStep.value).toBeNull();
  });

  it('does not revive an old callback from an unrelated habitual 18:00 mention', () => {
    const result = replay([
      ['agent', 'Давайте завтра созвонимся.'],
      ['client', 'Сначала изучу материалы.'],
      ['agent', 'Какой бюджет рассматриваете?'],
      ['client', 'В восемнадцать я обычно уже дома.'],
    ]);
    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expect(result.state.nextStepAgreement?.status).not.toBe('agreed');
    expect(result.state.agreedNextStep.value).toBeNull();
    expect(activeNextStepFacts(result.state)).toHaveLength(0);
  });

  it('does not revive an old callback from an unrelated yes', () => {
    const result = replay([
      ['agent', 'Давайте завтра созвонимся.'],
      ['client', 'Сначала изучу материалы.'],
      ['agent', 'А ипотеку рассматриваете?'],
      ['client', 'Да.'],
    ]);
    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expect(result.state.agreedNextStep.value).toBeNull();
  });

  it('does not turn an old video proposal into a spoken-hour agreement', () => {
    const result = replay([
      ['agent', 'Давайте завтра по видео.'],
      ['client', 'Нет, сначала материалы.'],
      ['agent', 'Какой бюджет рассматриваете?'],
      ['client', 'В восемнадцать я уже дома.'],
    ]);
    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expect(result.state.agreedNextStep.value).toBeNull();
  });

  it('preserves FIX32’s explicit date, clock and timezone merge', () => {
    const result = replay([
      ['agent', 'Давайте 10 июня созвонимся.'],
      ['client', 'Да, 10 июня.'],
      ['agent', 'Во сколько?'],
      ['client', 'В 10 по Москве.'],
    ]);
    expectCallback(result.state, /10\s+июня/iu, /10:00.*по\s+москве/iu);
  });

  it('keeps FIX34’s stale video proposal unaccepted by unrelated acknowledgement', () => {
    const result = replay([
      ['agent', 'Давайте завтра по видео.'],
      ['client', 'Нет, сначала пришлите материалы.'],
      ['agent', 'Какая цена вам подходит?'],
      ['client', 'Да.'],
    ]);
    expect(result.event?.type).not.toBe('MEETING_CONTRACT');
    expect(result.state.agreedNextStep.value).toBeNull();
  });
});
