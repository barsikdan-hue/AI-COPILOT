import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

const productionText = 'Часть своих, часть, возможно, ипотека, но без фанатизма. Если будет понятная схема, но не хочу сложных конструкций.';

function replay() {
  let state = createInitialState();
  const turns: TranscriptTurn[] = [];
  return {
    get state() { return state; },
    add(text: string, speaker: 'agent' | 'client' = 'client') {
      const turn: TranscriptTurn = { id: `m38-${turns.length}`, sessionId: 'mortgage-scope-38', text, speaker,
        source: 'call_audio', timestamp: (turns.length + 1) * 1000, revision: turns.length + 1, isFinal: true };
      turns.push(turn);
      const result = advanceLocalConversation(state, turn, turns);
      state = result.state;
      return result;
    },
    response(lastOnly = false) { return buildLocalAnalysisResponse({ sessionId: 'mortgage-scope-38', revision: turns.length,
      newTurns: [turns.at(-1)!], recentTurns: lastOnly ? [turns.at(-1)!] : turns, currentState: state }); },
  };
}

function expectOpen(r: ReturnType<typeof replay>) {
  expect(r.state.dialogueControl?.rejectedBranches).not.toContain('ипотеку');
  expect(r.state.scriptProgress?.metrics.ppi.status).not.toBe('not_applicable');
  const response = r.response();
  expect(response.scriptProgress?.metrics.ppi.status).not.toBe('not_applicable');
  expect(response.suggestedReply || '').not.toMatch(/ипотек[^.!?]{0,15}исключаем/iu);
}

