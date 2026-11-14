import { SoundTouch, SimpleFilter, SampleSource } from 'soundtouchjs';

/**
 * Bounds-safe stereo sample source wrapping a Web Audio AudioBuffer.
 * Includes optional trailing zero padding so SoundTouch's SimpleFilter
 * processes cleanly through the final audio frames without truncating the ending.
 */
class SafeAudioBufferSource implements SampleSource {
  private readonly left: Float32Array;
  private readonly right: Float32Array;
  private readonly audioLength: number;
  private readonly totalLengthWithPadding: number;

  constructor(buffer: AudioBuffer, trailingPaddingFrames: number = 16384) {
    this.left = buffer.getChannelData(0);
    this.right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : this.left;
    this.audioLength = buffer.length;
    this.totalLengthWithPadding = buffer.length + trailingPaddingFrames;
  }

  extract(target: Float32Array, numFrames: number = 0, position: number = 0): number {
    if (position >= this.totalLengthWithPadding || numFrames <= 0) {
      return 0;
    }

    const available = this.totalLengthWithPadding - position;
    const framesToRead = Math.min(numFrames, available);
    const audioLen = this.audioLength;
    const left = this.left;
    const right = this.right;

    for (let i = 0; i < framesToRead; i++) {
      const idx = position + i;
      if (idx < audioLen) {
        target[i * 2] = left[idx];
        target[i * 2 + 1] = right[idx];
      } else {
        target[i * 2] = 0;
        target[i * 2 + 1] = 0;
      }
    }

    return framesToRead;
  }
}

export interface PitchPlayerCallbacks {
  onTimeUpdate: (timeSec: number) => void;
  onEnded: () => void;
}

/**
 * Real-time SoundTouch WSOLA pitch-shifting audio player.
 * Independently controls pitch (in semitones) and tempo (playback rate),
 * preserving original BPM/timing when pitch is shifted.
 */
export class SoundTouchPitchPlayer {
  private readonly ctx: AudioContext;
  private readonly buffer: AudioBuffer;
  private readonly soundtouch: SoundTouch;
  private readonly source: SafeAudioBufferSource;
  private readonly filter: SimpleFilter;
  private readonly gainNode: GainNode;
  private readonly scriptNode: ScriptProcessorNode;
  private readonly callbacks: PitchPlayerCallbacks;

  private isDisposed = false;
  private isPlayingState = false;
  private startOffsetSec = 0;
  private playedOutputFrames = 0;
  private currentTempo = 1.0;
  private currentSemitones = 0;
  private loopRegion: { start: number; end: number } | null = null;
  private rafId: number | null = null;

  constructor(
    ctx: AudioContext,
    buffer: AudioBuffer,
    options: {
      startSec: number;
      semitones: number;
      tempo: number;
      volume: number;
      loopRegion: { start: number; end: number } | null;
    },
    callbacks: PitchPlayerCallbacks
  ) {
    this.ctx = ctx;
    this.buffer = buffer;
    this.callbacks = callbacks;
    this.startOffsetSec = Math.max(0, Math.min(buffer.duration, options.startSec));
    this.currentTempo = Math.max(0.5, Math.min(1.5, options.tempo));
    this.currentSemitones = options.semitones;
    this.loopRegion = options.loopRegion;

    this.soundtouch = new SoundTouch();
    this.soundtouch.stretch.setParameters(buffer.sampleRate, 0, 0, 8);
    this.soundtouch.stretch.quickSeek = true;
    this.soundtouch.tempo = this.currentTempo;
    this.soundtouch.pitch = Math.pow(2, this.currentSemitones / 12);

    this.source = new SafeAudioBufferSource(buffer, 16384);
    this.filter = new SimpleFilter(this.source, this.soundtouch);
    this.filter.sourcePosition = Math.floor(this.startOffsetSec * buffer.sampleRate);

    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = options.volume;

    const bufferSize = 4096;
    const interleaved = new Float32Array(bufferSize * 2);
    this.scriptNode = ctx.createScriptProcessor(bufferSize, 0, 2);

    this.scriptNode.onaudioprocess = (event) => {
      const outLeft = event.outputBuffer.getChannelData(0);
      const outRight = event.outputBuffer.getChannelData(1);

      if (this.isDisposed || !this.isPlayingState) {
        outLeft.fill(0);
        outRight.fill(0);
        return;
      }

      const framesExtracted = this.filter.extract(interleaved, bufferSize);

      for (let i = 0; i < framesExtracted; i++) {
        outLeft[i] = interleaved[i * 2];
        outRight[i] = interleaved[i * 2 + 1];
      }

      if (framesExtracted < bufferSize) {
        outLeft.fill(0, framesExtracted);
        outRight.fill(0, framesExtracted);
      }

      this.playedOutputFrames += framesExtracted;
      const estimatedTime = this.getCurrentTime();

      if (this.loopRegion && estimatedTime >= this.loopRegion.end) {
        this.seekInternal(this.loopRegion.start);
        return;
      }

      if (framesExtracted === 0 || estimatedTime >= this.buffer.duration) {
        this.isPlayingState = false;
        setTimeout(() => {
          if (!this.isDisposed) {
            this.callbacks.onEnded();
          }
        }, 0);
      }
    };

    this.scriptNode.connect(this.gainNode);
    this.gainNode.connect(this.ctx.destination);
  }

