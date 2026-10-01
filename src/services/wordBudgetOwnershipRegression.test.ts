import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

function replay(texts: string[]) {
  let state = createInitialState();
  const turns: TranscriptTurn[] = [];
  const states: ConversationState[] = [];
  for (const [index, text] of texts.entries()) {
    const turn: TranscriptTurn = {
      id: `ownership-${index}`, sessionId: 'word-budget-ownership',
      source: 'call_audio', speaker: 'client', text, timestamp: (index + 1) * 1000,
      isFinal: true, revision: index + 1,
    };
    turns.push(turn);
    state = advanceLocalConversation(state, turn, turns).state;
    states.push(state);
  }
  return { state, states, turns };
}

const activeBudget = (state: ConversationState) => state.confirmedFacts.filter(
  fact => fact.category === 'budget' && !['superseded', 'rejected'].includes(fact.lifecycleStatus || ''),
);

describe('client ownership of spoken budgets', () => {
  it('keeps the confirmed client budget after mentioning his brother budget', () => {
    const { state, states, turns } = replay([
      'Бюджет 15 млн',
      'У моего брата бюджет двадцать пять миллионов',
    ]);
    expect(states[0].budget.value).toBe('15 млн руб');
    const original = activeBudget(states[0])[0];
    expect(state.budget.value).toBe('15 млн руб');
    expect(activeBudget(state)).toEqual([expect.objectContaining({
      id: original.id, value: '15 млн руб', turnId: turns[0].id, lifecycleStatus: 'confirmed',
    })]);
    expect(state.confirmedFacts.filter(fact => fact.category === 'budget')).toHaveLength(1);
    expect(state.confirmedFacts.find(fact => fact.id === original.id)?.lifecycleStatus).toBe('confirmed');
  });

  it.each([
    'У моего брата бюджет двадцать пять миллионов',
    'У моей сестры бюджет двадцать пять миллионов',
    'У брата бюджет двадцать пять миллионов',
    'У брата не мой бюджет двадцать пять миллионов',
    'У брата не наш бюджет двадцать пять миллионов',
  ])('does not extract or activate a third-party budget: %s', text => {
    expect(extractDeterministicFacts(text, 'foreign').filter(fact => fact.field === 'budget')).toEqual([]);
    const { state } = replay([text]);
    expect(state.budget.value).toBeNull();
    expect(activeBudget(state)).toEqual([]);
    expect(state.confirmedFacts.filter(fact => fact.category === 'budget')).toEqual([]);
  });

  it('extracts and confirms the client own spoken budget', () => {
    const text = 'У меня бюджет двадцать пять миллионов';
    expect(extractDeterministicFacts(text, 'own').filter(fact => fact.field === 'budget')).toEqual([
      expect.objectContaining({ value: '25 млн руб', evidenceTurnId: 'own' }),
    ]);
    const { state, turns } = replay([text]);
    expect(state.budget.value).toBe('25 млн руб');
    expect(activeBudget(state)).toEqual([
      expect.objectContaining({ value: '25 млн руб', turnId: turns[0].id, lifecycleStatus: 'confirmed' }),
    ]);
  });

  it.each([
    ['У моего брата бюджет двадцать пять миллионов, а мой бюджет двадцать миллионов.', '20 млн руб', '25 млн руб'],
    ['Мой бюджет двадцать миллионов, а у моего брата бюджет двадцать пять миллионов.', '20 млн руб', '25 млн руб'],
    ['У моей сестры бюджет двадцать пять миллионов; мой бюджет двадцать миллионов.', '20 млн руб', '25 млн руб'],
    ['У моего брата бюджет пять млн а мой бюджет десять млн', '10 млн руб', '5 млн руб'],
    ['У моей сестры бюджет пять млн а у меня бюджет десять млн', '10 млн руб', '5 млн руб'],
    ['У моего брата бюджет пять млн а наш бюджет десять млн', '10 млн руб', '5 млн руб'],
    ['У моего брата бюджет пять млн а у нас бюджет десять млн', '10 млн руб', '5 млн руб'],
    ['У моего брата бюджет пять млн и мой бюджет десять млн', '10 млн руб', '5 млн руб'],
  ])('preserves a separate client budget in a mixed-owner turn: %s', (text, ownValue, foreignValue) => {
    expect(extractDeterministicFacts(text, 'mixed').filter(fact => fact.field === 'budget')).toEqual([
      expect.objectContaining({ value: ownValue, evidenceTurnId: 'mixed' }),
    ]);
    const { state, turns } = replay(['Бюджет 15 млн', text]);
    expect(state.budget.value).toBe(ownValue);
    expect(activeBudget(state)).toEqual([
      expect.objectContaining({ value: ownValue, turnId: turns[1].id, lifecycleStatus: 'confirmed' }),
    ]);
    expect(state.confirmedFacts.filter(fact => fact.category === 'budget').map(fact => fact.value)).not.toContain(foreignValue);
  });
});

