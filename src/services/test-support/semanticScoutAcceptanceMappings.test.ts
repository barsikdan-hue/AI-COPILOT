import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadContract, prepareBatch, projectCore, effectivePolicy, reportBatch, importResponses } from '../../../.agents/skills/ai-copilot-semantic-scout/scripts/scout';
import { emitRegressionObservation, type RegressionObservation } from './regressionObservation';
import { MASS_REGRESSION_GOLDEN_CASES } from '../test-fixtures/massRegressionGoldenCases';
import { EXPANDED_REGRESSION_SCENARIOS } from '../test-fixtures/expandedRegressionScenarios';
import { createInitialState } from '../conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from '../localAnalysisEngine';
import { chooseDialoguePolicyTarget } from '../dialoguePolicyEngine';
import type { TranscriptTurn } from '../../types';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const path = resolve('.agents/skills/ai-copilot-semantic-scout/references/semantic-scout-contract.json');
const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const expected = [
  ['fact.payment.no-mortgage', 'NO', 'ACTIVE_SHADOW'],
  ['negation.payment.mortgage', 'NO', 'ACTIVE_SHADOW'],
  ['fact.payment.mortgage', 'YES', 'ACTIVE_SHADOW'],
  ['finance.mortgage.plan', 'YES', 'ACTIVE_SHADOW'],
  ['correction.children.third-party', 'NO', 'OBSERVE_ONLY'],
  ['correction.payment.mortgage-cash', 'NO', 'OBSERVE_ONLY'],
  ['fact.correction.budget', 'YES', 'OBSERVE_ONLY'],
  ['finance.dp.future', 'YES', 'OBSERVE_ONLY'],
  ['finance.dp.ready', null, 'DISABLED'],
  ['finance.dp.none', null, 'DISABLED'],
  ['finance.no-mortgage.rejected', null, 'ACTIVE_SHADOW'],
] as const;

function capture(caseId: string): RegressionObservation {
  const original = MASS_REGRESSION_GOLDEN_CASES.find(x => x.id === caseId);
  const expanded = EXPANDED_REGRESSION_SCENARIOS.find(x => x.id === caseId);
  const prefix = original ? [...('previousClientText' in original && original.previousClientText ? [{ speaker: 'client' as const, text: original.previousClientText }] : []), { speaker: 'client' as const, text: original.text }] : expanded!.turns;
  const turns: TranscriptTurn[] = prefix.map((t, i) => ({ id: `${caseId}-t${i + 1}`, sessionId: 'mapping-test', speaker: t.speaker, text: t.text, source: t.speaker === 'client' ? 'call_audio' : 'microphone', timestamp: (i + 1) * 1000, isFinal: true, revision: i + 1 }));
  let state = createInitialState();
  for (let i = 0; i < turns.length; i++) state = advanceLocalConversation(state, turns[i], turns.slice(0, i + 1)).state;
  buildLocalAnalysisResponse({ sessionId: 'mapping-test', revision: turns.length, newTurns: [turns.at(-1)!], recentTurns: turns, currentState: state });
  chooseDialoguePolicyTarget(state, turns, state.scriptProgress);
  const before = JSON.stringify(state);
  let observed!: RegressionObservation;
  emitRegressionObservation({ harness: original ? 'original' : 'expanded', caseId, variation: 0, instance: 'primary', turnCutoff: turns.length }, { state, turns }, { observation: { select: () => true, onObservation: x => { observed = x; } } });
  expect(JSON.stringify(state)).toBe(before);
  return observed;
}

describe('bounded-acceptance-mappings', () => {
  it.each(expected)('projects actual canonical fixture %s without absence-to-NO conversion', (caseId, value, mode) => {
    const contract = loadContract(path);
    const observation = capture(caseId);
    const binding = contract.bindings.find(x => x.identity.caseId === caseId);
    expect(binding, `missing reviewed mapping ${caseId}`).toBeDefined();
    expect(effectivePolicy(binding!, contract)).toBe(mode);
    const core = projectCore(observation, binding!, contract);
    if (value === null) expect(core.status).toBe('NOT_COMPARABLE');
    else expect(core).toMatchObject({ status: 'COMPARABLE', value });
  });

  it('filters disabled and unprojectable sources before serialization', () => {
    const contract = loadContract(path);
    const ready = prepareBatch({ runId: 'mapping-test', sourceHead: head(), observations: expected.map(([id]) => capture(id)), contract });
    expect(ready.manifest.requestIds).toHaveLength(8);
    expect(ready.selection).toMatchObject({ status: 'SKIP' });
    const outgoing = ready.requestsJsonl;
    expect(outgoing).not.toContain('Средства на стартовый взнос уже лежат на счёте.');
    expect(outgoing).not.toContain('Первоначального взноса сейчас нет.');
    expect(outgoing).not.toContain('Ипотечные варианты даже не рассматриваю.');
  });

  it('missing Core fact stays NOT_COMPARABLE rather than importing the source label', () => {
    const contract = loadContract(path);
    const binding = contract.bindings.find(x => x.identity.caseId === 'finance.mortgage.plan');
    expect(binding).toBeDefined();
    const observed = capture('finance.mortgage.plan');
    expect(projectCore({ ...observed, core: { rejectedBranches: [] } }, binding!, contract).status).toBe('NOT_COMPARABLE');
  });

  it('deduplicates ACTIVE control disagreements and suppresses OBSERVE_ONLY candidates', () => {
    // Deliberate QA fault injection, not real inference or model-quality evidence.
    const contract = loadContract(path);
    const ready = prepareBatch({ runId: 'control', sourceHead: head(), observations: expected.map(([id]) => capture(id)), contract });
    expect(ready.manifest.requestIds).toHaveLength(8);
    const bytes = ready.manifest.requestIds.map((id, i) => {
      const o = ready.localObservations[i];
      const b = contract.bindings.find(x => x.identity.caseId === o.identity.caseId)!;
      const projected = projectCore(o, b, contract);
      return JSON.stringify({ id, status: 'OK', raw_output: projected.status === 'COMPARABLE' && projected.value === 'YES' ? 'NO' : 'YES', latency_ms: 1 });
    }).join('\n') + '\n';
    const imported = importResponses(ready.manifest, { schemaVersion: 1, runId: 'control', inputSha256: ready.manifest.inputSha256, contractSha256: ready.manifest.contractSha256, model: ready.manifest.model, promptHash: ready.manifest.promptHash, settingsHash: ready.manifest.settingsHash, responsesSha256: createHash('sha256').update(bytes).digest('hex'), runtimeIdentity: { runner: ready.manifest.runnerIdentity, runtimeReferenceHash: contract.runtimeReferenceHash, versions: { qa_control: 'injected' } } }, bytes);
    const report = reportBatch({ manifest: ready.manifest, observations: ready.localObservations, contract, imported });
    expect(report.counts).toMatchObject({ eligibleDisagreements: 4, observeOnlyDisagreements: 4, candidates: 2, suppressedRepeats: 2, provenCoreBugs: 0, provenScoutFalseAlarms: 0 });
    expect(report.candidates.map(x => x.occurrence_count).sort()).toEqual([2, 2]);
    expect(report.candidates.every(x => x.payload.domain === 'negation' || x.payload.domain === 'mortgage_intent')).toBe(true);
  });
});
