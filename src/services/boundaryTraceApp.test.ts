import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallSessionRecord, SpeakerRole } from '../types';

const runtime = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  stateIndex: 0,
  refIndex: 0,
  records: [] as CallSessionRecord[],
  effects: [] as Array<() => unknown>,
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
  const useEffect = (effect: () => unknown) => { runtime.effects.push(effect); };
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
import { AnalysisProvider } from './analysisProvider';

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
beforeEach(() => {
  runtime.states.length = 0;
  runtime.refs.length = 0;
  runtime.records.length = 0;
  TestSocket.all = [];
  vi.useFakeTimers();
  vi.setSystemTime(1790948181049);
  vi.stubGlobal('WebSocket', TestSocket);
  vi.stubEnv('DEV', true);
  vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:3000', search: '?boundaryTrace=1' } });
  runtime.effects.length = 0;
  vi.spyOn(Math, 'random').mockReturnValue(0.25);
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ summary: {} }) }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });


import { SuggestionCard } from '../components/SuggestionCard';

async function finish(tree: ReactElement): Promise<any> {
  await controls(tree).props.onEndCall();
  return runtime.records.at(-1)!;
}
function commitCard(tree: ReactElement) {
  runtime.effects.length=0;
  SuggestionCard(card(tree).props);
  for (const effect of runtime.effects) effect();
}
const time=1791014200000;
async function nameExchange(mode='live_call') {
  await start(mode);
  final('agent','Добрый день! Как к вам обращаться?',time);
  return final('client','Анна.',time+3000);
}
const events=(record:any) => record.boundaryTrace?.events || [];

