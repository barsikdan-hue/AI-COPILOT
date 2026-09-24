/**
 * High-quality linear resampling for mono Float32 audio and PCM16 conversion.
 * Ensures the audio stream fed to Live STT is strictly 16000 Hz PCM16,
 * even when the host browser AudioContext defaults to 44.1kHz, 48kHz, or other hardware rates.
 */

export function resampleMonoFloat32(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate: number = 16000
): Float32Array {
  if (inputSampleRate === targetSampleRate || input.length === 0) {
    return input;
  }

  const ratio = inputSampleRate / targetSampleRate;
  const newLength = Math.round(input.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;

    if (index + 1 < input.length) {
      result[i] = input[index] * (1 - fraction) + input[index + 1] * fraction;
    } else if (index < input.length) {
      result[i] = input[index];
    } else {
      result[i] = 0;
    }
  }

  return result;
}

export function float32ToPcm16(input: Float32Array): Int16Array {
  const pcm16 = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm16;
}
