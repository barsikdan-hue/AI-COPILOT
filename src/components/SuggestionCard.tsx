import React, { useState } from 'react';
import {
  Sparkles,
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  XCircle,
  HelpCircle,
  Loader2,
  Lock,
  MessageSquare,
  Clock,
  Radio,
} from 'lucide-react';
import { SuggestedReply, SalesRule, ActionType } from '../types';

interface SuggestionCardProps {
  suggestion: SuggestedReply | null;
  shouldSuggest: boolean;
  activeRule?: SalesRule | null;
  evidenceQuote?: string | null;
  onUseSuggestion: (reply: SuggestedReply) => void;
  onDismissSuggestion: () => void;
  onFeedback?: (suggestion: SuggestedReply, rating: 'accurate' | 'inaccurate', comment?: string) => void;
  isCallRunning?: boolean;
  isPaused?: boolean;
  isAgentSpeaking?: boolean;
  isClientSpeaking?: boolean;
  isAnalyzing?: boolean;
  isSuggestionLocked?: boolean;
  isRefiningContext?: boolean;
  hasAnalysisError?: boolean;
  analysisErrorMessage?: string | null;
  isCompleted?: boolean;
}

export const SuggestionCard: React.FC<SuggestionCardProps> = ({
  suggestion,
  shouldSuggest,
  activeRule,
  evidenceQuote,
  onUseSuggestion,
  onDismissSuggestion,
  onFeedback,
  isCallRunning = false,
  isPaused = false,
  isAgentSpeaking = false,
  isClientSpeaking = false,
  isAnalyzing = false,
  isSuggestionLocked = false,
  isRefiningContext = false,
  hasAnalysisError = false,
  isCompleted = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<'accurate' | 'inaccurate' | null>(null);

  const handleCopy = () => {
    if (suggestion?.text) {
      navigator.clipboard.writeText(suggestion.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleFeedback = (rating: 'accurate' | 'inaccurate') => {
    if (!suggestion) return;
    setFeedbackGiven(rating);
    onFeedback?.(suggestion, rating);
  };

  const getRuleBadgeColor = (ruleId?: string | null) => {
    switch (ruleId) {
      case 'P37':
        return 'bg-amber-100 text-amber-900 border-amber-300';
      case 'P44':
        return 'bg-blue-100 text-blue-900 border-blue-300';
      case 'P48':
        return 'bg-emerald-100 text-emerald-900 border-emerald-300';
      default:
        return 'bg-stone-100 text-stone-800 border-stone-300';
    }
  };

  const getActionTypeBadge = (actionType?: ActionType) => {
    switch (actionType) {
      case 'ANSWER':
        return { label: 'Ответ', class: 'bg-sky-100 text-sky-900 border-sky-300' };
      case 'CLARIFY':
        return { label: 'Уточнение', class: 'bg-amber-100 text-amber-900 border-amber-300' };
      case 'DEEPEN':
        return { label: 'Углубление', class: 'bg-indigo-100 text-indigo-900 border-indigo-300' };
      case 'SUMMARIZE':
        return { label: 'Фиксация', class: 'bg-purple-100 text-purple-900 border-purple-300' };
      case 'SHOW_EVIDENCE':
        return { label: 'Факты', class: 'bg-emerald-100 text-emerald-900 border-emerald-300' };
      case 'PROPOSE_NEXT_STEP':
        return { label: 'Следующий шаг', class: 'bg-teal-100 text-teal-900 border-teal-300' };
      case 'RESPECT_STOP':
        return { label: 'Стоп-контакт', class: 'bg-rose-100 text-rose-900 border-rose-300' };
      default:
        return null;
    }
  };

  const getSuggestionModeBadge = (mode?: string) => {
    switch (mode) {
      case 'SPIN_SITUATION':
        return { label: 'SPIN: Ситуация', class: 'bg-blue-100 text-blue-900 border-blue-300' };
      case 'SPIN_PROBLEM':
        return { label: 'SPIN: Проблема', class: 'bg-amber-100 text-amber-900 border-amber-300' };
      case 'SPIN_IMPLICATION':
        return { label: 'SPIN: Последствия', class: 'bg-indigo-100 text-indigo-900 border-indigo-300' };
      case 'SPIN_NEED_PAYOFF':
        return { label: 'SPIN: Ценность', class: 'bg-emerald-100 text-emerald-900 border-emerald-300' };
      case 'HPB_PRESENTATION':
        return { label: 'ХПВ: Презентация', class: 'bg-teal-100 text-teal-950 border-teal-400 font-bold' };
      case 'CHECK_ALIGNMENT':
        return { label: 'Проверка соответствия', class: 'bg-cyan-100 text-cyan-900 border-cyan-300' };
      case 'OBJECTION_CLARIFICATION':
        return { label: 'Изоляция сомнения', class: 'bg-rose-100 text-rose-900 border-rose-300' };
      case 'NEXT_STEP':
        return { label: 'Следующий шаг', class: 'bg-emerald-100 text-emerald-900 border-emerald-300' };
      default:
        return null;
    }
  };

  const canShowSuggestion =
    isCallRunning && !isPaused && !isCompleted && shouldSuggest && Boolean(suggestion?.text);
  const actionBadge = getActionTypeBadge(suggestion?.actionType);
  const modeBadge = getSuggestionModeBadge(suggestion?.suggestionMode);

  // Compact Waiting State (Height <= 54px)
  if (!canShowSuggestion || !suggestion?.text) {
    return (
      <div
        id="quiet-state-box"
        className="rounded-xl border border-stone-200/80 bg-white px-4 py-2.5 shadow-2xs flex items-center justify-between transition-all"
      >
        <div className="flex items-center space-x-2.5 text-xs text-stone-600">
          <div className="p-1 rounded bg-teal-50 text-teal-700">
            {isAnalyzing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isClientSpeaking ? (
              <Radio className="w-4 h-4 animate-pulse text-emerald-600" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
          </div>
          <span className="font-semibold text-stone-800 text-xs sm:text-sm">
            {isAnalyzing
              ? 'Анализ реплики клиента...'
              : isClientSpeaking
              ? 'Клиент говорит...'
              : isAgentSpeaking
              ? 'Андрей говорит...'
              : isCallRunning
              ? 'Ожидаю содержательную реплику клиента'
              : 'Звонок не начат'}
          </span>
          <span className="hidden sm:inline text-stone-300">•</span>
          <span className="hidden sm:inline text-stone-500 text-xs">
            {isCallRunning
              ? 'Суфлёр слушает диалог и подскажет следующий шаг'
              : 'Нажмите «Начать звонок» в верхней панели'}
          </span>
        </div>

        {isRefiningContext && (
          <span className="text-[11px] text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-md animate-pulse">
            уточняю контекст...
          </span>
        )}
      </div>
    );
  }

  // Active Suggestion Card (Constrained Max Height: 190–220px)
  return (
    <div
      id="suggestion-hero-card"
      className="bg-white rounded-xl border border-teal-200/90 shadow-sm p-3.5 sm:p-4 flex flex-col justify-between max-h-[220px] relative transition-all"
    >
      {/* Card Header */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
          <div className="p-1 rounded-md bg-teal-50 text-teal-700 shrink-0">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-stone-900 text-xs sm:text-sm tracking-tight">
            Следующая реплика суфлёра
          </span>

          {modeBadge && (
            <span className={`px-2 py-0.2 rounded text-[11px] font-semibold border ${modeBadge.class}`}>
              {modeBadge.label}
            </span>
          )}

          {suggestion.closesMetricLabel && (
            <span className="px-2 py-0.2 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-900 border border-emerald-300 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
              <span>{suggestion.closesMetricLabel}</span>
            </span>
          )}

          {actionBadge && (
            <span className={`px-2 py-0.2 rounded text-[11px] font-semibold border ${actionBadge.class}`}>
              {actionBadge.label}
            </span>
          )}

          {suggestion.candidateRuleId && (
            <span
              className={`px-2 py-0.2 rounded text-[11px] font-semibold border ${getRuleBadgeColor(
                suggestion.candidateRuleId
              )}`}
              title={activeRule ? activeRule.title : undefined}
            >
              {suggestion.candidateRuleId}
            </span>
          )}
        </div>

        {/* State Badges (Locked, Refining) */}
        <div className="flex items-center space-x-1.5 text-xs shrink-0">
          {isRefiningContext && (
            <span
              id="refining-context-badge"
              className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium bg-teal-50 text-teal-700 border border-teal-200"
            >
              <Loader2 className="w-3 h-3 text-teal-600 animate-spin" />
              <span>уточняю...</span>
            </span>
          )}

          {isSuggestionLocked && (
            <span
              id="suggestion-locked-badge"
              className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200"
              title="Зафиксировано во время речи Андрея"
            >
              <Lock className="w-3 h-3 text-amber-600" />
              <span>Зафиксировано</span>
            </span>
          )}
        </div>
      </div>

      {/* HPB Visual Connection (if in HPB Presentation Mode) */}
      {suggestion.hpb && (
        <div className="bg-teal-50/70 border border-teal-200 rounded-lg p-2 text-xs mb-1 space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold text-teal-900 flex items-center space-x-1">
              <span className="bg-teal-700 text-white px-1.5 py-0.2 rounded text-[10px] font-mono">ХПВ</span>
              <span>Связка под потребность клиента:</span>
            </span>
            {suggestion.hpb.evidenceQuote && (
              <span className="italic text-teal-800 truncate max-w-[280px]">
                «{suggestion.hpb.evidenceQuote}»
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-[11px]">
            <div className="bg-white/90 p-1.5 rounded border border-teal-100">
              <span className="text-stone-500 font-semibold block text-[10px]">Х (Характеристика):</span>
              <span className="text-stone-900 font-medium">{suggestion.hpb.characteristic}</span>
            </div>
            <div className="bg-white/90 p-1.5 rounded border border-teal-100">
              <span className="text-stone-500 font-semibold block text-[10px]">П (Преимущество):</span>
              <span className="text-stone-900 font-medium">{suggestion.hpb.advantage}</span>
            </div>
            <div className="bg-teal-100/70 p-1.5 rounded border border-teal-300">
              <span className="text-teal-800 font-bold block text-[10px]">В (Выгода клиента):</span>
              <span className="text-teal-950 font-bold">{suggestion.hpb.benefit}</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Prompter Reply Text (Max 2-3 lines, 15-16px) */}
      <div className="bg-teal-50/50 rounded-lg px-3 py-2 border border-teal-100/90 text-stone-950 my-1">
        <p
          id="suggested-reply-text"
          className="text-[15px] sm:text-[16px] font-medium leading-snug line-clamp-3 select-all text-stone-900"
        >
          «{suggestion.text}»
        </p>
        {suggestion.expectedClientMeaning && (
          <div className="mt-1.5 pt-1 border-t border-teal-100/60 text-[11px] text-teal-900/80 flex items-baseline gap-1">
            <span className="font-semibold text-teal-950">Ожидаемый ответ:</span>
            <span className="italic">{suggestion.expectedClientMeaning}</span>
          </div>
        )}
      </div>

      {/* Action Bar (Buttons: min-h 36px) */}
      <div className="flex items-center justify-between gap-2 pt-2 mt-0.5 border-t border-stone-100">
        <div className="flex items-center space-x-2">
          {/* Use Suggestion */}
          <button
            id="use-suggestion-btn"
            onClick={() => onUseSuggestion(suggestion)}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-semibold shadow-2xs transition-colors cursor-pointer min-h-[36px]"
          >
            <Check className="w-4 h-4" />
            <span>Использовано</span>
          </button>

          {/* Dismiss Suggestion */}
          <button
            id="dismiss-suggestion-btn"
            onClick={onDismissSuggestion}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:text-stone-900 hover:bg-stone-50 text-xs sm:text-sm font-medium transition-colors cursor-pointer min-h-[36px]"
          >
            <XCircle className="w-3.5 h-3.5 text-stone-400" />
            <span>Пропустить</span>
          </button>

          {/* Copy Button */}
          <button
            id="copy-suggestion-btn"
            onClick={handleCopy}
            className="p-2 rounded-lg border border-stone-200 text-stone-600 hover:text-stone-900 hover:bg-stone-50 transition-colors cursor-pointer min-h-[36px]"
            title="Скопировать в буфер"
          >
            {copied ? <Check className="w-4 h-4 text-teal-600" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>

        {/* Right side: "Почему?" & Feedback */}
        <div className="flex items-center space-x-2">
          {/* Collapsible Reasoning Button */}
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            className={`flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer min-h-[36px] ${
              showReasoning
                ? 'bg-stone-100 border-stone-300 text-stone-900'
                : 'border-stone-200 text-stone-600 hover:bg-stone-50'
            }`}
            title="Обоснование реплики суфлёра и цитата клиента"
          >
            <HelpCircle className="w-3.5 h-3.5 text-teal-600" />
            <span>Почему?</span>
          </button>

          {/* Andrei's Quick Feedback */}
          <div className="flex items-center space-x-1 bg-stone-50 p-1 rounded-lg border border-stone-200">
            <button
              onClick={() => handleFeedback('accurate')}
              className={`p-1 rounded cursor-pointer transition-colors ${
                feedbackGiven === 'accurate'
                  ? 'bg-emerald-600 text-white'
                  : 'text-stone-500 hover:bg-stone-200'
              }`}
              title="Точная реплика"
            >
              <ThumbsUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleFeedback('inaccurate')}
              className={`p-1 rounded cursor-pointer transition-colors ${
                feedbackGiven === 'inaccurate'
                  ? 'bg-rose-600 text-white'
                  : 'text-stone-500 hover:bg-stone-200'
              }`}
              title="Неточная реплика"
            >
              <ThumbsDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Popover / Overlay for "Почему?" Details */}
      {showReasoning && (
        <div className="absolute top-full left-0 right-0 mt-1 z-30 bg-white border border-stone-200 rounded-xl shadow-lg p-3 text-xs text-stone-700 space-y-2">
          <div className="flex items-center justify-between border-b border-stone-100 pb-1.5">
            <span className="font-semibold text-stone-900">Обоснование суфлёра ANDREI OS</span>
            <button
              onClick={() => setShowReasoning(false)}
              className="text-stone-400 hover:text-stone-600 font-bold px-1"
            >
              ✕
            </button>
          </div>
          <p className="text-stone-700 leading-relaxed">
            {suggestion.shortReason || 'Направление диалога к выявлению истинных критериев и потребностей клиента.'}
          </p>
          {suggestion.expectedClientMeaning && (
            <div className="bg-amber-50/70 p-2 rounded-lg border border-amber-200">
              <span className="font-semibold text-amber-900 block text-[11px] mb-0.5">Ожидаемый ответ клиента (смысл):</span>
              <span className="text-amber-950 font-medium">{suggestion.expectedClientMeaning}</span>
            </div>
          )}
          {evidenceQuote && (
            <div className="bg-stone-50 p-2 rounded-lg border border-stone-100">
              <span className="font-semibold text-stone-800 block text-[11px] mb-0.5">В ответ на слова клиента:</span>
              <span className="italic text-stone-600">«{evidenceQuote}»</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
