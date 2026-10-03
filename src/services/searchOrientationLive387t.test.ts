import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallSessionRecord, SpeakerRole } from '../types';

const runtime = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  stateIndex: 0,
  refIndex: 0,
  records: [] as CallSessionRecord[],
}));

// App's hooks are hosted without a DOM; production turn handling and services stay real.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const useState = (initial: unknown) => {
    const index = runtime.stateIndex++;
    if (!(index in runtime.states)) runtime.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [runtime.states[index], (next: unknown) => {
      runtime.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(runtime.states[index]) : next;
    }];
  };
  const useRef = (initial: unknown) => runtime.refs[runtime.refIndex++] ||= { current: initial };
  const useEffect = () => undefined;
  const useCallback = <T extends (...args: any[]) => any>(callback: T): T => callback;
  return { ...actual, default: { ...(actual.default || actual), useState, useRef, useEffect, useCallback }, useState, useRef, useEffect, useCallback };
});

// Audio permissions and IndexedDB are external boundaries, not the pipeline under test.
vi.mock('./audioCapture', () => ({
  DualAudioCapture: class {
    async startMicrophone() { return true; }
    async startCallAudio() { return true; }
    stopAll() {}
  },
}));
vi.mock('./sessionStorage', () => ({
  getAllCallSessions: async () => [],
  saveCallSession: async (record: CallSessionRecord) => { runtime.records.push(record); },
  deleteCallSession: async () => undefined,
  clearAllSessions: async () => undefined,
}));

import { App } from '../App';


class TestSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static all: TestSocket[] = [];
  readyState = TestSocket.CONNECTING;
  bufferedAmount = 0;
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { TestSocket.all.push(this); }
  open() { this.readyState = TestSocket.OPEN; this.onopen?.(); }
  send() {}
  close() { this.readyState = 3; this.onclose?.(); }
  final(text: string) {
    this.onmessage?.({ data: JSON.stringify({ type: 'final', text, timestamp: Date.now() }) });
  }
}

function render(): ReactElement {
  runtime.stateIndex = 0;
  runtime.refIndex = 0;
  return (App as unknown as () => ReactElement)();
}
function find(root: any, predicate: (node: any) => boolean): any {
  if (!root || typeof root !== 'object') return null;
  if (root.props && predicate(root)) return root;
  const children = root.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}
const controls = (tree: ReactElement) => find(tree, node => typeof node.props.onStartCall === 'function');
const panel = (tree: ReactElement) => find(tree, node => typeof node.props.onAskField === 'function');
const card = (tree: ReactElement) => find(tree, node => typeof node.props.onDismissSuggestion === 'function');

async function start(mode = 'live_call') {
  let tree = render();
  controls(tree).props.onChangeMode(mode);
  tree = render();
  await controls(tree).props.onToggleCallAudio();
  tree = render();
  await controls(tree).props.onStartCall();
  tree = render();
  TestSocket.all.forEach(socket => socket.open());
  return render();
}
function final(speaker: SpeakerRole, text: string, timestamp: number) {
  vi.setSystemTime(timestamp);
  const socket = TestSocket.all.find(item => item.url.includes('role=' + speaker));
  if (!socket) throw new Error('No transcription channel for ' + speaker);
  socket.final(text);
  return render();
}
const fourJch: Array<[SpeakerRole, string, number]> = [
  ['agent', 'Да, Элитный Сочи, как я могу к вам обращаться?', 1790948210848],
  ['client', 'Марина', 1790948213469],
  ['agent', 'Очень приятно, Марина.', 1790948216449],
  ['client', 'Взаимно.', 1790948220524],
  ['agent', 'Стоп, тест.', 1790948230895],
];

beforeEach(() => {
  runtime.states.length = 0;
  runtime.refs.length = 0;
  runtime.records.length = 0;
  TestSocket.all = [];
  vi.useFakeTimers();
  vi.setSystemTime(1790948181049);
  vi.stubGlobal('WebSocket', TestSocket);
  vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:3000' } });
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ summary: {} }) }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const exact387t: Array<[SpeakerRole, string, number]> = [
  ['client', 'Андрей, можно просто Андрей.', 1790948020150],
  ['agent', 'Добрый день, Данил, Сочи. Как я могу к вам обращаться?', 1790948025281],
  ['client', 'Да, Андрей.', 1790948034939],
  ['agent', 'Добрый день, Данил, Элитный Сочи. Как могу к вам обращаться?', 1790948038996],
  ['agent', 'На каком сейчас этапе? Присматриваете или уже ездите смотреть конкретные объекты?', 1790948043162],
  ['client', 'Ну, честно, просто мониторю. Смотрю, читаю, но пока без каких-то решений.', 1790948050107],
  ['agent', 'стоп-тест', 1790948069230],
];

async function shownOrientation(answer = exact387t[5][1], question = exact387t[4][1], advanceToGoal = false) {
  vi.setSystemTime(1790947991880);
  vi.spyOn(Math, 'random').mockReturnValue(parseInt('387t', 36) / Math.pow(36, 4));
  let tree = await start();
  for (let index = 0; index < exact387t.length; index++) {
    if (index === 6 && advanceToGoal) {
      card(tree).props.onUseSuggestion(card(tree).props.suggestion);
      tree = final('agent', 'Почему именно сейчас вопрос недвижимости стал актуален?', 1790948052000);
      tree = final('client', 'Потому что появился свободный капитал.', 1790948053000);
    }
    const [speaker, original, timestamp] = exact387t[index];
    tree = final(speaker, index === 4 ? question : index === 5 ? answer : original, timestamp);
    if (index === 0) {
      // The opening is actually marked used; the production App can then show orientation at rev3.
      card(tree).props.onUseSuggestion(card(tree).props.suggestion);
      tree = render();
    }
  }
  await controls(tree).props.onEndCall();
  vi.restoreAllMocks();
  return runtime.records.at(-1)!;
}

describe('387t live next action under the unchanged shown-history guard', () => {
  it('publishes a new objective after the exact monitoring answer, despite the prior orientation', async () => {
    const record = await shownOrientation();
    expect(record.state.revision).toBe(6);
    expect(record.state.searchExperience?.value).toBe('Изучает рынок / находится в процессе выбора');
    const orientation = record.suggestionTrace?.find(t => t.basedOnRevision === 3 && t.outcome === 'shown');
    expect(orientation).toBeTruthy();
    const next = record.suggestionTrace?.find(t => t.basedOnRevision === 6);
    expect(next?.outcome).toBe('shown');
    expect(next?.semanticKey).not.toBe(orientation?.semanticKey);
    expect(next?.reason).not.toBe('shown_semantic_cooldown');
    expect(record.suggestedRepliesHistory.some(r => r.basedOnRevision === 6)).toBe(true);
    expect(record.turns.at(-1)?.text).toBe('стоп-тест');
  });
  it('lets the next unresolved goal through the same prior shown history for known viewings', async () => {
    const record = await shownOrientation('Вчера смотрел новостройки и сравнил два комплекса.', exact387t[4][1], true);
    const next = record.suggestionTrace?.find(t => t.basedOnRevision === 8);
    expect(next?.outcome).toBe('shown');
    expect(next?.closesMetric).toBe('goal');
  });
  it('still rejects a real orientation duplicate when no search answer was given', async () => {
    const record = await shownOrientation('Да, Андрей.', 'Как я могу к вам обращаться?');
    expect(record.state.searchExperience?.value ?? null).toBeNull();
    expect(record.suggestionTrace?.find(t => t.basedOnRevision === 6)?.reason).toBe('shown_semantic_cooldown');
  });
});
