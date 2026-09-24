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
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'interim') {
            this.callbacks.onInterimText?.(this.role, data.text);
          } else if (data.type === 'final') {
            this.callbacks.onFinalTurn?.(this.role, data.text, data.timestamp || Date.now());
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
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Backpressure protection: drop audio chunks if socket buffer exceeds 64KB
      if (this.ws.bufferedAmount > 64 * 1024) {
        this.droppedAudioChunksCount++;
        if (this.droppedAudioChunksCount % 25 === 1) {
          console.warn(
            `[STT ${this.role}] High WebSocket bufferedAmount (${this.ws.bufferedAmount} bytes). Dropping chunk.`
          );
        }
        return;
      }
      this.ws.send(pcmChunk);
    }
  }

  public disconnect() {
    this.isIntentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, 'Normal closure');
      } catch (e) {}
      this.ws = null;
    }
    this.callbacks.onStatusChange?.(this.role, 'idle');
  }
}
