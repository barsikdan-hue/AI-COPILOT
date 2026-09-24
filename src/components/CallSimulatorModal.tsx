import React, { useState } from 'react';
import { Play, X, MessageSquare, Send, Sparkles, Filter, CheckCircle } from 'lucide-react';
import { SpeakerRole } from '../types';

interface CallSimulatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInjectTurn: (speaker: SpeakerRole, text: string) => void;
}

export interface PresetScenario {
  id: string;
  category: 'objection' | 'timeline' | 'budget' | 'motive' | 'next_step' | 'safety' | 'comparison';
  title: string;
  description: string;
  ruleBadge: string;
  speaker: SpeakerRole;
  text: string;
  turns?: Array<{ speaker: SpeakerRole; text: string }>;
}

export const ANDREI_OS_SCENARIOS: PresetScenario[] = [
  {
    id: 'p37_price_30_vs_50',
    category: 'objection',
    title: '1. P37: Дорого (клиент назвал сумму: 30 vs 50 млн)',
    description: 'Клиент назвал конкретную сумму — спросить про предел бюджета, а не «с чем сравниваете»',
    ruleBadge: 'P37',
    speaker: 'client',
    text: 'Слушайте, мы рассчитывали уложиться миллионов в 30, а вы предлагаете комплекс за 50. Это слишком дорого для нас.',
  },
  {
    id: 'p44_anapa_excluded',
    category: 'safety',
    title: '2. P44: Исключение Анапы («Анапу не рассматриваю»)',
    description: 'Клиент исключил Анапу — город исключён, P44 НЕ запускать, не спрашивать «почему»',
    ruleBadge: 'P44 Защита',
    speaker: 'client',
    text: 'Сразу скажу: Анапу мы вообще не рассматриваем, смотрим только Сочи и Сириус.',
  },
  {
    id: 'p48_living_focus',
    category: 'motive',
    title: '3. P48: Для проживания (переключение на быт семьи)',
    description: 'Клиент покупает для жизни — фокус на быт семьи, окружение, а не инвестиционную доходность',
    ruleBadge: 'P48',
    speaker: 'client',
    text: 'Мы покупаем не под сдачу и не для инвестиций, а именно для постоянного проживания семьи.',
  },
  {
    id: 'two_years_move_split',
    category: 'timeline',
    title: '4. Сроки: Переезд через 2 года (разделение покупки и переезда)',
    description: 'Покупка и заселение разделены: переезд через 2 года не равен сроку выхода на сделку',
    ruleBadge: 'Сроки',
    speaker: 'client',
    text: 'Переехать на юг мы планируем через два года, когда закончим все дела в Москве.',
  },
  {
    id: 'just_looking_one_question',
    category: 'motive',
    title: '5. Мотив: «Пока просто смотрю» (ровно 1 открытый вопрос)',
    description: 'Клиент просто смотрит — ровно один вопрос: «Что хотите для себя понять, пока смотрите?»',
    ruleBadge: 'Мотив',
    speaker: 'client',
    text: 'Да я пока просто смотрю рынок, прицениваюсь, конкретных планов нет.',
  },
  {
    id: 'budget_split_cash_mortgage',
    category: 'budget',
    title: '6. Бюджет: 6 наличными, до 10 с ипотекой',
    description: 'Разделение: 6 млн наличные, до 4 млн ипотека, общий бюджет до 10 млн',
    ruleBadge: 'Бюджет',
    speaker: 'client',
    text: 'У нас на руках сейчас 6 миллионов наличными, а в целом с ипотекой готовы рассматривать варианты до 10 миллионов.',
  },
  {
    id: 'unrealized_growth_not_cash',
    category: 'budget',
    title: '7. Финансы: «Квартира выросла в цене, но я её не продавал»',
    description: 'Рост оценки жилья НЕ является полученным доходом или наличными деньгами',
    ruleBadge: 'Финансы',
    speaker: 'client',
    text: 'У меня квартира в Краснодаре выросла в цене почти на два миллиона, но я её пока не продавал.',
  },
  {
    id: 'client_correction_6_vs_10',
    category: 'safety',
    title: '8. Защита: Менеджер назвал 10, клиент поправил «нет, 6»',
    description: 'Слова менеджера не создают фактов, факт клиента строго 6 млн',
    ruleBadge: 'Антигаллюцинация',
    speaker: 'client',
    text: 'Нет, Андрей, вы ошиблись: не 10 миллионов, мой реальный бюджет строго до 6 миллионов.',
  },
  {
    id: 'reason_already_named',
    category: 'motive',
    title: '9. Критерий: Причина уже названа («разный режим»)',
    description: 'Критерий — отдельный вход, причина — разный режим. Не переспрашивать причину заново!',
    ruleBadge: 'Критерий',
    speaker: 'client',
    text: 'Мне обязательно нужен отдельный вход или изолированная спальня, потому что у нас с супругом совершенно разный режим сна и работы.',
  },
  {
    id: 'respect_stop_contact',
    category: 'safety',
    title: '10. Стоп-контакт: «Больше не звоните» (actionType: RESPECT_STOP)',
    description: 'Вежливое закрытие диалога, запрет продажи и уговоров',
    ruleBadge: 'RESPECT_STOP',
    speaker: 'client',
    text: 'Слушайте, мы уже всё решили, больше мне не звоните и удалите мой номер из базы.',
  },
  {
    id: 'respect_busy_driving',
    category: 'timeline',
    title: '11. Занятость: «Я за рулём, перезвоните завтра в 11»',
    description: 'Уважение времени: зафиксировать перезвон завтра в 11:00, не удерживать на линии',
    ruleBadge: 'Время',
    speaker: 'client',
    text: 'Андрей, я сейчас за рулём в плотном потоке, не могу говорить. Перезвоните завтра ровно в 11:00.',
  },
  {
    id: 'layout_direct_question',
    category: 'motive',
    title: '12. Прямой вопрос: «Пришлите точную планировку лотов»',
    description: 'actionType: ANSWER — конкретный ответ/отправка, не откатывать к «зачем вам недвижимость»',
    ruleBadge: 'ANSWER',
    speaker: 'client',
    text: 'Андрей, пришлите мне в мессенджер точную планировку и поэтажный план именно этих двух апартаментов.',
  },
  {
    id: 'agree_meeting_two_people',
    category: 'next_step',
    title: '13. Согласование шага: «Да, завтра в 15:00, вдвоём»',
    description: 'agreedNextStep зафиксирован со статусом agreed, участники: клиент с супругой',
    ruleBadge: 'Шаг согласован',
    speaker: 'client',
    text: 'Да, завтра в 15:00 нам обоим удобно, мы подключимся к видеовстрече вдвоём с супругой.',
  },
  {
    id: 'compare_sochi_anapa',
    category: 'comparison',
    title: '14. Сравнение: Выбор между Сочи и Анапой',
    description: 'Выявить решающий критерий: «Что для вас будет решающим в выборе между этими городами?»',
    ruleBadge: 'Сценарии',
    speaker: 'client',
    text: 'Мы сейчас выбираем между Сочи и Анапой, никак не можем определиться, что лучше для семейного отдыха.',
  },
  {
    id: 'polyana_expensive_general',
    category: 'objection',
    title: '15. P37: Дорого в Красной Поляне (без точной суммы)',
    description: 'Выяснить: аналог дешевле, предел бюджета или непонятна ценность локации',
    ruleBadge: 'P37',
    speaker: 'client',
    text: 'В Красной Поляне нереально дорого, мы не ожидали такого уровня цен за квадратный метр.',
  },
  {
    id: 'region_flat_sale_condition',
    category: 'timeline',
    title: '16. Условие: Продажа трёшки в Екатеринбурге',
    description: 'Зависимость/условие от продажи жилья, а не подтверждённый срок сделки',
    ruleBadge: 'Условие',
    speaker: 'client',
    text: 'Мы пока продаём трёхкомнатную в Екатеринбурге, как только найдём покупателя — сразу выходим на сделку в Сочи.',
  },
  {
    id: 'cash_payment_confirmed',
    category: 'budget',
    title: '17. Факт: «Только 100% наличные, без кредитов»',
    description: 'Подтверждённый факт paymentMethod = 100% наличные, не переспрашивать форму расчёта',
    ruleBadge: 'Оплата',
    speaker: 'client',
    text: 'У нас вся сумма на руках, покупаем только за наличный расчёт, никаких ипотек и рассрочек.',
  },
  {
    id: 'agent_open_question_wait',
    category: 'safety',
    title: '18. Реплика Андрея: Вопрос клиенту (проверка паузы и заморозки)',
    description: 'Реплика менеджера — суфлёр фиксирует в транскрипте, замораживает карточку, не вызывает Gemini',
    ruleBadge: 'Андрей (WAIT)',
    speaker: 'agent',
    text: 'Подскажите, а что для вашей семьи будет самым главным в самом жилом комплексе — закрытая территория, бассейн или тишина?',
  },
  {
    id: 'for_myself_not_relocation',
    category: 'motive',
    title: '19. «Для себя» без переезда (НЕ запускает P48)',
    description: '«Для себя» не означает ПМЖ и школы. Задать нейтральный вопрос: отдых, сезоны или ПМЖ?',
    ruleBadge: 'Для себя (не P48)',
    speaker: 'client',
    text: 'Мы смотрим квартиру исключительно для себя.',
  },
  {
    id: 'filler_turn_ignore',
    category: 'safety',
    title: '20. Филлерная реплика клиента («Угу, понятно»)',
    description: 'Короткие подтверждения («угу», «да») игнорируются, карточка не мигает и не сбрасывается',
    ruleBadge: 'Филлер (Игнор)',
    speaker: 'client',
    text: 'Угу, понятно.',
  },
  {
    id: 'fast_objection_need_to_think',
    category: 'objection',
    title: '21. Быстрое возражение: «Надо подумать»',
    description: 'Мгновенная изоляция: «Конечно. Над чем конкретно хотите подумать — цена, объект, формат или сама необходимость покупки?»',
    ruleBadge: 'Надо подумать',
    speaker: 'client',
    text: 'Спасибо за информацию, нам в целом всё понятно, но нам надо подумать.',
  },
  {
    id: 'claim_risk_guaranteed_yield',
    category: 'safety',
    title: '22. Claim Risk: «Гарантированная доходность»',
    description: 'Категоричное обещание менеджера заменяется прогнозом с источником и допущениями',
    ruleBadge: 'CLAIM_RISK',
    speaker: 'agent',
    text: 'Здесь гарантированная доходность 20 процентов, объект точно окупится.',
  },
  {
    id: 'time_contract_two_minutes',
    category: 'timeline',
    title: '23. Контракт времени: «Займу две минуты»',
    description: 'Запускается локальный таймер и предупреждение на 80% обещанного времени',
    ruleBadge: 'TIME_CONTRACT',
    speaker: 'agent',
    text: 'Добрый день, займу буквально две минуты и задам один вопрос.',
  },
  {
    id: 'research_mode_no_urgency',
    category: 'motive',
    title: '24. Исследовательский режим без срочности',
    description: 'Сравнение и критерии вместо давления, дефицита и «горящих» предложений',
    ruleBadge: 'RESEARCH_MODE',
    speaker: 'client',
    text: 'Я пока только изучаю рынок и не буду реагировать на горящие предложения.',
  },
  {
    id: 'soft_resistance_repeated',
    category: 'objection',
    title: '25. Повторное мягкое сопротивление',
    description: 'После второй просьбы опрос прекращается: материал и один конкретный возврат',
    ruleBadge: 'SOFT_RESISTANCE ×2',
    speaker: 'client',
    text: 'Просто пришлите варианты, я посмотрю.',
    turns: [
      { speaker: 'client', text: 'Просто пришлите варианты, я посмотрю.' },
      { speaker: 'client', text: 'Я же сказал: пришлите информацию, потом подумаю.' },
    ],
  },
  {
    id: 'ambiguous_yes_compound_question',
    category: 'safety',
    title: '26. Неоднозначное «да» после двойного вопроса',
    description: 'Одно «да» не подтверждает одновременно бюджет и ипотеку',
    ruleBadge: 'AMBIGUOUS_CONFIRMATION',
    speaker: 'client',
    text: 'Да.',
    turns: [
      { speaker: 'agent', text: 'Правильно понимаю, бюджет до 20 миллионов и ипотека уже одобрена?' },
      { speaker: 'client', text: 'Да.' },
    ],
  },
  {
    id: 'compliance_fake_income',
    category: 'safety',
    title: '27. Комплаенс: недостоверная справка',
    description: 'Сценарий немедленно останавливается и переводится в официальный канал проверки',
    ruleBadge: 'COMPLIANCE_STOP',
    speaker: 'agent',
    text: 'Если что, сделаем справку о доходах и обойдём проверку банка.',
  },
  {
    id: 'meeting_contract_incomplete',
    category: 'next_step',
    title: '28. Встреча согласована не полностью',
    description: 'Copilot просит заполнить день/время, канал, участников и результат',
    ruleBadge: 'MEETING_CONTRACT',
    speaker: 'client',
    text: 'Да, давайте созвонимся как-нибудь на следующей неделе.',
    turns: [
      { speaker: 'agent', text: 'Тогда проведём видеовстречу и сравним варианты, согласны?' },
      { speaker: 'client', text: 'Да, давайте созвонимся как-нибудь на следующей неделе.' },
    ],
  },
  {
    id: 'explicit_format_rejection',
    category: 'safety',
    title: '29. Явный отказ от формата',
    description: 'Отвергнутая ветка закрывается и не предлагается повторно',
    ruleBadge: 'EXPLICIT_REJECTION',
    speaker: 'client',
    text: 'Апартаменты не хочу и вообще не рассматриваю, нужна только квартира.',
  },
];

