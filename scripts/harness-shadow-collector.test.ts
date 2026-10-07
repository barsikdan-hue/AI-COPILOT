import { describe, it, expect } from 'vitest';
import { collectShadow } from './harness-shadow-collector';

const context = { repository: 'barsikdan-hue/AI-COPILOT', workspace: '/runner/repo', testOutcome: 'failure', runId: '12', attempt: '1', head: 'a'.repeat(40), base: 'b'.repeat(40), checkout: 'c'.repeat(40) };
const assertion = (message: string, title = 'preserves initial payment polarity') => ({ ancestorTitles: ['routing'], fullName: `routing ${title}`, title, status: 'failed', duration: 13, failureMessages: [message] });
function fixture(messages = ['AssertionError: expected false to be true']) {
  return { numTotalTestSuites: 2, numPassedTestSuites: 0, numFailedTestSuites: 2, numPendingTestSuites: 0,
    numTotalTests: messages.length, numPassedTests: 0, numFailedTests: messages.length, numPendingTests: 0, numTodoTests: 0,
    snapshot: {}, startTime: 100, success: false,
    testResults: [{ name: '/runner/repo/src/routing.test.ts', status: 'failed', message: '', startTime: 101, endTime: 120, assertionResults: messages.map(m => assertion(m)) }] };
}
const collect = (data = fixture(), overrides = {}) => collectShadow(JSON.stringify(data), { ...context, ...overrides });

