import { detectNextStepResistance, nextStepResistanceReply, updateObjectionLifecycle } from './objectionEngine';
import { extractDeterministicFacts } from './deterministicFacts';
import eventRulesData from '../../conversation-events.json';
import {
  ActionType,
  CallStage,
  ClientBoundaryMode,
  ConversationEventRecord,
  ConversationEventType,
  ConversationState,
  DialogueControlState,
  MeetingConsentQuality,
  NextStepTarget,
  SuggestedReply,
  TranscriptTurn,
} from '../types';

interface EventRuleConfig {
  id: ConversationEventType;
  speaker: 'agent' | 'client' | 'any';
  priority: number;
  ruleId: string;
  actionType: ActionType;
  phrases: string[];
  suggestion: string;
  shortReason: string;
  suppressesAnalysis: boolean;
}

export interface ConversationEventDetection {
  type: ConversationEventType;
  priority: number;
  actionType: ActionType;
  ruleId: string | null;
  suggestedReply: string | null;
  shortReason: string;
  evidenceTurnId: string;
  evidenceQuote: string;
  suppressesAnalysis: boolean;
  stage: CallStage;
  closesMetric?: string | null;
  closesMetricLabel?: string | null;
  rejectedBranch?: string | null;
  nextStepTarget?: NextStepTarget | null;
  meetingConsentQuality?: MeetingConsentQuality;
  meetingContract?: {
    dateOrDay: string | null;
    time: string | null;
    channel: string | null;
    participants: string | null;
    expectedResult: string | null;
    durationMinutes?: number | null;
  } | null;
  timeContractSeconds?: number | null;
  boundaryMode?: Exclude<ClientBoundaryMode, 'none'>;
}

const EVENT_RULES = eventRulesData as EventRuleConfig[];

const normalize = (value: string): string =>
  value
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

const agreementIsConfirmed = (state: ConversationState): boolean =>
  state.nextStepAgreement?.status === 'agreed' || Boolean(state.agreedNextStep?.value);

const explicitAgreementCancellation = (text: string): boolean =>
  /(?:^|[.!?]\s*)(?:отменяем|отмена|созвон\p{L}*\s+отмен\p{L}*)|(?:сегодня|завтра|в\s+этот\s+раз)[^.!?]{0,35}(?:не\s+получится|не\s+смогу|неудобно|не\s+удобно)(?![^.!?]{0,55}(?:давайте|перенес\p{L}*|лучше|вместо))/iu.test(text);

const explicitAgreementDurationChange = (text: string): boolean =>
  /не\s+(?:\d{1,3}|\p{L}+)(?:\s*минут\p{L}*)?\s*[,;:-]?\s*а\s+(?:\d{1,3}|\p{L}+)\s*минут/iu.test(text);

const explicitAgreementChannelChange = (text: string): boolean =>
  /(?:лучше\s+)?не\s+(?:звонок|созвон|видео\p{L}*|встреч\p{L}*)\s*[,;:-]?\s*а\s+(?:видео\p{L}*|встреч\p{L}*|звонок|созвон)/iu.test(text);

const explicitAgreementReschedule = (text: string): boolean =>
  /(?:нет\s*[,;:-]?\s*)?(?:давайте\s+лучше|лучше|перенес\p{L}*|вместо)[^.!?]{0,55}(?:сегодня|завтра|послезавтра|после\s+\p{L}+|в\s+(?:\d{1,2}|\p{L}+))/iu.test(text);

const hasExplicitAgreementChange = (text: string): boolean =>
  explicitAgreementCancellation(text) ||
  explicitAgreementDurationChange(text) ||
  explicitAgreementChannelChange(text) ||
  explicitAgreementReschedule(text);

/** Acknowledges an already confirmed contract without replacing any of its fields. */
export function isAgreedNextStepReaffirmation(text: string, state: ConversationState): boolean {
  if (!agreementIsConfirmed(state) || hasExplicitAgreementChange(text)) return false;
  const normalized = normalize(text);
  const genericConfirmation = /^(?:хорошо\s*[,;:-]?\s*)?(?:да\s*[,;:-]?\s*)?(?:вс[её]\s+верно|договорились|так\s+и\s+остав(?:им|ляем|ляю)|после\s+семи|верно|хорошо)(?:\s*[,;:-]?\s*спасибо)?[.!]?$/iu.test(normalized);
  const existingAgreementReference = /(?:мы\s+)?уже\s+(?:это\s+)?(?:договорились|согласовали)|я\s+же\s+сказал|придержива\p{L}*\s+договор[её]нност|так\s+и\s+остав(?:им|ляем|ляю)/iu.test(normalized);
  return genericConfirmation || existingAgreementReference;
}

const includesConfiguredPhrase = (text: string, rule: EventRuleConfig): boolean =>
  rule.phrases.some((phrase) => text.includes(normalize(phrase)));

const matchesClientStop = (text: string, rule: EventRuleConfig): boolean => {
  const temporaryCallback = /не\s+звоните[^.!?]{0,55}(?:позвоните|перезвоните|наберите|свяжитесь)[^.!?]{0,30}(?:позже|вечером|завтра)/iu.test(text);
  if (temporaryCallback) return false;
  return includesConfiguredPhrase(text, rule) ||
    /(?:^|[^\p{L}\p{N}])(?:не\s+(?:звоните|связывайтесь)(?:\s+(?:мне|со\s+мной))?(?:\s+больше)?|больше\s+(?:мне\s+)?не\s+звоните|(?:удалите|уберите)\s+(?:мой\s+)?номер(?:\s+из\s+базы)?)(?=$|[^\p{L}\p{N}])/iu.test(text);
};

const hasBusinessTimeBoundary = (text: string): boolean => {
  const workLogistics = /(?:я\s+(?:сейчас\s+)?на\s+работе|(?:^|[.!?]\s*)на\s+работе[^.!?]{0,35}(?:коротко|быстро|по\s+делу)|у\s+меня\s+встреча\s+через\s+(?:\d+|пять|десять|пару)\s+минут)/iu.test(text);
  const brevityRequest = /(?:если\s+можно[^.!?]{0,20})?(?:давайте\s+)?(?:коротко(?:\s+и\s+по\s+делу)?|быстро\s+и\s+по\s+делу)|(?:лучше\s+)?ближе\s+к\s+сути/iu.test(text);
  const shortMeetingAgreement = /давайте\s+коротко\s+(?:созвон\p{L}*|посмотр\p{L}*|встрет\p{L}*)/iu.test(text);
  const limitedAvailability = /(?:времени\s+(?:немного|мало)|я\s+(?:сейчас\s+)?занят[^.!?]{0,28}(?:пару\s+минут|немного\s+времени)|сейчас\s+долго\s+говорить\s+не\s+могу)/iu.test(text);
  return workLogistics || (brevityRequest && !shortMeetingAgreement) || limitedAvailability;
};

/** Classifies the client's control over the current call, not incidental time wording. */
export function classifyClientBoundaryMode(value: string): ClientBoundaryMode {
  const text = normalize(value);
  const shortMeetingAgreement = /давайте\s+коротко\s+(?:созвон\p{L}*|посмотр\p{L}*|встрет\p{L}*)/iu.test(text);
  const defer =
    /перезвоните[^.!?]{0,45}(?:вечером|позже|завтра|после\s+\p{L}+|через\s+(?:\d+|\p{L}+)\s+(?:минут\p{L}*|час\p{L}*))|позвоните\s+(?:вечером|позже|завтра|после\s+\p{L}+|через\s+(?:\d+|\p{L}+)\s+(?:минут\p{L}*|час\p{L}*))|наберите[^.!?]{0,45}(?:вечером|позже|завтра|после\s+\p{L}+|через\s+(?:\d+|\p{L}+)\s+(?:минут\p{L}*|час\p{L}*))|давайте\s+(?:позже|потом|в\s+другой\s+раз)|сейчас\s+не\s+могу[^.!?]{0,50}(?:перезвон|позвон|набер|через)/iu.test(text);
  if (defer) return 'defer';

  const limitedWindow = !shortMeetingAgreement && (
    /(?:у\s+меня\s+(?:правда\s+)?(?:сейчас\s+)?(?:есть\s+)?(?:буквально\s+)?|буквально\s+|есть\s+)(?:пару|две|три|\d+)\s+минут(?:ы)?(?:\s+(?:есть|могу|можно))?/iu.test(text) ||
    /могу\s+(?:говорить\s+)?(?:буквально\s+)?(?:пару|две|три|\d+)\s+минут(?:ы)?/iu.test(text) ||
    /сейчас\s+могу\s+говорить\s+минуты?\s+(?:две|три|\d+)/iu.test(text) ||
    /пару\s+минут\s+у\s+меня\s+есть/iu.test(text) ||
    /(?:я\s+занят[^.!?]{0,25})?(?:но\s+)?пару\s+минут\s+есть/iu.test(text) ||
    /времени\s+(?:мало|немного)[^.!?]{0,35}(?:ближе\s+к\s+сути|коротко|быстро)/iu.test(text) ||
    /времени\s+(?:мало|немного)[^.!?]{0,35}(?:но\s+)?(?:пару|один|два|несколько)\s+вопрос\p{L}*\s+можно/iu.test(text) ||
    /(?:я\s+(?:сейчас\s+)?на\s+работе[^.!?]{0,45})?(?:давайте\s+)?(?:коротко|быстро)(?:\s+и\s+по\s+делу)?/iu.test(text) ||
    /(?:если\s+можно[^.!?]{0,20})(?:коротко|быстро|по\s+делу)/iu.test(text)
  );
  if (limitedWindow) return 'limited_active_window';

  const hardStop =
    /(?:^|[.!?]\s*)(?:не\s+могу\s+говорить|сейчас\s+(?:вообще\s+)?неудобно|мне\s+некогда|не\s+звоните\s+сейчас|я\s+занят[^.!?]{0,30}говорить\s+не\s+могу)(?:$|[.!?])/iu.test(text) ||
    /(?:говорить\s+(?:совсем\s+)?неудобно|на\s+разговор\s+времени\s+нет)/iu.test(text);
  if (hardStop) return 'hard_stop';

  return 'none';
}

