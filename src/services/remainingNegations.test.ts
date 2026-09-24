// Create src/services/remainingNegations.test.ts in the existing project.
// This is an additional regression suite; do not replace the existing tests.
import { describe, it, expect } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState, mergeFactsDelta } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { evaluateFirstCallScript } from './firstCallScriptEngine';

function runPipeline(text: string, previousAgentText?: string) {
  const clientTurn: TranscriptTurn = {
    id: 'client-1',
    sessionId: 'remaining-negations',
    source: 'call_audio',
    speaker: 'client',
    text,
    timestamp: 1700000001000,
    isFinal: true,
    revision: 1,
  };
  const turns: TranscriptTurn[] = [];
  if (previousAgentText) {
    turns.push({
      id: 'agent-1',
      sessionId: clientTurn.sessionId,
      source: 'microphone',
      speaker: 'agent',
      text: previousAgentText,
      timestamp: 1700000000000,
      isFinal: true,
      revision: 0,
    });
  }
  turns.push(clientTurn);
  const initialState = createInitialState();
  const facts = extractDeterministicFacts(text, clientTurn.id, previousAgentText);
  const mergedState = mergeFactsDelta(
    initialState,
    facts,
    initialState.stage,
    undefined,
    clientTurn.revision,
    Object.fromEntries(turns.map((turn) => [turn.id, turn.text])),
  );
  const script = evaluateFirstCallScript(turns, mergedState);
  return { facts, mergedState, script };
}

type PipelineResult = ReturnType<typeof runPipeline>;

function familyValues(result: PipelineResult): string[] {
  return [
    ...result.facts.filter((fact) => fact.field === 'familyMortgage').map((fact) => fact.value),
    result.mergedState.familyMortgage?.value,
    ...result.mergedState.confirmedFacts
      .filter((fact) => ['familyMortgage', 'family_mortgage'].includes(fact.category))
      .map((fact) => fact.value),
    result.script.metrics.familyMortgage?.value,
  ].filter((value): value is string => typeof value === 'string');
}

function expectNoPositiveChildFact(result: PipelineResult) {
  for (const value of familyValues(result)) {
    expect(value).not.toMatch(/^есть\s+(?:реб[её]нок|дети)/iu);
  }
}

describe('Remaining negations: extractor → state → script', () => {
  it('«Не хочу ипотеку»: does not select a payment method from a refusal', () => {
    const result = runPipeline('Не хочу ипотеку');
    expect(result.facts.filter((fact) => fact.field === 'paymentMethod')).toHaveLength(0);
    expect(result.mergedState.paymentMethod.value).toBeFalsy();
    expect(result.script.metrics.paymentMethod.value).toBeFalsy();
    expect(result.script.metrics.paymentMethod.status).not.toBe('confirmed');
    expect(result.mergedState.confirmedFacts.filter((fact) => fact.category === 'paymentMethod'))
      .toHaveLength(0);
  });

  it('«Рассрочка до 7 лет»: does not infer children from a financing term', () => {
    const result = runPipeline('Рассрочка до 7 лет');
    expectNoPositiveChildFact(result);
  });

  it('«Рядом нужен детский сад»: does not infer children from infrastructure', () => {
    const result = runPipeline('Рядом нужен детский сад');
    expectNoPositiveChildFact(result);
  });

  it('«Детей до 7 лет нет»: preserves the scope of the age restriction', () => {
    const result = runPipeline('Детей до 7 лет нет');
    expectNoPositiveChildFact(result);
    for (const value of familyValues(result)) {
      // No children under seven is not evidence of having no children at all.
      expect(value).not.toMatch(/^детей нет(?:\s*\(|$)/iu);
    }
  });

  it('«Нет проблем, завтра в 15:00 удобно»: accepts the proposed meeting', () => {
    const result = runPipeline(
      'Нет проблем, завтра в 15:00 удобно',
      'Видеопоказ завтра в 15:00 удобно?',
    );
    expect(result.facts.some((fact) => fact.field === 'agreedNextStep')).toBe(true);
    expect(result.mergedState.agreedNextStep.value).toBeTruthy();
    expect(result.mergedState.agreedNextStep.value).toContain('15:00');
    expect(result.script.ppv.clientAgreed).toBe(true);
    // The full PPV metric also depends on other criteria; do not require it to be closed.
  });
});
