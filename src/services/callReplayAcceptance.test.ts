import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { aggregateFinalTurn } from './sttDedup';
import { isSuggestionAllowedByState } from './suggestionLifecycle';
import { CallSessionRecord, TranscriptTurn } from '../types';

it('T19 replays the anonymized 2026-09-23 live call through the production local pipeline', () => {
  const file = process.env.COPILOT_CALL_RECORD_PATH || resolve('test-fixtures/call_record_2026-09-23_sessio.json');
  if (!existsSync(file)) throw new Error('T19 BLOCKED: live regression fixture is missing.');

  const record = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as CallSessionRecord;
  expect(Array.isArray(record.turns)).toBe(true);
  expect(record.turns.length).toBeGreaterThan(100);

  let state = createInitialState();
  let beforeLast = state;
  const turns: TranscriptTurn[] = [];
  const clientHints: Array<{ revision: number; text: string | null; eventType?: string | null }> = [];

  for (const [index, raw] of record.turns.entries()) {
    const aggregation = aggregateFinalTurn(turns.at(-1), raw.speaker, raw.text, raw.timestamp);
    if (aggregation.kind === 'duplicate') continue;

    const amend = aggregation.kind === 'amend';
    const turn: TranscriptTurn = {
      ...raw,
      id: amend ? turns.at(-1)!.id : raw.id || `replay-${index}`,
      text: aggregation.text,
      revision: amend ? turns.at(-1)!.revision : raw.revision || turns.length + 1,
    };

    const base = amend ? beforeLast : state;
    if (amend) turns[turns.length - 1] = turn;
    else {
      beforeLast = state;
      turns.push(turn);
    }

    const advanced = advanceLocalConversation(base, turn, turns);
    state = advanced.state;

    if (raw.speaker === 'client') {
      const hint = buildLocalAnalysisResponse({
        sessionId: record.id || 'replay',
        revision: turn.revision!,
        newTurns: [turn],
        recentTurns: turns.slice(-10),
        currentState: state,
      });
      clientHints.push({ revision: turn.revision!, text: hint.suggestedReply, eventType: advanced.event?.type });

      if (hint.shouldSuggest && state.dialogueControl?.blockedNextSteps?.includes('ppi')) {
        expect(isSuggestionAllowedByState({
          text: hint.suggestedReply!,
          closesMetric: hint.closesMetric,
          actionType: hint.actionType,
          priority: hint.priority,
          basedOnRevision: turn.revision,
        }, state)).toBe(true);
        expect(hint.suggestedReply).not.toMatch(/(?:давайте|предлагаю|подключим).*(?:брокер|ипотечн.*специалист)/iu);
      }
    }
  }

  // Canonical facts must respect negation and client corrections.
  expect(state.goal.value).toMatch(/отдых|сезон/iu);
  expect(state.goal.value).not.toMatch(/постоянн.*прожив|переезд/iu);
  expect(state.employment?.value).toMatch(/найм/iu);
  expect(state.employment?.value).not.toMatch(/индивидуальн.*предприним|\bИП\b/iu);
  expect(state.budget.value).toMatch(/15.*млн/iu);
  expect(state.paymentMethod.value).toMatch(/ипотек/iu);
  expect(state.purchaseTimeline.value).toMatch(/2\s*месяц/iu);
  expect(state.decisionMakers.value).toMatch(/совмест|супруг|семь/iu);

  // PPV is a single canonical state: the client agreed to tomorrow at 12:00.
  expect(state.nextStepAgreement?.status).toBe('agreed');
  expect(state.nextStepAgreement?.timeOrDeadline).toMatch(/завтра.*12:00/iu);
  expect(state.nextStepAgreement?.timeOrDeadline).not.toMatch(/завтра\s+завтра/iu);
  expect(state.agreedNextStep?.value).toMatch(/видеопоказ.*завтра.*12:00/iu);
  expect(state.scriptProgress?.metrics.ppv.status).toBe('confirmed');
  expect(state.scriptProgress?.metrics.ppv.value).toMatch(/завтра.*12:00/iu);
  expect(state.scriptProgress?.ppv.clientAgreed).toBe(true);

  // PPI was deferred twice: branch is blocked until the client reopens it.
  expect(state.dialogueControl?.blockedNextSteps).toContain('ppi');
  expect(state.activeObjection?.target).toBe('ppi');
  expect(state.activeObjection?.status).toBe('blocked');
  expect(state.scriptProgress?.metrics.ppi.status).toBe('partially_confirmed');
  expect(state.scriptProgress?.metrics.objections.status).not.toBe('confirmed');

  // Real agent question -> real client answer must advance SPIN, regardless of whether
  // the agent copied the hint literally.
  expect(state.spin.situation.length).toBeGreaterThanOrEqual(2);
  expect(state.spin.problem.length).toBeGreaterThanOrEqual(1);
  expect(state.spin.implication.length).toBeGreaterThanOrEqual(1);
  expect(state.spin.needPayoff.length).toBeGreaterThanOrEqual(1);
  expect(state.spin.completedStages).toEqual(expect.arrayContaining(['SITUATION', 'PROBLEM', 'IMPLICATION', 'NEED_PAYOFF']));
  expect(state.spin.missingStage).toBe('COMPLETE');

  // “Раньше особо не рассматривали, сейчас изучаем” is research context, not a refusal.
  const falseRejection = (state.events || []).find((event) =>
    event.type === 'EXPLICIT_REJECTION' && /раньше особо не рассматривали/iu.test(event.evidenceQuote)
  );
  expect(falseRejection).toBeUndefined();

  // “Завтра в 12:00. Подойдёт?” must be treated as a meeting contract, never as a
  // generic documents question.
  const schedulingHint = clientHints.find((item) => item.revision === 28);
  expect(schedulingHint?.eventType).toBe('MEETING_CONTRACT');
  expect(schedulingHint?.text).toMatch(/завтра.*12:00/iu);
  expect(schedulingHint?.text).not.toMatch(/документ/iu);
});
