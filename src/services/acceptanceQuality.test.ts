import { describe, expect, it } from 'vitest';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildCompactAnalysisContext, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { checkSemanticAntiRepeat } from './semanticAntiRepeat';
import { TranscriptTurn } from '../types';

describe('4.0.2 research, quality and bounded context', () => {
  it('T09 research mode asks about future risks and closes past-experience questions for the call', () => {
    let state = createInitialState(); const turns: TranscriptTurn[] = [];
    for (const text of ['Я только начал изучать рынок.', 'Пока ничего не смотрел.', 'Конкретных неудобств не было.']) {
      const turn: TranscriptTurn = { id: `t${turns.length}`, sessionId: 's', speaker: 'client', source: 'call_audio', text, timestamp: turns.length * 10000, revision: turns.length + 1, isFinal: true };
      turns.push(turn); state = advanceLocalConversation(state, turn, turns).state;
    }
    const response = buildLocalAnalysisResponse({ sessionId: 's', revision: turns.length, newTurns: [turns.at(-1)!], recentTurns: turns, currentState: state });
    expect(state.spin.problem).toEqual([]);
    expect(response.suggestedReply).toMatch(/смотреть впер[её]д|ошибки.*избежать/iu);
    expect(checkSemanticAntiRepeat('Что из увиденного вас не устроило?', state).accepted).toBe(false);
  });
  it('T18 rejects a reworded trust question anywhere in call history', () => {
    const state = createInitialState();
    state.askedQuestions = ['Сочи давно рассматриваете или только начали изучать рынок?'];
    expect(checkSemanticAntiRepeat('А как вообще сейчас ощущения от рынка Сочи? Давно присматриваетесь или только начали?', state).accepted).toBe(false);
    expect(checkSemanticAntiRepeat('Кто ещё участвует в выборе квартиры?', state).accepted).toBe(true);
  });
  it('skip forbids the exact wording while leaving the topic available', () => {
    const state = createInitialState(); state.dismissedSuggestionTexts = ['Какой у вас бюджет?'];
    expect(checkSemanticAntiRepeat('Какой у вас бюджет?', state).accepted).toBe(false);
    expect(checkSemanticAntiRepeat('До какой максимальной суммы рассматриваете покупку?', state).accepted).toBe(true);
  });
  it('compact context contains active facts, boundaries, <=6 turns and <=8 semantic keys', () => {
    const state = createInitialState(); state.paymentMethod.value = 'Ипотека';
    state.dialogueControl!.blockedNextSteps = ['ppi'];
    state.askedQuestions = Array.from({ length: 70 }, (_, i) => `Уникальная тема ${i} - что думаете?`);
    state.confirmedFacts = [
      { id: 'old', category: 'budget', value: '10 млн', lifecycleStatus: 'superseded', turnId: 'old', evidenceQuote: '10 млн', confidence: 1, timestamp: 1 },
      { id: 'new', category: 'budget', value: '15 млн', lifecycleStatus: 'confirmed', turnId: 'new', evidenceQuote: '15 млн', confidence: 1, timestamp: 2 },
    ];
    const turns = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, speaker: 'client', text: `Реплика ${i}`, timestamp: i } as TranscriptTurn));
    const compact = buildCompactAnalysisContext(state, [...turns, turns.at(-1)!]);
    expect(compact.recentTurns).toHaveLength(6);
    expect(compact.semanticKeys.length).toBeLessThanOrEqual(8);
    expect(compact.confirmedFacts).toHaveLength(1);
    expect(JSON.stringify(compact)).not.toContain('10 млн');
    expect(compact.facts.paymentMethod.value).toBe('Ипотека');
    expect(compact.blockedNextSteps).toEqual(['ppi']);
    expect(compact).not.toHaveProperty('sessionTurnsBacklog');
    expect(state.confirmedFacts).toHaveLength(2);
  });
});
