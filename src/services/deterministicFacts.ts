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
  detectAdultChildren,
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
  const explicitPaymentSwitch = /(?:всю|полностью|целиком|100%).*(?:покуп|оплат|средств)|(?:вместо|без) ипотеки|способ оплаты/iu.test(lower);

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
  const budgetMatches = Array.from(
    lower.matchAll(
      /(?:(?:бюджет(?:ом|а)?|до|около|примерно|в\s*районе)\s*)?(\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?)\s*(млн|миллион(?:а|ов)?|млрд|тысяч(?:и)?|тыс|к)(?:[^\p{L}\p{N}]|$)/giu
    )
  );
  // In corrections such as “not 10m, but 6m”, the last explicit value is current.
  // In flexible-budget phrases (“до 30, но 35–40 если стоящая история”) preserve
  // both the base target and the stretch ceiling instead of collapsing to one number.
  const unitlessStretchMatch = lower.match(/(?:посмотр(?:ю|им)|готов[^.!?]{0,20}рассмотр|мож(?:но|ем)[^.!?]{0,20}рассмотр)[^0-9]{0,24}(\d{1,3}(?:[.,]\d+)?(?:\s*-\s*\d{1,3}(?:[.,]\d+)?)?)(?!\s*(?:лет|год|месяц|%))/iu);
  const explicitBudgetCorrection = /(?:^|[^\p{L}\p{N}])не\s+[^.!?]{0,32}\d+(?:[.,]\d+)?\s*(?:млн|миллион(?:а|ов)?|млрд|тыс(?:яч(?:и)?)?|к)[^.!?]{0,24}(?:,\s*|\s+)а\s+[^.!?]{0,24}\d+(?:[.,]\d+)?\s*(?:млн|миллион(?:а|ов)?|млрд|тыс(?:яч(?:и)?)?|к)/iu.test(lower);
  const hasStretchCue = /(?:^|[^\p{L}\p{N}])(?:если|но)(?=$|[^\p{L}\p{N}])|при\s+(?:сильн|интересн|стоящ)|посмотрю|рассмотр/iu.test(lower);
  const conditionalStretch = !explicitBudgetCorrection &&
    (budgetMatches.length >= 2 || (budgetMatches.length >= 1 && Boolean(unitlessStretchMatch))) &&
    hasStretchCue;
  const budgetMatch = explicitBudgetCorrection
    ? (budgetMatches.at(-1) || null)
    : conditionalStretch
      ? budgetMatches[0]
      : (budgetMatches.at(-1) || null);
  const stretchMatch = conditionalStretch && budgetMatches.length >= 2 ? budgetMatches.at(-1)! : null;
  const isUnrealizedAssetGrowth =
    /(?:квартир|жиль|дом).{0,80}вырос\S*\s+(?:в\s+)?цен/iu.test(lower) &&
    /не\s+прода(?:вал|вала|вали|ю|ем)/iu.test(lower);
  const explicitlyBudgetContext = /(?:бюджет|общая\s*стоимость|весь\s*бюджет|максимальн\w*\s*сумм)/iu.test(lower);
  if (budgetMatch && !isUnrealizedAssetGrowth && (!agentAskedDownPayment || explicitlyBudgetContext)) {
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
  const investmentMatch = lower.match(
    /(?:смотр\p{L}*\s+как\s+вложени\p{L}*|скорее[^.!?]{0,20}вложени\p{L}*|как\s+вложени\p{L}*|вложить\s+(?:часть\s+)?(?:денег|капитал)|чисто\s*под\s*инвестици\p{L}*|для\s*перепродажи|инвестиционн\p{L}*|сохранить\s+капитал)/iu
  );
  const personalVisitMatch = lower.match(
    /(?:(?:сам(?:ому)?|сами|мы)\s+(?:иногда|периодически)?\s*приезжа\p{L}*|хотелось\s+бы\s+(?:и\s+)?сам(?:ому)?\s+(?:иногда\s+)?приезжа\p{L}*|приезжа\p{L}*\s+на\s+(?:пару|несколько|1-3|одну-две)\s+недел)/iu
  );
  const leisureMatch = lower.match(
    /(?:для\s*отдыха|сезонн(?:ое|ого|ом)?\s*проживан(?:ие|ия|ии)|приезжать\s+(?:на\s*)?(?:отдых|каникул)|на\s*каникулы|для\s*каникул|периодически\s*приезжать)/iu
  );

  const livingMatches = explicitNoPermanentLiving ? [] : Array.from(
    lower.matchAll(/(?:для\s*постоянной\s*жизни|постоянно\s*жить|буд(?:у|ем)\s*жить\s+постоянно|переезжа(?:ем|ть)|переезд|пмж)/giu)
  );
  const livingMatch = livingMatches.find((match) => {
    const startIndex = match.index || 0;
    const before = lower.slice(Math.max(0, startIndex - 55), startIndex);
    const after = lower.slice(startIndex + match[0].length, startIndex + match[0].length + 65);
    return !(
      /не\s+(?:хоч\p{L}*|планиру\p{L}*|собира\p{L}*|буд\p{L}*|рассматрива\p{L}*)[^.!?]{0,15}$/iu.test(before) ||
      /^\s*[^.!?]{0,35}не\s+(?:хоч\p{L}*|планиру\p{L}*|собира\p{L}*|буд\p{L}*|рассматрива\p{L}*)/iu.test(after)
    );
  }) || null;

  if (investmentMatch) {
    const mixedPersonal = Boolean(personalVisitMatch || leisureMatch);
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
        (personalVisitMatch || leisureMatch)![0].trim(),
        0.94
      );
    }
  } else if (livingMatch) {
    addFact('goal_primary', 'primaryGoal', 'Постоянное личное проживание', livingMatch[0].trim());
    addFact('goal', 'goal', 'Постоянное личное проживание', livingMatch[0].trim());
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
      addFact('goal', 'goal', 'Для себя (формат уточняется)', 'для себя', 0.9);
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
      comment: 'Средства доступны; размер первого платежа уточняется под конкретную схему оплаты.',
    });
  }

  // 4. Payment Method & Financing
  const cashMatch = lower.match(/(?:наличн(?:ые|ыми|ых)|расчет\s*наличными|расчёт\s*наличными|100%\s*оплата|свои\s*средства|собственн(?:ые|ыми)\s*средств(?:а|ами))/iu);
  
  // Explicit current negative intent towards mortgage (e.g. "не хочу ипотеку", "не нужна ипотека", "без ипотеки")
  const explicitMortgageNegative = lower.match(
    /(?:(?:^|[^\p{L}\p{N}])(?:(?:не\s*(?:нужн(?:а|о)|планиру(?:ю|ем)|хоч(?:у|ешь)|хот(?:им|ел|ела|ели|елось|елось\s*бы)|буд(?:ем|у)|рассматрива(?:ем|ю)|собира(?:юсь|емся)|подходит|интересует|люблю)|без)\s*ипотек(?:и|у)?)|(?:^|[^\p{L}\p{N}])ипотек(?:а|у|ой)?[^.!?]{0,35}не\s*(?:нужн(?:а|о)|интересн(?:а|о)|подходит|хоч(?:у|ется)|рассматрива(?:ю|ем)|собира(?:юсь|емся))|(?:^|[^\p{L}\p{N}])ипотек(?:а|у|ой)?[^.!?]{0,35}рассматрива(?:ть|ю|ем)[^.!?]{0,18}не\s*собира(?:юсь|емся))/iu
  );

  // Stating they didn't use mortgage in the past (e.g. "ипотекой раньше не пользовался")
  const pastExperienceNegation = !explicitMortgageNegative && lower.match(
    /(?:ипотек(?:ой)?\s*(?:раньше|никогда)?\s*не\s*(?:пользовал(?:ся|ись|ась)|брал(?:и)?))/iu
  );

  // Positive intent (e.g. "хочу купить в ипотеку", "в ипотеку", "рассматриваю вариант ипотека")
  const mortgageIntentMatch = !explicitMortgageNegative && lower.match(
    /(?:в\s*ипотеку|под\s*ипотеку|(?:^|[^\wа-яё])хочу\s*(?:купить\s*)?(?:в\s*)?ипотеку|буду\s*(?:в\s*)?ипотеку|купим\s*(?:в\s*)?ипотеку|планируем\s*(?:в\s*)?ипотеку|через\s*ипотеку|с\s*помощью\s*ипотеки|оформ(?:ить|ляем|им)\s*ипотеку|ипотек(?:а|у|ой)\s*(?:рассматрива(?:ем|ю)|подходит|нужна)|(?:рассматрива(?:ем|ю)\s*(?:вариант\s*)?)ипотек(?:а|у|ой)|ипотечное\s*кредитование)/iu
  );

  const mortgageNegationMatch = explicitMortgageNegative || (pastExperienceNegation && !mortgageIntentMatch);
  const genericMortgageMatch = !mortgageNegationMatch && lower.match(/(?:ипотек(?:а|у|ой)|в\s*ипотеку)/iu);
  const installmentMatch = lower.match(/(?:рассрочк(?:а|у|ой)|в\s*рассрочку)/iu);

  // If client specifically intends mortgage (even if stating they haven't used it in the past), give precedence to explicit intent
  if (mortgageIntentMatch && installmentMatch) {
    addFact('paymentMethod', 'paymentMethod', 'Ипотека / Рассрочка (допустимы оба варианта)', `${mortgageIntentMatch[0]}, ${installmentMatch[0]}`);
  } else if (cashMatch && (!sourceContext || explicitPaymentSwitch) && (!genericMortgageMatch || mortgageNegationMatch)) {
    addFact('paymentMethod', 'paymentMethod', /сво|собствен/iu.test(cashMatch[0]) ? 'Собственные средства (100% оплата)' : 'наличные', cashMatch[0]);
  } else if (mortgageNegationMatch && !mortgageIntentMatch) {
    // Negative preference regarding mortgage - do NOT choose mortgage as payment method
    // Do NOT invent cash or installment unless client explicitly stated it
  } else if (mortgageIntentMatch) {
    addFact('paymentMethod', 'paymentMethod', 'Ипотека', mortgageIntentMatch[0]);
  } else if (genericMortgageMatch && !mortgageNegationMatch) {
    addFact('paymentMethod', 'paymentMethod', 'Ипотека', genericMortgageMatch[0]);
  } else if (installmentMatch) {
    addFact('paymentMethod', 'paymentMethod', 'Рассрочка', installmentMatch[0]);
  }

  // Financial Priority (Comfortable Monthly Payment)
  const paymentPriorityMatch = lower.match(/(?:ежемесячный\s*платеж|комфортный\s*платеж|платеж\s*важнее|размер\s*платежа)/iu);
  if (paymentPriorityMatch) {
    addFact('finances', 'financialPriority', 'Комфортный ежемесячный платёж', paymentPriorityMatch[0]);
  }

  // Contextual initial payment: a short client answer like "15 миллионов" or "30%"
  // counts only when Andrei has just asked about the down payment.
  if (agentAskedDownPayment) {
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
    /(?:из\s*(?:личных\s*)?(?:накоплений|сбережений)|накоплени(?:я|й)|сбережени(?:я|й)|свои\s*средства|собственн(?:ые|ыми)\s*средств(?:а|ами)|деньги\s*на\s*руках)/iu
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
  // Scoped negation: "детей до 7 лет нет" is specific to the under-7 eligibility, not proof of having no kids at all
  const noChildUnder7Match = lower.match(
    /(?:(?:нет|нету|без)\s*(?:маленьких\s*)?детей\s*(?:до\s*7\s*(?:лет|года)?)|детей\s*(?:до\s*7\s*(?:лет|года)?)\s*(?:у\s*нас\s*)?(?:пока\s*)?нет)/iu
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
  const childGenericMatch = !noChildUnder7Match && !noChildrenMatch && !childUnder7Match && lower.match(
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
  const spouseMatch = lower.match(/(?:реша(?:ем|ть)\s*вместе|обсуд(?:им|ить|у)\s*с\s*(?:женой|мужем|супруг(?:ой|ом)|семь[её]й|партн[её]ром)|совет(?:уюсь|оваться)\s*с\s*(?:женой|мужем|супруг(?:ой|ом)|семь[её]й|партн[её]ром)|соглас(?:ую|овать)\s*с\s*(?:женой|мужем|супруг(?:ой|ом)|семь[её]й|партн[её]ром)|(?:жена|муж|супруг(?:а)?)\s+(?:тоже\s+)?(?:решает|участвует\s+в\s+решении))/iu);
  const soloMatch = lower.match(/(?:сам\s*решаю|сама\s*решаю|сам\s*принимаю\s*(?:финальн\p{L}*\s*)?решение|сама\s*принимаю\s*(?:финальн\p{L}*\s*)?решение|финальн\p{L}*\s+решение\s+(?:мо[её]|за\s+мной)|решение\s+(?:мо[её]|принимаю\s+сам(?:остоятельно)?|принимаю\s+сама(?:остоятельно)?)|один\s*выбираю|одна\s*выбираю|решаю\s*самостоятельно)/iu);
  if (spouseMatch) {
    addFact('decision_makers', 'decisionMakers', 'Совместно с супругом / семьёй', spouseMatch[0]);
  } else if (soloMatch) {
    addFact('decision_makers', 'decisionMakers', 'Принимает решение самостоятельно', soloMatch[0]);
  }

  // 8. Property Type (Whole-word / phrase matching, "рядом" != "дом")
  const isNegatedPropertyMention = (index: number, length: number): boolean => {
    const before = lower.slice(Math.max(0, index - 45), index);
    const after = lower.slice(index + length, index + length + 45);
    // A positive cue immediately before the noun belongs to that noun and must
    // not inherit a negation from an earlier alternative: "дом не хочу, нужна квартира".
    if (/(?:нужн(?:а|о|ы|ен)|хоч(?:у|ем)|рассматрива(?:ю|ем)|подход(?:ит|ят))\s*$/iu.test(before)) {
      return false;
    }
    return (
      /(?:не\s+(?:хочу|рассматрива(?:ю|ем)|нуж(?:ен|на|ны)|подход(?:ит|ят))|без|исключа(?:ю|ем))\s*(?:\S+\s*){0,2}$/iu.test(before) ||
      /^\s*(?:мне\s*)?не\s+(?:хочу|рассматрива(?:ю|ем)|нуж(?:ен|на|ны)|подход(?:ит|ят))/iu.test(after)
    );
  };
  const flatMatches = Array.from(
    lower.matchAll(/(?:квартир(?:а|у|ы|е|ой|ам|ами|ах)?|апартамент(?:ы|ов|ам|ами|ах|е)?|студи(?:я|ю|и|ей))/giu)
  );
  const flatMatch = flatMatches.find(
    (match) => !isNegatedPropertyMention(match.index, match[0].length)
  ) || null;
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
    /(?:(?:дом|коттедж|вилл(?:а|у)|таунхаус)\w*\s*(?:точно\s*)?(?:не\s*(?:нужен|нужно|интересует|рассматрива(?:ю|ем)|хочу|подходит)|исключа(?:ю|ем))|(?:не\s*(?:нужен|нужно|интересует|рассматрива(?:ю|ем)|хочу|подходит)|исключа(?:ю|ем))[^.!?]{0,24}(?:дом|коттедж|вилл(?:у|а)|таунхаус))/iu
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
  } else if (!genericMarketPropertyMention && flatMatch) {
    addFact('property_type', 'propertyType', flatMatch[0].toLowerCase().startsWith('апарт') ? 'Апартаменты' : 'Квартира', flatMatch[0]);
  }

  // 9. Timeline. Calendar wording such as "до декабря" is a concrete deadline.
  const timelineMatch = lower.match(
    /(?:пара\s*месяцев|пару\s*месяцев|в\s*течение\s*пары\s*месяцев|(?:2|два)[-–—\s]*(?:3|три)\s*месяц(?:а|ев)?|к\s*лету|в\s*течение\s*месяца|(?:^|[^\p{L}\p{N}])срочно(?:[^\p{L}\p{N}]|$)|не\s*к\s*спеху|(?:до|к)\s*(?:концу\s*)?(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)|(?:в|на)\s*(?:январе|феврале|марте|апреле|мае|июне|июле|августе|сентябре|октябре|ноябре|декабре))/iu
  );
  if (timelineMatch) {
    const timelineQuote = timelineMatch[0].trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    addFact('timeline', 'purchaseTimeline', timelineQuote, timelineQuote);
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