describe('optional DEV/QA boundary trace through production callbacks',()=>{
  it('correlates one final through state, analysis, lifecycle, publication and a separate UI receipt',async()=>{ const tree=await nameExchange(); commitCard(tree); const record=await finish(tree);
    expect(record.boundaryTrace).toBeDefined();
    const turn=record.turns.find((t:any)=>t.speaker==='client');
    const path=events(record).filter((e:any)=>e.turnId===turn.id);
    for(const boundary of ['TRANSCRIPT_FINAL_RECEIVED','STATE_UPDATE','ANALYSIS','DECISION','RECOMMENDATION_LIFECYCLE','PUBLICATION','UI_DELIVERY']){
      expect(path.some((e:any)=>e.boundary===boundary),boundary).toBe(true);
    }
    const published=path.find((e:any)=>e.boundary==='PUBLICATION'&&e.outcome==='emitted');
    const received=path.find((e:any)=>e.boundary==='UI_DELIVERY'&&e.outcome==='received');
    expect(published).toMatchObject({candidateId:record.suggestedRepliesHistory[0].id,candidateRevision:2});
    expect(received).toMatchObject({candidateId:published.candidateId,candidateRevision:2});
    expect(received.eventId).not.toBe(published.eventId);
    expect(path.every((e:any)=>e.sessionId===record.id && e.revision===2)).toBe(true);
    expect(path.find((e:any)=>e.boundary==='STATE_UPDATE'&&e.outcome==='completed')).toMatchObject({stateRevision:2});
    expect(JSON.stringify(record.boundaryTrace)).not.toContain('Анна');
    expect(JSON.stringify(record.boundaryTrace)).not.toContain('Добрый день');
  });
  it('records the existing technical-discussion skip explicitly without triggering analysis',async()=>{
    const tree=await nameExchange('technical_discussion');const record=await finish(tree);
    expect(record.suggestedRepliesHistory).toHaveLength(0);
    expect(events(record)).toEqual(expect.arrayContaining([expect.objectContaining({boundary:'ANALYSIS',outcome:'skipped',reason:'technical_discussion',revision:2})]));
  });
  it('observes manual publication and UI receipt without rerouting its existing setters',async()=>{
    let tree=await nameExchange();
    panel(tree).props.onAskField('PRIVATE_MANUAL_QUESTION'); tree=render(); commitCard(tree);
    const candidate=card(tree).props.suggestion; const record=await finish(tree);
    expect(events(record)).toEqual(expect.arrayContaining([
      expect.objectContaining({boundary:'DECISION',reason:'manual_activation',candidateId:candidate.id}),
      expect.objectContaining({boundary:'PUBLICATION',outcome:'emitted',reason:'manual_activation',candidateId:candidate.id}),
      expect.objectContaining({boundary:'UI_DELIVERY',outcome:'received',candidateId:candidate.id})
    ]));
    expect(JSON.stringify(record.boundaryTrace)).not.toContain('PRIVATE_MANUAL_QUESTION');
    expect(record.suggestedRepliesHistory).toHaveLength(1);
  });
  it('observes invisible UI receipt in the same session separately from emitted publication',async()=>{
    let tree=await nameExchange();controls(tree).props.onTogglePause();tree=render();commitCard(tree);
    const record=await finish(tree);
    expect(events(record)).toEqual(expect.arrayContaining([expect.objectContaining({boundary:'UI_DELIVERY',reason:'paused',visible:false,sessionId:record.id})]));
  });
  it('records the non-substantive-client skip with its accepted transcript id',async()=>{
    await start();const tree=final('client','угу',time);const record=await finish(tree);
    expect(record.state.revision).toBe(0);
    expect(events(record)).toEqual(expect.arrayContaining([expect.objectContaining({boundary:'ANALYSIS',outcome:'skipped',reason:'non_substantive_client',turnId:record.turns[0].id})]));
  });
  it.each([
    'Добрый день, меня зовут Данил, специалист по недвижимости.',
    'Добрый день, Данил, специалист по недвижимости компании Элитный Сочи. Как я могу обращаться к вам?',
  ])('Issue40 retains the greeting final without state analysis or a new hint after %s',async(agentIntroduction)=>{
    await start();
    final('agent',agentIntroduction,time);
    const tree=final('client','Да, добрый день, Данил.',time+3000);
    expect(card(tree).props.suggestion).toBeNull();
    const record=await finish(tree);
    expect(record.turns).toHaveLength(2);
    const greeting=record.turns[1];
    expect(greeting.text).toBe('Да, добрый день, Данил.');
    expect(record.state.revision).toBe(0);
    expect(record.suggestedRepliesHistory).toHaveLength(0);
    for(const boundary of ['STATE_UPDATE','ANALYSIS','DECISION']) {
      expect(events(record)).toEqual(expect.arrayContaining([expect.objectContaining({
        boundary,outcome:'skipped',reason:'non_substantive_client',turnId:greeting.id,
      })]));
    }
    expect(events(record).some((event:any)=>event.turnId===greeting.id&&
      ((event.boundary==='STATE_UPDATE'&&event.outcome==='started')||
       (event.boundary==='PUBLICATION'&&event.outcome==='emitted')))).toBe(false);
  });
  it('records analysis completion with no candidate and retains the current card',async()=>{
    await nameExchange();
    // Exercise the real App consumer with an explicit no-output provider result.
    vi.spyOn(AnalysisProvider.prototype,'scheduleLocalFirst').mockImplementation((payload,onSuccess)=>{
      onSuccess({sessionId:payload.sessionId,basedOnRevision:payload.revision,shouldSuggest:false,modelUsed:'local-deterministic',factsDelta:[]} as any);
    });
    const tree=final('client','Мы пока выбираем подходящий вариант.',time+9000);const record=await finish(tree);
    expect(record.suggestedRepliesHistory).toHaveLength(1);
    expect(events(record)).toEqual(expect.arrayContaining([
      expect.objectContaining({boundary:'DECISION',reason:'no_candidate',candidateProduced:false,revision:3}),
      expect.objectContaining({boundary:'PUBLICATION',outcome:'not_emitted',reason:'no_candidate',revision:3}),
      expect.objectContaining({boundary:'RECOMMENDATION_LIFECYCLE',outcome:'retained',reason:'no_new_publishable_candidate'})
    ]));
  });
  it('records an agent time contract as an event without a recommendation candidate',async()=>{
    await start();const tree=final('agent','Я займу у вас две минуты.',time);const record=await finish(tree);
    expect(record.state.dialogueControl.timeContract).toBeTruthy();
    expect(events(record)).toEqual(expect.arrayContaining([
      expect.objectContaining({boundary:'DECISION',candidateProduced:false,revision:1}),
      expect.objectContaining({boundary:'PUBLICATION',outcome:'not_emitted',reason:'no_candidate',revision:1})
    ]));
    expect(record.suggestedRepliesHistory).toHaveLength(0);
  });
  it('records a pending candidate terminal when the call ends without publication',async()=>{
    await start();final('agent','Как к вам обращаться?',time);
    const agent=TestSocket.all.find(item=>item.url.includes('role=agent'))!;
    agent.onmessage?.({data:JSON.stringify({type:'voiceActivity',activity:{type:'ACTIVITY_START'}})});
    const tree=final('client','Анна.',time+3000);const record=await finish(tree);
    const pending=events(record).find((e:any)=>e.boundary==='RECOMMENDATION_LIFECYCLE'&&e.outcome==='pending');
    expect(pending).toBeDefined();
    expect(events(record)).toEqual(expect.arrayContaining([expect.objectContaining({boundary:'RECOMMENDATION_LIFECYCLE',outcome:'superseded',reason:'call_ended',candidateId:pending.candidateId})]));
    expect(events(record).some((e:any)=>e.boundary==='PUBLICATION'&&e.outcome==='emitted'&&e.candidateId===pending.candidateId)).toBe(false);
  });
  it('records suppressed publication separately when an unchanged valid card repeats inside cooldown',async()=>{
    await nameExchange();final('agent','Как к вам обращаться?',time+9000);
    const tree=final('client','Анна.',time+12000);const record=await finish(tree);
    const rejected=record.suggestionTrace.find((e:any)=>e.outcome==='rejected');
    expect(rejected).toBeDefined();
    expect(events(record)).toEqual(expect.arrayContaining([
      expect.objectContaining({boundary:'RECOMMENDATION_LIFECYCLE',outcome:'suppressed',reason:rejected.reason,candidateId:rejected.candidateId}),
      expect.objectContaining({boundary:'PUBLICATION',outcome:'not_emitted',reason:rejected.reason,candidateId:rejected.candidateId})
    ]));
  });
  it('preserves arrival correlation for duplicate and earlier-timestamp finals without changing stored turns',async()=>{
    await start();final('client','Хочу квартиру для отдыха.',time);
    final('client','Хочу квартиру для отдыха.',time+100);
    const tree=final('client','Бюджет до 18 миллионов.',time-1000);const record=await finish(tree);
    expect(record.turns.map((t:any)=>t.revision)).toEqual([1,2]);
    expect(events(record)).toEqual(expect.arrayContaining([expect.objectContaining({boundary:'TRANSCRIPT_FINAL_RECEIVED',outcome:'ignored',reason:'duplicate_final',turnId:record.turns[0].id})]));
    const stored=events(record).filter((e:any)=>e.boundary==='TRANSCRIPT_FINAL_RECEIVED'&&e.outcome==='accepted');
    expect(stored.map((e:any)=>e.turnId)).toEqual(record.turns.map((t:any)=>t.id));
    expect(stored[1].timestamp).toBe(time-1000);
    expect(new Set(events(record).map((e:any)=>e.eventId)).size).toBe(events(record).length);
  });
  it.each([['',true],['?boundaryTrace=1',false]])('omits trace for opt-in=%s DEV=%s',async(search,dev)=>{
    (window.location as any).search=search;vi.stubEnv('DEV',dev);
    const tree=await nameExchange();const record=await finish(tree);
    expect(record.boundaryTrace).toBeUndefined();expect(record.suggestedRepliesHistory).toHaveLength(1);
  });
  it('produces identical state, replies, trace-independent diagnostics and timers with tracing enabled or disabled',async()=>{
    const run=async(enabled:boolean)=>{
      vi.clearAllTimers();runtime.states.length=0;runtime.refs.length=0;runtime.records.length=0;TestSocket.all=[];
      vi.setSystemTime(1790948181049);(window.location as any).search=enabled?'?boundaryTrace=1':'';
      await nameExchange();const tree=final('agent','Спасибо. стоп-тест',time+6000);const timers=vi.getTimerCount();const record=await finish(tree);
      const {boundaryTrace,...business}=record;return {business,timers};
    };
    expect(await run(true)).toEqual(await run(false));
  });
});