const allowsBriefContinuation = (text: string): boolean =>
  classifyClientBoundaryMode(text) === 'limited_active_window';

const matchesTimeConstraint = (text: string, rule: EventRuleConfig): boolean =>
  includesConfiguredPhrase(text, rule) ||
  classifyClientBoundaryMode(text) !== 'none' ||
  hasBusinessTimeBoundary(text) ||
  /(?:говорить\s+(?:неудобно|не\s+могу)|на\s+разговор\s+времени\s+нет|давайте\s+(?:позже|потом|в\s+другой\s+раз)|я\s+(?:тороплюсь|занят[^.!?]{0,35}(?:наберите|перезвоните|позвоните)))/iu.test(text);

const matchesResearchMode = (text: string, rule: EventRuleConfig): boolean =>
  includesConfiguredPhrase(text, rule) ||
  /(?:сравнива\p{L}*\s+рынок|изуча\p{L}*\s+предложени\p{L}*)/iu.test(text);

const matchesSoftResistance = (text: string, rule: EventRuleConfig): boolean =>
  includesConfiguredPhrase(text, rule) ||
  /(?:не\s+хочу\s+сейчас(?:\s+это)?\s+обсуждать|давайте\s+не\s+будем\s+пока\s+углубляться|(?:^|[^\p{L}\p{N}])(?:сначала\s+)?сам\s+(?:посмотрю|изучу|разберусь)(?=$|[^\p{L}\p{N}])|встречу\s+пока\s+не\s+назначаем)/iu.test(text);

function hasMaterialRequestIntent(value: string): boolean {
  const text = normalize(value);
  const delivery = text.match(
    /(?:(?:пришл(?:ите|и|ете)|прислать)|скин(?:ьте|ь|уть|ете)|отправ(?:ьте|ь|ить|ите)|покаж(?:ите|и|ем|ешь|ете)|дайте|предостав(?:ьте|ить)|перешл(?:ите|ать))/iu,
  );
  const material = text.match(
    /(?:прайс\p{L}*|каталог\p{L}*|презентац\p{L}*|фото(?:граф\p{L}*)?|подборк\p{L}*|планировк\p{L}*|цен\p{L}*|вариант\p{L}*|материал\p{L}*)/iu,
  );
  if (delivery && material && Math.abs((delivery.index || 0) - (material.index || 0)) <= 65) return true;

  const viewableMaterial = /(?:фото(?:граф\p{L}*)?|планировк\p{L}*|каталог\p{L}*|презентац\p{L}*|подборк\p{L}*|вариант\p{L}*)/iu;
  return (
    /(?:фото(?:граф\p{L}*)?|планировк\p{L}*|каталог\p{L}*|презентац\p{L}*|подборк\p{L}*)[^.!?]{0,18}\sбы\s+(?:посмотр\p{L}*|получ\p{L}*|увид\p{L}*)/iu.test(text) ||
    /(?:можно|хочу|хотел(?:а|ось)?\s+бы)[^.!?]{0,22}(?:получить|посмотреть|увидеть|ознакомиться)[^.!?]{0,30}/iu.test(text) && viewableMaterial.test(text)
  );
}

const findConfig = (id: ConversationEventType): EventRuleConfig | undefined =>
  EVENT_RULES.find((rule) => rule.id === id);

const lastAgentBefore = (turn: TranscriptTurn, recentTurns: TranscriptTurn[]): TranscriptTurn | null => {
  const before = recentTurns.filter((candidate) => {
    if (candidate.id === turn.id || candidate.speaker !== 'agent') return false;
    if (typeof candidate.revision === 'number' && typeof turn.revision === 'number') {
      return candidate.revision < turn.revision;
    }
    return candidate.timestamp <= turn.timestamp;
  });
  return before.length > 0 ? before[before.length - 1] : null;
};

const configuredEvent = (
  config: EventRuleConfig,
  turn: TranscriptTurn,
  overrides: Partial<ConversationEventDetection> = {}
): ConversationEventDetection => ({
  type: config.id,
  priority: config.priority,
  actionType: config.actionType,
  ruleId: config.ruleId,
  suggestedReply: config.suggestion,
  shortReason: config.shortReason,
  evidenceTurnId: turn.id,
  evidenceQuote: turn.text,
  suppressesAnalysis: config.suppressesAnalysis,
  stage:
    config.id === 'CLIENT_STOP' || config.id === 'TIME_CONSTRAINT'
      ? 'next_step_agreement'
      : config.id === 'SOFT_RESISTANCE'
        ? 'objection_clarification'
        : config.id === 'NEXT_STEP_RESISTANCE'
          ? 'objection_clarification'
        : 'diagnostics',
  ...overrides,
});

const configuredSoftResistanceEvent = (
  config: EventRuleConfig,
  turn: TranscriptTurn,
  state: ConversationState,
): ConversationEventDetection => {
  const text = normalize(turn.text);
  const materialBoundary = hasMaterialRequestIntent(text);
  const discussionBoundary = /(?:не\s+хочу\s+сейчас(?:\s+это)?\s+обсуждать|давайте\s+не\s+будем\s+пока\s+углубляться)/iu.test(text);
  const selfServiceBoundary = /(?:^|[^\p{L}\p{N}])(?:сначала\s+)?сам\s+(?:посмотрю|изучу|разберусь)(?=$|[^\p{L}\p{N}])/iu.test(text);
  const alreadyCounted = (state.events || []).some(
    (event) => event.turnId === turn.id && event.type === 'SOFT_RESISTANCE'
  );
  const priorCount = Math.max(
    0,
    (state.dialogueControl?.softResistanceCount || 0) - (alreadyCounted ? 1 : 0)
  );
  const repeated = priorCount >= 1;
  const boundaryReply = materialBoundary
    ? repeated
      ? 'Понял. Отправлю конкретный материал без длинного опроса. Когда удобно коротко сверить выводы после просмотра?'
      : config.suggestion
    : discussionBoundary
      ? 'Понял, сейчас не углубляемся. Вернёмся к теме, когда вам будет удобно.'
      : selfServiceBoundary
        ? 'Понял. Посмотрите в удобном темпе; если понадобится, помогу сравнить конкретные варианты.'
        : repeated
          ? 'Понял. Не буду продолжать опрос; вернёмся к теме, когда вам будет удобно.'
          : config.suggestion;
  return configuredEvent(config, turn, {
    priority: repeated ? 97 : config.priority,
    ruleId: discussionBoundary
      ? 'soft_resistance_discussion'
      : selfServiceBoundary && !materialBoundary
        ? 'soft_resistance_self_service'
        : config.ruleId,
    suggestedReply: boundaryReply,
    shortReason: discussionBoundary
      ? 'Клиент не хочет продолжать текущую тему: останавливаем ветку без постоянного запрета на контакт.'
      : selfServiceBoundary && !materialBoundary
        ? 'Клиент хочет сначала разобраться самостоятельно: не продолжаем квалификацию и не давим следующим шагом.'
        : repeated
          ? 'Повторное мягкое сопротивление стало границей: материал и один конкретный возврат без дальнейшего опроса.'
          : config.shortReason,
    suppressesAnalysis: repeated,
  });
};

function extractCallbackTime(text: string): string | null {
  const match = text.match(
    /(?:(сегодня|завтра|послезавтра)\s*)?(?:ровно\s*)?(?:в\s*)?(\d{1,2})(?::|\s)(\d{2})/iu
  );
  if (match) {
    const day = match[1] ? `${match[1]} ` : '';
    return `${day}в ${match[2].padStart(2, '0')}:${match[3]}`;
  }
  const hourOnly = text.match(/(?:(сегодня|завтра|послезавтра)\s*)?(?:ровно\s*)?в\s*(\d{1,2})(?:\s*час(?:а|ов)?)?/iu);
  if (!hourOnly) return null;
  const day = hourOnly[1] ? `${hourOnly[1]} ` : '';
  return `${day}в ${hourOnly[2].padStart(2, '0')}:00`;
}

