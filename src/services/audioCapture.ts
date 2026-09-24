import { float32ToPcm16, resampleMonoFloat32 } from './resampler';

export interface AudioCaptureCallbacks {
  onMicChunk?: (chunk: ArrayBuffer) => void;
  onCallChunk?: (chunk: ArrayBuffer) => void;
  onMicLevel?: (level: number, db: number) => void;
  onCallLevel?: (level: number, db: number) => void;
  onError?: (source: 'microphone' | 'call_audio', message: string) => void;
  onCallAudioEnded?: () => void;
}

export class DualAudioCapture {
  private micStream: MediaStream | null = null;
  private callStream: MediaStream | null = null;

  private micContext: AudioContext | null = null;
  private callContext: AudioContext | null = null;

  private micProcessor: ScriptProcessorNode | null = null;
  private callProcessor: ScriptProcessorNode | null = null;

  private callbacks: AudioCaptureCallbacks;

  private isMicActive = false;
  private isCallActive = false;
  private _isPaused = false;

  constructor(callbacks: AudioCaptureCallbacks) {
    this.callbacks = callbacks;
  }

  public get isMicrophoneActive(): boolean {
    return this.isMicActive;
  }

  public get isCallAudioActive(): boolean {
    return this.isCallActive;
  }

  public get isPaused(): boolean {
    return this._isPaused;
  }

  public set isPaused(val: boolean) {
    this._isPaused = val;
  }

  /**
   * Start microphone audio capture
   */
  public async startMicrophone(deviceId?: string): Promise<boolean> {
    try {
      this.stopMicrophone();

      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
        video: false,
      };

      this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
      const audioTracks = this.micStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('Микрофон не обнаружен или доступ заблокирован браузером.');
      }

