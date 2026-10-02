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
import { isSubstantiveClientTurn } from './objectionEngine';

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

describe('contextual short name eligibility', () => {
  it('limits only the name exception when the last agent question is no longer immediate', () => {
    expect(isSubstantiveClientTurn('Марина', 'Как вас зовут?', false)).toBe(false);
    expect(isSubstantiveClientTurn('да', 'Вам удобно?', false)).toBe(true);
  });
  it.each([
    ['Как я могу к вам обращаться?', 'Марина'],
    ['Как вас зовут?', 'Дмитрий'],
    ['Добрый день! Подскажите, как к вам обращаться?', 'Ли'],
    ['Скажите, пожалуйста, ваше имя.', 'Алекс'],
    ['Как вас зовут?', 'Рен'],
    ['Как вас зовут, пожалуйста?', 'Марина'],
  ])('accepts the short answer to %s without a name dictionary', (question, answer) => {
    expect(isSubstantiveClientTurn(answer, question)).toBe(true);
  });

  it.each([
    ['Марина', undefined],
    ['Дмитрий', 'Что из просмотренного понравилось?'],
    ['холодильник', 'Какой предмет вам нужен?'],
    ['Взаимно.', 'Очень приятно, Марина.'],
    ['Взаимно.', 'Как вас зовут?'],
    ['Спасибо.', 'Как вас зовут?'],
    ['угу', 'Как вас зовут?'],
    ['ага', 'Как вас зовут?'],
    ['понял', 'Как вас зовут?'],
    ['эээ', 'Как вас зовут?'],
    ['эмм', 'Как вас зовут?'],
    ['хм', 'Как вас зовут?'],
    ['кхм', 'Как вас зовут?'],
    ['...', 'Как вас зовут?'],
    ['Марина', 'Как вас зовут? Какой вариант понравился?'],
    ['Марина', 'Раньше спрашивали «Как вас зовут?», сейчас обсудим просмотр.'],
    ['Марина', 'Скажите, как зовут вашего риелтора?'],
    ['Марина', 'Не спрашиваю, как вас зовут.'],
    ['Марина', 'Раньше меня спрашивали, как вас зовут?'],
    ['Марина', 'Он спросил, как вас зовут?'],
    ['Марина', '«Как вас зовут?»'],
  ])('keeps %s filtered outside a valid name-answer context (%s)', (answer, question) => {
    expect(isSubstantiveClientTurn(answer, question)).toBe(false);
  });
});

describe('contextual short name through production live callbacks', () => {
  it('advances the exact 4jch finals in live_call when the client answers the name question', async () => {
    let tree = await start();
    for (const [speaker, text, timestamp] of fourJch) tree = final(speaker, text, timestamp);
    expect(panel(tree).props.state.revision).toBe(2);
    expect(card(tree).props.shouldSuggest).toBe(true);
    expect(card(tree).props.suggestion).toMatchObject({ basedOnRevision: 2, source: 'local_engine' });
    await controls(tree).props.onEndCall();
    const record = runtime.records.at(-1)!;
    expect(record.turns.map(turn => turn.text)).toEqual(fourJch.map(turn => turn[1]));
    expect(record.state.revision).toBe(2);
    expect(record.suggestedRepliesHistory).toHaveLength(1);
    expect(record.suggestionTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ basedOnRevision: 2, outcome: 'shown', source: 'local_engine' }),
    ]));
    expect(record.diagnostics?.lastAnalysisTime).not.toBeNull();
  });

  it('advances analysis and state for the other explicit name-question form', async () => {
    await start();
    final('agent', 'Как вас зовут?', 1790948210848);
    const tree = final('client', 'Дмитрий', 1790948213469);
    expect(panel(tree).props.state.revision).toBe(2);
    expect(card(tree).props.shouldSuggest).toBe(true);
    expect(card(tree).props.suggestion?.basedOnRevision).toBe(2);
  });

  it('persists an isolated name without starting the client analysis path', async () => {
    await start();
    const tree = final('client', 'Марина', 1790948213469);
    expect(panel(tree).props.state.revision).toBe(0);
    expect(card(tree).props.shouldSuggest).toBe(false);
    await controls(tree).props.onEndCall();
    expect(runtime.records.at(-1)?.turns).toHaveLength(1);
    expect(runtime.records.at(-1)?.suggestionTrace).toEqual([]);
    expect(runtime.records.at(-1)?.suggestedRepliesHistory).toEqual([]);
  });

  it('does not reuse an answered name question for a later single-word final', async () => {
    await start();
    final('agent', 'Как вас зовут?', 1790948210848);
    const answered = final('client', 'Марина', 1790948213469);
    const revision = panel(answered).props.state.revision;
    expect(revision).toBe(2);
    const later = final('client', 'холодильник', 1790948230000);
    expect(panel(later).props.state.revision).toBe(revision);
    await controls(later).props.onEndCall();
    expect(runtime.records.at(-1)?.turns.map(turn => turn.text)).toEqual([
      'Как вас зовут?', 'Марина', 'холодильник',
    ]);
  });

  it('preserves the earlier technical_discussion return for the exact finals', async () => {
    let tree = await start('technical_discussion');
    for (const [speaker, text, timestamp] of fourJch) tree = final(speaker, text, timestamp);
    expect(panel(tree).props.state.revision).toBe(0);
    expect(card(tree).props.shouldSuggest).toBe(false);
    await controls(tree).props.onEndCall();
    const record = runtime.records.at(-1)!;
    expect(record.turns).toHaveLength(5);
    expect(record.suggestionTrace).toEqual([]);
    expect(record.suggestedRepliesHistory).toEqual([]);
    expect(record.diagnostics?.lastAnalysisTime).toBeNull();
  });

  it('preserves the healthy 387t state progression and two shown local recommendations', async () => {
    let tree = await start();
    const turns: Array<[SpeakerRole, string, number]> = [
      ['client', 'Андрей, можно просто Андрей.', 1790948020150],
      ['agent', 'Добрый день, Данил, Сочи. Как я могу к вам обращаться?', 1790948025281],
      ['client', 'Да, Андрей.', 1790948034939],
      ['agent', 'Добрый день, Данил, Элитный Сочи. Как могу к вам обращаться?', 1790948038996],
      ['agent', 'На каком сейчас этапе? Присматриваете или уже ездите смотреть конкретные объекты?', 1790948043162],
      ['client', 'Ну, честно, просто мониторю. Смотрю, читаю, но пока без каких-то решений.', 1790948050107],
      ['agent', 'стоп-тест', 1790948069230],
    ];
    for (const [speaker, text, timestamp] of turns) tree = final(speaker, text, timestamp);
    expect(panel(tree).props.state.revision).toBe(6);
    await controls(tree).props.onEndCall();
    const record = runtime.records.at(-1)!;
    expect(record.turns).toHaveLength(7);
    expect(record.suggestedRepliesHistory).toHaveLength(2);
    expect(record.suggestionTrace?.filter(entry => entry.outcome === 'shown')).toHaveLength(2);
    expect(record.suggestedRepliesHistory.every(reply => reply.source === 'local_engine')).toBe(true);
  });
});