function extractCallbackSlots(text: string): string[] {
  const slots: string[] = [];
  const full = /(?:(сегодня|завтра|послезавтра)\s*)?(?:ровно\s*)?(?:в\s*)?(\d{1,2})(?::|\s)(\d{2})/giu;
  for (const match of text.matchAll(full)) {
    const day = match[1] ? `${match[1]} ` : '';
    slots.push(`${day}в ${match[2].padStart(2, '0')}:${match[3]}`);
  }
  const hourOnly = /(?:(сегодня|завтра|послезавтра)\s*)?(?:ровно\s*)?в\s*(\d{1,2})(?:\s*час(?:а|ов)?)?/giu;
  for (const match of text.matchAll(hourOnly)) {
    const day = match[1] ? `${match[1]} ` : '';
    slots.push(`${day}в ${match[2].padStart(2, '0')}:00`);
  }
  return Array.from(new Set(slots));
}

function extractPreferredCallbackTime(text: string): string | null {
  const preferred = text.match(
    /(?:удобнее|предпочту|предпочитаю|лучше|выбираю|давайте)\s+(?:(сегодня|завтра|послезавтра)\s*)?(?:ровно\s*)?(?:в\s*)?(\d{1,2})(?::|\s)(\d{2})/iu
  );
  if (preferred) {
    const day = preferred[1] ? `${preferred[1]} ` : '';
    return `${day}в ${preferred[2].padStart(2, '0')}:${preferred[3]}`;
  }
  return null;
}

function extractClock(text: string | null | undefined): string | null {
  if (!text) return null;
  const clock = text.match(/(?:^|[^\d])(\d{1,2}):(\d{2})(?=$|[^\d])/u);
  if (!clock) return null;
  return `в ${clock[1].padStart(2, '0')}:${clock[2]}`;
}

const CALLBACK_NUMBER_VALUES: Record<string, number> = {
  один: 1, одного: 1, два: 2, двух: 2, три: 3, трех: 3, трёх: 3,
  четыре: 4, четырех: 4, четырёх: 4, пять: 5, пяти: 5, шесть: 6,
  шести: 6, семь: 7, семи: 7, восемь: 8, восьми: 8, девять: 9,
  девяти: 9, десять: 10, десяти: 10, одиннадцать: 11, одиннадцати: 11,
  двенадцать: 12, двенадцати: 12,
};

const CALLBACK_NUMBER_PATTERN = String.raw`(?:\d{1,2}|один|одного|два|двух|три|тр[её]х|четыре|четыр[её]х|пять|пяти|шесть|шести|семь|семи|восемь|восьми|девять|девяти|десять|десяти|одиннадцать|одиннадцати|двенадцать|двенадцати)`;

function parseCallbackNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = normalize(value);
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) return numeric;
  return CALLBACK_NUMBER_VALUES[normalized] ?? null;
}

function extractCallbackDurationMinutes(text: string): number | null {
  const normalized = normalize(text);
  const correction = normalized.match(new RegExp(String.raw`не\s+${CALLBACK_NUMBER_PATTERN}(?:\s*минут\p{L}*)?\s*[,;:-]?\s*а\s+(${CALLBACK_NUMBER_PATTERN})\s*минут`, 'iu'));
  const correctedValue = parseCallbackNumber(correction?.[1]);
  if (correctedValue && correctedValue <= 180) return correctedValue;

  const reversed = normalized.match(new RegExp(String.raw`минут(?:ы|у)?\s+(?:на\s+)?(${CALLBACK_NUMBER_PATTERN})(?=$|[^\p{L}\p{N}])`, 'iu'));
  const reversedValue = parseCallbackNumber(reversed?.[1]);
  if (reversedValue && reversedValue <= 180) return reversedValue;

  const forward = new RegExp(String.raw`(${CALLBACK_NUMBER_PATTERN})\s*минут(?:ы|у)?(?=$|[^\p{L}\p{N}])`, 'giu');
  for (const match of normalized.matchAll(forward)) {
    const prefix = normalized.slice(Math.max(0, (match.index || 0) - 12), match.index || 0);
    if (/после\s*$/iu.test(prefix)) continue;
    const value = parseCallbackNumber(match[1]);
    if (value && value <= 180) return value;
  }
  return null;
}

function extractConversationalCallbackTiming(text: string): { dateOrDay: string | null; time: string | null } | null {
  const normalized = normalize(text);
  const explicitDay = normalized.match(/(?:^|[^\p{L}\p{N}])(сегодня|завтра|послезавтра)(?=$|[^\p{L}\p{N}])/iu)?.[1] || null;
  const after = normalized.match(new RegExp(String.raw`(?:часов?\s+)?после\s+(${CALLBACK_NUMBER_PATTERN})(?::(\d{2}))?`, 'iu'));
  if (after) {
    const rawHour = parseCallbackNumber(after[1]);
    const minute = Number(after[2] || 0);
    if (rawHour != null && rawHour >= 0 && rawHour <= 23 && minute >= 0 && minute <= 59) {
      const explicitMorning = /(?:утра|утром)/iu.test(normalized);
      const hour = !explicitMorning && rawHour >= 1 && rawHour <= 11 ? rawHour + 12 : rawHour;
      return {
        dateOrDay: explicitDay || 'сегодня',
        time: `после ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      };
    }
  }

  const at = normalized.match(new RegExp(String.raw`(?:^|[^\p{L}\p{N}])(?:сегодня\s+|завтра\s+|послезавтра\s+)?(?:ровно\s+)?в\s+(${CALLBACK_NUMBER_PATTERN})(?::(\d{2}))?`, 'iu'));
  if (at) {
    const rawHour = parseCallbackNumber(at[1]);
    const minute = Number(at[2] || 0);
    if (rawHour != null && rawHour >= 0 && rawHour <= 23 && minute >= 0 && minute <= 59) {
      const explicitMorning = /(?:утра|утром)/iu.test(normalized);
      const hour = !explicitMorning && rawHour >= 1 && rawHour <= 11 ? rawHour + 12 : rawHour;
      return {
        dateOrDay: explicitDay,
        time: `в ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      };
    }
  }

  if (/(?:сегодня\s+)?вечером/iu.test(normalized)) {
    return { dateOrDay: explicitDay || 'сегодня', time: 'вечером' };
  }
  return null;
}

function normalizeMeetingDeadline(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  const day = normalized.match(/(?:^|[^\p{L}\p{N}])(сегодня|завтра|послезавтра|понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресенье)(?=$|[^\p{L}\p{N}])/iu)?.[1] || null;
  const after = normalized.match(/после\s+(\d{1,2})(?::(\d{2}))?/iu);
  if (after) {
    const time = `после ${after[1].padStart(2, '0')}:${after[2] || '00'}`;
    return day ? `${day} ${time}` : time;
  }
  if (/вечером/iu.test(normalized)) return day ? `${day} вечером` : 'вечером';
  const clock = extractClock(normalized);
  if (day && clock) return `${day} ${clock}`;
  return clock || day || normalized;
}

function composeMeetingDeadline(dateOrDay: string | null, time: string | null): string | undefined {
  const day = dateOrDay?.trim() || null;
  return normalizeMeetingDeadline([day, time].filter(Boolean).join(' '));
}

function extractRejectedBranch(text: string): string | null {
  const lower = normalize(text);

  const directObjectRejections: Array<[RegExp, string]> = [
    [/(?:не\s+(?:хочу|рассматрива\p{L}*|нужен|нужна|подходит)\s+(?:вообще\s+)?)(дом|коттедж|вилл\p{L}*|таунхаус\p{L}*)/iu, 'дом'],
    [/(?:дом|коттедж|вилл\p{L}*|таунхаус\p{L}*)[^.!?]{0,18}не\s+(?:хочу|рассматрива\p{L}*|нужен|нужна|подходит)/iu, 'дом'],
    [/не\s+(?:хочу|рассматрива\p{L}*|нужн\p{L}*|подходит)[^.!?]{0,12}апартамент\p{L}*/iu, 'апартаменты'],
    [/не\s+(?:хочу|рассматрива\p{L}*|нужн\p{L}*|подходит)[^.!?]{0,12}квартир\p{L}*/iu, 'квартиру'],
    [/не\s+(?:хочу|рассматрива\p{L}*|нужн\p{L}*|подходит)[^.!?]{0,12}ипотек\p{L}*/iu, 'ипотеку'],
    [/не\s+(?:хочу|рассматрива\p{L}*|нужн\p{L}*|подходит)[^.!?]{0,12}рассроч\p{L}*/iu, 'рассрочку'],
  ];
  const exact = directObjectRejections.find(([pattern]) => pattern.test(lower));
  if (exact) return exact[1];
  const scoped: Array<[RegExp, string]> = [
    [/(?:красн(?:ую|ая|ой)?\s*полян\w*)[^.!?]{0,30}(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)|(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)[^.!?]{0,30}(?:красн(?:ую|ая|ой)?\s*полян\w*)/iu, 'Красная Поляна'],
    [/(?:сириус\w*)[^.!?]{0,30}(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)|(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)[^.!?]{0,30}(?:сириус\w*)/iu, 'Сириус'],
    [/(?:сочи)[^.!?]{0,30}(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)|(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)[^.!?]{0,30}(?:сочи)/iu, 'Сочи'],
    [/(?:апартамент\w*)[^.!?]{0,30}(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)|(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)[^.!?]{0,30}(?:апартамент\w*)/iu, 'апартаменты'],
    [/(?:ипотек\w*)[^.!?]{0,40}(?:не\s*(?:рассматрива\w*|собира\w*|хочу|нужн\w*)|отпал\w*|без)|(?:без|не\s*(?:рассматрива\w*|собира\w*|хочу|нужн\w*))[^.!?]{0,40}(?:ипотек\w*)|(?:^|[^\p{L}\p{N}])не\s+ипотек\w*\s*,?\s*а/iu, 'ипотеку'],
    [/(?:рассроч\w*)[^.!?]{0,30}(?:не\s*(?:рассматрива\w*|хочу|нужн\w*)|без)|(?:без|не\s*(?:рассматрива\w*|хочу|нужн\w*))[^.!?]{0,30}(?:рассроч\w*)/iu, 'рассрочку'],
    [/(?:дом|коттедж|вилл\w*|таунхаус\w*)[^.!?]{0,30}(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)|(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)[^.!?]{0,30}(?:дом|коттедж|вилл\w*|таунхаус\w*)/iu, 'дом'],
    [/(?:квартир\w*)[^.!?]{0,30}(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)|(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)[^.!?]{0,30}(?:квартир\w*)/iu, 'квартиру'],
    [/(?:виде\w*|видеосвяз\w*)[^.!?]{0,35}(?:не\s*(?:хочу|буду|выйду|нужн\w*)|без)|(?:без|не\s*(?:хочу|буду|выйду|нужн\w*))[^.!?]{0,35}(?:виде\w*|видеосвяз\w*)/iu, 'видеоформат'],
  ];
  return scoped.find(([pattern]) => pattern.test(lower))?.[1] || null;
}

