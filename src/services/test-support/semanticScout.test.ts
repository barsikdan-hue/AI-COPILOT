import { describe, expect, it, vi } from 'vitest';
import type { TranscriptTurn } from '../../types';
import { createInitialState } from '../conversationStore';
import * as localAnalysisEngine from '../localAnalysisEngine';
import { runMassRegressionBaseline } from './massRegressionHarness';
import {
  emitRegressionObservation,
  type RegressionIdentity,
  type RegressionObservation,
  type RegressionObservationOptions,
} from './regressionObservation';

function originalIdentity(): RegressionIdentity {
  return { harness: 'original', caseId: 'unit-case', variation: 0, instance: 'primary', turnCutoff: 1 };
}

function originalResult() {
  const state = createInitialState();
  state.dialogueControl!.rejectedBranches = ['ипотеку'];
  const turns: TranscriptTurn[] = [{
    id: 'client-1', sessionId: 'unit-session', source: 'call_audio', speaker: 'client',
    text: 'Ипотека мне не нужна.', timestamp: 1000, isFinal: true, revision: 1,
  }];
  return { state, turns };
}

describe('observer-original', () => {
  it('detaches and recursively freezes only the approved observation fields', () => {
    const identity = originalIdentity();
    const result = originalResult();
    const captured: RegressionObservation[] = [];
    let selectedIdentity: Readonly<RegressionIdentity> | undefined;
    emitRegressionObservation(identity, result, { observation: {
      select(value) { selectedIdentity = value; return true; },
      onObservation(value) { captured.push(value); },
    } });

    expect(captured).toHaveLength(1);
    const observed = captured[0];
    expect(observed.identity).toEqual(identity);
    expect(observed.identity).not.toBe(identity);
    expect(selectedIdentity).not.toBe(identity);
    expect(Object.isFrozen(selectedIdentity)).toBe(true);
    expect(observed.turns).not.toBe(result.turns);
    expect(observed.turns[0]).not.toBe(result.turns[0]);
    expect(observed.turns).toEqual([{ id: 'client-1', speaker: 'client', text: 'Ипотека мне не нужна.' }]);
    expect(observed.core.rejectedBranches).not.toBe(result.state.dialogueControl!.rejectedBranches);
    for (const value of [observed, observed.identity, observed.turns, observed.turns[0], observed.core, observed.core.rejectedBranches]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    // Deliberately unsafe test-only casts exercise the runtime boundary.
    expect(() => (observed.turns as unknown as Array<{ text: string }>).push({ text: 'changed' })).toThrow();
    expect(() => (observed.turns[0] as unknown as { text: string }).text = 'changed').toThrow();
    expect(() => (observed.core.rejectedBranches as unknown as string[]).push('changed')).toThrow();
    expect(() => (observed.identity as unknown as { caseId: string }).caseId = 'changed').toThrow();
    expect(result.turns[0].text).toBe('Ипотека мне не нужна.');
    expect(result.state.dialogueControl!.rejectedBranches).toEqual(['ипотеку']);
    expect(identity.caseId).toBe('unit-case');

    result.turns[0].text = 'later input';
    result.state.dialogueControl!.rejectedBranches.push('later input');
    expect(observed.turns[0].text).toBe('Ипотека мне не нужна.');
    expect(observed.core.rejectedBranches).toEqual(['ипотеку']);
  });

  it('uses an empty detached branch view when dialogue control is absent', () => {
    const result = originalResult();
    delete result.state.dialogueControl;
    let captured: RegressionObservation | undefined;
    emitRegressionObservation(originalIdentity(), result, { observation: {
      select: () => true, onObservation(value) { captured = value; },
    } });
    expect(captured).toBeDefined();
    expect(captured!.core.rejectedBranches).toEqual([]);
    expect(Object.isFrozen(captured!.core.rejectedBranches)).toBe(true);
  });

  it.each(['disabled', 'unselected'] as const)('does not read or copy pipeline results when %s', (mode) => {
    const result = originalResult();
    Object.defineProperty(result, 'turns', { get() { throw new Error('unnecessary export'); } });
    const options: RegressionObservationOptions = mode === 'disabled' ? {} : { observation: {
      select: () => false, onObservation() { throw new Error('unexpected observation'); },
    } };
    expect(() => emitRegressionObservation(originalIdentity(), result, options)).not.toThrow();
  });

  it.each(['selector', 'callback', 'onError'] as const)('isolates a throwing %s from the caller', (failure) => {
    const identity = originalIdentity();
    const errors: Array<{ identity: Readonly<RegressionIdentity>; code: string }> = [];
    const throwingOptions: RegressionObservationOptions = { observation: {
      select() { if (failure === 'selector') throw new Error('selector failed'); return true; },
      onObservation() { throw new Error('callback failed'); },
      onError(value, code) { errors.push({ identity: value, code }); if (failure === 'onError') throw new Error('error handler failed'); },
    } };
    expect(() => emitRegressionObservation(identity, originalResult(), throwingOptions)).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0].identity).toEqual(identity);
    expect(errors[0].identity).not.toBe(identity);
    expect(Object.isFrozen(errors[0].identity)).toBe(true);
    expect(errors[0].code.length).toBeGreaterThan(0);
  });

  it('contains rejected Promise callback misuse without awaiting async export', async () => {
    const errors: string[] = [];
    const returned = emitRegressionObservation(originalIdentity(), originalResult(), { observation: {
      select: () => true,
      onObservation: () => Promise.reject(new Error('async callback failed')),
      onError(_identity, code) { errors.push(code); return Promise.reject(new Error('async error handler failed')); },
    } });
    expect(returned).toBeUndefined();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(errors.length).toBeGreaterThan(0);
  });

  it.each(['resolves false', 'rejects'] as const)('contains a Promise selector that %s without exporting or awaiting it', async (mode) => {
    const captured: RegressionObservation[] = [];
    const errors: string[] = [];
    // Deliberately violate the synchronous selector type to verify the runtime boundary.
    const select = (() => mode === 'resolves false'
      ? Promise.resolve(false)
      : Promise.reject(new Error('async selector failed'))) as unknown as (identity: Readonly<RegressionIdentity>) => boolean;
    const returned = emitRegressionObservation(originalIdentity(), originalResult(), { observation: {
      select,
      onObservation(value) { captured.push(value); },
      onError(_identity, code) { errors.push(code); },
    } });
    const synchronousExports = captured.length;
    const synchronousErrors = errors.length;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(returned).toBeUndefined();
    expect(synchronousExports).toBe(0);
    expect(captured).toEqual([]);
    expect(synchronousErrors).toBe(1);
    expect(errors[0].length).toBeGreaterThan(0);
  });

  it.each(['true', 1, {}])('fails closed for the nonboolean truthy selector result %j', (value) => {
    const captured: RegressionObservation[] = [];
    const select = (() => value) as unknown as (identity: Readonly<RegressionIdentity>) => boolean;
    emitRegressionObservation(originalIdentity(), originalResult(), { observation: {
      select, onObservation(observation) { captured.push(observation); },
    } });
    expect(captured).toEqual([]);
  });

  it('emits actual Original fact/analysis/isolation prefixes while preserving the complete report', () => {
    const baseline = runMassRegressionBaseline();
    const captured: RegressionObservation[] = [];
    const selectedCaseIds = new Set<string>();
    const isolationSessions = new Set<string>();
    const advance = localAnalysisEngine.advanceLocalConversation;
    const spy = vi.spyOn(localAnalysisEngine, 'advanceLocalConversation').mockImplementation((...args) => {
      // Keep only the current call; retaining all pipeline states is unnecessary on low-memory machines.
      spy.mockClear();
      if (/^mass-[ab]-isolation\.payment-0$/u.test(args[1].sessionId)) isolationSessions.add(args[1].sessionId);
      return advance(...args);
    });
    let observedReport;
    try {
      observedReport = runMassRegressionBaseline({ observation: {
        select(identity) { selectedCaseIds.add(identity.caseId); return identity.variation === 0; },
        onObservation(value) {
          captured.push(value);
          (value.core.rejectedBranches as unknown as string[]).push('observer mutation');
        },
        onError() { throw new Error('error handler cannot alter Harness outcome'); },
      } });
    } finally {
      spy.mockRestore();
    }
    expect(observedReport).toEqual(baseline);
    expect(baseline.fingerprint).toBe('492c0b724fecf4a1f9182fd0072b3259f832eaf9414ca990fcecb826aed809b4');

    const noMortgage = captured.find((value) => value.identity.caseId === 'fact.payment.no-mortgage')!;
    expect(noMortgage).toBeDefined();
    expect(noMortgage.identity).toEqual({ harness: 'original', caseId: 'fact.payment.no-mortgage', variation: 0, instance: 'primary', turnCutoff: 1 });
    expect(noMortgage.turns).toEqual([{ id: 'c1', speaker: 'client', text: 'Ипотека мне не нужна.' }]);
    expect(noMortgage.core.rejectedBranches).toEqual(['ипотеку']);

    const analysis = captured.find((value) => value.identity.caseId === 'analysis.closed-video-branch')!;
    expect(analysis).toBeDefined();
    expect(analysis.identity.turnCutoff).toBe(2);
    expect(analysis.turns.map(({ speaker, text }) => ({ speaker, text }))).toEqual([
      { speaker: 'agent', text: 'Давайте назначим видеовстречу?' },
      { speaker: 'client', text: 'Нет, видеовстречу не хочу.' },
    ]);
    const isolation = captured.filter((value) => value.identity.caseId === 'isolation.payment');
    expect(isolation.map((value) => value.identity)).toEqual([
      { harness: 'original', caseId: 'isolation.payment', variation: 0, instance: 'isolation-a', turnCutoff: 1 },
      { harness: 'original', caseId: 'isolation.payment', variation: 0, instance: 'isolation-b', turnCutoff: 1 },
    ]);
    expect(isolation.map((value) => value.turns.map((turn) => turn.text))).toEqual([
      ['Покупаю в ипотеку.'], ['Покупаю за собственные средства.'],
    ]);
    expect([...isolationSessions].sort()).toEqual(['mass-a-isolation.payment-0', 'mass-b-isolation.payment-0']);
    expect([...selectedCaseIds].every((id) => /^(?:fact|analysis|isolation)\./u.test(id))).toBe(true);
  }, 360_000);
});
