import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, basename, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { RegressionIdentity, RegressionObservation } from '../../../../src/services/test-support/regressionObservation';

export type Label = 'YES' | 'NO' | 'UNKNOWN';
export type Mode = 'ACTIVE_SHADOW' | 'OBSERVE_ONLY' | 'DISABLED';
export type Domain = 'negation' | 'mortgage_intent' | 'budget_ownership' | 'ownership' | 'corrections' | 'down_payment_future' | 'down_payment_availability';
export type Dimensions = Record<string, string | boolean | number | null>;
export interface CaseBinding {
  identity: RegressionIdentity;
  sourceGroupId: string;
  sourceReferences: string[];
  questionId: string;
  domain: Domain;
  policySlices: string[];
  projectionId: string;
  projectionVersion: string;
  privacyApproved: boolean;
  scopeApproved: boolean;
  dimensions: Dimensions;
  requiredDimensions: string[];
  sourceHashes: Record<string, string>;
  turnsSha256: string;
}
export interface ScoutContract {
  schemaVersion: 1;
  semanticSourceHash: string;
  semanticPayload: Record<string, unknown>;
  model: { id: string; revision: string };
  systemPrompt: string;
  settings: Record<string, string | boolean | number>;
  promptHash: string;
  settingsHash: string;
  runtimeReferenceHash: string;
  sourceArtifactHashes: Record<string, string>;
  policy: Record<string, Mode>;
  questionPolicy: Record<string, Mode>;
  slicePolicy: Record<string, Mode>;
  policyVersion: string;
  questionRegistry: Record<string, string>;
  bindings: CaseBinding[];
  projections: Record<string, { version: string; questionId: string; requiredDimensions: string[] }>;
  fingerprintVersion: string;
}
export type CoreProjection =
  | { status: 'COMPARABLE'; value: Label; projectionId: string; dimensions: Dimensions }
  | { status: 'NOT_COMPARABLE'; reason: string };
export interface ScoutRequest {
  id: string;
  turns: Array<{ speaker: 'agent' | 'client'; text: string }>;
  question: string;
}
export interface ScoutResponse {
  id: string;
  status: 'OK' | 'INVALID' | 'TIMEOUT' | 'ERROR' | 'INPUT_LIMIT';
  raw_output: string | null;
  latency_ms: number | null;
  claimed_prediction?: Label | 'INVALID';
}
export type CheckedResponse = ScoutResponse & { prediction: Label | 'INVALID' | null };
export interface BatchManifest {
  schemaVersion: 1;
  runId: string;
  sourceHead: string;
  sourceHashes: Record<string, string>;
  inputSha256: string;
  requestIds: string[];
  contractSha256: string;
  model: { id: string; revision: string };
  promptHash: string;
  settingsHash: string;
  policyVersion: string;
  policyHash: string;
  projectionHash: string;
  questionRegistryHash: string;
  fingerprintVersion: string;
  fingerprintHash: string;
  runnerIdentity: string;
  selection: { observed: number; selected: number; rejected: number };
}
export interface ResponseManifest {
  schemaVersion: 1;
  runId: string;
  inputSha256: string;
  contractSha256: string;
  model: { id: string; revision: string };
  promptHash: string;
  settingsHash: string;
  responsesSha256: string;
  runtimeIdentity: { runner: string; runtimeReferenceHash: string; versions: Record<string, string> };
}
// An unavailable runtime has no response rows or observed library versions.
export interface RuntimeStatus {
  schemaVersion: 1;
  status: 'SKIP';
  reason: string;
  runId: string;
  inputSha256: string;
  contractSha256: string;
  model: { id: string; revision: string };
  promptHash: string;
  settingsHash: string;
  runtimeIdentity: { runner: string; runtimeReferenceHash: string };
}
export interface BatchImport {
  status: 'COMPLETE' | 'PARTIAL' | 'STOP';
  responses: CheckedResponse[];
  missingIds: string[];
  errors: string[];
}
export interface ComparisonPair {
  id: string;
  runId: string;
  binding: CaseBinding;
  core: CoreProjection;
  response: CheckedResponse;
}
export interface Disagreement {
  pair: ComparisonPair;
  fingerprint: { payload: Record<string, unknown>; sha256: string };
}
export interface Candidate {
  run_id: string;
  fingerprint: string;
  payload: Record<string, unknown>;
  occurrence_count: number;
  representative_ids: string[];
  occurrence_ids: string[];
  source_references: Array<{ observation_id: string; source_group_id: string; reference: string }>;
}

export interface PairComparison {
  agreements: ComparisonPair[];
  observeOnlyDisagreements: ComparisonPair[];
  eligibleDisagreements: Disagreement[];
  rejected: Array<{ id: string; reason: string }>;
}

// Byte hash belongs to this composed authority, not to its historical source.
const CONTRACT_SHA256 = 'ae526586ed84ae203e2542d84168147efc98685b42fd9962630f122165db9a90';
const AUTHORITY_SIGNATURE = '413ebeffbfccc21042728950be879c8ba630ef1c7439b4e76ecfaf69fb49f746';
const RUNTIME_CONTRACT_SHA256 = '3f9759e88fa98ff21c40240d8447bfdfb0b0c4efd38e6c6f0257336e743f069b';
const sourceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function readAuthority(path: string | URL): ScoutContract {
  const bytes = readFileSync(path);
  if (sha256(bytes) !== CONTRACT_SHA256) throw new Error('SCOUT_CONTRACT_DRIFT');
  return freeze(JSON.parse(bytes.toString('utf8')) as ScoutContract);
}

function hasAuthority(contract: ScoutContract): boolean {
  try { return sha256(canonical(contract)) === AUTHORITY_SIGNATURE; } catch { return false; }
}

type SourceReader = (path: string) => Buffer;
const readSource: SourceReader = (path) => readFileSync(sourcePath(path));
function sourcesMatch(binding: CaseBinding, reader: SourceReader = readSource): boolean {
  try {
    return Object.entries(binding.sourceHashes).every(([path, hash]) => {
      const bytes = reader(path);
      // Frozen binding pins are CRLF. Accept only verified uniform LF/CRLF
      // representations of those exact bytes; per-run source capture stays raw.
      const lf = bytes.toString('utf8').replace(/\r\n/gu, '\n');
      if (lf.includes('\r')) return false;
      const crlf = Buffer.from(lf.replace(/\n/gu, '\r\n'), 'utf8');
      if (!bytes.equals(Buffer.from(lf, 'utf8')) && !bytes.equals(crlf)) return false;
      return sha256(crlf) === hash;
    });
  } catch { return false; }
}

export function loadContract(path: string, reader: SourceReader = readSource): ScoutContract {
  const contract = readAuthority(path);
  if (!contract.bindings.every((binding) => sourcesMatch(binding, reader))) throw new Error('SCOUT_SOURCE_DRIFT');
  return contract;
}

export function effectivePolicy(binding: CaseBinding, contract: ScoutContract): Mode {
  if (!hasAuthority(contract) || binding.privacyApproved !== true || binding.scopeApproved !== true) return 'DISABLED';
  const modes = [contract.policy[binding.domain], contract.questionPolicy[binding.questionId],
    ...binding.policySlices.map((slice) => contract.slicePolicy[slice])];
  if (modes.some((mode) => !['ACTIVE_SHADOW', 'OBSERVE_ONLY'].includes(mode))) return 'DISABLED';
  if (modes.includes('OBSERVE_ONLY') || binding.dimensions.correctionScope !== 'none') return 'OBSERVE_ONLY';
  return 'ACTIVE_SHADOW';
}

