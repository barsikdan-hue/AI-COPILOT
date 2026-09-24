import { CallSessionRecord } from '../types';

const DB_NAME = 'ai_copilot_realtor_db';
const STORE_NAME = 'call_sessions';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('startedAt', 'startedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveCallSession(session: CallSessionRecord): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(session);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getAllCallSessions(): Promise<CallSessionRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('startedAt');
    const req = index.openCursor(null, 'prev');
    const results: CallSessionRecord[] = [];

    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getCallSessionById(id: string): Promise<CallSessionRecord | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCallSession(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearAllSessions(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function exportSessionToTxt(session: CallSessionRecord): string {
  const dateStr = new Date(session.startedAt).toLocaleString('ru-RU');
  const durationMin = Math.floor(session.durationSeconds / 60);
  const durationSec = session.durationSeconds % 60;

  let out = `====================================================\n`;
  out += `ИТОГ ЗВОНКА РИЕЛТОРА АНДРЕЯ\n`;
  out += `Дата: ${dateStr}\n`;
  out += `Длительность: ${durationMin} мин ${durationSec} сек\n`;
  out += `ID сессии: ${session.id}\n`;
  out += `====================================================\n\n`;

  if (session.summary) {
    out += `РЕЗЮМЕ ЗВОНКА:\n`;
    out += `• Цель клиента: ${session.summary.clientGoal || 'Не уточнено'}\n`;
    out += `• Согласованный следующий шаг: ${session.summary.agreedNextStep || 'Не согласован'}\n\n`;

    if (session.summary.confirmedFacts && session.summary.confirmedFacts.length > 0) {
      out += `ПОДТВЕРЖДЁННЫЕ ФАКТЫ:\n`;
      session.summary.confirmedFacts.forEach((f) => {
        const quote = f.evidenceQuote || f.quote;
        out += `  - ${f.label}: ${f.value}${quote ? ` (Цитата: "${quote}")` : ''}\n`;
      });
      out += `\n`;
    }

    if (session.summary.openQuestions && session.summary.openQuestions.length > 0) {
      out += `ОТКРЫТЫЕ ВОПРОСЫ:\n`;
      session.summary.openQuestions.forEach((q) => {
        out += `  - ${q}\n`;
      });
      out += `\n`;
    }

    if (session.summary.objections?.length > 0) {
      out += `ВОЗРАЖЕНИЯ И СОМНЕНИЯ:\n`;
      session.summary.objections.forEach((o) => {
        out += `  - ${o}\n`;
      });
      out += `\n`;
    }
  }

  out += `====================================================\n`;
  out += `ПОЛНЫЙ ТРАНСКРИПТ ДИАЛОГА:\n`;
  out += `====================================================\n`;

  session.turns.forEach((turn, idx) => {
    const time = new Date(turn.timestamp).toLocaleTimeString('ru-RU', {
      minute: '2-digit',
      second: '2-digit',
    });
    const speaker = turn.speaker === 'agent' ? 'Андрей (Риелтор)' : turn.speaker === 'client' ? 'Клиент' : 'Собеседник';
    out += `[${time}] ${speaker}: ${turn.text}\n`;
  });

  return out;
}

export function downloadFile(filename: string, content: string, contentType: string) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
