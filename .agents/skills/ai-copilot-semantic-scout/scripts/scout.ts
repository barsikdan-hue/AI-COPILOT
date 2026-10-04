import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
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

// Byte hash belongs to this composed authority, not to its historical source.
const CONTRACT_SHA256 = '9f86d71b239c2d865167764a8351f76e69124113b87739088beed028730aaf2f';
const AUTHORITY_SIGNATURE = 'e6ad9121f5ee53212954edd2b261b9dcda226ad52d9c8df06e721003fd4a492b';
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

function sourcesMatch(binding: CaseBinding): boolean {
  try {
    return Object.entries(binding.sourceHashes).every(([path, hash]) => sha256(readFileSync(resolve(sourceRoot, path))) === hash);
  } catch { return false; }
}

export function loadContract(path: string): ScoutContract {
  const contract = readAuthority(path);
  if (!contract.bindings.every(sourcesMatch)) throw new Error('SCOUT_SOURCE_DRIFT');
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
  if (binding.projectionId !== 'mortgage-rejected-branch' || projection?.version !== binding.projectionVersion
    || binding.questionId !== 'mortgage_permission' || projection.questionId !== binding.questionId) return reject('UNSUPPORTED_PROJECTION');
  if (canonical(binding.requiredDimensions) !== canonical(projection.requiredDimensions)
    || binding.requiredDimensions.some((key) => binding.dimensions[key] === undefined)) return reject('UNREVIEWED_SCOPE');
  if (observation.turns.length !== observation.identity.turnCutoff) return reject('CUTOFF_MISMATCH');
  // The exact ordered speaker/text prefix excludes Core results and turn ids.
  const prefix = observation.turns.map(({ speaker, text }) => ({ speaker, text }));
  if (sha256(canonical(prefix)) !== binding.turnsSha256) return reject('PREFIX_MISMATCH');
  if (!observation.core.rejectedBranches.includes('ипотеку')) return reject('NO_EXPLICIT_REJECTED_BRANCH');
  return { status: 'COMPARABLE', value: 'NO', projectionId: binding.projectionId, dimensions: { ...binding.dimensions } };
}

function observationId(identity: RegressionIdentity): string {
  return `${identity.harness}:${identity.caseId}:${identity.variation}:${identity.instance}:${identity.turnCutoff}`;
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
  const questions = Object.values(readAuthority(new URL('../references/semantic-scout-contract.json', import.meta.url)).questionRegistry);
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
  return { status: malformed ? 'STOP' : missingIds.length ? 'PARTIAL' : 'COMPLETE',
    responses: manifest.requestIds.flatMap((id) => accepted.has(id) ? [accepted.get(id)!] : []), missingIds, errors };
}
