import type { ReactElement } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { CallSessionRecord } from '../types';

const runtime = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  stateIndex: 0,
  refIndex: 0,
  agentVoiceActivity: null as null | ((role: 'agent', active: boolean) => void),
  records: [] as CallSessionRecord[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const useState = (initial: unknown) => {
    const index = runtime.stateIndex++;
    if (!(index in runtime.states)) runtime.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    const set = (next: unknown) => {
      runtime.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(runtime.states[index]) : next;
    };
    return [runtime.states[index], set];
  };
  const useRef = (initial: unknown) => {
    const index = runtime.refIndex++;
    return runtime.refs[index] ||= { current: initial };
  };
  const useEffect = () => undefined;
  const useCallback = <T extends (...args: any[]) => any>(callback: T): T => callback;
  return { ...actual, default: { ...(actual.default || actual), useState, useRef, useEffect, useCallback }, useState, useRef, useEffect, useCallback };
});

vi.mock('./audioCapture', () => ({
  DualAudioCapture: class {
    async startMicrophone() { return false; }
    stopAll() {}
  },
}));

vi.mock('./transcriptionService', () => ({
  LiveTranscriptionChannel: class {
    static resetLiveSessionsCount() {}
    static getTotalLiveSessionsCount() { return 0; }
    constructor(role: string, _session: string, callbacks: { onVoiceActivity?: (role: 'agent', active: boolean) => void }) {
      if (role === 'agent') runtime.agentVoiceActivity = callbacks.onVoiceActivity || null;
    }
    connect() {}
    disconnect() {}
  },
}));

vi.mock('./sessionStorage', () => ({
  getAllCallSessions: vi.fn(async () => []),
  saveCallSession: vi.fn(async (record: CallSessionRecord) => { runtime.records.push(record); }),
  deleteCallSession: vi.fn(async () => undefined),
  clearAllSessions: vi.fn(async () => undefined),
}));

import { App } from '../App';

function render(): ReactElement {
  runtime.stateIndex = 0;
  runtime.refIndex = 0;
  return (App as unknown as () => ReactElement)();
}

function find(root: any, predicate: (node: any) => boolean): any {
  if (!root || typeof root !== 'object') return null;
  if (root.props && predicate(root)) return root;
  const children = root.props?.children;
  for (const child of (Array.isArray(children) ? children : [children])) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}

function controls(tree: ReactElement) {
  return find(tree, (node) => typeof node.props?.onStartCall === 'function' && typeof node.props?.onEndCall === 'function');
}
function card(tree: ReactElement) {
  return find(tree, (node) => typeof node.props?.onDismissSuggestion === 'function' && 'shouldSuggest' in node.props);
}
function inject(tree: ReactElement, text: string) {
  const simulator = find(tree, (node) => typeof node.props?.onInjectTurn === 'function');
  simulator.props.onInjectTurn('client', text);
  return render();
}

beforeEach(() => {
  runtime.states.length = 0;
  runtime.refs.length = 0;
  runtime.records.length = 0;
  runtime.agentVoiceActivity = null;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ summary: {} }) })));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('P0 pending delivery through App', () => {
  it('does not let a superseded locked candidate block a newer substantive client turn', async () => {
    let tree = render();
    await controls(tree).props.onStartCall();
    tree = render();
    expect(runtime.agentVoiceActivity).toBeTruthy();
    runtime.agentVoiceActivity!('agent', true);
    tree = render();

    tree = inject(tree, 'Сэм Дэниел, и что же у вас есть, чего я ещё не видел в этих бесконечных презентациях?');
    expect(card(tree).props.shouldSuggest).toBe(false);

    vi.advanceTimersByTime(6000);
    tree = inject(tree, 'Я не планирую переезжать. Это скорее вложение, отдых с потенциалом сдачи.');
    const latestRevision = find(tree, (node) => typeof node.props?.onAskField === 'function').props.state.revision;
    expect(latestRevision).toBe(2);
    expect(card(tree).props.shouldSuggest).toBe(false); // Agent is still speaking.

    runtime.agentVoiceActivity!('agent', false);
    tree = render();
    const visible = card(tree);
    expect(visible.props.isCallRunning).toBe(true);
    expect(visible.props.shouldSuggest).toBe(true);
    expect(visible.props.suggestion?.basedOnRevision).toBe(latestRevision);
    await controls(tree).props.onEndCall();
    const trace = runtime.records.at(-1)?.suggestionTrace || [];
    expect(trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ basedOnRevision: 1, outcome: 'rejected', reason: 'superseded_by_newer_revision' }),
      expect.objectContaining({ basedOnRevision: latestRevision, outcome: 'pending', reason: 'suggestion_locked' }),
      expect.objectContaining({ basedOnRevision: latestRevision, outcome: 'shown', reason: 'accepted' }),
    ]));
    expect(trace.some((entry) => entry.basedOnRevision === latestRevision && entry.outcome === 'shown')).toBe(true);
  });
});
