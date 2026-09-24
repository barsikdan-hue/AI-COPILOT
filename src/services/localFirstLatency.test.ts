import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalysisProvider } from './analysisProvider';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation } from './localAnalysisEngine';
import { isSuggestionAllowedByState, recordAnalysisLatency, shouldReplaceSuggestion } from './suggestionLifecycle';
import { AudioControls } from '../components/AudioControls';
import { DiagnosticsDrawer } from '../components/DiagnosticsDrawer';
import { AnalysisResponse, DiagnosticsData, SuggestedReply, TranscriptTurn } from '../types';

const input = () => {
  const turn: TranscriptTurn = { id: 'client-1', sessionId: 's', speaker: 'client', source: 'call_audio', text: 'Хочу квартиру в Сочи для отдыха.', isFinal: true, revision: 1, timestamp: Date.now() };
  const state = advanceLocalConversation(createInitialState(), turn, [turn]).state;
  return { sessionId: 's', revision: 1, newTurns: [turn], recentTurns: [turn], currentState: state };
};
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('4.0.2 local-first and suggestion lifecycle', () => {
  it('T10 local actionable callback completes within 300ms while Gemini takes 9s', async () => {
    vi.useFakeTimers(); const payload = input(); let displayed: AnalysisResponse | undefined;
    const times: number[] = []; const start = performance.now();
    const fetchMock = vi.fn(() => new Promise(resolve => setTimeout(() => resolve({ ok: true, json: async () => ({ sessionId: 's', basedOnRevision: 1, shouldSuggest: false, modelUsed: 'gemini', latencyMs: 9000 }) }), 9000)));
    vi.stubGlobal('fetch', fetchMock); const provider = new AnalysisProvider(); provider.setSession('s');
    provider.scheduleLocalFirst(payload, result => { if (result.shouldSuggest) { displayed = result; times.push(performance.now() - start); } }, vi.fn());
    expect(displayed?.modelUsed).toBe('local-deterministic'); expect(displayed?.suggestedReply).toBeTruthy();
    expect(times[0]).toBeLessThanOrEqual(300);
    const localCard = displayed;
    await vi.advanceTimersByTimeAsync(9250);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(displayed).toBe(localCard);
    provider.cancelPending();
  });
  it('T11 a real provider hard timeout preserves the local card and reports diagnostics', async () => {
    vi.useFakeTimers(); const payload = input(); let displayed: AnalysisResponse | undefined; const errors = vi.fn();
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))));
    const provider = new AnalysisProvider(); provider.setSession('s');
    provider.scheduleLocalFirst(payload, result => { if (result.shouldSuggest) displayed = result; }, errors);
    const localCard = displayed; expect(localCard?.suggestedReply).toBeTruthy();
    await vi.advanceTimersByTimeAsync(AnalysisProvider.HARD_TIMEOUT_MS + 250);
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ isTimeout: true }));
    expect(displayed).toBe(localCard); provider.cancelPending();
  });
  it('T16 top UI retains first-hint 80ms while diagnostics renders Gemini 6600ms', () => {
    const noop = () => {};
    const diagnostics = recordAnalysisLatency({ analysisLatencyMs: 80, firstHintLatencyMs: 80, localDecisionLatencyMs: 5, geminiLatencyMs: null }, { modelUsed: 'gemini', latencyMs: 6600 });
    const top = renderToStaticMarkup(createElement(AudioControls, {
      isMicActive: false, isCallAudioActive: false, micLevel: 0, micDb: 0, callLevel: 0, callDb: 0, isCallRunning: true, isPaused: false, callDuration: 0, currentStage: 'diagnostics',
      onToggleMic: noop, onToggleCallAudio: noop, onStartCall: noop, onEndCall: noop, onTogglePause: noop, onOpenDiagnostics: noop, firstHintLatencyMs: diagnostics.firstHintLatencyMs,
      conversationMode: 'test_dialogue', onChangeMode: noop, onOpenHistory: noop, onOpenSimulator: noop, pastSessionsCount: 0,
    }));
    const drawer = renderToStaticMarkup(createElement(DiagnosticsDrawer, { isOpen: true, onClose: noop, onRunHealthCheck: async () => ({}), diagnostics: { ...diagnostics, analysisModel: 'gemini', sttAgentStatus: 'idle', sttClientStatus: 'idle' } as DiagnosticsData }));
    expect(top).toContain('Подсказка'); expect(top).toContain('80 мс'); expect(top).not.toContain('6600');
    expect(drawer).toContain('Gemini:'); expect(drawer).toContain('6600 мс');
  });
  it('T11 timeout error is rendered only when diagnostics is open', () => {
    const props = { onClose: () => {}, onRunHealthCheck: async () => ({}), diagnostics: { lastErrorMessage: 'Время ответа Gemini превышено, карточка сохранена' } as DiagnosticsData };
    expect(renderToStaticMarkup(createElement(DiagnosticsDrawer, { ...props, isOpen: true }))).toContain('Время ответа Gemini превышено');
    expect(renderToStaticMarkup(createElement(DiagnosticsDrawer, { ...props, isOpen: false }))).toBe('');
  });
  it('T17 a blocked PPV rejects Gemini and preserves the local alternative', () => {
    const state = createInitialState(); state.dialogueControl!.blockedNextSteps = ['ppv'];
    const current = { id: 'local', sessionId: 's', basedOnRevision: 1, text: 'Сначала сузим выбор до 2–3 объектов.', priority: 97, createdAt: Date.now(), lifecycleStatus: 'shown', source: 'local_engine' } as SuggestedReply;
    const candidate = { ...current, id: 'gemini', source: 'gemini', text: 'Давайте проведем видеопоказ сегодня в 18:00?', priority: 110 } as SuggestedReply;
    let shown = current;
    if (isSuggestionAllowedByState(candidate, state) && shouldReplaceSuggestion(shown, candidate)) shown = candidate;
    expect(shown).toBe(current);
    state.dialogueControl!.blockedNextSteps = ['ppi'];
    expect(isSuggestionAllowedByState({ ...candidate, text: 'Давайте подключим ипотечного брокера.' }, state)).toBe(false);
  });
  it('a newer low-priority Gemini response does not displace a fresh local P0 card', () => {
    const current = { sessionId: 's', basedOnRevision: 1, text: 'Уточним причину.', priority: 97, createdAt: Date.now(), source: 'local_engine' } as SuggestedReply;
    expect(shouldReplaceSuggestion(current, { ...current, basedOnRevision: 2, text: 'Какой бюджет?', priority: 50, source: 'gemini' })).toBe(false);
  });
  it('blocks stale evidence, canonical contradictions and closed metrics', () => {
    const state = input().currentState; state.paymentMethod.value = 'Ипотека';
    expect(isSuggestionAllowedByState({ basedOnRevision: 0, text: 'Уточним бюджет?' }, state)).toBe(false);
    expect(isSuggestionAllowedByState({ text: 'Покупаете без ипотеки, за наличные.' }, state)).toBe(false);
    expect(isSuggestionAllowedByState({ text: 'Где выбираете?', closesMetric: 'location' }, state)).toBe(false);
    state.budget.value = '15 млн руб';
    expect(isSuggestionAllowedByState({ text: 'Ваш бюджет 20 млн, предложу варианты.' }, state)).toBe(false);
    expect(isSuggestionAllowedByState({ text: 'Ваш бюджет 15 млн, учту при подборе.' }, state)).toBe(true);
  });
});
