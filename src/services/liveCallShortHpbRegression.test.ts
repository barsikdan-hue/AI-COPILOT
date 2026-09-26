import { describe, expect, it } from 'vitest';
import { createInitialSpinState, evaluateSpinAndHpb } from './spinEngine';

const clientTurn = (text: string) => ({
  id: 'client-investor-need-payoff',
  sessionId: 'live-call-short-hpb',
  source: 'call_audio',
  speaker: 'client',
  text,
  timestamp: 1,
  isFinal: true,
  revision: 12,
}) as any;

describe('live call concise HPB regression', () => {
  it('does not echo the whole client monologue in an investor HPB suggestion', () => {
    const spin = createInitialSpinState();
    spin.situation = [
      {
        text: 'Клиент изучает инвестиционный формат.',
        evidenceQuote: 'Думаю про инвестицию.',
        evidenceTurnId: 's1',
        source: 'client',
        confidence: 0.95,
      },
      {
        text: 'Клиент хочет минимум операционного участия.',
        evidenceQuote: 'Не хочу заниматься операционкой.',
        evidenceTurnId: 's2',
        source: 'client',
        confidence: 0.95,
      },
    ];

    const text = 'Скорее стабильный доход без моего постоянного участия. Рост капитала тоже хорошо, но не с нервами и ежедневным контролем. Да, именно максимально пассивно.';

    const result = evaluateSpinAndHpb(
      clientTurn(text),
      spin,
      'none',
      'То есть правильно понимаю, пассивный доход?',
      {
        goal: { value: 'Инвестиции', evidenceTurnIds: ['g1'] },
        criteria: {
          value: 'Доходность / экономика проекта',
          items: [{ text: 'Доходность / экономика проекта', evidenceTurnId: 'c1' }],
          evidenceTurnIds: ['c1'],
        },
        dialogueControl: {},
        activeObjection: null,
      } as any,
    );

    expect(result.suggestionMode).toBe('HPB_PRESENTATION');
    expect(result.suggestedText.length).toBeLessThanOrEqual(140);
    expect(result.suggestedText).toMatch(/чистому доходу|расходам|управлению/iu);
    expect(result.suggestedText).not.toContain(text);
    expect(result.suggestedText).not.toMatch(/вы сказали/iu);
  });
});
