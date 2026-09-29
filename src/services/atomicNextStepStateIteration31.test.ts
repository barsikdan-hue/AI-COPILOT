import { describe, expect, it } from 'vitest';
import type { ConfirmedFact, ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation } from './localAnalysisEngine';

type Line = ['agent' | 'client', string];

const makeTurn = (
  id: string,
  speaker: 'agent' | 'client',
  text: string,
  revision: number,
): TranscriptTurn => ({
  id,
  sessionId: 'fix-31-atomic-next-step',
  source: speaker === 'agent' ? 'microphone' : 'call_audio',
  speaker,
  text,
  timestamp: revision * 1000,
  isFinal: true,
  revision,
});

function replay(lines: Line[], initialState: ConversationState = createInitialState()) {
  let state = initialState;
  const turns: TranscriptTurn[] = [];
  const clientStates: ConversationState[] = [];
  let event: ReturnType<typeof advanceLocalConversation>['event'] = null;

  for (let index = 0; index < lines.length; index += 1) {
    const revision = index + 1;
    const [speaker, text] = lines[index];
    const turn = makeTurn(`t${revision}`, speaker, text, revision);
    turns.push(turn);
    const result = advanceLocalConversation(state, turn, turns);
    state = result.state;
    if (speaker === 'client') {
      event = result.event;
      clientStates.push(structuredClone(state));
    }
  }

  return { state, turns, clientStates, event };
}

function activeNextStepFacts(state: ConversationState): ConfirmedFact[] {
  return (state.confirmedFacts || []).filter(
    (fact) =>
      fact.category === 'next_step' &&
      fact.lifecycleStatus !== 'superseded' &&
      fact.lifecycleStatus !== 'rejected',
  );
}

function expectAtomicNextStep(state: ConversationState) {
  const active = activeNextStepFacts(state);
  const hasCanonical = Boolean(state.agreedNextStep?.value) && state.nextStepAgreement?.status !== 'none';

  if (!hasCanonical) {
    expect(active).toHaveLength(0);
    return;
  }

  expect(active).toHaveLength(1);
  expect(active[0].value).toBe(state.agreedNextStep.value);
  expect(active[0].turnId).toBe(state.nextStepAgreement?.basisTurnId);
  expect(active[0].evidenceQuote).toBeTruthy();
  if (state.nextStepAgreement?.timeOrDeadline) {
    expect(active[0].value).toContain(state.nextStepAgreement.timeOrDeadline);
  }
  if (/созвон|звонок/iu.test(state.nextStepAgreement?.action || '')) {
    expect(active[0].value).toMatch(/созвон|звонок/iu);
  }
  if (/видео/iu.test(state.nextStepAgreement?.channel || '')) {
    expect(active[0].value).toMatch(/видео|показ/iu);
  }
}

const initialAgreement: Line[] = [
  ['agent', 'Давайте завтра созвонимся после шести.'],
  ['client', 'Хорошо, после шести удобно.'],
];

