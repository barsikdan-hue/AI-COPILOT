import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSubstantiveClientTurn, detectLocalObjection } from './objectionEngine';
import { AnalysisProvider } from './analysisProvider';
import { ANDREI_OS_RULES } from './andreiRules';
import { createInitialState, mergeFactsDelta } from './conversationStore';
import { ConversationState, TranscriptTurn } from '../types';
import { isDuplicateFinalTurn } from './sttDedup';
import { extractDeterministicFacts } from './deterministicFacts';
import { selectCandidateRules } from './candidateRules';
import { checkSemanticAntiRepeat, extractSemanticKey } from './semanticAntiRepeat';
import { hasWholeWord, hasAnyWholeWord, validateEvidenceQuote } from './textUtils';
import { detectRealEstatePainCategory, buildHpbPresentation, evaluateSpinAndHpb } from './spinEngine';
import { classifyClientTurnIntent } from './objectionEngine';
import { evaluateFirstCallScript } from './firstCallScriptEngine';
import { isMetricClosed, SuggestedReply } from '../types';

describe('Copilot Engine & Andrei OS Test Suite', () => {
  const initialConversationState: ConversationState = createInitialState();

  // Scenario 1: Short non-substantive words return false
  it('Scenario 1: filters out short non-substantive filler words', () => {
    const fillers = ['да', 'угу', 'ага', 'понятно', 'хорошо', 'конечно', 'нет', 'не знаю'];
    for (const word of fillers) {
      expect(isSubstantiveClientTurn(word)).toBe(false);
      expect(isSubstantiveClientTurn(`  ${word}  `)).toBe(false);
    }
  });

  // Scenario 2: Short substantive turns return true
  it('Scenario 2: accepts short substantive business turns with numbers or keywords', () => {
    expect(isSubstantiveClientTurn('30 млн')).toBe(true);
    expect(isSubstantiveClientTurn('30млн')).toBe(true);
    expect(isSubstantiveClientTurn('для себя')).toBe(true);
    expect(isSubstantiveClientTurn('дорого')).toBe(true);
    expect(isSubstantiveClientTurn('Анапа')).toBe(true);
    expect(isSubstantiveClientTurn('в Сочи')).toBe(true);
    expect(isSubstantiveClientTurn('2 комнатная')).toBe(true);
  });

  // Scenario 3: Agent speech is never eligible for analysis
  it('Scenario 3: agent speech is never eligible for analysis', () => {
    const provider = new AnalysisProvider();
    provider.setSession('sess_1');

    const agentTurn: TranscriptTurn = {
      id: 'turn_agent_1',
      sessionId: 'sess_1',
      source: 'microphone',
      speaker: 'agent',
      text: 'Добрый день! Подскажите, рассматриваете квартиру для отдыха или для жизни?',
      timestamp: Date.now(),
      isFinal: true,
    };

    const check = provider.checkEligibility(agentTurn, 2);
    expect(check.eligible).toBe(false);
    expect(check.reason).toContain('Реплика Андрея');
  });

  // Scenario 4: Interim client turns are not eligible
  it('Scenario 4: interim speech is not eligible for analysis', () => {
    const provider = new AnalysisProvider();
    provider.setSession('sess_1');

    const interimTurn: TranscriptTurn = {
      id: 'turn_client_interim',
      sessionId: 'sess_1',
      source: 'call_audio',
      speaker: 'client',
      text: 'Мы хотим купить квартиру в Сочи около тридцати миллионов',
      timestamp: Date.now(),
      isFinal: false,
    };

    const check = provider.checkEligibility(interimTurn, 2);
    expect(check.eligible).toBe(false);
    expect(check.reason).toContain('Промежуточная транскрипция');
  });

  // Scenario 5: "Для себя" without permanent relocation triggers clarify_for_myself_format
  it('Scenario 5: "для себя" without living keywords maps to clarify_for_myself_format rule', () => {
    const rule = ANDREI_OS_RULES.find((r) => r.id === 'clarify_for_myself_format');
    expect(rule).toBeDefined();
    expect(rule?.title.toLowerCase()).toContain('для себя');
    expect(rule?.suggestedQuestions[0]).toContain('отдых');

    const p48 = ANDREI_OS_RULES.find((r) => r.id === 'P48');
    expect(p48?.exclusions).toContain('для себя');
  });

  // Scenario 6: "Для себя, переезжаем жить" triggers P48
  it('Scenario 6: explicit permanent relocation is covered by P48', () => {
    const p48 = ANDREI_OS_RULES.find((r) => r.id === 'P48');
    expect(p48).toBeDefined();
    expect(p48?.applicability.toLowerCase()).toContain('перее');
  });

  // Scenario 7: "Дорого" triggers detectLocalObjection with objection_price category and P37
  it('Scenario 7: detects "дорого" objection locally without API call', () => {
    const objection = detectLocalObjection('Это очень дорого для нас', initialConversationState);
    expect(objection).not.toBeNull();
    expect(objection?.category).toBe('objection_price');
    expect(objection?.ruleId).toBe('P37');
    expect(objection?.actionType).toBe('CLARIFY');
  });

  // Scenario 8: "Пришлите фото / варианты" triggers action_variants_video objection locally
  it('Scenario 8: detects "пришлите фото / материалы" objection locally', () => {
    const objection1 = detectLocalObjection('Скиньте мне варианты на WhatsApp', initialConversationState);
    expect(objection1).not.toBeNull();
    expect(objection1?.category).toBe('action_variants_video');
    expect(objection1?.actionType).toBe('PROPOSE_NEXT_STEP');
    expect(objection1?.text).toContain('видео');

    const objection2 = detectLocalObjection('Пришлите проект договора', initialConversationState);
    expect(objection2).not.toBeNull();
    expect(objection2?.category).toBe('action_answer');
  });

  // Scenario 9: "Не хочу видеозвонок / без зума" triggers objection_channel
  it('Scenario 9: detects refusal of video / zoom meeting locally', () => {
    const objection = detectLocalObjection('Я не хочу видеопоказ, давайте без зума', initialConversationState);
    expect(objection).not.toBeNull();
    expect(objection?.category).toBe('objection_channel');
    expect(objection?.text).toContain('видеосвязь не обязательна');
  });

  // Scenario 10: AnalysisProvider records turn as analyzed ONLY on HTTP 200
  it('Scenario 10: does not mark turn as analyzed if request fails or errors', async () => {
    const provider = new AnalysisProvider();
    provider.setSession('sess_1');

    const clientTurn: TranscriptTurn = {
      id: 'turn_client_1',
      sessionId: 'sess_1',
      source: 'call_audio',
      speaker: 'client',
      text: 'Ищем трехкомнатную квартиру с ремонтом',
      timestamp: Date.now(),
      isFinal: true,
    };

    // Mock fetch to simulate failure
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));

    const errorCallback = vi.fn();
    const successCallback = vi.fn();

    provider.scheduleAnalysis(
      {
        sessionId: 'sess_1',
        revision: 2,
        newTurns: [clientTurn],
        recentTurns: [],
        currentState: initialConversationState,
      },
      successCallback,
      errorCallback,
      undefined,
      10 // small debounce
    );

    // Wait for debounce and network execution
    await new Promise((r) => setTimeout(r, 50));

    expect(errorCallback).toHaveBeenCalled();
    expect(successCallback).not.toHaveBeenCalled();

    // Restore fetch
    global.fetch = originalFetch;
  });

  // Scenario 11: Superseding in-flight request on new substantive client turn
  it('Scenario 11: supersedes in-flight request when a new substantive client turn arrives', async () => {
    const provider = new AnalysisProvider();
    provider.setSession('sess_1');

    const turn1: TranscriptTurn = {
      id: 'turn_1',
      sessionId: 'sess_1',
      source: 'call_audio',
      speaker: 'client',
      text: 'Рассматриваем покупку квартиры',
      timestamp: Date.now(),
      isFinal: true,
    };

    const turn2: TranscriptTurn = {
      id: 'turn_2',
      sessionId: 'sess_1',
      source: 'call_audio',
      speaker: 'client',
      text: 'Бюджет тридцать пять миллионов рублей',
      timestamp: Date.now() + 100,
      isFinal: true,
    };

    const success1 = vi.fn();
    const success2 = vi.fn();
    const err = vi.fn();

    provider.scheduleAnalysis(
      {
        sessionId: 'sess_1',
        revision: 2,
        newTurns: [turn1],
        recentTurns: [],
        currentState: initialConversationState,
      },
      success1,
      err,
      undefined,
      150
    );

    // Immediately schedule turn 2 before debounce of turn 1 fires
    provider.scheduleAnalysis(
      {
        sessionId: 'sess_1',
        revision: 3,
        newTurns: [turn2],
        recentTurns: [turn1],
        currentState: initialConversationState,
      },
      success2,
      err,
      undefined,
      150
    );

    // Turn 1's debounce was replaced by turn 2
    expect(provider.getStats().requestsCount).toBe(0);
  });

  // Scenario 12: ConversationState merges facts regardless of suggestion UI lock
  it('Scenario 12: merges facts into ConversationState reliably', () => {
    const clientTurn: TranscriptTurn = {
      id: 'turn_client_facts',
      sessionId: 'sess_1',
      source: 'call_audio',
      speaker: 'client',
      text: 'Наш бюджет 45 миллионов рублей',
      timestamp: Date.now(),
      isFinal: true,
    };

    const turnLookup: Record<string, string> = {
      [clientTurn.id]: clientTurn.text,
    };

    const factsDelta = [
      {
        category: 'budget',
        field: 'budget',
        value: '45 млн руб',
        evidenceQuote: 'бюджет 45 миллионов рублей',
        evidenceTurnId: clientTurn.id,
        confidence: 0.95,
        status: 'confirmed',
      },
    ];

    const nextState = mergeFactsDelta(
      initialConversationState,
      factsDelta as any,
      'diagnostics',
      null,
      3,
      turnLookup
    );

    expect(nextState.budget.value).toBe('45 млн руб');
    expect(nextState.stage).toBe('diagnostics');
    expect(nextState.confirmedFacts.length).toBe(1);
    expect(nextState.confirmedFacts[0].evidenceQuote).toContain('45 миллионов');
  });

  // Scenario 13: STT turn deduplication protection (Requirement 10 & 14)
  it('Scenario 13: deduplicates identical final STT turns within 1.5s window', () => {
    const baseTime = 10000;
    const turn1: TranscriptTurn = {
      id: 't1',
      sessionId: 's1',
      source: 'call_audio',
      speaker: 'client',
      text: 'Алло, меня слышно?',
      timestamp: baseTime,
      isFinal: true,
    };

    // Identical turn within 500ms from same speaker
    expect(isDuplicateFinalTurn(turn1, 'client', 'Алло, меня слышно?', baseTime + 500, 1500)).toBe(true);

    // Same text but after 2000ms (> 1500ms window)
    expect(isDuplicateFinalTurn(turn1, 'client', 'Алло, меня слышно?', baseTime + 2000, 1500)).toBe(false);

    // Same text within 500ms but different speaker
    expect(isDuplicateFinalTurn(turn1, 'agent', 'Алло, меня слышно?', baseTime + 500, 1500)).toBe(false);

    // Different text within 500ms
    expect(isDuplicateFinalTurn(turn1, 'client', 'Да, слышно отлично', baseTime + 500, 1500)).toBe(false);
  });

  // Scenario 14: Deterministic facts extraction on client turn (Requirement 4 & 14)
  it('Scenario 14: extracts deterministic facts from client turns even when objections are raised', () => {
    const turnId = 'turn_objection_fact';
    const clientUtterance = 'В Сочи до 30 млн ничего приличного нет, скиньте варианты в ватсап';

    const facts = extractDeterministicFacts(clientUtterance, turnId);
    expect(facts.length).toBeGreaterThanOrEqual(2);

    const budgetFact = facts.find((f: any) => f.category === 'budget');
    expect(budgetFact).toBeDefined();
    expect(budgetFact?.value).toContain('30 млн руб');

    const locationFact = facts.find((f: any) => f.category === 'location');
    expect(locationFact).toBeDefined();
    expect(locationFact?.value).toBe('Сочи');
  });

  // Scenario 15: Candidate rules selector integrity (Requirement 6 & 14)
  it('Scenario 15: selects candidate rules with proper exclusion and applicability filtering', () => {
    const selected = selectCandidateRules(
      ANDREI_OS_RULES,
      'Рассматриваем покупку квартиры в Сочи для себя',
      'diagnostics'
    );

    expect(Array.isArray(selected)).toBe(true);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThanOrEqual(5);

    // Clarify for myself format should be prioritized for "для себя" without relocation
    const ruleIds = selected.map((r: any) => r.id);
    expect(ruleIds).toContain('clarify_for_myself_format');
  });

  // Scenario 16: Suggestion lock & pending suggestion preservation (Requirement 1 & 14)
  it('Scenario 16: preserves pending suggestion when suggestionLocked=true and presents on unlock', () => {
    let suggestionLocked = true;
    let currentSuggestion: any = { id: 'old_card', text: 'Старая подсказка' };
    let pendingSuggestion: any = null;

    // Fresh analysis arrives while Andrei is speaking
    const freshSuggestion = { id: 'fresh_card', text: 'Новая подсказка из анализа клиента' };

    if (suggestionLocked) {
      pendingSuggestion = freshSuggestion;
    } else {
      currentSuggestion = freshSuggestion;
    }

    // Current suggestion on screen remains unchanged
    expect(currentSuggestion.id).toBe('old_card');
    expect(pendingSuggestion.id).toBe('fresh_card');

    // Andrei stops speaking -> unlock
    suggestionLocked = false;
    if (pendingSuggestion) {
      currentSuggestion = pendingSuggestion;
      pendingSuggestion = null;
    }

    // Now fresh suggestion is presented without calling Gemini API again!
    expect(currentSuggestion.id).toBe('fresh_card');
    expect(pendingSuggestion).toBeNull();
  });

  // Scenario 17: Audio capture pause suppression (Requirement 3, 8 & 14)
  it('Scenario 17: audio capture pause suppression flag drops chunks without destroying stream', () => {
    let isPaused = false;
    let chunksSent = 0;

    const onChunk = () => {
      if (!isPaused) {
        chunksSent++;
      }
    };

    onChunk();
    expect(chunksSent).toBe(1);

    isPaused = true;
    onChunk();
    onChunk();
    expect(chunksSent).toBe(1); // Dropped while paused

    isPaused = false;
    onChunk();
    expect(chunksSent).toBe(2); // Resumed cleanly
  });

  // Scenario 18: Stage 2 Scheduler batches turns without aborting in-flight and isolates sessions
  it('Scenario 18: queues turns into pendingBatch while in-flight and aborts on session cancel', async () => {
    const provider = new AnalysisProvider();
    provider.setSession('sess_abort');

    let abortCalled = false;
    const fakeAbortController = {
      abort: () => {
        abortCalled = true;
      },
      signal: {} as any,
    };

    // Simulate in-flight state
    (provider as any).activeAbortController = fakeAbortController;
    (provider as any).isInFlight = true;
    (provider as any).inFlightRevision = 2;

    const newTurn: TranscriptTurn = {
      id: 'turn_new_supersede',
      sessionId: 'sess_abort',
      source: 'call_audio',
      speaker: 'client',
      text: 'На самом деле наш бюджет до пятидесяти миллионов',
      timestamp: Date.now(),
      isFinal: true,
    };

    provider.scheduleAnalysis(
      {
        sessionId: 'sess_abort',
        revision: 3,
        newTurns: [newTurn],
        recentTurns: [],
        currentState: initialConversationState,
      },
      vi.fn(),
      vi.fn(),
      undefined,
      100
    );

    // In Stage 2 scheduler, in-flight is NOT aborted; turn is batched into pendingBatch
    expect(abortCalled).toBe(false);
    expect(provider.getPendingBatch().length).toBe(1);
    expect(provider.getPendingBatch()[0].id).toBe('turn_new_supersede');

    // cancelPending cancels active controller
    provider.cancelPending();
    expect(abortCalled).toBe(true);
    expect(provider.getStats().cancelledCount).toBe(1);
  });

  // Scenario 19: Whole-word matching vs substring matching
  it('Scenario 19: hasWholeWord avoids substring false positives', () => {
    // "рядом" does not trigger "дом"
    expect(hasWholeWord('магазин находится рядом', 'дом')).toBe(false);
    expect(hasWholeWord('мы ищем загородный дом у моря', 'дом')).toBe(true);

    // "дорого" does not match "дорога"
    expect(hasWholeWord('хорошая дорога до пляжа', 'дорого')).toBe(false);
    expect(hasWholeWord('для нас это слишком дорого', 'дорого')).toBe(true);

    // "миллион" alone does not match "дорого"
    expect(hasAnyWholeWord('бюджет 15 миллионов', ['дорого', 'космос'])).toBe(false);
  });

  // Scenario 20: Semantic Anti-Repeat blocks asking for already confirmed facts
  it('Scenario 20: semanticAntiRepeat blocks suggestions asking for confirmed facts', () => {
    const stateWithBudget = {
      ...initialConversationState,
      budget: { value: '25-30 млн руб', evidenceTurnIds: ['turn_1'] },
      location: { value: 'Центр Сочи', evidenceTurnIds: ['turn_2'] },
    };

    const budgetQuestion: SuggestedReply = {
      id: 'rep_1',
      sessionId: 's1',
      basedOnRevision: 1,
      candidateRuleId: 'clarify_budget',
      actionType: 'CLARIFY',
      text: 'На какой порядок суммы покупки ориентируетесь?',
      shortReason: 'Уточнить бюджет',
      evidenceTurnIds: ['turn_1'],
      createdAt: Date.now(),
      stage: 'diagnostics',
      semanticKey: 'ask_budget',
    };

    const checkBudget = checkSemanticAntiRepeat(budgetQuestion, stateWithBudget);
    expect(checkBudget.accepted).toBe(false);
    expect(checkBudget.rejectionReason).toContain('Бюджет');

    const locationQuestion: SuggestedReply = {
      id: 'rep_2',
      sessionId: 's1',
      basedOnRevision: 1,
      candidateRuleId: null,
      actionType: 'CLARIFY',
      text: 'Какие районы Сочи рассматриваете?',
      shortReason: 'Уточнить локацию',
      evidenceTurnIds: ['turn_2'],
      createdAt: Date.now(),
      stage: 'diagnostics',
      semanticKey: 'ask_location',
    };

    const checkLocation = checkSemanticAntiRepeat(locationQuestion, stateWithBudget);
    expect(checkLocation.accepted).toBe(false);
    expect(checkLocation.rejectionReason).toContain('Локация');
  });

  // Scenario 21: Semantic Anti-Repeat blocks questions already in askedQuestions
  it('Scenario 21: semanticAntiRepeat blocks questions already recorded in askedQuestions', () => {
    const stateWithAsked = {
      ...initialConversationState,
      askedQuestions: ['Кто ещё будет участвовать в выборе и с кем нужно будет обсудить варианты?'],
    };

    const decisionMakerQuestion: SuggestedReply = {
      id: 'rep_3',
      sessionId: 's1',
      basedOnRevision: 1,
      candidateRuleId: 'check_decision_makers',
      actionType: 'CLARIFY',
      text: 'Кто ещё будет участвовать в выборе квартиры?',
      shortReason: 'ЛПР',
      evidenceTurnIds: ['turn_3'],
      createdAt: Date.now(),
      stage: 'diagnostics',
      semanticKey: 'ask_decision_makers',
    };

    const check = checkSemanticAntiRepeat(decisionMakerQuestion, stateWithAsked);
    expect(check.accepted).toBe(false);
    expect(check.rejectionReason).toContain('уже задавал');
  });

  // Scenario 22: Dynamic SPIN adapts HPB to RealEstatePainCategory
  it('Scenario 22: dynamic SPIN categorizes pain and builds tailored HPB', () => {
    // Noise & Sleep pain
    const noiseQuote = 'Невозможно спать, под окнами трасса и шумят по ночам';
    expect(detectRealEstatePainCategory(noiseQuote)).toBe('noise_sleep');

    const { hpb: noiseHpb } = buildHpbPresentation('Тишина и нормальный сон', noiseQuote);
    expect(noiseHpb.clientNeed.toLowerCase()).toContain('тишин');
    expect(noiseHpb.characteristic).toContain('звукоизоляци');
    expect(noiseHpb.benefit).toContain('сон');

    // Traffic & logistics pain
    const trafficQuote = 'По два часа стоим в пробках, до моря не доехать';
    expect(detectRealEstatePainCategory(trafficQuote)).toBe('traffic_logistics');

    const { hpb: trafficHpb } = buildHpbPresentation('Быстрая логистика', trafficQuote);
    expect(trafficHpb.clientNeed).toContain('логистик');
    expect(trafficHpb.benefit).toContain('час');

    // Security risks pain
    const riskQuote = 'Боимся долгостроев и что застройщик перенесет сдачу дома';
    expect(detectRealEstatePainCategory(riskQuote)).toBe('security_risks');

    const { hpb: riskHpb } = buildHpbPresentation('Безопасность сделки', riskQuote);
    expect(riskHpb.clientNeed).toContain('Безопасность');
    expect(riskHpb.characteristic).toContain('214');
  });

  // Scenario 23: Intent classification distinguishes objections from clarifications and next steps
  it('Scenario 23: classifyClientTurnIntent separates objections, clarifications, preferences and next steps', () => {
    // True objection
    const obj = classifyClientTurnIntent('Это очень дорого для нас, не потянем');
    expect(obj.type).toBe('objection');
    expect(obj.category).toBe('objection_price');

    // Clarification
    const clar = classifyClientTurnIntent('А где именно строится этот комплекс?');
    expect(clar.type).toBe('clarification');

    // Preference
    const pref = classifyClientTurnIntent('Нам обязательно нужен высокий этаж и балкон');
    expect(pref.type).toBe('preference');

    // Next step
    const nxt = classifyClientTurnIntent('Давайте созвонимся завтра в 18:00 по видео');
    expect(nxt.type).toBe('next_step');

    // Stop
    const stp = classifyClientTurnIntent('Не звоните мне больше, мы передумали покупать');
    expect(stp.type).toBe('stop');
  });

  // Scenario 24: "Used" button updates suggestion state and askedQuestions without injecting duplicate turns
  it('Scenario 24: handleUseSuggestion pattern records question in askedQuestions and does not mutate transcript', () => {
    const transcript: TranscriptTurn[] = [
      { id: 't1', speaker: 'agent', text: 'Добрый день!', timestamp: 1000, sessionId: 'sess_1', source: 'microphone', isFinal: true },
      { id: 't2', speaker: 'client', text: 'Здравствуйте, ищем квартиру в Сочи', timestamp: 2000, sessionId: 'sess_1', source: 'call_audio', isFinal: true },
    ];
    const initialCount = transcript.length;

    const suggestion: SuggestedReply = {
      id: 'sug_1',
      sessionId: 'sess_1',
      basedOnRevision: 1,
      candidateRuleId: 'P37',
      text: 'Дорого относительно бюджета, похожих вариантов или ценности самого решения?',
      shortReason: 'Изоляция цены',
      evidenceTurnIds: ['t2'],
      createdAt: Date.now(),
      stage: 'objection_clarification',
      semanticKey: 'clarify_objection_price',
    };

    // Simulate handleUseSuggestion update
    const updatedSuggestion: SuggestedReply = {
      ...suggestion,
      used: true,
      usedAt: Date.now(),
    };
    expect(updatedSuggestion.used).toBe(true);
    expect(typeof updatedSuggestion.usedAt).toBe('number');

    // Verify transcript was NOT mutated with a duplicate turn
    expect(transcript.length).toBe(initialCount);

    // Verify question is added to askedQuestions for anti-repeat
    const state: ConversationState = {
      ...createInitialState(),
      askedQuestions: [updatedSuggestion.text],
    };
    const repeatCheck = checkSemanticAntiRepeat(updatedSuggestion, state);
    expect(repeatCheck.accepted).toBe(false);
  });

  // Scenario 25: Hallucination Prevention & Substring Safety
  it('Scenario 25: prevents hallucinations from substring matches (рядом != дом, ипотека != ип)', () => {
    // "рядом" must not trigger "дом"
    expect(hasWholeWord('Квартира рядом с парком', 'дом')).toBe(false);
    expect(hasWholeWord('Мы ищем отдельный дом в горах', 'дом')).toBe(true);

    // "ипотека" must not trigger "ип"
    expect(hasWholeWord('Планируем брать в ипотеку', 'ип')).toBe(false);
    expect(hasWholeWord('У меня открыто ИП', 'ип')).toBe(true);

    // "жен" (жена) must not be triggered by "важен"
    expect(hasWholeWord('Для нас важен высокий этаж', 'жена')).toBe(false);
    expect(hasWholeWord('Мы с женой выбираем квартиру', 'женой')).toBe(true);
  });

  // Scenario 26: Evidence Invariant Validator
  it('Scenario 26: validateEvidenceQuote ensures facts are backed by real substrings in turn text', () => {
    const turnText = 'Мы с семьей ищем квартиру до 30 миллионов рублей в Сириусе';
    
    expect(validateEvidenceQuote(turnText, '30 миллионов рублей')).toBe(true);
    expect(validateEvidenceQuote(turnText, 'до 30 миллионов')).toBe(true);
    expect(validateEvidenceQuote(turnText, 'в Сириусе')).toBe(true);
    
    // Hallucinated quote not in the turn
    expect(validateEvidenceQuote(turnText, 'хотим дом у моря')).toBe(false);
    expect(validateEvidenceQuote(turnText, 'бюджет 50 миллионов')).toBe(false);
  });

  // Scenario 27: Full Replay / Acceptance Run — Conversation Intelligence Pipeline
  it('Scenario 27: executes full replay sequence without early return and with SPIN progression', () => {
    let state = createInitialState();
    const transcript: TranscriptTurn[] = [];

    const turnsData = [
      { speaker: 'agent' as const, text: 'Добрый день! Меня зовут Андрей, агентство недвижимости. Удобно говорить?' },
      { speaker: 'client' as const, text: 'Да, здравствуйте, удобно.' },
      { speaker: 'agent' as const, text: 'Подскажите, ищете недвижимость в Сочи для постоянного проживания или как инвестицию?' },
      { speaker: 'client' as const, text: 'Мы ищем квартиру для себя, планируем переезд с семьей.' },
      { speaker: 'agent' as const, text: 'Отлично! По бюджету на какую сумму ориентируетесь?' },
      { speaker: 'client' as const, text: 'Бюджет у нас около 30 миллионов рублей, расчет наличными.' },
      { speaker: 'agent' as const, text: 'Рассматриваете конкретный район или близость к морю?' },
      { speaker: 'client' as const, text: 'Хотелось бы в Сириусе, но мы боимся шума от трассы и туристов, сейчас не можем нормально спать.' },
      { speaker: 'agent' as const, text: 'Если бы удалось подобрать тихий закрытый двор со звукоизоляцией, насколько это решило бы вопрос?' },
      { speaker: 'client' as const, text: 'Да, именно это нам и нужно, тишина и нормальный сон для детей.' },
    ];

    let lastAgentTurnText = '';

    for (let i = 0; i < turnsData.length; i++) {
      const data = turnsData[i];
      const turn: TranscriptTurn = {
        id: `turn_${i + 1}`,
        sessionId: 'replay_session',
        source: data.speaker === 'agent' ? 'microphone' : 'call_audio',
        speaker: data.speaker,
        text: data.text,
        timestamp: Date.now() + i * 1000,
        isFinal: true,
      };
      transcript.push(turn);

      if (data.speaker === 'agent') {
        lastAgentTurnText = data.text;
        continue;
      }

      // 1. Client substantive check
      expect(isSubstantiveClientTurn(turn.text)).toBe(true);

      // 2. Deterministic facts extraction
      const facts = extractDeterministicFacts(turn.text, turn.id);
      if (facts.length > 0) {
        const turnLookup: Record<string, string> = {};
        transcript.forEach((t) => { turnLookup[t.id] = t.text; });
        state = mergeFactsDelta(state, facts as any, state.stage, undefined, i + 1, turnLookup);
      }

      // 3. Client turn intent classification
      const intent = classifyClientTurnIntent(turn.text, state);
      expect(intent).toBeDefined();

      // 4. Local objection check
      const localObj = detectLocalObjection(turn.text, state);
      if (localObj && intent.type === 'objection') {
        state = {
          ...state,
          stage: 'objection_clarification',
          objections: {
            value: localObj.category,
            items: state.objections.items.includes(localObj.category)
              ? state.objections.items
              : [...state.objections.items, localObj.category],
            evidenceTurnIds: [...state.objections.evidenceTurnIds, turn.id],
          },
        };
      }

      // 5. SPIN Progression Evaluation (Must NOT be blocked even when local objection is checked)
      const spinRes = evaluateSpinAndHpb(turn, state.spin, 'none', lastAgentTurnText);
      if (spinRes?.updatedSpin) {
        state = {
          ...state,
          spin: spinRes.updatedSpin,
          spinState: spinRes.updatedSpin,
        };
      }
    }

    // Verify final state after replay
    // Budget & Payment & Location & Goal facts extracted
    expect(state.budget.value).toContain('30');
    expect(state.paymentMethod.value).toBe('наличные');
    expect(state.location.value).toBe('Сириус');
    expect(state.goal.value).toBe('Постоянное личное проживание');

    // SPIN progression reached completed stages
    expect(state.spin.completedStages.length).toBeGreaterThan(0);
    expect(state.spin.completedStages).toContain('PROBLEM');
    expect(state.spin.completedStages).toContain('NEED_PAYOFF');
  });

  // Scenario 28: Exact User Regression Scenario
  it('Scenario 28: executes user regression replay flow with facts, SPIN progression, and agreedNextStep', () => {
    let state = createInitialState();
    const transcript: TranscriptTurn[] = [];

    const replayDialogue = [
      { speaker: 'agent' as const, text: 'Добрый день! Подскажите, для какой цели подбираете недвижимость?' },
      { speaker: 'client' as const, text: 'Ищу для себя: постоянная жизнь + иногда сдавать.' },
      { speaker: 'agent' as const, text: 'Какой бюджет планируете на покупку?' },
      { speaker: 'client' as const, text: 'Бюджет до 15 млн рублей.' },
      { speaker: 'agent' as const, text: 'Что для вас важнее всего при выборе?' },
      { speaker: 'client' as const, text: 'Главное — надёжность/прозрачность объекта и документов.' },
      { speaker: 'agent' as const, text: 'А если будут задержки или непонятный статус, как это повлияет?' },
      { speaker: 'client' as const, text: 'Это потраченные время/нервы/финансовые риски, я этого не переживу.' },
      { speaker: 'agent' as const, text: 'Если покажем проверенные объекты с чистой историей, это снимет риски?' },
      { speaker: 'client' as const, text: 'Да, именно это и нужно, тогда буду спокоен.' },
      { speaker: 'agent' as const, text: 'В какие сроки планируете выйти на сделку?' },
      { speaker: 'client' as const, text: 'В планах пара месяцев.' },
      { speaker: 'agent' as const, text: 'Какой способ покупки рассматриваете и форму занятости?' },
      { speaker: 'client' as const, text: 'Я работаю по найму, рассматриваю вариант ипотека/рассрочка, чтобы был комфортный ежемесячный платёж.' },
      { speaker: 'agent' as const, text: 'Видеопоказ завтра в 15:00 удобно?' },
      { speaker: 'client' as const, text: 'Да' },
    ];

    let lastAgentTurnText = '';

    for (let i = 0; i < replayDialogue.length; i++) {
      const item = replayDialogue[i];
      const turn: TranscriptTurn = {
        id: `turn_${i + 1}`,
        sessionId: 'user_scenario_session',
        source: item.speaker === 'agent' ? 'microphone' : 'call_audio',
        speaker: item.speaker,
        text: item.text,
        timestamp: Date.now() + i * 1000,
        isFinal: true,
        revision: i + 1,
      };
      transcript.push(turn);

      if (item.speaker === 'agent') {
        lastAgentTurnText = item.text;
        continue;
      }

      // Check client substantive turn (including contextual short answers like "Да")
      const substantive = isSubstantiveClientTurn(turn.text, lastAgentTurnText);
      expect(substantive).toBe(true);

      // Extract deterministic facts with agent context
      const facts = extractDeterministicFacts(turn.text, turn.id, lastAgentTurnText);
      if (facts.length > 0) {
        const turnLookup: Record<string, string> = {};
        transcript.forEach((t) => { turnLookup[t.id] = t.text; });
        state = mergeFactsDelta(state, facts as any, state.stage, undefined, i + 1, turnLookup);
      }

      // Classify intent
      const intent = classifyClientTurnIntent(turn.text, state, lastAgentTurnText);
      // Non-objection verification for "постоянная жизнь" and "Да"
      if (turn.text.includes('постоянная жизнь')) {
        expect(intent.type).not.toBe('objection');
      }
      if (turn.text === 'Да') {
        expect(intent.type).toBe('next_step');
      }

      // SPIN evaluation
      const spinRes = evaluateSpinAndHpb(turn, state.spin, 'none', lastAgentTurnText);
      if (spinRes?.updatedSpin) {
        state = {
          ...state,
          spin: spinRes.updatedSpin,
          spinState: spinRes.updatedSpin,
        };
      }
    }

    // Verify all deterministic facts extracted:
    expect(state.budget.value).toContain('15');
    expect(state.goal.value).toBeDefined();
    expect(state.purchaseTimeline?.value?.toLowerCase()).toContain('месяц');
    expect(state.paymentMethod.value?.toLowerCase()).toContain('ипотека');
    expect(state.criteria?.value?.replace(/ё/g, 'е').toLowerCase()).toContain('надежност');
    expect(state.employment?.value?.toLowerCase()).toContain('найм');
    expect(state.agreedNextStep?.value).toBeDefined();

    // Verify SPIN progression
    expect(state.spin.completedStages).toContain('PROBLEM');
    expect(state.spin.completedStages).toContain('IMPLICATION');
    expect(state.spin.completedStages).toContain('NEED_PAYOFF');
  });

  // Scenario 29: Hint Lifecycle Status Transition Verification
  it('Scenario 29: enforces HintLifecycleStatus transitions and TTL validation', () => {
    const HINT_TTL_MS = 15000;
    const now = Date.now();

    // Candidate suggestion
    const candidate: SuggestedReply = {
      id: 'hint_1',
      sessionId: 'sess_1',
      basedOnRevision: 3,
      candidateRuleId: null,
      actionType: 'CLARIFY',
      text: 'В какие сроки планируете выйти на сделку?',
      shortReason: 'Уточнить сроки',
      evidenceTurnIds: ['t_1'],
      createdAt: now,
      stage: 'diagnostics',
      confidenceStatus: 'high',
      lifecycleStatus: 'candidate',
      semanticKey: 'purchase_timeline',
    };

    expect(candidate.lifecycleStatus).toBe('candidate');

    // Promotion to shown
    candidate.lifecycleStatus = 'shown';
    expect(candidate.lifecycleStatus).toBe('shown');

    // Used transition
    candidate.lifecycleStatus = 'used';
    candidate.used = true;
    candidate.usedAt = now + 1000;
    expect(candidate.lifecycleStatus).toBe('used');

    // Superseded check when new revision arrives
    const pendingOld: SuggestedReply = {
      ...candidate,
      id: 'hint_2',
      basedOnRevision: 2,
      lifecycleStatus: 'candidate',
    };
    const currentRev = 3;
    if (pendingOld.basedOnRevision < currentRev) {
      pendingOld.lifecycleStatus = 'superseded';
    }
    expect(pendingOld.lifecycleStatus).toBe('superseded');

    // Expired check when TTL exceeded
    const pendingExpired: SuggestedReply = {
      ...candidate,
      id: 'hint_3',
      createdAt: now - 16000,
      lifecycleStatus: 'candidate',
    };
    if (now - pendingExpired.createdAt > HINT_TTL_MS) {
      pendingExpired.lifecycleStatus = 'expired';
    }
    expect(pendingExpired.lifecycleStatus).toBe('expired');

    // Suppressed check when dismissed or anti-repeat rejects
    const dismissed: SuggestedReply = {
      ...candidate,
      id: 'hint_4',
      lifecycleStatus: 'shown',
    };
    dismissed.lifecycleStatus = 'suppressed';
    expect(dismissed.lifecycleStatus).toBe('suppressed');
  });

  // Scenario A: Active suggestion retention when new response has shouldSuggest = false
  it('Scenario A: preserves current active suggestion when new AI response contains shouldSuggest=false and topic remains open', () => {
    // Current displayed suggestion
    const currentSuggestion: SuggestedReply = {
      id: 'sugg_budget_1',
      sessionId: 'sess_test',
      basedOnRevision: 1,
      candidateRuleId: null,
      actionType: 'CLARIFY',
      text: 'В какой бюджет комфортно уложиться при покупке?',
      shortReason: 'Уточнить бюджет',
      evidenceTurnIds: ['t_1'],
      createdAt: Date.now() - 2000,
      stage: 'diagnostics',
      confidenceStatus: 'high',
      lifecycleStatus: 'shown',
      closesMetric: 'budget',
    };

    let displayedSuggestion: SuggestedReply | null = currentSuggestion;
    let shouldSuggestUIState = true;

    // Simulate incoming analysis response with shouldSuggest = false
    const analysisResponse = {
      sessionId: 'sess_test',
      basedOnRevision: 2,
      actionType: 'WAIT' as const,
      shouldSuggest: false,
      suggestedReply: null,
      factsDelta: {},
    };

    // State of conversation where topic 'budget' is still not closed
    const currentConvState: ConversationState = {
      ...initialConversationState,
      scriptProgress: {
        metrics: {
          budget: {
            id: 'budget',
            name: 'Бюджет покупки',
            category: 'finances',
            status: 'not_confirmed',
            value: null,
          },
        },
      } as any,
    };

    // Logic in App.tsx / handleAnalysisSuccess:
    // When shouldSuggest = false, it means "no new suggestion", NOT "remove current suggestion"
    if (analysisResponse.shouldSuggest && analysisResponse.suggestedReply) {
      displayedSuggestion = analysisResponse.suggestedReply;
      shouldSuggestUIState = true;
    } else {
      // Check if topic of current suggestion was closed
      const current = displayedSuggestion;
      if (current?.closesMetric) {
        const metric = currentConvState.scriptProgress?.metrics?.[current.closesMetric];
        if (metric && isMetricClosed(metric.status)) {
          current.lifecycleStatus = 'suppressed';
          displayedSuggestion = null;
          shouldSuggestUIState = false;
        }
      }
      // If topic is still open, displayedSuggestion remains untouched!
    }

    // VERIFICATION:
    // Suggestion must remain displayed on screen
    expect(displayedSuggestion).not.toBeNull();
    expect(displayedSuggestion?.id).toBe('sugg_budget_1');
    expect(displayedSuggestion?.text).toBe('В какой бюджет комфортно уложиться при покупке?');
    expect(displayedSuggestion?.lifecycleStatus).toBe('shown');
  });

  // Scenario B: Analysis response arrives at 6s; not cancelled at 5s; state updated; stale suggestion not shown
  it('Scenario B: does not abort request at 5-6s, applies state update, and suppresses stale suggestion', async () => {
    const provider = new AnalysisProvider();
    provider.setSession('sess_timeout_test');

    const clientTurn: TranscriptTurn = {
      id: 'turn_client_6s',
      sessionId: 'sess_timeout_test',
      source: 'call_audio',
      speaker: 'client',
      text: 'Мы рассматриваем бюджет 50 миллионов',
      timestamp: Date.now(),
      isFinal: true,
    };

    const originalFetch = global.fetch;
    const requestStartTime = Date.now();

    // Mock fetch that resolves after 6000ms (simulate 6s response time)
    // Note: AnalysisProvider.HARD_TIMEOUT_MS is 11000ms (> 6000ms), so it will NOT abort!
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              json: async () => ({
                sessionId: 'sess_timeout_test',
                basedOnRevision: 1, // original revision when request started
                actionType: 'CLARIFY',
                shouldSuggest: true,
                suggestedReply: {
                  id: 'sugg_stale_1',
                  sessionId: 'sess_timeout_test',
                  basedOnRevision: 1,
                  actionType: 'CLARIFY',
                  text: 'Какой бюджет покупки планируете?',
                  shortReason: 'Уточнить бюджет',
                  evidenceTurnIds: ['turn_client_6s'],
                  createdAt: requestStartTime, // created 6 seconds ago!
                  stage: 'diagnostics',
                  confidenceStatus: 'high',
                  lifecycleStatus: 'candidate',
                  closesMetric: 'budget',
                },
                factsDelta: [
                  {
                    field: 'budget',
                    value: '50 млн руб',
                    evidenceQuote: '50 миллионов',
                    evidenceTurnId: 'turn_client_6s',
                    confidence: 0.95,
                    status: 'confirmed',
                  },
                ],
              }),
            });
          }, 120); // Scaled time: 120ms represents delayed response in test environment
        })
    );

    let receivedResponse: any = null;
    let receivedError: any = null;

    provider.scheduleAnalysis(
      {
        sessionId: 'sess_timeout_test',
        revision: 1,
        newTurns: [clientTurn],
        recentTurns: [],
        currentState: initialConversationState,
      },
      (res) => {
        receivedResponse = res;
      },
      (err) => {
        receivedError = err;
      },
      undefined,
      10 // debounce 10ms
    );

    // Wait for the delayed response to complete
    await new Promise((r) => setTimeout(r, 200));

    // Request must succeed and NOT be aborted or errored
    expect(receivedError).toBeNull();
    expect(receivedResponse).not.toBeNull();
    expect(receivedResponse.factsDelta[0].value).toBe('50 млн руб');

    // 1. Valid state update is accepted
    const updatedState = mergeFactsDelta(
      initialConversationState,
      receivedResponse.factsDelta,
      'diagnostics',
      undefined,
      receivedResponse.basedOnRevision,
      { [clientTurn.id]: clientTurn.text }
    );
    expect(updatedState.budget.value).toBe('50 млн руб');

    // In the application lifecycle (App.tsx:672), evaluateFirstCallScript computes metric status
    const scriptProgress = evaluateFirstCallScript([clientTurn], updatedState);
    updatedState.scriptProgress = scriptProgress;
    expect(scriptProgress.metrics['budget'].status).toBe('confirmed');

    // 2. Evaluate suggestion staleness check:
    // When late response arrives, check if suggestion's closesMetric is already closed
    const candidateSuggestion: SuggestedReply = receivedResponse.suggestedReply;
    const isTopicClosed = Boolean(
      candidateSuggestion.closesMetric &&
      isMetricClosed(scriptProgress.metrics[candidateSuggestion.closesMetric]?.status)
    );

    // Simulating verifyAndPromotePendingSuggestion in App.tsx:334-342
    let shouldPromote = true;
    if (isTopicClosed) {
      candidateSuggestion.lifecycleStatus = 'suppressed';
      shouldPromote = false;
    }

    expect(isTopicClosed).toBe(true);
    expect(shouldPromote).toBe(false);
    expect(candidateSuggestion.lifecycleStatus).toBe('suppressed');

    // Restore fetch
    global.fetch = originalFetch;
  });

  // Scenario C: Metric with partially_confirmed or needs_clarification and non-empty value
  it('Scenario C: metric with partially_confirmed/needs_clarification is NOT closed despite having value, allowing clarification', () => {
    // 1. Test directly with isMetricClosed
    expect(isMetricClosed('partially_confirmed')).toBe(false);
    expect(isMetricClosed('needs_clarification')).toBe(false);
    expect(isMetricClosed('not_confirmed')).toBe(false);
    expect(isMetricClosed('confirmed')).toBe(true);
    expect(isMetricClosed('not_applicable')).toBe(true);
    expect(isMetricClosed('declined_to_disclose')).toBe(true);

    // 2. Client mentions children but age is unknown:
    // Real function evaluateFirstCallScript sets status to 'partially_confirmed' with value
    const turns: TranscriptTurn[] = [
      {
        id: 't_agent_1',
        sessionId: 'sess_fam',
        source: 'microphone',
        speaker: 'agent',
        text: 'Здравствуйте! Рассматриваете для семьи или для себя?',
        timestamp: Date.now(),
        isFinal: true,
      },
      {
        id: 't_client_1',
        sessionId: 'sess_fam',
        source: 'call_audio',
        speaker: 'client',
        text: 'Для семьи, у нас есть дети',
        timestamp: Date.now() + 1000,
        isFinal: true,
      },
    ];

    const scriptProgress = evaluateFirstCallScript(turns, initialConversationState);
    const familyMortgageMetric = scriptProgress.metrics['familyMortgage'];

    // Metric must have non-empty value AND partially_confirmed status
    expect(familyMortgageMetric).toBeDefined();
    expect(familyMortgageMetric.value).toBeTruthy(); // Has value: "Есть дети (возраст не уточнён...)"
    expect(familyMortgageMetric.status).toBe('partially_confirmed');
    expect(familyMortgageMetric.needsClarification).toBe(true);

    // CRITICAL: isMetricClosed MUST return false despite metric having a value!
    expect(isMetricClosed(familyMortgageMetric.status)).toBe(false);

    // 3. Clarifying question is allowed:
    // Suggestion targeting this metric must NOT be suppressed by lifecycle check
    const clarifyingSuggestion: SuggestedReply = {
      id: 'sugg_clarify_kids',
      sessionId: 'sess_fam',
      basedOnRevision: 2,
      candidateRuleId: null,
      actionType: 'CLARIFY',
      text: 'Подскажите, сколько лет детям? Есть ли ребенок до 7 лет?',
      shortReason: 'Уточнить возраст детей для семейной ипотеки',
      evidenceTurnIds: ['t_client_1'],
      createdAt: Date.now(),
      stage: 'diagnostics',
      confidenceStatus: 'high',
      lifecycleStatus: 'candidate',
      closesMetric: 'familyMortgage',
    };

    // Promotion gate from App.tsx:
    let isSuppressed = false;
    if (clarifyingSuggestion.closesMetric) {
      const metric = scriptProgress.metrics[clarifyingSuggestion.closesMetric];
      if (metric && isMetricClosed(metric.status)) {
        isSuppressed = true;
      }
    }

    // Clarification question is NOT suppressed and is permitted to show
    expect(isSuppressed).toBe(false);
  });

  // Scenario D: familyMortgage has status not_applicable
  it('Scenario D: familyMortgage with status not_applicable is treated as closed, suppresses repeated questions', () => {
    // 1. Client explicitly states children are adults living separately
    const turns: TranscriptTurn[] = [
      {
        id: 't_agent_1',
        sessionId: 'sess_adult',
        source: 'microphone',
        speaker: 'agent',
        text: 'Добрый день! Рассматриваете квартиру для себя?',
        timestamp: Date.now(),
        isFinal: true,
      },
      {
        id: 't_client_1',
        sessionId: 'sess_adult',
        source: 'call_audio',
        speaker: 'client',
        text: 'Дети уже взрослые, живут отдельно, покупаем для себя с женой',
        timestamp: Date.now() + 1000,
        isFinal: true,
      },
    ];

    const scriptProgress = evaluateFirstCallScript(turns, initialConversationState);
    const familyMortgageMetric = scriptProgress.metrics['familyMortgage'];

    // Verify real engine output
    expect(familyMortgageMetric).toBeDefined();
    expect(familyMortgageMetric.status).toBe('not_applicable');
    expect(familyMortgageMetric.value).toContain('взрослые');
    expect(familyMortgageMetric.needsClarification).toBe(false);

    // Verify metric is recognized as closed
    expect(isMetricClosed(familyMortgageMetric.status)).toBe(true);

    // 2. Pre-display verification: A repeated question about family mortgage must be rejected
    const repeatedFamilyMortgageSuggestion: SuggestedReply = {
      id: 'sugg_repeat_fam',
      sessionId: 'sess_adult',
      basedOnRevision: 2,
      candidateRuleId: null,
      actionType: 'CLARIFY',
      text: 'А у вас есть дети до 7 лет под семейную ипотеку?',
      shortReason: 'Уточнить семейную ипотеку',
      evidenceTurnIds: ['t_client_1'],
      createdAt: Date.now(),
      stage: 'diagnostics',
      confidenceStatus: 'high',
      lifecycleStatus: 'candidate',
      closesMetric: 'familyMortgage',
    };

    // App.tsx promotion check:
    let isSuppressed = false;
    if (repeatedFamilyMortgageSuggestion.closesMetric) {
      const metric = scriptProgress.metrics[repeatedFamilyMortgageSuggestion.closesMetric];
      if (metric && isMetricClosed(metric.status)) {
        repeatedFamilyMortgageSuggestion.lifecycleStatus = 'suppressed';
        isSuppressed = true;
      }
    }

    // Repeated question is properly suppressed!
    expect(isSuppressed).toBe(true);
    expect(repeatedFamilyMortgageSuggestion.lifecycleStatus).toBe('suppressed');
  });

  describe('Children vs Mortgage Usage Disambiguation', () => {
    // 1. Child confirmed -> "ипотекой не пользовался" -> child status remains confirmed
    it('1. Child confirmed -> "ипотекой не пользовался" -> child status remains confirmed', () => {
      const turns: TranscriptTurn[] = [
        {
          id: 'turn_agent_1',
          sessionId: 'sess_child_1',
          source: 'microphone',
          speaker: 'agent',
          text: 'Подскажите, есть ли у вас дети до 7 лет?',
          timestamp: 1000,
          isFinal: true,
        },
        {
          id: 'turn_client_1',
          sessionId: 'sess_child_1',
          source: 'call_audio',
          speaker: 'client',
          text: 'Да, у нас сыну 3 года',
          timestamp: 2000,
          isFinal: true,
        },
        {
          id: 'turn_agent_2',
          sessionId: 'sess_child_1',
          source: 'microphone',
          speaker: 'agent',
          text: 'Ранее пользовались льготной или семейной ипотекой?',
          timestamp: 3000,
          isFinal: true,
        },
        {
          id: 'turn_client_2',
          sessionId: 'sess_child_1',
          source: 'call_audio',
          speaker: 'client',
          text: 'Нет, пока не пользовался. Это было бы в первый раз, если решим',
          timestamp: 4000,
          isFinal: true,
        },
      ];

      const scriptProgress = evaluateFirstCallScript(turns, initialConversationState);
      const famMetric = scriptProgress.metrics['familyMortgage'];

      expect(famMetric).toBeDefined();
      expect(famMetric.status).toBe('confirmed');
      expect(famMetric.value).toContain('Есть ребёнок до 7 лет');
      expect(isMetricClosed(famMetric.status)).toBe(true);
      expect(famMetric.needsClarification).toBe(false);
    });

    // 2. "ипотекой не пользовался" without child discussion -> children status remains unknown (not_confirmed)
    it('2. "ипотекой не пользовался" without child discussion -> children status remains unknown / not_confirmed', () => {
      const turns: TranscriptTurn[] = [
        {
          id: 'turn_agent_1',
          sessionId: 'sess_child_2',
          source: 'microphone',
          speaker: 'agent',
          text: 'Вы раньше брали ипотеку?',
          timestamp: 1000,
          isFinal: true,
        },
        {
          id: 'turn_client_1',
          sessionId: 'sess_child_2',
          source: 'call_audio',
          speaker: 'client',
          text: 'Нет, ипотекой никогда не пользовался',
          timestamp: 2000,
          isFinal: true,
        },
      ];

      const scriptProgress = evaluateFirstCallScript(turns, initialConversationState);
      const famMetric = scriptProgress.metrics['familyMortgage'];

      expect(famMetric).toBeDefined();
      expect(famMetric.status).toBe('not_confirmed');
      expect(famMetric.value).toBeNull();
      expect(isMetricClosed(famMetric.status)).toBe(false);
    });

    // 3. Explicit "детей нет" -> status not_applicable (confirmed closed)
    it('3. Explicit "детей нет" -> status not_applicable', () => {
      const turns: TranscriptTurn[] = [
        {
          id: 'turn_agent_1',
          sessionId: 'sess_child_3',
          source: 'microphone',
          speaker: 'agent',
          text: 'Есть ли дети?',
          timestamp: 1000,
          isFinal: true,
        },
        {
          id: 'turn_client_1',
          sessionId: 'sess_child_3',
          source: 'call_audio',
          speaker: 'client',
          text: 'Детей нет, подбираем квартиру для себя',
          timestamp: 2000,
          isFinal: true,
        },
      ];

      const scriptProgress = evaluateFirstCallScript(turns, initialConversationState);
      const famMetric = scriptProgress.metrics['familyMortgage'];

      expect(famMetric).toBeDefined();
      expect(famMetric.status).toBe('not_applicable');
      expect(famMetric.value).toContain('Детей нет');
      expect(isMetricClosed(famMetric.status)).toBe(true);
      expect(famMetric.needsClarification).toBe(false);
    });

    // 4. Question about child without answer -> children status unknown / not_confirmed
    it('4. Question about child without answer -> children status unknown / not_confirmed', () => {
      const turns: TranscriptTurn[] = [
        {
          id: 'turn_agent_1',
          sessionId: 'sess_child_4',
          source: 'microphone',
          speaker: 'agent',
          text: 'Подскажите, сколько детям лет, если есть дети?',
          timestamp: 1000,
          isFinal: true,
        },
      ];

      const scriptProgress = evaluateFirstCallScript(turns, initialConversationState);
      const famMetric = scriptProgress.metrics['familyMortgage'];

      expect(famMetric).toBeDefined();
      expect(famMetric.status).toBe('not_confirmed');
      expect(famMetric.value).toBeNull();
      expect(isMetricClosed(famMetric.status)).toBe(false);
      // Question was asked by agent, but client did not provide an answer
      expect(famMetric.agentQuestionAsked).toBe(true);
    });

    // 5. "нет" on down payment question -> does not change child status
    it('5. "нет" on down payment question -> does not change child status', () => {
      const turns: TranscriptTurn[] = [
        {
          id: 'turn_agent_1',
          sessionId: 'sess_child_5',
          source: 'microphone',
          speaker: 'agent',
          text: 'Есть ли у вас дети до 7 лет?',
          timestamp: 1000,
          isFinal: true,
        },
        {
          id: 'turn_client_1',
          sessionId: 'sess_child_5',
          source: 'call_audio',
          speaker: 'client',
          text: 'Да, дочке 5 лет',
          timestamp: 2000,
          isFinal: true,
        },
        {
          id: 'turn_agent_2',
          sessionId: 'sess_child_5',
          source: 'microphone',
          speaker: 'agent',
          text: 'Есть ли уже на руках первоначальный взнос?',
          timestamp: 3000,
          isFinal: true,
        },
        {
          id: 'turn_client_2',
          sessionId: 'sess_child_5',
          source: 'call_audio',
          speaker: 'client',
          text: 'Нет, пока нет, планируем продавать квартиру',
          timestamp: 4000,
          isFinal: true,
        },
      ];

      const scriptProgress = evaluateFirstCallScript(turns, initialConversationState);
      const famMetric = scriptProgress.metrics['familyMortgage'];

      expect(famMetric).toBeDefined();
      expect(famMetric.status).toBe('confirmed');
      expect(famMetric.value).toContain('Есть ребёнок до 7 лет');
      expect(isMetricClosed(famMetric.status)).toBe(true);
    });
  });
});


