import React, { useEffect, useRef, useState } from 'react';
import {
  AudioLibrary,
  VideoTrackItem,
  isNativeAndroid,
  resolvePlayableAudioUrl,
  saveExportedAudioBlob,
  saveExportedVideoBlob,
} from '../plugins/audioLibrary';
import {
  AUDIO_EXPORT_FORMATS,
  AudioExportFormat,
  encodeAudioFormatBlob,
  getAudioFormatOption,
} from '../utils/audioEncoders';
import { decodeAudioData } from '../utils/audioAnalyzer';
import {
  Check,
  Copy,
  Film,
  Folder,
  FolderInput,
  FolderOpen,
  Headphones,
  Maximize2,
  Music,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  Trash2,
  Video,
  X,
} from 'lucide-react';

function formatClock(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/* ---------------- Video Delete Confirmation Modal ---------------- */
interface VideoDeleteConfirmModalProps {
  video: VideoTrackItem | null;
  isBusy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const VideoDeleteConfirmModal: React.FC<VideoDeleteConfirmModalProps> = ({
  video,
  isBusy,
  onClose,
  onConfirm,
}) => {
  if (!video) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm p-4"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 text-red-600 dark:text-red-400">
          <Trash2 className="w-5 h-5" />
          <h3 className="text-base font-bold">Delete Video?</h3>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          Delete{' '}
          <span className="font-bold text-slate-900 dark:text-slate-100">
            &ldquo;{video.title || video.displayName}&rdquo;
          </span>{' '}
          from your library{isNativeAndroid() ? ' and phone storage' : ''}?
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            className="min-h-[40px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onConfirm}
            className="min-h-[40px] px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold cursor-pointer"
          >
            {isBusy ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------------- Video Rename Modal ---------------- */
interface VideoRenameModalProps {
  video: VideoTrackItem | null;
  isBusy: boolean;
  onClose: () => void;
  onConfirm: (newTitle: string) => void;
}

export const VideoRenameModal: React.FC<VideoRenameModalProps> = ({
  video,
  isBusy,
  onClose,
  onConfirm,
}) => {
  const [name, setName] = useState('');

  useEffect(() => {
    if (video) {
      setName(video.title || video.displayName.replace(/\.[^/.]+$/, ''));
    }
  }, [video]);

  if (!video) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm p-4"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5">
          <Pencil className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Rename Video
          </h3>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) onConfirm(name.trim());
          }}
          autoFocus
          className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-emerald-500 rounded-xl px-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none"
          placeholder="Enter new video name"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            className="min-h-[40px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isBusy || !name.trim()}
            onClick={() => onConfirm(name.trim())}
            className="min-h-[40px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white dark:text-slate-950 text-xs font-bold cursor-pointer"
          >
            {isBusy ? 'Renaming...' : 'Rename'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------------- Video Move / Copy Folder Picker Modal ---------------- */
interface VideoMoveCopyModalProps {
  mode: 'move' | 'copy' | null;
  video: VideoTrackItem | null;
  folders: string[];
  isLoadingFolders?: boolean;
  isNativeAndroid?: boolean;
  isBusy: boolean;
  onClose: () => void;
  onConfirm: (targetFolder: string) => void;
  onBrowsePhoneFolders?: () => void;
}

const DEFAULT_VIDEO_PHONE_FOLDERS = [
  'Movies/Mo Vibe',
  'Movies',
  'Download',
  'Download/Mo Vibe',
  'DCIM',
  'Documents',
  'Music',
  'Pictures',
  'Recordings',
];

export const VideoMoveCopyModal: React.FC<VideoMoveCopyModalProps> = ({
  mode,
  video,
  folders,
  isLoadingFolders = false,
  isNativeAndroid: nativeAndroid = false,
  isBusy,
  onClose,
  onConfirm,
  onBrowsePhoneFolders,
}) => {
  const [selectedFolder, setSelectedFolder] = useState('Movies/Mo Vibe');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (mode && video) {
      setSearchQuery('');
      setSelectedFolder('Movies/Mo Vibe');
    }
  }, [mode, video]);

  if (!mode || !video) return null;

  const mergedBase = Array.from(
    new Set([
      'Movies/Mo Vibe',
      'Movies',
      'DCIM',
      'Download',
      ...(folders.length > 0 ? folders : DEFAULT_VIDEO_PHONE_FOLDERS),
    ])
  );
  const trimmedSearch = searchQuery.trim().replace(/^\/+|\/+$/g, '');
  const filteredFolders = trimmedSearch
    ? mergedBase.filter((folder) =>
        folder.toLowerCase().includes(trimmedSearch.toLowerCase())
      )
    : mergedBase;

  const hasExactMatch =
    trimmedSearch.length > 0 &&
    mergedBase.some((f) => f.toLowerCase() === trimmedSearch.toLowerCase());

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm p-0 sm:p-4"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col p-5 space-y-3.5 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {mode === 'move' ? (
              <FolderInput className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
            ) : (
              <Copy className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0" />
            )}
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">
              {mode === 'move' ? 'Move Video to Folder' : 'Copy Video to Folder'}
            </h3>
          </div>
          {nativeAndroid && onBrowsePhoneFolders && (
            <button
              type="button"
              disabled={isBusy}
              onClick={onBrowsePhoneFolders}
              className="min-h-[34px] px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5 text-emerald-500" />
              <span>Browse Storage</span>
            </button>
          )}
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 truncate shrink-0">
          {video.title || video.displayName}
        </p>

        <div className="relative shrink-0">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search or enter any folder (e.g. Movies, DCIM, My Videos)"
            className="w-full min-h-[38px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-emerald-500 rounded-xl pl-8 pr-8 text-xs text-slate-900 dark:text-slate-100 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              aria-label="Clear folder filter"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="space-y-1.5 overflow-y-auto flex-1 min-h-[160px] pr-1">
          {isLoadingFolders && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400 px-2 py-1">
              Scanning phone folders...
            </div>
          )}

          {trimmedSearch && !hasExactMatch && (
            <button
              type="button"
              onClick={() => setSelectedFolder(trimmedSearch)}
              className={`w-full min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-between text-left cursor-pointer ${
                selectedFolder === trimmedSearch
                  ? 'bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-50 dark:bg-slate-950 border-dashed border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              <span className="flex items-center gap-2 truncate">
                <Folder className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className="truncate">Use folder: {trimmedSearch}</span>
              </span>
              {selectedFolder === trimmedSearch && <Check className="w-4 h-4 shrink-0" />}
            </button>
          )}

          {filteredFolders.map((folder) => {
            const active = selectedFolder === folder;
            return (
              <button
                key={folder}
                type="button"
                onClick={() => setSelectedFolder(folder)}
                className={`w-full min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-between text-left cursor-pointer ${
                  active
                    ? 'bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <Folder className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{folder}</span>
                </span>
                {active && <Check className="w-4 h-4 shrink-0" />}
              </button>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 pt-1 shrink-0">
          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            className="min-h-[40px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isBusy || !selectedFolder.trim()}
            onClick={() => onConfirm(selectedFolder.trim())}
            className="min-h-[40px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white dark:text-slate-950 text-xs font-bold cursor-pointer"
          >
            {isBusy
              ? mode === 'move'
                ? 'Moving...'
                : 'Copying...'
              : mode === 'move'
              ? 'Move Here'
              : 'Copy Here'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------------- Video to Audio Converter Modal ---------------- */
interface VideoToAudioModalProps {
  video: VideoTrackItem | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

type VideoToAudioChoice = 'original_m4a' | AudioExportFormat;

export const VideoToAudioModal: React.FC<VideoToAudioModalProps> = ({
  video,
  onClose,
  onSuccess,
}) => {
  const [selectedChoice, setSelectedChoice] = useState<VideoToAudioChoice>(
    isNativeAndroid() ? 'original_m4a' : 'mp3-320'
  );
  const [isBusy, setIsBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedChoice(isNativeAndroid() ? 'original_m4a' : 'mp3-320');
    setProgress(0);
    setError(null);
  }, [video]);

  if (!video) return null;

  const baseName = (video.title || video.displayName || 'video')
    .replace(/\.[^/.]+$/, '')
    .trim();

  const handleExtract = async () => {
    setIsBusy(true);
    setError(null);
    setProgress(10);
    try {
      if (selectedChoice === 'original_m4a' && isNativeAndroid()) {
        setProgress(45);
        const res = await AudioLibrary.extractVideoAudio({
          uri: video.uri,
          title: baseName,
          displayName: video.displayName,
          setAsRingtone: false,
        });
        if (!res.saved) {
          throw new Error(res.message || 'Could not extract audio from this video.');
        }
        setProgress(100);
        onSuccess(res.message || `Saved audio to ${res.displayPath}`);
        onClose();
        return;
      }

      const format: AudioExportFormat =
        selectedChoice === 'original_m4a' ? 'mp3-320' : selectedChoice;
      let playableUrl = video.webUrl || '';
      if (!playableUrl && isNativeAndroid()) {
        const prepared = await AudioLibrary.prepareMediaFile({
          uri: video.uri,
          displayName: video.displayName || video.title,
          mediaKind: 'video',
        });
        playableUrl = resolvePlayableAudioUrl(prepared);
      }
      if (!playableUrl) {
        throw new Error('Video source unavailable.');
      }

      setProgress(25);
      const response = await fetch(playableUrl);
      if (!response.ok) {
        throw new Error('Could not read video stream.');
      }
      const buffer = await response.arrayBuffer();
      setProgress(45);
      const decoded = await decodeAudioData(buffer);
      setProgress(65);
      const left = decoded.getChannelData(0);
      const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : left;
      const encodedBlob = await encodeAudioFormatBlob(
        left,
        right,
        decoded.length,
        decoded.sampleRate,
        decoded.numberOfChannels,
        format,
        (pct) => {
          setProgress(65 + Math.round(pct * 0.25));
        }
      );
      const opt = getAudioFormatOption(format);
      const fileName = `${baseName}.${opt.extension}`;
      const saved = await saveExportedAudioBlob(encodedBlob, fileName, (pct) => {
        setProgress(90 + Math.round(pct * 0.1));
      });
      onSuccess(`Extracted audio saved to ${saved.displayPath}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audio extraction failed.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm p-0 sm:p-4"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <Music className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Video to Audio
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {video.title || video.displayName}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            className="min-w-[36px] min-h-[36px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          {isNativeAndroid() && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setSelectedChoice('original_m4a')}
              className={`w-full px-3.5 py-3 rounded-xl border text-left flex items-center justify-between cursor-pointer ${
                selectedChoice === 'original_m4a'
                  ? 'bg-emerald-500/10 border-emerald-500 text-emerald-800 dark:text-emerald-200'
                  : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              <div>
                <div className="text-xs font-bold">Original Audio (M4A · Instant)</div>
                <div className="text-[11px] opacity-75">
                  Fast lossless extraction directly from video
                </div>
              </div>
              {selectedChoice === 'original_m4a' && <Check className="w-4 h-4 text-emerald-500 shrink-0" />}
            </button>
          )}

          {AUDIO_EXPORT_FORMATS.filter((f) => f.id !== 'aiff').map((fmt) => {
            const active = selectedChoice === fmt.id;
            return (
              <button
                key={fmt.id}
                type="button"
                disabled={isBusy}
                onClick={() => setSelectedChoice(fmt.id)}
                className={`w-full px-3.5 py-2.5 rounded-xl border text-left flex items-center justify-between cursor-pointer ${
                  active
                    ? 'bg-emerald-500/10 border-emerald-500 text-emerald-800 dark:text-emerald-200'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div>
                  <div className="text-xs font-bold">
                    {fmt.label} · {fmt.qualityTag}
                  </div>
                  <div className="text-[11px] opacity-75">{fmt.description}</div>
                </div>
                {active && <Check className="w-4 h-4 text-emerald-500 shrink-0" />}
              </button>
            );
          })}
        </div>

        {isBusy && (
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
              <span>Extracting audio track...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 font-medium">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            className="min-h-[40px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handleExtract()}
            className="min-h-[40px] px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white dark:text-slate-950 text-xs font-bold cursor-pointer"
          >
            {isBusy ? 'Extracting...' : 'Extract Audio'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------------- Video Format & Resolution Converter Modal ---------------- */
interface VideoConverterModalProps {
  video: VideoTrackItem | null;
  onClose: () => void;
  onConverted: (message: string, savedVideo?: VideoTrackItem) => void;
}

type VideoTargetFormat = 'mp4_h264' | 'webm_vp9' | 'webm_vp8';
type VideoResolutionPreset = 'original' | '1080p' | '720p' | '480p';
type VideoQualityPreset = 'high' | 'balanced' | 'compact';

function pickSupportedRecorderMime(choice: VideoTargetFormat): {
  mimeType: string;
  extension: string;
} {
  if (typeof MediaRecorder === 'undefined') {
    return { mimeType: 'video/webm', extension: 'webm' };
  }
  const candidates: Record<VideoTargetFormat, Array<{ mime: string; ext: string }>> = {
    mp4_h264: [
      { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
      { mime: 'video/mp4', ext: 'mp4' },
      { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
      { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    ],
    webm_vp9: [
      { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
      { mime: 'video/webm;codecs=vp9', ext: 'webm' },
      { mime: 'video/webm', ext: 'webm' },
    ],
    webm_vp8: [
      { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
      { mime: 'video/webm', ext: 'webm' },
    ],
  };

  for (const item of candidates[choice]) {
    if (MediaRecorder.isTypeSupported(item.mime)) {
      return { mimeType: item.mime, extension: item.ext };
    }
  }
  return { mimeType: 'video/webm', extension: 'webm' };
}

export const VideoConverterModal: React.FC<VideoConverterModalProps> = ({
  video,
  onClose,
  onConverted,
}) => {
  const [targetFormat, setTargetFormat] = useState<VideoTargetFormat>('mp4_h264');
  const [resolution, setResolution] = useState<VideoResolutionPreset>('720p');
  const [quality, setQuality] = useState<VideoQualityPreset>('balanced');
  const [isBusy, setIsBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    setTargetFormat('mp4_h264');
    setResolution('720p');
    setQuality('balanced');
    setProgress(0);
    setError(null);
    cancelRef.current = false;
  }, [video]);

  if (!video) return null;

  const baseName = (video.title || video.displayName || 'video')
    .replace(/\.[^/.]+$/, '')
    .trim();

  const handleConvert = async () => {
    setIsBusy(true);
    setError(null);
    setProgress(3);
    cancelRef.current = false;

    let tempVideo: HTMLVideoElement | null = null;
    let audioCtx: AudioContext | null = null;
    let rafId: number | null = null;
    let recorder: MediaRecorder | null = null;

    try {
      let playableUrl = video.webUrl || '';
      if (!playableUrl && isNativeAndroid()) {
        const prepared = await AudioLibrary.prepareMediaFile({
          uri: video.uri,
          displayName: video.displayName || video.title,
          mediaKind: 'video',
        });
        playableUrl = resolvePlayableAudioUrl(prepared);
      }
      if (!playableUrl) throw new Error('Video source unavailable.');

      tempVideo = document.createElement('video');
      tempVideo.src = playableUrl;
      tempVideo.crossOrigin = 'anonymous';
      tempVideo.playsInline = true;
      tempVideo.muted = false;
      tempVideo.preload = 'auto';

      await new Promise<void>((resolve, reject) => {
        if (!tempVideo) return reject(new Error('Missing player'));
        const onLoaded = () => resolve();
        const onErr = () => reject(new Error('Could not decode video for conversion.'));
        tempVideo.addEventListener('loadedmetadata', onLoaded, { once: true });
        tempVideo.addEventListener('error', onErr, { once: true });
      });

      const srcW = tempVideo.videoWidth || 1280;
      const srcH = tempVideo.videoHeight || 720;
      const maxDimMap: Record<VideoResolutionPreset, number | null> = {
        original: null,
        '1080p': 1920,
        '720p': 1280,
        '480p': 854,
      };
      const maxDim = maxDimMap[resolution];
      let outW = srcW;
      let outH = srcH;
      if (maxDim && Math.max(srcW, srcH) > maxDim) {
        const scale = maxDim / Math.max(srcW, srcH);
        outW = Math.max(2, Math.round((srcW * scale) / 2) * 2);
        outH = Math.max(2, Math.round((srcH * scale) / 2) * 2);
      } else {
        outW = Math.max(2, Math.round(srcW / 2) * 2);
        outH = Math.max(2, Math.round(srcH / 2) * 2);
      }

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable.');

      const videoStream = canvas.captureStream(30);
      const tracks: MediaStreamTrack[] = [...videoStream.getVideoTracks()];

      try {
        const ACtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new ACtx();
        const srcNode = audioCtx.createMediaElementSource(tempVideo);
        const destNode = audioCtx.createMediaStreamDestination();
        srcNode.connect(destNode);
        const aTrack = destNode.stream.getAudioTracks()[0];
        if (aTrack) tracks.push(aTrack);
      } catch {
        // Proceed cleanly even if audio track cannot be routed on silent clips
      }

      const combinedStream = new MediaStream(tracks);
      const { mimeType, extension } = pickSupportedRecorderMime(targetFormat);
      const bitrateMap: Record<VideoQualityPreset, number> = {
        high: 6_000_000,
        balanced: 3_000_000,
        compact: 1_200_000,
      };

      const chunks: BlobPart[] = [];
      recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: bitrateMap[quality],
      });
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };

      const stoppedPromise = new Promise<void>((resolve) => {
        if (!recorder) return resolve();
        recorder.onstop = () => resolve();
      });

      const totalDur = Math.max(0.1, tempVideo.duration || (video.durationMs || 1000) / 1000);
      recorder.start(250);
      await tempVideo.play();

      await new Promise<void>((resolve, reject) => {
        const tick = () => {
          if (cancelRef.current) {
            reject(new Error('Conversion cancelled.'));
            return;
          }
          if (!tempVideo) {
            resolve();
            return;
          }
          ctx.drawImage(tempVideo, 0, 0, outW, outH);
          const pct = Math.min(92, Math.max(5, Math.round((tempVideo.currentTime / totalDur) * 90)));
          setProgress(pct);
          if (tempVideo.ended || tempVideo.currentTime >= totalDur - 0.02) {
            resolve();
            return;
          }
          rafId = window.requestAnimationFrame(tick);
        };
        rafId = window.requestAnimationFrame(tick);
      });

      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      await stoppedPromise;
      setProgress(95);

      const outBlob = new Blob(chunks, { type: mimeType.split(';')[0] || 'video/mp4' });
      const outFileName = `${baseName}_converted.${extension}`;
      const saved = await saveExportedVideoBlob(
        outBlob,
        outFileName,
        `${baseName} (${resolution === 'original' ? `${outW}x${outH}` : resolution})`,
        Math.round(totalDur * 1000),
        `${outW}x${outH}`
      );
      setProgress(100);
      onConverted(`Converted video saved to ${saved.displayPath}`, saved.video);
      onClose();
    } catch (err) {
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* ignore */ }
      }
      setError(err instanceof Error ? err.message : 'Video conversion failed.');
    } finally {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (tempVideo) {
        tempVideo.pause();
        tempVideo.removeAttribute('src');
        tempVideo.load();
      }
      if (audioCtx) {
        try { await audioCtx.close(); } catch { /* ignore */ }
      }
      setIsBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm p-0 sm:p-4"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <RefreshCw className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Video Converter
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {video.title || video.displayName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (isBusy) {
                cancelRef.current = true;
              } else {
                onClose();
              }
            }}
            className="min-w-[36px] min-h-[36px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Output Format */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Format
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                { id: 'mp4_h264', label: 'MP4 · Auto' },
                { id: 'webm_vp9', label: 'WebM · VP9' },
                { id: 'webm_vp8', label: 'WebM · VP8' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={isBusy}
                onClick={() => setTargetFormat(opt.id)}
                className={`min-h-[38px] px-2 rounded-xl border text-xs font-bold cursor-pointer ${
                  targetFormat === opt.id
                    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Resolution */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Resolution
          </span>
          <div className="grid grid-cols-4 gap-1.5">
            {(['original', '1080p', '720p', '480p'] as const).map((res) => (
              <button
                key={res}
                type="button"
                disabled={isBusy}
                onClick={() => setResolution(res)}
                className={`min-h-[36px] px-2 rounded-xl border text-xs font-bold capitalize cursor-pointer ${
                  resolution === res
                    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {res}
              </button>
            ))}
          </div>
        </div>

        {/* Quality */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Quality
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                { id: 'high', label: 'High' },
                { id: 'balanced', label: 'Balanced' },
                { id: 'compact', label: 'Compact' },
              ] as const
            ).map((qOpt) => (
              <button
                key={qOpt.id}
                type="button"
                disabled={isBusy}
                onClick={() => setQuality(qOpt.id)}
                className={`min-h-[36px] px-2 rounded-xl border text-xs font-bold cursor-pointer ${
                  quality === qOpt.id
                    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {qOpt.label}
              </button>
            ))}
          </div>
        </div>

        {isBusy && (
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
              <span>Converting video ({resolution})...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 font-medium">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              if (isBusy) {
                cancelRef.current = true;
              } else {
                onClose();
              }
            }}
            className="min-h-[40px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
          >
            {isBusy ? 'Cancel Conversion' : 'Close'}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handleConvert()}
            className="min-h-[40px] px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white dark:text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Film className="w-4 h-4" />
            <span>{isBusy ? 'Converting...' : 'Convert & Save'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------------- Play Video as Audio Mini Deck ---------------- */
interface VideoPlayAsAudioBarProps {
  video: VideoTrackItem | null;
  thumbUrl?: string;
  pauseSignal: number;
  onPlaybackStarted: () => void;
  onOpenAsVideo: (video: VideoTrackItem) => void;
  onClose: () => void;
}

const AUDIO_MODE_SPEEDS = [1, 1.25, 1.5, 2, 0.5];

export const VideoPlayAsAudioBar: React.FC<VideoPlayAsAudioBarProps> = ({
  video,
  thumbUrl,
  pauseSignal,
  onPlaybackStarted,
  onOpenAsVideo,
  onClose,
}) => {
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const el = audioElRef.current;
    if (!video || !el) return;

    let cancelled = false;
    setErrorMsg(null);
    setIsLoading(true);
    setCurrentTime(0);
    setDuration(video.durationMs > 0 ? video.durationMs / 1000 : 0);

    const startPlayback = async () => {
      try {
        let playableUrl = video.webUrl || '';
        if (!playableUrl && isNativeAndroid()) {
          const prepared = await AudioLibrary.prepareMediaFile({
            uri: video.uri,
            displayName: video.displayName || video.title,
            mediaKind: 'video',
          });
          playableUrl = resolvePlayableAudioUrl(prepared);
        }
        if (cancelled) return;
        if (!playableUrl) throw new Error('Audio stream unavailable');

        onPlaybackStarted();
        el.src = playableUrl;
        el.playbackRate = speed;
        el.load();
        await el.play();
        if (!cancelled) {
          setIsPlaying(true);
        }
      } catch (err) {
        if (!cancelled) {
          setIsPlaying(false);
          setErrorMsg(err instanceof Error ? err.message : 'Could not play audio');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void startPlayback();

    return () => {
      cancelled = true;
      el.pause();
    };
    // Start when target video changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id, video?.uri]);

  useEffect(() => {
    const el = audioElRef.current;
    if (!el || pauseSignal === 0) return;
    el.pause();
    setIsPlaying(false);
  }, [pauseSignal]);

  if (!video) return null;

  const togglePlay = async () => {
    const el = audioElRef.current;
    if (!el) return;
    if (el.paused) {
      onPlaybackStarted();
      try {
        await el.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    } else {
      el.pause();
      setIsPlaying(false);
    }
  };

  const seekRel = (delta: number) => {
    const el = audioElRef.current;
    if (!el) return;
    const maxD = isFinite(el.duration) && el.duration > 0 ? el.duration : duration;
    const next = Math.max(0, Math.min(maxD || 0, el.currentTime + delta));
    el.currentTime = next;
    setCurrentTime(next);
  };

  const cycleSpeed = () => {
    const next =
      AUDIO_MODE_SPEEDS[(AUDIO_MODE_SPEEDS.indexOf(speed) + 1) % AUDIO_MODE_SPEEDS.length];
    setSpeed(next);
    if (audioElRef.current) {
      audioElRef.current.playbackRate = next;
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-emerald-500/40 rounded-2xl p-3 sm:p-4 shadow-lg space-y-2.5">
      <audio
        ref={audioElRef}
        onLoadedMetadata={() => {
          const el = audioElRef.current;
          if (el && isFinite(el.duration) && el.duration > 0) {
            setDuration(el.duration);
          }
        }}
        onTimeUpdate={() => {
          const el = audioElRef.current;
          if (el) setCurrentTime(el.currentTime);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-11 h-9 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 overflow-hidden flex items-center justify-center shrink-0">
            {thumbUrl ? (
              <img
                src={thumbUrl}
                alt={video.title || video.displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <Video className="w-4 h-4 text-slate-400" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Headphones className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Playing as Audio
              </span>
            </div>
            <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
              {video.title || video.displayName}
            </h4>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              audioElRef.current?.pause();
              setIsPlaying(false);
              onClose();
              onOpenAsVideo(video);
            }}
            className="min-h-[32px] px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1 cursor-pointer"
            title="Switch to video view"
          >
            <Maximize2 className="w-3 h-3" />
            <span className="hidden sm:inline">Video</span>
          </button>
          <button
            type="button"
            onClick={() => {
              audioElRef.current?.pause();
              setIsPlaying(false);
              onClose();
            }}
            className="min-w-[32px] min-h-[32px] rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center cursor-pointer"
            aria-label="Close audio playback"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {errorMsg && (
        <p className="text-[11px] text-red-600 dark:text-red-400 font-medium">{errorMsg}</p>
      )}

      <div className="space-y-1">
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0.1)}
          step={0.1}
          value={Math.min(currentTime, Math.max(duration, 0.1))}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (audioElRef.current) audioElRef.current.currentTime = next;
            setCurrentTime(next);
          }}
          className="w-full accent-emerald-500 cursor-pointer"
        />
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400">
          <span>{formatClock(currentTime)}</span>
          <span>{formatClock(duration)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={cycleSpeed}
          className="min-h-[34px] px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
        >
          {speed}x
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => seekRel(-10)}
            className="min-w-[38px] min-h-[38px] rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
            title="Rewind 10s"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => void togglePlay()}
            className="min-w-[44px] min-h-[44px] rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white dark:text-slate-950 flex items-center justify-center cursor-pointer shadow-sm"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-current" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-0.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => seekRel(10)}
            className="min-w-[38px] min-h-[38px] rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
            title="Forward 10s"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        </div>

        <div className="w-10" />
      </div>
    </div>
  );
};
