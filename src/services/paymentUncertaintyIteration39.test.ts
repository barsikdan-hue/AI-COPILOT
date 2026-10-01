import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState, mergeSemanticFacts } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse, buildCompactAnalysisContext } from './localAnalysisEngine';
import { evaluateFirstCallScript } from './firstCallScriptEngine';
import { checkSemanticAntiRepeat } from './semanticAntiRepeat';
import { buildSessionHandoff } from './sessionHandoff';
import { detectConversationEvent } from './conversationEventEngine';

const mixed = 'Смешанная схема: собственные средства + ипотека';
const productionText = 'Часть своих, часть, возможно, ипотека, но без фанатизма. Если будет понятная схема, но не хочу сложных конструкций.';
const activePayment = (state: ConversationState) => state.confirmedFacts.filter(f =>
  f.category === 'paymentMethod' && !['superseded', 'rejected'].includes(f.lifecycleStatus || ''));

describe('FIX39 R8 mortgage-credit payment-choice semantics', () => {
  it('R8 keeps an undecided client answer to an immediate credit-choice question uncertain', () => {
    const r = replay(); r.add('Планируете использовать ипотечный кредит?', 'agent'); r.add('Не знаю.');
    expectUncertain(r);
  });

  it.each(['Не знаю, нужен ли ипотечный кредит.', 'Сомневаюсь, нужен ли ипотечный кредит.'])
  ('R8 does not confirm explicit uncertainty about using mortgage credit: %s', text => {
    const r = replay(); r.add(text); expectUncertain(r);
    const { response, refreshed, app } = r.surfaces();
    for (const progress of [r.state.scriptProgress!, response.scriptProgress!, refreshed, app.scriptProgress!]) {
      expect(progress.metrics.ppi.status).toBe('not_confirmed');
    }
  });

  it('R8 supersedes confirmed credit when its payment choice becomes uncertain', () => {
    const r = replay(); r.add('Ипотечный кредит точно нужен.'); const old = activePayment(r.state)[0];
    r.add('Не знаю, нужен ли ипотечный кредит.'); expectUncertain(r);
    expect(r.state.confirmedFacts.find(f => f.id === old.id)).toMatchObject({
      lifecycleStatus: 'superseded', turnId: old.turnId, evidenceQuote: old.evidenceQuote });
  });

  it.each(['Размер ипотечного кредита зависит от своих средств.',
    'Ставка ипотечного кредита пока неизвестна.', 'Условия ипотечного кредита ещё уточняю.'])
  ('R8 keeps a credit property outside current payment-choice evidence: %s', text => {
    const fresh = replay(); fresh.add(text);
    const { response, refreshed, app } = fresh.surfaces();
    for (const state of [fresh.state, app]) {
      expect(state.paymentMethod.value).toBeNull(); expect(activePayment(state)).toHaveLength(0);
      expect(state.paymentMethod.evidenceTurnIds).toHaveLength(0);
    }
    for (const progress of [fresh.state.scriptProgress!, response.scriptProgress!, refreshed, app.scriptProgress!]) {
      expect(progress.metrics.paymentMethod.status).not.toBe('confirmed');
      expect(progress.ppi.paymentMethodDisclosed).toBe(false);
    }
    expect(response.factsDelta?.some(f => f.field === 'paymentMethod')).toBe(false);
    const confirmed = replay(); confirmed.add('Ипотечный кредит точно нужен.');
    const old = activePayment(confirmed.state)[0]; confirmed.add(text); expectDefinite(confirmed, 'Ипотека');
    expect(activePayment(confirmed.state)[0]).toMatchObject({ turnId: old.turnId, evidenceQuote: old.evidenceQuote });
    const uncertain = replay(); uncertain.add('Может быть ипотека.'); uncertain.add(text);
    expectUncertain(uncertain, false, 'u39-0');
    expect(uncertain.state.paymentMethod.evidenceTurnIds).not.toContain('u39-1');
  });

  it('R8 preserves explicit credit confirmation with an unsettled rate', () => {
    const r = replay(); r.add('Ипотечный кредит точно нужен, ставку пока не знаю.'); expectDefinite(r, 'Ипотека');
  });

  it.each([
    ['Не знаю, нужен ли ипотечный кредит. Да, точно будем брать ипотеку.', false],
    ['Ипотечный кредит точно нужен. Хотя теперь сомневаюсь, нужен ли он.', true],
  ])('R8 uses ordered current credit choice across explicit noun and pronoun: %s', (text, uncertain) => {
    const r = replay(); r.add(text); if (uncertain) expectUncertain(r); else expectDefinite(r, 'Ипотека');
  });

  it('R8 keeps possible credit tentative under Policy B', () => {
    const r = replay(); r.add('Может быть ипотечный кредит.'); expectUncertain(r);
  });

  it('R8 treats a whether-to-use credit question as undecided payment', () => {
    const r = replay(); r.add('Нужен ли ипотечный кредит?'); expectUncertain(r);
  });

  it('R8 lets explicit masculine confirmation resolve the same credit choice', () => {
    const r = replay(); r.add('Не знаю, нужен ли ипотечный кредит. Да, точно нужен.');
    expectDefinite(r, 'Ипотека');
  });

  it('R8 does not turn conditional credit into current confirmation', () => {
    const r = replay(); r.add('Может быть ипотечный кредит. Если ставка снизится, будем брать ипотечный кредит.');
    expectUncertain(r);
  });

  it('R8 lets explicit credit confirmation resolve earlier mortgage uncertainty', () => {
    const r = replay(); r.add('Не знаю, нужна ли ипотека. Ипотечный кредит точно нужен.'); expectDefinite(r, 'Ипотека');
  });

  it('R8 recognizes unconditional plural confirmation after mortgage uncertainty', () => {
    const r = replay(); r.add('Не знаю, нужна ли ипотека. Да, точно будем брать ипотеку.'); expectDefinite(r, 'Ипотека');
  });

  it('R8 does not borrow a masculine mortgage antecedent across a different property', () => {
    const r = replay(); r.add('Ипотечный кредит точно нужен. Район пока не выбрал. Хотя сомневаюсь, нужен ли он.');
    expectDefinite(r, 'Ипотека');
  });

  it('R8 does not transfer another recipient credit doubt to the client choice', () => {
    const r = replay(); r.add('Ипотечный кредит точно нужен.'); const old = activePayment(r.state)[0];
    r.add('Сомневаюсь, нужен ли соседям ипотечный кредит.'); expectDefinite(r, 'Ипотека');
    expect(activePayment(r.state)[0]).toMatchObject({ turnId: old.turnId, evidenceQuote: old.evidenceQuote });
  });
});

