import { SalesRule, SuggestedReply, CallStage, ConversationState } from '../types';
import { ANDREI_OS_RULES } from './andreiRules';

export const DEFAULT_RULES: SalesRule[] = ANDREI_OS_RULES;

export class SalesDecisionEngine {
  private rules: SalesRule[] = DEFAULT_RULES;
  private ruleLastUsedTurn: Map<string, number> = new Map();

  constructor(customRules?: SalesRule[]) {
    if (customRules && customRules.length > 0) {
      this.rules = customRules;
    }
  }

  public setRules(rules: SalesRule[]) {
    this.rules = rules;
  }

  public getRules(): SalesRule[] {
    return this.rules;
  }

  public getRule(ruleId: string): SalesRule | undefined {
    return this.rules.find((r) => r.id === ruleId);
  }

  /**
   * Check if a candidate rule is in cooldown
   */
  public isRuleInCooldown(ruleId: string, currentTurnIndex: number): boolean {
    const lastUsed = this.ruleLastUsedTurn.get(ruleId);
    if (lastUsed === undefined) return false;
    const rule = this.getRule(ruleId);
    const cooldown = rule?.cooldown || 2;
    return currentTurnIndex - lastUsed < cooldown;
  }

  /**
   * Mark a rule as used at a specific turn index
   */
  public markRuleUsed(ruleId: string, turnIndex: number) {
    this.ruleLastUsedTurn.set(ruleId, turnIndex);
  }

  /**
   * Reset cooldowns for a new call session
   */
  public resetSession() {
    this.ruleLastUsedTurn.clear();
  }

  /**
   * Fast rule heuristic check based on client keywords (for instant feedback or fallback)
   */
  public detectTriggeredRule(clientText: string, _state: ConversationState): string | null {
    const lower = clientText.toLowerCase();

    // Respect stop
    if (
      lower.includes('больше не звоните') ||
      lower.includes('не звоните') ||
      lower.includes('не пишите') ||
      lower.includes('забудьте номер')
    ) {
      return 'respect_stop_contact';
    }

    // Busy time
    if (
      lower.includes('не могу говорить') ||
      lower.includes('за рулем') ||
      lower.includes('за рулём') ||
      lower.includes('на совещании') ||
      lower.includes('нет времени')
    ) {
      return 'respect_busy_time';
    }

    // Just browsing
    if (
      lower.includes('просто смотрю') ||
      lower.includes('пока просто смотрю') ||
      lower.includes('пока присматриваюсь') ||
      lower.includes('изучаю рынок')
    ) {
      return 'clarify_contact_reason';
    }

    // P37: Дорого / цены / скидка / бюджет
    if (
      lower.includes('дорого') ||
      lower.includes('дороговато') ||
      lower.includes('цены космос') ||
      lower.includes('завышен') ||
      lower.includes('не потянем') ||
      lower.includes('слишком большая цена') ||
      lower.includes('скидк')
    ) {
      return 'P37';
    }

    // P44: Анапа (NOT if client explicitly excludes Anapa: "Анапу не рассматриваю")
    if (
      (lower.includes('анап') || lower.includes('витязево') || lower.includes('джемете')) &&
      !lower.includes('не рассматриваю') &&
      !lower.includes('не хочу') &&
      !lower.includes('не интересует')
    ) {
      return 'P44';
    }

    // P48: ТОЛЬКО при прямом подтверждении переезда или постоянного проживания
    // «Для себя» без этих слов НЕ запускает P48!
    const hasExplicitRelocation =
      lower.includes('буду жить') ||
      lower.includes('будем жить') ||
      lower.includes('для постоянного') ||
      lower.includes('переезд') ||
      lower.includes('пмж') ||
      lower.includes('жить на юге') ||
      lower.includes('хочу переехать') ||
      lower.includes('будем жить всей семьей') ||
      lower.includes('будем жить всей семьёй');

    if (hasExplicitRelocation) {
      return 'P48';
    }

    // Если клиент сказал ТОЛЬКО «для себя» без переезда -> отдельное нейтральное уточнение формата
    if (lower.includes('для себя')) {
      return 'clarify_for_myself_format';
    }

    // Spouse / husband
    if (
      lower.includes('с мужем') ||
      lower.includes('с супругой') ||
      lower.includes('с женой') ||
      lower.includes('с партнером') ||
      lower.includes('обсудить с семьей')
    ) {
      return 'handle_discuss_spouse';
    }

    // Think about it
    if (lower.includes('я подумаю') || lower.includes('надо подумать')) {
      return 'handle_think_about_it';
    }

    // Specific materials requested
    // Specific materials requested / "пришлите фото"
    if (
      lower.includes('пришлите фото') ||
      lower.includes('скиньте фото') ||
      lower.includes('отправьте фото') ||
      lower.includes('пришлите в вотсап') ||
      lower.includes('скиньте в телеграм')
    ) {
      return 'objection_send_photos';
    }

    // "Не хочу видео" / видеозвонок
    if (
      lower.includes('не хочу видео') ||
      lower.includes('не люблю видео') ||
      lower.includes('без видео') ||
      lower.includes('зачем видео')
    ) {
      return 'objection_no_video';
    }

    // Покупка зависит от продажи
    if (
      lower.includes('сначала продам') ||
      lower.includes('нужно продать') ||
      lower.includes('продаем свою') ||
      lower.includes('продаём свою')
    ) {
      return 'condition_sell_first';
    }

    if (
      lower.includes('планировк') ||
      lower.includes('проект договора') ||
      lower.includes('шахматк')
    ) {
      return 'specific_object_material';
    }

    return null;
  }

