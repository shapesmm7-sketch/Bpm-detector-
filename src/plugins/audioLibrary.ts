import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';

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
  thumbnailUrl?: string;
  hasEmbeddedArt?: boolean;
}

export type MusicRepeatMode = 'off' | 'all' | 'one';

export interface MusicPlaybackState {
  hasTrack: boolean;
  trackId: string;
  trackUri: string;
  title: string;
  displayName: string;
  artist: string;
  album: string;
  isPlaying: boolean;
  isLoading: boolean;
  positionMs: number;
  durationMs: number;
  isShuffle: boolean;
  repeatMode: MusicRepeatMode;
  playbackSpeed?: number;
  error?: string;
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
  thumbnailUrl?: string;
}

export interface ImageTrackItem {
  id: string;
  title: string;
  displayName: string;
  width: number;
  height: number;
  size: number;
  mimeType: string;
  uri: string;
  webUrl?: string;
  thumbnailUrl?: string;
}

export interface ExternalMediaPayload {
  requestId: string;
  mediaKind: 'audio' | 'video';
  title: string;
  displayName: string;
  mimeType: string;
  size: number;
  durationMs: number;
  resolution?: string;
  uri: string;
  filePath?: string;
  localUrl: string;
}

export interface DefaultPlayerStatus {
  supported: boolean;
  isAudioDefault: boolean;
  isVideoDefault: boolean;
  audioDefaultApp: string | null;
  audioDefaultPkg: string | null;
  videoDefaultApp: string | null;
  videoDefaultPkg: string | null;
}

export interface SetDefaultPlayerResult extends DefaultPlayerStatus {
  action: 'prompted_chooser' | 'opened_clear_defaults' | 'already_default' | 'opened_settings';
  target: 'audio' | 'video' | 'both';
  lockedApp?: string;
  lockedPackage?: string;
}

export type AppThemeMode = 'dark' | 'light' | 'system';

export interface VideoTrimResult {
  saved: boolean;
  displayPath: string;
  video: VideoTrackItem;
}

export interface VideoSplitResult {
  saved: boolean;
  displayPaths: string[];
  videos: VideoTrackItem[];
}

