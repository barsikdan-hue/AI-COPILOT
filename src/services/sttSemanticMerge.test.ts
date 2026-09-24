import { afterEach, describe, expect, it, vi } from 'vitest';
import { aggregateFinalTurn, FinalTurnBuffer } from './sttDedup';
import { AnalysisProvider } from './analysisProvider';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse, restoreStateForAmendedTurn } from './localAnalysisEngine';
import { TranscriptTurn } from '../types';
import { selectFinalTranscriptionText } from './transcriptionService';

const turn = (text: string, timestamp = 0): TranscriptTurn => ({ id: 't1', sessionId: 's', speaker: 'client', source: 'call_audio', text, timestamp, isFinal: true, revision: 1 });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('STT final hypothesis selection', () => {
  it('prefers Gemini final correction over a longer noisy interim', () => {
    expect(
      selectFinalTranscriptionText(
        'Давайте сравним чистый денежный поток и риски.',
        'Давайте сравним одинаковые чистоты денежный поток возможный рост стоимости и риски.'
      )
    ).toBe('Давайте сравним чистый денежный поток и риски.');
  });

  it('recovers a richer interim only when the final is obviously truncated', () => {
    expect(
      selectFinalTranscriptionText(
        'Доходность',
        'Доходность выше депозита для меня будет минимально приемлемой.'
      )
    ).toBe('Доходность выше депозита для меня будет минимально приемлемой.');
  });
});

describe('4.0.2 semantic final aggregation', () => {
  it('T12 extended final preserves one turn, objection and Gemini batch', async () => {
    vi.useFakeTimers();
    const initial = createInitialState();
    const first = turn('Пока не готов назначать время показа. Сначала хочу определиться с вариантами.');
    const state = advanceLocalConversation(initial, first, [first]).state;
    const result = buildLocalAnalysisResponse({ sessionId: 's', revision: 1, newTurns: [first], recentTurns: [first], currentState: state });
    const fetchMock = vi.fn(() => new Promise(resolve => setTimeout(() => resolve({ ok: true, json: async () => result }), 9000)));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new AnalysisProvider(); provider.setSession('s'); const accept = vi.fn();
    provider.scheduleAnalysis({ sessionId: 's', revision: 1, newTurns: [first], recentTurns: [first], currentState: state }, accept, vi.fn());
    await vi.advanceTimersByTimeAsync(4000);
    const extended = `${first.text} А потом согласуем.`;
    const merged = aggregateFinalTurn(first, 'client', extended, 4000);
    expect(merged).toEqual({ kind: 'amend', text: extended });
    const amended = { ...first, text: merged.text, timestamp: 4000 };
    const updated = advanceLocalConversation(initial, amended, [amended]).state;
    provider.amendTurn(amended, updated);
    expect(updated.events?.filter(e => e.type === 'NEXT_STEP_RESISTANCE')).toHaveLength(1);
    expect(updated.dialogueControl?.nextStepResistance?.count).toBe(1);
    expect(provider.getMemoryBacklog()).toHaveLength(1);
    expect(provider.getMemoryBacklog()[0].text).toBe(extended);
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(accept).not.toHaveBeenCalled(); // the response was based on the shorter text
    provider.cancelPending();
  });
  it('T13 unfinished fragment plus continuation produces one full state transition', async () => {
    vi.useFakeTimers(); const emit = vi.fn(); const buffer = new FinalTurnBuffer(emit);
    buffer.push('client', 'Поэтому конкретных неудобств', 0);
    await vi.advanceTimersByTimeAsync(1200);
    expect(emit).not.toHaveBeenCalled();
    buffer.push('client', 'не было.', 1200);
    expect(emit).toHaveBeenCalledExactlyOnceWith('client', 'Поэтому конкретных неудобств не было.', 1200);
    await vi.advanceTimersByTimeAsync(2000);
    expect(emit).toHaveBeenCalledTimes(1);
    buffer.reset();
  });
  it('updates a queued batch with full text before dispatch', async () => {
    vi.useFakeTimers(); const fetchMock = vi.fn(() => new Promise(() => {})); vi.stubGlobal('fetch', fetchMock);
    const first = turn('Бюджет 15 млн.'); const state = createInitialState();
    const provider = new AnalysisProvider(); provider.setSession('s');
    provider.scheduleAnalysis({ sessionId: 's', revision: 1, newTurns: [first], recentTurns: [first], currentState: state }, vi.fn(), vi.fn());
    provider.amendTurn({ ...first, text: 'Бюджет 15 млн. До декабря.' }, state);
    await vi.advanceTimersByTimeAsync(250);
    const payload = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(payload.newTurns).toHaveLength(1); expect(payload.newTurns[0].text).toContain('До декабря.');
    provider.cancelPending();
  });
  it('does not merge different speakers, late utterances, or changed negation', () => {
    const first = turn('Хочу купить квартиру в Сочи с видом на море.');
    expect(aggregateFinalTurn(first, 'agent', first.text, 1000).kind).toBe('new');
    expect(aggregateFinalTurn(first, 'client', `${first.text} С ремонтом.`, 6000).kind).toBe('new');
    expect(aggregateFinalTurn(first, 'client', 'Не хочу купить квартиру в Сочи с видом на море.', 1000).kind).toBe('new');
  });
  it('merges a high-similarity internal STT correction, preserving changed numbers and negation as new turns', () => {
    const first = turn('Хочу купить хорошую квартиру в Сочи с красивым видом на море.');
    expect(aggregateFinalTurn(first, 'client', 'Хочу купить большую квартиру в Сочи с красивым видом на море.', 2000).kind).toBe('amend');
    expect(aggregateFinalTurn(first, 'client', 'Хочу купить хорошую квартиру в Сочи без красивого вида на море.', 2000).kind).toBe('new');
    expect(aggregateFinalTurn(turn('Хочу купить квартиру в Сочи за 15 миллионов рублей.'), 'client', 'Хочу купить квартиру в Сочи за 20 миллионов рублей.', 2000).kind).toBe('new');
  });
  it('amending evidence preserves manual used/skipped history without counting the old event twice', () => {
    const before = createInitialState(); const first = turn('Пока не готов к показу.');
    const current = advanceLocalConversation(before, first, [first]).state;
    current.askedQuestions.push('Какой у вас бюджет?');
    current.dismissedSuggestionTexts = ['Когда запланируем показ?'];
    const amended = { ...first, text: `${first.text} Сначала выберем объекты.` };
    const result = advanceLocalConversation(restoreStateForAmendedTurn(before, current), amended, [amended]).state;
    expect(result.askedQuestions).toContain('Какой у вас бюджет?');
    expect(result.dismissedSuggestionTexts).toContain('Когда запланируем показ?');
    expect(result.dialogueControl?.nextStepResistance?.count).toBe(1);
  });
});
