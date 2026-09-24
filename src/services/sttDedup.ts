import { SpeakerRole, TranscriptTurn } from '../types';

/**
 * Duplicate Final STT Turn Protection
 * Deduplicates identical final turns from the same speaker arriving within a short time window (e.g. 1000-1500ms),
 * which can occur when WebSocket reconnections or chunk replays happen.
 */
export function isDuplicateFinalTurn(
  lastTurn: TranscriptTurn | null | undefined,
  newSpeaker: SpeakerRole,
  newText: string,
  newTimestamp: number,
  windowMs: number = 1500
): boolean {
  if (!lastTurn) return false;
  if (lastTurn.speaker !== newSpeaker) return false;

  const normLast = lastTurn.text.trim().toLowerCase();
  const normNew = newText.trim().toLowerCase();
  if (normLast !== normNew) return false;

  const diff = Math.abs(newTimestamp - lastTurn.timestamp);
  return diff <= windowMs;
}

const normalized = (text: string) => text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Amend the same logical turn; retain the complete transcript rather than a summary. */
export function aggregateFinalTurn(last: TranscriptTurn | undefined, speaker: SpeakerRole, text: string, timestamp: number): { kind: 'new' | 'duplicate' | 'amend'; text: string } {
  if (!last || last.speaker !== speaker || timestamp < last.timestamp || timestamp - last.timestamp > 5000) return { kind: 'new', text };
  const before = normalized(last.text); const after = normalized(text);
  if (before.startsWith('не ') !== after.startsWith('не ') && (before.includes(after) || after.includes(before))) return { kind: 'new', text };
  if (before === after || (after.length > 0 && before.includes(after))) return { kind: 'duplicate', text: last.text };
  if (before.length > 0 && after.includes(before)) return { kind: 'amend', text };
  const left = before.split(' '); const right = after.split(' ');
  // Token edit similarity also handles small STT corrections inside a sentence.
  // Changed numbers or negation are new assertions, not harmless recognition edits.
  const anchors = (tokens: string[]) => tokens.filter(token => /^(?:не|нет|без|никогда|\d+)$/u.test(token)).join(' ');
  const lexical = (tokens: string[]) => new Set(tokens.filter(token => token.length > 2 && !/^(?:не|нет|без|никогда)$/u.test(token)));
  const leftLexical = lexical(left); const rightLexical = lexical(right);
  const sharedLexical = [...leftLexical].filter(token => rightLexical.has(token)).length;
  const lexicalOverlap = Math.min(leftLexical.size, rightLexical.size) > 0
    ? sharedLexical / Math.min(leftLexical.size, rightLexical.size)
    : 0;
  if (anchors(left) !== anchors(right) && lexicalOverlap >= 0.6) return { kind: 'new', text };
  if (Math.min(left.length, right.length) >= 6 && Math.max(left.length, right.length) <= 400 && anchors(left) === anchors(right)) {
    let distance = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i++) {
      const next = [i];
      for (let j = 1; j <= right.length; j++) next[j] = Math.min(next[j - 1] + 1, distance[j] + 1, distance[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
      distance = next;
    }
    if (1 - distance[right.length] / Math.max(left.length, right.length) >= 0.82) return { kind: 'amend', text };
  }
  if (timestamp - last.timestamp <= 1500 && !/[.!?…]$/.test(last.text.trim()) && right.length <= 5) {
    return { kind: 'amend', text: `${last.text.trim()} ${text.trim()}` };
  }
  return { kind: 'new', text };
}

/** Hold clearly unfinished causal fragments so they do not advance SPIN on their own. */
export class FinalTurnBuffer {
  private pending: { speaker: SpeakerRole; text: string; timestamp: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private emit: (speaker: SpeakerRole, text: string, timestamp: number) => void) {}
  push(speaker: SpeakerRole, text: string, timestamp = Date.now()) {
    if (this.pending) {
      const pending = this.pending;
      if (pending.speaker === speaker && timestamp - pending.timestamp <= 1500) {
        this.reset();
        const merged = aggregateFinalTurn({ ...pending } as TranscriptTurn, speaker, text, timestamp);
        this.emit(speaker, merged.kind === 'new' ? `${pending.text} ${text}` : merged.text, timestamp);
        return;
      }
      this.flush();
    }
    if (!/[.!?…]$/.test(text.trim()) && /^(?:поэтому|потому что|так как|если|когда|в результате)\s/iu.test(text) && text.split(/\s+/).length <= 6) {
      this.pending = { speaker, text, timestamp };
      this.timer = setTimeout(() => this.flush(), 1500);
    } else this.emit(speaker, text, timestamp);
  }
  flush() {
    const pending = this.pending; this.reset();
    if (pending) this.emit(pending.speaker, pending.text, pending.timestamp);
  }
  reset() { if (this.timer) clearTimeout(this.timer); this.timer = null; this.pending = null; }
}
