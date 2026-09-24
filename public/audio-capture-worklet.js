class Pcm16CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.paused = false;
    this.tail = null;
    this.position = 0;
    this.pending = [];
    this.levelTick = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === 'pause') this.paused = Boolean(event.data.value);
    };
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;
    if (this.paused) {
      if (++this.levelTick % 8 === 0) this.port.postMessage({ type: 'level', level: 0, db: -100 });
      return true;
    }

    let sumSquares = 0;
    for (let index = 0; index < input.length; index++) sumSquares += input[index] * input[index];
    if (++this.levelTick % 4 === 0) {
      const rms = Math.sqrt(sumSquares / input.length);
      const db = rms > 0.00001 ? 20 * Math.log10(rms) : -100;
      this.port.postMessage({
        type: 'level',
        level: Math.min(1, Math.max(0, (db + 60) / 60)),
        db: Math.round(db),
      });
    }

    const combined = new Float32Array(input.length + (this.tail === null ? 0 : 1));
    let offset = 0;
    if (this.tail !== null) {
      combined[0] = this.tail;
      offset = 1;
    }
    combined.set(input, offset);
    const ratio = sampleRate / 16000;

    while (this.position < combined.length - 1) {
      const left = Math.floor(this.position);
      const fraction = this.position - left;
      const sample = combined[left] + (combined[left + 1] - combined[left]) * fraction;
      const clipped = Math.max(-1, Math.min(1, sample));
      this.pending.push(clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff);
      this.position += ratio;
    }
    this.position -= combined.length - 1;
    this.tail = combined[combined.length - 1];

    while (this.pending.length >= 1600) {
      const chunk = new Int16Array(1600);
      for (let index = 0; index < chunk.length; index++) chunk[index] = this.pending[index];
      this.pending.splice(0, chunk.length);
      this.port.postMessage({ type: 'chunk', buffer: chunk.buffer }, [chunk.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm16-capture-processor', Pcm16CaptureProcessor);

