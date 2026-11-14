import { Mp3Encoder } from '@breezystack/lamejs';

export type AudioExportFormat = 'mp3-320' | 'mp3-192' | 'wav' | 'flac' | 'aiff';

export interface AudioFormatOption {
  id: AudioExportFormat;
  label: string;
  extension: string;
  mimeType: string;
  qualityTag: string;
  description: string;
}

export const AUDIO_EXPORT_FORMATS: AudioFormatOption[] = [
  {
    id: 'mp3-320',
    label: 'MP3',
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    qualityTag: '320 kbps',
    description: 'Highest quality MP3, compatible with all players & phones',
  },
  {
    id: 'mp3-192',
    label: 'MP3',
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    qualityTag: '192 kbps',
    description: 'Compact MP3 with smaller file size for quick sharing',
  },
  {
    id: 'wav',
    label: 'WAV',
    extension: 'wav',
    mimeType: 'audio/wav',
    qualityTag: '16-bit PCM',
    description: 'Uncompressed lossless studio master audio',
  },
  {
    id: 'flac',
    label: 'FLAC',
    extension: 'flac',
    mimeType: 'audio/flac',
    qualityTag: 'Lossless',
    description: 'Bit-exact lossless audio format for DJs & hi-fi playback',
  },
  {
    id: 'aiff',
    label: 'AIFF',
    extension: 'aiff',
    mimeType: 'audio/aiff',
    qualityTag: '16-bit PCM',
    description: 'Uncompressed Apple / Rekordbox / CDJ studio format',
  },
];

export function getAudioFormatOption(format: AudioExportFormat): AudioFormatOption {
  return AUDIO_EXPORT_FORMATS.find((f) => f.id === format) || AUDIO_EXPORT_FORMATS[0];
}

