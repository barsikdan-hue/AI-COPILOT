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