export function projectCore(observation: RegressionObservation, binding: CaseBinding, contract: ScoutContract): CoreProjection {
  const reject = (reason: string): CoreProjection => ({ status: 'NOT_COMPARABLE', reason });
  if (!hasAuthority(contract)) return reject('CONTRACT_DRIFT');
  if (effectivePolicy(binding, contract) === 'DISABLED') return reject('POLICY_DISABLED');
  const approved = contract.bindings.find((candidate) => canonical(candidate.identity) === canonical(binding.identity));
  if (!approved || canonical(approved) !== canonical(binding)) return reject('UNREVIEWED_BINDING');
  if (canonical(observation.identity) !== canonical(binding.identity)) return reject('IDENTITY_MISMATCH');
  if (!sourcesMatch(binding)) return reject('SOURCE_DRIFT');
  const projection = contract.projections[binding.projectionId];
  if (!projection || projection.version !== binding.projectionVersion
    || projection.questionId !== binding.questionId) return reject('UNSUPPORTED_PROJECTION');
  if (canonical(binding.requiredDimensions) !== canonical(projection.requiredDimensions)
    || binding.requiredDimensions.some((key) => binding.dimensions[key] === undefined)) return reject('UNREVIEWED_SCOPE');
  if (observation.turns.length !== observation.identity.turnCutoff) return reject('CUTOFF_MISMATCH');
  // The exact ordered speaker/text prefix excludes Core results and turn ids.
  const prefix = observation.turns.map(({ speaker, text }) => ({ speaker, text }));
  if (sha256(canonical(prefix)) !== binding.turnsSha256) return reject('PREFIX_MISMATCH');
  let value: Label;
  if (binding.projectionId === 'mortgage-rejected-branch' && binding.questionId === 'mortgage_permission') {
    if (!observation.core.rejectedBranches.includes('ипотеку')) return reject('NO_EXPLICIT_REJECTED_BRANCH');
    value = 'NO';
  } else {
    // Existing canonical values only; no text classifier or missing-fact label.
    const supported: Record<string, { questionId: string; category: string; canonicalValue: string; answer: Label }> = {
      'mortgage-payment-method': { questionId: 'mortgage_use', category: 'paymentMethod', canonicalValue: 'Ипотека', answer: 'YES' },
      'client-children-explicit-absence': { questionId: 'children', category: 'familyMortgage', canonicalValue: 'Детей нет (семейная ипотека не применима)', answer: 'NO' },
      'client-budget20-explicit': { questionId: 'client20', category: 'budget', canonicalValue: '20 млн руб', answer: 'YES' },
      'dp-future-expectation': { questionId: 'dp_future_funds_available', category: 'downPayment', canonicalValue: 'Средства на первоначальный взнос будут доступны позже; сейчас готовность не подтверждена', answer: 'YES' },
    };
    const rule = supported[binding.projectionId];
    if (!rule || rule.questionId !== binding.questionId) return reject('UNSUPPORTED_PROJECTION');
    const facts = observation.core.facts?.filter(fact => fact.category === rule.category) ?? [];
    if (facts.length !== 1 || facts[0].value !== rule.canonicalValue
      || !observation.turns.some(turn => turn.id === facts[0].turnId && turn.speaker === 'client')) return reject('NO_EXPLICIT_CANONICAL_FACT');
    value = rule.answer;
  }
  return { status: 'COMPARABLE', value, projectionId: binding.projectionId, dimensions: { ...binding.dimensions } };
}

function observationId(identity: RegressionIdentity): string {
  return `${identity.harness}:${identity.caseId}:${identity.variation}:${identity.instance}:${identity.turnCutoff}`;
}
function wireId(identity: RegressionIdentity): string {
  // Readable fixture annotations stay in private identities/occurrences, never in exported ids.
  return sha256(canonical(identity));
}

export function selectObservations(observations: readonly RegressionObservation[], contract: ScoutContract): {
  eligible: Array<{ observation: RegressionObservation; binding: CaseBinding; mode: Mode; core: CoreProjection }>;
  rejected: Array<{ id: string; reason: string }>;
} {
  const eligible: Array<{ observation: RegressionObservation; binding: CaseBinding; mode: Mode; core: CoreProjection }> = [];
  const rejected: Array<{ id: string; reason: string }> = [];
  for (const observation of observations) {
    const id = observationId(observation.identity);
    if (!hasAuthority(contract)) { rejected.push({ id, reason: 'CONTRACT_DRIFT' }); continue; }
    const binding = contract.bindings.find((candidate) => canonical(candidate.identity) === canonical(observation.identity));
    if (!binding) { rejected.push({ id, reason: 'UNREVIEWED_BINDING' }); continue; }
    const mode = effectivePolicy(binding, contract);
    if (mode === 'DISABLED') { rejected.push({ id, reason: 'POLICY_DISABLED' }); continue; }
    const core = projectCore(observation, binding, contract);
    if (core.status === 'NOT_COMPARABLE') { rejected.push({ id, reason: core.reason }); continue; }
    eligible.push({ observation, binding, mode, core });
  }
  return { eligible, rejected };
}

function validUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function codePointOrder(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = a[index].codePointAt(0)! - b[index].codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

function canonicalFingerprint(value: unknown): string {
  if (typeof value === 'string') {
    if (!validUnicode(value)) throw new Error('SCOUT_FINGERPRINT_UNICODE');
    return JSON.stringify(value);
  }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('SCOUT_FINGERPRINT_INTEGER');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (!denseArray(value)) throw new Error('SCOUT_FINGERPRINT_ARRAY');
    return `[${value.map(canonicalFingerprint).join(',')}]`;
  }
  if (record(value)) {
    return `{${Object.keys(value).sort(codePointOrder).map((key) =>
      `${canonicalFingerprint(key)}:${canonicalFingerprint(value[key])}`).join(',')}}`;
  }
  throw new Error('SCOUT_FINGERPRINT_VALUE');
}

function reviewedBinding(binding: CaseBinding, contract: ScoutContract): boolean {
  const approved = contract.bindings.find((candidate) => canonical(candidate.identity) === canonical(binding.identity));
  return approved !== undefined && canonical(approved) === canonical(binding);
}

function comparableReason(value: ComparisonPair, contract: ScoutContract): string | null {
  if (!hasAuthority(contract)) return 'CONTRACT_DRIFT';
  if (!nonempty(value.id) || !nonempty(value.runId) || value.response.id !== value.id) return 'PAIR_ID_MISMATCH';
  if (value.core.status !== 'COMPARABLE') return 'NOT_COMPARABLE';
  const projection = contract.projections[value.binding.projectionId];
  if (!projection || value.core.projectionId !== value.binding.projectionId
    || projection.version !== value.binding.projectionVersion || projection.questionId !== value.binding.questionId
    || canonical(projection.requiredDimensions) !== canonical(value.binding.requiredDimensions)
    || !Object.hasOwn(contract.questionRegistry, value.binding.questionId)) return 'UNREVIEWED_PROJECTION';
  if (!['YES', 'NO', 'UNKNOWN'].includes(value.core.value)) return 'INVALID_CORE_LABEL';
  if (value.response.status !== 'OK' || typeof value.response.raw_output !== 'string'
    || !['YES', 'NO', 'UNKNOWN'].includes(value.response.prediction as string)
    || normalizeOutput(value.response.raw_output) !== value.response.prediction) return 'INVALID_SCOUT_RESPONSE';
  return null;
}

const reviewedDimensionValues: Readonly<Record<string, readonly string[]>> = {
  owner: ['client', 'relative'],
  time: ['current', 'future'],
  predicate: ['mortgage_permission', 'mortgage_use', 'children', 'client20', 'dp_future_funds_available'],
  correctionScope: ['none', 'explicit', 'revocation'],
};

function safeDimension(key: string, value: unknown, binding: CaseBinding): value is string | boolean | number | null {
  if (typeof value === 'number') return typeof binding.dimensions[key] === 'number'
    && Number.isSafeInteger(value) && Number.isSafeInteger(binding.dimensions[key]);
  if (typeof value === 'string') return reviewedDimensionValues[key]?.includes(value) === true;
  return value === binding.dimensions[key] && (value === null || typeof value === 'boolean');
}

