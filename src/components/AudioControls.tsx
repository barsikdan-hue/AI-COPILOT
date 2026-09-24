import React from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  PhoneCall,
  PhoneOff,
  Pause,
  Play,
  AlertTriangle,
  Zap,
  PlayCircle,
  History,
  Cpu,
} from 'lucide-react';
import { CallStage } from '../types';

interface AudioControlsProps {
  isMicActive: boolean;
  isCallAudioActive: boolean;
  micLevel: number;
  micDb: number;
  callLevel: number;
  callDb: number;
  isCallRunning: boolean;
  isPaused: boolean;
  callDuration: number;
  currentStage: CallStage;
  onToggleMic: () => void;
  onToggleCallAudio: () => void;
  onStartCall: () => void;
  onEndCall: () => void;
  onTogglePause: () => void;
  onOpenDiagnostics: () => void;
  firstHintLatencyMs: number | null;
  isAnalyzing?: boolean;
  hasAnalysisError?: boolean;
  isTranscribing?: boolean;
  isCompleted?: boolean;
  conversationMode: 'live_call' | 'test_dialogue' | 'technical_discussion';
  onChangeMode: (mode: 'live_call' | 'test_dialogue' | 'technical_discussion') => void;
  onOpenHistory: () => void;
  onOpenSimulator: () => void;
  pastSessionsCount: number;
}

