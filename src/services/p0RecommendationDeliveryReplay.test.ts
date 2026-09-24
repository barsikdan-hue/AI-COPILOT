import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallSessionRecord, SuggestedReply } from '../types';
import { isPendingSuggestionSuperseded, shouldReplaceSuggestion } from './suggestionLifecycle';

/**
 * P0 delivery regression harness.
 *
 * This file intentionally does NOT fix production code. It drives the real App
 * callbacks while replacing only React's hook runtime and browser persistence so
 * the recommendation lifecycle can be replayed in Vitest's node environment.
 */
const runtime = vi.hoisted(() => ({
  stateSlots: [] as unknown[],
  refSlots: [] as Array<{ current: unknown }>,
  stateCursor: 0,
  refCursor: 0,
  savedRecords: [] as CallSessionRecord[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<any>();

  const useState = (initialValue: unknown) => {
    const index = runtime.stateCursor++;
    if (!Object.prototype.hasOwnProperty.call(runtime.stateSlots, index)) {
      runtime.stateSlots[index] =
        typeof initialValue === 'function' ? (initialValue as () => unknown)() : initialValue;
    }
    const setValue = (nextValue: unknown) => {
      const previous = runtime.stateSlots[index];
      runtime.stateSlots[index] =
        typeof nextValue === 'function'
          ? (nextValue as (previous: unknown) => unknown)(previous)
          : nextValue;
    };
    return [runtime.stateSlots[index], setValue];
  };

  const useRef = (initialValue: unknown) => {
    const index = runtime.refCursor++;
    if (!runtime.refSlots[index]) runtime.refSlots[index] = { current: initialValue };
    return runtime.refSlots[index];
  };

  const useEffect = () => undefined;
  const useCallback = <T extends (...args: any[]) => any>(callback: T): T => callback;

  const defaultReact = actual.default || actual;
  return {
    ...actual,
    default: {
      ...defaultReact,
      useState,
      useRef,
      useEffect,
      useCallback,
    },
    useState,
    useRef,
    useEffect,
    useCallback,
  };
});

vi.mock('./sessionStorage', () => ({
  getAllCallSessions: vi.fn(async () => []),
  saveCallSession: vi.fn(async (record: CallSessionRecord) => {
    runtime.savedRecords.push(record);
  }),
  deleteCallSession: vi.fn(async () => undefined),
  clearAllSessions: vi.fn(async () => undefined),
}));

import { App } from '../App';

const SESSION_10_DIRECT_QUESTION =
  'Сэм Дэниел, и что же у вас есть, чего я ещё не видел в этих бесконечных презентациях?';
const SESSION_10_SOFT_RESISTANCE =
  'И да, сразу скажу, давайте вы просто скинете мне цены и планировки, я сам гляну, без очередного часового представления, ладно?';

function resetHookRuntime() {
  runtime.stateSlots.length = 0;
  runtime.refSlots.length = 0;
  runtime.savedRecords.length = 0;
  runtime.stateCursor = 0;
  runtime.refCursor = 0;
}

function renderApp(): ReactElement {
  runtime.stateCursor = 0;
  runtime.refCursor = 0;
  return App() as ReactElement;
}

function childrenOf(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  const children = node.props?.children;
  if (children == null) return [];
  return Array.isArray(children) ? children : [children];
}

function findElement(root: any, predicate: (element: any) => boolean): any {
  if (!root || typeof root !== 'object') return null;
  if (root.props && predicate(root)) return root;
  for (const child of childrenOf(root)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function getSimulator(root: ReactElement) {
  return findElement(root, (element) => typeof element.props?.onInjectTurn === 'function');
}

function getAudioControls(root: ReactElement) {
  return findElement(
    root,
    (element) =>
      typeof element.props?.onTogglePause === 'function' &&
      typeof element.props?.onEndCall === 'function'
  );
}

function getSuggestionCard(root: ReactElement) {
  return findElement(
    root,
    (element) =>
      Object.prototype.hasOwnProperty.call(element.props || {}, 'shouldSuggest') &&
      typeof element.props?.onDismissSuggestion === 'function'
  );
}

function getClientContext(root: ReactElement) {
  return findElement(root, (element) => typeof element.props?.onAskField === 'function');
}

function inject(root: ReactElement, speaker: 'agent' | 'client', text: string): ReactElement {
  const simulator = getSimulator(root);
  expect(simulator, 'CallSimulatorModal must expose onInjectTurn').toBeTruthy();
  simulator.props.onInjectTurn(speaker, text);
  return renderApp();
}

async function endAndCapture(root: ReactElement): Promise<CallSessionRecord> {
  const controls = getAudioControls(root);
  expect(controls, 'AudioControls must expose onEndCall').toBeTruthy();
  await controls.props.onEndCall();
  const record = runtime.savedRecords.at(-1);
  expect(record, 'session record must be persisted at call end').toBeTruthy();
  return record!;
}

beforeEach(() => {
  resetHookRuntime();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-24T12:00:00.000Z'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ summary: {} }),
    }))
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('P0 recommendation delivery replay', () => {
  it('replays session 10: pause/resume must not let an invisible old P0 card block the next valid client recommendation', async () => {
    let tree = renderApp();

    // Real client wording from call_record_2026-09-24_sessio 10.json.
    tree = inject(tree, 'client', SESSION_10_DIRECT_QUESTION);
    let card = getSuggestionCard(tree);
    expect(card.props.shouldSuggest).toBe(true);
    expect(card.props.suggestion?.priority).toBeGreaterThanOrEqual(100);
    const oldRevision = card.props.suggestion?.basedOnRevision;

    // Production pause path clears React UI state but currently leaves
    // currentSuggestionRef.current untouched.
    let controls = getAudioControls(tree);
    controls.props.onTogglePause();
    tree = renderApp();
    card = getSuggestionCard(tree);
    expect(card.props.shouldSuggest).toBe(false);
    expect(card.props.suggestion).toBeNull();

    // Resume while the invisible ref still points at the old high-priority card.
    controls = getAudioControls(tree);
    controls.props.onTogglePause();
    vi.advanceTimersByTime(6000); // new STT turn, but old card is still inside its 15s TTL
    tree = renderApp();

    // Another real substantive client turn from the same problematic session.
    tree = inject(tree, 'client', SESSION_10_SOFT_RESISTANCE);

    const context = getClientContext(tree);
    card = getSuggestionCard(tree);
    const uiVisible = Boolean(
      card.props.isCallRunning &&
        !card.props.isPaused &&
        card.props.shouldSuggest &&
        card.props.suggestion?.text
    );
    const visibleRevision = card.props.suggestion?.basedOnRevision ?? null;
    const stateRevision = context.props.state.revision;
    const eventDetected = context.props.state.dialogueControl?.lastEventType ?? null;

    const record = await endAndCapture(tree);
    const newRevisionTrace = (record.suggestionTrace || []).filter(
      (entry) => entry.basedOnRevision === stateRevision
    );

    const deliveryTrace = {
      turn_revision: stateRevision,
      client_text: SESSION_10_SOFT_RESISTANCE,
      state_updated: stateRevision > (oldRevision ?? 0),
      event_detected: eventDetected,
      candidate_generated: newRevisionTrace.length > 0,
      candidate_sources: newRevisionTrace.map((entry) => entry.source),
      candidate_priorities: newRevisionTrace.map((entry) => entry.priority),
      state_validator: newRevisionTrace.some((entry) => entry.reason === 'state_validator')
        ? 'REJECT'
        : 'PASS',
      replacement_policy: newRevisionTrace.some((entry) => entry.reason === 'replacement_policy')
        ? 'REJECT'
        : 'PASS',
      semantic_cooldown: newRevisionTrace.some((entry) => entry.reason === 'shown_semantic_cooldown')
        ? 'REJECT'
        : 'PASS',
      anti_repeat: newRevisionTrace.some((entry) => entry.reason.startsWith('anti_repeat:'))
        ? 'REJECT'
        : 'PASS',
      lock_state: Boolean(card.props.isSuggestionLocked),
      pending_state: newRevisionTrace.some((entry) => entry.outcome === 'pending'),
      pending_discard_reason: null,
      final_active_suggestion_revision: visibleRevision,
      shouldSuggest: card.props.shouldSuggest,
      ui_outcome: uiVisible ? 'VISIBLE' : 'NO_CARD',
    };

    // P0 invariant: state changed and valid actionable candidates were generated,
    // therefore the latest turn must result in a visible card or an intentional
    // domain-level suppression. A stale invisible UI ref is not such a reason.
    expect(deliveryTrace).toMatchObject({
      state_updated: true,
      candidate_generated: true,
      state_validator: 'PASS',
      replacement_policy: 'PASS',
      final_active_suggestion_revision: stateRevision,
      shouldSuggest: true,
      ui_outcome: 'VISIBLE',
    });
  });

  it('manual suggestion must be the same active recommendation that dismiss lifecycle records', async () => {
    let tree = renderApp();
    tree = inject(tree, 'client', SESSION_10_DIRECT_QUESTION);

    const manualText = 'До какой максимальной суммы рассматриваете покупку?';
    const context = getClientContext(tree);
    context.props.onAskField(manualText);
    tree = renderApp();

    let card = getSuggestionCard(tree);
    expect(card.props.shouldSuggest).toBe(true);
    expect(card.props.suggestion?.text).toBe(manualText);

    // Dismiss what the user can actually see.
    card.props.onDismissSuggestion();
    tree = renderApp();
    card = getSuggestionCard(tree);
    expect(card.props.shouldSuggest).toBe(false);

    const record = await endAndCapture(tree);
    const dismissed = record.state.dismissedSuggestionTexts || [];

    // Fails today: handleAskField updates React state only, while dismiss reads
    // currentSuggestionRef.current and therefore dismisses a different card.
    expect(dismissed).toContain(manualText);
  });

  it('newer actionable candidate must not disappear behind a pending card that is already doomed by revision', () => {
    const pending: SuggestedReply = {
      id: 'pending-r8',
      sessionId: 'session-10',
      basedOnRevision: 8,
      candidateRuleId: 'fact_correction',
      actionType: 'CLARIFY',
      text: 'Сначала уточним изменение контекста.',
      shortReason: 'Old P0 candidate',
      evidenceTurnIds: ['r8'],
      createdAt: 1_000,
      stage: 'diagnostics',
      lifecycleStatus: 'candidate',
      priority: 104,
      source: 'local_engine',
      semanticKey: 'old-p0',
      ttlMs: 15_000,
    };
    const newer: SuggestedReply = {
      id: 'candidate-r9',
      sessionId: 'session-10',
      basedOnRevision: 9,
      candidateRuleId: 'soft_resistance_materials',
      actionType: 'CLARIFY',
      text: 'Отправлю. Чтобы не прислать случайный набор, что сравнить первым?',
      shortReason: 'New substantive client turn',
      evidenceTurnIds: ['r9'],
      createdAt: 7_000,
      stage: 'objection_clarification',
      lifecycleStatus: 'candidate',
      priority: 85,
      source: 'local_event',
      semanticKey: 'new-soft-resistance',
      ttlMs: 15_000,
    };

    const latestSubstantiveRevision = 9;
    const oldPendingCannotSurviveUnlock = isPendingSuggestionSuperseded(
      pending.basedOnRevision,
      latestSubstantiveRevision
    );
    expect(oldPendingCannotSurviveUnlock).toBe(true);

    // This is the comparison order used by App.publishSuggestion today.
    const comparisonTarget = shouldReplaceSuggestion(null, pending, 7_000) ? pending : null;
    const newerAccepted = shouldReplaceSuggestion(comparisonTarget, newer, 7_000);

    // On unlock the old pending is discarded because revision 8 < revision 9.
    const pendingAfterUnlock = oldPendingCannotSurviveUnlock ? null : pending;
    const finalActive = newerAccepted ? newer : pendingAfterUnlock;

    // P0 invariant. Current code fails here: newerAccepted=false, then the old
    // pending is discarded, leaving no active recommendation at all.
    expect({
      old_pending_superseded: oldPendingCannotSurviveUnlock,
      newer_candidate_accepted: newerAccepted,
      final_active_suggestion: finalActive?.id ?? null,
    }).toEqual({
      old_pending_superseded: true,
      newer_candidate_accepted: true,
      final_active_suggestion: newer.id,
    });
  });
});