// Latest decisive payment intent owns canonical, ledger and all script projections.
describe('FIX39 uncertainty precedence R5–R7', () => {
  it('F39-R5 keeps conditional future mortgage uncertain', () => {
    const r = replay(); r.add('Может быть ипотека. Если ставка снизится, буду брать ипотеку.');
    expectUncertain(r);
  });

  it('F39-R6 retires confirmed mortgage after comma-separated explicit doubt', () => {
    const r = replay(); r.add('Ипотека точно нужна.');
    const old = activePayment(r.state)[0];
    r.add('Сомневаюсь, нужна ли ипотека.'); expectUncertain(r);
    expect(r.state.confirmedFacts.find(f => f.id === old.id)).toMatchObject({
      lifecycleStatus: 'superseded', evidenceQuote: old.evidenceQuote, turnId: old.turnId });
  });

  it('F39-R7 applies later explicit-noun doubt in the same turn', () => {
    const r = replay(); r.add('Да, будем брать ипотеку. Хотя пока не уверен, нужна ли ипотека.');
    expectUncertain(r);
  });

  it('keeps a real decision after an earlier undecided complement', () => {
    const r = replay(); r.add('Пока не решил, использовать ли ипотеку. Решил: буду брать ипотеку.');
    expectDefinite(r, 'Ипотека');
  });

  it.each(['Будем брать ипотеку. Но пока не уверен, нужна ли ипотека.',
    'Ипотека нужна. Хотя сомневаюсь, нужна ли она.',
    'Ипотека точно нужна. Хотя теперь не уверен.'])
  ('reopens payment from later decisive doubt: %s', text => {
    const r = replay(); r.add(text); expectUncertain(r);
  });

  it.each(['Не уверен насчёт ипотеки. Если условия будут хорошими, возьмём.',
    'Возможно ипотека. Если не хватит своих, тогда будем брать ипотеку.',
    'Может быть ипотека. Если одобрят, буду брать ипотеку.',
    'Может быть ипотека. Ипотека нужна только если не хватит своих денег.',
    'Может быть ипотека. Если одобрят, часть своими, остальное ипотека.',
    'Может быть ипотека, если ставка снизится, буду брать ипотеку.',
    'Может быть ипотека. Не уверен, буду брать ипотеку.',
    'Может быть ипотека. Не уверен, что ипотека подходит.'])
  ('does not let any affirmative branch bypass conditional or doubt ownership: %s', text => {
    const r = replay(); r.add(text); expectUncertain(r);
  });

  it.each(['Ипотека нужна. Сомневаюсь нужна ли ипотека.',
    'Ипотека нужна; сомневаюсь, нужна ли ипотека.',
    'Ипотека нужна. Хотя пока не уверен нужна ли ипотека.',
    'Ипотека нужна. Хотя сомневаюсь нужна ли она.',
    'Ипотека нужна, теперь не уверен, нужна ли ипотека.',
    'Ипотека нужна, теперь не уверен, нужна ли она.'])
  ('keeps noun, pronoun and normal punctuation equivalent for the same choice: %s', text => {
    const r = replay(); r.add(text); expectUncertain(r);
  });

  it.each(['Ипотека нужна, размер кредита пока не решил.',
    'Будем брать ипотеку, условия пока не знаю.',
    'Ипотека точно нужна. Сомневаюсь в ставке.',
    'Ипотека точно нужна, не уверен, какой район.',
    'Не уверен, какой район, ипотека точно нужна.'])
  ('keeps doubt owned by a property outside the payment decision: %s', text => {
    const r = replay(); r.add(text); expectDefinite(r, 'Ипотека');
  });

  it('lets an unconditional comma-separated decision supersede earlier possibility', () => {
    const r = replay(); r.add('Может быть ипотека, да, точно возьмём ипотеку.');
    expectDefinite(r, 'Ипотека');
  });

  it.each(['Не уверен, какая сумма будет по ипотеке.', 'Не уверен, какая ставка будет по ипотеке.',
    'Сомневаюсь, какая сумма будет по ипотеке.', 'Не уверен, какой срок будет у ипотеки.',
    'Не уверен, какую квартиру брать в ипотеку.', 'Не уверен, какая будет переплата по ипотеке.'])
  ('keeps a question-owned property outside the payment choice: %s', text => {
    const r = replay(); r.add('Ипотека точно нужна.'); const old = activePayment(r.state)[0];
    r.add(text); expectDefinite(r, 'Ипотека');
    expect(activePayment(r.state)[0]).toMatchObject({ turnId: old.turnId, evidenceQuote: old.evidenceQuote });
  });

  it('does not turn a property question into new payment evidence', () => {
    const r = replay(); r.add('Может быть ипотека.');
    r.add('Не уверен, какая сумма будет по ипотеке.'); expectUncertain(r, false, 'u39-0');
    expect(r.state.paymentMethod.evidenceTurnIds).not.toContain('u39-1');
  });

  it('does not discard an explicit payment decision before a later property question', () => {
    const r = replay(); r.add('Ипотека точно нужна, потом уточню какой будет платеж.');
    expectDefinite(r, 'Ипотека');
  });

  it('lets a comma-separated decided statement resolve the same payment choice', () => {
    const r = replay(); r.add('Может быть ипотека, решил: буду брать ипотеку.');
    expectDefinite(r, 'Ипотека');
  });

  it('keeps a dative recipient from changing the same mortgage antecedent', () => {
    const r = replay(); r.add('Ипотека точно нужна. Хотя не уверен, нужна ли мне она.');
    expectUncertain(r);
  });

  it.each(['Если честно, покупаю в ипотеку.', 'Если откровенно, покупаю в ипотеку.', 'Если точнее, покупаю в ипотеку.'])
  ('does not classify a discourse stance as a financing condition: %s', text => {
    const r = replay(); r.add(text); expectDefinite(r, 'Ипотека');
  });

  it.each(['Сомневаюсь, нужна ли соседям ипотека.', 'Сомневаюсь, нужна ли им она.'])
  ('keeps an explicitly different recipient outside the current payment choice: %s', text => {
    const r = replay(); r.add('Ипотека точно нужна.'); const old = activePayment(r.state)[0];
    r.add(text); expectDefinite(r, 'Ипотека');
    expect(activePayment(r.state)[0]).toMatchObject({ turnId: old.turnId, evidenceQuote: old.evidenceQuote });
  });

  it.each(['Сомневаюсь, нужна ли мне ипотека.', 'Сомневаюсь, нужна ли нам она.'])
  ('lets explicit client recipients keep same-turn doubt on the same payment choice: %s', text => {
    const r = replay(); r.add(`Ипотека точно нужна. ${text}`); expectUncertain(r);
  });
});

