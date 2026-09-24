/**
 * Central Russian UI labels and mappings.
 * Prevents raw technical IDs from showing up in user-facing UI.
 */

export const METRIC_LABELS: Record<string, string> = {
  goal: 'Цель покупки',
  primaryGoal: 'Основная цель покупки',
  secondaryUse: 'Дополнительный сценарий',
  location: 'Город или локация',
  propertyType: 'Тип недвижимости',
  budget: 'Бюджет покупки',
  paymentMethod: 'Способ оплаты',
  payment_method: 'Способ оплаты',
  purchaseTimeline: 'Сроки покупки',
  purchase_timeline: 'Сроки покупки',
  moveInTimeline: 'Сроки заселения / переезда',
  move_in_timeline: 'Сроки заселения / переезда',
  timeline: 'Сроки покупки / переезда',
  decisionMaker: 'Лицо, принимающее решение (ЛПР)',
  decisionMakers: 'Лицо, принимающее решение (ЛПР)',
  decision_makers: 'Лицо, принимающее решение (ЛПР)',
  criteria: 'Ключевые критерии',
  infrastructure: 'Инфраструктура и окружение',
  employment: 'Занятость и форма дохода',
  financialPriority: 'Финансовый приоритет',
  financial_priority: 'Финансовый приоритет',
  familyMortgage: 'Семейная ипотека (дети)',
  family_mortgage: 'Семейная ипотека (дети)',
  concerns: 'Опасения и риски',
  objections: 'Возражения',
  experience: 'Опыт выбора / покупки',
  nextStep: 'Следующий шаг',
  ppv: 'Видеопрезентация (ППВ)',
};

export const OBJECTION_LABELS: Record<string, string> = {
  objection_price: 'Цена / Высокая стоимость',
  objection_timing: 'Сроки / Надо подумать',
  objection_security: 'Надёжность и безопасность сделки',
  objection_finance: 'Условия финансирования / Ипотека',
  objection_remote: 'Дистанционный формат / Недоверие к удалёнке',
  objection_decision_maker: 'Согласование с супругом / семьёй',
  objection_competition: 'Сравнение с другими объектами/агентами',
  objection_location: 'Сомнения по локации / району',
  objection_stop: 'Отказ от контакта',
};

export const CATEGORY_LABELS: Record<string, string> = {
  needs: 'Потребности и цель',
  core_criteria: 'Базовые критерии',
  finances: 'Финансы и оплата',
  qualification: 'Квалификация и ЛПР',
  risks: 'Риски и сомнения',
  next_step: 'Договорённости',
  motive_living: 'Личное проживание',
  motive_vacation: 'Отдых и сезон',
  motive_investment: 'Инвестиции и доход',
  motive_neutral: 'Уточнение цели',
};

export function getMetricLabel(metricId: string): string {
  return METRIC_LABELS[metricId] || metricId;
}

export function getObjectionLabel(objectionId: string): string {
  return OBJECTION_LABELS[objectionId] || objectionId.replace(/^objection_/, '').replace(/_/g, ' ');
}

export function getCategoryLabel(catId: string): string {
  return CATEGORY_LABELS[catId] || catId;
}

/**
 * Filter out pseudo-objections (clarifications, neutral motives, facts)
 * so only real resistance items appear in the Objections UI block.
 */
export function isRealObjection(item: string): boolean {
  if (!item) return false;
  const lower = item.toLowerCase();
  if (
    lower.startsWith('motive_') ||
    lower.startsWith('action_') ||
    lower.startsWith('preference_') ||
    lower.includes('neutral') ||
    lower.includes('clarif') ||
    lower === 'fact'
  ) {
    return false;
  }
  return true;
}
