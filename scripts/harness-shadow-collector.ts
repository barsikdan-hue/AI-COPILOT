import { createHash } from 'node:crypto';

export const MAX_INPUT_BYTES = 16 * 1024 * 1024;
export const MAX_REPORT_BYTES = 128 * 1024;
const MAX_DETAILS = 100;
const MAX_PROCESSING_WORK = 32 * 1024 * 1024;
export interface ShadowContext {
  repository: string;
  workspace: string;
  testOutcome: string;
  runId?: string;
  attempt?: string;
  head?: string;
  base?: string;
  checkout?: string;
  tree?: string;
  branch?: string;
  runner?: string;
  node?: string;
}
type Category = 'ASSERTION_MISMATCH' | 'TIMEOUT' | 'PROVENANCE_DRIFT' | 'PROVIDER_INFRA_FAILURE' | 'UNRESOLVED';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const digits = (value?: string) => value && /^\d{1,20}$/.test(value) ? value : null;
const revision = (value?: string) => value && /^[a-f0-9]{40}$/.test(value) ? value : null;

function envelope(context: ShadowContext, raw: { bytes: number; sha256: string | null }) {
  return {
    schema: 'ai-copilot-shadow-incident/v1', detector: 'vitest-json/5', shadow: true, remediationExecuted: false,
    crossRunPersistence: 'NOT_IMPLEMENTED', causalVerdict: 'ROOT_CAUSE_NOT_PROVEN',
    raw: { ...raw, location: 'RUNNER_LOCAL_ONLY_NOT_UPLOADED' },
    provenance: {
      repository: context.repository === 'barsikdan-hue/AI-COPILOT' ? context.repository : null,
      runId: digits(context.runId), attempt: digits(context.attempt),
      head: revision(context.head), base: revision(context.base), checkout: revision(context.checkout), tree: revision(context.tree),
      branchSha256: context.branch ? sha(context.branch) : null,
      runner: ['Linux', 'Windows', 'macOS'].includes(context.runner ?? '') ? context.runner : null,
      node: /^v?\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(context.node ?? '') ? context.node : null,
      testOutcome: ['success', 'failure', 'cancelled', 'skipped'].includes(context.testOutcome) ? context.testOutcome : 'UNKNOWN',
      command: 'npm test (existing vitest run; JSON reporter added)',
    },
  };
}

export function stopped(context: ShadowContext, reason: string, bytes = 0, hash: string | null = null) {
  return { ...envelope(context, { bytes, sha256: hash }), status: 'STOP_INFRA', reason,
    counts: null, incidents: [], occurrences: [], omitted: { incidents: 0, occurrences: 0 }, evidenceComplete: false };
}

// Remove only presentation: ANSI/CRLF, the verified checkout prefix and formatted stack frames.
// Client numbers, expected/actual values, ownership, polarity and time remain in the signature.
function signature(message: string, workspace: string) {
  const root = workspace.replace(/\\/g, '/').replace(/\/$/, '');
  return message.replace(/\u001b\[[0-9;]*m/g, '').replace(/\r\n/g, '\n')
    .split('\n').filter(line => !/^ {4}at .+(?::\d+:\d+\)?|\(<anonymous>\))$/.test(line)).join('\n')
    .split(root).join('<workspace>');
}
function category(message: string): Category {
  if (/^AssertionError\b/.test(message)) return 'ASSERTION_MISMATCH';
  if (/^(?:Error: )?(?:Test|Hook) timed out in \d+ms\b/.test(message)) return 'TIMEOUT';
  if (/^(?:Error: )?SCOUT_SOURCE_DRIFT\b/.test(message)) return 'PROVENANCE_DRIFT';
  if (/^(?:Error: )?(?:connect |spawn |getaddrinfo )?(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPERM|EACCES)\b/.test(message)) return 'PROVIDER_INFRA_FAILURE';
  return 'UNRESOLVED';
}
function suiteIdentity(name: string, workspace: string): string | null {
  const path = name.replace(/\\/g, '/'), root = workspace.replace(/\\/g, '/').replace(/\/$/, '') + '/';
  if (!path.startsWith(root)) return null;
  const relative = path.slice(root.length);
  return relative && !relative.split('/').some(part => part === '..' || !part) ? relative : null;
}

