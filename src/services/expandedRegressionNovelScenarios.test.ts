import { describe, expect, it } from 'vitest';
import { MASS_REGRESSION_GOLDEN_CASES } from './test-fixtures/massRegressionGoldenCases';
import { EXPANDED_REGRESSION_SCENARIOS } from './test-fixtures/expandedRegressionScenarios';
import { runExpandedRegression } from './test-support/expandedRegressionHarness';

describe('expanded regression: novel scenarios', () => {
  it('keeps the original golden baseline immutable and covers 256 new base scenarios', () => {
    expect(MASS_REGRESSION_GOLDEN_CASES).toHaveLength(101);
    expect(EXPANDED_REGRESSION_SCENARIOS).toHaveLength(256);
    expect(new Set(EXPANDED_REGRESSION_SCENARIOS.map((scenario) => scenario.id)).size).toBe(256);
  });

  it('characterizes 8192 local deterministic executions and clusters unique failures', () => {
    const report = runExpandedRegression();
    expect(report.generatedExecutions).toBe(8192);
    expect({
      ...report,
      failureClusters: report.failureClusters.map((cluster) => ({
        id: cluster.id,
        count: cluster.count,
        invariant: cluster.invariant,
        semanticAction: cluster.semanticAction,
        factCategory: cluster.factCategory,
        eventType: cluster.eventType,
        productionLayer: cluster.productionLayer,
        severity: cluster.severity,
      })),
    }).toMatchSnapshot();
  }, 360_000);
});
