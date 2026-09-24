import React, { useState } from 'react';
import { X, CheckCircle, AlertTriangle, RefreshCw, Cpu, Activity, ShieldCheck, Wifi } from 'lucide-react';
import { DiagnosticsData } from '../types';

interface DiagnosticsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  diagnostics: DiagnosticsData;
  onRunHealthCheck: () => Promise<any>;
}

export const DiagnosticsDrawer: React.FC<DiagnosticsDrawerProps> = ({
  isOpen,
  onClose,
  diagnostics,
  onRunHealthCheck,
}) => {
  const [isChecking, setIsChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<any>(null);
  const isLocalAnalysis = diagnostics.analysisModel === 'local-deterministic';

  if (!isOpen) return null;

  const handleCheck = async () => {
    setIsChecking(true);
    try {
      const res = await onRunHealthCheck();
      setCheckResult(res);
    } catch (e: any) {
      setCheckResult({ ok: false, error: e.message || 'Ошибка связи' });
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end bg-black/30 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center space-x-2">
            <Cpu className="w-5 h-5 text-teal-700" />
            <h2 className="font-semibold text-stone-900 text-sm">
              Системная диагностика Copilot
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-stone-500 hover:text-stone-800 hover:bg-stone-200/60 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 text-xs">
          {diagnostics.lastErrorMessage && (
            <div id="diagnostics-last-error" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
              {diagnostics.lastErrorMessage}
            </div>
          )}
          {/* Real Models Status */}
          <div className="bg-stone-50 rounded-lg p-3 border border-stone-200 space-y-2.5">
            <div className="font-semibold text-stone-800 flex items-center justify-between">
              <span>Используемые движки</span>
              <span className="flex items-center space-x-1 text-emerald-700 text-[11px]">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Серверная защита ключа</span>
              </span>
            </div>

            <div className="space-y-1.5 text-stone-600">
              <div className="flex justify-between items-center py-1 border-b border-stone-200/60">
                <span>Потоковая речь (Live STT):</span>
                <span className="font-mono font-medium text-stone-900">
                  {diagnostics.actualModel || 'gemini-3.5-transcribe-live'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-stone-200/60">
                <span>Анализ и подсказки:</span>
                <span className="font-mono font-medium text-stone-900">
                  {diagnostics.analysisModel || 'gemini-3.1-flash-lite'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span>Формат аудиопотока:</span>
                <span className="font-mono text-stone-900">
                  PCM16 Mono 16000Hz (вход: mic {diagnostics.currentMicSampleRate || 16000}Hz / call {diagnostics.currentCallSampleRate || 16000}Hz)
                </span>
              </div>
            </div>
          </div>

          {/* Optimization & Quota Metrics (Requirement 16 & 15) */}
          <div className="bg-stone-50 rounded-lg p-3 border border-teal-200/80 space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-stone-800 text-xs">Анализ и использование API</div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 font-medium">
                {isLocalAnalysis ? 'Локальный режим' : 'Gemini + fallback'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-stone-600">
              <div className="bg-white p-2 rounded border border-stone-200">
                <span className="text-[10px] text-stone-400 block">Live STT-сессий</span>
                <span className="font-mono font-semibold text-stone-900 text-sm">
                  {diagnostics.liveSttSessionsCount || 0}
                </span>
              </div>

              <div className="bg-white p-2 rounded border border-stone-200">
                <span className="text-[10px] text-stone-400 block">Запросов анализа</span>
                <span className="font-mono font-semibold text-teal-700 text-sm">
                  {diagnostics.analysisRequestsCount}
                </span>
              </div>

              <div className="bg-white p-2 rounded border border-stone-200">
                <span className="text-[10px] text-stone-400 block">Отменено запросов</span>
                <span className="font-mono font-semibold text-amber-700 text-sm">
                  {diagnostics.cancelledRequestsCount || 0}
                </span>
              </div>

              <div className="bg-white p-2 rounded border border-stone-200">
                <span className="text-[10px] text-stone-400 block">Отклонено шлюзом</span>
                <span className="font-mono font-semibold text-stone-700 text-sm">
                  {diagnostics.rejectedAnalysisCount || 0}
                </span>
              </div>
            </div>

            {diagnostics.lastRejectedReason && (
              <div className="bg-white p-2 rounded border border-stone-200 text-[11px] text-stone-600">
                <span className="text-stone-400 block text-[10px]">Причина отклонения:</span>
                <span className="font-medium text-stone-800">{diagnostics.lastRejectedReason}</span>
              </div>
            )}

            <div className="bg-white p-2 rounded border border-stone-200 space-y-1 text-[11px]">
              <div className="flex justify-between items-center text-stone-500">
                <span>Gemini-контекст (не блокирует карточку):</span>
                <span className="font-mono font-semibold text-stone-900">
                  {diagnostics.geminiLatencyMs != null ? `${diagnostics.geminiLatencyMs} мс` : '—'}
                </span>
              </div>
              <div className="text-stone-500">
                Локальное решение: {diagnostics.localDecisionLatencyMs ?? '—'} мс · Первая подсказка: {diagnostics.firstHintLatencyMs ?? '—'} мс
              </div>
              <div className="flex justify-between items-center text-stone-500">
                <span>Время последнего запроса:</span>
                <span className="font-mono text-stone-800">
                  {diagnostics.lastRequestTime ? new Date(diagnostics.lastRequestTime).toLocaleTimeString() : '—'}
                </span>
              </div>
              <div className="text-stone-500">
                <span>Причина отправки: </span>
                <span className="text-stone-800 font-medium">
                  {diagnostics.lastRequestReason || 'Запрос ещё не отправлялся'}
                </span>
              </div>
            </div>
          </div>

          {/* Connection & Status Metrics */}
          <div className="bg-stone-50 rounded-lg p-3 border border-stone-200 space-y-2">
            <div className="font-semibold text-stone-800">Статусы потоков аудио и буферов</div>
            <div className="grid grid-cols-2 gap-2 text-stone-600">
              <div className="bg-white p-2 rounded border border-stone-200">
                <span className="text-[10px] text-stone-400 block">STT (Андрей)</span>
                <span className="font-medium text-stone-900 text-xs block">
                  {diagnostics.sttAgentStatus}
                </span>
                <span className="text-[10px] text-stone-500">
                  Дроп: {diagnostics.droppedAudioChunksMic || 0} чанков
                </span>
              </div>

              <div className="bg-white p-2 rounded border border-stone-200">
                <span className="text-[10px] text-stone-400 block">STT (Клиент)</span>
                <span className="font-medium text-stone-900 text-xs block">
                  {diagnostics.sttClientStatus}
                </span>
                <span className="text-[10px] text-stone-500">
                  Дроп: {diagnostics.droppedAudioChunksCall || 0} чанков
                </span>
              </div>
            </div>

            <div className="bg-white p-2 rounded border border-stone-200 text-[11px] text-stone-600 flex justify-between">
              <span>Реконнекты STT:</span>
              <span className="font-mono font-medium text-stone-800">
                микрофон: {diagnostics.micReconnectCount || 0} / звонок: {diagnostics.clientReconnectCount || 0}
              </span>
            </div>

            {diagnostics.reconnectCount > 0 && (
              <div className="flex items-center space-x-1 text-amber-700 text-[11px] pt-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Переподключений сессии: {diagnostics.reconnectCount}</span>
              </div>
            )}
          </div>

          {/* Verification Trigger Button */}
          <div className="pt-2">
            <button
              onClick={handleCheck}
              disabled={isChecking}
              className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:bg-stone-300 text-white font-medium transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
              <span>
                {isChecking
                  ? 'Проверка движков...'
                  : isLocalAnalysis
                    ? 'Проверить локальное ядро'
                    : 'Выполнить живой тест Gemini API'}
              </span>
            </button>
          </div>

          {/* Test Results Output */}
          {checkResult && (
            <div
              className={`rounded-lg p-3 border text-xs ${
                checkResult.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                  : 'bg-red-50 border-red-200 text-red-950'
              }`}
            >
              <div className="flex items-center space-x-1.5 font-semibold mb-1">
                {checkResult.ok ? (
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                )}
                <span>
                  {checkResult.ok ? 'Движок готов к работе' : 'Ошибка подключения'}
                </span>
              </div>

              {checkResult.ok ? (
                <div className="space-y-1 text-[11px]">
                  <p>• Полная проверка Gemini API: {checkResult.latencyMs} мс</p>
                  <p>• Live Transcribe: {checkResult.transcribeLiveReady ? 'доступна' : 'не проверялась / недоступна'}</p>
                  <p>• Модель анализа: {checkResult.workingAnalysisModel}</p>
                  {checkResult.message && <p>• {checkResult.message}</p>}
                </div>
              ) : (
                <div className="text-[11px] text-red-800">
                  {checkResult.error || 'Проверьте сетевое соединение и конфигурацию ключа.'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
