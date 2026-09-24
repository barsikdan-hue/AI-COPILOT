import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranscriptTurn } from '../types';
import { AnalysisProvider } from './analysisProvider';
import {
  applyConversationEvent,
  detectConversationEvent,
  suggestionFromEvent,
} from './conversationEventEngine';
import { createInitialState, mergeFactsDelta } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { buildLocalAnalysisResponse } from './localAnalysisEngine';
import { redactSensitiveText } from './privacy';
import { buildSessionHandoff } from './sessionHandoff';
import { isPendingSuggestionSuperseded, shouldReplaceSuggestion } from './suggestionLifecycle';

const makeTurn = (
  id: string,
  speaker: 'agent' | 'client',
  text: string,
  revision: number
): TranscriptTurn => ({
  id,
  sessionId: 'os4_session',
  source: speaker === 'agent' ? 'microphone' : 'call_audio',
  speaker,
  text,
  timestamp: 1_000 + revision,
  isFinal: true,
  revision,
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ANDREI OS 4 deterministic core', () => {
  it('puts a client stop above every sales action', () => {
    const state = createInitialState();
    const turn = makeTurn('stop', 'client', 'Больше мне не звоните и удалите мой номер.', 1);
    const event = detectConversationEvent(turn, [turn], state);
    expect(event?.type).toBe('CLIENT_STOP');
    expect(event?.priority).toBe(120);
    expect(event?.suppressesAnalysis).toBe(true);
    expect(suggestionFromEvent(event!, turn.sessionId, 1)?.actionType).toBe('RESPECT_STOP');
  });

  it('answers a direct client question before returning to SPIN', () => {
    const turn = makeTurn('question', 'client', 'Пришлите точную планировку и проект договора.', 1);
    const event = detectConversationEvent(turn, [turn], createInitialState());
    expect(event?.type).toBe('DIRECT_QUESTION');
    expect(event?.actionType).toBe('ANSWER');
    expect(event?.priority).toBeGreaterThan(100);
  });

  it('treats a short yes after a compound question as ambiguous', () => {
    const agent = makeTurn(
      'agent_compound',
      'agent',
      'Правильно понимаю, бюджет до 20 миллионов и ипотека уже одобрена?',
      1
    );
    const client = makeTurn('client_yes', 'client', 'Да.', 2);
    const event = detectConversationEvent(client, [agent, client], createInitialState());
    expect(event?.type).toBe('AMBIGUOUS_CONFIRMATION');
    expect(event?.suggestedReply).toContain('какой именно вариант');
  });

  it('routes a concrete material request directly and respects a later time boundary', () => {
    const first = makeTurn('soft_1', 'client', 'Просто пришлите варианты, цены и планировки, я посмотрю.', 1);
    const firstEvent = detectConversationEvent(first, [first], createInitialState())!;
    const afterFirst = applyConversationEvent(createInitialState(), firstEvent, first);
    expect(firstEvent.type).toBe('DIRECT_QUESTION');
    expect(firstEvent.ruleId).toBe('direct_question_materials_request');
    expect(firstEvent.suppressesAnalysis).toBe(true);
    const second = makeTurn('soft_2', 'client', 'Мне сейчас некогда объяснять, просто пришлите, потом посмотрю.', 2);
    const secondEvent = detectConversationEvent(second, [first, second], afterFirst)!;
    const afterSecond = applyConversationEvent(afterFirst, secondEvent, second);
    expect(secondEvent.type).toBe('TIME_CONSTRAINT');
    expect(secondEvent.suppressesAnalysis).toBe(true);
    expect(afterSecond.dialogueControl?.clientBoundaryActive).toBe(true);
  });

  it('detects risky guarantees in the agent speech', () => {
    const turn = makeTurn(
      'claim',
      'agent',
      'Здесь гарантированная доходность 20 процентов и объект точно окупится.',
      1
    );
    const event = detectConversationEvent(turn, [turn], createInitialState());
    expect(event?.type).toBe('CLAIM_RISK');
    expect(event?.priority).toBe(110);
    expect(event?.suggestedReply).toContain('не гарантия');
  });

  it('stores an explicit time promise for the 80 percent warning', () => {
    const turn = makeTurn('time', 'agent', 'Займу буквально две минуты и задам один вопрос.', 1);
    const event = detectConversationEvent(turn, [turn], createInitialState())!;
    const state = applyConversationEvent(createInitialState(), event, turn, 5_000);
    expect(event.type).toBe('TIME_CONTRACT');
    expect(state.dialogueControl?.timeContract).toEqual({
      promisedSeconds: 120,
      startedAt: 5_000,
      warningShown: false,
    });
  });

  it('checks the quality of a meeting contract', () => {
    const agent = makeTurn(
      'meeting_agent',
      'agent',
      'Давайте завтра в 15:00 проведём видеовстречу и сравним два сценария, согласны?',
      1
    );
    const client = makeTurn('meeting_client', 'client', 'Да, подключимся вдвоём с супругой.', 2);
    const event = detectConversationEvent(client, [agent, client], createInitialState());
    expect(event?.type).toBe('MEETING_CONTRACT');
    expect(event?.meetingConsentQuality).toBe('clear');
    expect(event?.meetingContract?.time).toContain('15:00');
    expect(event?.meetingContract?.participants).toBe('несколько участников');
  });

  it('supersedes the old fact instead of keeping two active truths', () => {
    const initial = createInitialState();
    const first = mergeFactsDelta(
      initial,
      [{ field: 'budget', category: 'budget', value: '10 млн руб', evidenceQuote: '10 миллионов', evidenceTurnId: 'b1' }],
      'diagnostics',
      null,
      1,
      { b1: 'Бюджет 10 миллионов' }
    );
    const corrected = mergeFactsDelta(
      first,
      [{ field: 'budget', category: 'budget', value: '6 млн руб', evidenceQuote: '6 миллионов', evidenceTurnId: 'b2' }],
      'diagnostics',
      null,
      2,
      { b1: 'Бюджет 10 миллионов', b2: 'Нет, бюджет 6 миллионов' }
    );
    const oldFact = corrected.confirmedFacts.find((fact) => fact.turnId === 'b1');
    const newFact = corrected.confirmedFacts.find((fact) => fact.turnId === 'b2');
    expect(oldFact?.lifecycleStatus).toBe('superseded');
    expect(newFact?.lifecycleStatus).toBe('confirmed');
    expect(newFact?.supersedesFactId).toBe(oldFact?.id);
    expect(corrected.budget.value).toBe('6 млн руб');
  });

  it('uses the corrected value when two budgets occur in one sentence', () => {
    const text = 'Нет, не 10 миллионов, а 6 миллионов — это предел.';
    const facts = extractDeterministicFacts(
      text,
      'budget_correction'
    );
    expect(facts.find((fact) => fact.field === 'budget')?.value).toBe('6 млн руб');
    const turn = makeTurn('budget_correction', 'client', text, 1);
    expect(detectConversationEvent(turn, [turn], createInitialState())?.type).toBe('FACT_CORRECTION');
  });

  it('does not store a rejected property format as the client preference', () => {
    const facts = extractDeterministicFacts(
      'Апартаменты не хочу и не рассматриваю, нужна только квартира.',
      'property_rejection'
    );
    expect(facts.find((fact) => fact.field === 'propertyType')?.value).toBe('Квартира');
  });

  it('does not count unrealized asset growth as available budget', () => {
    const facts = extractDeterministicFacts(
      'Моя квартира выросла в цене на 2 миллиона, но я её не продавал.',
      'unrealized_growth'
    );
    expect(facts.some((fact) => fact.field === 'budget')).toBe(false);
  });

  it('produces an offline response with facts and a usable card', () => {
    const turn = makeTurn(
      'offline',
      'client',
      'Ищу квартиру для жизни в Сочи, бюджет 30 миллионов.',
      1
    );
    const response = buildLocalAnalysisResponse({
      sessionId: turn.sessionId,
      revision: 1,
      newTurns: [turn],
      recentTurns: [turn],
      currentState: createInitialState(),
      fallbackReason: 'quota_exhausted',
    });
    expect(response.modelUsed).toBe('local-deterministic');
    expect(response.fallbackReason).toBe('quota_exhausted');
    expect(response.factsDelta.some((fact) => fact.field === 'budget')).toBe(true);
    expect(response.shouldSuggest).toBe(true);
    expect(response.suggestedReply).toBeTruthy();
  });

  it('redacts contact and identity data before an LLM request', () => {
    const redacted = redactSensitiveText(
      'Телефон +7 (999) 123-45-67, почта test@example.com, паспорт 1234 567890.'
    );
    expect(redacted).not.toContain('999');
    expect(redacted).not.toContain('test@example.com');
    expect(redacted).not.toContain('567890');
    expect(redacted).toContain('[телефон скрыт]');
    expect(redacted).toContain('[email скрыт]');
  });

  it('keeps a fresh higher-priority card and ignores filler revisions', () => {
    const current = {
      id: 'current',
      sessionId: 'os4_session',
      basedOnRevision: 3,
      candidateRuleId: 'respect_stop_contact',
      text: 'Понял. Больше не звоним.',
      shortReason: 'Стоп',
      evidenceTurnIds: ['stop'],
      createdAt: 10_000,
      stage: 'next_step_agreement' as const,
      priority: 120,
      lifecycleStatus: 'shown' as const,
    };
    const lower = { ...current, id: 'lower', basedOnRevision: 4, text: 'Какой бюджет?', priority: 50 };
    expect(isPendingSuggestionSuperseded(3, 3)).toBe(false);
    expect(shouldReplaceSuggestion(current, lower, 10_100)).toBe(false);
  });

  it('builds a handoff that preserves boundaries and rejected branches', () => {
    const state = createInitialState();
    state.dialogueControl = {
      ...state.dialogueControl!,
      clientBoundaryActive: true,
      researchMode: true,
      rejectedBranches: ['апартаменты'],
    };
    state.events = [{
      id: 'risk',
      type: 'CLAIM_RISK',
      priority: 110,
      speaker: 'agent',
      turnId: 'claim',
      evidenceQuote: 'гарантированная доходность',
      createdAt: 1,
    }];
    const handoff = buildSessionHandoff(state);
    expect(handoff.boundaries.join(' ')).toContain('срочности');
    expect(handoff.rejectedBranches).toEqual(['апартаменты']);
    expect(handoff.riskFlags).toContain('Категоричное обещание требует проверки');
  });

  it('uses a non-sliding debounce and the latest callbacks for a batched request', async () => {
    vi.useFakeTimers();
    const provider = new AnalysisProvider();
    provider.setSession('os4_session');
    const agent = makeTurn('agent', 'agent', 'Что для вас важно в квартире?', 1);
    const first = makeTurn('first', 'client', 'Нужна тихая квартира рядом с парком.', 2);
    const second = makeTurn('second', 'client', 'И бюджет до 20 миллионов.', 3);
    const requests: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      return {
        ok: true,
        json: async () => ({
          sessionId: 'os4_session',
          basedOnRevision: body.revision,
          stage: 'diagnostics',
          factsDelta: [],
          objection: null,
          candidateRuleId: null,
          suggestedReply: null,
          shortReason: null,
          evidenceTurnIds: [],
          missingCriticalField: null,
          shouldSuggest: false,
        }),
      } as Response;
    }));
    const firstSuccess = vi.fn();
    const latestSuccess = vi.fn();

    provider.scheduleAnalysis(
      { sessionId: 'os4_session', revision: 2, newTurns: [first], recentTurns: [agent], currentState: createInitialState() },
      firstSuccess,
      vi.fn(),
      undefined,
      250
    );
    await vi.advanceTimersByTimeAsync(100);
    provider.scheduleAnalysis(
      { sessionId: 'os4_session', revision: 3, newTurns: [second], recentTurns: [agent, first], currentState: createInitialState() },
      latestSuccess,
      vi.fn(),
      undefined,
      250
    );
    await vi.advanceTimersByTimeAsync(151);
    await Promise.resolve();

    expect(requests).toHaveLength(1);
    expect(requests[0].revision).toBe(3);
    expect(requests[0].newTurns.map((turn: TranscriptTurn) => turn.id)).toEqual(['first', 'second']);
    expect(firstSuccess).not.toHaveBeenCalled();
    expect(latestSuccess).toHaveBeenCalledOnce();
  });

  it('accepts contextual short answers in the provider', async () => {
    vi.useFakeTimers();
    const provider = new AnalysisProvider();
    provider.setSession('os4_session');
    const agent = makeTurn('agent_short', 'agent', 'Завтра в 15:00 на видеовстречу удобно?', 1);
    const client = makeTurn('client_short', 'client', 'Да.', 2);
    const fetchMock = vi.fn(async (_url, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return {
        ok: true,
        json: async () => ({
          sessionId: 'os4_session',
          basedOnRevision: body.revision,
          stage: 'next_step_agreement',
          factsDelta: [],
          objection: null,
          candidateRuleId: null,
          suggestedReply: null,
          shortReason: null,
          evidenceTurnIds: [],
          missingCriticalField: null,
          shouldSuggest: false,
        }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    provider.scheduleAnalysis(
      { sessionId: 'os4_session', revision: 2, newTurns: [client], recentTurns: [agent], currentState: createInitialState() },
      vi.fn(),
      vi.fn(),
      undefined,
      10
    );
    await vi.advanceTimersByTimeAsync(11);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not let a cancelled old session clear a new in-flight request', async () => {
    vi.useFakeTimers();
    const provider = new AnalysisProvider();
    let resolveOld!: (value: Response) => void;
    let resolveNew!: (value: Response) => void;
    const oldPromise = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const newPromise = new Promise<Response>((resolve) => { resolveNew = resolve; });
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(oldPromise)
      .mockReturnValueOnce(newPromise));

    provider.setSession('old_session');
    const oldTurn = { ...makeTurn('old_turn', 'client', 'Ищу квартиру для жизни.', 1), sessionId: 'old_session' };
    provider.scheduleAnalysis(
      { sessionId: 'old_session', revision: 1, newTurns: [oldTurn], recentTurns: [], currentState: createInitialState() },
      vi.fn(),
      vi.fn(),
      undefined,
      1
    );
    await vi.advanceTimersByTimeAsync(2);

    provider.setSession('new_session');
    const newTurn = { ...makeTurn('new_turn', 'client', 'Нужна квартира рядом с морем.', 1), sessionId: 'new_session' };
    provider.scheduleAnalysis(
      { sessionId: 'new_session', revision: 1, newTurns: [newTurn], recentTurns: [], currentState: createInitialState() },
      vi.fn(),
      vi.fn(),
      undefined,
      1
    );
    await vi.advanceTimersByTimeAsync(2);
    expect(provider.getIsInFlight()).toBe(true);

    resolveOld({
      ok: true,
      json: async () => ({ sessionId: 'old_session', basedOnRevision: 1 }),
    } as Response);
    await Promise.resolve();
    await Promise.resolve();
    expect(provider.getIsInFlight()).toBe(true);

    resolveNew({
      ok: true,
      json: async () => ({ sessionId: 'new_session', basedOnRevision: 1 }),
    } as Response);
    await Promise.resolve();
    await Promise.resolve();
    expect(provider.getIsInFlight()).toBe(false);
  });
});