  /**
   * Fallback reply generator when offline or API timeout occurs
   */
  public generateFallbackReply(
    ruleId: string | null,
    stage: CallStage,
    state: ConversationState,
    evidenceTurnId: string,
    revision: number,
    sessionId: string
  ): SuggestedReply | null {
    // Specific First Call Triggers
    if (ruleId === 'objection_send_photos') {
      return {
        id: `reply_${Date.now()}`,
        sessionId,
        basedOnRevision: revision,
        candidateRuleId: 'objection_send_photos',
        actionType: 'OBJECTION_CLARIFICATION',
        suggestionMode: 'OBJECTION_CLARIFICATION',
        closesMetric: 'ppv',
        closesMetricLabel: 'Вывод на видеопрезентацию (ППВ)',
        immediatePriority: 'Отработка возражения: перевод с фото на видеопоказ со специалистом',
        text: 'Фото я отправлю, но по ним сложно оценить локацию и планировку. Лучше на 15 минут подключим специалиста застройщика и посмотрим всё по видео. Вечером удобно?',
        shortReason: 'Признание содержания, изоляция сомнения и вывод на видеопоказ со специалистом.',
        expectedClientMeaning: 'Клиент соглашается уделить 15 минут на содержательный видеопоказ.',
        evidenceTurnIds: [evidenceTurnId],
        createdAt: Date.now(),
        stage,
      };
    }

    if (ruleId === 'objection_no_video') {
      return {
        id: `reply_${Date.now()}`,
        sessionId,
        basedOnRevision: revision,
        candidateRuleId: 'objection_no_video',
        actionType: 'OBJECTION_CLARIFICATION',
        suggestionMode: 'OBJECTION_CLARIFICATION',
        closesMetric: 'ppv',
        closesMetricLabel: 'Вывод на видеопрезентацию (ППВ)',
        immediatePriority: 'Отработка возражения: снятие барьера камеры',
        text: 'Понимаю. Камера с вашей стороны не обязательна — мы просто выведем планировки и расчёты на экран. Это сбережёт вам недели поездок. Когда удобнее подключиться?',
        shortReason: 'Снятие психологического барьера видеозвонка с сохранением ценности экрана.',
        expectedClientMeaning: 'Клиент соглашается на формат демонстрации экрана без собственной камеры.',
        evidenceTurnIds: [evidenceTurnId],
        createdAt: Date.now(),
        stage,
      };
    }

    if (ruleId === 'condition_sell_first') {
      return {
        id: `reply_${Date.now()}`,
        sessionId,
        basedOnRevision: revision,
        candidateRuleId: 'condition_sell_first',
        actionType: 'CLARIFY',
        suggestionMode: 'SPIN_SITUATION',
        closesMetric: 'downPaymentSource',
        closesMetricLabel: 'Источник первоначального взноса',
        immediatePriority: 'Следующий приоритет: выяснить статус продажи текущего жилья',
        text: 'Логично. Квартира уже выставлена в продажу или пока только прицениваетесь, какую сумму удастся выручить?',
        shortReason: 'Фиксация зависимости покупки от продажи жилья без иллюзии немедленной сделки.',
        expectedClientMeaning: 'Клиент сообщает реальный статус экспозиции квартиры и примерную сумму.',
        evidenceTurnIds: [evidenceTurnId],
        createdAt: Date.now(),
        stage,
      };
    }

    if (ruleId === 'clarify_for_myself_format') {
      return {
        id: `reply_${Date.now()}`,
        sessionId,
        basedOnRevision: revision,
        candidateRuleId: 'clarify_for_myself_format',
        actionType: 'CLARIFY',
        suggestionMode: 'SPIN_SITUATION',
        closesMetric: 'goal',
        closesMetricLabel: 'Цель покупки',
        immediatePriority: 'Следующий шаг: разграничить формат «для себя» (отдых или ПМЖ)',
        text: 'Понял. А для себя — это больше про отдых, сезонное проживание или планируете жить постоянно?',
        shortReason: '«Для себя» не равно переезду: точное разграничение цели без домысливания.',
        expectedClientMeaning: 'Клиент конкретизирует сценарий использования.',
        evidenceTurnIds: [evidenceTurnId],
        createdAt: Date.now(),
        stage,
      };
    }

    if (ruleId) {
      const rule = this.getRule(ruleId);
      if (rule && rule.suggestedQuestions.length > 0) {
        const unaskedQuestion =
          rule.suggestedQuestions.find(
            (q) =>
              !state.askedQuestions.some((asked) =>
                asked.toLowerCase().includes(q.slice(0, 20).toLowerCase())
              )
          ) || rule.suggestedQuestions[0];

        return {
          id: `reply_${Date.now()}`,
          sessionId,
          basedOnRevision: revision,
          candidateRuleId: rule.id,
          selectedRuleId: rule.id,
          actionType: rule.actionType || 'CLARIFY',
          text: unaskedQuestion,
          shortReason: rule.objective.slice(0, 100) + '...',
          evidenceTurnIds: [evidenceTurnId],
          createdAt: Date.now(),
          stage,
        };
      }
    }

    // Qualification hierarchy: 1. Goal -> 2. Location -> 3. Budget -> 4. Decision Maker -> 5. PPV
    if (!state.goal.value) {
      return {
        id: `reply_${Date.now()}`,
        sessionId,
        basedOnRevision: revision,
        candidateRuleId: 'P48',
        actionType: 'CLARIFY',
        closesMetric: 'goal',
        closesMetricLabel: 'Цель покупки',
        immediatePriority: 'Следующий приоритет: выяснить цель покупки',
        text: 'Подскажите, под какую основную задачу подбираете недвижимость — для постоянной жизни, отдыха или инвестиций?',
        shortReason: 'Выяснить цель покупки перед подбором сценария',
        expectedClientMeaning: 'Клиент называет свою истинную цель покупки.',
        evidenceTurnIds: [evidenceTurnId],
        createdAt: Date.now(),
        stage: 'diagnostics',
      };
    }

    if (!state.location.value) {
      return {
        id: `reply_${Date.now()}`,
        sessionId,
        basedOnRevision: revision,
        candidateRuleId: null,
        actionType: 'CLARIFY',
        closesMetric: 'location',
        closesMetricLabel: 'Город или локация',
        immediatePriority: 'Следующий приоритет: определить локацию',
        text: 'Какие районы Сочи или побережья рассматриваете в первую очередь?',
        shortReason: 'Уточнить предпочтительную локацию для поиска объектов',
        expectedClientMeaning: 'Клиент называет приоритетные локации.',
        evidenceTurnIds: [evidenceTurnId],
        createdAt: Date.now(),
        stage: 'diagnostics',
      };
    }

    if (!state.budget.value) {
      return {
        id: `reply_${Date.now()}`,
        sessionId,
        basedOnRevision: revision,
        candidateRuleId: 'clarify_budget',
        actionType: 'CLARIFY',
        closesMetric: 'budget',
        closesMetricLabel: 'Бюджет',
        immediatePriority: 'Следующий приоритет: уточнить бюджет покупки',
        text: 'Чтобы обсуждать подходящие варианты, на какой порядок суммы покупки ориентируетесь?',
        shortReason: 'Уточнить финансовые рамки для формирования сценария',
        expectedClientMeaning: 'Клиент называет комфортный ориентир по сумме.',
        evidenceTurnIds: [evidenceTurnId],
        createdAt: Date.now(),
        stage: 'diagnostics',
      };
    }

    if (!state.decisionMakers?.value) {
      return {
        id: `reply_${Date.now()}`,
        sessionId,
        basedOnRevision: revision,
        candidateRuleId: 'check_decision_makers',
        actionType: 'CLARIFY',
        closesMetric: 'decisionMaker',
        closesMetricLabel: 'Лицо, принимающее решение (ЛПР)',
        immediatePriority: 'Следующий шаг: проверить, кто принимает решение',
        text: 'Кто ещё будет участвовать в выборе и с кем нужно будет обсудить варианты?',
        shortReason: 'Проверка состава лиц, принимающих решение (ЛПР).',
        expectedClientMeaning: 'Клиент озвучивает участников принятия решения.',
        evidenceTurnIds: [evidenceTurnId],
        createdAt: Date.now(),
        stage: 'diagnostics',
      };
    }

    // Video Presentation (ППВ) proposal
    return {
      id: `reply_${Date.now()}`,
      sessionId,
      basedOnRevision: revision,
      candidateRuleId: 'propose_ppv',
      actionType: 'NEXT_STEP',
      closesMetric: 'ppv',
      closesMetricLabel: 'Вывод на видеопрезентацию (ППВ)',
      immediatePriority: 'Следующий шаг: предложить видеопоказ с экспертом застройщика',
      text: 'Чтобы сберечь время и не смотреть всё подряд, давайте подключим специалиста застройщика и за 15 минут посмотрим планировки по видео. Вам удобнее сегодня в 18:00 или завтра в 12:00?',
      shortReason: 'Вывод на видеопрезентацию (ППВ) с конкретным временным слотом.',
      expectedClientMeaning: 'Клиент выбирает удобный слот для 15-минутного видеопоказа.',
      evidenceTurnIds: [evidenceTurnId],
      createdAt: Date.now(),
      stage: 'next_step_agreement',
    };
  }
}
