import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoundaryTrace, boundaryTraceEnabled, businessTraceEvents, isTesterMarker, observeBoundary } from './boundaryTrace';
import type { BoundaryTraceInput } from '../types';

const event: BoundaryTraceInput = { sessionId: 'session-1', turnId: 'turn-2', revision: 2, candidateId: 'candidate-2', candidateRevision: 2, boundary: 'PUBLICATION', outcome: 'emitted', reason: 'accepted', timestamp: 123 };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('bounded boundary trace metadata', () => {
  it('retains only scalar metadata and detaches input and exported snapshots', () => {
    const trace = new BoundaryTrace('session-1', 'live_call', 'head');
    const input = { ...event, text: 'PRIVATE_TEXT', payload: { secret: 'SECRET' }, currentState: { goal: 'PRIVATE_GOAL' } };
    trace.record(input);
    input.reason = 'changed';
    const exported = trace.snapshot();
    expect(exported.events[0]).toMatchObject({ ...event, sequence: 1, correlationId: 'session-1:turn:turn-2' });
    expect(JSON.stringify(exported)).not.toMatch(/PRIVATE|SECRET|payload|currentState/);
    exported.events[0].reason = 'mutated_export';
    expect(trace.snapshot().events[0].reason).toBe('accepted');
  });
  it('normalizes rejection prose to a fixed code without retaining client facts', () => {
    const trace = new BoundaryTrace('session-1', 'live_call');
    trace.record({ ...event, reason: 'anti_repeat:goal PRIVATE_CLIENT_GOAL location PRIVATE_LOCATION budget 18881234' });
    trace.record({ ...event, reason: 'unexpected PRIVATE_SECRET' });
    expect(trace.snapshot().events.map(e => e.reason)).toEqual(['anti_repeat', 'unspecified_reason']);
    expect(JSON.stringify(trace.snapshot())).not.toContain('PRIVATE');
  });
  it('preserves bounded prefix and declares dropped observations', () => {
    const trace = new BoundaryTrace('session-1', 'live_call', 'head', 2);
    for (let n = 0; n < 4; n++) trace.record({ ...event, timestamp: n });
    expect(trace.snapshot()).toMatchObject({ droppedEvents: 2, events: [{ sequence: 1, timestamp: 0 }, { sequence: 2, timestamp: 1 }] });
  });
  it('isolates observer exceptions and leaves observed data unchanged', () => {
    const before = JSON.stringify(event);
    expect(() => observeBoundary(() => { throw new Error('observer failed'); }, event)).not.toThrow();
    observeBoundary(undefined, event);
    expect(JSON.stringify(event)).toBe(before);
  });
  it.each([['', true, false], ['?boundaryTrace=0', true, false], ['?boundaryTrace=1', false, false], ['?boundaryTrace=1', true, true]])('requires DEV and explicit opt-in %s', (search, dev, enabled) => {
    vi.stubEnv('DEV', dev); vi.stubGlobal('window', { location: { search } });
    expect(boundaryTraceEnabled()).toBe(enabled);
  });
  it.each(['стоп-тест', 'Спасибо. стоп тест, теперь проверяем'])('cuts interpretation before tester observation while preserving capture: %s', text => {
    const trace = new BoundaryTrace('session-1', 'live_call');
    trace.record(event);
    trace.record({ ...event, boundary: 'TRANSCRIPT_FINAL_RECEIVED', testerMarker: isTesterMarker(text) });
    trace.record({ ...event, boundary: 'DECISION' });
    const capture = trace.snapshot();
    expect(businessTraceEvents(capture)).toHaveLength(1);
    expect(capture.events).toHaveLength(3);
    expect(JSON.stringify(capture)).not.toContain(text);
  });
});
