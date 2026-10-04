import { createHash } from 'node:crypto';
import type { ConversationState, SuggestedReply, TranscriptTurn } from '../../types';
import { detectConversationEvent } from '../conversationEventEngine';
import { AnalysisProvider } from '../analysisProvider';
import { createInitialState } from '../conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from '../localAnalysisEngine';
import { isSuggestionAllowedByState, shouldReplaceSuggestion } from '../suggestionLifecycle';
import { aggregateFinalTurn, isDuplicateFinalTurn } from '../sttDedup';
import { emitRegressionObservation, type RegressionObservationOptions } from './regressionObservation';
import {
  MASS_REGRESSION_GOLDEN_CASES,
  MASS_REGRESSION_SEED,
  VARIATIONS_PER_CASE,
  type GoldenCase,
} from '../test-fixtures/massRegressionGoldenCases';

export interface BaselineFailure {
  priority: 'P0' | 'P1';
  invariant: string;
  caseId: string;
  variation: number;
  input: string;
  expected: string;
  actual: string;
  probableLayer: string;
  files: string[];
}

export interface FailureCluster {
  key: string;
  priority: 'P0' | 'P1';
  invariant: string;
  probableLayer: string;
  signature: string;
  count: number;
  minimalScenario: string;
  expected: string;
  actual: string;
  files: string[];
  confidence: 'high';
}

export interface MassRegressionReport {
  seed: number;
  baseGoldenCases: number;
  variationsPerCase: number;
  generatedScenarios: number;
  assertions: number;
  pass: number;
  fail: number;
  passRate: number;
  failureClusters: FailureCluster[];
  fingerprint: string;
}

interface CaseMeta {
  id: string;
  invariant: string;
  priority: 'P0' | 'P1';
}

const INTERNAL_SPEECH = /принял(?:а)? поправку|дальше опираемся|canonical|semantic key|state|метрик(?:а|у|и)|rule[_ -]?id|внутренн(?:ий|яя) логик/iu;
const FIELD_TO_METRIC: Record<string, string> = {
  goal: 'goal', location: 'location', budget: 'budget', paymentMethod: 'paymentMethod',
  purchaseTimeline: 'urgency', decisionMakers: 'decisionMaker', criteria: 'criteria',
  propertyType: 'propertyType', familyMortgage: 'familyMortgage', searchExperience: 'experience',
  downPayment: 'downPayment',
};

