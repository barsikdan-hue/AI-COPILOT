/**
 * Shared semantic normalization for free-form Russian sales dialogue.
 *
 * Important architectural rule:
 * - this layer does not decide UI state;
 * - it only turns different phrasings into stable business meanings;
 * - ConversationState / script metrics consume the same meanings, so a fact
 *   cannot be "understood" in one module and missed in another.
 */

import { normalizeRussianText } from './textUtils';
import type { TranscriptTurn } from '../types';

export interface MortgageDecision {
  kind: 'rejected' | 'allowed' | 'ambiguous' | 'unrelated';
  evidenceQuote: string | null;
}

/** Mortgage admissibility only; this does not select a payment method or consent to PPI. */
export function classifyMortgageDecision(text: string, previousText: string | null = null): MortgageDecision {
  const lower = (text || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/gu, ' ').trim();
  const result = (kind: MortgageDecision['kind'], evidenceQuote: string | null = null): MortgageDecision => ({ kind, evidenceQuote });

  // Only an immediate, unambiguous mortgage refusal can supply an omitted object.
  if (/^(?:нет\s*[,—-]?\s*)?не\s+(?:совсем|полностью)\s+исключа\p{L}*[.!]*$/iu.test(lower)) {
    const prior = previousText ? classifyMortgageDecision(previousText) : null;
    const otherObject = /дом|коттедж|вилл\p{L}*|таунхаус|апартамент|квартир|рассроч|видео|сириус|полян/iu.test(previousText || '');
    return prior?.kind === 'rejected' && !otherObject ? result('allowed', lower) : result('ambiguous');
  }

  const mentions = Array.from(lower.matchAll(/ипотек\p{L}*|ипотечн\p{L}*\s+(?:кредит\p{L}*|вариант\p{L}*)/giu));
  let decision = result('unrelated');
  for (const mention of mentions) {
    const start = mention.index || 0;
    const sentenceEnd = lower.slice(start).match(/[.!?]/u)?.[0];
    if (sentenceEnd === '?') {
      if (decision.kind === 'unrelated') decision = result('ambiguous', mention[0]);
      continue;
    }
    const before = lower.slice(0, start).split(/[.!?;,:]|\s+(?:но|однако|зато|а)\s+/u).at(-1) || '';
    const after = lower.slice(start + mention[0].length).split(/[.!?;,:]|\s+(?:но|однако|зато|а|и)\s+/u)[0] || '';
    const modifiers = '(?:(?:мне|нам|я|мы|сейчас|пока|вообще|больше|совсем|уже|все-таки|точно)\\s+)*';
    const end = '(?:\\s+(?:брать|оформлять|использовать|вообще|совсем|сейчас|пока|мне|нам))*\\s*(?:(?:из-за|потому\\s+что|так\\s+как|поскольку)\\s+[^.!?]*)?$';
    const negatedExclusion = /(?:^|[^\p{L}])не\s+(?:(?:совсем|полностью)\s+)?исключа\p{L}*\s*$/iu.test(before) ||
      new RegExp(`^\\s*${modifiers}не\\s+(?:(?:совсем|полностью)\\s+)?исключа\\p{L}*${end}`, 'iu').test(after);
    const additive = /(?:^|[^\p{L}])не\s+только\s*$/iu.test(before);
    const negativeBefore = new RegExp(`(?:^|[^\\p{L}])не\\s+(?:хоч\\p{L}*|хот\\p{L}*|рассматрива\\p{L}*|планиру\\p{L}*|собира\\p{L}*|буд\\p{L}*|нужн\\p{L}*|подходит|интересует|люблю)\\s+${modifiers}(?:(?:брать|оформлять|использовать|в)\\s+)*$`, 'iu').test(before);
    const negativeAfter = new RegExp(`^\\s*${modifiers}(?:(?:брать|оформлять|использовать)\\s+)?не\\s+(?:хоч\\p{L}*|хот\\p{L}*|рассматрива\\p{L}*|планиру\\p{L}*|собира\\p{L}*|буд\\p{L}*|нужн\\p{L}*|интересн\\p{L}*|подход\\p{L}*|интересует)${end}`, 'iu').test(after);
    const excluded = !negatedExclusion && (
      /(?:^|[^\p{L}])исключа\p{L}*\s*$/iu.test(before) ||
      new RegExp(`^\\s*${modifiers}(?:исключа\\p{L}*|отпал\\p{L}*)${end}`, 'iu').test(after)
    );
    const withoutMortgage = /(?:^|[^\p{L}])без\s*$/iu.test(before);
    const cannotDoWithout = withoutMortgage && (
      /^\s*не\s+обойтись\s*$/iu.test(after) ||
      /(?:не\s+(?:могу|можем|смогу|сможем)\s+(?:обойтись\s+)?без|не\s+обойтись\s+без)\s*$/iu.test(before)
    );
    const notMortgage = /(?:^|[^\p{L}])не\s*$/iu.test(before);
    if (!additive && !negatedExclusion && !cannotDoWithout && (negativeBefore || negativeAfter || excluded || withoutMortgage || notMortgage)) {
      decision = result('rejected', `${before}${mention[0]}${after}`.trim());
      continue;
    }
    const positiveBefore = /(?:рассматрива\p{L}*|рассмотр\p{L}*|оформ\p{L}*|бер\p{L}*|допуска\p{L}*)\s*(?:все-таки\s*)?$|(?:в|под|через)\s*$|(?:часть(?:\s+мож\p{L}*\s+взять\s+в)?|остальн\p{L}*)\s*$/iu.test(before);
    const positiveAfter = new RegExp(`^\\s*${modifiers}(?:рассматрива\\p{L}*|рассмотр\\p{L}*|допустим\\p{L}*|возможн\\p{L}*|подходит|нужна|одобрен\\p{L}*)`, 'iu').test(after);
    const simpleConditional = /^\s*если\s*$/iu.test(before) && /будет\s+прост\p{L}*[^.!?]*[,;]\s*рассмотр/iu.test(lower.slice(start + mention[0].length));
    if (negatedExclusion || additive || cannotDoWithout || positiveBefore || positiveAfter || simpleConditional) {
      decision = result('allowed', `${before}${mention[0]}${after}`.trim());
    } else if (decision.kind === 'unrelated') {
      decision = result('ambiguous', mention[0]);
    }
  }
  return decision;
}

/** Latest client-owned decision; unrelated turns and agent statements cannot change it. */
export function resolveMortgageDecision(turns: Pick<TranscriptTurn, 'speaker' | 'text'>[]): MortgageDecision {
  let decision: MortgageDecision = { kind: 'unrelated', evidenceQuote: null };
  for (let i = 0; i < turns.length; i += 1) {
    if (turns[i].speaker !== 'client') continue;
    const incoming = classifyMortgageDecision(turns[i].text, turns[i - 1]?.text || null);
    if (incoming.kind === 'rejected' || incoming.kind === 'allowed') decision = incoming;
  }
  return decision;
}

const paymentProperty = '(?:размер\\p{L}*|сумм\\p{L}*|ставк\\p{L}*|процент\\p{L}*|услов\\p{L}*|платеж\\p{L}*|взнос\\p{L}*|срок\\p{L}*|программ\\p{L}*|район\\p{L}*|локац\\p{L}*|объект\\p{L}*|квартир\\p{L}*)';
const mortgageProperty = '(?:размер\\p{L}*|сумм\\p{L}*|ставк\\p{L}*|процент\\p{L}*|услов\\p{L}*|платеж\\p{L}*|взнос\\p{L}*|срок\\p{L}*|программ\\p{L}*)';
const paymentMortgage = '(?:ипотек\\p{L}*|ипотечн\\p{L}*\\s+кредит\\p{L}*)';

function paymentChoiceClauses(text: string): string[] {
  const lower = (text || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/gu, ' ').trim();
  const cue = '(?:не\\s+(?:знаю|решил\\p{L}*|выбрал\\p{L}*|определил\\p{L}*)|под\\s+вопросом)';
  return lower.split(/[.!?;]|\s+(?:но|однако|зато)\s+/u).map(clause => clause
    .replace(new RegExp(`(?:^|[\\s,])${paymentProperty}[^,;.!?]{0,55}${cue}`, 'giu'), ' ')
    .replace(new RegExp(`(?:возможн\\p{L}*|может\\s+быть)\\s+(?:под|по|на)\\s+(?:семейн\\p{L}*\\s+)?${paymentProperty}[^,;.!?]*`, 'giu'), ' ')
    .replace(new RegExp(`(?:возможн\\p{L}*|может\\s+быть)\\s+${mortgageProperty}[^,;.!?]*`, 'giu'), ' ')
    .replace(new RegExp(`${paymentProperty}(?:\\s+по)?\\s+${paymentMortgage}`, 'giu'), ' '));
}

/** A property-owned mortgage mention is not new evidence of a payment choice. */
export function hasPaymentMethodScope(text: string): boolean {
  if (!new RegExp(paymentMortgage, 'iu').test(text)) return true;
  const lower = text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  return orderedPaymentStatements(lower).filter(statement => !isPaymentPropertyQuestion(statement) && !hasOtherPaymentRecipient(statement))
    .some(statement => paymentChoiceClauses(statement).some(clause =>
      /ипотек|ипотечн\p{L}*\s+кредит|рассроч|способ\s+оплат|схем\p{L}*\s+(?:покупк|оплат)|(?:куп\p{L}*|опла\p{L}*|покуп\p{L}*|запла\p{L}*)[^.!?]{0,35}(?:за\s+свои|собственн\p{L}*\s+средств|наличн)|(?:полностью|100%)[^.!?]{0,30}(?:сво\p{L}*|собственн\p{L}*\s+средств)/iu.test(clause)));
}

const paymentDoubt = /не\s+(?:(?:совсем\s+)?уверен\p{L}*|знаю|решил\p{L}*|выбрал\p{L}*|определил\p{L}*)|сомнева\p{L}*|под\s+вопросом/iu;
const paymentCondition = /(?:^|[^\p{L}])(?:если|в\s+случае|при\s+условии)(?:$|[^\p{L}])/iu;
const paymentOtherProperty = new RegExp(paymentProperty, 'iu');

/** A which/how-much complement owns a property, unlike a whether-to-use payment choice. */
function isPaymentPropertyQuestion(statement: string): boolean {
  const text = statement.replace(/[,:]/gu, ' ').replace(/\s+/gu, ' ').trim();
  const question = text.match(/(?:^|\s)(?:как\p{L}+|сколько)\s+[^.!?;]*/iu);
  if (!question || /способ\s+оплат|схем\p{L}*\s+(?:покупк|оплат)/iu.test(question[0])) return false;
  // A later property question cannot own an already expressed payment choice.
  if (new RegExp(paymentMortgage, 'iu').test(text.slice(0, question.index))) return false;
  return paymentOtherProperty.test(question[0]) || /(?:по|у)\s+ипотек/iu.test(question[0]);
}

/** A named non-client recipient in a whether-needed complement owns a different payment choice. */
function hasOtherPaymentRecipient(statement: string): boolean {
  const recipient = statement.match(/(?:нуж(?:н\p{L}*|ен)|надо)\s+ли\s+(\p{L}+)\s+(?:ипотек\p{L}*|он|она|ее|это)(?:$|[^\p{L}])/iu)?.[1];
  return Boolean(recipient && !/^(?:мне|нам)$/iu.test(recipient) && /(?:[аяиы]м|ему|ей)$|^тебе$/iu.test(recipient));
}

