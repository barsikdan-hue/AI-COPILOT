import { describe, expect, it } from 'vitest';
import { AnalysisProvider } from './analysisProvider';
import { isSubstantiveClientTurn } from './objectionEngine';
import type { TranscriptTurn } from '../types';

// Public Issue #40 final; introduction reconstructed, not a private call export.
const introduction = 'Добрый день, меня зовут Данил, специалист по недвижимости.';
// Checked-in liveHintSilence fixture introduction; a separate session, not the
// missing preceding agent turn from the public Issue #40 incident.
const compactIntroduction = 'Добрый день, Данил, специалист по недвижимости компании Элитный Сочи. Как я могу обращаться к вам?';
const originalFinal = 'Да, добрый день, Данил.';

describe('Issue #40 greeting acknowledgement eligibility', () => {
  it('original greeting acknowledgement does not enter client analysis', () => {
    expect(isSubstantiveClientTurn(originalFinal, introduction, true)).toBe(false);
  });

  it('rejects the residual greeting after a compact agent introduction', () => {
    expect(isSubstantiveClientTurn(originalFinal, compactIntroduction, true)).toBe(false);
    expect(isSubstantiveClientTurn('Здравствуйте, Олег.', 'Здравствуйте, Олег, специалист по недвижимости.', true)).toBe(false);
  });

  it('does not infer an introduction from a client address or stale agent text', () => {
    expect(isSubstantiveClientTurn(originalFinal, compactIntroduction, false)).toBe(true);
    expect(isSubstantiveClientTurn(originalFinal, 'Добрый день, Данил, какой у вас бюджет?', true)).toBe(true);
    expect(isSubstantiveClientTurn('Добрый день, Марина.', compactIntroduction, true)).toBe(true);
    expect(isSubstantiveClientTurn('Добрый день, ипотека.', compactIntroduction, true)).toBe(true);
    expect(isSubstantiveClientTurn('Марина.', compactIntroduction, true)).toBe(true);
    expect(isSubstantiveClientTurn('Да, добрый день, Данил, бюджет 20 млн.', compactIntroduction, true)).toBe(true);
  });

  it.each([
    'Добрый день.',
    'Да, добрый день.',
    'Ну да, добрый день, Данил.',
    'Ага, здравствуйте.',
    'Угу, привет.',
    'Да, добрый вечер, Данил.',
    'Да, доброе утро, Данил.',
    '  ДА,  ДОБРЫЙ   ДЕНЬ,  ДАНИЛ!  ',
  ])('rejects a whole-turn greeting: %s', (text) => {
    expect(isSubstantiveClientTurn(text, introduction, true)).toBe(false);
  });

  it('binds the greeting address to the immediate agent introduction', () => {
    expect(isSubstantiveClientTurn('Да, добрый день, Олег.', 'Здравствуйте, меня зовут Олег.', true)).toBe(false);
    expect(isSubstantiveClientTurn(originalFinal, introduction, false)).toBe(true);
    expect(isSubstantiveClientTurn(originalFinal, 'Что для вас важно в локации?', true)).toBe(true);
    expect(isSubstantiveClientTurn('Да, добрый день, Марина.', introduction, true)).toBe(true);
  });

  it.each([
    ['Да, конечно', 'Вам удобно обсудить варианты завтра?'],
    ['Марина.', 'Как вас зовут?'],
    ['Женя.', 'Как к вам обращаться?'],
    ['30 млн', introduction],
    ['дорого', introduction],
    ['для себя', introduction],
    ['2 млн будут только в декабре', 'Сколько есть на первоначальный взнос сейчас?'],
    ['Добрый день, бюджет 20 млн.', introduction],
    ['Да, добрый день, Данил, хочу квартиру для себя.', introduction],
    ['Добрый день, меня зовут Марина.', 'Как вас зовут?'],
    ['Добрый день, нет.', 'Есть первоначальный взнос?'],
    ['Добрый день, ипотека.', introduction],
    ['Добрый день, перезвоните завтра.', introduction],
    ['Добрый день, уже выбираем.', introduction],
  ])('preserves substantive answer: %s', (text, question) => {
    expect(isSubstantiveClientTurn(text, question, true)).toBe(true);
  });

  it.each([introduction, compactIntroduction])('provider rejects the greeting and keeps the next business turn eligible after %s', (agentIntroduction) => {
    const provider = new AnalysisProvider();
    provider.setSession('issue40-session');
    const turn: TranscriptTurn = {
      id: 'greeting', sessionId: 'issue40-session', source: 'microphone',
      speaker: 'client', text: originalFinal, timestamp: 1000, isFinal: true,
    };
    expect(provider.checkEligibility(turn, 3, agentIntroduction)).toMatchObject({ eligible: false, canReuseLast: false });
    expect(provider.checkEligibility({ ...turn, id: 'business', text: 'Бюджет 20 млн.' }, 4, agentIntroduction).eligible).toBe(true);
    expect(provider.getLastValidResponse()).toBeNull();
  });
});
