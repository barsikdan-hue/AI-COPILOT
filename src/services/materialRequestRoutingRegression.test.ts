import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { applyConversationEvent, detectConversationEvent } from './conversationEventEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

const turn = (text: string, revision = 1): TranscriptTurn => ({
  id: `material-${revision}`,
  sessionId: 'material-request-routing',
  source: 'call_audio',
  speaker: 'client',
  text,
  timestamp: revision * 1000,
  isFinal: true,
  revision,
});

const questionCount = (text: string | null | undefined): number =>
  (text?.match(/\?/gu) || []).length;

describe('material request routing regression', () => {
  it.each([
    'Скиньте цены.',
    'Пришлите планировки.',
    'Пришлите варианты.',
  ])('routes %s through the material-request contract', (text) => {
    const client = turn(text);
    const event = detectConversationEvent(client, [client], createInitialState());

    expect(event?.type).toBe('MATERIAL_REQUEST');
    expect(event?.actionType).toBe('ANSWER');
    expect(event?.ruleId).toBe('material_request');
    expect(event?.suggestedReply).toBeTruthy();
    expect(event?.suggestedReply).not.toMatch(/^\s*(?:хорошо[,.:;]?\s*)?отправлю(?:\s+цены)?[.!]?\s*$/iu);
    expect(event?.suggestedReply).not.toMatch(/видеовстреч|видеопоказ|созвон/iu);
    expect(questionCount(event?.suggestedReply)).toBeLessThanOrEqual(1);
  });

  it.each([
    ['Можно посмотреть цены?', 'direct_question_general'],
    ['Сколько стоит квартира?', 'direct_question_price'],
  ])('keeps the legitimate direct question %s', (text, ruleId) => {
    const client = turn(text);
    const event = detectConversationEvent(client, [client], createInitialState());

    expect(event?.type).toBe('DIRECT_QUESTION');
    expect(event?.actionType).toBe('ANSWER');
    expect(event?.ruleId).toBe(ruleId);
  });

  it.each([
    'Просто скиньте цены, я сам посмотрю.',
    'Скиньте планировки, созваниваться не хочу.',
  ])('preserves material-first semantics without inventing resistance for %s', (text) => {
    const client = turn(text);
    const initial = createInitialState();
    const event = detectConversationEvent(client, [client], initial);

    expect(event?.type).toBe('MATERIAL_REQUEST');
    expect(event?.actionType).toBe('ANSWER');
    expect(event?.suggestedReply).not.toMatch(/видеовстреч|видеопоказ|созвон/iu);
    expect(questionCount(event?.suggestedReply)).toBeLessThanOrEqual(1);

    const next = applyConversationEvent(initial, event!, client);
    expect(next.dialogueControl?.softResistanceCount).toBe(0);
    expect(next.dialogueControl?.lastEventType).toBe('MATERIAL_REQUEST');
  });

  it('keeps material routing and facts from the same utterance aligned', () => {
    const client = turn('Пришлите варианты по 15–20 млн у моря.');
    const advanced = advanceLocalConversation(createInitialState(), client, [client]);

    expect(advanced.event?.type).toBe('MATERIAL_REQUEST');
    expect(advanced.event?.actionType).toBe('ANSWER');
    expect(advanced.state.budget.value).toMatch(/15.*20|20.*15/iu);
    expect(advanced.state.criteria.items.map((item) => item.text).join(' ')).toMatch(/мор/iu);

    const analysis = buildLocalAnalysisResponse({
      sessionId: client.sessionId,
      revision: client.revision ?? 1,
      newTurns: [client],
      recentTurns: [client],
      currentState: advanced.state,
    });
    expect(analysis.suggestedReply).toBeTruthy();
    expect(questionCount(analysis.suggestedReply)).toBeLessThanOrEqual(1);
    expect(analysis.suggestedReply).not.toMatch(/какой\s+бюджет|где\s+у\s+моря|видеовстреч|видеопоказ/iu);
  });
});