      this.micContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });

      const source = this.micContext.createMediaStreamSource(this.micStream);
      // ScriptProcessor for robust 16kHz PCM16 conversion
      this.micProcessor = this.micContext.createScriptProcessor(2048, 1, 1);

      this.micProcessor.onaudioprocess = (e) => {
        if (this._isPaused) {
          if (this.callbacks.onMicLevel) {
            this.callbacks.onMicLevel(0, -100);
          }
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        // Calculate RMS Level & dB on raw input
        let sumSq = 0;
        for (let i = 0; i < inputData.length; i++) {
          sumSq += inputData[i] * inputData[i];
        }

        const rms = Math.sqrt(sumSq / inputData.length);
        const db = rms > 0.00001 ? 20 * Math.log10(rms) : -100;
        const normalizedLevel = Math.min(1, Math.max(0, (db + 60) / 60));

        if (this.callbacks.onMicLevel) {
          this.callbacks.onMicLevel(normalizedLevel, Math.round(db));
        }

        // Resample mono Float32 to strictly 16000 Hz if hardware runs at 44.1/48kHz
        const actualSampleRate = this.micContext?.sampleRate || 16000;
        const resampledData = resampleMonoFloat32(inputData, actualSampleRate, 16000);
        const pcm16 = float32ToPcm16(resampledData);

        if (this.callbacks.onMicChunk) {
          this.callbacks.onMicChunk(pcm16.buffer as ArrayBuffer);
        }
      };

      source.connect(this.micProcessor);
      this.micProcessor.connect(this.micContext.destination);

      this.isMicActive = true;
      return true;
    } catch (err: any) {
      console.error('Microphone capture error:', err);
      const msg = err.name === 'NotAllowedError'
        ? 'Доступ к микрофону отклонён в браузере. Разрешите доступ к микрофону в настройках сайта.'
        : err.message || 'Ошибка включения микрофона';
      if (this.callbacks.onError) {
        this.callbacks.onError('microphone', msg);
      }
      this.stopMicrophone();
      return false;
    }
  }

  /**
   * Start call audio capture from system/tab using getDisplayMedia
   */
  public async startCallAudio(): Promise<boolean> {
    try {
      this.stopCallAudio();

      // Request display capture with audio
      const displayMediaOptions: DisplayMediaStreamOptions = {
        video: {
          displaySurface: 'browser',
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      } as any;

      this.callStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

      // CRITICAL CHECK: User MUST have checked "Share audio"
      const audioTracks = this.callStream.getAudioTracks();
      if (!audioTracks || audioTracks.length === 0) {
        // Stop video tracks immediately
        this.callStream.getTracks().forEach((t) => t.stop());
        this.callStream = null;
        const errorMsg =
          'В окне захвата экрана/вкладки не была включена галочка «Поделиться аудио». ' +
          'Выберите вкладку телефонии и обязательно отметьте передачу звука.';
        if (this.callbacks.onError) {
          this.callbacks.onError('call_audio', errorMsg);
        }
        return false;
      }

      // We only need the audio track, stop any video track to save CPU
      this.callStream.getVideoTracks().forEach((t) => t.stop());

      // Listen for track ending (e.g. user clicks "Stop sharing")
      audioTracks[0].onended = () => {
        this.stopCallAudio();
        if (this.callbacks.onCallAudioEnded) {
          this.callbacks.onCallAudioEnded();
        }
      };

      this.callContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });

      const source = this.callContext.createMediaStreamSource(this.callStream);
      this.callProcessor = this.callContext.createScriptProcessor(2048, 1, 1);

      this.callProcessor.onaudioprocess = (e) => {
        if (this._isPaused) {
          if (this.callbacks.onCallLevel) {
            this.callbacks.onCallLevel(0, -100);
          }
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        let sumSq = 0;
        for (let i = 0; i < inputData.length; i++) {
          sumSq += inputData[i] * inputData[i];
        }

        const rms = Math.sqrt(sumSq / inputData.length);
        const db = rms > 0.00001 ? 20 * Math.log10(rms) : -100;
        const normalizedLevel = Math.min(1, Math.max(0, (db + 60) / 60));

        if (this.callbacks.onCallLevel) {
          this.callbacks.onCallLevel(normalizedLevel, Math.round(db));
        }

        // Resample mono Float32 to strictly 16000 Hz if hardware runs at 44.1/48kHz
        const actualSampleRate = this.callContext?.sampleRate || 16000;
        const resampledData = resampleMonoFloat32(inputData, actualSampleRate, 16000);
        const pcm16 = float32ToPcm16(resampledData);

        if (this.callbacks.onCallChunk) {
          this.callbacks.onCallChunk(pcm16.buffer as ArrayBuffer);
        }
      };

      source.connect(this.callProcessor);
      this.callProcessor.connect(this.callContext.destination);

      this.isCallActive = true;
      return true;
    } catch (err: any) {
      console.error('Call audio capture error:', err);
      if (err.name === 'NotAllowedError') {
        // User cancelled picker dialog
        return false;
      }
      const msg = err.message || 'Ошибка захвата звука звонка';
      if (this.callbacks.onError) {
        this.callbacks.onError('call_audio', msg);
      }
      this.stopCallAudio();
      return false;
    }
  }

  public stopMicrophone() {
    this.isMicActive = false;
    if (this.micProcessor) {
      try {
        this.micProcessor.disconnect();
      } catch (e) {}
      this.micProcessor = null;
    }
    if (this.micContext) {
      try {
        this.micContext.close();
      } catch (e) {}
      this.micContext = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.callbacks.onMicLevel) {
      this.callbacks.onMicLevel(0, -100);
    }
  }

  public stopCallAudio() {
    this.isCallActive = false;
    if (this.callProcessor) {
      try {
        this.callProcessor.disconnect();
      } catch (e) {}
      this.callProcessor = null;
    }
    if (this.callContext) {
      try {
        this.callContext.close();
      } catch (e) {}
      this.callContext = null;
    }
    if (this.callStream) {
      this.callStream.getTracks().forEach((t) => t.stop());
      this.callStream = null;
    }
    if (this.callbacks.onCallLevel) {
      this.callbacks.onCallLevel(0, -100);
    }
  }

  public stopAll() {
    this.stopMicrophone();
    this.stopCallAudio();
  }
}
