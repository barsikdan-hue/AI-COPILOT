import { describe, expect, it } from 'vitest';
import { extractSemanticCriteria } from './semanticEvidence';

describe('live semantic regressions 2026-09-25', () => {
  it('does not treat conversational silence from agents as a quiet-location criterion', () => {
    const criteria = extractSemanticCriteria(
      'Наверное, обещания без конкретики. Как-то всё на словах, а когда в детали начинаешь вникать — тишина. Плюс много разговоров в стиле «да потом разберёмся», а мне важно всё понимать на берегу.'
    );

    expect(criteria.some((item) => item.key === 'quiet')).toBe(false);
  });

  it('still recognizes explicit preference for a quiet environment', () => {
    const examples = [
      'Мне важна тишина, не хочу шум под окнами.',
      'Хочу тихий район, чтобы спокойно отдыхать.',
      'Предпочитаю тишину и спокойное окружение.',
    ];

    for (const text of examples) {
      const criteria = extractSemanticCriteria(text);
      expect(criteria.some((item) => item.key === 'quiet')).toBe(true);
    }
  });
});
