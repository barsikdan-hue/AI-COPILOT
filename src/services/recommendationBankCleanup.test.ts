import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { suggestionFromEvent } from './conversationEventEngine';
import { isSuggestionAllowedByState, shouldReplaceSuggestion } from './suggestionLifecycle';
import { evaluateFirstCallScript, getFirstCallSuggestion } from './firstCallScriptEngine';

function replay(lines: Array<['agent' | 'client', string]>) {
  let state = createInitialState();
  const turns: TranscriptTurn[] = [];
  return lines.map(([speaker, text], index) => {
    const revision = index + 1;
    const turn: TranscriptTurn = { id: `t${revision}`, sessionId: 'bank-cleanup', source: speaker === 'client' ? 'call_audio' : 'microphone', speaker, text, revision, timestamp: revision * 1000, isFinal: true };
    turns.push(turn);
    const advanced = advanceLocalConversation(state, turn, turns);
    state = advanced.state;
    const result = buildLocalAnalysisResponse({ sessionId: turn.sessionId, revision, newTurns: [turn], recentTurns: turns, currentState: state });
    const event = advanced.event ? suggestionFromEvent(advanced.event, turn.sessionId, revision, revision * 1000) : null;
    return { state, result, event, turns: [...turns] };
  });
}

describe('recommendation bank live boundaries', () => {
  // Catches internal lifecycle wording leaking through the event publication path.
  it('acknowledges the corrected budget while superseding its old fact', () => {
    const row = replay([['client', 'Бюджет 20 миллионов.'], ['client', 'Поправлю: бюджет всё-таки 15 миллионов.']]).at(-1)!;
    expect(row.state.budget.value).toMatch(/15/);
    const facts = row.state.confirmedFacts.filter(f => f.category === 'budget');
    expect(facts.filter(f => f.lifecycleStatus === 'confirmed')).toHaveLength(1);
    expect(facts.find(f => /20/.test(f.value))?.lifecycleStatus).toBe('superseded');
    expect(row.event?.eventType).toBe('FACT_CORRECTION');
    expect(row.event?.text).toMatch(/15/);
    expect(row.event?.text).not.toMatch(/принял|верси|факт|предыдущ|не учитываю|актуальный предел/iu);
    expect(row.event!.text.split(/\s+/u).length).toBeLessThanOrEqual(15);
    expect(isSuggestionAllowedByState(row.event!, row.state, 2)).toBe(true);
  });

  // Catches loss of rejection memory or re-selling video on unrelated turns.
  it('keeps video rejected across subsequent turns and blocks a later proposal', () => {
    const rows = replay([['agent', 'Давайте проведём видеопоказ?'], ['client', 'Не хочу видео.'], ['agent', 'Что для вас важно?'], ['client', 'Тишина и рядом море.'], ['client', 'Бюджет до 15 миллионов.']]);
    const rejected = rows[1].state.dialogueControl;
    expect(rejected?.nextStepResistanceHistory?.ppv).toBeTruthy();
    for (const row of rows.slice(1)) {
      expect(isSuggestionAllowedByState({ text: 'Давайте проведём видеопоказ?', actionType: 'PROPOSE_NEXT_STEP', closesMetric: 'ppv' }, row.state)).toBe(false);
    }
    for (const row of [rows[3], rows[4]]) expect(row.result.suggestedReply || '').not.toMatch(/видео|видеопоказ/iu);
  });

  it('allows video after an explicit new client reopening', () => {
    const row = replay([['agent', 'Давайте проведём видеопоказ?'], ['client', 'Не хочу видео.'], ['client', 'Теперь готов к видеопоказу.']]).at(-1)!;
    expect(row.event?.eventType).toBe('NEXT_STEP_REOPENED');
    expect(row.state.dialogueControl?.blockedNextSteps || []).not.toContain('ppv');
    expect(isSuggestionAllowedByState(row.event!, row.state, 3)).toBe(true);
  });

  it('allows a confirmed callback while the video branch remains rejected', () => {
    const row = replay([['agent', 'Давайте проведём видеопоказ?'], ['client', 'Не хочу видео.'], ['client', 'Мне сейчас некогда.'], ['agent', 'Когда удобно коротко созвониться?'], ['client', 'Завтра в 16:00 по Москве.']]).at(-1)!;
    expect(row.state.nextStepAgreement).toMatchObject({ status: 'agreed', channel: 'созвон' });
    expect(row.state.dialogueControl?.nextStepResistanceHistory?.ppv?.status).not.toBe('handled');
    expect(row.event?.eventType).toBe('MEETING_CONTRACT');
    expect(isSuggestionAllowedByState(row.event!, row.state, 5)).toBe(true);
    expect(row.event?.closesMetric).not.toBe('ppv');
    expect(isSuggestionAllowedByState({ text: 'Давайте проведём видеопоказ?', actionType: 'PROPOSE_NEXT_STEP' }, row.state)).toBe(false);
  });

  // Catches invented calendar availability in the existing explicit-readiness fallback.
  it('asks for a video time without inventing available calendar slots', () => {
    const state = createInitialState();
    state.goal = { value: 'Отдых', evidenceTurnIds: ['goal'] };
    const progress = evaluateFirstCallScript([], state);
    for (const metric of Object.values(progress.metrics)) metric.status = metric.id === 'ppv' ? 'not_confirmed' : 'confirmed';
    const client: TranscriptTurn = { id: 'ready', sessionId: 'bank-cleanup', speaker: 'client', source: 'call_audio', text: 'Теперь готов к видео.', timestamp: 1000, revision: 2, isFinal: true };
    const candidate = getFirstCallSuggestion(progress, client, state, [client]);
    expect(candidate?.closesMetric).toBe('ppv');
    expect(candidate?.suggestedReply).toMatch(/когда|в какое время/iu);
    expect(candidate?.suggestedReply).not.toMatch(/18:00|12:00|сегодня|завтра/iu);
    expect((candidate!.suggestedReply.match(/\?/g) || []).length).toBe(1);
  });

  it('accepts requested prices and layouts with at most one relevant question', () => {
    const row = replay([['client', 'Скиньте цены и планировки.']])[0];
    expect(row.result.eventType).toBe('MATERIAL_REQUEST');
    expect(row.result.actionType).toBe('ANSWER');
    expect(row.result.suggestedReply).toMatch(/отправ|пришл/iu);
    expect(row.result.suggestedReply).not.toMatch(/видео|бюджет|в течение часа|18:00|12:00/iu);
    expect((row.result.suggestedReply!.match(/\?/g) || []).length).toBeLessThanOrEqual(1);
    expect(row.state.activeObjection).toBeFalsy();
  });

  // Catches boundary fallback overriding a freshly completed callback contract.
  it('keeps a short busy callback flow and confirms the agreed time', () => {
    const rows = replay([['client', 'Мне сейчас некогда.'], ['agent', 'Когда удобно коротко созвониться?'], ['client', 'Завтра в 16:00 по Москве.']]);
    expect(rows[0].result.eventType).toBe('TIME_CONSTRAINT');
    expect((rows[0].result.suggestedReply!.match(/\?/g) || []).length).toBeLessThanOrEqual(1);
    const row = rows.at(-1)!;
    expect(row.state.nextStepAgreement).toMatchObject({ status: 'agreed', channel: 'созвон', timeOrDeadline: 'завтра в 16:00 по Москве' });
    expect(row.result.eventType).toBe('MEETING_CONTRACT');
    expect(row.result.suggestedReply).toMatch(/16:00/);
    expect(row.result.candidateRuleId).not.toBe('boundary_safe_liveness');
  });

  it('does not continue discovery after a confirmed next step', () => {
    const row = replay([['client', 'Мне сейчас некогда.'], ['agent', 'Когда удобно коротко созвониться?'], ['client', 'Завтра в 16:00 по Москве.'], ['client', 'Тишина для меня важна.']]).at(-1)!;
    expect(row.state.nextStepAgreement?.status).toBe('agreed');
    expect(row.result.shouldSuggest).toBe(false);
    expect(isSuggestionAllowedByState({ text: 'К чему это приводит?', actionType: 'DEEPEN', suggestionMode: 'SPIN_IMPLICATION' }, row.state)).toBe(false);
  });

  it('answers a direct price question with an honest limit before qualification', () => {
    const row = replay([['client', 'Сколько стоит?']])[0];
    expect(row.result.eventType).toBe('DIRECT_QUESTION');
    expect(row.result.actionType).toBe('ANSWER');
    expect(row.result.suggestedReply).toMatch(/нет|без|уточн|провер/iu);
    expect(row.result.suggestedReply).not.toMatch(/какой бюджет|цель покупки|\d+\s*(млн|миллион)/iu);
    expect((row.result.suggestedReply!.match(/\?/g) || []).length).toBeLessThanOrEqual(1);
    expect(row.result.suggestedReply!.split(/\s+/u).length).toBeLessThanOrEqual(30);
  });

  // Catches internal timer guidance entering the copy/use/speech recommendation path.
  it('rejects the internal time warning at the live publication boundary', () => {
    expect(isSuggestionAllowedByState({ text: 'Время почти вышло: завершите текущую мысль и зафиксируйте один конкретный следующий шаг.', eventType: 'TIME_CONTRACT_WARNING', candidateRuleId: 'time_contract_warning', actionType: 'PROPOSE_NEXT_STEP', priority: 108, basedOnRevision: 2 }, createInitialState(), 2)).toBe(false);
  });

  it('does not let a low priority checklist replace a correction event', () => {
    const row = replay([['client', 'Бюджет 20 миллионов.'], ['client', 'Поправлю: бюджет всё-таки 15 миллионов.']]).at(-1)!;
    expect(shouldReplaceSuggestion(row.event!, { ...row.event!, id: 'checklist', eventType: null, source: 'local_engine', text: 'Какая цель покупки?', actionType: 'CLARIFY', priority: 58, semanticKey: 'ask_goal', createdAt: 2001 }, 2001)).toBe(false);
  });
});
