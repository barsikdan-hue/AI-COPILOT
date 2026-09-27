import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { chooseDialoguePolicyTarget } from './dialoguePolicyEngine';
import { advanceLocalConversation } from './localAnalysisEngine';

function clientTurn(id: string, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'decision-maker-iteration-14',
    source: 'call_audio',
    speaker: 'client',
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

function replay(texts: string[]) {
  let state: ConversationState = createInitialState();
  const turns: TranscriptTurn[] = [];
  let eventType: string | null = null;
  texts.forEach((text, index) => {
    const turn = clientTurn(`client-${index + 1}`, text, index + 1);
    turns.push(turn);
    const result = advanceLocalConversation(state, turn, turns);
    state = result.state;
    eventType = result.event?.type || null;
  });
  return { state, turns, eventType };
}

const decisionFacts = (state: ConversationState) => state.confirmedFacts.filter(
  (fact) => fact.category === 'decision_makers'
);

const activeDecisionFacts = (state: ConversationState) => decisionFacts(state).filter(
  (fact) => !['superseded', 'rejected'].includes(fact.lifecycleStatus || '')
);

describe('FIX ITERATION 14 decision maker / ЛПР', () => {
  it('A: understands “Решение о покупке принимаю сам” across canonical, fact and metric layers', () => {
    const { state, turns } = replay(['Решение о покупке принимаю сам.']);
    expect(state.decisionMakers.value).toMatch(/самостоятель/iu);
    expect(activeDecisionFacts(state)).toHaveLength(1);
    expect(activeDecisionFacts(state)[0].evidenceQuote).toMatch(/решение о покупке принимаю сам/iu);
    expect(state.scriptProgress?.metrics.decisionMaker).toMatchObject({
      status: 'confirmed',
      value: state.decisionMakers.value,
    });

    const metrics = state.scriptProgress!.metrics;
    const allClosed = Object.fromEntries(Object.entries(metrics).map(([id, metric]) => [
      id,
      { ...metric, status: 'confirmed' },
    ]));
    const beforeProgress = {
      ...state.scriptProgress!,
      metrics: {
        ...allClosed,
        decisionMaker: { ...metrics.decisionMaker, status: 'not_confirmed', value: null },
      },
    } as typeof state.scriptProgress;
    const beforeState = {
      ...state,
      decisionMakers: { value: null, evidenceTurnIds: [] },
      scriptProgress: beforeProgress,
    };
    expect(chooseDialoguePolicyTarget(beforeState, turns, beforeProgress)?.metric).toBe('decisionMaker');
    expect(chooseDialoguePolicyTarget(state, turns)?.metric).not.toBe('decisionMaker');
  });

  it.each([
    ['B', 'Я сам принимаю решение.'],
    ['C', 'Решение принимаю самостоятельно.'],
    ['D', 'Покупку решаю сам.'],
  ])('%s: confirms explicit sole decision semantics: %s', (_case, text) => {
    const { state } = replay([text]);
    expect(state.decisionMakers.value).toMatch(/самостоятель/iu);
    expect(state.scriptProgress?.metrics.decisionMaker.value).toBe(state.decisionMakers.value);
    expect(activeDecisionFacts(state)).toHaveLength(1);
  });

  it('E: joint authority wins over unrelated “сам смотрю”', () => {
    const { state } = replay(['Я сам смотрю варианты, но решение принимаем с женой.']);
    expect(state.decisionMakers.value).toMatch(/совмест|супруг|семь/iu);
    expect(state.decisionMakers.value).not.toMatch(/самостоятель/iu);
    expect(state.scriptProgress?.metrics.decisionMaker.value).toBe(state.decisionMakers.value);
  });

  it('F: records an explicit joint decision', () => {
    const { state } = replay(['Решение принимаем вместе с супругой.']);
    expect(state.decisionMakers.value).toMatch(/совмест|супруг|семь/iu);
    expect(state.decisionMakers.value).not.toMatch(/самостоятель/iu);
  });

  it('G: does not attribute third-party final authority to the client', () => {
    const { state } = replay(['Финальное решение за женой.']);
    expect(state.decisionMakers.value).toMatch(/супруг|другой участник/iu);
    expect(state.decisionMakers.value).not.toMatch(/самостоятель/iu);
    expect(state.scriptProgress?.metrics.decisionMaker.value).toBe(state.decisionMakers.value);
  });

  it('H: “сам посмотрю” is not sole authority when family approval follows', () => {
    const { state } = replay(['Сначала сам посмотрю, потом обсудим с семьёй.']);
    expect(state.decisionMakers.value).toMatch(/совмест|семь|супруг/iu);
    expect(state.decisionMakers.value).not.toMatch(/самостоятель/iu);
  });

  it('I: keeps explicit uncertainty unresolved', () => {
    const { state } = replay(['Пока не знаю, кто будет принимать окончательное решение.']);
    expect(state.decisionMakers.value).toBeNull();
    expect(activeDecisionFacts(state)).toHaveLength(0);
    expect(state.scriptProgress?.metrics.decisionMaker.status).toBe('not_confirmed');
  });

  it('J: supersedes joint authority with a genuine sole-decision correction', () => {
    const { state, eventType } = replay([
      'Решение принимаем вместе.',
      'Нет, в итоге решать буду я сам.',
    ]);
    const [oldFact, newFact] = decisionFacts(state);
    expect(state.decisionMakers.value).toMatch(/самостоятель/iu);
    expect(oldFact.lifecycleStatus).toBe('superseded');
    expect(newFact.lifecycleStatus).toBe('confirmed');
    expect(newFact.supersedesFactId).toBe(oldFact.id);
    expect(activeDecisionFacts(state)).toEqual([newFact]);
    expect(state.scriptProgress?.metrics.decisionMaker.value).toBe(state.decisionMakers.value);
    expect(eventType).toBe('FACT_CORRECTION');
  });

  it('K: supersedes sole authority when spouse approval becomes required', () => {
    const { state, eventType } = replay([
      'Решаю сам.',
      'Нет, всё-таки нужно согласовать с женой.',
    ]);
    const [oldFact, newFact] = decisionFacts(state);
    expect(state.decisionMakers.value).toMatch(/совмест|супруг|семь/iu);
    expect(state.decisionMakers.value).not.toMatch(/самостоятель/iu);
    expect(oldFact.lifecycleStatus).toBe('superseded');
    expect(newFact.supersedesFactId).toBe(oldFact.id);
    expect(activeDecisionFacts(state)).toEqual([newFact]);
    expect(state.scriptProgress?.metrics.decisionMaker.value).toBe(state.decisionMakers.value);
    expect(eventType).toBe('FACT_CORRECTION');
  });
});
