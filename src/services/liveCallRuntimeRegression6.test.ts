import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SpeakerRole, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { checkSemanticAntiRepeat, extractSemanticKey } from './semanticAntiRepeat';

function turn(id: string, speaker: SpeakerRole, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'live-runtime-regression-6',
    source: speaker === 'agent' ? 'microphone' : 'call_audio',
    speaker,
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

describe('2026-09-25 runtime Gemini and semantic-repeat regression #6', () => {
  it('production start actually enables Gemini semantic analysis', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    );

    expect(packageJson.scripts.start).toContain('COPILOT_ANALYSIS_MODE=gemini');
  });

  it('maps all live-call timeline phrasings to one semantic key', () => {
    expect(extractSemanticKey('К какому сроку планируете определиться с покупкой?')).toBe('ask_timeline');
    expect(extractSemanticKey('Понял. А с каким сроком вы планируете определиться с покупкой?')).toBe('ask_timeline');
    expect(extractSemanticKey('Скажите, пожалуйста, а 2-3 месяца что вы вкладываете?')).toBe('ask_timeline');
  });

  it('does not ask the goal twice after the usage clarification already asked the same meaning', () => {
    const usageQuestion = 'Понял. А для себя это больше про отдых, сезонное проживание или планируете жить постоянно?';
    expect(extractSemanticKey(usageQuestion)).toBe('ask_goal');

    const state = createInitialState();
    state.askedQuestions = [usageQuestion];
    const recentTurns = [
      turn('a1', 'agent', usageQuestion, 1),
      turn('c1', 'client', 'Да, скорее всего, постоянно.', 2),
    ];

    const result = checkSemanticAntiRepeat(
      'Для чего выбираете недвижимость: отдых, постоянная жизнь или инвестиции?',
      state,
      recentTurns
    );

    expect(result.semanticKey).toBe('ask_goal');
    expect(result.accepted).toBe(false);
  });

  it('blocks a repeated deadline question when the client already said two-three months even if state enrichment is late', () => {
    const state = createInitialState();
    const recentTurns = [
      turn('a2', 'agent', 'А к какому сроку планируете определиться с покупкой?', 1),
      turn('c2', 'client', 'Ну, внутри, наверное, двух-трех месяцев. Да, так.', 2),
    ];

    const result = checkSemanticAntiRepeat(
      'К какому сроку планируете определиться с покупкой?',
      state,
      recentTurns
    );

    expect(result.semanticKey).toBe('ask_timeline');
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toMatch(/срок|задавал/iu);
  });
});