describe('FIX38 mortgage rejection scope and reopening', () => {
  // Catch target proximity and the independent accumulated-text PPI rejection.
  it.each([
    productionText,
    productionText.replace(', но без фанатизма', ''),
    productionText.replace(', возможно', ''),
    productionText.replace('. Если', '; если'),
    'Часть своих, часть ипотека, но не хочу сложных конструкций.',
    'Ипотека подходит. Не хочу сложных конструкций.',
    'Не только ипотека, могу часть внести своими.',
    'Ипотека допустима, но не хочу сложных конструкций.',
    'Ипотека, но без фанатизма.',
    'Если ипотека будет простой, рассмотрю.',
    'Не хочу сложную ипотечную схему.',
    'Не хочу сложных конструкций, ипотека допустима.',
  ])('does not reject mortgage for unrelated or additive negation: %s', text => {
    const r = replay();
    const result = r.add(text);
    expect(result.event?.rejectedBranch).not.toBe('ипотеку');
    expectOpen(r);
  });

  it('does not destroy an independently extracted mixed payment fact through unrelated negation', () => {
    const r = replay();
    r.add('Часть своих, часть ипотека, но не хочу сложных конструкций.');
    expect(r.state.paymentMethod.value).toBe('Смешанная схема: собственные средства + ипотека');
    expect(r.state.confirmedFacts.filter(f => f.category === 'paymentMethod' && f.lifecycleStatus === 'confirmed')).toHaveLength(1);
  });

  it('keeps the existing uncertainty outcome for the exact production wording', () => {
    const r = replay(); r.add(productionText);
    expect(r.state.paymentMethod).toMatchObject({ value: null, needsClarification: true });
    expectOpen(r);
  });

  it('does not attach an unrelated later turn to the earlier mortgage', () => {
    const r = replay(); r.add('Рассматриваю ипотеку.'); r.add('Не хочу сложных конструкций.');
    expect(r.state.paymentMethod.value).toBe('Ипотека');
    expectOpen(r);
  });

  // Catch missed true rejections, including those without the old general gate.
  it.each(['Ипотеку не хочу.', 'Ипотеку не рассматриваю.', 'Без ипотеки.', 'Ипотеку исключаем.', 'Только свои, ипотека не нужна.'])
  ('closes mortgage on a real scoped refusal: %s', text => {
    const r = replay(); r.add('Рассматриваю ипотеку.'); r.add(text);
    expect(r.state.dialogueControl?.rejectedBranches).toContain('ипотеку');
    expect(r.state.paymentMethod.value).toBeNull();
    expect(r.state.confirmedFacts.filter(f => f.category === 'paymentMethod' && f.lifecycleStatus === 'confirmed')).toHaveLength(0);
    expect(r.response().scriptProgress?.metrics.ppi.status).toBe('not_applicable');
  });

  it.each(['Ипотеку всё-таки рассматриваю.', 'Часть можем взять в ипотеку.', 'Ипотека допустима.', 'Не исключаю ипотеку.', 'Часть своими, остальное ипотека.'])
  ('reopens a rejected mortgage on new client permission: %s', text => {
    const r = replay(); r.add('Ипотеку не рассматриваю.'); r.add(text);
    expectOpen(r);
    expect(r.response().scriptProgress?.metrics.ppi.status).not.toBe('confirmed');
  });

  it('reopens on the immediate client correction without inventing a payment fact', () => {
    const r = replay(); r.add('Ипотеку исключаем.'); r.add('Не совсем исключаем.');
    expectOpen(r);
    expect(r.state.paymentMethod.value).toBeNull();
    expect(r.response().scriptProgress?.metrics.paymentMethod.status).not.toBe('confirmed');
    expect(r.response().scriptProgress?.metrics.paymentMethod.value).not.toBe('Ипотека');
    expect(r.state.confirmedFacts.filter(f => f.category === 'paymentMethod' && f.lifecycleStatus === 'confirmed')).toHaveLength(0);
  });

  it('accepts the correction of the immediate agent echo of a client-owned rejection', () => {
    const r = replay(); r.add('Ипотеку не рассматриваю.');
    r.add('Понял, ипотеку исключаем и дальше эту ветку не предлагаю.', 'agent'); r.add('Не совсем исключаем.');
    expectOpen(r);
    expect(r.state.paymentMethod.value).toBeNull();
  });

  it('does not reopen on an ambiguous correction without current mortgage context', () => {
    const r = replay(); r.add('Ипотеку не рассматриваю.'); r.add('Мне важна тишина.'); r.add('Не совсем исключаем.');
    expect(r.state.dialogueControl?.rejectedBranches).toContain('ипотеку');
    expect(r.response().scriptProgress?.metrics.ppi.status).toBe('not_applicable');
  });

  it('does not reopen an arbitrary other branch on a short correction', () => {
    const r = replay(); r.add('Дом не хочу.'); r.add('Не совсем исключаем.');
    expect(r.state.dialogueControl?.rejectedBranches).toContain('дом');
    expect(r.state.dialogueControl?.rejectedBranches).not.toContain('ипотеку');
  });

  it('does not reopen mortgage on an agent permission or a mere mention', () => {
    const r = replay(); r.add('Ипотеку не рассматриваю.');
    r.add('Ипотеку всё-таки рассматриваем.', 'agent'); r.add('Какие ставки по ипотеке?');
    expect(r.state.dialogueControl?.rejectedBranches).toContain('ипотеку');
  });

  it('closes the branch again after a newer explicit refusal', () => {
    const r = replay(); r.add('Ипотека допустима.'); r.add('Ипотеку не хочу.');
    expect(r.state.dialogueControl?.rejectedBranches).toContain('ипотеку');
    expect(r.response().scriptProgress?.metrics.ppi.status).toBe('not_applicable');
  });

  it('preserves a new active mixed fact after reopening rather than projecting an old rejection', () => {
    const r = replay(); r.add('Ипотеку не рассматриваю.'); r.add('Часть своими, остальное ипотека.');
    expect(r.state.paymentMethod.value).toBe('Смешанная схема: собственные средства + ипотека');
    expect(r.response().scriptProgress?.metrics.paymentMethod.value).toBe('Смешанная схема: собственные средства + ипотека');
    expectOpen(r);
  });

  it('does not turn an agent-only negative question into client rejection', () => {
    const r = replay(); r.add('Ипотеку не рассматриваем?', 'agent');
    expect(r.state.dialogueControl?.rejectedBranches).not.toContain('ипотеку');
    expect(r.state.paymentMethod.value).toBeNull();
    r.add('Нет, ипотека допустима.'); expectOpen(r);
  });

  it('records an explicit client confirmation of rejection after the agent question', () => {
    const r = replay(); r.add('Ипотеку не рассматриваем?', 'agent'); r.add('Да, ипотеку не рассматриваю.');
    expect(r.state.dialogueControl?.rejectedBranches).toContain('ипотеку');
    expect(r.response().scriptProgress?.metrics.ppi.status).toBe('not_applicable');
  });

  it.each([
    ['Ипотеку не хочу, но ипотека допустима.', false],
    ['Ипотека допустима, но ипотеку не хочу.', true],
  ] as const)('uses the latest scoped same-turn decision: %s', (text, rejected) => {
    const r = replay(); r.add(text);
    expect(r.state.dialogueControl?.rejectedBranches.includes('ипотеку')).toBe(rejected);
    expect(r.response().scriptProgress?.metrics.ppi.status === 'not_applicable').toBe(rejected);
  });

  it.each(['Ипотеку брать не хочу.', 'Ипотека не подходит мне.', 'Ипотеку не рассматриваю из-за высокой ставки.',
    'Ипотеку не хочу. Какие есть варианты без неё?'])('retains scoped refusals with an infinitive, reason or separate question: %s', text => {
    const r = replay(); r.add('Рассматриваю ипотеку.'); r.add(text);
    expect(r.state.dialogueControl?.rejectedBranches).toContain('ипотеку');
    expect(r.state.paymentMethod.value).toBeNull();
    expect(r.response().scriptProgress?.metrics.ppi.status).toBe('not_applicable');
  });

  it.each(['Без ипотеки не обойтись.', 'Не можем обойтись без ипотеки.', 'Не могу без ипотеки.'])('does not reverse mortgage necessity into rejection: %s', text => {
    const r = replay(); r.add(text); expectOpen(r);
  });

  it('does not let an older uncertain turn override a newer real mortgage refusal', () => {
    const r = replay(); r.add('Возможно ипотека, пока не решил.'); r.add('Ипотеку не рассматриваю.');
    expect(r.state.dialogueControl?.rejectedBranches).toContain('ипотеку');
    expect(r.response().scriptProgress?.metrics.ppi.status).toBe('not_applicable');
  });

  it('retains the canonical refusal when its evidence falls outside the recent-turn window', () => {
    const r = replay(); r.add('Ипотеку не рассматриваю.'); r.add('Мне важна тишина.');
    expect(r.response(true).scriptProgress?.metrics.ppi.status).toBe('not_applicable');
  });

  it('does not resurrect a superseded mortgage through historical text after a short reopening', () => {
    const r = replay(); r.add('Часть своими, остальное ипотека.'); r.add('Ипотеку исключаем.'); r.add('Не совсем исключаем.');
    expectOpen(r);
    expect(r.state.paymentMethod.value).toBeNull();
    expect(r.response().scriptProgress?.metrics.paymentMethod.status).not.toBe('confirmed');
    expect(r.response().scriptProgress?.metrics.paymentMethod.value).toBeNull();
  });
});