function extractCorrection(text: string): string | null {
  // Require a real separator before the contrastive conjunction "а".
  // The previous pattern allowed zero whitespace and could treat the final "а"
  // inside words such as "инфраструктура" as the conjunction, producing false
  // FACT_CORRECTION events from ordinary negative statements.
  const direct = text.match(
    /(?:^|[^\p{L}\p{N}])не\s+(.{1,60}?)(?:,\s*|\s+)а\s+(.{1,80})(?:[.!?]|$)/iu
  );
  if (direct?.[2]) return direct[2].trim().replace(/[.!?]+$/u, '');
  const explicitRevision = text.match(/(?:^|[.!?]\s*)нет\s*,?\s*(?:вс[её]-?таки|в\s+итоге)\s+(.{2,100})/iu);
  if (explicitRevision?.[1]) return explicitRevision[1].trim().replace(/[.!?]+$/u, '');
  const changedPlans = text.match(/(?:^|[.!?]\s*)нет\s*,?\s*(планы\s+(?:изменил\p{L}*|поменял\p{L}*|ускорил\p{L}*|сдвинул\p{L}*)[^.!?]{0,100}(?:в\s+течение|через|до\s+конца|месяц\p{L}*|полгода|год\p{L}*))/iu);
  if (changedPlans?.[1]) return changedPlans[1].trim().replace(/[.!?]+$/u, '');
  const budgetIncrease = text.match(/(?:^|[.!?]\s*)нет\s*,?\s*((?:мож\p{L}*|готов\p{L}*)[^.!?]{0,30}(?:подняться|увеличить|расширить)[^.!?]{0,60})/iu);
  if (budgetIncrease?.[1]) return budgetIncrease[1].trim().replace(/[.!?]+$/u, '');
  const paymentRevision = text.match(
    /(?:способ\s+оплаты\s+меня\p{L}*\s*[:,-]?\s*(.{2,100})|ипотек\p{L}*[^.!?]{0,35}не\s+хоч\p{L}*\s*[,;:-]\s*(.{2,100})|(?:^|[.!?]\s*)нет\s*,?\s*((?:решил\p{L}*|буд\p{L}*|покуп\p{L}*|оплат\p{L}*)[^.!?]{0,100}(?:за\s+свои|собственн\p{L}*\s+средств\p{L}*|наличн\p{L}*))|((?:планы|схем\p{L}*)\s+(?:изменил\p{L}*|поменял\p{L}*)[^.!?]{0,100}(?:ипотек\p{L}*|рассроч\p{L}*|за\s+свои|собственн\p{L}*\s+средств\p{L}*))|(ипотек\p{L}*\s+отпал\p{L}*[^.!?]{0,100})|((?:теперь|вс[её]-?таки)\s+(?:выбира\p{L}*|бер\p{L}*|оформ\p{L}*)[^.!?]{0,80}(?:ипотек\p{L}*|рассроч\p{L}*))|(рассрочк\p{L}*[^.!?]{0,35}(?:не\s+нужн\p{L}*|неинтересн\p{L}*)[^.!?]{0,80}(?:заплач\p{L}*\s+сразу|наличн\p{L}*|собственн\p{L}*\s+средств\p{L}*)))/iu
  );
  const revisedPayment = paymentRevision?.slice(1).find(Boolean);
  if (revisedPayment) {
    return revisedPayment.trim().replace(/[.!?]+$/u, '');
  }
  const goalRevision = text.match(
    /(?:^|[.!?]\s*)\s*(?:(?:итак|смотрите|если\s+точнее|вообще|по\s+сути|на\s+данный\s+момент|скажу\s+прямо)\s*[:,]?\s*)?(?:(?:нет|уточню)\s*[,;:-]?\s*)?(?:(?:сдава\p{L}*|аренд\p{L}*)[^.!?]{0,35}не\s+(?:буд\p{L}*|хоч\p{L}*|планиру\p{L}*)\s*[,;:-]?\s*)?((?:планы\s+поменял\p{L}*|решил\p{L}*|передумал\p{L}*|переезжа\p{L}*)[^.!?]{0,100}(?:под\s+аренд\p{L}*|для\s+сдач\p{L}*|сдава\p{L}*|инвестиц\p{L}*|остав\p{L}*\s+себе|для\s+себя|жить\s+сам\p{L}*|жив\p{L}*\s+постоянно|мне\s+сам\p{L}*))/iu
  );
  if (goalRevision?.[1]) return goalRevision[1].trim().replace(/[.!?]+$/u, '');
  const clarification = text.match(/(?:вы\s+ошиблись|поправлю|уточню|точнее|я\s+оговорил(?:ся|ась))\s*[:,-]?\s*(.{2,100})/iu);
  return clarification?.[1]?.trim().replace(/[.!?]+$/u, '') || null;
}

function hasConfirmedFactReplacement(
  turn: TranscriptTurn,
  recentTurns: TranscriptTurn[],
  state: ConversationState,
): boolean {
  const facts = state.confirmedFacts || [];
  const linkedReplacement = facts.some((fact) => {
    if (fact.turnId !== turn.id || !fact.supersedesFactId || fact.lifecycleStatus !== 'confirmed') return false;
    const previous = facts.find((candidate) => candidate.id === fact.supersedesFactId);
    return Boolean(previous && previous.lifecycleStatus === 'superseded' && normalize(previous.value) !== normalize(fact.value));
  });
  if (linkedReplacement) return true;

  // Some direct callers ask for event detection before the current turn is
  // merged. In that boundary, compare the incoming deterministic fact with a
  // previously confirmed active fact from the same semantic category.
  const previousAgent = lastAgentBefore(turn, recentTurns);
  const incomingFacts = extractDeterministicFacts(turn.text, turn.id, previousAgent?.text || null);
  return incomingFacts.some((incoming) => facts.some((previous) =>
    previous.turnId !== turn.id &&
    previous.category === incoming.category &&
    previous.lifecycleStatus === 'confirmed' &&
    normalize(previous.value) !== normalize(incoming.value)
  ));
}

function hasDirectQuestion(text: string): boolean {
  const lower = normalize(text);
  const explicitQuestion = text.includes('?');
  const explicitInterrogativeLead = /^(сколько|где|почему|зачем|какой|какая|какие|кто|можно ли|есть ли|скажите|подскажите|уточните)(?=$|[^\p{L}\p{N}])/iu.test(lower);
  const spokenWhenQuestion = /^когда\s+(?:будет|будут|можно|смож\p{L}*|планиру\p{L}*|начн\p{L}*|законч\p{L}*|сдад\p{L}*|сдач\p{L}*|ключ\p{L}*|встреч\p{L}*|показ\p{L}*|созвон\p{L}*|удобн\p{L}*)/iu.test(lower);
  return (
    explicitQuestion ||
    explicitInterrogativeLead ||
    spokenWhenQuestion ||
    /(?:хочу|хотел|хотела|хотелось)\s+(?:бы\s+)?(?:узнать|понять)[^.!?]{0,70}(?:сколько|какая|какой|почему|зачем|что)/iu.test(lower) ||
    hasMaterialRequestIntent(lower) ||
    /(?:скин\p{L}*|пришл\p{L}*|отправ\p{L}*|покаж\p{L}*|дайте)\s+[^.!?]{0,45}(?:договор|расчет|расчёт|документ)/iu.test(lower)
  );
}

