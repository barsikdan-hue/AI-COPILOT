import React, { useState } from 'react';
import {
  Target,
  MapPin,
  CircleDollarSign,
  Calendar,
  Users,
  Compass,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Layers,
  ChevronDown,
  ChevronUp,
  Award,
  ShieldCheck,
  Check,
  Minus,
  Video,
  FileText,
} from 'lucide-react';
import { ConversationState, FactEntry, FirstCallMetric, isMetricClosed } from '../types';
import { FIRST_CALL_METRICS_LIST } from '../services/firstCallScriptEngine';
import { getActiveObjectionGuidance } from '../services/objectionEngine';
import { getContextualSpinQuestion } from '../services/spinEngine';
import { getCategoryLabel, getMetricLabel, getObjectionLabel, isRealObjection } from '../utils/labels';

const SCRIPT_METRIC_QUESTIONS: Record<string, string> = {
  trust: 'Как вообще сейчас ощущения от рынка в Сочи — давно присматриваетесь или только начали?',
  goal: 'Под какую основную задачу подбираете недвижимость — для себя, для отдыха или инвестиции?',
  propertyType: 'Какой формат рассматриваете — апартаменты, жилой комплекс или отдельный дом?',
  criteria: 'Что для вас самое принципиальное при выборе — близость к морю, тишина или инфраструктура?',
  infrastructure: 'Какая инфраструктура должна быть обязательно рядом — спа, бассейны, рестораны, школы?',
  location: 'Какие локации рассматриваете в первую очередь — центр Сочи, Сириус, Красную Поляну?',
  familyMortgage: 'Рассматривали вариант семейной ипотеки под 6% — есть ли детки подходящего возраста?',
  downPayment: 'Какой первоначальный взнос планируете задействовать для покупки?',
  downPaymentSource: 'Первоначальный взнос уже на руках в деньгах или планируется продажа актива?',
  paymentMethod: 'По форме расчёта — комфортнее 100% оплата, ипотека или рассрочка?',
  budget: 'На какой общий бюджет покупки ориентируетесь?',
  employment: 'По занятости — официально трудоустроены, ИП или самозанятость?',
  experience: 'Что уже успели посмотреть в Сочи, и почему пока ни на чём не остановились?',
  urgency: 'В какие сроки планируете определиться и выйти на сделку?',
  decisionMaker: 'Решение принимаете самостоятельно или будете советоваться с семьёй?',
  objections: 'Что сейчас вызывает наибольшие сомнения по покупке?',
  ppi: 'Давайте подключим нашего ипотечного брокера — он за 10 минут бесплатно подберёт субсидированные ставки?',
  ppv: 'Предлагаю на 15 минут подключиться к видеопоказу с экспертом застройщика: выведем планировки и расчеты. Вам когда удобнее — сегодня в 18:00 или завтра в 12:00?',
};

const TRUST_QUESTION_BANK = [
  'Как вообще сейчас ощущения от рынка Сочи — давно присматриваетесь или только начали?',
  'Что уже успели посмотреть и что из увиденного вам понравилось или, наоборот, оттолкнуло?',
  'Когда вы в последний раз были в Сочи — что больше всего запомнилось?',
  'Когда приезжаете в Сочи, как обычно проводите здесь время — больше море, город или спокойный отдых?',
  'Что в Сочи лично для вас самое приятное — море, прогулки, горы или сам ритм города?',
  'Если не про квадратные метры, какой формат отдыха для вас обычно самый комфортный?',
  'Кто кроме вас будет чаще всего пользоваться этой недвижимостью?',
  'Как вы поймёте, что объект действительно подходит именно вам, а не просто хорошо выглядит в презентации?',
  'Что в прошлых просмотрах или общении с агентами вам хотелось бы сделать по-другому?',
  'Какие два критерия вы точно не готовы жертвовать при выборе?',
  'Если вариантов останется всего два, по каким признакам будете принимать финальное решение?',
  'Что для вас важнее в этом решении: комфорт использования, сохранность капитала или возможность заработать?',
];

interface ClientContextPanelProps {
  state: ConversationState;
  onTurnClick?: (turnIds: string[]) => void;
  onAskField?: (fieldQuestion: string) => void;
}

