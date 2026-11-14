declare module 'soundtouchjs' {
  export class FifoSampleBuffer {
    vector: Float32Array;
    position: number;
    readonly startIndex: number;
    readonly frameCount: number;
    readonly endIndex: number;
    clear(): void;
    put(numFrames: number): void;
    putSamples(samples: Float32Array, position?: number, numFrames?: number): void;
    putBuffer(buffer: FifoSampleBuffer, position?: number, numFrames?: number): void;
    receive(numFrames?: number): void;
    receiveSamples(output: Float32Array, numFrames?: number): void;
    extract(output: Float32Array, position?: number, numFrames?: number): void;
    ensureCapacity(numFrames?: number): void;
    ensureAdditionalCapacity(numFrames?: number): void;
    rewind(): void;
  }

  export class RateTransposer {
    constructor(createBuffers?: boolean);
    inputBuffer: FifoSampleBuffer;
    outputBuffer: FifoSampleBuffer;
    rate: number;
    reset(): void;
    clear(): void;
    process(): void;
  }

  export class Stretch {
    constructor(createBuffers?: boolean);
    inputBuffer: FifoSampleBuffer;
    outputBuffer: FifoSampleBuffer;
    tempo: number;
    quickSeek: boolean;
    sampleRate: number;
    clear(): void;
    setParameters(sampleRate: number, sequenceMs: number, seekWindowMs: number, overlapMs: number): void;
    process(): void;
  }

  export class SoundTouch {
    constructor();
    transposer: RateTransposer;
    stretch: Stretch;
    readonly inputBuffer: FifoSampleBuffer;
    readonly outputBuffer: FifoSampleBuffer;
    rate: number;
    tempo: number;
    pitch: number;
    pitchOctaves: number;
    pitchSemitones: number;
    clear(): void;
    process(): void;
  }

  export interface SampleSource {
    extract(target: Float32Array, numFrames?: number, position?: number): number;
  }

  export class SimpleFilter {
    constructor(sourceSound: SampleSource, pipe: SoundTouch, callback?: () => void);
    position: number;
    sourcePosition: number;
    readonly inputBuffer: FifoSampleBuffer;
    readonly outputBuffer: FifoSampleBuffer;
    extract(target: Float32Array, numFrames?: number): number;
    clear(): void;
  }

  export class PitchShifter {
    constructor(context: AudioContext, buffer: AudioBuffer, bufferSize: number, onEnd?: () => void);
    tempo: number;
    rate: number;
    pitch: number;
    pitchSemitones: number;
    percentagePlayed: number;
    readonly duration: number;
    readonly timePlayed: number;
    connect(toNode: AudioNode): void;
    disconnect(): void;
    on(eventName: string, cb: (detail: { timePlayed: number; formattedTimePlayed: string; percentagePlayed: number }) => void): void;
    off(eventName?: string | null): void;
  }
}
