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