function isBarrierQuestion(text: string): boolean {
  const lower = normalize(text);
  return /(?:если[^?]{0,90}(?:меньше|хуже)[^?]{0,60}(?:зачем[^?]{0,45}менять\s+инструмент|депозит|банк)|(?:депозит|банк)[^?]{0,80}если[^?]{0,70}(?:меньше|хуже)|зачем[^?]{0,50}(?:менять\s+инструмент|покупать|брать)|не\s+вижу\s+смысла|где\s+гаранти)/iu.test(lower);
}

type DirectQuestionIntent =
  | 'meeting_time_confirmation'
  | 'documents'
  | 'financing'
  | 'price'
  | 'yield_comparison'
  | 'materials_request'
  | 'market_options'
  | 'property_details'
  | 'general';

function lastRelevantInterrogativeClause(text: string): string {
  const normalized = normalize(text);
  const throughQuestionMarks = normalized.split(/(?<=\?)/u);
  const lastQuestionSegment = throughQuestionMarks
    .filter((segment) => segment.trim().endsWith('?'))
    .at(-1);
  if (!lastQuestionSegment) return normalized;

  return lastQuestionSegment
    .split(/[.!;]\s*/u)
    .filter(Boolean)
    .at(-1)
    ?.trim() || normalized;
}

function classifyDirectQuestionIntent(text: string, previousAgentText: string | null): DirectQuestionIntent {
  const questionClause = lastRelevantInterrogativeClause(text);
  const previous = normalize(previousAgentText || '');
  const combined = `${previous} ${questionClause}`;

  if (
    /(?:подойд[её]т|удобно|удобнее|можем|давайте).{0,25}(?:сегодня|завтра|послезавтра|\d{1,2}[:.]\d{2})/iu.test(questionClause) ||
    (/(?:сегодня|завтра|послезавтра|\d{1,2}[:.]\d{2})/u.test(questionClause) && /видео|показ|созвон|встреч/iu.test(combined))
  ) return 'meeting_time_confirmation';
  if (/документ|дду|договор|выписк|разрешен|эскроу|земл|214[-\s]?фз/iu.test(questionClause)) return 'documents';
  if (/(?:сколько|какая|какой).{0,25}(?:стоит|цена|стоимость)|(?:цена|стоимость).{0,25}(?:сколько|какая|какой)/iu.test(questionClause)) return 'price';
  if (/(?:доходност|окупаем|депозит|денежн\p{L}*\s+поток|сколько.{0,35}(?:получить|заработать|принос\p{L}*)|что.{0,35}даст.{0,20}инвест)/iu.test(questionClause)) return 'yield_comparison';
  if (/ипотек|ставк|плат[её]ж|банк|рассроч|первоначальн.*взнос/iu.test(questionClause)) return 'financing';
  if (hasMaterialRequestIntent(questionClause)) return 'materials_request';
  if (/(?:что\s+(?:реально\s+)?интересн|что\s+можете\s+предлож|какие\s+есть\s+(?:вариант|решен)|что\s+есть\s+такого)/iu.test(questionClause)) return 'market_options';
  if (
    /(?<![\p{L}\p{N}])(?:площад\p{L}*|этаж\p{L}*|планиров\p{L}*|отделк\p{L}*|ремонт\p{L}*|срок\s+сдач\p{L}*|инфраструктур\p{L}*|паркинг\p{L}*|вид\s+(?:из\s+окна|на\s+(?:море|горы|город))|видов\p{L}*\s+характеристик\p{L}*|море)(?![\p{L}\p{N}])/iu.test(questionClause) ||
    /(?<![\p{L}\p{N}])(?:лпх|объект\p{L}*|квартир\p{L}*|апартамент\p{L}*|дом\p{L}*|участок\p{L}*)[^?]{0,60}(?:можно|разреш\p{L}*|сдава\p{L}*|использ\p{L}*|коммерц\p{L}*)/iu.test(questionClause)
  ) return 'property_details';
  return 'general';
}

function directQuestionReply(intent: DirectQuestionIntent, text: string): string {
  if (intent === 'meeting_time_confirmation') {
    const slot = extractCallbackTime(text);
    return slot ? `Да, ${slot}. Зафиксирую.` : 'Да, подходит. Зафиксирую договорённость.';
  }
  if (intent === 'documents') return 'Проверю именно этот пункт по актуальным документам конкретного объекта и дам точный ответ — без догадок.';
  if (intent === 'price') return 'По цене отвечу прямо, но не буду придумывать цифру без актуальной базы: диапазон сильно зависит от формата и локации. Назову проверенную вилку и дальше сравним, за что реально есть смысл доплачивать.';
  if (intent === 'yield_comparison') return 'Без конкретного объекта честную доходность не назову. Считать нужно чистый денежный поток, возможный рост цены и риски, а затем сравнить это с депозитом. Какая планка для вас будет минимально приемлемой?';
  if (intent === 'financing') return 'По этому финансовому вопросу лучше дать точный расчёт по вашим параметрам — проверю условия, не буду гадать.';
  if (intent === 'materials_request') return 'Да. Отправлю 2–3 варианта с ценами и планировками без длинной презентации. После просмотра коротко сверим, что из этого действительно оставлять.';
  if (intent === 'market_options') return 'Если цель — вложить капитал и не тратить время, сравнивать нужно 2–3 сценария по чистому доходу, ликвидности и потенциалу роста. Что для вас важнее: доход сейчас или рост стоимости?';
  if (intent === 'property_details') return 'По конкретному объекту отвечу только проверенными данными. Если объект ещё не выбран, сначала сузим до 2–3 вариантов и сравним этот параметр по каждому.';
  return 'Уточните, пожалуйста, какой именно момент вы хотите сейчас прояснить?';
}

function isAmbiguousShortConfirmation(text: string, agentText: string | null): boolean {
  if (!agentText) return false;
  const clean = normalize(text).replace(/[.,!?]/g, '');
  const shortAnswers = new Set(['да', 'верно', 'правильно', 'угу', 'ага', 'конечно', 'да конечно']);
  if (!shortAnswers.has(clean)) return false;
  const questionCount = (agentText.match(/\?/g) || []).length;
  const hasCompoundQuestion =
    questionCount > 1 ||
    (/\?/u.test(agentText) && /(?:^|[^\p{L}\p{N}])(?:и|или)(?=$|[^\p{L}\p{N}])/iu.test(agentText)) ||
    /(?:правильно понимаю|верно),?.*(?:и|или).*/iu.test(agentText);
  return hasCompoundQuestion;
}

