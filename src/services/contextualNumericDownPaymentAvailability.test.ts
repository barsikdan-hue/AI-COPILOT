import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

const question = 'Первоначальный взнос уже можно внести?';
const unavailable = [
  '2 млн будут только в декабре',
  '2 млн поступят после закрытия вклада',
  '2 млн сейчас недоступны',
  '2 млн сейчас не доступны',
  'В декабре поступят 2 млн',
  'Сейчас недоступны 2 млн',
  '2 млн появятся после закрытия вклада',
  'деньги будут на руках через месяц',
  'сейчас 2 млн недоступны',
  '2 млн будут на руках через месяц',
  '2 млн будут через месяц',
  '2 млн будут к декабрю',
  '2 млн будут после закрытия вклада',
  'После закрытия вклада появятся 2 млн',
];
const activeDp = (state: ConversationState) => state.confirmedFacts.filter(fact =>
  ['downPayment', 'down_payment'].includes(fact.category) &&
  !['superseded', 'rejected'].includes(fact.lifecycleStatus || ''),
);

function replay(texts: string[]) {
  const input = [{ speaker: 'agent' as const, text: question },
    ...texts.map(text => ({ speaker: 'client' as const, text }))];
  const turns: TranscriptTurn[] = input.map((turn, index) => ({
    ...turn, id: `numeric-dp-${index}`, sessionId: 'numeric-dp-availability',
    source: turn.speaker === 'agent' ? 'microphone' : 'call_audio',
    timestamp: (index + 1) * 10000, isFinal: true, revision: index + 1,
  }));
  let state = createInitialState();
  let before = state;
  for (const [index, turn] of turns.entries()) {
    before = state;
    state = advanceLocalConversation(state, turn, turns.slice(0, index + 1)).state;
  }
  const client = turns.at(-1)!;
  const analysis = buildLocalAnalysisResponse({
    sessionId: client.sessionId, revision: client.revision!, newTurns: [client], recentTurns: turns, currentState: before,
  });
  return { state, analysis, client };
}

