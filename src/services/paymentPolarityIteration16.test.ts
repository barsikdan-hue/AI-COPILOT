import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

function clientTurn(id: string, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'payment-polarity-iteration-16',
    source: 'call_audio',
    speaker: 'client',
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

function advance(state: ConversationState, turns: TranscriptTurn[], text: string) {
  const next = clientTurn(`payment-${turns.length + 1}`, text, turns.length + 1);
  const history = [...turns, next];
  return { history, result: advanceLocalConversation(state, next, history) };
}

const activePaymentFacts = (state: ConversationState) =>
  state.confirmedFacts.filter((fact) =>
    fact.category === 'paymentMethod' && !['superseded', 'rejected'].includes(fact.lifecycleStatus || '')
  );

const isCash = (value: string | null | undefined) => /собствен|свои|налич/iu.test(value || '');
const isMixed = (value: string | null | undefined) => /смешан|собствен.*ипотек|ипотек.*собствен/iu.test(value || '');

describe('FIX ITERATION 16 payment polarity and contrast', () => {
  it('A: resolves first-turn mortgage contrast to own funds without a correction', () => {
    const { result } = advance(createInitialState(), [], 'Не ипотека, а своими деньгами.');

    expect(isCash(result.state.paymentMethod.value)).toBe(true);
    expect(activePaymentFacts(result.state)).toHaveLength(1);
    expect(activePaymentFacts(result.state)[0].value).not.toMatch(/^ипотека$/iu);
    expect(result.event?.type).not.toBe('FACT_CORRECTION');
    expect(result.state.scriptProgress?.metrics.paymentMethod.value).toBe(result.state.paymentMethod.value);
  });

  it('B: keeps an explicit mortgage rejection negative and does not recommend mortgage', () => {
    const turn = clientTurn('mortgage-rejected', 'Ипотеку не рассматриваю.', 1);
    const advanced = advanceLocalConversation(createInitialState(), turn, [turn]);
    const response = buildLocalAnalysisResponse({
      sessionId: turn.sessionId,
      revision: 1,
      newTurns: [turn],
      recentTurns: [turn],
      currentState: advanced.state,
    });

    expect(advanced.state.paymentMethod.value).toBeNull();
    expect(activePaymentFacts(advanced.state)).toHaveLength(0);
    expect(advanced.event?.type).not.toBe('FACT_CORRECTION');
    expect(response.suggestedReply || '').not.toMatch(/ипотечн\p{L}*\s+специалист|ставк\p{L}*|одобрени\p{L}*/iu);
  });

  it('C: confirms a full own-funds purchase', () => {
    const { result } = advance(createInitialState(), [], 'Хочу купить полностью за свои.');

    expect(isCash(result.state.paymentMethod.value)).toBe(true);
    expect(activePaymentFacts(result.state)).toHaveLength(1);
    expect(result.state.scriptProgress?.metrics.paymentMethod.status).toBe('confirmed');
  });

  it('D: preserves explicit mixed financing instead of collapsing it to cash or mortgage', () => {
    const { result } = advance(createInitialState(), [], 'Часть своими, остальное ипотека.');

    expect(isMixed(result.state.paymentMethod.value)).toBe(true);
    expect(result.state.paymentMethod.value).not.toBe('Ипотека');
    expect(activePaymentFacts(result.state)).toHaveLength(1);
    expect(result.state.scriptProgress?.metrics.paymentMethod.value).toBe(result.state.paymentMethod.value);
  });

  it('E: does not confirm a merely possible mortgage', () => {
    const { result } = advance(createInitialState(), [], 'Возможно ипотека, пока не решил.');

    expect(result.state.paymentMethod).toMatchObject({ value: null, needsClarification: true });
    expect(activePaymentFacts(result.state)).toHaveLength(0);
    expect(result.state.scriptProgress?.metrics.paymentMethod.status).toBe('needs_clarification');
  });

  it('F: retains an explicit positive mortgage statement', () => {
    const { result } = advance(createInitialState(), [], 'Ипотека подходит.');

    expect(result.state.paymentMethod.value).toBe('Ипотека');
    expect(activePaymentFacts(result.state)).toHaveLength(1);
    expect(result.state.scriptProgress?.metrics.paymentMethod.value).toBe('Ипотека');
  });

  it('G: supersedes mortgage with cash and emits a genuine correction', () => {
    const first = advance(createInitialState(), [], 'Буду брать ипотеку.');
    const second = advance(first.result.state, first.history, 'Нет, решил покупать полностью за свои.');
    const facts = second.result.state.confirmedFacts.filter((fact) => fact.category === 'paymentMethod');
    const oldFact = facts.find((fact) => fact.turnId === first.history[0].id);
    const newFact = facts.find((fact) => fact.turnId === second.history[1].id);

    expect(isCash(second.result.state.paymentMethod.value)).toBe(true);
    expect(oldFact?.lifecycleStatus).toBe('superseded');
    expect(newFact?.supersedesFactId).toBe(oldFact?.id);
    expect(activePaymentFacts(second.result.state)).toHaveLength(1);
    expect(second.result.event?.type).toBe('FACT_CORRECTION');
  });

  it('H: supersedes cash-only with a mixed mortgage scheme', () => {
    const first = advance(createInitialState(), [], 'Покупаю за свои.');
    const second = advance(first.result.state, first.history, 'Планы изменились, часть придётся взять в ипотеку.');
    const facts = second.result.state.confirmedFacts.filter((fact) => fact.category === 'paymentMethod');
    const oldFact = facts.find((fact) => fact.turnId === first.history[0].id);
    const newFact = facts.find((fact) => fact.turnId === second.history[1].id);

    expect(isMixed(second.result.state.paymentMethod.value)).toBe(true);
    expect(oldFact?.lifecycleStatus).toBe('superseded');
    expect(newFact?.supersedesFactId).toBe(oldFact?.id);
    expect(second.result.event?.type).toBe('FACT_CORRECTION');
    expect(second.result.state.scriptProgress?.metrics.paymentMethod.value).toBe(second.result.state.paymentMethod.value);
  });

  it('I: separates own-funds down-payment source from the mortgage payment method', () => {
    const { result } = advance(createInitialState(), [], 'Первоначальный взнос из своих средств, остальное ипотека.');

    expect(result.state.paymentMethod.value).toBe('Ипотека');
    expect(result.state.downPaymentSource?.value).toMatch(/накоплен|средств/iu);
    expect(result.state.paymentMethod.value).not.toMatch(/100%|налич/iu);
    expect(result.state.scriptProgress?.metrics.paymentMethod.value).toBe('Ипотека');
  });

  it('J: does not turn available own funds into a cash-only method while payment is undecided', () => {
    const { result } = advance(createInitialState(), [], 'Есть свои деньги, но способ оплаты ещё не решил.');

    expect(result.state.paymentMethod.value).toBeNull();
    expect(activePaymentFacts(result.state)).toHaveLength(0);
    expect(result.state.scriptProgress?.metrics.paymentMethod.status).not.toBe('confirmed');
  });

  it('K: keeps installment positive when mortgage is rejected in the same utterance', () => {
    const { result } = advance(createInitialState(), [], 'Ипотека не нужна, рассрочку рассматриваю.');

    expect(result.state.paymentMethod.value).toMatch(/рассроч/iu);
    expect(activePaymentFacts(result.state)).toHaveLength(1);
    expect(activePaymentFacts(result.state)[0].value).not.toMatch(/^ипотека$/iu);
    expect(result.state.scriptProgress?.metrics.paymentMethod.value).toBe(result.state.paymentMethod.value);
  });

  it('L: treats "not only mortgage" as inclusion in a mixed scheme, not rejection', () => {
    const { result } = advance(createInitialState(), [], 'Не только ипотека, могу часть внести своими.');

    expect(isMixed(result.state.paymentMethod.value)).toBe(true);
    expect(activePaymentFacts(result.state)).toHaveLength(1);
    expect(result.state.dialogueControl?.rejectedBranches || []).not.toContain('ипотеку');
  });
});
