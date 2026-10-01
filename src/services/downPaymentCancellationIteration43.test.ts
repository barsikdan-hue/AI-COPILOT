import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState, mergeFactsDelta, mergeSemanticFacts } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { evaluateFirstCallScript } from './firstCallScriptEngine';

function replay(items: Array<string | ['agent', string]>) {
  let state = createInitialState();
  const turns: TranscriptTurn[] = [];
  for (const [index, item] of items.entries()) {
    const [speaker, text] = typeof item === 'string' ? ['client' as const, item] : item;
    const turn: TranscriptTurn = {
      id: `fix43-${index}`, sessionId: 'fix43', source: 'call_audio', speaker,
      text, timestamp: (index + 1) * 1000, isFinal: true, revision: index + 1,
    };
    turns.push(turn);
    state = advanceLocalConversation(state, turn, turns).state;
  }
  return { state, turns };
}

const active = (state: ConversationState) => state.confirmedFacts.filter(
  fact => ['downPayment', 'down_payment'].includes(fact.category) &&
    !['superseded', 'rejected'].includes(fact.lifecycleStatus || ''),
);
const seed = 'Первоначальный взнос 4 млн';

describe('FIX43 explicit downPayment cancellation', () => {
  // These assertions catch dropping explicit absence before merge, retaining
  // active historical evidence, and rebuilding the metric from old text.
  it.each([
    'Первоначального взноса сейчас нет',
    'Первоначальный взнос не сформирован',
    'Первоначальный взнос пока не готов',
    'Нет средств на первоначальный взнос',
    'Денег на первоначальный взнос нет',
    'Первого взноса сейчас нет',
    'Первого платежа сейчас нет',
    'Первоначального взноса 4 млн сейчас нет',
  ])('clears canonical amount and retires the active fact: %s', negative => {
    const { state, turns } = replay([seed, negative]);
    expect(state.downPayment?.value).toBeNull();
    expect(state.downPayment?.evidenceTurnIds).toContain(turns[1].id);
    expect(active(state)).toHaveLength(0);
    expect(state.confirmedFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'downPayment', value: '4 млн руб', lifecycleStatus: 'superseded' }),
    ]));
    expect(state.scriptProgress?.metrics.downPayment.status).toBe('not_confirmed');
    expect(state.scriptProgress?.metrics.downPayment.value).toBeNull();
  });

  it('carries an explicit cancellation through the extractor boundary', () => {
    expect(extractDeterministicFacts('Первоначального взноса сейчас нет', 'negative')).toEqual([
      expect.objectContaining({ field: 'downPayment', cancelsDownPayment: true, evidenceTurnId: 'negative' }),
    ]);
  });

  it('does not resurrect historical amount or availability after later unrelated turns', () => {
    const { state, turns } = replay([
      'Деньги на первоначальный взнос есть', 'Первоначальный взнос 4 миллиона',
      'Первоначального взноса сейчас нет', 'Спасибо, понял',
    ]);
    expect(state.downPayment?.value).toBeNull();
    expect(active(state)).toHaveLength(0);
    const metric = evaluateFirstCallScript(turns, state).metrics.downPayment;
    expect(metric.status).toBe('not_confirmed');
    expect(metric.value).toBeNull();
    const response = buildLocalAnalysisResponse({
      sessionId: 'fix43', revision: 4, newTurns: [turns[3]], recentTurns: turns, currentState: state,
    });
    expect(response.scriptProgress?.metrics.downPayment.status).toBe('not_confirmed');
    expect(response.scriptProgress?.metrics.downPayment.value).toBeNull();
  });

  it('clears a short readiness denial only with an immediately preceding DP question', () => {
    const { state } = replay([seed, ['agent', 'Средства на первоначальный взнос уже есть?'], 'Нет']);
    expect(state.downPayment?.value).toBeNull();
    expect(active(state)).toHaveLength(0);
    expect(state.scriptProgress?.metrics.downPayment.status).toBe('not_confirmed');
  });

  it('records absence without inventing a confirmed amount when no DP existed', () => {
    const { state, turns } = replay(['Первоначального взноса сейчас нет']);
    expect(state.downPayment?.value).toBeNull();
    expect(state.downPayment?.evidenceTurnIds).toContain(turns[0].id);
    expect(active(state)).toHaveLength(0);
    expect(state.scriptProgress?.metrics.downPayment.status).toBe('not_confirmed');
  });

  it('replaces 4 million with 5 million and retires only the older amount', () => {
    const { state } = replay([seed, 'Первоначальный взнос 5 млн']);
    expect(state.downPayment?.value).toBe('5 млн руб');
    expect(active(state)).toEqual([expect.objectContaining({ value: '5 млн руб', lifecycleStatus: 'confirmed' })]);
    expect(state.confirmedFacts.find(f => f.value === '4 млн руб')?.lifecycleStatus).toBe('superseded');
  });

  it('accepts a new amount after cancellation without restoring the superseded amount', () => {
    const { state } = replay([seed, 'Первоначального взноса сейчас нет', 'Первоначальный взнос 5 млн']);
    expect(state.downPayment?.value).toBe('5 млн руб');
    expect(active(state)).toEqual([expect.objectContaining({ value: '5 млн руб' })]);
    expect(state.scriptProgress?.metrics.downPayment.value).toBe('5 млн руб');
    expect(state.scriptProgress?.metrics.downPayment.status).toBe('confirmed');
  });

  it.each(['deterministic', 'semantic'])('does not reactivate cancelled evidence through a %s historical re-merge', route => {
    const { state, turns } = replay([seed, 'Первоначального взноса сейчас нет']);
    const historical = extractDeterministicFacts(seed, turns[0].id);
    const after = route === 'semantic'
      ? mergeSemanticFacts(state, historical, turns)
      : mergeFactsDelta(state, historical, state.stage, undefined, 3, Object.fromEntries(turns.map(t => [t.id, t.text])));
    expect(after.downPayment?.value).toBeNull();
    expect(active(after)).toHaveLength(0);
    expect(evaluateFirstCallScript(turns, after).metrics.downPayment.status).toBe('not_confirmed');
  });

  it('retires all active repeated DP confirmations', () => {
    const { state } = replay([seed, seed, 'Первоначального взноса сейчас нет']);
    expect(state.downPayment?.value).toBeNull();
    expect(active(state)).toHaveLength(0);
    expect(state.confirmedFacts.filter(f => f.category === 'downPayment')).toHaveLength(2);
    expect(state.confirmedFacts.filter(f => f.category === 'downPayment').every(f => f.lifecycleStatus === 'superseded')).toBe(true);
  });

  it('does not replay an older cancellation over a later positive amount', () => {
    const { state, turns } = replay([seed, 'Первоначального взноса сейчас нет', 'Первоначальный взнос 5 млн']);
    const historical = extractDeterministicFacts(turns[1].text, turns[1].id);
    const after = mergeFactsDelta(state, historical, state.stage, undefined, 4, Object.fromEntries(turns.map(t => [t.id, t.text])));
    expect(after.downPayment?.value).toBe('5 млн руб');
    expect(active(after)).toEqual([expect.objectContaining({ value: '5 млн руб' })]);
  });

  it('projects the new amount after cancellation even when history contains generic availability', () => {
    const { state } = replay([
      'Деньги на первоначальный взнос есть', seed,
      'Первоначального взноса сейчас нет', 'Первоначальный взнос 5 млн',
    ]);
    expect(state.scriptProgress?.metrics.downPayment.status).toBe('confirmed');
    expect(state.scriptProgress?.metrics.downPayment.value).toBe('5 млн руб');
  });

  it('keeps future availability distinct from historical current readiness', () => {
    const { state } = replay([
      'Деньги на первоначальный взнос есть', seed,
      'Первоначального взноса сейчас нет', 'Первоначальный взнос будет через полгода',
    ]);
    expect(state.downPayment?.needsClarification).toBe(true);
    expect(state.scriptProgress?.metrics.downPayment.status).toBe('partially_confirmed');
    expect(state.scriptProgress?.metrics.downPayment.value).toBe(state.downPayment?.value);
    expect(state.scriptProgress?.metrics.downPayment.value).toMatch(/позже/iu);
  });

  it.each([
    'Первоначального взноса сейчас нет, точнее, первоначальный взнос 5 млн уже есть',
    'Первоначального взноса 4 млн сейчас нет, точнее, первоначальный взнос 5 млн',
  ])('honors a later explicit DP correction within the same turn: %s', text => {
    const { state } = replay([seed, text]);
    expect(state.downPayment?.value).toBe('5 млн руб');
    expect(active(state)).toEqual([expect.objectContaining({ value: '5 млн руб', lifecycleStatus: 'confirmed' })]);
    expect(state.scriptProgress?.metrics.downPayment.value).toBe('5 млн руб');
  });

  it('does not reopen when the same-turn correction is still an explicit absence', () => {
    const { state } = replay([seed, 'Первоначального взноса сейчас нет, точнее, первоначального взноса 5 млн сейчас нет']);
    expect(state.downPayment?.value).toBeNull();
    expect(active(state)).toHaveLength(0);
  });

  it.each([
    'Первоначального взноса пока не определил',
    'Первоначальный взнос будет через полгода',
    'Первоначальный взнос есть, ипотека пока не готова',
    'Первоначальный взнос есть, документов сейчас нет',
    'Нет, спасибо',
    'Спасибо, понял',
    'Если первоначального взноса нет, ипотеку одобрят?',
    'У брата первоначального взноса сейчас нет',
    'Допустим, первоначального взноса нет',
    'Не хватает денег на первоначальный взнос, есть только 3 млн',
  ])('does not treat uncertainty or unrelated negation as cancellation: %s', text => {
    expect(replay([seed, text]).state.downPayment?.value).toBe('4 млн руб');
  });

  it('does not use an old readiness question after an intervening client answer', () => {
    const { state } = replay([seed, ['agent', 'Средства на первоначальный взнос уже есть?'], 'Спасибо, понял', 'Нет']);
    expect(state.downPayment?.value).toBe('4 млн руб');
  });

  it.each([null, 'Готовность требует уточнения'])('ordinary null/clarification delta does not clear a confirmed DP: %s', value => {
    const { state } = replay([seed]);
    const after = mergeFactsDelta(state, [{
      field: 'downPayment', category: 'downPayment', value: value as string,
      needsClarification: true, evidenceQuote: 'Пока не определил', evidenceTurnId: 'clarification',
    }], state.stage, undefined, 2, { clarification: 'Пока не определил' });
    expect(after.downPayment?.value).toBe('4 млн руб');
    expect(active(after)).toEqual([expect.objectContaining({ value: '4 млн руб', lifecycleStatus: 'confirmed' })]);
  });

  it('preserves independent budget, financing, source, and property facts', () => {
    const { state } = replay([
      'Бюджет 18 млн, планируем ипотеку, нужна квартира',
      'Первоначальный взнос 4 млн из личных накоплений',
      'Первоначального взноса сейчас нет',
    ]);
    expect(state.downPayment?.value).toBeNull();
    expect(state.budget.value).toBe('18 млн руб');
    expect(state.paymentMethod.value).toBe('Ипотека');
    expect(state.propertyType?.value).toBe('Квартира');
    expect(state.downPaymentSource?.value).toBe('Личные накопления / свободные средства');
    expect(state.confirmedFacts.filter(f => f.category !== 'downPayment').every(f => f.lifecycleStatus === 'confirmed')).toBe(true);
  });
});
