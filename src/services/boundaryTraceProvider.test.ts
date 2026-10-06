import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalysisProvider } from './analysisProvider';
import { BoundaryTrace } from './boundaryTrace';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation } from './localAnalysisEngine';
import type { TranscriptTurn } from '../types';

const payload = () => {
  const turn: TranscriptTurn = { id: 't1', sessionId: 's1', revision: 1, timestamp: Date.now(), speaker: 'client', source: 'call_audio', isFinal: true, text: 'Хочу квартиру в Сочи для отдыха, но сомневаюсь, что понимаю реальные риски выбора.' };
  return { sessionId: 's1', revision: 1, newTurns: [turn], recentTurns: [turn], currentState: advanceLocalConversation(createInitialState(), turn, [turn]).state };
};
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('passive analysis boundary observations', () => {
  it('records active cancellation synchronously for the existing call-end snapshot', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))));
    const trace = new BoundaryTrace('s1', 'live_call'); const provider = new AnalysisProvider();
    provider.setSession('s1'); provider.setRemoteEnhancementEnabled(true); provider.setBoundaryObserver(trace.record);
    provider.scheduleLocalFirst(payload(), vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(250);
    expect(trace.snapshot().events).toEqual(expect.arrayContaining([expect.objectContaining({ outcome: 'started', turnId: 't1' })]));
    provider.cancelPending();
    expect(trace.snapshot().events).toEqual(expect.arrayContaining([expect.objectContaining({ outcome: 'cancelled', reason: 'active_cancelled', turnId: 't1', revision: 1, analysisId: 's1:remote:1' })]));
  });
  it.each(['off', 'on', 'throwing'])('leaves local result, payload, requests and timers unchanged for observer %s', observer => {
    vi.useFakeTimers(); vi.setSystemTime(1791014200000);
    const input = payload(); const before = JSON.stringify(input); const callback = vi.fn(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const provider = new AnalysisProvider(); provider.setSession('s1');
    const trace = new BoundaryTrace('s1', 'live_call');
    provider.setBoundaryObserver(observer === 'off' ? undefined : observer === 'on' ? trace.record : () => { throw new Error('observer'); });
    provider.scheduleLocalFirst(input, callback, vi.fn());
    expect(callback).toHaveBeenCalledTimes(1); expect(callback.mock.calls[0][0]).toMatchObject({ modelUsed: 'local-deterministic', shouldSuggest: true });
    expect(JSON.stringify(input)).toBe(before); expect(fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    if (observer === 'on') expect(trace.snapshot().events.map(e => e.reason)).toEqual(['local_first', 'local_result', 'remote_disabled']);
  });
  it.each(['error', 'timeout', 'late'])('records remote %s without altering local delivery or leaking errors', async outcome => {
    vi.useFakeTimers(); vi.setSystemTime(1791014200000);
    const fetch = vi.fn((_url, options) => outcome === 'error' ? Promise.reject(new Error('PRIVATE_SECRET')) : new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      if (outcome === 'late') setTimeout(() => resolve({ ok: true, json: async () => ({ sessionId: 's1', basedOnRevision: 1, shouldSuggest: false, modelUsed: 'gemini' }) }), 1500);
    }));
    vi.stubGlobal('fetch', fetch); const trace = new BoundaryTrace('s1', 'live_call'); const provider = new AnalysisProvider();
    provider.setSession('s1'); provider.setRemoteEnhancementEnabled(true); provider.setBoundaryObserver(trace.record);
    const delivered = vi.fn(); const errors = vi.fn(); provider.scheduleLocalFirst(payload(), delivered, errors);
    expect(delivered).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(AnalysisProvider.HARD_TIMEOUT_MS + 250);
    expect(fetch).toHaveBeenCalledTimes(1);
    const reason = outcome === 'error' ? 'remote_error' : outcome === 'timeout' ? 'remote_hard_timeout' : 'remote_result_late';
    expect(trace.snapshot().events).toEqual(expect.arrayContaining([expect.objectContaining({ reason, turnId: 't1', revision: 1 })]));
    expect(JSON.stringify(trace.snapshot())).not.toMatch(/PRIVATE_SECRET|Хочу квартиру|currentState/);
    if (outcome === 'late') expect(delivered).toHaveBeenLastCalledWith(expect.objectContaining({ suggestionExpired: true }));
    else expect(delivered).toHaveBeenCalledTimes(1);
    provider.cancelPending();
  });
});
