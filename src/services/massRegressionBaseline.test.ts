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
        "assertions": 12224,
        "baseGoldenCases": 101,
        "clusters": [
          {
            "count": 32,
            "invariant": "INV_CONSISTENCY",
            "key": "91fe5e379706",
            "priority": "P1",
            "probableLayer": "canonical fact extraction",
          },
          {
            "count": 32,
            "invariant": "INV_CONSISTENCY",
            "key": "d968db4e006e",
            "priority": "P1",
            "probableLayer": "canonical fact extraction",
          },
        ],
        "fail": 64,
        "fingerprint": "8a6e23fb9b45b1a578559eece5b344678ad85201f5c82d7e250476f7d913e4b6",
        "generatedScenarios": 3232,
        "pass": 12160,
        "passRate": 99.48,
        "seed": 99537922,
      }
    `);
  });
});