export interface VideoSegmentRange {
  startMs: number;
  endMs: number;
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
  getAllImageFiles(): Promise<{
    granted: boolean;
    images: ImageTrackItem[];
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
    mediaKind?: 'audio' | 'video' | 'image';
    keepAlive?: boolean;
    forceCopy?: boolean;
  }): Promise<{
    filePath?: string;
    localUrl: string;
  }>;
  getAudioThumbnail(options: {
    id: string;
    uri: string;
    title?: string;
    artist?: string;
  }): Promise<{
    filePath?: string;
    localUrl: string;
    hasEmbeddedArt?: boolean;
  }>;
  getVideoThumbnail(options: {
    id: string;
    uri: string;
  }): Promise<{
    filePath?: string;
    localUrl: string;
  }>;
  getImageThumbnail(options: {
    id: string;
    uri: string;
  }): Promise<{
    filePath?: string;
    localUrl: string;
  }>;
  trimVideoLossless(options: {
    uri: string;
    displayName?: string;
    title?: string;
    startMs: number;
    endMs: number;
  }): Promise<VideoTrimResult>;
  splitVideoLossless(options: {
    uri: string;
    displayName?: string;
    title?: string;
    splitMs: number;
    keepPart?: 'both' | 'part1' | 'part2';
  }): Promise<VideoSplitResult>;
  exportVideoSegmentsLossless(options: {
    uri: string;
    displayName?: string;
    title?: string;
    segments: VideoSegmentRange[];
  }): Promise<VideoTrimResult>;
  consumePendingExternalMedia(): Promise<{
    media: ExternalMediaPayload | null;
  }>;
  consumePendingOpenSection(): Promise<{
    section: 'home' | 'audio' | 'video' | null;
  }>;
  startMusicPlayback(options: {
    songs: AudioTrackItem[];
    startIndex: number;
    isShuffle: boolean;
    repeatMode: MusicRepeatMode;
    volume: number;
    isMuted: boolean;
    playbackSpeed?: number;
  }): Promise<void>;
  toggleMusicPlayPause(): Promise<void>;
  pauseMusicPlayback(): Promise<void>;
  resumeMusicPlayback(): Promise<void>;
  stepMusicTrack(options: { direction: -1 | 1 }): Promise<void>;
  seekMusicPlayback(options: { positionMs: number }): Promise<void>;
  updateMusicSettings(options: {
    isShuffle: boolean;
    repeatMode: MusicRepeatMode;
    volume: number;
    isMuted: boolean;
    playbackSpeed?: number;
  }): Promise<void>;
  updateMusicQueue(options: { songs: AudioTrackItem[] }): Promise<void>;
  stopMusicPlayback(): Promise<void>;
  getMusicPlaybackState(): Promise<MusicPlaybackState>;
  getDefaultPlayerStatus(): Promise<DefaultPlayerStatus>;
  setAsDefaultPlayer(options?: {
    mediaType?: 'auto' | 'audio' | 'video';
  }): Promise<SetDefaultPlayerResult>;
  openDefaultAppsSettings(options?: {
    packageName?: string;
  }): Promise<{
    opened: boolean;
  }>;
  setAppAppearance(options: {
    theme: AppThemeMode;
  }): Promise<{
    applied: boolean;
    theme: AppThemeMode;
    isDark: boolean;
  }>;
  getAudioDetails(options: {
    uri: string;
    id?: string;
    displayName?: string;
  }): Promise<{
    bitrateKbps?: number;
    sampleRateHz?: number;
    mimeType?: string;
    folderPath?: string;
    artist?: string;
    album?: string;
    title?: string;
    durationMs?: number;
    size?: number;
  }>;
  setAsRingtone(options: {
    uri: string;
    title?: string;
    displayName?: string;
  }): Promise<{
    status: 'set' | 'permission_required' | 'failed';
    message?: string;
  }>;
  shareAudioFile(options: {
    uri: string;
    title?: string;
    displayName?: string;
    mimeType?: string;
  }): Promise<{ shared: boolean }>;
  deleteAudioFile(options: {
    uri: string;
    id?: string;
  }): Promise<{ deleted: boolean; cancelled?: boolean }>;
  renameAudioFile(options: {
    uri: string;
    id?: string;
    newTitle: string;
    newDisplayName?: string;
    newArtist?: string;
    newAlbum?: string;
  }): Promise<{
    renamed: boolean;
    cancelled?: boolean;
    title: string;
    displayName: string;
    artist?: string;
    album?: string;
  }>;
  moveOrCopyAudioFile(options: {
    uri: string;
    id?: string;
    displayName: string;
    title?: string;
    artist?: string;
    album?: string;
    durationMs?: number;
    mimeType?: string;
    targetFolder: string;
    mode: 'move' | 'copy';
  }): Promise<{
    success: boolean;
    cancelled?: boolean;
    newUri?: string;
    displayPath?: string;
    song?: AudioTrackItem;
  }>;
  moveToSecureFolder(options: {
    uri: string;
    id?: string;
    title?: string;
    displayName: string;
    mimeType?: string;
  }): Promise<{
    launched: boolean;
    usedSystemSecureFolder: boolean;
    message?: string;
  }>;
  pinAudioShortcut(options: {
    id: string;
    uri: string;
    title: string;
    artist?: string;
    displayName?: string;
  }): Promise<{
    pinned: boolean;
    supported: boolean;
  }>;
  addListener(
    eventName: 'externalMediaOpened',
    listenerFunc: (payload: ExternalMediaPayload) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'defaultPlayerStatusChanged',
    listenerFunc: (status: DefaultPlayerStatus) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'musicPlaybackStateChanged',
    listenerFunc: (state: MusicPlaybackState) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'openSectionRequested',
    listenerFunc: (payload: { section: 'home' | 'audio' | 'video' }) => void
  ): Promise<PluginListenerHandle>;
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
  finishVideoExport(options: {
    exportId: string;
    fileName: string;
    mimeType: string;
    title?: string;
    durationMs?: number;
    resolution?: string;
  }): Promise<VideoTrimResult>;
}

export const AudioLibrary = registerPlugin<AudioLibraryPluginInterface>('AudioLibrary');

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function resolvePlayableAudioUrl(prepared: { filePath?: string; localUrl: string }): string {
  const raw = prepared.filePath ? Capacitor.convertFileSrc(prepared.filePath) : prepared.localUrl;
  if (!raw) return raw;
  if (raw.includes('/_capacitor_file_') && (raw.includes('#') || raw.includes('?'))) {
    return raw.replace(/#/g, '%23').replace(/\?/g, '%3F');
  }
  return raw;
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
 * - On native Android (Capacitor): streams in 384 KB chunks directly into Android MediaStore (Music/Mo Vibe/).
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
      return { displayPath: result.displayPath || `Music/Mo Vibe/${fileName}` };
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

/**
 * Saves a composed video Blob (multi-clip / images / replaced audio) locally:
 * - On native Android: streams in 384 KB chunks into Android MediaStore Movies/Mo Vibe/.
 * - On Web: triggers a browser file download.
 */
export async function saveExportedVideoBlob(
  blob: Blob,
  fileName: string,
  title: string,
  durationMs: number,
  resolution: string
): Promise<{ displayPath: string; video?: VideoTrackItem }> {
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
      }

      const result = await AudioLibrary.finishVideoExport({
        exportId,
        fileName,
        mimeType: blob.type || 'video/mp4',
        title,
        durationMs: Math.round(durationMs),
        resolution,
      });
      return { displayPath: result.displayPath, video: result.video };
    } catch (err) {
      try {
        await AudioLibrary.cancelAudioExport({ exportId });
      } catch {
        // ignore cleanup error
      }
      throw err;
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { displayPath: fileName };
}