describe('FIX48 ownership across numeric budgets and corrections', () => {
  it.each([
    'У брата бюджет 25 млн',
    'У моего брата бюджет 25 млн',
    'У брата бюджет не 15, а 25 млн',
    'У брата бюджет не 15 млн, а 25 млн',
    'У брата бюджет не пятнадцать миллионов, а двадцать пять миллионов',
    'У моего брата не пятнадцать миллионов, а двадцать пять миллионов',
  ])('keeps the original client budget and ledger after foreign evidence: %s', text => {
    expect(extractDeterministicFacts(text, 'foreign').filter(fact => fact.field === 'budget')).toEqual([]);
    const { state, states, turns } = replay(['Бюджет 15 млн', text]);
    const original = activeBudget(states[0])[0];
    expect(state.budget.value).toBe('15 млн руб');
    expect(state.budget.evidenceTurnIds).toEqual([turns[0].id]);
    expect(activeBudget(state)).toEqual([expect.objectContaining({
      id: original.id, value: '15 млн руб', turnId: turns[0].id, lifecycleStatus: 'confirmed',
    })]);
    expect(state.confirmedFacts.filter(fact => fact.category === 'budget')).toHaveLength(1);
    expect(state.scriptProgress?.metrics.budget.value).toBe('15 млн руб');
    const analysis = buildLocalAnalysisResponse({
      sessionId: turns[0].sessionId, revision: 2, newTurns: [turns[1]], recentTurns: turns, currentState: state,
    });
    expect(analysis.factsDelta.filter(fact => fact.field === 'budget')).toEqual([]);
  });

  it.each([
    'Мой бюджет теперь 25 млн',
    'У меня бюджет 25 млн',
    'У меня бюджет не 15, а 25 млн',
    'У меня бюджет не 15 млн, а 25 млн',
    'У меня бюджет не пятнадцать миллионов, а двадцать пять миллионов',
    'У брата бюджет не 15, а 20 млн, мой бюджет не 18, а 25 млн',
  ])('accepts the own budget and retains atomic supersession: %s', text => {
    expect(extractDeterministicFacts(text, 'own').filter(fact => fact.field === 'budget')).toEqual([
      expect.objectContaining({ value: '25 млн руб', evidenceTurnId: 'own' }),
    ]);
    const { state, turns } = replay(['Бюджет 15 млн', text]);
    const old = state.confirmedFacts.find(fact => fact.category === 'budget' && fact.turnId === turns[0].id);
    expect(old?.lifecycleStatus).toBe('superseded');
    expect(state.budget.value).toBe('25 млн руб');
    expect(activeBudget(state)).toEqual([expect.objectContaining({
      value: '25 млн руб', turnId: turns[1].id, lifecycleStatus: 'confirmed', supersedesFactId: old?.id,
    })]);
    expect(state.scriptProgress?.metrics.budget.value).toBe('25 млн руб');
    const analysis = buildLocalAnalysisResponse({
      sessionId: turns[0].sessionId, revision: 2, newTurns: [turns[1]], recentTurns: turns, currentState: state,
    });
    expect(analysis.factsDelta.filter(fact => fact.field === 'budget')).toEqual([
      expect.objectContaining({ value: '25 млн руб', evidenceTurnId: turns[1].id }),
    ]);
  });

  it.each([
    'У брата бюджет 25 млн, а мой бюджет 20 млн',
    'Мой бюджет 20 млн, а у брата бюджет 25 млн',
    'Мой бюджет двадцать миллионов, а у брата не пятнадцать миллионов, а двадцать пять миллионов',
    'У брата бюджет не 15, а 25 млн, а мой бюджет 20 млн',
    'Мой бюджет 20 млн, а у брата бюджет не 15, а 25 млн',
    'У брата бюджет не 15, а 25 млн, мой бюджет не 18, а 20 млн',
    'У брата бюджет не 5 а 6 млн а мой бюджет не 8 а 20 млн',
    'У брата не 5 а 6 млн и мой бюджет не 8 а 20 млн',
  ])('rejects only the foreign span while preserving the own budget: %s', text => {
    expect(extractDeterministicFacts(text, 'mixed').filter(fact => fact.field === 'budget')).toEqual([
      expect.objectContaining({ value: '20 млн руб', evidenceTurnId: 'mixed' }),
    ]);
    const { state, turns } = replay(['Бюджет 15 млн', text]);
    expect(state.budget.value).toBe('20 млн руб');
    expect(activeBudget(state)).toEqual([expect.objectContaining({
      value: '20 млн руб', turnId: turns[1].id, lifecycleStatus: 'confirmed',
    })]);
    expect(state.confirmedFacts.filter(fact => fact.category === 'budget').map(fact => fact.value)).not.toContain('25 млн руб');
  });
});
