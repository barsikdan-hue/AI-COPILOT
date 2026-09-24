import { describe, expect, it } from 'vitest';
import { createInitialState, mergeFactsDelta } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { applyConversationEvent, detectConversationEvent } from './conversationEventEngine';
import { advanceLocalConversation } from './localAnalysisEngine';
import { evaluateFirstCallScript } from './firstCallScriptEngine';
import type { TranscriptTurn } from '../types';

const turn = (id:string, speaker:'agent'|'client', text:string, revision:number): TranscriptTurn => ({
  id, sessionId:'s', source:speaker === 'agent' ? 'microphone' : 'call_audio', speaker, text,
  timestamp:revision*1000, isFinal:true, revision,
});

describe('RC4 stress-call regressions', () => {
  it('does not treat explicit refusal of video as meeting agreement', () => {
    const a = turn('a','agent','Отправлю до пяти вариантов. Как вам такой вариант?',1);
    const c = turn('c','client','Ладно, только без всяких видеопоказов. Я посмотрю на бумаге.',2);
    const state = createInitialState();
    const event = detectConversationEvent(c,[a,c],state);
    expect(event?.type).not.toBe('MEETING_CONTRACT');
  });

  it('detects PPV resistance when client asks for materials instead of video', () => {
    const a = turn('a','agent','Предлагаю короткий видеопоказ, покажем планировки.',1);
    const c = turn('c','client','Нет, скиньте мне всё сообщением, на видео я не выйду.',2);
    const event = detectConversationEvent(c,[a,c],createInitialState());
    expect(event?.type).toBe('NEXT_STEP_RESISTANCE');
    expect(event?.nextStepTarget).toBe('ppv');
  });

  it('does not confirm mortgage from explicit negative intent', () => {
    const facts = extractDeterministicFacts('У меня нет детей до 7 лет, и ипотеку я рассматривать не собираюсь.', 'c');
    expect(facts.some(f => f.field === 'paymentMethod' && /ипотек/iu.test(f.value))).toBe(false);
  });

  it('maps residential complex answer to property type in explicit question context', () => {
    const facts = extractDeterministicFacts('Скорее жилой комплекс, но точнее посмотрю позже.', 'c', 'Какой формат рассматриваете: апартаменты, жилой комплекс или дом?');
    expect(facts.some(f => f.field === 'propertyType' && /жилом комплексе/iu.test(f.value))).toBe(true);
  });

  it('keeps down payment context across short agent aside', () => {
    let state = createInitialState();
    const turns = [
      turn('a1','agent','Какой первоначальный взнос планируете задействовать для покупки?',1),
      turn('a2','agent','Заикаться стал с тобой.',2),
      turn('c1','client','Хорошо, я планирую 20% взноса. Теперь точно всё.',3),
    ];
    const out = advanceLocalConversation(state, turns[2], turns);
    expect(out.state.confirmedFacts.some(f => f.category === 'downPayment' && f.value === '20%')).toBe(true);
  });

  it('rejecting Krasnaya Polyana does not reject Sochi', () => {
    const c = turn('c','client','Давайте центр Сочи или Сириус. Красную Поляну пока не рассматриваю.',1);
    const event = detectConversationEvent(c,[c],createInitialState());
    expect(event?.rejectedBranch).toBe('Красная Поляна');
  });
});