export const AudioControls: React.FC<AudioControlsProps> = ({
  isMicActive,
  isCallAudioActive,
  micLevel,
  callLevel,
  isCallRunning,
  isPaused,
  callDuration,
  currentStage,
  onToggleMic,
  onToggleCallAudio,
  onStartCall,
  onEndCall,
  onTogglePause,
  onOpenDiagnostics,
  firstHintLatencyMs,
  conversationMode,
  onChangeMode,
  onOpenHistory,
  onOpenSimulator,
  pastSessionsCount,
}) => {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStageShort = (stage: CallStage) => {
    switch (stage) {
      case 'contact':
        return 'Контакт';
      case 'diagnostics':
        return 'Диагностика';
      case 'objection_clarification':
        return 'Возражения';
      case 'next_step_agreement':
        return 'Целевой шаг';
      default:
        return 'Диагностика';
    }
  };

  return (
    <header
      id="unified-top-bar"
      className="bg-white border-b border-stone-200 sticky top-0 z-30 shadow-2xs h-13 sm:h-14 flex items-center px-3 sm:px-5 shrink-0"
    >
      <div className="w-full flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Brand & Live Call Status */}
        <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-teal-700 flex items-center justify-center text-white font-bold text-xs tracking-wider shadow-2xs">
              AI
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-stone-900 text-sm sm:text-base tracking-tight leading-none">
                AI Copilot <span className="hidden md:inline font-normal text-xs text-stone-500">риелтора</span>
              </span>
              <span className="text-[10px] text-teal-700 font-semibold tracking-wide">
                ANDREI OS
              </span>
            </div>
          </div>

          {/* Call Status Indicator */}
          {isCallRunning ? (
            <div className="flex items-center space-x-2 bg-red-50 text-red-800 border border-red-200 px-2.5 py-1 rounded-lg text-xs">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="font-mono font-bold">{formatTime(callDuration)}</span>
              <span className="hidden lg:inline text-red-600/80">•</span>
              <span className="hidden lg:inline font-medium text-[11px]">{getStageShort(currentStage)}</span>
            </div>
          ) : (
            <div className="hidden lg:flex items-center space-x-1.5 bg-stone-100 text-stone-600 border border-stone-200 px-2 py-0.5 rounded-md text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-stone-400" />
              <span>Готов к звонку</span>
            </div>
          )}

          {/* Warning if Client audio not captured */}
          {isCallRunning && isMicActive && !isCallAudioActive && (
            <div
              className="hidden xl:flex items-center space-x-1 bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded text-[11px]"
              title="Звук собеседника не транскрибируется"
            >
              <AlertTriangle className="w-3 h-3 text-amber-600" />
              <span>Звук клиента не захвачен</span>
            </div>
          )}
        </div>

        {/* Center: Audio Channels & Analysis Latency */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* Andrei Mic */}
          <div
            id="mic-channel-card"
            className={`flex items-center space-x-1.5 px-2 py-1 rounded-lg border text-xs transition-colors ${
              isMicActive
                ? 'bg-teal-50/80 border-teal-200 text-teal-950'
                : 'bg-stone-50 border-stone-200 text-stone-500'
            }`}
          >
            <button
              id="toggle-mic-btn"
              onClick={onToggleMic}
              title={isMicActive ? 'Отключить микрофон' : 'Включить микрофон'}
              className={`p-1 rounded transition-colors cursor-pointer ${
                isMicActive ? 'bg-teal-600 text-white hover:bg-teal-700' : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
              }`}
            >
              {isMicActive ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
            </button>
            <span className="hidden sm:inline font-medium text-[11px]">Микрофон</span>
            <div className="w-8 sm:w-10 bg-stone-200 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-teal-600 h-full transition-all duration-75"
                style={{ width: `${isMicActive ? Math.min(100, Math.max(8, micLevel * 100)) : 0}%` }}
              />
            </div>
          </div>

          {/* Client Audio */}
          <div
            id="call-audio-channel-card"
            className={`flex items-center space-x-1.5 px-2 py-1 rounded-lg border text-xs transition-colors ${
              isCallAudioActive
                ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                : 'bg-stone-50 border-stone-200 text-stone-500'
            }`}
          >
            <button
              id="toggle-call-audio-btn"
              onClick={onToggleCallAudio}
              title={isCallAudioActive ? 'Отключить звук клиента' : 'Захватить звук клиента из вкладки/экрана'}
              className={`p-1 rounded transition-colors cursor-pointer ${
                isCallAudioActive ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
              }`}
            >
              {isCallAudioActive ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>
            <span className="hidden sm:inline font-medium text-[11px]">Звук клиента</span>
            <div className="w-8 sm:w-10 bg-stone-200 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-emerald-600 h-full transition-all duration-75"
                style={{ width: `${isCallAudioActive ? Math.min(100, Math.max(8, callLevel * 100)) : 0}%` }}
              />
            </div>
          </div>

          {/* Analysis Latency Button */}
          <button
            id="open-diagnostics-badge-btn"
            onClick={onOpenDiagnostics}
            className="flex items-center space-x-1 px-2 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs transition-colors cursor-pointer border border-stone-200"
            title="Полная задержка: конец реплики клиента → готовая подсказка. Нажмите для диагностики"
          >
            <Zap className="w-3 h-3 text-teal-600" /><span>Подсказка</span>
            <span className="font-mono text-[11px]">
              {firstHintLatencyMs != null ? `${Math.round(firstHintLatencyMs)} мс` : '—'}
            </span>
          </button>
        </div>

        {/* Right: Primary Call Action & Compact Tool Buttons */}
        <div className="flex items-center space-x-2 shrink-0">
          {/* Pause Button */}
          {isCallRunning && (
            <button
              id="pause-call-btn"
              onClick={onTogglePause}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border border-stone-300 text-stone-700 bg-white hover:bg-stone-50 text-xs font-medium transition-colors cursor-pointer min-h-[36px]"
              title={isPaused ? 'Возобновить звонок' : 'Поставить на паузу'}
            >
              {isPaused ? <Play className="w-3.5 h-3.5 text-teal-700" /> : <Pause className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{isPaused ? 'Продолжить' : 'Пауза'}</span>
            </button>
          )}

          {/* Big Action Button: Start / End Call */}
          {!isCallRunning ? (
            <button
              id="start-call-btn"
              onClick={onStartCall}
              className="flex items-center space-x-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-xs sm:text-sm shadow-xs transition-colors cursor-pointer min-h-[36px]"
            >
              <PhoneCall className="w-4 h-4" />
              <span>Начать звонок</span>
            </button>
          ) : (
            <button
              id="end-call-btn"
              onClick={onEndCall}
              className="flex items-center space-x-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-xs sm:text-sm shadow-xs transition-colors cursor-pointer min-h-[36px]"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Завершить звонок</span>
            </button>
          )}

          {/* Compact Utilities Dropdown/Buttons */}
          <div className="hidden lg:flex items-center space-x-1 pl-1 border-l border-stone-200">
            {/* Mode Selector */}
            <select
              value={conversationMode}
              onChange={(e) => onChangeMode(e.target.value as any)}
              className="text-[11px] font-medium border border-stone-200 rounded-lg px-2 py-1.5 bg-stone-50 text-stone-700 cursor-pointer hover:bg-stone-100 min-h-[36px] outline-none"
              title="Режим диалога"
            >
              <option value="live_call">Боевой звонок</option>
              <option value="test_dialogue">Тест диалог</option>
              <option value="technical_discussion">Тех. обсуждение</option>
            </select>

            {/* Test Rules */}
            <button
              id="open-simulator-btn"
              onClick={onOpenSimulator}
              className="p-2 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 transition-colors cursor-pointer min-h-[36px]"
              title="Тест правил продаж (симулятор)"
            >
              <PlayCircle className="w-4 h-4 text-teal-600" />
            </button>

            {/* History */}
            <button
              id="open-history-btn"
              onClick={onOpenHistory}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 text-xs font-medium transition-colors cursor-pointer min-h-[36px]"
              title="История звонков"
            >
              <History className="w-3.5 h-3.5 text-stone-600" />
              <span>{pastSessionsCount}</span>
            </button>

            {/* Diagnostics */}
            <button
              id="open-diagnostics-btn"
              onClick={onOpenDiagnostics}
              className="p-2 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 transition-colors cursor-pointer min-h-[36px]"
              title="Системная диагностика"
            >
              <Cpu className="w-4 h-4 text-teal-600" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
