import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation } from './localAnalysisEngine';
import { detectConversationEvent } from './conversationEventEngine';
import { detectLocalObjection } from './objectionEngine';
import { extractDeterministicFacts } from './deterministicFacts';
import { evaluateSpinAndHpb, createInitialSpinState } from './spinEngine';
import { extractSemanticKey } from './semanticAntiRepeat';

const turn = (id: string, speaker: 'agent' | 'client', text: string, revision: number): TranscriptTurn => ({
  id,
  sessionId: 'session12-regression',
  source: speaker === 'agent' ? 'microphone' : 'call_audio',
  speaker,
  text,
  timestamp: 1_790_249_650_000 + revision * 1000,
  isFinal: true,
  revision,
});

describe('session 12 field regression', () => {
  it('answers a broad market-options question with a relevant investment bridge, not the generic no-facts phrase', () => {
    const client = turn(
      'c1',
      'client',
      'У меня есть свободные деньги, смотрю, куда разумно вложить. Что реально интересного есть, чтобы не терять время?',
      1
    );
    const event = detectConversationEvent(client, [client], createInitialState());
    expect(event?.type).toBe('DIRECT_QUESTION');
    expect(event?.ruleId).toBe('direct_question_market_options');
    expect(event?.suggestedReply).toMatch(/2–3|2-3|доход|ликвид|рост/iu);
    expect(event?.suggestedReply).not.toMatch(/если точного факта сейчас нет/iu);
  });

  it('recognizes an embedded yield question without a question mark', () => {
    const client = turn(
      'c1',
      'client',
      'Я вообще-то вопрос задал. Хотел узнать, сколько на практике такие объекты приносят, без рекламных обещаний.',
      1
    );
    const event = detectConversationEvent(client, [client], createInitialState());
    expect(event?.type).toBe('DIRECT_QUESTION');
    expect(event?.ruleId).toBe('direct_question_yield_comparison');
  });

  it('routes the deposit challenge as an objection rather than a generic direct question', () => {
    const client = turn(
      'c1',
      'client',
      'У меня деньги сейчас лежат на депозите. Если недвижимость даст меньше, зачем вообще менять инструмент?',
      1
    );
    const event = detectConversationEvent(client, [client], createInitialState());
    expect(event?.type).not.toBe('DIRECT_QUESTION');
    const objection = detectLocalObjection(client.text, createInitialState(), null);
    expect(objection?.category).toBe('objection_yield');
  });

  it('treats a request for prices and floor plans as a material request', () => {
    const client = turn(
      'c1',
      'client',
      'Слушайте, может, просто скинете мне пару вариантов, цены, планировки? Я сначала сам посмотрю.',
      1
    );
    const event = detectConversationEvent(client, [client], createInitialState());
    expect(event?.ruleId).toBe('direct_question_materials_request');
    expect(event?.suggestedReply).toMatch(/отправлю|2–3|2-3|цен|планиров/iu);
    expect(event?.suggestedReply).not.toMatch(/по конкретному объекту отвечу/iu);
  });

  it('routes "не хочу никаких презентаций" to PPV resistance even when client asks why', () => {
    const agent = turn('a1', 'agent', 'Давайте тогда короткую видеопрезентацию?', 1);
    const client = turn('c1', 'client', 'А почему нельзя просто отправить? Я пока не хочу никаких презентаций.', 2);
    const event = detectConversationEvent(client, [agent, client], createInitialState());
    expect(event?.type).toBe('NEXT_STEP_RESISTANCE');
    expect(event?.nextStepTarget).toBe('ppv');
    expect(event?.suggestedReply).toMatch(/видео|показ|дав|комфорт|сначала/iu);
  });

  it('keeps investment as primary goal when client also visits personally and rejects relocation', () => {
    const state0 = createInitialState();
    const client = turn(
      'c1',
      'client',
      'Я вроде уже сказал, это инвестиция, иногда самому приезжать, а переезжать я не собираюсь.',
      1
    );
    const state = advanceLocalConversation(state0, client, [client]).state;
    expect(state.primaryGoal?.value).toMatch(/инвестиц/iu);
    expect(state.goal.value).toMatch(/инвестиц/iu);
    expect(state.secondaryUse?.value).toMatch(/приезд|отдых/iu);
    expect(state.goal.value).not.toMatch(/постоянн.*прожив|пмж/iu);
    expect(state.scriptProgress?.metrics.goal.value).toMatch(/инвестиц/iu);
  });

  it('keeps the accepted flat formats and excludes a house', () => {
    const agent = turn('a1', 'agent', 'Какой формат жилья вам подходит — квартира или апартаменты?', 1);
    const client = turn('c1', 'client', 'Дом я вообще не хочу, рассматриваю квартиру или апартаменты.', 2);
    const state = advanceLocalConversation(createInitialState(), agent, [agent]).state;
    const next = advanceLocalConversation(state, client, [agent, client]).state;
    expect(next.dialogueControl?.rejectedBranches).toContain('дом');
    expect(next.dialogueControl?.rejectedBranches).not.toContain('апартаменты');
    expect(next.propertyType?.value).toMatch(/квартир/iu);
    expect(next.propertyType?.value).toMatch(/апартамент/iu);
    expect(next.scriptProgress?.metrics.propertyType.value).not.toMatch(/дом или квартира/iu);
  });

  it('understands spoken budget correction "не 10 миллионов, а шесть"', () => {
    const facts = extractDeterministicFacts(
      'Нет, я неправильно сказал вначале. Не 10 миллионов, а шесть — это предел. Ориентируемся на эту сумму.',
      'c1'
    );
    const budget = facts.find((fact) => fact.field === 'budget');
    expect(budget?.value).toBe('6 млн руб');
    expect(budget?.isFlexible).toBe(false);
  });

  it('does not turn hobby/personal-rest context into an implication of comparison overload', () => {
    const spin = createInitialSpinState();
    spin.situation = [
      { text: 'Изучает рынок', evidenceQuote: 'смотрю рынок', evidenceTurnId: 's1', source: 'client', confidence: 0.95 },
    ];
    spin.problem = [
      { text: 'Перегруз одинаковыми презентациями', evidenceQuote: 'куча одинаковых презентаций и не понимаю отличия', evidenceTurnId: 'p1', source: 'client', confidence: 0.95 },
    ];
    spin.currentStage = 'IMPLICATION';
    spin.completedStages = ['SITUATION', 'PROBLEM'];
    const client = turn(
      'c1',
      'client',
      'Я вообще люблю гулять, иногда играем с друзьями в настольные игры, читаю. На отдыхе мне скорее важно спокойно переключиться.',
      2
    );
    const result = evaluateSpinAndHpb(
      client,
      spin,
      'asked_implication_question',
      'К чему это приводит и как влияет на ваше решение?',
      createInitialState()
    );
    expect(result.suggestionMode).toBe('WAIT');
    expect(result.updatedSpin.implication).toHaveLength(0);
  });

  it('normalizes LPR semantic key despite ё and an inserted verb', () => {
    expect(extractSemanticKey('Кто ещё будет участвовать в выборе и с кем нужно будет обсудить варианты?'))
      .toBe('ask_decision_makers');
  });
});