function detectMeetingContract(
  turn: TranscriptTurn,
  previousAgent: TranscriptTurn | null,
  state: ConversationState
): ConversationEventDetection | null {
  const text = normalize(turn.text);
  const agentText = normalize(previousAgent?.text || '');
  const existingAgreement = agreementIsConfirmed(state);
  if (isAgreedNextStepReaffirmation(turn.text, state)) return null;
  const explicitMeetingRefusal = /(?:без\s+(?:всяких\s+)?(?:видео|видеопоказ\w*|видеовстреч\w*)|никак\w*\s+(?:видео|видеопоказ\w*)|на\s+видео\s+(?:я\s+)?не\s+(?:выйду|буду)|не\s+(?:хочу|буду|готов\w*)[^.!?]{0,25}(?:видео|видеопоказ\w*|видеовстреч\w*))/iu.test(text);
  const explicitCallbackRefusal = /(?:не\s+(?:могу|смогу)|не\s+получится|неудобно|не\s+удобно)[^.!?]{0,35}(?:после|вечер)|(?:после|вечер)[^.!?]{0,35}(?:не\s+(?:могу|смогу)|не\s+получится|неудобно|не\s+удобно)/iu.test(text);
  if (explicitMeetingRefusal || explicitCallbackRefusal) return null;

  const conversationalTiming = extractConversationalCallbackTiming(turn.text);
  const exactClientSlot = extractPreferredCallbackTime(turn.text) || extractCallbackTime(turn.text);
  const clientHasOwnTiming = Boolean(conversationalTiming?.time || exactClientSlot);
  const followUpPrompt = /(?:когда[^.!?]{0,55}(?:удобн|продолж|связат|вернут)|верн\p{L}*[^.!?]{0,80}когда[^.!?]{0,35}удобн|следующ\p{L}*\s+шаг[^.!?]{0,55}когда)/iu.test(agentText);
  const clientSchedulingVerb = /(?:давайте|созвон\p{L}*|позвон\p{L}*|перезвон\p{L}*|свяж\p{L}*|продолж\p{L}*)/iu.test(text);
  const contextualTimingResponse = followUpPrompt && clientHasOwnTiming;
  const explicitAffirmative = /(?:^|[^\p{L}\p{N}])(?:да|давайте|согласен|согласна|подходит|удобно|удобнее|предпочту|выбираю|договорились|окей|хорошо)(?:$|[^\p{L}\p{N}])/iu.test(text);
  const durationChange = existingAgreement && explicitAgreementDurationChange(turn.text);
  const channelChange = existingAgreement && explicitAgreementChannelChange(turn.text);
  const reschedule = existingAgreement && explicitAgreementReschedule(turn.text);
  const affirmative =
    explicitAffirmative ||
    contextualTimingResponse ||
    durationChange ||
    channelChange ||
    reschedule;
  const meetingContext =
    /(?:видеовстреч|видеопоказ|видео|созвон|зум|zoom|встреч|показ)/iu.test(`${agentText} ${text}`) ||
    followUpPrompt;
  if (!affirmative || !meetingContext) return null;

  const clientSlot = conversationalTiming
    ? [conversationalTiming.dateOrDay, conversationalTiming.time].filter(Boolean).join(' ')
    : exactClientSlot;
  const agentSlots = extractCallbackSlots(previousAgent?.text || '');
  const explicitPartialChange = durationChange || channelChange;
  const inheritedSingleAgentSlot = !clientSlot && !explicitPartialChange && agentSlots.length === 1 ? agentSlots[0] : null;
  const callbackSlot = clientSlot || inheritedSingleAgentSlot;
  const time = conversationalTiming?.time || extractClock(callbackSlot);
  const clientDay = conversationalTiming?.dateOrDay || turn.text.match(/(?:^|[^\p{L}\p{N}])(сегодня|завтра|послезавтра|понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресенье)(?=$|[^\p{L}\p{N}])/iu)?.[1] || null;
  const inheritedDay = inheritedSingleAgentSlot?.match(/(?:^|[^\p{L}\p{N}])(сегодня|завтра|послезавтра|понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресенье)(?=$|[^\p{L}\p{N}])/iu)?.[1] || null;
  const dateOrDay = clientDay || inheritedDay || null;
  const replacementChannel = channelChange
    ? text.match(/а\s+(видео\p{L}*|встреч\p{L}*|звонок|созвон)/iu)?.[1] || null
    : null;
  const rawChannel = replacementChannel || `${agentText} ${text}`.match(/(видеовстреча|видеопоказ|видео|zoom|зум|телефон|звонок|созвон\p{L}*|whatsapp|ватсап|telegram|телеграм)/iu)?.[1] || null;
  const channel = rawChannel && /созвон|телефон/iu.test(rawChannel)
    ? 'созвон'
    : rawChannel && /звонок/iu.test(rawChannel)
      ? 'созвон'
    : rawChannel || (contextualTimingResponse ? 'созвон' : null);
  const participants = /(?:вдвоем|вдвоём|с супруг|с муж|с жен|всей семь)/iu.test(text) ? 'несколько участников' : null;
  const expectedResult = /(?:сравним|выберем|определим|решим|проверим)/iu.test(`${agentText} ${text}`)
    ? 'результат обозначен'
    : null;
  const durationMinutes = extractCallbackDurationMinutes(turn.text);

  const priorBoundary = Boolean(state.dialogueControl?.clientBoundaryActive);
  const tentative = /(?:попробуем|может быть|наверное|скорее всего)/iu.test(text);
  const clientOriginatedConcreteProposal =
    (clientHasOwnTiming && (contextualTimingResponse || (explicitAffirmative && clientSchedulingVerb) || reschedule)) ||
    durationChange ||
    channelChange;
  const quality: MeetingConsentQuality = tentative
    ? 'tentative'
    : clientOriginatedConcreteProposal
      ? 'clear'
      : priorBoundary
        ? 'forced_or_low_confidence'
        : 'clear';

  const missing: string[] = [];
  const multipleAgentSlotsWithoutSelection = !clientSlot && agentSlots.length > 1;
  if (!dateOrDay && !existingAgreement) missing.push('день');
  if (!time && !existingAgreement) missing.push('время');
  if (!channel && !existingAgreement) missing.push('канал');
  if (multipleAgentSlotsWithoutSelection && !missing.includes('время')) missing.push('выбор времени');

  const normalizedDeadline = composeMeetingDeadline(dateOrDay, time);
  const durationSuffix = durationMinutes ? ` на ${durationMinutes} минут` : '';
  const suggestion =
    quality === 'forced_or_low_confidence'
      ? 'Уточню: встреча действительно полезна вам, или лучше сначала отправить конкретный материал и вернуться после просмотра?'
      : quality === 'tentative'
        ? `Правильно понимаю: ориентируемся на ${normalizedDeadline || 'это время'}${durationSuffix}, но пока не фиксируем окончательно?`
      : missing.length > 0
        ? `Зафиксируем встречу точно. Уточним ${missing.slice(0, 2).join(' и ')} — какой вариант удобен?`
        : channel === 'созвон' && normalizedDeadline
          ? `Отлично, тогда созвонимся ${normalizedDeadline}${durationSuffix}. Зафиксировал.`
        : time && dateOrDay
          ? `Да, ${dateOrDay} ${time.replace(/^.*?в\s*/iu, 'в ')}. Зафиксирую.`
          : 'Фиксируем договорённость.';

  return {
    type: 'MEETING_CONTRACT',
    priority: 95,
    actionType: 'PROPOSE_NEXT_STEP',
    ruleId: 'meeting_contract',
    suggestedReply: suggestion,
    shortReason: `Контракт встречи: качество согласия — ${quality}; не заполнено: ${missing.join(', ') || 'ничего'}.`,
    evidenceTurnId: turn.id,
    evidenceQuote: turn.text,
    suppressesAnalysis: true,
    stage: 'next_step_agreement',
    closesMetric: 'ppv',
    closesMetricLabel: 'Контракт видеовстречи',
    meetingConsentQuality: quality,
    meetingContract: { dateOrDay, time, channel, participants, expectedResult, durationMinutes },
  };
}

function parseTimeContractSeconds(text: string): number | null {
  const normalized = normalize(text);
  if (!/(?:займу|буквально|разговор|вопрос).*(?:минут|секунд)|(?:две|три|пять|\d+)\s*минут/iu.test(normalized)) {
    return null;
  }
  const digit = normalized.match(/(\d+)\s*минут/iu);
  if (digit) return Math.max(1, Number(digit[1])) * 60;
  if (/две\s*минут/iu.test(normalized) || /пару\s*минут/iu.test(normalized)) return 120;
  if (/три\s*минут/iu.test(normalized)) return 180;
  if (/пять\s*минут/iu.test(normalized)) return 300;
  return null;
}

