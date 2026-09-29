import { describe, expect, it } from 'vitest';
import { runMassRegressionBaseline } from './test-support/massRegressionHarness';

describe('AI Copilot mass offline regression baseline', () => {
  const report = runMassRegressionBaseline();

  it('uses 50-101 golden cases and at least 2000 deterministic scenarios', () => {
    expect(report.baseGoldenCases).toBeGreaterThanOrEqual(50);
    expect(report.baseGoldenCases).toBeLessThanOrEqual(101);
    expect(report.generatedScenarios).toBeGreaterThanOrEqual(2000);
    expect(report.assertions).toBeGreaterThan(report.generatedScenarios);
  });

  it('keeps the observed behavior reproducible and clustered', () => {
    expect({
      seed: report.seed,
      baseGoldenCases: report.baseGoldenCases,
      generatedScenarios: report.generatedScenarios,
      assertions: report.assertions,
      pass: report.pass,
      fail: report.fail,
      passRate: report.passRate,
      clusters: report.failureClusters.map(({ key, priority, invariant, probableLayer, count }) => ({ key, priority, invariant, probableLayer, count })),
      fingerprint: report.fingerprint,
    }).toMatchInlineSnapshot(`
      {
        "assertions": 12288,
        "baseGoldenCases": 101,
        "clusters": [],
        "fail": 0,
        "fingerprint": "492c0b724fecf4a1f9182fd0072b3259f832eaf9414ca990fcecb826aed809b4",
        "generatedScenarios": 3232,
        "pass": 12288,
        "passRate": 100,
        "seed": 99537922,
      }
    `);
  });
});
