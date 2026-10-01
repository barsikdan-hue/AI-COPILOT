import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { advanceLocalConversation } from './localAnalysisEngine';

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