/** Keep complements and conditional antecedent/consequence together; split independently owned statements. */
function orderedPaymentStatements(text: string): string[] {
  // Normalize the existing financing lexeme, not its owner, decision or original evidence.
  const paymentText = text.replace(/ипотечн\p{L}*\s+кредит\p{L}*/gu, 'ипотека');
  return paymentText.split(/[.!?;]|(?:,\s*|\s+)(?:но|однако|зато|хотя)[,\s]+/u).flatMap(rawSentence => {
    // Discourse stance is not a financing antecedent; normalize it before classifying decisions.
    const sentence = rawSentence.replace(/^\s*(?:ну|слушайте|вообще|смотрите|в\s+целом|если\s+(?:честно|откровенно|точнее))\s*,\s*/u, '');
    if (/^(?:если|в\s+случае|при\s+условии)\s/iu.test(sentence.trim())) return [sentence];
    const statements: string[] = [];
    let start = 0;
    for (const comma of sentence.matchAll(/,\s*/gu)) {
      const next = sentence.slice(comma.index! + comma[0].length);
      const prefix = sentence.slice(start, comma.index);
      if (/^(?:если|в\s+случае|при\s+условии)\s/iu.test(prefix.trim())) continue;
      const newOwner = new RegExp(`^(?:(?:возможно|может\\s+быть)\\s+)?${paymentProperty}`, 'iu').test(next);
      const newDecision = /^(?:(?:теперь|пока|еще)\s+)*(?:не\s+уверен\p{L}*|сомнева\p{L}*|решил\p{L}*|если|да(?:\s|,)|точно\s+возьм|буд(?:у|ем)\s+брать)/iu.test(next);
      const explicitMortgage = /^ипотек/iu.test(next) && (/ипотек/iu.test(prefix) || paymentOtherProperty.test(prefix));
      const priorOwner = /ипотек/iu.test(prefix) || paymentOtherProperty.test(prefix);
      if (newOwner || (newDecision && priorOwner) || explicitMortgage) {
        statements.push(prefix);
        start = comma.index! + comma[0].length;
      }
    }
    statements.push(sentence.slice(start));
    return statements;
  }).map(statement => statement.trim()).filter(Boolean);
}

/** Local classification only; these kinds are not conversation-state statuses. */
function paymentStatementKind(statement: string, mortgageContext: boolean): {
  kind: 'confirmation' | 'uncertainty' | 'conditional' | 'property' | 'none'; mortgageContext: boolean;
} {
  if (isPaymentPropertyQuestion(statement)) return { kind: 'property', mortgageContext: false };
  if (hasOtherPaymentRecipient(statement)) return { kind: 'none', mortgageContext: false };
  const scoped = paymentChoiceClauses(statement)[0].replace(/[,:]/gu, ' ').replace(/\s+/gu, ' ').trim();
  const explicit = /ипотек|способ\s+оплат|схем\p{L}*\s+(?:покупк|оплат)/iu.test(scoped);
  const echo = scoped.replace(/^(?:(?:да|я|мы|теперь|пока|еще|окончательно)\s+)*/u, '');
  const uncertainEcho = new RegExp(`^(?:${paymentDoubt.source})(?:\\s+(?:нуж(?:н\\p{L}*|ен)|надо|брать|использовать)\\s+ли\\s+(?:(?:мне|нам)\\s+)?(?:он|она|ее|это))?$`, 'iu').test(echo) ||
    /^(?:может\s+быть|возможно)\s+(?:все-таки\s+)?без\s+нее$/u.test(echo);
  const confirmedEcho = /^точно\s+нуж(?:на|ен)$/u.test(echo);
  const ownsEcho = mortgageContext && !paymentOtherProperty.test(statement) && (uncertainEcho || confirmedEcho);
  const context = (explicit && /ипотек/iu.test(scoped) && !paymentOtherProperty.test(statement)) || ownsEcho;
  const result = (kind: 'confirmation' | 'uncertainty' | 'conditional' | 'property' | 'none') => ({ kind, mortgageContext: context });
  if (!explicit && !ownsEcho) return result(paymentOtherProperty.test(statement) ? 'property' : 'none');
  // Ownership is decided before polarity: a hypothetical action is never an affirmative reset.
  if (paymentCondition.test(scoped)) return result('conditional');
  const choice = /(?:способ\s+оплаты|схем\p{L}*|вариант\p{L}*)[^.!?]{0,45}не\s+(?:выбран\p{L}*|определен\p{L}*|решил\p{L}*|выбрал\p{L}*)|(?:сравнива\p{L}*|выбира\p{L}*)[^.!?]{0,60}ипотек[^.!?]{0,45}рассроч|ипотек[^.!?]{0,45}(?:или|либо)[^.!?]{0,35}рассроч/iu.test(scoped);
  const possible = /(?:возможн\p{L}*|может\s+быть|скорее\s+всего)[^.!?]{0,35}ипотек\p{L}*|ипотек\p{L}*[^.!?]{0,35}(?:возможн\p{L}*|может\s+быть)/iu.test(scoped);
  const unresolvedChoice = /(?:нуж(?:н\p{L}*|ен)|надо|стоит\s+брать)\s+ли[^.!?]{0,40}ипотек|ипотек\p{L}*[^.!?]{0,45}или\s+не\s+(?:надо|нужно|брать|использовать)/iu.test(scoped);
  if (paymentDoubt.test(scoped) || choice || possible || unresolvedChoice || (ownsEcho && uncertainEcho)) return result('uncertainty');
  const affirmative = /(?:беру|берем|буд(?:у|ем)\s+брать|решил\p{L}*)[^.!?]{0,35}ипотек|ипотек\p{L}*\s+(?:точно\s+)?(?:нуж(?:на|ен)|подходит|одобрен\p{L}*)|часть[^.!?]{0,35}сво\p{L}*[^.!?]{0,45}ипотек/iu.test(scoped) ||
    /^(?:да\s+)?(?:(?:я|мы)\s+)?(?:часть\s+)?(?:точно\s+возьм(?:у|ем)|будем\s+брать)\s+(?:в\s+)?ипотек\p{L}*$/iu.test(scoped);
  return result(affirmative || (ownsEcho && confirmedEcho) ? 'confirmation' : 'none');
}

/** Ordered payment choice: only unconditional confirmation can clear uncertainty. */
export function isPaymentMethodUncertain(text: string, previousAgentText: string | null = null): boolean {
  const lower = (text || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/gu, ' ').trim();
  const undecidedAnswer = /^(?:(?:я|мы|пока|еще|окончательно|с этим)\s+)*(?:не\s+(?:знаю|решил\p{L}*|выбрал\p{L}*|определил\p{L}*)|под\s+вопросом|может\s+быть)[.!]*$/iu.test(lower);
  const paymentQuestion = (new RegExp(paymentMortgage, 'iu').test(previousAgentText || '') ||
    /рассроч|способ\s+(?:покупк|оплат)|схем\p{L}*\s+(?:покупк|оплат)/iu.test(previousAgentText || '')) &&
    (!new RegExp(paymentProperty, 'iu').test(previousAgentText || '') || /способ|схем/iu.test(previousAgentText || ''));
  if (undecidedAnswer && paymentQuestion) return true;

  let uncertain = false;
  let mortgageContext = false;
  for (const statement of orderedPaymentStatements(lower)) {
    const decision = paymentStatementKind(statement, mortgageContext);
    mortgageContext = decision.mortgageContext;
    if (decision.kind === 'uncertainty' || decision.kind === 'conditional') uncertain = true;
    else if (decision.kind === 'confirmation') uncertain = false;
  }
  return uncertain;
}

export interface SemanticCriterion {
  key: string;
  label: string;
  evidenceQuote: string;
}

export interface SemanticSearchExperience {
  value: string;
  evidenceQuote: string;
  level: 'none' | 'browsing' | 'agent_contact' | 'viewings' | 'purchase';
}

export const isNoSearchExperienceValue = (value: string | null | undefined): boolean =>
  /конкретн\p{L}*\s+объект\p{L}*\s+ещ[её]\s+не\s+смотрел/iu.test(value || '');

export type TrustQuestionKind = 'technical' | 'personal' | null;

export type InvestmentIntentKind = 'positive' | 'negative' | 'uncertain' | 'mixed' | 'none';

export type GoalIntentKind = 'personal' | 'permanent' | 'seasonal' | 'investment' | 'mixed' | 'uncertain' | 'none';

export interface SemanticGoalIntent {
  kind: GoalIntentKind;
  evidenceQuote: string | null;
  personalEvidenceQuote: string | null;
  investmentEvidenceQuote: string | null;
}

const firstSemanticMatch = (text: string, patterns: RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0].trim();
  }
  return null;
};

const investmentMention = (text: string): boolean =>
  /(?:инвестиц\p{L}*|вложени\p{L}*|сдава\p{L}*|сдач\p{L}*|аренд\p{L}*|доходн\p{L}*\s+недвижимост\p{L}*|пассивн\p{L}*\s+доход|сохран\p{L}*\s+капитал|перепродаж\p{L}*)/iu.test(text);

const personalUseMention = (text: string): boolean =>
  /(?:для\s+себя|бер\p{L}*\s+себе|остав\p{L}*\s+себе|жить\s+(?:буд\p{L}*\s+)?сам\p{L}*|буд\p{L}*\s+жить\s+сам\p{L}*|семейн\p{L}*\s+жиль\p{L}*|личн\p{L}*\s+(?:использован\p{L}*|поезд\p{L}*)|для\s+отдыха|приезжа\p{L}*)/iu.test(text);

/**
 * Classify investment intent before keyword-driven projections or suggestions.
 * Order matters: mixed and uncertain phrases contain the same words as positive
 * intent, while explicit rejection may still mention yield as a comparison.
 */
