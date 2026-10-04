import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  effectivePolicy, loadContract, projectCore, selectObservations,
  type CaseBinding, type ScoutContract,
} from '../../../.agents/skills/ai-copilot-semantic-scout/scripts/scout';
import { EXPANDED_REGRESSION_SCENARIOS } from '../test-fixtures/expandedRegressionScenarios';
import { MASS_REGRESSION_GOLDEN_CASES } from '../test-fixtures/massRegressionGoldenCases';
import type { TranscriptTurn } from '../../types';
import { createInitialState } from '../conversationStore';
import { detectConversationEvent } from '../conversationEventEngine';
import { chooseDialoguePolicyTarget } from '../dialoguePolicyEngine';
import * as localAnalysisEngine from '../localAnalysisEngine';
import { runExpandedRegression } from './expandedRegressionHarness';
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

const scoutContractPath = resolve('.agents/skills/ai-copilot-semantic-scout/references/semantic-scout-contract.json');

function binding(contract: ScoutContract, overrides: Partial<CaseBinding> = {}): CaseBinding {
  return { ...structuredClone(contract.bindings[0]), ...overrides };
}

function observation(overrides: Partial<RegressionObservation> = {}): RegressionObservation {
  return {
    identity: { harness: 'original', caseId: 'fact.payment.no-mortgage', variation: 0, instance: 'primary', turnCutoff: 1 },
    turns: [{ id: 'c1', speaker: 'client', text: 'Ипотека мне не нужна.' }],
    core: { rejectedBranches: ['ипотеку'] },
    ...overrides,
  };
}