function seededNumber(value: string): number {
  let hash = MASS_REGRESSION_SEED >>> 0;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

function surfaceVariation(text: string, variation: number, caseId: string): string {
  if (variation === 0) return text;
  const prefixes = ['', 'Ну, ', 'Слушайте, ', 'Вообще, ', 'Если честно, ', 'Смотрите, ', 'Да, ', 'В целом, '];
  const suffixes = ['', ' Понимаете?', ' Вот так.', ' Это важно.', ' Пока так.', ' Именно.', ' Без спешки.', ' На данный момент.'];
  const punctuation = ['', '.', '!', '…'];
  const n = seededNumber(`${caseId}:${variation}`);
  let result = `${prefixes[(n + variation) % prefixes.length]}${text.replace(/[.!?…]+$/u, '')}${suffixes[(n >>> 3) % suffixes.length]}`;
  result = result.replace(/[.!?…]+$/u, '') + punctuation[(n >>> 7) % punctuation.length];
  if (variation % 7 === 0) result = result.toLocaleUpperCase('ru-RU');
  if (variation % 5 === 0) result = result.replace(/ё/giu, (match) => match === 'Ё' ? 'Е' : 'е');
  if (variation % 11 === 0) result = `  ${result.replace(/ /g, '  ')}  `;
  return result;
}

function turn(sessionId: string, id: string, speaker: 'agent' | 'client', text: string, revision: number): TranscriptTurn {
  return { id, sessionId, source: speaker === 'agent' ? 'microphone' : 'call_audio', speaker, text, timestamp: revision * 1000, isFinal: true, revision };
}

function fieldValue(state: ConversationState, field: string): string {
  const entry = (state as unknown as Record<string, { value?: string | null }>)[field];
  return String(entry?.value || '');
}

function semanticallyConsistent(left: string, right: string): boolean {
  const normalize = (value: string) => value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const contradictoryFamilies: Array<[RegExp, RegExp]> = [
    [/нет детей|не примен/iu, /есть дет|ребен|ребён|семейн/iu],
    [/ипотек/iu, /собствен|налич|свои средств/iu],
    [/инвест|вложен|капитал|доход/iu, /постоянн.{0,12}(?:жизн|прожив)|пмж|переезд/iu],
  ];
  if (contradictoryFamilies.some(([first, second]) => (first.test(a) && second.test(b)) || (second.test(a) && first.test(b)))) return false;
  const families = [
    /инвест|вложен|капитал|доход/iu,
    /жизн|прожив|пмж|переезд/iu,
    /для себя|личн\p{L}*\s+использ/iu,
    /ипотек/iu,
    /собствен|налич|свои средств/iu,
    /нет детей|не примен/iu,
    /есть дет|семейн|ребен|ребён/iu,
    /видов|вид на|море|горы/iu,
    /тиш|шум/iu,
  ];
  if (families.some((family) => family.test(a) && family.test(b))) return true;
  const numbersA = new Set(a.match(/\d+/gu) || []);
  const numbersB = new Set(b.match(/\d+/gu) || []);
  return numbersA.size > 0 && [...numbersA].some((number) => numbersB.has(number));
}

function pipeline(sessionId: string, currentText: string, previousAgentText?: string, previousClientText?: string) {
  const turns: TranscriptTurn[] = [];
  if (previousClientText) turns.push(turn(sessionId, 'c0', 'client', previousClientText, 1));
  if (previousAgentText) turns.push(turn(sessionId, 'a0', 'agent', previousAgentText, turns.length + 1));
  turns.push(turn(sessionId, 'c1', 'client', currentText, turns.length + 1));
  let state = createInitialState();
  const latest = turns.at(-1)!;
  for (let i = 0; i < turns.length - 1; i += 1) state = advanceLocalConversation(state, turns[i], turns.slice(0, i + 1)).state;
  const event = detectConversationEvent(latest, turns, state, latest.timestamp);
  state = advanceLocalConversation(state, latest, turns).state;
  const analysis = buildLocalAnalysisResponse({ sessionId, revision: latest.revision!, newTurns: [latest], recentTurns: turns, currentState: state });
  return { turns, state, latest, event, analysis };
}

function suggestion(id: string, sessionId: string, revision: number, priority: number, semanticKey: string, createdAt: number): SuggestedReply {
  return {
    id, sessionId, basedOnRevision: revision, candidateRuleId: id, text: id, shortReason: id,
    evidenceTurnIds: [], createdAt, stage: 'contact', actionType: 'CLARIFY', suggestionMode: 'WAIT',
    priority, semanticKey, source: 'local_engine', lifecycleStatus: 'shown', ttlMs: 60_000,
  };
}

function addFailure(failures: BaselineFailure[], testCase: CaseMeta, variation: number, input: string, expected: string, actual: unknown, probableLayer: string, files: string[]) {
  failures.push({
    priority: testCase.priority, invariant: testCase.invariant, caseId: testCase.id, variation, input,
    expected, actual: String(actual ?? 'null'), probableLayer, files,
  });
}

function checkHint(failures: BaselineFailure[], testCase: CaseMeta, variation: number, input: string, hint: string | null | undefined) {
  if (!hint) return;
  if (hint.length > 220) addFailure(failures, { ...testCase, invariant: 'INV_HINT_LENGTH' }, variation, input, '<= 220 chars', `${hint.length} chars: ${hint}`, 'recommendation presentation', ['src/services/localAnalysisEngine.ts', 'src/services/spinEngine.ts']);
  if (INTERNAL_SPEECH.test(hint)) addFailure(failures, { ...testCase, invariant: 'INV_NO_INTERNAL_SPEECH' }, variation, input, 'agent-speakable text without internal terms', hint, 'recommendation presentation', ['src/services/localAnalysisEngine.ts']);
}

function runCase(testCase: GoldenCase, variation: number, failures: BaselineFailure[], options: RegressionObservationOptions = {}): number {
  const input = surfaceVariation(testCase.text, variation, testCase.id);
  const before = failures.length;
  let assertions = 0;

  if (testCase.kind === 'event') {
    const state = createInitialState();
    const current = turn(`mass-${testCase.id}-${variation}`, 't1', testCase.speaker === 'agent' ? 'agent' : 'client', input, 1);
    const event = detectConversationEvent(current, [current], state, current.timestamp);
    assertions += 1;
    if (event?.type !== testCase.expectedEvent) addFailure(failures, testCase, variation, input, `event=${testCase.expectedEvent}`, `event=${event?.type || 'null'}`, 'event detection', ['src/services/conversationEventEngine.ts', 'src/services/conversationEventEngineLegacy.ts', 'conversation-events.json']);
    if (testCase.expectedAction) {
      assertions += 1;
      if (event?.actionType !== testCase.expectedAction) addFailure(failures, testCase, variation, input, `action=${testCase.expectedAction}`, `action=${event?.actionType || 'null'}`, 'event routing', ['src/services/conversationEventEngineLegacy.ts']);
    }
    checkHint(failures, testCase, variation, input, event?.suggestedReply);
    assertions += event?.suggestedReply ? 2 : 0;
  }

  if (testCase.kind === 'fact') {
    const result = pipeline(`mass-${testCase.id}-${variation}`, input, testCase.previousAgentText, testCase.previousClientText);
    if (options.observation) emitRegressionObservation({ harness: 'original', caseId: testCase.id, variation, instance: 'primary', turnCutoff: result.turns.length }, result, options);
    const value = fieldValue(result.state, testCase.field);
    if (testCase.expectedValue) {
      assertions += 1;
      if (!testCase.expectedValue.test(value)) addFailure(failures, testCase, variation, input, `${testCase.field} matches ${testCase.expectedValue}`, `${testCase.field}=${value || 'null'}`, 'canonical fact extraction', ['src/services/deterministicFacts.ts', 'src/services/conversationStore.ts']);
    }
    if (testCase.forbiddenValue) {
      assertions += 1;
      if (testCase.forbiddenValue.test(value)) addFailure(failures, testCase, variation, input, `${testCase.field} does not match ${testCase.forbiddenValue}`, `${testCase.field}=${value}`, 'negation/canonical fact extraction', ['src/services/deterministicFacts.ts', 'src/services/conversationStore.ts']);
    }
    if (testCase.expectedEvent) {
      assertions += 1;
      if (result.event?.type !== testCase.expectedEvent) addFailure(failures, testCase, variation, input, `event=${testCase.expectedEvent}`, `event=${result.event?.type || 'null'}`, 'event detection', ['src/services/conversationEventEngine.ts', 'src/services/conversationEventEngineLegacy.ts']);
    }
    if (testCase.forbiddenEvent) {
      assertions += 1;
      if (result.event?.type === testCase.forbiddenEvent) addFailure(failures, testCase, variation, input, `event!=${testCase.forbiddenEvent}`, `event=${result.event.type}`, 'event detection', ['src/services/conversationEventEngineLegacy.ts']);
    }
    const metricKey = FIELD_TO_METRIC[testCase.field];
    const metricValue = metricKey ? result.state.scriptProgress?.metrics?.[metricKey]?.value : null;
    if (value && metricValue) {
      assertions += 1;
      if (!semanticallyConsistent(value, String(metricValue))) addFailure(failures, { ...testCase, invariant: 'INV_CONSISTENCY' }, variation, input, `state.${testCase.field}=${value} is semantically consistent with scriptProgress.${metricKey}`, `scriptProgress=${metricValue}`, 'cross-layer projection', ['src/services/firstCallScriptEngine.ts', 'src/services/conversationStore.ts']);
    }
    checkHint(failures, testCase, variation, input, result.analysis.suggestedReply);
    assertions += result.analysis.suggestedReply ? 2 : 0;
  }

  if (testCase.kind === 'analysis') {
    const result = pipeline(`mass-${testCase.id}-${variation}`, input, testCase.previousAgentText);
    if (options.observation) emitRegressionObservation({ harness: 'original', caseId: testCase.id, variation, instance: 'primary', turnCutoff: result.turns.length }, result, options);
    const hint = result.analysis.suggestedReply || '';
    assertions += 1;
    if (testCase.forbiddenHint.test(hint)) addFailure(failures, testCase, variation, input, `hint does not match ${testCase.forbiddenHint}`, hint, 'next-action/recommendation selection', ['src/services/localAnalysisEngine.ts', 'src/services/dialoguePolicyEngine.ts']);
    if (testCase.expectedEvent) {
      assertions += 1;
      if (result.event?.type !== testCase.expectedEvent) addFailure(failures, testCase, variation, input, `event=${testCase.expectedEvent}`, `event=${result.event?.type || 'null'}`, 'event detection', ['src/services/conversationEventEngine.ts']);
    }
    checkHint(failures, testCase, variation, input, hint);
    assertions += hint ? 2 : 0;
  }

  if (testCase.kind === 'isolation') {
    const first = pipeline(`mass-a-${testCase.id}-${variation}`, input);
    const otherInput = surfaceVariation(testCase.otherText, variation, `${testCase.id}.other`);
    const second = pipeline(`mass-b-${testCase.id}-${variation}`, otherInput);
    if (options.observation) {
      emitRegressionObservation({ harness: 'original', caseId: testCase.id, variation, instance: 'isolation-a', turnCutoff: first.turns.length }, first, options);
      emitRegressionObservation({ harness: 'original', caseId: testCase.id, variation, instance: 'isolation-b', turnCutoff: second.turns.length }, second, options);
    }
    const firstValue = fieldValue(first.state, testCase.field);
    const secondValue = fieldValue(second.state, testCase.field);
    assertions += 3;
    if (!testCase.expectedValue.test(firstValue)) addFailure(failures, testCase, variation, input, `session A ${testCase.field} matches ${testCase.expectedValue}`, firstValue || 'null', 'session state', ['src/services/conversationStore.ts']);
    if (!testCase.otherExpectedValue.test(secondValue)) addFailure(failures, testCase, variation, otherInput, `session B ${testCase.field} matches ${testCase.otherExpectedValue}`, secondValue || 'null', 'session state', ['src/services/conversationStore.ts']);
    if (firstValue === secondValue) addFailure(failures, testCase, variation, `${input} | ${otherInput}`, 'isolated canonical values', `both=${firstValue || 'null'}`, 'session state', ['src/services/conversationStore.ts']);
  }

  if (testCase.kind === 'lifecycle') {
    const now = 100_000 + variation;
    const current = suggestion('current', 'session-a', 5, 100, 'high-value', now);
    let okay = true;
    if (testCase.mode === 'stale') okay = !shouldReplaceSuggestion(current, suggestion('stale', 'session-a', 4, 130, 'old', now + 1), now + 1);
    if (testCase.mode === 'low-cannot-replace-high') okay = !shouldReplaceSuggestion(current, suggestion('low', 'session-a', 6, 20, 'low-value', now + 1), now + 1);
    if (testCase.mode === 'closed-branch') {
      const state = createInitialState();
      state.revision = 6;
      state.dialogueControl = { ...(state.dialogueControl || {}), blockedNextSteps: ['ppv'] } as ConversationState['dialogueControl'];
      const candidate = suggestion('closed', 'session-a', 6, 90, 'ask-video', now + 1);
      candidate.closesMetric = 'ppv';
      candidate.text = 'Давайте назначим видеовстречу?';
      okay = !isSuggestionAllowedByState(candidate, state, 6);
    }
    assertions += 1;
    if (!okay) addFailure(failures, testCase, variation, input, 'candidate rejected', 'candidate accepted', 'suggestion lifecycle', ['src/services/suggestionLifecycle.ts', 'src/services/recommendationArbiter.ts']);
  }

  if (testCase.kind === 'transport') {
    const mode = variation % 4;
    let okay = false;
    let actual = '';
    if (mode === 0) {
      const provider = new AnalysisProvider();
      provider.setSession(`mass-transport-${variation}`);
      const partial = turn(`mass-transport-${variation}`, 'partial', 'client', input, 1);
      partial.isFinal = false;
      const eligibility = provider.checkEligibility(partial, 1);
      okay = !eligibility.eligible && /промежуточ/iu.test(eligibility.reason);
      actual = `${eligibility.eligible}:${eligibility.reason}`;
    } else if (mode === 1) {
      const last = turn('mass-transport', 'final-1', 'client', input, 1);
      okay = isDuplicateFinalTurn(last, 'client', input, last.timestamp + 250);
      actual = `duplicate=${okay}`;
    } else if (mode === 2) {
      const last = turn('mass-transport', 'final-1', 'client', 'Ипотека нужна.', 1);
      const merged = aggregateFinalTurn(last, 'client', 'Ипотека не нужна.', last.timestamp + 250);
      okay = merged.kind === 'new';
      actual = `${merged.kind}:${merged.text}`;
    } else {
      const last = turn('mass-transport', 'final-1', 'client', input, 2);
      const merged = aggregateFinalTurn(last, 'client', `${input} Уточняю.`, last.timestamp - 500);
      okay = merged.kind === 'new';
      actual = `${merged.kind}:${merged.text}`;
    }
    assertions += 1;
    if (!okay) addFailure(failures, testCase, variation, input, 'partial/duplicate/revision ordering preserved', actual, 'STT/analysis eligibility boundary', ['src/services/analysisProvider.ts', 'src/services/sttDedup.ts']);
  }

  return assertions - (failures.length - before);
}

function clusterFailures(failures: BaselineFailure[]): FailureCluster[] {
  const clusters = new Map<string, FailureCluster>();
  for (const failure of failures) {
    const signature = failure.actual.replace(/\d+/g, '#').slice(0, 180);
    const key = `${failure.priority}|${failure.invariant}|${failure.probableLayer}|${signature}`;
    const current = clusters.get(key);
    if (current) current.count += 1;
    else clusters.set(key, {
      key: createHash('sha256').update(key).digest('hex').slice(0, 12),
      priority: failure.priority,
      invariant: failure.invariant,
      probableLayer: failure.probableLayer,
      signature,
      count: 1,
      minimalScenario: failure.input.trim(),
      expected: failure.expected,
      actual: failure.actual,
      files: failure.files,
      confidence: 'high',
    });
  }
  return [...clusters.values()].sort((a, b) => a.priority.localeCompare(b.priority) || b.count - a.count || a.key.localeCompare(b.key));
}

export function runMassRegressionBaseline(options: RegressionObservationOptions = {}): MassRegressionReport {
  const failures: BaselineFailure[] = [];
  let assertions = 0;
  for (const testCase of MASS_REGRESSION_GOLDEN_CASES) {
    for (let variation = 0; variation < VARIATIONS_PER_CASE; variation += 1) {
      const before = failures.length;
      const passedAssertions = runCase(testCase, variation, failures, options);
      assertions += passedAssertions + (failures.length - before);
    }
  }
  const failureClusters = clusterFailures(failures);
  const fail = failures.length;
  const pass = assertions - fail;
  const fingerprint = createHash('sha256').update(JSON.stringify({
    seed: MASS_REGRESSION_SEED,
    cases: MASS_REGRESSION_GOLDEN_CASES.map((item) => item.id),
    failures: failures.map((item) => [item.invariant, item.caseId, item.variation, item.actual]),
  })).digest('hex');
  return {
    seed: MASS_REGRESSION_SEED,
    baseGoldenCases: MASS_REGRESSION_GOLDEN_CASES.length,
    variationsPerCase: VARIATIONS_PER_CASE,
    generatedScenarios: MASS_REGRESSION_GOLDEN_CASES.length * VARIATIONS_PER_CASE,
    assertions,
    pass,
    fail,
    passRate: Number(((pass / assertions) * 100).toFixed(2)),
    failureClusters,
    fingerprint,
  };
}