  private seekInternal(timeSec: number): void {
    const clamped = Math.max(0, Math.min(this.buffer.duration, timeSec));
    this.startOffsetSec = clamped;
    this.playedOutputFrames = 0;
    this.filter.clear();
    this.filter.sourcePosition = Math.floor(clamped * this.buffer.sampleRate);
  }

  getCurrentTime(): number {
    const elapsedSourceSec = (this.playedOutputFrames * this.currentTempo) / this.ctx.sampleRate;
    return Math.min(this.buffer.duration, this.startOffsetSec + elapsedSourceSec);
  }

  start(): void {
    if (this.isDisposed) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    this.isPlayingState = true;
    this.startTicker();
  }

  pause(): void {
    this.isPlayingState = false;
    this.stopTicker();
  }

  seek(timeSec: number): void {
    this.seekInternal(timeSec);
    this.callbacks.onTimeUpdate(this.startOffsetSec);
  }

  setVolume(volume: number): void {
    this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
  }

  setLoopRegion(loop: { start: number; end: number } | null): void {
    this.loopRegion = loop;
  }

  setTempo(tempo: number): void {
    const nowTime = this.getCurrentTime();
    this.startOffsetSec = nowTime;
    this.playedOutputFrames = 0;
    this.currentTempo = Math.max(0.5, Math.min(1.5, tempo));
    this.soundtouch.tempo = this.currentTempo;
  }

  setPitchSemitones(semitones: number): void {
    const prevPitch = Math.pow(2, this.currentSemitones / 12);
    const nextPitch = Math.pow(2, semitones / 12);
    const prevRate = prevPitch;
    const nextRate = nextPitch;

    this.currentSemitones = semitones;
    this.soundtouch.pitch = nextPitch;

    // If rate crossed 1.0, SoundTouch swaps its internal stretch/transposer pipeline order;
    // re-anchoring at the current playhead prevents stale intermediate buffer artifacts.
    if ((prevRate <= 1.0 && nextRate > 1.0) || (prevRate > 1.0 && nextRate <= 1.0)) {
      const nowTime = this.getCurrentTime();
      this.seekInternal(nowTime);
    }
  }

