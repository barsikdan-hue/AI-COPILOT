import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Headphones, Clock, ArrowUp, Activity } from 'lucide-react';
import { TranscriptTurn } from '../types';

interface TranscriptFeedProps {
  turns: TranscriptTurn[];
  agentInterim: string;
  clientInterim: string;
  isAgentSpeaking: boolean;
  isClientSpeaking: boolean;
  highlightTurnIds?: string[];
}

export const TranscriptFeed: React.FC<TranscriptFeedProps> = React.memo(({
  turns,
  agentInterim,
  clientInterim,
  isAgentSpeaking,
  isClientSpeaking,
  highlightTurnIds = [],
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const reversedTurns = useMemo(() => Array.from(turns).reverse(), [turns]);
  const highlightedTurns = useMemo(() => new Set(highlightTurnIds), [highlightTurnIds]);

  // Auto-scroll to top when new turns or interim text arrives
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [turns, agentInterim, clientInterim, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const isAtTop = containerRef.current.scrollTop < 60;
    setAutoScroll(isAtTop);
  };

  const scrollToTop = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
      setAutoScroll(true);
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div
      id="transcript-feed-panel"
      className="transcript-panel bg-white rounded-xl border border-stone-200 shadow-sm flex flex-col relative overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-stone-100 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <span className="font-semibold text-stone-900 text-sm">
            Живой транскрипт
          </span>
          <span className="text-[11px] bg-stone-100 text-stone-600 px-2 py-0.5 rounded-full font-mono">
            {turns.length}
          </span>
        </div>

        {/* Live speech indicators */}
        <div className="flex items-center space-x-2 text-xs">
          {isAgentSpeaking && (
            <div className="flex items-center space-x-1 text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md text-[11px] font-medium">
              <Activity className="w-3 h-3 animate-pulse" />
              <span>Андрей говорит</span>
            </div>
          )}
          {isClientSpeaking && (
            <div className="flex items-center space-x-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md text-[11px] font-medium">
              <Activity className="w-3 h-3 animate-pulse" />
              <span>Клиент говорит</span>
            </div>
          )}
        </div>
      </div>

      {/* Feed Body - Top has freshest turns */}
      <div
        id="transcript-scroll-container"
        ref={containerRef}
        onScroll={handleScroll}
        className="transcript-scroll flex-1 p-3 sm:p-4 space-y-2.5 scroll-smooth"
      >
        {turns.length === 0 && !agentInterim && !clientInterim && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-stone-400">
            <Headphones className="w-8 h-8 mb-2 text-stone-300 stroke-[1.5]" />
            <p className="text-sm font-medium text-stone-600">Ожидание начала диалога</p>
            <p className="text-xs text-stone-400 mt-0.5 max-w-xs">
              Реплики будут мгновенно транскрибироваться в реальном времени.
            </p>
          </div>
        )}

        {/* Real-time Interim Streaming Bubble for Agent (Top) */}
        {agentInterim && (
          <div className="flex flex-col items-end animate-in fade-in duration-100">
            <div className="flex items-center space-x-1 text-[11px] text-teal-700 mb-0.5 px-1">
              <span className="font-semibold">Андрей</span>
              <span className="italic text-[10px]">(распознавание...)</span>
            </div>
            <div className="max-w-[85%] rounded-xl px-3.5 py-2 text-[15px] sm:text-[16px] bg-teal-50/80 text-teal-950 rounded-tr-none border border-teal-200 italic animate-pulse leading-snug">
              {agentInterim}
            </div>
          </div>
        )}

        {/* Real-time Interim Streaming Bubble for Client (Top) */}
        {clientInterim && (
          <div className="flex flex-col items-start animate-in fade-in duration-100">
            <div className="flex items-center space-x-1 text-[11px] text-emerald-700 mb-0.5 px-1">
              <span className="font-semibold">Клиент</span>
              <span className="italic text-[10px]">(распознавание...)</span>
            </div>
            <div className="max-w-[85%] rounded-xl px-3.5 py-2 text-[15px] sm:text-[16px] bg-emerald-50/80 text-emerald-950 rounded-tl-none border border-emerald-200 italic animate-pulse leading-snug">
              {clientInterim}
            </div>
          </div>
        )}

        {/* Completed Turns in reverse order: newest first at the top */}
        {reversedTurns.map((turn) => {
          const isAgent = turn.speaker === 'agent';
          const isHighlighted = highlightedTurns.has(turn.id);

          return (
            <div
              key={turn.id}
              id={`turn-${turn.id}`}
              className={`flex flex-col transition-all group ${
                isAgent ? 'items-end' : 'items-start'
              }`}
            >
              {/* Speaker Label & Timestamp (Clean, non-intrusive) */}
              <div className="flex items-center space-x-1 text-[11px] text-stone-400 mb-0.5 px-1">
                {isAgent ? (
                  <>
                    <span className="font-semibold text-teal-900">Андрей</span>
                    <span>•</span>
                    <Clock className="w-2.5 h-2.5 opacity-60" />
                    <span>{formatTime(turn.timestamp)}</span>
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-stone-700">Клиент</span>
                    <span>•</span>
                    <Clock className="w-2.5 h-2.5 opacity-60" />
                    <span>{formatTime(turn.timestamp)}</span>
                  </>
                )}
                {/* ID shown only on hover to remove visual noise */}
                <span
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-stone-400 font-mono ml-1"
                  title={`ID реплики: ${turn.id}`}
                >
                  #{turn.id.slice(-4)}
                </span>
              </div>

              {/* Turn Bubble: 15–16 px readable text */}
              <div
                className={`max-w-[88%] rounded-xl px-3.5 py-2 text-[15px] sm:text-[16px] leading-relaxed transition-shadow ${
                  isAgent
                    ? 'bg-stone-100 text-stone-900 rounded-tr-none border border-stone-200/90'
                    : `bg-white text-stone-900 rounded-tl-none border ${
                        isHighlighted
                          ? 'border-teal-500 ring-2 ring-teal-100 shadow-xs'
                          : 'border-stone-200'
                      }`
                }`}
              >
                <p className="whitespace-pre-wrap">{turn.text}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating Scroll-to-Top Button ("К последней реплике") */}
      {!autoScroll && (
        <button
          id="scroll-to-top-btn"
          onClick={scrollToTop}
          className="absolute bottom-3 right-3 flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white shadow-md border border-stone-200 text-stone-700 hover:text-stone-900 hover:bg-stone-50 transition-colors cursor-pointer text-xs font-medium z-10"
          title="К последней реплике"
        >
          <ArrowUp className="w-3.5 h-3.5 text-teal-600" />
          <span>К последней реплике</span>
        </button>
      )}
    </div>
  );
});
