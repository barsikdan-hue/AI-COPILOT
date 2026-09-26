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
            "invariant": "INV_FACT_CORRECTION",
            "key": "0012f5179656",
            "priority": "P0",
            "probableLayer": "canonical fact extraction",
          },
          {
            "count": 32,
            "invariant": "INV_NEGATION",
            "key": "b7028e8bdafc",
            "priority": "P0",
            "probableLayer": "canonical fact extraction",
          },
          {
            "count": 32,
            "invariant": "INV_CONSISTENCY",
            "key": "f85c862c441f",
            "priority": "P0",
            "probableLayer": "canonical fact extraction",
          },
          {
            "count": 30,
            "invariant": "INV_CONSISTENCY",
            "key": "1c79465cd8f2",
            "priority": "P0",
            "probableLayer": "cross-layer projection",
          },
          {
            "count": 64,
            "invariant": "INV_CONTEXT_NEXT_ACTION",
            "key": "077a65288c94",
            "priority": "P1",
            "probableLayer": "event routing",
          },
          {
            "count": 64,
            "invariant": "INV_CONSISTENCY",
            "key": "463804bfb794",
            "priority": "P1",
            "probableLayer": "canonical fact extraction",
          },
          {
            "count": 64,
            "invariant": "INV_CONTEXT_NEXT_ACTION",
            "key": "c21d7957eefc",
            "priority": "P1",
            "probableLayer": "event detection",
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
          {
            "count": 9,
            "invariant": "INV_CLOSED_BRANCH",
            "key": "80d80da8fa60",
            "priority": "P1",
            "probableLayer": "next-action/recommendation selection",
          },
        ],
        "fail": 451,
        "fingerprint": "4a5e4c0d5cd2efb8cdff7a5993f4e597d3025fedcc70b205d828a188fd122c68",
        "generatedScenarios": 3200,
        "pass": 11549,
        "passRate": 96.24,
        "seed": 99537922,
      }
    `);
  });
});
