import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  effectivePolicy, loadContract, projectCore, selectObservations, normalizeOutput, encodeRequests, importResponses,
  type CaseBinding, type ScoutContract, type ScoutRequest, type BatchManifest, type ResponseManifest,
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

// Protocol test fixtures are private unit inputs, not additions to the semantic oracle.
function protocolHash(value: unknown): string {
  const sorted = (item: unknown): unknown => Array.isArray(item) ? item.map(sorted)
    : item !== null && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, nested]) => [key, sorted(nested)]))
      : item;
  return createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
}

function batchFixture(rows: unknown[] = [
  { id: 'opaque-a', status: 'OK', raw_output: ' NO\n', latency_ms: 2, claimed_prediction: 'NO' },
  { id: 'opaque-b', status: 'OK', raw_output: 'UNKNOWN', latency_ms: null },
]): { manifest: BatchManifest; responseManifest: ResponseManifest; jsonl: string; requests: ScoutRequest[] } {
  const contract = loadContract(scoutContractPath);
  const requests: ScoutRequest[] = ['opaque-a', 'opaque-b'].map((id) => ({
    id, turns: [{ speaker: 'client', text: 'Ипотека мне не нужна.' }], question: contract.questionRegistry.mortgage_permission,
  }));
  const input = requests.map((request) => JSON.stringify(request)).join('\n') + '\n';
  const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  const jsonl = rows.length ? rows.map((row) => JSON.stringify(row)).join('\n') + '\n' : '';
  const manifest: BatchManifest = {
    schemaVersion: 1, runId: 'unit-run', sourceHead: '5cc9b0def768a9f068c0daee9c2e48263b0404d7',
    sourceHashes: { ...contract.bindings[0].sourceHashes }, inputSha256: hash(input), requestIds: ['opaque-a', 'opaque-b'],
    contractSha256: hash(readFileSync(scoutContractPath)), model: { ...contract.model },
    promptHash: contract.promptHash, settingsHash: contract.settingsHash,
    policyVersion: contract.policyVersion, policyHash: protocolHash({ policy: contract.policy, questionPolicy: contract.questionPolicy, slicePolicy: contract.slicePolicy }),
    projectionHash: protocolHash(contract.projections), questionRegistryHash: protocolHash(contract.questionRegistry),
    fingerprintVersion: contract.fingerprintVersion, fingerprintHash: protocolHash({ version: contract.fingerprintVersion }),
    runnerIdentity: 'transformers-batch-v1', selection: { observed: 3, selected: 2, rejected: 1 },
  };
  const responseManifest: ResponseManifest = {
    schemaVersion: 1, runId: manifest.runId, inputSha256: manifest.inputSha256,
    contractSha256: manifest.contractSha256, model: { ...manifest.model }, promptHash: manifest.promptHash,
    settingsHash: manifest.settingsHash, responsesSha256: hash(jsonl),
    runtimeIdentity: { runner: manifest.runnerIdentity, runtimeReferenceHash: contract.runtimeReferenceHash, versions: { python: 'unit', transformers: 'unit' } },
  };
  return { manifest, responseManifest, jsonl, requests };
}