function replay() {
  let state = createInitialState();
  const turns: TranscriptTurn[] = [];
  return {
    get state() { return state; },
    get turns() { return turns; },
    add(text: string, speaker: 'client' | 'agent' = 'client') {
      const turn: TranscriptTurn = { id: `u39-${turns.length}`, sessionId: 'uncertainty-39', text, speaker,
        source: 'call_audio', timestamp: (turns.length + 1) * 1000, revision: turns.length + 1, isFinal: true };
      turns.push(turn);
      const result = advanceLocalConversation(state, turn, turns);
      state = result.state;
      return result;
    },
    surfaces() {
      const response = buildLocalAnalysisResponse({ sessionId: 'uncertainty-39', revision: turns.length,
        currentState: state, newTurns: [turns.at(-1)!], recentTurns: turns });
      const refreshed = evaluateFirstCallScript(turns, state);
      // The actual local applyAnalysisResult path retains canonical state and refreshes progress.
      const merged = response.modelUsed === 'local-deterministic' ? state
        : mergeSemanticFacts(state, response.factsDelta || [], turns);
      const app: ConversationState = { ...merged, scriptProgress: evaluateFirstCallScript(turns, merged) };
      return { response, refreshed, app };
    },
  };
}

function expectUncertain(r: ReturnType<typeof replay>, installment = false, decisionTurnId = r.turns.at(-1)!.id) {
  const { response, refreshed, app } = r.surfaces();
  for (const state of [r.state, app]) {
    expect.soft(state.paymentMethod).toMatchObject({ value: null, needsClarification: true });
    expect.soft(state.paymentMethod.evidenceTurnIds).toContain(decisionTurnId);
    expect.soft(activePayment(state)).toHaveLength(0);
    expect.soft(state.dialogueControl?.rejectedBranches).not.toContain('ипотеку');
    expect.soft(checkSemanticAntiRepeat({ text: 'Способ покупки?', semanticKey: 'ask_payment_method' }, state, r.turns).accepted).toBe(true);
    expect.soft(buildSessionHandoff(state).stableFacts.some(f => f.category === 'paymentMethod')).toBe(false);
    expect.soft(buildCompactAnalysisContext(state, r.turns).confirmedFacts.some(f =>
      (f as { category: string }).category === 'paymentMethod')).toBe(false);
  }
  for (const progress of [r.state.scriptProgress!, refreshed, app.scriptProgress!, response.scriptProgress!]) {
    expect.soft(progress.metrics.paymentMethod.status).toBe('needs_clarification');
    expect.soft(progress.metrics.paymentMethod.needsClarification).toBe(true);
    expect.soft(progress.ppi.paymentMethodDisclosed).toBe(false);
    expect.soft(progress.metrics.ppi.status).not.toBe('confirmed');
    expect.soft(progress.metrics.ppi.status).not.toBe('not_applicable');
    if (!installment) {
      expect.soft(progress.metrics.paymentMethod.value || '').not.toMatch(/рассроч/iu);
      expect.soft(progress.metrics.paymentMethod.semanticReason || '').not.toMatch(/рассроч/iu);
    }
  }
  expect.soft((response.factsDelta || []).some(f => f.field === 'paymentMethod' && !f.needsClarification)).toBe(false);
}

