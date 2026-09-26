import { describe, expect, it } from 'vitest';
import { runMassRegressionBaseline } from './test-support/massRegressionHarness';

describe('AI Copilot mass offline regression baseline', () => {
  const report = runMassRegressionBaseline();

  it('uses 50-100 golden cases and at least 2000 deterministic scenarios', () => {
    expect(report.baseGoldenCases).toBeGreaterThanOrEqual(50);
    expect(report.baseGoldenCases).toBeLessThanOrEqual(100);
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
        "assertions": 12000,
        "baseGoldenCases": 100,
        "clusters": [
          {
            "count": 32,
            "invariant": "INV_NEGATION",
            "key": "b7028e8bdafc",
            "priority": "P0",
            "probableLayer": "canonical fact extraction",
          },
          {
            "count": 64,
            "invariant": "INV_CONSISTENCY",
            "key": "463804bfb794",
            "priority": "P1",
            "probableLayer": "canonical fact extraction",
          },
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
          {
            "count": 32,
            "invariant": "INV_CONSISTENCY",
            "key": "f0248a43cdd1",
            "priority": "P1",
            "probableLayer": "canonical fact extraction",
          },
          {
            "count": 28,
            "invariant": "INV_CONSISTENCY",
            "key": "e98ad66636f9",
            "priority": "P1",
            "probableLayer": "canonical fact extraction",
          },
        ],
        "fail": 220,
        "fingerprint": "a569c5e66c8a1cbffe8bb95e87635f961dfb219c0f96fe34a646279046f3e101",
        "generatedScenarios": 3200,
        "pass": 11780,
        "passRate": 98.17,
        "seed": 99537922,
      }
    `);
  });
});
