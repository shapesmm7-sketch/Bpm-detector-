import {
  AudioLibrary,
  AudioTrackItem,
  isNativeAndroid,
  resolvePlayableAudioUrl,
} from '../plugins/audioLibrary';

const PALETTES: ReadonlyArray<readonly [string, string, string]> = [
  ['#064e3b', '#10b981', '#a7f3d0'],
  ['#0f172a', '#06b6d4', '#67e8f9'],
  ['#311042', '#8b5cf6', '#ddd6fe'],
  ['#3f1d2b', '#ec4899', '#fbcfe8'],
  ['#431407', '#f97316', '#fed7aa'],
  ['#1e3a8a', '#3b82f6', '#bfdbfe'],
  ['#134e4a', '#14b8a6', '#99f6e4'],
  ['#312e81', '#6366f1', '#c7d2fe'],
];

const artworkCache = new Map<string, string>();
const inFlightRequests = new Map<string, Promise<string>>();
const generatedCache = new Map<string, string>();

function javaHashCode(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return h;
}

export function getAudioTrackArtworkCacheKey(track: {
  id?: string;
  uri?: string;
  title?: string;
  artist?: string;
}): string {
  if (track.id && track.id.length > 0) return `id:${track.id}`;
  if (track.uri && track.uri.length > 0) return `uri:${track.uri}`;
  return `meta:${track.title || ''}_${track.artist || ''}`;
}

export function getGeneratedAudioArtworkUrl(
  title: string,
  artist?: string,
  seedKey?: string
): string {
  const combinedSeed =
    seedKey && seedKey.length > 0 ? seedKey : `${title || ''}_${artist || ''}`;
  const existing = generatedCache.get(combinedSeed);
  if (existing) return existing;

  const hash = javaHashCode(combinedSeed || 'beatpulse');
  const palette = PALETTES[Math.abs(hash) % PALETTES.length];
  const gradId = `g${Math.abs(hash).toString(36)}`;

  let barsSvg = '';
  const barCount = 9;
  const barWidth = 10;
  const gap = 9;
  const totalW = barCount * barWidth + (barCount - 1) * gap;
  const startX = (360 - totalW) / 2;
  const baseY = 316;
  for (let i = 0; i < barCount; i++) {
    const hSeed = Math.abs((Math.imul(hash, 31) + i * 97) % 100);
    const barH = 14 + (hSeed / 100) * 30;
    const x = startX + i * (barWidth + gap);
    const y = baseY - barH;
    barsSvg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth}" height="${barH.toFixed(1)}" rx="5" fill="${palette[2]}" fill-opacity="0.68"/>`;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 360">` +
    `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="${palette[0]}"/>` +
    `<stop offset="56%" stop-color="#090d16"/>` +
    `<stop offset="100%" stop-color="${palette[1]}"/>` +
    `</linearGradient></defs>` +
    `<rect width="360" height="360" fill="url(#${gradId})"/>` +
    `<circle cx="180" cy="173" r="122" fill="${palette[1]}" fill-opacity="0.22"/>` +
    `<circle cx="180" cy="173" r="112" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="2.2"/>` +
    `<circle cx="180" cy="173" r="90" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1.5"/>` +
    `<circle cx="180" cy="173" r="68" fill="#0b1220" fill-opacity="0.86" stroke="${palette[2]}" stroke-opacity="0.72" stroke-width="3"/>` +
    barsSvg +
    `<path d="M180 140h28v18h-16v39h-12z" fill="#ffffff"/>` +
    `<circle cx="174" cy="197" r="15" fill="#ffffff"/>` +
    `</svg>`;

  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  generatedCache.set(combinedSeed, url);
  return url;
}

export async function resolveAudioTrackThumbnail(
  track: AudioTrackItem
): Promise<string> {
  if (track.thumbnailUrl) return track.thumbnailUrl;

  const key = getAudioTrackArtworkCacheKey(track);
  const cached = artworkCache.get(key);
  if (cached) return cached;

  const fallback = getGeneratedAudioArtworkUrl(
    track.title || track.displayName,
    track.artist,
    track.id || track.uri || track.title
  );

  if (!isNativeAndroid() || !track.uri || track.uri.startsWith('blob:')) {
    artworkCache.set(key, fallback);
    return fallback;
  }

  const inflight = inFlightRequests.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const res = await AudioLibrary.getAudioThumbnail({
        id: track.id || '',
        uri: track.uri,
        title: track.title || track.displayName || 'Audio Track',
        artist: track.artist || 'Unknown Artist',
      });
      const resolved = resolvePlayableAudioUrl(res);
      if (resolved) {
        artworkCache.set(key, resolved);
        return resolved;
      }
    } catch {
      // ignore thumbnail load error and use generated fallback
    } finally {
      inFlightRequests.delete(key);
    }
    artworkCache.set(key, fallback);
    return fallback;
  })();

  inFlightRequests.set(key, promise);
  return promise;
}

function decodeSynchsafe(b0: number, b1: number, b2: number, b3: number): number {
  return ((b0 & 0x7f) << 21) | ((b1 & 0x7f) << 14) | ((b2 & 0x7f) << 7) | (b3 & 0x7f);
}

function findAscii(bytes: Uint8Array, start: number, end: number): { text: string; next: number } {
  let pos = start;
  let text = '';
  while (pos < end && bytes[pos] !== 0) {
    text += String.fromCharCode(bytes[pos]);
    pos++;
  }
  return { text, next: pos + 1 };
}

