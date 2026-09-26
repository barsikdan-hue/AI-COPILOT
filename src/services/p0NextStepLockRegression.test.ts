import { describe, expect, it } from 'vitest';
import type { SuggestedReply, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { evaluateFirstCallScript } from './firstCallScriptEngine';
import { chooseDialoguePolicyTarget } from './dialoguePolicyEngine';
import { isSuggestionAllowedByState, shouldReplaceSuggestion } from './suggestionLifecycle';

function turn(id: string, speaker: 'agent' | 'client', text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'p0-next-step-lock',
    source: speaker === 'agent' ? 'microphone' : 'call_audio',
    speaker,
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

function reply(overrides: Partial<SuggestedReply>): SuggestedReply {
  return {
    id: 'reply',
    sessionId: 'p0-next-step-lock',
    basedOnRevision: 20,
    candidateRuleId: null,
    actionType: 'CLARIFY',
    suggestionMode: 'WAIT',
    text: 'Что уже успели посмотреть в Сочи?',
    shortReason: 'Диагностика',
    evidenceTurnIds: ['c20'],
    createdAt: 20000,
    stage: 'diagnostics',
    priority: 70,
    source: 'local_engine',
    ...overrides,
  };
}

describe('P0 agreed-next-step and session-memory regression', () => {
  it('remembers why-now across the whole session even when the original turn is outside recent context', () => {
    const state = createInitialState();
    state.askedQuestions = [
      'Рынок Сочи давно отслеживаете или интерес появился недавно?',
      'Какую задачу хочется решить покупкой именно на этом этапе?',
    ];

    const recentTurns = [
      turn('a18', 'agent', 'Что уже успели посмотреть в Сочи?', 18),
      turn('c19', 'client', 'Пока ничего конкретного не смотрел, просто присматриваюсь.', 19),
    ];
    state.scriptProgress = evaluateFirstCallScript(recentTurns, state);

    const decision = chooseDialoguePolicyTarget(state, recentTurns, state.scriptProgress);

    expect(decision?.semanticKey).not.toBe('ask_motive_now');
    expect(decision?.semanticKey).not.toBe('ask_search_experience');
  });

  it('stops dialogue policy discovery once the next step is agreed', () => {
    const state = createInitialState();
    const recentTurns = [
      turn('a19', 'agent', 'Зафиксируем короткий созвон. Какой вариант удобен?', 19),
      turn('c20', 'client', 'Давай завтра после 12.', 20),
    ];
    state.nextStepAgreement = {
      action: 'Короткий созвон',
      timeOrDeadline: 'завтра после 12',
      status: 'agreed',
    };
    state.scriptProgress = evaluateFirstCallScript(recentTurns, state);

    expect(chooseDialoguePolicyTarget(state, recentTurns, state.scriptProgress)).toBeNull();
  });

  it('blocks ordinary discovery cards after an agreed next step', () => {
    const state = createInitialState();
    state.revision = 20;
    state.nextStepAgreement = {
      action: 'Короткий созвон',
      timeOrDeadline: 'завтра после 12',
      status: 'agreed',
    };

    const diagnostic = reply({
      semanticKey: 'ask_experience',
      closesMetric: 'experience',
      text: 'Что уже успели посмотреть в Сочи и почему пока ни на чём не остановились?',
    });

    expect(isSuggestionAllowedByState(diagnostic, state, 20)).toBe(false);
  });

  it('still allows a direct client question after an agreed next step', () => {
    const state = createInitialState();
    state.revision = 20;
    state.nextStepAgreement = {
      action: 'Короткий созвон',
      timeOrDeadline: 'завтра после 12',
      status: 'agreed',
    };

    const directAnswer = reply({
      actionType: 'ANSWER',
      eventType: 'DIRECT_QUESTION',
      semanticKey: 'direct_question_price',
      closesMetric: null,
      text: 'По цене отвечу по актуальной базе, без выдуманных цифр.',
      source: 'local_event',
      priority: 106,
    });

    expect(isSuggestionAllowedByState(directAnswer, state, 20)).toBe(true);
  });

  it('does not let local_engine erase a local_event on the same revision without winning arbitration', () => {
    const currentEvent = reply({
      id: 'meeting-event',
      actionType: 'PROPOSE_NEXT_STEP',
      eventType: 'MEETING_CONTRACT',
      semanticKey: 'meeting_contract',
      closesMetric: 'ppv',
      text: 'Да, завтра после 12. Зафиксирую короткий созвон.',
      source: 'local_event',
      priority: 95,
      createdAt: 20000,
    });
    const laterDiagnostic = reply({
      id: 'later-diagnostic',
      semanticKey: 'ask_goal',
      closesMetric: 'goal',
      text: 'Какую задачу должна решить покупка?',
      source: 'local_engine',
      priority: 90,
      createdAt: 20010,
    });

    expect(shouldReplaceSuggestion(currentEvent, laterDiagnostic, 20020)).toBe(false);
  });
});
