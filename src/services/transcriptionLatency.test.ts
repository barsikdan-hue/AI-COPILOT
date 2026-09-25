import { afterEach, describe, expect, it, vi } from 'vitest';
import { VAD_FINAL_GRACE_MS, VadFinalCommitter } from './transcriptionService';

afterEach(() => {
  vi.useRealTimers();
});

describe('VAD-first transcript finalization', () => {
  it('commits the latest interim shortly after explicit speech end', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T13:00:00Z'));
    const commit = vi.fn();
    const committer = new VadFinalCommitter(commit);

    committer.onInterim('Мне важны тишина и нормальная логистика.');
    committer.onActivity(false);

    await vi.advanceTimersByTimeAsync(VAD_FINAL_GRACE_MS - 1);
    expect(commit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0]).toBe('Мне важны тишина и нормальная логистика.');
  });

  it('lets the real Gemini final win when it arrives inside the grace window', async () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const committer = new VadFinalCommitter(commit);

    committer.onInterim('Мне важны тишина и нормальная логистика');
    committer.onActivity(false);
    await vi.advanceTimersByTimeAsync(80);
    committer.onFinal('Мне важны тишина и нормальная логистика.', 1234);
    await vi.advanceTimersByTimeAsync(VAD_FINAL_GRACE_MS);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('Мне важны тишина и нормальная логистика.', 1234);
  });

  it('does not emit a duplicate when the late final only corrects punctuation', async () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const committer = new VadFinalCommitter(commit);

    committer.onInterim('Бюджет примерно двадцать миллионов');
    committer.onActivity(false);
    await vi.advanceTimersByTimeAsync(VAD_FINAL_GRACE_MS);
    committer.onFinal('Бюджет примерно двадцать миллионов.', 2000);

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('emits a materially corrected late final so the amendment pipeline can repair state', async () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const committer = new VadFinalCommitter(commit);

    committer.onInterim('Мне нужна квартира в Сочи с красивым видом на море');
    committer.onActivity(false);
    await vi.advanceTimersByTimeAsync(VAD_FINAL_GRACE_MS);
    committer.onFinal('Мне нужна большая квартира в Сочи с красивым видом на море.', 2000);

    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit.mock.calls[1]).toEqual([
      'Мне нужна большая квартира в Сочи с красивым видом на море.',
      2000,
    ]);
  });
});