export function classifyInvestmentIntent(text: string): InvestmentIntentKind {
  const lower = (text || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/gu, ' ').trim();
  if (!lower.trim()) return 'none';

  const unresolvedAlternatives =
    /(?:пока\s+)?(?:выбира\p{L}*|не\s+(?:решил\p{L}*|определил\p{L}*|знаю)|реш\p{L}*\s+позже)[^.!?]{0,120}\sили\s/iu.test(lower) &&
    personalUseMention(lower) &&
    investmentMention(lower);
  if (unresolvedAlternatives) return 'uncertain';

  const contextualMixedRental = /часть\s+года[^.!?]{0,80}(?:еще\s+и\s+)?сдава\p{L}*/iu.test(lower);
  const explicitMixedUse = contextualMixedRental || (personalUseMention(lower) && investmentMention(lower) && (
    /не\s+только[^.!?]{0,120}(?:инвестиц\p{L}*|сдава\p{L}*)/iu.test(lower) ||
    /часть\s+года[^.!?]{0,100}(?:остальн\p{L}*\s+врем\p{L}*|сдава\p{L}*)/iu.test(lower) ||
    /(?:для\s+отдыха|жить\s+сам\p{L}*|приезжа\p{L}*)[^.!?]{0,80}(?:и\s+иногда|остальн\p{L}*\s+врем\p{L}*|еще\s+и)\s*(?:под\s+аренд\p{L}*|сдава\p{L}*)/iu.test(lower) ||
    /(?:сохран\p{L}*\s+капитал|инвестиц\p{L}*|вложени\p{L}*)[^.!?]{0,100}[,;:-]?\s*(?:но\s+)?(?:летом|иногда|периодически)[^.!?]{0,45}(?:приезжа\p{L}*|жить\s+сам\p{L}*)/iu.test(lower)
  ));
  if (explicitMixedUse) return 'mixed';

  if (
    /не\s+для\s+инвестиц\p{L}*/iu.test(lower) ||
    /не\s+под\s+аренд\p{L}*/iu.test(lower) ||
    /(?:для\s+)?инвестиц\p{L}*\s*(?:мне\s+)?(?:(?:больше|уже|вообще|совсем|точно)\s+)?не\s+(?:хоч\p{L}*|рассматрива\p{L}*|интерес\p{L}*|нужн\p{L}*)/iu.test(lower) ||
    /не\s+(?:хоч\p{L}*|рассматрива\p{L}*|интерес\p{L}*|нужн\p{L}*)\s+(?:для\s+)?инвестиц\p{L}*/iu.test(lower) ||
    /инвестиционн\p{L}*\s+покупк\p{L}*[^.!?]{0,25}исключа\p{L}*/iu.test(lower) ||
    /не\s+(?:хоч\p{L}*|планиру\p{L}*|буд\p{L}*|собира\p{L}*|рассматрива\p{L}*)[^.!?]{0,30}сдава\p{L}*/iu.test(lower) ||
    /сдава\p{L}*[^.!?]{0,30}не\s+(?:хоч\p{L}*|планиру\p{L}*|буд\p{L}*|собира\p{L}*|рассматрива\p{L}*)/iu.test(lower)
  ) return 'negative';

  if (
    /(?:как|для|под)\s+(?:инвестиц\p{L}*|вложени\p{L}*)/iu.test(lower) ||
    /инвестиционн\p{L}*\s+(?:объект\p{L}*|покупк\p{L}*|недвижимост\p{L}*)/iu.test(lower) ||
    /(?:бер\p{L}*|покупа\p{L}*|ищ\p{L}*|смотр\p{L}*|рассматрива\p{L}*|решил\p{L}*|нужн\p{L}*|хоч\p{L}*)[^.!?]{0,55}(?:под\s+(?:долгосрочн\p{L}*\s+|краткосрочн\p{L}*\s+|посуточн\p{L}*\s+)?аренд\p{L}*|для\s+сдач\p{L}*|сдава\p{L}*)/iu.test(lower) ||
    /(?:под\s+(?:долгосрочн\p{L}*\s+|краткосрочн\p{L}*\s+|посуточн\p{L}*\s+)?аренд\p{L}*|для\s+сдач\p{L}*)/iu.test(lower) ||
    /доходн\p{L}*\s+недвижимост\p{L}*/iu.test(lower) ||
    /(?:хоч\p{L}*\s+получа\p{L}*|принос\p{L}*)[^.!?]{0,30}(?:пассивн\p{L}*\s+)?доход/iu.test(lower) ||
    /(?:арендн\p{L}*|пассивн\p{L}*)\s+доход/iu.test(lower) ||
    /сохран\p{L}*\s+капитал(?:а)?(?:\s+в\s+недвижимост\p{L}*)?/iu.test(lower) ||
    /(?:рост\p{L}*\s+цен\p{L}*|роста\s+цены)[^.!?]{0,55}(?:перепродаж\p{L}*|перепродать)/iu.test(lower)
  ) return 'positive';

  return 'none';
}

/**
 * Resolve the purchase-use category before deterministic facts are created.
 * A personal-use mention is filtered for local negation, while mixed intent
 * requires explicit co-use rather than mere interest in yield or price growth.
 */
export function classifyGoalIntent(text: string): SemanticGoalIntent {
  const lower = (text || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/gu, ' ').trim();
  const none: SemanticGoalIntent = {
    kind: 'none',
    evidenceQuote: null,
    personalEvidenceQuote: null,
    investmentEvidenceQuote: null,
  };
  if (!lower) return none;

  const investmentIntent = classifyInvestmentIntent(lower);
  const investmentEvidenceQuote = firstSemanticMatch(lower, [
    /(?:как|для|под)\s+(?:инвестиц\p{L}*|вложени\p{L}*)/iu,
    /инвестиционн\p{L}*\s+(?:объект\p{L}*|покупк\p{L}*|недвижимост\p{L}*)/iu,
    /(?:под\s+(?:долгосрочн\p{L}*\s+|краткосрочн\p{L}*\s+|посуточн\p{L}*\s+)?аренд\p{L}*|для\s+сдач\p{L}*|смотр\p{L}*\s+для\s+сдач\p{L}*)/iu,
    /доходн\p{L}*\s+недвижимост\p{L}*/iu,
    /(?:хоч\p{L}*\s+получа\p{L}*|принос\p{L}*)[^.!?]{0,30}(?:пассивн\p{L}*\s+)?доход/iu,
    /сохран\p{L}*\s+капитал(?:а)?(?:\s+в\s+недвижимост\p{L}*)?/iu,
    /(?:рост\p{L}*\s+цен\p{L}*|роста\s+цены)[^.!?]{0,55}(?:перепродаж\p{L}*|перепродать)/iu,
  ]);

  const permanentPatterns = [
    /для\s+постоянн\p{L}*\s+(?:жизн\p{L}*|проживан\p{L}*)/giu,
    /(?:постоянно\s+(?:там\s+)?жить|жить(?:\s+(?:сам\p{L}*|там)){0,2}\s+постоянно|переезжа\p{L}*|переезд\p{L}*|пмж)/giu,
    /(?:основн\p{L}*\s+жиль\p{L}*|жиль\p{L}*\s+кругл\p{L}*\s+год)/giu,
  ];
  const isNegatedPermanentSpan = (match: RegExpMatchArray): boolean => {
    const start = match.index || 0;
    const before = lower.slice(Math.max(0, start - 55), start).split(/[.!?;,:]/u).at(-1) || '';
    const after = lower.slice(start + match[0].length, start + match[0].length + 55).split(/[.!?]/u)[0] || '';
    const nominal = /^(?:для\s+постоянн|пмж)/iu.test(match[0]);
    const postposedNegation = after.match(
      /^\s*[,;:—-]?\s*(?:(?:там|здесь|тут|вообще|сейчас|пока|больше|я|мы|(?:в|на)\s+\p{L}+)\s+)*не\s+(?:планиру\p{L}*|собира\p{L}*|хоч\p{L}*|буд\p{L}*|рассматрива\p{L}*|подход\p{L}*)(.*)$/iu,
    );
    const precedingNegation = before.match(
      /(?:^|[^\p{L}])не\s+(?:планиру\p{L}*|собира\p{L}*|хоч\p{L}*|буд\p{L}*|рассматрива\p{L}*|подход\p{L}*)(?:\s+(?:там|здесь|тут|вообще|сейчас|пока|больше|(?:в|на)\s+\p{L}+))*(?:\s+для)?\s*$/iu,
    );
    const precedingObject = precedingNegation ? before.slice(0, precedingNegation.index).trim() : '';
    // A following explicit object ("не рассматриваю ипотеку") is not a rejection of this goal.
    const followingObject = postposedNegation?.[1].split(/[,;:—-]/u)[0].trim() || '';
    const rejectsThisGoal = Boolean(postposedNegation &&
      /^(?:(?:пока|вообще|совсем|больше|сейчас)\s*)*$/iu.test(followingObject));
    const rejectsThisGoalBefore = Boolean(precedingNegation &&
      /^(?:(?:я|мы|сейчас|пока|вообще)\s*)*$/iu.test(precedingObject));
    return (
      (nominal && /(?:^|[^\p{L}])не\s+(?:для\s+)?$/iu.test(before)) ||
      rejectsThisGoalBefore ||
      rejectsThisGoal ||
      (nominal && /^\s*(?:не\s+для\s+меня|исключа\p{L}*)/iu.test(after))
    );
  };
  const latestPermanentMatch = permanentPatterns
    .flatMap((pattern) => Array.from(lower.matchAll(pattern)))
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .at(-1);
  const permanentEvidenceQuote = latestPermanentMatch && !isNegatedPermanentSpan(latestPermanentMatch)
    ? latestPermanentMatch[0]
    : null;

  const seasonalEvidenceQuote = firstSemanticMatch(lower, [
    /для\s+личн\p{L}*\s+поезд\p{L}*/iu,
    /приезжа\p{L}*[^.!?]{0,30}(?:отдыха\p{L}*|на\s+отдых|сам\p{L}*)/iu,
    /приезжа\p{L}*[^.!?]{0,30}(?:только\s+)?лет\p{L}*/iu,
    /для\s+себя[^.!?]{0,30}(?:на\s+)?лет\p{L}*/iu,
    /(?:жить\s+сам\p{L}*|сам\p{L}*\s+жить)[^.!?]{0,30}(?:месяц\p{L}*|недел\p{L}*)\s+в\s+году/iu,
    /(?:для\s+отпуск\p{L}*|для\s+отдыха|на\s+каникул\p{L}*|длинн\p{L}*\s+выходн\p{L}*|сезонн\p{L}*\s+проживан\p{L}*)/iu,
  ]);

  const personalCandidates = [
    /(?:покупа\p{L}*|бер\p{L}*|ищ\p{L}*|нужн\p{L}*|рассматрива\p{L}*)[^.!?]{0,40}для\s+себя/iu,
    /(?:квартир\p{L}*|жиль\p{L}*|объект\p{L}*)[^.!?]{0,35}(?:для\s+меня|нуж\p{L}*\s+мне\s+лично|нуж\p{L}*\s+мне\s+сам\p{L}*)/iu,
    /(?:бер\p{L}*|остав\p{L}*)\s+себе/iu,
    /(?:буд\p{L}*\s+(?:там\s+)?жить\s+сам\p{L}*|жить\s+буд\p{L}*\s+сам\p{L}*|хоч\p{L}*\s+(?:сам\p{L}*\s+)?(?:там\s+)?жить(?:\s+сам\p{L}*)?|сам\p{L}*\s+(?:там\s+)?буд\p{L}*\s+жить)/iu,
    /для\s+жизн\p{L}*/iu,
  ];
  let personalEvidenceQuote = firstSemanticMatch(lower, personalCandidates);
  if (personalEvidenceQuote) {
    const escaped = personalEvidenceQuote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const negatedSelfUse = new RegExp(
      `(?:не\\s+для\\s+себя|для\\s+себя\\s+не\\s+(?:бер\\p{L}*|покупа\\p{L}*|рассматрива\\p{L}*)|${escaped}[^.!?]{0,25}не\\s+(?:буд\\p{L}*|хоч\\p{L}*|планиру\\p{L}*))`,
      'iu',
    ).test(lower);
    if (negatedSelfUse) personalEvidenceQuote = null;
  }

  if (investmentIntent === 'uncertain') return { ...none, kind: 'uncertain' };
  if (investmentIntent === 'mixed') {
    const personalQuote = seasonalEvidenceQuote || personalEvidenceQuote;
    return {
      kind: 'mixed',
      evidenceQuote: lower,
      personalEvidenceQuote: personalQuote,
      investmentEvidenceQuote,
    };
  }
  if (investmentIntent === 'positive') {
    return {
      kind: 'investment',
      evidenceQuote: investmentEvidenceQuote || lower,
      personalEvidenceQuote,
      investmentEvidenceQuote: investmentEvidenceQuote || lower,
    };
  }
  if (permanentEvidenceQuote) {
    return { kind: 'permanent', evidenceQuote: permanentEvidenceQuote, personalEvidenceQuote: permanentEvidenceQuote, investmentEvidenceQuote };
  }
  if (seasonalEvidenceQuote) {
    return { kind: 'seasonal', evidenceQuote: seasonalEvidenceQuote, personalEvidenceQuote: seasonalEvidenceQuote, investmentEvidenceQuote };
  }
  if (personalEvidenceQuote) {
    return { kind: 'personal', evidenceQuote: personalEvidenceQuote, personalEvidenceQuote, investmentEvidenceQuote };
  }
  return none;
}

