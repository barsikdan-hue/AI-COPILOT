import { describe, expect, it } from 'vitest';
import type { SuggestedReply, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { detectConversationEvent } from './conversationEventEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { evaluateFirstCallScript } from './firstCallScriptEngine';
import { decideRecommendationOutcome } from './suggestionLifecycle';

const turn = (id: string, speaker: 'agent' | 'client', text: string, revision: number): TranscriptTurn => ({
  id,
  sessionId: 'semantic-policy-correction-1',
  source: speaker === 'agent' ? 'microphone' : 'call_audio',
  speaker,
  text,
  timestamp: revision * 1000,
  isFinal: true,
  revision,
});

function replay(lines: Array<['agent' | 'client', string]>) {
  let state = createInitialState();
  const turns: TranscriptTurn[] = [];
  lines.forEach(([speaker, text], index) => {
    const current = turn(`t${index + 1}`, speaker, text, index + 1);
    turns.push(current);
    state = advanceLocalConversation(state, current, turns).state;
  });
  return { state, turns };
}

function shownReply(id: string, createdAt = 1000): SuggestedReply {
  return {
    id,
    sessionId: 'semantic-policy-correction-1',
    basedOnRevision: 1,
    candidateRuleId: id,
    actionType: 'CLARIFY',
    text: id,
    shortReason: id,
    evidenceTurnIds: [],
    createdAt,
    stage: 'diagnostics',
    lifecycleStatus: 'shown',
    semanticKey: id,
    priority: 60,
    source: 'local_engine',
    ttlMs: 15000,
  } as SuggestedReply;
}

describe('SEMANTIC POLICY CORRECTION 1', () => {
  it('allows a qualified non-video call to pass quality without confirming PPV', () => {
    const result = replay([
      ['agent', 'Для чего выбираете недвижимость?'],
      ['client', 'Для постоянной жизни, переезжаю в Сочи.'],
      ['agent', 'Какой формат жилья нужен?'],
      ['client', 'Квартира в жилом комплексе.'],
      ['agent', 'Что обязательно важно при выборе?'],
      ['client', 'Тишина, школа рядом и хороший выезд.'],
      ['agent', 'Какой район рассматриваете?'],
      ['client', 'Адлер.'],
      ['agent', 'Какой бюджет и способ оплаты?'],
      ['client', 'До 25 миллионов, полностью за свои средства.'],
      ['agent', 'К какому сроку планируете купить?'],
      ['client', 'До конца ноября.'],
      ['agent', 'Кто принимает финальное решение?'],
      ['client', 'Решение принимаю сам.'],
    ]);
    const progress = evaluateFirstCallScript(result.turns, result.state);

    expect(progress.metrics.ppv.status).not.toBe('confirmed');
    expect(progress.quality.mandatoryPpvPassed).toBe(false);
    expect(progress.quality.passedCoreCriteriaCount).toBeGreaterThanOrEqual(7);
    expect(progress.quality.mandatoryTrustPassed).toBe(true);
    expect(progress.quality.isQualityCall).toBe(true);
    expect(progress.quality.verdictReason).not.toMatch(/обязательн.*ППВ/iu);
  });

  it('treats a material-first request as an action, not an objection', () => {
    const client = turn('c1', 'client', 'Сначала пришлите информацию и планировки.', 1);
    const event = detectConversationEvent(client, [client], createInitialState());

    expect(event).toMatchObject({
      type: 'MATERIAL_REQUEST',
      actionType: 'ANSWER',
      ruleId: 'material_request',
      suppressesAnalysis: true,
    });
    expect(event?.suggestedReply).not.toMatch(/видео|какой бюджет|что важнее/iu);
  });

  it('keeps explicit active-video resistance separate from the material request', () => {
    const agent = turn('a1', 'agent', 'Давайте завтра проведём видеопоказ?', 1);
    const client = turn('c1', 'client', 'Видео не хочу. Сначала пришлите планировки.', 2);
    const event = detectConversationEvent(client, [agent, client], createInitialState());

    expect(event).toMatchObject({
      type: 'NEXT_STEP_RESISTANCE',
      nextStepTarget: 'ppv',
      secondaryIntent: 'MATERIAL_REQUEST',
    });
    expect(event?.suggestedReply).toMatch(/видео.*не фиксируем|отправлю.*материал/iu);
  });

  it('treats self-service as a client preference without opening objection state', () => {
    const client = turn('c1', 'client', 'Я сначала сам изучу.', 1);
    const advanced = advanceLocalConversation(createInitialState(), client, [client]);

    expect(advanced.event?.type).toBe('CLIENT_PREFERENCE');
    expect(advanced.state.dialogueControl?.softResistanceCount).toBe(0);
    expect(advanced.state.activeObjection).toBeFalsy();
  });

  it('does not replace a validator-rejected candidate with a random checklist question', () => {
    const client = turn('c2', 'client', 'Тишина для меня важна.', 2);
    const state = createInitialState();
    state.nextStepAgreement = { action: 'Созвон', status: 'agreed' };
    state.agreedNextStep = { value: 'Созвон завтра', evidenceTurnIds: ['c1'] };

    const result = buildLocalAnalysisResponse({
      sessionId: client.sessionId,
      revision: 2,
      newTurns: [client],
      recentTurns: [client],
      currentState: state,
    });

    expect(result.shouldSuggest).toBe(false);
    expect(result.recommendationOutcome).toBe('NO_NEW_RECOMMENDATION');
    expect(result.candidateRuleId).toBe('state_validator_no_replacement');
    expect(result.suggestedReply).toBeNull();
  });

  it('makes KEEP and NO_NEW explicit lifecycle outcomes', () => {
    const current = shownReply('current');
    const weak = { ...shownReply('weak', 1100), basedOnRevision: 2, priority: 55 };

    expect(decideRecommendationOutcome(current, null, 1200)).toBe('KEEP_ACTIVE_RECOMMENDATION');
    expect(decideRecommendationOutcome(null, null, 1200)).toBe('NO_NEW_RECOMMENDATION');
    expect(decideRecommendationOutcome(current, weak, 1200)).toBe('KEEP_ACTIVE_RECOMMENDATION');
  });

  it('preserves a genuine current video agreement', () => {
    const agent = turn('a1', 'agent', 'Можем завтра в 18:00 провести видеопоказ?', 1);
    const client = turn('c1', 'client', 'Да, завтра в 18:00 удобно.', 2);
    const event = detectConversationEvent(client, [agent, client], createInitialState());

    expect(event?.type).toBe('MEETING_CONTRACT');
    expect(event?.meetingConsentQuality).toBe('clear');
  });

  it('keeps a direct price request above open checklist metrics', () => {
    const client = turn('c1', 'client', 'Сколько стоит эта квартира?', 1);
    const event = detectConversationEvent(client, [client], createInitialState());
    const result = buildLocalAnalysisResponse({
      sessionId: client.sessionId,
      revision: 1,
      newTurns: [client],
      recentTurns: [client],
      currentState: createInitialState(),
    });

    expect(event?.ruleId).toBe('direct_question_price');
    expect(result.eventType).toBe('DIRECT_QUESTION');
    expect(result.actionType).toBe('ANSWER');
    expect(result.suggestedReply).not.toMatch(/для чего выбираете|что важнее|какой бюджет/iu);
  });
});