function skipTerminatedString(bytes: Uint8Array, start: number, end: number, encoding: number): number {
  let pos = start;
  if (encoding === 1 || encoding === 2) {
    while (pos + 1 < end) {
      if (bytes[pos] === 0 && bytes[pos + 1] === 0) {
        return pos + 2;
      }
      pos += 2;
    }
    return end;
  }
  while (pos < end) {
    if (bytes[pos] === 0) {
      return pos + 1;
    }
    pos++;
  }
  return end;
}

function detectImageMime(data: Uint8Array): string {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    data.length >= 4 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return 'image/png';
  }
  if (data.length >= 4 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) {
    return 'image/webp';
  }
  return 'image/jpeg';
}

/**
 * Extracts embedded cover art from uploaded web audio files (ID3v2 APIC/PIC or MP4 covr atom).
 */
export async function extractWebAudioCoverArt(file: File): Promise<string | null> {
  try {
    const readLimit = Math.min(file.size, 1572864);
    const buffer = await file.slice(0, readLimit).arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // 1. Check ID3v2 header
    if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      const majorVersion = bytes[3];
      const flags = bytes[5];
      const tagSize = decodeSynchsafe(bytes[6], bytes[7], bytes[8], bytes[9]);
      let offset = 10;
      const limit = Math.min(bytes.length, 10 + tagSize);

      // Extended header (bit 6)
      if ((flags & 0x40) !== 0 && offset + 4 <= limit) {
        const extSize =
          majorVersion === 4
            ? decodeSynchsafe(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
            : ((bytes[offset] << 24) |
                (bytes[offset + 1] << 16) |
                (bytes[offset + 2] << 8) |
                bytes[offset + 3]) >>>
              0;
        offset += majorVersion === 4 ? extSize : 4 + extSize;
      }

      if (majorVersion === 2) {
        while (offset + 6 <= limit) {
          const frameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2]);
          const frameSize =
            (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5];
          offset += 6;
          if (frameSize <= 0 || offset + frameSize > limit) break;
          if (frameId === 'PIC' && frameSize > 6) {
            const encoding = bytes[offset];
            const imgFmt = String.fromCharCode(
              bytes[offset + 1],
              bytes[offset + 2],
              bytes[offset + 3]
            ).toLowerCase();
            let pos = offset + 5;
            pos = skipTerminatedString(bytes, pos, offset + frameSize, encoding);
            if (pos < offset + frameSize) {
              const imgBytes = bytes.slice(pos, offset + frameSize);
              const mime = imgFmt === 'png' ? 'image/png' : detectImageMime(imgBytes);
              return URL.createObjectURL(new Blob([imgBytes], { type: mime }));
            }
          }
          offset += frameSize;
        }
      } else if (majorVersion === 3 || majorVersion === 4) {
        while (offset + 10 <= limit) {
          const frameId = String.fromCharCode(
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3]
          );
          if (bytes[offset] === 0) break;
          const frameSize =
            majorVersion === 4
              ? decodeSynchsafe(
                  bytes[offset + 4],
                  bytes[offset + 5],
                  bytes[offset + 6],
                  bytes[offset + 7]
                )
              : ((bytes[offset + 4] << 24) |
                  (bytes[offset + 5] << 16) |
                  (bytes[offset + 6] << 8) |
                  bytes[offset + 7]) >>>
                0;
          offset += 10;
          if (frameSize <= 0 || offset + frameSize > limit) break;
          if (frameId === 'APIC' && frameSize > 4) {
            const frameEnd = offset + frameSize;
            const encoding = bytes[offset];
            const mimeInfo = findAscii(bytes, offset + 1, frameEnd);
            let pos = mimeInfo.next;
            if (pos < frameEnd) {
              pos += 1; // picture type byte
              pos = skipTerminatedString(bytes, pos, frameEnd, encoding);
              if (pos < frameEnd) {
                const imgBytes = bytes.slice(pos, frameEnd);
                const mime =
                  mimeInfo.text && mimeInfo.text.includes('/')
                    ? mimeInfo.text
                    : detectImageMime(imgBytes);
                return URL.createObjectURL(new Blob([imgBytes], { type: mime }));
              }
            }
          }
          offset += frameSize;
        }
      }
    }

    // 2. Quick scan for MP4 'covr' -> 'data' atom in first 1.5MB
    for (let i = 0; i + 20 < bytes.length; i++) {
      if (
        bytes[i] === 0x63 &&
        bytes[i + 1] === 0x6f &&
        bytes[i + 2] === 0x76 &&
        bytes[i + 3] === 0x72
      ) {
        const dataLen =
          ((bytes[i + 4] << 24) | (bytes[i + 5] << 16) | (bytes[i + 6] << 8) | bytes[i + 7]) >>> 0;
        if (
          dataLen > 16 &&
          i + 4 + dataLen <= bytes.length &&
          bytes[i + 8] === 0x64 &&
          bytes[i + 9] === 0x61 &&
          bytes[i + 10] === 0x74 &&
          bytes[i + 11] === 0x61
        ) {
          const imgStart = i + 20;
          const imgEnd = i + 4 + dataLen;
          if (imgStart < imgEnd) {
            const imgBytes = bytes.slice(imgStart, imgEnd);
            const mime = detectImageMime(imgBytes);
            return URL.createObjectURL(new Blob([imgBytes], { type: mime }));
          }
        }
      }
    }
  } catch {
    // ignore metadata parse failures
  }
  return null;
}
