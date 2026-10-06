import { afterEach, describe, expect, it, vi } from 'vitest';
import { VadFinalCommitter, VAD_FINAL_GRACE_MS } from './transcriptionService';
import { FinalTurnBuffer } from './sttDedup';
import { BoundaryTrace } from './boundaryTrace';

afterEach(() => vi.useRealTimers());
describe('transcript observers preserve commits, buffer order and timers', () => {
  it('keeps VAD promotion, duplicate suppression and amendment identical with an observer that throws', async () => {
    const run = async (observe: boolean) => {
      vi.useFakeTimers(); vi.clearAllTimers(); vi.setSystemTime(1791014200000);
      const commit = vi.fn(); const trace = vi.fn(() => { throw new Error('diagnostic'); });
      const vad = new VadFinalCommitter(commit, VAD_FINAL_GRACE_MS, observe ? trace : undefined);
      vad.onInterim('Мне нужна квартира в Сочи'); vad.onActivity(false);
      const timers = vi.getTimerCount();
      await vi.advanceTimersByTimeAsync(VAD_FINAL_GRACE_MS);
      vad.onFinal('Мне нужна квартира в Сочи.', Date.now());
      vad.onFinal('Мне нужна большая квартира в Сочи с видом на море.', Date.now());
      return { calls: commit.mock.calls, timers, remaining: vi.getTimerCount() };
    };
    const observed = await run(true); expect(observed.calls).toHaveLength(2); expect(observed).toEqual(await run(false));
  });
  it('keeps causal fragment merging and flushing identical while recording text-free upstream correlation', async () => {
    const run = async (enabled: boolean) => {
      vi.useFakeTimers(); vi.clearAllTimers(); vi.setSystemTime(1791014200000);
      const trace = new BoundaryTrace('s1', 'live_call'); const emit = vi.fn();
      const buffer = new FinalTurnBuffer(emit, enabled ? trace.record : undefined, 's1');
      buffer.push('client', 'Потому что мне', Date.now()); const timers = vi.getTimerCount();
      buffer.push('client', 'хочу квартиру для отдыха.', Date.now()+100);
      buffer.push('agent', 'PRIVATE_AGENT_TEXT', Date.now()+200); buffer.flush();
      await vi.advanceTimersByTimeAsync(1600);
      expect(JSON.stringify(trace.snapshot())).not.toMatch(/Потому|квартиру|PRIVATE_AGENT_TEXT/);
      if(enabled) expect(trace.snapshot().events).toEqual(expect.arrayContaining([expect.objectContaining({ reason:'causal_fragment_merged', sessionId:'s1', upstreamCorrelationId:expect.any(String) })]));
      return { calls: emit.mock.calls, timers, remaining: vi.getTimerCount() };
    };
    expect(await run(true)).toEqual(await run(false));
  });
});