export const CallSimulatorModal: React.FC<CallSimulatorModalProps> = ({
  isOpen,
  onClose,
  onInjectTurn,
}) => {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [customSpeaker, setCustomSpeaker] = useState<SpeakerRole>('client');
  const [customText, setCustomText] = useState('');

  if (!isOpen) return null;

  const filteredScenarios = activeCategory === 'all'
    ? ANDREI_OS_SCENARIOS
    : ANDREI_OS_SCENARIOS.filter((s) => s.category === activeCategory);

  const handleRunPreset = (preset: PresetScenario) => {
    const scenarioTurns = preset.turns || [{ speaker: preset.speaker, text: preset.text }];
    for (const turn of scenarioTurns) onInjectTurn(turn.speaker, turn.text);
    onClose();
  };

  const handleSendCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customText.trim()) return;
    onInjectTurn(customSpeaker, customText.trim());
    setCustomText('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[92vh] shadow-2xl flex flex-col overflow-hidden border border-stone-200">
        {/* Header */}
        <div className="p-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-teal-700" />
            <div>
              <h2 className="text-sm font-semibold text-stone-900">
                {ANDREI_OS_SCENARIOS.length} тестовых сценариев ANDREI OS 4
              </h2>
              <p className="text-[11px] text-stone-500">
                Проверка правил (P37, P44, P48), запрета галлюцинаций, стоп-контактов и бюджетов
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Category Filters */}
        <div className="px-4 py-2 border-b border-stone-100 flex flex-wrap gap-1.5 bg-stone-50/50 text-[11px]">
          {[
            { id: 'all', label: 'Все 18 сценариев' },
            { id: 'objection', label: 'Возражения (P37)' },
            { id: 'safety', label: 'Защита и P44' },
            { id: 'budget', label: 'Бюджет и деньги' },
            { id: 'motive', label: 'Мотивы и P48' },
            { id: 'timeline', label: 'Сроки и условия' },
            { id: 'next_step', label: 'Следующий шаг' },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                activeCategory === cat.id
                  ? 'bg-teal-700 text-white font-medium shadow-xs'
                  : 'bg-stone-100 text-stone-600 hover:text-stone-900 hover:bg-stone-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Scenarios List */}
        <div className="p-4 space-y-2.5 overflow-y-auto max-h-[50vh] text-xs">
          {filteredScenarios.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleRunPreset(preset)}
              className="w-full text-left p-3 rounded-xl border border-stone-200 bg-stone-50/60 hover:bg-teal-50/70 hover:border-teal-300 transition-all group flex flex-col space-y-1 cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-stone-900 group-hover:text-teal-950">
                  {preset.title}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-stone-200 group-hover:bg-teal-200 text-stone-700 group-hover:text-teal-900 text-[10px] font-mono">
                  {preset.ruleBadge}
                </span>
              </div>
              <p className="text-[11px] text-stone-500">{preset.description}</p>
              <p className="text-xs text-stone-800 italic bg-white p-2 rounded-md border border-stone-100">
                «{preset.text}»
              </p>
            </button>
          ))}
        </div>

        {/* Custom Turn Form */}
        <div className="p-4 border-t border-stone-200 bg-stone-50 text-xs">
          <span className="font-semibold text-stone-800 block mb-2">
            Произвольная реплика собеседника:
          </span>
          <form onSubmit={handleSendCustom} className="space-y-2">
            <div className="flex items-center space-x-2">
              <select
                value={customSpeaker}
                onChange={(e) => setCustomSpeaker(e.target.value as SpeakerRole)}
                className="px-2 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-800 text-xs focus:ring-1 focus:ring-teal-600 outline-none"
              >
                <option value="client">Собеседник: Клиент</option>
                <option value="agent">Собеседник: Андрей (Риелтор)</option>
              </select>

              <input
                type="text"
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Введите текст реплики..."
                className="flex-1 px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-xs focus:ring-1 focus:ring-teal-600 outline-none"
              />

              <button
                type="submit"
                disabled={!customText.trim()}
                className="px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:bg-stone-300 text-white transition-colors cursor-pointer flex items-center space-x-1"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Отправить</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
