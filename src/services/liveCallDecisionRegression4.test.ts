import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { OPENING_GREETING_TEXT } from '../components/SuggestionCard';
import {
  createInitialSpinState,
  detectRealEstatePainCategory,
  evaluateSpinAndHpb,
  extractClientSpinMeaning,
} from './spinEngine';

function clientTurn(text: string, id = 'client_1', revision = 1): TranscriptTurn {
  return {
    id,
    sessionId: 'session_live_regression_4',
    source: 'call_audio',
    speaker: 'client',
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

describe('2026-09-25 live next-action regression #4', () => {
  it('keeps the opening cue concise and usable before transcript analysis starts', () => {
    expect(OPENING_GREETING_TEXT).toBe(
      'Добрый день! Данил, «Элитный Сочи». Как могу к вам обращаться?'
    );
    expect(OPENING_GREETING_TEXT.length).toBeLessThan(80);
  });

  it('does not interpret “тишина с ответами” plus grey schemes as noise/sleep pain', () => {
    const text =
      'Куча обещаний, а когда начинаешь вдаваться в детали, там тишина с ответами. ' +
      'Я не хочу потом бесконечно что-то переделывать и переподписывать. И ещё всякие серые схемы.';

    expect(detectRealEstatePainCategory(text)).toBe('security_risks');
    expect(extractClientSpinMeaning(clientTurn(text))?.stage).toBe('PROBLEM');
  });

  it('still recognizes a real residential quiet/noise need as noise_sleep', () => {
    expect(
      detectRealEstatePainCategory(
        'Мне важна тишина, хочу тихий район, чтобы ночью нормально спать и отдыхать.'
      )
    ).toBe('noise_sleep');
  });

  it('lets an explicit client problem override the scripted Situation queue', () => {
    const firstClientMeaning =
      'Здравствуйте. Андрей. Я смотрю на всю эту недвижимость и не понимаю, что мне реально подходит. ' +
      'Такое ощущение, что везде одни и те же обещания, а по факту непонятно.';

    const result = evaluateSpinAndHpb(
      clientTurn(firstClientMeaning),
      createInitialSpinState(),
      'none'
    );

    expect(result.suggestionMode).toBe('SPIN_PROBLEM');
    expect(result.suggestedText).toContain('Что именно мешает понять разницу');
    expect(result.suggestedText).not.toContain('Сочи давно рассматриваете');
    expect(result.updatedSpin.problem).toHaveLength(1);
  });

  it('continues explicit document/grey-scheme pain through decision impact, never sleep/rest', () => {
    const firstClientMeaning =
      'Я не понимаю, что мне реально подходит. Такое ощущение, что везде одни и те же обещания.';
    const first = evaluateSpinAndHpb(
      clientTurn(firstClientMeaning, 'client_1', 1),
      createInitialSpinState(),
      'none'
    );

    const riskText =
      'Куча обещаний, потом тишина с ответами. Не хочу переделывать и переподписывать документы, ' +
      'и в серые схемы тоже лезть не хочу.';
    const result = evaluateSpinAndHpb(
      clientTurn(riskText, 'client_2', 2),
      first.updatedSpin,
      'asked_problem_question'
    );

    expect(detectRealEstatePainCategory(riskText)).toBe('security_risks');
    expect(result.suggestionMode).toBe('SPIN_IMPLICATION');
    expect(result.suggestedText).toMatch(/риск|документ|объект.*отпадает/iu);
    expect(result.suggestedText).not.toMatch(/сон|отдых|общее состояние/iu);
  });
});