describe('batch-contract', () => {
  it.each([
    [' YES ', 'YES'], ['NO\r\n', 'NO'], [' UNKNOWN\n', 'UNKNOWN'],
    ['yes', 'INVALID'], ['YES because', 'INVALID'], ['NO UNKNOWN', 'INVALID'], ['', 'INVALID'],
    ['prefix YES', 'INVALID'], ['YЕS', 'INVALID'],
  ])('normalizes only whole exact labels in %j', (raw, expected) => {
    expect(normalizeOutput(raw)).toBe(expected);
  });

  it('encodes only exact request payloads as LF-terminated Unicode JSONL', () => {
    const { requests } = batchFixture();
    expect(encodeRequests(requests)).toBe(requests.map((request) => JSON.stringify(request)).join('\n') + '\n');
    expect(JSON.parse(encodeRequests(requests).split('\n')[0])).toEqual({
      id: 'opaque-a', turns: [{ speaker: 'client', text: 'Ипотека мне не нужна.' }], question: requests[0].question,
    });
    expect(encodeRequests([])).toBe('');
  });

  it.each([
    { id: '' }, { turns: [] },
    { turns: [{ speaker: 'system', text: 'x' }] },
    { turns: [{ speaker: 'client', text: 1 }] },
    { turns: [{ speaker: 'client', text: 'x', core: 'NO' }] },
    { question: { text: 'x' } }, { question: '' },
  ])('rejects malformed request roles/question/payload %j', (override) => {
    const { requests } = batchFixture();
    expect(() => encodeRequests([{ ...requests[0], ...override } as unknown as ScoutRequest])).toThrow();
  });

  it('rejects duplicate request ids, extra comparator fields and unregistered questions', () => {
    const { requests } = batchFixture();
    expect(() => encodeRequests([requests[0], requests[0]])).toThrow();
    expect(() => encodeRequests([{ ...requests[0], gold: 'YES' } as ScoutRequest])).toThrow();
    expect(() => encodeRequests([{ ...requests[0], question: 'Answer-informed question' }])).toThrow();
  });

  it('rejects absent slots in the submitted requests array rather than dropping records', () => {
    const { requests } = batchFixture();
    expect(() => encodeRequests(new Array<ScoutRequest>(1))).toThrow('SCOUT_REQUEST_SCHEMA');
    const sparse = new Array<ScoutRequest>(3);
    sparse[0] = requests[0];
    sparse[2] = requests[1];
    expect(() => encodeRequests(sparse)).toThrow('SCOUT_REQUEST_SCHEMA');
  });

  it('rejects absent turn slots rather than serializing a null dialogue turn', () => {
    const { requests } = batchFixture();
    const sparse = new Array<ScoutRequest['turns'][number]>(2);
    sparse[1] = requests[0].turns[0];
    expect(() => encodeRequests([{ ...requests[0], turns: sparse }])).toThrow('SCOUT_REQUEST_SCHEMA');
    expect(() => encodeRequests([{ ...requests[0], turns: new Array(1) }])).toThrow('SCOUT_REQUEST_SCHEMA');
  });

  it('stops a sparse manifest requestIds array rather than losing case accounting', () => {
    const fixture = batchFixture([]);
    const result = importResponses({ ...fixture.manifest, requestIds: new Array<string>(1),
      selection: { observed: 1, selected: 1, rejected: 0 },
    }, fixture.responseManifest, fixture.jsonl);
    expect(result.status).toBe('STOP');
    expect(result.errors).toEqual(['BATCH_MANIFEST_SCHEMA']);
  });

  it('rejects inherited array slots at every request protocol boundary', () => {
    const fixture = batchFixture([]);
    const inheritedSlot = <T,>(item: T): T[] => Object.setPrototypeOf(new Array<T>(1),
      Object.assign(Object.create(Array.prototype), { 0: item }));
    expect(() => encodeRequests(inheritedSlot(fixture.requests[0]))).toThrow('SCOUT_REQUEST_SCHEMA');
    expect(() => encodeRequests([{ ...fixture.requests[0], turns: inheritedSlot(fixture.requests[0].turns[0]) }])).toThrow('SCOUT_REQUEST_SCHEMA');
    expect(importResponses({ ...fixture.manifest, requestIds: inheritedSlot('opaque-a'),
      selection: { observed: 1, selected: 1, rejected: 0 },
    }, fixture.responseManifest, fixture.jsonl).errors).toEqual(['BATCH_MANIFEST_SCHEMA']);
  });

  it('retains semantic NO/UNKNOWN and returns responses in submitted order', () => {
    const { manifest, responseManifest, jsonl } = batchFixture([
      { id: 'opaque-b', status: 'OK', raw_output: 'UNKNOWN', latency_ms: null },
      { id: 'opaque-a', status: 'OK', raw_output: ' NO\n', latency_ms: 2, claimed_prediction: 'NO' },
    ]);
    expect(importResponses(manifest, responseManifest, jsonl)).toEqual({
      status: 'COMPLETE', responses: [
        { id: 'opaque-a', status: 'OK', raw_output: ' NO\n', latency_ms: 2, claimed_prediction: 'NO', prediction: 'NO' },
        { id: 'opaque-b', status: 'OK', raw_output: 'UNKNOWN', latency_ms: null, prediction: 'UNKNOWN' },
      ], missingIds: [], errors: [],
    });
  });

  it('accounts missing ids explicitly without creating UNKNOWN', () => {
    const { manifest, responseManifest, jsonl } = batchFixture([{ id: 'opaque-a', status: 'OK', raw_output: 'NO', latency_ms: 0 }]);
    const result = importResponses(manifest, responseManifest, jsonl);
    expect(result.status).toBe('PARTIAL');
    expect(result.missingIds).toEqual(['opaque-b']);
    expect(result.responses.map((row) => row.prediction)).toEqual(['NO']);
    expect(result.errors).toContain('MISSING_RESPONSE:opaque-b');
    const empty = batchFixture([]);
    expect(importResponses(empty.manifest, empty.responseManifest, empty.jsonl).missingIds).toEqual(['opaque-a', 'opaque-b']);
  });

  it.each(['TIMEOUT', 'ERROR', 'INPUT_LIMIT'])('retains %s with null prediction and explicit error accounting', (status) => {
    const { manifest, responseManifest, jsonl } = batchFixture([
      { id: 'opaque-a', status, raw_output: null, latency_ms: 30_000 },
      { id: 'opaque-b', status: 'OK', raw_output: 'NO', latency_ms: 1 },
    ]);
    const result = importResponses(manifest, responseManifest, jsonl);
    expect(result.status).toBe('COMPLETE');
    expect(result.responses[0].prediction).toBeNull();
    expect(result.responses[0].status).toBe(status);
    expect(result.errors).toContain(`${status}:opaque-a`);
    expect(result.missingIds).toEqual([]);
  });

  it('allows redacted runtime INVALID but never OK with null output', () => {
    const valid = batchFixture([{ id: 'opaque-a', status: 'INVALID', raw_output: null, latency_ms: 2, claimed_prediction: 'INVALID' }]);
    expect(importResponses(valid.manifest, valid.responseManifest, valid.jsonl).responses[0].prediction).toBe('INVALID');
    const invalid = batchFixture([{ id: 'opaque-a', status: 'OK', raw_output: null, latency_ms: 2 }]);
    expect(importResponses(invalid.manifest, invalid.responseManifest, invalid.jsonl).status).toBe('STOP');
  });

  it('recomputes raw labels and rejects forged claimed predictions', () => {
    for (const row of [
      { id: 'opaque-a', status: 'OK', raw_output: 'NO', latency_ms: 1, claimed_prediction: 'YES' },
      { id: 'opaque-a', status: 'INVALID', raw_output: 'NO', latency_ms: 1 },
      { id: 'opaque-a', status: 'TIMEOUT', raw_output: null, latency_ms: null, claimed_prediction: 'UNKNOWN' },
    ]) {
      const fixture = batchFixture([row]);
      expect(importResponses(fixture.manifest, fixture.responseManifest, fixture.jsonl).status).toBe('STOP');
    }
    const fixture = batchFixture([{ id: 'opaque-a', status: 'OK', raw_output: 'YES because', latency_ms: 1 }]);
    expect(importResponses(fixture.manifest, fixture.responseManifest, fixture.jsonl).responses[0].prediction).toBe('INVALID');
  });

  it.each(['runId', 'inputSha256', 'contractSha256', 'promptHash', 'settingsHash', 'responsesSha256'])('stops wrong response provenance %s', (key) => {
    const fixture = batchFixture();
    const changed = { ...fixture.responseManifest, [key]: key === 'runId' ? 'another-run' : 'a'.repeat(64) };
    const result = importResponses(fixture.manifest, changed, fixture.jsonl);
    expect(result.status).toBe('STOP');
    expect(result.responses).toEqual([]);
    expect(result.errors.some((error) => error.startsWith('MALFORMED_JSONL'))).toBe(false);
  });

  it('checks provenance before parsing even a rehashed malformed response file', () => {
    const fixture = batchFixture();
    const result = importResponses(fixture.manifest, { ...fixture.responseManifest,
      inputSha256: 'a'.repeat(64), responsesSha256: createHash('sha256').update('not JSON\n').digest('hex'),
    }, 'not JSON\n');
    expect(result.errors).toEqual(['PROVENANCE_MISMATCH:inputSha256']);
  });

  it('stops wrong model/revision/runtime and forged matching local provenance', () => {
    const fixture = batchFixture();
    for (const changed of [
      { ...fixture.responseManifest, model: { ...fixture.responseManifest.model, id: 'replacement' } },
      { ...fixture.responseManifest, model: { ...fixture.responseManifest.model, revision: 'a'.repeat(40) } },
      { ...fixture.responseManifest, runtimeIdentity: { ...fixture.responseManifest.runtimeIdentity, runner: 'replacement' } },
      { ...fixture.responseManifest, runtimeIdentity: { ...fixture.responseManifest.runtimeIdentity, runtimeReferenceHash: 'a'.repeat(64) } },
    ]) expect(importResponses(fixture.manifest, changed, fixture.jsonl).status).toBe('STOP');
    for (const key of ['contractSha256', 'promptHash', 'settingsHash'] as const) {
      expect(importResponses({ ...fixture.manifest, [key]: 'a'.repeat(64) }, { ...fixture.responseManifest, [key]: 'a'.repeat(64) }, fixture.jsonl).status).toBe('STOP');
    }
  });

  it.each(['policyHash', 'projectionHash', 'questionRegistryHash', 'fingerprintHash'])('stops forged %s frozen metadata', (key) => {
    const fixture = batchFixture();
    expect(importResponses({ ...fixture.manifest, [key]: 'a'.repeat(64) }, fixture.responseManifest, fixture.jsonl).status).toBe('STOP');
  });

  it('stops response byte edits even when JSON meaning is unchanged', () => {
    const fixture = batchFixture();
    expect(importResponses(fixture.manifest, fixture.responseManifest, fixture.jsonl.replace('"id":', '"id": ')).status).toBe('STOP');
  });

  it.each([
    ['duplicate', [{ id: 'opaque-a', status: 'OK', raw_output: 'NO', latency_ms: 0 }, { id: 'opaque-a', status: 'OK', raw_output: 'NO', latency_ms: 0 }]],
    ['unexpected', [{ id: 'external-id', status: 'OK', raw_output: 'NO', latency_ms: 0 }]],
    ['malformed timing', [{ id: 'opaque-a', status: 'OK', raw_output: 'NO', latency_ms: '1' }]],
    ['overflow timing', [{ id: 'opaque-a', status: 'OK', raw_output: 'NO', latency_ms: 1e309 }]],
    ['negative timing', [{ id: 'opaque-a', status: 'OK', raw_output: 'NO', latency_ms: -1 }]],
    ['wrong output type', [{ id: 'opaque-a', status: 'OK', raw_output: 1, latency_ms: 0 }]],
    ['external Core authority', [{ id: 'opaque-a', status: 'OK', raw_output: 'NO', latency_ms: 0, core: 'YES' }]],
    ['external gold authority', [{ id: 'opaque-a', status: 'OK', raw_output: 'NO', latency_ms: 0, gold: 'YES' }]],
  ])('stops %s rows', (_name, rows) => {
    const fixture = batchFixture(rows as unknown[]);
    // JSON.stringify converts non-finite numbers to null; use a legal JSON numeric overflow lexeme.
    const jsonl = _name === 'overflow timing' ? fixture.jsonl.replace('"latency_ms":null', '"latency_ms":1e309') : fixture.jsonl;
    const responseManifest = { ...fixture.responseManifest, responsesSha256: createHash('sha256').update(jsonl).digest('hex') };
    const result = importResponses(fixture.manifest, responseManifest, jsonl);
    expect(result.status).toBe('STOP');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it.each(['{}', '{}\n\n', '\n', '\ufeff{}\n', '{}\r\n', 'not JSON\n', '[]\n', 'null\n'])('stops malformed LF JSONL %j with matching byte hash', (jsonl) => {
    const fixture = batchFixture();
    const responseManifest = { ...fixture.responseManifest, responsesSha256: createHash('sha256').update(jsonl).digest('hex') };
    expect(importResponses(fixture.manifest, responseManifest, jsonl).status).toBe('STOP');
  });

  it('rejects unknown manifest keys, duplicate submitted ids and impossible selection totals', () => {
    const fixture = batchFixture();
    for (const manifest of [
      { ...fixture.manifest, gold: 'YES' }, { ...fixture.manifest, requestIds: ['opaque-a', 'opaque-a'] },
      { ...fixture.manifest, selection: { observed: 1, selected: 2, rejected: 0 } },
    ]) expect(importResponses(manifest, fixture.responseManifest, fixture.jsonl).status).toBe('STOP');
    expect(importResponses(fixture.manifest, { ...fixture.responseManifest, gold: 'YES' } as ResponseManifest, fixture.jsonl).status).toBe('STOP');
  });
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
