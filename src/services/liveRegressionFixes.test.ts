import { describe, expect, it } from 'vitest';
import { ConversationState, TranscriptTurn } from '../types';
import { createInitialState, mergeFactsDelta } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { evaluateFirstCallScript, isConcreteTimeline } from './firstCallScriptEngine';
import { createInitialSpinState, evaluateSpinAndHpb } from './spinEngine';

const turn = (id: string, speaker: 'agent' | 'client', text: string, revision: number): TranscriptTurn => ({
  id,
  sessionId: 'regression_session',
  source: speaker === 'agent' ? 'microphone' : 'call_audio',
  speaker,
  text,
  timestamp: 1_000 + revision,
  isFinal: true,
  revision,
});

describe('live-call regressions from 2026-09-22 field test', () => {
  it('treats "до декабря" as a concrete deadline and closes urgency', () => {
    const agent = turn('a1', 'agent', 'До декабря мы сможем с вами закрыть этот вопрос?', 1);
    const client = turn('c1', 'client', 'Да, вполне. Если всё сложится с вариантом, до декабря успеем решить вопрос.', 2);
    const facts = extractDeterministicFacts(client.text, client.id, agent.text);
    const timeline = facts.find((f) => f.field === 'purchaseTimeline');
    expect(timeline?.value.toLowerCase()).toContain('до декабря');
    expect(isConcreteTimeline(timeline?.value || '')).toBe(true);

    const lookup = { [client.id]: client.text };
    const state = mergeFactsDelta(createInitialState(), facts as any, undefined, undefined, 2, lookup);
    const progress = evaluateFirstCallScript([agent, client], state);
    expect(progress.metrics.urgency.status).toBe('confirmed');
  });

  it('extracts a contextual down payment without misclassifying it as budget', () => {
    const agent = turn('a1', 'agent', 'Какой первоначальный взнос планируете задействовать?', 1);
    const client = turn('c1', 'client', '15 миллионов из накоплений.', 2);
    const facts = extractDeterministicFacts(client.text, client.id, agent.text);
    expect(facts.some((f) => f.field === 'downPayment')).toBe(true);
    expect(facts.some((f) => f.field === 'downPaymentSource' && f.value.includes('накоп'))).toBe(true);
    expect(facts.some((f) => f.field === 'budget')).toBe(false);
  });

  it('keeps house rejection as a hard constraint while still accepting a flat', () => {
    const facts = extractDeterministicFacts('Дом не рассматриваю, нужна квартира.', 'c1', 'Какой формат рассматриваете?');
    expect(facts.some((f) => f.field === 'propertyTypeConstraint' && f.value.includes('Дом исключён'))).toBe(true);
    expect(facts.some((f) => f.field === 'propertyType' && f.value === 'Квартира')).toBe(true);
    expect(facts.some((f) => f.field === 'propertyType' && f.value.includes('Дом /'))).toBe(false);
  });

  it('counts proximity to sea as a preferred criterion', () => {
    const facts = extractDeterministicFacts('Близость к морю будет приятным бонусом.', 'c1');
    expect(facts.some((f) => f.field === 'clientCriteria' && f.value.includes('морю'))).toBe(true);
  });

  it('does not jump from the first situation answer straight into a Problem question', () => {
    const client = turn('c1', 'client', 'Только начал смотреть Сочи.', 1);
    const result = evaluateSpinAndHpb(client, createInitialSpinState(), 'none', '');
    expect(result.suggestionMode).toBe('SPIN_SITUATION');
    expect(result.suggestedText).not.toContain('самым неудобным');
  });


  it('keeps seasonal-use negation: “постоянно жить не планируем” must not become permanent residence', () => {
    const rState = createInitialState();
    const client = turn('c-goal', 'client', 'Пока больше для отдыха и сезонного проживания. Постоянно жить не планируем, скорее приезжать на каникулы.', 1);
    const facts = extractDeterministicFacts(client.text, client.id);
    const lookup = { [client.id]: client.text };
    const merged = mergeFactsDelta(rState, facts as any, undefined, undefined, 1, lookup);
    const progress = evaluateFirstCallScript([client], merged);
    expect(merged.goal.value).toMatch(/отдых|сезон/iu);
    expect(merged.goal.value).not.toMatch(/постоянн.*прожив|переезд/iu);
    expect(progress.metrics.goal.value).toMatch(/отдых|сезон/iu);
  });

  it('keeps employment negation: “работаю по найму, ИП нет” must not become entrepreneur', () => {
    const client = turn('c-job', 'client', 'Я официально трудоустроен, работаю по найму, никаких ИП или ООО у меня нет.', 1);
    const facts = extractDeterministicFacts(client.text, client.id, 'Официально трудоустроены, возможно ИП или ООО?');
    const merged = mergeFactsDelta(createInitialState(), facts as any, undefined, undefined, 1, { [client.id]: client.text });
    const progress = evaluateFirstCallScript([client], merged);
    expect(merged.employment?.value).toMatch(/найм/iu);
    expect(progress.metrics.employment.value).toMatch(/найм/iu);
    expect(progress.metrics.employment.value).not.toMatch(/индивидуальн.*предприним|\bИП\b/iu);
  });

  it('does not credit an objection as handled merely because the client voiced it', () => {
    const client = turn('c1', 'client', 'Для меня это дорого.', 1);
    const state: ConversationState = {
      ...createInitialState(),
      objections: { value: 'Цена', items: ['Цена'], evidenceTurnIds: [client.id] },
      lastAgentAction: 'none',
    };
    const progress = evaluateFirstCallScript([client], state);
    expect(progress.metrics.objections.status).toBe('partially_confirmed');
  });

  it('does not close PPI until the client agrees to the consultation', () => {
    const agent = turn(
      'a1',
      'agent',
      'Есть семейная ипотека, субсидированная ставка и стандартная программа. Давайте подключим ипотечного брокера?',
      1
    );
    const client = turn('c1', 'client', 'Нет, не надо.', 2);
    const progress = evaluateFirstCallScript([agent, client], createInitialState());
    expect(progress.metrics.ppi.status).not.toBe('confirmed');
  });
});
