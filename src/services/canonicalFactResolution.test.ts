import { describe, expect, it } from 'vitest';
import { createInitialState, mergeFactsDelta, mergeSemanticFacts } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { advanceLocalConversation } from './localAnalysisEngine';
import { TranscriptTurn } from '../types';

function session() {
  let state = createInitialState(); const turns: TranscriptTurn[] = [];
  return { get state() { return state; }, turns, add(text: string, speaker: 'client' | 'agent' = 'client') {
    const turn: TranscriptTurn = { id: `t${turns.length}`, sessionId: 'test', source: 'call_audio', speaker, text, timestamp: turns.length * 10000, isFinal: true, revision: turns.length + 1 };
    turns.push(turn); state = advanceLocalConversation(state, turn, turns).state;
  } };
}

describe('4.0.2 canonical facts', () => {
  it('T07 down-payment source cannot overwrite mortgage in state, ledger or metrics', () => {
    const r = session(); r.add('Рассматриваю ипотеку.');
    r.add('Средства уже есть на руках или будут после продажи актива?', 'agent');
    r.add('Вопрос закрывается собственными средствами.');
    expect(r.state.paymentMethod.value).toBe('Ипотека');
    expect(r.state.downPaymentSource?.value).toMatch(/накопления/iu);
    expect(r.state.scriptProgress?.metrics.paymentMethod.value).toBe(r.state.paymentMethod.value);
    expect(r.state.confirmedFacts.filter(f => f.category === 'paymentMethod' && f.lifecycleStatus !== 'superseded').every(f => f.value === 'Ипотека')).toBe(true);
  });
  it('T08 specific child-age evidence remains confirmed through generic follow-ups', () => {
    const r = session();
    for (const text of ['У меня есть ребёнок до 7 лет.', 'Ребёнку сейчас меньше 7 лет.', 'Точный возраст не хочу говорить, важно что он до 7.', 'У меня есть ребёнок.']) {
      r.add(text);
      expect(r.state.familyMortgage?.needsClarification).toBe(false);
      expect(r.state.familyMortgage?.value).toMatch(/подходит/iu);
      expect(r.state.scriptProgress?.metrics.familyMortgage.status).toBe('confirmed');
      expect(r.state.scriptProgress?.metrics.familyMortgage.needsClarification).toBe(false);
    }
  });
  it.each(['Ребёнку меньше 7 лет.', 'Ребёнок младше 7 лет.', 'Ребёнку до семи.', 'Ребёнку ещё нет 7.'])('supports age range: %s', text => {
    expect(extractDeterministicFacts(text, 't').find(f => f.field === 'familyMortgage')).toMatchObject({ needsClarification: false });
  });
  it('explicit correction replaces earlier concrete facts across all readers', () => {
    const r = session(); r.add('У меня есть ребёнок до 7 лет.'); r.add('Поправлю: детей до 7 лет нет.');
    expect(r.state.familyMortgage?.value).toMatch(/нет детей/iu);
    expect(r.state.scriptProgress?.metrics.familyMortgage.status).toBe('not_applicable');
    r.add('Покупаю в ипотеку.'); r.add('Способ оплаты меняю: полностью собственными средствами, без ипотеки.');
    expect(r.state.paymentMethod.value).toMatch(/собственные средства/iu);
    expect(r.state.scriptProgress?.metrics.paymentMethod.value).toBe(r.state.paymentMethod.value);
  });
  it('Gemini cannot turn agent evidence or an invented quote into a fact, nor overwrite canonical facts', () => {
    const r = session(); r.add('Бюджет 15 млн.'); r.add('Значит ваш бюджет 20 млн?', 'agent');
    const changed = mergeSemanticFacts(r.state, [
      { field: 'budget', value: '20 млн', evidenceTurnId: 't1', evidenceQuote: '20 млн' },
      { field: 'paymentMethod', value: 'Ипотека', evidenceTurnId: 't0', evidenceQuote: 'ипотека' },
      { field: 'budget', value: '100 млн', evidenceTurnId: 't0', evidenceQuote: '15 млн' },
    ], r.turns);
    expect(changed.budget.value).toBe('15 млн руб');
    expect(changed.paymentMethod.value).toBeNull();
  });
  it('strict evidence lookup rejects unknown turn IDs', () => {
    expect(mergeFactsDelta(createInitialState(), [{ field: 'budget', value: '20 млн', evidenceTurnId: 'agent' }], undefined, undefined, 1, {}).budget.value).toBeNull();
  });
  it('Gemini snake_case aliases cannot bypass canonical-field protection', () => {
    const r = session(); r.add('Покупаю в ипотеку.');
    const changed = mergeSemanticFacts(r.state, [{ field: 'payment_method', value: 'Наличные', evidenceTurnId: 't0', evidenceQuote: 'Покупаю' }], r.turns);
    expect(changed.paymentMethod.value).toBe('Ипотека');
  });
});
