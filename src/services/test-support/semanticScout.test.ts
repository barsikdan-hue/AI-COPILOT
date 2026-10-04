import { describe, expect, it, vi } from 'vitest';
const sourceAccess = vi.hoisted(() => ({ historyUnavailable: false }));
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
    if (sourceAccess.historyUnavailable && String(args[0]).replace(/\\/gu, '/').includes('/diagnostics/')) throw new Error('HISTORICAL_FIXTURE_UNAVAILABLE');
    return actual.readFileSync(...args);
  } };
});
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  effectivePolicy, loadContract, projectCore, selectObservations, normalizeOutput, encodeRequests, importResponses,
  comparePairs, fingerprintDisagreement, deduplicateDisagreements,
  prepareBatch, reportBatch, main,
  type CaseBinding, type ScoutContract, type ScoutRequest, type ScoutResponse, type BatchManifest, type ResponseManifest, type RuntimeStatus, type ComparisonPair,
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

function pair(contract: ScoutContract, overrides: Partial<ComparisonPair> = {}): ComparisonPair {
  const source = contract.bindings[0];
  return {
    id: 'c1', runId: 'run-a', binding: source,
    core: { status: 'COMPARABLE', value: 'NO', projectionId: source.projectionId, dimensions: { ...source.dimensions } },
    response: { id: 'c1', status: 'OK', raw_output: 'YES', latency_ms: 1, prediction: 'YES' },
    ...overrides,
  };
}

describe('compare-dedup', () => {
  it('creates only advisory disagreements from comparable valid active mismatches', () => {
    const contract = loadContract(scoutContractPath);
    const active = pair(contract);
    const agreement = pair(contract, { id: 'agree', response: { ...active.response, id: 'agree', raw_output: 'NO', prediction: 'NO' } });
    const observe = pair(contract, { id: 'observe', binding: { ...active.binding, policySlices: ['corrections'] },
      response: { ...active.response, id: 'observe' } });
    const disabled = pair(contract, { id: 'disabled', binding: { ...active.binding, privacyApproved: false },
      response: { ...active.response, id: 'disabled' } });
    const notComparable = pair(contract, { id: 'nc', core: { status: 'NOT_COMPARABLE', reason: 'NO_PROJECTION' },
      response: { ...active.response, id: 'nc' } });
    const invalid = pair(contract, { id: 'invalid', response: { ...active.response, id: 'invalid', raw_output: 'maybe', prediction: 'INVALID' } });
    const error = pair(contract, { id: 'error', response: { ...active.response, id: 'error', status: 'ERROR', raw_output: null, prediction: null } });
    const result = comparePairs([active, agreement, observe, disabled, notComparable, invalid, error], contract);
    expect(result.agreements.map(({ id }) => id)).toEqual(['agree']);
    expect(result.observeOnlyDisagreements.map(({ id }) => id)).toEqual(['observe']);
    expect(result.eligibleDisagreements.map(({ pair: value }) => value.id)).toEqual(['c1']);
    expect(result.rejected.map(({ id }) => id)).toEqual(['disabled', 'nc', 'invalid', 'error']);
    expect(deduplicateDisagreements('run-a', result.eligibleDisagreements)).toMatchObject([
      { run_id: 'run-a', occurrence_count: 1, occurrence_ids: ['c1'], representative_ids: ['c1'] },
    ]);
    expect(() => fingerprintDisagreement(agreement, contract)).toThrow();
    expect(() => fingerprintDisagreement(observe, contract)).toThrow();
  });

  it('deduplicates five sorted occurrences, retains all private references, and ignores repeated import', () => {
    const contract = loadContract(scoutContractPath);
    const ids = ['c5', 'c1', 'c3', 'c2', 'c4'];
    const pairs = ids.map((id) => pair(contract, { id, response: { ...pair(contract).response, id },
      binding: { ...contract.bindings[0], sourceGroupId: `source-${id}`, sourceReferences: [`private/${id}`] } }));
    const values = comparePairs(pairs, contract).eligibleDisagreements;
    // The immutable binding gate means these test-local source variations are checked at the dedup boundary.
    const certified = pairs.map((value) => ({ pair: value, fingerprint: fingerprintDisagreement(pair(contract), contract) }));
    expect(values).toHaveLength(0);
    const first = deduplicateDisagreements('run-a', certified);
    expect(first).toMatchObject([{ occurrence_count: 5, occurrence_ids: ['c1', 'c2', 'c3', 'c4', 'c5'],
      representative_ids: ['c1', 'c2', 'c3'] }]);
    expect(first[0].source_references).toEqual(ids.sort().map((id) => ({
      observation_id: id, source_group_id: `source-${id}`, reference: `private/${id}`,
    })));
    expect(deduplicateDisagreements('run-a', [...certified].reverse())).toEqual(first);
    expect(deduplicateDisagreements('run-a', [...certified, certified[0]])[0].occurrence_count).toBe(5);
    const newRun = certified.map((value) => ({ ...value, pair: { ...value.pair, runId: 'run-b' } }));
    expect(deduplicateDisagreements('run-b', newRun)[0]).toMatchObject({ run_id: 'run-b', occurrence_count: 5 });
  });

  it('separates direction and reviewed owner/time dimensions, and conservatively isolates missing dimensions', () => {
    const contract = loadContract(scoutContractPath);
    const base = pair(contract);
    const swapped = pair(contract, { id: 'swap', core: { ...base.core, value: 'YES' } as ComparisonPair['core'],
      response: { ...base.response, id: 'swap', raw_output: 'NO', prediction: 'NO' } });
    const relative = pair(contract, { id: 'relative', core: { ...base.core,
      dimensions: { ...base.binding.dimensions, owner: 'relative' } } as ComparisonPair['core'], response: { ...base.response, id: 'relative' } });
    const future = pair(contract, { id: 'future', core: { ...base.core,
      dimensions: { ...base.binding.dimensions, time: 'future' } } as ComparisonPair['core'], response: { ...base.response, id: 'future' } });
    const missing1 = pair(contract, { id: 'missing-1', core: { ...base.core,
      dimensions: { owner: 'client', predicate: 'mortgage_permission', correctionScope: 'none' } } as ComparisonPair['core'], response: { ...base.response, id: 'missing-1' } });
    const missing2 = pair(contract, { id: 'missing-2', core: missing1.core, response: { ...base.response, id: 'missing-2' } });
    const values = [base, swapped, relative, future, missing1, missing2].map((value) => ({
      pair: value, fingerprint: fingerprintDisagreement(value, contract),
    }));
    expect(deduplicateDisagreements('run-a', values)).toHaveLength(6);
    expect(values[4].fingerprint.payload).toHaveProperty('missingObservationDiscriminator');
    expect(JSON.stringify(values[4].fingerprint.payload)).not.toContain('missing-1');
  });

  it('rejects unreviewed question/projection/version, unsafe dimensions, and excludes secret-bearing fields', () => {
    const contract = loadContract(scoutContractPath);
    const base = pair(contract);
    const payload = fingerprintDisagreement(base, contract).payload;
    for (const changed of [
      { questionId: 'mortgage_use' }, { projectionVersion: 'v2' }, { projectionId: 'other' },
    ]) expect(() => fingerprintDisagreement(pair(contract, { binding: { ...base.binding, ...changed } }), contract)).toThrow();
    for (const dimensions of [
      { ...base.binding.dimensions, owner: 1.5 },
      { ...base.binding.dimensions, owner: 20_000_000 },
      { ...base.binding.dimensions, owner: 'private/secret' },
    ]) expect(() => fingerprintDisagreement(pair(contract, { core: { ...base.core, dimensions } as ComparisonPair['core'] }), contract)).toThrow();
    const secretPair = pair(contract, { binding: { ...base.binding, sourceReferences: ['private/secret'], sourceHashes: { secret: 'abc' } },
      response: { ...base.response, claimed_prediction: 'YES' } });
    expect(JSON.stringify(payload)).not.toMatch(/private|secret|sourceReferences|sourceHashes|raw_output|latency_ms/u);
    expect(() => fingerprintDisagreement(secretPair, contract)).toThrow();
    const extraPrivate = pair(contract, { core: { ...base.core, dimensions: {
      ...base.binding.dimensions, rawText: 'Private Person', amount: 20_000_000, sourcePath: 'private/secret',
    } } as ComparisonPair['core'] });
    expect(fingerprintDisagreement(extraPrivate, contract)).toEqual(fingerprintDisagreement(base, contract));
    const reordered = pair(contract, { core: { ...base.core, dimensions: {
      correctionScope: 'none', predicate: 'mortgage_permission', time: 'current', owner: 'client',
    } } as ComparisonPair['core'] });
    expect(fingerprintDisagreement(reordered, contract)).toEqual(fingerprintDisagreement(base, contract));
    expect(JSON.stringify(payload)).toContain('Клиент сейчас');
    const canonicalBytes = '{"coreAnswer":"NO","dimensions":{"correctionScope":"none","owner":"client","predicate":"mortgage_permission","time":"current"},"domain":"negation","fingerprintVersion":"semantic-scout/v1","policyVersion":"semantic-scout-initial/v1","projection":{"id":"mortgage-rejected-branch","version":"v1"},"question":{"id":"mortgage_permission","wording":"Клиент сейчас допускает рассмотрение ипотеки для своей покупки?"},"scoutAnswer":"YES","semanticContract":{"schemaVersion":1,"sourceSha256":"fb3f482766b3858815cbac5ce39061cd17022bbb9e75db16386e13a5e2f56020"}}';
    expect(fingerprintDisagreement(base, contract).sha256).toBe(createHash('sha256').update(Buffer.from(canonicalBytes, 'utf8')).digest('hex'));
  });
});