describe('Stage1A shadow failure evidence', () => {
  it('separates assertion, timeout, provenance and explicit provider/infra codes', () => {
    const result = collect(fixture(['AssertionError: expected false to be true', 'Error: Test timed out in 5000ms.', 'Error: SCOUT_SOURCE_DRIFT: pinned hash differs', 'Error: connect ECONNRESET']));
    expect(result.status).toBe('COLLECTED');
    expect(result.incidents.map((i: any) => i.category).sort()).toEqual(['ASSERTION_MISMATCH', 'PROVENANCE_DRIFT', 'PROVIDER_INFRA_FAILURE', 'TIMEOUT']);
    expect(new Set(result.incidents.map((i: any) => i.fingerprint)).size).toBe(4);
  });
  it('does not mistake drift/timeout wording inside assertion values for causal evidence', () => {
    expect(collect(fixture(['AssertionError: expected "SCOUT_SOURCE_DRIFT Test timed out" to be "ok"'])).incidents[0].category).toBe('ASSERTION_MISMATCH');
  });
  it('excludes run/SHA/duration and known stack host offsets from stable identity', () => {
    const first = fixture(['AssertionError: expected 2 млн in декабре to be available now\n    at /runner/repo/src/routing.ts:7:3']);
    const second = fixture(['AssertionError: expected 2 млн in декабре to be available now\n    at C:\\agent\\repo\\src\\routing.ts:99:4']);
    second.testResults[0].name = 'C:\\agent\\repo\\src\\routing.test.ts'; second.startTime = 900;
    second.testResults[0].assertionResults[0].duration = 200;
    const a = collect(first), b = collect(second, { workspace: 'C:\\agent\\repo', runId: '99', head: 'd'.repeat(40) });
    expect(a.incidents[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(a.incidents[0].fingerprint).toBe(b.incidents[0].fingerprint);
    expect(a.provenance.runId).toBe('12'); expect(b.provenance.runId).toBe('99');
    expect(a.raw.sha256).not.toBe(b.raw.sha256);
  });
  it('retains numeric, ownership, time, polarity and expected/actual distinctions', () => {
    const messages = ['AssertionError: expected client 2 млн now to be true', 'AssertionError: expected client 3 млн now to be true', 'AssertionError: expected agent 2 млн now to be true', 'AssertionError: expected client 2 млн december to be true', 'AssertionError: expected client 2 млн now to be false'];
    expect(new Set(collect(fixture(messages)).incidents.map((i: any) => i.fingerprint)).size).toBe(5);
  });
  it('deduplicates equivalent detector symptoms only inside one run, retaining each occurrence', () => {
    const result = collect(fixture(['AssertionError: expected 1 to be 2', 'AssertionError: expected 1 to be 2']));
    expect(result.incidents).toHaveLength(1); expect(result.occurrences).toHaveLength(2);
    expect(result.incidents[0].occurrenceCount).toBe(2);
    expect(result.crossRunPersistence).toBe('NOT_IMPLEMENTED');
    expect(result.remediationExecuted).toBe(false); expect(result.shadow).toBe(true);
    expect(collect(fixture(['AssertionError: expected 1 to be 2'])).incidents[0].occurrenceCount).toBe(1);
  });
  it('does not treat missing test identity or unresolved errors as dedupe wildcards', () => {
    const data = fixture(['Error: mystery', 'Error: mystery']);
    expect(collect(data).incidents).toHaveLength(2);
    data.testResults[0].assertionResults.forEach(a => { a.title = ''; a.fullName = ''; });
    data.testResults[0].assertionResults.forEach(a => { a.failureMessages = ['AssertionError: mismatch']; });
    expect(collect(data).incidents).toHaveLength(2);
  });
  it('never publishes raw messages, titles, paths, credentials or dialogue text', () => {
    const secret = 'sk-live-PRIVATE_TOKEN';
    const data = fixture([`AssertionError: client Марина +79991234567 mail@test.ru token=${secret}`]);
    data.testResults[0].name = `/runner/repo/${secret}.test.ts`;
    data.testResults[0].assertionResults[0].title = secret;
    data.testResults[0].assertionResults[0].fullName = secret;
    const output = JSON.stringify(collect(data, { runId: secret }));
    for (const text of [secret, 'Марина', '+79991234567', 'mail@test.ru', '/runner/repo']) expect(output).not.toContain(text);
  });
  it('bounds output without silently losing occurrence denominators', () => {
    const result = collect(fixture(Array.from({ length: 2000 }, (_, n) => `AssertionError: expected ${n} to be 0`)));
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(128 * 1024);
    expect(result.counts?.detectedOccurrences).toBe(2000);
    expect(result.counts?.uniqueFingerprints).toBe(2000);
    expect(result.omitted.incidents + result.incidents.length).toBe(2000);
    expect(result.omitted.occurrences + result.occurrences.length).toBe(2000);
  });
  it.each(['', '{', '{}', 'null'])('fails closed on missing/corrupt schema: %j', raw => {
    expect(collectShadow(raw, context).status).toBe('STOP_INFRA');
  });
  it('rejects inconsistent test totals or hidden failed status', () => {
    const data = fixture(); data.numFailedTests = 0;
    expect(collect(data).status).toBe('STOP_INFRA');
    const other = fixture(); other.success = true;
    expect(collect(other).status).toBe('STOP_INFRA');
  });
  it('keeps suite setup failures distinct from test assertions', () => {
    const data = fixture([]); data.testResults[0].message = 'Error: spawn EPERM';
    const result = collect(data);
    expect(result.incidents[0].phase).toBe('SUITE');
    expect(result.incidents[0].category).toBe('PROVIDER_INFRA_FAILURE');
    expect(result.counts?.tests.failed).toBe(0);
  });
  it('reports failure exit with JSON success as missing error evidence, not green', () => {
    const data = fixture([]); data.success = true; data.numPassedTestSuites = 2; data.numFailedTestSuites = 0; data.testResults[0].status = 'passed';
    expect(collect(data).reason).toBe('TEST_EXIT_UNEXPLAINED');
    expect(collect(data, { testOutcome: 'success' }).status).toBe('NO_TEST_FAILURES_OBSERVED');
  });
  it('preserves indented semantic lines that only resemble a stack prefix', () => {
    const result = collect(fixture(['AssertionError: mismatch\n    at december client has 2 млн', 'AssertionError: mismatch\n    at now client has 2 млн']));
    expect(result.incidents).toHaveLength(2);
  });
  it('stops on hidden suite messages even when the JSON claims success', () => {
    const data = fixture([]); data.success = true; data.numPassedTestSuites = 2; data.numFailedTestSuites = 0;
    data.testResults[0].status = 'passed'; data.testResults[0].message = 'Error: SCOUT_SOURCE_DRIFT';
    expect(collect(data).status).toBe('STOP_INFRA');
  });
  it('never dedupes lossy Chai object assertions as proven semantic equivalence', () => {
    const truncated = "AssertionError: expected { client: { owner: 'client', …(3) } } to deeply equal { client: { owner: 'client', …(3) } }";
    const result = collect(fixture([truncated, truncated]));
    expect(result.incidents).toHaveLength(2);
    expect(result.incidents.every(i => i.equivalence === 'UNRESOLVED_OCCURRENCE')).toBe(true);
  });
  it('rejects missing file-level suite denominators rather than report no failures', () => {
    const data = fixture([]); data.success = true; data.numPassedTestSuites = 0; data.numTotalTestSuites = 0; data.numFailedTestSuites = 0;
    data.testResults[0].status = 'passed';
    expect(collect(data, { testOutcome: 'success' }).status).toBe('STOP_INFRA');
  });
  it('stops before adversarial identity repetition amplifies bounded input work', () => {
    const data = fixture();
    const a = data.testResults[0].assertionResults[0];
    a.title = 't'.repeat(128 * 1024); a.fullName = a.title; a.ancestorTitles = [];
    a.failureMessages = Array(300).fill('AssertionError: expected 1 to be 2');
    expect(collect(data).reason).toBe('PROCESSING_LIMIT');
  });
  it('treats incomplete object placeholders as lossy without searching for closing brackets', () => {
    const text = 'AssertionError: ' + '[Object'.repeat(1000);
    const result = collect(fixture([text, text]));
    expect(result.incidents).toHaveLength(2);
    expect(result.incidents.every(i => i.equivalence === 'UNRESOLVED_OCCURRENCE')).toBe(true);
  });
});
