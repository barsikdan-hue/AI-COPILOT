import { open, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { collectShadow, MAX_INPUT_BYTES, stopped, type ShadowContext } from './harness-shadow-collector';

export async function runCollector(argv: string[], context: ShadowContext): Promise<number> {
  if (argv.length !== 4 || argv[0] !== '--input' || argv[2] !== '--output' || !argv[1] || !argv[3]
    || resolve(argv[1]) === resolve(argv[3])) return 2;
  let report: ReturnType<typeof collectShadow> = stopped(context, 'INPUT_UNAVAILABLE');
  try {
    const file = await open(argv[1], 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile()) report = stopped(context, 'INPUT_UNAVAILABLE');
      else if (stat.size > MAX_INPUT_BYTES) report = stopped(context, 'INPUT_TOO_LARGE', stat.size);
      else {
        // Bounded reads also protect against a file growing after stat().
        const buffer = Buffer.alloc(MAX_INPUT_BYTES + 1);
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length > MAX_INPUT_BYTES) report = stopped(context, 'INPUT_TOO_LARGE', length);
        else {
          const bytes = buffer.subarray(0, length);
          let decoded: string | undefined = undefined;
          try { decoded = new TextDecoder('utf8', { fatal: true, ignoreBOM: true }).decode(bytes); }
          catch { report = stopped(context, 'INVALID_UTF8', length, createHash('sha256').update(bytes).digest('hex')); }
          if (decoded !== undefined) report = collectShadow(decoded, context);
        }
      }
    } finally { await file.close(); }
  } catch { report = stopped(context, 'INPUT_UNAVAILABLE'); }
  try {
    await mkdir(dirname(argv[3]), { recursive: true });
    // Each run has a fresh report destination; do not overwrite another run's evidence.
    await writeFile(argv[3], JSON.stringify(report) + '\n', { flag: 'wx' });
  } catch { return 2; }
  return report.status === 'STOP_INFRA' ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const context: ShadowContext = {
    repository: process.env.GITHUB_REPOSITORY ?? 'barsikdan-hue/AI-COPILOT', workspace: process.env.GITHUB_WORKSPACE ?? process.cwd(),
    testOutcome: process.env.HARNESS_TEST_OUTCOME ?? 'UNKNOWN', runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
    head: process.env.HARNESS_HEAD_SHA, base: process.env.HARNESS_BASE_SHA, checkout: process.env.GITHUB_SHA,
    branch: process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF, runner: process.env.RUNNER_OS, node: process.version,
  };
  process.exitCode = await runCollector(process.argv.slice(2), context);
  console.log(process.exitCode === 0 ? 'SHADOW_COLLECTION_COMPLETE (test outcome unchanged)' : 'STOP_INFRA: shadow collection incomplete');
}