function expectDefinite(r: ReturnType<typeof replay>, value: string) {
  const { response, refreshed, app } = r.surfaces();
  for (const state of [r.state, app]) {
    expect.soft(state.paymentMethod.value).toBe(value);
    expect.soft(state.paymentMethod.needsClarification).not.toBe(true);
    expect.soft(activePayment(state)).toHaveLength(1);
    expect.soft(activePayment(state)[0]?.lifecycleStatus).toBe('confirmed');
    expect.soft(activePayment(state)[0]?.value).toBe(value);
  }
  for (const progress of [r.state.scriptProgress!, refreshed, app.scriptProgress!, response.scriptProgress!]) {
    expect.soft(progress.metrics.paymentMethod.value).toBe(value);
    expect.soft(progress.metrics.paymentMethod.status).toBe('confirmed');
    expect.soft(progress.ppi.paymentMethodDisclosed).toBe(true);
  }
}

describe('FIX39 payment uncertainty scope and cross-surface consistency', () => {
  it('preserves definite mixed financing on every surface', () => {
    const r = replay(); r.add('Часть своих, часть ипотека.'); expectDefinite(r, mixed);
  });

  it.each([productionText, 'Часть своих, часть, возможно, ипотека.', 'Может быть ипотека.',
    'Возможно возьмём небольшую ипотеку.', 'Ипотеку пока не решил.',
    'Скорее всего часть будет ипотека.', 'Ипотека под вопросом.', 'Если не хватит своих, тогда ипотека.'])
  ('does not re-confirm tentative payment or invent installment: %s', text => {
    const r = replay(); r.add(text); expectUncertain(r);
  });

  it.each([
    ['Ипотека точно нужна, размер ипотеки пока не решил.', 'Ипотека'],
    ['Ипотека точно нужна, ставку пока не знаю.', 'Ипотека'],
    ['Часть своих, часть ипотека. По району пока не решил.', mixed],
    ['Ипотека нужна, объект пока не выбрал.', 'Ипотека'],
    ['Часть своих, часть ипотека, возможно под семейную программу.', mixed],
    ['Ипотека нужна, условия пока под вопросом.', 'Ипотека'],
    ['Ипотека точно нужна. Не знаю размер ипотеки.', 'Ипотека'],
  ])('does not transfer uncertainty of another property to payment: %s', (text, value) => {
    const r = replay(); r.add(text); expectDefinite(r, value);
  });

  it('retires all active payment facts but preserves historical evidence on confirmed to uncertainty', () => {
    const r = replay(); r.add('Часть своими, остальное ипотека.'); const old = r.state.confirmedFacts.find(f => f.category === 'paymentMethod')!;
    r.add('Может быть ипотека.'); expectUncertain(r);
    expect(r.state.confirmedFacts.find(f => f.id === old.id)).toMatchObject({ value: mixed,
      evidenceQuote: 'Часть своими, остальное ипотека.', lifecycleStatus: 'superseded', turnId: old.turnId });
  });

  it('restores one current confirmed fact on uncertainty to definite confirmation', () => {
    const r = replay(); r.add('Часть своими, остальное ипотека.'); r.add('Может быть ипотека.');
    expectUncertain(r); r.add('Да, решил: часть своими, остальное ипотека.'); expectDefinite(r, mixed);
    expect(activePayment(r.state)[0]?.turnId).toBe(r.turns.at(-1)!.id);
  });

  it('retains confirmed payment across unrelated uncertainty in a new turn', () => {
    const r = replay(); r.add('Часть своими, остальное ипотека.'); r.add('По району пока не решил.'); expectDefinite(r, mixed);
  });

  it('does not treat a later mortgage-terms clause as a definite payment choice', () => {
    const r = replay(); r.add('Может быть ипотека. Условия ипотеки пока неизвестны.'); expectUncertain(r);
  });

  it('retains possibility when a later clause only discusses an undecided amount', () => {
    const r = replay(); r.add('Может быть ипотека. Размер ипотеки пока не решил.'); expectUncertain(r);
  });

  it.each([
    ['Возможно ипотека. Решил: буду брать ипотеку.', false],
    ['Буду брать ипотеку. Возможно ипотека.', true],
  ])('uses the latest same-turn payment choice: %s', (text, uncertain) => {
    const r = replay(); r.add(text); if (uncertain) expectUncertain(r); else expectDefinite(r, 'Ипотека');
  });

  it('confirms the exact same-turn decision after mortgage uncertainty without inventing PPI consent', () => {
    const r = replay(); r.add('Может быть ипотека. Да, часть точно возьмём в ипотеку.');
    expectDefinite(r, 'Ипотека');
    const { response, refreshed, app } = r.surfaces();
    for (const progress of [r.state.scriptProgress!, response.scriptProgress!, refreshed, app.scriptProgress!]) {
      expect(progress.metrics.ppi.status).toBe('not_confirmed');
    }
    expect(activePayment(r.state)[0]?.turnId).toBe(r.turns[0].id);
  });

  it.each(['Не знаю, нужна ли ипотека. Да, точно нужна.',
    'Пока не решил, использовать ли ипотеку. Да, будем брать ипотеку.'])
  ('lets a later explicit decision resolve the same mortgage choice: %s', text => {
    const r = replay(); r.add(text); expectDefinite(r, 'Ипотека');
    const { response, refreshed, app } = r.surfaces();
    for (const progress of [r.state.scriptProgress!, response.scriptProgress!, refreshed, app.scriptProgress!]) {
      expect(progress.metrics.ppi.status).toBe('not_confirmed');
    }
  });

  it.each(['Ипотека точно нужна. Хотя, может быть, всё-таки без неё.',
    'Да, будем брать ипотеку. Хотя пока не уверен, нужна ли она.',
    'Да, будем брать ипотеку. Хотя пока не уверен нужна ли она.',
    'Да, часть точно возьмём в ипотеку. Может быть ипотека.'])
  ('lets later same-turn uncertainty reopen the mortgage choice: %s', text => {
    const r = replay(); r.add(text); expectUncertain(r);
  });

  it.each(['Возможно возьмём ипотеку.',
    'Может быть ипотека. Да, возможно, будем брать ипотеку.',
    'Может быть ипотека. Не уверен, что будем брать ипотеку.',
    'Может быть ипотека. В случае одобрения точно возьмём в ипотеку.',
    'Может быть ипотека. Если ставка снизится, точно возьмём в ипотеку.'])
  ('does not mistake a tentative or conditional decision for confirmation: %s', text => {
    const r = replay(); r.add(text); expectUncertain(r);
  });

  it.each(['Может быть ипотека. Ставка точно нужна.',
    'Может быть ипотека, квартира тоже пока под вопросом. Да, точно нужна.',
    'Может быть ипотека. Квартира подходит. Да, точно нужна.'])
  ('does not borrow another object as a same-turn mortgage confirmation: %s', text => {
    const r = replay(); r.add(text); expectUncertain(r);
  });

  it('does not borrow a pronoun about the apartment as renewed mortgage uncertainty', () => {
    const r = replay(); r.add('Ипотека точно нужна. Квартира подходит. Хотя пока не уверен, нужна ли она.');
    expectDefinite(r, 'Ипотека');
  });

  it('does not borrow a nearer apartment antecedent from the same clause', () => {
    const r = replay(); r.add('Ипотека точно нужна, квартира пока под вопросом. Хотя пока не уверен, нужна ли она.');
    expectDefinite(r, 'Ипотека');
  });

  it('does not reuse a stale agent payment question for a later unrelated undecided reply', () => {
    const r = replay(); r.add('Ипотеку будете использовать или свои средства?', 'agent');
    r.add('Часть своими, остальное ипотека.'); r.add('По району пока выбираю.'); r.add('Пока не решил.'); expectDefinite(r, mixed);
  });

  it('does not interpret an amount-question answer as payment-choice uncertainty', () => {
    const r = replay(); r.add('Часть своими, остальное ипотека.');
    r.add('Какой размер ипотеки?', 'agent'); r.add('Пока не решил.'); expectDefinite(r, mixed);
  });

  it('does not mistake alternatives between rate and term for payment-method alternatives', () => {
    const r = replay(); r.add('Часть своими, остальное ипотека.');
    r.add('Ставку по ипотеке или срок кредита уже выбрали?', 'agent'); r.add('Пока не решил.'); expectDefinite(r, mixed);
  });

  it('does not re-confirm tentative payment from a new property-only mortgage mention', () => {
    const r = replay(); r.add('Может быть ипотека.'); r.add('Ставку по ипотеке пока не знаю.'); expectUncertain(r, false, 'u39-0');
    expect(r.state.paymentMethod.evidenceTurnIds).not.toContain('u39-1');
  });

  it('does not infer a new financing choice from own funds inside a mortgage-amount comment', () => {
    const r = replay(); r.add('Ипотека под вопросом.'); r.add('Размер ипотеки зависит от своих средств.'); expectUncertain(r, false, 'u39-0');
    expect(r.state.paymentMethod.evidenceTurnIds).not.toContain('u39-1');
  });

  it('does not suppress explicit non-mortgage payment evidence in response', () => {
    const r = replay(); r.add('Куплю банковским переводом.');
    expectDefinite(r, 'наличные');
    expect(r.surfaces().response.factsDelta?.some(f => f.field === 'paymentMethod')).toBe(true);
  });

  it('retains uncertainty evidence and disclosure across a shortened recent-turn window', () => {
    const r = replay(); r.add('Может быть ипотека.');
    for (let i = 0; i < 11; i += 1) r.add('Мне важна тишина.');
    const recentTurns = r.turns.slice(-10);
    const response = buildLocalAnalysisResponse({ sessionId: 'uncertainty-39', revision: r.turns.length,
      currentState: r.state, newTurns: [r.turns.at(-1)!], recentTurns });
    const refreshed = evaluateFirstCallScript(recentTurns, r.state);
    for (const progress of [response.scriptProgress!, refreshed]) {
      expect(progress.metrics.paymentMethod.status).toBe('needs_clarification');
      expect(progress.metrics.paymentMethod.evidenceTurnId).toBe('u39-0');
      expect(progress.metrics.paymentMethod.evidenceQuote).toBe('Может быть ипотека.');
      expect(progress.ppi.paymentMethodDisclosed).toBe(false);
      const state = { ...r.state, scriptProgress: progress };
      expect(checkSemanticAntiRepeat({ text: 'Способ покупки?', semanticKey: 'ask_payment_method' }, state, recentTurns).accepted).toBe(true);
    }
  });

  it('preserves FIX38 rejection and permission-only reopening after uncertainty', () => {
    const r = replay(); r.add('Может быть ипотека.'); r.add('Ипотеку не рассматриваю.');
    expect(r.state.dialogueControl?.rejectedBranches).toContain('ипотеку');
    expect(r.surfaces().response.scriptProgress?.metrics.ppi.status).toBe('not_applicable');
    r.add('Не совсем исключаем.');
    expect(r.state.paymentMethod.value).toBeNull(); expect(activePayment(r.state)).toHaveLength(0);
    expect(r.state.dialogueControl?.rejectedBranches).not.toContain('ипотеку');
    expect(r.surfaces().response.scriptProgress?.metrics.paymentMethod.status).not.toBe('confirmed');
    expect(r.surfaces().app.scriptProgress?.metrics.ppi.status).not.toBe('confirmed');
  });

  it('ignores agent-only uncertainty instead of changing client-owned confirmed financing', () => {
    const r = replay(); r.add('Часть своими, остальное ипотека.'); r.add('Может быть ипотека, пока не решили?', 'agent'); expectDefinite(r, mixed);
  });

  it('uses immediate payment question context for an elliptical uncertain client answer', () => {
    const r = replay(); r.add('Ипотеку будете использовать или только свои средства?', 'agent');
    r.add('Пока не решил.'); expectUncertain(r);
  });

  it('keeps true mortgage/installment alternatives unresolved without erasing their evidence', () => {
    const r = replay(); r.add('Пока сравниваю ипотеку и рассрочку, ещё не решил.'); expectUncertain(r, true);
    expect(r.state.scriptProgress?.metrics.paymentMethod.value).toMatch(/ипотек.*рассроч/iu);
  });

  it('does not lose uncertainty when the same evidence is projected without new client turns', () => {
    const r = replay(); r.add(productionText);
    const response = buildLocalAnalysisResponse({ sessionId: 'uncertainty-39', revision: 1,
      currentState: r.state, newTurns: [], recentTurns: r.turns });
    expect(response.scriptProgress?.metrics.paymentMethod.status).toBe('needs_clarification');
    expect(response.scriptProgress?.ppi.paymentMethodDisclosed).toBe(false);
  });

  it('keeps payment clarification eligible and next-step guards aware of uncertainty', () => {
    const r = replay(); r.add(productionText);
    const q: TranscriptTurn = { ...r.turns[0], id: 'u39-next', revision: 2, text: 'Какой следующий шаг?' };
    const state = { ...r.state, budget: { value: '20 млн', evidenceTurnIds: ['seed'] },
      criteria: { value: 'Тишина', items: [], evidenceTurnIds: ['seed'] } };
    const event = detectConversationEvent(q, [...r.turns, q], state);
    expect(event?.suggestedReply).toMatch(/уточним.*способ/iu);
  });
});

