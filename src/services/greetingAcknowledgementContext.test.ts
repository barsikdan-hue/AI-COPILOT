import { describe, expect, it } from 'vitest';
import { AnalysisProvider } from './analysisProvider';
import { createInitialState } from './conversationStore';
import { shouldReplaceSuggestion } from './suggestionLifecycle';
import type { SuggestedReply, TranscriptTurn } from '../types';

const sessionId = 'issue40-context';
const question = 'Как я могу обращаться к вам?';
const introductions = [
  `Добрый день, меня зовут Данил, специалист по недвижимости. ${question}`,
  `Добрый день, Данил, специалист по недвижимости компании Элитный Сочи. ${question}`,
];
const greeting = 'Да, добрый день, Данил.';
const turn = (id: string, speaker: 'agent' | 'client', text: string, revision: number): TranscriptTurn => ({
  id, sessionId, speaker, text, revision, timestamp: revision * 3000,
  source: 'microphone', isFinal: true,
});

function scheduledReason(turns: TranscriptTurn[]): string[] {
  const provider = new AnalysisProvider();
  provider.setSession(sessionId);
  const reasons: string[] = [];
  provider.setBoundaryObserver(event => { reasons.push(event.reason); });
  const latest = turns.at(-1)!;
  try {
    // Observe the real eligibility/debounce boundary without firing a remote request.
    provider.scheduleAnalysis({ sessionId, revision: latest.revision!, newTurns: [latest],
      recentTurns: turns, currentState: createInitialState() }, () => {}, () => {});
    return [...reasons];
  } finally {
    provider.cancelPending();
  }
}

function card(overrides: Partial<SuggestedReply>): SuggestedReply {
  return {
    id: 'current', sessionId, basedOnRevision: 1, candidateRuleId: null, selectedRuleId: null,
    actionType: 'CLARIFY', text: question, shortReason: 'test', expectedClientMeaning: null,
    closesMetric: null, closesMetricLabel: null, immediatePriority: null, suggestionMode: 'WAIT',
    evidenceTurnIds: [], createdAt: 1000, stage: 'contact', confidenceStatus: 'high',
    lifecycleStatus: 'shown', semanticKey: 'name-question', priority: 90, eventType: null,
    source: 'local_engine', ttlMs: 15000, used: false, ...overrides,
  } as SuggestedReply;
}

function replaceAfter(turns: TranscriptTurn[]): boolean {
  const latest = turns.at(-1)!;
  return shouldReplaceSuggestion(card({}), card({ id: 'next', basedOnRevision: latest.revision!,
    text: 'Что для вас важно в квартире?', semanticKey: 'next-question', priority: 40,
    evidenceTurnIds: [latest.id], createdAt: 2000 }), 3000, turns);
}

describe.each(introductions)('Issue #40 real caller adjacency after %s', introduction => {
  it('provider preserves a named greeting after an intervening client business turn', () => {
    expect(scheduledReason([turn('intro', 'agent', introduction, 2),
      turn('business', 'client', 'Бюджет 20 млн.', 3), turn('greeting', 'client', greeting, 4)]))
      .toEqual(['remote_debounce']);
  });

  it('lifecycle preserves release after a stale introduction and a named greeting', () => {
    expect(replaceAfter([turn('intro', 'agent', introduction, 2),
      turn('business', 'client', 'Бюджет 20 млн.', 3), turn('greeting', 'client', greeting, 4)]))
      .toBe(true);
  });

  it('both callers suppress the immediate greeting acknowledgement', () => {
    const turns = [turn('intro', 'agent', introduction, 2), turn('greeting', 'client', greeting, 3)];
    expect(scheduledReason(turns)).toEqual(['remote_ineligible']);
    expect(replaceAfter(turns)).toBe(false);
  });

  it.each(['Марина.', 'Да, конечно', '30 млн', 'дорого', 'для себя',
    '2 млн будут только в декабре', 'Добрый день, бюджет 20 млн.'])
  ('preserves an immediate substantive response through both callers: %s', text => {
    const turns = [turn('intro', 'agent', introduction, 2), turn('answer', 'client', text, 3)];
    expect(scheduledReason(turns)).toEqual(['remote_debounce']);
    expect(replaceAfter(turns)).toBe(true);
  });
});