export interface SemanticDecisionMaker {
  kind: 'sole' | 'joint' | 'third_party';
  value: string;
  evidenceQuote: string;
}

const firstMatch = (text: string, regex: RegExp): string | null => {
  const match = text.match(regex);
  return match?.[0]?.trim() || null;
};

const addUniqueCriterion = (
  out: SemanticCriterion[],
  key: string,
  label: string,
  quote: string | null,
) => {
  if (!quote || out.some((item) => item.key === key)) return;
  out.push({ key, label, evidenceQuote: quote });
};

/**
 * Extract client decision criteria by meaning, not by one exact template.
 * The recognizer intentionally accepts natural synonyms used in live calls.
 */
export function extractSemanticCriteria(text: string): SemanticCriterion[] {
  const raw = (text || '').trim();
  if (!raw) return [];
  const lower = raw.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const out: SemanticCriterion[] = [];

  addUniqueCriterion(
    out,
    'location',
    'Сильная / подходящая локация',
    firstMatch(lower, /(?:хорош(?:ая|ую)|сильн(?:ая|ую)|удачн(?:ая|ую)|подходящ(?:ая|ую)|важн(?:а|о|ый|ую))\s+локаци\p{L}*|локаци\p{L}*[^.!?]{0,28}(?:важн|ключев|решающ|хорош|сильн)/iu),
  );
  addUniqueCriterion(
    out,
    'liquidity',
    'Ликвидность / возможность перепродажи',
    firstMatch(lower, /(?:ликвидн\p{L}*|легко\s+продать|без\s+проблем\s+продать|перепродаж\p{L}*)/iu),
  );
  addUniqueCriterion(
    out,
    'rental',
    'Возможность сдавать в аренду',
    firstMatch(lower, /(?:возможност\p{L}*\s+сдава\p{L}*|сдава\p{L}*\s+в\s+аренд\p{L}*|сдач\p{L}*\s+в\s+аренд\p{L}*|под\s+аренд\p{L}*|под\s+сдач\p{L}*|арендн\p{L}+\s+доход\p{L}*|чтобы\s+сдава\p{L}*)/iu),
  );
  addUniqueCriterion(
    out,
    'price',
    'Адекватная цена / не переплачивать',
    firstMatch(lower, /(?:адекватн\p{L}*\s+цен\p{L}*|разумн\p{L}*\s+цен\p{L}*|не\s+переплачива\p{L}*|цена[^.!?]{0,22}(?:важн|решающ|адекватн))/iu),
  );
  addUniqueCriterion(
    out,
    'yield',
    'Доходность / экономика проекта',
    firstMatch(lower, /(?:доходност\p{L}*|окупаемост\p{L}*|денежн\p{L}+\s+поток\p{L}*|экономик\p{L}+\s+проект\p{L}*)/iu),
  );
  addUniqueCriterion(
    out,
    'infrastructure',
    'Развитая инфраструктура',
    firstMatch(
      lower,
      /(?:инфраструктур\p{L}*|логистик\p{L}*|транспортн\p{L}+\s+доступност\p{L}*|не\s+(?:хочу\s+)?(?:быть\s+)?отрезан\p{L}*\s+от\s+цивилизаци\p{L}*|не\s+(?:хочу\s+)?(?:быть\s+)?вырезан\p{L}*\s+из\s+социум\p{L}*|не\s+(?:было|будет)\s+ощущени\p{L}*[^.!?]{0,60}отрезан\p{L}*\s+от\s+цивилизаци\p{L}*|не\s+(?:было|будет)\s+ощущени\p{L}*[^.!?]{0,60}вырезан\p{L}*\s+из\s+социум\p{L}*|(?:важн\p{L}*|нужн\p{L}*|хоч\p{L}*|критери\p{L}*)[^.!?]{0,35}(?:рестораны?|магазины?|кафе|спа(?=$|[^\p{L}])|бассейн\p{L}*|школ\p{L}*|поликлиник\p{L}*|детск\p{L}+\s+сад\p{L}*))/iu,
    ),
  );
  addUniqueCriterion(
    out,
    'transport',
    'Транспортная доступность',
    firstMatch(lower, /(?:обязательн\p{L}*|важн\p{L}*|нужн\p{L}*)[^.!?]{0,35}(?:удобн\p{L}*\s+дорог\p{L}*|дорог\p{L}*\s+до\s+(?:вокзал\p{L}*|аэропорт\p{L}*))/iu),
  );
  const rejectsSeaProximity =
    /(?:близост\p{L}*|близко|рядом)[^.!?]{0,18}(?:к\s+)?мор\p{L}*[^.!?]{0,32}не\s+(?:важн\p{L}*|нужн\p{L}*|обязательн\p{L}*|принципиальн\p{L}*)/iu.test(lower) ||
    /не\s+(?:важн\p{L}*|нужн\p{L}*|обязательн\p{L}*|принципиальн\p{L}*)[^.!?]{0,24}(?:близост\p{L}*|близко|рядом)[^.!?]{0,12}(?:к\s+)?мор\p{L}*/iu.test(lower);
  const seaIsObjectFact = /мор\p{L}*\s+рядом[^.!?]{0,45}(?:просто\s+)?факт\p{L}*\s+про\s+объект/iu.test(lower);
  addUniqueCriterion(
    out,
    'sea',
    'Близость к морю / пляжу',
    rejectsSeaProximity || seaIsObjectFact
      ? null
      : firstMatch(lower, /(?:близост\p{L}*\s+к\s+морю|близко\s+к\s+морю|рядом\s+с\s+морем|море\s+рядом|море\s+пешком|недалеко\s+от\s+моря|у\s+моря|до\s+(?:моря|пляж\p{L}*)|пляж\p{L}*|первая\s+берегов\p{L}*\s+лини\p{L}*)/iu),
  );
  const rejectsQuietAsHousingCriterion =
    /тишин\p{L}*[^.!?]{0,32}не\s+(?:важн\p{L}*|нужн\p{L}*|обязательн\p{L}*|принципиальн\p{L}*)/iu.test(lower) ||
    /(?:^|[^\p{L}])не\s+(?:важн\p{L}*|нужн\p{L}*|обязательн\p{L}*|принципиальн\p{L}*)[^.!?]{0,32}(?:тишин\p{L}*|тих\p{L}*)/iu.test(lower) ||
    /(?:тишин\p{L}*|тих\p{L}+\s+(?:мест\p{L}*|район\p{L}*|двор\p{L}*))[^.!?]{0,40}не\s+(?:явля\p{L}*\s+требован\p{L}*|счита\p{L}*\s+требован\p{L}*)/iu.test(lower) ||
    /не\s+(?:тишин\p{L}*|тих\p{L}+\s+(?:мест\p{L}*|район\p{L}*|двор\p{L}*))[^.!?]{0,24}(?:главн\p{L}*|важн\p{L}*|требован\p{L}*)/iu.test(lower) ||
    /(?:слишком\s+)?тих\p{L}*[^.!?]{0,40}не\s+(?:хоч\p{L}*|нужн\p{L}*|подход\p{L}*|рассматрива\p{L}*)/iu.test(lower) ||
    /(?:^|[^\p{L}])не\s+(?:хоч\p{L}*|нужн\p{L}*|рассматрива\p{L}*)[^.!?]{0,40}(?:тишин\p{L}*|тих\p{L}*)/iu.test(lower);
  const quietIsExplicitlyNonHousing =
    /(?:для|на)\s+работ\p{L}*[^.!?]{0,48}(?:тишин\p{L}*|тих\p{L}*)[^.!?]{0,64}(?:дом\p{L}*|жиль\p{L}*|квартир\p{L}*)[^.!?]{0,32}(?:не\s+принципиальн\p{L}*|не\s+важн\p{L}*|не\s+обязательн\p{L}*)/iu.test(lower) ||
    /(?:тишин\p{L}*|тих\p{L}+\s+мест\p{L}*)[^.!?]{0,40}только\s+для\s+(?:офис\p{L}*|работ\p{L}*)[^.!?]{0,64}(?:дом\p{L}*|жиль\p{L}*|квартир\p{L}*)[^.!?]{0,32}не\s+относ\p{L}*/iu.test(lower);
  const quietEvidence = rejectsQuietAsHousingCriterion || quietIsExplicitlyNonHousing
    ? null
    : firstMatch(
      lower,
      /(?:(?:хоч\p{L}*|нужн\p{L}*|важн\p{L}*|критичн\p{L}*|ценю|предпочита\p{L}*|обязательн\p{L}*|принципиальн\p{L}*)[^.!?]{0,48}(?:тишин\p{L}*|тих\p{L}*)|(?:тишин\p{L}*|тих\p{L}*)[^.!?]{0,36}(?:важн\p{L}*|нужн\p{L}*|хоч\p{L}*|предпочита\p{L}*|обязательн\p{L}*|принципиальн\p{L}*)|(?:больше|скорее)\s+тишин\p{L}*|тишин\p{L}*\s*,?\s*но|(?:не\s+только|но\s+и)\s+тишин\p{L}*|тих\p{L}+\s+(?:мест|район|двор)|спокойн\p{L}+\s+(?:мест|район|двор|окруж)|без\s+шум\p{L}*|не\s+хоч\p{L}*[^.!?]{0,48}(?:рядом\s+с\s+)?шумн\p{L}*\s+(?:дорог\p{L}*|улиц\p{L}*|трасс\p{L}*|район\p{L}*)|шумн\p{L}*\s+(?:дорог\p{L}*|улиц\p{L}*|трасс\p{L}*)[^.!?]{0,36}не\s+(?:подход|подойд)\p{L}*)/iu,
    );
  addUniqueCriterion(
    out,
    'quiet',
    'Тишина / спокойное окружение',
    quietEvidence,
  );
  addUniqueCriterion(
    out,
    'project_level',
    'Уровень / класс проекта',
    firstMatch(lower, /(?:уровень\s+проект\p{L}*|проект\p{L}*\s+(?:нормальн|хорош|высок)\p{L}*\s+уровн\p{L}*|класс\s+проект\p{L}*)/iu),
  );
  const rejectsGenericView =
    /(?:^|[^\p{L}])вид(?:\s+из\s+окна)?[^.!?,;]{0,24}не\s*(?:важ\p{L}*|нуж\p{L}*|обязател\p{L}*|принципиал\p{L}*)/iu.test(lower) ||
    /(?:^|[^\p{L}])не\s+(?:важ\p{L}*|нуж\p{L}*|обязател\p{L}*|принципиал\p{L}*)[^.!?,;]{0,24}вид(?:\s+из\s+окна)?/iu.test(lower);
  const rejectsSeaView = rejectsGenericView ||
    /(?:вид\s+на\s+море|морск\p{L}*\s+вид|море\s+из\s+окна)[^.!?,;]{0,32}не\s*(?:важ\p{L}*|нуж\p{L}*|треб\p{L}*|обязател\p{L}*|принципиал\p{L}*)/iu.test(lower);
  const rejectsMountainView = rejectsGenericView ||
    /(?:вид\s+на\s+горы|горы\s+из\s+окна)[^.!?,;]{0,32}не\s*(?:важ\p{L}*|нуж\p{L}*|треб\p{L}*|обязател\p{L}*|принципиал\p{L}*)/iu.test(lower);
  const seaViewEvidence = rejectsSeaView
    ? null
    : firstMatch(lower, /(?:(?:боков\p{L}*\s+или\s+)?(?:хотя\s+бы\s+)?частичн\p{L}*\s+вид\p{L}*\s+на\s+море|прям\p{L}*\s+вид\s+на\s+море|панорамн\p{L}*\s+вид[^.!?]{0,16}на\s+море|вид\s+на\s+море|видеть\s+море\s+из\s+окна|(?:должн\p{L}*\s+быть\s+)?видно\s+море)/iu);
  const mountainViewEvidence = rejectsMountainView
    ? null
    : firstMatch(lower, /(?:вид\s+на\s+горы|видеть\s+горы\s+из\s+окна)/iu);
  const alternativeViewEvidence = rejectsGenericView || seaViewEvidence || mountainViewEvidence
    ? null
    : firstMatch(lower, /(?:либо\s+море\s*,?\s*либо\s+горы|море\s+или\s+горы)(?:[^.!?]{0,24}из\s+окна)?/iu);

  addUniqueCriterion(
    out,
    'sea_view',
    seaViewEvidence && /частичн/iu.test(seaViewEvidence)
      ? 'Частичный вид на море'
      : seaViewEvidence && /прям/iu.test(seaViewEvidence)
        ? 'Прямой вид на море'
        : 'Вид на море',
    seaViewEvidence,
  );
  addUniqueCriterion(
    out,
    'mountain_view',
    'Вид на горы',
    mountainViewEvidence,
  );
  addUniqueCriterion(
    out,
    'view',
    'Вид на море или горы',
    alternativeViewEvidence,
  );
  addUniqueCriterion(
    out,
    'view',
    'Видовые характеристики',
    rejectsGenericView || seaViewEvidence || mountainViewEvidence || alternativeViewEvidence
      ? null
      : firstMatch(lower, /(?:панорам\p{L}+\s+вид\p{L}*|красив\p{L}+\s+вид\p{L}*)/iu),
  );
  addUniqueCriterion(
    out,
    'floor',
    'Высокий этаж',
    firstMatch(lower, /(?:хоч\p{L}*|нужн\p{L}*|важн\p{L}*|предпочита\p{L}*)[^.!?]{0,24}высок\p{L}*\s+этаж\p{L}*/iu),
  );
  addUniqueCriterion(
    out,
    'kitchen',
    'Большая кухня-гостиная',
    firstMatch(lower, /(?:нужн\p{L}*|важн\p{L}*|хоч\p{L}*)[^.!?]{0,24}(?:больш\p{L}*|просторн\p{L}*)\s+кухн\p{L}*[-\s]?гостин\p{L}*/iu),
  );
  addUniqueCriterion(
    out,
    'terrace',
    'Просторная терраса / балкон',
    firstMatch(lower, /(?:без\s+(?:просторн\p{L}*|больш\p{L}*)\s+(?:террас\p{L}*|балкон\p{L}*)[^.!?]{0,32}не\s+рассматрива\p{L}*|(?:нужн\p{L}*|важн\p{L}*|хоч\p{L}*)[^.!?]{0,24}(?:просторн\p{L}*|больш\p{L}*)\s+(?:террас\p{L}*|балкон\p{L}*))/iu),
  );
  addUniqueCriterion(
    out,
    'parking',
    'Паркинг / машиноместо',
    firstMatch(lower, /(?:паркинг\p{L}*|парковк\p{L}*|машиномест\p{L}*)/iu),
  );
  addUniqueCriterion(
    out,
    'ready_finish',
    'Готовый ремонт / формат под ключ',
    firstMatch(lower, /(?:с\s+ремонт\p{L}*|под\s+ключ|заехать\s+и\s+жить|приехать\s+и\s+сразу\s+жить)/iu),
  );
  addUniqueCriterion(
    out,
    'family_layout',
    'Планировка и комфорт для семьи',
    firstMatch(
      lower,
      /(?:для\s+семьи|(?:удобн\p{L}*|функциональн\p{L}*|важн\p{L}*|принципиальн\p{L}*)[^.!?]{0,18}планировк\p{L}*|планировк\p{L}*[^.!?]{0,18}(?:удобн\p{L}*|функциональн\p{L}*|важн\p{L}*|принципиальн\p{L}*)|изолированн\p{L}+\s+комнат\p{L}*|личн\p{L}+\s+пространств\p{L}*)/iu,
    ),
  );

  // A broad "everything matters" statement is not a concrete criterion by itself.
  // Keep only explicitly named dimensions above.
  return out;
}

