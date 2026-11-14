import { Capacitor, registerPlugin } from '@capacitor/core';

export interface AudioTrackItem {
  id: string;
  title: string;
  displayName: string;
  artist: string;
  album: string;
  durationMs: number;
  size: number;
  mimeType: string;
  uri: string;
  webUrl?: string;
}

export interface VideoTrackItem {
  id: string;
  title: string;
  displayName: string;
  durationMs: number;
  size: number;
  mimeType: string;
  resolution: string;
  uri: string;
  webUrl?: string;
}

interface AudioLibraryPluginInterface {
  getAllAudioFiles(): Promise<{
    granted: boolean;
    songs: AudioTrackItem[];
  }>;
  getAllVideoFiles(): Promise<{
    granted: boolean;
    videos: VideoTrackItem[];
  }>;
  prepareAudioFile(options: {
    uri: string;
    displayName?: string;
  }): Promise<{
    filePath?: string;
    localUrl: string;
  }>;
  prepareMediaFile(options: {
    uri: string;
    displayName?: string;
    mediaKind?: 'audio' | 'video';
  }): Promise<{
    filePath?: string;
    localUrl: string;
  }>;
  beginAudioExport(): Promise<{
    exportId: string;
  }>;
  appendAudioExportChunk(options: {
    exportId: string;
    base64Chunk: string;
  }): Promise<void>;
  finishAudioExport(options: {
    exportId: string;
    fileName: string;
    mimeType: string;
  }): Promise<{
    saved: boolean;
    displayPath: string;
    uri: string;
  }>;
  cancelAudioExport(options: {
    exportId: string;
  }): Promise<void>;
}

export const AudioLibrary = registerPlugin<AudioLibraryPluginInterface>('AudioLibrary');

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function resolvePlayableAudioUrl(prepared: { filePath?: string; localUrl: string }): string {
  if (prepared.filePath) {
    return Capacitor.convertFileSrc(prepared.filePath);
  }
  return prepared.localUrl;
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Saves an exported audio Blob locally to the device:
 * - On native Android (Capacitor): streams in 384 KB chunks directly into Android MediaStore (Music/BeatPulse/).
 * - On Web: triggers a standard browser file download.
 */
export async function saveExportedAudioBlob(
  blob: Blob,
  fileName: string,
  onProgress?: (percent: number) => void
): Promise<{ displayPath: string }> {
  if (isNativeAndroid()) {
    const { exportId } = await AudioLibrary.beginAudioExport();
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const chunkBytes = 384 * 1024;
      const total = bytes.length;

      for (let offset = 0; offset < total; offset += chunkBytes) {
        const slice = bytes.subarray(offset, Math.min(offset + chunkBytes, total));
        const base64Chunk = uint8ToBase64(slice);
        await AudioLibrary.appendAudioExportChunk({ exportId, base64Chunk });
        onProgress?.(Math.min(99, Math.round(((offset + slice.length) / total) * 100)));
      }

      const result = await AudioLibrary.finishAudioExport({
        exportId,
        fileName,
        mimeType: blob.type || 'audio/wav',
      });
      onProgress?.(100);
      return { displayPath: result.displayPath || `Music/BeatPulse/${fileName}` };
    } catch (err) {
      try {
        await AudioLibrary.cancelAudioExport({ exportId });
      } catch {
        // ignore cleanup error
      }
      throw err;
    }
  }

  // Web / Desktop browser local download
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  onProgress?.(100);
  return { displayPath: fileName };
}
