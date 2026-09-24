import React from 'react';
import { X, Calendar, Clock, Trash2, FileText, Download, ChevronRight, HardDrive } from 'lucide-react';
import { CallSessionRecord } from '../types';
import { exportSessionToTxt, downloadFile } from '../services/sessionStorage';

interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: CallSessionRecord[];
  onSelectSession: (session: CallSessionRecord) => void;
  onDeleteSession: (id: string) => void;
  onClearAll: () => void;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  isOpen,
  onClose,
  sessions,
  onSelectSession,
  onDeleteSession,
  onClearAll,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end bg-black/30 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center space-x-2">
            <Clock className="w-5 h-5 text-teal-700" />
            <h2 className="font-semibold text-stone-900 text-sm">
              История звонков на устройстве
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-stone-500 hover:text-stone-800 hover:bg-stone-200/60 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Notice */}
        <div className="px-4 py-2 bg-stone-50 border-b border-stone-200 text-[11px] text-stone-500 flex items-center space-x-1.5">
          <HardDrive className="w-3.5 h-3.5 text-stone-400 shrink-0" />
          <span>Все звонки сохраняются в локальную базу браузера (IndexedDB).</span>
        </div>

        {/* List */}
        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          {sessions.length === 0 ? (
            <div className="py-12 text-center text-stone-400 text-xs">
              <Calendar className="w-8 h-8 text-stone-300 mx-auto mb-2" />
              <p>История пуста</p>
              <p className="mt-1">Завершённые звонки будут автоматически сохранены здесь.</p>
            </div>
          ) : (
            sessions.map((sess) => {
              const dateStr = new Date(sess.startedAt).toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
              });
              const mins = Math.floor(sess.durationSeconds / 60);
              const secs = sess.durationSeconds % 60;

              return (
                <div
                  key={sess.id}
                  className="bg-stone-50 hover:bg-stone-100/80 rounded-xl p-3 border border-stone-200 transition-colors flex flex-col space-y-2"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-semibold text-stone-900 text-xs block">
                        {sess.summary?.clientGoal || sess.state.goal.value || 'Звонок без указания цели'}
                      </span>
                      <span className="text-[11px] text-stone-500">
                        {dateStr} • {mins}м {secs}с • {sess.turns.length} реплик
                      </span>
                    </div>

                    <button
                      onClick={() => onDeleteSession(sess.id)}
                      className="text-stone-400 hover:text-red-600 p-1 transition-colors cursor-pointer"
                      title="Удалить запись"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Summary preview */}
                  {sess.summary?.agreedNextStep && (
                    <div className="text-[11px] text-teal-900 bg-teal-50/80 p-2 rounded-md border border-teal-100">
                      <span className="font-semibold">Шаг:</span> {sess.summary.agreedNextStep}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-1 text-xs">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => {
                          const txt = exportSessionToTxt(sess);
                          downloadFile(`call_${sess.id.slice(0, 6)}.txt`, txt, 'text/plain;charset=utf-8');
                        }}
                        className="text-stone-600 hover:text-stone-900 text-[11px] flex items-center space-x-1 cursor-pointer"
                        title="Скачать TXT"
                      >
                        <Download className="w-3 h-3" />
                        <span>TXT</span>
                      </button>
                    </div>

                    <button
                      onClick={() => onSelectSession(sess)}
                      className="text-teal-700 hover:text-teal-900 font-medium text-[11px] flex items-center space-x-1 cursor-pointer"
                    >
                      <span>Подробнее</span>
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Clear All Footer */}
        {sessions.length > 0 && (
          <div className="p-3 border-t border-stone-200 bg-stone-50 flex justify-end">
            <button
              onClick={() => {
                if (confirm('Вы действительно хотите очистить всю историю звонков на этом устройстве?')) {
                  onClearAll();
                }
              }}
              className="text-xs text-red-600 hover:text-red-800 transition-colors cursor-pointer"
            >
              Очистить историю
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