export function detectConversationEvent(
  turn: TranscriptTurn,
  recentTurns: TranscriptTurn[],
  state: ConversationState,
  now = Date.now()
): ConversationEventDetection | null {
  const text = normalize(turn.text);
  if (!text || turn.speaker === 'unknown') {
    return {
      type: 'ASR_GATE',
      priority: 125,
      actionType: 'WAIT',
      ruleId: 'asr_gate',
      suggestedReply: null,
      shortReason: 'Неуверенная роль или пустая финальная реплика: бизнес-логика приостановлена.',
      evidenceTurnId: turn.id,
      evidenceQuote: turn.text,
      suppressesAnalysis: true,
      stage: state.stage,
    };
  }

  const compliance = findConfig('COMPLIANCE_STOP');
  if (compliance && includesConfiguredPhrase(text, compliance)) {
    return configuredEvent(compliance, turn);
  }

  if (turn.speaker === 'agent') {
    const claimRisk = findConfig('CLAIM_RISK');
    if (
      claimRisk &&
      (includesConfiguredPhrase(text, claimRisk) ||
        /(?:гарантир|точно|сто\s*процентов|100%)\S*.{0,40}(?:доход|окуп|одобр|достро|выраст|безопас|риск|здоров)/iu.test(text))
    ) {
      return configuredEvent(claimRisk, turn);
    }

    const promisedSeconds = parseTimeContractSeconds(text);
    if (promisedSeconds) {
      return {
        type: 'TIME_CONTRACT',
        priority: 75,
        actionType: 'WAIT',
        ruleId: 'time_contract',
        suggestedReply: null,
        shortReason: `Агент обещал уложиться в ${Math.round(promisedSeconds / 60)} мин.; предупреждение появится на 80% лимита.`,
        evidenceTurnId: turn.id,
        evidenceQuote: turn.text,
        suppressesAnalysis: true,
        stage: state.stage,
        timeContractSeconds: promisedSeconds,
      };
    }
    return null;
  }

  const clientStop = findConfig('CLIENT_STOP');
  if (clientStop && matchesClientStop(text, clientStop)) {
    const permanentContactStop = /(?:не\s+(?:звоните|пишите|связывайтесь)|(?:удалите|уберите)\s+(?:мой\s+)?номер|забудьте\s+(?:этот\s+)?номер)/iu.test(text);
    return configuredEvent(clientStop, turn, {
      suggestedReply: permanentContactStop
        ? clientStop.suggestion
        : 'Понял, завершаю разговор. Всего доброго.',
      shortReason: permanentContactStop
        ? clientStop.shortReason
        : 'Клиент попросил завершить текущий разговор: остановить продажу без предположения о запрете будущего контакта.',
    });
  }

  const timeConstraint = findConfig('TIME_CONSTRAINT');
  if (timeConstraint && matchesTimeConstraint(text, timeConstraint)) {
    const callbackTime = extractCallbackTime(turn.text);
    const materialRequest = hasMaterialRequestIntent(turn.text);
    const briefContinuation = allowsBriefContinuation(text);
    const detectedBoundaryMode = classifyClientBoundaryMode(turn.text);
    const boundaryMode = detectedBoundaryMode === 'none' ? 'defer' : detectedBoundaryMode;
    return configuredEvent(timeConstraint, turn, {
      actionType: timeConstraint.actionType,
      suggestedReply: materialRequest
        ? 'Понял, не отвлекаю. Отправлю запрошенный материал; к разговору вернёмся позже.'
        : callbackTime
        ? `Понял. Перезвоню ${callbackTime}. Не отвлекаю.`
        : briefContinuation
        ? 'Понял. Тогда коротко: для какой задачи рассматриваете недвижимость — для жизни, отдыха или инвестиции?'
        : timeConstraint.suggestion,
      shortReason: briefContinuation
        ? 'Клиент ограничил формат разговора, но разрешил кратко продолжить: без small talk переходим к задаче покупки.'
        : timeConstraint.shortReason,
      boundaryMode,
    });
  }

  const previousAgent = lastAgentBefore(turn, recentTurns);

  const resistance = detectNextStepResistance(text, state, previousAgent?.text);
  if (resistance && (['ppv', 'ppi'].includes(resistance.target) || !hasDirectQuestion(turn.text))) {
    const recorded = state.dialogueControl?.nextStepResistanceHistory?.[resistance.target]?.lastEvidenceTurnId === turn.id;
    const count = resistance.count - (recorded ? 1 : 0);
    return {
      type: resistance.reopened ? 'NEXT_STEP_REOPENED' : 'NEXT_STEP_RESISTANCE',
      priority: count > 1 ? 97 : 88, actionType: 'CLARIFY',
      ruleId: `next_step_${resistance.reopened ? 'reopened' : 'resistance'}_${resistance.target}`,
      suggestedReply: resistance.reopened
        ? resistance.target === 'ppi' ? 'Хорошо, подключим специалиста и сравним условия по выбранным объектам.' : 'Хорошо, согласуем следующий шаг. Когда вам удобно?'
        : nextStepResistanceReply(resistance.target, count > 1, turn.text),
      shortReason: resistance.reopened ? 'Клиент сам вернулся к отложенному шагу.' : 'Клиент откладывает следующий шаг; уточняем причину без повторного предложения.',
      evidenceTurnId: turn.id, evidenceQuote: turn.text,
      suppressesAnalysis: false, stage: resistance.reopened ? 'next_step_agreement' : 'objection_clarification',
      nextStepTarget: resistance.target,
    };
  }

  if (isAmbiguousShortConfirmation(turn.text, previousAgent?.text || null)) {
    return {
      type: 'AMBIGUOUS_CONFIRMATION',
      priority: 106,
      actionType: 'CLARIFY',
      ruleId: 'ambiguous_confirmation',
      suggestedReply: 'Уточню отдельно один параметр: какой именно вариант вы сейчас подтвердили?',
      shortReason: 'Короткое «да» после составного вопроса не подтверждает сразу несколько фактов.',
      evidenceTurnId: turn.id,
      evidenceQuote: turn.text,
      suppressesAnalysis: true,
      stage: state.stage,
    };
  }

  const meeting = detectMeetingContract(turn, previousAgent, state);
  if (meeting) return meeting;

  if (hasDirectQuestion(turn.text) && !isBarrierQuestion(turn.text)) {
    const intent = classifyDirectQuestionIntent(turn.text, previousAgent?.text || null);
    const materialRequest = intent === 'materials_request' ? findConfig('SOFT_RESISTANCE') : null;
    const materialBoundaryQuestion = /(?:^|[^\p{L}\p{N}])сам\s+(?:посмотрю|изучу|разберусь)(?=$|[^\p{L}\p{N}])/iu.test(text);
    if (materialRequest && (!turn.text.includes('?') || materialBoundaryQuestion || matchesSoftResistance(text, materialRequest))) {
      return configuredSoftResistanceEvent(materialRequest, turn, state);
    }
    return {
      type: 'DIRECT_QUESTION',
      priority: 105,
      actionType: 'ANSWER',
      ruleId: `direct_question_${intent}`,
      suggestedReply: directQuestionReply(intent, turn.text),
      shortReason: `Прямой вопрос клиента (${intent}) выше коррекции, SPIN-вопроса и презентации.`,
      evidenceTurnId: turn.id,
      evidenceQuote: turn.text,
      suppressesAnalysis: true,
      stage: state.stage,
    };
  }

  const correction = extractCorrection(turn.text);
  if (correction && hasConfirmedFactReplacement(turn, recentTurns, state)) {
    const correctedBudget = /миллион|млн|бюджет|предел/iu.test(turn.text) && state.budget?.value
      ? `Принял: ${state.budget.value} — актуальный предел. Предыдущее значение больше не учитываю.`
      : 'Принял поправку. Дальше опираемся на новую версию факта, старую не учитываю.';
    return {
      type: 'FACT_CORRECTION',
      priority: 104,
      actionType: 'SUMMARIZE',
      ruleId: 'fact_correction',
      suggestedReply: correctedBudget,
      shortReason: 'Новая версия факта заменяет прежнюю; после коррекции не перескакиваем на случайный вопрос анкеты.',
      evidenceTurnId: turn.id,
      evidenceQuote: turn.text,
      suppressesAnalysis: true,
      stage: state.stage,
    };
  }

  const explicitRejectionPattern = /(?:^|[^\p{L}\p{N}])не\s+(?:рассматрива\p{L}*|хоч(?:у|ем)|подходит|интересует)|(?:^|[^\p{L}\p{N}])исключа(?:ю|ем)|только\s+не/iu;
  const historicalResearchNegation =
    /(?:раньше|до этого|прежде|ранее|никогда).{0,45}не\s+рассматрива\p{L}*/iu.test(text) &&
    /(?:сейчас|теперь|пока).{0,55}(?:изуча\p{L}*|смотр\p{L}*|рассматрива\p{L}*|в процессе)/iu.test(text);
  if (explicitRejectionPattern.test(text) && !historicalResearchNegation) {
    const rejectedBranch = extractRejectedBranch(text);
    // A generic phrase such as “раньше не рассматривали” is not enough to close
    // a sales branch. Hard rejection requires either a concrete branch/object or
    // an explicit present-tense refusal to buy/proceed.
    const genericCurrentStop = /(?:^|[^\p{L}\p{N}])(?:не\s+хочу\s+(?:покупать|брать|продолжать)|не\s+интересно|покупк\p{L}*\s+не\s+интерес)/iu.test(text);
    if (rejectedBranch || genericCurrentStop) {
      return {
        type: 'EXPLICIT_REJECTION',
        priority: 100,
        actionType: 'CLARIFY',
        ruleId: 'explicit_rejection',
        suggestedReply: rejectedBranch
          ? `Понял, «${rejectedBranch}» исключаем и дальше эту ветку не предлагаю.`
          : 'Понял, эту ветку исключаем и дальше на ней не настаиваю.',
        shortReason: 'Явно отвергнутая ветка закрывается; после отказа не перескакиваем на несвязанный вопрос.',
        evidenceTurnId: turn.id,
        evidenceQuote: turn.text,
        suppressesAnalysis: true,
        stage: 'diagnostics',
        rejectedBranch,
      };
    }
  }

  const research = findConfig('RESEARCH_MODE');
  if (research && matchesResearchMode(text, research)) {
    return configuredEvent(research, turn);
  }

  const softResistance = findConfig('SOFT_RESISTANCE');
  if (softResistance && matchesSoftResistance(text, softResistance)) {
    return configuredSoftResistanceEvent(softResistance, turn, state);
  }

  const finance = findConfig('FINANCE_VERIFY');
  if (finance && includesConfiguredPhrase(text, finance)) {
    return configuredEvent(finance, turn, {
      closesMetric: 'budget',
      closesMetricLabel: 'Структура капитала',
    });
  }

  return null;
}