export function fingerprintDisagreement(value: ComparisonPair, contract: ScoutContract): { payload: Record<string, unknown>; sha256: string } {
  const reason = comparableReason(value, contract);
  if (reason) throw new Error(`SCOUT_FINGERPRINT_${reason}`);
  if (effectivePolicy(value.binding, contract) !== 'ACTIVE_SHADOW' || !reviewedBinding(value.binding, contract)) {
    throw new Error('SCOUT_FINGERPRINT_UNREVIEWED_ACTIVE_BINDING');
  }
  if (value.core.status !== 'COMPARABLE' || value.core.value === value.response.prediction) {
    throw new Error('SCOUT_FINGERPRINT_NOT_MISMATCH');
  }
  const required = contract.projections[value.binding.projectionId].requiredDimensions;
  if (!record(value.core.dimensions)) throw new Error('SCOUT_FINGERPRINT_DIMENSIONS');
  const dimensions: Record<string, string | boolean | number | null> = {};
  const missing: string[] = [];
  for (const key of required) {
    if (!Object.hasOwn(value.core.dimensions, key)) { missing.push(key); continue; }
    const dimension = value.core.dimensions[key];
    if (!safeDimension(key, dimension, value.binding)) throw new Error('SCOUT_FINGERPRINT_UNSAFE_DIMENSION');
    dimensions[key] = dimension;
  }
  const payload: Record<string, unknown> = {
    fingerprintVersion: contract.fingerprintVersion,
    semanticContract: { schemaVersion: contract.schemaVersion, sourceSha256: contract.semanticSourceHash },
    question: { id: value.binding.questionId, wording: contract.questionRegistry[value.binding.questionId] },
    domain: value.binding.domain,
    policyVersion: contract.policyVersion,
    projection: { id: value.binding.projectionId, version: value.binding.projectionVersion },
    coreAnswer: value.core.value,
    scoutAnswer: value.response.prediction,
    dimensions,
  };
  if (missing.length > 0) {
    payload.missingDimensions = missing;
    if (!validUnicode(value.id)) throw new Error('SCOUT_FINGERPRINT_UNICODE');
    payload.missingObservationDiscriminator = sha256(value.id);
  }
  return { payload, sha256: sha256(Buffer.from(canonicalFingerprint(payload), 'utf8')) };
}

export function comparePairs(pairs: readonly ComparisonPair[], contract: ScoutContract): PairComparison {
  const result: PairComparison = { agreements: [], observeOnlyDisagreements: [], eligibleDisagreements: [], rejected: [] };
  for (const pair of pairs) {
    const reason = comparableReason(pair, contract);
    if (reason) { result.rejected.push({ id: pair.id, reason }); continue; }
    const mode = effectivePolicy(pair.binding, contract);
    if (mode === 'DISABLED') { result.rejected.push({ id: pair.id, reason: 'POLICY_DISABLED' }); continue; }
    if (mode === 'ACTIVE_SHADOW' && !reviewedBinding(pair.binding, contract)) {
      result.rejected.push({ id: pair.id, reason: 'UNREVIEWED_BINDING' }); continue;
    }
    if (pair.core.status !== 'COMPARABLE') continue;
    if (pair.core.value === pair.response.prediction) { result.agreements.push(pair); continue; }
    if (mode === 'OBSERVE_ONLY') { result.observeOnlyDisagreements.push(pair); continue; }
    try { result.eligibleDisagreements.push({ pair, fingerprint: fingerprintDisagreement(pair, contract) }); }
    catch { result.rejected.push({ id: pair.id, reason: 'UNSAFE_FINGERPRINT' }); }
  }
  return result;
}

export function deduplicateDisagreements(runId: string, values: readonly Disagreement[]): Candidate[] {
  if (!nonempty(runId)) throw new Error('SCOUT_DEDUP_RUN_ID');
  const groups = new Map<string, { fingerprint: Disagreement['fingerprint']; pairs: Map<string, ComparisonPair[]> }>();
  for (const value of values) {
    if (value.pair.runId !== runId || !nonempty(value.pair.id)) throw new Error('SCOUT_DEDUP_RUN_MISMATCH');
    const serialized = canonicalFingerprint(value.fingerprint.payload);
    if (sha256(Buffer.from(serialized, 'utf8')) !== value.fingerprint.sha256) throw new Error('SCOUT_DEDUP_FINGERPRINT_MISMATCH');
    // Canonical tuple equality remains explicit even if two digest strings collide.
    const key = `${value.fingerprint.sha256}:${serialized}`;
    let group = groups.get(key);
    if (!group) {
      group = { fingerprint: value.fingerprint, pairs: new Map() };
      groups.set(key, group);
    }
    const observations = group.pairs.get(value.pair.id) ?? [];
    observations.push(value.pair);
    group.pairs.set(value.pair.id, observations);
  }
  return [...groups.values()].map(({ fingerprint, pairs }) => {
    const occurrence_ids = [...pairs.keys()].sort(codePointOrder);
    const references = new Map<string, Candidate['source_references'][number]>();
    for (const id of occurrence_ids) for (const pair of pairs.get(id)!) for (const reference of pair.binding.sourceReferences) {
      const item = { observation_id: id, source_group_id: pair.binding.sourceGroupId, reference };
      references.set(canonicalFingerprint(item), item);
    }
    return {
      run_id: runId, fingerprint: fingerprint.sha256, payload: fingerprint.payload,
      occurrence_count: occurrence_ids.length, representative_ids: occurrence_ids.slice(0, 3), occurrence_ids,
      source_references: [...references.values()].sort((left, right) => codePointOrder(canonicalFingerprint(left), canonicalFingerprint(right))),
    };
  }).sort((left, right) => codePointOrder(left.fingerprint, right.fingerprint));
}

export function normalizeOutput(raw: string): Label | 'INVALID' {
  const value = raw.trim();
  return value === 'YES' || value === 'NO' || value === 'UNKNOWN' ? value : 'INVALID';
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  return record(value) && required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const hashValue = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function denseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  // every/map skip holes and may read inherited slots; a protocol prefix needs own entries.
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) return false;
  return true;
}
function stringMap(value: unknown, values: (value: unknown) => boolean): value is Record<string, string> {
  return record(value) && Object.keys(value).length > 0 && Object.entries(value).every(([key, nested]) => nonempty(key) && values(nested));
}
function validModel(value: unknown): boolean {
  return fields(value, ['id', 'revision']) && nonempty(value.id)
    && typeof value.revision === 'string' && /^[a-f0-9]{40}$/u.test(value.revision);
}

function validManifest(value: unknown): value is BatchManifest {
  if (!fields(value, ['schemaVersion', 'runId', 'sourceHead', 'sourceHashes', 'inputSha256', 'requestIds',
    'contractSha256', 'model', 'promptHash', 'settingsHash', 'policyVersion', 'policyHash', 'projectionHash',
    'questionRegistryHash', 'fingerprintVersion', 'fingerprintHash', 'runnerIdentity', 'selection'])) return false;
  const selection = value.selection;
  return value.schemaVersion === 1 && nonempty(value.runId)
    && typeof value.sourceHead === 'string' && /^[a-f0-9]{40}$/u.test(value.sourceHead)
    && stringMap(value.sourceHashes, hashValue) && validModel(value.model)
    && ['inputSha256', 'contractSha256', 'promptHash', 'settingsHash', 'policyHash', 'projectionHash', 'questionRegistryHash', 'fingerprintHash'].every((key) => hashValue(value[key]))
    && ['policyVersion', 'fingerprintVersion', 'runnerIdentity'].every((key) => nonempty(value[key]))
    && denseArray(value.requestIds) && value.requestIds.every(nonempty) && new Set(value.requestIds).size === value.requestIds.length
    && fields(selection, ['observed', 'selected', 'rejected']) && count(selection.observed) && count(selection.selected) && count(selection.rejected)
    && selection.selected === value.requestIds.length && selection.observed === selection.selected + selection.rejected;
}

