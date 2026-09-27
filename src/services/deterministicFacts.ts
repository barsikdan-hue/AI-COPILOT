/**
 * Deterministic Fact Extraction for Real Estate Client Utterances
 * Extracts confirmed facts (budget, location, goal, payment method, timeline, criteria)
 * directly from client utterances with strictly validated verbatim quotes.
 */

import {
  hasWholeWord,
  hasAnyWholeWord,
  hasPhrase,
  hasAnyPhrase,
  normalizeRussianText,
  validateEvidenceQuote,
} from './textUtils';
import {
  classifyInvestmentIntent,
  detectAdultChildren,
  detectDecisionMaker,
  detectFundsAvailability,
  detectSearchExperience,
  extractSemanticCriteria,
} from './semanticEvidence';

export interface ExtractedFactItem {
  category: string;
  field: string;
  value: string;
  evidenceQuote: string;
  evidenceTurnId: string;
  confidence: number;
  status: 'confirmed';
  isFlexible?: boolean;
  comment?: string;
  needsClarification?: boolean;
}

export function extractDeterministicFacts(
  text: string,
  turnId: string,
  previousAgentTurnText?: string | null
): ExtractedFactItem[] {
  const trimmed = (text || '').trim();
  const clean = trimmed.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, '').trim();
  if (!trimmed) return [];

  const lower = trimmed.toLowerCase();
  const previousAgentLower = (previousAgentTurnText || '').toLowerCase();
  const facts: ExtractedFactItem[] = [];

  const agentAskedDownPayment =
    /(?:первоначальн|первый\s*взнос|сколько\s*(?:готовы|можете)?\s*внести|какую\s*сумму\s*(?:готовы|можете)?\s*внести|сумм\w*\s*сразу|на\s*руках)/iu.test(previousAgentLower);

  const sourceContext = agentAskedDownPayment || /источник|откуда.*средств|средства.*(?:руках|продаж)|после продажи/iu.test(previousAgentLower);

  const addFact = (
    category: string,
    field: string,
    value: string,
    quote: string,
    confidence = 0.95,
    extra?: Partial<ExtractedFactItem>
  ) => {
    if (!validateEvidenceQuote(trimmed, quote)) {
      console.warn(`[DeterministicFacts] Rejected invalid evidenceQuote "${quote}" for turn "${trimmed}"`);
      return;
    }
    facts.push({
      category,
      field,
      value,
      evidenceQuote: quote,
      evidenceTurnId: turnId,
      confidence,
      status: 'confirmed',
      ...extra,
    });
  };

  // 1. Budget extraction: e.g. "30 миллионов", "30 млн", "до 45 млн руб", "около 15 млн", "бюджет 15 млн"
  const spokenNumberMap: Record<string, number> = {
    один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6,
    семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12,
    тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17,
    восемнадцать: 18, девятнадцать: 19, двадцать: 20, тридцать: 30, сорок: 40,
    пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90,
  };
  const parseBudgetNumber = (token: string): number | null => {
    const cleanToken = token.toLocaleLowerCase('ru-RU').replace(',', '.').trim();
    const numeric = Number(cleanToken);
    if (Number.isFinite(numeric)) return numeric;
    return spokenNumberMap[cleanToken] ?? null;
  };
  const normalizedBudgetNumber = (token: string): string => String(Number(token.replace(',', '.')));
  const normalizedBudgetUnit = (unit: string): string => {
    if (unit.startsWith('млрд')) return 'млрд руб';
    if (unit.startsWith('тыс') || unit === 'к') return 'тыс руб';
    return 'млн руб';
  };
  const budgetRangeMatch = lower.match(
    /(?:(?:бюджет|диапазон|рассматрива\p{L}*|смотр\p{L}*|где-то|примерно|около)[^\d]{0,20})?(?:от\s*)?(\d+(?:[.,]\d+)?)\s*(?:млн|миллион(?:а|ов)?|млрд|тысяч(?:и)?|тыс|к)?\s*(?:[-–—]|до)\s*(\d+(?:[.,]\d+)?)\s*(млн|миллион(?:а|ов)?|млрд|тысяч(?:и)?|тыс|к)(?=$|[^\p{L}\p{N}])/iu
  );
  const unitlessCorrectionRangeMatch = !budgetRangeMatch && lower.match(
    /(?:нет\s*,?\s*)?(?:мож\p{L}*|готов\p{L}*)[^.!?]{0,24}(?:подняться|увеличить|расширить)[^\d]{0,12}(?:до\s*)?(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)(?!\s*(?:этаж\p{L}*|лет|год\p{L}*|месяц\p{L}*|процент\p{L}*|%|метр\p{L}*))(?=$|[^\p{L}\p{N}])/iu
  );
  const rawRublesMatch = lower.match(/^\s*(\d{1,3}(?:\s\d{3}){2,3}|\d{7,12})\s*(?:руб(?:лей|ля)?|₽)?[.!]?\s*$/iu);
  const structuredBudget = (() => {
    if (budgetRangeMatch) {
      const unit = normalizedBudgetUnit(budgetRangeMatch[3]);
      const range = `${normalizedBudgetNumber(budgetRangeMatch[1])}–${normalizedBudgetNumber(budgetRangeMatch[2])} ${unit}`;
      const approximate = /(?:где-то|примерно|около)/iu.test(budgetRangeMatch[0]);
      return {
        value: approximate ? `Около ${range}` : range,
        quote: budgetRangeMatch[0].trim(),
        isFlexible: approximate,
        comment: approximate ? 'Клиент назвал приблизительный диапазон бюджета.' : 'Клиент назвал закрытый диапазон бюджета.',
      };
    }
    if (unitlessCorrectionRangeMatch) {
      return {
        value: `${normalizedBudgetNumber(unitlessCorrectionRangeMatch[1])}–${normalizedBudgetNumber(unitlessCorrectionRangeMatch[2])} млн руб`,
        quote: unitlessCorrectionRangeMatch[0].trim(),
        isFlexible: false,
        comment: 'Клиент явно заменил прежний бюджет новым диапазоном.',
      };
    }
    if (rawRublesMatch) {
      const rubles = Number(rawRublesMatch[1].replace(/\s+/g, ''));
      const millions = rubles / 1_000_000;
      return {
        value: `${String(Number(millions.toFixed(6)))} млн руб`,
        quote: rawRublesMatch[0].trim(),
        isFlexible: false,
        comment: 'Полная сумма в рублях нормализована в миллионы рублей.',
      };
    }
    return null;
  })();
  const correctionToken = '(?:\\d+(?:[.,]\\d+)?|один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|одиннадцать|двенадцать|тринадцать|четырнадцать|пятнадцать|шестнадцать|семнадцать|восемнадцать|девятнадцать|двадцать|тридцать|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто)';
  const budgetCorrectionRegex = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])не\\s+(${correctionToken})\\s*(млн|миллион(?:а|ов)?|млрд|тысяч(?:и)?|тыс|к)[^.!?]{0,28}(?:,\\s*|\\s+)а\\s+(${correctionToken})(?:\\s*(млн|миллион(?:а|ов)?|млрд|тысяч(?:и)?|тыс|к))?(?!\\s*(?:лет|год|месяц|%))`,
    'iu'
  );
  const budgetCorrectionMatch = lower.match(budgetCorrectionRegex);
  let explicitCorrectedBudget: { value: string; quote: string } | null = null;
  if (budgetCorrectionMatch) {
    const correctedNumber = parseBudgetNumber(budgetCorrectionMatch[3]);
    const correctedUnit = budgetCorrectionMatch[4] || budgetCorrectionMatch[2];
    if (correctedNumber != null) {
      const value = correctedUnit.startsWith('млрд')
        ? `${correctedNumber} млрд руб`
        : correctedUnit.startsWith('тыс') || correctedUnit === 'к'
          ? `${correctedNumber} тыс руб`
          : `${correctedNumber} млн руб`;
      explicitCorrectedBudget = {
        value,
        quote: budgetCorrectionMatch[0].trim().replace(/^[^\p{L}\p{N}]+/u, ''),
      };
    }
  }

  const budgetMatches = Array.from(
    lower.matchAll(
      /(?:(?:бюджет(?:ом|а)?|до|около|примерно|в\s*районе)\s*)?(\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?)\s*(млн|миллион(?:а|ов)?|млрд|тысяч(?:и)?|тыс|к)(?:[^\p{L}\p{N}]|$)/giu
    )
  );
  const explicitDownPaymentAmount = (() => {
    const afterLabel = lower.match(
      /(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*\s*(?:(?:составля\p{L}*|будет|примерно|около|в\s+размере)\s*)?(\d+(?:[.,]\d+)?)\s*(млн|миллион(?:а|ов)?|тысяч(?:и)?|тыс|%|руб(?:лей|ля)?)/iu
    );
    if (afterLabel) return { amount: afterLabel[1], unit: afterLabel[2], quote: afterLabel[0].trim() };
    const beforeLabel = lower.match(
      /(\d+(?:[.,]\d+)?)\s*(млн|миллион(?:а|ов)?|тысяч(?:и)?|тыс|%|руб(?:лей|ля)?)\s+(?:на|для)\s+(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*/iu
    );
    return beforeLabel
      ? { amount: beforeLabel[1], unit: beforeLabel[2], quote: beforeLabel[0].trim() }
      : null;
  })();
  // In corrections such as “not 10m, but 6m”, the last explicit value is current.
  // In flexible-budget phrases (“до 30, но 35–40 если стоящая история”) preserve
  // both the base target and the stretch ceiling instead of collapsing to one number.
  const unitlessStretchMatch = lower.match(/(?:посмотр(?:ю|им)|готов[^.!?]{0,20}рассмотр|мож(?:но|ем)[^.!?]{0,20}рассмотр)[^0-9]{0,24}(\d{1,3}(?:[.,]\d+)?(?:\s*-\s*\d{1,3}(?:[.,]\d+)?)?)(?!\s*(?:лет|год|месяц|%))/iu);
  const explicitBudgetCorrection = Boolean(explicitCorrectedBudget);
  const contextualBudgetMatch = budgetMatches.find((match) => /бюджет/iu.test(match[0]));
  const hasStretchCue = /(?:^|[^\p{L}\p{N}])(?:если|но)(?=$|[^\p{L}\p{N}])|при\s+(?:сильн|интересн|стоящ)|посмотрю|рассмотр/iu.test(lower);
  const conditionalStretch = !explicitBudgetCorrection &&
    (budgetMatches.length >= 2 || (budgetMatches.length >= 1 && Boolean(unitlessStretchMatch))) &&
    hasStretchCue;
  const budgetMatch = explicitBudgetCorrection
    ? (budgetMatches.at(-1) || null)
    : conditionalStretch
      ? budgetMatches[0]
      : (contextualBudgetMatch || budgetMatches.at(-1) || null);
  const stretchMatch = conditionalStretch && budgetMatches.length >= 2 ? budgetMatches.at(-1)! : null;
  const isUnrealizedAssetGrowth =
    /(?:квартир|жиль|дом).{0,80}вырос\S*\s+(?:в\s+)?цен/iu.test(lower) &&
    /не\s+прода(?:вал|вала|вали|ю|ем)/iu.test(lower);
  const explicitlyBudgetContext = /(?:бюджет|общая\s*стоимость|весь\s*бюджет|максимальн\w*\s*сумм)/iu.test(lower);
  const nonBudgetMoneyContext = !explicitlyBudgetContext && (
    Boolean(explicitDownPaymentAmount) ||
    /(?:(?:цена|стоимость)\s+(?:за\s+)?(?:квадратн\p{L}*\s+)?метр|доходност\p{L}*|(?:арендн\p{L}*\s+)?доход\s+(?:за|в)\s+|выручк\p{L}*)/iu.test(lower)
  );
  const upperBoundMatch = !structuredBudget && !conditionalStretch && !hasStretchCue && lower.match(/(?:^|[^\p{L}\p{N}])(до|максимум|не\s+больше)\s*(\d+(?:[.,]\d+)?)\s*(млн|миллион(?:а|ов)?|млрд|тысяч(?:и)?|тыс|к)(?=$|[^\p{L}\p{N}])/iu);
  const lowerBoundMatch = !structuredBudget && !conditionalStretch && !hasStretchCue && lower.match(/(?:^|[^\p{L}\p{N}])(от|не\s+меньше)\s*(\d+(?:[.,]\d+)?)\s*(млн|миллион(?:а|ов)?|млрд|тысяч(?:и)?|тыс|к)(?=$|[^\p{L}\p{N}])/iu);
  if (structuredBudget && !nonBudgetMoneyContext && (!agentAskedDownPayment || explicitlyBudgetContext || Boolean(unitlessCorrectionRangeMatch))) {
    addFact('budget', 'budget', structuredBudget.value, structuredBudget.quote, 0.98, {
      isFlexible: structuredBudget.isFlexible,
      comment: structuredBudget.comment,
    });
  } else if (upperBoundMatch && !nonBudgetMoneyContext && (!agentAskedDownPayment || explicitlyBudgetContext)) {
    addFact('budget', 'budget', `До ${normalizedBudgetNumber(upperBoundMatch[2])} ${normalizedBudgetUnit(upperBoundMatch[3])}`, upperBoundMatch[0].trim(), 0.97, {
      isFlexible: false,
      comment: 'Клиент назвал только верхнюю границу бюджета.',
    });
  } else if (lowerBoundMatch && !nonBudgetMoneyContext && (!agentAskedDownPayment || explicitlyBudgetContext)) {
    addFact('budget', 'budget', `От ${normalizedBudgetNumber(lowerBoundMatch[2])} ${normalizedBudgetUnit(lowerBoundMatch[3])}`, lowerBoundMatch[0].trim(), 0.97, {
      isFlexible: false,
      comment: 'Клиент назвал только нижнюю границу бюджета.',
    });
  } else if (explicitCorrectedBudget && !nonBudgetMoneyContext && (!agentAskedDownPayment || explicitlyBudgetContext)) {
    addFact('budget', 'budget', explicitCorrectedBudget.value, explicitCorrectedBudget.quote, 0.99, {
      isFlexible: false,
      comment: 'Явная коррекция клиента: предыдущее значение бюджета отменено.',
    });
  } else if (budgetMatch && !isUnrealizedAssetGrowth && !nonBudgetMoneyContext && (!agentAskedDownPayment || explicitlyBudgetContext)) {
    const normalizeBudget = (match: RegExpMatchArray) => {
      const num = match[1].replace(',', '.');
      const unit = match[2];
      if (unit.startsWith('млрд')) return `${num} млрд руб`;
      if (unit.startsWith('тыс') || unit === 'к') return `${num} тыс руб`;
      return `${num} млн руб`;
    };
    const normalizedValue = normalizeBudget(budgetMatch);
    const inferredStretchValue = !stretchMatch && conditionalStretch && unitlessStretchMatch && /млн|миллион/iu.test(budgetMatch[2])
      ? `${unitlessStretchMatch[1].replace(/\s+/g, '')} млн руб`
      : null;
    const stretchValue = stretchMatch ? normalizeBudget(stretchMatch) : inferredStretchValue;
    const spokenBaseMatch = lower.match(/(?:но\s+)?(?:пока|ориентир|базов\p{L}*)[^.!?]{0,16}(?:около|примерно)?\s*(двадцати|тридцати|сорока|пятидесяти|шестидесяти|семидесяти|восьмидесяти|девяноста)(?:\s*млн)?/iu);
    const spokenBaseMap: Record<string, number> = {
      двадцати: 20, тридцати: 30, сорока: 40, пятидесяти: 50,
      шестидесяти: 60, семидесяти: 70, восьмидесяти: 80, девяноста: 90,
    };
    const isExplicitStretchCeiling = /(?:готов\p{L}*|мож\p{L}*)[^.!?]{0,24}(?:рассматрива\p{L}*|посмотр\p{L}*)[^.!?]{0,16}до\s*\d+/iu.test(lower);
    const isFlex =
      !explicitBudgetCorrection && (
      conditionalStretch ||
      isExplicitStretchCeiling ||
      Boolean(spokenBaseMatch) ||
      lower.includes('немного выше') ||
      lower.includes('при веском обосновании') ||
      lower.includes('гибк') ||
      lower.includes('посмотрю и') ||
      lower.includes('посмотрим'));

    const spokenBaseValue = spokenBaseMatch ? spokenBaseMap[spokenBaseMatch[1].toLowerCase()] : null;
    const finalValue = spokenBaseValue && isExplicitStretchCeiling
      ? `Ориентир ${spokenBaseValue} млн руб; до ${normalizedValue} при сильном варианте`
      : stretchValue && stretchValue !== normalizedValue
        ? `Ориентир ${normalizedValue}; до ${stretchValue} при сильном варианте`
        : isFlex
          ? `Около ${normalizedValue} (гибкий)`
          : normalizedValue;
    addFact('budget', 'budget', finalValue, budgetMatch[0].trim(), 0.95, {
      isFlexible: isFlex,
      comment: spokenBaseValue && isExplicitStretchCeiling
        ? `Базовый ориентир ${spokenBaseValue} млн руб; ${normalizedValue} — верхняя граница для сильного варианта`
        : stretchValue && stretchValue !== normalizedValue
          ? `Базовый ориентир ${normalizedValue}; расширение до ${stretchValue} при сильном варианте`
          : isFlex ? 'Может рассмотреть немного выше при веском обосновании' : undefined,
    });
  }

  // 2. Location extraction
  const locations: Array<{ name: string; regex: RegExp }> = [
    { name: 'Сириус', regex: /(?:^|[^\p{L}\p{N}])(сириус(?:е|а)?|sirius|в\s*сириусе|окрестност(?:и|ях)\s*сириуса)(?:[^\p{L}\p{N}]|$)/iu },
    { name: 'Сочи', regex: /(?:^|[^\p{L}\p{N}])(сочи|в\s*сочи)(?:[^\p{L}\p{N}]|$)/iu },
    { name: 'Адлер', regex: /(?:^|[^\p{L}\p{N}])(адлер|в\s*адлере)(?:[^\p{L}\p{N}]|$)/iu },
    { name: 'Красная Поляна', regex: /(?:^|[^\p{L}\p{N}])(красн(?:ая|ой)\s*полян(?:а|е|у))(?:[^\p{L}\p{N}]|$)/iu },
    { name: 'Дагомыс', regex: /(?:^|[^\p{L}\p{N}])(дагомыс|в\s*дагомысе)(?:[^\p{L}\p{N}]|$)/iu },
    { name: 'Хоста', regex: /(?:^|[^\p{L}\p{N}])(хост(?:а|е|у)|в\s*хосте)(?:[^\p{L}\p{N}]|$)/iu },
    { name: 'Анапа', regex: /(?:^|[^\p{L}\p{N}])(анап(?:а|е|у)|в\s*анапе)(?:[^\p{L}\p{N}]|$)/iu },
    { name: 'Геленджик', regex: /(?:^|[^\p{L}\p{N}])(геленджик|в\s*геленджике)(?:[^\p{L}\p{N}]|$)/iu },
    { name: 'Краснодар', regex: /(?:^|[^\p{L}\p{N}])(краснодар|в\s*краснодаре)(?:[^\p{L}\p{N}]|$)/iu },
  ];

  const positiveLocations: Array<{ name: string; quote: string }> = [];
  const locationRejected = (name: string): boolean => {
    const token = name === 'Красная Поляна' ? 'красн\w*\s+полян\w*'
      : name === 'Сириус' ? '(?:сириус\w*|sirius)'
      : name.toLocaleLowerCase('ru-RU');
    const before = new RegExp(`(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)[^.!?]{0,18}${token}`, 'iu');
    const after = new RegExp(`${token}[^.!?]{0,18}(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)`, 'iu');
    return before.test(lower) || after.test(lower);
  };
  for (const loc of locations) {
    const match = lower.match(loc.regex);
    if (!match || locationRejected(loc.name)) continue;
    positiveLocations.push({ name: loc.name, quote: match[1] || match[0].trim() });
  }
  if (positiveLocations.length === 1) {
    addFact('location', 'location', positiveLocations[0].name, positiveLocations[0].quote);
  } else if (positiveLocations.length > 1) {
    const names = Array.from(new Set(positiveLocations.map((item) => item.name)));
    addFact('location', 'location', names.join(' / '), positiveLocations[0].quote, 0.93);
  }

  // 3. Goal & Secondary Use Model
  // Positive residence must never be inferred from a negated mention such as
  // “переезжать на ПМЖ я не планирую”. Prefer explicit investment intent when
  // the client says the purchase is primarily an investment with occasional use.
  const explicitNoPermanentLiving = /(?:(?:не|точно\s+не)\s*(?:планиру\p{L}*|собира\p{L}*|хоч\p{L}*|буд\p{L}*)[^.!?]{0,35}(?:переезжа\p{L}*|жить\s+постоянно|пмж)|(?:переезжа\p{L}*|пмж|жить\s+постоянно)[^.!?]{0,45}(?:не\s*(?:планиру\p{L}*|собира\p{L}*|хоч\p{L}*|буд\p{L}*)))/iu.test(lower);
  const investmentIntent = classifyInvestmentIntent(lower);
  const investmentMatch = ['positive', 'mixed'].includes(investmentIntent) ? lower.match(
    /(?:смотр\p{L}*\s+как\s+вложени\p{L}*|скорее[^.!?]{0,20}вложени\p{L}*|(?:как|для)\s+(?:вложени\p{L}*|инвестици\p{L}*)|это\s+инвестици\p{L}*|хоч\p{L}*\s+сдава\p{L}*[^.!?]{0,30}(?:посуточно|в\s+аренду)|куда\s+(?:разумно\s+)?вложить|вложить\s+(?:часть\s+)?(?:денег|капитал)|чисто\s*под\s*инвестици\p{L}*|для\s*перепродажи|инвестиционн\p{L}*|сохранить\s+капитал)/iu
  ) : null;
  const personalVisitMatch = lower.match(
    /(?:(?:сам(?:ому)?|сами|мы)\s+(?:иногда|периодически)?\s*приезжа\p{L}*|(?:иногда|периодически)\s+сам(?:ому)?\s+приезжа\p{L}*|хотелось\s+бы\s+(?:и\s+)?сам(?:ому)?\s+(?:иногда\s+)?приезжа\p{L}*|приезжа\p{L}*\s+на\s+(?:пару|несколько|1-3|одну-две)\s+недел)/iu
  );
  const leisureMatch = lower.match(
    /(?:для\s*отдыха|сезонн(?:ое|ого|ом)?\s*проживан(?:ие|ия|ии)|приезжать\s+(?:на\s*)?(?:отдых|каникул)|на\s*каникулы|для\s*каникул|периодически\s*приезжать)/iu
  );

  const selfUseLivingMatches = Array.from(lower.matchAll(
    /(?:хоч\p{L}*\s+(?:(?:сам(?:ому)?|сама)\s+)?(?:там\s+)?жить(?:\s+(?:сам(?:ому)?|сама))?|(?:сам(?:ому)?|сама)\s+(?:там\s+)?буд\p{L}*\s+жить|для\s+себя[^.!?]{0,45}буд\p{L}*\s+(?:там\s+)?жить|буд\p{L}*\s+(?:там\s+)?жить[^.!?]{0,45}для\s+себя)/giu
  ));
  const permanentLivingMatches = explicitNoPermanentLiving ? [] : Array.from(
    lower.matchAll(/(?:для\s*(?:постоянной\s*)?жизни|для\s*постоянного\s*проживания|постоянно\s*жить|жить\s+постоянно|буд(?:у|ем)\s+жить(?:\s+(?:сам(?:ому)?|сама))?\s+постоянно|переезжа(?:ем|ть)|переезд|пмж)/giu)
  );
  const positiveLivingMatch = (matches: RegExpMatchArray[]) => matches.find((match) => {
    const startIndex = match.index || 0;
    const before = lower.slice(Math.max(0, startIndex - 55), startIndex);
    const after = lower.slice(startIndex + match[0].length, startIndex + match[0].length + 65);
    return !(
      /(?:^|[^\p{L}\p{N}])не\s*$/iu.test(before) ||
      /не\s+(?:хоч\p{L}*|планиру\p{L}*|собира\p{L}*|буд\p{L}*|рассматрива\p{L}*)[^.!?]{0,15}$/iu.test(before) ||
      /^\s*[^.!?]{0,35}не\s+(?:хоч\p{L}*|планиру\p{L}*|собира\p{L}*|буд\p{L}*|рассматрива\p{L}*)/iu.test(after)
    );
  }) || null;
  const permanentLivingMatch = positiveLivingMatch(permanentLivingMatches);
  const selfUseLivingMatch = positiveLivingMatch(selfUseLivingMatches);

  const addUnresolvedSelfUse = (quote: string, confidence = 0.95) => {
    const extra = { needsClarification: true };
    addFact('goal_primary', 'primaryGoal', 'Для себя (формат уточняется)', quote, confidence, extra);
    addFact('goal', 'goal', 'Для себя (формат уточняется)', quote, confidence, extra);
  };

  if (investmentMatch) {
    const mixedPersonal = Boolean(personalVisitMatch || leisureMatch || selfUseLivingMatch);
    addFact('goal_primary', 'primaryGoal', 'Инвестиции', investmentMatch[0].trim());
    addFact(
      'goal',
      'goal',
      mixedPersonal ? 'Инвестиции + периодическое личное использование' : 'Инвестиции',
      investmentMatch[0].trim(),
      0.97
    );
    if (mixedPersonal) {
      addFact(
        'goal_secondary',
        'secondaryUse',
        'Периодические личные приезды / отдых',
        (personalVisitMatch || leisureMatch || selfUseLivingMatch)![0].trim(),
        0.94
      );
    }
  } else if (permanentLivingMatch) {
    addFact('goal_primary', 'primaryGoal', 'Постоянное личное проживание', permanentLivingMatch[0].trim());
    addFact('goal', 'goal', 'Постоянное личное проживание', permanentLivingMatch[0].trim());
  } else if (selfUseLivingMatch) {
    addUnresolvedSelfUse(selfUseLivingMatch[0].trim());
  } else if (leisureMatch || personalVisitMatch) {
    const leisureQuote = (leisureMatch || personalVisitMatch)![0].trim();
    addFact('goal_primary', 'primaryGoal', 'Отдых и сезонное проживание', leisureQuote);
    addFact('goal', 'goal', 'Отдых и сезонное проживание', leisureQuote);
  } else {
    const forMyselfUsageMatch = lower.match(
      /(?:(?:ищу|покупа\p{L}*|беру|рассматрива\p{L}*|выбира\p{L}*|нужн\p{L}*)[^.!?]{0,35}для\s+себя|для\s+себя[^.!?]{0,35}(?:ищу|покупа\p{L}*|беру|рассматрива\p{L}*|выбира\p{L}*|недвижимост\p{L}*|объект\p{L}*))/iu
    );
    const agentAskedUsage = /(?:для\s+себя|для\s+кого|как\s+планиру\p{L}*\s+использ|цель\s+покупк|для\s+чего)/iu.test(previousAgentLower);
    if (hasPhrase(lower, 'для себя') && !explicitNoPermanentLiving && (forMyselfUsageMatch || agentAskedUsage)) {
      addUnresolvedSelfUse('для себя', 0.9);
    }
  }

  // Secondary use: rental during absence.
  const rentalMatch = lower.match(
    /(?:иногда\s*сдавать|возможност\p{L}*\s*(?:иногда\s*)?сдавать|сдавать\s*(?:можно|можно\s+было|в\s+аренду)|можно\s+(?:было\s+)?сдавать|сдавать,?\s*если\s*я\s*уезжаю|сдавать\s*во\s*время\s*отсутствия)/iu
  );
  if (rentalMatch) {
    addFact('goal_secondary', 'secondaryUse', 'Периодическая сдача во время отсутствия', rentalMatch[0].trim());
  }


  // Shared semantic evidence layer: one meaning -> one normalized fact regardless
  // of the exact wording used by the client.
  for (const criterion of extractSemanticCriteria(trimmed)) {
    addFact('criteria', 'clientCriteria', criterion.label, criterion.evidenceQuote, 0.94);
  }

  const searchExperience = detectSearchExperience(trimmed);
  if (searchExperience) {
    addFact('searchExperience', 'searchExperience', searchExperience.value, searchExperience.evidenceQuote, 0.94);
  }

  const fundsAvailability = detectFundsAvailability(trimmed, previousAgentTurnText || '');
  if (fundsAvailability) {
    addFact('downPayment', 'downPayment', fundsAvailability.value, fundsAvailability.evidenceQuote, 0.94, {
      needsClarification: fundsAvailability.needsClarification,
      comment: fundsAvailability.comment,
    });
  }

  // 4. Payment Method & Financing
  const mortgageMention = lower.match(/(?:ипотек\p{L}*|ипотечн\p{L}*\s+кредит\p{L}*)/iu);
  const installmentMatch = lower.match(/(?:рассрочк\p{L}*|в\s*рассрочку)/iu);
  const downPaymentOwnFundsContext = /(?:первоначальн\p{L}*|перв\p{L}*)\s+(?:взнос\p{L}*|плат[её]ж\p{L}*)/iu.test(lower);
  const paymentUndecided = /(?:способ\s+оплаты|схем\p{L}*|вариант\p{L}*)[^.!?]{0,45}(?:ещ[её]\s+|пока\s+)?не\s+(?:решил\p{L}*|выбрал\p{L}*|определил\p{L}*)|(?:возможн\p{L}*|может\s+быть)[^.!?]{0,25}ипотек\p{L}*|ипотек\p{L}*[^.!?]{0,35}(?:пока\s+)?не\s+решил\p{L}*/iu.test(lower);
  const cashMatch = lower.match(
    /(?:наличн\p{L}*|расч[её]т\s*наличными|100%\s*оплат\p{L}*|сво(?:и|их|ими)\s+(?:средств\p{L}*|деньг\p{L}*)|собственн\p{L}*\s+средств\p{L}*|со\s+своего\s+сч[её]та|банковск\p{L}*\s+перевод\p{L}*|деньг\p{L}*\s+на\s+покупк\p{L}*\s+есть|заплач\p{L}*\s+сразу|без\s+кредит\p{L}*|(?:куп\p{L}*|покуп\p{L}*|оплат\p{L}*|бер\p{L}*)[^.!?]{0,32}за\s+свои(?:\s+(?:средств\p{L}*|деньг\p{L}*))?)/iu
  );

  // "Не только ипотека" keeps mortgage in a mixed scheme; it is not a rejection.
  const mortgageStillIncluded = /не\s+только\s+ипотек\p{L}*/iu.test(lower);
  const explicitMortgageNegative = !mortgageStillIncluded && lower.match(
    /(?:(?:^|[^\p{L}\p{N}])(?:(?:не\s*(?:нужн\p{L}*|планиру\p{L}*|хоч\p{L}*|буд\p{L}*|рассматрива\p{L}*|собира\p{L}*|подходит|интересует|люблю)|без)\s*ипотек\p{L}*)|(?:^|[^\p{L}\p{N}])ипотечн\p{L}*\s+вариант\p{L}*[^.!?]{0,35}не\s+рассматрива\p{L}*|(?:^|[^\p{L}\p{N}])ипотек\p{L}*[^.!?]{0,35}(?:не\s*(?:нужн\p{L}*|интересн\p{L}*|подходит|хоч\p{L}*|рассматрива\p{L}*|собира\p{L}*)|отпал\p{L}*)|(?:^|[^\p{L}\p{N}])не\s+ипотек\p{L}*(?:\s*,?\s*а|(?=$|[^\p{L}\p{N}]))|(?:кредит\p{L}*[^.!?]{0,25})?ипотек\p{L}*[^.!?]{0,25}не\s+подход\p{L}*)/iu
  );
  const installmentNegative = Boolean(
    installmentMatch && /(?:рассрочк\p{L}*\s+(?:мне\s+)?(?:не\s+(?:нужн\p{L}*|подход\p{L}*|рассматрива\p{L}*)|неинтересн\p{L}*)|не\s+(?:нужн\p{L}*|интересн\p{L}*|рассматрива\p{L}*)\s+(?:мне\s+)?рассрочк\p{L}*)/iu.test(lower)
  );

  // Stating they didn't use mortgage in the past (e.g. "ипотекой раньше не пользовался")
  const pastExperienceNegation = !explicitMortgageNegative && lower.match(
    /(?:ипотек(?:ой)?\s*(?:раньше|никогда)?\s*не\s*(?:пользовал(?:ся|ись|ась)|брал(?:и)?))/iu
  );

  // Positive intent (e.g. "хочу купить в ипотеку", "в ипотеку", "рассматриваю вариант ипотека")
  const mortgageIntentMatch = !explicitMortgageNegative && lower.match(
    /(?:в\s*ипотеку|под\s*ипотеку|(?:^|[^\wа-яё])хочу\s*(?:купить\s*)?(?:в\s*)?ипотеку|буду\s+(?:брать\s+)?(?:в\s*)?ипотеку|купим\s*(?:в\s*)?ипотеку|планиру\p{L}*[^.!?]{0,18}(?:оформить\s+)?ипотечн\p{L}*\s+кредит\p{L}*|планируем\s*(?:в\s*)?ипотеку|через\s*ипотеку|с\s*помощью\s*ипотеки|оформ(?:ить|ляем|им|ляю)\s*ипотеку|рассчитыва\p{L}*\s+на\s+(?:семейн\p{L}*\s+)?ипотек\p{L}*|ипотек\p{L}*\s*(?:рассматрива\p{L}*|подходит|нужна|одобрен\p{L}*)|(?:рассматрива\p{L}*\s*(?:вариант\s*)?)ипотек\p{L}*|ипотечн\p{L}*\s+(?:кредит\p{L}*|кредитование))/iu
  );

  const mortgageNegationMatch = explicitMortgageNegative || (pastExperienceNegation && !mortgageIntentMatch);
  const genericMortgageMatch = !mortgageNegationMatch && !paymentUndecided && mortgageMention;
  const mixedOwnMortgage = Boolean(
    mortgageMention && !downPaymentOwnFundsContext && (
      /(?:часть[^.!?]{0,35}(?:сво\p{L}*|средств\p{L}*)[^.!?]{0,45}(?:остальн\p{L}*|ипотек\p{L}*)|(?:остальн\p{L}*|часть\s+прид[её]тся)[^.!?]{0,35}ипотек\p{L}*|не\s+только\s+ипотек\p{L}*[^.!?]{0,55}часть[^.!?]{0,25}(?:сво\p{L}*|средств\p{L}*))/iu.test(lower)
    )
  );
  const financingAlternatives = Boolean(
    mortgageMention && installmentMatch && !installmentNegative &&
    /(?:сравнива\p{L}*|выбира\p{L}*|решени\p{L}*[^.!?]{0,25}не\s+приня\p{L}*|пока\s+не\s+решил\p{L}*)/iu.test(lower)
  );
  const explicitFullCash = Boolean(
    cashMatch && !sourceContext && !downPaymentOwnFundsContext && !paymentUndecided && (
      /(?:всю|полностью|целиком|100%)[^.!?]{0,40}(?:сумм\p{L}*|оплат\p{L}*|за\s+свои|собственн\p{L}*\s+средств\p{L}*)|(?:куп\p{L}*|покуп\p{L}*|оплат\p{L}*)[^.!?]{0,35}(?:за\s+свои|собственн\p{L}*\s+средств\p{L}*|со\s+своего\s+сч[её]та)|(?:без\s+кредит\p{L}*|кредит\p{L}*\s+не\s+понадоб\p{L}*)|банковск\p{L}*\s+перевод\p{L}*|заплач\p{L}*\s+сразу|не\s+ипотек\p{L}*[^.!?]{0,25}а[^.!?]{0,30}(?:сво\p{L}*|наличн\p{L}*)|ипотек\p{L}*\s+отпал\p{L}*[^.!?]{0,45}(?:сво\p{L}*|собственн\p{L}*)|наличн\p{L}*|100%\s*оплат\p{L}*/iu.test(lower)
    )
  );

  if (financingAlternatives) {
    addFact('paymentMethod', 'paymentMethod', 'Ипотека / рассрочка (схема не выбрана)', trimmed, 0.94, { needsClarification: true });
  } else if (mixedOwnMortgage) {
    addFact('paymentMethod', 'paymentMethod', 'Смешанная схема: собственные средства + ипотека', trimmed, 0.97);
  } else if (downPaymentOwnFundsContext && mortgageMention && !mortgageNegationMatch) {
    addFact('paymentMethod', 'paymentMethod', 'Ипотека', mortgageMention[0]);
  } else if (cashMatch && explicitFullCash && (!mortgageMention || mortgageNegationMatch)) {
    addFact('paymentMethod', 'paymentMethod', /сво|собствен/iu.test(cashMatch[0]) ? 'Собственные средства (100% оплата)' : 'наличные', cashMatch[0]);
  } else if (installmentMatch && !installmentNegative && (mortgageNegationMatch || !mortgageMention)) {
    addFact('paymentMethod', 'paymentMethod', 'Рассрочка', installmentMatch[0]);
  } else if (paymentUndecided && mortgageMention) {
    addFact('paymentMethod', 'paymentMethod', 'Ипотека рассматривается; решение не принято', trimmed, 0.9, { needsClarification: true });
  } else if (mortgageIntentMatch && installmentMatch && !installmentNegative) {
    addFact('paymentMethod', 'paymentMethod', 'Ипотека / рассрочка (допустимы оба варианта)', trimmed, 0.94, { needsClarification: true });
  } else if (mortgageIntentMatch) {
    addFact('paymentMethod', 'paymentMethod', 'Ипотека', mortgageIntentMatch[0]);
  } else if (genericMortgageMatch && !mortgageNegationMatch) {
    addFact('paymentMethod', 'paymentMethod', 'Ипотека', genericMortgageMatch[0]);
  } else if (installmentMatch && !installmentNegative) {
    addFact('paymentMethod', 'paymentMethod', 'Рассрочка', installmentMatch[0]);
  }

  // Financial Priority (Comfortable Monthly Payment)
  const paymentPriorityMatch = lower.match(/(?:ежемесячный\s*платеж|комфортный\s*платеж|платеж\s*важнее|размер\s*платежа)/iu);
  if (paymentPriorityMatch) {
    addFact('finances', 'financialPriority', 'Комфортный ежемесячный платёж', paymentPriorityMatch[0]);
  }

  // Contextual initial payment: a short client answer like "15 миллионов" or "30%"
  // counts only when Andrei has just asked about the down payment.
  if (agentAskedDownPayment && !explicitDownPaymentAmount) {
    const downPaymentMoneyMatch = lower.match(
      /(\d+(?:[.,]\d+)?)\s*(млн|миллион(?:а|ов)?|тысяч(?:и)?|тыс)(?:\s*(?:руб(?:лей|ля)?|₽))?/iu
    );
    const downPaymentPercentMatch = lower.match(/(\d{1,3})\s*%/u);
    if (downPaymentMoneyMatch) {
      const amount = downPaymentMoneyMatch[1].replace(',', '.');
      const unit = downPaymentMoneyMatch[2].startsWith('тыс') ? 'тыс руб' : 'млн руб';
      addFact('downPayment', 'downPayment', `${amount} ${unit}`, downPaymentMoneyMatch[0].trim(), 0.98);
    } else if (downPaymentPercentMatch) {
      addFact('downPayment', 'downPayment', `${downPaymentPercentMatch[1]}%`, downPaymentPercentMatch[0], 0.98);
    }
  }

  const savingsSourceMatch = lower.match(
    /(?:из\s*(?:личных\s*)?(?:накоплений|сбережений)|накоплени(?:я|й)|сбережени(?:я|й)|сво(?:и|их|ими)\s+(?:средств\p{L}*|деньг\p{L}*)|собственн\p{L}*\s*средств\p{L}*|деньги\s*на\s*руках)/iu
  );
  const assetSaleSourceMatch = lower.match(
    /(?:из\s*продажи\s*(?:актива|активов|квартиры|недвижимости)|продам\s*(?:актив|активы|квартиру|недвижимость)|после\s*продажи\s*(?:актива|активов|квартиры|недвижимости))/iu
  );
  if (assetSaleSourceMatch) {
    addFact('downPaymentSource', 'downPaymentSource', 'Продажа актива / недвижимости', assetSaleSourceMatch[0], 0.97);
  } else if (savingsSourceMatch) {
    addFact('downPaymentSource', 'downPaymentSource', 'Личные накопления / свободные средства', savingsSourceMatch[0], 0.97);
  }

  // 5. Family & Children (Family Mortgage eligibility check)
  const adultChildren = detectAdultChildren(trimmed);
  const childAgeToken = '(?:1[0-7]|[0-9]|семнадцать|шестнадцать|пятнадцать|четырнадцать|тринадцать|двенадцать|одиннадцать|десять|девять|восемь|семь|шесть|пять|четыре|три|два|две|один|одна)';
  const childAgeMatch = lower.match(new RegExp(
    `(?:(?:реб[её]н(?:ок|ку|ка|ком)|сын(?:у|а)?|дочер(?:и|ь)|дочк(?:е|а|у))(?:(?:[^.!?]{0,24}?(?:ему|ей)\\s*(?:уже\\s*)?(${childAgeToken})(?=$|[^\\p{L}\\p{N}]))|(?:\\s+(?:уже\\s*)?(${childAgeToken})\\s*(?:год(?:а)?|лет)))|(?:оговорил(?:ся|ась)|поправлю|точнее)[^.!?]{0,30}?(?:ему|ей)\\s*(?:уже\\s*)?(${childAgeToken})(?=$|[^\\p{L}\\p{N}]))`,
    'iu'
  ));
  const childAgeRaw = childAgeMatch?.[1] || childAgeMatch?.[2] || childAgeMatch?.[3] || null;
  const childAgeIsRange = /(?:реб[её]н(?:ок|ку|ка)|дети|сыну|дочери).{0,20}(?:меньше|младше|до|еще нет|ещё нет)\s*(?:7|семи)(?:\s*лет)?/iu.test(lower);
  const childAge = childAgeRaw && !childAgeIsRange ? parseBudgetNumber(childAgeRaw) : null;
  const hypotheticalChildReference = /(?:возможн\p{L}*|может\s+быть)[^.!?]{0,70}(?:покуп\p{L}*|оформ\p{L}*)[^.!?]{0,35}на\s+(?:дочь|сына|реб[её]нка)|(?:покуп\p{L}*|оформ\p{L}*)[^.!?]{0,35}на\s+(?:дочь|сына|реб[её]нка)[^.!?]{0,55}пока\s+не\s+решил\p{L}*/iu.test(lower);
  // Scoped negation: "детей до 7 лет нет" is specific to the under-7 eligibility, not proof of having no kids at all
  const noChildUnder7Match = lower.match(
    /(?:(?:нет|нету|без)\s*(?:маленьких\s*)?детей\s*(?:до\s*(?:7|семи)\s*(?:лет|года)?)|детей\s*(?:до\s*(?:7|семи)\s*(?:лет|года)?)\s*(?:у\s*нас\s*)?(?:пока\s*)?нет)/iu
  );
  // General negation: client explicitly has no children
  const noChildrenMatch = !noChildUnder7Match && lower.match(
    /(?:(?:нет|нету|без)\s*детей|детей\s*(?:у\s*нас\s*)?(?:пока\s*)?нет|нет\s*реб[её]нка|без\s*реб[её]нка)/iu
  );
  // Explicit positive evidence of child under 7: must be bound to child words, not loan terms like "рассрочка до 7 лет" or infrastructure like "детский сад"
  const childAgeRangeMatch = lower.match(/(?:реб[её]н(?:ок|ку|ка)|дети|сыну|дочери).{0,20}(?:меньше|младше|до|еще нет|ещё нет)\s*(?:7|семи)(?:\s*лет)?/iu);
  const childUnder7Match = !noChildUnder7Match && !noChildrenMatch && lower.match(
    /(?:(?:реб[её]нк(?:у|а)?|дет(?:ям|ей|и)|сыну|дочер(?:и|ь)|дочк(?:е|а|у))\s*(?:до\s*7\s*(?:лет|года)?|[1-6]\s*(?:год(?:а)?|лет))|(?:до\s*7\s*(?:лет|года)?|[1-6]\s*(?:год(?:а)?|лет))\s*(?:реб[её]нк(?:у|а)?|дет(?:ям|ей|и)|сыну|дочер(?:и|ь)|дочк(?:е|а|у))|маленьк(?:ие|их)\s*дет(?:и|ей)|малыш|(?:есть\s+)?(?:реб[её]нок|дети)\s+до\s*7\s*(?:лет|года)?)/iu
  );
  // Generic children mentioned (without verified age)
  const childGenericMatch = !hypotheticalChildReference && !noChildUnder7Match && !noChildrenMatch && childAge == null && !childUnder7Match && lower.match(
    /(?:есть\s+(?:реб[её]нок|дети)|реб[её]нок|реб[её]нка|реб[её]нку|дет(?:и|ей)|сыну|дочери|сын|дочь)/iu
  );

  if (noChildUnder7Match) {
    addFact(
      'familyMortgage',
      'familyMortgage',
      'Нет детей до 7 лет (семейная ипотека по возрасту детей не применима)',
      noChildUnder7Match[0],
      0.95,
      { status: 'confirmed', needsClarification: false }
    );
  } else if (noChildrenMatch) {
    // Explicit negative fact: children absent
    addFact(
      'familyMortgage',
      'familyMortgage',
      'Детей нет (семейная ипотека не применима)',
      noChildrenMatch[0],
      0.95,
      { status: 'confirmed', needsClarification: false }
    );
  } else if (childAge != null && childAgeMatch) {
    addFact(
      'familyMortgage',
      'familyMortgage',
      childAge < 7
        ? 'Есть ребёнок подходящего возраста (до 7 лет, подходит под условия семейной ипотеки)'
        : `Есть ребёнок ${childAge} лет (семейная ипотека по возрасту ребёнка не применима)`,
      childAgeMatch[0],
      0.98,
      { status: 'confirmed', needsClarification: false }
    );
  } else if (adultChildren) {
    addFact(
      'familyMortgage',
      'familyMortgage',
      adultChildren.value,
      adultChildren.evidenceQuote,
      0.98,
      { status: 'confirmed', needsClarification: false }
    );
  } else if (childUnder7Match || childAgeRangeMatch) {
    addFact(
      'familyMortgage',
      'familyMortgage',
      'Есть ребёнок подходящего возраста (до 7 лет, подходит под условия семейной ипотеки)',
      (childUnder7Match || childAgeRangeMatch)![0],
      0.95,
      { status: 'confirmed', needsClarification: false }
    );
  } else if (childGenericMatch) {
    // Children present but age unknown -> do NOT assert program eligibility without age check
    addFact(
      'familyMortgage',
      'familyMortgage',
      'Есть дети (возраст не уточнён, требуется проверка условий программы)',
      childGenericMatch[0],
      0.9,
      { status: 'confirmed', needsClarification: true }
    );
  }

  // 6. Employment (Requirement 5 & 8: Whole-word / phrase matching, "ипотека" != "ИП")
  const employmentMatch = lower.match(/(?:по\s*найму|в\s*найме|работаю\s*по\s*найму|в\s*компании|официальн(?:о|ое)\s*трудоустройство|официально\s*трудоустроен(?:а)?)/iu);
  const ipExplicitlyNegative = /(?:не\s*(?:являюсь|зарегистрирован(?:а)?|работаю\s*как)\s*)?ип\s*(?:у\s*меня\s*)?нет|никак(?:ого|их)\s+ип|без\s+ип|ип\s+не\s+(?:оформлен|зарегистрирован)/iu.test(lower);
  const businessExplicitlyNegative = /(?:ооо|бизнес)\s*(?:у\s*меня\s*)?нет|никак(?:ого|их)\s+(?:ооо|бизнеса)/iu.test(lower);
  if (employmentMatch) {
    addFact('finances', 'employment', 'Работа по найму', employmentMatch[0]);
  } else if ((!ipExplicitlyNegative && hasWholeWord(lower, 'ип')) || (!businessExplicitlyNegative && (hasPhrase(lower, 'свой бизнес') || hasPhrase(lower, 'собственный бизнес')))) {
    const ipQuote = hasWholeWord(lower, 'ип') ? 'ип' : 'свой бизнес';
    addFact('finances', 'employment', 'Индивидуальный предприниматель (ИП)', ipQuote);
  }

  // 7. Decision Makers (Requirement 5 & 6: Never fabricate "с женой" from "важен" or "предложений")
  const decisionMaker = detectDecisionMaker(trimmed);
  if (decisionMaker) {
    addFact('decision_makers', 'decisionMakers', decisionMaker.value, decisionMaker.evidenceQuote, 0.97);
  }

  // 8. Property Type (Whole-word / phrase matching, "рядом" != "дом")
  const isNegatedPropertyMention = (index: number, length: number): boolean => {
    const before = lower.slice(Math.max(0, index - 45), index);
    const after = lower.slice(index + length, index + length + 45);
    // A positive cue immediately before the noun belongs to that noun and must
    // not inherit a negation from an earlier alternative: "дом не хочу, нужна квартира".
    const hasPositiveCue = /(?:нужн(?:а|о|ы|ен)|хоч(?:у|ем)|рассматрива(?:ю|ем)|подход(?:ит|ят))\s*$/iu.test(before);
    const hasNegatedCue = /не\s+(?:хоч(?:у|ем)|рассматрива(?:ю|ем)|нужн(?:а|о|ы|ен)|подход(?:ит|ят))\s*$/iu.test(before);
    if (hasPositiveCue && !hasNegatedCue) {
      return false;
    }
    return (
      /(?:не\s+(?:хочу|рассматрива(?:ю|ем)|нуж(?:ен|на|ны)|подход(?:ит|ят))|без|исключа(?:ю|ем))\s*(?:\S+\s*){0,2}$/iu.test(before) ||
      /^\s*(?:(?:мне|я|мы)\s+)?(?:вообще\s+|точно\s+)?не\s+(?:хочу|рассматрива(?:ю|ем)|нуж(?:ен|на|ны)|подход(?:ит|ят))/iu.test(after)
    );
  };
  const flatMatches = Array.from(
    lower.matchAll(/(?:квартир(?:а|у|ы|е|ой|ам|ами|ах)?|апартамент(?:ы|ов|ам|ами|ах|е)?|студи(?:я|ю|и|ей))/giu)
  );
  const positiveFlatMatches = flatMatches.filter(
    (match) => !isNegatedPropertyMention(match.index, match[0].length)
  );
  const flatMatch = positiveFlatMatches[0] || null;
  const hasPositiveApartment = positiveFlatMatches.some((match) => match[0].toLowerCase().startsWith('апарт'));
  const hasPositiveFlat = positiveFlatMatches.some((match) => match[0].toLowerCase().startsWith('квартир'));
  const explicitHouseMatch = lower.match(/(?:коттедж(?:ей|а)?|вилл(?:а|у)|таунхаус(?:а)?)/iu);
  const homeToken = lower.match(/(?:^|[^\p{L}\p{N}])(дом)(?=$|[^\p{L}\p{N}])/iu);
  const homeIndex = homeToken
    ? (homeToken.index || 0) + homeToken[0].lastIndexOf(homeToken[1])
    : -1;
  const houseMatch = explicitHouseMatch && !isNegatedPropertyMention(explicitHouseMatch.index || 0, explicitHouseMatch[0].length)
    ? explicitHouseMatch
    : homeToken && !hasPhrase(lower, 'рядом') && !isNegatedPropertyMention(homeIndex, homeToken[1].length)
      ? ({ 0: 'дом' } as any)
      : null;

  const rejectedHouseMatch = lower.match(
    /(?:(?:дом|коттедж|вилл(?:а|у)|таунхаус)\w*[^.!?]{0,22}(?:не\s*(?:нужен|нужно|интересует|рассматрива(?:ю|ем)|хочу|подходит)|исключа(?:ю|ем))|(?:не\s*(?:нужен|нужно|интересует|рассматрива(?:ю|ем)|хочу|подходит)|исключа(?:ю|ем))[^.!?]{0,24}(?:дом|коттедж|вилл(?:у|а)|таунхаус))/iu
  );
  if (rejectedHouseMatch) {
    addFact('property_constraint', 'propertyTypeConstraint', 'Дом исключён', rejectedHouseMatch[0].trim(), 0.99);
  }

  const propertyTypeQuestionContext = /(?:формат жилья|квартир|апартамент|дом|тип недвижимости|что рассматриваете)/iu.test(previousAgentLower);
  const residentialComplexMatch = lower.match(/(?:жил(?:ой|ом)\s+комплекс(?:е|а)?|жк)(?:$|[^\p{L}\p{N}])/iu);
  const genericMarketPropertyMention = /(?:сегмент(?:е|а)|рынок|доходност|загрузк|аналитик|источник)/iu.test(lower) && !propertyTypeQuestionContext;

  if (!genericMarketPropertyMention && propertyTypeQuestionContext && residentialComplexMatch && !flatMatch && !houseMatch) {
    addFact('property_type', 'propertyType', 'Квартира в жилом комплексе', residentialComplexMatch[0].trim());
  } else if (!genericMarketPropertyMention && houseMatch && flatMatch) {
    addFact('property_type', 'propertyType', 'Дом или квартира (допустимы оба формата)', `${flatMatch[0]}, ${houseMatch[0]}`);
  } else if (!genericMarketPropertyMention && houseMatch) {
    addFact('property_type', 'propertyType', 'Дом / Коттедж', houseMatch[0]);
  } else if (!genericMarketPropertyMention && hasPositiveApartment && hasPositiveFlat) {
    const firstIndex = positiveFlatMatches[0].index ?? 0;
    const lastPositive = positiveFlatMatches.at(-1)!;
    const lastEnd = (lastPositive.index ?? firstIndex) + lastPositive[0].length;
    const exactQuote = trimmed.slice(firstIndex, lastEnd);
    addFact('property_type', 'propertyType', 'Квартира / апартаменты', exactQuote);
  } else if (!genericMarketPropertyMention && flatMatch) {
    addFact('property_type', 'propertyType', flatMatch[0].toLowerCase().startsWith('апарт') ? 'Апартаменты' : 'Квартира', flatMatch[0]);
  }

  // 9. Timeline. Preserve relative direction/range in the scalar value instead
  // of reducing "не раньше", "максимум" or "где-то" to an exact duration.
  const timelineMatch = lower.match(
    /(?:(?:не\s+раньше\s+чем|максимум)\s+через\s+(?:полгода|(?:\d+|один|одного|два|две|двух|три|тр[её]х|четыре|четыр[её]х)(?:\s*[-–—]\s*(?:\d+|два|две|двух|три|тр[её]х|четыре|четыр[её]х))?\s*месяц(?:а|ев)?)|(?:(?:где-то|примерно|ориентировочно|приблизительно)\s+)?(?:в\s+течение|через)\s+(?:полгода|(?:\d+|один|одного|два|две|двух|три|тр[её]х|четыре|четыр[её]х)(?:\s*[-–—]\s*(?:\d+|два|две|двух|три|тр[её]х|четыре|четыр[её]х))?\s*месяц(?:а|ев)?)|пара\s*месяцев|пару\s*месяцев|в\s*течение\s*пары\s*месяцев|(?:2|два)[-–—\s]*(?:3|три)\s*месяц(?:а|ев)?|к\s*лету|в\s*течение\s*месяца|до\s+(?:конца\s+года|нового\s+года)|(?:^|[^\p{L}\p{N}])срочно(?:[^\p{L}\p{N}]|$)|не\s*к\s*спеху|(?:до|к)\s*(?:концу\s*)?(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)|(?:в|на)\s*(?:январе|феврале|марте|апреле|мае|июне|июле|августе|сентябре|октябре|ноябре|декабре))/iu
  );
  if (timelineMatch) {
    const timelineQuote = timelineMatch[0].trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const timelineValue = timelineQuote
      .replace(/(^|[^\p{L}])(?:двух|два|две)(?=$|[^\p{L}])/giu, (_match, prefix: string) => `${prefix}2`)
      .replace(/(^|[^\p{L}])(?:тр[её]х|три)(?=$|[^\p{L}])/giu, (_match, prefix: string) => `${prefix}3`)
      .replace(/(^|[^\p{L}])(?:четыр[её]х|четыре)(?=$|[^\p{L}])/giu, (_match, prefix: string) => `${prefix}4`);
    const isFlexibleTimeline = /(?:где-то|примерно|ориентировочно|приблизительно)/iu.test(timelineQuote);
    const boundaryComment = /не\s+раньше\s+чем/iu.test(timelineQuote)
      ? 'Нижняя граница срока; не трактовать как точную дату.'
      : /максимум/iu.test(timelineQuote)
        ? 'Верхняя граница срока; не трактовать как точную дату.'
        : isFlexibleTimeline
          ? 'Ориентировочный срок; неопределённость сохранена.'
          : undefined;
    addFact('timeline', 'purchaseTimeline', timelineValue, timelineQuote, 0.95, {
      isFlexible: isFlexibleTimeline,
      comment: boundaryComment,
    });
  }

  if (explicitDownPaymentAmount) {
    const amount = explicitDownPaymentAmount.amount.replace(',', '.');
    const rawUnit = explicitDownPaymentAmount.unit;
    const value = rawUnit === '%'
      ? `${amount}%`
      : rawUnit.startsWith('тыс')
        ? `${amount} тыс руб`
        : rawUnit.startsWith('руб')
          ? `${amount} руб`
          : `${amount} млн руб`;
    addFact('downPayment', 'downPayment', value, explicitDownPaymentAmount.quote, 0.98, {
      comment: 'Клиент явно назвал сумму первоначального взноса.',
    });
  }

  // 10. Criteria: Reliability / Transparency
  if (lower.includes('надежност') || lower.includes('надёжност') || lower.includes('прозрачност')) {
    const quote = lower.includes('надёжность')
      ? 'надёжность'
      : lower.includes('надежность')
      ? 'надежность'
      : 'прозрачность';
    addFact('criteria', 'clientCriteria', 'Надёжность и прозрачность сделки', quote);
  }

  const seaPreferenceMatch = lower.match(
    /(?:близост[а-яё]*\s*к\s*морю|рядом\s*с\s*морем|недалеко\s*от\s*моря|у\s*моря|море[^.!?]{0,24}(?:бонус|важн|желатель))/iu
  );
  if (seaPreferenceMatch) {
    addFact(
      'criteria',
      'clientCriteria',
      'Близость к морю / пляжу',
      seaPreferenceMatch[0].trim(),
      0.94,
      { comment: 'Клиент обозначил море как предпочтение; не повышать до обязательного критерия без подтверждения.' }
    );
  }

  // 11. Contextual agreedNextStep (e.g. Agent: "Видеопоказ завтра в 15:00 удобно?" -> Client: "Да")
  // Check polite agreement idioms (e.g., "нет проблем, завтра в 15:00 удобно", "без проблем", "нет вопросов")
  const isPoliteAgreement =
    hasPhrase(lower, 'нет проблем') ||
    hasPhrase(lower, 'без проблем') ||
    hasPhrase(lower, 'нет вопросов') ||
    hasPhrase(lower, 'не проблема');

  // Check if client explicitly rejects the proposed meeting/step (e.g. "да нет", "не подходит", "не удобно", "не смогу", "не надо", "нет")
  const isNegativeNextStep =
    hasPhrase(lower, 'да нет') ||
    hasPhrase(lower, 'не подходит') ||
    hasPhrase(lower, 'не удобно') ||
    hasPhrase(lower, 'не смогу') ||
    hasPhrase(lower, 'не нужно') ||
    hasPhrase(lower, 'не надо') ||
    hasAnyWholeWord(clean, ['нельзя', 'неудобно']) ||
    (!isPoliteAgreement && hasAnyWholeWord(clean, ['нет']));

  const isAffirmative =
    !isNegativeNextStep &&
    (isPoliteAgreement ||
      hasAnyWholeWord(clean, [
        'да',
        'хорошо',
        'конечно',
        'согласен',
        'согласна',
        'удобно',
        'договорились',
        'давайте',
        'ок',
        'окей',
        'подходит',
        'точно',
      ]) ||
      hasAnyPhrase(lower, ['предпочту', 'удобнее завтра', 'лучше завтра', 'да, завтра', 'тогда завтра']));

  if (previousAgentTurnText) {
    const prevLower = previousAgentTurnText.toLowerCase();
    const hasNextStepProposal =
      prevLower.includes('видеопоказ') ||
      prevLower.includes('видео') ||
      prevLower.includes('созвон') ||
      prevLower.includes('зум') ||
      prevLower.includes('показ') ||
      (prevLower.includes('завтра') && prevLower.includes('удобно'));

    if (isAffirmative && hasNextStepProposal) {
      // Extract proposed step detail if present, or generate descriptive step
      let stepValue = 'Видеопоказ';
      const combined = `${prevLower} ${lower}`;
      const exactSlot = combined.match(/(?:^|[^\p{L}\p{N}])(сегодня|завтра|послезавтра)?\s*(?:в\s*)?(\d{1,2})(?::|\s)(\d{2})(?:$|[^\p{L}\p{N}])/iu);
      if (exactSlot) {
        const day = exactSlot[1] ? `${exactSlot[1]} ` : '';
        stepValue = `Видеопоказ ${day}в ${exactSlot[2].padStart(2, '0')}:${exactSlot[3]}`.replace(/\s+/g, ' ').trim();
      } else if (prevLower.includes('видеопоказ') || prevLower.includes('видео')) {
        stepValue = 'Видеопоказ вариантов';
      } else if (prevLower.includes('созвон') || prevLower.includes('зум')) {
        stepValue = 'Онлайн-созвон';
      } else {
        stepValue = 'Согласованный следующий шаг';
      }
      addFact('next_step', 'agreedNextStep', stepValue, trimmed);
    }
  }

  return facts;
}