export const ClientContextPanel: React.FC<ClientContextPanelProps> = ({
  state,
  onTurnClick,
  onAskField,
}) => {
  const [activeTab, setActiveTab] = useState<'script' | 'profile' | 'spin' | 'facts' | 'objections'>('script');
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [questionRotation, setQuestionRotation] = useState<Record<string, number>>({});
  const [expandedObjection, setExpandedObjection] = useState<string | null>(null);

  const askMetricQuestion = (metricId: string, fallbackQuestion: string) => {
    if (!onAskField) return;
    if (metricId === 'objections') {
      const guidance = getActiveObjectionGuidance(state);
      onAskField(guidance?.text || fallbackQuestion);
      return;
    }
    const houseRejected = state.dialogueControl?.rejectedBranches?.some((branch) => branch.toLowerCase().includes('дом'));
    const safeFallback =
      metricId === 'propertyType' && houseRejected
        ? 'Если дом исключаем, какой формат ближе — квартира в жилом комплексе или апартаменты?'
        : fallbackQuestion;
    const bank = metricId === 'trust' ? TRUST_QUESTION_BANK : [safeFallback];
    const currentIndex = questionRotation[metricId] || 0;
    const question = bank[currentIndex % bank.length];
    setQuestionRotation((prev) => ({ ...prev, [metricId]: currentIndex + 1 }));
    onAskField(question);
  };

  // Helper to render key diagnostic field cleanly
  const renderCompactField = (
    label: string,
    fact: FactEntry | undefined,
    icon: React.ReactNode,
    suggestedQuestion: string
  ) => {
    const isClosed = isMetricClosed(fact?.status);
    const isNotApplicable = fact?.status === 'not_applicable';
    const isSpecified = Boolean(fact?.value) || isClosed;

    return (
      <div className="flex items-center justify-between p-2 rounded-lg bg-stone-50/70 border border-stone-100 hover:border-stone-200 transition-colors">
        <div className="flex items-center space-x-2 min-w-0 pr-2">
          <div className="text-stone-500 shrink-0">{icon}</div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center space-x-1.5 mb-0.5">
              <span className="text-[11px] font-medium text-stone-500 leading-none">{label}</span>
              {isNotApplicable && (
                <span className="bg-stone-100 text-stone-700 text-[9px] px-1 py-0.2 rounded font-medium shrink-0">
                  ✓ Не применимо
                </span>
              )}
            </div>
            <span
              className={`text-xs truncate ${
                isSpecified ? 'font-semibold text-stone-900' : 'text-stone-400 italic'
              }`}
              title={fact?.value || (isNotApplicable ? 'Не применимо' : 'Не подтверждено — уточнить')}
            >
              {fact?.value || (isNotApplicable ? 'Не применимо' : 'Не подтверждено — уточнить')}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-1 shrink-0">
          {isSpecified && fact?.evidenceTurnIds && fact.evidenceTurnIds.length > 0 && (
            <button
              onClick={() => onTurnClick?.(fact.evidenceTurnIds)}
              className="text-[10px] text-teal-700 hover:underline font-mono px-1 py-0.5 rounded bg-teal-50"
              title="Показать реплику-источник"
            >
              #{fact.evidenceTurnIds[0].slice(-4)}
            </button>
          )}

          {!isSpecified && !isClosed && !isNotApplicable && onAskField && (
            <button
              onClick={() => onAskField(suggestedQuestion)}
              className="text-[10px] text-teal-700 hover:text-teal-900 font-medium px-1.5 py-0.5 rounded hover:bg-teal-50 transition-colors cursor-pointer"
            >
              Спросить
            </button>
          )}
        </div>
      </div>
    );
  };

  const nextStepValue =
    state.agreedNextStep?.value ||
    (state.stage === 'next_step_agreement'
      ? 'Согласовать показ / видеовстречу'
      : state.conversationTask || null);

  const timelineValue =
    state.purchaseTimeline || state.timeline || state.moveInTimeline || { value: null, evidenceTurnIds: [] };

  const scriptProgress = state.scriptProgress;
  const quality = state.qualityResult || scriptProgress?.quality;
  const trust = state.trustEvaluation || scriptProgress?.trust;
  const metrics: FirstCallMetric[] = scriptProgress?.metrics
    ? Object.values(scriptProgress.metrics)
    : FIRST_CALL_METRICS_LIST.map((m) => ({
        id: m.id,
        name: m.name,
        category: m.category,
        isCoreCriteria: m.isCoreCriteria,
        priorityOrder: m.priorityOrder,
        status: 'missing' as const,
      }));
  const clientSpeechPercent = Math.round((trust?.clientSpeechRatio ?? 0) * 100);

  return (
    <div
      id="client-context-panel"
      className="bg-white rounded-xl border border-stone-200 shadow-sm flex flex-col h-full overflow-hidden"
    >
      {/* Header with 4 Tabs */}
      <div className="px-3.5 py-2.5 border-b border-stone-100 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-1.5">
          <Target className="w-4 h-4 text-teal-700" />
          <span className="font-semibold text-stone-900 text-sm">
            Контекст клиента
          </span>
        </div>

        {/* 5 Tabs: Скрипт (18) | Профиль | SPIN | Факты | Возражения */}
        <div className="flex items-center bg-stone-100 p-0.5 rounded-lg text-xs">
          <button
            onClick={() => setActiveTab('script')}
            className={`px-2 py-1 rounded-md transition-colors cursor-pointer font-medium flex items-center space-x-1 ${
              activeTab === 'script'
                ? 'bg-white text-stone-900 shadow-2xs font-bold'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <span>Скрипт</span>
            <span className="bg-teal-100 text-teal-800 text-[9px] px-1 rounded-full font-mono">
              {metrics.filter((m) => isMetricClosed(m.status)).length}/18
            </span>
          </button>
          <button
            onClick={() => setActiveTab('profile')}
            className={`px-2 py-1 rounded-md transition-colors cursor-pointer font-medium ${
              activeTab === 'profile'
                ? 'bg-white text-stone-900 shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Профиль
          </button>
          <button
            onClick={() => setActiveTab('spin')}
            className={`px-2 py-1 rounded-md transition-colors cursor-pointer font-medium ${
              activeTab === 'spin'
                ? 'bg-white text-stone-900 shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            SPIN
          </button>
          <button
            onClick={() => setActiveTab('facts')}
            className={`px-2 py-1 rounded-md transition-colors cursor-pointer font-medium flex items-center space-x-1 ${
              activeTab === 'facts'
                ? 'bg-white text-stone-900 shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <span>Факты</span>
            {state.confirmedFacts?.length > 0 && (
              <span className="bg-teal-100 text-teal-800 text-[9px] px-1 rounded-full font-mono">
                {state.confirmedFacts.filter(
                  (fact) => fact.lifecycleStatus !== 'superseded' && fact.lifecycleStatus !== 'rejected'
                ).length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('objections')}
            className={`px-2 py-1 rounded-md transition-colors cursor-pointer font-medium flex items-center space-x-1 ${
              activeTab === 'objections'
                ? 'bg-white text-stone-900 shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <span>Возражения</span>
            {state.objections?.items?.length > 0 && (
              <span className="bg-amber-100 text-amber-900 text-[9px] px-1 rounded-full font-mono">
                {state.objections.items.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Panel Body: Scrollable Internally */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-3.5 space-y-2.5">
        {/* Служебные события OS4 остаются в diagnostics и не показываются агенту во время звонка. */}

        {/* TAB 0: СКРИПТ ПЕРВОГО ЗВОНКА И КАЧЕСТВО */}
        {activeTab === 'script' && (
          <div className="space-y-3 text-xs">
            {/* Quality and Control Summary Banner */}
            <div className="bg-stone-50 border border-stone-200 rounded-lg p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5">
                  <Award className="w-4 h-4 text-teal-700" />
                  <span className="font-bold text-stone-900 text-xs">Контроль качества звонка</span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                    quality?.isQualityCall
                      ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                      : 'bg-amber-50 text-amber-900 border-amber-300'
                  }`}
                >
                  {quality?.isQualityCall ? '✓ Пройдено' : 'В процессе'}
                </span>
              </div>

              {/* Progress bar for 12 Core Criteria */}
              <div>
                <div className="flex justify-between text-[11px] text-stone-600 mb-1">
                  <span>Ядро скрипта: {quality?.passedCoreCriteriaCount ?? 0} / 12 (порог: 7)</span>
                  <span className="font-semibold text-stone-800">
                    Всего раскрыто: {metrics.filter((m) => isMetricClosed(m.status)).length} / 18
                  </span>
                </div>
                <div className="w-full bg-stone-200 h-1.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      quality?.isQualityCall ? 'bg-emerald-600' : 'bg-amber-500'
                    }`}
                    style={{
                      width: `${Math.min(100, Math.round(((quality?.passedCoreCriteriaCount ?? 0) / 12) * 100))}%`,
                    }}
                  />
                </div>
              </div>

              {/* Trust & Rules metrics */}
              <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px]">
                <div className="bg-white p-1.5 rounded border border-stone-200">
                  <span className="text-stone-500 block text-[10px]">Доверие (Trust):</span>
                  <span className="font-semibold text-stone-900">
                    {Math.min(trust?.openTechnicalQuestionsCount ?? 0, 3)}/3 техн., {Math.min(trust?.openPersonalQuestionsCount ?? 0, 2)}/2 личн.
                  </span>
                </div>
                <div className="bg-white p-1.5 rounded border border-stone-200">
                  <span className="text-stone-500 block text-[10px]">Правило 40/60:</span>
                  <span
                    className={`font-semibold ${
                      clientSpeechPercent >= 40 ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    Клиент: {clientSpeechPercent}% (норма ≥40%)
                  </span>
                </div>
              </div>

              {/* PPV Status */}
              <div className="flex items-center justify-between bg-teal-50/70 border border-teal-200 rounded p-1.5 text-[11px]">
                <span className="font-semibold text-teal-950 flex items-center gap-1">
                  <Video className="w-3.5 h-3.5 text-teal-700" />
                  <span>ППВ (Видеопрезентация):</span>
                </span>
                <span className="font-bold text-teal-900">
                  {scriptProgress?.ppv?.clientAgreed
                    ? '✓ Согласована'
                    : scriptProgress?.ppv?.concreteTimeProposed
                    ? 'Предложена'
                    : 'Не предложена'}
                </span>
              </div>
            </div>

            {/* 18 Indicators List */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1 text-[11px] text-stone-500 font-medium">
                <span>18 показателей первого звонка</span>
                <span>Статус / Вопрос</span>
              </div>

              {metrics.map((metric) => {
                const isClosed = isMetricClosed(metric.status);
                const isConfirmed = metric.status === 'confirmed';
                const isNotApplicable = metric.status === 'not_applicable';
                const isPartial = metric.status === 'partially_confirmed' || metric.status === 'needs_clarification';
                const suggestedQ = SCRIPT_METRIC_QUESTIONS[metric.id];

                return (
                  <div
                    key={metric.id}
                    className={`p-2 rounded-lg border transition-colors ${
                      isClosed
                        ? 'bg-emerald-50/40 border-emerald-200'
                        : isPartial
                        ? 'bg-amber-50/40 border-amber-200'
                        : 'bg-stone-50/60 border-stone-100 hover:border-stone-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center space-x-1.5 min-w-0">
                        {isClosed ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : isPartial ? (
                          <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        ) : (
                          <Minus className="w-3.5 h-3.5 text-stone-300 shrink-0" />
                        )}

                        <span className="font-semibold text-stone-900 truncate">
                          {metric.priorityOrder ? `${metric.priorityOrder}. ` : ''}{metric.name}
                        </span>

                        {isNotApplicable && (
                          <span className="bg-stone-100 text-stone-700 text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 flex items-center gap-1">
                            ✓ Не применимо
                          </span>
                        )}

                        {metric.isCoreCriteria && (
                          <span className="bg-amber-100 text-amber-900 text-[9px] px-1 py-0.2 rounded font-semibold shrink-0">
                            ★ Ядро
                          </span>
                        )}
                      </div>

                      <div className="shrink-0 flex items-center space-x-1">
                        {isClosed && metric.evidenceTurnId && (
                          <button
                            onClick={() => onTurnClick?.([metric.evidenceTurnId!])}
                            className="text-[10px] text-teal-700 hover:underline font-mono px-1 py-0.2 rounded bg-teal-50"
                            title="Показать реплику-источник"
                          >
                            #{metric.evidenceTurnId.slice(-4)}
                          </button>
                        )}

                        {!isClosed && !isNotApplicable && !state.dialogueControl?.blockedNextSteps?.includes(metric.id) && suggestedQ && onAskField && (
                          <button
                            onClick={() => askMetricQuestion(metric.id, suggestedQ)}
                            className="text-[10px] text-teal-700 hover:text-teal-900 font-medium px-1.5 py-0.5 rounded hover:bg-teal-50 transition-colors cursor-pointer"
                          >
                            Спросить
                          </button>
                        )}
                      </div>
                    </div>

                    {state.dialogueControl?.blockedNextSteps?.includes(metric.id) && <p className="text-[11px] text-amber-700 pl-5">Отложено клиентом</p>}
                    {/* Value or Evidence */}
                    {metric.value ? (
                      <div className="mt-1 text-[11px] text-stone-800 font-medium pl-5">
                        {metric.value}
                        {metric.evidenceQuote && (
                          <span className="text-stone-500 italic block text-[10px]">
                            «{metric.evidenceQuote}»
                          </span>
                        )}
                      </div>
                    ) : isNotApplicable ? (
                      <div className="mt-0.5 text-[10px] text-stone-500 font-medium pl-5">
                        ✓ Не применимо
                      </div>
                    ) : (
                      <div className="mt-0.5 text-[10px] text-stone-400 italic pl-5">
                        Не раскрыто
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 1: ПРОФИЛЬ (Key Fields Only) */}
        {activeTab === 'profile' && (
          <div className="space-y-2">
            {/* 1. Цель */}
            {renderCompactField(
              'Цель покупки',
              state.goal,
              <Compass className="w-3.5 h-3.5 text-teal-600" />,
              'Под какую основную задачу подбираете недвижимость — для себя, отдыха или инвестиций?'
            )}

            {/* 1a. Первичная цель (если разграничена) */}
            {state.primaryGoal?.value && state.primaryGoal.value !== state.goal?.value && (
              renderCompactField(
                'Формат использования',
                state.primaryGoal,
                <Compass className="w-3.5 h-3.5 text-teal-600" />,
                'Для себя — это больше про отдых, сезон или постоянное проживание?'
              )
            )}

            {/* 1b. Вторичный сценарий (сдача в аренду во время отсутствия) */}
            {state.secondaryUse?.value && (
              renderCompactField(
                'Дополнительный сценарий',
                state.secondaryUse,
                <Layers className="w-3.5 h-3.5 text-indigo-600" />,
                'Планируете ли сдавать объект в аренду во время своего отсутствия?'
              )
            )}

            {/* 2. Локация */}
            {renderCompactField(
              'Локация',
              state.location,
              <MapPin className="w-3.5 h-3.5 text-blue-600" />,
              'Какие районы Сочи или побережья рассматриваете в первую очередь?'
            )}

            {/* 3. Бюджет */}
            {renderCompactField(
              'Бюджет',
              state.budget,
              <CircleDollarSign className="w-3.5 h-3.5 text-emerald-600" />,
              'На какой комфортный бюджет покупки вы ориентируетесь?'
            )}

            {/* 3a. Финансовый приоритет */}
            {state.financialPriority?.value && (
              renderCompactField(
                'Финансовый приоритет',
                state.financialPriority,
                <CircleDollarSign className="w-3.5 h-3.5 text-emerald-700" />,
                'Что важнее при покупке — минимальный первый взнос или низкий ежемесячный платеж?'
              )
            )}

            {/* 4. Срок */}
            {renderCompactField(
              'Срок покупки / переезда',
              timelineValue,
              <Calendar className="w-3.5 h-3.5 text-amber-600" />,
              'Как скоро планируете приехать на просмотр или выйти на сделку?'
            )}

            {/* 5. Кто принимает решение */}
            {renderCompactField(
              'Кто принимает решение',
              state.decisionMakers,
              <Users className="w-3.5 h-3.5 text-purple-600" />,
              'Решение принимаете самостоятельно или будете советоваться с семьёй?'
            )}

            {/* 6. Следующий шаг */}
            <div className="flex items-center justify-between p-2 rounded-lg bg-teal-50/50 border border-teal-100">
              <div className="flex items-center space-x-2 min-w-0 pr-2">
                <div className="text-teal-700 shrink-0">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] font-semibold text-teal-900 leading-none mb-0.5">
                    Следующий шаг
                  </span>
                  <span className="text-xs text-stone-800 font-medium truncate">
                    {nextStepValue || 'Не подтверждено — уточнить'}
                  </span>
                </div>
              </div>
            </div>

            {/* Collapsed Secondary Details (Payment, Criteria) */}
            <div className="pt-1">
              <button
                onClick={() => setShowMoreDetails(!showMoreDetails)}
                className="flex items-center space-x-1 text-[11px] text-stone-500 hover:text-stone-800 font-medium cursor-pointer transition-colors"
              >
                <span>{showMoreDetails ? 'Свернуть детали' : 'Дополнительные параметры'}</span>
                {showMoreDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>

              {showMoreDetails && (
                <div className="mt-2 space-y-2 pt-2 border-t border-stone-100 animate-in fade-in duration-100">
                  {renderCompactField(
                    'Форма оплаты',
                    state.paymentMethod,
                    <CircleDollarSign className="w-3.5 h-3.5 text-stone-500" />,
                    'Планируете покупку за 100% расчёт, ипотеку или рассрочку?'
                  )}

                  {state.criteria.items.length > 0 && (
                    <div className="p-2 rounded-lg bg-stone-50 border border-stone-100">
                      <span className="text-[11px] font-semibold text-stone-700 block mb-1">
                        Критерии ({state.criteria.items.length}):
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {state.criteria.items.map((item, idx) => (
                          <span
                            key={idx}
                            className="text-[11px] bg-white border border-stone-200 px-2 py-0.5 rounded text-stone-800"
                          >
                            {item.text}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: SPIN */}
        {activeTab === 'spin' && (
          <div className="space-y-2.5 text-xs">
            {/* SPIN Stepper Bar */}
            <div className="bg-stone-50 border border-stone-200 rounded-lg p-2">
              <div className="flex items-center justify-between text-[11px] font-semibold text-stone-600 mb-1.5">
                <span>Прогресс выявления потребности (SPIN):</span>
                {state.spin.completedStages.length === 4 ? (
                  <span className="text-teal-700 bg-teal-100 px-1.5 py-0.5 rounded text-[10px] font-bold">
                    Готов к ХПВ
                  </span>
                ) : (
                  <span className="text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded text-[10px]">
                    Этап: {state.spin.currentStage}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-1">
                {(['SITUATION', 'PROBLEM', 'IMPLICATION', 'NEED_PAYOFF'] as const).map((stg) => {
                  const isDone = state.spin.completedStages.includes(stg);
                  const isCurrent = state.spin.currentStage === stg;
                  const labelMap = {
                    SITUATION: 'S • Ситуация',
                    PROBLEM: 'P • Проблема',
                    IMPLICATION: 'I • Последствия',
                    NEED_PAYOFF: 'N • Ценность',
                  };
                  return (
                    <button
                      type="button"
                      key={stg}
                      onClick={() => onAskField?.(getContextualSpinQuestion(stg, state))}
                      title="Предложить следующий SPIN-вопрос"
                      className={`text-center py-1 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
                        isDone
                          ? 'bg-teal-700 text-white border-teal-700 font-bold'
                          : isCurrent
                          ? 'bg-amber-100 text-amber-900 border-amber-300 font-bold animate-pulse'
                          : 'bg-white text-stone-400 border-stone-200'
                      }`}
                    >
                      {labelMap[stg]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Strict SPIN Rule Reminder */}
            <div className="bg-sky-50/70 border border-sky-200 rounded-lg p-2 text-[11px] text-sky-900">
              <span className="font-semibold block mb-0.5">Строгий стандарт квалификации:</span>
              <span>
                SPIN строится <strong>только на ответах клиента</strong> с цитатами. Вопросы риелтора не являются фактами и не засчитываются в прогресс.
              </span>
            </div>

            {/* S • Situation */}
            <div className="p-2.5 rounded-lg bg-stone-50 border border-stone-200">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-stone-900 text-[11px]">S • Ситуация (факты клиента)</span>
                {state.spin.situation.length > 0 && (
                  <span className="text-[10px] bg-teal-100 text-teal-800 px-1.5 rounded font-mono">
                    Подтверждено ({state.spin.situation.length})
                  </span>
                )}
              </div>
              {state.spin.situation.length > 0 ? (
                <div className="space-y-1.5">
                  {state.spin.situation.map((it, idx) => (
                    <div key={idx} className="bg-white p-1.5 rounded border border-stone-200">
                      <p className="text-stone-800 font-medium text-xs">{it.text}</p>
                      {it.evidenceQuote && (
                        <p className="text-[11px] text-stone-500 italic mt-0.5">
                          Цитата: «{it.evidenceQuote}»
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-stone-400 italic">Не подтверждено ответом клиента</span>
              )}
            </div>

            {/* P • Problem */}
            <div className="p-2.5 rounded-lg bg-stone-50 border border-stone-200">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-stone-900 text-[11px]">P • Проблема (сложности, боли)</span>
                {state.spin.problem.length > 0 && (
                  <span className="text-[10px] bg-teal-100 text-teal-800 px-1.5 rounded font-mono">
                    Подтверждено ({state.spin.problem.length})
                  </span>
                )}
              </div>
              {state.spin.problem.length > 0 ? (
                <div className="space-y-1.5">
                  {state.spin.problem.map((it, idx) => (
                    <div key={idx} className="bg-white p-1.5 rounded border border-stone-200">
                      <p className="text-stone-800 font-medium text-xs">{it.text}</p>
                      {it.evidenceQuote && (
                        <p className="text-[11px] text-stone-500 italic mt-0.5">
                          Цитата: «{it.evidenceQuote}»
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-stone-400 italic">Не подтверждено ответом клиента</span>
              )}
            </div>

            {/* I • Implication */}
            <div className="p-2.5 rounded-lg bg-stone-50 border border-stone-200">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-stone-900 text-[11px]">I • Извлечение последствий</span>
                {state.spin.implication.length > 0 && (
                  <span className="text-[10px] bg-teal-100 text-teal-800 px-1.5 rounded font-mono">
                    Подтверждено ({state.spin.implication.length})
                  </span>
                )}
              </div>
              {state.spin.implication.length > 0 ? (
                <div className="space-y-1.5">
                  {state.spin.implication.map((it, idx) => (
                    <div key={idx} className="bg-white p-1.5 rounded border border-stone-200">
                      <p className="text-stone-800 font-medium text-xs">{it.text}</p>
                      {it.evidenceQuote && (
                        <p className="text-[11px] text-stone-500 italic mt-0.5">
                          Цитата: «{it.evidenceQuote}»
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-stone-400 italic">Не подтверждено ответом клиента</span>
              )}
            </div>

            {/* N • Need-Payoff */}
            <div className="p-2.5 rounded-lg bg-stone-50 border border-stone-200">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-stone-900 text-[11px]">N • Направляющая ценность</span>
                {state.spin.needPayoff.length > 0 && (
                  <span className="text-[10px] bg-teal-100 text-teal-800 px-1.5 rounded font-mono">
                    Подтверждено ({state.spin.needPayoff.length})
                  </span>
                )}
              </div>
              {state.spin.needPayoff.length > 0 ? (
                <div className="space-y-1.5">
                  {state.spin.needPayoff.map((it, idx) => (
                    <div key={idx} className="bg-white p-1.5 rounded border border-stone-200">
                      <p className="text-stone-800 font-medium text-xs">{it.text}</p>
                      {it.evidenceQuote && (
                        <p className="text-[11px] text-stone-500 italic mt-0.5">
                          Цитата: «{it.evidenceQuote}»
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-stone-400 italic">Не подтверждено ответом клиента</span>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: ФАКТЫ */}
        {activeTab === 'facts' && (
          <div className="space-y-2 text-xs">
            {state.confirmedFacts && state.confirmedFacts.length > 0 ? (
              state.confirmedFacts.map((fact) => {
                const categoryLabel =
                  getCategoryLabel(fact.category) ||
                  getMetricLabel(fact.category) ||
                  fact.category;

                return (
                  <div
                    key={fact.id}
                    className={`p-2 rounded-lg border flex flex-col space-y-0.5 ${
                      fact.lifecycleStatus === 'superseded'
                        ? 'bg-stone-100/70 border-stone-200 opacity-60'
                        : fact.lifecycleStatus === 'needs_verification'
                          ? 'bg-amber-50/60 border-amber-200'
                          : 'bg-stone-50 border-stone-100'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-teal-900 text-[11px] uppercase tracking-wide">
                        {categoryLabel}
                      </span>
                      {fact.lifecycleStatus === 'superseded' && (
                        <span className="text-[9px] rounded bg-stone-200 text-stone-600 px-1.5 py-0.5">
                          заменён
                        </span>
                      )}
                      {fact.lifecycleStatus === 'needs_verification' && (
                        <span className="text-[9px] rounded bg-amber-100 text-amber-800 px-1.5 py-0.5">
                          проверить
                        </span>
                      )}
                      {fact.turnId && (
                        <button
                          onClick={() => onTurnClick?.([fact.turnId])}
                          className="text-[10px] text-teal-700 hover:underline font-mono"
                        >
                          #{fact.turnId.slice(-4)}
                        </button>
                      )}
                    </div>
                    <p className="text-stone-800 font-medium">{fact.value}</p>
                    {fact.evidenceQuote && (
                      <p className="text-[11px] text-stone-500 italic bg-white p-1 rounded border border-stone-100 mt-0.5">
                        «{fact.evidenceQuote}»
                      </p>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="text-center py-6 text-stone-400 text-xs">
                Подтверждённые факты появятся по мере диалога
              </div>
            )}
          </div>
        )}

        {/* TAB 4: ВОЗРАЖЕНИЯ */}
        {activeTab === 'objections' && (
          <div className="space-y-2 text-xs">
            {(() => {
              const realObjections = (state.objections?.items || []).filter(isRealObjection);
              if (realObjections.length === 0) {
                return (
                  <div className="text-center py-6 text-stone-400 text-xs">
                    Возражений пока не зафиксировано
                  </div>
                );
              }
              const activeGuidance = getActiveObjectionGuidance(state);
              return realObjections.map((obj, idx) => {
                const isActive = state.activeObjection?.category === obj;
                const isExpanded = expandedObjection === obj || (expandedObjection === null && isActive);
                const statusLabel = isActive
                  ? ({
                      detected: 'Причина ещё не уточнена',
                      response_attempted: 'Агент уточнил, ожидаем ответ',
                      clarified: 'Причина уточнена',
                      handled: 'Отработано',
                      deferred: 'Отложено клиентом, граница принята',
                      blocked: 'Клиент поставил границу — не повторяем',
                      cause_identified: 'Причина уже названа клиентом',
                      resolved: 'Снято',
                    } as Record<string, string>)[state.activeObjection!.status] || state.activeObjection!.status
                  : null;

                return (
                  <div
                    key={idx}
                    className={`rounded-lg border transition-colors ${isActive ? 'bg-amber-50 text-amber-900 border-amber-300' : 'bg-stone-50 text-stone-700 border-stone-200'}`}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedObjection(isExpanded ? null : obj)}
                      className="w-full p-2.5 text-left flex items-start justify-between gap-2"
                    >
                      <div>
                        <div className="flex items-center space-x-1.5 font-semibold text-stone-950">
                          <AlertCircle className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-amber-700' : 'text-stone-500'}`} />
                          <span>{getObjectionLabel(obj)}</span>
                        </div>
                        {statusLabel && <p className="text-[11px] mt-1 text-amber-900">{statusLabel}</p>}
                      </div>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                    </button>

                    {isExpanded && (
                      <div className="px-2.5 pb-2.5 space-y-2 border-t border-black/5 pt-2">
                        {isActive && state.activeObjection?.evidenceQuote && (
                          <div>
                            <div className="text-[10px] uppercase tracking-wide font-semibold text-stone-500 mb-0.5">Клиент сказал</div>
                            <p className="text-[11px] italic bg-white/80 border border-stone-200 rounded p-1.5 text-stone-700">
                              «{state.activeObjection.evidenceQuote}»
                            </p>
                          </div>
                        )}
                        {isActive && activeGuidance ? (
                          <>
                            <div>
                              <div className="text-[10px] uppercase tracking-wide font-semibold text-stone-500 mb-0.5">Сказать сейчас</div>
                              <p className="text-[12px] font-semibold leading-snug text-stone-950">{activeGuidance.text}</p>
                            </div>
                            <div>
                              <div className="text-[10px] uppercase tracking-wide font-semibold text-stone-500 mb-0.5">Цель</div>
                              <p className="text-[11px] text-stone-700">{activeGuidance.goal}</p>
                            </div>
                            {onAskField && (
                              <button
                                type="button"
                                onClick={() => onAskField(activeGuidance.text)}
                                className="w-full rounded-md bg-stone-900 text-white py-1.5 px-2 text-[11px] font-semibold hover:bg-stone-800"
                              >
                                Показать подсказку
                              </button>
                            )}
                          </>
                        ) : obj.includes(' — ') ? (
                          <p className="text-[11px] text-stone-700 italic">{obj.split(' — ')[1]}</p>
                        ) : (
                          <p className="text-[11px] text-stone-500">Историческое возражение. Активной отработки сейчас не требует.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>
    </div>
  );
};