function validResponseManifest(value: unknown): value is ResponseManifest {
  if (!fields(value, ['schemaVersion', 'runId', 'inputSha256', 'contractSha256', 'model', 'promptHash',
    'settingsHash', 'responsesSha256', 'runtimeIdentity'])) return false;
  const runtime = value.runtimeIdentity;
  return value.schemaVersion === 1 && nonempty(value.runId) && validModel(value.model)
    && ['inputSha256', 'contractSha256', 'promptHash', 'settingsHash', 'responsesSha256'].every((key) => hashValue(value[key]))
    && fields(runtime, ['runner', 'runtimeReferenceHash', 'versions']) && nonempty(runtime.runner)
    && hashValue(runtime.runtimeReferenceHash) && stringMap(runtime.versions, nonempty);
}

function requestPayload(value: unknown, questions: readonly string[]): value is ScoutRequest {
  return fields(value, ['id', 'turns', 'question']) && nonempty(value.id)
    && nonempty(value.question) && questions.includes(value.question)
    && denseArray(value.turns) && value.turns.length > 0 && value.turns.every((turn) =>
      fields(turn, ['speaker', 'text']) && (turn.speaker === 'agent' || turn.speaker === 'client') && typeof turn.text === 'string');
}

export function encodeRequests(requests: readonly ScoutRequest[]): string {
  const authority = readAuthority(new URL('../references/semantic-scout-contract.json', import.meta.url));
  const questions = Object.entries(authority.questionRegistry).filter(([id]) =>
    ['ACTIVE_SHADOW', 'OBSERVE_ONLY'].includes(authority.questionPolicy[id])).map(([, wording]) => wording);
  const ids = new Set<string>();
  if (!denseArray(requests)) throw new Error('SCOUT_REQUEST_SCHEMA');
  return requests.map((request) => {
    if (!requestPayload(request, questions) || ids.has(request.id)) throw new Error('SCOUT_REQUEST_SCHEMA');
    ids.add(request.id);
    // Explicit construction excludes all comparator and private binding metadata.
    return JSON.stringify({ id: request.id, turns: request.turns.map(({ speaker, text }) => ({ speaker, text })), question: request.question }) + '\n';
  }).join('');
}

function checkedResponse(value: unknown): CheckedResponse | null {
  if (!fields(value, ['id', 'status', 'raw_output', 'latency_ms'], ['claimed_prediction']) || !nonempty(value.id)
    || !['OK', 'INVALID', 'TIMEOUT', 'ERROR', 'INPUT_LIMIT'].includes(value.status as string)
    || !(value.latency_ms === null || (typeof value.latency_ms === 'number' && Number.isFinite(value.latency_ms) && value.latency_ms >= 0))
    || !(value.raw_output === null || typeof value.raw_output === 'string')
    || (Object.hasOwn(value, 'claimed_prediction') && !['YES', 'NO', 'UNKNOWN', 'INVALID'].includes(value.claimed_prediction as string))) return null;
  let prediction: CheckedResponse['prediction'];
  if (value.status === 'OK') {
    if (typeof value.raw_output !== 'string') return null;
    prediction = normalizeOutput(value.raw_output);
  } else if (value.status === 'INVALID') {
    if (value.raw_output !== null && normalizeOutput(value.raw_output as string) !== 'INVALID') return null;
    prediction = 'INVALID';
  } else {
    if (value.raw_output !== null || Object.hasOwn(value, 'claimed_prediction')) return null;
    prediction = null;
  }
  if (Object.hasOwn(value, 'claimed_prediction') && value.claimed_prediction !== prediction) return null;
  return { ...(value as unknown as ScoutResponse), prediction };
}

export function importResponses(manifest: BatchManifest, responseManifest: ResponseManifest, responseJsonl: string): BatchImport {
  const stop = (error: string): BatchImport => ({ status: 'STOP', responses: [],
    missingIds: validManifest(manifest) ? [...manifest.requestIds] : [], errors: [error] });
  if (!validManifest(manifest)) return stop('BATCH_MANIFEST_SCHEMA');
  if (!validResponseManifest(responseManifest)) return stop('RESPONSE_MANIFEST_SCHEMA');
  // The interface accepts decoded UTF-8; hash the exact supplied JSONL bytes before parsing rows.
  if (typeof responseJsonl !== 'string' || sha256(responseJsonl) !== responseManifest.responsesSha256) return stop('RESPONSES_BYTE_HASH_MISMATCH');
  let authority: ScoutContract;
  try { authority = readAuthority(new URL('../references/semantic-scout-contract.json', import.meta.url)); }
  catch { return stop('CONTRACT_DRIFT'); }
  for (const key of ['runId', 'inputSha256', 'contractSha256', 'promptHash', 'settingsHash'] as const) {
    if (manifest[key] !== responseManifest[key]) return stop(`PROVENANCE_MISMATCH:${key}`);
  }
  if (canonical(manifest.model) !== canonical(responseManifest.model) || canonical(manifest.model) !== canonical(authority.model)) return stop('MODEL_PROVENANCE_MISMATCH');
  if (manifest.contractSha256 !== CONTRACT_SHA256 || manifest.promptHash !== authority.promptHash || manifest.settingsHash !== authority.settingsHash) return stop('FROZEN_AUTHORITY_MISMATCH');
  if (manifest.policyVersion !== authority.policyVersion || manifest.fingerprintVersion !== authority.fingerprintVersion
    || manifest.policyHash !== sha256(canonical({ policy: authority.policy, questionPolicy: authority.questionPolicy, slicePolicy: authority.slicePolicy }))
    || manifest.projectionHash !== sha256(canonical(authority.projections))
    || manifest.questionRegistryHash !== sha256(canonical(authority.questionRegistry))
    || manifest.fingerprintHash !== sha256(canonical({ version: authority.fingerprintVersion }))) return stop('FROZEN_METADATA_MISMATCH');
  if (responseManifest.runtimeIdentity.runner !== manifest.runnerIdentity
    || responseManifest.runtimeIdentity.runtimeReferenceHash !== authority.runtimeReferenceHash) return stop('RUNTIME_PROVENANCE_MISMATCH');
  if (responseJsonl !== '' && (!responseJsonl.endsWith('\n') || responseJsonl.includes('\r') || responseJsonl.startsWith('\ufeff'))) return stop('MALFORMED_JSONL_ENCODING');
  const submitted = new Set(manifest.requestIds);
  const seen = new Set<string>();
  const accepted = new Map<string, CheckedResponse>();
  const errors: string[] = [];
  let malformed = false;
  const lines = responseJsonl === '' ? [] : responseJsonl.slice(0, -1).split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    let row: unknown;
    try { row = JSON.parse(lines[index]); }
    catch { errors.push(`MALFORMED_JSONL:${index + 1}`); malformed = true; continue; }
    const checked = checkedResponse(row);
    if (!checked) { errors.push(`RESPONSE_SCHEMA:${index + 1}`); malformed = true; continue; }
    if (!submitted.has(checked.id)) { errors.push(`UNEXPECTED_RESPONSE:${checked.id}`); malformed = true; continue; }
    if (seen.has(checked.id)) { errors.push(`DUPLICATE_RESPONSE:${checked.id}`); malformed = true; continue; }
    seen.add(checked.id);
    accepted.set(checked.id, checked);
    if (checked.prediction === 'INVALID') errors.push(`INVALID:${checked.id}`);
    else if (checked.status !== 'OK') errors.push(`${checked.status}:${checked.id}`);
  }
  const missingIds = manifest.requestIds.filter((id) => !accepted.has(id));
  errors.push(...missingIds.map((id) => `MISSING_RESPONSE:${id}`));
  return { status: malformed ? 'STOP' : errors.length ? 'PARTIAL' : 'COMPLETE',
    responses: manifest.requestIds.flatMap((id) => accepted.has(id) ? [accepted.get(id)!] : []), missingIds, errors };
}

