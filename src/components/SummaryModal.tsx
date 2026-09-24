import React from 'react';
import {
  CheckCircle2,
  Download,
  FileText,
  X,
  HardDrive,
  Target,
  HelpCircle,
  AlertCircle,
  ArrowRight,
  Award,
  ShieldCheck,
  Video,
  Check,
  Minus,
} from 'lucide-react';
import { CallSessionRecord, CallSummary } from '../types';
import { exportSessionToTxt, downloadFile } from '../services/sessionStorage';
import { getCategoryLabel, getMetricLabel, getObjectionLabel, isRealObjection } from '../utils/labels';

interface SummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionRecord: CallSessionRecord | null;
  summary: CallSummary | null;
  isLoading: boolean;
}

export const SummaryModal: React.FC<SummaryModalProps> = ({
  isOpen,
  onClose,
  sessionRecord,
  summary,
  isLoading,
}) => {
  if (!isOpen || !sessionRecord) return null;

  const handleExportTxt = () => {
    const txt = exportSessionToTxt(sessionRecord);
    const filename = `call_summary_${new Date(sessionRecord.startedAt).toISOString().slice(0, 10)}_${sessionRecord.id.slice(0, 6)}.txt`;
    downloadFile(filename, txt, 'text/plain;charset=utf-8');
  };

  const handleExportJson = () => {
    const json = JSON.stringify(sessionRecord, null, 2);
    const filename = `call_record_${new Date(sessionRecord.startedAt).toISOString().slice(0, 10)}_${sessionRecord.id.slice(0, 6)}.json`;
    downloadFile(filename, json, 'application/json;charset=utf-8');
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] shadow-2xl flex flex-col overflow-hidden border border-stone-200">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-teal-700" />
            <div>
              <h2 className="text-base font-semibold text-stone-900">
                Итоги звонка риелтора Андрея
              </h2>
              <span className="text-xs text-stone-500">
                Длительность: {Math.floor(sessionRecord.durationSeconds / 60)} мин {sessionRecord.durationSeconds % 60} сек • {sessionRecord.turns.length} реплик
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs sm:text-sm">
          {isLoading ? (
            <div className="py-12 text-center text-stone-500">
              <div className="w-8 h-8 border-3 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="font-medium text-stone-800">Формирование структурированного итога...</p>
              <p className="text-xs text-stone-400 mt-1">Анализ реплик и извлечение фактов через Gemini</p>
            </div>
          ) : summary ? (
            <>
              {/* Client Goal & Next Step Banner */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-teal-50/70 border border-teal-200 rounded-xl p-3.5">
                  <div className="flex items-center space-x-1.5 text-xs font-semibold text-teal-900 mb-1">
                    <Target className="w-4 h-4 text-teal-700" />
                    <span>Цель клиента:</span>
                  </div>
                  <p className="text-stone-900 font-medium text-sm">
                    {summary.clientGoal || 'Не уточнено'}
                  </p>
                </div>

                <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5">
                  <div className="flex items-center space-x-1.5 text-xs font-semibold text-emerald-900 mb-1">
                    <ArrowRight className="w-4 h-4 text-emerald-700" />
                    <span>Согласованный следующий шаг:</span>
                  </div>
                  <p className="text-stone-900 font-medium text-sm">
                    {summary.agreedNextStep || 'Следующий шаг не согласован'}
                  </p>
                </div>
              </div>

              {/* Quality Control & First Call Script System Assessment */}
              {summary.qualityResult && (
                <div className="bg-stone-50 border border-stone-200 rounded-xl p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Award className="w-4 h-4 text-teal-700" />
                      <span className="font-bold text-stone-900 text-xs sm:text-sm">
                        Оценка качества первого звонка
                      </span>
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                        summary.qualityResult.isQualityCall
                          ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                          : 'bg-amber-50 text-amber-900 border-amber-300'
                      }`}
                    >
                      {summary.qualityResult.isQualityCall ? '✓ Стандарт выполнен' : 'Требует доработки'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div className="bg-white p-2 rounded-lg border border-stone-200">
                      <span className="text-stone-500 block text-[11px]">Ядро критериев:</span>
                      <span className="font-bold text-stone-900 text-sm">
                        {summary.qualityResult.passedCoreCriteriaCount} / 12
                      </span>
                      <span className="text-[10px] text-stone-400 block mt-0.5">Минимум для зачёта: 7</span>
                    </div>

                    <div className="bg-white p-2 rounded-lg border border-stone-200">
                      <span className="text-stone-500 block text-[11px]">Доверие (Trust):</span>
                      <span className="font-bold text-stone-900 text-sm">
                        {summary.trustEvaluation?.openTechnicalQuestionsCount ?? 0} техн. / {summary.trustEvaluation?.openPersonalQuestionsCount ?? 0} личн.
                      </span>
                      <span className="text-[10px] text-stone-400 block mt-0.5">Норма: 3 техн. + 2 личн.</span>
                    </div>

                    <div className="bg-white p-2 rounded-lg border border-stone-200">
                      <span className="text-stone-500 block text-[11px]">Правило 40/60:</span>
                      <span
                        className={`font-bold text-sm ${
                          Math.round((summary.trustEvaluation?.clientSpeechRatio ?? 0) * 100) >= 40
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {Math.round((summary.trustEvaluation?.clientSpeechRatio ?? 0) * 100)}% речи клиента
                      </span>
                      <span className="text-[10px] text-stone-400 block mt-0.5">Норма: ≥ 40%</span>
                    </div>
                  </div>

                  {/* 18 Indicators Breakdown */}
                  {summary.firstCallMetrics && (
                    <div className="pt-1">
                      <span className="text-[11px] font-semibold text-stone-700 block mb-1.5">
                        Статус 18 показателей первого звонка:
                      </span>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px]">
                        {(Array.isArray(summary.firstCallMetrics)
                          ? summary.firstCallMetrics
                          : Object.values(summary.firstCallMetrics)
                        ).map((m: any) => (
                          <div
                            key={m.id}
                            className={`flex items-center space-x-1.5 px-2 py-1 rounded border ${
                              m.status === 'confirmed'
                                ? 'bg-emerald-50 text-emerald-950 border-emerald-200'
                                : m.status === 'partially_confirmed' || m.status === 'partial'
                                ? 'bg-amber-50 text-amber-950 border-amber-200'
                                : 'bg-stone-100 text-stone-400 border-stone-200'
                            }`}
                          >
                            {m.status === 'confirmed' ? (
                              <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                            ) : m.status === 'partially_confirmed' || m.status === 'partial' ? (
                              <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />
                            ) : (
                              <Minus className="w-3 h-3 text-stone-300 shrink-0" />
                            )}
                            <span className="truncate" title={m.value || m.name}>
                              {m.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Confirmed Facts */}
              {summary.confirmedFacts?.length > 0 && (
                <div className="space-y-2">
                  <span className="font-semibold text-stone-800 block text-xs">
                    Подтверждённые факты (с цитатами из речи клиента):
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {summary.confirmedFacts.map((fact, idx) => {
                      const quote = fact.evidenceQuote || fact.quote;
                      return (
                        <div
                          key={idx}
                          className="bg-stone-50 border border-stone-200 rounded-lg p-2.5 text-xs"
                        >
                          <div className="flex items-center justify-between text-[11px] text-stone-500 mb-0.5">
                            <span className="font-semibold text-teal-800 uppercase tracking-wider text-[10px]">
                              {fact.label || getCategoryLabel(fact.category) || getMetricLabel(fact.category) || fact.category || 'Факт'}
                            </span>
                            {fact.turnId && (
                              <span className="font-mono text-[10px]">#{fact.turnId.slice(-4)}</span>
                            )}
                          </div>
                          <div className="font-semibold text-stone-900 mt-0.5">{fact.value}</div>
                          {quote && (
                            <div className="italic text-stone-600 bg-white p-1.5 rounded border border-stone-100 mt-1.5 text-[11px]">
                              «{quote}»
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* SPIN Analysis Blocks if present */}
              {summary.spin && (
                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 space-y-2">
                  <span className="font-semibold text-stone-800 block text-xs">
                    Диагностика по методологии SPIN:
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {summary.spin.situation?.length ? (
                      <div className="p-2 bg-white rounded-lg border border-stone-200">
                        <span className="font-medium text-blue-900 block mb-1">Ситуация (Situation):</span>
                        <ul className="list-disc list-inside text-stone-600 space-y-0.5">
                          {summary.spin.situation.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    {summary.spin.problem?.length ? (
                      <div className="p-2 bg-amber-50/50 rounded-lg border border-amber-200">
                        <span className="font-medium text-amber-900 block mb-1">Проблема (Problem):</span>
                        <ul className="list-disc list-inside text-amber-950 space-y-0.5">
                          {summary.spin.problem.map((p, i) => <li key={i}>{p}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    {summary.spin.implication?.length ? (
                      <div className="p-2 bg-rose-50/50 rounded-lg border border-rose-200">
                        <span className="font-medium text-rose-900 block mb-1">Последствия (Implication):</span>
                        <ul className="list-disc list-inside text-rose-950 space-y-0.5">
                          {summary.spin.implication.map((imp, i) => <li key={i}>{imp}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    {summary.spin.needPayoff?.length ? (
                      <div className="p-2 bg-teal-50/50 rounded-lg border border-teal-200">
                        <span className="font-medium text-teal-900 block mb-1">Ценность решения (Need-Payoff):</span>
                        <ul className="list-disc list-inside text-teal-950 space-y-0.5">
                          {summary.spin.needPayoff.map((np, i) => <li key={i}>{np}</li>)}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              {/* Unconfirmed Data Requiring Verification */}
              {((summary.unconfirmedData && summary.unconfirmedData.length > 0) ||
                (summary.unconfirmedHypotheses && summary.unconfirmedHypotheses.length > 0)) && (
                <div className="p-3 bg-amber-50/40 rounded-xl border border-amber-200 space-y-1.5">
                  <span className="font-semibold text-amber-900 block text-xs">
                    Требует подтверждения / не доказано цитатами:
                  </span>
                  <div className="space-y-1">
                    {((summary.unconfirmedHypotheses || summary.unconfirmedData || []) as any[]).map((u, i) => {
                      const cat = typeof u === 'string' ? 'Гипотеза' : (u.category || 'Гипотеза');
                      const txt = typeof u === 'string' ? u : (u.text || '');
                      const reason = typeof u === 'string' ? undefined : u.reason;
                      return (
                        <div key={i} className="text-xs bg-white p-2 rounded border border-amber-200 text-stone-800">
                          <span className="font-semibold text-amber-950">{cat}: </span>
                          <span>{txt}</span>
                          {reason && (
                            <span className="text-stone-500 block text-[11px] mt-0.5">Причина: {reason}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Open Questions & Objections */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {summary.openQuestions && summary.openQuestions.length > 0 && (
                  <div className="bg-stone-50 border border-stone-200 rounded-xl p-3">
                    <div className="flex items-center space-x-1.5 font-semibold text-stone-700 text-xs mb-2">
                      <HelpCircle className="w-3.5 h-3.5 text-stone-500" />
                      <span>Что осталось не выяснено:</span>
                    </div>
                    <ul className="space-y-1 text-xs text-stone-600 list-disc list-inside">
                      {summary.openQuestions.map((q, idx) => (
                        <li key={idx}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {(() => {
                  const realObjs = (summary.objections || []).filter(isRealObjection);
                  if (realObjs.length === 0) return null;
                  return (
                    <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3">
                      <div className="flex items-center space-x-1.5 font-semibold text-amber-900 text-xs mb-2">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                        <span>Возражения и сомнения:</span>
                      </div>
                      <ul className="space-y-1 text-xs text-amber-950 list-disc list-inside">
                        {realObjs.map((o, idx) => (
                          <li key={idx}>{getObjectionLabel(o)}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
              </div>

              {/* Andrei OS Professional Review: Strong Point & Specific Improvement */}
              {(summary.strongPoint || summary.specificImprovement) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {summary.strongPoint && (
                    <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3">
                      <span className="font-semibold text-emerald-950 block text-xs mb-1">
                        Сильная сторона Андрея в диалоге:
                      </span>
                      <p className="text-emerald-900 text-xs leading-relaxed">
                        {summary.strongPoint}
                      </p>
                    </div>
                  )}
                  {summary.specificImprovement && (
                    <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-3">
                      <span className="font-semibold text-blue-950 block text-xs mb-1">
                        Конкретная точка роста (на следующий контакт):
                      </span>
                      <p className="text-blue-900 text-xs leading-relaxed">
                        {summary.specificImprovement}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Recommendations */}
              {summary.recommendations && summary.recommendations.length > 0 && (
                <div className="bg-teal-50/50 border border-teal-200 rounded-xl p-3">
                  <span className="font-semibold text-teal-900 block text-xs mb-1.5">
                    Рекомендации Андрею к следующему контакту:
                  </span>
                  <ul className="space-y-1 text-xs text-teal-950 list-disc list-inside">
                    {summary.recommendations.map((rec: string, idx: number) => (
                      <li key={idx}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="text-stone-500">Итог звонка отсутствует.</p>
          )}

          {/* Local Persistence Info */}
          <div className="flex items-center space-x-2 text-xs text-stone-500 bg-stone-50 p-2.5 rounded-lg border border-stone-200">
            <HardDrive className="w-4 h-4 text-stone-400 shrink-0" />
            <span>
              Звонок и транскрипт автоматически сохранены в локальную базу IndexedDB на этом устройстве.
            </span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-stone-200 bg-stone-50 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <button
              onClick={handleExportTxt}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-100 text-xs font-medium transition-colors cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Экспорт TXT</span>
            </button>
            <button
              onClick={handleExportJson}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-100 text-xs font-medium transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Экспорт JSON</span>
            </button>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium transition-colors cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
