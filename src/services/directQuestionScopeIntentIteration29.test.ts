import { describe, expect, it } from 'vitest';
import type { SpeakerRole, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { detectConversationEvent } from './conversationEventEngine';

function turn(id: string, speaker: SpeakerRole, text: string, revision = 1): TranscriptTurn {
  return {
    id,
    sessionId: 'fix-29',
    source: speaker === 'agent' ? 'microphone' : 'call_audio',
    speaker,
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

function eventFor(text: string, previousAgentText: string | null = null) {
  const client = turn('c1', 'client', text, previousAgentText ? 2 : 1);
  const turns = previousAgentText
    ? [turn('a1', 'agent', previousAgentText, 1), client]
    : [client];
  return detectConversationEvent(client, turns, createInitialState());
}

describe('FIX 29 direct-question scope and intent resolution', () => {
  it('A resolves the final meta question and never leaks “видеть” into property details', () => {
    const event = eventFor('Мне нравится видеть результат. Что конкретно вы хотите уточнить?');

    expect(event?.type).toBe('DIRECT_QUESTION');
    expect(event?.ruleId).toBe('direct_question_general');
    expect(event?.suggestedReply).not.toMatch(/конкретному объекту|2–3 вариантов/iu);
  });

  it.each([
    'Что конкретно вы хотите уточнить?',
    'Что именно вы хотите узнать?',
    'Что вы хотите спросить?',
    'Что конкретно вас интересует?',
  ])('B/C recognizes a meta/general question: %s', (text) => {
    const event = eventFor(text);
    expect(event?.type).toBe('DIRECT_QUESTION');
    expect(event?.ruleId).toBe('direct_question_general');
  });

  it.each([
    'Какой там вид из окна?',
    'Есть вид на море?',
    'Какая у объекта видовая характеристика?',
  ])('D/E keeps property-view questions in property details: %s', (text) => {
    const event = eventFor(text);
    expect(event?.type).toBe('DIRECT_QUESTION');
    expect(event?.ruleId).toBe('direct_question_property_details');
  });

  it('F lets the final price question win over an earlier “видеть” token', () => {
    const event = eventFor('Я хочу видеть результат. Какая цена квартиры?');
    expect(event?.ruleId).toBe('direct_question_price');
  });

  it('G lets the final price question win over earlier mortgage context', () => {
    const event = eventFor('По ипотеке я пока только изучаю условия. Какая цена этой квартиры?');
    expect(event?.ruleId).toBe('direct_question_price');
  });

  it('H lets the final financing question win over earlier price context', () => {
    const event = eventFor('Цену квартиры я понял. Какая ставка по ипотеке?');
    expect(event?.ruleId).toBe('direct_question_financing');
  });

  it('does not treat “ликвидность … да?” as a property-view question or a real direct question', () => {
    const event = eventFor('Слушайте, для меня важна ликвидность, чтобы можно было перепродать и не потеряться в стоимости, да? И при этом никаких апартов и серых схем мне не надо.');
    expect(event?.type).not.toBe('DIRECT_QUESTION');
  });

  it('resolves a genuine property-use question instead of a generic meta fallback', () => {
    const event = eventFor('Подождите, другой вопрос. ЛПХ: отдыхать самому или другому сдавать?');
    expect(event?.type).toBe('DIRECT_QUESTION');
    expect(event?.ruleId).toBe('direct_question_property_details');
    expect(event?.suggestedReply).not.toMatch(/какой именно момент/iu);
  });

  it.each([
    ['Сколько стоит квартира?', 'direct_question_price'],
    ['Какие документы есть по объекту?', 'direct_question_documents'],
    ['Какая ставка по ипотеке?', 'direct_question_financing'],
    ['Скиньте цены и планировки?', 'direct_question_materials_request'],
    ['Что реально интересного есть у моря?', 'direct_question_market_options'],
  ])('preserves neighboring intent %s', (text, ruleId) => {
    const event = eventFor(text);
    expect(event?.type).toBe('DIRECT_QUESTION');
    expect(event?.ruleId).toBe(ruleId);
  });

  it('preserves the dedicated next-step route', () => {
    const event = eventFor('Понятно. Тогда следующий шаг какой?');
    expect(event?.type).toBe('DIRECT_QUESTION');
    expect(event?.ruleId).toBe('direct_question_next_step');
  });
});
