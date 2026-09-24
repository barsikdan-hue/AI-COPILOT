import { SpeakerRole } from '../types';

export interface TranscriptionCallbacks {
  onStatusChange?: (role: SpeakerRole, status: 'idle' | 'connecting' | 'connected' | 'error' | 'closed') => void;
  onInterimText?: (role: SpeakerRole, text: string) => void;
  onFinalTurn?: (role: SpeakerRole, text: string, timestamp: number) => void;
  onError?: (role: SpeakerRole, message: string, code?: string) => void;
  onVoiceActivity?: (role: SpeakerRole, active: boolean) => void;
}

export class LiveTranscriptionChannel {
  private static totalLiveSessionsCreated = 0;
  private role: SpeakerRole;
  private sessionId: string;
  private ws: WebSocket | null = null;
  private callbacks: TranscriptionCallbacks;
  private isIntentionalClose = false;
  private reconnectAttempts = 0;
  private maxReconnects = 3;
  private reconnectTimer: any = null;
  private audioFlushTimer: any = null;
  private audioQueue: ArrayBuffer[] = [];
  private readonly maxQueuedChunks = 30;
  private readonly highWaterMarkBytes = 256 * 1024;
  private longestInterimText = '';
  public droppedAudioChunksCount: number = 0;

  public get reconnectCount(): number {
    return this.reconnectAttempts;
  }

  public static getTotalLiveSessionsCount(): number {
    return LiveTranscriptionChannel.totalLiveSessionsCreated;
  }

  public static resetLiveSessionsCount(): void {
    LiveTranscriptionChannel.totalLiveSessionsCreated = 0;
  }

  constructor(role: SpeakerRole, sessionId: string, callbacks: TranscriptionCallbacks) {
    this.role = role;
    this.sessionId = sessionId;
    this.callbacks = callbacks;
  }

  public isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  public isConnecting(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.CONNECTING;
  }

  public connect() {
    // Optimization: Do NOT create a new session if one is already open or connecting
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log(`[STT ${this.role}] Live session already active/connecting. Keeping existing session.`);
      return;
    }

    this.isIntentionalClose = false;
    this.callbacks.onStatusChange?.(this.role, 'connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/transcribe?role=${this.role}&sessionId=${this.sessionId}`;

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';
      LiveTranscriptionChannel.totalLiveSessionsCreated++;

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.callbacks.onStatusChange?.(this.role, 'connected');
        this.flushAudioQueue();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'interim') {
            const interimText = String(data.text || '').trim();
            if (interimText.length >= this.longestInterimText.length) this.longestInterimText = interimText;
            this.callbacks.onInterimText?.(this.role, interimText);
          } else if (data.type === 'final') {
            const finalText = String(data.text || '').trim();
            const interimText = this.longestInterimText.trim();
            const norm = (value: string) => value.toLowerCase().replace(/[^а-яёa-z0-9\s]/giu, ' ').replace(/\s+/g, ' ').trim();
            const normalizedFinal = norm(finalText);
            const normalizedInterim = norm(interimText);
            const finalTokens = new Set(normalizedFinal.split(' ').filter(Boolean));
            const interimTokens = new Set(normalizedInterim.split(' ').filter(Boolean));
            const shared = [...finalTokens].filter((token) => interimTokens.has(token)).length;
            const overlap = finalTokens.size ? shared / finalTokens.size : 0;
            const interimLooksLikeRicherSameUtterance =
              interimText.length > finalText.length * 1.15 &&
              (normalizedInterim.includes(normalizedFinal) || overlap >= 0.7);
            const preservedText = interimLooksLikeRicherSameUtterance ? interimText : finalText;
            this.longestInterimText = '';
            this.callbacks.onFinalTurn?.(this.role, preservedText, data.timestamp || Date.now());
          } else if (data.type === 'voiceActivity') {
            const active = data.activity?.type === 'ACTIVITY_START';
            this.callbacks.onVoiceActivity?.(this.role, active);
          } else if (data.type === 'status') {
            this.callbacks.onStatusChange?.(this.role, data.status);
          } else if (data.type === 'error') {
            this.callbacks.onError?.(this.role, data.message, data.code);
            this.callbacks.onStatusChange?.(this.role, 'error');
          }
        } catch (e) {
          console.error(`[STT ${this.role}] Error parsing WS message:`, e);
        }
      };

      this.ws.onclose = (event) => {
        if (!this.isIntentionalClose) {
          if (this.reconnectAttempts < this.maxReconnects) {
            this.reconnectAttempts++;
            this.callbacks.onStatusChange?.(this.role, 'connecting');
            this.reconnectTimer = setTimeout(() => this.connect(), 1000 * this.reconnectAttempts);
          } else {
            this.callbacks.onStatusChange?.(this.role, 'closed');
          }
        } else {
          this.callbacks.onStatusChange?.(this.role, 'idle');
        }
      };

      this.ws.onerror = (event) => {
        console.error(`[STT ${this.role}] Socket error:`, event);
        this.callbacks.onError?.(this.role, 'Сбой сетевого соединения с сервисом распознавания речи');
        this.callbacks.onStatusChange?.(this.role, 'error');
      };
    } catch (err: any) {
      this.callbacks.onError?.(this.role, err.message || 'Не удалось открыть WebSocket');
      this.callbacks.onStatusChange?.(this.role, 'error');
    }
  }

  public sendAudioChunk(pcmChunk: ArrayBuffer) {
    if (this.audioQueue.length >= this.maxQueuedChunks) {
      this.audioQueue.shift();
      this.droppedAudioChunksCount++;
    }
    this.audioQueue.push(pcmChunk);
    this.flushAudioQueue();
  }

  private flushAudioQueue() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    while (this.audioQueue.length > 0 && this.ws.bufferedAmount < this.highWaterMarkBytes) {
      const next = this.audioQueue.shift();
      if (next) this.ws.send(next);
    }
    if (this.audioQueue.length > 0 && !this.audioFlushTimer) {
      this.audioFlushTimer = setTimeout(() => {
        this.audioFlushTimer = null;
        this.flushAudioQueue();
      }, 20);
    }
  }

  public disconnect() {
    this.isIntentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.audioFlushTimer) {
      clearTimeout(this.audioFlushTimer);
      this.audioFlushTimer = null;
    }
    this.audioQueue = [];
    this.longestInterimText = '';
    if (this.ws) {
      try {
        this.ws.close(1000, 'Normal closure');
      } catch (e) {}
      this.ws = null;
    }
    this.callbacks.onStatusChange?.(this.role, 'idle');
  }
}
