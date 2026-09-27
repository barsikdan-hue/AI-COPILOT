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
        "assertions": 12256,
        "baseGoldenCases": 101,
        "clusters": [
          {
            "count": 32,
            "invariant": "INV_CONSISTENCY",
            "key": "d968db4e006e",
            "priority": "P1",
            "probableLayer": "canonical fact extraction",
          },
        ],
        "fail": 32,
        "fingerprint": "746ab047d91ceaafdf4b3868f49c4f6ac055778951b013bd17ed5d90d6d2ac98",
        "generatedScenarios": 3232,
        "pass": 12224,
        "passRate": 99.74,
        "seed": 99537922,
      }
    `);
  });
});