describe('contract-policy-comparability', () => {
  it('freezes semantic meaning and proven runtime values without historical task authority', () => {
    const contract = loadContract(scoutContractPath);
    const semantic = JSON.parse(readFileSync('diagnostics/semantic-gold-benchmark/contract.json', 'utf8'));
    const runtime = JSON.parse(readFileSync('diagnostics/semantic-three-set-validation-2026-10-04/evaluation-contract.json', 'utf8'));
    expect(contract.semanticPayload).toEqual({
      unit: semantic.unit, input_format: semantic.input_format, labels: semantic.labels,
      ambiguity_gate: semantic.ambiguity_gate, speaker_rule: semantic.speaker_rule,
      correction_rule: semantic.correction_rule, predicate_notes: semantic.predicate_notes,
    });
    expect(contract.questionRegistry).toEqual(semantic.question_registry);
    expect(contract.systemPrompt).toBe(runtime.system_prompt);
    expect(contract.settings).toEqual(runtime.settings);
    expect(contract.model).toEqual({ id: runtime.model.id, revision: runtime.model.revision });
    expect(contract.semanticSourceHash).toBe(createHash('sha256').update(readFileSync('diagnostics/semantic-gold-benchmark/contract.json')).digest('hex'));
    expect(contract.runtimeReferenceHash).toBe(createHash('sha256').update(readFileSync('diagnostics/kaggle-semantic-judge/tournament-2026-10-04/run_tournament.py')).digest('hex'));
    expect(contract).not.toHaveProperty('inference_allowed_in_this_task');
    expect(contract).not.toHaveProperty('previous_protocol_path');
    expect(contract.semanticPayload).not.toHaveProperty('coverage');
    expect(contract.semanticPayload).not.toHaveProperty('evaluation_constraints');
    expect(Object.isFrozen(contract.bindings[0].dimensions)).toBe(true);
  });

  it.each([
    ['negation', 'ACTIVE_SHADOW'], ['mortgage_intent', 'ACTIVE_SHADOW'],
    ['budget_ownership', 'OBSERVE_ONLY'], ['ownership', 'OBSERVE_ONLY'],
    ['corrections', 'OBSERVE_ONLY'], ['down_payment_future', 'OBSERVE_ONLY'],
    ['down_payment_availability', 'DISABLED'],
  ] as const)('enforces initial mode for %s', (domain, expected) => {
    const contract = loadContract(scoutContractPath);
    expect(effectivePolicy(binding(contract, { domain }), contract)).toBe(expected);
  });

  it('blocks a DP availability question mislabeled as negation', () => {
    const contract = loadContract(scoutContractPath);
    expect(effectivePolicy(binding(contract, { domain: 'negation', questionId: 'dp_current_available_some' }), contract)).toBe('DISABLED');
  });

  it.each(['toString', '__proto__', 'missing'])('fails closed for unclassified policy key %s', (key) => {
    const contract = loadContract(scoutContractPath);
    expect(effectivePolicy(binding(contract, { domain: key as CaseBinding['domain'] }), contract)).toBe('DISABLED');
    expect(effectivePolicy(binding(contract, { questionId: key }), contract)).toBe('DISABLED');
    expect(effectivePolicy(binding(contract, { policySlices: [key] }), contract)).toBe('DISABLED');
  });

  it.each(['financial_certainty', 'financial_availability', 'unknown_sensitive_dp', 'unreviewed_slice'])('blocks restrictive or unknown slice %s', (slice) => {
    const contract = loadContract(scoutContractPath);
    expect(effectivePolicy(binding(contract, { policySlices: [slice] }), contract)).toBe('DISABLED');
  });

  it('keeps mortgage correction scope observe-only across labels', () => {
    const contract = loadContract(scoutContractPath);
    expect(effectivePolicy(binding(contract, { domain: 'mortgage_intent', policySlices: ['corrections'] }), contract)).toBe('OBSERVE_ONLY');
    expect(effectivePolicy(binding(contract, { dimensions: { ...contract.bindings[0].dimensions, correctionScope: 'explicit' } }), contract)).toBe('OBSERVE_ONLY');
  });

  it.each([{ privacyApproved: false }, { scopeApproved: false }, { domain: 'unclassified' }])('excludes unapproved/unclassified bindings %j', (override) => {
    const contract = loadContract(scoutContractPath);
    const changed = binding(contract, override as Partial<CaseBinding>);
    expect(effectivePolicy(changed, contract)).toBe('DISABLED');
    const result = selectObservations([observation()], { ...contract, bindings: [changed] });
    expect(result.eligible).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it('does not infer a semantic answer from branch absence or mortgage use', () => {
    const contract = loadContract(scoutContractPath);
    expect(projectCore(observation({ core: { rejectedBranches: [] } }), binding(contract), contract).status).toBe('NOT_COMPARABLE');
    expect(projectCore(observation(), binding(contract, { questionId: 'mortgage_use' }), contract).status).toBe('NOT_COMPARABLE');
  });

  it('rejects registry wording drift before export', () => {
    const contract = loadContract(scoutContractPath);
    const changed = { ...contract, questionRegistry: { ...contract.questionRegistry, mortgage_permission: 'Будет ли ипотека?' } };
    expect(selectObservations([observation()], changed).eligible).toEqual([]);
  });

  it('requires audited binding identity, source metadata, projection and scope', () => {
    const contract = loadContract(scoutContractPath);
    for (const changed of [
      binding(contract, { sourceHashes: {} }), binding(contract, { sourceReferences: [] }),
      binding(contract, { projectionVersion: 'unreviewed' }),
      binding(contract, { dimensions: { owner: 'relative', time: 'current', predicate: 'mortgage_permission', correctionScope: 'none' } }),
      binding(contract, { requiredDimensions: [] }),
    ]) expect(projectCore(observation(), changed, contract).status).toBe('NOT_COMPARABLE');
    expect(selectObservations([observation({ identity: { ...observation().identity, variation: 1 } })], contract).eligible).toEqual([]);
  });

  it('rejects agent wording, later uncertainty and a changed prefix despite a persisted branch', () => {
    const contract = loadContract(scoutContractPath);
    for (const turns of [
      [{ id: 'c1', speaker: 'agent' as const, text: 'Ипотека мне не нужна.' }],
      [...observation().turns, { id: 'c2', speaker: 'client' as const, text: 'Или всё-таки рассмотрю, пока не решил.' }],
      [{ id: 'c1', speaker: 'client' as const, text: 'Ипотека брату не нужна.' }],
    ]) expect(projectCore(observation({ turns }), binding(contract), contract).status).toBe('NOT_COMPARABLE');
  });

  it('projects only audited actual current client refusals through the public pipeline', () => {
    const contract = loadContract(scoutContractPath);
    const actual: RegressionObservation[] = [];
    const auditSources = [...contract.bindings, binding(contract, { identity: {
      harness: 'expanded', caseId: 'finance.no-mortgage.rejected', variation: 0, instance: 'primary', turnCutoff: 1,
    } })];
    for (const source of auditSources) {
      const fixture = source.identity.harness === 'original'
        ? MASS_REGRESSION_GOLDEN_CASES.find((item) => item.id === source.identity.caseId)
        : EXPANDED_REGRESSION_SCENARIOS.find((item) => item.id === source.identity.caseId);
      expect(fixture).toBeDefined();
      const prefix = 'turns' in fixture! ? fixture.turns : [{ speaker: 'client' as const, text: (fixture as { text: string }).text }];
      let state = createInitialState();
      const turns: TranscriptTurn[] = prefix.map((turn, index) => ({
        ...turn, id: source.identity.harness === 'original' ? 'c1' : `${source.identity.caseId}-t${index + 1}`,
        sessionId: `scout-audit-${source.identity.caseId}`, source: 'call_audio', timestamp: (index + 1) * 1000,
        isFinal: true, revision: index + 1,
      }));
      for (let index = 0; index < turns.length; index += 1) {
        if (index === turns.length - 1) detectConversationEvent(turns[index], turns, state, turns[index].timestamp);
        state = localAnalysisEngine.advanceLocalConversation(state, turns[index], turns.slice(0, index + 1)).state;
      }
      const beforeAnalysis = [...(state.dialogueControl?.rejectedBranches ?? [])];
      const latest = turns.at(-1)!;
      localAnalysisEngine.buildLocalAnalysisResponse({ sessionId: latest.sessionId, revision: latest.revision!, newTurns: [latest], recentTurns: turns, currentState: state });
      chooseDialoguePolicyTarget(state, turns, state.scriptProgress);
      expect(state.dialogueControl?.rejectedBranches ?? []).toEqual(beforeAnalysis);
      emitRegressionObservation(source.identity, { state, turns }, { observation: { select: () => true, onObservation(value) { actual.push(value); } } });
    }
    expect(actual).toHaveLength(3);
    expect(actual.map((item) => item.core.rejectedBranches)).toEqual([['ипотеку'], ['ипотеку'], []]);
    const selected = selectObservations(actual, contract);
    expect(selected.rejected).toHaveLength(1);
    expect(selected.eligible.map((item) => item.mode)).toEqual(['ACTIVE_SHADOW', 'ACTIVE_SHADOW']);
    expect(selected.eligible.map((item) => item.core.status === 'COMPARABLE' ? item.core.value : null)).toEqual(['NO', 'NO']);
  }, 30_000);
});

describe('observer-expanded', () => {
  it('exports the actual primary prefixes and isolates throwing callbacks from the report', () => {
    const baseline = runExpandedRegression();
    const captured: RegressionObservation[] = [];
    const errors: Array<{ caseId: string; code: string }> = [];
    const observedReport = runExpandedRegression({ observation: {
      select(identity) {
        return identity.variation === 0 && (
          identity.caseId === 'negation.payment.mortgage'
          || identity.caseId === 'session_isolation.payment.cash-mortgage'
        );
      },
      onObservation(value) {
        captured.push(value);
        throw new Error('observer cannot change Expanded results');
      },
      onError(identity, code) {
        errors.push({ caseId: identity.caseId, code });
        throw new Error('error callback cannot change Expanded results');
      },
    } });

    expect(observedReport).toEqual(baseline);
    expect(captured).toHaveLength(2);
    const mortgage = captured.find((value) => value.identity.caseId === 'negation.payment.mortgage');
    expect(mortgage?.identity).toEqual({
      harness: 'expanded', caseId: 'negation.payment.mortgage', variation: 0,
      instance: 'primary', turnCutoff: 1,
    });
    expect(mortgage?.turns).toEqual([
      { id: 'negation.payment.mortgage-t1', speaker: 'client', text: 'Кредит и ипотека мне не подходят.' },
    ]);
    const isolation = captured.find((value) => value.identity.caseId === 'session_isolation.payment.cash-mortgage');
    expect(isolation?.identity).toEqual({
      harness: 'expanded', caseId: 'session_isolation.payment.cash-mortgage', variation: 0,
      instance: 'primary', turnCutoff: 1,
    });
    expect(isolation?.turns).toEqual([
      { id: 'session_isolation.payment.cash-mortgage-t1', speaker: 'client', text: 'Покупаю за собственные средства.' },
    ]);
    expect(captured.flatMap((value) => value.turns.map((turn) => turn.text))).not.toContain('Оформляю ипотеку.');
    expect(errors).toEqual([
      { caseId: 'negation.payment.mortgage', code: 'OBSERVATION_ERROR' },
      { caseId: 'session_isolation.payment.cash-mortgage', code: 'OBSERVATION_ERROR' },
    ]);
  }, 600_000);
});
