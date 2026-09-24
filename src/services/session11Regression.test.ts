import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { detectConversationEvent } from './conversationEventEngine';
import { createInitialSpinState, evaluateSpinAndHpb } from './spinEngine';

type Speaker = 'agent' | 'client';

const makeTurn = (id: string, speaker: Speaker, text: string, revision: number): TranscriptTurn => ({
  id,
  sessionId: 'session11-regression',
  source: speaker === 'client' ? 'call_audio' : 'microphone',
  speaker,
  text,
  timestamp: 1_790_229_000_000 + revision * 1000,
  isFinal: true,
  revision,
});

function replay(lines: Array<[Speaker, string]>) {
  let state = createInitialState();
  const turns: TranscriptTurn[] = [];
  const hints: Array<{ text: string | null; clientText: string; state: ConversationState }> = [];

  lines.forEach(([speaker, text], index) => {
    const turn = makeTurn(`t${index + 1}`, speaker, text, index + 1);
    turns.push(turn);
    const advanced = advanceLocalConversation(state, turn, turns);
    state = advanced.state;
    if (speaker === 'client') {
      const response = buildLocalAnalysisResponse({
        sessionId: 'session11-regression',
        revision: index + 1,
        newTurns: [turn],
        recentTurns: turns.slice(-12),
        currentState: state,
      });
      hints.push({ text: response.suggestedReply, clientText: text, state });
    }
  });

  return { state, turns, hints };
}

