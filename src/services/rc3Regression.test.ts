import { describe, expect, it } from 'vitest';
import { TranscriptTurn } from '../types';
import { createInitialState, mergeFactsDelta } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { evaluateFirstCallScript, isOpenPersonalQuestion, isOpenTechnicalQuestion } from './firstCallScriptEngine';
import { classifyAgentAction, createInitialSpinState, evaluateSpinAndHpb } from './spinEngine';
import { detectNextStepResistance } from './objectionEngine';

const turn = (id: string, speaker: 'agent' | 'client', text: string, revision: number): TranscriptTurn => ({
  id, sessionId: 'rc3', source: speaker === 'agent' ? 'microphone' : 'call_audio', speaker, text,
  timestamp: 1000 + revision, isFinal: true, revision,
});

describe('4.0.2-rc.3 field regressions 2026-09-23', () => {
  it('does not extract "срочно" from "долгосрочной"', () => {
    const facts = extractDeterministicFacts(
      'Больше всего сомнений вызывает стабильность спроса в долгосрочной перспективе.',
      'c1'
    );
    expect(facts.some(f => f.field === 'purchaseTimeline' && f.value === 'срочно')).toBe(false);
  });

  it('keeps a concrete 2-3 month timeline when later vague urgency arrives', () => {
    const a = turn('a1', 'agent', 'Когда планируете выйти на сделку?', 1);
    const c1 = turn('c1', 'client', 'Ориентируемся на 2-3 месяца.', 2);
    const c2 = turn('c2', 'client', 'В целом вопрос важный.', 3);
    let state = createInitialState();
    state = mergeFactsDelta(state, extractDeterministicFacts(c1.text, c1.id, a.text) as any, undefined, undefined, 2, { c1: c1.text });
    state = mergeFactsDelta(state, [{ category: 'timeline', field: 'purchaseTimeline', value: 'срочно', evidenceQuote: 'срочно', evidenceTurnId: c2.id, confidence: .95, status: 'confirmed' }] as any, undefined, undefined, 3, { c2: 'срочно' });
    expect(state.purchaseTimeline?.value).toMatch(/2-3/);
  });

  it('recognizes implication questions and stores the next client answer as implication', () => {
    const a = turn('a1', 'agent', 'Как вы думаете, как этот дискомфорт повлияет на вас в перспективе трёх лет?', 1);
    const c = turn('c1', 'client', 'Мы будем постоянно испытывать дискомфорт, и это усложнит последующую продажу.', 2);
    expect(classifyAgentAction(a.text)).toBe('asked_implication_question');
    const result = evaluateSpinAndHpb(c, createInitialSpinState(), classifyAgentAction(a.text), a.text);
    expect(result.updatedSpin.implication.length).toBeGreaterThan(0);
  });

  it('counts contextual technical and dopamine questions toward trust', () => {
    expect(isOpenTechnicalQuestion('Какой ошибки вы больше всего хотите избежать при выборе?')).toBe(true);
    expect(isOpenTechnicalQuestion('Что сейчас вызывает наибольшие сомнения по покупке?')).toBe(true);
    expect(isOpenPersonalQuestion('Когда последний раз были в Сочи, что вам запомнилось больше всего?')).toBe(true);
    expect(isOpenPersonalQuestion('Чем увлекаетесь в свободное время?')).toBe(true);
  });

  it('detects implicit PPI deferral from "ставки уточним когда будем увереннее"', () => {
    const state = createInitialState();
    const r = detectNextStepResistance(
      'Параметры объекта сначала посмотрим, а ставки уже уточним, когда будем более уверены в выборе.',
      state,
      'Давайте подключим ипотечного брокера.'
    );
    expect(r?.target).toBe('ppi');
    expect(r?.reopened).toBe(false);
  });

  it('closes PPI when client explicitly agrees to mortgage specialist consultation', () => {
    const turns = [
      turn('a1', 'agent', 'Давайте подключим нашего ипотечного брокера, он бесплатно подберёт варианты.', 1),
      turn('c1', 'client', 'Хорошо, давайте подключим. Назначьте время.', 2),
      turn('a2', 'agent', 'Давайте в 16:00.', 3),
      turn('c2', 'client', 'Да, договорились, в 16:00 подключимся к брокеру.', 4),
    ];
    const state = createInitialState();
    const progress = evaluateFirstCallScript(turns, state);
    expect(progress.metrics.ppi.status).toBe('confirmed');
  });

  it('does not replace chosen apartment type from generic market analytics about apartments', () => {
    const chosen = extractDeterministicFacts('Я больше склоняюсь к квартире в жилом комплексе.', 'c1', 'Какой формат жилья вам подходит?');
    let state = mergeFactsDelta(createInitialState(), chosen as any, undefined, undefined, 1, { c1: 'Я больше склоняюсь к квартире в жилом комплексе.' });
    const market = extractDeterministicFacts('В сегменте апартаментов у моря доходность иногда выше.', 'c2', 'Что слышали о доходности рынка?');
    state = mergeFactsDelta(state, market as any, undefined, undefined, 2, { c2: 'В сегменте апартаментов у моря доходность иногда выше.' });
    expect(state.propertyType?.value).toBe('Квартира');
  });
});