// Orientation asks where the client is in the property search, not about any
// arbitrary activity's stage. Share this meaning with SPIN and dialogue policy.
export const searchOrientationQuestionPattern = /(?:как\s+вообще[^?]{0,40}рынк|давно.*(?:рассматрива|присматрива|отслежива)|интерес\s+появил\p{L}*\s+недавно|только.*(?:начал|начала|начали|изуча).*рын|на\s+каком.*этап.*рын|уже\s+сравниваете\s+конкретн.*вариант|на\s+как(?:ом|ой)[^.!]{0,35}(?:этап\p{L}*|стади\p{L}*)[^.!]{0,110}(?:поиск\p{L}*\s+(?:недвижимост\p{L}*|квартир(?:а|ы|у|е|ой|ам|ах)?(?!\p{L})|дом(?:а|ов|у|ом|е)?(?!\p{L})|объект(?:а|ов|ы|у|е|ом|ам|ах)?(?!\p{L}))|рынк\p{L}*|присматрива\p{L}*|смотреть\s+конкретн\p{L}*\s+объект\p{L}*)|(?:присматрива\p{L}*|изуча\p{L}*\s+рынок)[^.!?]{0,40}или[^.!?]{0,50}(?:смотр\p{L}*|езд\p{L}*)[^.!?]{0,30}(?:объект\p{L}*|квартир\p{L}*|конкретн\p{L}*\s+вариант\p{L}*))/iu;

export function isSearchOrientationQuestion(text: string): boolean {
  return searchOrientationQuestionPattern.test((text || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е'));
}

function isContextualClientSearchAnswer(text: string, quote: string, index = text.indexOf(quote)): boolean {
  const before = text.slice(0, index);
  const sentence = before.split(/[.!?;]/u).at(-1) || '';
  if (/(?:^|\s)бы(?:\s|$)/iu.test(sentence)) return false;
  const clauses = before.split(/[.!?;]|\s+(?:но|а|зато)\s+/u);
  const prefix = clauses.at(-1)!.trim();
  if (clauses.length > 1 && !/^(?:я|мы)(?:\s|,|$)/iu.test(prefix)) {
    // A conjunction inherits the earlier subject. Only an explicit client
    // subject can reset somebody else's scope; implicit earlier clauses must
    // themselves describe the client's actual search, not a hypothetical.
    const clientSearchClause = /^(?:(?:я|мы|уже|вчера|позавчера|раньше|сначала|пока|еще|просто|только|ну|честно|да|нет|вообще)\s*[,—-]?\s*)*(?:не\s+)?(?:смотрел\p{L}*|смотрю|ездил\p{L}*|сравнивал\p{L}*|был\p{L}*|изучал\p{L}*|изучаю|мониторю|читаю)/iu;
    if (clauses.slice(0, -1).some(clause => clause.replace(/[,\s]+/gu, '').length > 0 && !clientSearchClause.test(clause.trim()))) return false;
  }
  // An omitted subject can inherit the client's scope; an explicit other person
  // or hypothetical clause cannot. Do not guess ownership from names.
  return /^(?:(?:я|мы|уже|вчера|позавчера|раньше|сначала|пока|еще|просто|только|ну|честно|да|нет|вообще)\s*[,—-]?\s*)*$/iu.test(prefix);
}

function findContextualClientSearchAnswer(text: string, pattern: RegExp): RegExpMatchArray | null {
  for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))) {
    if (isContextualClientSearchAnswer(text, match[0], match.index)) return match;
  }
  return null;
}

