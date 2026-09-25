import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { evaluateFirstCallScript } from './firstCallScriptEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { chooseDialoguePolicyTarget } from './dialoguePolicyEngine';

function turn(id: string, speaker: 'agent' | 'client', text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'dialogue-policy-v1',
    source: speaker === 'agent' ? 'microphone' : 'call_audio',
    speaker,
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

function buildState(turns: TranscriptTurn[]) {
  let state = createInitialState();
  for (let i = 0; i < turns.length; i += 1) {
    state = advanceLocalConversation(state, turns[i], turns.slice(0, i + 1)).state;
  }
  const progress = evaluateFirstCallScript(turns, state);
  return { ...state, scriptProgress: progress };
}

function analyze(turns: TranscriptTurn[]) {
  const state = buildState(turns);
  const latest = turns.at(-1)!;
  return buildLocalAnalysisResponse({
    sessionId: latest.sessionId,
    revision: latest.revision || turns.length,
    newTurns: [latest],
    recentTurns: turns,
    currentState: state,
  });
}

describe('Dialogue Policy Engine V1', () => {
  it('moves to property format after permanent-living goal and quiet/logistics criteria instead of past experience', () => {
    const turns = [
      turn('a1', 'agent', 'А для себя это больше про отдых, сезонное проживание или планируете жить постоянно?', 1),
      turn('c1', 'client', 'Для постоянной жизни, для себя.', 2),
      turn('a2', 'agent', 'Что по локации для вас важнее?', 3),
      turn('c2', 'client', 'Больше тишина, но чтобы не быть отрезанным от цивилизации и с нормальной логистикой.', 4),
    ];
    const state = buildState(turns);
    const decision = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);

    expect(decision?.branch).toBe('property_format');
    expect(decision?.metric).toBe('propertyType');
  });

  it('never reopens experience after the client says there is nothing to highlight', () => {
    const turns = [
      turn('a1', 'agent', 'Что из уже увиденного вам понравилось больше всего, а что точно не хотите повторять?', 1),
      turn('c1', 'client', 'Я пока не могу ничего выделить, яркого примера нет.', 2),
      turn('a2', 'agent', 'Для чего выбираете недвижимость?', 3),
      turn('c2', 'client', 'Для постоянной жизни.', 4),
    ];
    const state = buildState(turns);
    const decision = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);

    expect(decision?.metric).not.toBe('experience');
  });

  it('follows a finance turn instead of jumping to an unrelated branch', () => {
    const turns = [
      turn('a1', 'agent', 'Для чего выбираете недвижимость?', 1),
      turn('c1', 'client', 'Для постоянной жизни.', 2),
      turn('a2', 'agent', 'Что для вас важно в выборе?', 3),
      turn('c2', 'client', 'Тишина и нормальная логистика.', 4),
      turn('c3', 'client', 'По деньгам пока думаю, ипотека или свои средства.', 5),
    ];
    const state = buildState(turns);
    const decision = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);

    expect(decision?.branch).toBe('finance');
    expect(['budget', 'paymentMethod']).toContain(decision?.metric);
  });

  it('does not mask the SPIN future-risk handoff after client has no concrete viewing history', () => {
    const turns = [
      turn('a1', 'agent', 'Как вообще сейчас ощущения от рынка Сочи? Давно присматриваетесь или только начали?', 1),
      turn('c1', 'client', 'Только смотрю так долго, знаете ли, лениво, ничего конкретного.', 2),
      turn('a2', 'agent', 'А что уже успели посмотреть и что из увиденного вам понравилось или, наоборот, оттолкнуло?', 3),
      turn('c2', 'client', 'Да, знаете, я ничего конкретного не смотрел. Так, в общих чертах порасспрашивал там и здесь, но пока ничего.', 4),
    ];
    const state = buildState(turns);
    const decision = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);

    expect(state.spin?.pastExperienceQuestionClosed || state.spinState?.pastExperienceQuestionClosed).toBe(true);
    expect(state.spin?.researchMode || state.spinState?.researchMode).toBe(true);
    expect(decision).toBeNull();
  });

  it('does not resurrect the same goal policy after the agent skipped that visible hint', () => {
    const turns = [
      turn('a1', 'agent', 'Добрый день. Как я могу к вам обращаться?', 1),
      turn('c1', 'client', 'Андрей.', 2),
    ];
    const state = buildState(turns);
    state.dismissedSuggestionTexts = [
      'Что должно измениться после покупки: переезд, свой формат отдыха или работа капитала?',
    ];

    const decision = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);

    expect(decision?.semanticKey).not.toBe('ask_goal');
  });

  it('starts with search orientation instead of immediately asking the same generic goal question', () => {
    const turns = [
      turn('a1', 'agent', 'Добрый день. Меня зовут Данил. Как я могу к вам обращаться?', 1),
      turn('c1', 'client', 'Сергей.', 2),
    ];
    const state = buildState(turns);
    const decision = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);

    expect(decision).toMatchObject({
      branch: 'orientation',
      metric: null,
      semanticKey: 'ask_search_experience',
      priority: 92,
    });
  });

  it('asks why now after a passive search-orientation answer', () => {
    const turns = [
      turn('a1', 'agent', 'Как вообще сейчас ощущения от рынка Сочи? Давно присматриваетесь или только начали?', 1),
      turn('c1', 'client', 'Только начал изучать, пока ничего конкретного.', 2),
    ];
    const state = buildState(turns);
    const decision = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);

    expect(decision).toMatchObject({
      branch: 'orientation',
      metric: null,
      semanticKey: 'ask_motive_now',
      priority: 90,
    });
  });

  it('renders the why-now micro-goal as a real hint without pretending it closes a quality metric', () => {
    const result = analyze([
      turn('a1', 'agent', 'Как вообще сейчас ощущения от рынка Сочи? Давно присматриваетесь или только начали?', 1),
      turn('c1', 'client', 'Только начал изучать, пока ничего конкретного.', 2),
    ]);

    expect(result.candidateRuleId).toContain('dialogue_policy_orientation_ask_motive_now');
    expect(result.suggestedReply).toMatch(/сейчас|именно сейчас|подтолкнул|этапе/iu);
    expect(result.closesMetric).toBeNull();
    expect(result.immediatePriority).toContain('Причина актуальности сейчас');
  });

  it('does not ask why now when the client already gave the trigger in the orientation answer', () => {
    const turns = [
      turn('a1', 'agent', 'Давно присматриваетесь или только начали изучать рынок?', 1),
      turn('c1', 'client', 'Только начал, потому что через три месяца переезжаем в Сочи.', 2),
    ];
    const state = buildState(turns);
    const decision = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);

    expect(decision?.semanticKey).not.toBe('ask_motive_now');
  });

  it('does not resurrect a skipped why-now hint on the next policy pass', () => {
    const turns = [
      turn('a1', 'agent', 'Давно присматриваетесь или только начали изучать рынок?', 1),
      turn('c1', 'client', 'Пока просто присматриваюсь.', 2),
    ];
    const state = buildState(turns);
    state.dismissedSuggestionTexts = [
      'Что изменилось сейчас, что тема недвижимости стала для вас актуальнее?',
    ];

    const decision = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);

    expect(decision?.semanticKey).not.toBe('ask_motive_now');
  });
});