export function collectShadow(input: string, context: ShadowContext) {
  const bytes = Buffer.byteLength(input);
  if (bytes > MAX_INPUT_BYTES) return stopped(context, 'INPUT_TOO_LARGE', bytes);
  const rawHash = sha(input);
  const stop = (reason: string) => stopped(context, reason, bytes, rawHash);
  let data: any;
  try { data = JSON.parse(input); } catch { return stop('INVALID_JSON'); }
  const testKeys = ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests'];
  const suiteKeys = ['numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites'];
  if (!object(data) || ![...testKeys, ...suiteKeys].every(key => integer(data[key])) || typeof data.success !== 'boolean'
    || !Array.isArray(data.testResults) || !data.testResults.length || number(data.startTime) === null) return stop('INVALID_SCHEMA');
  if (data.numTotalTestSuites < data.testResults.length) return stop('INCONSISTENT_COUNTS');
  if (data.numTotalTests !== data.numPassedTests + data.numFailedTests + data.numPendingTests + data.numTodoTests
    || data.numTotalTestSuites !== data.numPassedTestSuites + data.numFailedTestSuites + data.numPendingTestSuites) return stop('INCONSISTENT_COUNTS');
  if (!['success', 'failure'].includes(context.testOutcome)) return stop('TEST_OUTCOME_UNAVAILABLE');
  if (context.repository !== 'barsikdan-hue/AI-COPILOT' || !context.workspace) return stop('SOURCE_IDENTITY_UNAVAILABLE');
  const groups = new Map<string, any>();
  const occurrences: any[] = [];
  let detected = 0, passed = 0, failed = 0, pending = 0, todo = 0, failedFiles = 0;
  let processingWork = 0;
  const reserve = (units: number) => (processingWork += units) <= MAX_PROCESSING_WORK;
  function add(message: string, file: any, fileIndex: number, assertionIndex: number | null, messageIndex: number, assertion?: any) {
    const phase = assertion ? 'TEST' : 'SUITE';
    const suite = suiteIdentity(file.name, context.workspace);
    // Structured ancestor/title avoids collisions from Vitest's space-joined fullName.
    const test = assertion ? [...assertion.ancestorTitles, assertion.title] : ['<suite>'];
    const normalized = signature(message, context.workspace);
    const kind = category(normalized);
    // Chai's truncated display can erase amounts/time/polarity; JSON has no expected/actual payload to restore them.
    const lossy = /…|\.\.\.|\[(?:Array|Object|Function|Arguments|Circular)\b/.test(normalized);
    const equivalent = !!suite && test.every(part => !!part) && !!normalized && kind !== 'UNRESOLVED' && !lossy;
    const identity = ['ai-copilot-shadow-incident/v1', 'vitest-json/5', context.repository, phase, kind,
      suite, test, normalized, equivalent ? null : ['occurrence', fileIndex, assertionIndex, messageIndex]];
    const fingerprint = sha(JSON.stringify(identity));
    let incident = groups.get(fingerprint);
    if (!incident) {
      incident = { fingerprint, category: kind, phase, equivalence: equivalent ? 'DETECTOR_SYMPTOM_ONLY' : 'UNRESOLVED_OCCURRENCE',
        suiteSha256: sha(suite ?? file.name), testSha256: sha(JSON.stringify(test)), signatureSha256: sha(normalized), occurrenceCount: 0 };
      groups.set(fingerprint, incident);
    }
    incident.occurrenceCount++;
    detected++;
    if (occurrences.length < MAX_DETAILS) occurrences.push({ ordinal: detected, fingerprint,
      rawLocator: { fileIndex, assertionIndex, messageIndex }, startTime: number(file.startTime), endTime: number(file.endTime), duration: number(assertion?.duration) });
  }
  for (const [fileIndex, file] of data.testResults.entries()) {
    if (!object(file) || typeof file.name !== 'string' || typeof file.message !== 'string' || !['passed', 'failed'].includes(file.status)
      || !Array.isArray(file.assertionResults)) return stop('INVALID_SUITE');
    if (file.message && file.status !== 'failed') return stop('HIDDEN_FAILED_SUITE');
    if (file.status === 'failed') failedFiles++;
    let fileFailedTests = 0;
    for (const [index, assertion] of file.assertionResults.entries()) {
      if (!object(assertion) || typeof assertion.title !== 'string' || typeof assertion.fullName !== 'string'
        || !Array.isArray(assertion.ancestorTitles) || !assertion.ancestorTitles.every((t: unknown) => typeof t === 'string')
        || !Array.isArray(assertion.failureMessages) || !assertion.failureMessages.every((m: unknown) => typeof m === 'string')) return stop('INVALID_ASSERTION');
      if (assertion.status === 'passed') passed++;
      else if (assertion.status === 'failed') {
        failed++; fileFailedTests++;
        const messages = assertion.failureMessages.length ? assertion.failureMessages : [''];
        // Charge repeated identity serialization before doing it; small JSON can otherwise amplify work quadratically.
        const identityUnits = file.name.length + assertion.title.length
          + assertion.ancestorTitles.reduce((sum: number, title: string) => sum + title.length + 4, 0) + 512;
        const units = messages.length * identityUnits + messages.reduce((sum: number, message: string) => sum + message.length * 6, 0);
        if (!reserve(units)) return stop('PROCESSING_LIMIT');
        messages.forEach((message: string, messageIndex: number) => add(message, file, fileIndex, index, messageIndex, assertion));
      } else if (['pending', 'skipped'].includes(assertion.status)) pending++;
      else if (assertion.status === 'todo') todo++;
      else return stop('INVALID_ASSERTION_STATUS');
      if (assertion.status !== 'failed' && assertion.failureMessages.length) return stop('HIDDEN_FAILURE_MESSAGES');
    }
    if (fileFailedTests && file.status !== 'failed') return stop('HIDDEN_FAILED_SUITE');
    if (file.message || (file.status === 'failed' && !fileFailedTests)) {
      if (!reserve(file.name.length + file.message.length * 6 + 512)) return stop('PROCESSING_LIMIT');
      add(file.message, file, fileIndex, null, 0);
    }
  }
  if (passed !== data.numPassedTests || failed !== data.numFailedTests || pending !== data.numPendingTests || todo !== data.numTodoTests
    || failedFiles > data.numFailedTestSuites || (!!failedFiles !== (data.numFailedTestSuites > 0))) return stop('INCONSISTENT_COUNTS');
  if (data.success === (failedFiles > 0 || failed > 0) || (context.testOutcome === 'success' && (!data.success || detected))) return stop('INCONSISTENT_OUTCOME');
  // Vitest JSON omits unhandled run errors; a nonzero CI test exit remains independent evidence.
  if (context.testOutcome === 'failure' && !detected) return stop('TEST_EXIT_UNEXPLAINED');
  const incidents = [...groups.values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)).slice(0, MAX_DETAILS);
  const report = { ...envelope(context, { bytes, sha256: rawHash }),
    status: detected ? 'COLLECTED' : 'NO_TEST_FAILURES_OBSERVED', reason: null, evidenceComplete: true,
    counts: { detectedOccurrences: detected, uniqueFingerprints: groups.size, duplicateOccurrences: detected - groups.size,
      files: { total: data.testResults.length, failed: failedFiles },
      tests: { total: data.numTotalTests, passed, failed, pending, todo },
      suites: { total: data.numTotalTestSuites, passed: data.numPassedTestSuites, failed: data.numFailedTestSuites, pending: data.numPendingTestSuites } },
    incidents, occurrences, omitted: { incidents: groups.size - incidents.length, occurrences: detected - occurrences.length } };
  if (Buffer.byteLength(JSON.stringify(report)) > MAX_REPORT_BYTES) return stop('REPORT_TOO_LARGE');
  return report;
}
