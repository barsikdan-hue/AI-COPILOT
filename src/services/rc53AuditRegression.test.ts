import { describe, expect, it } from 'vitest';
import { extractDeterministicFacts } from './deterministicFacts';
import { detectNextStepResistance } from './objectionEngine';
import { selectCandidateRules } from './candidateRules';
import { aggregateFinalTurn } from './sttDedup';
import { createInitialState } from './conversationStore';
import { detectConversationEvent } from './conversationEventEngine';
import { isSuggestionAllowedByState, shouldReplaceSuggestion } from './suggestionLifecycle';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import type { SuggestedReply, TranscriptTurn } from '../types';

const turn = (
  id: string,
  speaker: 'agent' | 'client',
  text: string,
  revision: number
): TranscriptTurn => ({
  id,
  sessionId: 'rc53-audit',
  source: speaker === 'agent' ? 'microphone' : 'call_audio',
  speaker,
  text,
  timestamp: 1_790_300_000_000 + revision * 1000,
  isFinal: true,
  revision,
});

describe('RC5.3 audit regressions', () => {
  it('treats "not 10m, but 6m" as an explicit correction, not flexible budget', () => {
    const facts = extractDeterministicFacts(
      'Нет, не 10 миллионов, а 6 миллионов — это предел.',
      'c1'
    );
    const budget = facts.find((fact) => fact.field === 'budget');
    expect(budget?.value).toContain('6');
    expect(budget?.value).not.toContain('10');
    expect(budget?.isFlexible).toBe(false);
  });

  it('does not bind "не хочу дом" to a previous broker proposal', () => {
    const state = createInitialState();
    const resistance = detectNextStepResistance(
      'Не хочу дом, рассматриваю квартиру.',
      state,
      'Давайте подключим ипотечного брокера?'
    );
    expect(resistance).toBeNull();
  });

  it('does not select permanent-residence rule from explicit no-PMJ wording', () => {
    const rules = [
      { id: 'P48', title: 'PMJ' },
      { id: 'investor_alternative', title: 'Investor' },
    ];
    const selected = selectCandidateRules(
      rules,
      'Смотрю как вложение. Переезжать на ПМЖ я не планирую.',
      'diagnostics'
    );
    expect(selected.some((rule) => rule.id === 'P48')).toBe(false);
    expect(selected.some((rule) => rule.id === 'investor_alternative')).toBe(true);
  });

  it('does not merge opposite STT assertions into one turn', () => {
    const previous = turn('c1', 'client', 'Я хочу квартиру', 1);
    const result = aggregateFinalTurn(previous, 'client', 'Я не хочу квартиру', previous.timestamp + 1000);
    expect(result.kind).toBe('new');
    expect(result.text).toBe('Я не хочу квартиру');
  });

  it('does not invent a slot when agent offered two and client accepted only the meeting', () => {
    const agent = turn('a1', 'agent', 'Можем созвониться сегодня в 18:00 или завтра в 13:00. Что удобнее?', 1);
    const client = turn('c1', 'client', 'Да, давайте созвонимся, время предложите.', 2);
    const event = detectConversationEvent(client, [agent, client], createInitialState());
    expect(event?.type).toBe('MEETING_CONTRACT');
    expect(event?.meetingContract?.time).toBeNull();
    expect(event?.suggestedReply).toMatch(/время|вариант/iu);
  });

  it('allows a meeting confirmation card even when PPV metric is already closed', () => {
    const state = createInitialState();
    (state as any).scriptProgress = { metrics: { ppv: { status: 'confirmed' } } };
    const allowed = isSuggestionAllowedByState(
      {
        basedOnRevision: state.revision,
        text: 'Да, завтра в 12:00. Зафиксирую.',
        closesMetric: 'ppv',
        eventType: 'MEETING_CONTRACT',
        actionType: 'PROPOSE_NEXT_STEP',
      },
      state,
      state.revision
    );
    expect(allowed).toBe(true);
  });

  it('lets a corrected local card replace a same-revision local card', () => {
    const base: SuggestedReply = {
      id: 'r1',
      sessionId: 's',
      basedOnRevision: 5,
      candidateRuleId: null,
      text: 'Первый смысл',
      shortReason: 'old',
      evidenceTurnIds: ['c1'],
      createdAt: 1000,
      stage: 'diagnostics',
      confidenceStatus: 'high',
      lifecycleStatus: 'shown',
      semanticKey: 'old',
      priority: 50,
      source: 'local_engine',
    };
    const corrected: SuggestedReply = {
      ...base,
      id: 'r2',
      text: 'Исправленный смысл',
      shortReason: 'new',
      createdAt: 1100,
      lifecycleStatus: 'candidate',
      semanticKey: 'new',
    };
    expect(shouldReplaceSuggestion(base, corrected, 1150)).toBe(true);
  });

  it('keeps canonical investment goal aligned with first-call metric', () => {
    const state0 = createInitialState();
    const client = turn(
      'c1',
      'client',
      'Скорее смотрю как вложение, но хотелось бы и самому иногда приезжать на пару недель. Переезжать на постоянку точно не собираюсь.',
      1
    );
    const state = advanceLocalConversation(state0, client, [client]).state;
    expect(state.goal.value).toMatch(/инвестиц/iu);
    expect(state.scriptProgress?.metrics.goal.value).toMatch(/инвестиц/iu);
    expect(state.scriptProgress?.metrics.goal.value).not.toMatch(/постоянн.*прожив|пмж/iu);
  });

  it('normalizes a partial state instead of throwing during local analysis', () => {
    const client = turn('c1', 'client', 'Бюджет около 30 миллионов.', 1);
    expect(() =>
      buildLocalAnalysisResponse({
        sessionId: 's',
        revision: 1,
        newTurns: [client],
        recentTurns: [client],
        currentState: {} as any,
      })
    ).not.toThrow();
  });
});
