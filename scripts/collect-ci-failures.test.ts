import { it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCollector } from './collect-ci-failures';

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) {
    for (const name of ['input.json', 'report.json']) await unlink(join(folder, name)).catch(() => {});
    await rmdir(folder);
  }
});
async function files() {
  const root = await mkdtemp(join(tmpdir(), 'shadow-stage1a-')); folders.push(root);
  return { root, input: join(root, 'input.json'), output: join(root, 'report.json') };
}
const context = { repository: 'barsikdan-hue/AI-COPILOT', workspace: '/workspace', testOutcome: 'failure' };
it('writes STOP_INFRA and exits nonzero on missing input', async () => {
  const f = await files();
  expect(await runCollector(['--input', f.input, '--output', f.output], context)).toBe(2);
  expect(JSON.parse(await readFile(f.output, 'utf8')).reason).toBe('INPUT_UNAVAILABLE');
});
it('writes STOP_INFRA and exits nonzero on corrupt input without leaking raw text', async () => {
  const f = await files(); await writeFile(f.input, 'SECRET_TOKEN corrupt {');
  expect(await runCollector(['--input', f.input, '--output', f.output], context)).toBe(2);
  const report = await readFile(f.output, 'utf8');
  expect(report).toContain('INVALID_JSON'); expect(report).not.toContain('SECRET_TOKEN');
});
it('refuses oversized input before unbounded read and writes an explicit STOP', async () => {
  const f = await files(); await writeFile(f.input, 'x'.repeat(16 * 1024 * 1024 + 1));
  expect(await runCollector(['--input', f.input, '--output', f.output], context)).toBe(2);
  expect(JSON.parse(await readFile(f.output, 'utf8')).reason).toBe('INPUT_TOO_LARGE');
});
it('collects failed test evidence without claiming the test passed', async () => {
  const f = await files();
  await writeFile(f.input, JSON.stringify({ numTotalTests: 1, numPassedTests: 0, numFailedTests: 1, numPendingTests: 0, numTodoTests: 0,
    numTotalTestSuites: 1, numPassedTestSuites: 0, numFailedTestSuites: 1, numPendingTestSuites: 0, success: false, startTime: 1,
    testResults: [{ name: '/workspace/test.ts', status: 'failed', message: '', assertionResults: [{ title: 'gate', fullName: 'gate', ancestorTitles: [], status: 'failed', failureMessages: ['AssertionError: expected 1 to be 2'] }] }] }));
  expect(await runCollector(['--input', f.input, '--output', f.output], context)).toBe(0);
  const report = JSON.parse(await readFile(f.output, 'utf8'));
  expect(report.status).toBe('COLLECTED'); expect(report.counts.tests.failed).toBe(1);
  expect(report.provenance.testOutcome).toBe('failure'); expect(report.remediationExecuted).toBe(false);
});
it('rejects malformed UTF8 instead of silently replacing raw evidence bytes', async () => {
  const f = await files(); await writeFile(f.input, Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]));
  expect(await runCollector(['--input', f.input, '--output', f.output], context)).toBe(2);
  expect(JSON.parse(await readFile(f.output, 'utf8')).reason).toBe('INVALID_UTF8');
});