export function estimateExportSizeLabel(
  durationSec: number,
  sampleRate: number,
  format: AudioExportFormat
): string {
  if (!durationSec || durationSec <= 0) return '';
  let bytes = 0;
  switch (format) {
    case 'mp3-320':
      bytes = (320 * 1000 * durationSec) / 8;
      break;
    case 'mp3-192':
      bytes = (192 * 1000 * durationSec) / 8;
      break;
    case 'wav':
    case 'flac':
    case 'aiff':
      bytes = durationSec * sampleRate * 2 * 2; // stereo 16-bit PCM
      break;
  }
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `~${mb.toFixed(1)} MB` : `~${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function floatToInt16(sample: number): number {
  const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

/**
 * Encodes stereo/mono PCM sample arrays into a standard 16-bit PCM WAV Blob.
 */
export function encodeWavBlob(
  left: Float32Array,
  right: Float32Array,
  numFrames: number,
  sampleRate: number,
  numChannels: number
): Blob {
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
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataByteLength, true);

  let writeOffset = 44;
  for (let i = 0; i < numFrames; i++) {
    view.setInt16(writeOffset, floatToInt16(left[i]), true);
    writeOffset += 2;
    if (numChannels > 1) {
      view.setInt16(writeOffset, floatToInt16(right[i]), true);
      writeOffset += 2;
    }
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

/**
 * Writes an 80-bit IEEE 754 extended float for AIFF sample rates.
 */
function writeIeee80(view: DataView, offset: number, val: number): void {
  if (val === 0) {
    for (let i = 0; i < 10; i++) view.setUint8(offset + i, 0);
    return;
  }
  const sign = val < 0 ? 0x8000 : 0;
  let absVal = Math.abs(val);
  let exp = Math.floor(Math.log2(absVal));
  let mantissa = absVal / Math.pow(2, exp);
  if (mantissa >= 2) {
    mantissa /= 2;
    exp += 1;
  }
  const biasedExp = exp + 16383;
  const hiMant = Math.floor(mantissa * 0x80000000) >>> 0;
  const loMant = Math.floor((mantissa * 0x80000000 - hiMant) * 0x100000000) >>> 0;

  view.setUint16(offset, sign | (biasedExp & 0x7fff), false);
  view.setUint32(offset + 2, hiMant, false);
  view.setUint32(offset + 6, loMant, false);
}

/**
 * Encodes stereo/mono PCM sample arrays into a standard 16-bit PCM AIFF Blob.
 */
export function encodeAiffBlob(
  left: Float32Array,
  right: Float32Array,
  numFrames: number,
  sampleRate: number,
  numChannels: number
): Blob {
  const bytesPerSample = 2;
  const dataByteLength = numFrames * numChannels * bytesPerSample;
  const paddedDataLength = dataByteLength + (dataByteLength % 2);
  const totalFileBytes = 4 + (8 + 18) + (8 + 8 + paddedDataLength);
  const buffer = new ArrayBuffer(8 + totalFileBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'FORM');
  view.setUint32(4, totalFileBytes, false);
  writeAscii(8, 'AIFF');

  // COMM chunk
  writeAscii(12, 'COMM');
  view.setUint32(16, 18, false);
  view.setInt16(20, numChannels, false);
  view.setUint32(22, numFrames, false);
  view.setInt16(26, 16, false);
  writeIeee80(view, 28, sampleRate);

  // SSND chunk
  writeAscii(38, 'SSND');
  view.setUint32(42, 8 + dataByteLength, false);
  view.setUint32(46, 0, false); // offset
  view.setUint32(50, 0, false); // blockSize

  let writeOffset = 54;
  for (let i = 0; i < numFrames; i++) {
    view.setInt16(writeOffset, floatToInt16(left[i]), false);
    writeOffset += 2;
    if (numChannels > 1) {
      view.setInt16(writeOffset, floatToInt16(right[i]), false);
      writeOffset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/aiff' });
}

/**
 * Encodes stereo/mono PCM sample arrays into an MP3 Blob using @breezystack/lamejs.
 */
export async function encodeMp3Blob(
  left: Float32Array,
  right: Float32Array,
  numFrames: number,
  sampleRate: number,
  numChannels: number,
  kbps: number,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const encoder = new Mp3Encoder(numChannels, sampleRate, kbps);
  const mp3Parts: Uint8Array[] = [];
  const chunkSize = 1152 * 8; // 9216 frames per slice

  const leftInt16 = new Int16Array(chunkSize);
  const rightInt16 = numChannels > 1 ? new Int16Array(chunkSize) : null;

  for (let offset = 0; offset < numFrames; offset += chunkSize) {
    if (signal?.aborted) {
      throw new DOMException('Export cancelled', 'AbortError');
    }

    const len = Math.min(chunkSize, numFrames - offset);
    for (let i = 0; i < len; i++) {
      leftInt16[i] = floatToInt16(left[offset + i]);
      if (rightInt16) {
        rightInt16[i] = floatToInt16(right[offset + i]);
      }
    }

    const lSlice = len === chunkSize ? leftInt16 : leftInt16.subarray(0, len);
    const encoded = rightInt16
      ? encoder.encodeBuffer(lSlice, len === chunkSize ? rightInt16 : rightInt16.subarray(0, len))
      : encoder.encodeBuffer(lSlice);

    if (encoded.length > 0) {
      mp3Parts.push(new Uint8Array(encoded));
    }

    onProgress?.(Math.min(95, Math.round(((offset + len) / numFrames) * 95)));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const tail = encoder.flush();
  if (tail.length > 0) {
    mp3Parts.push(new Uint8Array(tail));
  }

  onProgress?.(100);
  return new Blob(mp3Parts as BlobPart[], { type: 'audio/mpeg' });
}

function crc8Flac(data: Uint8Array, length: number): number {
  let crc = 0;
  for (let i = 0; i < length; i++) {
    crc ^= data[i];
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

function crc16Flac(data: Uint8Array, length: number): number {
  let crc = 0;
  for (let i = 0; i < length; i++) {
    crc ^= data[i] << 8;
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function encodeFlacUtf8Number(value: number, out: number[]): void {
  if (value < 0x80) {
    out.push(value);
  } else if (value < 0x800) {
    out.push(0xc0 | (value >> 6), 0x80 | (value & 0x3f));
  } else if (value < 0x10000) {
    out.push(0xe0 | (value >> 12), 0x80 | ((value >> 6) & 0x3f), 0x80 | (value & 0x3f));
  } else if (value < 0x200000) {
    out.push(
      0xf0 | (value >> 18),
      0x80 | ((value >> 12) & 0x3f),
      0x80 | ((value >> 6) & 0x3f),
      0x80 | (value & 0x3f)
    );
  } else if (value < 0x4000000) {
    out.push(
      0xf8 | (value >> 24),
      0x80 | ((value >> 18) & 0x3f),
      0x80 | ((value >> 12) & 0x3f),
      0x80 | ((value >> 6) & 0x3f),
      0x80 | (value & 0x3f)
    );
  } else {
    out.push(
      0xfc | Math.floor(value / 0x40000000),
      0x80 | ((value >>> 24) & 0x3f),
      0x80 | ((value >>> 18) & 0x3f),
      0x80 | ((value >>> 12) & 0x3f),
      0x80 | ((value >>> 6) & 0x3f),
      0x80 | (value & 0x3f)
    );
  }
}

/**
 * Encodes stereo/mono 16-bit PCM into a valid Xiph FLAC lossless stream.
 */
export async function encodeFlacBlob(
  left: Float32Array,
  right: Float32Array,
  numFrames: number,
  sampleRate: number,
  numChannels: number,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const MAX_BLOCK = 4096;
  const flacParts: Uint8Array[] = [];

  // 1. Magic + STREAMINFO (last metadata block)
  const header = new Uint8Array(4 + 4 + 34);
  header[0] = 0x66; // 'f'
  header[1] = 0x4c; // 'L'
  header[2] = 0x61; // 'a'
  header[3] = 0x43; // 'C'
  header[4] = 0x80; // isLast=1, type=0 (STREAMINFO)
  header[5] = 0x00;
  header[6] = 0x00;
  header[7] = 34;

  const si = new DataView(header.buffer, 8, 34);
  const minBlock = Math.min(MAX_BLOCK, Math.max(16, numFrames));
  si.setUint16(0, minBlock, false);
  si.setUint16(2, MAX_BLOCK, false);
  // minFrameSize (3 bytes) = 0, maxFrameSize (3 bytes) = 0
  // Bytes 10..17 hold: sampleRate (20b) | channels-1 (3b) | bps-1 (5b) | totalSamples (36b)
  const sr20 = sampleRate & 0xfffff;
  const ch3 = (numChannels - 1) & 0x07;
  const bps5 = 15; // 16 - 1
  const total36Hi = Math.floor(numFrames / 0x100000000) & 0x0f;
  const total36Lo = numFrames >>> 0;

  header[18] = (sr20 >>> 12) & 0xff;
  header[19] = (sr20 >>> 4) & 0xff;
  header[20] = ((sr20 & 0x0f) << 4) | (ch3 << 1) | ((bps5 >>> 4) & 0x01);
  header[21] = ((bps5 & 0x0f) << 4) | total36Hi;
  si.setUint32(14, total36Lo, false);
  // Bytes 26..41 (MD5) left as zeros

  flacParts.push(header);

  const sampleRateCodeMap: Record<number, number> = {
    88200: 0x1,
    176400: 0x2,
    192000: 0x3,
    8000: 0x4,
    16000: 0x5,
    22050: 0x6,
    24000: 0x7,
    32000: 0x8,
    44100: 0x9,
    48000: 0xa,
    96000: 0xb,
  };
  const srCode = sampleRateCodeMap[sampleRate] ?? 0xd; // 0xd = 16-bit sample rate in Hz

  let frameIndex = 0;
  let blocksSinceYield = 0;

  for (let offset = 0; offset < numFrames; offset += MAX_BLOCK) {
    if (signal?.aborted) {
      throw new DOMException('Export cancelled', 'AbortError');
    }

    const blockSize = Math.min(MAX_BLOCK, numFrames - offset);
    const bsCode = blockSize === 4096 ? 0xc : 0x7; // 0x7 = 16-bit (blockSize - 1)

    const frameHeaderBytes: number[] = [
      0xff,
      0xf8, // Sync + fixed blocksize strategy
      (bsCode << 4) | srCode,
      ((numChannels > 1 ? 0x1 : 0x0) << 4) | 0x8, // L/R stereo or mono, 16-bit sample size (4 << 1)
    ];

    encodeFlacUtf8Number(frameIndex, frameHeaderBytes);

    if (bsCode === 0x7) {
      const bm1 = blockSize - 1;
      frameHeaderBytes.push((bm1 >>> 8) & 0xff, bm1 & 0xff);
    }
    if (srCode === 0xd) {
      frameHeaderBytes.push((sampleRate >>> 8) & 0xff, sampleRate & 0xff);
    }

    const headerUint8 = new Uint8Array(frameHeaderBytes);
    const crc8 = crc8Flac(headerUint8, headerUint8.length);

    // Subframes (Verbatim 16-bit per channel) + 2-byte CRC16 footer
    const subframeSize = 1 + blockSize * 2;
    const frameBuf = new Uint8Array(headerUint8.length + 1 + subframeSize * numChannels + 2);
    frameBuf.set(headerUint8, 0);
    frameBuf[headerUint8.length] = crc8;

    const dv = new DataView(frameBuf.buffer);
    let ptr = headerUint8.length + 1;

    // Channel 0 (Left)
    frameBuf[ptr++] = 0x02; // Verbatim subframe
    for (let i = 0; i < blockSize; i++) {
      dv.setInt16(ptr, floatToInt16(left[offset + i]), false);
      ptr += 2;
    }

    // Channel 1 (Right)
    if (numChannels > 1) {
      frameBuf[ptr++] = 0x02; // Verbatim subframe
      for (let i = 0; i < blockSize; i++) {
        dv.setInt16(ptr, floatToInt16(right[offset + i]), false);
        ptr += 2;
      }
    }

    const crc16 = crc16Flac(frameBuf, ptr);
    frameBuf[ptr++] = (crc16 >>> 8) & 0xff;
    frameBuf[ptr] = crc16 & 0xff;

    flacParts.push(frameBuf);
    frameIndex++;
    blocksSinceYield++;

    if (blocksSinceYield >= 12) {
      blocksSinceYield = 0;
      onProgress?.(Math.min(95, Math.round(((offset + blockSize) / numFrames) * 95)));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  onProgress?.(100);
  return new Blob(flacParts as BlobPart[], { type: 'audio/flac' });
}

export async function encodeAudioFormatBlob(
  left: Float32Array,
  right: Float32Array,
  numFrames: number,
  sampleRate: number,
  numChannels: number,
  format: AudioExportFormat,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  switch (format) {
    case 'mp3-320':
      return encodeMp3Blob(left, right, numFrames, sampleRate, numChannels, 320, onProgress, signal);
    case 'mp3-192':
      return encodeMp3Blob(left, right, numFrames, sampleRate, numChannels, 192, onProgress, signal);
    case 'flac':
      return encodeFlacBlob(left, right, numFrames, sampleRate, numChannels, onProgress, signal);
    case 'aiff': {
      const blob = encodeAiffBlob(left, right, numFrames, sampleRate, numChannels);
      onProgress?.(100);
      return blob;
    }
    case 'wav':
    default: {
      const blob = encodeWavBlob(left, right, numFrames, sampleRate, numChannels);
      onProgress?.(100);
      return blob;
    }
  }
}
