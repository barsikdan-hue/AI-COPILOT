import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { evaluateFirstCallScript } from './firstCallScriptEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { checkSemanticAntiRepeat } from './semanticAntiRepeat';

function clientTurn(text: string, revision = 1): TranscriptTurn {
  return {
    id: `c${revision}`,
    sessionId: 'owner-safe-family-fallback-41',
    source: 'call_audio',
    speaker: 'client',
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

function replay(texts: string[]) {
  const turns = texts.map((text, index) => clientTurn(text, index + 1));
  let state = createInitialState();
  for (let index = 0; index < turns.length; index += 1) {
    state = advanceLocalConversation(state, turns[index], turns.slice(0, index + 1)).state;
  }
  const latest = turns.at(-1)!;
  const analysis = buildLocalAnalysisResponse({
    sessionId: latest.sessionId,
    revision: latest.revision!,
    newTurns: [latest],
    recentTurns: turns,
    currentState: state,
  });
  return { state, turns, analysis };
}

const activeFamilyFacts = (state: ConversationState) => state.confirmedFacts.filter(
  fact => fact.category === 'familyMortgage' && !['superseded', 'rejected'].includes(fact.lifecycleStatus || ''),
);

const unresolved = { status: 'not_confirmed', value: null, needsClarification: false };

describe('FIX41 owner-safe familyMortgage metric fallback', () => {
  it.each([
    'У брата двое маленьких детей.',
    'У брата ребёнку 4 года.',
    'У сестры ребёнок до семи лет.',
    'У друга двое маленьких детей.',
    'У моей сестры маленькие дети.',
    'У подруги ребёнку 4 года.',
    'У друзей маленькие дети.',
    'У родителей маленькие дети.',
    'Маленькие дети у брата.',
    'У брата дети.',
  ])('keeps relative-only evidence unresolved throughout the pipeline: %s', text => {
    const { state, turns, analysis } = replay([text]);
    expect(extractDeterministicFacts(text, turns[0].id).filter(fact => fact.field === 'familyMortgage')).toHaveLength(0);
    expect(activeFamilyFacts(state)).toHaveLength(0);
    expect(state.familyMortgage?.value ?? null).toBeNull();
    expect(state.scriptProgress?.metrics.familyMortgage).toMatchObject(unresolved);
    expect(analysis.scriptProgress?.metrics.familyMortgage).toMatchObject(unresolved);
    expect(evaluateFirstCallScript(turns, createInitialState()).metrics.familyMortgage).toMatchObject(unresolved);
  });

  it.each([
    'У меня двое маленьких детей.',
    'У нас двое маленьких детей.',
    'Моему ребёнку 4 года.',
    'У меня ребёнку 4 года.',
    'Есть ребёнок, ему пять лет.',
  ])('preserves qualifying own-child evidence: %s', text => {
    const { state, analysis } = replay([text]);
    expect(activeFamilyFacts(state)).toHaveLength(1);
    expect(state.familyMortgage).toMatchObject({ needsClarification: false });
    expect(state.scriptProgress?.metrics.familyMortgage).toMatchObject({ status: 'confirmed', needsClarification: false });
    expect(analysis.scriptProgress?.metrics.familyMortgage.status).toBe('confirmed');
  });

  it('retains raw fallback when canonical and ledger have not been populated', () => {
    const turn = clientTurn('У меня двое маленьких детей.');
    const initial = createInitialState();
    expect(initial.familyMortgage?.value ?? null).toBeNull();
    expect(activeFamilyFacts(initial)).toHaveLength(0);
    expect(evaluateFirstCallScript([turn], initial).metrics.familyMortgage).toMatchObject({
      status: 'confirmed', needsClarification: false,
    });
  });

  it('accepts a later own-child match within the same turn after a relative match', () => {
    const { state, turns, analysis } = replay(['У брата тоже ребёнок, а у меня дочке 4 года.']);
    expect(activeFamilyFacts(state)).toHaveLength(1);
    expect(state.scriptProgress?.metrics.familyMortgage.status).toBe('confirmed');
    expect(analysis.scriptProgress?.metrics.familyMortgage.status).toBe('confirmed');
    expect(evaluateFirstCallScript(turns, createInitialState()).metrics.familyMortgage.status).toBe('confirmed');
  });

  it.each(['моему', 'нашему'])('retains explicit %s child fallback after a relative clause', owner => {
    const { state, turns, analysis } = replay([`У брата тоже ребёнок, а ${owner} ребёнку 4 года.`]);
    // This existing raw fallback is useful even when extraction has no fact.
    expect(activeFamilyFacts(state)).toHaveLength(0);
    expect(state.familyMortgage?.value ?? null).toBeNull();
    expect(state.scriptProgress?.metrics.familyMortgage).toMatchObject({ status: 'confirmed', needsClarification: false });
    expect(analysis.scriptProgress?.metrics.familyMortgage.status).toBe('confirmed');
    expect(evaluateFirstCallScript(turns, createInitialState()).metrics.familyMortgage.status).toBe('confirmed');
  });

  it('allows later qualifying own-child evidence after a relative-only turn', () => {
    const first = clientTurn('У брата двое маленьких детей.');
    const firstState = advanceLocalConversation(createInitialState(), first, [first]).state;
    expect(firstState.scriptProgress?.metrics.familyMortgage).toMatchObject(unresolved);
    const { state, analysis } = replay([first.text, 'А у меня дочке четыре года.']);
    expect(activeFamilyFacts(state)).toHaveLength(1);
    expect(state.scriptProgress?.metrics.familyMortgage).toMatchObject({ status: 'confirmed', needsClarification: false });
    expect(analysis.scriptProgress?.metrics.familyMortgage.status).toBe('confirmed');
  });

  it.each([
    ['У брата', 'Маленькие дети.', 'confirmed'],
    ['У меня', 'У брата маленькие дети.', 'not_confirmed'],
    ['У брата дети', 'У меня дочке 4 года.', 'confirmed'],
  ])('does not carry an owner across client-turn boundaries: %s / %s', (first, second, status) => {
    const turns = [clientTurn(first), clientTurn(second, 2)];
    const initial = createInitialState();
    const combined = evaluateFirstCallScript(turns, initial).metrics.familyMortgage;
    expect(combined).toMatchObject({ status, needsClarification: false });
    if (status === 'not_confirmed') expect(combined.value).toBeNull();
    else expect(combined.value).toMatch(/до 7 лет/iu);
  });

  it('does not construct a qualifying marker by joining unrelated child and age turns', () => {
    const turns = [clientTurn('У брата дети'), clientTurn('До 7 лет.', 2)];
    expect(evaluateFirstCallScript(turns, createInitialState()).metrics.familyMortgage).toMatchObject(unresolved);
  });

  it('allows asking about the client children when only relative children were mentioned', () => {
    const { state, turns } = replay(['У брата двое маленьких детей.']);
    expect(checkSemanticAntiRepeat({ semanticKey: 'ask_family_mortgage', text: 'У вас есть дети до семи лет?' }, state, turns))
      .toMatchObject({ accepted: true, semanticKey: 'ask_family_mortgage' });
  });
});