  private startTicker(): void {
    this.stopTicker();
    const tick = () => {
      if (this.isDisposed || !this.isPlayingState) return;
      this.callbacks.onTimeUpdate(this.getCurrentTime());
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopTicker(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.isPlayingState = false;
    this.stopTicker();
    try {
      this.scriptNode.onaudioprocess = null;
      this.scriptNode.disconnect();
      this.gainNode.disconnect();
    } catch {
      // already disconnected
    }
  }
}

/**
 * Encodes stereo/mono PCM sample arrays into a standard 16-bit PCM WAV Blob.
 */
function encodeWavBlob(left: Float32Array, right: Float32Array, numFrames: number, sampleRate: number, numChannels: number): Blob {
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataByteLength = numFrames * blockAlign;
  const wavBuffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(wavBuffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // Bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataByteLength, true);

  let writeOffset = 44;
  for (let i = 0; i < numFrames; i++) {
    const sampleL = Math.max(-1, Math.min(1, left[i]));
    view.setInt16(writeOffset, sampleL < 0 ? sampleL * 0x8000 : sampleL * 0x7fff, true);
    writeOffset += 2;

    if (numChannels > 1) {
      const sampleR = Math.max(-1, Math.min(1, right[i]));
      view.setInt16(writeOffset, sampleR < 0 ? sampleR * 0x8000 : sampleR * 0x7fff, true);
      writeOffset += 2;
    }
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

/**
 * Offline SoundTouch DSP render & 16-bit PCM WAV export.
 * Preserves exact original BPM and track duration while shifting pitch by semitones.
 * Processes asynchronously in blocks to keep the UI responsive on mobile & desktop.
 */
export async function exportPitchShiftedWav(
  audioBuffer: AudioBuffer,
  semitones: number,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const sampleRate = audioBuffer.sampleRate;
  const targetFrames = audioBuffer.length;
  const numChannels = Math.min(2, Math.max(1, audioBuffer.numberOfChannels));

  if (semitones === 0) {
    onProgress?.(50);
    const left = audioBuffer.getChannelData(0);
    const right = numChannels > 1 ? audioBuffer.getChannelData(1) : left;
    const blob = encodeWavBlob(left, right, targetFrames, sampleRate, numChannels);
    onProgress?.(100);
    return blob;
  }

  const soundtouch = new SoundTouch();
  soundtouch.stretch.setParameters(sampleRate, 0, 0, 8);
  // Full cross-correlation search for offline export maximizes audio fidelity
  soundtouch.stretch.quickSeek = false;
  soundtouch.tempo = 1.0;
  soundtouch.pitch = Math.pow(2, semitones / 12);

  // Pad trailing zeros so SimpleFilter flushes every real audio sample through the pipeline
  const source = new SafeAudioBufferSource(audioBuffer, 24576);
  const filter = new SimpleFilter(source, soundtouch);

  const outLeft = new Float32Array(targetFrames);
  const outRight = new Float32Array(targetFrames);

  const blockFrames = 4096;
  const interleaved = new Float32Array(blockFrames * 2);

  let writtenFrames = 0;
  let peakAbs = 0;
  let blocksSinceYield = 0;

  while (writtenFrames < targetFrames) {
    if (signal?.aborted) {
      throw new DOMException('Export cancelled', 'AbortError');
    }

    const extracted = filter.extract(interleaved, blockFrames);
    if (extracted === 0) {
      break;
    }

    const framesToCopy = Math.min(extracted, targetFrames - writtenFrames);
    for (let i = 0; i < framesToCopy; i++) {
      const l = interleaved[i * 2];
      const r = interleaved[i * 2 + 1];
      outLeft[writtenFrames + i] = l;
      outRight[writtenFrames + i] = r;

      const absL = l < 0 ? -l : l;
      const absR = r < 0 ? -r : r;
      if (absL > peakAbs) peakAbs = absL;
      if (absR > peakAbs) peakAbs = absR;
    }

    writtenFrames += framesToCopy;
    blocksSinceYield++;

    if (blocksSinceYield >= 8) {
      blocksSinceYield = 0;
      const pct = Math.min(95, Math.round((writtenFrames / targetFrames) * 95));
      onProgress?.(pct);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  // Soft peak protection if WSOLA overlap slightly exceeds 0 dBFS so export never hard-clips
  if (peakAbs > 0.99) {
    const scale = 0.98 / peakAbs;
    for (let i = 0; i < writtenFrames; i++) {
      outLeft[i] *= scale;
      outRight[i] *= scale;
    }
  }

  onProgress?.(98);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const wavBlob = encodeWavBlob(outLeft, outRight, targetFrames, sampleRate, numChannels);
  onProgress?.(100);
  return wavBlob;
}

/**
 * Offline render & 16-bit PCM WAV export for Tempo Pitch Fader.
 * Matches live preview exactly:
 * - When semitones === 0: renders with OfflineAudioContext playbackRate resampling (preservesPitch = false).
 * - When semitones !== 0: renders through SoundTouch DSP combining both tempo and semitone shift.
 */
export async function exportTempoAdjustedWav(
  audioBuffer: AudioBuffer,
  playbackRate: number,
  semitones: number = 0,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const safeRate = Math.max(0.5, Math.min(1.5, playbackRate));
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = Math.min(2, Math.max(1, audioBuffer.numberOfChannels));
  const targetFrames = Math.max(1, Math.round(audioBuffer.length / safeRate));

  if (Math.abs(safeRate - 1.0) < 0.0005 && semitones === 0) {
    onProgress?.(50);
    const left = audioBuffer.getChannelData(0);
    const right = numChannels > 1 ? audioBuffer.getChannelData(1) : left;
    const blob = encodeWavBlob(left, right, audioBuffer.length, sampleRate, numChannels);
    onProgress?.(100);
    return blob;
  }

  if (semitones === 0) {
    if (signal?.aborted) {
      throw new DOMException('Export cancelled', 'AbortError');
    }
    onProgress?.(20);
    const offlineCtx = new OfflineAudioContext(numChannels, targetFrames, sampleRate);
    const src = offlineCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.playbackRate.value = safeRate;
    src.connect(offlineCtx.destination);
    src.start(0);

    const rendered = await offlineCtx.startRendering();
    if (signal?.aborted) {
      throw new DOMException('Export cancelled', 'AbortError');
    }
    onProgress?.(85);
    const left = rendered.getChannelData(0);
    const right = numChannels > 1 ? rendered.getChannelData(1) : left;
    const blob = encodeWavBlob(left, right, rendered.length, sampleRate, numChannels);
    onProgress?.(100);
    return blob;
  }

  const soundtouch = new SoundTouch();
  soundtouch.stretch.setParameters(sampleRate, 0, 0, 8);
  soundtouch.stretch.quickSeek = false;
  soundtouch.tempo = safeRate;
  soundtouch.pitch = Math.pow(2, semitones / 12);

  const source = new SafeAudioBufferSource(audioBuffer, 24576);
  const filter = new SimpleFilter(source, soundtouch);

  const outLeft = new Float32Array(targetFrames);
  const outRight = new Float32Array(targetFrames);
  const blockFrames = 4096;
  const interleaved = new Float32Array(blockFrames * 2);

  let writtenFrames = 0;
  let peakAbs = 0;
  let blocksSinceYield = 0;

  while (writtenFrames < targetFrames) {
    if (signal?.aborted) {
      throw new DOMException('Export cancelled', 'AbortError');
    }

    const extracted = filter.extract(interleaved, blockFrames);
    if (extracted === 0) {
      break;
    }

    const framesToCopy = Math.min(extracted, targetFrames - writtenFrames);
    for (let i = 0; i < framesToCopy; i++) {
      const l = interleaved[i * 2];
      const r = interleaved[i * 2 + 1];
      outLeft[writtenFrames + i] = l;
      outRight[writtenFrames + i] = r;

      const absL = l < 0 ? -l : l;
      const absR = r < 0 ? -r : r;
      if (absL > peakAbs) peakAbs = absL;
      if (absR > peakAbs) peakAbs = absR;
    }

    writtenFrames += framesToCopy;
    blocksSinceYield++;

    if (blocksSinceYield >= 8) {
      blocksSinceYield = 0;
      const pct = Math.min(95, Math.round((writtenFrames / targetFrames) * 95));
      onProgress?.(pct);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  if (peakAbs > 0.99) {
    const scale = 0.98 / peakAbs;
    for (let i = 0; i < writtenFrames; i++) {
      outLeft[i] *= scale;
      outRight[i] *= scale;
    }
  }

  onProgress?.(98);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const wavBlob = encodeWavBlob(outLeft, outRight, writtenFrames || targetFrames, sampleRate, numChannels);
  onProgress?.(100);
  return wavBlob;
}