export interface ScoutReport {
  status: 'COMPLETE' | 'PARTIAL' | 'SKIP' | 'STOP';
  reasons: string[];
  provenance: { runId: string; sourceHead: string; contractSha256: string; inputSha256: string };
  counts: Record<string, number>;
  labels: { core: Record<Label, number>; scout: Record<Label, number> };
  domains: Record<string, Record<string, number>>;
  candidates: Candidate[];
  occurrences: Array<{ observation_id: string; local_observation_id: string; source_group_id: string; fingerprint: string; source_references: string[] }>;
  runtimeStatus?: RuntimeStatus;
  evidence?: { freezeFile: string; freezeSha256: string; artifactHashes: Record<string, string> };
}
export function prepareBatch(input: { runId: string; sourceHead: string; observations: readonly RegressionObservation[]; contract: ScoutContract }): {
  manifest: BatchManifest; requestsJsonl: string; localObservations: RegressionObservation[]; selection: ScoutReport;
} {
  if (!nonempty(input.runId) || !/^[a-f0-9]{40}$/u.test(input.sourceHead)) throw new Error('SCOUT_RUN_IDENTITY');
  const { contract } = input;
  const selected = selectObservations(input.observations, contract);
  const ids = selected.eligible.map(({ observation }) => wireId(observation.identity));
  if (new Set(ids).size !== ids.length) throw new Error('SCOUT_DUPLICATE_OBSERVATION');
  // Privacy/policy/comparability gates precede copying or encoding any case.
  const localObservations = selected.eligible.map(({ observation }) => freeze(structuredClone(observation)));
  const requestsJsonl = encodeRequests(selected.eligible.map(({ observation, binding }) => requestFor(observation, binding, contract)));
  const manifest: BatchManifest = freeze({
    schemaVersion: 1, runId: input.runId, sourceHead: input.sourceHead, sourceHashes: captureSourceHashes(contract),
    inputSha256: sha256(requestsJsonl), requestIds: ids, contractSha256: CONTRACT_SHA256, model: { ...contract.model },
    promptHash: contract.promptHash, settingsHash: contract.settingsHash, policyVersion: contract.policyVersion,
    policyHash: sha256(canonical({ policy: contract.policy, questionPolicy: contract.questionPolicy, slicePolicy: contract.slicePolicy })),
    projectionHash: sha256(canonical(contract.projections)), questionRegistryHash: sha256(canonical(contract.questionRegistry)),
    fingerprintVersion: contract.fingerprintVersion, fingerprintHash: sha256(canonical({ version: contract.fingerprintVersion })),
    runnerIdentity: 'transformers-batch-v1', selection: { observed: input.observations.length, selected: ids.length, rejected: selected.rejected.length },
  });
  const selection = reportBatch({ manifest, observations: input.observations, contract, imported: null });
  if (!hasAuthority(contract)) { selection.status = 'STOP'; selection.reasons = ['CONTRACT_DRIFT']; }
  return { manifest, requestsJsonl, localObservations: freeze(localObservations), selection };
}

function requestFor(observation: RegressionObservation, binding: CaseBinding, contract: ScoutContract): ScoutRequest {
  return { id: wireId(observation.identity), question: contract.questionRegistry[binding.questionId],
    turns: observation.turns.map(({ speaker, text }) => {
      if (speaker !== 'agent' && speaker !== 'client') throw new Error('SCOUT_REQUEST_ROLE');
      return { speaker, text };
    }) };
}

function captureSourceHashes(contract: ScoutContract): Record<string, string> {
  const paths = new Set([
    ...contract.bindings.flatMap((binding) => Object.keys(binding.sourceHashes)),
    'src/services/test-support/massRegressionHarness.ts', 'src/services/test-support/expandedRegressionHarness.ts',
    'src/services/test-support/regressionObservation.ts', '.agents/skills/ai-copilot-semantic-scout/scripts/scout.ts',
  ]);
  // Preserve exact current source bytes, including uncommitted DEV code. Historical research docs HEAD is not runtime authority.
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json'], { cwd: sourceRoot, encoding: 'utf8' });
  for (const path of tracked.split('\0').filter(Boolean)) paths.add(path);
  return Object.fromEntries([...paths].sort().map((path) => [path, sha256(readFileSync(sourcePath(path)))]));
}
function sourcePath(path: string): string {
  const absolute = resolve(sourceRoot, path);
  const within = relative(sourceRoot, absolute);
  if (isAbsolute(path) || within.startsWith('..') || isAbsolute(within)) throw new Error('SCOUT_SOURCE_PATH');
  return absolute;
}