describe('session 11 field regression', () => {
  it('keeps investment goal when permanent relocation is explicitly rejected', () => {
    const { state } = replay([
      ['agent', 'Что стало причиной заняться недвижимостью сейчас?'],
      ['client', 'Ну, скорее смотрю как вложение. Есть свободные деньги, но не хочется их держать просто так.'],
      ['agent', 'А для себя это отдых или постоянное проживание?'],
      ['client', 'Скорее смотрю как вложение, но хотелось бы и самому иногда приезжать на пару недель. Переезжать на постоянку точно не собираюсь.'],
    ]);

    expect(state.goal.value).toMatch(/инвестиц/iu);
    expect(state.goal.value).toMatch(/личн|период/iu);
    expect(state.goal.value).not.toMatch(/постоянн.*прожив|пмж|переезд/iu);
    expect(state.scriptProgress?.metrics.goal.value).toMatch(/инвестиц/iu);
    expect(state.scriptProgress?.metrics.goal.value).not.toMatch(/постоянн.*прожив|переезд/iu);
  });

  it('keeps target and stretch budget instead of overwriting target with 40m', () => {
    const { state } = replay([
      ['client', 'Примерно 30-35 млн руб. за адекватный вариант.'],
      ['client', 'Если объект покажет понятную разницу, я готов рассматривать до 40 млн, но пока около тридцати.'],
    ]);

    expect(state.budget.value).toMatch(/30/);
    expect(state.budget.value).toMatch(/40/);
    expect(state.budget.isFlexible).toBe(true);
  });

  it('recognizes explicit single decision maker and prior search experience', () => {
    const { state } = replay([
      ['client', 'Я открываю десятки презентаций и вообще не понимаю, чем один объект отличается от другого.'],
      ['agent', 'Кто ещё будет участвовать в выборе?'],
      ['client', 'Финальное решение моё. Супруга посмотрит уже те варианты, которые я отберу.'],
    ]);

    expect(state.searchExperience?.value).toMatch(/подбор|агент|рынок|презентац/iu);
    expect(state.scriptProgress?.metrics.experience.status).toBe('confirmed');
    expect(state.decisionMakers?.value).toMatch(/самостоятель|единолич|сам/iu);
    expect(state.scriptProgress?.metrics.decisionMaker.status).toBe('confirmed');
  });

  it('treats real yield question as a direct question, not a fake property-details answer', () => {
    const client = makeTurn(
      'c-yield',
      'client',
      'Скорее форматы и реальная доходность, но только не рекламная. Сколько вообще там на практике можно получить?',
      2
    );
    const agent = makeTurn('a1', 'agent', 'Что сейчас сложнее сравнить?', 1);
    const event = detectConversationEvent(client, [agent, client], createInitialState());

    expect(event?.type).toBe('DIRECT_QUESTION');
    expect(event?.ruleId).toBe('direct_question_yield_comparison');
    expect(event?.suggestedReply).toMatch(/доходност|денежн|депозит|рост/iu);
    expect(event?.suggestedReply).not.toMatch(/выбранному объекту/iu);
  });

  it('classifies comparison overload as SPIN Problem evidence', () => {
    const client = makeTurn(
      'c-problem',
      'client',
      'Я вообще не понял, чем один отличается от другого. У всех одно и то же. Я открываю десятки презентаций и не понимаю, что реально имеет смысл.',
      2
    );
    const result = evaluateSpinAndHpb(
      client,
      createInitialSpinState(),
      'asked_problem_question',
      'Что из того, что вы уже видели, вас не устроило больше всего?'
    );

    expect(result.updatedSpin.problem.length).toBeGreaterThan(0);
    expect(result.updatedSpin.problem.at(-1)?.evidenceQuote).toContain('не понял');
  });

  it('uses investment risk, not an arbitrary sea criterion, for research-mode Problem', () => {
    const state = createInitialState();
    state.goal = { value: 'Инвестиции + периодическое личное использование', evidenceTurnIds: ['g1'] };
    state.primaryGoal = { value: 'Инвестиции', evidenceTurnIds: ['g1'] };
    state.criteria = {
      value: 'Близость к морю / пляжу, Доходность / экономика проекта, Ликвидность / возможность перепродажи',
      items: [
        { text: 'Близость к морю / пляжу', evidenceTurnId: 'c1' },
        { text: 'Доходность / экономика проекта', evidenceTurnId: 'c2' },
        { text: 'Ликвидность / возможность перепродажи', evidenceTurnId: 'c3' },
      ],
      evidenceTurnIds: ['c1', 'c2', 'c3'],
    };
    const spin = createInitialSpinState();
    spin.researchMode = true;
    spin.situation = [
      { text: 'Изучает рынок', evidenceQuote: 'изучаю рынок', evidenceTurnId: 's1', source: 'client', confidence: 0.9 },
      { text: 'Инвестиционная цель', evidenceQuote: 'как вложение', evidenceTurnId: 's2', source: 'client', confidence: 0.9 },
    ];
    const client = makeTurn(
      'c-risk',
      'client',
      'Скорее смотрю как вложение, но хотелось бы иногда самому приезжать. Переезжать точно не собираюсь.',
      3
    );

    const result = evaluateSpinAndHpb(client, spin, 'none', '', state);
    expect(result.suggestionMode).toBe('SPIN_PROBLEM');
    expect(result.suggestedText).toMatch(/инвестиц|аренд|перепродаж|переплат/iu);
    expect(result.suggestedText).not.toMatch(/учитывать.*море|учитывать.*пляж/iu);
  });

  it('does not repeat the yield threshold after client already names deposit as baseline', () => {
    const { hints } = replay([
      ['client', 'Если недвижимость даст меньше, зачем мне менять инструмент? Сейчас деньги лежат на депозите.'],
      ['agent', 'Какой результат для вас будет минимально приемлемым?'],
      ['client', 'Если недвижимость даст доходность выше депозита, её можно сдавать и потом нормально продать, это уже адекватно. Если меньше депозита — смысла нет.'],
    ]);

    const last = hints.at(-1)?.text || '';
    expect(last).toMatch(/планк|депозит|сда|ликвид|сравни/iu);
    expect(last).not.toMatch(/какую доходность.*считаете|какой результат.*минимально/iu);
  });
});