export function detectSearchExperience(text: string, previousAgentTurnText = ''): SemanticSearchExperience | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  const lower = raw.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');

  const purchase = firstMatch(lower, /(?:уже\s+покупал\p{L}*\s+недвижимост\p{L}*|есть\s+опыт\s+покупк\p{L}*|не\s+первая\s+покупк\p{L}*)/iu);
  if (purchase) return { value: 'Есть опыт покупки недвижимости', evidenceQuote: purchase, level: 'purchase' };

  if (isSearchOrientationQuestion(previousAgentTurnText)) {
    const noViewingsAnswer = findContextualClientSearchAnswer(lower, /(?:пока\s+|ещ[её]\s+|вообще\s+)*не\s+(?:смотрел\p{L}*|ездил\p{L}*|был\p{L}*\s+на\s+просмотр\p{L}*)(?:\s+(?:квартир\p{L}*|объект\p{L}*|вариант\p{L}*|дом\p{L}*|жк|на\s+просмотр\p{L}*))?(?=\s*[,.!?;]|\s*$)/iu);
    if (noViewingsAnswer) {
      // A later voluntary viewing wins over historical absence; keep its own quote.
      const completed = detectSearchExperience(lower);
      if (completed?.level === 'viewings' && isContextualClientSearchAnswer(lower, completed.evidenceQuote)) return completed;
      const later = detectSearchExperience(lower.slice(noViewingsAnswer.index! + noViewingsAnswer[0].length), previousAgentTurnText);
      if (later && ['viewings', 'purchase'].includes(later.level)) return later;
      return { value: 'Изучает рынок; конкретные объекты ещё не смотрел', evidenceQuote: noViewingsAnswer[0], level: 'none' };
    }
  }

  // Completed actions and real-estate anchors are deliberately separate from
  // future intent ("посмотрю", "хочу посмотреть") and unrelated visual verbs.
  const viewings = firstSemanticMatch(lower, [
    /(?:был\p{L}*\s+(?:уже\s+)?на\s+(?:просмотр\p{L}*|показ\p{L}*)|ездил\p{L}*\s+(?:на\s+(?:просмотр\p{L}*|показ\p{L}*)|смотреть\s+(?:дом\p{L}*|квартир\p{L}*|апартамент\p{L}*|объект\p{L}*|жк)))/iu,
    /(?:посмотрел\p{L}*|смотрел\p{L}*|осмотрел\p{L}*|видел\p{L}*|увидел\p{L}*)\s+(?:(?:уже|всего)\s+)?(?:(?:один|одну|два|две|три|четыре|пять|пару|несколько|кучу)\s+)?(?:объект\p{L}*|вариант\p{L}*|жк|квартир\p{L}*|апартамент\p{L}*|дом\p{L}*|новостро\p{L}*|вторичк\p{L}*|комплекс\p{L}*)/iu,
    /(?:(?:один|одну|два|две|три|четыре|пять|пару|несколько|кучу)\s+)(?:объект\p{L}*|вариант\p{L}*|жк|квартир\p{L}*|апартамент\p{L}*|дом\p{L}*|новостро\p{L}*|комплекс\p{L}*)[^.!?]{0,32}(?:смотрел\p{L}*|видел\p{L}*|посетил\p{L}*)/iu,
    /(?:объехал\p{L}*|пересмотрел\p{L}*|сравнил\p{L}*)[^.!?]{0,24}(?:объект\p{L}*|вариант\p{L}*|жк|квартир\p{L}*|апартамент\p{L}*|дом\p{L}*|новостро\p{L}*|вторичк\p{L}*|комплекс\p{L}*)/iu,
    /(?:был\p{L}*|побывал\p{L}*)\s+(?:уже\s+)?в\s+(?:одном|двух|тр[её]х|четыр[её]х|пяти|нескольких)\s+(?:жк|комплекс\p{L}*|новостро\p{L}*)/iu,
    /(?:съездил\p{L}*|ездил\p{L}*)\s+в\s+(?:один|два|три|четыре|пять|несколько)\s+(?:жк|комплекс\p{L}*|новостро\p{L}*)/iu,
  ]);
  if (viewings) return { value: 'Есть опыт просмотров и сравнения объектов', evidenceQuote: viewings, level: 'viewings' };

  const remoteViewing = firstSemanticMatch(lower, [
    /(?:прош[её]л\p{L}*|был\p{L}*)[^.!?]{0,18}видеопоказ\p{L}*/iu,
    /(?:мне\s+)?(?:уже\s+)?показывал\p{L}*[^.!?]{0,28}(?:объект\p{L}*|вариант\p{L}*|квартир\p{L}*|апартамент\p{L}*|дом\p{L}*|жк)[^.!?]{0,18}(?:по\s+видео|онлайн)/iu,
    /смотрел\p{L}*\s+презентаци\p{L}*\s+(?:объект\p{L}*|вариант\p{L}*|проект\p{L}*)[^.!?]{0,32}(?:вместе\s+с|с)\s+(?:агент\p{L}*|менеджер\p{L}*)/iu,
  ]);
  if (remoteViewing) {
    return { value: 'Есть опыт видеопросмотра объектов; очный просмотр не подтверждён', evidenceQuote: remoteViewing, level: 'viewings' };
  }

  const digitalOnly = firstMatch(
    lower,
    /(?:(?:в\s+интернете|онлайн)\s+(?:смотрел\p{L}*|изучал\p{L}*)[^.!?]{0,45}(?:вживую|очно)[^.!?]{0,20}(?:ещ[её]\s+)?нет|(?:сравнивал\p{L}*|изучал\p{L}*|смотрел\p{L}*)\s+(?:объявлени\p{L}*|вариант\p{L}*)\s+онлайн[^.!?]{0,45}(?:на\s+просмотр\p{L}*|вживую|очно)[^.!?]{0,20}не\s+(?:был\p{L}*|ездил\p{L}*|смотрел\p{L}*)|(?:вживую|очно)[^.!?]{0,20}(?:ещ[её]\s+)?не\s+(?:смотрел\p{L}*|ездил\p{L}*)[^.!?]{0,45}(?:в\s+интернете|онлайн))/iu,
  );
  if (digitalOnly) return { value: 'Изучал варианты онлайн; очных просмотров ещё не было', evidenceQuote: digitalOnly, level: 'browsing' };

  // A full, self-contained no-viewings statement is semantic evidence too.
  // Short contextual answers ("нет", "ничего", "ещё не успел") stay outside
  // this extractor and continue to be handled by their separate dialogue branch.
  const noViewings = firstSemanticMatch(lower, [
    /(?:объект\p{L}*|вариант\p{L}*|квартир\p{L}*|апартамент\p{L}*|дом\p{L}*|новостройк\p{L}*|жк)\s+(?:ещ[её]\s+|пока\s+)?не\s+(?:смотрел\p{L}*|видел\p{L}*|посещал\p{L}*)/iu,
    /(?:пока\s+)?ни\s+одного\s+(?:объект\p{L}*|вариант\p{L}*|жк|квартир\p{L}*|апартамент\p{L}*|дом\p{L}*|новостройк\p{L}*)\s+не\s+(?:смотрел\p{L}*|видел\p{L}*|посещал\p{L}*)/iu,
    /что\s+(?:уже\s+)?смотрел\p{L}*\s*\?\s*(?:пока\s+)?(?:вообще\s+)?ничего/iu,
  ]);
  if (noViewings) {
    return { value: 'Изучает рынок; конкретные объекты ещё не смотрел', evidenceQuote: noViewings, level: 'none' };
  }

  const agentContact = firstMatch(
    lower,
    /(?:общал\p{L}*\s+с\s+(?:другим\s+)?агент\p{L}*|агент\p{L}*\s+(?:мне\s+)?(?:прислал\p{L}*|скинул\p{L}*|отправил\p{L}*)|присылал\p{L}*\s+(?:мне\s+)?(?:объект\p{L}*|вариант\p{L}*|подборк\p{L}*)|(?:открыва\p{L}*|смотр\p{L}*|получ\p{L}*)[^.!?]{0,25}(?:десят\p{L}*|много|кучу|\d+)[^.!?]{0,15}презентаци\p{L}*|презентаци\p{L}*[^.!?]{0,30}(?:в\s+вацап\p{L}*|в\s+ватсап\p{L}*|много|штук|десят\p{L}*)|(?:кучу|много|десят\p{L}*|штук\s+\d+)\s+(?:объект\p{L}*|вариант\p{L}*|презентаци\p{L}*))/iu,
  );
  if (agentContact) return { value: 'Есть опыт работы с агентами / получения подборок', evidenceQuote: agentContact, level: 'agent_contact' };

  const browsing = firstMatch(
    lower,
    /(?:смотрю\s+(?:рынок|недвижимост|вариант)|изучаю\s+рынок|присматриваюсь|прицениваюсь|только\s+начал\p{L}*\s+(?:изуча\p{L}*|смотре\p{L}*)\s+(?:рынок|недвижимост|вариант\p{L}*)|(?:уже\s+)?(?:месяц|полтора\s+месяца)[^.!?]{0,25}(?:смотр\p{L}*|изуча\p{L}*|ковыря\p{L}*)|смотрю\s+где-то\s+\p{L}+\s+месяц\p{L}*)/iu,
  );
  if (browsing) return { value: 'Изучает рынок / находится в процессе выбора', evidenceQuote: browsing, level: 'browsing' };

  // Elliptical answers inherit the property-search scope only from the current
  // orientation question. They do not turn unrelated monitoring or a purchase
  // postponement into an answered search stage.
  if (!isSearchOrientationQuestion(previousAgentTurnText)) return null;
  if (/(?:сервер|телевизор|книг|на\s+работе|рабоч\p{L}*|фильм|погод|новост\p{L}*\s+политик|акци\p{L}*\s+на\s+бирж)/iu.test(lower) ||
      /(?:покупк\p{L}*[^.!?]{0,45}(?:откладыва\p{L}*|отлож\p{L}*|перенос\p{L}*)|(?:откладыва\p{L}*|отлож\p{L}*|перенос\p{L}*)[^.!?]{0,45}покупк\p{L}*|сейчас\s+не\s+готов\p{L}*[^.!?]{0,35}(?:покуп|принимать\s+решени))/iu.test(lower)) return null;

  if (/не\s+сравнивал\p{L}*/iu.test(lower)) return null;
  const contextualViewings = findContextualClientSearchAnswer(lower, /(?:уже\s+)?(?:ездил\p{L}*|смотрел\p{L}*|сравнивал\p{L}*)(?:\s*[,;]\s*|\s+)(?:сравнивал\p{L}*\s+)?(?:несколько|пару|вариант\p{L}*)(?=\s*[,.!?;]|\s*$)/iu);
  if (contextualViewings) return { value: 'Есть опыт просмотров и сравнения объектов', evidenceQuote: contextualViewings[0], level: 'viewings' };

  if (/не\s+(?:монитор\p{L}*|смотрю|читаю|изучаю)/iu.test(lower)) return null;
  const contextualBrowsing = findContextualClientSearchAnswer(lower, /(?:мониторю|мониторим|смотрю\s*,?\s*читаю|(?:просто|пока|только)\s+(?:смотрю|читаю|изучаю))(?:\s+(?:рынок|недвижимост\p{L}*|объявлени\p{L}*|вариант\p{L}*))?(?=\s*[,.!?;]|\s*$|\s+(?:но|пока)\s)/iu);
  if (contextualBrowsing) return { value: 'Изучает рынок / находится в процессе выбора', evidenceQuote: contextualBrowsing[0], level: 'browsing' };

  return null;
}

/**
 * A short answer about available capital may semantically close the first-payment
 * readiness question even when the client does not repeat the words "ПВ".
 */