function emptyReport(manifest: BatchManifest): ScoutReport {
  return {
    status: 'SKIP', reasons: [], provenance: { runId: manifest.runId, sourceHead: manifest.sourceHead,
      contractSha256: manifest.contractSha256, inputSha256: manifest.inputSha256 },
    counts: Object.fromEntries(['observed', 'selected', 'rejected', 'disabled', 'notComparable', 'unclassifiedRejected', 'submitted', 'returned', 'missing', 'valid', 'invalid',
      'timedOut', 'failed', 'inputLimit', 'comparisons', 'agreements', 'observeOnlyDisagreements', 'eligibleDisagreements', 'candidates',
      'suppressedRepeats', 'provenCoreBugs', 'provenScoutFalseAlarms', 'unresolved', 'selectedSourceGroups', 'comparedSourceGroups',
      'disagreementSourceGroups'].map((key) => [key, 0])),
    labels: { core: { YES: 0, NO: 0, UNKNOWN: 0 }, scout: { YES: 0, NO: 0, UNKNOWN: 0 } }, domains: {}, candidates: [], occurrences: [],
  };
}
export function reportBatch(input: { manifest: BatchManifest; observations: readonly RegressionObservation[]; contract: ScoutContract; imported: BatchImport | null }): ScoutReport {
  const { manifest, contract, imported } = input;
  const result = emptyReport(manifest);
  const stop = (reason: string): ScoutReport => { result.status = 'STOP'; result.reasons.push(reason); return result; };
  if (!validManifest(manifest)) return stop('BATCH_MANIFEST_SCHEMA');
  Object.assign(result.counts, manifest.selection, { submitted: manifest.requestIds.length });
  if (!hasAuthority(contract) || manifest.contractSha256 !== CONTRACT_SHA256) return stop('CONTRACT_DRIFT');
  if (manifest.promptHash !== contract.promptHash || manifest.settingsHash !== contract.settingsHash
    || canonical(manifest.model) !== canonical(contract.model) || manifest.policyVersion !== contract.policyVersion
    || manifest.policyHash !== sha256(canonical({ policy: contract.policy, questionPolicy: contract.questionPolicy, slicePolicy: contract.slicePolicy }))
    || manifest.projectionHash !== sha256(canonical(contract.projections)) || manifest.questionRegistryHash !== sha256(canonical(contract.questionRegistry))
    || manifest.fingerprintVersion !== contract.fingerprintVersion
    || manifest.fingerprintHash !== sha256(canonical({ version: contract.fingerprintVersion }))) return stop('FROZEN_METADATA_DRIFT');
  try {
    if (manifest.sourceHead !== currentHead() || canonical(manifest.sourceHashes) !== canonical(captureSourceHashes(contract))) return stop('SOURCE_PROVENANCE_DRIFT');
  } catch { return stop('SOURCE_PROVENANCE_UNAVAILABLE'); }
  const selected = selectObservations(input.observations, contract);
  const requests = selected.eligible.map(({ observation, binding }) => requestFor(observation, binding, contract));
  const completeSelection = input.observations.length === manifest.selection.observed && selected.rejected.length === manifest.selection.rejected;
  const selectedOnly = input.observations.length === manifest.selection.selected && selected.rejected.length === 0;
  if ((!completeSelection && !selectedOnly) || canonical(requests.map(({ id }) => id)) !== canonical(manifest.requestIds)
    || sha256(encodeRequests(requests)) !== manifest.inputSha256) return stop('LOCAL_OBSERVATION_DRIFT');
  result.reasons.push(...selected.rejected.map(({ id, reason }) => `${reason}:${id}`));
  result.counts.disabled = selected.rejected.filter(({ reason }) => reason === 'POLICY_DISABLED').length;
  result.counts.notComparable = selected.rejected.filter(({ reason }) => reason !== 'POLICY_DISABLED').length;
  // A selected-only caller cannot classify rejections absent from its observations.
  result.counts.unclassifiedRejected = manifest.selection.rejected - selected.rejected.length;
  const groupCount = (items: readonly { binding: CaseBinding }[]) => new Set(items.map(({ binding }) => binding.sourceGroupId)).size;
  result.counts.selectedSourceGroups = groupCount(selected.eligible);
  const domainCounts = (name: Domain) => result.domains[name] ??= { ...emptyReport(manifest).counts,
    disagreements: 0, coreYES: 0, coreNO: 0, coreUNKNOWN: 0, scoutYES: 0, scoutNO: 0, scoutUNKNOWN: 0 };
  for (const { binding } of selected.eligible) {
    const domain = domainCounts(binding.domain);
    domain.observed += 1; domain.selected += 1; domain.submitted += 1;
  }
  for (const rejected of selected.rejected) {
    const binding = contract.bindings.find((item) => observationId(item.identity) === rejected.id);
    if (!binding) { result.counts.unclassifiedRejected += 1; continue; }
    const domain = domainCounts(binding.domain);
    domain.observed += 1; domain.rejected += 1;
    domain[rejected.reason === 'POLICY_DISABLED' ? 'disabled' : 'notComparable'] += 1;
  }
  for (const [name, domain] of Object.entries(result.domains)) domain.selectedSourceGroups = groupCount(selected.eligible.filter(({ binding }) => binding.domain === name));
  if (manifest.requestIds.length === 0) { result.reasons.push('NO_ELIGIBLE_INPUTS'); return result; }
  if (!imported) { result.reasons.push('RUNTIME_OR_RESPONSE_BUNDLE_UNAVAILABLE'); return result; }
  result.reasons.push(...imported.errors);
  result.counts.returned = imported.responses.length; result.counts.missing = imported.missingIds.length;
  const bindingById = new Map(selected.eligible.map(({ observation, binding }) => [wireId(observation.identity), binding]));
  for (const id of imported.missingIds) {
    const binding = bindingById.get(id); if (binding) domainCounts(binding.domain).missing += 1;
  }
  for (const response of imported.responses) {
    const binding = bindingById.get(response.id);
    const domain = binding ? domainCounts(binding.domain) : undefined;
    if (domain) domain.returned += 1;
    let counter: string;
    if (response.prediction === 'INVALID') counter = 'invalid';
    else if (response.status === 'OK' && response.prediction && normalizeOutput(response.raw_output ?? '') === response.prediction) {
      counter = 'valid'; result.labels.scout[response.prediction] += 1;
      if (domain) domain[`scout${response.prediction}`] += 1;
    } else if (response.status === 'TIMEOUT') counter = 'timedOut';
    else if (response.status === 'INPUT_LIMIT') counter = 'inputLimit';
    else counter = 'failed';
    result.counts[counter] += 1; if (domain) domain[counter] += 1;
  }
  if (imported.status === 'STOP') return stop('RESPONSE_IMPORT_STOP');
  const byId = new Map(imported.responses.map((response) => [response.id, response]));
  if (byId.size !== imported.responses.length || imported.responses.some(({ id }) => !manifest.requestIds.includes(id))) return stop('RESPONSE_ACCOUNTING_DRIFT');
  const pairs: ComparisonPair[] = selected.eligible.flatMap(({ observation, binding }) => {
    const id = wireId(observation.identity); const response = byId.get(id);
    return response ? [{ id, runId: manifest.runId, binding, core: projectCore(observation, binding, contract), response }] : [];
  });
  const comparisons = comparePairs(pairs, contract);
  const compared = [...comparisons.agreements, ...comparisons.observeOnlyDisagreements, ...comparisons.eligibleDisagreements.map(({ pair }) => pair)];
  result.status = imported.status === 'PARTIAL' || result.counts.valid !== manifest.requestIds.length ? 'PARTIAL' : 'COMPLETE';
  result.counts.comparisons = compared.length; result.counts.agreements = comparisons.agreements.length;
  result.counts.observeOnlyDisagreements = comparisons.observeOnlyDisagreements.length;
  result.counts.eligibleDisagreements = comparisons.eligibleDisagreements.length;
  result.counts.comparedSourceGroups = groupCount(compared);
  result.counts.disagreementSourceGroups = groupCount([...comparisons.observeOnlyDisagreements, ...comparisons.eligibleDisagreements.map(({ pair }) => pair)]);
  for (const pair of compared) {
    if (pair.core.status === 'COMPARABLE') { result.labels.core[pair.core.value] += 1; result.domains[pair.binding.domain][`core${pair.core.value}`] += 1; }
    const domain = result.domains[pair.binding.domain]; domain.comparisons += 1;
    if (pair.core.status === 'COMPARABLE' && pair.core.value === pair.response.prediction) domain.agreements += 1; else domain.disagreements += 1;
  }
  result.reasons.push(...comparisons.rejected.map(({ id, reason }) => `${reason}:${id}`));
  result.candidates = deduplicateDisagreements(manifest.runId, comparisons.eligibleDisagreements);
  const localIds = new Map(selected.eligible.map(({ observation }) => [wireId(observation.identity), observationId(observation.identity)]));
  result.occurrences = comparisons.eligibleDisagreements.map(({ pair, fingerprint }) => ({
    observation_id: pair.id, local_observation_id: localIds.get(pair.id)!, source_group_id: pair.binding.sourceGroupId,
    fingerprint: fingerprint.sha256, source_references: [...pair.binding.sourceReferences],
  }));
  result.counts.candidates = result.candidates.length;
  result.counts.suppressedRepeats = result.counts.eligibleDisagreements - result.counts.candidates;
  result.counts.unresolved = result.candidates.length;
  for (const [name, domain] of Object.entries(result.domains)) {
    domain.observeOnlyDisagreements = comparisons.observeOnlyDisagreements.filter(({ binding }) => binding.domain === name).length;
    domain.eligibleDisagreements = comparisons.eligibleDisagreements.filter(({ pair }) => pair.binding.domain === name).length;
    domain.comparedSourceGroups = groupCount(compared.filter(({ binding }) => binding.domain === name));
    domain.disagreementSourceGroups = groupCount([...comparisons.observeOnlyDisagreements, ...comparisons.eligibleDisagreements.map(({ pair }) => pair)].filter(({ binding }) => binding.domain === name));
    domain.candidates = result.candidates.filter(({ payload }) => payload.domain === name).length;
    domain.suppressedRepeats = domain.eligibleDisagreements - domain.candidates;
    domain.unresolved = domain.candidates;
  }
  // No gold-equivalence evidence or independent investigation proof is accepted by this interface.
  return result;
}