export function applyConversationEvent(
  current: ConversationState,
  event: ConversationEventDetection,
  turn: TranscriptTurn,
  now = Date.now()
): ConversationState {
  const eventAlreadyRecorded = (current.events || []).some(
    (record) => record.turnId === turn.id && record.type === event.type
  );
  const control: DialogueControlState = {
    lastEventType: null,
    lastEventTurnId: null,
    clientBoundaryActive: false,
    boundaryMode: 'none',
    researchMode: false,
    softResistanceCount: 0,
    rejectedBranches: [],
    meetingConsentQuality: 'none',
    timeContract: null,
    ...(current.dialogueControl || {}),
  };

  control.lastEventType = event.type;
  control.lastEventTurnId = turn.id;

  if (event.type === 'CLIENT_STOP' || event.type === 'TIME_CONSTRAINT' || event.type === 'COMPLIANCE_STOP') {
    control.clientBoundaryActive = true;
    control.boundaryMode = event.type === 'TIME_CONSTRAINT'
      ? event.boundaryMode || 'defer'
      : 'hard_stop';
  }
  if (event.type === 'SOFT_RESISTANCE') {
    if (!eventAlreadyRecorded) control.softResistanceCount += 1;
    if (control.softResistanceCount > 1) control.clientBoundaryActive = true;
  }
  if (event.type === 'RESEARCH_MODE') control.researchMode = true;
  if (event.type === 'EXPLICIT_REJECTION' && event.rejectedBranch) {
    control.rejectedBranches = Array.from(new Set([...control.rejectedBranches, event.rejectedBranch]));
    if (event.rejectedBranch === 'ипотеку' && /ипотек/iu.test(current.paymentMethod?.value || '')) {
      current = {
        ...current,
        paymentMethod: { value: null, evidenceTurnIds: Array.from(new Set([...(current.paymentMethod?.evidenceTurnIds || []), turn.id])) },
        confirmedFacts: (current.confirmedFacts || []).map((fact) =>
          fact.category === 'paymentMethod' && fact.lifecycleStatus !== 'superseded'
            ? { ...fact, lifecycleStatus: 'superseded' as const }
            : fact
        ),
      };
    }
    if (event.rejectedBranch === 'видеоформат') {
      control.blockedNextSteps = Array.from(new Set([...(control.blockedNextSteps || []), 'ppv']));
      current = {
        ...current,
        agreedNextStep: { value: null, evidenceTurnIds: current.agreedNextStep?.evidenceTurnIds || [] },
        nextStepAgreement: current.nextStepAgreement
          ? { ...current.nextStepAgreement, status: 'none' }
          : current.nextStepAgreement,
      };
    }
  }
  if ((event.type === 'NEXT_STEP_RESISTANCE' || event.type === 'NEXT_STEP_REOPENED') && event.nextStepTarget) {
    const target = event.nextStepTarget;
    const prior = control.nextStepResistanceHistory?.[target];
    const reopened = event.type === 'NEXT_STEP_REOPENED';
    const evidence = Array.from(new Set([...(prior?.evidenceTurnIds || []), turn.id]));
    const count = reopened ? 0 : (prior?.count || 0) + (prior?.evidenceTurnIds.includes(turn.id) ? 0 : 1);
    const resistance = { target, count, status: reopened ? 'handled' as const : count >= 2 ? 'blocked' as const : 'detected' as const,
      lastEvidenceTurnId: turn.id, evidenceTurnIds: evidence, retryAfter: 'client_reopens' as const };
    control.nextStepResistance = resistance;
    control.nextStepResistanceHistory = { ...control.nextStepResistanceHistory, [target]: resistance };
    if (reopened) control.blockedNextSteps = (control.blockedNextSteps || []).filter((item) => item !== target);
    else if (count >= 2 && (target === 'ppi' || target === 'ppv')) control.blockedNextSteps = Array.from(new Set([...(control.blockedNextSteps || []), target]));
  }
  if (event.type === 'MEETING_CONTRACT' && event.meetingConsentQuality) {
    const confirmedAlready = current.nextStepAgreement?.status === 'agreed';
    control.meetingConsentQuality = confirmedAlready && event.meetingConsentQuality !== 'clear'
      ? current.dialogueControl?.meetingConsentQuality || 'clear'
      : event.meetingConsentQuality;
  }
  if (event.type === 'TIME_CONTRACT' && event.timeContractSeconds) {
    control.timeContract = {
      promisedSeconds: event.timeContractSeconds,
      startedAt: now,
      warningShown: false,
    };
  }

  const record: ConversationEventRecord = {
    id: `event_${turn.id}_${event.type}`,
    type: event.type,
    priority: event.priority,
    speaker: turn.speaker,
    turnId: turn.id,
    evidenceQuote: turn.text,
    createdAt: now,
    ruleId: event.ruleId,
  };
  const events = [...(current.events || [])];
  if (!events.some((existing) => existing.id === record.id)) events.push(record);

  let next: ConversationState = {
    ...current,
    stage: event.stage || current.stage,
    events: events.slice(-50),
    dialogueControl: control,
  };

  if (event.type === 'NEXT_STEP_RESISTANCE' && event.nextStepTarget) {
    next = updateObjectionLifecycle(next, turn, `next_step_${event.nextStepTarget}`, event.nextStepTarget);
  }
  if (event.type === 'NEXT_STEP_REOPENED' && next.activeObjection && next.activeObjection.target === event.nextStepTarget) {
    next.activeObjection = { ...next.activeObjection, status: 'handled', evidenceTurnIds: [...next.activeObjection.evidenceTurnIds, turn.id] };
  }

  if (event.type === 'MEETING_CONTRACT' && event.meetingContract) {
    const contract = event.meetingContract;
    const previousAgreement = current.nextStepAgreement;
    const proposedTime = composeMeetingDeadline(contract.dateOrDay, contract.time);
    const normalizedPreviousTime = normalizeMeetingDeadline(previousAgreement?.timeOrDeadline);
    const previousHasClock = /\d{1,2}:\d{2}/u.test(normalizedPreviousTime || '');
    const proposedHasClock = /\d{1,2}:\d{2}/u.test(proposedTime || '');
    // A later generic “завтра созвонимся” must not erase the already agreed
    // “завтра в 12:00”. Preserve the more specific confirmed contract.
    const effectiveTime = previousHasClock && !proposedHasClock
      ? normalizedPreviousTime
      : normalizeMeetingDeadline(proposedTime || normalizedPreviousTime);
    const incomingStatus = event.meetingConsentQuality === 'clear' ? 'agreed' as const : 'discussing' as const;
    const effectiveStatus = previousAgreement?.status === 'agreed' && incomingStatus === 'discussing'
      ? 'agreed' as const
      : incomingStatus;
    const previousDuration = previousAgreement?.durationMinutes || Number(previousAgreement?.action.match(/на\s+(\d{1,3})\s*минут/iu)?.[1] || 0) || undefined;
    const effectiveDuration = contract.durationMinutes || previousDuration;
    const previousBaseAction = previousAgreement?.action.replace(/\s+на\s+\d{1,3}\s*минут\p{L}*/iu, '').trim();
    const baseAction = contract.channel === 'созвон'
      ? 'Созвон'
      : contract.channel
        ? `Встреча: ${contract.channel}`
        : previousBaseAction || 'Встреча / видеопоказ';
    const effectiveAction = effectiveDuration
      ? `${baseAction} на ${effectiveDuration} минут`
      : baseAction;
    next.nextStepAgreement = {
      action: effectiveAction,
      durationMinutes: effectiveDuration,
      assignee: contract.participants || previousAgreement?.assignee || undefined,
      timeOrDeadline: effectiveTime,
      channel: contract.channel || previousAgreement?.channel || undefined,
      participants: contract.participants || previousAgreement?.participants || undefined,
      expectedResult: contract.expectedResult || previousAgreement?.expectedResult || undefined,
      basisTurnId: turn.id,
      status: effectiveStatus,
    };
    if (effectiveStatus === 'agreed' && /видео|показ|созвон|звонок/iu.test(effectiveAction)) {
      const factAction = /созвон|звонок/iu.test(effectiveAction) ? effectiveAction : 'Видеопоказ';
      const factValue = `${factAction}${effectiveTime ? ` ${effectiveTime}` : ''}`.replace(/\s+/g, ' ').trim();
      next.agreedNextStep = {
        value: factValue,
        evidenceTurnIds: Array.from(new Set([...(current.agreedNextStep?.evidenceTurnIds || []), turn.id])),
        needsClarification: false,
      };

      // An explicit meeting agreement reopens a previously deferred PPV branch.
      // Canonical meeting state must be the source of truth for all downstream
      // metrics; an old refusal must not keep PPV permanently unresolved.
      const priorPpv = control.nextStepResistanceHistory?.ppv;
      if (priorPpv) {
        const handledPpv = {
          ...priorPpv,
          count: 0,
          status: 'handled' as const,
          lastEvidenceTurnId: turn.id,
          evidenceTurnIds: Array.from(new Set([...(priorPpv.evidenceTurnIds || []), turn.id])),
        };
        control.nextStepResistanceHistory = { ...control.nextStepResistanceHistory, ppv: handledPpv };
        if (control.nextStepResistance?.target === 'ppv') control.nextStepResistance = handledPpv;
        control.blockedNextSteps = (control.blockedNextSteps || []).filter((item) => item !== 'ppv');
        next.dialogueControl = control;
      }
      if (next.activeObjection?.target === 'ppv') {
        next.activeObjection = {
          ...next.activeObjection,
          status: 'handled',
          evidenceTurnIds: Array.from(new Set([...next.activeObjection.evidenceTurnIds, turn.id])),
        };
      }
    }
  }

  return next;
}

export function suggestionFromEvent(
  event: ConversationEventDetection,
  sessionId: string,
  revision: number,
  now = Date.now()
): SuggestedReply | null {
  if (!event.suggestedReply) return null;
  return {
    id: `reply_${now}_${event.type.toLowerCase()}`,
    sessionId,
    basedOnRevision: revision,
    candidateRuleId: event.ruleId,
    selectedRuleId: event.ruleId,
    actionType: event.actionType,
    text: event.suggestedReply,
    shortReason: event.shortReason,
    evidenceTurnIds: [event.evidenceTurnId],
    createdAt: now,
    stage: event.stage,
    confidenceStatus: 'confirmed',
    lifecycleStatus: 'candidate',
    closesMetric: event.closesMetric,
    closesMetricLabel: event.closesMetricLabel,
    immediatePriority: `P0: ${event.type}`,
    priority: event.priority,
    eventType: event.type,
    source: 'local_event',
  };
}