describe('contextual numeric DP does not imply current availability', () => {
  it('rejects future availability before the independent sanitizer fallback', () => {
    const raw = extractDeterministicFacts('2 млн будут доступны через месяц', 'future-available', question, question);
    expect(raw.filter(fact => fact.field === 'downPayment')).toHaveLength(0);
    // The downstream canonical assertion is preserved in diagnostics as FIX-S.
  });

  // A regression in the contextual numeric emitter would put the future or
  // denied amount into raw facts, canonical state and the active fact ledger.
  it.each(unavailable)('rejects noncurrent numeric funds: %s', text => {
    const { state, analysis, client } = replay([text]);
    const raw = extractDeterministicFacts(text, client.id, question, question);
    expect(raw.filter(fact => fact.field === 'downPayment')).toHaveLength(0);
    expect(state.downPayment?.value ?? null).toBeNull();
    expect(activeDp(state)).toHaveLength(0);
    expect(analysis.factsDelta.filter(fact => fact.field === 'downPayment')).toHaveLength(0);
  });

  it.each([
    ['2 млн уже на руках', '2 млн руб'],
    ['2 млн уже есть', '2 млн руб'],
    ['2 млн сейчас доступны', '2 млн руб'],
    ['эти 2 млн пойдут на первый взнос, они уже на счёте', '2 млн руб'],
    ['эти 2 млн пойдут на первый взнос, они уже есть', '2 млн руб'],
    ['2 млн', '2 млн руб'],
    ['4,5 млн', '4.5 млн руб'],
    ['2 млн уже на руках, квартира будет доступна в декабре.', '2 млн руб'],
    ['2 млн уже на руках, документы сейчас недоступны.', '2 млн руб'],
    ['Документы сейчас недоступны, 2 млн уже на руках.', '2 млн руб'],
    ['2 млн будут первым взносом, деньги уже на руках.', '2 млн руб'],
    ['2 млн будут в качестве первого взноса, деньги уже на руках.', '2 млн руб'],
    ['2 млн будут в счёт первого взноса, деньги уже на руках.', '2 млн руб'],
    ['2 млн будут через банк, деньги уже на руках.', '2 млн руб'],
    ['2 млн будут в декабре первым взносом, деньги уже на руках.', '2 млн руб'],
    ['2 млн будут в декабре первым взносом, они уже есть.', '2 млн руб'],
    ['2 млн будут в декабре первым взносом, средства уже на счёте.', '2 млн руб'],
    ['2 млн будут в декабре первым взносом, деньги сейчас доступны.', '2 млн руб'],
  ])('preserves current and unqualified contextual amounts: %s', (text, value) => {
    const { state, client } = replay([text]);
    const raw = extractDeterministicFacts(text, client.id, question, question);
    expect(raw.filter(fact => fact.field === 'downPayment')).toEqual(expect.arrayContaining([
      expect.objectContaining({ value, status: 'confirmed' }),
    ]));
    expect(state.downPayment?.value).toBe(value);
    expect(state.downPayment?.needsClarification).not.toBe(true);
    expect(activeDp(state)).toEqual([expect.objectContaining({ value })]);
  });

  it.each([
    '2 млн будут только в декабре, документы уже на руках.',
    '2 млн будут только в декабре, у родителей деньги уже на руках.',
    '2 млн сейчас недоступны, остальные деньги уже на руках.',
    '2 млн будут доступны через месяц, остальные деньги уже на руках.',
    '2 млн будут в декабре первым взносом, деньги будут на руках через месяц.',
    '2 млн будут в декабре первым взносом, деньги ещё не на руках.',
    '2 млн будут в декабре первым взносом, деньги уже есть, но не все.',
    '2 млн будут в декабре первым взносом, деньги уже есть. Но не все.',
    '2 млн будут в декабре первым взносом, документы готовы, деньги уже есть.',
    '2 млн будут в декабре первым взносом, 1 млн уже есть.',
    '2 млн появятся после закрытия вклада, деньги уже на руках.',
    '2 млн сейчас недоступны, деньги уже есть.',
  ])('does not use unrelated current evidence to override numeric unavailability: %s', text => {
    const raw = extractDeterministicFacts(text, 'unrelated-current', question, question);
    expect(raw.filter(fact => fact.field === 'downPayment' && fact.value === '2 млн руб')).toHaveLength(0);
  });

  it('preserves explicit amount precedence for the existing partial wording', () => {
    const { state } = replay(['первый взнос 2 млн, часть уже есть']);
    expect(state.downPayment?.value).toBe('2 млн руб');
    expect(activeDp(state)).toEqual([expect.objectContaining({ value: '2 млн руб' })]);
  });

  it('preserves established partial readiness without an explicit amount', () => {
    const { state } = replay(['Собрана только часть первоначального взноса.']);
    expect(state.downPayment?.value).toMatch(/доступна частично/iu);
    expect(state.downPayment?.needsClarification).toBe(true);
    expect(state.scriptProgress?.metrics.downPayment.status).toBe('partially_confirmed');
  });

  it('preserves partial current funds when the remainder arrives later', () => {
    const { state } = replay(['Собрана часть первоначального взноса, остальные деньги на взнос поступят после закрытия вклада.']);
    expect(state.downPayment?.value).toMatch(/доступна частично/iu);
    expect(state.downPayment?.needsClarification).toBe(true);
    expect(state.scriptProgress?.metrics.downPayment.status).toBe('partially_confirmed');
  });

  it('preserves explicit cancellation of the previous DP', () => {
    const { state } = replay(['Первый взнос 4 млн.', 'Первоначального взноса сейчас нет']);
    expect(state.downPayment?.value ?? null).toBeNull();
    expect(activeDp(state)).toHaveLength(0);
    expect(state.confirmedFacts.find(fact => fact.value === '4 млн руб')?.lifecycleStatus).toBe('superseded');
  });

  it.each(['Точнее, первый взнос 2 млн.', 'Точнее, 2 млн уже на руках.'])(
    'preserves correction of a previously confirmed amount: %s', text => {
      const { state } = replay(['Первый взнос 4 млн.', text]);
      expect(state.downPayment?.value).toBe('2 млн руб');
      expect(activeDp(state)).toEqual([expect.objectContaining({ value: '2 млн руб' })]);
      expect(state.confirmedFacts.find(fact => fact.value === '4 млн руб')?.lifecycleStatus).toBe('superseded');
    },
  );

  it.each(unavailable.slice(0, 3))('does not treat a noncurrent amount as cancellation: %s', text => {
    const { state } = replay(['Первый взнос 4 млн.', text]);
    expect(state.downPayment?.value).toBe('4 млн руб');
    expect(activeDp(state)).toEqual([expect.objectContaining({ value: '4 млн руб' })]);
  });
});
