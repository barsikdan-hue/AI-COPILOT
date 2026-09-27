import { describe, expect, it } from 'vitest';
import type { ConversationState, SpeakerRole, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

function turn(id: string, speaker: SpeakerRole, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'down-payment-readiness-iteration-13',
    source: speaker === 'agent' ? 'microphone' : 'call_audio',
    speaker,
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

function replay(agentText: string | null, clientText: string) {
  let state: ConversationState = createInitialState();
  const turns: TranscriptTurn[] = [];
  if (agentText) {
    const agent = turn('agent', 'agent', agentText, 1);
    turns.push(agent);
    state = advanceLocalConversation(state, agent, turns).state;
  }
  const client = turn('client', 'client', clientText, turns.length + 1);
  turns.push(client);
  const result = advanceLocalConversation(state, client, turns);
  return { beforeClient: state, client, result, turns };
}

const activeDownPaymentFacts = (state: ConversationState) => state.confirmedFacts.filter(
  (fact) => fact.category === 'downPayment' && !['superseded', 'rejected'].includes(fact.lifecycleStatus || '')
);

describe('FIX ITERATION 13 down-payment readiness', () => {
  it('A: records explicit readiness without inventing an amount or repeating readiness', () => {
    const scenario = replay(
      'Средства на первоначальный взнос уже доступны?',
      'Да, первоначальный взнос уже есть.',
    );
    const { state } = scenario.result;
    expect(state.downPayment?.value).toMatch(/средств.*доступ|взнос.*есть/iu);
    expect(state.downPayment?.value).not.toMatch(/\d/iu);
    expect(state.downPayment?.needsClarification).toBe(true);
    expect(activeDownPaymentFacts(state)).toHaveLength(1);
    expect(activeDownPaymentFacts(state)[0].evidenceQuote).toMatch(/первоначальный взнос уже есть/iu);
    expect(state.scriptProgress?.metrics.downPayment.status).toBe('partially_confirmed');

    const response = buildLocalAnalysisResponse({
      sessionId: 'down-payment-readiness-iteration-13',
      revision: scenario.client.revision || 2,
      newTurns: [scenario.client],
      recentTurns: scenario.turns,
      currentState: scenario.beforeClient,
    });
    expect(response.suggestedReply || '').not.toMatch(/взнос.*(?:есть|доступ|сформирован)|средств.*(?:есть|доступ)/iu);
  });

  it('B: accepts a short answer only in an explicit readiness context', () => {
    const { result } = replay('Первоначальный взнос уже сформирован?', 'Да, уже есть.');
    expect(result.state.downPayment?.value).toMatch(/средств.*доступ/iu);
    expect(activeDownPaymentFacts(result.state)[0].evidenceQuote).toMatch(/да, уже есть/iu);
  });

  it('C: accepts a self-contained readiness statement without prior context', () => {
    const { result } = replay(null, 'Первоначальный взнос уже есть.');
    expect(result.state.downPayment?.value).toMatch(/средств.*доступ/iu);
    expect(result.state.downPayment?.needsClarification).toBe(true);
  });

  it('D: preserves a positive statement tied explicitly to the first payment', () => {
    const { result } = replay(null, 'На первый взнос деньги есть.');
    expect(result.state.downPayment?.value).toMatch(/средств.*доступ/iu);
    expect(activeDownPaymentFacts(result.state)).toHaveLength(1);
  });

  it('E: does not turn current absence into positive readiness', () => {
    const { result } = replay(null, 'Пока первоначального взноса нет.');
    expect(result.state.downPayment?.value ?? null).toBeNull();
    expect(activeDownPaymentFacts(result.state)).toHaveLength(0);
  });

  it('F: keeps future availability distinct from available-now readiness', () => {
    const { result } = replay(null, 'Первоначальный взнос будет через месяц.');
    expect(result.state.downPayment?.value).toMatch(/будут доступны позже|сейчас.*не подтверждена/iu);
    expect(result.state.downPayment?.value).not.toMatch(/^средства.*доступны;/iu);
    expect(result.state.downPayment?.needsClarification).toBe(true);
  });

  it('G: records an explicit down-payment amount and does not turn it into budget', () => {
    const { result } = replay(null, 'Есть примерно 5 миллионов на первоначальный взнос.');
    expect(result.state.downPayment?.value).toBe('5 млн руб');
    expect(result.state.budget.value).toBeNull();
    expect(result.state.scriptProgress?.metrics.downPayment.status).toBe('confirmed');
  });

  it('H: keeps budget and down-payment amounts separate', () => {
    const { result } = replay(null, 'Бюджет 20 млн, первоначальный взнос 5 млн.');
    expect(result.state.budget.value).toBe('20 млн руб');
    expect(result.state.downPayment?.value).toBe('5 млн руб');
  });

  it('I: generic money does not become an amount allocated to the first payment', () => {
    const { result } = replay(null, 'Деньги есть, но пока не решил, сколько пойдёт на первоначальный взнос.');
    expect(result.state.downPayment?.value).toMatch(/точный размер не назван/iu);
    expect(result.state.downPayment?.value).not.toMatch(/\d/iu);
    expect(result.state.downPayment?.needsClarification).toBe(true);
  });

  it('J: partial readiness is not upgraded to full readiness', () => {
    const { result } = replay('Средства на первоначальный взнос уже доступны?', 'Частично.');
    expect(result.state.downPayment?.value).toMatch(/частично/iu);
    expect(result.state.downPayment?.needsClarification).toBe(true);
    expect(result.state.scriptProgress?.metrics.downPayment.status).toBe('partially_confirmed');
  });

  it('K: does not broaden “not a problem” into a readiness or amount fact', () => {
    const { result } = replay(null, 'Первоначальный взнос не проблема.');
    expect(result.state.downPayment?.value ?? null).toBeNull();
    expect(activeDownPaymentFacts(result.state)).toHaveLength(0);
  });

  it('does not accept a generic short positive after an unrelated financial question', () => {
    const { result } = replay('Бюджет уже определили?', 'Да, уже есть.');
    expect(result.state.downPayment?.value ?? null).toBeNull();
    expect(activeDownPaymentFacts(result.state)).toHaveLength(0);
  });
});