describe('contract-policy-comparability', () => {
  it('loads pinned authority and binding sources through actual LF and Windows Git filters', () => {
    const path = '.agents/skills/ai-copilot-semantic-scout/references/semantic-scout-contract.json';
    const root = mkdtempSync(resolve(tmpdir(), 'scout-eol-'));
    try {
      for (const autocrlf of ['false', 'true']) {
        const filtered = execFileSync('git', ['-c', `core.autocrlf=${autocrlf}`, 'cat-file', '--filters', `HEAD:${path}`]);
        const target = resolve(root, 'contract.json'); writeFileSync(target, filtered);
        const contract = loadContract(target, (source) => execFileSync('git', ['-c', `core.autocrlf=${autocrlf}`, 'cat-file', '--filters', `HEAD:${source}`]));
        expect(projectCore(observation(), contract.bindings[0], contract).status).toBe('COMPARABLE');
      }
      expect(() => loadContract(resolve(root, 'contract.json'), (source) => Buffer.concat([execFileSync('git', ['show', `HEAD:${source}`]), Buffer.from('// semantic drift')]))).toThrow('SCOUT_SOURCE_DRIFT');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('freezes semantic meaning and proven runtime values without historical task authority', () => {
    const contract = loadContract(scoutContractPath);
    expect(contract.semanticPayload.labels).toHaveProperty('UNKNOWN');
    expect(contract.questionRegistry.mortgage_permission).toBe('Клиент сейчас допускает рассмотрение ипотеки для своей покупки?');
    expect(contract.model).toEqual({ id: 'RefalMachine/RuadaptQwen3-4B-Instruct', revision: '684adcaf873c3befcac5629804151a606a1b2d57' });
    expect(contract.settings).toMatchObject({ repetition_penalty: 1, max_input_tokens: 2048, do_sample: false, thinking: false });
    expect(contract.semanticSourceHash).toBe('fb3f482766b3858815cbac5ce39061cd17022bbb9e75db16386e13a5e2f56020');
    expect(contract.runtimeReferenceHash).toBe('fe0bc5cd97fa60f2bdd6c143fcef87746f320efb8e9bc319a3fa9bac01539ff5');
    expect(Object.keys(contract.sourceArtifactHashes)).toHaveLength(3);
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

describe('portable-adapter-contract', () => {
  // Provider-independent wire examples: no Python/package/GPU invocation in Vitest.
  // These catch loss of ordered inputs or interpreting operational failure as UNKNOWN.
  function adapterFixture() {
    const fixture = batchFixture([]);
    const requests: ScoutRequest[] = ['a', 'b', 'c', 'd', 'e'].map((letter) => ({
      id: letter.repeat(64), question: fixture.requests[0].question,
      turns: [{ speaker: 'agent', text: 'Рассмотрим ипотеку?' }, { speaker: 'client', text: 'Нет.' }],
    }));
    const input = encodeRequests(requests);
    const manifest: BatchManifest = { ...fixture.manifest, requestIds: requests.map(({ id }) => id),
      inputSha256: createHash('sha256').update(input).digest('hex'), selection: { observed: 5, selected: 5, rejected: 0 } };
    // Matches Python's compact, sorted-key UTF-8 LF rows; invalid reasoning is absent.
    const jsonl = [
      `{"id":"${'a'.repeat(64)}","latency_ms":1.5,"raw_output":"NO","status":"OK"}`,
      `{"id":"${'b'.repeat(64)}","latency_ms":2,"raw_output":null,"status":"INVALID"}`,
      `{"id":"${'c'.repeat(64)}","latency_ms":30001,"raw_output":null,"status":"TIMEOUT"}`,
      `{"id":"${'d'.repeat(64)}","latency_ms":null,"raw_output":null,"status":"ERROR"}`,
      `{"id":"${'e'.repeat(64)}","latency_ms":3,"raw_output":null,"status":"INPUT_LIMIT"}`,
    ].join('\n') + '\n';
    const responseManifest: ResponseManifest = { ...fixture.responseManifest,
      inputSha256: manifest.inputSha256, responsesSha256: createHash('sha256').update(jsonl).digest('hex'),
      runtimeIdentity: { ...fixture.responseManifest.runtimeIdentity, versions: { python: 'stdlib-fixture',
        torch: 'provider-fixture', transformers: 'provider-fixture', cuda: 'provider-fixture',
        dtype: 'float16', device: 'cuda:0', attention: 'sdpa', settings: '{"repetition_penalty":1.0}' } } };
    return { requests, input, manifest, jsonl, responseManifest };
  }

  it('exports opaque ids and exact ordered agent/client turns with one atomic question', () => {
    const fixture = adapterFixture();
    const rows = fixture.input.trimEnd().split('\n').map((line) => JSON.parse(line));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ id: 'a'.repeat(64), question: 'Клиент сейчас допускает рассмотрение ипотеки для своей покупки?',
      turns: [{ speaker: 'agent', text: 'Рассмотрим ипотеку?' }, { speaker: 'client', text: 'Нет.' }] });
    expect(rows.every((row) => Object.keys(row).sort().join(',') === 'id,question,turns')).toBe(true);
    expect(createHash('sha256').update(Buffer.from(fixture.input, 'utf8')).digest('hex')).toBe(fixture.manifest.inputSha256);
  });

  it('imports complete adapter accounting while failed ids have no semantic answer', () => {
    const fixture = adapterFixture();
    const imported = importResponses(fixture.manifest, fixture.responseManifest, fixture.jsonl);
    expect(imported.status).toBe('PARTIAL');
    expect(imported.missingIds).toEqual([]);
    expect(imported.responses.map(({ id }) => id)).toEqual(fixture.manifest.requestIds);
    expect(imported.responses.map(({ prediction }) => prediction)).toEqual(['NO', 'INVALID', null, null, null]);
    expect(imported.responses.slice(1).every(({ raw_output }) => raw_output === null)).toBe(true);
    expect(imported.errors).toEqual([`INVALID:${'b'.repeat(64)}`, `TIMEOUT:${'c'.repeat(64)}`,
      `ERROR:${'d'.repeat(64)}`, `INPUT_LIMIT:${'e'.repeat(64)}`]);
  });

  it('detects a truncated adapter bundle through raw byte hash before accepting rows', () => {
    const fixture = adapterFixture();
    const imported = importResponses(fixture.manifest, fixture.responseManifest, fixture.jsonl.slice(0, -1));
    expect(imported.status).toBe('STOP');
    expect(imported.responses).toEqual([]);
    expect(imported.errors).toEqual(['RESPONSES_BYTE_HASH_MISMATCH']);
  });
});

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
    expect(result.status).toBe('PARTIAL');
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

describe('workflow-skip-report', () => {
  const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  function observations(): RegressionObservation[] {
    const contract = loadContract(scoutContractPath);
    const expanded = EXPANDED_REGRESSION_SCENARIOS.find((item) => item.id === contract.bindings[1].identity.caseId)!;
    return [observation(), observation({ identity: contract.bindings[1].identity,
      turns: expanded.turns.map((turn, index) => ({ ...turn, id: `e${index + 1}` })) })];
  }
  function prepared(values = observations()) {
    return prepareBatch({ runId: 'private-test-run', sourceHead: head(), observations: values, contract: loadContract(scoutContractPath) });
  }
  function bundle(manifest: BatchManifest, rows: ScoutResponse[] = manifest.requestIds.map((id) => ({ id, status: 'OK', raw_output: 'YES', latency_ms: 1 }))) {
    const jsonl = rows.map((row) => JSON.stringify(row) + '\n').join('');
    const contract = loadContract(scoutContractPath);
    const responseManifest: ResponseManifest = {
      schemaVersion: 1, runId: manifest.runId, inputSha256: manifest.inputSha256, contractSha256: manifest.contractSha256,
      model: manifest.model, promptHash: manifest.promptHash, settingsHash: manifest.settingsHash,
      responsesSha256: createHash('sha256').update(jsonl).digest('hex'),
      runtimeIdentity: { runner: manifest.runnerIdentity, runtimeReferenceHash: contract.runtimeReferenceHash, versions: { unit: 'stub' } },
    };
    return { jsonl, responseManifest };
  }
  function runtimeSkip(manifest: BatchManifest): RuntimeStatus {
    const contract = loadContract(scoutContractPath);
    return { schemaVersion: 1, status: 'SKIP', reason: 'CUDA_UNAVAILABLE', runId: manifest.runId,
      inputSha256: manifest.inputSha256, contractSha256: manifest.contractSha256, model: manifest.model,
      promptHash: manifest.promptHash, settingsHash: manifest.settingsHash,
      runtimeIdentity: { runner: manifest.runnerIdentity, runtimeReferenceHash: contract.runtimeReferenceHash } };
  }
  async function withExport(test: (dir: string, run: string) => Promise<void>) {
    const dir = mkdtempSync(resolve(tmpdir(), 'scout-workflow-'));
    const run = resolve(dir, 'new-private-run');
    const original = vi.spyOn(await import('./massRegressionHarness'), 'runMassRegressionBaseline').mockImplementation((options) => {
      const good = observations()[0];
      expect(options?.observation?.select(good.identity)).toBe(true);
      expect(options?.observation?.select({ ...good.identity, variation: 1 })).toBe(false);
      expect(options?.observation?.select({ ...good.identity, instance: 'isolation-a' })).toBe(false);
      options?.observation?.onObservation(good);
      options?.observation?.onError?.(good.identity, 'UNIT_OBSERVER_ERROR');
      return { unit: 'original-deterministic-report' } as unknown as ReturnType<typeof runMassRegressionBaseline>;
    });
    const expanded = vi.spyOn(await import('./expandedRegressionHarness'), 'runExpandedRegression').mockImplementation((options) => {
      options?.observation?.onObservation(observations()[1]);
      return { unit: 'expanded-deterministic-report' } as unknown as ReturnType<typeof runExpandedRegression>;
    });
    try {
      expect(await main(['export', '--contract', scoutContractPath, '--out', run])).toBe(0);
      expect(original).toHaveBeenCalledTimes(1); expect(expanded).toHaveBeenCalledTimes(1);
      await test(dir, run);
    } finally { original.mockRestore(); expanded.mockRestore(); rmSync(dir, { recursive: true, force: true }); }
  }
  async function responsesAt(dir: string, run: string, bytes?: Buffer) {
    const manifest = JSON.parse(readFileSync(resolve(run, 'manifest.json'), 'utf8')) as BatchManifest;
    const response = bundle(manifest);
    const responses = resolve(dir, 'responses.jsonl'); const responseManifest = resolve(dir, 'response-manifest.json');
    writeFileSync(responses, bytes ?? response.jsonl);
    if (bytes) response.responseManifest.responsesSha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(responseManifest, JSON.stringify(response.responseManifest));
    return ['import', '--run', run, '--responses', responses, '--response-manifest', responseManifest];
  }
  it('selects before serialization and freezes only minimal requests and comparable private local observations', () => {
    const missing = observation({ core: { rejectedBranches: [] } });
    const privateUnreviewed = observation({ identity: { ...observation().identity, caseId: 'private-unit' },
      turns: [{ id: 'p1', speaker: 'client', text: 'PRIVATE-SECRET' }] });
    const ready = prepared([...observations(), missing, privateUnreviewed]);
    expect(ready.manifest.selection).toEqual({ observed: 4, selected: 2, rejected: 2 });
    expect(ready.requestsJsonl).not.toMatch(/PRIVATE-SECRET|core|gold|domain|sourceReferences|rejectedBranches/u);
    expect(ready.requestsJsonl.trim().split('\n').map((line) => Object.keys(JSON.parse(line)))).toEqual([['id', 'turns', 'question'], ['id', 'turns', 'question']]);
    expect(ready.localObservations).toHaveLength(2);
    expect(Object.isFrozen(ready.localObservations[0].core.rejectedBranches)).toBe(true);
    expect(reportBatch({ manifest: ready.manifest, observations: [...observations(), missing, privateUnreviewed],
      contract: loadContract(scoutContractPath), imported: null })).toMatchObject({ status: 'SKIP', counts: { observed: 4, selected: 2, rejected: 2, notComparable: 2 } });
    expect(prepared([missing]).selection.status).toBe('SKIP');
    const contract = loadContract(scoutContractPath);
    for (const bindingChange of [{ privacyApproved: false }, { questionId: 'dp_current_available_some' }]) {
      const changed = { ...contract, bindings: [{ ...contract.bindings[0], ...bindingChange }] };
      expect(prepareBatch({ runId: 'r', sourceHead: head(), observations: [observation()], contract: changed }).selection.status).toBe('STOP');
    }
  });
  it('uses deterministic opaque wire ids with exact private occurrence-to-source mapping', () => {
    const ready = prepared();
    const rows = ready.requestsJsonl.trim().split('\n').map((line) => JSON.parse(line));
    const values = observations();
    expect(rows.map(({ id }) => id)).toEqual(values.map(({ identity }) => protocolHash(identity)));
    expect(rows.every(({ id }) => /^[a-f0-9]{64}$/u.test(id))).toBe(true);
    expect(ready.manifest.requestIds).toEqual(prepared().manifest.requestIds);
    for (const { id } of rows) expect(id).not.toMatch(/fact|payment|mortgage|negation|original|expanded|primary|no-|YES|NO|UNKNOWN/u);
    const response = bundle(ready.manifest);
    const report = reportBatch({ manifest: ready.manifest, observations: ready.localObservations, contract: loadContract(scoutContractPath),
      imported: importResponses(ready.manifest, response.responseManifest, response.jsonl) });
    expect(report.occurrences.map((item) => item.observation_id)).toEqual(ready.manifest.requestIds);
    expect(report.occurrences.map((item) => item.local_observation_id)).toEqual(values.map(({ identity }) =>
      `${identity.harness}:${identity.caseId}:${identity.variation}:${identity.instance}:${identity.turnCutoff}`));
    expect(report.candidates[0].occurrence_ids).toEqual([...ready.manifest.requestIds].sort());
    expect(report.candidates[0].source_references.map((item) => item.observation_id)).toEqual(expect.arrayContaining(ready.manifest.requestIds));
  });
  it('counts two raw mismatches as one advisory group with every occurrence and zero proven outcomes', () => {
    const ready = prepared(); const response = bundle(ready.manifest);
    const imported = importResponses(ready.manifest, response.responseManifest, response.jsonl);
    const report = reportBatch({ manifest: ready.manifest, observations: ready.localObservations, contract: loadContract(scoutContractPath), imported });
    expect(report.status).toBe('COMPLETE');
    expect(report.counts).toMatchObject({ submitted: 2, valid: 2, comparisons: 2, eligibleDisagreements: 2, candidates: 1, suppressedRepeats: 1,
      provenCoreBugs: 0, provenScoutFalseAlarms: 0, unresolved: 1, selectedSourceGroups: 2, disagreementSourceGroups: 2 });
    expect(report.candidates[0].source_references).toHaveLength(8);
    expect(report.occurrences).toHaveLength(2);
    expect(report).not.toHaveProperty('accuracy');
    expect(reportBatch({ manifest: ready.manifest, observations: ready.localObservations, contract: loadContract(scoutContractPath), imported: null }).status).toBe('SKIP');
  });
  it('exports and imports with historical artifact reads unavailable', async () => {
    sourceAccess.historyUnavailable = true;
    try {
      await withExport(async (dir, run) => {
        const manifest = JSON.parse(readFileSync(resolve(run, 'manifest.json'), 'utf8'));
        expect(Object.keys(manifest.sourceHashes).some((path) => path.startsWith('diagnostics/'))).toBe(false);
        expect(await main(await responsesAt(dir, run))).toBe(0);
        expect(JSON.parse(readFileSync(resolve(run, 'results/report.json'), 'utf8')).status).toBe('COMPLETE');
      });
    } finally { sourceAccess.historyUnavailable = false; }
  });
  it('exports a complete minimal external bundle without private comparator/source metadata', async () => {
    await withExport(async (_dir, run) => {
      const bytes = readFileSync(resolve(run, 'runtime-contract.json'), 'utf8');
      const runtime = JSON.parse(bytes);
      const manifest = JSON.parse(readFileSync(resolve(run, 'runtime-manifest.json'), 'utf8'));
      const requests = readFileSync(resolve(run, 'requests.jsonl'), 'utf8');
      expect(Object.keys(runtime).sort()).toEqual(['schemaVersion', 'semanticSourceHash', 'model', 'systemPrompt', 'settings', 'promptHash', 'settingsHash', 'runtimeReferenceHash', 'questionRegistry', 'questionPolicy'].sort());
      expect(Object.keys(manifest).sort()).toEqual(['schemaVersion', 'runId', 'inputSha256', 'requestIds', 'contractSha256', 'runtimeContractSha256', 'model', 'promptHash', 'settingsHash', 'runnerIdentity'].sort());
      expect(bytes + JSON.stringify(manifest) + requests).not.toMatch(/fact\.payment|negation\.payment|sourceGroup|sourceReferences|sourceHashes|sourceHead|mortgage-rejected-branch|dimensions|bindings|projections/u);
      expect(bytes).toContain('"repetition_penalty":1.0');
      expect(manifest.runtimeContractSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(manifest.inputSha256).toBe(createHash('sha256').update(requests).digest('hex'));
    });
  });
  it('retains sanitized immutable response evidence outside the run before candidates', async () => {
    await withExport(async (dir, run) => {
      const manifest = JSON.parse(readFileSync(resolve(run, 'manifest.json'), 'utf8')) as BatchManifest;
      const response = bundle(manifest, [
        { id: manifest.requestIds[0], status: 'OK', raw_output: 'YES', latency_ms: 1 },
        { id: manifest.requestIds[1], status: 'OK', raw_output: '<think>PRIVATE_REASONING</think>'.repeat(1000), latency_ms: 2 },
      ]);
      const responses = resolve(dir, 'external.jsonl'); const metadata = resolve(dir, 'external-manifest.json');
      writeFileSync(responses, response.jsonl); writeFileSync(metadata, JSON.stringify(response.responseManifest));
      const out = resolve(dir, 'independent-results');
      const args = ['import', '--run', run, '--responses', responses, '--response-manifest', metadata, '--out', out];
      expect(await main(args)).toBe(0);
      const report = JSON.parse(readFileSync(resolve(out, 'report.json'), 'utf8'));
      const frozen = JSON.parse(readFileSync(resolve(out, 'evidence-freeze.json'), 'utf8'));
      const evidenceBytes = readFileSync(resolve(out, 'response-evidence.json'));
      const evidence = JSON.parse(evidenceBytes.toString('utf8'));
      expect(report.status).toBe('PARTIAL');
      expect(evidence.responses.map((row: { id: string }) => row.id)).toEqual(manifest.requestIds);
      expect(evidence.responses.map((row: { raw_output: string | null }) => row.raw_output)).toEqual(['YES', null]);
      expect(evidence.missingIds).toEqual([]);
      expect(evidenceBytes.toString('utf8')).not.toContain('PRIVATE_REASONING');
      expect(frozen.incomingResponsesSha256).toBe(response.responseManifest.responsesSha256);
      expect(frozen.artifactHashes['response-evidence.json']).toBe(createHash('sha256').update(evidenceBytes).digest('hex'));
      expect(report.evidence.freezeSha256).toBe(createHash('sha256').update(readFileSync(resolve(out, 'evidence-freeze.json'))).digest('hex'));
      expect(readFileSync(resolve(out, 'contract.json'))).toEqual(readFileSync(scoutContractPath));
      expect(await main([...args.slice(0, -1), resolve(dir, 'second-results')])).toBe(0);
      expect(readFileSync(resolve(dir, 'second-results/response-evidence.json'))).toEqual(evidenceBytes);
      writeFileSync(responses, 'mutated external source'); rmSync(metadata);
      expect(readFileSync(resolve(out, 'response-evidence.json'))).toEqual(evidenceBytes);
      expect(await main(args)).toBe(2);
      expect(readFileSync(resolve(out, 'response-evidence.json'))).toEqual(evidenceBytes);
    });
  });
  it('retains all accepted failed and missing ids in evidence accounting', async () => {
    await withExport(async (dir, run) => {
      const manifest = JSON.parse(readFileSync(resolve(run, 'manifest.json'), 'utf8'));
      const response = bundle(manifest, [{ id: manifest.requestIds[0], status: 'ERROR', raw_output: null, latency_ms: 1 }]);
      const responses = resolve(dir, 'partial.jsonl'); const metadata = resolve(dir, 'partial-manifest.json');
      writeFileSync(responses, response.jsonl); writeFileSync(metadata, JSON.stringify(response.responseManifest));
      expect(await main(['import', '--run', run, '--responses', responses, '--response-manifest', metadata])).toBe(0);
      const evidence = JSON.parse(readFileSync(resolve(run, 'results/response-evidence.json'), 'utf8'));
      expect(evidence.responses).toMatchObject([{ id: manifest.requestIds[0], status: 'ERROR', prediction: null }]);
      expect(evidence.missingIds).toEqual([manifest.requestIds[1]]);
      expect(evidence.requestIds).toEqual(manifest.requestIds);
    });
  });
  it('reconciles domain operational and dedup denominators with global accounting', () => {
    const values = [...observations(), observation({ core: { rejectedBranches: [] } }),
      observation({ identity: { ...observation().identity, caseId: 'unclassified-private' } })];
    const ready = prepared(values); const contract = loadContract(scoutContractPath);
    expect(ready.selection.domains.negation).toMatchObject({ observed: 3, selected: 2, rejected: 1, notComparable: 1 });
    expect(ready.selection.counts.unclassifiedRejected).toBe(1);
    const failed = bundle(ready.manifest, [{ id: ready.manifest.requestIds[0], status: 'ERROR', raw_output: null, latency_ms: 1 }]);
    const report = reportBatch({ manifest: ready.manifest, observations: values, contract,
      imported: importResponses(ready.manifest, failed.responseManifest, failed.jsonl) });
    expect(report.domains.negation).toMatchObject({ submitted: 2, returned: 1, failed: 1, missing: 1, valid: 0, comparisons: 0, candidates: 0 });
    const mismatch = bundle(ready.manifest);
    const dedup = reportBatch({ manifest: ready.manifest, observations: values, contract,
      imported: importResponses(ready.manifest, mismatch.responseManifest, mismatch.jsonl) });
    expect(dedup.domains.negation).toMatchObject({ valid: 2, comparisons: 2, eligibleDisagreements: 2, candidates: 1, suppressedRepeats: 1,
      selectedSourceGroups: 2, comparedSourceGroups: 2, disagreementSourceGroups: 2, provenCoreBugs: 0, provenScoutFalseAlarms: 0, unresolved: 1 });
    for (const key of ['selected', 'submitted', 'returned', 'failed', 'missing', 'valid', 'comparisons', 'candidates', 'suppressedRepeats']) {
      expect(Object.values(dedup.domains).reduce((sum, domain) => sum + domain[key], 0)).toBe(dedup.counts[key]);
    }
  });
  it('blocks disabled and unclassified question wording in the low-level encoder', () => {
    const contract = loadContract(scoutContractPath);
    for (const question of [contract.questionRegistry.dp_current_available_some, 'unclassified question']) {
      expect(() => encodeRequests([{ id: 'a'.repeat(64), turns: [{ speaker: 'client', text: 'PRIVATE' }], question }])).toThrow('SCOUT_REQUEST_SCHEMA');
    }
    expect(encodeRequests([{ id: 'a'.repeat(64), turns: [{ speaker: 'client', text: 'Later.' }], question: contract.questionRegistry.dp_future_funds_available }])).toContain('Later.');
  });
  it('retains partial/invalid/timeout denominators and blocks every STOP comparison', () => {
    const ready = prepared(); const response = bundle(ready.manifest, [{ id: ready.manifest.requestIds[0], status: 'TIMEOUT', raw_output: null, latency_ms: 30 }]);
    const imported = importResponses(ready.manifest, response.responseManifest, response.jsonl);
    const input = { manifest: ready.manifest, observations: ready.localObservations, contract: loadContract(scoutContractPath), imported };
    expect(reportBatch(input)).toMatchObject({ status: 'PARTIAL', counts: { returned: 1, missing: 1, timedOut: 1, valid: 0, candidates: 0 } });
    expect(reportBatch({ ...input, imported: { ...imported, status: 'STOP' } })).toMatchObject({ status: 'STOP', counts: { comparisons: 0, candidates: 0 } });
    expect(reportBatch({ ...input, contract: { ...input.contract, policyVersion: 'drift' } })).toMatchObject({ status: 'STOP', counts: { comparisons: 0 } });
    const invalid = bundle(ready.manifest, [{ id: ready.manifest.requestIds[0], status: 'OK', raw_output: 'maybe', latency_ms: 1 }]);
    expect(reportBatch({ ...input, imported: importResponses(ready.manifest, invalid.responseManifest, invalid.jsonl) }).counts.invalid).toBe(1);
  });
  it.each(['ERROR', 'TIMEOUT', 'INPUT_LIMIT', 'INVALID'] as const)('reports all returned %s rows as PARTIAL', (status) => {
    const ready = prepared();
    const response = bundle(ready.manifest, ready.manifest.requestIds.map((id) => ({ id, status, raw_output: null, latency_ms: 1 })));
    const imported = importResponses(ready.manifest, response.responseManifest, response.jsonl);
    expect(imported.status).toBe('PARTIAL');
    expect(imported.missingIds).toEqual([]);
    expect(reportBatch({ manifest: ready.manifest, observations: ready.localObservations, contract: loadContract(scoutContractPath), imported })).toMatchObject({ status: 'PARTIAL', counts: { valid: 0, comparisons: 0, candidates: 0 } });
  });
  it.each(['policyHash', 'projectionHash', 'promptHash', 'sourceHead'])('report STOP on local manifest %s drift even without runtime', (key) => {
    const ready = prepared();
    expect(reportBatch({ manifest: { ...ready.manifest, [key]: 'a'.repeat(key === 'sourceHead' ? 40 : 64) },
      observations: ready.localObservations, contract: loadContract(scoutContractPath), imported: null })).toMatchObject({ status: 'STOP', counts: { comparisons: 0, candidates: 0 } });
  });
  it('exports through existing hooks, byte-copies authority, preserves reports/errors, then imports without execution', async () => {
    await withExport(async (dir, run) => {
      expect(readFileSync(resolve(run, 'contract.json'))).toEqual(readFileSync(scoutContractPath));
      expect(JSON.parse(readFileSync(resolve(run, 'harness-reports.json'), 'utf8'))).toEqual({ original: { unit: 'original-deterministic-report' }, expanded: { unit: 'expanded-deterministic-report' } });
      expect(readFileSync(resolve(run, 'observer-errors.json'), 'utf8')).toContain('UNIT_OBSERVER_ERROR');
      const original = vi.spyOn(await import('./massRegressionHarness'), 'runMassRegressionBaseline');
      const expanded = vi.spyOn(await import('./expandedRegressionHarness'), 'runExpandedRegression');
      original.mockClear(); expanded.mockClear();
      expect(await main(await responsesAt(dir, run))).toBe(0);
      expect(original).not.toHaveBeenCalled(); expect(expanded).not.toHaveBeenCalled();
      expect(JSON.parse(readFileSync(resolve(run, 'results/report.json'), 'utf8')).counts.candidates).toBe(1);
      expect(existsSync(resolve(run, 'results/occurrences.json'))).toBe(true);
      expect(existsSync(resolve(run, 'results/candidates.json'))).toBe(true);
      const saved = readFileSync(resolve(run, 'manifest.json'));
      expect(await main(['export', '--contract', scoutContractPath, '--out', run])).toBe(2);
      expect(await main(await responsesAt(dir, run))).toBe(2);
      expect(readFileSync(resolve(run, 'manifest.json'))).toEqual(saved);
    });
  });
  it('missing runtime bundle is SKIP and leaves deterministic reports byte-identical', async () => {
    await withExport(async (dir, run) => {
      const saved = readFileSync(resolve(run, 'harness-reports.json'));
      expect(await main(['import', '--run', run, '--responses', resolve(dir, 'absent'), '--response-manifest', resolve(dir, 'absent-manifest')])).toBe(0);
      expect(JSON.parse(readFileSync(resolve(run, 'results/report.json'), 'utf8')).status).toBe('SKIP');
      expect(readFileSync(resolve(run, 'harness-reports.json'))).toEqual(saved);
    });
  });
  it.each(['direct', 'sibling'])('validates explicit %s runtime SKIP marker and preserves reason/provenance without rows', async (mode) => {
    await withExport(async (dir, run) => {
      const manifest = JSON.parse(readFileSync(resolve(run, 'manifest.json'), 'utf8'));
      const marker = runtimeSkip(manifest);
      const markerPath = resolve(dir, 'runtime-status.json');
      writeFileSync(markerPath, JSON.stringify(marker));
      const deterministic = readFileSync(resolve(run, 'harness-reports.json'));
      expect(await main(['import', '--run', run, '--responses', resolve(dir, 'absent-responses.jsonl'),
        '--response-manifest', mode === 'direct' ? markerPath : resolve(dir, 'absent-response-manifest.json')])).toBe(0);
      const report = JSON.parse(readFileSync(resolve(run, 'results/report.json'), 'utf8'));
      expect(report).toMatchObject({ status: 'SKIP', runtimeStatus: marker, reasons: expect.arrayContaining(['CUDA_UNAVAILABLE']),
        counts: { returned: 0, valid: 0, comparisons: 0, candidates: 0 } });
      expect(JSON.parse(readFileSync(resolve(run, 'results/occurrences.json'), 'utf8'))).toEqual([]);
      expect(JSON.parse(readFileSync(resolve(run, 'results/candidates.json'), 'utf8'))).toEqual([]);
      expect(readFileSync(resolve(run, 'harness-reports.json'))).toEqual(deterministic);
    });
  });
  it.each(['runId', 'inputSha256', 'contractSha256', 'promptHash', 'settingsHash', 'model', 'runtimeReferenceHash', 'runner', 'status', 'extra'])('STOP on tampered runtime SKIP %s provenance', async (key) => {
    await withExport(async (dir, run) => {
      const manifest = JSON.parse(readFileSync(resolve(run, 'manifest.json'), 'utf8'));
      const marker = runtimeSkip(manifest) as unknown as Record<string, unknown>;
      if (key === 'model') marker.model = { ...manifest.model, revision: 'a'.repeat(40) };
      else if (key === 'runtimeReferenceHash' || key === 'runner') marker.runtimeIdentity = {
        ...(marker.runtimeIdentity as Record<string, unknown>), [key]: key === 'runner' ? 'different-runner' : 'a'.repeat(64) };
      else marker[key] = key === 'runId' ? 'foreign-run' : key === 'status' ? 'COMPLETE' : 'a'.repeat(64);
      const markerPath = resolve(dir, 'runtime-status.json'); writeFileSync(markerPath, JSON.stringify(marker));
      expect(await main(['import', '--run', run, '--responses', resolve(dir, 'absent'), '--response-manifest', markerPath])).toBe(2);
      expect(existsSync(resolve(run, 'results/candidates.json'))).toBe(false);
    });
  });
  it('STOP on ambiguous runtime SKIP plus responses rather than silently ignoring either', async () => {
    await withExport(async (dir, run) => {
      const argv = await responsesAt(dir, run);
      const manifest = JSON.parse(readFileSync(resolve(run, 'manifest.json'), 'utf8'));
      writeFileSync(resolve(dir, 'runtime-status.json'), JSON.stringify(runtimeSkip(manifest)));
      expect(await main(argv)).toBe(2);
      expect(existsSync(resolve(run, 'results/candidates.json'))).toBe(false);
    });
  });
  it.each(['requests.jsonl', 'local-observations.json', 'manifest.json', 'contract.json', 'harness-reports.json'])('STOP on changed saved %s before comparison', async (artifact) => {
    await withExport(async (dir, run) => {
      const argv = await responsesAt(dir, run);
      writeFileSync(resolve(run, artifact), readFileSync(resolve(run, artifact)).toString('utf8') + ' ');
      expect(await main(argv)).toBe(2);
      expect(existsSync(resolve(run, 'results/candidates.json'))).toBe(false);
    });
  });
  it('STOP on validly rehashed local turn/cutoff drift and malformed UTF-8 response bytes', async () => {
    await withExport(async (dir, run) => {
      const argv = await responsesAt(dir, run);
      const observationsPath = resolve(run, 'local-observations.json');
      const values = JSON.parse(readFileSync(observationsPath, 'utf8'));
      values[0].turns[0].speaker = 'agent'; values[0].identity.turnCutoff = 2;
      writeFileSync(observationsPath, JSON.stringify(values));
      const freezePath = resolve(run, 'freeze.json'); const frozen = JSON.parse(readFileSync(freezePath, 'utf8'));
      frozen.artifactHashes['local-observations.json'] = createHash('sha256').update(readFileSync(observationsPath)).digest('hex');
      writeFileSync(freezePath, JSON.stringify(frozen));
      expect(await main(argv)).toBe(2);
      expect(existsSync(resolve(run, 'results/candidates.json'))).toBe(false);
    });
    await withExport(async (dir, run) => {
      expect(await main(await responsesAt(dir, run, Buffer.from([0xc3, 0x28, 0x0a])))).toBe(2);
      expect(existsSync(resolve(run, 'results/candidates.json'))).toBe(false);
    });
  });
  it.each(['head', 'requests', 'source-bytes'])('independently rejects rehashed %s evidence without comparison', async (change) => {
    await withExport(async (dir, run) => {
      const argv = await responsesAt(dir, run);
      const manifestPath = resolve(run, 'manifest.json');
      const freezePath = resolve(run, 'freeze.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const frozen = JSON.parse(readFileSync(freezePath, 'utf8'));
      const source = resolve('.agents/skills/ai-copilot-semantic-scout/scripts/scout.ts');
      const originalBytes = readFileSync(source);
      try {
        if (change === 'head') manifest.sourceHead = 'a'.repeat(40);
        if (change === 'requests') {
          const requestPath = resolve(run, 'requests.jsonl');
          const rows = readFileSync(requestPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
          rows.reverse();
          writeFileSync(requestPath, rows.map((row) => JSON.stringify(row) + '\n').join(''));
          manifest.inputSha256 = createHash('sha256').update(readFileSync(requestPath)).digest('hex');
          frozen.artifactHashes['requests.jsonl'] = manifest.inputSha256;
        }
        if (change === 'source-bytes') writeFileSync(source, Buffer.concat([originalBytes, Buffer.from('\n// unit source-byte drift\n')]));
        writeFileSync(manifestPath, JSON.stringify(manifest));
        frozen.artifactHashes['manifest.json'] = createHash('sha256').update(readFileSync(manifestPath)).digest('hex');
        writeFileSync(freezePath, JSON.stringify(frozen));
        expect(await main(argv)).toBe(2);
        expect(existsSync(resolve(run, 'results/candidates.json'))).toBe(false);
      } finally { if (change === 'source-bytes') writeFileSync(source, originalBytes); }
    });
  });
  it('rejects unsupported modes and incomplete arguments without creating artifacts or executing hooks', async () => {
    expect(await main([])).toBe(2); expect(await main(['auto'])).toBe(2);
    expect(await main(['export', '--contract', scoutContractPath])).toBe(2);
    expect(await main(['import', '--run', tmpdir()])).toBe(2);
    expect(readdirSync(tmpdir()).some((name) => name === 'scout-unexpected-runtime')).toBe(false);
  });
});
