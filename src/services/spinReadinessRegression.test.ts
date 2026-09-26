import { describe, expect, it } from 'vitest';
import { classifyAgentAction, createInitialSpinState, evaluateSpinAndHpb } from './spinEngine';

const clientTurn = (text: string) => ({
  id: 'client-1',
  sessionId: 'spin-readiness-regression',
  source: 'call_audio',
  speaker: 'client',
  text,
  timestamp: 1,
  isFinal: true,
  revision: 11,
}) as any;

const situationItem = (id: string, text: string) => ({
  text,
  evidenceQuote: text,
  evidenceTurnId: id,
  source: 'client' as const,
  confidence: 0.95,
});

describe('SPIN readiness gate', () => {
  it('does not jump from a location preference into implication before enough context is accumulated', () => {
    const spin = createInitialSpinState();
    spin.situation = [
      situationItem('s1', 'Готов сравнить квартиру и апартаменты, главное без постоянного управления.'),
    ];
    const agentText = 'Какие районы в Сочи для вас приоритетны, а какие сразу исключаем?';

    const result = evaluateSpinAndHpb(
      clientTurn('Чётко район ещё не сузил. Скорее не про тусовку и шум в центре. Важнее тишина, нормальная среда и чтобы можно было спокойно дойти до моря без толпы и суеты.'),
      spin,
      classifyAgentAction(agentText),
      agentText,
      {
        goal: { value: 'Отдых и сезонное проживание', evidenceTurnIds: ['g1'] },
        primaryGoal: { value: 'Отдых', evidenceTurnIds: ['g1'] },
        criteria: {
          value: 'Тишина, пешая доступность до моря',
          items: [{ text: 'Тишина / спокойное окружение', evidenceTurnId: 'c1' }],
          evidenceTurnIds: ['c1'],
        },
        dialogueControl: {},
        activeObjection: null,
      } as any,
    );

    expect(result.suggestionMode).not.toBe('SPIN_IMPLICATION');
    expect(result.suggestedText).not.toMatch(/что именно больше всего страдает/iu);
    expect(result.updatedSpin.problem).toHaveLength(0);
    expect(result.updatedSpin.implication).toHaveLength(0);
  });

  it('allows SPIN after goal, criteria and a sufficient situation base are present', () => {
    const spin = createInitialSpinState();
    spin.situation = [
      situationItem('s1', 'Покупка нужна для собственного отдыха.'),
      situationItem('s2', 'Важны тишина и пешая доступность до моря.'),
    ];

    const result = evaluateSpinAndHpb(
      clientTurn('В прошлый раз было слишком шумно, дорога под окнами, нормально отдыхать было сложно.'),
      spin,
      'none',
      'Что из того, что уже смотрели, не устроило больше всего?',
      {
        goal: { value: 'Отдых и сезонное проживание', evidenceTurnIds: ['g1'] },
        primaryGoal: { value: 'Отдых', evidenceTurnIds: ['g1'] },
        criteria: {
          value: 'Тишина, пешая доступность до моря',
          items: [{ text: 'Тишина / спокойное окружение', evidenceTurnId: 'c1' }],
          evidenceTurnIds: ['c1'],
        },
        dialogueControl: {},
        activeObjection: null,
      } as any,
    );

    expect(result.suggestionMode).toBe('SPIN_IMPLICATION');
    expect(result.updatedSpin.problem.length).toBeGreaterThan(0);
  });
});
