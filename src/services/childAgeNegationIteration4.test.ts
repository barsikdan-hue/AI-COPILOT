import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation } from './localAnalysisEngine';

function clientTurn(id: string, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'child-age-negation-iteration-4',
    source: 'call_audio',
    speaker: 'client',
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

function advance(state: ConversationState, turns: TranscriptTurn[], next: TranscriptTurn) {
  const history = [...turns, next];
  return { history, result: advanceLocalConversation(state, next, history) };
}

const activeFamilyFacts = (state: ConversationState) => state.confirmedFacts.filter(
  (fact) => fact.category === 'familyMortgage' && !['superseded', 'rejected'].includes(fact.lifecycleStatus || '')
);

describe('FIX ITERATION 4 child/age negation', () => {
  it('A: records global no-children without a positive child fact', () => {
    const turn = clientTurn('no-children', 'У меня детей нет.', 1);
    const result = advance(createInitialState(), [], turn).result;

    expect(result.state.familyMortgage?.value).toMatch(/детей нет|не примен/iu);
    expect(activeFamilyFacts(result.state).some((fact) => /^есть\s+(?:реб[её]нок|дети)/iu.test(fact.value))).toBe(false);
    expect(result.state.scriptProgress?.metrics.familyMortgage.status).toBe('not_applicable');
    expect(result.state.scriptProgress?.metrics.familyMortgage.value).toBe(result.state.familyMortgage?.value);
  });

  it('B: preserves age-bounded negation without turning it into global no-children', () => {
    const turn = clientTurn('no-under-seven', 'Детей до семи лет нет.', 1);
    const result = advance(createInitialState(), [], turn).result;

    expect(result.state.familyMortgage?.value).toMatch(/нет детей до 7|по возрасту/iu);
    expect(result.state.familyMortgage?.value).not.toMatch(/^детей нет(?:\s*\(|$)/iu);
    expect(activeFamilyFacts(result.state).some((fact) => /подходит под условия/iu.test(fact.value))).toBe(false);
    expect(result.state.scriptProgress?.metrics.familyMortgage.value).toBe(result.state.familyMortgage?.value);
    expect(result.state.scriptProgress?.metrics.familyMortgage.status).toBe('not_applicable');
  });

  it('C: records a five-year-old child as current under-seven evidence', () => {
    const turn = clientTurn('child-five', 'Есть ребёнок, ему пять лет.', 1);
    const result = advance(createInitialState(), [], turn).result;
    const fact = activeFamilyFacts(result.state)[0];

    expect(result.state.familyMortgage?.value).toMatch(/подходящего возраста|до 7/iu);
    expect(fact).toMatchObject({ turnId: turn.id, lifecycleStatus: 'confirmed' });
    expect(fact?.evidenceQuote).toMatch(/реб[её]нок.*пять/iu);
    expect(result.state.scriptProgress?.metrics.familyMortgage.status).toBe('confirmed');
    expect(result.state.scriptProgress?.metrics.familyMortgage.value).toBe(result.state.familyMortgage?.value);
  });

  it('D: confirms an older child without creating under-seven eligibility', () => {
    const turn = clientTurn('child-nine', 'Есть сын, ему девять.', 1);
    const result = advance(createInitialState(), [], turn).result;

    expect(result.state.familyMortgage?.value).toMatch(/реб[её]нок 9 лет/iu);
    expect(result.state.familyMortgage?.value).toMatch(/не примен/iu);
    expect(result.state.familyMortgage?.value).not.toMatch(/подходит под условия/iu);
    expect(result.state.scriptProgress?.metrics.familyMortgage.status).toBe('not_applicable');
    expect(result.state.scriptProgress?.metrics.familyMortgage.value).toBe(result.state.familyMortgage?.value);
  });

  it('E: supersedes an under-seven age with the corrected current age', () => {
    const five = clientTurn('age-five', 'Ребёнку пять лет.', 1);
    const first = advance(createInitialState(), [], five);
    const eight = clientTurn('age-eight', 'Нет, я оговорился, ему уже восемь.', 2);
    const second = advance(first.result.state, first.history, eight).result;
    const oldFact = second.state.confirmedFacts.find((fact) => fact.category === 'familyMortgage' && fact.turnId === five.id);
    const newFact = second.state.confirmedFacts.find((fact) => fact.category === 'familyMortgage' && fact.turnId === eight.id);

    expect(oldFact?.lifecycleStatus).toBe('superseded');
    expect(newFact).toMatchObject({ lifecycleStatus: 'confirmed', turnId: eight.id });
    expect(newFact?.supersedesFactId).toBe(oldFact?.id);
    expect(newFact?.evidenceQuote).toMatch(/оговорился.*восемь/iu);
    expect(activeFamilyFacts(second.state)).toHaveLength(1);
    expect(second.state.familyMortgage?.value).toMatch(/реб[её]нок 8 лет/iu);
    expect(second.state.familyMortgage?.value).not.toMatch(/подходит под условия/iu);
    expect(second.state.scriptProgress?.metrics.familyMortgage.value).toBe(second.state.familyMortgage?.value);
    expect(second.event?.type).toBe('FACT_CORRECTION');
  });

  it('F: does not mark a first contrastive older-child statement as correction or under-seven', () => {
    const turn = clientTurn('child-ten', 'Не маленький ребёнок, ему уже десять.', 1);
    const result = advance(createInitialState(), [], turn).result;

    expect(result.event?.type).not.toBe('FACT_CORRECTION');
    expect(result.state.familyMortgage?.value).toMatch(/реб[её]нок 10 лет/iu);
    expect(result.state.familyMortgage?.value).not.toMatch(/подходит под условия/iu);
  });

  it('G: attributes children to the client, not the mentioned relative', () => {
    const turn = clientTurn('relative-children', 'У брата двое маленьких детей, у меня детей нет.', 1);
    const result = advance(createInitialState(), [], turn).result;

    expect(result.state.familyMortgage?.value).toMatch(/детей нет/iu);
    expect(activeFamilyFacts(result.state)).toHaveLength(1);
    expect(activeFamilyFacts(result.state)[0]?.evidenceQuote).toMatch(/детей нет/iu);
    expect(result.state.scriptProgress?.metrics.familyMortgage.status).toBe('not_applicable');
  });

  it('H: keeps a hypothetical purchase for a daughter out of confirmed family facts', () => {
    const turn = clientTurn('hypothetical-daughter', 'Возможно, будем покупать на дочь, но пока не решили.', 1);
    const result = advance(createInitialState(), [], turn).result;

    expect(result.state.familyMortgage?.value ?? null).toBeNull();
    expect(activeFamilyFacts(result.state)).toHaveLength(0);
    expect(result.state.scriptProgress?.metrics.familyMortgage.status).toBe('not_confirmed');
    expect(result.state.scriptProgress?.metrics.familyMortgage.value).toBeNull();
  });
});