describe('FIX 31 atomic next-step state synchronization', () => {
  it('reproduces the exact Natalia P0-B chain without a final canonical/ledger conflict', () => {
    const result = replay([
      ['agent', 'Если вас это устроит, без проблем я могу отправить, но я бы хотел разговор с представителем застройщика по цене.'],
      ['client', 'цена не повысится в результате разговора застройщика, то да, меня это устроит вполне.'],
      ['agent', 'Тогда я хочу вам провести видеопрезентацию полноценную, чтобы вы поняли, что это за проект.'],
      ['client', 'Я просто хочу понять, что это за комплекс, потому что я ни разу его не встречала пока в предложениях нигде. Ну, если так удобнее, давайте я сама посмотрю, что это за комплекс, а потом уже обратимся за видео.'],
      ['agent', 'А когда мы можем с вами созвониться, Наталья, уже тогда договориться там о следующих действиях?'],
      ['client', 'Вы, получается, в воскресенье работаете? Тогда 10 июня.'],
      ['agent', 'Могу 9 вам позвонить, если хотите, но 10 тоже удобно.'],
      ['client', 'Да, давайте 10.'],
      ['agent', 'А 10 в какое время?'],
      ['client', 'Вот в это же самое. А, ну нет, получается в 10 по Москве.'],
    ]);

    expect(result.clientStates[1].agreedNextStep.value).toBeNull();
    expect(activeNextStepFacts(result.clientStates[1])).toHaveLength(0);
    expect(result.state.nextStepAgreement?.status).toBe('agreed');
    expect(result.state.agreedNextStep.value).toMatch(/созвон/iu);
    expectAtomicNextStep(result.state);
    expect(result.state.confirmedFacts.find((fact) => fact.value === 'Видеопоказ вариантов')?.lifecycleStatus)
      .toMatch(/superseded|rejected/iu);
  });

  it('synchronizes a new contextual agreement', () => {
    const result = replay(initialAgreement);

    expect(result.state.nextStepAgreement?.status).toBe('agreed');
    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/завтра.*после\s+18:00/iu);
    expectAtomicNextStep(result.state);
  });

  it('projects a generic agreed meeting when the client does not repeat the action type', () => {
    const result = replay([
      ['agent', 'Тогда завтра мы с вами в 10 утра встретимся. Предварительно вам напишу утром.'],
      ['client', 'Договорились, Софья.'],
    ]);

    expect(result.state.nextStepAgreement?.status).toBe('agreed');
    expect(result.state.agreedNextStep.value).toBeTruthy();
    expectAtomicNextStep(result.state);
  });

  it('synchronizes a contextual reschedule and retires the prior slot', () => {
    const result = replay([
      ['agent', 'Давайте созвонимся в понедельник в 16:00.'],
      ['client', 'Да, договорились.'],
      ['agent', 'Итак, созвон в понедельник в 16:00.'],
      ['client', 'Лучше во вторник после четырех.'],
    ]);

    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/вторник.*после\s+16:00/iu);
    expect(result.state.nextStepAgreement?.timeOrDeadline).not.toMatch(/понедельник/iu);
    expectAtomicNextStep(result.state);
    const oldFact = result.state.confirmedFacts.find(
      (fact) => fact.category === 'next_step' && fact.lifecycleStatus === 'superseded',
    );
    expect(oldFact?.lifecycleStatus).toBe('superseded');
  });

  it('synchronizes the canonical result of a date-only update', () => {
    const result = replay([
      ['agent', 'Давайте созвонимся в понедельник в 16:00.'],
      ['client', 'Да, договорились.'],
      ['agent', 'Если переносим созвон, какой день вам удобнее?'],
      ['client', 'Лучше во вторник.'],
    ]);

    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/вторник/iu);
    expectAtomicNextStep(result.state);
  });

  it('synchronizes the canonical result of a time-only update', () => {
    const result = replay([
      ['agent', 'Давайте завтра созвонимся.'],
      ['client', 'Да, договорились.'],
      ['agent', 'Для завтрашнего созвона во сколько вам удобно?'],
      ['client', 'Давайте в десять утра.'],
    ]);

    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/10:00/iu);
    expectAtomicNextStep(result.state);
  });

  it('keeps an ambiguous time-only change atomic without changing FIX 31 into the P0-C parser fix', () => {
    const result = replay([
      ['agent', 'Давайте завтра созвонимся.'],
      ['client', 'Да, договорились.'],
      ['agent', 'Для завтрашнего созвона во сколько вам удобно?'],
      ['client', 'Давайте в десять.'],
    ]);

    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/\d{1,2}:00/iu);
    expectAtomicNextStep(result.state);
  });

  it('synchronizes a combined date-and-time update', () => {
    const result = replay([
      ['agent', 'Давайте созвонимся в понедельник в 16:00.'],
      ['client', 'Да, договорились.'],
      ['agent', 'Когда перенесём созвон?'],
      ['client', 'Лучше во вторник в десять утра.'],
    ]);

    expect(result.state.nextStepAgreement?.timeOrDeadline).toMatch(/вторник.*10:00/iu);
    expectAtomicNextStep(result.state);
  });

  it('does not duplicate an active fact on reaffirmation', () => {
    const result = replay([
      ...initialAgreement,
      ['agent', 'Отлично, договорились: завтра после шести.'],
      ['client', 'Хорошо, договорились.'],
    ]);

    expect(result.event).toBeNull();
    expectAtomicNextStep(result.state);
    expect(activeNextStepFacts(result.state)).toHaveLength(1);
  });

  it('clears the active fact on cancellation while retaining history', () => {
    const result = replay([
      ...initialAgreement,
      ['agent', 'Отлично, договорились: завтра после шести.'],
      ['client', 'Нет, давайте отменим созвон.'],
    ]);

    expect(result.state.nextStepAgreement?.status).not.toBe('agreed');
    expect(result.state.agreedNextStep.value).toBeNull();
    expectAtomicNextStep(result.state);
    expect(result.state.confirmedFacts.some(
      (fact) => fact.category === 'next_step' && ['superseded', 'rejected'].includes(String(fact.lifecycleStatus)),
    )).toBe(true);
  });

  it('retains superseded evidence as history and links the current version to it', () => {
    const result = replay([
      ['agent', 'Давайте созвонимся в понедельник в 16:00.'],
      ['client', 'Да, договорились.'],
      ['agent', 'Итак, созвон в понедельник в 16:00.'],
      ['client', 'Лучше во вторник после четырех.'],
    ]);
    const facts = result.state.confirmedFacts.filter((fact) => fact.category === 'next_step');
    const current = activeNextStepFacts(result.state)[0];
    const previous = facts.find((fact) => fact.id === current.supersedesFactId);

    expect(facts.length).toBeGreaterThanOrEqual(2);
    expect(previous?.lifecycleStatus).toBe('superseded');
    expect(previous?.evidenceQuote).toBeTruthy();
    expectAtomicNextStep(result.state);
  });

  it('leaves unrelated canonical fields and fact lifecycles untouched', () => {
    const initial = createInitialState();
    initial.location = { value: 'Сочи', evidenceTurnIds: ['seed-location'] };
    initial.confirmedFacts.push({
      id: 'fact_seed_location',
      category: 'location',
      value: 'Сочи',
      evidenceQuote: 'Рассматриваю Сочи.',
      turnId: 'seed-location',
      confidence: 0.99,
      lifecycleStatus: 'confirmed',
      origin: 'client_explicit',
    });

    const result = replay(initialAgreement, initial);
    const locationFact = result.state.confirmedFacts.find((fact) => fact.id === 'fact_seed_location');

    expect(result.state.location).toEqual(initial.location);
    expect(locationFact?.lifecycleStatus).toBe('confirmed');
    expect(locationFact?.value).toBe('Сочи');
    expectAtomicNextStep(result.state);
  });
});