describe('FIX39 confirmed review findings R1–R4', () => {
  it.each(['Квартиру возможно возьмём в ипотеку.', 'Квартиру может быть возьмём в ипотеку.',
    'Квартиру, возможно, возьмём в ипотеку.'])
  ('R1 retains payment-choice possibility with a property subject: %s', text => {
    const r = replay(); r.add(text); expectUncertain(r);
  });

  it.each(['Не знаю, нужна ли ипотека.', 'Пока не решил, использовать ли ипотеку.'])
  ('R2 supports uncertainty with a comma before the payment-choice complement: %s', text => {
    const r = replay(); r.add(text); expectUncertain(r);
  });

  it('R2 supersedes prior confirmed payment when the new undecided complement contains a comma', () => {
    const r = replay(); r.add('Часть своими, остальное ипотека.');
    const old = activePayment(r.state)[0];
    r.add('Пока не решил, использовать ли ипотеку.'); expectUncertain(r);
    expect(r.state.confirmedFacts.find(f => f.id === old.id)).toMatchObject({
      lifecycleStatus: 'superseded', evidenceQuote: old.evidenceQuote, turnId: old.turnId });
  });

  it.each(['Не знаю, какой район, ипотека точно нужна.',
    'Не знаю, какой объект. Ипотека точно нужна.',
    'Ипотека точно нужна, район пока не решил.'])
  ('R2 does not reconnect uncertainty from another object or sentence: %s', text => {
    const r = replay(); r.add(text); expectDefinite(r, 'Ипотека');
  });

  it.each(['Ипотека точно нужна, возможно ставка будет ниже.',
    'Ипотека точно нужна, может быть ставка будет ниже.',
    'Ипотека точно нужна, возможно сумма будет меньше.',
    'Ипотека точно нужна, размер пока не решил.',
    'Ипотека нужна, условия ещё уточняю.'])
  ('R3 keeps a definite method when only its property is unsettled: %s', text => {
    const r = replay(); r.add(text); expectDefinite(r, 'Ипотека');
  });

  it.each(['Размер ипотечного кредита зависит от своих средств.',
    'Ставку по ипотеке пока не знаю.', 'Условия ипотеки ещё уточняю.'])
  ('R4 preserves existing uncertainty through a property-only turn: %s', text => {
    const r = replay(); r.add('Может быть ипотека.');
    const evidence = r.state.scriptProgress!.metrics.paymentMethod.evidenceTurnId;
    r.add(text); expectUncertain(r, false, 'u39-0');
    expect(r.state.paymentMethod.evidenceTurnIds).not.toContain('u39-1');
    for (const progress of [r.state.scriptProgress!, r.surfaces().response.scriptProgress!,
      r.surfaces().refreshed, r.surfaces().app.scriptProgress!]) {
      expect(progress.metrics.paymentMethod.evidenceTurnId).toBe(evidence);
      expect(progress.metrics.paymentMethod.evidenceQuote).toBe('Может быть ипотека.');
    }
  });

  it.each(['Размер ипотечного кредита зависит от своих средств.',
    'Ставку по ипотеке пока не знаю.', 'Условия ипотеки ещё уточняю.'])
  ('R4 does not create a payment decision from a standalone property mention: %s', text => {
    const r = replay(); r.add(text);
    const { response, refreshed, app } = r.surfaces();
    for (const state of [r.state, app]) {
      expect(state.paymentMethod.value).toBeNull(); expect(activePayment(state)).toHaveLength(0);
      expect(buildSessionHandoff(state).stableFacts.some(f => f.category === 'paymentMethod')).toBe(false);
      expect(checkSemanticAntiRepeat({ text: 'Способ покупки?', semanticKey: 'ask_payment_method' }, state, r.turns).accepted).toBe(true);
    }
    for (const progress of [r.state.scriptProgress!, response.scriptProgress!, refreshed, app.scriptProgress!]) {
      expect(progress.metrics.paymentMethod.status).not.toBe('confirmed');
      expect(progress.ppi.paymentMethodDisclosed).toBe(false);
      expect(progress.metrics.ppi.status).not.toBe('confirmed');
    }
    expect(response.factsDelta?.some(f => f.field === 'paymentMethod')).toBe(false);
  });

  it.each(['Ипотека точно нужна.', 'Да, часть точно возьмём в ипотеку.'])
  ('restores exactly one confirmed payment fact on new definite evidence: %s', text => {
    const r = replay(); r.add('Может быть ипотека.'); r.add(text); expectDefinite(r, 'Ипотека');
    expect(activePayment(r.state)[0].turnId).toBe(r.turns.at(-1)!.id);
  });

  it('retains exact FIX38 permission-only reopening control', () => {
    const r = replay(); r.add('Ипотеку исключаем.');
    expect(r.state.dialogueControl?.rejectedBranches).toContain('ипотеку');
    r.add('Не совсем исключаем.');
    expect(r.state.dialogueControl?.rejectedBranches).not.toContain('ипотеку');
    expect(r.state.paymentMethod.value).toBeNull(); expect(activePayment(r.state)).toHaveLength(0);
    for (const progress of [r.state.scriptProgress!, r.surfaces().response.scriptProgress!, r.surfaces().refreshed]) {
      expect(progress.metrics.paymentMethod.status).not.toBe('confirmed');
      expect(progress.ppi.paymentMethodDisclosed).toBe(false);
      expect(progress.metrics.ppi.status).not.toBe('confirmed');
    }
  });
});