export function detectFundsAvailability(
  text: string,
  previousAgentTurnText = '',
  immediateAgentTurnText = previousAgentTurnText,
): { value: string; evidenceQuote: string; needsClarification: boolean; comment: string; cancelsDownPayment?: boolean } | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  const lower = raw.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const prev = (previousAgentTurnText || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const mentionsDownPayment = /(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*|первого\s+платежа/iu;
  const asksReadiness = mentionsDownPayment.test(prev) && /(?:есть|доступн\p{L}*|сформирован\p{L}*|на\s+руках)/iu.test(prev);
  const asksFundsSource = /(?:средств\p{L}*|деньг\p{L}*)[^.!?]{0,36}(?:на\s+руках|продаж\p{L}*|вклад\p{L}*|актив\p{L}*)|(?:источник|откуда)[^.!?]{0,28}(?:средств\p{L}*|денег)/iu.test(prev);

  // Absence is a DP cancellation, not missing evidence. Keep the predicate
  // bound to DP itself so an unrelated "документов нет" cannot clear it.
  const dpLabel = String.raw`(?:первоначальн\p{L}*|перв\p{L}*)\s+(?:взнос\p{L}*|плат[её]ж\p{L}*)`;
  const timing = String.raw`(?:(?:сейчас|пока|ещ[её]|уже|больше|теперь|у\s+(?:меня|нас))\s+)*`;
  const amount = String.raw`(?:\d+(?:[.,]\d+)?\s*(?:млн|миллион\p{L}*|тыс\p{L}*|%|руб\p{L}*)\s*)?`;
  const absence = String.raw`(?:нет|не\s+(?:сформирован\p{L}*|готов(?:а|о|ы)?|доступ(?:ен|на|но|ны)))`;
  const immediate = (immediateAgentTurnText || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const immediateReadiness = new RegExp(dpLabel, 'iu').test(immediate) && /(?:есть|доступн\p{L}*|сформирован\p{L}*|на\s+руках)/iu.test(immediate);
  const cancellationMatch = lower.match(new RegExp(
    String.raw`${dpLabel}\s+${amount}${timing}${absence}(?=$|[^\p{L}])|нет\s+${timing}(?:денег|средств)\s+(?:на|для)\s+${dpLabel}|(?:денег|средств)\s+(?:на|для)\s+${dpLabel}\s+${timing}${absence}(?=$|[^\p{L}])`,
    'iu',
  ));
  const cancellationPrefix = cancellationMatch ? lower.slice(0, cancellationMatch.index).split(/[.!?;]/u).at(-1) || '' : '';
  const nonClientAssertion = /(?:если|допустим|предположим)(?=$|[^\p{L}])|(?:у|для)\s+(?:(?:моего|моей|нашего|нашей)\s+)?(?:брата|сестры|друга|подруги|родителей)(?=$|[^\p{L}])/iu.test(cancellationPrefix);
  const cancelsDownPayment = Boolean(cancellationMatch && !nonClientAssertion) ||
    (immediateReadiness && /^(?:нет|пока\s+нет|не\s+сформирован\p{L}*)[.!]?$/iu.test(lower));
  if (cancelsDownPayment) {
    return {
      value: 'Средства на первоначальный взнос сейчас отсутствуют',
      evidenceQuote: raw,
      needsClarification: false,
      comment: 'Клиент явно отменил текущую готовность первоначального взноса.',
      cancelsDownPayment: true,
    };
  }

  // A concrete amount is handled by the amount extractor. Do not also emit a
  // generic readiness fact for the same evidence.
  const hasExplicitAmount =
    /(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*\s*(?:(?:составля\p{L}*|будет|примерно|около|в\s+размере)\s*)?\d+(?:[.,]\d+)?\s*(?:млн|миллион\p{L}*|тыс\p{L}*|%|руб)/iu.test(lower) ||
    /\d+(?:[.,]\d+)?\s*(?:млн|миллион\p{L}*|тыс\p{L}*|%|руб)\s+(?:на|для)\s+(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*/iu.test(lower);
  if (hasExplicitAmount) return null;

  const explicitNegative =
    /(?:пока\s+)?(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*[^.!?]{0,24}(?:нет|не\s+сформирован\p{L}*|не\s+готов\p{L}*)|(?:нет|не\s+хватает)[^.!?]{0,32}(?:денег|средств)[^.!?]{0,32}(?:на\s+)?(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*/iu.test(lower) ||
    (asksReadiness && /^(?:нет|пока\s+нет|не\s+сформирован\p{L}*)[.!]?$/iu.test(lower));
  if (explicitNegative) return null;

  const futureQuote = firstMatch(
    lower,
    /(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*[^.!?]{0,24}(?:будет|появится|сформиру\p{L}*)[^.!?]{0,28}(?:через|к)\s+[^.!?]+/iu,
  ) || (() => {
    const explicitDp = String.raw`(?:первоначальн|перв|стартов)\p{L}*\s+взнос\p{L}*`;
    const allocatedDp = String.raw`(?:(?:первоначальн|перв|стартов)\p{L}*\s+)?взнос\p{L}*`;
    const arrivalHead = String.raw`(?:(?:деньги|средства)\s+(?:на|для)\s+${allocatedDp}|(?:на|для)\s+${allocatedDp}\s+(?:деньги|средства)|${explicitDp})\s+(?:поступ(?:ят|ит)|появ(?:ятся|ится))\s+после\s+`;
    const match = lower.match(new RegExp(`${arrivalHead}[^.!?;]+`, 'iu'));
    if (!match) return null;
    const prefix = lower.slice(0, match.index).split(/[.!?;]/u).at(-1) || '';
    const clause = lower.slice(match.index).split(/[.!;]/u)[0] || '';
    if (/(?<!\p{L})не\s*$/iu.test(prefix) ||
      /(?<!\p{L})(?:если(?!\s+точнее\s*[:,])|допустим|предположим|не\s+(?:факт|думаю|считаю|уверен\p{L}*))(?=$|[^\p{L}])/iu.test(prefix) ||
      /(?<!\p{L})(?:у|для)\s+(?:(?:моего|моей|нашего|нашей)\s+)?(?:брата|сестры|друга|подруги|родителей)(?=$|[^\p{L}])/iu.test(`${prefix} ${clause}`) ||
      /\?/u.test(clause)) return null;
    // Remove every new arrival head before reusing the existing partial detector.
    // The remaining text cannot enter this alternative again, and retains partial
    // evidence in either clause order without duplicating FIX47's grammar.
    const withoutArrivals = lower.replace(new RegExp(arrivalHead, 'giu'), '');
    if (/доступна частично/iu.test(detectFundsAvailability(withoutArrivals, previousAgentTurnText, immediateAgentTurnText)?.value || '')) return null;
    return match[0];
  })();
  if (futureQuote) {
    return {
      value: 'Средства на первоначальный взнос будут доступны позже; сейчас готовность не подтверждена',
      evidenceQuote: futureQuote,
      needsClarification: true,
      comment: 'Клиент описал будущую, а не текущую доступность первоначального взноса.',
    };
  }

  const partialDpSubject = String.raw`часть\s+(?:(?:денег|средств)\s+(?:на|для)\s+)?${dpLabel}`;
  const collectedPartialQuote = firstMatch(lower, new RegExp(
    String.raw`(?:собрана|сформирована|подготовлена)\s+(?:(?:пока|уже|только|лишь)\s+)*${partialDpSubject}|${partialDpSubject}\s+(?:(?:пока|уже)\s+)*(?:собрана|сформирована|подготовлена)(?=$|[^\p{L}])|${dpLabel}\s+(?:(?:пока|уже)\s+)*(?:собран|сформирован|подготовлен)\s+(?:(?:только|лишь)\s+)?частично(?=$|[^\p{L}])`, 'iu',
  ));
  const partialStart = collectedPartialQuote ? lower.indexOf(collectedPartialQuote) : 0;
  const partialPrefix = lower.slice(0, partialStart).split(/[.!?;]/u).at(-1) || '';
  const partialSuffix = lower.slice(partialStart + (collectedPartialQuote?.length || 0)).split(/[.!;]/u)[0] || '';
  // Only assert current client funds; modal/negative predicates, foreign funds
  // and questions do not establish even partial readiness.
  const currentPartialQuote = collectedPartialQuote &&
    !/(?<!\p{L})(?:не|будет|будут|может|мог\p{L}*|должн\p{L}*|был[ао]?\s+бы)(?:\s+(?:бы|быть|был[ао]?|были|будет|будут|уже|пока))*\s*$/iu.test(partialPrefix) &&
    !/(?<!\p{L})(?:если(?!\s+точнее\s*[:,])|допустим|предположим)(?=$|[^\p{L}])/iu.test(partialPrefix) &&
    !/(?<!\p{L})(?:у|для)\s+(?:(?:моего|моей|нашего|нашей)\s+)?(?:брата|сестры|друга|подруги|родителей)(?=$|[^\p{L}])/iu.test(`${partialPrefix} ${partialSuffix}`) &&
    !/\?/u.test(partialSuffix)
      ? collectedPartialQuote : null;
  const partialQuote = currentPartialQuote || (asksReadiness
    ? firstMatch(lower, /^(?:да[,.]?\s*)?(?:только\s+)?частичн\p{L}*[.!]?$/iu)
    : firstMatch(lower, /част\p{L}*[^.!?]{0,24}(?:денег|средств)[^.!?]{0,40}(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*|(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*[^.!?]{0,40}част\p{L}*[^.!?]{0,20}(?:есть|доступн\p{L}*)/iu));
  if (partialQuote) {
    return {
      value: 'Часть средств на первоначальный взнос доступна частично; полная готовность требует уточнения',
      evidenceQuote: partialQuote,
      needsClarification: true,
      comment: 'Клиент подтвердил только частичную готовность первоначального взноса.',
    };
  }

  const explicitQuote = firstMatch(
    lower,
    /(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*[^.!?]{0,24}(?:уже\s+)?(?:есть|доступен\p{L}*|сформирован\p{L}*|готов\p{L}*)|на\s+(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*[^.!?]{0,24}(?:деньг\p{L}*|средств\p{L}*)[^.!?]{0,18}(?:есть|доступн\p{L}*|на\s+руках)|(?:деньг\p{L}*|средств\p{L}*)[^.!?]{0,24}(?:есть|доступн\p{L}*|на\s+руках)[^.!?]{0,60}(?:на\s+)?(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*/iu,
  );
  // Current readiness can name the allocated funds instead of a numeric DP.
  // Keep this grammar separate from cancellation, amount and future/partial
  // extraction, and require the readiness predicate next to its DP subject.
  const currentDpLabel = String.raw`(?:первоначальн\p{L}*|перв\p{L}*|стартов\p{L}*)\s+взнос\p{L}*`;
  const currentDpPredicate = String.raw`(?:есть|доступ(?:ен|на|но|ны)|сформирован(?:а|о|ы)?|подготовлен(?:а|о|ы)?|готов(?:а|о|ы)?|лежат\s+на\s+(?:счет\p{L}*|руках))`;
  const currentQuote = explicitQuote || firstMatch(lower, new RegExp(
    String.raw`${currentDpLabel}\s+(?:(?:деньг\p{L}*|средств\p{L}*)\s+)?(?:(?:уже|сейчас|у\s+(?:меня|нас))\s+)*${currentDpPredicate}(?=$|[^\p{L}])`, 'iu',
  ));
  const currentStart = currentQuote ? lower.indexOf(currentQuote) : 0;
  const currentPrefix = lower.slice(0, currentStart).split(/[.!?;]/u).at(-1) || '';
  const currentSuffix = lower.slice(currentStart + (currentQuote?.length || 0)).split(/[.!?;]/u)[0] || '';
  const currentReadyQuote = currentQuote &&
    !/(?<!\p{L})(?:часть|части|частью|частичн\p{L}*)\s+(?:(?:денег|средств)\s+(?:на|для)\s+)?$/iu.test(currentPrefix) &&
    !/(?<!\p{L})(?:часть|части|частью|частичн\p{L}*|не|будут|будет)(?=$|[^\p{L}])/iu.test(currentQuote) &&
    !/^\s*,?\s*(?:но\s+)?(?:(?:только|лишь)\s+част|не\s+(?:все|полностью))/iu.test(currentSuffix) &&
    !/(?<!\p{L})(?:только|лишь)\s+(?:часть|половин\p{L}*)|(?<!\p{L})остальн\p{L}*\s+(?:(?:деньг|средств|сумм)\p{L}*\s+)?буд(?:ет|ут)/iu.test(currentSuffix) &&
    (explicitQuote || (
      !/(?<!\p{L})(?:если(?!\s+точнее\s*[:,])|допустим|предположим|скоро|не)(?=$|[^\p{L}])|(?<!\p{L})(?:у|для)\s+(?:брата|сестры|друга|подруги|родителей)(?=$|[^\p{L}])/iu.test(currentPrefix) &&
      !/^\s*(?:через|после|к\s+|\d)/iu.test(currentSuffix) &&
      !/^\s*,?\s*(?:если|при\s+условии|(?:только\s+)?у\s+(?:брата|сестры|друга|подруги|родителей))(?=$|[^\p{L}])/iu.test(currentSuffix) &&
      !/^\s*\?/u.test(lower.slice(currentStart + currentQuote.length))
    )) ? currentQuote : null;
  const contextualQuote = asksReadiness
    ? firstMatch(lower, /^(?:да[,.]?\s*)?(?:в\s+целом\s+)?(?:уже\s+)?(?:есть|доступн(?:ы|а|о)|сформирован(?:ы|а|о)?)(?:\s*,\s*но[^.!?]{0,70})?[.!]?$/iu)
    : null;
  const sourceQuote = asksFundsSource
    ? firstMatch(lower, /(?:это\s+)?уже\s+на\s+руках|деньг\p{L}*[^.!?]{0,18}(?:есть|лежат|на\s+руках)|средств\p{L}*[^.!?]{0,18}(?:есть|на\s+руках)|продавать\s+ничего\s+не\s+планирую/iu)
    : null;
  const quote = currentReadyQuote || contextualQuote || sourceQuote;
  if (!quote) return null;
  return {
    value: 'Средства доступны на первоначальный взнос; точный размер не назван',
    evidenceQuote: quote,
    needsClarification: !sourceQuote,
    comment: 'Готовность средств подтверждена, но точный размер первоначального взноса не назван.',
  };
}

/**
 * Resolve explicit decision authority without treating an unrelated "сам" as
 * sole-decision evidence. Shared/joint authority wins over a nearby solo
 * viewing phrase because it describes who actually approves the purchase.
 */
export function detectDecisionMaker(text: string): SemanticDecisionMaker | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  const lower = raw.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const participant = '(?:жен\\p{L}*|муж\\p{L}*|супруг\\p{L}*|семь\\p{L}*|(?:делов\\p{L}*\\s+)?партнер\\p{L}*|(?:делов\\p{L}*\\s+)?партнёр\\p{L}*|отец|отц\\p{L}*|мать|матер\\p{L}*|родител\\p{L}*)';

  if (
    /(?:пока\s+)?не\s+знаю[^.!?]{0,55}кто[^.!?]{0,45}(?:принима\p{L}*|будет\s+принима\p{L}*|реша\p{L}*)[^.!?]{0,30}решен\p{L}*/iu.test(lower) ||
    /(?:решен\p{L}*|кто\s+реша\p{L}*)[^.!?]{0,45}(?:пока\s+)?не\s+(?:ясн\p{L}*|определен\p{L}*|решен\p{L}*)/iu.test(lower)
  ) return null;

  const thirdParty = firstMatch(
    lower,
    new RegExp(
      `(?:последн\\p{L}*|финальн\\p{L}*|окончательн\\p{L}*)\\s+слово[^.!?]{0,24}(?:будет\\s+)?за\\s+${participant}` +
      `|(?:финальн\\p{L}*\\s+)?решен\\p{L}*\\s+(?:будет\\s+)?за\\s+${participant}` +
      `|${participant}[^.!?]{0,40}(?:принима\\p{L}*\\s+(?:финальн\\p{L}*\\s+)?решен\\p{L}*|реша\\p{L}*\\s+окончательно|окончательно\\s+утверд\\p{L}*|утверд\\p{L}*\\s+вариант\\p{L}*)` +
      `|(?:оплачива\\p{L}*|финансиру\\p{L}*)[^.!?]{0,24}${participant}[^.!?]{0,35}(?:он|она)\\s+(?:и\\s+)?(?:окончательно\\s+)?утверд\\p{L}*`,
      'iu',
    ),
  );
  if (thirdParty) {
    return {
      kind: 'third_party',
      value: 'Финальное решение принимает супруг / другой участник',
      evidenceQuote: thirdParty,
    };
  }

  const participantExited = new RegExp(
    `${participant}[^.!?]{0,28}(?:вышел\\p{L}*|выбыл\\p{L}*|не\\s+участву\\p{L}*)[^.!?]{0,24}(?:из\\s+сделк\\p{L}*|в\\s+решен\\p{L}*)`,
    'iu',
  ).test(lower);
  const joint = participantExited ? null : firstMatch(
    lower,
    new RegExp(
      `(?:финальн\\p{L}*|окончательн\\p{L}*)?\\s*решен\\p{L}*[^.!?]{0,20}(?:принима\\p{L}*|утвержда\\p{L}*)[^.!?]{0,20}(?:всей\\s+семь\\p{L}*|вместе\\s+с\\s+${participant})` +
      `|(?:решен\\p{L}*(?:\\s+о\\s+покупк\\p{L}*)?\\s+принима\\p{L}*|принима\\p{L}*\\s+решен\\p{L}*)[^.!?]{0,32}(?:(?:вместе|вдвоем)(?:\\s+с\\s+${participant})?|с\\s+${participant})` +
      `|(?:выбира\\p{L}*|реша\\p{L}*|утвержда\\p{L}*)[^.!?]{0,30}(?:(?:вместе|вдвоем)(?:\\s+с\\s+${participant})?|с\\s+${participant}|(?:всей\\s+)?семь\\p{L}*)` +
      `|(?:финальн\\p{L}*\\s+)?решен\\p{L}*[^.!?]{0,20}(?:прим\\p{L}*|утверд\\p{L}*)[^.!?]{0,16}(?:всей\\s+)?семь\\p{L}*` +
      `|(?:без\\s+(?:одобрени\\p{L}*|согласи\\p{L}*)\\s+${participant}|без\\s+(?:него|нее))[^.!?]{0,45}(?:не\\s+утвержда\\p{L}*|решен\\p{L}*\\s+не\\s+принима\\p{L}*|объект\\p{L}*\\s+не\\s+утвержда\\p{L}*)` +
      `|(?:обс(?:уд|ужд)\\p{L}*|совет\\p{L}*|соглас\\p{L}*)[^.!?]{0,28}(?:с\\s+)?${participant}` +
      `|${participant}[^.!?]{0,40}(?:тоже\\s+)?(?:реша\\p{L}*|участву\\p{L}*\\s+в\\s+(?:решен\\p{L}*|выбор\\p{L}*))` +
      `|(?:я\\s+и\\s+${participant}|${participant}\\s+и\\s+я)[^.!?]{0,35}(?:вместе\\s+)?(?:реша\\p{L}*|утвержда\\p{L}*)` +
      `|в\\s+сделк\\p{L}*[^.!?]{0,35}(?:я[^.!?]{0,12}(?:и|с)\\s+${participant}|${participant}[^.!?]{0,12}(?:и|со?)\\s+мной)`,
      'iu',
    ),
  );
  if (joint) {
    const jointValue = /партнер|партнёр/iu.test(joint)
      ? 'Совместно с деловым партнёром'
      : /родител|отц|мать|матер/iu.test(joint)
        ? 'Совместно с родителями / семьёй'
        : 'Совместно с супругом / семьёй';
    return {
      kind: 'joint',
      value: jointValue,
      evidenceQuote: joint,
    };
  }

  const sole = firstMatch(
    lower,
    /(?:сам|сама)\s+принима\p{L}*\s+(?:финальн\p{L}*\s+)?решен\p{L}*|решен\p{L}*[^.!?]{0,24}(?:принима\p{L}*|реша\p{L}*)\s+(?:только\s+я|я(?:\s+(?:самостоятельно|сам|сама))?|самостоятельно|сам|сама)|покупк\p{L}*\s+(?:принима\p{L}*|реша\p{L}*)\s+(?:только\s+я|я(?:\s+(?:самостоятельно|сам|сама))?|самостоятельно|сам|сама)|(?:реша\p{L}*|выбира\p{L}*)[^.!?]{0,20}буду\s+я\s+(?:сам|сама)|решаю\s+(?:я\s+)?(?:самостоятельно|сам|сама)|(?:последн\p{L}*|финальн\p{L}*|окончательн\p{L}*)\s+(?:решен\p{L}*|слово)[^.!?]{0,24}(?:мо[её]|за\s+мной|оста\p{L}*\s+за\s+мной)|решен\p{L}*[^.!?]{0,16}(?:полностью\s+)?за\s+мной|(?:(?:покупк\p{L}*|объект\p{L}*)\s+утвержда\p{L}*|утвержда\p{L}*\s+(?:покупк\p{L}*|объект\p{L}*))\s+(?:самостоятельно|сам|сама|лично)|(?:ничь\p{L}*\s+одобрени\p{L}*\s+не\s+требу\p{L}*|согласовыва\p{L}*[^.!?]{0,20}ни\s+с\s+кем\s+не\s+(?:нужн\p{L}*|требу\p{L}*))|(?:супруг\p{L}*|жен\p{L}*|муж\p{L}*|партнер\p{L}*|партнёр\p{L}*)[^.!?]{0,30}переда\p{L}*[^.!?]{0,24}(?:решен\p{L}*|выбор\p{L}*)\s+мне|(?:один|одна)\s+выбира\p{L}*/iu,
  );
  if (!sole) return null;
  return {
    kind: 'sole',
    value: 'Принимает решение самостоятельно',
    evidenceQuote: sole,
  };
}

export function detectAdultChildren(text: string): { value: string; evidenceQuote: string } | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  const lower = raw.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');

  const explicit = firstMatch(lower, /(?:дети\s+(?:у\s+меня\s+)?(?:уже\s+)?взросл\p{L}*|совершеннолетн\p{L}+\s+дет\p{L}*|дети\s+совершеннолетн\p{L}*|дети\s+живут\s+отдельно)/iu);
  if (explicit) {
    return {
      value: 'Дети взрослые / совершеннолетние (семейная ипотека по возрасту не применима)',
      evidenceQuote: explicit,
    };
  }

  const mentionsChildren = /(?:дети|ребенок|ребёнок|сын|дочь|дочери)/iu.test(lower);
  if (!mentionsChildren) return null;
  const ages = Array.from(lower.matchAll(/(?:^|[^\d])(1[89]|[2-9]\d)\s*(?:лет|года?)(?=$|[^\p{L}\p{N}])/giu));
  if (ages.length === 0) return null;
  return {
    value: 'Дети взрослые / совершеннолетние (семейная ипотека по возрасту не применима)',
    evidenceQuote: ages[0][0].trim(),
  };
}

/**
 * Trust question classifier shared by UI quality scoring. It deliberately works
 * with intent families instead of exact script strings, so an agent can phrase
 * the question naturally.
 */
export function classifyTrustQuestion(text: string): TrustQuestionKind {
  const raw = (text || '').trim();
  if (!raw) return null;
  const lower = raw.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const normalized = normalizeRussianText(lower);
  const looksLikeQuestion = raw.includes('?') || /^(?:а\s+)?(?:что|как|какой|какая|какие|почему|где|когда|сколько|расскажите|подскажите|чем)/iu.test(lower);
  if (!looksLikeQuestion) return null;

  // Personal/contextual questions build rapport by exploring the person and
  // their lived scenario, not only transaction parameters.
  if (
    /(?:что\s+(?:вам|тебе)\s+(?:обычно\s+)?(?:нравится|запомнилось)|как\s+(?:обычно\s+)?(?:проводите|отдыхаете|путешествуете)|когда\s+(?:вы\s+)?(?:в\s+)?(?:последний\s+раз\s+)?были\s+в\s+сочи|как\s+вам\s+(?:вообще\s+)?сочи|почему\s+(?:решили|выбрали).*сочи|как\s+часто\s+бываете|с\s+кем\s+(?:обычно\s+)?приезжаете|кто\s+будет\s+пользоваться|чем\s+(?:вы\s+)?занимаетесь|в\s+какой\s+сфере|как\s+давно\s+в\s+(?:этой\s+)?профессии|что\s+нравится\s+в\s+вашей\s+работе|чем\s+увлекаетесь|свободное\s+время|как\s+любите\s+проводить\s+время|что\s+для\s+(?:вас|вашей\s+семьи).*важно|какой\s+отдых.*комфорт)/iu.test(lower)
  ) {
    return 'personal';
  }

  // Technical/open exploration: needs, use case, criteria, location, format,
  // previous search, pain, consequence, expected result.
  if (
    /(?:для\s+чего|под\s+какую\s+задачу|какая\s+цель|что\s+хотите\s+получить|как\s+планируете\s+использовать|какой\s+формат|квартира\s+или\s+апартаменты|сколько\s+комнат|какая\s+площадь|что\s+для\s+вас\s+(?:важно|принципиально)|какие\s+(?:(?:два|три|2|3)\s+)?(?:критерии|критерия|требования|пожелания)|на\s+что\s+обращаете\s+внимание|какую\s+локацию|какой\s+район|какая\s+инфраструктура|что\s+уже\s+(?:успели\s+)?(?:посмотреть|смотреть)|что\s+(?:не\s+устроило|смущает|мешает|оттолкнуло)|что\s+вызывает.*сомнен|к\s+чему\s+это\s+приводит|как\s+это\s+влияет|что\s+из-за\s+этого\s+теряете|что\s+для\s+вас\s+изменится|какой\s+результат)/iu.test(lower)
  ) {
    return 'technical';
  }

  // Do not count closed financial/admin qualification as trust questions.
  if (/бюджет|первоначальн|взнос|ипотек|рассрочк|занятост|трудоустро|кто\s+принимает\s+решение|срок\s+покупк/iu.test(normalized)) return null;

  return null;
}
