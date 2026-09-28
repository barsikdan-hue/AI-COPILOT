import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { applyConversationEvent, detectConversationEvent } from './conversationEventEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

const turn = (text: string, revision = 1): TranscriptTurn => ({
  id: `material-intent-${revision}`,
  sessionId: 'material-request-intent-iteration-21',
  source: 'call_audio',
  speaker: 'client',
  text,
  timestamp: revision * 1000,
  isFinal: true,
  revision,
});

function analyze(text: string) {
  const client = turn(text);
  const initial = createInitialState();
  const event = detectConversationEvent(client, [client], initial);
  const advanced = advanceLocalConversation(initial, client, [client]);
  const response = buildLocalAnalysisResponse({
    sessionId: client.sessionId,
    revision: client.revision ?? 1,
    newTurns: [client],
    recentTurns: [client],
    currentState: advanced.state,
  });
  return { client, initial, event, state: advanced.state, response };
}

describe('FIX ITERATION 21: material request intent lexicon', () => {
  it.each([
    ['Пришлите прайс.', 'SOFT_RESISTANCE'],
    ['Скиньте каталог.', 'SOFT_RESISTANCE'],
    ['Отправьте презентацию.', 'SOFT_RESISTANCE'],
    ['Пришлите фото.', 'SOFT_RESISTANCE'],
    ['Скиньте подборку.', 'SOFT_RESISTANCE'],
    ['Планировки отправьте.', 'SOFT_RESISTANCE'],
    ['Цены можно прислать?', 'DIRECT_QUESTION'],
    ['Прайс можете скинуть?', 'DIRECT_QUESTION'],
    ['Каталог мне отправьте.', 'SOFT_RESISTANCE'],
    ['Фото бы посмотреть.', 'SOFT_RESISTANCE'],
    ['Подборку пришлите, пожалуйста.', 'SOFT_RESISTANCE'],
    ['Можно просто получить варианты планировок?', 'DIRECT_QUESTION'],
  ])('routes the explicit or reordered request: %s', (text, expectedType) => {
    const { event, response } = analyze(text);

    expect(event?.type).toBe(expectedType);
    expect(event?.ruleId).toBe(expectedType === 'SOFT_RESISTANCE'
      ? 'soft_resistance_materials'
      : 'direct_question_materials_request');
    expect(event?.actionType).toBe(expectedType === 'SOFT_RESISTANCE' ? 'CLARIFY' : 'ANSWER');
    expect(response.eventType).toBe(expectedType);
    expect(response.suggestedReply).toMatch(/отправ|пришл/iu);
    expect(response.suggestedReply).not.toMatch(/видеовстреч|видеопоказ|созвон|какой\s+бюджет/iu);
  });

  it.each([
    'Планировки пришлите, дальше сам посмотрю.',
    'Скиньте каталог, я потом изучу.',
  ])('keeps material routing together with self-service: %s', (text) => {
    const { event, state, response } = analyze(text);

    expect(event?.type).toBe('SOFT_RESISTANCE');
    expect(event?.ruleId).toBe('soft_resistance_materials');
    expect(state.dialogueControl?.softResistanceCount).toBe(1);
    expect(response.suggestedReply).toMatch(/отправ|пришл/iu);
    expect(response.suggestedReply).not.toMatch(/видеовстреч|видеопоказ|созвон/iu);
  });

  it.each([
    'Я тороплюсь, просто скиньте цены.',
    'Сейчас некогда, отправьте презентацию.',
  ])('preserves the time boundary and the requested material: %s', (text) => {
    const { event, state, response } = analyze(text);

    expect(event?.type).toBe('TIME_CONSTRAINT');
    expect(state.dialogueControl?.clientBoundaryActive).toBe(true);
    expect(response.eventType).toBe('TIME_CONSTRAINT');
    expect(response.suggestedReply).toMatch(/отправ|пришл|материал/iu);
    expect(response.suggestedReply).not.toMatch(/видеовстреч|видеопоказ|созвон|какой\s+бюджет/iu);
  });

  it('keeps the no-video boundary without blocking a material follow-up', () => {
    const client = turn('Каталог можно, видеопоказ пока не предлагайте.');
    const initial = createInitialState();
    const event = detectConversationEvent(client, [client], initial);
    const next = applyConversationEvent(initial, event!, client);

    expect(event?.type).toBe('NEXT_STEP_RESISTANCE');
    expect(event?.nextStepTarget).toBe('ppv');
    expect(next.dialogueControl?.nextStepResistanceHistory?.ppv?.status).toBe('detected');
    expect(next.dialogueControl?.blockedNextSteps || []).not.toContain('materials');
  });

  it.each([
    ['Какая цена у этой квартиры?', 'DIRECT_QUESTION'],
    ['Расскажите про планировку.', null],
    ['У вас есть фотографии стройки?', 'DIRECT_QUESTION'],
    ['Почему цена выросла?', 'DIRECT_QUESTION'],
    ['Каталог хороший.', null],
    ['Я уже видел презентацию.', null],
    ['Какая планировка у этой квартиры?', 'DIRECT_QUESTION'],
  ])('does not turn a factual question, statement or past experience into a material request: %s', (text, expectedType) => {
    const { event } = analyze(text!);

    expect(event?.type ?? null).toBe(expectedType);
    expect(event?.ruleId).not.toBe('soft_resistance_materials');
  });
});