function runtimeBundle(manifest: BatchManifest, contract: ScoutContract): { contractBytes: string; manifest: Record<string, unknown> } {
  if (!hasAuthority(contract)) throw new Error('SCOUT_CONTRACT_DRIFT');
  const payload = { schemaVersion: 1, semanticSourceHash: contract.semanticSourceHash, model: contract.model,
    systemPrompt: contract.systemPrompt, settings: contract.settings, promptHash: contract.promptHash,
    settingsHash: contract.settingsHash, runtimeReferenceHash: contract.runtimeReferenceHash,
    questionRegistry: contract.questionRegistry, questionPolicy: contract.questionPolicy };
  // The frozen numeric lexeme is significant to the Python settings hash.
  const contractBytes = JSON.stringify(payload).replace('"repetition_penalty":1,', '"repetition_penalty":1.0,') + '\n';
  if (sha256(contractBytes) !== RUNTIME_CONTRACT_SHA256) throw new Error('SCOUT_RUNTIME_CONTRACT_DRIFT');
  return { contractBytes, manifest: { schemaVersion: 1, runId: manifest.runId, inputSha256: manifest.inputSha256,
    requestIds: manifest.requestIds, contractSha256: manifest.contractSha256, runtimeContractSha256: RUNTIME_CONTRACT_SHA256,
    model: manifest.model, promptHash: manifest.promptHash, settingsHash: manifest.settingsHash, runnerIdentity: manifest.runnerIdentity } };
}
const runFiles = ['contract.json', 'manifest.json', 'requests.jsonl', 'local-observations.json', 'selection.json', 'observer-errors.json', 'harness-reports.json', 'runtime-contract.json', 'runtime-manifest.json'] as const;
interface RunFreeze { schemaVersion: 1; artifactHashes: Record<string, string> }
function strictText(bytes: Buffer): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('SCOUT_INVALID_UTF8'); }
}
function readJson(path: string): unknown {
  try { return JSON.parse(strictText(readFileSync(path))); }
  catch (error) { if (error instanceof Error && error.message === 'SCOUT_INVALID_UTF8') throw error; throw new Error('SCOUT_JSON_ARTIFACT'); }
}
function writeJson(path: string, value: unknown): void { writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
function newDirectory(path: string): void {
  if (existsSync(path)) throw new Error('SCOUT_DESTINATION_EXISTS');
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(path); // Exclusive final directory creation; a concurrent destination is never reused.
}
function currentHead(): string { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim(); }
function checkedRuntimeStatus(value: unknown, manifest: BatchManifest, contract: ScoutContract): RuntimeStatus {
  if (!fields(value, ['schemaVersion', 'status', 'reason', 'runId', 'inputSha256', 'contractSha256', 'model', 'promptHash', 'settingsHash', 'runtimeIdentity'])
    || value.schemaVersion !== 1 || value.status !== 'SKIP' || !nonempty(value.reason) || !nonempty(value.runId)
    || !validModel(value.model) || !['inputSha256', 'contractSha256', 'promptHash', 'settingsHash'].every((key) => hashValue(value[key]))
    || !fields(value.runtimeIdentity, ['runner', 'runtimeReferenceHash']) || !nonempty(value.runtimeIdentity.runner)
    || !hashValue(value.runtimeIdentity.runtimeReferenceHash)) throw new Error('SCOUT_RUNTIME_STATUS_SCHEMA');
  if ((['runId', 'inputSha256', 'contractSha256', 'promptHash', 'settingsHash'] as const).some((key) => value[key] !== manifest[key])
    || canonical(value.model) !== canonical(manifest.model) || canonical(value.model) !== canonical(contract.model)
    || value.runtimeIdentity.runner !== manifest.runnerIdentity
    || value.runtimeIdentity.runtimeReferenceHash !== contract.runtimeReferenceHash) throw new Error('SCOUT_RUNTIME_STATUS_PROVENANCE');
  return freeze(structuredClone(value)) as unknown as RuntimeStatus;
}
function validateRun(run: string): { manifest: BatchManifest; observations: RegressionObservation[]; contract: ScoutContract; selection: ScoutReport } {
  const frozen = readJson(resolve(run, 'freeze.json'));
  if (!fields(frozen, ['schemaVersion', 'artifactHashes']) || frozen.schemaVersion !== 1
    || !fields(frozen.artifactHashes, runFiles) || !stringMap(frozen.artifactHashes, hashValue)) throw new Error('SCOUT_FREEZE_SCHEMA');
  for (const name of runFiles) if (sha256(readFileSync(resolve(run, name))) !== frozen.artifactHashes[name]) throw new Error('SCOUT_SAVED_ARTIFACT_DRIFT');
  const contract = loadContract(resolve(run, 'contract.json'));
  const manifest = readJson(resolve(run, 'manifest.json'));
  if (!validManifest(manifest)) throw new Error('SCOUT_MANIFEST_SCHEMA');
  if (currentHead() !== manifest.sourceHead) throw new Error('SCOUT_SOURCE_HEAD_DRIFT');
  const actualHashes = captureSourceHashes(contract);
  if (canonical(actualHashes) !== canonical(manifest.sourceHashes)) throw new Error('SCOUT_SOURCE_BYTES_DRIFT');
  const requests = readFileSync(resolve(run, 'requests.jsonl'));
  if (sha256(requests) !== manifest.inputSha256) throw new Error('SCOUT_SAVED_REQUEST_DRIFT');
  const observations = readJson(resolve(run, 'local-observations.json')) as RegressionObservation[];
  if (!denseArray(observations)) throw new Error('SCOUT_LOCAL_OBSERVATIONS_SCHEMA');
  const regenerated = prepareBatch({ runId: manifest.runId, sourceHead: manifest.sourceHead, observations, contract });
  if (regenerated.selection.status === 'STOP' || regenerated.localObservations.length !== observations.length
    || regenerated.requestsJsonl !== strictText(requests)) throw new Error('SCOUT_ORDERED_PREFIX_DRIFT');
  // The selection report holds pre-serialization rejections; only selected cases live in local-observations.
  const regeneratedManifest = { ...regenerated.manifest, selection: manifest.selection };
  if (canonical(regeneratedManifest) !== canonical(manifest)) throw new Error('SCOUT_MANIFEST_DRIFT');
  const selection = readJson(resolve(run, 'selection.json')) as ScoutReport;
  if (!record(selection) || !record(selection.counts) || !Array.isArray(selection.reasons)
    || selection.counts.observed !== manifest.selection.observed || selection.counts.selected !== manifest.selection.selected
    || selection.counts.rejected !== manifest.selection.rejected) throw new Error('SCOUT_SELECTION_DRIFT');
  return { manifest, observations, contract, selection };
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    const [mode, ...args] = argv;
    if (mode !== 'export' && mode !== 'import') throw new Error('SCOUT_MODE_REQUIRED');
    const allowed = mode === 'export' ? ['--contract', '--out'] : ['--run', '--responses', '--response-manifest', '--out'];
    const options = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
      if (!allowed.includes(args[i]) || options.has(args[i]) || !nonempty(args[i + 1]) || args[i + 1].startsWith('--')) throw new Error('SCOUT_ARGUMENTS');
      options.set(args[i], resolve(args[i + 1]));
    }
    const required = mode === 'export' ? ['--contract', '--out'] : ['--run', '--responses', '--response-manifest'];
    if (required.some((key) => !options.has(key))) throw new Error('SCOUT_ARGUMENTS');
    if (mode === 'export') {
      const out = options.get('--out')!;
      if (existsSync(out)) throw new Error('SCOUT_DESTINATION_EXISTS');
      const contractBytes = readFileSync(options.get('--contract')!); // Never reserialize: frozen settings preserve original 1.0 lexeme.
      const contract = loadContract(options.get('--contract')!);
      const sourceHead = currentHead(); const beforeHashes = captureSourceHashes(contract);
      const observations: RegressionObservation[] = []; const observerErrors: Array<{ identity: RegressionIdentity; code: string }> = [];
      const hook = { observation: {
        select: (identity: Readonly<RegressionIdentity>) => identity.variation === 0 && identity.instance === 'primary'
          && contract.bindings.some((binding) => effectivePolicy(binding, contract) !== 'DISABLED' && canonical(binding.identity) === canonical(identity)),
        onObservation: (value: Readonly<RegressionObservation>) => { observations.push(value); },
        onError: (identity: Readonly<RegressionIdentity>, code: string) => { observerErrors.push({ identity: { ...identity }, code }); },
      } };
      // Lazy imports keep module import and import mode free of Harness execution or model/runtime loading.
      const { runMassRegressionBaseline } = await import('../../../../src/services/test-support/massRegressionHarness');
      const original = runMassRegressionBaseline(hook);
      const { runExpandedRegression } = await import('../../../../src/services/test-support/expandedRegressionHarness');
      const expanded = runExpandedRegression(hook);
      const prepared = prepareBatch({ runId: basename(out), sourceHead, observations, contract });
      if (prepared.selection.status === 'STOP' || currentHead() !== sourceHead
        || canonical(beforeHashes) !== canonical(prepared.manifest.sourceHashes)) throw new Error('SCOUT_EXPORT_SOURCE_DRIFT');
      newDirectory(out);
      writeFileSync(resolve(out, 'contract.json'), contractBytes, { flag: 'wx' });
      const runtime = runtimeBundle(prepared.manifest, contract);
      writeFileSync(resolve(out, 'runtime-contract.json'), runtime.contractBytes, { flag: 'wx' });
      writeJson(resolve(out, 'runtime-manifest.json'), runtime.manifest);
      writeFileSync(resolve(out, 'requests.jsonl'), prepared.requestsJsonl, { flag: 'wx' });
      writeJson(resolve(out, 'manifest.json'), prepared.manifest); writeJson(resolve(out, 'local-observations.json'), prepared.localObservations);
      writeJson(resolve(out, 'selection.json'), prepared.selection); writeJson(resolve(out, 'observer-errors.json'), observerErrors);
      writeJson(resolve(out, 'harness-reports.json'), { original, expanded });
      const frozen: RunFreeze = { schemaVersion: 1, artifactHashes: Object.fromEntries(runFiles.map((name) => [name, sha256(readFileSync(resolve(out, name)))])) };
      writeJson(resolve(out, 'freeze.json'), frozen);
      return 0;
    }
    const run = options.get('--run')!; const out = options.get('--out') ?? resolve(run, 'results');
    if (existsSync(out)) throw new Error('SCOUT_DESTINATION_EXISTS');
    const { manifest, observations, contract, selection } = validateRun(run);
    let imported: BatchImport | null = null;
    let runtimeStatus: RuntimeStatus | undefined;
    let incomingResponsesSha256: string | undefined;
    let retainedResponseManifest: ResponseManifest | undefined;
    const responsesPath = options.get('--responses')!;
    const responseManifestPath = options.get('--response-manifest')!;
    const siblingPath = resolve(dirname(responseManifestPath), 'runtime-status.json');
    const incomingManifestBytes = existsSync(responseManifestPath) ? readFileSync(responseManifestPath) : undefined;
    const suppliedManifest = incomingManifestBytes ? JSON.parse(strictText(incomingManifestBytes)) as unknown : undefined;
    const directMarker = suppliedManifest !== undefined && (basename(responseManifestPath) === 'runtime-status.json'
      || (record(suppliedManifest) && Object.hasOwn(suppliedManifest, 'status')));
    const siblingMarker = siblingPath !== responseManifestPath && existsSync(siblingPath);
    if (directMarker || siblingMarker) {
      if (existsSync(responsesPath) || (siblingMarker && suppliedManifest !== undefined)) throw new Error('SCOUT_RUNTIME_STATUS_AMBIGUOUS');
      runtimeStatus = checkedRuntimeStatus(directMarker ? suppliedManifest : readJson(siblingPath), manifest, contract);
    } else if (existsSync(responsesPath) && suppliedManifest !== undefined) {
      const responseBytes = readFileSync(responsesPath);
      const responseManifest = suppliedManifest as ResponseManifest;
      if (!validResponseManifest(responseManifest) || sha256(responseBytes) !== responseManifest.responsesSha256) throw new Error('SCOUT_RESPONSE_BYTES_DRIFT');
      imported = importResponses(manifest, responseManifest, strictText(responseBytes));
      incomingResponsesSha256 = sha256(responseBytes);
      retainedResponseManifest = structuredClone(responseManifest);
      // Retain short operational identity only, never oversized free-form text.
      retainedResponseManifest.runtimeIdentity.versions = Object.fromEntries(Object.entries(responseManifest.runtimeIdentity.versions)
        .map(([key, value]) => [key, value.length <= 512 ? value : 'REDACTED_OVERSIZED_VERSION']));
    }
    const report = reportBatch({ manifest, observations, contract, imported });
    if (runtimeStatus && report.status !== 'STOP') {
      report.runtimeStatus = runtimeStatus;
      report.reasons = report.reasons.filter((reason) => reason !== 'RUNTIME_OR_RESPONSE_BUNDLE_UNAVAILABLE');
      report.reasons.push(runtimeStatus.reason);
    }
    report.reasons.push(...selection.reasons.filter((reason) => reason !== 'RUNTIME_OR_RESPONSE_BUNDLE_UNAVAILABLE'));
    report.counts.disabled = selection.counts.disabled; report.counts.notComparable = selection.counts.notComparable;
    report.counts.unclassifiedRejected = selection.counts.unclassifiedRejected;
    for (const [name, domain] of Object.entries(selection.domains)) {
      const target = report.domains[name] ??= { ...domain };
      for (const key of ['observed', 'rejected', 'disabled', 'notComparable']) target[key] = domain[key];
    }
    newDirectory(out);
    // Freeze private, self-contained provenance and sanitized rows before candidates.
    const evidenceNames = ['contract.json', 'manifest.json', 'local-observations.json', 'selection.json'];
    for (const name of evidenceNames) writeFileSync(resolve(out, name), readFileSync(resolve(run, name)), { flag: 'wx' });
    writeJson(resolve(out, 'response-evidence.json'), { schemaVersion: 1, status: imported?.status ?? 'SKIP',
      requestIds: manifest.requestIds, responses: (imported?.responses ?? []).map((row) => ({ ...row,
        raw_output: row.status === 'OK' && row.prediction !== 'INVALID' ? row.prediction : null })),
      missingIds: imported?.missingIds ?? manifest.requestIds, errors: imported?.errors ?? [] });
    evidenceNames.push('response-evidence.json');
    if (retainedResponseManifest) { writeJson(resolve(out, 'response-manifest.json'), retainedResponseManifest); evidenceNames.push('response-manifest.json'); }
    if (runtimeStatus) { writeJson(resolve(out, 'runtime-status.json'), runtimeStatus); evidenceNames.push('runtime-status.json'); }
    const artifactHashes = Object.fromEntries(evidenceNames.map((name) => [name, sha256(readFileSync(resolve(out, name)))]));
    writeJson(resolve(out, 'evidence-freeze.json'), { schemaVersion: 1, artifactHashes,
      ...(incomingResponsesSha256 ? { incomingResponsesSha256 } : {}),
      ...(incomingManifestBytes ? { incomingManifestSha256: sha256(incomingManifestBytes) } : {}) });
    report.evidence = { freezeFile: 'evidence-freeze.json', freezeSha256: sha256(readFileSync(resolve(out, 'evidence-freeze.json'))), artifactHashes };
    writeJson(resolve(out, 'report.json'), report);
    if (report.status === 'STOP') return 2;
    writeJson(resolve(out, 'occurrences.json'), report.occurrences); writeJson(resolve(out, 'candidates.json'), report.candidates);
    return 0;
  } catch (error) {
    // Error messages in this module are opaque codes; never print dialogue, paths or arbitrary exception content.
    const code = error instanceof Error && /^[A-Z_]+$/u.test(error.message) ? error.message : 'SCOUT_WORKFLOW_STOP';
    console.error(code);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
