import { createHash } from 'node:crypto';
import type { ConversationState, SuggestedReply, TranscriptTurn } from '../../types';
import { AnalysisProvider } from '../analysisProvider';
import { detectConversationEvent } from '../conversationEventEngine';
import { createInitialState } from '../conversationStore';
import { chooseDialoguePolicyTarget } from '../dialoguePolicyEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from '../localAnalysisEngine';
import { isSuggestionAllowedByState, shouldReplaceSuggestion } from '../suggestionLifecycle';
import { aggregateFinalTurn, isDuplicateFinalTurn } from '../sttDedup';
import {
  EXPANDED_EXECUTIONS_PER_SCENARIO,
  EXPANDED_REGRESSION_SCENARIOS,
  EXPANDED_REGRESSION_SEED,
  type ExpandedCheck,
  type ExpandedDomain,
  type ExpandedImpact,
  type ExpandedScenario,
} from '../test-fixtures/expandedRegressionScenarios';

export interface ExpandedFailure {
  scenarioId: string;
  domain: ExpandedDomain;
  variation: number;
  invariant: string;
  semanticAction: string;
  factCategory: string;
  eventType: string;
  productionLayer: string;
  likelyFunctions: string[];
  input: string;
  expected: string;
  actual: string;
  impact: ExpandedImpact[];
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ExpandedFailureCluster {
  id: string;
  count: number;
  invariant: string;
  semanticAction: string;
  factCategory: string;
  eventType: string;
  productionLayer: string;
  likelyFunctions: string[];
  minimalScenario: string;
  expected: string;
  actual: string;
  impact: ExpandedImpact[];
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  confidence: 'high' | 'medium';
}

export interface ExpandedRegressionReport {
  seed: number;
  baseScenarios: number;
  executionsPerScenario: number;
  generatedExecutions: number;
  assertions: number;
  pass: number;
  fail: number;
  passRate: number;
  failureClusters: ExpandedFailureCluster[];
  coverageByDomain: Record<ExpandedDomain, number>;
  fingerprint: string;
}

interface ReplayResult {
  state: ConversationState;
  turns: TranscriptTurn[];
  eventType: string;
  analysis: ReturnType<typeof buildLocalAnalysisResponse>;
  policyKey: string;
}

const INTERNAL_SPEECH = /принял(?:а)? поправку|дальше опираемся|canonical|semantic key|rule[_ -]?id|внутренн(?:ий|яя) логик/iu;
const ACTIVE = (status: string | undefined) => !['superseded', 'rejected'].includes(status || '');

function seededNumber(value: string): number {
  let hash = EXPANDED_REGRESSION_SEED >>> 0;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

function vary(text: string, variation: number, key: string): string {
  if (variation === 0) return text;
  const prefixes = ['', 'Итак, ', 'Смотрите, ', 'Если точнее, ', 'Вообще, ', 'По сути, ', 'На данный момент, ', 'Скажу прямо: '];
  const suffixes = ['', ' Это важно.', ' Именно так.', ' Вот такой запрос.', ' Я это уточняю.', ' Вот мой ориентир.', ' Это принципиально.', ' Такой план.'];
  const punctuation = ['.', '!', '…', ''];
  const n = seededNumber(`${key}:${variation}`);
  let result = `${prefixes[(n + variation) % prefixes.length]}${text.replace(/[.!?…]+$/u, '')}${suffixes[(n >>> 4) % suffixes.length]}`;
  result = result.replace(/[.!?…]+$/u, '') + (text.trim().endsWith('?') ? '?' : punctuation[(n >>> 9) % punctuation.length]);
  if (variation % 8 === 0) result = result.replace(/ё/giu, (match) => match === 'Ё' ? 'Е' : 'е');
  if (variation % 13 === 0) result = `  ${result.replace(/ /g, '  ')}  `;
  return result;
}

function makeTurn(sessionId: string, scenarioId: string, turnIndex: number, speaker: 'agent' | 'client', text: string): TranscriptTurn {
  const revision = turnIndex + 1;
  return {
    id: `${scenarioId}-t${revision}`,
    sessionId,
    source: speaker === 'agent' ? 'microphone' : 'call_audio',
    speaker,
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

function replay(scenario: ExpandedScenario, variation: number, sessionSuffix = ''): ReplayResult {
  const sessionId = `expanded-${scenario.id}-${variation}${sessionSuffix}`;
  const lastClientIndex = scenario.turns.reduce((last, item, index) => item.speaker === 'client' ? index : last, -1);
  const turns = scenario.turns.map((item, index) => makeTurn(
    sessionId,
    scenario.id,
    index,
    item.speaker,
    item.speaker === 'client' && index === lastClientIndex ? vary(item.text, variation, scenario.id) : item.text,
  ));
  let state = createInitialState();
  let eventType = 'none';
  for (let index = 0; index < turns.length; index += 1) {
    const detected = index === turns.length - 1
      ? detectConversationEvent(turns[index], turns, state, turns[index].timestamp)
      : null;
    const advanced = advanceLocalConversation(state, turns[index], turns.slice(0, index + 1));
    state = advanced.state;
    if (index === turns.length - 1) eventType = detected?.type || advanced.event?.type || 'none';
  }
  const latest = turns.at(-1)!;
  const analysis = buildLocalAnalysisResponse({
    sessionId,
    revision: latest.revision || turns.length,
    newTurns: [latest],
    recentTurns: turns,
    currentState: state,
  });
  const policy = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);
  return { state, turns, eventType, analysis, policyKey: policy?.semanticKey || 'none' };
}

function valueAt(state: ConversationState, fieldName: string): string {
  const value = (state as unknown as Record<string, unknown>)[fieldName] as { value?: string | null } | string | null | undefined;
  if (value && typeof value === 'object' && 'value' in value) return String(value.value || '');
  return typeof value === 'string' ? value : '';
}

function regexText(pattern: RegExp): string {
  return `/${pattern.source}/${pattern.flags}`;
}

function makeSuggestion(id: string, revision: number, priority: number, semanticKey: string, createdAt: number): SuggestedReply {
  return {
    id,
    sessionId: 'expanded-lifecycle',
    basedOnRevision: revision,
    candidateRuleId: id,
    text: id,
    shortReason: id,
    evidenceTurnIds: [],
    createdAt,
    stage: 'contact',
    actionType: 'CLARIFY',
    suggestionMode: 'WAIT',
    priority,
    semanticKey,
    source: 'local_engine',
    lifecycleStatus: 'shown',
    ttlMs: 60_000,
  };
}

function transportResult(mode: Extract<ExpandedCheck, { kind: 'transport' }>['mode'], input: string, variation: number): { okay: boolean; actual: string } {
  if (mode === 'partial') {
    const provider = new AnalysisProvider();
    provider.setSession(`expanded-partial-${variation}`);
    const partial = makeTurn(`expanded-partial-${variation}`, 'partial', 0, 'client', input);
    partial.isFinal = false;
    const eligibility = provider.checkEligibility(partial, 1);
    return { okay: !eligibility.eligible && /промежуточ/iu.test(eligibility.reason), actual: `${eligibility.eligible}:${eligibility.reason}` };
  }
  if (mode === 'duplicate_final') {
    const last = makeTurn('expanded-duplicate', 'duplicate', 0, 'client', input);
    const duplicate = isDuplicateFinalTurn(last, 'client', input, last.timestamp + 200);
    return { okay: duplicate, actual: `duplicate=${duplicate}` };
  }
  if (mode === 'amended_final') {
    const last = makeTurn('expanded-amend', 'amend', 0, 'client', input);
    const amended = aggregateFinalTurn(last, 'client', `${input} Уточнение изменяет смысл.`, last.timestamp + 200);
    return { okay: amended.kind === 'amend', actual: `${amended.kind}:${amended.text}` };
  }
  const last = makeTurn('expanded-order', 'order', 1, 'client', input);
  const earlier = aggregateFinalTurn(last, 'client', `${input} Ранняя версия.`, last.timestamp - 700);
  return { okay: earlier.kind === 'new', actual: `${earlier.kind}:${earlier.text}` };
}

function lifecycleResult(mode: Extract<ExpandedCheck, { kind: 'lifecycle' }>['mode'], variation: number): { okay: boolean; actual: string } {
  const now = 200_000 + variation;
  const current = makeSuggestion('current', 5, 100, 'current-action', now);
  if (mode === 'stale') {
    const accepted = shouldReplaceSuggestion(current, makeSuggestion('stale', 4, 130, 'stale-action', now + 1), now + 1);
    return { okay: !accepted, actual: `staleAccepted=${accepted}` };
  }
  if (mode === 'priority') {
    const accepted = shouldReplaceSuggestion(current, makeSuggestion('low', 6, 20, 'low-action', now + 1), now + 1);
    return { okay: !accepted, actual: `lowPriorityAccepted=${accepted}` };
  }
  const state = createInitialState();
  state.revision = 6;
  state.dialogueControl = { ...(state.dialogueControl || {}), blockedNextSteps: ['ppv'] } as ConversationState['dialogueControl'];
  const candidate = makeSuggestion('closed', 6, 90, 'ask-video', now + 1);
  candidate.closesMetric = 'ppv';
  candidate.text = 'Давайте назначим видеовстречу?';
  const accepted = isSuggestionAllowedByState(candidate, state, 6);
  return { okay: !accepted, actual: `closedBranchAccepted=${accepted}` };
}

function expectedFor(check: ExpandedCheck): string {
  if (check.kind === 'field') return `${check.field}${check.absent ? ' is null' : check.match ? ` matches ${regexText(check.match)}` : ` excludes ${regexText(check.notMatch!)}`}`;
  if (check.kind === 'metric') return `${check.metric} metric ${check.status ? `status=${JSON.stringify(check.status)} ` : ''}${check.match ? `matches ${regexText(check.match)}` : check.notMatch ? `excludes ${regexText(check.notMatch)}` : 'has expected status'}`;
  if (check.kind === 'event') return check.expected ? `event=${check.expected}` : `event!=${check.forbidden}`;
  if (check.kind === 'active_fact') return `active ${check.category} facts satisfy count/value/evidence contract`;
  if (check.kind === 'supersede') return `${check.category} old fact superseded by new fact with link`;
  if (check.kind === 'hint') return `hint ${check.required ? 'exists; ' : ''}${check.match ? `matches ${regexText(check.match)}; ` : ''}${check.notMatch ? `excludes ${regexText(check.notMatch)}; ` : ''}${check.maxQuestions != null ? `questions<=${check.maxQuestions}` : ''}`;
  if (check.kind === 'policy') return check.match ? `policy matches ${regexText(check.match)}` : `policy excludes ${regexText(check.notMatch!)}`;
  if (check.kind === 'analysis') return `semantic action ${check.action ? `in ${JSON.stringify(check.action)}; ` : ''}${check.closesMetric ? `metric in ${JSON.stringify(check.closesMetric)}; ` : ''}${check.candidateMatch ? `candidate matches ${regexText(check.candidateMatch)}` : check.candidateNotMatch ? `candidate excludes ${regexText(check.candidateNotMatch)}` : ''}`;
  if (check.kind === 'evidence_latest') return 'recommendation evidence includes latest client turn';
  if (check.kind === 'transport') return `${check.mode} transport semantics preserved`;
  if (check.kind === 'lifecycle') return `${check.mode} candidate rejected`;
  return `${check.field} isolated between sessions`;
}

function addFailure(failures: ExpandedFailure[], scenario: ExpandedScenario, variation: number, replayed: ReplayResult, expected: string, actual: unknown, invariant = scenario.invariant) {
  const input = replayed.turns.map((turn) => `${turn.speaker}: ${turn.text}`).join(' -> ');
  failures.push({
    scenarioId: scenario.id,
    domain: scenario.domain,
    variation,
    invariant,
    semanticAction: scenario.semanticAction,
    factCategory: scenario.factCategory,
    eventType: replayed.eventType,
    productionLayer: scenario.productionLayer,
    likelyFunctions: scenario.likelyFunctions,
    input,
    expected,
    actual: String(actual ?? 'null'),
    impact: scenario.impact,
    severity: scenario.severity,
  });
}

function runCheck(check: ExpandedCheck, scenario: ExpandedScenario, variation: number, replayed: ReplayResult, failures: ExpandedFailure[]): number {
  const expected = expectedFor(check);
  if (check.kind === 'field') {
    const value = valueAt(replayed.state, check.field);
    const okay = check.absent ? !value : check.match ? check.match.test(value) : !check.notMatch!.test(value);
    if (!okay) addFailure(failures, scenario, variation, replayed, expected, `${check.field}=${value || 'null'}`);
  } else if (check.kind === 'metric') {
    const entry = replayed.state.scriptProgress?.metrics?.[check.metric];
    const statuses = Array.isArray(check.status) ? check.status : check.status ? [check.status] : [];
    const statusOkay = statuses.length === 0 || statuses.includes(String(entry?.status || 'missing'));
    const value = String(entry?.value || '');
    const valueOkay = check.match ? check.match.test(value) : check.notMatch ? !check.notMatch.test(value) : true;
    if (!statusOkay || !valueOkay) addFailure(failures, scenario, variation, replayed, expected, `${check.metric}=${entry?.status || 'missing'}:${value || 'null'}`);
  } else if (check.kind === 'event') {
    const okay = check.expected ? replayed.eventType === check.expected : replayed.eventType !== check.forbidden;
    if (!okay) addFailure(failures, scenario, variation, replayed, expected, `event=${replayed.eventType}`);
  } else if (check.kind === 'active_fact') {
    const active = (replayed.state.confirmedFacts || []).filter((fact) => fact.category === check.category && ACTIVE(fact.lifecycleStatus));
    const countOkay = check.count == null || active.filter((fact) => !check.match || check.match.test(fact.value)).length === check.count;
    const matchOkay = !check.match || check.count === 0 || active.some((fact) => check.match!.test(fact.value));
    const notMatchOkay = !check.notMatch || active.every((fact) => !check.notMatch!.test(fact.value));
    const latestClient = [...replayed.turns].reverse().find((turn) => turn.speaker === 'client');
    const evidenceOkay = !check.evidenceLastClient || active.some((fact) => fact.turnId === latestClient?.id && fact.evidenceQuote);
    if (!countOkay || !matchOkay || !notMatchOkay || !evidenceOkay) addFailure(failures, scenario, variation, replayed, expected, JSON.stringify(active.map((fact) => ({ value: fact.value, turnId: fact.turnId, status: fact.lifecycleStatus }))));
  } else if (check.kind === 'supersede') {
    const oldId = replayed.turns[check.oldTurn]?.id;
    const newId = replayed.turns[check.newTurn]?.id;
    const facts = (replayed.state.confirmedFacts || []).filter((fact) => fact.category === check.category);
    const oldFact = facts.find((fact) => fact.turnId === oldId);
    const newFact = facts.find((fact) => fact.turnId === newId);
    const active = facts.filter((fact) => ACTIVE(fact.lifecycleStatus));
    const okay = oldFact?.lifecycleStatus === 'superseded' && newFact?.lifecycleStatus === 'confirmed' && newFact.supersedesFactId === oldFact.id && active.length === 1;
    if (!okay) addFailure(failures, scenario, variation, replayed, expected, JSON.stringify(facts.map((fact) => ({ value: fact.value, turnId: fact.turnId, status: fact.lifecycleStatus, supersedes: fact.supersedesFactId }))));
  } else if (check.kind === 'hint') {
    const hint = replayed.analysis.suggestedReply || '';
    const okay = (!check.required || Boolean(hint)) && (!check.match || check.match.test(hint)) && (!check.notMatch || !check.notMatch.test(hint)) && (check.maxQuestions == null || (hint.match(/\?/gu) || []).length <= check.maxQuestions);
    if (!okay) addFailure(failures, scenario, variation, replayed, expected, hint || 'null');
  } else if (check.kind === 'policy') {
    const okay = check.match ? check.match.test(replayed.policyKey) : !check.notMatch!.test(replayed.policyKey);
    if (!okay) addFailure(failures, scenario, variation, replayed, expected, `policy=${replayed.policyKey}`);
  } else if (check.kind === 'analysis') {
    const actions = Array.isArray(check.action) ? check.action : check.action ? [check.action] : [];
    const metrics = Array.isArray(check.closesMetric) ? check.closesMetric : check.closesMetric ? [check.closesMetric] : [];
    const candidate = String(replayed.analysis.candidateRuleId || 'none');
    const actionOkay = actions.length === 0 || actions.includes(String(replayed.analysis.actionType || 'none'));
    const metricOkay = metrics.length === 0 || metrics.includes(String(replayed.analysis.closesMetric || 'none'));
    const candidateOkay = (!check.candidateMatch || check.candidateMatch.test(candidate)) && (!check.candidateNotMatch || !check.candidateNotMatch.test(candidate));
    if (!actionOkay || !metricOkay || !candidateOkay) addFailure(failures, scenario, variation, replayed, expected, `action=${replayed.analysis.actionType || 'none'}; metric=${replayed.analysis.closesMetric || 'none'}; candidate=${candidate}`);
  } else if (check.kind === 'evidence_latest') {
    const latest = [...replayed.turns].reverse().find((turn) => turn.speaker === 'client');
    const evidence = replayed.analysis.evidenceTurnIds || [];
    if (!latest || !evidence.includes(latest.id)) addFailure(failures, scenario, variation, replayed, expected, `latest=${latest?.id || 'none'}; evidence=${evidence.join(',') || 'none'}`);
  } else if (check.kind === 'transport') {
    const result = transportResult(check.mode, replayed.turns.at(-1)!.text, variation);
    if (!result.okay) addFailure(failures, scenario, variation, replayed, expected, result.actual);
  } else if (check.kind === 'lifecycle') {
    const result = lifecycleResult(check.mode, variation);
    if (!result.okay) addFailure(failures, scenario, variation, replayed, expected, result.actual);
  } else {
    const secondScenario: ExpandedScenario = { ...scenario, turns: [{ speaker: 'client', text: check.otherText }], checks: [] };
    const other = replay(secondScenario, variation, '-other');
    const firstValue = valueAt(replayed.state, check.field);
    const secondValue = valueAt(other.state, check.field);
    const okay = check.firstMatch.test(firstValue) && check.secondMatch.test(secondValue) && firstValue !== secondValue;
    if (!okay) addFailure(failures, scenario, variation, replayed, expected, `A=${firstValue || 'null'}; B=${secondValue || 'null'}`);
  }
  return 1;
}

function normalizeSignature(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/expanded-[\w.-]+/gu, '<id>')
    .replace(/\d+/gu, '#')
    .replace(/\s+/gu, ' ')
    .slice(0, 260);
}

function expectedClusterSignature(failure: ExpandedFailure): string {
  const expected = failure.expected;
  if (/^event[!=]/u.test(expected)) return normalizeSignature(expected);
  if (/^policy /u.test(expected)) return 'policy-contract';
  if (/^semantic action /u.test(expected)) return 'semantic-action-contract';
  if (/^recommendation evidence /u.test(expected)) return 'latest-evidence-contract';
  if (/ isolated between sessions$/u.test(expected)) return 'session-isolation-contract';
  if (/^hint /u.test(expected)) return 'hint-contract';
  return `${failure.factCategory}:expected-semantic-contract`;
}

function actualClusterSignature(failure: ExpandedFailure): string {
  if (/^event=/u.test(failure.actual)) return normalizeSignature(failure.actual);
  if (/^policy=/u.test(failure.actual)) return normalizeSignature(failure.actual);
  if (/^action=/u.test(failure.actual)) return normalizeSignature(failure.actual.replace(/candidate=[^;]+/u, 'candidate=<rule>'));
  if (/^A=/u.test(failure.actual)) return 'session-values-do-not-match-seeds';
  if (/^latest=/u.test(failure.actual)) return 'latest-evidence-missing';
  if (failure.expected.startsWith('hint ')) return 'hint-contract-mismatch';
  return `${failure.factCategory}:actual-semantic-contract-mismatch`;
}

function clusterFailures(failures: ExpandedFailure[]): ExpandedFailureCluster[] {
  const clusters = new Map<string, ExpandedFailureCluster>();
  for (const failure of failures) {
    const key = [
      failure.invariant,
      failure.semanticAction,
      failure.factCategory,
      failure.eventType,
      failure.productionLayer,
      expectedClusterSignature(failure),
      actualClusterSignature(failure),
    ].join('|');
    const current = clusters.get(key);
    if (current) {
      current.count += 1;
      continue;
    }
    clusters.set(key, {
      id: createHash('sha256').update(key).digest('hex').slice(0, 12),
      count: 1,
      invariant: failure.invariant,
      semanticAction: failure.semanticAction,
      factCategory: failure.factCategory,
      eventType: failure.eventType,
      productionLayer: failure.productionLayer,
      likelyFunctions: failure.likelyFunctions,
      minimalScenario: failure.input.trim(),
      expected: failure.expected,
      actual: failure.actual,
      impact: failure.impact,
      severity: failure.severity,
      confidence: failure.likelyFunctions.length > 0 ? 'high' : 'medium',
    });
  }
  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return [...clusters.values()].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.count - a.count || a.id.localeCompare(b.id));
}

export function runExpandedRegression(): ExpandedRegressionReport {
  const failures: ExpandedFailure[] = [];
  let assertions = 0;
  const coverageByDomain = Object.fromEntries([
    'goal', 'criteria', 'finance', 'timeline', 'decision_maker', 'experience', 'material_request', 'objection', 'correction', 'negation', 'transcript_transport', 'session_isolation', 'next_action', 'recommendation_quality',
  ].map((domain) => [domain, 0])) as Record<ExpandedDomain, number>;

  for (const scenario of EXPANDED_REGRESSION_SCENARIOS) {
    coverageByDomain[scenario.domain] += 1;
    for (let variation = 0; variation < EXPANDED_EXECUTIONS_PER_SCENARIO; variation += 1) {
      const replayed = replay(scenario, variation);
      for (const check of scenario.checks) assertions += runCheck(check, scenario, variation, replayed, failures);
      const hint = replayed.analysis.suggestedReply || '';
      if (hint) {
        assertions += 2;
        if (hint.length > 220) addFailure(failures, scenario, variation, replayed, '<= 220 characters', `${hint.length} chars: ${hint}`, 'INV_HINT_LENGTH');
        if (INTERNAL_SPEECH.test(hint)) addFailure(failures, scenario, variation, replayed, 'agent-speakable text without internal terms', hint, 'INV_NO_INTERNAL_SPEECH');
      }
    }
  }

  const failureClusters = clusterFailures(failures);
  const fail = failures.length;
  const pass = assertions - fail;
  const fingerprint = createHash('sha256').update(JSON.stringify({
    seed: EXPANDED_REGRESSION_SEED,
    scenarios: EXPANDED_REGRESSION_SCENARIOS.map((item) => item.id),
    failures: failures.map((item) => [item.scenarioId, item.variation, item.invariant, normalizeSignature(item.actual)]),
  })).digest('hex');

  return {
    seed: EXPANDED_REGRESSION_SEED,
    baseScenarios: EXPANDED_REGRESSION_SCENARIOS.length,
    executionsPerScenario: EXPANDED_EXECUTIONS_PER_SCENARIO,
    generatedExecutions: EXPANDED_REGRESSION_SCENARIOS.length * EXPANDED_EXECUTIONS_PER_SCENARIO,
    assertions,
    pass,
    fail,
    passRate: Number(((pass / assertions) * 100).toFixed(2)),
    failureClusters,
    coverageByDomain,
    fingerprint,
  };
}
