import { describe, it, expect } from 'vitest';
import { createInitialState, mergeFactsDelta } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { evaluateFirstCallScript } from './firstCallScriptEngine';
import { TranscriptTurn } from '../types';

describe('Regression Tests: Targeted Negation and Fact Disambiguation', () => {
  // Scenario A: «У меня нет детей».
  // Нигде не должно появляться положительного подтверждённого факта о наличии ребёнка или подходящем возрасте.
  it('Scenario A: "У меня нет детей" does not create positive child fact or confirmed family mortgage', () => {
    const state = createInitialState();
    const text = 'У меня нет детей';
    const turnId = 'turn_client_a';
    const clientTurn: TranscriptTurn = {
      id: turnId,
      sessionId: 'sess_test_a',
      speaker: 'client',
      source: 'call_audio',
      text,
      timestamp: Date.now(),
      isFinal: true,
    };

    const extracted = extractDeterministicFacts(text, turnId, null);
    const mergedState = mergeFactsDelta(
      state,
      extracted as any,
      state.stage,
      undefined,
      1,
      { [turnId]: text }
    );
    const scriptProgress = evaluateFirstCallScript([clientTurn], mergedState);
    const famMetric = scriptProgress.metrics['familyMortgage'];

    // 1. In extracted facts: no positive child fact
    const hasPositiveChildFact = extracted.some(
      (f) => (f.category === 'finances' || f.category === 'familyMortgage') &&
        f.field === 'familyMortgage' &&
        f.value.includes('Есть ребёнок')
    );
    expect(hasPositiveChildFact).toBe(false);

    // 2. In merged state: no positive child fact
    if (mergedState.familyMortgage?.value) {
      expect(mergedState.familyMortgage.value).not.toContain('Есть ребёнок');
    }

    // 3. In confirmedFacts: no positive child fact
    const positiveConfirmedFacts = mergedState.confirmedFacts.filter(
      (f) => f.category === 'familyMortgage' || f.category === 'family_mortgage' || f.category === 'finances'
    );
    for (const f of positiveConfirmedFacts) {
      expect(f.value).not.toContain('Есть ребёнок');
    }

    // 4. In script metric: not confirmed positive child
    expect(famMetric).toBeDefined();
    expect(famMetric.status).toBe('not_applicable');
    expect(famMetric.value).toContain('Детей нет');
  });

  // Scenario B: «Ипотека мне не нужна».
  // Ипотека не должна становиться выбранным способом оплаты ни в состоянии, ни в показателе скрипта.
  // Наличные или рассрочку без слов клиента не додумывать.
  it('Scenario B: "Ипотека мне не нужна" does not set mortgage as chosen payment method and does not guess other methods', () => {
    const state = createInitialState();
    const text = 'Ипотека мне не нужна';
    const turnId = 'turn_client_b';
    const clientTurn: TranscriptTurn = {
      id: turnId,
      sessionId: 'sess_test_b',
      speaker: 'client',
      source: 'call_audio',
      text,
      timestamp: Date.now(),
      isFinal: true,
    };

    const extracted = extractDeterministicFacts(text, turnId, null);
    const mergedState = mergeFactsDelta(
      state,
      extracted as any,
      state.stage,
      undefined,
      1,
      { [turnId]: text }
    );
    const scriptProgress = evaluateFirstCallScript([clientTurn], mergedState);
    const pmMetric = scriptProgress.metrics['paymentMethod'];

    // 1. In extracted: no paymentMethod set to mortgage
    const mortgageExtracted = extracted.find((f) => f.field === 'paymentMethod');
    if (mortgageExtracted) {
      expect(mortgageExtracted.value.toLowerCase()).not.toContain('ипотек');
    }

    // 2. In merged state: paymentMethod not set to mortgage
    if (mergedState.paymentMethod?.value) {
      expect(mergedState.paymentMethod.value.toLowerCase()).not.toContain('ипотек');
    }

    // 3. In script metric: paymentMethod not confirmed
    expect(pmMetric.status).not.toBe('confirmed');
    if (pmMetric.value) {
      expect(pmMetric.value.toLowerCase()).not.toContain('ипотек');
    }
  });

  // Scenario C: Агент: «Видеопоказ завтра в 15:00 удобно?» Клиент: «Да нет, видеопоказ мне не подходит».
  // Не должно появляться подтверждённого согласованного шага или clientAgreed=true.
  it('Scenario C: "Да нет, видеопоказ мне не подходит" on meeting offer does not confirm agreed step or PPV', () => {
    const state = createInitialState();
    const agentText = 'Видеопоказ завтра в 15:00 удобно?';
    const clientText = 'Да нет, видеопоказ мне не подходит';
    const agentTurnId = 'turn_agent_c';
    const clientTurnId = 'turn_client_c';

    const agentTurn: TranscriptTurn = {
      id: agentTurnId,
      sessionId: 'sess_test_c',
      speaker: 'agent',
      source: 'microphone',
      text: agentText,
      timestamp: Date.now() - 1000,
      isFinal: true,
    };
    const clientTurn: TranscriptTurn = {
      id: clientTurnId,
      sessionId: 'sess_test_c',
      speaker: 'client',
      source: 'call_audio',
      text: clientText,
      timestamp: Date.now(),
      isFinal: true,
    };

    const extracted = extractDeterministicFacts(clientText, clientTurnId, agentText);
    const mergedState = mergeFactsDelta(
      state,
      extracted as any,
      state.stage,
      undefined,
      1,
      { [clientTurnId]: clientText, [agentTurnId]: agentText }
    );
    const scriptProgress = evaluateFirstCallScript([agentTurn, clientTurn], mergedState);
    const ppvMetric = scriptProgress.metrics['ppv'];

    // 1. In extracted: no agreedNextStep created
    const nextStepFact = extracted.find((f) => f.field === 'agreedNextStep' || f.category === 'next_step');
    expect(nextStepFact).toBeUndefined();

    // 2. In state: agreedNextStep is empty
    expect(mergedState.agreedNextStep?.value).toBeFalsy();

    // 3. In metric: PPV not confirmed
    expect(ppvMetric.status).not.toBe('confirmed');
    expect(ppvMetric.value).not.toBe('Согласован');
  });

  // Scenario 4: «У меня есть ребёнок».
  // Наличие ребёнка не отрицать; возраст и применимость программы без дополнительных сведений не подтверждать.
  it('Scenario 4: "У меня есть ребёнок" partially confirms children without assuming < 7 years or confirming mortgage', () => {
    const state = createInitialState();
    const text = 'У меня есть ребёнок';
    const turnId = 'turn_client_4';
    const clientTurn: TranscriptTurn = {
      id: turnId,
      sessionId: 'sess_test_4',
      speaker: 'client',
      source: 'call_audio',
      text,
      timestamp: Date.now(),
      isFinal: true,
    };

    const extracted = extractDeterministicFacts(text, turnId, null);
    const mergedState = mergeFactsDelta(
      state,
      extracted as any,
      state.stage,
      undefined,
      1,
      { [turnId]: text }
    );
    const scriptProgress = evaluateFirstCallScript([clientTurn], mergedState);
    const famMetric = scriptProgress.metrics['familyMortgage'];

    // Children exist, but age is unknown -> status partially_confirmed, needs clarification
    expect(famMetric).toBeDefined();
    expect(famMetric.status).toBe('partially_confirmed');
    expect(famMetric.needsClarification).toBe(true);
    expect(famMetric.value).toContain('Есть дети (возраст не уточнён');
  });

  // Scenario 5: «Покупать буду в ипотеку».
  // Ипотека распознаётся как выбранный способ оплаты.
  it('Scenario 5: "Покупать буду в ипотеку" recognizes mortgage as chosen payment method', () => {
    const state = createInitialState();
    const text = 'Покупать буду в ипотеку';
    const turnId = 'turn_client_5';
    const clientTurn: TranscriptTurn = {
      id: turnId,
      sessionId: 'sess_test_5',
      speaker: 'client',
      source: 'call_audio',
      text,
      timestamp: Date.now(),
      isFinal: true,
    };

    const extracted = extractDeterministicFacts(text, turnId, null);
    const mergedState = mergeFactsDelta(
      state,
      extracted as any,
      state.stage,
      undefined,
      1,
      { [turnId]: text }
    );
    const scriptProgress = evaluateFirstCallScript([clientTurn], mergedState);
    const pmMetric = scriptProgress.metrics['paymentMethod'];

    expect(extracted.some((f) => f.field === 'paymentMethod' && f.value.toLowerCase().includes('ипотек'))).toBe(true);
    expect(mergedState.paymentMethod?.value?.toLowerCase()).toContain('ипотек');
    expect(pmMetric.status).toBe('confirmed');
    expect(pmMetric.value?.toLowerCase()).toContain('ипотек');
  });

  // Scenario 6: На предложение видеопоказа: «Да, завтра в 15:00 удобно».
  // Следующий шаг согласован.
  it('Scenario 6: "Да, завтра в 15:00 удобно" on meeting proposal agrees on next step', () => {
    const state = createInitialState();
    const agentText = 'Видеопоказ завтра в 15:00 удобно?';
    const clientText = 'Да, завтра в 15:00 удобно';
    const agentTurnId = 'turn_agent_6';
    const clientTurnId = 'turn_client_6';

    const agentTurn: TranscriptTurn = {
      id: agentTurnId,
      sessionId: 'sess_test_6',
      speaker: 'agent',
      source: 'microphone',
      text: agentText,
      timestamp: Date.now() - 1000,
      isFinal: true,
    };
    const clientTurn: TranscriptTurn = {
      id: clientTurnId,
      sessionId: 'sess_test_6',
      speaker: 'client',
      source: 'call_audio',
      text: clientText,
      timestamp: Date.now(),
      isFinal: true,
    };

    const extracted = extractDeterministicFacts(clientText, clientTurnId, agentText);
    const mergedState = mergeFactsDelta(
      state,
      extracted as any,
      state.stage,
      undefined,
      1,
      { [clientTurnId]: clientText, [agentTurnId]: agentText }
    );

    expect(extracted.some((f) => f.field === 'agreedNextStep' && f.value.includes('Видеопоказ'))).toBe(true);
    expect(mergedState.agreedNextStep?.value).toContain('Видеопоказ');
  });

  // Scenario 7: «Ипотека не нужна, куплю за свои средства».
  // Собственные средства распознаются, ипотека не выбирается.
  it('Scenario 7: "Ипотека не нужна, куплю за свои средства" selects cash / own funds and rejects mortgage', () => {
    const state = createInitialState();
    const text = 'Ипотека не нужна, куплю за свои средства';
    const turnId = 'turn_client_7';
    const clientTurn: TranscriptTurn = {
      id: turnId,
      sessionId: 'sess_test_7',
      speaker: 'client',
      source: 'call_audio',
      text,
      timestamp: Date.now(),
      isFinal: true,
    };

    const extracted = extractDeterministicFacts(text, turnId, null);
    const mergedState = mergeFactsDelta(
      state,
      extracted as any,
      state.stage,
      undefined,
      1,
      { [turnId]: text }
    );
    const scriptProgress = evaluateFirstCallScript([clientTurn], mergedState);
    const pmMetric = scriptProgress.metrics['paymentMethod'];

    // Mortgage must not be selected
    expect(mergedState.paymentMethod?.value?.toLowerCase()).not.toContain('ипотек');
    // Own funds / cash must be selected
    expect(mergedState.paymentMethod?.value).toBeTruthy();
    expect(pmMetric.status).toBe('confirmed');
    expect(pmMetric.value?.toLowerCase()).toContain('собственные средства');
  });

  // Scenario 8: «Ипотекой раньше не пользовался, сейчас хочу купить в ипотеку».
  // Выбранный способ — ипотека. Выводов о детях нет.
  it('Scenario 8: "Ипотекой раньше не пользовался, сейчас хочу купить в ипотеку" chooses mortgage without touching children', () => {
    const state = createInitialState();
    const text = 'Ипотекой раньше не пользовался, сейчас хочу купить в ипотеку';
    const turnId = 'turn_client_8';
    const clientTurn: TranscriptTurn = {
      id: turnId,
      sessionId: 'sess_test_8',
      speaker: 'client',
      source: 'call_audio',
      text,
      timestamp: Date.now(),
      isFinal: true,
    };

    const extracted = extractDeterministicFacts(text, turnId, null);
    const mergedState = mergeFactsDelta(
      state,
      extracted as any,
      state.stage,
      undefined,
      1,
      { [turnId]: text }
    );
    const scriptProgress = evaluateFirstCallScript([clientTurn], mergedState);
    const pmMetric = scriptProgress.metrics['paymentMethod'];
    const famMetric = scriptProgress.metrics['familyMortgage'];

    // Mortgage selected
    expect(mergedState.paymentMethod?.value?.toLowerCase()).toContain('ипотек');
    expect(pmMetric.status).toBe('confirmed');

    // No children facts inferred
    expect(mergedState.familyMortgage?.value).toBeFalsy();
    expect(famMetric.status).toBe('not_confirmed');
  });
});
