import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLibrary,
  AudioTrackItem,
  ImageTrackItem,
  VideoTrackItem,
  isNativeAndroid,
  resolvePlayableAudioUrl,
  saveExportedVideoBlob,
} from '../plugins/audioLibrary';
import { AudioArtwork } from './AudioArtwork';
import {
  Video,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Search,
  RefreshCw,
  FolderPlus,
  ShieldAlert,
  Expand,
  Shrink,
  Scissors,
  SplitSquareHorizontal,
  Trash2,
  Undo2,
  Redo2,
  Check,
  AlertCircle,
  X,
  Plus,
  Music,
  Type,
  Image as ImageIcon,
  Film,
  Upload,
  Layers,
  Crop,
  Heart,
  Eye,
  EyeOff,
  ListMusic,
  ListPlus,
  MoreVertical,
  Pencil,
  CheckCircle2,
} from 'lucide-react';
import {
  VideoActionSheetModal,
  VideoAddToPlaylistModal,
  VideoPlaylist,
  VideoPlaylistAddVideosModal,
} from './VideoLibraryOrganizationModals';
import {
  exportVideoSegmentsBlobLossless,
  splitVideoBlobLossless,
  trimVideoBlobLossless,
  triggerWebVideoDownload,
} from '../utils/losslessVideoTrim';
import {
  composeSplitTimelineBlob,
  computeTextAnimationState,
  resolveOverlayFontCss,
  TextAnimationType,
  TextEffectStyle,
  TextFontKey,
  TimelineOverlayComposeClip,
  TimelineTextOverlay,
  VideoCropRect,
} from '../utils/timelineComposer';

const DEFAULT_VIDEO_CROP: VideoCropRect = { left: 0, top: 0, right: 1, bottom: 1 };

type VideoLibraryFilterTab = 'all' | 'favorites' | 'playlists' | 'hidden';
type VideoPlaybackScope =
  | { type: 'all' }
  | { type: 'favorites' }
  | { type: 'hidden' }
  | { type: 'playlist'; playlistId: string };

const VIDEO_PLAYLISTS_STORAGE_KEY = 'movibe_video_playlists';
const VIDEO_FAVORITES_STORAGE_KEY = 'movibe_video_favorites';
const VIDEO_HIDDEN_STORAGE_KEY = 'movibe_video_hidden';

function readVideoJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

type CropAspectPreset = 'free' | '16:9' | '9:16' | '1:1' | '4:5';

const CROP_ASPECT_OPTIONS: Array<{ id: CropAspectPreset; label: string; ratio: number | null }> = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
];

function isMediaAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = 'name' in err ? String((err as { name?: unknown }).name) : '';
  const msg = 'message' in err ? String((err as { message?: unknown }).message) : '';
  return (
    name === 'AbortError' ||
    msg.includes('interrupted by a call to pause') ||
    msg.includes('interrupted by a new load request')
  );
}

function isCropModified(crop: VideoCropRect): boolean {
  return (
    crop.left > 0.005 ||
    crop.top > 0.005 ||
    crop.right < 0.995 ||
    crop.bottom < 0.995
  );
}

function normalizeDeg360(deg: number): number {
  const n = ((deg % 360) + 360) % 360;
  return Number(n.toFixed(1));
}

function snapCardinalDeg(deg: number): number {
  const n = normalizeDeg360(deg);
  for (const target of [0, 90, 180, 270, 360]) {
    if (Math.abs(n - target) <= 4) {
      return target === 360 ? 0 : target;
    }
  }
  return Math.round(n);
}

const TEXT_ANIMATION_OPTIONS: Array<{ id: TextAnimationType; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade In' },
  { id: 'pop', label: 'Pop' },
  { id: 'slide-up', label: 'Slide Up' },
  { id: 'slide-left', label: 'Slide In' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'typewriter', label: 'Typewriter' },
  { id: 'pulse', label: 'Pulse' },
];

const TEXT_COLOR_PALETTE = [
  '#ffffff',
  '#111827',
  '#fde047',
  '#fb923c',
  '#ef4444',
  '#ec4899',
  '#a855f7',
  '#38bdf8',
  '#34d399',
  '#84cc16',
] as const;

const TEXT_BG_PALETTE = [
  '#ffffff',
  '#111827',
  '#fde047',
  '#ef4444',
  '#ec4899',
  '#7c3aed',
  '#2563eb',
  '#10b981',
] as const;

const TEXT_FONT_OPTIONS: Array<{ id: TextFontKey; label: string }> = [
  { id: 'sans', label: 'Modern' },
  { id: 'serif', label: 'Editorial' },
  { id: 'mono', label: 'Typewriter' },
  { id: 'display', label: 'Impact' },
  { id: 'handwriting', label: 'Script' },
  { id: 'condensed', label: 'Classic' },
];

const TEXT_STYLE_OPTIONS: Array<{ id: TextEffectStyle; label: string }> = [
  { id: 'clean', label: 'Clean' },
  { id: 'outline', label: 'Outline' },
  { id: 'shadow', label: 'Shadow' },
  { id: 'glow', label: 'Glow' },
  { id: 'uppercase', label: 'ALL CAPS' },
];

const TEXT_TEMPLATE_OPTIONS: Array<{
  id: string;
  label: string;
  color: string;
  bgStyle: 'none' | 'solid' | 'dark';
  bgColor?: string;
  fontFamily: TextFontKey;
  textStyle: TextEffectStyle;
  fontSize: 20 | 26 | 34;
}> = [
  {
    id: 'classic-bold',
    label: 'Classic',
    color: '#ffffff',
    bgStyle: 'none',
    fontFamily: 'sans',
    textStyle: 'outline',
    fontSize: 26,
  },
  {
    id: 'subtitle-box',
    label: 'Subtitle',
    color: '#ffffff',
    bgStyle: 'dark',
    bgColor: '#111827',
    fontFamily: 'sans',
    textStyle: 'clean',
    fontSize: 20,
  },
  {
    id: 'headline-pill',
    label: 'Headline',
    color: '#111827',
    bgStyle: 'solid',
    bgColor: '#ffffff',
    fontFamily: 'display',
    textStyle: 'uppercase',
    fontSize: 34,
  },
  {
    id: 'yellow-cinema',
    label: 'Cinema',
    color: '#fde047',
    bgStyle: 'none',
    fontFamily: 'serif',
    textStyle: 'shadow',
    fontSize: 26,
  },
  {
    id: 'neon-pulse',
    label: 'Neon',
    color: '#38bdf8',
    bgStyle: 'none',
    fontFamily: 'sans',
    textStyle: 'glow',
    fontSize: 34,
  },
  {
    id: 'rose-lyric',
    label: 'Lyric',
    color: '#ffffff',
    bgStyle: 'dark',
    bgColor: '#ec4899',
    fontFamily: 'handwriting',
    textStyle: 'shadow',
    fontSize: 26,
  },
  {
    id: 'mono-tag',
    label: 'Caption',
    color: '#34d399',
    bgStyle: 'dark',
    bgColor: '#111827',
    fontFamily: 'mono',
    textStyle: 'clean',
    fontSize: 20,
  },
  {
    id: 'alert-banner',
    label: 'Highlight',
    color: '#ffffff',
    bgStyle: 'dark',
    bgColor: '#ef4444',
    fontFamily: 'display',
    textStyle: 'uppercase',
    fontSize: 26,
  },
];

function resolveTextEffectShadow(
  effect: TextEffectStyle | undefined,
  textColor: string,
  hasBg: boolean
): string {
  switch (effect) {
    case 'outline':
      return 'rgb(0, 0, 0) -1.5px -1.5px 0px, rgb(0, 0, 0) 1.5px -1.5px 0px, rgb(0, 0, 0) -1.5px 1.5px 0px, rgb(0, 0, 0) 1.5px 1.5px 0px, 0 2px 5px rgba(0, 0, 0, 0.85)';
    case 'glow':
      return `0 0 10px ${textColor}, 0 0 22px ${textColor}`;
    case 'shadow':
      return '0 4px 10px rgba(0, 0, 0, 0.92), 0 1px 3px rgba(0, 0, 0, 0.9)';
    case 'uppercase':
    case 'clean':
    default:
      return hasBg
        ? 'none'
        : '0 2px 6px rgba(0, 0, 0, 0.92), 0 0 2px rgba(0, 0, 0, 0.9)';
  }
}

interface StandaloneVideoPlayerProps {
  isActiveTab: boolean;
  pauseSignal: number;
  onPlaybackStarted: () => void;
  externalVideoRequest?: { requestId: string; video: VideoTrackItem } | null;
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = Math.floor(sec % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatTimePadded(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '00:00';
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = Math.floor(sec % 60);
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatPreciseTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00.0';
  const tenths = Math.floor((sec % 1) * 10);
  return `${formatTime(Math.floor(sec))}.${tenths}`;
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function formatQualityLabel(resolution: string): string {
  if (!resolution) return '';
  const parts = resolution.split(/[x×]/i).map((p) => parseInt(p.trim(), 10));
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return '';
  const shortSide = Math.min(parts[0], parts[1]);
  if (shortSide >= 2160) return '4K';
  if (shortSide >= 1440) return '1440p';
  if (shortSide >= 1080) return '1080p';
  if (shortSide >= 720) return '720p';
  if (shortSide >= 480) return '480p';
  return 'SD';
}

const videoThumbnailCache = new Map<string, string>();
let activeThumbJobs = 0;
const thumbWaitQueue: Array<() => void> = [];

async function withThumbnailSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeThumbJobs >= 3) {
    await new Promise<void>((resolve) => thumbWaitQueue.push(resolve));
  }
  activeThumbJobs++;
  try {
    return await task();
  } finally {
    activeThumbJobs--;
    const next = thumbWaitQueue.shift();
    if (next) next();
  }
}

function extractWebVideoThumbnail(srcUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const tempVideo = document.createElement('video');
    tempVideo.muted = true;
    tempVideo.playsInline = true;
    tempVideo.preload = 'metadata';

    let settled = false;
    const finish = (dataUrl: string) => {
      if (settled) return;
      settled = true;
      tempVideo.removeAttribute('src');
      tempVideo.load();
      resolve(dataUrl);
    };

    const timer = window.setTimeout(() => finish(''), 5000);

    tempVideo.onloadedmetadata = () => {
      const targetTime =
        isFinite(tempVideo.duration) && tempVideo.duration > 1 ? Math.min(1.0, tempVideo.duration * 0.15) : 0;
      if (targetTime > 0) {
        tempVideo.currentTime = targetTime;
      } else {
        // Trigger frame capture cleanly on loadeddata
      }
    };

    const captureFrame = () => {
      window.clearTimeout(timer);
      try {
        const vw = tempVideo.videoWidth || 320;
        const vh = tempVideo.videoHeight || 180;
        const scale = Math.min(1, 360 / Math.max(vw, vh));
        const cw = Math.max(1, Math.round(vw * scale));
        const ch = Math.max(1, Math.round(vh * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(tempVideo, 0, 0, cw, ch);
          finish(canvas.toDataURL('image/jpeg', 0.78));
          return;
        }
      } catch {
        // ignore canvas capture errors
      }
      finish('');
    };

    tempVideo.onseeked = captureFrame;
    tempVideo.onloadeddata = () => {
      if (!isFinite(tempVideo.duration) || tempVideo.duration <= 1) {
        captureFrame();
      }
    };
    tempVideo.onerror = () => {
      window.clearTimeout(timer);
      finish('');
    };

    tempVideo.src = srcUrl;
  });
}

interface VideoThumbnailCardProps {
  video: VideoTrackItem;
  isSelected: boolean;
  isFavorite?: boolean;
  isHidden?: boolean;
  onSelect: (video: VideoTrackItem) => void;
  onOpenMenu?: (video: VideoTrackItem) => void;
  onUnhide?: (video: VideoTrackItem) => void;
}

const VideoThumbnailCard: React.FC<VideoThumbnailCardProps> = ({
  video,
  isSelected,
  isFavorite,
  isHidden,
  onSelect,
  onOpenMenu,
  onUnhide,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string>(
    () => video.thumbnailUrl || videoThumbnailCache.get(video.id) || ''
  );
  const [hasFailed, setHasFailed] = useState<boolean>(false);

  useEffect(() => {
    const cached = video.thumbnailUrl || videoThumbnailCache.get(video.id);
    if (cached) {
      setThumbUrl(cached);
      return;
    }

    const node = cardRef.current;
    if (!node) return;

    let cancelled = false;
    const loadThumb = async () => {
      const url = await withThumbnailSlot(async () => {
        if (cancelled) return '';
        if (video.webUrl) {
          return await extractWebVideoThumbnail(video.webUrl);
        }
        if (isNativeAndroid()) {
          try {
            const res = await AudioLibrary.getVideoThumbnail({
              id: video.id,
              uri: video.uri,
            });
            return res.filePath ? resolvePlayableAudioUrl(res) : res.localUrl || '';
          } catch {
            return '';
          }
        }
        return '';
      });

      if (!cancelled && url) {
        videoThumbnailCache.set(video.id, url);
        setThumbUrl(url);
      }
    };

    if (typeof IntersectionObserver === 'undefined') {
      void loadThumb();
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          void loadThumb();
        }
      },
      { rootMargin: '220px' }
    );

    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [video.id, video.uri, video.webUrl, video.thumbnailUrl]);

  const qualityLabel = formatQualityLabel(video.resolution);
  const durationLabel = video.durationMs > 0 ? formatTime(video.durationMs / 1000) : '';
  const sizeLabel = formatSize(video.size);

  return (
    <div
      ref={cardRef}
      className={`group relative flex flex-col gap-1.5 min-w-0 rounded-xl p-1.5 transition-colors ${
        isSelected ? 'bg-emerald-500/10' : 'hover:bg-slate-100 dark:hover:bg-slate-800/50'
      }`}
    >
      <div
        className={`relative w-full aspect-video rounded-xl overflow-hidden bg-slate-200 dark:bg-slate-950 border ${
          isSelected
            ? 'border-emerald-500 dark:border-emerald-400 ring-1 ring-emerald-500/60 dark:ring-emerald-400/60'
            : 'border-slate-200 group-hover:border-slate-300 dark:border-slate-800 dark:group-hover:border-slate-700'
        }`}
      >
        <button
          type="button"
          onClick={() => onSelect(video)}
          className="w-full h-full block cursor-pointer text-left"
          aria-label={`Play ${video.title || video.displayName}`}
        >
          {thumbUrl && !hasFailed ? (
            <img
              src={thumbUrl}
              alt={video.title || video.displayName}
              referrerPolicy="no-referrer"
              onError={() => setHasFailed(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-900 dark:to-slate-950">
              <Video className="w-7 h-7 text-slate-400 dark:text-slate-700" />
            </div>
          )}
        </button>

        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/35 pointer-events-none" />

        {qualityLabel && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-mono font-bold text-white leading-none pointer-events-none">
            {qualityLabel}
          </span>
        )}

        {onOpenMenu && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenMenu(video);
            }}
            className="absolute top-1 right-1 w-7 h-7 rounded-lg bg-black/55 hover:bg-black/80 text-white flex items-center justify-center cursor-pointer transition-colors"
            title="Video options"
            aria-label={`Options for ${video.title || video.displayName}`}
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        )}

        {isFavorite && (
          <span className="absolute bottom-1.5 left-1.5 w-5 h-5 rounded-full bg-black/65 flex items-center justify-center pointer-events-none">
            <Heart className="w-3 h-3 text-rose-500 fill-rose-500" />
          </span>
        )}

        {durationLabel && (
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-mono font-semibold tabular-nums text-white leading-none pointer-events-none">
            {durationLabel}
          </span>
        )}
      </div>

      <div className="flex items-start justify-between gap-1.5 min-w-0 px-0.5">
        <button
          type="button"
          onClick={() => onSelect(video)}
          className="min-w-0 flex-1 text-left cursor-pointer"
        >
          <p
            className={`text-xs sm:text-sm font-semibold truncate ${
              isSelected ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {video.title || video.displayName}
          </p>
          <p className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400 truncate">
            {sizeLabel || video.displayName}
          </p>
        </button>

        {isHidden && onUnhide && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUnhide(video);
            }}
            className="px-2 py-1 rounded-lg bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer shrink-0"
            title="Unhide video"
          >
            <Eye className="w-3 h-3" />
            <span>Unhide</span>
          </button>
        )}
      </div>
    </div>
  );
};

const imageThumbnailCache = new Map<string, string>();

interface ImageThumbnailCardProps {
  image: ImageTrackItem;
  onSelect: (image: ImageTrackItem) => void;
}

const ImageThumbnailCard: React.FC<ImageThumbnailCardProps> = ({ image, onSelect }) => {
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string>(
    () => image.thumbnailUrl || image.webUrl || imageThumbnailCache.get(image.id) || ''
  );
  const [hasFailed, setHasFailed] = useState<boolean>(false);

  useEffect(() => {
    const cached = image.thumbnailUrl || image.webUrl || imageThumbnailCache.get(image.id);
    if (cached) {
      setThumbUrl(cached);
      return;
    }

    const node = cardRef.current;
    if (!node || !isNativeAndroid()) return;

    let cancelled = false;
    const loadThumb = async () => {
      const url = await withThumbnailSlot(async () => {
        if (cancelled) return '';
        try {
          const res = await AudioLibrary.getImageThumbnail({
            id: image.id,
            uri: image.uri,
          });
          return res.filePath ? resolvePlayableAudioUrl(res) : res.localUrl || '';
        } catch {
          return '';
        }
      });
      if (!cancelled && url) {
        imageThumbnailCache.set(image.id, url);
        setThumbUrl(url);
      }
    };

    if (typeof IntersectionObserver === 'undefined') {
      void loadThumb();
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          void loadThumb();
        }
      },
      { rootMargin: '220px' }
    );
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [image.id, image.uri, image.webUrl, image.thumbnailUrl]);

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={() => onSelect(image)}
      className="group text-left flex flex-col gap-1 min-w-0 cursor-pointer rounded-xl p-1 hover:bg-white/10 transition-colors"
    >
      <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-slate-900 border border-white/15 group-hover:border-emerald-400/60">
        {thumbUrl && !hasFailed ? (
          <img
            src={thumbUrl}
            alt={image.title || image.displayName}
            referrerPolicy="no-referrer"
            onError={() => setHasFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-slate-900">
            <ImageIcon className="w-6 h-6 text-slate-600" />
          </div>
        )}
      </div>
      <p className="text-[11px] font-medium text-slate-200 truncate px-0.5">
        {image.title || image.displayName}
      </p>
    </button>
  );
};

function readVideoDurationFromUrl(srcUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.muted = true;
    el.playsInline = true;
    const timer = window.setTimeout(() => {
      el.removeAttribute('src');
      el.load();
      resolve(5);
    }, 5000);
    el.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const dur = isFinite(el.duration) && el.duration > 0 ? el.duration : 5;
      el.removeAttribute('src');
      el.load();
      resolve(dur);
    };
    el.onerror = () => {
      window.clearTimeout(timer);
      el.removeAttribute('src');
      el.load();
      resolve(5);
    };
    el.src = srcUrl;
  });
}

function readAudioDurationFromUrl(srcUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement('audio');
    el.preload = 'metadata';
    const timer = window.setTimeout(() => {
      el.removeAttribute('src');
      el.load();
      resolve(30);
    }, 5000);
    el.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const dur = isFinite(el.duration) && el.duration > 0 ? el.duration : 30;
      el.removeAttribute('src');
      el.load();
      resolve(Math.max(0.5, Number(dur.toFixed(2))));
    };
    el.onerror = () => {
      window.clearTimeout(timer);
      el.removeAttribute('src');
      el.load();
      resolve(30);
    };
    el.src = srcUrl;
  });
}

const PLAYBACK_SPEEDS = [0.5, 1, 1.25, 1.5, 2];

export const StandaloneVideoPlayer: React.FC<StandaloneVideoPlayerProps> = ({
  isActiveTab,
  pauseSignal,
  onPlaybackStarted,
  externalVideoRequest,
}) => {
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const webFileInputRef = useRef<HTMLInputElement | null>(null);
  const webObjectUrlsRef = useRef<string[]>([]);
  const hasAutoLoadedRef = useRef<boolean>(false);
  const lastExternalRequestIdRef = useRef<string | null>(null);
  const hideControlsTimerRef = useRef<number | null>(null);

  const [videos, setVideos] = useState<VideoTrackItem[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [videoLibraryFilter, setVideoLibraryFilter] = useState<VideoLibraryFilterTab>('all');
  const [selectedVideoPlaylistId, setSelectedVideoPlaylistId] = useState<string | null>(null);
  const [videoPlaybackScope, setVideoPlaybackScope] = useState<VideoPlaybackScope>({ type: 'all' });
  const videoPlaybackScopeRef = useRef<VideoPlaybackScope>({ type: 'all' });
  const [isCreateVideoPlaylistOpen, setIsCreateVideoPlaylistOpen] = useState<boolean>(false);
  const [newVideoPlaylistNameInput, setNewVideoPlaylistNameInput] = useState<string>('');
  const [addVideosModalPlaylistId, setAddVideosModalPlaylistId] = useState<string | null>(null);
  const [renamingVideoPlaylistId, setRenamingVideoPlaylistId] = useState<string | null>(null);
  const [renamingVideoPlaylistDraft, setRenamingVideoPlaylistDraft] = useState<string>('');
  const [videoPlaylists, setVideoPlaylists] = useState<VideoPlaylist[]>(() =>
    readVideoJsonStorage<VideoPlaylist[]>(VIDEO_PLAYLISTS_STORAGE_KEY, [])
  );
  const [videoFavoriteIds, setVideoFavoriteIds] = useState<string[]>(() =>
    readVideoJsonStorage<string[]>(VIDEO_FAVORITES_STORAGE_KEY, [])
  );
  const [videoHiddenIds, setVideoHiddenIds] = useState<string[]>(() =>
    readVideoJsonStorage<string[]>(VIDEO_HIDDEN_STORAGE_KEY, [])
  );
  const [menuVideo, setMenuVideo] = useState<VideoTrackItem | null>(null);
  const [playlistModalVideo, setPlaylistModalVideo] = useState<VideoTrackItem | null>(null);
  const [videoToast, setVideoToast] = useState<string | null>(null);
  const videoToastTimerRef = useRef<number | null>(null);

  const showVideoToast = (msg: string, durationMs = 3200) => {
    setVideoToast(msg);
    if (videoToastTimerRef.current !== null) {
      window.clearTimeout(videoToastTimerRef.current);
    }
    videoToastTimerRef.current = window.setTimeout(() => {
      setVideoToast(null);
      videoToastTimerRef.current = null;
    }, durationMs);
  };

  useEffect(() => {
    try {
      localStorage.setItem(VIDEO_PLAYLISTS_STORAGE_KEY, JSON.stringify(videoPlaylists));
    } catch {
      // ignore quota errors
    }
  }, [videoPlaylists]);

  useEffect(() => {
    try {
      localStorage.setItem(VIDEO_FAVORITES_STORAGE_KEY, JSON.stringify(videoFavoriteIds));
    } catch {
      // ignore
    }
  }, [videoFavoriteIds]);

  useEffect(() => {
    try {
      localStorage.setItem(VIDEO_HIDDEN_STORAGE_KEY, JSON.stringify(videoHiddenIds));
    } catch {
      // ignore
    }
  }, [videoHiddenIds]);

  const [isLoadingLibrary, setIsLoadingLibrary] = useState<boolean>(false);
  const [permissionDenied, setPermissionDenied] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [currentVideo, setCurrentVideo] = useState<VideoTrackItem | null>(null);
  const [isPlayerOpen, setIsPlayerOpen] = useState<boolean>(false);
  const [isLoadingVideo, setIsLoadingVideo] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [showControls, setShowControls] = useState<boolean>(true);
  const [isOsFullscreen, setIsOsFullscreen] = useState<boolean>(false);

  // Lossless Trim & TikTok-style Multi-Clip Split/Remove editor state
  interface TimelineClipSegment {
    id: string;
    mediaType: 'video' | 'image';
    title: string;
    sourceUrl: string;
    sourceUri: string;
    sourceDisplayName: string;
    thumbnailUrl?: string;
    sourceStart: number;
    sourceEnd: number;
    maxSourceDuration: number;
    removed: boolean;
  }

  interface MappedSplitSegment extends TimelineClipSegment {
    globalStart: number;
    globalEnd: number;
  }

  interface SplitCustomAudio {
    id: string;
    title: string;
    displayName: string;
    url: string;
  }

  const splitAudioRef = useRef<HTMLAudioElement | null>(null);
  const splitAudioUploadInputRef = useRef<HTMLInputElement | null>(null);
  const splitAddVideoInputRef = useRef<HTMLInputElement | null>(null);
  const splitAddImageInputRef = useRef<HTMLInputElement | null>(null);
  const splitOverlayVideoInputRef = useRef<HTMLInputElement | null>(null);
  const splitOverlayImageInputRef = useRef<HTMLInputElement | null>(null);
  const overlayVideoElsRef = useRef<Record<string, HTMLVideoElement | null>>({});
  const overlayLastSeekMsRef = useRef<Record<string, number>>({});
  const overlayWasVisibleRef = useRef<Record<string, boolean>>({});
  const overlayPlayInFlightRef = useRef<Record<string, boolean>>({});
  const overlayPrewarmedRef = useRef<Record<string, boolean>>({});
  const audioLastSeekMsRef = useRef<number>(0);
  const overlayBoxRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const overlayPinchRef = useRef<{
    id: string;
    startDist: number;
    startAngle: number;
    origScale: number;
    origRotation: number;
    snapshot: TimelineOverlayItem[];
  } | null>(null);
  const splitFitContainerRef = useRef<HTMLDivElement | null>(null);
  const mediaFrameRef = useRef<HTMLDivElement | null>(null);
  const standbyVideoRef = useRef<HTMLVideoElement | null>(null);
  const mainVideoUrlRef = useRef<string>('');
  const activeSplitDeckRef = useRef<'A' | 'B'>('A');
  const [activeSplitDeck, setActiveSplitDeck] = useState<'A' | 'B'>('A');
  const deckUrlsRef = useRef<{ A: string; B: string }>({ A: '', B: '' });
  const pendingDeckSeekRef = useRef<{
    A: { sourceUrl: string; sourceTime: number; autoPlay: boolean; awaitingMetadata?: boolean } | null;
    B: { sourceUrl: string; sourceTime: number; autoPlay: boolean; awaitingMetadata?: boolean } | null;
  }>({ A: null, B: null });
  const deckPlayInFlightRef = useRef<{ A: boolean; B: boolean }>({ A: false, B: false });
  const seekStuckSinceMsRef = useRef<{ A: number; B: number }>({ A: 0, B: 0 });
  const standbyPreloadRef = useRef<{
    deck: 'A' | 'B';
    sourceUrl: string;
    sourceTime: number;
    ready: boolean;
  } | null>(null);
  const lastProgrammaticScrollLeftRef = useRef<number>(-1);
  const scrollSyncUnlockAtMsRef = useRef<number>(0);
  const splitLastRafMsRef = useRef<number>(0);

  interface TimelineAudioSegment {
    id: string;
    title: string;
    displayName: string;
    sourceUrl: string;
    sourceStart: number;
    sourceEnd: number;
    maxSourceDuration: number;
  }

  interface MappedAudioSegment extends TimelineAudioSegment {
    globalStart: number;
    globalEnd: number;
  }

  interface TimelineOverlayItem extends TimelineOverlayComposeClip {
    title: string;
    sourceUri?: string;
    thumbnailUrl?: string;
    maxSourceDuration: number;
  }

  interface SplitHistorySnapshot {
    video: TimelineClipSegment[];
    audio: TimelineAudioSegment[];
    text: TimelineTextOverlay[];
    overlays: TimelineOverlayItem[];
    crop?: VideoCropRect;
  }

  const [editMode, setEditMode] = useState<'none' | 'trim' | 'split'>('none');
  const [trimStart, setTrimStart] = useState<number>(0);
  const [trimEnd, setTrimEnd] = useState<number>(0);
  const [splitSegments, setSplitSegments] = useState<TimelineClipSegment[]>([]);
  const [selectedSplitSegId, setSelectedSplitSegId] = useState<string | null>(null);
  const [splitAudioSegments, setSplitAudioSegments] = useState<TimelineAudioSegment[]>([]);
  const [selectedAudioSegId, setSelectedAudioSegId] = useState<string | null>(null);
  const [splitOverlays, setSplitOverlays] = useState<TimelineOverlayItem[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [selectedTrackType, setSelectedTrackType] = useState<'none' | 'video' | 'audio' | 'text' | 'overlay'>('none');
  const clearTimelineSelection = () => {
    setSelectedTrackType('none');
    setSelectedSplitSegId(null);
    setSelectedAudioSegId(null);
    setSelectedTextId(null);
    setSelectedOverlayId(null);
  };
  const [mainVideoCrop, setMainVideoCrop] = useState<VideoCropRect>(DEFAULT_VIDEO_CROP);
  const [isMainCropActive, setIsMainCropActive] = useState<boolean>(false);
  const [activeCropAspect, setActiveCropAspect] = useState<CropAspectPreset>('free');
  const cropSnapshotBeforeEditRef = useRef<VideoCropRect>(DEFAULT_VIDEO_CROP);
  const [splitStageSize, setSplitStageSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [mainMediaDims, setMainMediaDims] = useState<{ w: number; h: number }>({ w: 1280, h: 720 });
  const [activeOverlayGesture, setActiveOverlayGesture] = useState<{
    id: string;
    kind: 'rotate' | 'resize';
    valueLabel: string;
  } | null>(null);
  const [splitUndoStack, setSplitUndoStack] = useState<SplitHistorySnapshot[]>([]);
  const [splitRedoStack, setSplitRedoStack] = useState<SplitHistorySnapshot[]>([]);
  const [splitFramesBySource, setSplitFramesBySource] = useState<
    Record<string, Array<{ time: number; url: string }>>
  >({});
  const [extractingSources, setExtractingSources] = useState<Record<string, boolean>>({});
  const [activeTrimDrag, setActiveTrimDrag] = useState<{
    segId: string;
    side: 'left' | 'right';
    initialSourceStart: number;
    initialSourceEnd: number;
    liveSourceStart: number;
    liveSourceEnd: number;
    frozenPxPerSec: number;
  } | null>(null);
  const [activeAudioTrimDrag, setActiveAudioTrimDrag] = useState<{
    segId: string;
    side: 'left' | 'right';
    initialSourceStart: number;
    initialSourceEnd: number;
    liveSourceStart: number;
    liveSourceEnd: number;
    frozenPxPerSec: number;
  } | null>(null);
  const [activeTextTrimDrag, setActiveTextTrimDrag] = useState<{
    id: string;
    side: 'left' | 'right';
    initialStart: number;
    initialEnd: number;
    liveStart: number;
    liveEnd: number;
    frozenPxPerSec: number;
  } | null>(null);
  const [activeOverlayTrimDrag, setActiveOverlayTrimDrag] = useState<{
    id: string;
    side: 'left' | 'right';
    initialTimelineStart: number;
    initialSourceStart: number;
    initialSourceEnd: number;
    liveTimelineStart: number;
    liveSourceStart: number;
    liveSourceEnd: number;
    frozenPxPerSec: number;
  } | null>(null);
  const [activeOverlayMoveDrag, setActiveOverlayMoveDrag] = useState<{
    id: string;
    initialTimelineStart: number;
    liveTimelineStart: number;
    duration: number;
    frozenPxPerSec: number;
  } | null>(null);
  const [activeTextMoveDrag, setActiveTextMoveDrag] = useState<{
    id: string;
    initialStart: number;
    initialEnd: number;
    liveStart: number;
    liveEnd: number;
    frozenPxPerSec: number;
  } | null>(null);
  const [activeVideoMoveDrag, setActiveVideoMoveDrag] = useState<{
    segId: string;
    initialIndex: number;
    targetIndex: number;
    offsetX: number;
  } | null>(null);
  const lastActiveAudioSegIdRef = useRef<string | null>(null);
  const splitTimelineRef = useRef<HTMLDivElement | null>(null);
  const isSyncingTimelineScrollRef = useRef<boolean>(false);
  const isUserScrubbingTimelineRef = useRef<boolean>(false);

  // Replacement audio + Add Video/Add Image + Text Overlay states in Split studio
  const [splitCustomAudio, setSplitCustomAudio] = useState<SplitCustomAudio | null>(null);
  const [splitTextOverlays, setSplitTextOverlays] = useState<TimelineTextOverlay[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [isTextEditorOpen, setIsTextEditorOpen] = useState<boolean>(false);
  const [draftTextValue, setDraftTextValue] = useState<string>('');
  const [draftTextColor, setDraftTextColor] = useState<string>('#ffffff');
  const [draftTextBgStyle, setDraftTextBgStyle] = useState<'none' | 'solid' | 'dark'>('none');
  const [draftTextBgColor, setDraftTextBgColor] = useState<string | undefined>(undefined);
  const [draftTextFont, setDraftTextFont] = useState<TextFontKey>('sans');
  const [draftTextStyleEffect, setDraftTextStyleEffect] = useState<TextEffectStyle>('clean');
  const [draftTextAnimation, setDraftTextAnimation] = useState<TextAnimationType>('none');
  const [draftTextSize, setDraftTextSize] = useState<20 | 26 | 34>(26);
  const [draftTextTiming, setDraftTextTiming] = useState<'all' | '4s' | 'custom'>('all');
  const [draftTextRow, setDraftTextRow] = useState<number>(0);
  const [draftTextInsertStart, setDraftTextInsertStart] = useState<number | null>(null);
  const [activeTextSection, setActiveTextSection] = useState<
    'none' | 'color' | 'bg' | 'fonts' | 'styles' | 'templates' | 'animations'
  >('none');
  const [animPreviewElapsed, setAnimPreviewElapsed] = useState<number>(2);
  const [animPreviewTrigger, setAnimPreviewTrigger] = useState<number>(0);
  const [showAddMediaMenu, setShowAddMediaMenu] = useState<boolean>(false);
  const [activeSplitPicker, setActiveSplitPicker] = useState<'none' | 'audio' | 'video' | 'image' | 'overlay'>('none');
  const [overlayPickerTab, setOverlayPickerTab] = useState<'video' | 'image'>('video');
  const [deviceSongs, setDeviceSongs] = useState<AudioTrackItem[]>([]);
  const [isLoadingAudioPicker, setIsLoadingAudioPicker] = useState<boolean>(false);
  const [audioPermissionDenied, setAudioPermissionDenied] = useState<boolean>(false);
  const [audioPickerSearch, setAudioPickerSearch] = useState<string>('');
  const [videoPickerSearch, setVideoPickerSearch] = useState<string>('');
  const [deviceImages, setDeviceImages] = useState<ImageTrackItem[]>([]);
  const [isLoadingImagePicker, setIsLoadingImagePicker] = useState<boolean>(false);
  const [imagePermissionDenied, setImagePermissionDenied] = useState<boolean>(false);
  const [imagePickerSearch, setImagePickerSearch] = useState<string>('');
  const [isPreparingSplitMedia, setIsPreparingSplitMedia] = useState<boolean>(false);
  const [exportProgressPct, setExportProgressPct] = useState<number | null>(null);

  const [isPreviewingTrim, setIsPreviewingTrim] = useState<boolean>(false);
  const [isMaskingTrimSeek, setIsMaskingTrimSeek] = useState<boolean>(false);
  const [isProcessingEdit, setIsProcessingEdit] = useState<boolean>(false);
  const [editStatusMessage, setEditStatusMessage] = useState<string | null>(null);
  const [editErrorMessage, setEditErrorMessage] = useState<string | null>(null);
  const [lastSavedClip, setLastSavedClip] = useState<VideoTrackItem | null>(null);

  const { mappedSplitSegments, totalSplitDuration } = useMemo(() => {
    let cursor = 0;
    const mapped: MappedSplitSegment[] = splitSegments.map((seg) => {
      const len = Math.max(0.1, seg.sourceEnd - seg.sourceStart);
      const item: MappedSplitSegment = {
        ...seg,
        globalStart: cursor,
        globalEnd: cursor + len,
      };
      cursor += len;
      return item;
    });
    return { mappedSplitSegments: mapped, totalSplitDuration: cursor };
  }, [splitSegments]);

  const { mappedAudioSegments, totalAudioDuration } = useMemo(() => {
    let cursor = 0;
    const mapped: MappedAudioSegment[] = splitAudioSegments.map((seg) => {
      const len = Math.max(0.1, seg.sourceEnd - seg.sourceStart);
      const item: MappedAudioSegment = {
        ...seg,
        globalStart: cursor,
        globalEnd: cursor + len,
      };
      cursor += len;
      return item;
    });
    return { mappedAudioSegments: mapped, totalAudioDuration: cursor };
  }, [splitAudioSegments]);

  const maxOverlayDuration = useMemo(
    () =>
      splitOverlays.reduce(
        (mx, ov) => Math.max(mx, ov.timelineStart + Math.max(0.1, ov.sourceEnd - ov.sourceStart)),
        0
      ),
    [splitOverlays]
  );

  const maxSplitTimelineDuration = Math.max(
    totalSplitDuration,
    totalAudioDuration,
    maxOverlayDuration
  );
  const activeSplitDuration = editMode === 'split' ? totalSplitDuration : duration;

  const activeSplitSegAtPlayhead = useMemo(() => {
    if (editMode !== 'split' || mappedSplitSegments.length === 0) return null;
    return (
      mappedSplitSegments.find((s) => currentTime >= s.globalStart - 0.01 && currentTime < s.globalEnd) ||
      mappedSplitSegments[mappedSplitSegments.length - 1]
    );
  }, [editMode, mappedSplitSegments, currentTime]);

  const snapTimelinePosition = (rawSec: number, pxPerSec: number): number => {
    const safeRaw = Math.max(0, rawSec);
    const snapWindow = Math.max(0.14, 10 / Math.max(8, pxPerSec));
    const candidates: number[] = [0, trimBoundsRef.current.currentTime];
    for (const s of mappedSplitSegments) {
      candidates.push(s.globalStart, s.globalEnd);
    }
    let best = safeRaw;
    let bestDist = snapWindow;
    for (const target of candidates) {
      const dist = Math.abs(safeRaw - target);
      if (dist < bestDist) {
        bestDist = dist;
        best = target;
      }
    }
    return Math.max(0, Number(best.toFixed(2)));
  };

  const canExportSplitLossless = useMemo(() => {
    if (!currentVideo || editMode !== 'split') return true;
    const kept = splitSegments.filter((s) => !s.removed && s.sourceEnd - s.sourceStart > 0.1);
    if (
      kept.length === 0 ||
      splitCustomAudio ||
      splitAudioSegments.length > 0 ||
      isMuted ||
      splitTextOverlays.length > 0 ||
      splitOverlays.length > 0 ||
      isCropModified(mainVideoCrop)
    ) {
      return false;
    }
    return kept.every(
      (s) =>
        s.mediaType === 'video' &&
        (s.sourceUri === currentVideo.uri || s.sourceUrl === mainVideoUrlRef.current)
    );
  }, [
    currentVideo,
    editMode,
    splitSegments,
    splitCustomAudio,
    splitAudioSegments,
    isMuted,
    splitTextOverlays,
    splitOverlays,
    mainVideoCrop,
  ]);

  useEffect(() => {
    if (editMode !== 'split') return;
    const el = splitFitContainerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSplitStageSize({ w: rect.width, h: rect.height });
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editMode]);

  const trimBoundsRef = useRef({
    editMode,
    isPlaying,
    trimStart,
    trimEnd,
    isPreviewingTrim,
    mappedSplitSegments,
    totalSplitDuration,
    mappedAudioSegments,
    totalAudioDuration,
    splitOverlays,
    maxOverlayDuration,
    selectedTrackType,
    currentTime,
    playbackSpeed,
    isMuted,
    splitCustomAudio,
  });
  trimBoundsRef.current = {
    editMode,
    isPlaying,
    trimStart,
    trimEnd,
    isPreviewingTrim,
    mappedSplitSegments,
    totalSplitDuration,
    mappedAudioSegments,
    totalAudioDuration,
    splitOverlays,
    maxOverlayDuration,
    selectedTrackType,
    currentTime,
    playbackSpeed,
    isMuted,
    splitCustomAudio,
  };

  // Dynamic pixel scale so short/medium clips match TikTok's crisp 1-second ruler and long videos stay smooth
  const splitPxPerSec = useMemo(() => {
    const dur = editMode === 'split' ? totalSplitDuration : duration;
    if (dur <= 0) return 44;
    if (dur <= 45) return 48;
    if (dur <= 150) return 30;
    if (dur <= 480) return 18;
    return Math.max(8, Math.min(16, 4800 / dur));
  }, [editMode, totalSplitDuration, duration]);

  const clearHideTimer = () => {
    if (hideControlsTimerRef.current !== null) {
      window.clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = null;
    }
  };

  const scheduleHideControls = () => {
    clearHideTimer();
    hideControlsTimerRef.current = window.setTimeout(() => {
      setShowControls(false);
    }, 3500);
  };

  const getDeckEl = (deck: 'A' | 'B'): HTMLVideoElement | null =>
    deck === 'A' ? videoRef.current : standbyVideoRef.current;

  const getActiveSplitVideoEl = (): HTMLVideoElement | null =>
    getDeckEl(activeSplitDeckRef.current);

  const tryPlayDeckEl = (deck: 'A' | 'B', el: HTMLVideoElement | null) => {
    if (!el || !trimBoundsRef.current.isPlaying || activeSplitDeckRef.current !== deck) return;
    if (!el.paused || deckPlayInFlightRef.current[deck]) return;
    deckPlayInFlightRef.current[deck] = true;
    void el
      .play()
      .then(() => {
        if (!trimBoundsRef.current.isPlaying || activeSplitDeckRef.current !== deck) {
          el.pause();
        }
      })
      .catch((err: unknown) => {
        if (isMediaAbortError(err)) return;
        const name = (err as { name?: string })?.name;
        if (name === 'NotAllowedError' && trimBoundsRef.current.isPlaying && activeSplitDeckRef.current === deck) {
          // If Chrome blocks unmuted async play() after a seek, mute fallback keeps video & timeline running instead of stalling at 00:00
          el.muted = true;
          trimBoundsRef.current.isMuted = true;
          setIsMuted(true);
          void el
            .play()
            .then(() => {
              if (!trimBoundsRef.current.isPlaying || activeSplitDeckRef.current !== deck) {
                el.pause();
              }
            })
            .catch(() => {});
        }
      })
      .finally(() => {
        deckPlayInFlightRef.current[deck] = false;
      });
  };

  const pauseAllSplitVideos = () => {
    deckPlayInFlightRef.current = { A: false, B: false };
    seekStuckSinceMsRef.current = { A: 0, B: 0 };
    overlayPlayInFlightRef.current = {};
    if (videoRef.current) {
      videoRef.current.pause();
    }
    if (standbyVideoRef.current) {
      standbyVideoRef.current.pause();
    }
    if (splitAudioRef.current) {
      splitAudioRef.current.pause();
    }
    for (const ovEl of Object.values(overlayVideoElsRef.current)) {
      if (ovEl) {
        ovEl.pause();
      }
    }
  };

  const syncOverlaysToTime = (globalSec: number, shouldPlay: boolean, forceSync = false) => {
    const { splitOverlays: overlays, playbackSpeed: spd } = trimBoundsRef.current;
    if (!overlays || overlays.length === 0) return;
    const nowMs = performance.now();

    for (const ov of overlays) {
      if (ov.mediaType !== 'video') continue;
      const el = overlayVideoElsRef.current[ov.id];
      if (!el) continue;

      const ovDur = Math.max(0.1, ov.sourceEnd - ov.sourceStart);
      const ovEnd = ov.timelineStart + ovDur;
      const hasAdjacentPrev = overlays.some(
        (o) =>
          o.id !== ov.id &&
          o.mediaType === 'video' &&
          Math.abs(o.timelineStart + Math.max(0.1, o.sourceEnd - o.sourceStart) - ov.timelineStart) < 0.05
      );
      const hasAdjacentNext = overlays.some(
        (o) =>
          o.id !== ov.id &&
          o.mediaType === 'video' &&
          Math.abs(o.timelineStart - ovEnd) < 0.05
      );

      const isVisible =
        (hasAdjacentPrev ? globalSec >= ov.timelineStart : globalSec >= ov.timelineStart - 0.015) &&
        (hasAdjacentNext ? globalSec < ovEnd : globalSec < ovEnd - 0.01);

      if (!isVisible) {
        overlayWasVisibleRef.current[ov.id] = false;
        if (!el.paused) el.pause();

        // Pre-seek upcoming/inactive cut segments cleanly to their sourceStart while hidden
        // so transitions into cut 2+ are instant without decoder flush stalls.
        if (el.readyState >= 1 && !el.seeking && Math.abs(el.currentTime - ov.sourceStart) > 0.08) {
          const lastSeekMs = overlayLastSeekMsRef.current[ov.id] || 0;
          if (forceSync || nowMs - lastSeekMs >= 250) {
            overlayLastSeekMsRef.current[ov.id] = nowMs;
            el.currentTime = ov.sourceStart;
          }
        }

        // Synchronously pre-warm hidden cut video elements inside the user's Play tap so Chrome
        // Android / WebView grants playback activation before the playhead reaches cut 2+.
        if (
          forceSync &&
          shouldPlay &&
          !overlayPrewarmedRef.current[ov.id] &&
          !overlayPlayInFlightRef.current[ov.id]
        ) {
          overlayPrewarmedRef.current[ov.id] = true;
          overlayPlayInFlightRef.current[ov.id] = true;
          el.muted = true;
          void el
            .play()
            .then(() => {
              if (!overlayWasVisibleRef.current[ov.id] || !trimBoundsRef.current.isPlaying) {
                el.pause();
                if (el.readyState >= 1 && !el.seeking && Math.abs(el.currentTime - ov.sourceStart) > 0.08) {
                  el.currentTime = ov.sourceStart;
                }
              }
            })
            .catch(() => {
              overlayPrewarmedRef.current[ov.id] = false;
            })
            .finally(() => {
              overlayPlayInFlightRef.current[ov.id] = false;
            });
        }
        continue;
      }

      const wasVisible = Boolean(overlayWasVisibleRef.current[ov.id]);
      overlayWasVisibleRef.current[ov.id] = true;

      const wantMuted = Boolean(ov.muted);
      if (el.muted !== wantMuted) el.muted = wantMuted;
      if (Math.abs(el.playbackRate - spd) > 0.001) el.playbackRate = spd;

      const targetOffset = Math.max(
        ov.sourceStart,
        Math.min(ov.sourceEnd, ov.sourceStart + Math.max(0, globalSec - ov.timelineStart))
      );

      // Stop cleanly once this cut reaches its own sourceEnd boundary
      const reachedOvEnd =
        targetOffset >= ov.sourceEnd - 0.02 ||
        (shouldPlay && !el.seeking && el.readyState >= 2 && el.currentTime >= ov.sourceEnd - 0.015);
      if (reachedOvEnd) {
        if (!el.paused) el.pause();
        continue;
      }

      if (el.readyState >= 1 && !el.seeking && !overlayPlayInFlightRef.current[ov.id]) {
        const drift = Math.abs(el.currentTime - targetOffset);
        const lastSeekMs = overlayLastSeekMsRef.current[ov.id] || 0;
        const nearClipEnd = ov.sourceEnd - targetOffset <= 0.15;

        let shouldSeek = false;
        if (!shouldPlay) {
          shouldSeek = drift > 0.05 && (forceSync || nowMs - lastSeekMs >= 70);
        } else if (forceSync || !wasVisible) {
          shouldSeek = !nearClipEnd && drift > 0.14 && (forceSync || nowMs - lastSeekMs >= 200);
        } else {
          // During continuous playback, allow normal pipeline offset without flushing decoders
          // (which previously caused second-cut stuttering).
          shouldSeek = !nearClipEnd && drift > 0.85 && nowMs - lastSeekMs >= 1200;
        }

        if (shouldSeek) {
          overlayLastSeekMsRef.current[ov.id] = nowMs;
          el.currentTime = targetOffset;
        }
      }

      if (shouldPlay) {
        if (
          el.paused &&
          (!el.ended || forceSync) &&
          (!el.seeking || forceSync || !wasVisible) &&
          el.readyState >= (forceSync ? 1 : 2) &&
          !overlayPlayInFlightRef.current[ov.id] &&
          targetOffset < ov.sourceEnd - 0.03
        ) {
          overlayPlayInFlightRef.current[ov.id] = true;
          overlayPrewarmedRef.current[ov.id] = true;
          void el
            .play()
            .then(() => {
              if (!trimBoundsRef.current.isPlaying || !overlayWasVisibleRef.current[ov.id]) {
                el.pause();
              }
            })
            .catch((err: unknown) => {
              if (
                (err as { name?: string })?.name === 'NotAllowedError' &&
                trimBoundsRef.current.isPlaying &&
                overlayWasVisibleRef.current[ov.id]
              ) {
                el.muted = true;
                void el
                  .play()
                  .then(() => {
                    if (!trimBoundsRef.current.isPlaying || !overlayWasVisibleRef.current[ov.id]) {
                      el.pause();
                    }
                  })
                  .catch(() => {});
              }
            })
            .finally(() => {
              overlayPlayInFlightRef.current[ov.id] = false;
            });
        }
      } else {
        el.pause();
      }
    }
  };

  const syncCustomAudioToTime = (globalSec: number, shouldPlay: boolean, forceSync = false) => {
    const audioEl = splitAudioRef.current;
    const {
      mappedAudioSegments: audioSegs,
      splitCustomAudio: customAudio,
      playbackSpeed: spd,
    } = trimBoundsRef.current;
    if (!audioEl || !customAudio || audioSegs.length === 0) {
      lastActiveAudioSegIdRef.current = null;
      if (audioEl && !audioEl.paused) audioEl.pause();
      return;
    }

    const aSeg =
      audioSegs.find((s) => globalSec >= s.globalStart - 0.01 && globalSec < s.globalEnd - 0.01) ||
      null;
    if (!aSeg) {
      lastActiveAudioSegIdRef.current = null;
      if (!audioEl.paused) audioEl.pause();
      return;
    }

    const targetOffset = Math.max(
      aSeg.sourceStart,
      Math.min(aSeg.sourceEnd, aSeg.sourceStart + (globalSec - aSeg.globalStart))
    );
    const crossedCut = lastActiveAudioSegIdRef.current !== aSeg.id;
    lastActiveAudioSegIdRef.current = aSeg.id;

    const nowMs = performance.now();
    const drift = Math.abs(audioEl.currentTime - targetOffset);
    const driftThreshold = crossedCut || forceSync ? 0.12 : shouldPlay ? 0.55 : 0.05;
    if (
      !audioEl.seeking &&
      drift > driftThreshold &&
      (crossedCut || forceSync || !shouldPlay || nowMs - audioLastSeekMsRef.current >= 800)
    ) {
      audioLastSeekMsRef.current = nowMs;
      audioEl.currentTime = targetOffset;
    }
    if (Math.abs(audioEl.playbackRate - spd) > 0.001) audioEl.playbackRate = spd;
    if (audioEl.muted) audioEl.muted = false;
    if (shouldPlay && audioEl.paused && (!audioEl.seeking || forceSync)) {
      void audioEl
        .play()
        .then(() => {
          if (!trimBoundsRef.current.isPlaying) {
            audioEl.pause();
          }
        })
        .catch(() => {
          // ignore play interruption
        });
    } else if (!shouldPlay) {
      audioEl.pause();
    }
  };

  // Pre-buffer and pre-seek the next non-contiguous video clip onto the standby deck
  // so crossing a trimmed or cut boundary swaps decks in 0ms with no decode stall.
  const preloadUpcomingClip = (
    currentSeg: MappedSplitSegment | null,
    kept: MappedSplitSegment[]
  ) => {
    if (!currentSeg || kept.length === 0) return;
    const curIdx = kept.findIndex((s) => s.id === currentSeg.id);
    if (curIdx < 0) return;

    let targetSeg: MappedSplitSegment | null = null;
    let prevSeg: MappedSplitSegment = currentSeg;
    for (let i = curIdx + 1; i < kept.length; i++) {
      const cand = kept[i];
      if (cand.mediaType === 'video') {
        const isContiguousFromPrev =
          prevSeg.mediaType === 'video' &&
          cand.sourceUrl === prevSeg.sourceUrl &&
          Math.abs(cand.sourceStart - prevSeg.sourceEnd) < 0.06 &&
          Math.abs(cand.globalStart - prevSeg.globalEnd) < 0.06;
        if (!isContiguousFromPrev) {
          targetSeg = cand;
          break;
        }
      }
      prevSeg = cand;
    }

    if (!targetSeg) return;

    const standbyDeck: 'A' | 'B' = activeSplitDeckRef.current === 'A' ? 'B' : 'A';
    const sb = getDeckEl(standbyDeck);
    if (!sb) return;

    const existing = standbyPreloadRef.current;
    if (
      existing &&
      existing.deck === standbyDeck &&
      existing.sourceUrl === targetSeg.sourceUrl &&
      Math.abs(existing.sourceTime - targetSeg.sourceStart) < 0.03
    ) {
      return;
    }

    sb.muted = true;
    sb.playbackRate = trimBoundsRef.current.playbackSpeed;
    if (!sb.paused) {
      sb.pause();
    }

    if (deckUrlsRef.current[standbyDeck] !== targetSeg.sourceUrl) {
      deckUrlsRef.current[standbyDeck] = targetSeg.sourceUrl;
      pendingDeckSeekRef.current[standbyDeck] = {
        sourceUrl: targetSeg.sourceUrl,
        sourceTime: targetSeg.sourceStart,
        autoPlay: false,
        awaitingMetadata: true,
      };
      standbyPreloadRef.current = {
        deck: standbyDeck,
        sourceUrl: targetSeg.sourceUrl,
        sourceTime: targetSeg.sourceStart,
        ready: false,
      };
      sb.src = targetSeg.sourceUrl;
      sb.load();
    } else {
      pendingDeckSeekRef.current[standbyDeck] = null;
      const alreadyAtTarget =
        sb.readyState >= 2 && Math.abs(sb.currentTime - targetSeg.sourceStart) <= 0.03;
      standbyPreloadRef.current = {
        deck: standbyDeck,
        sourceUrl: targetSeg.sourceUrl,
        sourceTime: targetSeg.sourceStart,
        ready: alreadyAtTarget,
      };
      if (!alreadyAtTarget && sb.readyState >= 1) {
        sb.currentTime = targetSeg.sourceStart;
      } else if (!alreadyAtTarget && sb.readyState === 0) {
        pendingDeckSeekRef.current[standbyDeck] = {
          sourceUrl: targetSeg.sourceUrl,
          sourceTime: targetSeg.sourceStart,
          autoPlay: false,
          awaitingMetadata: true,
        };
      }
    }
  };

  const seekSplitTimelineTo = (globalTimeSec: number, autoPlay?: boolean) => {
    const {
      mappedSplitSegments: mapped,
      totalSplitDuration: totalDur,
      totalAudioDuration: totalAudDur,
      maxOverlayDuration: totalOvDur,
      isMuted: mutedNow,
      playbackSpeed: spd,
    } = trimBoundsRef.current;
    if (mapped.length === 0) return;

    const maxBound = Math.max(totalDur, totalAudDur, totalOvDur);
    const clamped = Math.max(0, Math.min(maxBound, globalTimeSec));
    setCurrentTime(clamped);
    trimBoundsRef.current.currentTime = clamped;

    if (autoPlay && splitTimelineRef.current && !isUserScrubbingTimelineRef.current) {
      const targetLeft = clamped * splitPxPerSec;
      lastProgrammaticScrollLeftRef.current = targetLeft;
      scrollSyncUnlockAtMsRef.current = performance.now() + 90;
      isSyncingTimelineScrollRef.current = true;
      splitTimelineRef.current.scrollLeft = targetLeft;
      window.requestAnimationFrame(() => {
        isSyncingTimelineScrollRef.current = false;
      });
    }

    const videoClamped = Math.max(0, Math.min(totalDur, clamped));
    const seg =
      mapped.find((s) => videoClamped >= s.globalStart - 0.005 && videoClamped < s.globalEnd) ||
      mapped[mapped.length - 1];
    const kept = mapped.filter((s) => !s.removed);

    const activeDeck = activeSplitDeckRef.current;
    const otherDeck: 'A' | 'B' = activeDeck === 'A' ? 'B' : 'A';
    const activeEl = getDeckEl(activeDeck);
    const otherEl = getDeckEl(otherDeck);

    if (clamped >= totalDur && totalAudDur > totalDur) {
      if (activeEl && !activeEl.paused) activeEl.pause();
      if (otherEl && !otherEl.paused) otherEl.pause();
    } else if (seg.mediaType === 'image') {
      if (activeEl && !activeEl.paused) activeEl.pause();
      if (otherEl && !otherEl.paused) otherEl.pause();
      preloadUpcomingClip(seg, kept);
    } else {
      const localSec = Math.max(
        seg.sourceStart,
        Math.min(seg.sourceEnd, seg.sourceStart + (videoClamped - seg.globalStart))
      );

      // If the standby deck already has this exact clip pre-seeked & decoded, swap to it cleanly!
      if (
        otherEl &&
        deckUrlsRef.current[otherDeck] === seg.sourceUrl &&
        otherEl.readyState >= 2 &&
        Math.abs(otherEl.currentTime - localSec) <= 0.12 &&
        (deckUrlsRef.current[activeDeck] !== seg.sourceUrl ||
          !activeEl ||
          Math.abs(activeEl.currentTime - localSec) > 0.12)
      ) {
        pendingDeckSeekRef.current[otherDeck] = null;
        if (otherEl.muted !== mutedNow) otherEl.muted = mutedNow;
        if (Math.abs(otherEl.playbackRate - spd) > 0.001) otherEl.playbackRate = spd;
        if (activeEl) {
          activeEl.muted = true;
          activeEl.pause();
        }
        activeSplitDeckRef.current = otherDeck;
        setActiveSplitDeck(otherDeck);
        if (autoPlay) {
          tryPlayDeckEl(otherDeck, otherEl);
        } else {
          otherEl.pause();
        }
        standbyPreloadRef.current = null;
        preloadUpcomingClip(seg, kept);
      } else if (activeEl) {
        if (otherEl) {
          otherEl.muted = true;
          otherEl.pause();
        }
        if (deckUrlsRef.current[activeDeck] !== seg.sourceUrl) {
          pendingDeckSeekRef.current[activeDeck] = {
            sourceUrl: seg.sourceUrl,
            sourceTime: localSec,
            autoPlay: Boolean(autoPlay),
            awaitingMetadata: true,
          };
          deckUrlsRef.current[activeDeck] = seg.sourceUrl;
          activeEl.src = seg.sourceUrl;
          activeEl.muted = mutedNow;
          activeEl.playbackRate = spd;
          activeEl.load();
          if (autoPlay) {
            tryPlayDeckEl(activeDeck, activeEl);
          }
        } else {
          const needsSeek = Math.abs(activeEl.currentTime - localSec) > 0.04;
          if (needsSeek && activeEl.readyState >= 1) {
            seekStuckSinceMsRef.current[activeDeck] = performance.now();
            activeEl.currentTime = localSec;
          }
          if (activeEl.muted !== mutedNow) activeEl.muted = mutedNow;
          if (Math.abs(activeEl.playbackRate - spd) > 0.001) activeEl.playbackRate = spd;

          if (autoPlay) {
            // Always initiate play() synchronously inside the user-gesture handler so Chrome Android
            // grants unmuted playback activation even when rewinding from end (needsSeek === true).
            tryPlayDeckEl(activeDeck, activeEl);
            if (activeEl.seeking || activeEl.readyState < 2) {
              pendingDeckSeekRef.current[activeDeck] = {
                sourceUrl: seg.sourceUrl,
                sourceTime: localSec,
                autoPlay: true,
                awaitingMetadata: activeEl.readyState === 0,
              };
            } else {
              pendingDeckSeekRef.current[activeDeck] = null;
            }
          } else {
            pendingDeckSeekRef.current[activeDeck] = null;
            activeEl.pause();
          }
        }
        preloadUpcomingClip(seg, kept);
      }
    }

    syncCustomAudioToTime(clamped, Boolean(autoPlay), true);
    syncOverlaysToTime(clamped, Boolean(autoPlay), true);
  };

  useEffect(() => {
    const onFsChange = () => {
      setIsOsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      clearHideTimer();
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
      if (standbyVideoRef.current) {
        standbyVideoRef.current.pause();
        standbyVideoRef.current.removeAttribute('src');
        standbyVideoRef.current.load();
      }
      if (splitAudioRef.current) {
        splitAudioRef.current.pause();
      }
      for (const url of webObjectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      webObjectUrlsRef.current = [];
    };
  }, []);

  // Auto-hide HUD while playing, always reveal HUD when paused or editing (Trim / Split)
  useEffect(() => {
    if (!isPlayerOpen) return;
    if (editMode !== 'none') {
      clearHideTimer();
      setShowControls(true);
      return;
    }
    if (isPlaying && showControls) {
      scheduleHideControls();
    } else if (!isPlaying) {
      clearHideTimer();
      setShowControls(true);
    }
    return () => clearHideTimer();
  }, [isPlayerOpen, isPlaying, showControls, editMode]);

  // Paused Split timeline scroll sync (isolated from rAF playback loop so ticking never restarts rAF)
  useEffect(() => {
    if (
      !isPlayerOpen ||
      editMode !== 'split' ||
      isPlaying ||
      activeTrimDrag ||
      activeAudioTrimDrag ||
      activeTextTrimDrag ||
      activeOverlayTrimDrag ||
      activeOverlayMoveDrag ||
      activeTextMoveDrag ||
      activeVideoMoveDrag ||
      !splitTimelineRef.current ||
      isUserScrubbingTimelineRef.current
    ) {
      return;
    }
    const targetLeft = currentTime * splitPxPerSec;
    lastProgrammaticScrollLeftRef.current = targetLeft;
    isSyncingTimelineScrollRef.current = true;
    splitTimelineRef.current.scrollLeft = targetLeft;
    const resetId = window.requestAnimationFrame(() => {
      isSyncingTimelineScrollRef.current = false;
    });
    return () => window.cancelAnimationFrame(resetId);
  }, [
    isPlayerOpen,
    isPlaying,
    editMode,
    currentTime,
    splitPxPerSec,
    activeTrimDrag,
    activeAudioTrimDrag,
    activeTextTrimDrag,
    activeOverlayTrimDrag,
    activeOverlayMoveDrag,
    activeTextMoveDrag,
    activeVideoMoveDrag,
  ]);

  // High-precision rAF guard for Trim selection bounds AND seamless Dual-Deck Multi-Clip Split playback
  useEffect(() => {
    if (!isPlayerOpen || editMode === 'none' || !isPlaying) return;

    let rafId = 0;
    splitLastRafMsRef.current = performance.now();

    const syncTimelineScrollDuringPlayback = (globalSec: number) => {
      if (splitTimelineRef.current && !isUserScrubbingTimelineRef.current) {
        const targetLeft = globalSec * splitPxPerSec;
        lastProgrammaticScrollLeftRef.current = targetLeft;
        scrollSyncUnlockAtMsRef.current = performance.now() + 80;
        isSyncingTimelineScrollRef.current = true;
        splitTimelineRef.current.scrollLeft = targetLeft;
        window.requestAnimationFrame(() => {
          isSyncingTimelineScrollRef.current = false;
        });
      }
    };

    const tick = (nowMs: number) => {
      const dtSec = Math.min(0.1, Math.max(0, (nowMs - splitLastRafMsRef.current) / 1000));
      splitLastRafMsRef.current = nowMs;

      const {
        editMode: mode,
        trimStart: start,
        trimEnd: end,
        mappedSplitSegments: segs,
        currentTime: curGlobal,
        playbackSpeed: spd,
        isMuted: mutedNow,
      } = trimBoundsRef.current;

      if (mode === 'trim' && end > start) {
        const el = videoRef.current;
        if (!el || el.paused) return;
        if (el.currentTime < start - 0.08) {
          el.currentTime = start;
          setCurrentTime(start);
        } else if (el.currentTime >= end - 0.02) {
          el.pause();
          el.currentTime = end;
          setCurrentTime(end);
          setIsPlaying(false);
          return;
        } else {
          setCurrentTime(el.currentTime);
        }
      } else if (mode === 'split' && segs.length > 0) {
        const kept = segs.filter((s) => !s.removed);
        if (kept.length === 0) {
          trimBoundsRef.current.isPlaying = false;
          pauseAllSplitVideos();
          setIsPlaying(false);
          return;
        }

        // Allow auditioning long uploaded audio or overlays past the end of the main video
        const {
          totalSplitDuration: videoTotalDur,
          totalAudioDuration: audTotalDur,
          maxOverlayDuration: ovTotalDur,
          selectedTrackType: selTrack,
        } = trimBoundsRef.current;
        const tailMaxDur =
          selTrack === 'audio'
            ? audTotalDur
            : selTrack === 'overlay'
            ? ovTotalDur
            : videoTotalDur;
        if (
          (selTrack === 'audio' || selTrack === 'overlay') &&
          tailMaxDur > videoTotalDur + 0.15 &&
          curGlobal >= videoTotalDur - 0.01
        ) {
          const activeDeck = activeSplitDeckRef.current;
          const activeEl = getDeckEl(activeDeck);
          if (activeEl && !activeEl.paused) activeEl.pause();
          const nextGlobal = curGlobal + dtSec * spd;
          if (nextGlobal >= tailMaxDur - 0.02) {
            trimBoundsRef.current.isPlaying = false;
            pauseAllSplitVideos();
            setCurrentTime(tailMaxDur);
            trimBoundsRef.current.currentTime = tailMaxDur;
            setIsPlaying(false);
            syncTimelineScrollDuringPlayback(tailMaxDur);
            return;
          }
          setCurrentTime(nextGlobal);
          trimBoundsRef.current.currentTime = nextGlobal;
          syncCustomAudioToTime(nextGlobal, true);
          syncOverlaysToTime(nextGlobal, true);
          syncTimelineScrollDuringPlayback(nextGlobal);
          rafId = window.requestAnimationFrame(tick);
          return;
        }

        const currentSeg =
          kept.find((s) => curGlobal >= s.globalStart - 0.03 && curGlobal < s.globalEnd - 0.02) || null;

        if (!currentSeg) {
          const nextKept = kept.find((s) => s.globalStart >= curGlobal - 0.03);
          if (nextKept) {
            seekSplitTimelineTo(nextKept.globalStart, true);
            rafId = window.requestAnimationFrame(tick);
            return;
          } else {
            const lastEnd = kept[kept.length - 1].globalEnd;
            trimBoundsRef.current.isPlaying = false;
            pauseAllSplitVideos();
            setCurrentTime(lastEnd);
            trimBoundsRef.current.currentTime = lastEnd;
            setIsPlaying(false);
            syncTimelineScrollDuringPlayback(lastEnd);
            return;
          }
        }

        // Keep standby deck pre-seeked and pre-decoded for the next non-contiguous video cut
        preloadUpcomingClip(currentSeg, kept);

        const activeDeck = activeSplitDeckRef.current;
        const standbyDeck: 'A' | 'B' = activeDeck === 'A' ? 'B' : 'A';
        const el = getDeckEl(activeDeck);

        if (currentSeg.mediaType === 'image') {
          if (el && !el.paused) el.pause();
          const nextGlobal = curGlobal + dtSec * spd;
          if (nextGlobal >= currentSeg.globalEnd - 0.02) {
            const nextKept = kept.find((s) => s.globalStart >= currentSeg.globalEnd - 0.01);
            if (nextKept) {
              seekSplitTimelineTo(nextKept.globalStart, true);
            } else if ((selTrack === 'audio' || selTrack === 'overlay') && tailMaxDur > videoTotalDur + 0.15) {
              if (el && !el.paused) el.pause();
              setCurrentTime(currentSeg.globalEnd);
              trimBoundsRef.current.currentTime = currentSeg.globalEnd;
              syncCustomAudioToTime(currentSeg.globalEnd, true);
              syncOverlaysToTime(currentSeg.globalEnd, true);
              syncTimelineScrollDuringPlayback(currentSeg.globalEnd);
            } else {
              trimBoundsRef.current.isPlaying = false;
              pauseAllSplitVideos();
              setCurrentTime(currentSeg.globalEnd);
              trimBoundsRef.current.currentTime = currentSeg.globalEnd;
              setIsPlaying(false);
              return;
            }
          } else {
            setCurrentTime(nextGlobal);
            trimBoundsRef.current.currentTime = nextGlobal;
            syncCustomAudioToTime(nextGlobal, true);
            syncOverlaysToTime(nextGlobal, true);
            syncTimelineScrollDuringPlayback(nextGlobal);
          }
        } else if (el) {
          if (deckUrlsRef.current[activeDeck] !== currentSeg.sourceUrl) {
            seekSplitTimelineTo(curGlobal, true);
            rafId = window.requestAnimationFrame(tick);
            return;
          }

          if (el.muted !== mutedNow) el.muted = mutedNow;
          if (Math.abs(el.playbackRate - spd) > 0.001) el.playbackRate = spd;

          // Recover if Android hardware decoder stalls in seeking=true when rewinding from ended
          if (el.seeking) {
            if (seekStuckSinceMsRef.current[activeDeck] === 0) {
              seekStuckSinceMsRef.current[activeDeck] = nowMs;
            } else if (nowMs - seekStuckSinceMsRef.current[activeDeck] > 1200) {
              seekStuckSinceMsRef.current[activeDeck] = nowMs;
              const pendingTarget = pendingDeckSeekRef.current[activeDeck]?.sourceTime ?? currentSeg.sourceStart;
              const nudgedTarget = Math.min(currentSeg.sourceEnd - 0.05, pendingTarget + 0.02);
              if (el.readyState >= 1) {
                el.currentTime = Math.max(0, nudgedTarget);
              }
              tryPlayDeckEl(activeDeck, el);
            }
          } else {
            seekStuckSinceMsRef.current[activeDeck] = 0;
          }

          let pendingForActive = pendingDeckSeekRef.current[activeDeck];
          if (
            pendingForActive &&
            !pendingForActive.awaitingMetadata &&
            pendingForActive.sourceUrl === currentSeg.sourceUrl &&
            !el.seeking &&
            el.readyState >= 2
          ) {
            const shouldStart = pendingForActive.autoPlay;
            pendingDeckSeekRef.current[activeDeck] = null;
            pendingForActive = null;
            if (shouldStart && el.paused) {
              tryPlayDeckEl(activeDeck, el);
            }
          }
          if (el.paused && !pendingForActive && !el.seeking && el.readyState >= 2) {
            tryPlayDeckEl(activeDeck, el);
          }

          if (!pendingForActive && !el.seeking && el.readyState >= 2) {
            const mappedNow = Math.max(
              currentSeg.globalStart,
              Math.min(
                currentSeg.globalEnd,
                currentSeg.globalStart + (el.currentTime - currentSeg.sourceStart)
              )
            );
            const reachedClipEnd =
              el.currentTime >= currentSeg.sourceEnd - 0.035 ||
              (el.ended && el.currentTime >= Math.max(currentSeg.sourceStart, currentSeg.sourceEnd - 0.35));
            if (reachedClipEnd) {
              const nextKept = kept.find((s) => s.globalStart >= currentSeg.globalEnd - 0.02);
              if (nextKept) {
                const isSeamlessSameSource =
                  nextKept.mediaType === 'video' &&
                  nextKept.sourceUrl === currentSeg.sourceUrl &&
                  Math.abs(nextKept.sourceStart - currentSeg.sourceEnd) < 0.06 &&
                  Math.abs(nextKept.globalStart - currentSeg.globalEnd) < 0.06;

                if (isSeamlessSameSource) {
                  setCurrentTime(nextKept.globalStart);
                  trimBoundsRef.current.currentTime = nextKept.globalStart;
                  syncCustomAudioToTime(nextKept.globalStart, true);
                  syncOverlaysToTime(nextKept.globalStart, true);
                  syncTimelineScrollDuringPlayback(nextKept.globalStart);
                } else if (nextKept.mediaType === 'video') {
                  const sb = getDeckEl(standbyDeck);
                  const sbReadyForCut =
                    sb &&
                    deckUrlsRef.current[standbyDeck] === nextKept.sourceUrl &&
                    sb.readyState >= 2 &&
                    Math.abs(sb.currentTime - nextKept.sourceStart) <= 0.25;

                  if (sbReadyForCut && sb) {
                    // Instant zero-stall dual-deck cut!
                    sb.muted = mutedNow;
                    sb.playbackRate = spd;
                    if (Math.abs(sb.currentTime - nextKept.sourceStart) > 0.08) {
                      sb.currentTime = nextKept.sourceStart;
                    }
                    activeSplitDeckRef.current = standbyDeck;
                    setActiveSplitDeck(standbyDeck);
                    tryPlayDeckEl(standbyDeck, sb);
                    el.muted = true;
                    el.pause();
                    standbyPreloadRef.current = null;
                    setCurrentTime(nextKept.globalStart);
                    trimBoundsRef.current.currentTime = nextKept.globalStart;
                    syncCustomAudioToTime(nextKept.globalStart, true);
                    syncOverlaysToTime(nextKept.globalStart, true);
                    syncTimelineScrollDuringPlayback(nextKept.globalStart);
                    preloadUpcomingClip(nextKept, kept);
                  } else {
                    seekSplitTimelineTo(nextKept.globalStart, true);
                  }
                } else {
                  seekSplitTimelineTo(nextKept.globalStart, true);
                }
              } else if ((selTrack === 'audio' || selTrack === 'overlay') && tailMaxDur > videoTotalDur + 0.15) {
                if (!el.paused) el.pause();
                setCurrentTime(currentSeg.globalEnd);
                trimBoundsRef.current.currentTime = currentSeg.globalEnd;
                syncCustomAudioToTime(currentSeg.globalEnd, true);
                syncOverlaysToTime(currentSeg.globalEnd, true);
                syncTimelineScrollDuringPlayback(currentSeg.globalEnd);
              } else {
                trimBoundsRef.current.isPlaying = false;
                pauseAllSplitVideos();
                setCurrentTime(currentSeg.globalEnd);
                trimBoundsRef.current.currentTime = currentSeg.globalEnd;
                setIsPlaying(false);
                syncTimelineScrollDuringPlayback(currentSeg.globalEnd);
                return;
              }
            } else {
              setCurrentTime(mappedNow);
              trimBoundsRef.current.currentTime = mappedNow;
              syncCustomAudioToTime(mappedNow, true);
              syncOverlaysToTime(mappedNow, true);
              syncTimelineScrollDuringPlayback(mappedNow);
            }
          }
        }
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [isPlayerOpen, isPlaying, editMode, splitPxPerSec]);

  // Extract filmstrip frames per unique video source on the Split timeline & video overlays
  const splitVideoSourcesKey = useMemo(() => {
    const urls = Array.from(
      new Set([
        ...splitSegments
          .filter((s) => s.mediaType === 'video' && s.sourceUrl)
          .map((s) => s.sourceUrl),
        ...splitOverlays
          .filter((o) => o.mediaType === 'video' && o.sourceUrl)
          .map((o) => o.sourceUrl),
      ])
    );
    return urls.join('|');
  }, [splitSegments, splitOverlays]);

  useEffect(() => {
    if (!isPlayerOpen || editMode !== 'split' || !splitVideoSourcesKey) {
      return;
    }

    const sourceUrls = splitVideoSourcesKey.split('|').filter(Boolean);
    const missing = sourceUrls.filter((u) => !splitFramesBySource[u] && !extractingSources[u]);
    if (missing.length === 0) return;

    let cancelled = false;

    const extractSource = async (src: string) => {
      setExtractingSources((prev) => ({ ...prev, [src]: true }));
      const tempVideo = document.createElement('video');
      tempVideo.muted = true;
      tempVideo.playsInline = true;
      tempVideo.preload = 'auto';

      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error('Frame timeout')), 4500);
          tempVideo.onloadeddata = () => {
            window.clearTimeout(timeout);
            resolve();
          };
          tempVideo.onerror = () => {
            window.clearTimeout(timeout);
            reject(new Error('Frame load failed'));
          };
          tempVideo.src = src;
        });

        if (cancelled) return;
        const srcDur = isFinite(tempVideo.duration) && tempVideo.duration > 0 ? tempVideo.duration : 10;
        const frameCount = Math.max(6, Math.min(18, Math.ceil(srcDur / 2)));
        const vw = tempVideo.videoWidth || 320;
        const vh = tempVideo.videoHeight || 180;
        const targetH = 96;
        const targetW = Math.max(48, Math.round((vw / Math.max(1, vh)) * targetH));
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const results: Array<{ time: number; url: string }> = [];
        for (let i = 0; i < frameCount; i++) {
          if (cancelled) break;
          const t =
            frameCount === 1
              ? 0
              : Math.min(Math.max(0, srcDur - 0.08), (i / (frameCount - 1)) * srcDur);

          await new Promise<void>((resolve) => {
            const seekTimer = window.setTimeout(resolve, 650);
            tempVideo.onseeked = () => {
              window.clearTimeout(seekTimer);
              resolve();
            };
            tempVideo.currentTime = t;
          });

          if (cancelled) break;
          try {
            ctx.drawImage(tempVideo, 0, 0, targetW, targetH);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
            results.push({ time: t, url: dataUrl });
            if (results.length === 1 || results.length % 3 === 0 || i === frameCount - 1) {
              setSplitFramesBySource((prev) => ({ ...prev, [src]: [...results] }));
            }
          } catch {
            break;
          }
        }
      } catch {
        // Keep timeline usable even if frame extraction fails
      } finally {
        tempVideo.removeAttribute('src');
        tempVideo.load();
        if (!cancelled) {
          setExtractingSources((prev) => ({ ...prev, [src]: false }));
        }
      }
    };

    void (async () => {
      for (const src of missing) {
        if (cancelled) break;
        await extractSource(src);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isPlayerOpen, editMode, splitVideoSourcesKey]);

  // Pause video player if Home BPM Analyzer or Standalone Audio Player starts playing
  useEffect(() => {
    if (pauseSignal > 0) {
      pauseAllSplitVideos();
      setIsPlaying(false);
    }
  }, [pauseSignal]);

  const loadDeviceVideos = async () => {
    if (!isNativeAndroid()) return;
    setIsLoadingLibrary(true);
    setErrorMessage(null);
    try {
      const res = await AudioLibrary.getAllVideoFiles();
      if (res.granted) {
        setPermissionDenied(false);
        setVideos(res.videos || []);
      } else {
        setPermissionDenied(true);
      }
    } catch (err) {
      console.error('Failed to load phone video library:', err);
      setErrorMessage('Could not read video files from your phone.');
    } finally {
      setIsLoadingLibrary(false);
    }
  };

  useEffect(() => {
    if (isActiveTab && isNativeAndroid() && !hasAutoLoadedRef.current) {
      hasAutoLoadedRef.current = true;
      void loadDeviceVideos();
    }
  }, [isActiveTab]);

  const videosRef = useRef<VideoTrackItem[]>(videos);
  videosRef.current = videos;
  const videoPlaylistsRef = useRef<VideoPlaylist[]>(videoPlaylists);
  videoPlaylistsRef.current = videoPlaylists;
  const videoFavoriteIdsRef = useRef<string[]>(videoFavoriteIds);
  videoFavoriteIdsRef.current = videoFavoriteIds;
  const videoHiddenIdsRef = useRef<string[]>(videoHiddenIds);
  videoHiddenIdsRef.current = videoHiddenIds;

  const resolveVideoScopeQueue = (scope: VideoPlaybackScope): VideoTrackItem[] => {
    const all = videosRef.current;
    const hidden = videoHiddenIdsRef.current;
    if (scope.type === 'hidden') {
      return all.filter((v) => hidden.includes(v.id) || hidden.includes(v.uri));
    }
    const visible = all.filter((v) => !hidden.includes(v.id) && !hidden.includes(v.uri));
    if (scope.type === 'favorites') {
      const favs = videoFavoriteIdsRef.current;
      return visible.filter((v) => favs.includes(v.id));
    }
    if (scope.type === 'playlist') {
      const pl = videoPlaylistsRef.current.find((p) => p.id === scope.playlistId);
      if (!pl) return [];
      const byId = new Map(visible.map((v) => [v.id, v]));
      return pl.trackIds
        .map((id) => byId.get(id))
        .filter((item): item is VideoTrackItem => Boolean(item));
    }
    return visible;
  };

  const nonHiddenVideos = useMemo(() => {
    return videos.filter(
      (v) => !videoHiddenIds.includes(v.id) && !videoHiddenIds.includes(v.uri)
    );
  }, [videos, videoHiddenIds]);

  const currentOpenVideoPlaylist = useMemo(() => {
    if (!selectedVideoPlaylistId) return null;
    return videoPlaylists.find((p) => p.id === selectedVideoPlaylistId) ?? null;
  }, [videoPlaylists, selectedVideoPlaylistId]);

  const visibleBaseVideos = useMemo(() => {
    if (videoLibraryFilter === 'hidden') {
      return videos.filter(
        (v) => videoHiddenIds.includes(v.id) || videoHiddenIds.includes(v.uri)
      );
    }
    if (videoLibraryFilter === 'favorites') {
      return nonHiddenVideos.filter((v) => videoFavoriteIds.includes(v.id));
    }
    if (videoLibraryFilter === 'playlists') {
      const pl = videoPlaylists.find((p) => p.id === selectedVideoPlaylistId);
      if (!pl) return [];
      const byId = new Map(nonHiddenVideos.map((v) => [v.id, v]));
      return pl.trackIds
        .map((id) => byId.get(id))
        .filter((item): item is VideoTrackItem => Boolean(item));
    }
    return nonHiddenVideos;
  }, [
    videos,
    nonHiddenVideos,
    videoLibraryFilter,
    videoHiddenIds,
    videoFavoriteIds,
    videoPlaylists,
    selectedVideoPlaylistId,
  ]);

  const filteredVideos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return visibleBaseVideos;
    return visibleBaseVideos.filter(
      (v) =>
        v.title.toLowerCase().includes(q) ||
        v.displayName.toLowerCase().includes(q)
    );
  }, [visibleBaseVideos, searchQuery]);

  const handleToggleVideoFavorite = (vid: VideoTrackItem) => {
    setVideoFavoriteIds((prev) => {
      const exists = prev.includes(vid.id);
      const next = exists ? prev.filter((id) => id !== vid.id) : [...prev, vid.id];
      showVideoToast(
        exists
          ? `Removed "${vid.title || vid.displayName}" from favorites`
          : `Added "${vid.title || vid.displayName}" to favorites`
      );
      return next;
    });
  };

  const handleToggleVideoHidden = (vid: VideoTrackItem) => {
    setVideoHiddenIds((prev) => {
      const isHidden = prev.includes(vid.id) || (vid.uri ? prev.includes(vid.uri) : false);
      const next = isHidden
        ? prev.filter((id) => id !== vid.id && id !== vid.uri)
        : [...prev, vid.id];
      showVideoToast(
        isHidden
          ? `Unhid "${vid.title || vid.displayName}"`
          : `Hidden "${vid.title || vid.displayName}" from main list`
      );
      return next;
    });
  };

  const handleCreateVideoPlaylistDirect = () => {
    const trimmed = newVideoPlaylistNameInput.trim();
    if (!trimmed) return;
    const newPl: VideoPlaylist = {
      id: `vpl-${Date.now()}`,
      name: trimmed,
      trackIds: [],
      createdAt: Date.now(),
    };
    setVideoPlaylists((prev) => [newPl, ...prev]);
    setNewVideoPlaylistNameInput('');
    setIsCreateVideoPlaylistOpen(false);
    setVideoLibraryFilter('playlists');
    setSelectedVideoPlaylistId(newPl.id);
    showVideoToast(`Created playlist "${trimmed}"`);
    if (nonHiddenVideos.length > 0) {
      setAddVideosModalPlaylistId(newPl.id);
    }
  };

  const handleRemoveVideoFromPlaylist = (playlistId: string, videoId: string) => {
    setVideoPlaylists((prev) =>
      prev.map((pl) =>
        pl.id === playlistId
          ? { ...pl, trackIds: pl.trackIds.filter((id) => id !== videoId) }
          : pl
      )
    );
    showVideoToast('Removed video from playlist');
  };

  const closePlayer = async () => {
    clearHideTimer();
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // ignore fullscreen exit error
      }
    }
    pauseAllSplitVideos();
    if (standbyVideoRef.current) {
      standbyVideoRef.current.removeAttribute('src');
      standbyVideoRef.current.load();
    }
    deckUrlsRef.current.B = '';
    pendingDeckSeekRef.current = { A: null, B: null };
    standbyPreloadRef.current = null;
    activeSplitDeckRef.current = 'A';
    setActiveSplitDeck('A');
    setIsPlaying(false);
    setIsPreviewingTrim(false);
    setEditMode('none');
    setShowAddMediaMenu(false);
    setActiveSplitPicker('none');
    setIsTextEditorOpen(false);
    setSelectedTextId(null);
    setSplitTextOverlays([]);
    setSplitOverlays([]);
    setSelectedOverlayId(null);
    setActiveOverlayTrimDrag(null);
    setActiveOverlayMoveDrag(null);
    setActiveTextMoveDrag(null);
    setActiveVideoMoveDrag(null);
    setActiveTrimDrag(null);
    setActiveAudioTrimDrag(null);
    setSplitCustomAudio(null);
    setSplitAudioSegments([]);
    setSelectedAudioSegId(null);
    setSelectedTrackType('video');
    setMainVideoCrop(DEFAULT_VIDEO_CROP);
    setIsMainCropActive(false);
    setActiveCropAspect('free');
    lastActiveAudioSegIdRef.current = null;
    setEditStatusMessage(null);
    setEditErrorMessage(null);
    setLastSavedClip(null);
    setIsPlayerOpen(false);
  };

  // Close VLC overlay cleanly with Escape key
  useEffect(() => {
    if (!isPlayerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) {
        if (isTextEditorOpen) {
          setIsTextEditorOpen(false);
        } else if (isMainCropActive) {
          setIsMainCropActive(false);
        } else if (activeSplitPicker !== 'none') {
          setActiveSplitPicker('none');
        } else if (showAddMediaMenu) {
          setShowAddMediaMenu(false);
        } else if (isPreviewingTrim) {
          setIsPreviewingTrim(false);
          if (videoRef.current && !videoRef.current.paused) {
            videoRef.current.pause();
            setIsPlaying(false);
          }
        } else if (editMode !== 'none') {
          exitSplitToPlayer();
          setIsPreviewingTrim(false);
        } else {
          void closePlayer();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPlayerOpen, editMode, isPreviewingTrim, activeSplitPicker, showAddMediaMenu, isTextEditorOpen, isMainCropActive]);

  const playVideoItem = async (item: VideoTrackItem, explicitScope?: VideoPlaybackScope) => {
    const targetScope: VideoPlaybackScope =
      explicitScope ??
      (videoLibraryFilter === 'playlists' && selectedVideoPlaylistId
        ? { type: 'playlist', playlistId: selectedVideoPlaylistId }
        : videoLibraryFilter === 'favorites'
        ? { type: 'favorites' }
        : videoLibraryFilter === 'hidden'
        ? { type: 'hidden' }
        : { type: 'all' });
    videoPlaybackScopeRef.current = targetScope;
    setVideoPlaybackScope(targetScope);

    setErrorMessage(null);
    setEditMode('none');
    setShowAddMediaMenu(false);
    setActiveSplitPicker('none');
    setIsTextEditorOpen(false);
    setSelectedTextId(null);
    setSplitTextOverlays([]);
    setSplitOverlays([]);
    setSelectedOverlayId(null);
    setActiveOverlayTrimDrag(null);
    setActiveOverlayMoveDrag(null);
    setActiveTextMoveDrag(null);
    setActiveVideoMoveDrag(null);
    setActiveTrimDrag(null);
    setActiveAudioTrimDrag(null);
    setSplitCustomAudio(null);
    setSplitAudioSegments([]);
    setSelectedAudioSegId(null);
    setSelectedTrackType('video');
    setMainVideoCrop(DEFAULT_VIDEO_CROP);
    setIsMainCropActive(false);
    setActiveCropAspect('free');
    lastActiveAudioSegIdRef.current = null;
    setIsPreviewingTrim(false);
    setEditStatusMessage(null);
    setEditErrorMessage(null);
    setLastSavedClip(null);
    setCurrentVideo(item);
    setIsPlayerOpen(true);
    setIsLoadingVideo(true);
    setShowControls(true);
    setCurrentTime(0);
    setDuration(item.durationMs > 0 ? item.durationMs / 1000 : 0);
    onPlaybackStarted();

    try {
      let playableUrl = item.webUrl || '';
      if (!playableUrl && isNativeAndroid()) {
        const prepared = await AudioLibrary.prepareMediaFile({
          uri: item.uri,
          displayName: item.displayName || item.title,
          mediaKind: 'video',
        });
        playableUrl = resolvePlayableAudioUrl(prepared);
      }

      if (!playableUrl) {
        throw new Error('Video source unavailable');
      }

      const loadAndPlayUrl = async (url: string) => {
        mainVideoUrlRef.current = url;
        deckUrlsRef.current = { A: url, B: '' };
        pendingDeckSeekRef.current = { A: null, B: null };
        standbyPreloadRef.current = null;
        activeSplitDeckRef.current = 'A';
        setActiveSplitDeck('A');

        const videoEl = videoRef.current;
        if (!videoEl) return;

        videoEl.src = url;
        videoEl.muted = isMuted;
        videoEl.playbackRate = playbackSpeed;
        videoEl.load();
        await videoEl.play();
      };

      try {
        await loadAndPlayUrl(playableUrl);
      } catch (firstErr) {
        if (isMediaAbortError(firstErr)) {
          return;
        }
        if (isNativeAndroid() && item.uri && !item.uri.startsWith('blob:')) {
          const copied = await AudioLibrary.prepareMediaFile({
            uri: item.uri,
            displayName: item.displayName || item.title,
            mediaKind: 'video',
            forceCopy: true,
          });
          const retryUrl = resolvePlayableAudioUrl(copied);
          if (retryUrl && retryUrl !== playableUrl) {
            await loadAndPlayUrl(retryUrl);
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }
      setIsPlaying(true);
    } catch (err) {
      if (!isMediaAbortError(err)) {
        console.error('Video playback failed:', err);
        setErrorMessage(`Could not play "${item.title || item.displayName}".`);
      }
      setIsPlaying(false);
    } finally {
      setIsLoadingVideo(false);
    }
  };

  // Auto-open VLC-style player and start playback when an external video is opened in BeatPulse
  useEffect(() => {
    if (!externalVideoRequest) return;
    if (lastExternalRequestIdRef.current === externalVideoRequest.requestId) return;
    lastExternalRequestIdRef.current = externalVideoRequest.requestId;

    const incoming = externalVideoRequest.video;
    setVideos((prev) => {
      const exists = prev.some((v) => v.id === incoming.id || (v.uri && v.uri === incoming.uri));
      return exists ? prev : [incoming, ...prev];
    });
    void playVideoItem(incoming);
  }, [externalVideoRequest]);

  const handleTogglePlayPause = async () => {
    const videoEl = videoRef.current;
    if (!videoEl || !currentVideo) return;

    setShowControls(true);
    if (editMode === 'split') {
      if (isPlaying) {
        trimBoundsRef.current.isPlaying = false;
        pauseAllSplitVideos();
        setIsPlaying(false);
      } else {
        onPlaybackStarted();
        const kept = mappedSplitSegments.filter((s) => !s.removed);
        if (kept.length === 0) return;

        // If user scrolled out into the audio or overlay tail, play from there
        const activeTailMax =
          selectedTrackType === 'audio'
            ? totalAudioDuration
            : selectedTrackType === 'overlay'
            ? maxOverlayDuration
            : totalSplitDuration;
        if (
          (selectedTrackType === 'audio' || selectedTrackType === 'overlay') &&
          activeTailMax > totalSplitDuration + 0.15 &&
          currentTime > totalSplitDuration + 0.08 &&
          currentTime < activeTailMax - 0.05
        ) {
          trimBoundsRef.current.isPlaying = true;
          setIsPlaying(true);
          syncCustomAudioToTime(currentTime, true, true);
          syncOverlaysToTime(currentTime, true, true);
          return;
        }

        let targetTime = currentTime;
        const inKept = kept.find(
          (s) => currentTime >= s.globalStart - 0.03 && currentTime < s.globalEnd - 0.04
        );
        if (!inKept) {
          const nextKept = kept.find((s) => s.globalStart >= currentTime) || kept[0];
          targetTime = nextKept.globalStart;
        }
        trimBoundsRef.current.isPlaying = true;
        setIsPlaying(true);
        seekSplitTimelineTo(targetTime, true);
      }
      return;
    }

    if (videoEl.paused) {
      onPlaybackStarted();
      try {
        if (editMode === 'trim' && trimEnd > trimStart) {
          const cur = videoEl.currentTime;
          if (cur < trimStart - 0.05 || cur >= trimEnd - 0.05) {
            if (Math.abs(cur - trimStart) > 0.02) {
              setIsMaskingTrimSeek(true);
            }
            videoEl.currentTime = trimStart;
            setCurrentTime(trimStart);
          }
        }
        await videoEl.play();
        setIsPlaying(true);
      } catch (err) {
        setIsMaskingTrimSeek(false);
        if (!isMediaAbortError(err)) {
          console.error('Video resume failed:', err);
          setIsPlaying(false);
        }
      }
    } else {
      videoEl.pause();
      setIsPlaying(false);
    }
  };

  const handleSeekRelative = (deltaSec: number) => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    setShowControls(true);
    const maxDur = isFinite(videoEl.duration) ? videoEl.duration : duration;
    const minBound = editMode === 'trim' ? trimStart : 0;
    const maxBound = editMode === 'trim' && trimEnd > trimStart ? trimEnd : maxDur || 0;
    const next = Math.max(minBound, Math.min(maxBound, videoEl.currentTime + deltaSec));
    videoEl.currentTime = next;
    setCurrentTime(next);
  };

  const handleStepVideo = (direction: -1 | 1) => {
    const scope = videoPlaybackScopeRef.current;
    const scopedPool = resolveVideoScopeQueue(scope);
    const pool =
      scope.type === 'playlist'
        ? scopedPool
        : scopedPool.length > 0
        ? scopedPool
        : videos;
    if (pool.length === 0) return;

    if (!currentVideo) {
      void playVideoItem(pool[0], scope);
      return;
    }

    const idx = pool.findIndex((v) => v.id === currentVideo.id);
    const baseIdx = idx >= 0 ? idx : 0;
    const nextIdx = (baseIdx + direction + pool.length) % pool.length;
    void playVideoItem(pool[nextIdx], scope);
  };

  const handlePlayVideoPlaylistFolder = (playlistId: string, startVideo?: VideoTrackItem) => {
    const scope: VideoPlaybackScope = { type: 'playlist', playlistId };
    const folderVideos = resolveVideoScopeQueue(scope);
    if (folderVideos.length === 0) {
      showVideoToast('Add videos to this playlist first.');
      setAddVideosModalPlaylistId(playlistId);
      return;
    }
    const target =
      startVideo && folderVideos.some((v) => v.id === startVideo.id)
        ? startVideo
        : folderVideos[0];
    void playVideoItem(target, scope);
  };

  const cycleSpeed = () => {
    setShowControls(true);
    const currentIdx = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
    const nextSpeed = PLAYBACK_SPEEDS[(currentIdx + 1) % PLAYBACK_SPEEDS.length];
    setPlaybackSpeed(nextSpeed);
    if (videoRef.current) {
      videoRef.current.playbackRate = nextSpeed;
    }
  };

  const handleFullscreen = async () => {
    setShowControls(true);
    const containerEl = playerContainerRef.current;
    const videoEl = videoRef.current as (HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
    }) | null;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (containerEl?.requestFullscreen) {
        await containerEl.requestFullscreen();
      } else if (videoEl?.requestFullscreen) {
        await videoEl.requestFullscreen();
      } else if (videoEl?.webkitEnterFullscreen) {
        videoEl.webkitEnterFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen toggle failed:', err);
    }
  };

  const getLiveDuration = (): number => {
    const elDur = videoRef.current?.duration;
    if (elDur && isFinite(elDur) && elDur > 0) return elDur;
    return duration;
  };

  const openTrimEditor = () => {
    const total = getLiveDuration();
    if (!currentVideo || total <= 0.4) {
      setEditErrorMessage('Wait for video duration to load before trimming.');
      return;
    }
    setShowControls(true);
    setEditStatusMessage(null);
    setEditErrorMessage(null);
    setLastSavedClip(null);
    setIsPreviewingTrim(false);
    setIsMaskingTrimSeek(false);

    if (editMode === 'trim') {
      setEditMode('none');
      return;
    }

    const pos = videoRef.current?.currentTime ?? currentTime;
    const defaultStart = pos > 0.3 && pos < total - 1.0 ? Number(pos.toFixed(1)) : 0;
    const defaultEnd = total;
    setTrimStart(defaultStart);
    setTrimEnd(defaultEnd);
    setEditMode('trim');
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const exitSplitToPlayer = () => {
    pauseAllSplitVideos();
    if (standbyVideoRef.current) {
      standbyVideoRef.current.removeAttribute('src');
      standbyVideoRef.current.load();
    }
    pendingDeckSeekRef.current = { A: null, B: null };
    standbyPreloadRef.current = null;
    activeSplitDeckRef.current = 'A';
    setActiveSplitDeck('A');
    deckUrlsRef.current.B = '';
    setIsPlaying(false);
    setShowAddMediaMenu(false);
    setActiveSplitPicker('none');
    setIsTextEditorOpen(false);
    setSelectedTextId(null);
    setSplitTextOverlays([]);
    setSplitOverlays([]);
    setSelectedOverlayId(null);
    setActiveOverlayTrimDrag(null);
    setActiveOverlayMoveDrag(null);
    setActiveTextMoveDrag(null);
    setActiveVideoMoveDrag(null);
    setActiveTrimDrag(null);
    setActiveAudioTrimDrag(null);
    setSplitAudioSegments([]);
    setSelectedAudioSegId(null);
    setSelectedTrackType('video');
    setMainVideoCrop(DEFAULT_VIDEO_CROP);
    setIsMainCropActive(false);
    setActiveCropAspect('free');
    lastActiveAudioSegIdRef.current = null;
    setEditMode('none');
    // Restore original main video source if multi-clip playback switched it
    if (videoRef.current && mainVideoUrlRef.current && deckUrlsRef.current.A !== mainVideoUrlRef.current) {
      deckUrlsRef.current.A = mainVideoUrlRef.current;
      videoRef.current.src = mainVideoUrlRef.current;
      videoRef.current.load();
      setCurrentTime(0);
    }
  };

  const openSplitEditor = () => {
    const total = getLiveDuration();
    if (!currentVideo || total <= 0.6) {
      setEditErrorMessage('Video is too short to split.');
      return;
    }
    setShowControls(true);
    setEditStatusMessage(null);
    setEditErrorMessage(null);
    setLastSavedClip(null);
    setIsPreviewingTrim(false);
    setIsMaskingTrimSeek(false);
    setShowAddMediaMenu(false);
    setActiveSplitPicker('none');
    setIsTextEditorOpen(false);
    setSelectedTextId(null);
    setSplitTextOverlays([]);
    setSplitOverlays([]);
    setSelectedOverlayId(null);
    setActiveTrimDrag(null);
    setActiveAudioTrimDrag(null);
    setActiveTextTrimDrag(null);
    setActiveOverlayTrimDrag(null);
    setActiveOverlayMoveDrag(null);
    setActiveTextMoveDrag(null);
    setActiveVideoMoveDrag(null);
    setSplitCustomAudio(null);
    setSplitAudioSegments([]);
    setSelectedAudioSegId(null);
    setSelectedTrackType('video');
    setMainVideoCrop(DEFAULT_VIDEO_CROP);
    setIsMainCropActive(false);
    setActiveCropAspect('free');
    if (videoRef.current && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
      setMainMediaDims({ w: videoRef.current.videoWidth, h: videoRef.current.videoHeight });
    }
    lastActiveAudioSegIdRef.current = null;
    setExportProgressPct(null);

    if (editMode === 'split') {
      exitSplitToPlayer();
      return;
    }

    const playableUrl = mainVideoUrlRef.current || currentVideo.webUrl || videoRef.current?.currentSrc || '';
    mainVideoUrlRef.current = playableUrl;
    deckUrlsRef.current = { A: playableUrl, B: '' };
    pendingDeckSeekRef.current = { A: null, B: null };
    standbyPreloadRef.current = null;
    activeSplitDeckRef.current = 'A';
    setActiveSplitDeck('A');

    const initialSeg: TimelineClipSegment = {
      id: `seg-0-${Date.now()}`,
      mediaType: 'video',
      title: currentVideo.title || currentVideo.displayName,
      sourceUrl: playableUrl,
      sourceUri: currentVideo.uri,
      sourceDisplayName: currentVideo.displayName || 'video.mp4',
      thumbnailUrl: currentVideo.thumbnailUrl || videoThumbnailCache.get(currentVideo.id),
      sourceStart: 0,
      sourceEnd: total,
      maxSourceDuration: total,
      removed: false,
    };
    setSplitSegments([initialSeg]);
    setSelectedTrackType('none');
    setSelectedSplitSegId(null);
    setSelectedAudioSegId(null);
    setSelectedTextId(null);
    setSelectedOverlayId(null);
    setSplitUndoStack([]);
    setSplitRedoStack([]);
    setEditMode('split');

    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
    if (standbyVideoRef.current) {
      standbyVideoRef.current.pause();
      standbyVideoRef.current.removeAttribute('src');
      standbyVideoRef.current.load();
    }

    // Align scroll position cleanly without wasting a duplicate standby decoder until a cut needs it
    window.requestAnimationFrame(() => {
      if (splitTimelineRef.current && videoRef.current) {
        const targetLeft = videoRef.current.currentTime * splitPxPerSec;
        lastProgrammaticScrollLeftRef.current = targetLeft;
        scrollSyncUnlockAtMsRef.current = performance.now() + 90;
        isSyncingTimelineScrollRef.current = true;
        splitTimelineRef.current.scrollLeft = targetLeft;
        window.requestAnimationFrame(() => {
          isSyncingTimelineScrollRef.current = false;
        });
      }
    });
  };

  const commitTimelineState = (
    nextVideo: TimelineClipSegment[],
    nextAudio: TimelineAudioSegment[],
    nextSelectedVideoId?: string | null,
    nextSelectedAudioId?: string | null,
    nextTrackType?: 'none' | 'video' | 'audio' | 'text' | 'overlay',
    nextText?: TimelineTextOverlay[],
    nextSelectedTextId?: string | null,
    nextOverlays?: TimelineOverlayItem[],
    nextSelectedOverlayId?: string | null,
    nextCrop?: VideoCropRect
  ) => {
    standbyPreloadRef.current = null;
    setSplitUndoStack((prev) => [
      ...prev.slice(-19),
      {
        video: splitSegments,
        audio: splitAudioSegments,
        text: splitTextOverlays,
        overlays: splitOverlays,
        crop: mainVideoCrop,
      },
    ]);
    setSplitRedoStack([]);
    setSplitSegments(nextVideo);
    setSplitAudioSegments(nextAudio);
    if (nextText !== undefined) {
      setSplitTextOverlays(nextText);
    }
    if (nextOverlays !== undefined) {
      setSplitOverlays(nextOverlays);
    }
    if (nextCrop !== undefined) {
      setMainVideoCrop(nextCrop);
    }
    if (nextSelectedVideoId !== undefined) {
      setSelectedSplitSegId(nextSelectedVideoId);
    }
    if (nextSelectedAudioId !== undefined) {
      setSelectedAudioSegId(nextSelectedAudioId);
    }
    if (nextSelectedTextId !== undefined) {
      setSelectedTextId(nextSelectedTextId);
    }
    if (nextSelectedOverlayId !== undefined) {
      setSelectedOverlayId(nextSelectedOverlayId);
    }
    if (nextTrackType) {
      setSelectedTrackType(nextTrackType);
    }
    setEditStatusMessage(null);
    setEditErrorMessage(null);
  };

  const handleUndoSplit = () => {
    if (splitUndoStack.length === 0) return;
    standbyPreloadRef.current = null;
    const previous = splitUndoStack[splitUndoStack.length - 1];
    setSplitUndoStack((prev) => prev.slice(0, -1));
    setSplitRedoStack((prev) => [
      ...prev,
      {
        video: splitSegments,
        audio: splitAudioSegments,
        text: splitTextOverlays,
        overlays: splitOverlays,
        crop: mainVideoCrop,
      },
    ]);
    setSplitSegments(previous.video);
    setSplitAudioSegments(previous.audio);
    setSplitTextOverlays(previous.text);
    setSplitOverlays(previous.overlays);
    if (previous.crop) {
      setMainVideoCrop(previous.crop);
    }
    if (!previous.video.some((s) => s.id === selectedSplitSegId)) {
      setSelectedSplitSegId(previous.video[0]?.id || null);
    }
    if (previous.audio.length > 0) {
      const firstAudio = previous.audio[0];
      setSplitCustomAudio({
        id: firstAudio.id,
        title: firstAudio.title,
        displayName: firstAudio.displayName,
        url: firstAudio.sourceUrl,
      });
      if (!previous.audio.some((s) => s.id === selectedAudioSegId)) {
        setSelectedAudioSegId(firstAudio.id);
      }
    } else {
      if (splitAudioRef.current) splitAudioRef.current.pause();
      setSplitCustomAudio(null);
      setSelectedAudioSegId(null);
    }
    if (!previous.text.some((t) => t.id === selectedTextId)) {
      setSelectedTextId(previous.text[0]?.id || null);
    }
    if (!previous.overlays.some((o) => o.id === selectedOverlayId)) {
      setSelectedOverlayId(previous.overlays[0]?.id || null);
    }
    if (
      (selectedTrackType === 'audio' && previous.audio.length === 0) ||
      (selectedTrackType === 'text' && previous.text.length === 0) ||
      (selectedTrackType === 'overlay' && previous.overlays.length === 0)
    ) {
      setSelectedTrackType('none');
    }
    setEditErrorMessage(null);
  };

  const handleRedoSplit = () => {
    if (splitRedoStack.length === 0) return;
    standbyPreloadRef.current = null;
    const nextState = splitRedoStack[splitRedoStack.length - 1];
    setSplitRedoStack((prev) => prev.slice(0, -1));
    setSplitUndoStack((prev) => [
      ...prev,
      {
        video: splitSegments,
        audio: splitAudioSegments,
        text: splitTextOverlays,
        overlays: splitOverlays,
        crop: mainVideoCrop,
      },
    ]);
    setSplitSegments(nextState.video);
    setSplitAudioSegments(nextState.audio);
    setSplitTextOverlays(nextState.text);
    setSplitOverlays(nextState.overlays);
    if (nextState.crop) {
      setMainVideoCrop(nextState.crop);
    }
    if (!nextState.video.some((s) => s.id === selectedSplitSegId)) {
      setSelectedSplitSegId(nextState.video[0]?.id || null);
    }
    if (nextState.audio.length > 0) {
      const firstAudio = nextState.audio[0];
      setSplitCustomAudio({
        id: firstAudio.id,
        title: firstAudio.title,
        displayName: firstAudio.displayName,
        url: firstAudio.sourceUrl,
      });
      if (!nextState.audio.some((s) => s.id === selectedAudioSegId)) {
        setSelectedAudioSegId(firstAudio.id);
      }
    } else {
      if (splitAudioRef.current) splitAudioRef.current.pause();
      setSplitCustomAudio(null);
      setSelectedAudioSegId(null);
    }
    if (!nextState.text.some((t) => t.id === selectedTextId)) {
      setSelectedTextId(nextState.text[0]?.id || null);
    }
    if (!nextState.overlays.some((o) => o.id === selectedOverlayId)) {
      setSelectedOverlayId(nextState.overlays[0]?.id || null);
    }
    if (
      (selectedTrackType === 'audio' && nextState.audio.length === 0) ||
      (selectedTrackType === 'text' && nextState.text.length === 0) ||
      (selectedTrackType === 'overlay' && nextState.overlays.length === 0)
    ) {
      setSelectedTrackType('none');
    }
    setEditErrorMessage(null);
  };

  const handleSplitAtPlayhead = () => {
    if (selectedTrackType === 'overlay' && splitOverlays.length > 0) {
      const getOvEnd = (ov: TimelineOverlayItem) =>
        ov.timelineStart + Math.max(0.3, ov.sourceEnd - ov.sourceStart);
      const target =
        splitOverlays.find(
          (ov) =>
            ov.id === selectedOverlayId &&
            currentTime > ov.timelineStart + 0.15 &&
            currentTime < getOvEnd(ov) - 0.15
        ) ||
        splitOverlays.find(
          (ov) => currentTime > ov.timelineStart + 0.15 && currentTime < getOvEnd(ov) - 0.15
        );
      if (!target) {
        setEditErrorMessage('Move playhead inside the overlay clip before splitting.');
        return;
      }
      const cutTime = Number(currentTime.toFixed(2));
      const offsetInOv = Math.max(0.15, cutTime - target.timelineStart);
      const cutSource = Number((target.sourceStart + offsetInOv).toFixed(2));
      const leftOv: TimelineOverlayItem = {
        ...target,
        id: `ov-L-${Date.now()}`,
        sourceEnd: cutSource,
      };
      const rightOv: TimelineOverlayItem = {
        ...target,
        id: `ov-R-${Date.now()}`,
        timelineStart: cutTime,
        sourceStart: cutSource,
      };
      const idx = splitOverlays.findIndex((ov) => ov.id === target.id);
      const nextOverlays = [
        ...splitOverlays.slice(0, idx),
        leftOv,
        rightOv,
        ...splitOverlays.slice(idx + 1),
      ];
      commitTimelineState(
        splitSegments,
        splitAudioSegments,
        undefined,
        undefined,
        'overlay',
        undefined,
        undefined,
        nextOverlays,
        rightOv.id
      );
      return;
    }

    if (selectedTrackType === 'text' && splitTextOverlays.length > 0) {
      const timelineCap = Math.max(0.5, maxSplitTimelineDuration);
      const getEffectiveEnd = (ov: TimelineTextOverlay) =>
        ov.endTime >= 90000
          ? timelineCap
          : Math.max(ov.startTime + 0.3, Math.min(timelineCap, ov.endTime));
      const target =
        splitTextOverlays.find(
          (ov) =>
            ov.id === selectedTextId &&
            currentTime > ov.startTime + 0.15 &&
            currentTime < getEffectiveEnd(ov) - 0.15
        ) ||
        splitTextOverlays.find(
          (ov) => currentTime > ov.startTime + 0.15 && currentTime < getEffectiveEnd(ov) - 0.15
        );
      if (!target) {
        setEditErrorMessage('Move playhead inside the text clip before splitting.');
        return;
      }
      const cutTime = Number(currentTime.toFixed(2));
      const effectiveEnd = getEffectiveEnd(target);
      const leftText: TimelineTextOverlay = {
        ...target,
        id: `txt-L-${Date.now()}`,
        endTime: cutTime,
        trackRow: target.trackRow ?? 0,
      };
      const rightText: TimelineTextOverlay = {
        ...target,
        id: `txt-R-${Date.now()}`,
        startTime: cutTime,
        endTime: effectiveEnd,
        trackRow: target.trackRow ?? 0,
      };
      const idx = splitTextOverlays.findIndex((ov) => ov.id === target.id);
      const nextText = [
        ...splitTextOverlays.slice(0, idx),
        leftText,
        rightText,
        ...splitTextOverlays.slice(idx + 1),
      ];
      commitTimelineState(
        splitSegments,
        splitAudioSegments,
        undefined,
        undefined,
        'text',
        nextText,
        rightText.id
      );
      return;
    }

    const shouldSplitAudio =
      mappedAudioSegments.length > 0 &&
      (selectedTrackType === 'audio' || currentTime > totalSplitDuration - 0.05);

    if (shouldSplitAudio) {
      const targetIdx = mappedAudioSegments.findIndex(
        (s) => currentTime > s.globalStart + 0.15 && currentTime < s.globalEnd - 0.15
      );
      if (targetIdx < 0) {
        setEditErrorMessage('Move playhead inside the audio clip before splitting.');
        return;
      }
      const mapped = mappedAudioSegments[targetIdx];
      const target = splitAudioSegments[targetIdx];
      const offsetInSeg = currentTime - mapped.globalStart;
      const snappedSourceCut = Number((target.sourceStart + offsetInSeg).toFixed(2));

      const leftAudio: TimelineAudioSegment = {
        ...target,
        id: `aud-L-${Date.now()}`,
        sourceEnd: snappedSourceCut,
      };
      const rightAudio: TimelineAudioSegment = {
        ...target,
        id: `aud-R-${Date.now()}`,
        sourceStart: snappedSourceCut,
      };
      const nextAudio = [
        ...splitAudioSegments.slice(0, targetIdx),
        leftAudio,
        rightAudio,
        ...splitAudioSegments.slice(targetIdx + 1),
      ];
      commitTimelineState(splitSegments, nextAudio, undefined, rightAudio.id, 'audio');
      return;
    }

    const targetIdx = mappedSplitSegments.findIndex(
      (s) => currentTime > s.globalStart + 0.25 && currentTime < s.globalEnd - 0.25
    );
    if (targetIdx < 0) {
      setEditErrorMessage('Move playhead away from clip edges before splitting.');
      return;
    }

    const mapped = mappedSplitSegments[targetIdx];
    const target = splitSegments[targetIdx];
    const offsetInSeg = currentTime - mapped.globalStart;
    const snappedSourceCut = Number((target.sourceStart + offsetInSeg).toFixed(2));

    const leftSeg: TimelineClipSegment = {
      ...target,
      id: `seg-L-${Date.now()}`,
      sourceEnd: snappedSourceCut,
    };
    const rightSeg: TimelineClipSegment = {
      ...target,
      id: `seg-R-${Date.now()}`,
      sourceStart: snappedSourceCut,
    };
    const next = [
      ...splitSegments.slice(0, targetIdx),
      leftSeg,
      rightSeg,
      ...splitSegments.slice(targetIdx + 1),
    ];
    commitTimelineState(next, splitAudioSegments, rightSeg.id, undefined, 'video');
  };

  const handleToggleRemoveSelectedSegment = () => {
    if (selectedTrackType === 'overlay' && splitOverlays.length > 0) {
      const targetId =
        selectedOverlayId ||
        splitOverlays.find(
          (ov) =>
            currentTime >= ov.timelineStart &&
            currentTime <= ov.timelineStart + Math.max(0.3, ov.sourceEnd - ov.sourceStart)
        )?.id ||
        splitOverlays[0]?.id;
      if (!targetId) return;

      const idx = splitOverlays.findIndex((ov) => ov.id === targetId);
      if (idx < 0) return;

      const nextOverlays = splitOverlays.filter((ov) => ov.id !== targetId);
      const nextSelected =
        nextOverlays.length > 0
          ? nextOverlays[Math.min(idx, nextOverlays.length - 1)]?.id || null
          : null;
      commitTimelineState(
        splitSegments,
        splitAudioSegments,
        undefined,
        undefined,
        nextOverlays.length > 0 ? 'overlay' : 'none',
        undefined,
        undefined,
        nextOverlays,
        nextSelected
      );
      return;
    }

    if (selectedTrackType === 'text' && splitTextOverlays.length > 0) {
      const targetId =
        selectedTextId ||
        splitTextOverlays.find((ov) => currentTime >= ov.startTime && currentTime <= ov.endTime)?.id ||
        splitTextOverlays[0]?.id;
      if (!targetId) return;

      const idx = splitTextOverlays.findIndex((ov) => ov.id === targetId);
      if (idx < 0) return;

      const nextText = splitTextOverlays.filter((ov) => ov.id !== targetId);
      const nextSelected =
        nextText.length > 0 ? nextText[Math.min(idx, nextText.length - 1)]?.id || null : null;
      commitTimelineState(
        splitSegments,
        splitAudioSegments,
        undefined,
        undefined,
        nextText.length > 0 ? 'text' : 'none',
        nextText,
        nextSelected
      );
      return;
    }

    if (selectedTrackType === 'audio' && splitAudioSegments.length > 0) {
      const targetId =
        selectedAudioSegId ||
        mappedAudioSegments.find((s) => currentTime >= s.globalStart && currentTime <= s.globalEnd)?.id ||
        splitAudioSegments[0]?.id;
      if (!targetId) return;

      const idx = splitAudioSegments.findIndex((s) => s.id === targetId);
      if (idx < 0) return;

      const nextAudio = splitAudioSegments.filter((s) => s.id !== targetId);
      if (nextAudio.length === 0) {
        if (splitAudioRef.current) splitAudioRef.current.pause();
        setSplitCustomAudio(null);
        commitTimelineState(splitSegments, [], undefined, null, 'none');
        return;
      }

      const nextSelected = nextAudio[Math.min(idx, nextAudio.length - 1)]?.id || null;
      commitTimelineState(splitSegments, nextAudio, undefined, nextSelected, 'audio');
      return;
    }

    const targetId =
      selectedSplitSegId ||
      mappedSplitSegments.find((s) => currentTime >= s.globalStart && currentTime <= s.globalEnd)?.id ||
      null;
    if (!targetId) return;

    const target = mappedSplitSegments.find((s) => s.id === targetId);
    if (!target) return;

    const keptCount = mappedSplitSegments.filter((s) => !s.removed).length;
    if (!target.removed && keptCount <= 1) {
      setEditErrorMessage('Keep at least one clip on the timeline.');
      return;
    }

    const next = splitSegments.map((s) =>
      s.id === targetId ? { ...s, removed: !s.removed } : s
    );
    commitTimelineState(next, splitAudioSegments, targetId, undefined, 'video');

    // If we removed the clip under playhead, jump playhead cleanly to nearest kept clip
    if (!target.removed && currentTime >= target.globalStart && currentTime <= target.globalEnd) {
      let cursor = 0;
      let jumpTo: number | null = null;
      for (const s of next) {
        const len = s.sourceEnd - s.sourceStart;
        if (!s.removed && cursor >= target.globalEnd - 0.05) {
          jumpTo = cursor;
          break;
        }
        cursor += len;
      }
      if (jumpTo === null) {
        cursor = 0;
        for (const s of next) {
          if (!s.removed) {
            jumpTo = cursor;
            break;
          }
          cursor += s.sourceEnd - s.sourceStart;
        }
      }
      if (jumpTo !== null) {
        seekSplitTimelineTo(jumpTo, false);
        if (splitTimelineRef.current) {
          isSyncingTimelineScrollRef.current = true;
          splitTimelineRef.current.scrollLeft = jumpTo * splitPxPerSec;
          window.requestAnimationFrame(() => {
            isSyncingTimelineScrollRef.current = false;
          });
        }
      }
    }
  };

  useEffect(() => {
    if (!isTextEditorOpen || draftTextAnimation === 'none') {
      setAnimPreviewElapsed(2);
      return;
    }
    let rafId = 0;
    const startMs = performance.now();
    const maxRunMs = draftTextAnimation === 'pulse' ? 2400 : 1600;
    const step = (now: number) => {
      const elapsedSec = (now - startMs) / 1000;
      setAnimPreviewElapsed(elapsedSec);
      if (now - startMs < maxRunMs || draftTextAnimation === 'pulse') {
        rafId = window.requestAnimationFrame(step);
      }
    };
    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [isTextEditorOpen, draftTextAnimation, animPreviewTrigger]);

  const openAddTextEditor = (
    existing?: TimelineTextOverlay,
    options?: { row?: number; startAt?: number }
  ) => {
    pauseAllSplitVideos();
    setIsPlaying(false);
    setShowAddMediaMenu(false);
    setActiveSplitPicker('none');
    setActiveTextSection('none');
    if (existing) {
      setSelectedTrackType('text');
      setSelectedTextId(existing.id);
      setDraftTextValue(existing.text);
      setDraftTextColor(existing.color);
      setDraftTextBgStyle(existing.bgStyle);
      setDraftTextBgColor(
        existing.bgStyle === 'none'
          ? undefined
          : existing.bgColor || (existing.bgStyle === 'solid' ? '#ffffff' : '#111827')
      );
      setDraftTextFont(existing.fontFamily || 'sans');
      setDraftTextStyleEffect(existing.textStyle || 'clean');
      setDraftTextAnimation(existing.animation || 'none');
      setDraftTextSize(existing.fontSize >= 32 ? 34 : existing.fontSize <= 22 ? 20 : 26);
      setDraftTextRow(existing.trackRow ?? 0);
      setDraftTextInsertStart(null);
      const isWhole =
        existing.startTime <= 0.05 &&
        (existing.endTime >= 90000 || existing.endTime >= Math.max(0.5, maxSplitTimelineDuration) - 0.1);
      setDraftTextTiming(isWhole ? 'all' : 'custom');
    } else {
      setSelectedTextId(null);
      setDraftTextValue('');
      setDraftTextColor('#ffffff');
      setDraftTextBgStyle('none');
      setDraftTextBgColor(undefined);
      setDraftTextFont('sans');
      setDraftTextStyleEffect('clean');
      setDraftTextAnimation('none');
      setDraftTextSize(26);

      const timelineCap = Math.max(0.5, maxSplitTimelineDuration);
      const maxRow = splitTextOverlays.reduce((m, t) => Math.max(m, t.trackRow ?? 0), -1);
      if (options?.row !== undefined) {
        setDraftTextRow(options.row);
        if (options.startAt !== undefined) {
          setDraftTextInsertStart(options.startAt);
          setDraftTextTiming('4s');
        } else {
          setDraftTextInsertStart(null);
          setDraftTextTiming('all');
        }
      } else if (splitTextOverlays.length === 0) {
        setDraftTextRow(0);
        setDraftTextInsertStart(null);
        setDraftTextTiming('all');
      } else {
        // Pick first row without an overlapping text block near playhead, or place on a new line below
        let freeRow = -1;
        for (let r = 0; r <= maxRow; r++) {
          const overlaps = splitTextOverlays.some((t) => {
            if ((t.trackRow ?? 0) !== r) return false;
            const end = t.endTime >= 90000 ? timelineCap : t.endTime;
            return currentTime >= t.startTime - 0.05 && currentTime < end - 0.05;
          });
          if (!overlaps) {
            freeRow = r;
            break;
          }
        }
        if (freeRow >= 0) {
          setDraftTextRow(freeRow);
          setDraftTextInsertStart(Number(Math.min(timelineCap - 0.5, currentTime).toFixed(2)));
          setDraftTextTiming('4s');
        } else {
          setDraftTextRow(maxRow + 1);
          setDraftTextInsertStart(null);
          setDraftTextTiming('4s');
        }
      }
    }
    setIsTextEditorOpen(true);
  };

  const handleSaveTextOverlay = () => {
    const clean = draftTextValue.trim();
    if (!clean) {
      if (selectedTextId) {
        const nextText = splitTextOverlays.filter((item) => item.id !== selectedTextId);
        commitTimelineState(
          splitSegments,
          splitAudioSegments,
          undefined,
          undefined,
          nextText.length > 0 ? 'text' : 'none',
          nextText,
          nextText[0]?.id || null
        );
      } else {
        setSelectedTextId(null);
      }
      setIsTextEditorOpen(false);
      return;
    }

    const timelineCap = Number(Math.max(0.5, maxSplitTimelineDuration).toFixed(2));
    const existingItem = selectedTextId
      ? splitTextOverlays.find((item) => item.id === selectedTextId)
      : undefined;

    let startTime = 0;
    let endTime = timelineCap;
    if (draftTextTiming === 'custom' && existingItem) {
      startTime = Math.max(0, Math.min(timelineCap - 0.3, existingItem.startTime));
      endTime =
        existingItem.endTime >= 90000
          ? timelineCap
          : Math.max(startTime + 0.3, Math.min(timelineCap, existingItem.endTime));
    } else if (draftTextTiming === '4s') {
      const baseStart = draftTextInsertStart !== null ? draftTextInsertStart : currentTime;
      startTime = Number(Math.max(0, Math.min(timelineCap - 0.3, baseStart)).toFixed(2));
      endTime = Number(Math.min(timelineCap, startTime + 4.0).toFixed(2));
    }

    if (selectedTextId && existingItem) {
      const nextText = splitTextOverlays.map((item) =>
        item.id === selectedTextId
          ? {
              ...item,
              text: clean,
              color: draftTextColor,
              bgStyle: draftTextBgStyle,
              bgColor: draftTextBgStyle === 'none' ? undefined : draftTextBgColor,
              fontFamily: draftTextFont,
              textStyle: draftTextStyleEffect,
              animation: draftTextAnimation,
              fontSize: draftTextSize,
              startTime,
              endTime,
              trackRow: draftTextRow,
            }
          : item
      );
      commitTimelineState(
        splitSegments,
        splitAudioSegments,
        undefined,
        undefined,
        'text',
        nextText,
        selectedTextId
      );
    } else {
      const sameRowShift =
        draftTextRow > 0
          ? Math.min(0.28, draftTextRow * 0.09)
          : Math.min(0.24, splitTextOverlays.length * 0.06);
      const newOverlay: TimelineTextOverlay = {
        id: `txt-${Date.now()}`,
        text: clean,
        x: 0.5,
        y: Math.min(0.84, 0.5 + sameRowShift),
        color: draftTextColor,
        bgStyle: draftTextBgStyle,
        bgColor: draftTextBgStyle === 'none' ? undefined : draftTextBgColor,
        fontFamily: draftTextFont,
        textStyle: draftTextStyleEffect,
        animation: draftTextAnimation,
        fontSize: draftTextSize,
        startTime,
        endTime,
        trackRow: draftTextRow,
      };
      const nextText = [...splitTextOverlays, newOverlay];
      commitTimelineState(
        splitSegments,
        splitAudioSegments,
        undefined,
        undefined,
        'text',
        nextText,
        newOverlay.id
      );
    }

    setIsTextEditorOpen(false);
  };

  const handleDeleteTextOverlay = (id: string) => {
    const nextText = splitTextOverlays.filter((item) => item.id !== id);
    const nextSel =
      selectedTextId === id ? nextText[0]?.id || null : selectedTextId;
    commitTimelineState(
      splitSegments,
      splitAudioSegments,
      undefined,
      undefined,
      nextText.length > 0 ? 'text' : 'none',
      nextText,
      nextSel
    );
    setIsTextEditorOpen(false);
  };

  // Load phone audio songs when opening Add Sound modal
  const openAudioPickerModal = async () => {
    setShowAddMediaMenu(false);
    setActiveSplitPicker('audio');
    if (!isNativeAndroid() || deviceSongs.length > 0) return;

    setIsLoadingAudioPicker(true);
    try {
      const res = await AudioLibrary.getAllAudioFiles();
      if (res.granted) {
        setAudioPermissionDenied(false);
        setDeviceSongs(res.songs || []);
      } else {
        setAudioPermissionDenied(true);
      }
    } catch (err) {
      console.error('Failed to load phone songs:', err);
    } finally {
      setIsLoadingAudioPicker(false);
    }
  };

  const loadDeviceImages = async () => {
    if (!isNativeAndroid()) return;
    setIsLoadingImagePicker(true);
    try {
      const res = await AudioLibrary.getAllImageFiles();
      if (res.granted) {
        setImagePermissionDenied(false);
        setDeviceImages(res.images || []);
      } else {
        setImagePermissionDenied(true);
      }
    } catch (err) {
      console.error('Failed to load phone images:', err);
    } finally {
      setIsLoadingImagePicker(false);
    }
  };

  const openAddVideoPickerModal = () => {
    setShowAddMediaMenu(false);
    setActiveSplitPicker('video');
    if (isNativeAndroid() && videos.length === 0) {
      void loadDeviceVideos();
    }
  };

  const openAddImagePickerModal = () => {
    setShowAddMediaMenu(false);
    setActiveSplitPicker('image');
    if (isNativeAndroid() && deviceImages.length === 0) {
      void loadDeviceImages();
    }
  };

  const openOverlayPickerModal = () => {
    setShowAddMediaMenu(false);
    setActiveSplitPicker('overlay');
    if (isNativeAndroid()) {
      if (videos.length === 0) void loadDeviceVideos();
      if (deviceImages.length === 0) void loadDeviceImages();
    }
  };

  const addOverlayVideoToTimeline = async (vid: VideoTrackItem) => {
    setIsPreparingSplitMedia(true);
    try {
      let playableUrl = vid.webUrl || '';
      if (!playableUrl && isNativeAndroid()) {
        const prepared = await AudioLibrary.prepareMediaFile({
          uri: vid.uri,
          displayName: vid.displayName || vid.title,
          mediaKind: 'video',
          keepAlive: true,
        });
        playableUrl = resolvePlayableAudioUrl(prepared);
      }
      if (!playableUrl) throw new Error('Overlay video source unavailable');

      const clipDur =
        vid.durationMs > 200 ? vid.durationMs / 1000 : await readVideoDurationFromUrl(playableUrl);
      const maxVidDur = Math.max(0.5, Number(clipDur.toFixed(2)));
      const insertAt = Math.max(0, Number(currentTime.toFixed(2)));
      const stagger = (splitOverlays.length % 3) * 0.06;

      const newOverlay: TimelineOverlayItem = {
        id: `ov-vid-${Date.now()}`,
        mediaType: 'video',
        title: vid.title || vid.displayName || 'Overlay Video',
        sourceUrl: playableUrl,
        sourceUri: vid.uri,
        thumbnailUrl: vid.thumbnailUrl || videoThumbnailCache.get(vid.id),
        sourceStart: 0,
        sourceEnd: maxVidDur,
        maxSourceDuration: maxVidDur,
        timelineStart: insertAt,
        x: Math.min(0.78, 0.5 + stagger),
        y: Math.min(0.78, 0.5 - stagger),
        scale: 0.42,
        rotation: 0,
        muted: false,
      };
      const nextOverlays = [...splitOverlays, newOverlay];
      commitTimelineState(
        splitSegments,
        splitAudioSegments,
        undefined,
        undefined,
        'overlay',
        undefined,
        undefined,
        nextOverlays,
        newOverlay.id
      );
      setActiveSplitPicker('none');
    } catch (err) {
      console.error('Failed to add overlay video:', err);
      setEditErrorMessage('Could not add selected overlay video.');
    } finally {
      setIsPreparingSplitMedia(false);
    }
  };

  const handleUploadOverlayVideoFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const url = URL.createObjectURL(file);
    webObjectUrlsRef.current.push(url);
    const title = file.name.replace(/\.[^/.]+$/, '');
    const dur = await readVideoDurationFromUrl(url);
    const newVideoItem: VideoTrackItem = {
      id: `upload-ov-vid-${Date.now()}`,
      title,
      displayName: file.name,
      durationMs: Math.round(dur * 1000),
      size: file.size,
      mimeType: file.type || 'video/mp4',
      resolution: '',
      uri: url,
      webUrl: url,
    };
    setVideos((prev) => [newVideoItem, ...prev]);
    await addOverlayVideoToTimeline(newVideoItem);
  };

  const addOverlayImageToTimeline = async (img: ImageTrackItem) => {
    setIsPreparingSplitMedia(true);
    try {
      let playableUrl = img.webUrl || '';
      if (!playableUrl && isNativeAndroid()) {
        const prepared = await AudioLibrary.prepareMediaFile({
          uri: img.uri,
          displayName: img.displayName || img.title,
          mediaKind: 'image',
          keepAlive: true,
        });
        playableUrl = resolvePlayableAudioUrl(prepared);
      }
      if (!playableUrl) throw new Error('Overlay photo source unavailable');

      const insertAt = Math.max(0, Number(currentTime.toFixed(2)));
      const stagger = (splitOverlays.length % 3) * 0.06;
      const defaultDur = Math.max(
        1.5,
        Math.min(4.0, Math.max(0.5, totalSplitDuration - insertAt) || 4.0)
      );

      const newOverlay: TimelineOverlayItem = {
        id: `ov-img-${Date.now()}`,
        mediaType: 'image',
        title: img.title || img.displayName || 'Overlay Photo',
        sourceUrl: playableUrl,
        sourceUri: img.uri,
        thumbnailUrl: img.thumbnailUrl || imageThumbnailCache.get(img.id) || playableUrl,
        sourceStart: 0,
        sourceEnd: Number(defaultDur.toFixed(2)),
        maxSourceDuration: 60,
        timelineStart: insertAt,
        x: Math.min(0.78, 0.5 + stagger),
        y: Math.min(0.78, 0.5 - stagger),
        scale: 0.4,
        rotation: 0,
        muted: true,
      };
      const nextOverlays = [...splitOverlays, newOverlay];
      commitTimelineState(
        splitSegments,
        splitAudioSegments,
        undefined,
        undefined,
        'overlay',
        undefined,
        undefined,
        nextOverlays,
        newOverlay.id
      );
      setActiveSplitPicker('none');
    } catch (err) {
      console.error('Failed to add overlay photo:', err);
      setEditErrorMessage('Could not add selected overlay photo.');
    } finally {
      setIsPreparingSplitMedia(false);
    }
  };

  const handleUploadOverlayImageFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const url = URL.createObjectURL(file);
    webObjectUrlsRef.current.push(url);
    const title = file.name.replace(/\.[^/.]+$/, '');
    const newImgItem: ImageTrackItem = {
      id: `upload-ov-img-${Date.now()}`,
      title,
      displayName: file.name,
      width: 0,
      height: 0,
      size: file.size,
      mimeType: file.type || 'image/*',
      uri: url,
      webUrl: url,
      thumbnailUrl: url,
    };
    setDeviceImages((prev) => [newImgItem, ...prev]);
    await addOverlayImageToTimeline(newImgItem);
  };

  const handleSelectReplacementAudio = async (song: AudioTrackItem) => {
    setIsPreparingSplitMedia(true);
    try {
      let playableUrl = song.webUrl || '';
      if (!playableUrl && isNativeAndroid()) {
        const prepared = await AudioLibrary.prepareMediaFile({
          uri: song.uri,
          displayName: song.displayName || song.title,
          mediaKind: 'audio',
          keepAlive: true,
        });
        playableUrl = resolvePlayableAudioUrl(prepared);
      }
      if (!playableUrl) throw new Error('Audio source unavailable');

      const audioDur =
        song.durationMs > 300
          ? Number((song.durationMs / 1000).toFixed(2))
          : await readAudioDurationFromUrl(playableUrl);

      const title = song.title || song.displayName;
      const initialAudioSeg: TimelineAudioSegment = {
        id: `aud-0-${Date.now()}`,
        title,
        displayName: song.displayName,
        sourceUrl: playableUrl,
        sourceStart: 0,
        sourceEnd: audioDur,
        maxSourceDuration: audioDur,
      };
      setSplitCustomAudio({
        id: song.id,
        title,
        displayName: song.displayName,
        url: playableUrl,
      });
      lastActiveAudioSegIdRef.current = null;
      commitTimelineState(splitSegments, [initialAudioSeg], undefined, initialAudioSeg.id, 'audio');
      setActiveSplitPicker('none');
    } catch (err) {
      console.error('Failed to load replacement audio:', err);
      setEditErrorMessage('Could not load selected audio file.');
    } finally {
      setIsPreparingSplitMedia(false);
    }
  };

  const handleUploadReplacementAudioFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const url = URL.createObjectURL(file);
    webObjectUrlsRef.current.push(url);
    const title = file.name.replace(/\.[^/.]+$/, '');
    const audioDur = await readAudioDurationFromUrl(url);
    const uploadedTrack: AudioTrackItem = {
      id: `upload-audio-${Date.now()}`,
      title,
      displayName: file.name,
      artist: 'Uploaded Audio',
      album: '',
      durationMs: Math.round(audioDur * 1000),
      size: file.size,
      mimeType: file.type || 'audio/*',
      uri: url,
      webUrl: url,
    };
    const initialAudioSeg: TimelineAudioSegment = {
      id: `aud-0-${Date.now()}`,
      title,
      displayName: file.name,
      sourceUrl: url,
      sourceStart: 0,
      sourceEnd: audioDur,
      maxSourceDuration: audioDur,
    };
    setDeviceSongs((prev) => [uploadedTrack, ...prev]);
    setSplitCustomAudio({
      id: uploadedTrack.id,
      title,
      displayName: file.name,
      url,
    });
    lastActiveAudioSegIdRef.current = null;
    commitTimelineState(splitSegments, [initialAudioSeg], undefined, initialAudioSeg.id, 'audio');
    setActiveSplitPicker('none');
  };

  const appendVideoToTimeline = async (vid: VideoTrackItem) => {
    setIsPreparingSplitMedia(true);
    try {
      let playableUrl = vid.webUrl || '';
      if (!playableUrl && isNativeAndroid()) {
        const prepared = await AudioLibrary.prepareMediaFile({
          uri: vid.uri,
          displayName: vid.displayName || vid.title,
          mediaKind: 'video',
          keepAlive: true,
        });
        playableUrl = resolvePlayableAudioUrl(prepared);
      }
      if (!playableUrl) throw new Error('Video source unavailable');

      const clipDur =
        vid.durationMs > 200 ? vid.durationMs / 1000 : await readVideoDurationFromUrl(playableUrl);

      const maxVidDur = Math.max(0.5, Number(clipDur.toFixed(2)));
      const newSeg: TimelineClipSegment = {
        id: `seg-vid-${Date.now()}`,
        mediaType: 'video',
        title: vid.title || vid.displayName,
        sourceUrl: playableUrl,
        sourceUri: vid.uri,
        sourceDisplayName: vid.displayName || 'video.mp4',
        thumbnailUrl: vid.thumbnailUrl || videoThumbnailCache.get(vid.id),
        sourceStart: 0,
        sourceEnd: maxVidDur,
        maxSourceDuration: maxVidDur,
        removed: false,
      };
      const prevTotal = totalSplitDuration;
      const next = [...splitSegments, newSeg];
      commitTimelineState(next, splitAudioSegments, newSeg.id, undefined, 'video');
      setActiveSplitPicker('none');
      window.requestAnimationFrame(() => {
        setCurrentTime(prevTotal);
        if (splitTimelineRef.current) {
          isSyncingTimelineScrollRef.current = true;
          splitTimelineRef.current.scrollLeft = prevTotal * splitPxPerSec;
          window.requestAnimationFrame(() => {
            isSyncingTimelineScrollRef.current = false;
          });
        }
      });
    } catch (err) {
      console.error('Failed to add video clip:', err);
      setEditErrorMessage('Could not add selected video to timeline.');
    } finally {
      setIsPreparingSplitMedia(false);
    }
  };

  const handleUploadExtraVideoFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const url = URL.createObjectURL(file);
    webObjectUrlsRef.current.push(url);
    const title = file.name.replace(/\.[^/.]+$/, '');
    const dur = await readVideoDurationFromUrl(url);
    const newVideoItem: VideoTrackItem = {
      id: `upload-vid-${Date.now()}`,
      title,
      displayName: file.name,
      durationMs: Math.round(dur * 1000),
      size: file.size,
      mimeType: file.type || 'video/mp4',
      resolution: '',
      uri: url,
      webUrl: url,
    };
    setVideos((prev) => [newVideoItem, ...prev]);
    await appendVideoToTimeline(newVideoItem);
  };

  const appendImageToTimeline = async (img: ImageTrackItem) => {
    setIsPreparingSplitMedia(true);
    try {
      let playableUrl = img.webUrl || '';
      if (!playableUrl && isNativeAndroid()) {
        const prepared = await AudioLibrary.prepareMediaFile({
          uri: img.uri,
          displayName: img.displayName || img.title,
          mediaKind: 'image',
          keepAlive: true,
        });
        playableUrl = resolvePlayableAudioUrl(prepared);
      }
      if (!playableUrl) throw new Error('Image source unavailable');

      const newSeg: TimelineClipSegment = {
        id: `seg-img-${Date.now()}`,
        mediaType: 'image',
        title: img.title || img.displayName,
        sourceUrl: playableUrl,
        sourceUri: img.uri,
        sourceDisplayName: img.displayName || 'image.jpg',
        thumbnailUrl: img.thumbnailUrl || imageThumbnailCache.get(img.id) || playableUrl,
        sourceStart: 0,
        sourceEnd: 3.0,
        maxSourceDuration: 30,
        removed: false,
      };
      const prevTotal = totalSplitDuration;
      const next = [...splitSegments, newSeg];
      commitTimelineState(next, splitAudioSegments, newSeg.id, undefined, 'video');
      setActiveSplitPicker('none');
      window.requestAnimationFrame(() => {
        setCurrentTime(prevTotal);
        if (splitTimelineRef.current) {
          isSyncingTimelineScrollRef.current = true;
          splitTimelineRef.current.scrollLeft = prevTotal * splitPxPerSec;
          window.requestAnimationFrame(() => {
            isSyncingTimelineScrollRef.current = false;
          });
        }
      });
    } catch (err) {
      console.error('Failed to add image clip:', err);
      setEditErrorMessage('Could not add selected image to timeline.');
    } finally {
      setIsPreparingSplitMedia(false);
    }
  };

  const handleUploadExtraImageFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const url = URL.createObjectURL(file);
    webObjectUrlsRef.current.push(url);
    const title = file.name.replace(/\.[^/.]+$/, '');
    const newImgItem: ImageTrackItem = {
      id: `upload-img-${Date.now()}`,
      title,
      displayName: file.name,
      width: 0,
      height: 0,
      size: file.size,
      mimeType: file.type || 'image/*',
      uri: url,
      webUrl: url,
      thumbnailUrl: url,
    };
    setDeviceImages((prev) => [newImgItem, ...prev]);
    await appendImageToTimeline(newImgItem);
  };

  const filteredDeviceSongs = useMemo(() => {
    const q = audioPickerSearch.trim().toLowerCase();
    if (!q) return deviceSongs;
    return deviceSongs.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.displayName.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q)
    );
  }, [deviceSongs, audioPickerSearch]);

  const filteredPickerVideos = useMemo(() => {
    const q = videoPickerSearch.trim().toLowerCase();
    if (!q) return videos;
    return videos.filter(
      (v) => v.title.toLowerCase().includes(q) || v.displayName.toLowerCase().includes(q)
    );
  }, [videos, videoPickerSearch]);

  const filteredDeviceImages = useMemo(() => {
    const q = imagePickerSearch.trim().toLowerCase();
    if (!q) return deviceImages;
    return deviceImages.filter(
      (img) => img.title.toLowerCase().includes(q) || img.displayName.toLowerCase().includes(q)
    );
  }, [deviceImages, imagePickerSearch]);

  const seekVideoTo = (sec: number) => {
    const total = getLiveDuration();
    const clamped = Math.max(0, Math.min(total || 0, sec));
    setCurrentTime(clamped);
    if (videoRef.current) {
      videoRef.current.currentTime = clamped;
    }
  };

  const handlePreviewTrim = async () => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    // Enter isolated Preview Cut screen and start playback cleanly at trimStart (0:00 of trimmed video)
    setIsPreviewingTrim(true);
    setEditStatusMessage(null);
    setEditErrorMessage(null);

    try {
      if (Math.abs(videoEl.currentTime - trimStart) > 0.02) {
        setIsMaskingTrimSeek(true);
        videoEl.currentTime = trimStart;
      }
      setCurrentTime(trimStart);
      onPlaybackStarted();
      await videoEl.play();
      setIsPlaying(true);
      setIsMaskingTrimSeek(false);
    } catch (err) {
      if (!isMediaAbortError(err)) {
        console.warn('Preview trim playback error:', err);
      }
      setIsMaskingTrimSeek(false);
    }
  };

  const handleExecuteLosslessTrim = async () => {
    if (!currentVideo || isProcessingEdit) return;
    const total = getLiveDuration();
    const startSec = Math.max(0, Math.min(trimStart, total - 0.2));
    const endSec = Math.max(startSec + 0.2, Math.min(trimEnd, total));

    if (endSec - startSec < 0.2) {
      setEditErrorMessage('Selected segment must be at least 0.2 seconds long.');
      return;
    }

    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
    setIsPreviewingTrim(false);
    setIsProcessingEdit(true);
    setEditErrorMessage(null);
    setEditStatusMessage(null);

    try {
      if (isNativeAndroid()) {
        const res = await AudioLibrary.trimVideoLossless({
          uri: currentVideo.uri,
          displayName: currentVideo.displayName,
          title: currentVideo.title,
          startMs: Math.round(startSec * 1000),
          endMs: Math.round(endSec * 1000),
        });
        if (res?.video) {
          setVideos((prev) => [res.video, ...prev]);
          setLastSavedClip(res.video);
        }
        setEditStatusMessage(`Saved trimmed original-quality clip to ${res.displayPath}`);
      } else {
        const srcUrl = currentVideo.webUrl || videoRef.current?.currentSrc;
        if (!srcUrl) {
          throw new Error('Video source is unavailable.');
        }
        const clip = await trimVideoBlobLossless(
          srcUrl,
          startSec,
          endSec,
          currentVideo.title || currentVideo.displayName
        );
        const clipUrl = URL.createObjectURL(clip.blob);
        webObjectUrlsRef.current.push(clipUrl);
        triggerWebVideoDownload(clip.blob, clip.fileName);

        const newItem: VideoTrackItem = {
          id: `web-trim-${Date.now()}`,
          title: `${currentVideo.title || currentVideo.displayName} (Trimmed)`,
          displayName: clip.fileName,
          durationMs: clip.durationMs,
          size: clip.blob.size,
          mimeType: 'video/mp4',
          resolution: currentVideo.resolution,
          uri: clipUrl,
          webUrl: clipUrl,
        };
        setVideos((prev) => [newItem, ...prev]);
        setLastSavedClip(newItem);
        setEditStatusMessage(`Trimmed without quality loss · Downloaded ${clip.fileName}`);
      }
    } catch (err) {
      console.error('Lossless trim failed:', err);
      setEditErrorMessage(
        err instanceof Error && err.message
          ? err.message
          : 'Could not trim video without quality loss.'
      );
    } finally {
      setIsProcessingEdit(false);
    }
  };

  const handleSaveSplitTimeline = async () => {
    if (!currentVideo || isProcessingEdit) return;
    const keptSegments = splitSegments.filter((s) => !s.removed && s.sourceEnd - s.sourceStart > 0.1);
    const removedCount = splitSegments.filter((s) => s.removed).length;
    const hasExtraClips = splitSegments.some(
      (s) => s.mediaType === 'image' || s.sourceUri !== currentVideo.uri
    );
    const hasTrimmedHandles = splitSegments.some(
      (s) => s.sourceStart > 0.05 || s.sourceEnd < s.maxSourceDuration - 0.05
    );
    const hasChanges =
      removedCount > 0 ||
      splitSegments.length > 1 ||
      hasExtraClips ||
      hasTrimmedHandles ||
      Boolean(splitCustomAudio) ||
      splitAudioSegments.length > 0 ||
      isMuted ||
      splitTextOverlays.length > 0 ||
      splitOverlays.length > 0 ||
      isCropModified(mainVideoCrop);

    if (keptSegments.length === 0) {
      setEditErrorMessage('Keep at least one clip before saving.');
      return;
    }

    if (!hasChanges) {
      setEditErrorMessage('Pull handles, Split, Crop video, Audio, Text, Overlay, or + to edit first.');
      return;
    }

    pauseAllSplitVideos();
    setIsPlaying(false);

    setIsProcessingEdit(true);
    setExportProgressPct(null);
    setEditErrorMessage(null);
    setEditStatusMessage(null);

    try {
      // Fast 100% lossless zero-re-encoding path when only original video bounds/cuts change without text/audio/extra media
      if (canExportSplitLossless) {
        if (removedCount === 0 && keptSegments.length === 2 && !hasTrimmedHandles) {
          const cutSec = keptSegments[0].sourceEnd;
          if (isNativeAndroid()) {
            const res = await AudioLibrary.splitVideoLossless({
              uri: currentVideo.uri,
              displayName: currentVideo.displayName,
              title: currentVideo.title,
              splitMs: Math.round(cutSec * 1000),
              keepPart: 'both',
            });
            const newItems = res?.videos || [];
            if (newItems.length > 0) {
              setVideos((prev) => [...newItems, ...prev]);
              setLastSavedClip(newItems[0]);
            }
            setEditStatusMessage('Split into 2 original-quality clips in Movies/Mo Vibe/');
          } else {
            const srcUrl = mainVideoUrlRef.current || currentVideo.webUrl || videoRef.current?.currentSrc;
            if (!srcUrl) throw new Error('Video source is unavailable.');
            const clips = await splitVideoBlobLossless(
              srcUrl,
              cutSec,
              'both',
              currentVideo.title || currentVideo.displayName
            );
            const addedItems: VideoTrackItem[] = clips.map((clip, i) => {
              const clipUrl = URL.createObjectURL(clip.blob);
              webObjectUrlsRef.current.push(clipUrl);
              window.setTimeout(() => triggerWebVideoDownload(clip.blob, clip.fileName), i * 250);
              return {
                id: `web-split-${Date.now()}-${i}`,
                title: `${currentVideo.title || currentVideo.displayName} (${clip.partLabel || `Part ${i + 1}`})`,
                displayName: clip.fileName,
                durationMs: clip.durationMs,
                size: clip.blob.size,
                mimeType: 'video/mp4',
                resolution: currentVideo.resolution,
                uri: clipUrl,
                webUrl: clipUrl,
              };
            });
            if (addedItems.length > 0) {
              setVideos((prev) => [...addedItems, ...prev]);
              setLastSavedClip(addedItems[0]);
            }
            setEditStatusMessage(`Saved ${clips.length} split parts in original quality`);
          }
          return;
        }

        if (isNativeAndroid()) {
          const res = await AudioLibrary.exportVideoSegmentsLossless({
            uri: currentVideo.uri,
            displayName: currentVideo.displayName,
            title: currentVideo.title,
            segments: keptSegments.map((s) => ({
              startMs: Math.round(s.sourceStart * 1000),
              endMs: Math.round(s.sourceEnd * 1000),
            })),
          });
          if (res?.video) {
            setVideos((prev) => [res.video, ...prev]);
            setLastSavedClip(res.video);
          }
          setEditStatusMessage(`Saved edited original-quality video to ${res.displayPath}`);
        } else {
          const srcUrl = mainVideoUrlRef.current || currentVideo.webUrl || videoRef.current?.currentSrc;
          if (!srcUrl) throw new Error('Video source is unavailable.');
          const clip = await exportVideoSegmentsBlobLossless(
            srcUrl,
            keptSegments.map((s) => ({ startSec: s.sourceStart, endSec: s.sourceEnd })),
            currentVideo.title || currentVideo.displayName
          );
          const clipUrl = URL.createObjectURL(clip.blob);
          webObjectUrlsRef.current.push(clipUrl);
          triggerWebVideoDownload(clip.blob, clip.fileName);

          const newItem: VideoTrackItem = {
            id: `web-edited-${Date.now()}`,
            title: `${currentVideo.title || currentVideo.displayName} (Edited)`,
            displayName: clip.fileName,
            durationMs: clip.durationMs,
            size: clip.blob.size,
            mimeType: 'video/mp4',
            resolution: currentVideo.resolution,
            uri: clipUrl,
            webUrl: clipUrl,
          };
          setVideos((prev) => [newItem, ...prev]);
          setLastSavedClip(newItem);
          setEditStatusMessage(`Saved original-quality video · Downloaded ${clip.fileName}`);
        }
        return;
      }

      // Composed export path (text overlays, replaced/muted audio, added videos, or added images)
      setExportProgressPct(1);
      const composed = await composeSplitTimelineBlob(
        keptSegments.map((s) => ({
          mediaType: s.mediaType,
          sourceUrl: s.sourceUrl,
          sourceStart: s.sourceStart,
          sourceEnd: s.sourceEnd,
        })),
        {
          baseTitle: currentVideo.title || currentVideo.displayName,
          videoMuted: isMuted,
          customAudioUrl: splitCustomAudio?.url || null,
          customAudioClips:
            splitAudioSegments.length > 0
              ? splitAudioSegments.map((a) => ({
                  sourceUrl: a.sourceUrl,
                  sourceStart: a.sourceStart,
                  sourceEnd: a.sourceEnd,
                }))
              : undefined,
          textOverlays: splitTextOverlays,
          overlayClips: splitOverlays.map((o) => ({
            id: o.id,
            mediaType: o.mediaType,
            sourceUrl: o.sourceUrl,
            sourceStart: o.sourceStart,
            sourceEnd: o.sourceEnd,
            timelineStart: o.timelineStart,
            x: o.x,
            y: o.y,
            scale: o.scale,
            rotation: o.rotation || 0,
            muted: o.muted,
          })),
          mainVideoCrop: isCropModified(mainVideoCrop) ? mainVideoCrop : undefined,
          onProgress: (pct) => setExportProgressPct(pct),
        }
      );

      const savedTitle = `${currentVideo.title || currentVideo.displayName} (Edited)`;
      const savedRes = await saveExportedVideoBlob(
        composed.blob,
        composed.fileName,
        savedTitle,
        composed.durationMs,
        composed.resolution
      );

      if (savedRes.video) {
        setVideos((prev) => [savedRes.video!, ...prev]);
        setLastSavedClip(savedRes.video);
      } else {
        const clipUrl = URL.createObjectURL(composed.blob);
        webObjectUrlsRef.current.push(clipUrl);
        const newItem: VideoTrackItem = {
          id: `web-mix-${Date.now()}`,
          title: savedTitle,
          displayName: composed.fileName,
          durationMs: composed.durationMs,
          size: composed.blob.size,
          mimeType: composed.mimeType,
          resolution: composed.resolution,
          uri: clipUrl,
          webUrl: clipUrl,
        };
        setVideos((prev) => [newItem, ...prev]);
        setLastSavedClip(newItem);
      }
      setEditStatusMessage(`Saved edited video to ${savedRes.displayPath}`);
    } catch (err) {
      console.error('Split export failed:', err);
      setEditErrorMessage(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save edited video.'
      );
    } finally {
      setIsProcessingEdit(false);
      setExportProgressPct(null);
    }
  };

  const handleWebFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const added: VideoTrackItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const url = URL.createObjectURL(file);
      webObjectUrlsRef.current.push(url);
      added.push({
        id: `web-video-${Date.now()}-${i}`,
        title: file.name.replace(/\.[^/.]+$/, ''),
        displayName: file.name,
        durationMs: 0,
        size: file.size,
        mimeType: file.type || 'video/*',
        resolution: '',
        uri: url,
        webUrl: url,
      });
    }
    setVideos((prev) => [...added, ...prev]);
    if (added[0]) {
      void playVideoItem(added[0]);
    }
  };

  return (
    <div className="space-y-5 min-w-0">
      <input
        ref={webFileInputRef}
        type="file"
        accept="video/*,.mp4,.webm,.mov,.mkv,.m4v"
        multiple
        className="hidden"
        onChange={(e) => {
          handleWebFilesSelected(e.target.files);
          e.target.value = '';
        }}
      />

      <input
        ref={splitAudioUploadInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
        className="hidden"
        onChange={(e) => {
          void handleUploadReplacementAudioFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <input
        ref={splitAddVideoInputRef}
        type="file"
        accept="video/*,.mp4,.webm,.mov,.mkv,.m4v"
        className="hidden"
        onChange={(e) => {
          void handleUploadExtraVideoFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <input
        ref={splitAddImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void handleUploadExtraImageFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <input
        ref={splitOverlayVideoInputRef}
        type="file"
        accept="video/*,.mp4,.webm,.mov,.mkv,.m4v"
        className="hidden"
        onChange={(e) => {
          void handleUploadOverlayVideoFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <input
        ref={splitOverlayImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void handleUploadOverlayImageFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <audio
        ref={splitAudioRef}
        src={splitCustomAudio?.url || undefined}
        preload="auto"
        className="hidden"
      />

      {/* VLC-Style Full-Viewport Video Player Screen (Zero Scrolling) */}
      <div
        ref={playerContainerRef}
        onClick={(e) => {
          if (editMode !== 'split') return;
          if (!(e.target as HTMLElement).closest('[data-keep-selection="true"]')) {
            clearTimelineSelection();
          }
        }}
        className={
          isPlayerOpen
            ? 'fixed inset-0 z-50 bg-black flex flex-col w-full h-full overflow-hidden select-none'
            : 'hidden'
        }
      >
        {/* TikTok-Style Top Studio Header when Split Editor is open */}
        {editMode === 'split' && (
          <div className="shrink-0 flex items-center justify-between gap-2 px-3.5 sm:px-5 pt-3 pb-2 bg-black z-30">
            <button
              type="button"
              onClick={exitSplitToPlayer}
              className="w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer shrink-0 transition-colors"
              title="Back to Player"
              aria-label="Back to Video Player"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <div className="min-w-0 text-center px-2">
              <p className="text-xs font-semibold text-white truncate">
                {splitSegments.length > 1
                  ? `${splitSegments.filter((s) => !s.removed).length} kept · ${
                      splitSegments.filter((s) => s.removed).length
                    } removed`
                  : 'Scroll & Split video'}
              </p>
              <p className="text-[10px] font-mono tabular-nums text-slate-400">
                {isProcessingEdit && exportProgressPct !== null
                  ? `Exporting video... ${exportProgressPct}%`
                  : canExportSplitLossless
                  ? 'Original quality · No re-encoding'
                  : splitTextOverlays.length > 0
                  ? 'Text, audio & media mix'
                  : 'Custom audio & media mix'}
              </p>
            </div>

            <button
              type="button"
              data-keep-selection="true"
              onClick={() => void handleSaveSplitTimeline()}
              disabled={isProcessingEdit}
              className="min-h-[44px] px-4 rounded-full bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shrink-0 transition-colors whitespace-nowrap"
              title="Export Video"
              aria-label="Export Edited Video"
            >
              {isProcessingEdit ? (
                <div className="w-4 h-4 border-2 border-slate-900/30 border-t-slate-950 rounded-full animate-spin" />
              ) : (
                <>
                  <span>Export</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        )}

        {/* Video Viewport Stage */}
        <div
          className={`relative flex-1 min-h-0 w-full flex items-center justify-center bg-black overflow-hidden ${
            editMode === 'split' ? 'px-5 sm:px-10 py-1' : ''
          }`}
          onClick={() => {
            if (editMode === 'split') {
              if (isMainCropActive) return;
              if (selectedTrackType !== 'none') {
                clearTimelineSelection();
                return;
              }
              void handleTogglePlayPause();
            } else if (isPreviewingTrim) {
              void handleTogglePlayPause();
            } else {
              setShowControls((prev) => !prev);
            }
          }}
        >
          {(() => {
            const cropWFrac = Math.max(0.1, mainVideoCrop.right - mainVideoCrop.left);
            const cropHFrac = Math.max(0.1, mainVideoCrop.bottom - mainVideoCrop.top);
            const cropAppliedView =
              editMode === 'split' && !isMainCropActive && isCropModified(mainVideoCrop);

            let croppedFrameStyle: React.CSSProperties | undefined;
            if (cropAppliedView && splitStageSize.w > 0 && splitStageSize.h > 0) {
              const targetAspect =
                ((mainMediaDims.w || 16) * cropWFrac) /
                Math.max(1, (mainMediaDims.h || 9) * cropHFrac);
              const availAspect = splitStageSize.w / Math.max(1, splitStageSize.h);
              const frameW =
                targetAspect > availAspect
                  ? splitStageSize.w
                  : splitStageSize.h * targetAspect;
              const frameH =
                targetAspect > availAspect
                  ? splitStageSize.w / targetAspect
                  : splitStageSize.h;
              croppedFrameStyle = {
                width: `${Math.max(60, Math.round(frameW))}px`,
                height: `${Math.max(60, Math.round(frameH))}px`,
              };
            }

            const pushOverlayUndoSnapshot = (beforeOverlays: TimelineOverlayItem[]) => {
              setSplitUndoStack((prev) => [
                ...prev.slice(-19),
                {
                  video: splitSegments,
                  audio: splitAudioSegments,
                  text: splitTextOverlays,
                  overlays: beforeOverlays,
                  crop: mainVideoCrop,
                },
              ]);
              setSplitRedoStack([]);
            };

            const openMainVideoCropMode = () => {
              if (isPlaying) {
                pauseAllSplitVideos();
                setIsPlaying(false);
              }
              setSelectedTrackType('video');
              setShowAddMediaMenu(false);
              setIsTextEditorOpen(false);
              cropSnapshotBeforeEditRef.current = mainVideoCrop;
              const curEl = getActiveSplitVideoEl();
              if (curEl && curEl.videoWidth > 0 && curEl.videoHeight > 0) {
                setMainMediaDims({ w: curEl.videoWidth, h: curEl.videoHeight });
              }
              setIsMainCropActive(true);
            };

            const applyCropAspectPreset = (preset: CropAspectPreset) => {
              setActiveCropAspect(preset);
              const opt = CROP_ASPECT_OPTIONS.find((o) => o.id === preset);
              if (!opt || opt.ratio === null) return;
              const mediaRatio = (mainMediaDims.w || 16) / Math.max(1, mainMediaDims.h || 9);
              const desiredFracRatio = opt.ratio / mediaRatio;
              const wFrac = desiredFracRatio >= 1 ? 1 : Math.max(0.15, desiredFracRatio);
              const hFrac = desiredFracRatio >= 1 ? Math.max(0.15, 1 / desiredFracRatio) : 1;
              const cx = (mainVideoCrop.left + mainVideoCrop.right) / 2;
              const cy = (mainVideoCrop.top + mainVideoCrop.bottom) / 2;
              const left = Number(Math.max(0, Math.min(1 - wFrac, cx - wFrac / 2)).toFixed(4));
              const top = Number(Math.max(0, Math.min(1 - hFrac, cy - hFrac / 2)).toFixed(4));
              setMainVideoCrop({
                left,
                top,
                right: Number((left + wFrac).toFixed(4)),
                bottom: Number((top + hFrac).toFixed(4)),
              });
            };

            const startCropPointerDrag = (
              e: React.PointerEvent<HTMLDivElement>,
              mode: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e'
            ) => {
              e.stopPropagation();
              e.preventDefault();
              const frameEl = mediaFrameRef.current;
              if (!frameEl) return;
              const rect = frameEl.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) return;

              const startX = e.clientX;
              const startY = e.clientY;
              const orig = { ...mainVideoCrop };
              const minSize = 0.15;
              const opt = CROP_ASPECT_OPTIONS.find((o) => o.id === activeCropAspect);
              const mediaRatio = (mainMediaDims.w || 16) / Math.max(1, mainMediaDims.h || 9);
              const lockedFracRatio = opt && opt.ratio !== null ? opt.ratio / mediaRatio : null;

              const onMove = (ev: PointerEvent) => {
                const dx = (ev.clientX - startX) / rect.width;
                const dy = (ev.clientY - startY) / rect.height;

                if (mode === 'move') {
                  const w = orig.right - orig.left;
                  const h = orig.bottom - orig.top;
                  const left = Math.max(0, Math.min(1 - w, orig.left + dx));
                  const top = Math.max(0, Math.min(1 - h, orig.top + dy));
                  setMainVideoCrop({
                    left: Number(left.toFixed(4)),
                    top: Number(top.toFixed(4)),
                    right: Number((left + w).toFixed(4)),
                    bottom: Number((top + h).toFixed(4)),
                  });
                  return;
                }

                let left = orig.left;
                let top = orig.top;
                let right = orig.right;
                let bottom = orig.bottom;

                if (mode.includes('w')) left = Math.max(0, Math.min(orig.right - minSize, orig.left + dx));
                if (mode.includes('e')) right = Math.min(1, Math.max(orig.left + minSize, orig.right + dx));
                if (mode.includes('n')) top = Math.max(0, Math.min(orig.bottom - minSize, orig.top + dy));
                if (mode.includes('s')) bottom = Math.min(1, Math.max(orig.top + minSize, orig.bottom + dy));

                if (lockedFracRatio && (mode === 'nw' || mode === 'ne' || mode === 'sw' || mode === 'se')) {
                  const w = right - left;
                  let h = w / lockedFracRatio;
                  if (mode.includes('n')) {
                    if (orig.bottom - h < 0) {
                      h = orig.bottom;
                      const adjW = h * lockedFracRatio;
                      if (mode.includes('w')) left = Math.max(0, orig.right - adjW);
                      else right = Math.min(1, orig.left + adjW);
                    }
                    top = Math.max(0, orig.bottom - h);
                  } else {
                    if (orig.top + h > 1) {
                      h = 1 - orig.top;
                      const adjW = h * lockedFracRatio;
                      if (mode.includes('w')) left = Math.max(0, orig.right - adjW);
                      else right = Math.min(1, orig.left + adjW);
                    }
                    bottom = Math.min(1, orig.top + h);
                  }
                }

                setMainVideoCrop({
                  left: Number(left.toFixed(4)),
                  top: Number(top.toFixed(4)),
                  right: Number(right.toFixed(4)),
                  bottom: Number(bottom.toFixed(4)),
                });
              };

              const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onUp);
              };

              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onUp);
              window.addEventListener('pointercancel', onUp);
            };

            return (
              <div
                ref={splitFitContainerRef}
                className={
                  editMode === 'split'
                    ? 'relative w-full h-full flex items-center justify-center min-h-0'
                    : 'w-full h-full flex items-center justify-center'
                }
              >
                {/* Tight media wrapper in Split mode so WYSIWYG overlay/text coordinates match exported video */}
                <div
                  ref={mediaFrameRef}
                  style={
                    croppedFrameStyle ||
                    (editMode === 'split' && splitStageSize.w > 0 && splitStageSize.h > 0
                      ? {
                          maxWidth: `${Math.floor(splitStageSize.w)}px`,
                          maxHeight: `${Math.floor(splitStageSize.h)}px`,
                        }
                      : undefined)
                  }
                  onClick={(e) => {
                    if (editMode === 'split') {
                      e.stopPropagation();
                      if (!isMainCropActive) {
                        openMainVideoCropMode();
                      }
                    }
                  }}
                  className={
                    editMode === 'split'
                      ? `relative inline-flex items-center justify-center max-w-full max-h-full overflow-hidden rounded-xl ${
                          isMainCropActive ? 'cursor-default' : 'cursor-pointer'
                        }`
                      : 'w-full h-full flex items-center justify-center'
                  }
                >
                  {/* Cropped Main Media Viewport Inner Wrapper */}
                  <div
                    style={
                      cropAppliedView
                        ? {
                            position: 'absolute',
                            left: `${-(mainVideoCrop.left / cropWFrac) * 100}%`,
                            top: `${-(mainVideoCrop.top / cropHFrac) * 100}%`,
                            width: `${(1 / cropWFrac) * 100}%`,
                            height: `${(1 / cropHFrac) * 100}%`,
                          }
                        : undefined
                    }
                    className={
                      cropAppliedView
                        ? 'pointer-events-none'
                        : 'contents'
                    }
                  >
                    {/* Image clip preview when Split playhead stands on an added Image */}
                    {editMode === 'split' && activeSplitSegAtPlayhead?.mediaType === 'image' && (
                      <img
                        src={activeSplitSegAtPlayhead.sourceUrl}
                        alt={activeSplitSegAtPlayhead.title}
                        onLoad={(e) => {
                          const img = e.currentTarget;
                          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                            setMainMediaDims({ w: img.naturalWidth, h: img.naturalHeight });
                          }
                        }}
                        className={
                          cropAppliedView
                            ? 'relative z-10 block w-full h-full object-contain rounded-xl'
                            : 'relative z-10 block max-w-full max-h-full w-auto h-auto rounded-xl object-contain'
                        }
                      />
                    )}

                    {/* Deck A (Primary Video Element) */}
                    <video
                      ref={videoRef}
                      playsInline
                      preload="auto"
                      onTimeUpdate={() => {
                        const el = videoRef.current;
                        if (!el) return;
                        const now = el.currentTime;
                        const { editMode: mode, trimStart: start, trimEnd: end } = trimBoundsRef.current;
                        if (mode === 'split') {
                          return;
                        }
                        if (mode === 'trim' && end > start) {
                          if (now >= end) {
                            el.pause();
                            el.currentTime = end;
                            setCurrentTime(end);
                            setIsPlaying(false);
                            return;
                          }
                          if (now < start - 0.1 && !el.paused) {
                            el.currentTime = start;
                            setCurrentTime(start);
                            return;
                          }
                        }
                        setCurrentTime(now);
                      }}
                      onSeeked={() => {
                        setIsMaskingTrimSeek(false);
                        const el = videoRef.current;
                        if (!el) return;
                        if (trimBoundsRef.current.editMode === 'split') {
                          seekStuckSinceMsRef.current.A = 0;
                          const pending = pendingDeckSeekRef.current.A;
                          if (pending && !pending.awaitingMetadata && deckUrlsRef.current.A === pending.sourceUrl) {
                            pendingDeckSeekRef.current.A = null;
                            const isActive = activeSplitDeckRef.current === 'A';
                            if (pending.autoPlay && isActive && trimBoundsRef.current.isPlaying) {
                              el.muted = trimBoundsRef.current.isMuted;
                              el.playbackRate = trimBoundsRef.current.playbackSpeed;
                              tryPlayDeckEl('A', el);
                            }
                          } else if (
                            activeSplitDeckRef.current === 'A' &&
                            trimBoundsRef.current.isPlaying &&
                            el.paused
                          ) {
                            el.muted = trimBoundsRef.current.isMuted;
                            el.playbackRate = trimBoundsRef.current.playbackSpeed;
                            tryPlayDeckEl('A', el);
                          }
                          if (
                            activeSplitDeckRef.current !== 'A' &&
                            standbyPreloadRef.current?.deck === 'A' &&
                            Math.abs(el.currentTime - standbyPreloadRef.current.sourceTime) <= 0.15
                          ) {
                            standbyPreloadRef.current.ready = true;
                          }
                        }
                      }}
                      onLoadedMetadata={() => {
                        const el = videoRef.current;
                        if (!el) return;
                        if (el.videoWidth > 0 && el.videoHeight > 0) {
                          setMainMediaDims({ w: el.videoWidth, h: el.videoHeight });
                        }
                        const pending = pendingDeckSeekRef.current.A;
                        if (
                          trimBoundsRef.current.editMode === 'split' &&
                          pending &&
                          deckUrlsRef.current.A === pending.sourceUrl
                        ) {
                          if (Math.abs(el.currentTime - pending.sourceTime) > 0.04) {
                            el.currentTime = pending.sourceTime;
                          }
                          const isActive = activeSplitDeckRef.current === 'A';
                          el.muted = isActive ? trimBoundsRef.current.isMuted : true;
                          el.playbackRate = trimBoundsRef.current.playbackSpeed;
                          if (el.seeking) {
                            pendingDeckSeekRef.current.A = { ...pending, awaitingMetadata: false };
                          } else {
                            pendingDeckSeekRef.current.A = null;
                            if (pending.autoPlay && isActive && trimBoundsRef.current.isPlaying) {
                              tryPlayDeckEl('A', el);
                            } else if (!isActive) {
                              el.pause();
                            }
                          }
                          return;
                        }
                        if (trimBoundsRef.current.editMode !== 'split' && isFinite(el.duration) && el.duration > 0) {
                          setDuration(el.duration);
                          setTrimEnd((prev) => (prev <= 0 ? el.duration : Math.min(prev, el.duration)));
                        }
                      }}
                      onPlay={() => {
                        if (trimBoundsRef.current.editMode === 'split') {
                          if (activeSplitDeckRef.current !== 'A') return;
                          onPlaybackStarted();
                          setIsPlaying(true);
                          return;
                        }
                        const el = videoRef.current;
                        const { editMode: mode, trimStart: start, trimEnd: end } = trimBoundsRef.current;
                        if (el && mode === 'trim' && end > start) {
                          if (el.currentTime < start - 0.05 || el.currentTime >= end - 0.05) {
                            el.currentTime = start;
                            setCurrentTime(start);
                          }
                        }
                        onPlaybackStarted();
                        setIsPlaying(true);
                      }}
                      onPause={() => {
                        if (trimBoundsRef.current.editMode !== 'split') {
                          setIsPlaying(false);
                        }
                      }}
                      onEnded={() => {
                        if (trimBoundsRef.current.editMode !== 'split') {
                          const scope = videoPlaybackScopeRef.current;
                          if (scope.type === 'playlist' && trimBoundsRef.current.editMode === 'none') {
                            const folderPool = resolveVideoScopeQueue(scope);
                            const idx = currentVideo
                              ? folderPool.findIndex((v) => v.id === currentVideo.id)
                              : -1;
                            if (idx >= 0 && idx < folderPool.length - 1) {
                              void playVideoItem(folderPool[idx + 1], scope);
                              return;
                            }
                          }
                          setIsPlaying(false);
                          setShowControls(true);
                        }
                      }}
                      className={`bg-black ${
                        editMode === 'split'
                          ? activeSplitSegAtPlayhead?.mediaType !== 'image' && activeSplitDeck === 'A'
                            ? cropAppliedView
                              ? 'relative z-10 block w-full h-full rounded-xl object-contain opacity-100'
                              : 'relative z-10 block max-w-full max-h-full w-auto h-auto rounded-xl object-contain opacity-100'
                            : 'absolute inset-0 z-0 w-full h-full rounded-xl object-contain opacity-0 pointer-events-none'
                          : `transition-opacity duration-75 w-full h-full ${
                              fitMode === 'cover' ? 'object-cover' : 'object-contain'
                            } ${isMaskingTrimSeek ? 'opacity-0' : 'opacity-100'}`
                      }`}
                    />

                    {/* Deck B (Standby Pre-Seeked Video Element for Zero-Stall Split Cuts) */}
                    {editMode === 'split' && (
                      <video
                        ref={standbyVideoRef}
                        playsInline
                        preload="auto"
                        onSeeked={() => {
                          const el = standbyVideoRef.current;
                          if (!el) return;
                          seekStuckSinceMsRef.current.B = 0;
                          const pending = pendingDeckSeekRef.current.B;
                          if (pending && !pending.awaitingMetadata && deckUrlsRef.current.B === pending.sourceUrl) {
                            pendingDeckSeekRef.current.B = null;
                            const isActive = activeSplitDeckRef.current === 'B';
                            if (pending.autoPlay && isActive && trimBoundsRef.current.isPlaying) {
                              el.muted = trimBoundsRef.current.isMuted;
                              el.playbackRate = trimBoundsRef.current.playbackSpeed;
                              tryPlayDeckEl('B', el);
                            }
                          } else if (
                            activeSplitDeckRef.current === 'B' &&
                            trimBoundsRef.current.isPlaying &&
                            el.paused
                          ) {
                            el.muted = trimBoundsRef.current.isMuted;
                            el.playbackRate = trimBoundsRef.current.playbackSpeed;
                            tryPlayDeckEl('B', el);
                          }
                          if (
                            activeSplitDeckRef.current !== 'B' &&
                            standbyPreloadRef.current?.deck === 'B' &&
                            Math.abs(el.currentTime - standbyPreloadRef.current.sourceTime) <= 0.15
                          ) {
                            standbyPreloadRef.current.ready = true;
                          }
                        }}
                        onLoadedMetadata={() => {
                          const el = standbyVideoRef.current;
                          if (!el) return;
                          if (el.videoWidth > 0 && el.videoHeight > 0 && activeSplitDeckRef.current === 'B') {
                            setMainMediaDims({ w: el.videoWidth, h: el.videoHeight });
                          }
                          const pending = pendingDeckSeekRef.current.B;
                          if (pending && deckUrlsRef.current.B === pending.sourceUrl) {
                            if (Math.abs(el.currentTime - pending.sourceTime) > 0.04) {
                              el.currentTime = pending.sourceTime;
                            }
                            const isActive = activeSplitDeckRef.current === 'B';
                            el.muted = isActive ? trimBoundsRef.current.isMuted : true;
                            el.playbackRate = trimBoundsRef.current.playbackSpeed;
                            if (el.seeking) {
                              pendingDeckSeekRef.current.B = { ...pending, awaitingMetadata: false };
                            } else {
                              pendingDeckSeekRef.current.B = null;
                              if (pending.autoPlay && isActive && trimBoundsRef.current.isPlaying) {
                                tryPlayDeckEl('B', el);
                              } else if (!isActive) {
                                el.pause();
                              }
                            }
                          }
                        }}
                        onPlay={() => {
                          if (activeSplitDeckRef.current !== 'B') return;
                          onPlaybackStarted();
                          setIsPlaying(true);
                        }}
                        className={`bg-black ${
                          activeSplitSegAtPlayhead?.mediaType !== 'image' && activeSplitDeck === 'B'
                            ? cropAppliedView
                              ? 'relative z-10 block w-full h-full rounded-xl object-contain opacity-100'
                              : 'relative z-10 block max-w-full max-h-full w-auto h-auto rounded-xl object-contain opacity-100'
                            : 'absolute inset-0 z-0 w-full h-full rounded-xl object-contain opacity-0 pointer-events-none'
                        }`}
                      />
                    )}
                  </div>

                  {/* Subtle top-right Crop shortcut indicator when in Split mode */}
                  {editMode === 'split' && !isMainCropActive && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openMainVideoCropMode();
                      }}
                      className={`absolute top-2 left-2 z-20 px-2 py-1 rounded-lg backdrop-blur-md text-[10px] font-semibold flex items-center gap-1 border shadow cursor-pointer transition-colors ${
                        isCropModified(mainVideoCrop)
                          ? 'bg-emerald-500/85 border-emerald-300/60 text-white'
                          : 'bg-black/55 hover:bg-black/75 border-white/20 text-white/85'
                      }`}
                      title="Tap video or here to crop main video"
                    >
                      <Crop className="w-3 h-3" />
                      <span>{isCropModified(mainVideoCrop) ? 'Cropped' : 'Crop'}</span>
                    </button>
                  )}

                  {/* Interactive Main Video Crop Box Overlay */}
                  {editMode === 'split' && isMainCropActive && (
                    <div
                      data-keep-selection="true"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="absolute inset-0 z-30 select-none touch-none"
                    >
                      {/* 4 Dimmed Masks Outside Crop Rect */}
                      <div
                        style={{
                          left: 0,
                          top: 0,
                          right: 0,
                          height: `${mainVideoCrop.top * 100}%`,
                        }}
                        className="absolute bg-black/65 pointer-events-none"
                      />
                      <div
                        style={{
                          left: 0,
                          top: `${mainVideoCrop.bottom * 100}%`,
                          right: 0,
                          bottom: 0,
                        }}
                        className="absolute bg-black/65 pointer-events-none"
                      />
                      <div
                        style={{
                          left: 0,
                          top: `${mainVideoCrop.top * 100}%`,
                          width: `${mainVideoCrop.left * 100}%`,
                          height: `${(mainVideoCrop.bottom - mainVideoCrop.top) * 100}%`,
                        }}
                        className="absolute bg-black/65 pointer-events-none"
                      />
                      <div
                        style={{
                          left: `${mainVideoCrop.right * 100}%`,
                          top: `${mainVideoCrop.top * 100}%`,
                          right: 0,
                          height: `${(mainVideoCrop.bottom - mainVideoCrop.top) * 100}%`,
                        }}
                        className="absolute bg-black/65 pointer-events-none"
                      />

                      {/* Draggable Active Crop Frame */}
                      <div
                        onPointerDown={(e) => startCropPointerDrag(e, 'move')}
                        style={{
                          left: `${mainVideoCrop.left * 100}%`,
                          top: `${mainVideoCrop.top * 100}%`,
                          width: `${(mainVideoCrop.right - mainVideoCrop.left) * 100}%`,
                          height: `${(mainVideoCrop.bottom - mainVideoCrop.top) * 100}%`,
                        }}
                        className="absolute border-2 border-emerald-400 shadow-[0_0_0_1px_rgba(0,0,0,0.65)] cursor-move"
                      >
                        {/* Rule of thirds grid */}
                        <div className="absolute inset-0 pointer-events-none">
                          <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/30" />
                          <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/30" />
                          <div className="absolute top-1/3 left-0 right-0 h-px bg-white/30" />
                          <div className="absolute top-2/3 left-0 right-0 h-px bg-white/30" />
                        </div>

                        {/* 4 Corner Handles */}
                        <div
                          onPointerDown={(e) => startCropPointerDrag(e, 'nw')}
                          className="absolute -top-3 -left-3 w-7 h-7 flex items-center justify-center cursor-nwse-resize"
                        >
                          <div className="w-3.5 h-3.5 border-t-[3px] border-l-[3px] border-white rounded-tl-sm shadow" />
                        </div>
                        <div
                          onPointerDown={(e) => startCropPointerDrag(e, 'ne')}
                          className="absolute -top-3 -right-3 w-7 h-7 flex items-center justify-center cursor-nesw-resize"
                        >
                          <div className="w-3.5 h-3.5 border-t-[3px] border-r-[3px] border-white rounded-tr-sm shadow" />
                        </div>
                        <div
                          onPointerDown={(e) => startCropPointerDrag(e, 'sw')}
                          className="absolute -bottom-3 -left-3 w-7 h-7 flex items-center justify-center cursor-nesw-resize"
                        >
                          <div className="w-3.5 h-3.5 border-b-[3px] border-l-[3px] border-white rounded-bl-sm shadow" />
                        </div>
                        <div
                          onPointerDown={(e) => startCropPointerDrag(e, 'se')}
                          className="absolute -bottom-3 -right-3 w-7 h-7 flex items-center justify-center cursor-nwse-resize"
                        >
                          <div className="w-3.5 h-3.5 border-b-[3px] border-r-[3px] border-white rounded-br-sm shadow" />
                        </div>

                        {/* 4 Edge Midpoint Handles */}
                        <div
                          onPointerDown={(e) => startCropPointerDrag(e, 'n')}
                          className="absolute -top-2 left-1/2 -translate-x-1/2 w-10 h-4 flex items-center justify-center cursor-ns-resize"
                        >
                          <div className="w-6 h-1 rounded-full bg-white shadow" />
                        </div>
                        <div
                          onPointerDown={(e) => startCropPointerDrag(e, 's')}
                          className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-10 h-4 flex items-center justify-center cursor-ns-resize"
                        >
                          <div className="w-6 h-1 rounded-full bg-white shadow" />
                        </div>
                        <div
                          onPointerDown={(e) => startCropPointerDrag(e, 'w')}
                          className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-10 flex items-center justify-center cursor-ew-resize"
                        >
                          <div className="h-6 w-1 rounded-full bg-white shadow" />
                        </div>
                        <div
                          onPointerDown={(e) => startCropPointerDrag(e, 'e')}
                          className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-10 flex items-center justify-center cursor-ew-resize"
                        >
                          <div className="h-6 w-1 rounded-full bg-white shadow" />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Interactive Picture-in-Picture Media Overlays (Videos & Photos) on Split Stage */}
                  {editMode === 'split' &&
                    splitOverlays.map((ov) => {
                      const isDraggingTrim = activeOverlayTrimDrag?.id === ov.id;
                      const isDraggingMove = activeOverlayMoveDrag?.id === ov.id;
                      const liveTlStart = isDraggingTrim
                        ? activeOverlayTrimDrag.liveTimelineStart
                        : isDraggingMove
                        ? activeOverlayMoveDrag.liveTimelineStart
                        : ov.timelineStart;
                      const liveSrcStart = isDraggingTrim
                        ? activeOverlayTrimDrag.liveSourceStart
                        : ov.sourceStart;
                      const liveSrcEnd = isDraggingTrim
                        ? activeOverlayTrimDrag.liveSourceEnd
                        : ov.sourceEnd;
                      const ovEnd = liveTlStart + Math.max(0.1, liveSrcEnd - liveSrcStart);
                      const hasAdjacentNextOv = splitOverlays.some(
                        (o) =>
                          o.id !== ov.id &&
                          o.mediaType === 'video' &&
                          Math.abs(o.timelineStart - ovEnd) < 0.05
                      );
                      const isVisible =
                        !isMainCropActive &&
                        currentTime >= liveTlStart - 0.005 &&
                        (currentTime < ovEnd - 0.005 ||
                          (!hasAdjacentNextOv && Math.abs(currentTime - ovEnd) <= 0.02));
                      const isSelectedOv =
                        selectedTrackType === 'overlay' && selectedOverlayId === ov.id;
                      const rotDeg = ov.rotation || 0;

                      return (
                        <div
                          key={ov.id}
                          data-keep-selection="true"
                          ref={(el) => {
                            overlayBoxRefs.current[ov.id] = el;
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onTouchStart={(e) => {
                            if (e.touches.length === 2) {
                              e.stopPropagation();
                              const t1 = e.touches[0];
                              const t2 = e.touches[1];
                              setIsMainCropActive(false);
                              setSelectedTrackType('overlay');
                              setSelectedOverlayId(ov.id);
                              overlayPinchRef.current = {
                                id: ov.id,
                                startDist: Math.max(12, Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)),
                                startAngle: Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX),
                                origScale: ov.scale,
                                origRotation: ov.rotation || 0,
                                snapshot: splitOverlays,
                              };
                            }
                          }}
                          onTouchMove={(e) => {
                            const pinch = overlayPinchRef.current;
                            if (!pinch || pinch.id !== ov.id || e.touches.length !== 2) return;
                            e.stopPropagation();
                            const t1 = e.touches[0];
                            const t2 = e.touches[1];
                            const curDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                            const curAngle = Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
                            const nextScale = Math.max(
                              0.18,
                              Math.min(1.85, Number((pinch.origScale * (curDist / pinch.startDist)).toFixed(3)))
                            );
                            const deltaDeg = ((curAngle - pinch.startAngle) * 180) / Math.PI;
                            const nextRot = snapCardinalDeg(pinch.origRotation + deltaDeg);
                            setSplitOverlays((prev) =>
                              prev.map((item) =>
                                item.id === ov.id
                                  ? { ...item, scale: nextScale, rotation: nextRot }
                                  : item
                              )
                            );
                          }}
                          onTouchEnd={(e) => {
                            if (overlayPinchRef.current?.id === ov.id && e.touches.length < 2) {
                              pushOverlayUndoSnapshot(overlayPinchRef.current.snapshot);
                              overlayPinchRef.current = null;
                            }
                          }}
                          onPointerDown={(e) => {
                            if ((e.target as HTMLElement).closest('[data-overlay-control="true"]')) {
                              return;
                            }
                            if (overlayPinchRef.current) return;
                            e.stopPropagation();
                            setIsMainCropActive(false);
                            const startX = e.clientX;
                            const startY = e.clientY;
                            const origX = ov.x;
                            const origY = ov.y;
                            const snapshotBeforeMove = splitOverlays;
                            let moved = false;
                            setSelectedTrackType('overlay');
                            setSelectedOverlayId(ov.id);

                            const onMove = (ev: PointerEvent) => {
                              if (overlayPinchRef.current) return;
                              const rect = mediaFrameRef.current?.getBoundingClientRect();
                              if (!rect || rect.width <= 0 || rect.height <= 0) return;
                              const dx = ev.clientX - startX;
                              const dy = ev.clientY - startY;
                              if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                                moved = true;
                              }
                              if (!moved) return;
                              const nextX = Math.max(0.05, Math.min(0.95, origX + dx / rect.width));
                              const nextY = Math.max(0.05, Math.min(0.95, origY + dy / rect.height));
                              setSplitOverlays((prev) =>
                                prev.map((item) =>
                                  item.id === ov.id ? { ...item, x: nextX, y: nextY } : item
                                )
                              );
                            };

                            const onUp = () => {
                              window.removeEventListener('pointermove', onMove);
                              window.removeEventListener('pointerup', onUp);
                              window.removeEventListener('pointercancel', onUp);
                              if (moved) {
                                pushOverlayUndoSnapshot(snapshotBeforeMove);
                              }
                            };

                            window.addEventListener('pointermove', onMove);
                            window.addEventListener('pointerup', onUp);
                            window.addEventListener('pointercancel', onUp);
                          }}
                          style={{
                            left: `${ov.x * 100}%`,
                            top: `${ov.y * 100}%`,
                            width: `${Number((ov.scale * 100).toFixed(2))}%`,
                            transform: `translate(-50%, -50%) rotate(${rotDeg}deg)`,
                          }}
                          className={`absolute z-[15] rounded-xl overflow-visible select-none touch-none cursor-grab active:cursor-grabbing transition-opacity duration-75 ${
                            isVisible
                              ? 'opacity-100 pointer-events-auto'
                              : 'opacity-0 pointer-events-none'
                          }`}
                        >
                          <div
                            className={`relative w-full min-h-[36px] rounded-xl overflow-hidden bg-black/40 shadow-2xl ${
                              isSelectedOv
                                ? 'ring-2 ring-violet-400'
                                : 'ring-1 ring-white/25'
                            }`}
                          >
                            {ov.mediaType === 'video' ? (
                              <video
                                ref={(el) => {
                                  overlayVideoElsRef.current[ov.id] = el;
                                }}
                                src={ov.sourceUrl}
                                playsInline
                                preload="auto"
                                muted={ov.muted}
                                onLoadedMetadata={(e) => {
                                  const v = e.currentTarget;
                                  if (
                                    v.readyState >= 1 &&
                                    !v.seeking &&
                                    Math.abs(v.currentTime - ov.sourceStart) > 0.08 &&
                                    !trimBoundsRef.current.isPlaying
                                  ) {
                                    v.currentTime = ov.sourceStart;
                                  }
                                }}
                                className="w-full h-auto max-h-[70vh] block object-contain pointer-events-none select-none bg-black"
                              />
                            ) : (
                              <img
                                src={ov.sourceUrl}
                                alt={ov.title}
                                draggable={false}
                                className="w-full h-auto max-h-[70vh] block object-contain pointer-events-none select-none"
                              />
                            )}
                          </div>

                          {/* Live Angle / Size HUD Pill during active gesture */}
                          {activeOverlayGesture?.id === ov.id && (
                            <div
                              style={{ transform: `rotate(${-rotDeg}deg)` }}
                              className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-slate-950/90 border border-violet-400/60 text-violet-200 text-[10px] font-semibold tabular-nums whitespace-nowrap shadow-lg pointer-events-none z-30"
                            >
                              {activeOverlayGesture.valueLabel}
                            </div>
                          )}

                          {isSelectedOv && isVisible && (
                            <>
                              {/* Top-right compact Rotate +90° / Mute / Delete actions */}
                              <div
                                data-overlay-control="true"
                                className="absolute -top-3.5 -right-2.5 flex items-center gap-1 z-20"
                              >
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const nextRot = normalizeDeg360((ov.rotation || 0) + 90);
                                    const nextOverlays = splitOverlays.map((item) =>
                                      item.id === ov.id ? { ...item, rotation: nextRot } : item
                                    );
                                    commitTimelineState(
                                      splitSegments,
                                      splitAudioSegments,
                                      undefined,
                                      undefined,
                                      'overlay',
                                      undefined,
                                      undefined,
                                      nextOverlays,
                                      ov.id
                                    );
                                  }}
                                  className="w-7 h-7 rounded-full bg-slate-950/90 border border-white/25 text-white flex items-center justify-center shadow-lg cursor-pointer"
                                  title="Rotate overlay 90°"
                                  aria-label="Rotate overlay 90 degrees"
                                >
                                  <RotateCw className="w-3.5 h-3.5 text-violet-300" />
                                </button>
                                {ov.mediaType === 'video' && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const nextMuted = !ov.muted;
                                      const el = overlayVideoElsRef.current[ov.id];
                                      if (el) el.muted = nextMuted;
                                      setSplitOverlays((prev) =>
                                        prev.map((item) =>
                                          item.id === ov.id ? { ...item, muted: nextMuted } : item
                                        )
                                      );
                                    }}
                                    className="w-7 h-7 rounded-full bg-slate-950/90 border border-white/25 text-white flex items-center justify-center shadow-lg cursor-pointer"
                                    title={ov.muted ? 'Unmute overlay video' : 'Mute overlay video'}
                                    aria-label={ov.muted ? 'Unmute overlay video' : 'Mute overlay video'}
                                  >
                                    {ov.muted ? (
                                      <VolumeX className="w-3.5 h-3.5 text-red-300" />
                                    ) : (
                                      <Volume2 className="w-3.5 h-3.5 text-violet-300" />
                                    )}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const nextOverlays = splitOverlays.filter((item) => item.id !== ov.id);
                                    commitTimelineState(
                                      splitSegments,
                                      splitAudioSegments,
                                      undefined,
                                      undefined,
                                      nextOverlays.length > 0 ? 'overlay' : 'none',
                                      undefined,
                                      undefined,
                                      nextOverlays,
                                      nextOverlays[0]?.id || null
                                    );
                                  }}
                                  className="w-7 h-7 rounded-full bg-red-600/95 border border-white/25 text-white flex items-center justify-center shadow-lg cursor-pointer"
                                  title="Remove overlay"
                                  aria-label="Remove overlay"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              {/* Bottom-center Free-Rotate Handle */}
                              <div
                                data-overlay-control="true"
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const boxEl = overlayBoxRefs.current[ov.id];
                                  if (!boxEl) return;
                                  const bRect = boxEl.getBoundingClientRect();
                                  const cx = bRect.left + bRect.width / 2;
                                  const cy = bRect.top + bRect.height / 2;
                                  const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
                                  const origRot = ov.rotation || 0;
                                  const snapshotBeforeRot = splitOverlays;
                                  let rotated = false;

                                  const onMove = (ev: PointerEvent) => {
                                    rotated = true;
                                    const curAngle = Math.atan2(ev.clientY - cy, ev.clientX - cx);
                                    const deltaDeg = ((curAngle - startAngle) * 180) / Math.PI;
                                    const snapped = snapCardinalDeg(origRot + deltaDeg);
                                    setActiveOverlayGesture({
                                      id: ov.id,
                                      kind: 'rotate',
                                      valueLabel: `${Math.round(snapped)}°`,
                                    });
                                    setSplitOverlays((prev) =>
                                      prev.map((item) =>
                                        item.id === ov.id ? { ...item, rotation: snapped } : item
                                      )
                                    );
                                  };
                                  const onUp = () => {
                                    window.removeEventListener('pointermove', onMove);
                                    window.removeEventListener('pointerup', onUp);
                                    window.removeEventListener('pointercancel', onUp);
                                    setActiveOverlayGesture(null);
                                    if (rotated) {
                                      pushOverlayUndoSnapshot(snapshotBeforeRot);
                                    }
                                  };
                                  window.addEventListener('pointermove', onMove);
                                  window.addEventListener('pointerup', onUp);
                                  window.addEventListener('pointercancel', onUp);
                                }}
                                className="absolute -bottom-9 left-1/2 -translate-x-1/2 flex flex-col items-center touch-none cursor-grab active:cursor-grabbing z-20"
                                title="Drag to rotate overlay"
                              >
                                <div className="w-0.5 h-2.5 bg-violet-400" />
                                <div className="w-7 h-7 rounded-full bg-violet-600 border-2 border-white text-white flex items-center justify-center shadow-lg">
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </div>
                              </div>

                              {/* Bottom-right Radial Corner Resize Handle */}
                              <div
                                data-overlay-control="true"
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const boxEl = overlayBoxRefs.current[ov.id];
                                  if (!boxEl) return;
                                  const bRect = boxEl.getBoundingClientRect();
                                  const cx = bRect.left + bRect.width / 2;
                                  const cy = bRect.top + bRect.height / 2;
                                  const startDist = Math.max(
                                    12,
                                    Math.hypot(e.clientX - cx, e.clientY - cy)
                                  );
                                  const origScale = ov.scale;
                                  const snapshotBeforeScale = splitOverlays;
                                  let scaled = false;

                                  const onMove = (ev: PointerEvent) => {
                                    scaled = true;
                                    const curDist = Math.max(
                                      6,
                                      Math.hypot(ev.clientX - cx, ev.clientY - cy)
                                    );
                                    const nextScale = Math.max(
                                      0.18,
                                      Math.min(
                                        1.85,
                                        Number((origScale * (curDist / startDist)).toFixed(3))
                                      )
                                    );
                                    setActiveOverlayGesture({
                                      id: ov.id,
                                      kind: 'resize',
                                      valueLabel: `${Math.round(nextScale * 100)}%`,
                                    });
                                    setSplitOverlays((prev) =>
                                      prev.map((item) =>
                                        item.id === ov.id ? { ...item, scale: nextScale } : item
                                      )
                                    );
                                  };
                                  const onUp = () => {
                                    window.removeEventListener('pointermove', onMove);
                                    window.removeEventListener('pointerup', onUp);
                                    window.removeEventListener('pointercancel', onUp);
                                    setActiveOverlayGesture(null);
                                    if (scaled) {
                                      pushOverlayUndoSnapshot(snapshotBeforeScale);
                                    }
                                  };
                                  window.addEventListener('pointermove', onMove);
                                  window.addEventListener('pointerup', onUp);
                                  window.addEventListener('pointercancel', onUp);
                                }}
                                className="absolute -bottom-2.5 -right-2.5 w-7 h-7 rounded-full bg-violet-500 border-2 border-white text-white flex items-center justify-center shadow-lg cursor-nwse-resize touch-none z-20"
                                title="Drag to resize overlay"
                              >
                                <Maximize className="w-3 h-3" />
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}

                  {/* Interactive Draggable Text Overlays on Split Stage */}
                  {editMode === 'split' &&
                    splitTextOverlays.map((ov) => {
                      const liveTxtStart =
                        activeTextMoveDrag?.id === ov.id
                          ? activeTextMoveDrag.liveStart
                          : activeTextTrimDrag?.id === ov.id
                          ? activeTextTrimDrag.liveStart
                          : ov.startTime;
                      const liveTxtEnd =
                        activeTextMoveDrag?.id === ov.id
                          ? activeTextMoveDrag.liveEnd
                          : activeTextTrimDrag?.id === ov.id
                          ? activeTextTrimDrag.liveEnd
                          : ov.endTime;
                      const isVisible =
                        !isMainCropActive &&
                        currentTime >= liveTxtStart - 0.02 &&
                        currentTime <= liveTxtEnd + 0.02;
                      if (!isVisible) return null;
                      const animState = computeTextAnimationState(
                        ov.animation,
                        Math.max(0, currentTime - liveTxtStart),
                        ov.text.length
                      );
                      const visibleText =
                        ov.animation === 'typewriter' ? ov.text.slice(0, animState.visibleChars) : ov.text;
                      const hasBg = ov.bgStyle !== 'none';
                      const resolvedBgColor = hasBg
                        ? ov.bgColor || (ov.bgStyle === 'solid' ? '#ffffff' : 'rgba(15, 23, 42, 0.82)')
                        : undefined;
                      const previewTextColor =
                        hasBg &&
                        resolvedBgColor?.toLowerCase() === '#ffffff' &&
                        ov.color.toLowerCase() === '#ffffff'
                          ? '#111827'
                          : ov.color;

                      return (
                        <div
                          key={ov.id}
                          data-keep-selection="true"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            setIsMainCropActive(false);
                            const startX = e.clientX;
                            const startY = e.clientY;
                            const origX = ov.x;
                            const origY = ov.y;
                            let moved = false;
                            setSelectedTrackType('text');
                            setSelectedTextId(ov.id);

                            const onMove = (ev: PointerEvent) => {
                              const rect = mediaFrameRef.current?.getBoundingClientRect();
                              if (!rect || rect.width <= 0 || rect.height <= 0) return;
                              const dx = ev.clientX - startX;
                              const dy = ev.clientY - startY;
                              if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
                                moved = true;
                              }
                              if (!moved) return;
                              const nextX = Math.max(0.08, Math.min(0.92, origX + dx / rect.width));
                              const nextY = Math.max(0.08, Math.min(0.92, origY + dy / rect.height));
                              setSplitTextOverlays((prev) =>
                                prev.map((item) =>
                                  item.id === ov.id ? { ...item, x: nextX, y: nextY } : item
                                )
                              );
                            };

                            const onUp = () => {
                              window.removeEventListener('pointermove', onMove);
                              window.removeEventListener('pointerup', onUp);
                              window.removeEventListener('pointercancel', onUp);
                              if (!moved) {
                                openAddTextEditor(ov);
                              }
                            };

                            window.addEventListener('pointermove', onMove);
                            window.addEventListener('pointerup', onUp);
                            window.addEventListener('pointercancel', onUp);
                          }}
                          style={{
                            left: `${ov.x * 100}%`,
                            top: `${ov.y * 100}%`,
                            opacity: animState.opacity,
                            transform: `translate(-50%, -50%) translate(${animState.offsetX}px, ${animState.offsetY}px) scale(${animState.scale})`,
                            fontSize: `${Math.round(ov.fontSize * 0.86)}px`,
                            fontFamily: resolveOverlayFontCss(ov.fontFamily),
                            color: previewTextColor,
                            backgroundColor: resolvedBgColor,
                            textTransform: ov.textStyle === 'uppercase' ? 'uppercase' : 'none',
                            textShadow: resolveTextEffectShadow(ov.textStyle, previewTextColor, hasBg),
                          }}
                          className={`absolute z-20 max-w-[88%] leading-tight text-center whitespace-pre-wrap break-words select-none touch-none cursor-grab active:cursor-grabbing ${
                            ov.fontFamily === 'display' ? 'font-black' : 'font-bold'
                          } ${hasBg ? 'shadow-md rounded-lg px-2.5 py-1' : 'px-1'}`}
                          title="Drag to move or tap to edit text"
                        >
                          {visibleText}
                        </div>
                      );
                    })}
                </div>

                {/* Floating Main Video Crop Bar when Crop Mode is Active */}
                {editMode === 'split' && isMainCropActive && (
                  <div
                    data-keep-selection="true"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="absolute bottom-2 left-1/2 -translate-x-1/2 z-40 max-w-[96%] px-2.5 py-1.5 rounded-2xl bg-slate-950/92 border border-white/15 backdrop-blur-md shadow-2xl flex items-center gap-1 overflow-x-auto no-scrollbar"
                  >
                    {CROP_ASPECT_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => applyCropAspectPreset(opt.id)}
                        className={`px-2 py-1 rounded-lg text-[11px] font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                          activeCropAspect === opt.id
                            ? 'bg-emerald-500 text-white'
                            : 'bg-white/10 hover:bg-white/20 text-slate-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                    <div className="w-px h-4 bg-white/15 mx-0.5 shrink-0" />
                    <button
                      type="button"
                      onClick={() => {
                        setActiveCropAspect('free');
                        setMainVideoCrop(DEFAULT_VIDEO_CROP);
                      }}
                      className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const prevCrop = cropSnapshotBeforeEditRef.current;
                        const changed =
                          Math.abs(prevCrop.left - mainVideoCrop.left) > 0.002 ||
                          Math.abs(prevCrop.top - mainVideoCrop.top) > 0.002 ||
                          Math.abs(prevCrop.right - mainVideoCrop.right) > 0.002 ||
                          Math.abs(prevCrop.bottom - mainVideoCrop.bottom) > 0.002;
                        if (changed) {
                          setSplitUndoStack((prev) => [
                            ...prev.slice(-19),
                            {
                              video: splitSegments,
                              audio: splitAudioSegments,
                              text: splitTextOverlays,
                              overlays: splitOverlays,
                              crop: prevCrop,
                            },
                          ]);
                          setSplitRedoStack([]);
                        }
                        setIsMainCropActive(false);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Done</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

          {isLoadingVideo && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center pointer-events-none">
              <div className="w-10 h-10 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />
            </div>
          )}

          {/* Top VLC Overlay Bar (hidden when TikTok Split screen header is active) */}
          {editMode !== 'split' && (
          <div
            onClick={(e) => e.stopPropagation()}
            className={`absolute top-0 left-0 right-0 z-10 px-2.5 sm:px-5 pt-3 pb-8 bg-gradient-to-b from-black/90 via-black/60 to-transparent flex items-center justify-between gap-2 transition-opacity duration-200 ${
              showControls || editMode !== 'none' ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <button
                type="button"
                onClick={() => void closePlayer()}
                className="min-w-[44px] min-h-[44px] rounded-xl bg-black/50 hover:bg-white/15 text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
                title="Back to Videos"
                aria-label="Back to Video List"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="text-xs sm:text-base font-bold text-white truncate">
                  {currentVideo?.title || currentVideo?.displayName || 'Video Player'}
                </h2>
                {currentVideo?.resolution && (
                  <p className="text-[10px] sm:text-[11px] font-mono text-slate-300 truncate">
                    {currentVideo.resolution}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              <button
                type="button"
                onClick={openTrimEditor}
                disabled={isProcessingEdit}
                className={`min-h-[44px] px-2 sm:px-3 rounded-lg border text-[11px] sm:text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                  editMode === 'trim'
                    ? 'bg-emerald-400 border-emerald-300 text-slate-950 font-bold'
                    : 'bg-black/55 hover:bg-white/15 border-white/15 text-white'
                }`}
                title="Trim Video (Original Quality)"
                aria-label="Trim Video"
              >
                <Scissors className="w-3.5 h-3.5 shrink-0" />
                <span>Trim</span>
              </button>

              <button
                type="button"
                onClick={openSplitEditor}
                disabled={isProcessingEdit}
                className="min-h-[44px] px-2 sm:px-3 rounded-lg border text-[11px] sm:text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 bg-black/55 hover:bg-white/15 border-white/15 text-white"
                title="Split Video (Original Quality)"
                aria-label="Split Video"
              >
                <SplitSquareHorizontal className="w-3.5 h-3.5 shrink-0" />
                <span>Split</span>
              </button>

              <button
                type="button"
                onClick={cycleSpeed}
                className="min-w-[38px] min-h-[44px] px-2 rounded-lg bg-black/55 hover:bg-white/15 border border-white/15 text-white text-[11px] sm:text-xs font-mono font-bold cursor-pointer transition-colors whitespace-nowrap shrink-0"
                title="Playback Speed"
              >
                {playbackSpeed}x
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowControls(true);
                  setFitMode((prev) => (prev === 'contain' ? 'cover' : 'contain'));
                }}
                className="min-w-[38px] sm:min-w-[44px] min-h-[44px] px-2 rounded-lg bg-black/55 hover:bg-white/15 border border-white/15 text-white flex items-center justify-center text-xs font-semibold cursor-pointer transition-colors shrink-0"
                title={fitMode === 'contain' ? 'Fill Screen' : 'Fit Whole Video'}
                aria-label="Toggle Video Fit or Fill"
              >
                {fitMode === 'contain' ? (
                  <Expand className="w-4 h-4" />
                ) : (
                  <Shrink className="w-4 h-4" />
                )}
              </button>

              <button
                type="button"
                onClick={() => void handleFullscreen()}
                className="min-w-[38px] sm:min-w-[44px] min-h-[44px] px-2 rounded-lg bg-black/55 hover:bg-white/15 border border-white/15 text-white flex items-center justify-center cursor-pointer transition-colors shrink-0"
                title={isOsFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                aria-label="Toggle Fullscreen"
              >
                {isOsFullscreen ? (
                  <Minimize className="w-4 h-4" />
                ) : (
                  <Maximize className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
          )}

          {/* Center Play/Pause Quick Button when paused or HUD visible (hidden during Trim/Split to keep video clear) */}
          {!isLoadingVideo && editMode === 'none' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleTogglePlayPause();
              }}
              aria-label={isPlaying ? 'Pause Video' : 'Play Video'}
              className={`absolute z-10 w-16 h-16 rounded-full bg-black/65 hover:bg-emerald-500 text-white hover:text-slate-950 border border-white/25 flex items-center justify-center backdrop-blur-sm transition-all cursor-pointer active:scale-95 ${
                showControls ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'
              }`}
            >
              {isPlaying ? (
                <Pause className="w-7 h-7 fill-current" />
              ) : (
                <Play className="w-7 h-7 fill-current ml-0.5" />
              )}
            </button>
          )}

          {/* Bottom Dock: Isolated Preview Cut OR Trim Editor OR Split Editor OR Standard Transport Strip */}
          {editMode === 'trim' && isPreviewingTrim ? (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-0 left-0 right-0 z-20 px-3.5 sm:px-6 pt-8 pb-4 bg-gradient-to-t from-black via-black/95 to-transparent space-y-3"
            >
              {/* Preview Cut Header: Trimmed Clip Only */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-2 py-0.5 rounded bg-emerald-400 text-slate-950 text-[10px] font-bold uppercase tracking-wider shrink-0">
                    Cut Preview
                  </span>
                  <span className="text-xs font-mono tabular-nums text-slate-200 truncate">
                    {formatPreciseTime(Math.max(0, trimEnd - trimStart))} trimmed clip
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (videoRef.current && !videoRef.current.paused) {
                        videoRef.current.pause();
                        setIsPlaying(false);
                      }
                      setIsPreviewingTrim(false);
                    }}
                    className="min-h-[40px] px-3 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                  >
                    Adjust Cut
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (videoRef.current && !videoRef.current.paused) {
                        videoRef.current.pause();
                        setIsPlaying(false);
                      }
                      setIsPreviewingTrim(false);
                      setEditMode('none');
                    }}
                    className="min-w-[40px] min-h-[40px] rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 flex items-center justify-center cursor-pointer"
                    title="Close Trim"
                    aria-label="Close Trim Preview"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Isolated Timeline: 0:00 -> Trimmed Duration ONLY */}
              {(() => {
                const clipDuration = Math.max(0.2, trimEnd - trimStart);
                const clipPos = Math.max(0, Math.min(clipDuration, currentTime - trimStart));
                return (
                  <div className="space-y-1.5 bg-slate-900/85 border border-emerald-500/25 rounded-xl p-3">
                    <input
                      type="range"
                      min={0}
                      max={clipDuration}
                      step={0.05}
                      value={clipPos}
                      onChange={(e) => {
                        const offset = parseFloat(e.target.value);
                        seekVideoTo(trimStart + offset);
                      }}
                      aria-label="Trimmed video preview timeline"
                      className="w-full h-2 accent-emerald-400 cursor-pointer"
                    />
                    <div className="flex items-center justify-between text-xs font-mono tabular-nums text-emerald-300">
                      <span>{formatPreciseTime(clipPos)}</span>
                      <span>{formatPreciseTime(clipDuration)}</span>
                    </div>
                  </div>
                );
              })()}

              {editErrorMessage && (
                <div className="p-2.5 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editErrorMessage}</span>
                </div>
              )}

              {editStatusMessage && (
                <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-emerald-200 text-xs flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="truncate">{editStatusMessage}</span>
                  </div>
                  {lastSavedClip && (
                    <button
                      type="button"
                      onClick={() => void playVideoItem(lastSavedClip)}
                      className="px-2.5 py-1 rounded-lg bg-emerald-400 text-slate-950 font-bold text-[11px] whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Play Clip
                    </button>
                  )}
                </div>
              )}

              {/* Preview Transport + Save */}
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void handleTogglePlayPause()}
                  disabled={isProcessingEdit}
                  className="min-h-[44px] px-4 rounded-xl bg-white/15 hover:bg-white/25 border border-white/15 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-4 h-4 fill-current" />
                      <span>Pause</span>
                    </>
                  ) : currentTime >= trimEnd - 0.05 ? (
                    <>
                      <RotateCcw className="w-4 h-4" />
                      <span>Replay Cut</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      <span>Play Cut</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => void handleExecuteLosslessTrim()}
                  disabled={isProcessingEdit}
                  className="flex-1 min-h-[44px] px-4 rounded-xl bg-emerald-400 hover:bg-emerald-300 disabled:opacity-60 text-slate-950 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors whitespace-nowrap"
                >
                  {isProcessingEdit ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-900/30 border-t-slate-950 rounded-full animate-spin" />
                      <span>Saving Original Quality...</span>
                    </>
                  ) : (
                    <>
                      <Scissors className="w-4 h-4 shrink-0" />
                      <span>Save Trimmed Video</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : editMode === 'trim' ? (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-0 left-0 right-0 z-20 px-3.5 sm:px-6 pt-8 pb-4 bg-gradient-to-t from-black via-black/95 to-transparent space-y-3"
            >
              {/* Trim Header Row */}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-white">
                    <Scissors className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Trim Video</span>
                    <span className="text-slate-400 font-normal hidden sm:inline">·</span>
                    <span className="text-[11px] font-mono text-emerald-400 font-medium hidden sm:inline">
                      Play stays inside selection
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleSeekRelative(-1)}
                    className="min-w-[40px] min-h-[40px] rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-mono font-bold px-2 cursor-pointer"
                    title="Back 1s inside selection"
                  >
                    -1s
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleTogglePlayPause()}
                    className="min-w-[40px] min-h-[40px] rounded-lg bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer"
                    aria-label={isPlaying ? 'Pause Selected Part' : 'Play Selected Part'}
                    title="Play Selected Part Only"
                  >
                    {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSeekRelative(1)}
                    className="min-w-[40px] min-h-[40px] rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-mono font-bold px-2 cursor-pointer"
                    title="Forward 1s inside selection"
                  >
                    +1s
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPreviewingTrim(false);
                      setEditMode('none');
                    }}
                    className="min-w-[40px] min-h-[40px] rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 flex items-center justify-center cursor-pointer"
                    title="Close Trim"
                    aria-label="Close Trim Editor"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Dual-Handle Trim Range Bar + Set Start / End Helpers */}
              <div className="space-y-2 bg-slate-900/85 border border-white/10 rounded-xl p-3">
                <div className="relative h-8 flex items-center select-none">
                  {/* Full background track */}
                  <div className="w-full h-2.5 rounded-full bg-white/15 relative overflow-hidden">
                    {/* Selected kept segment */}
                    {duration > 0 && (
                      <div
                        className="absolute top-0 bottom-0 bg-emerald-400/80"
                        style={{
                          left: `${Math.max(0, Math.min(100, (trimStart / duration) * 100))}%`,
                          width: `${Math.max(0, Math.min(100, ((trimEnd - trimStart) / duration) * 100))}%`,
                        }}
                      />
                    )}
                  </div>

                  {/* Current Playhead Marker */}
                  {duration > 0 && (
                    <div
                      className="absolute top-1 bottom-1 w-0.5 bg-white pointer-events-none z-10"
                      style={{
                        left: `${Math.max(0, Math.min(100, (currentTime / duration) * 100))}%`,
                      }}
                    />
                  )}

                  {/* Start Handle Range */}
                  <input
                    type="range"
                    min={0}
                    max={duration > 0 ? duration : 100}
                    step={0.1}
                    value={trimStart}
                    onChange={(e) => {
                      const next = Math.min(parseFloat(e.target.value), Math.max(0, trimEnd - 0.3));
                      setTrimStart(next);
                      setEditStatusMessage(null);
                      setEditErrorMessage(null);
                      seekVideoTo(next);
                    }}
                    aria-label="Trim start time"
                    className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none z-20 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-emerald-400 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-ew-resize [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-emerald-400"
                  />

                  {/* End Handle Range */}
                  <input
                    type="range"
                    min={0}
                    max={duration > 0 ? duration : 100}
                    step={0.1}
                    value={trimEnd}
                    onChange={(e) => {
                      const next = Math.max(parseFloat(e.target.value), Math.min(duration, trimStart + 0.3));
                      setTrimEnd(next);
                      setEditStatusMessage(null);
                      setEditErrorMessage(null);
                      seekVideoTo(next);
                    }}
                    aria-label="Trim end time"
                    className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none z-20 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-400 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-ew-resize [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-emerald-400 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white"
                  />
                </div>

                {/* Timestamps + Quick Set Here Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.min(currentTime, Math.max(0, trimEnd - 0.3));
                      setTrimStart(next);
                      setEditStatusMessage(null);
                      setEditErrorMessage(null);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                    title="Set Start to current video frame"
                  >
                    Set Start ({formatPreciseTime(trimStart)})
                  </button>

                  <span className="text-emerald-400 font-bold">
                    Keep {formatPreciseTime(Math.max(0, trimEnd - trimStart))}
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.max(currentTime, Math.min(duration, trimStart + 0.3));
                      setTrimEnd(next);
                      setEditStatusMessage(null);
                      setEditErrorMessage(null);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                    title="Set End to current video frame"
                  >
                    Set End ({formatPreciseTime(trimEnd)})
                  </button>
                </div>
              </div>

              {editErrorMessage && (
                <div className="p-2.5 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editErrorMessage}</span>
                </div>
              )}

              {editStatusMessage && (
                <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-emerald-200 text-xs flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="truncate">{editStatusMessage}</span>
                  </div>
                  {lastSavedClip && (
                    <button
                      type="button"
                      onClick={() => void playVideoItem(lastSavedClip)}
                      className="px-2.5 py-1 rounded-lg bg-emerald-400 text-slate-950 font-bold text-[11px] whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Play Clip
                    </button>
                  )}
                </div>
              )}

              {/* Trim Action Buttons */}
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void handlePreviewTrim()}
                  disabled={isProcessingEdit}
                  className="min-h-[44px] px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  <Play className="w-4 h-4" />
                  <span>Preview Cut</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleExecuteLosslessTrim()}
                  disabled={isProcessingEdit}
                  className="flex-1 min-h-[44px] px-4 rounded-xl bg-emerald-400 hover:bg-emerald-300 disabled:opacity-60 text-slate-950 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors whitespace-nowrap"
                >
                  {isProcessingEdit ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-900/30 border-t-slate-950 rounded-full animate-spin" />
                      <span>Saving Original Quality...</span>
                    </>
                  ) : (
                    <>
                      <Scissors className="w-4 h-4 shrink-0" />
                      <span>Save Trimmed Video</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : editMode === 'split' ? null : (
            /* Bottom VLC Overlay Controls: Seek Bar + Transport */
            <div
              onClick={(e) => e.stopPropagation()}
              className={`absolute bottom-0 left-0 right-0 z-10 px-4 sm:px-6 pt-10 pb-5 bg-gradient-to-t from-black/95 via-black/75 to-transparent space-y-3 transition-opacity duration-200 ${
                showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              {errorMessage && (
                <div className="p-2.5 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 text-xs text-center">
                  {errorMessage}
                </div>
              )}

              {/* Seek Timeline */}
              <div className="space-y-1">
                <input
                  type="range"
                  min={0}
                  max={duration > 0 ? duration : 100}
                  step={0.1}
                  value={Math.min(currentTime, duration > 0 ? duration : 100)}
                  disabled={duration <= 0}
                  onChange={(e) => {
                    setShowControls(true);
                    const next = parseFloat(e.target.value);
                    setCurrentTime(next);
                    if (videoRef.current) {
                      videoRef.current.currentTime = next;
                    }
                  }}
                  aria-label="Video timeline"
                  className="w-full h-2 accent-emerald-400 cursor-pointer disabled:opacity-40"
                />
                <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-200">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Transport Strip */}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowControls(true);
                    const next = !isMuted;
                    trimBoundsRef.current.isMuted = next;
                    setIsMuted(next);
                    if (videoRef.current) {
                      videoRef.current.muted = next;
                    }
                  }}
                  className="min-w-[44px] min-h-[44px] rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
                  title={isMuted ? 'Unmute' : 'Mute'}
                  aria-label={isMuted ? 'Unmute Video' : 'Mute Video'}
                >
                  {isMuted ? (
                    <VolumeX className="w-5 h-5 text-red-400" />
                  ) : (
                    <Volume2 className="w-5 h-5" />
                  )}
                </button>

                <div className="flex items-center gap-2 sm:gap-3">
                  <button
                    type="button"
                    onClick={() => handleStepVideo(-1)}
                    disabled={videos.length === 0}
                    className="min-w-[44px] min-h-[44px] rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white flex items-center justify-center cursor-pointer transition-colors"
                    title="Previous Video"
                    aria-label="Previous Video"
                  >
                    <SkipBack className="w-5 h-5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSeekRelative(-10)}
                    className="min-w-[44px] min-h-[44px] rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
                    title="Rewind 10s"
                    aria-label="Rewind 10 seconds"
                  >
                    <RotateCcw className="w-5 h-5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleTogglePlayPause()}
                    className="w-13 h-13 rounded-2xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 flex items-center justify-center shadow-lg shadow-emerald-500/25 active:scale-95 transition-all cursor-pointer shrink-0"
                    title={isPlaying ? 'Pause' : 'Play'}
                    aria-label={isPlaying ? 'Pause Video' : 'Play Video'}
                  >
                    {isPlaying ? (
                      <Pause className="w-6 h-6 fill-current" />
                    ) : (
                      <Play className="w-6 h-6 fill-current ml-0.5" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSeekRelative(10)}
                    className="min-w-[44px] min-h-[44px] rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
                    title="Forward 10s"
                    aria-label="Forward 10 seconds"
                  >
                    <RotateCw className="w-5 h-5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleStepVideo(1)}
                    disabled={videos.length === 0}
                    className="min-w-[44px] min-h-[44px] rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white flex items-center justify-center cursor-pointer transition-colors"
                    title="Next Video"
                    aria-label="Next Video"
                  >
                    <SkipForward className="w-5 h-5" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => void closePlayer()}
                  className="min-w-[44px] min-h-[44px] px-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center justify-center cursor-pointer transition-colors"
                  title="Close Player"
                  aria-label="Close Video Player"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* TikTok-Style Lower Editor Workspace (Timeline Filmstrip + Add Sound + Add Media + Split/Remove Tools) */}
        {editMode === 'split' && (
          <div className="shrink-0 bg-black border-t border-white/10 pt-2 pb-3 flex flex-col gap-2 z-20 relative">
            {/* Middle Control Bar: Timestamp | Center Play/Pause | Undo / Redo / Fullscreen */}
            <div className="px-4 flex items-center justify-between gap-2">
              <div className="text-xs font-mono tabular-nums min-w-[92px]">
                <span className="text-white font-semibold">{formatTimePadded(currentTime)}</span>
                <span className="text-slate-500">/{formatTimePadded(activeSplitDuration)}</span>
              </div>

              <button
                type="button"
                data-keep-selection="true"
                onClick={() => void handleTogglePlayPause()}
                className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 fill-current ml-0.5" />
                )}
              </button>

              <div className="flex items-center justify-end gap-1 min-w-[92px]">
                <button
                  type="button"
                  data-keep-selection="true"
                  onClick={handleUndoSplit}
                  disabled={splitUndoStack.length === 0}
                  className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-white/10 disabled:opacity-30 text-white flex items-center justify-center cursor-pointer"
                  title="Undo"
                  aria-label="Undo Split Change"
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  data-keep-selection="true"
                  onClick={handleRedoSplit}
                  disabled={splitRedoStack.length === 0}
                  className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-white/10 disabled:opacity-30 text-white flex items-center justify-center cursor-pointer"
                  title="Redo"
                  aria-label="Redo Split Change"
                >
                  <Redo2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  data-keep-selection="true"
                  onClick={() => void handleFullscreen()}
                  className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-white/10 text-white flex items-center justify-center cursor-pointer"
                  title="Fullscreen"
                  aria-label="Toggle Fullscreen"
                >
                  {isOsFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Horizontal Scrolling Multi-Track Timeline (Video, Audio, Multi-Line Text, Overlay) + Left Pinned Track Icons */}
            {(() => {
              const maxTextRow = splitTextOverlays.reduce(
                (m, t) => Math.max(m, t.trackRow ?? 0),
                -1
              );
              const textRowCount = splitTextOverlays.length === 0 ? 1 : maxTextRow + 1;
              const hasTextAddLineRow = splitTextOverlays.length > 0;
              const textSectionTotalHeightPx =
                textRowCount * 44 + (hasTextAddLineRow ? 36 : 0);
              const overlayTopPx = 124 + textSectionTotalHeightPx;
              const timelineTotalHeightPx =
                overlayTopPx + (splitOverlays.length > 0 ? 46 : 0);

              return (
            <div
              style={{ height: `${timelineTotalHeightPx}px` }}
              className="relative w-full bg-black overflow-hidden transition-[height] duration-150"
            >
              {/* Fixed Mute Button on Left Edge (Video Row) */}
              <button
                type="button"
                data-keep-selection="true"
                onClick={() => {
                  const next = !isMuted;
                  trimBoundsRef.current.isMuted = next;
                  setIsMuted(next);
                  const activeEl = getActiveSplitVideoEl();
                  if (activeEl) activeEl.muted = next;
                  const standbyEl = getDeckEl(activeSplitDeckRef.current === 'A' ? 'B' : 'A');
                  if (standbyEl) standbyEl.muted = true;
                }}
                className={`absolute left-2 top-[27px] z-30 w-10 h-10 rounded-xl border flex items-center justify-center cursor-pointer transition-colors ${
                  isMuted
                    ? 'bg-red-500/20 border-red-400/50 text-red-300'
                    : 'bg-zinc-900/90 border-white/15 text-white hover:bg-white/15'
                }`}
                title={isMuted ? 'Unmute Video Sound' : 'Mute Video Sound'}
                aria-label={isMuted ? 'Unmute Video Sound' : 'Mute Video Sound'}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              {/* Fixed Audio Track Icon on Left Edge (Audio Row) */}
              {splitAudioSegments.length > 0 ? (
                <button
                  type="button"
                  data-keep-selection="true"
                  onClick={() => {
                    if (splitAudioRef.current) splitAudioRef.current.pause();
                    setSplitCustomAudio(null);
                    commitTimelineState(splitSegments, [], undefined, null, 'none');
                  }}
                  className="absolute left-2 top-[78px] z-30 w-10 h-10 rounded-xl bg-zinc-900/90 border border-emerald-400/40 text-emerald-300 hover:bg-red-500/20 hover:border-red-400/50 hover:text-red-200 flex items-center justify-center cursor-pointer transition-colors"
                  title="Remove added audio track"
                  aria-label="Remove added audio track"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  data-keep-selection="true"
                  onClick={() => void openAudioPickerModal()}
                  className="absolute left-2 top-[78px] z-30 w-10 h-10 rounded-xl bg-zinc-900/90 border border-white/15 text-slate-300 hover:text-white hover:bg-white/15 flex items-center justify-center cursor-pointer transition-colors"
                  title="Add audio"
                  aria-label="Add audio"
                >
                  <Music className="w-4 h-4" />
                </button>
              )}

              {/* Fixed Text Track Icon on Left Edge (Text Row 1) */}
              <button
                type="button"
                data-keep-selection="true"
                onClick={() => openAddTextEditor()}
                className={`absolute left-2 top-[124px] z-30 w-10 h-[38px] rounded-xl border flex items-center justify-center cursor-pointer transition-colors ${
                  splitTextOverlays.length > 0
                    ? 'bg-amber-500/15 border-amber-400/45 text-amber-300 hover:bg-amber-500/25'
                    : 'bg-zinc-900/90 border-white/15 text-slate-300 hover:text-white hover:bg-white/15'
                }`}
                title="Add text"
                aria-label="Add text"
              >
                <Type className="w-4 h-4" />
              </button>

              {/* Fixed Overlay Track Icon on Left Edge (Overlay Row, aligned below all text lines) */}
              {splitOverlays.length > 0 && (
                <button
                  type="button"
                  data-keep-selection="true"
                  onClick={openOverlayPickerModal}
                  style={{ top: `${overlayTopPx}px` }}
                  className="absolute left-2 z-30 w-10 h-[40px] rounded-xl border bg-violet-500/15 border-violet-400/45 text-violet-300 hover:bg-violet-500/25 flex items-center justify-center cursor-pointer transition-colors"
                  title="Add overlay video or photo"
                  aria-label="Add overlay"
                >
                  <Layers className="w-4 h-4" />
                </button>
              )}

              {/* Floating + Add Video / Image Button on Right Edge (TikTok / CapCut style) */}
              <button
                type="button"
                onClick={() => setShowAddMediaMenu((prev) => !prev)}
                disabled={isPreparingSplitMedia || isProcessingEdit}
                className="absolute right-2.5 top-[27px] z-30 w-10 h-10 rounded-xl bg-white hover:bg-slate-200 text-slate-950 shadow-lg flex items-center justify-center cursor-pointer active:scale-95 transition-transform disabled:opacity-50"
                title="Add Video or Image"
                aria-label="Add Video or Image"
              >
                <Plus className={`w-5 h-5 stroke-[2.5] transition-transform ${showAddMediaMenu ? 'rotate-45' : ''}`} />
              </button>

              {/* Center Fixed Vertical White Playhead */}
              <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[2.5px] bg-white z-30 pointer-events-none rounded-full shadow-[0_0_8px_rgba(255,255,255,0.75)]" />

              {/* Scrollable Time Ruler + Video Filmstrip + Audio Line */}
              <div
                ref={splitTimelineRef}
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest('[data-trim-handle="true"]')) {
                    return;
                  }
                  isUserScrubbingTimelineRef.current = true;
                  pauseAllSplitVideos();
                  setIsPlaying(false);
                  if (e.pointerType === 'mouse' && splitTimelineRef.current) {
                    const startX = e.clientX;
                    const startScroll = splitTimelineRef.current.scrollLeft;
                    let moved = false;
                    const onMove = (ev: PointerEvent) => {
                      const dx = ev.clientX - startX;
                      if (Math.abs(dx) > 3) moved = true;
                      if (moved && splitTimelineRef.current) {
                        splitTimelineRef.current.scrollLeft = startScroll - dx;
                      }
                    };
                    const onUp = () => {
                      isUserScrubbingTimelineRef.current = false;
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }
                }}
                onPointerUp={() => {
                  isUserScrubbingTimelineRef.current = false;
                }}
                onTouchEnd={() => {
                  isUserScrubbingTimelineRef.current = false;
                }}
                onScroll={(e) => {
                  if (
                    isSyncingTimelineScrollRef.current ||
                    performance.now() < scrollSyncUnlockAtMsRef.current ||
                    (trimBoundsRef.current.isPlaying && !isUserScrubbingTimelineRef.current)
                  ) {
                    return;
                  }
                  const target = e.currentTarget;
                  if (
                    lastProgrammaticScrollLeftRef.current >= 0 &&
                    Math.abs(target.scrollLeft - lastProgrammaticScrollLeftRef.current) < 2
                  ) {
                    return;
                  }
                  lastProgrammaticScrollLeftRef.current = -1;
                  const nextTime = Math.max(
                    0,
                    Math.min(maxSplitTimelineDuration, target.scrollLeft / splitPxPerSec)
                  );
                  seekSplitTimelineTo(nextTime, false);
                }}
                className="w-full h-full overflow-x-auto overflow-y-hidden no-scrollbar cursor-grab active:cursor-grabbing"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                <div
                  className="relative h-full box-content"
                  style={{
                    width: `${Math.max(
                      120,
                      maxSplitTimelineDuration * splitPxPerSec +
                        (activeTrimDrag
                          ? Math.max(
                              0,
                              (activeTrimDrag.initialSourceStart - activeTrimDrag.liveSourceStart) *
                                activeTrimDrag.frozenPxPerSec
                            ) +
                            Math.max(
                              0,
                              (activeTrimDrag.liveSourceEnd - activeTrimDrag.initialSourceEnd) *
                                activeTrimDrag.frozenPxPerSec
                            )
                          : 0) +
                        (activeAudioTrimDrag
                          ? Math.max(
                              0,
                              (activeAudioTrimDrag.initialSourceStart -
                                activeAudioTrimDrag.liveSourceStart) *
                                activeAudioTrimDrag.frozenPxPerSec
                            ) +
                            Math.max(
                              0,
                              (activeAudioTrimDrag.liveSourceEnd -
                                activeAudioTrimDrag.initialSourceEnd) *
                                activeAudioTrimDrag.frozenPxPerSec
                            )
                          : 0) +
                        (activeOverlayTrimDrag
                          ? Math.max(
                              0,
                              (activeOverlayTrimDrag.liveTimelineStart +
                                (activeOverlayTrimDrag.liveSourceEnd -
                                  activeOverlayTrimDrag.liveSourceStart) -
                                (activeOverlayTrimDrag.initialTimelineStart +
                                  (activeOverlayTrimDrag.initialSourceEnd -
                                    activeOverlayTrimDrag.initialSourceStart))) *
                                activeOverlayTrimDrag.frozenPxPerSec
                            )
                          : 0) +
                        (activeOverlayMoveDrag
                          ? Math.max(
                              0,
                              (activeOverlayMoveDrag.liveTimelineStart +
                                activeOverlayMoveDrag.duration -
                                maxSplitTimelineDuration) *
                                activeOverlayMoveDrag.frozenPxPerSec
                            )
                          : 0) +
                        (activeTextMoveDrag
                          ? Math.max(
                              0,
                              (activeTextMoveDrag.liveEnd - maxSplitTimelineDuration) *
                                activeTextMoveDrag.frozenPxPerSec
                            )
                          : 0)
                    )}px`,
                    paddingLeft: '50%',
                    paddingRight: '50%',
                  }}
                >
                  {/* Top Time Ruler Ticks */}
                  <div className="relative h-5 w-full">
                    {(() => {
                      const baseStep =
                        totalSplitDuration <= 45
                          ? 1
                          : totalSplitDuration <= 150
                          ? 5
                          : totalSplitDuration <= 480
                          ? 15
                          : 30;
                      const stepSec = Math.max(
                        baseStep,
                        Math.ceil(maxSplitTimelineDuration / 180)
                      );
                      const ticks: number[] = [];
                      for (let t = 0; t <= Math.ceil(maxSplitTimelineDuration); t += stepSec) {
                        ticks.push(t);
                      }
                      return ticks.map((t) => (
                        <div
                          key={t}
                          className="absolute top-0 flex flex-col items-center -translate-x-1/2 pointer-events-none"
                          style={{ left: `${t * splitPxPerSec}px` }}
                        >
                          <span className="text-[10px] font-mono tabular-nums text-slate-400 leading-none">
                            {formatTimePadded(t)}
                          </span>
                        </div>
                      ));
                    })()}
                  </div>

                  {/* Multi-Clip Filmstrip Segments with TikTok White < > Touch-and-Pull Handles */}
                  <div className="relative h-[50px] mt-0.5 flex items-center">
                    {mappedSplitSegments.map((seg, idx) => {
                      const isDraggingThis = activeTrimDrag?.segId === seg.id;
                      const pxPerSec = isDraggingThis ? activeTrimDrag.frozenPxPerSec : splitPxPerSec;
                      const baseStart = isDraggingThis ? activeTrimDrag.initialSourceStart : seg.sourceStart;
                      const baseEnd = isDraggingThis ? activeTrimDrag.initialSourceEnd : seg.sourceEnd;
                      const liveStart = isDraggingThis ? activeTrimDrag.liveSourceStart : seg.sourceStart;
                      const liveEnd = isDraggingThis ? activeTrimDrag.liveSourceEnd : seg.sourceEnd;

                      const baseWidth = Math.max(24, (baseEnd - baseStart) * pxPerSec);
                      const extraLeftPx =
                        isDraggingThis && liveStart < baseStart ? (baseStart - liveStart) * pxPerSec : 0;
                      const extraRightPx =
                        isDraggingThis && liveEnd > baseEnd ? (liveEnd - baseEnd) * pxPerSec : 0;
                      const slotWidth = Math.max(24, baseWidth + extraLeftPx + extraRightPx);
                      const trimLeftPx =
                        isDraggingThis && liveStart > baseStart ? (liveStart - baseStart) * pxPerSec : 0;
                      const trimRightPx =
                        isDraggingThis && liveEnd < baseEnd ? (baseEnd - liveEnd) * pxPerSec : 0;
                      const activeBracketWidth = Math.max(12, slotWidth - trimLeftPx - trimRightPx);

                      const isSelected =
                        selectedTrackType === 'video' && selectedSplitSegId === seg.id;
                      const sourceFrames = seg.mediaType === 'video' ? splitFramesBySource[seg.sourceUrl] || [] : [];
                      const segThumbs =
                        sourceFrames.length > 0
                          ? sourceFrames.filter(
                              (f) => f.time >= Math.min(liveStart, baseStart) - 2 && f.time <= Math.max(liveEnd, baseEnd) + 2
                            )
                          : [];
                      const displayFrames = segThumbs.length > 0 ? segThumbs : sourceFrames.slice(0, 3);
                      const isSourceExtracting = Boolean(extractingSources[seg.sourceUrl]);

                      const previewClipAt = (targetSourceSec: number) => {
                        const activeDeck = activeSplitDeckRef.current;
                        const videoEl = getDeckEl(activeDeck);
                        if (!videoEl || seg.mediaType !== 'video') return;
                        if (deckUrlsRef.current[activeDeck] !== seg.sourceUrl) {
                          pendingDeckSeekRef.current[activeDeck] = {
                            sourceUrl: seg.sourceUrl,
                            sourceTime: targetSourceSec,
                            autoPlay: false,
                            awaitingMetadata: true,
                          };
                          deckUrlsRef.current[activeDeck] = seg.sourceUrl;
                          videoEl.src = seg.sourceUrl;
                          videoEl.muted = trimBoundsRef.current.isMuted;
                          videoEl.playbackRate = trimBoundsRef.current.playbackSpeed;
                          videoEl.load();
                        } else {
                          pendingDeckSeekRef.current[activeDeck] = null;
                          videoEl.currentTime = targetSourceSec;
                        }
                      };

                      const isMovingVideoSeg = activeVideoMoveDrag?.segId === seg.id;
                      const canDragReorderVideo =
                        splitSegments.length > 1 && isSelected && !seg.removed;
                      const isDropTargetBefore =
                        activeVideoMoveDrag &&
                        !isMovingVideoSeg &&
                        activeVideoMoveDrag.targetIndex === idx &&
                        activeVideoMoveDrag.initialIndex > idx;
                      const isDropTargetAfter =
                        activeVideoMoveDrag &&
                        !isMovingVideoSeg &&
                        activeVideoMoveDrag.targetIndex === idx &&
                        activeVideoMoveDrag.initialIndex < idx;

                      return (
                        <div
                          key={seg.id}
                          data-keep-selection="true"
                          style={{
                            width: `${slotWidth}px`,
                            transform: isMovingVideoSeg
                              ? `translateX(${activeVideoMoveDrag.offsetX}px) scale(1.03)`
                              : undefined,
                          }}
                          className={`relative h-full shrink-0 ${idx > 0 ? 'ml-0.5' : ''} ${
                            isMovingVideoSeg
                              ? 'z-40 shadow-2xl opacity-95'
                              : isSelected && !seg.removed
                              ? 'z-20'
                              : ''
                          } ${isDropTargetBefore ? 'border-l-[3px] border-emerald-400 pl-0.5' : ''} ${
                            isDropTargetAfter ? 'border-r-[3px] border-emerald-400 pr-0.5' : ''
                          }`}
                        >
                          <button
                            type="button"
                            onPointerDown={(e) => {
                              if (!canDragReorderVideo && e.pointerType !== 'mouse') return;
                              if (splitSegments.length <= 1 || seg.removed) return;
                              if (!isSelected && e.pointerType !== 'mouse') return;
                              e.stopPropagation();
                              try {
                                e.currentTarget.setPointerCapture(e.pointerId);
                              } catch {
                                // ignore
                              }
                              const startClientX = e.clientX;
                              const frozenPx = splitPxPerSec;
                              const origIdx = idx;
                              const itemWidths = mappedSplitSegments.map((m) =>
                                Math.max(24, (m.sourceEnd - m.sourceStart) * frozenPx)
                              );
                              let itemCenters: number[] = [];
                              let acc = 0;
                              for (let i = 0; i < itemWidths.length; i++) {
                                itemCenters.push(acc + itemWidths[i] / 2);
                                acc += itemWidths[i] + (i > 0 ? 2 : 0);
                              }
                              const origCenter = itemCenters[origIdx] ?? 0;
                              let latestTargetIdx = origIdx;
                              let moved = false;

                              const onMove = (ev: PointerEvent) => {
                                const dx = ev.clientX - startClientX;
                                if (!moved && Math.abs(dx) < 8) return;
                                if (!moved) {
                                  moved = true;
                                  pauseAllSplitVideos();
                                  setIsPlaying(false);
                                  isUserScrubbingTimelineRef.current = true;
                                  setSelectedTrackType('video');
                                  setSelectedSplitSegId(seg.id);
                                }
                                const draggedCenter = origCenter + dx;
                                let nextTarget = origIdx;
                                for (let i = 0; i < itemCenters.length; i++) {
                                  if (i < origIdx && draggedCenter < itemCenters[i]) {
                                    nextTarget = Math.min(nextTarget, i);
                                  } else if (i > origIdx && draggedCenter > itemCenters[i]) {
                                    nextTarget = Math.max(nextTarget, i);
                                  }
                                }
                                latestTargetIdx = nextTarget;
                                setActiveVideoMoveDrag({
                                  segId: seg.id,
                                  initialIndex: origIdx,
                                  targetIndex: nextTarget,
                                  offsetX: dx,
                                });
                              };

                              const onUp = () => {
                                window.removeEventListener('pointermove', onMove);
                                window.removeEventListener('pointerup', onUp);
                                window.removeEventListener('pointercancel', onUp);
                                isUserScrubbingTimelineRef.current = false;
                                setActiveVideoMoveDrag(null);
                                if (moved && latestTargetIdx !== origIdx) {
                                  const reordered = [...splitSegments];
                                  const [picked] = reordered.splice(origIdx, 1);
                                  reordered.splice(latestTargetIdx, 0, picked);
                                  let nextCursor = 0;
                                  for (let i = 0; i < latestTargetIdx; i++) {
                                    nextCursor += Math.max(
                                      0.1,
                                      reordered[i].sourceEnd - reordered[i].sourceStart
                                    );
                                  }
                                  commitTimelineState(
                                    reordered,
                                    splitAudioSegments,
                                    seg.id,
                                    undefined,
                                    'video'
                                  );
                                  seekSplitTimelineTo(nextCursor, false);
                                }
                              };

                              window.addEventListener('pointermove', onMove);
                              window.addEventListener('pointerup', onUp);
                              window.addEventListener('pointercancel', onUp);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTrackType('video');
                              setSelectedSplitSegId(seg.id);
                            }}
                            className={`relative w-full h-full overflow-hidden rounded-lg block ${
                              canDragReorderVideo
                                ? 'touch-none cursor-grab active:cursor-grabbing'
                                : 'cursor-pointer'
                            } ${
                              seg.removed
                                ? 'opacity-35 grayscale border border-red-400/50 bg-slate-900'
                                : isMovingVideoSeg
                                ? 'bg-slate-900 ring-2 ring-emerald-400'
                                : isSelected
                                ? 'bg-slate-900'
                                : 'border border-white/20 bg-slate-900'
                            }`}
                          >
                            {/* Image or Video Frame Strip Background */}
                            {seg.mediaType === 'image' ? (
                              <div className="absolute inset-0 flex">
                                {Array.from({ length: Math.max(2, Math.ceil(slotWidth / 44)) }).map((_, tileIdx) => (
                                  <img
                                    key={tileIdx}
                                    src={seg.thumbnailUrl || seg.sourceUrl}
                                    alt=""
                                    draggable={false}
                                    className="h-full flex-1 min-w-0 object-cover pointer-events-none select-none"
                                  />
                                ))}
                              </div>
                            ) : displayFrames.length > 0 ? (
                              <div className="absolute inset-0 flex">
                                {Array.from({ length: Math.max(2, Math.ceil(slotWidth / 44)) }).map(
                                  (_, tileIdx) => {
                                    const frame =
                                      displayFrames[
                                        Math.min(
                                          displayFrames.length - 1,
                                          Math.floor(
                                            (tileIdx / Math.max(1, Math.ceil(slotWidth / 44))) *
                                              displayFrames.length
                                          )
                                        )
                                      ];
                                    return (
                                      <img
                                        key={tileIdx}
                                        src={frame?.url}
                                        alt=""
                                        draggable={false}
                                        className="h-full flex-1 min-w-0 object-cover pointer-events-none select-none"
                                      />
                                    );
                                  }
                                )}
                              </div>
                            ) : (
                              <div
                                className={`absolute inset-0 ${
                                  isSourceExtracting
                                    ? 'bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 animate-pulse'
                                    : 'bg-slate-800'
                                }`}
                              />
                            )}

                            {/* Dimmed Cut-Away Overlays while pulling < or > inward */}
                            {isDraggingThis && trimLeftPx > 0 && (
                              <div
                                style={{ left: 0, width: `${trimLeftPx}px` }}
                                className="absolute top-0 bottom-0 bg-black/75 pointer-events-none"
                              />
                            )}
                            {isDraggingThis && trimRightPx > 0 && (
                              <div
                                style={{ right: 0, width: `${trimRightPx}px` }}
                                className="absolute top-0 bottom-0 bg-black/75 pointer-events-none"
                              />
                            )}

                            {/* Removed Overlay */}
                            {seg.removed && (
                              <div className="absolute inset-0 bg-red-950/60 flex items-center justify-center">
                                <span className="px-1.5 py-0.5 rounded bg-black/80 text-red-200 text-[10px] font-bold uppercase tracking-wider">
                                  Removed
                                </span>
                              </div>
                            )}
                          </button>

                          {/* Active White Selection Bracket Frame + Live Duration Label */}
                          {isSelected && !seg.removed && (
                            <div
                              style={{ left: `${trimLeftPx}px`, right: `${trimRightPx}px` }}
                              className="absolute top-0 bottom-0 border-y-[3px] border-white pointer-events-none z-20"
                            >
                              {activeBracketWidth >= 52 && (
                                <span className="absolute top-1 left-2.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-mono tabular-nums text-white leading-none font-semibold">
                                  {(liveEnd - liveStart).toFixed(1)}s
                                </span>
                              )}
                            </div>
                          )}

                          {/* Left White Touch-and-Pull Trim Handle (<) */}
                          {isSelected && !seg.removed && (
                            <div
                              role="slider"
                              tabIndex={0}
                              data-trim-handle="true"
                              aria-label="Trim clip start"
                              aria-valuemin={0}
                              aria-valuemax={Number((liveEnd - 0.3).toFixed(1))}
                              aria-valuenow={Number(liveStart.toFixed(1))}
                              style={{ left: `${trimLeftPx - 16}px` }}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                try {
                                  e.currentTarget.setPointerCapture(e.pointerId);
                                } catch {
                                  // ignore capture unsupported
                                }
                                pauseAllSplitVideos();
                                setIsPlaying(false);
                                isUserScrubbingTimelineRef.current = true;
                                standbyPreloadRef.current = null;

                                const startClientX = e.clientX;
                                const startScrollLeft = splitTimelineRef.current?.scrollLeft ?? 0;
                                const frozenPx = splitPxPerSec;
                                const initialSegments = splitSegments;
                                const initialStart = seg.sourceStart;
                                const fixedEnd = seg.sourceEnd;
                                const segGlobalStart = seg.globalStart;
                                let latestStart = initialStart;

                                setActiveTrimDrag({
                                  segId: seg.id,
                                  side: 'left',
                                  initialSourceStart: initialStart,
                                  initialSourceEnd: fixedEnd,
                                  liveSourceStart: initialStart,
                                  liveSourceEnd: fixedEnd,
                                  frozenPxPerSec: frozenPx,
                                });
                                previewClipAt(initialStart);

                                const onMove = (ev: PointerEvent) => {
                                  const dx = ev.clientX - startClientX;
                                  const nextStart = Math.max(
                                    0,
                                    Math.min(fixedEnd - 0.3, Number((initialStart + dx / frozenPx).toFixed(2)))
                                  );
                                  if (nextStart === latestStart) return;
                                  latestStart = nextStart;

                                  // When pulling left outward (nextStart < initialStart), scroll right by extraPx so the right edge stays locked in place
                                  if (splitTimelineRef.current) {
                                    isSyncingTimelineScrollRef.current = true;
                                    if (nextStart < initialStart) {
                                      splitTimelineRef.current.scrollLeft =
                                        startScrollLeft + (initialStart - nextStart) * frozenPx;
                                    } else {
                                      splitTimelineRef.current.scrollLeft = startScrollLeft;
                                    }
                                    window.requestAnimationFrame(() => {
                                      isSyncingTimelineScrollRef.current = false;
                                    });
                                  }

                                  setActiveTrimDrag((prev) =>
                                    prev ? { ...prev, liveSourceStart: nextStart } : null
                                  );
                                  previewClipAt(nextStart);
                                };

                                const onUp = () => {
                                  window.removeEventListener('pointermove', onMove);
                                  window.removeEventListener('pointerup', onUp);
                                  window.removeEventListener('pointercancel', onUp);
                                  isUserScrubbingTimelineRef.current = false;
                                  setActiveTrimDrag(null);

                                  if (Math.abs(latestStart - initialStart) >= 0.05) {
                                    const nextSegments = initialSegments.map((item) =>
                                      item.id === seg.id ? { ...item, sourceStart: latestStart } : item
                                    );
                                    setSplitUndoStack((prev) => [
                                        ...prev.slice(-19),
                                        {
                                          video: initialSegments,
                                          audio: splitAudioSegments,
                                          text: splitTextOverlays,
                                          overlays: splitOverlays,
                                        },
                                      ]);
                                    setSplitRedoStack([]);
                                    setSplitSegments(nextSegments);
                                    setCurrentTime(segGlobalStart);
                                    trimBoundsRef.current.currentTime = segGlobalStart;
                                    setEditStatusMessage(null);
                                    setEditErrorMessage(null);
                                    previewClipAt(latestStart);
                                  }
                                };

                                window.addEventListener('pointermove', onMove);
                                window.addEventListener('pointerup', onUp);
                                window.addEventListener('pointercancel', onUp);
                              }}
                              className="absolute top-0 bottom-0 w-8 flex items-center justify-center cursor-ew-resize touch-none z-30 select-none"
                              title="Touch and pull to trim clip start"
                            >
                              <div className="w-5 h-full rounded-l-lg bg-white text-slate-950 flex items-center justify-center shadow-lg pointer-events-none">
                                <ChevronLeft className="w-4 h-4 stroke-[3]" />
                              </div>
                            </div>
                          )}

                          {/* Right White Touch-and-Pull Trim Handle (>) */}
                          {isSelected && !seg.removed && (
                            <div
                              role="slider"
                              tabIndex={0}
                              data-trim-handle="true"
                              aria-label="Trim clip end"
                              aria-valuemin={Number((liveStart + 0.3).toFixed(1))}
                              aria-valuemax={Number(seg.maxSourceDuration.toFixed(1))}
                              aria-valuenow={Number(liveEnd.toFixed(1))}
                              style={{ right: `${trimRightPx - 16}px` }}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                try {
                                  e.currentTarget.setPointerCapture(e.pointerId);
                                } catch {
                                  // ignore capture unsupported
                                }
                                pauseAllSplitVideos();
                                setIsPlaying(false);
                                isUserScrubbingTimelineRef.current = true;
                                standbyPreloadRef.current = null;

                                const startClientX = e.clientX;
                                const frozenPx = splitPxPerSec;
                                const initialSegments = splitSegments;
                                const initialEnd = seg.sourceEnd;
                                const fixedStart = seg.sourceStart;
                                const maxAllowedEnd = seg.maxSourceDuration || Math.max(initialEnd, 10);
                                const segGlobalStart = seg.globalStart;
                                let latestEnd = initialEnd;

                                setActiveTrimDrag({
                                  segId: seg.id,
                                  side: 'right',
                                  initialSourceStart: fixedStart,
                                  initialSourceEnd: initialEnd,
                                  liveSourceStart: fixedStart,
                                  liveSourceEnd: initialEnd,
                                  frozenPxPerSec: frozenPx,
                                });
                                previewClipAt(initialEnd);

                                const onMove = (ev: PointerEvent) => {
                                  const dx = ev.clientX - startClientX;
                                  const nextEnd = Math.min(
                                    maxAllowedEnd,
                                    Math.max(fixedStart + 0.3, Number((initialEnd + dx / frozenPx).toFixed(2)))
                                  );
                                  if (nextEnd === latestEnd) return;
                                  latestEnd = nextEnd;

                                  setActiveTrimDrag((prev) =>
                                    prev ? { ...prev, liveSourceEnd: nextEnd } : null
                                  );
                                  previewClipAt(nextEnd);
                                };

                                const onUp = () => {
                                  window.removeEventListener('pointermove', onMove);
                                  window.removeEventListener('pointerup', onUp);
                                  window.removeEventListener('pointercancel', onUp);
                                  isUserScrubbingTimelineRef.current = false;
                                  setActiveTrimDrag(null);

                                  if (Math.abs(latestEnd - initialEnd) >= 0.05) {
                                    const nextSegments = initialSegments.map((item) =>
                                      item.id === seg.id ? { ...item, sourceEnd: latestEnd } : item
                                    );
                                    const newSegEndGlobal = segGlobalStart + (latestEnd - fixedStart);
                                    setSplitUndoStack((prev) => [
                                        ...prev.slice(-19),
                                        {
                                          video: initialSegments,
                                          audio: splitAudioSegments,
                                          text: splitTextOverlays,
                                          overlays: splitOverlays,
                                        },
                                      ]);
                                    setSplitRedoStack([]);
                                    setSplitSegments(nextSegments);
                                    setCurrentTime(newSegEndGlobal);
                                    trimBoundsRef.current.currentTime = newSegEndGlobal;
                                    setEditStatusMessage(null);
                                    setEditErrorMessage(null);
                                    previewClipAt(latestEnd);
                                  }
                                };

                                window.addEventListener('pointermove', onMove);
                                window.addEventListener('pointerup', onUp);
                                window.addEventListener('pointercancel', onUp);
                              }}
                              className="absolute top-0 bottom-0 w-8 flex items-center justify-center cursor-ew-resize touch-none z-30 select-none"
                              title="Touch and pull to trim clip end"
                            >
                              <div className="w-5 h-full rounded-r-lg bg-white text-slate-950 flex items-center justify-center shadow-lg pointer-events-none">
                                <ChevronRight className="w-4 h-4 stroke-[3]" />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Row 2: Audio Track Line Directly Below Video Line (+ Add audio or interactive waveform segments) */}
                  <div className="relative h-[40px] mt-1.5 flex items-center">
                    {splitAudioSegments.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => void openAudioPickerModal()}
                        style={{ width: `${Math.max(140, totalSplitDuration * splitPxPerSec)}px` }}
                        className="h-full rounded-lg bg-white/[0.06] hover:bg-white/[0.11] border border-white/10 px-3 flex items-center gap-2 text-slate-300 hover:text-white text-xs font-medium cursor-pointer transition-colors text-left"
                      >
                        <Plus className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                        <span className="truncate">Add audio</span>
                      </button>
                    ) : (
                      mappedAudioSegments.map((aSeg, idx) => {
                        const isDraggingThis = activeAudioTrimDrag?.segId === aSeg.id;
                        const pxPerSec = isDraggingThis
                          ? activeAudioTrimDrag.frozenPxPerSec
                          : splitPxPerSec;
                        const baseStart = isDraggingThis
                          ? activeAudioTrimDrag.initialSourceStart
                          : aSeg.sourceStart;
                        const baseEnd = isDraggingThis
                          ? activeAudioTrimDrag.initialSourceEnd
                          : aSeg.sourceEnd;
                        const liveStart = isDraggingThis
                          ? activeAudioTrimDrag.liveSourceStart
                          : aSeg.sourceStart;
                        const liveEnd = isDraggingThis
                          ? activeAudioTrimDrag.liveSourceEnd
                          : aSeg.sourceEnd;

                        const baseWidth = Math.max(24, (baseEnd - baseStart) * pxPerSec);
                        const extraLeftPx =
                          isDraggingThis && liveStart < baseStart
                            ? (baseStart - liveStart) * pxPerSec
                            : 0;
                        const extraRightPx =
                          isDraggingThis && liveEnd > baseEnd
                            ? (liveEnd - baseEnd) * pxPerSec
                            : 0;
                        const slotWidth = Math.max(24, baseWidth + extraLeftPx + extraRightPx);
                        const trimLeftPx =
                          isDraggingThis && liveStart > baseStart
                            ? (liveStart - baseStart) * pxPerSec
                            : 0;
                        const trimRightPx =
                          isDraggingThis && liveEnd < baseEnd
                            ? (baseEnd - liveEnd) * pxPerSec
                            : 0;
                        const activeBracketWidth = Math.max(
                          12,
                          slotWidth - trimLeftPx - trimRightPx
                        );

                        const isSelected =
                          selectedTrackType === 'audio' && selectedAudioSegId === aSeg.id;
                        const barCount = Math.min(180, Math.max(8, Math.floor(slotWidth / 6)));

                        const previewAudioAt = (targetSourceSec: number) => {
                          if (splitAudioRef.current) {
                            splitAudioRef.current.currentTime = Math.max(
                              0,
                              Math.min(aSeg.maxSourceDuration, targetSourceSec)
                            );
                          }
                        };

                        return (
                          <div
                            key={aSeg.id}
                            data-keep-selection="true"
                            style={{ width: `${slotWidth}px` }}
                            className={`relative h-full shrink-0 ${idx > 0 ? 'ml-0.5' : ''} ${
                              isSelected ? 'z-20' : ''
                            }`}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTrackType('audio');
                                setSelectedAudioSegId(aSeg.id);
                              }}
                              className={`relative w-full h-full overflow-hidden rounded-lg cursor-pointer block text-left ${
                                isSelected
                                  ? 'bg-emerald-900/90'
                                  : 'bg-emerald-950/85 border border-emerald-400/35'
                              }`}
                            >
                              {/* Waveform Bars */}
                              <div className="absolute inset-0 flex items-center justify-between gap-[2px] px-1.5 opacity-45 pointer-events-none overflow-hidden">
                                {Array.from({ length: barCount }).map((_, bIdx) => {
                                  const hPct =
                                    28 + (((bIdx * 37 + idx * 13) % 11) / 10) * 58;
                                  return (
                                    <span
                                      key={bIdx}
                                      style={{ height: `${Math.round(hPct)}%` }}
                                      className="w-[2px] rounded-full bg-emerald-300 shrink-0"
                                    />
                                  );
                                })}
                              </div>

                              {/* Song Title & Duration Label */}
                              {activeBracketWidth >= 68 && (
                                <div className="relative z-10 h-full px-2.5 flex items-center gap-1.5 pointer-events-none">
                                  <Music className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                                  <span className="text-[11px] font-semibold text-white truncate">
                                    {aSeg.title}
                                  </span>
                                  <span className="text-[10px] font-mono tabular-nums text-emerald-200/90 shrink-0 ml-auto">
                                    {(liveEnd - liveStart).toFixed(1)}s
                                  </span>
                                </div>
                              )}

                              {/* Dimmed Cut-Away Overlays while pulling < or > inward */}
                              {isDraggingThis && trimLeftPx > 0 && (
                                <div
                                  style={{ left: 0, width: `${trimLeftPx}px` }}
                                  className="absolute top-0 bottom-0 bg-black/75 pointer-events-none z-10"
                                />
                              )}
                              {isDraggingThis && trimRightPx > 0 && (
                                <div
                                  style={{ right: 0, width: `${trimRightPx}px` }}
                                  className="absolute top-0 bottom-0 bg-black/75 pointer-events-none z-10"
                                />
                              )}
                            </button>

                            {/* Active White Selection Bracket Frame */}
                            {isSelected && (
                              <div
                                style={{ left: `${trimLeftPx}px`, right: `${trimRightPx}px` }}
                                className="absolute top-0 bottom-0 border-y-[3px] border-white pointer-events-none z-20"
                              />
                            )}

                            {/* Left White Touch-and-Pull Audio Trim Handle (<) */}
                            {isSelected && (
                              <div
                                role="slider"
                                tabIndex={0}
                                data-trim-handle="true"
                                aria-label="Trim audio start"
                                aria-valuemin={0}
                                aria-valuemax={Number((liveEnd - 0.3).toFixed(1))}
                                aria-valuenow={Number(liveStart.toFixed(1))}
                                style={{ left: `${trimLeftPx - 16}px` }}
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  try {
                                    e.currentTarget.setPointerCapture(e.pointerId);
                                  } catch {
                                    // ignore capture unsupported
                                  }
                                  pauseAllSplitVideos();
                                  setIsPlaying(false);
                                  isUserScrubbingTimelineRef.current = true;

                                  const startClientX = e.clientX;
                                  const startScrollLeft = splitTimelineRef.current?.scrollLeft ?? 0;
                                  const frozenPx = splitPxPerSec;
                                  const initialAudio = splitAudioSegments;
                                  const initialStart = aSeg.sourceStart;
                                  const fixedEnd = aSeg.sourceEnd;
                                  const segGlobalStart = aSeg.globalStart;
                                  let latestStart = initialStart;

                                  setActiveAudioTrimDrag({
                                    segId: aSeg.id,
                                    side: 'left',
                                    initialSourceStart: initialStart,
                                    initialSourceEnd: fixedEnd,
                                    liveSourceStart: initialStart,
                                    liveSourceEnd: fixedEnd,
                                    frozenPxPerSec: frozenPx,
                                  });
                                  previewAudioAt(initialStart);

                                  const onMove = (ev: PointerEvent) => {
                                    const dx = ev.clientX - startClientX;
                                    const nextStart = Math.max(
                                      0,
                                      Math.min(
                                        fixedEnd - 0.3,
                                        Number((initialStart + dx / frozenPx).toFixed(2))
                                      )
                                    );
                                    if (nextStart === latestStart) return;
                                    latestStart = nextStart;

                                    if (splitTimelineRef.current) {
                                      isSyncingTimelineScrollRef.current = true;
                                      if (nextStart < initialStart) {
                                        splitTimelineRef.current.scrollLeft =
                                          startScrollLeft + (initialStart - nextStart) * frozenPx;
                                      } else {
                                        splitTimelineRef.current.scrollLeft = startScrollLeft;
                                      }
                                      window.requestAnimationFrame(() => {
                                        isSyncingTimelineScrollRef.current = false;
                                      });
                                    }

                                    setActiveAudioTrimDrag((prev) =>
                                      prev ? { ...prev, liveSourceStart: nextStart } : null
                                    );
                                    previewAudioAt(nextStart);
                                  };

                                  const onUp = () => {
                                    window.removeEventListener('pointermove', onMove);
                                    window.removeEventListener('pointerup', onUp);
                                    window.removeEventListener('pointercancel', onUp);
                                    isUserScrubbingTimelineRef.current = false;
                                    setActiveAudioTrimDrag(null);

                                    if (Math.abs(latestStart - initialStart) >= 0.05) {
                                      const nextAudio = initialAudio.map((item) =>
                                        item.id === aSeg.id
                                          ? { ...item, sourceStart: latestStart }
                                          : item
                                      );
                                      setSplitUndoStack((prev) => [
                                        ...prev.slice(-19),
                                        {
                                          video: splitSegments,
                                          audio: initialAudio,
                                          text: splitTextOverlays,
                                          overlays: splitOverlays,
                                        },
                                      ]);
                                      setSplitRedoStack([]);
                                      setSplitAudioSegments(nextAudio);
                                      setCurrentTime(segGlobalStart);
                                      trimBoundsRef.current.currentTime = segGlobalStart;
                                      setEditStatusMessage(null);
                                      setEditErrorMessage(null);
                                      previewAudioAt(latestStart);
                                    }
                                  };

                                  window.addEventListener('pointermove', onMove);
                                  window.addEventListener('pointerup', onUp);
                                  window.addEventListener('pointercancel', onUp);
                                }}
                                className="absolute top-0 bottom-0 w-8 flex items-center justify-center cursor-ew-resize touch-none z-30 select-none"
                                title="Touch and pull to trim audio start"
                              >
                                <div className="w-5 h-full rounded-l-lg bg-white text-slate-950 flex items-center justify-center shadow-lg pointer-events-none">
                                  <ChevronLeft className="w-4 h-4 stroke-[3]" />
                                </div>
                              </div>
                            )}

                            {/* Right White Touch-and-Pull Audio Trim Handle (>) */}
                            {isSelected && (
                              <div
                                role="slider"
                                tabIndex={0}
                                data-trim-handle="true"
                                aria-label="Trim audio end"
                                aria-valuemin={Number((liveStart + 0.3).toFixed(1))}
                                aria-valuemax={Number(aSeg.maxSourceDuration.toFixed(1))}
                                aria-valuenow={Number(liveEnd.toFixed(1))}
                                style={{ right: `${trimRightPx - 16}px` }}
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  try {
                                    e.currentTarget.setPointerCapture(e.pointerId);
                                  } catch {
                                    // ignore capture unsupported
                                  }
                                  pauseAllSplitVideos();
                                  setIsPlaying(false);
                                  isUserScrubbingTimelineRef.current = true;

                                  const startClientX = e.clientX;
                                  const frozenPx = splitPxPerSec;
                                  const initialAudio = splitAudioSegments;
                                  const initialEnd = aSeg.sourceEnd;
                                  const fixedStart = aSeg.sourceStart;
                                  const maxAllowedEnd =
                                    aSeg.maxSourceDuration || Math.max(initialEnd, 10);
                                  const segGlobalStart = aSeg.globalStart;
                                  let latestEnd = initialEnd;

                                  setActiveAudioTrimDrag({
                                    segId: aSeg.id,
                                    side: 'right',
                                    initialSourceStart: fixedStart,
                                    initialSourceEnd: initialEnd,
                                    liveSourceStart: fixedStart,
                                    liveSourceEnd: initialEnd,
                                    frozenPxPerSec: frozenPx,
                                  });
                                  previewAudioAt(initialEnd);

                                  const onMove = (ev: PointerEvent) => {
                                    const dx = ev.clientX - startClientX;
                                    const nextEnd = Math.min(
                                      maxAllowedEnd,
                                      Math.max(
                                        fixedStart + 0.3,
                                        Number((initialEnd + dx / frozenPx).toFixed(2))
                                      )
                                    );
                                    if (nextEnd === latestEnd) return;
                                    latestEnd = nextEnd;

                                    setActiveAudioTrimDrag((prev) =>
                                      prev ? { ...prev, liveSourceEnd: nextEnd } : null
                                    );
                                    previewAudioAt(nextEnd);
                                  };

                                  const onUp = () => {
                                    window.removeEventListener('pointermove', onMove);
                                    window.removeEventListener('pointerup', onUp);
                                    window.removeEventListener('pointercancel', onUp);
                                    isUserScrubbingTimelineRef.current = false;
                                    setActiveAudioTrimDrag(null);

                                    if (Math.abs(latestEnd - initialEnd) >= 0.05) {
                                      const nextAudio = initialAudio.map((item) =>
                                        item.id === aSeg.id
                                          ? { ...item, sourceEnd: latestEnd }
                                          : item
                                      );
                                      const newSegEndGlobal =
                                        segGlobalStart + (latestEnd - fixedStart);
                                      setSplitUndoStack((prev) => [
                                        ...prev.slice(-19),
                                        {
                                          video: splitSegments,
                                          audio: initialAudio,
                                          text: splitTextOverlays,
                                          overlays: splitOverlays,
                                        },
                                      ]);
                                      setSplitRedoStack([]);
                                      setSplitAudioSegments(nextAudio);
                                      setCurrentTime(newSegEndGlobal);
                                      trimBoundsRef.current.currentTime = newSegEndGlobal;
                                      setEditStatusMessage(null);
                                      setEditErrorMessage(null);
                                      previewAudioAt(latestEnd);
                                    }
                                  };

                                  window.addEventListener('pointermove', onMove);
                                  window.addEventListener('pointerup', onUp);
                                  window.addEventListener('pointercancel', onUp);
                                }}
                                className="absolute top-0 bottom-0 w-8 flex items-center justify-center cursor-ew-resize touch-none z-30 select-none"
                                title="Touch and pull to trim audio end"
                              >
                                <div className="w-5 h-full rounded-r-lg bg-white text-slate-950 flex items-center justify-center shadow-lg pointer-events-none">
                                  <ChevronRight className="w-4 h-4 stroke-[3]" />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Row 3+: Multi-Section & Multi-Line Text Tracks (+ Add text in front OR add new text line below) */}
                  {Array.from({ length: textRowCount }).map((_, rowIdx) => {
                    const timelineCap = Math.max(0.5, maxSplitTimelineDuration);
                    const rowItems = splitTextOverlays
                      .filter((t) => (t.trackRow ?? 0) === rowIdx)
                      .sort((a, b) => a.startTime - b.startTime);
                    const rowLastEnd = rowItems.reduce(
                      (m, t) => Math.max(m, t.endTime >= 90000 ? timelineCap : t.endTime),
                      0
                    );

                    return (
                      <div key={`text-row-${rowIdx}`} className="relative h-[38px] mt-1.5">
                        {rowItems.length === 0 ? (
                          <button
                            type="button"
                            data-keep-selection="true"
                            onClick={() => openAddTextEditor(undefined, { row: rowIdx })}
                            style={{ width: `${Math.max(140, maxSplitTimelineDuration * splitPxPerSec)}px` }}
                            className="h-full rounded-lg bg-white/[0.06] hover:bg-white/[0.11] border border-white/10 px-3 flex items-center gap-2 text-slate-300 hover:text-white text-xs font-medium cursor-pointer transition-colors text-left"
                          >
                            <Plus className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                            <span className="truncate">
                              {rowIdx === 0 ? 'Add text' : `Add text on Line ${rowIdx + 1}`}
                            </span>
                          </button>
                        ) : (
                          <>
                            {rowItems.map((ov) => {
                              const isDraggingTrim = activeTextTrimDrag?.id === ov.id;
                              const isDraggingMove = activeTextMoveDrag?.id === ov.id;
                              const pxPerSec = isDraggingTrim
                                ? activeTextTrimDrag.frozenPxPerSec
                                : isDraggingMove
                                ? activeTextMoveDrag.frozenPxPerSec
                                : splitPxPerSec;
                              const storedStart = Math.max(0, ov.startTime);
                              const storedEnd =
                                ov.endTime >= 90000
                                  ? timelineCap
                                  : Math.max(storedStart + 0.3, ov.endTime);
                              const liveStart = isDraggingTrim
                                ? activeTextTrimDrag.liveStart
                                : isDraggingMove
                                ? activeTextMoveDrag.liveStart
                                : storedStart;
                              const liveEnd = isDraggingTrim
                                ? activeTextTrimDrag.liveEnd
                                : isDraggingMove
                                ? activeTextMoveDrag.liveEnd
                                : storedEnd;
                              const leftPx = liveStart * pxPerSec;
                              const barWidth = Math.max(28, (liveEnd - liveStart) * pxPerSec);
                              const isSelected =
                                selectedTrackType === 'text' && selectedTextId === ov.id;

                              return (
                                <div
                                  key={ov.id}
                                  data-keep-selection="true"
                                  style={{ left: `${leftPx}px`, width: `${barWidth}px` }}
                                  className={`absolute top-0 bottom-0 ${
                                    isDraggingMove ? 'z-30 opacity-95' : isSelected ? 'z-20' : 'z-10'
                                  }`}
                                >
                            <button
                              type="button"
                              onPointerDown={(e) => {
                                if (!isSelected && e.pointerType !== 'mouse') return;
                                e.stopPropagation();
                                try {
                                  e.currentTarget.setPointerCapture(e.pointerId);
                                } catch {
                                  // ignore
                                }
                                const startClientX = e.clientX;
                                const frozenPx = splitPxPerSec;
                                const initialTextList = splitTextOverlays;
                                const initStart = storedStart;
                                const clipDur = Math.max(0.3, storedEnd - storedStart);
                                let latestStart = initStart;
                                let latestEnd = initStart + clipDur;
                                let moved = false;

                                const onMove = (ev: PointerEvent) => {
                                  const dx = ev.clientX - startClientX;
                                  if (!moved && Math.abs(dx) < 5) return;
                                  if (!moved) {
                                    moved = true;
                                    pauseAllSplitVideos();
                                    setIsPlaying(false);
                                    isUserScrubbingTimelineRef.current = true;
                                    setSelectedTrackType('text');
                                    setSelectedTextId(ov.id);
                                    setActiveTextMoveDrag({
                                      id: ov.id,
                                      initialStart: initStart,
                                      initialEnd: initStart + clipDur,
                                      liveStart: initStart,
                                      liveEnd: initStart + clipDur,
                                      frozenPxPerSec: frozenPx,
                                    });
                                  }
                                  const snappedStart = snapTimelinePosition(
                                    initStart + dx / frozenPx,
                                    frozenPx
                                  );
                                  if (snappedStart === latestStart) return;
                                  latestStart = snappedStart;
                                  latestEnd = Number((snappedStart + clipDur).toFixed(2));
                                  setActiveTextMoveDrag((prev) =>
                                    prev
                                      ? { ...prev, liveStart: latestStart, liveEnd: latestEnd }
                                      : null
                                  );
                                };

                                const onUp = () => {
                                  window.removeEventListener('pointermove', onMove);
                                  window.removeEventListener('pointerup', onUp);
                                  window.removeEventListener('pointercancel', onUp);
                                  isUserScrubbingTimelineRef.current = false;
                                  setActiveTextMoveDrag(null);

                                  if (moved && Math.abs(latestStart - initStart) >= 0.02) {
                                    const nextOverlays = initialTextList.map((item) =>
                                      item.id === ov.id
                                        ? { ...item, startTime: latestStart, endTime: latestEnd }
                                        : item
                                    );
                                    setSplitUndoStack((prev) => [
                                      ...prev.slice(-19),
                                      {
                                        video: splitSegments,
                                        audio: splitAudioSegments,
                                        text: initialTextList,
                                        overlays: splitOverlays,
                                        crop: mainVideoCrop,
                                      },
                                    ]);
                                    setSplitRedoStack([]);
                                    setSplitTextOverlays(nextOverlays);
                                    setEditStatusMessage(null);
                                    setEditErrorMessage(null);
                                  } else if (!moved && isSelected) {
                                    openAddTextEditor(ov);
                                  } else if (!moved) {
                                    setSelectedTrackType('text');
                                    setSelectedTextId(ov.id);
                                  }
                                };

                                window.addEventListener('pointermove', onMove);
                                window.addEventListener('pointerup', onUp);
                                window.addEventListener('pointercancel', onUp);
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!isSelected) {
                                  setSelectedTrackType('text');
                                  setSelectedTextId(ov.id);
                                }
                              }}
                              className={`relative w-full h-full overflow-hidden rounded-lg px-2.5 flex items-center gap-1.5 text-left ${
                                isSelected
                                  ? 'bg-amber-600/90 touch-none cursor-grab active:cursor-grabbing'
                                  : 'bg-amber-900/80 border border-amber-400/40 cursor-pointer'
                              }`}
                              title="Drag along line to move · tap to select/edit · pull < or > to trim"
                            >
                              <Type className="w-3.5 h-3.5 text-amber-200 shrink-0" />
                              {barWidth >= 60 && (
                                <span className="text-[11px] font-semibold text-white truncate">
                                  {isDraggingMove ? formatTimePadded(liveStart) : ov.text}
                                </span>
                              )}
                              {barWidth >= 96 && (
                                <span className="text-[10px] font-mono tabular-nums text-amber-100/90 shrink-0 ml-auto">
                                  {(liveEnd - liveStart).toFixed(1)}s
                                </span>
                              )}
                            </button>

                            {/* Active White Selection Bracket Frame */}
                            {isSelected && (
                              <div className="absolute inset-0 border-y-[3px] border-white pointer-events-none z-20" />
                            )}

                            {/* Left White Touch-and-Pull Text Trim Handle (<) */}
                            {isSelected && (
                              <div
                                role="slider"
                                tabIndex={0}
                                data-trim-handle="true"
                                aria-label="Trim text start"
                                aria-valuemin={0}
                                aria-valuemax={Number((liveEnd - 0.3).toFixed(1))}
                                aria-valuenow={Number(liveStart.toFixed(1))}
                                style={{ left: '-16px' }}
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  try {
                                    e.currentTarget.setPointerCapture(e.pointerId);
                                  } catch {
                                    // ignore capture unsupported
                                  }
                                  pauseAllSplitVideos();
                                  setIsPlaying(false);
                                  isUserScrubbingTimelineRef.current = true;

                                  const startClientX = e.clientX;
                                  const frozenPx = splitPxPerSec;
                                  const initialOverlays = splitTextOverlays;
                                  const initialStart = storedStart;
                                  const fixedEnd = storedEnd;
                                  let latestStart = initialStart;

                                  setActiveTextTrimDrag({
                                    id: ov.id,
                                    side: 'left',
                                    initialStart,
                                    initialEnd: fixedEnd,
                                    liveStart: initialStart,
                                    liveEnd: fixedEnd,
                                    frozenPxPerSec: frozenPx,
                                  });

                                  const onMove = (ev: PointerEvent) => {
                                    const dx = ev.clientX - startClientX;
                                    const nextStart = Math.max(
                                      0,
                                      Math.min(
                                        fixedEnd - 0.3,
                                        Number((initialStart + dx / frozenPx).toFixed(2))
                                      )
                                    );
                                    if (nextStart === latestStart) return;
                                    latestStart = nextStart;
                                    setActiveTextTrimDrag((prev) =>
                                      prev ? { ...prev, liveStart: nextStart } : null
                                    );
                                  };

                                  const onUp = () => {
                                    window.removeEventListener('pointermove', onMove);
                                    window.removeEventListener('pointerup', onUp);
                                    window.removeEventListener('pointercancel', onUp);
                                    isUserScrubbingTimelineRef.current = false;
                                    setActiveTextTrimDrag(null);

                                    if (Math.abs(latestStart - initialStart) >= 0.05) {
                                      const nextOverlays = initialOverlays.map((item) =>
                                        item.id === ov.id
                                          ? { ...item, startTime: latestStart, endTime: fixedEnd }
                                          : item
                                      );
                                      setSplitUndoStack((prev) => [
                                        ...prev.slice(-19),
                                        {
                                          video: splitSegments,
                                          audio: splitAudioSegments,
                                          text: initialOverlays,
                                          overlays: splitOverlays,
                                        },
                                      ]);
                                      setSplitRedoStack([]);
                                      setSplitTextOverlays(nextOverlays);
                                      setCurrentTime(latestStart);
                                      trimBoundsRef.current.currentTime = latestStart;
                                      setEditStatusMessage(null);
                                      setEditErrorMessage(null);
                                    }
                                  };

                                  window.addEventListener('pointermove', onMove);
                                  window.addEventListener('pointerup', onUp);
                                  window.addEventListener('pointercancel', onUp);
                                }}
                                className="absolute top-0 bottom-0 w-8 flex items-center justify-center cursor-ew-resize touch-none z-30 select-none"
                                title="Touch and pull to trim text start"
                              >
                                <div className="w-5 h-full rounded-l-lg bg-white text-slate-950 flex items-center justify-center shadow-lg pointer-events-none">
                                  <ChevronLeft className="w-4 h-4 stroke-[3]" />
                                </div>
                              </div>
                            )}

                            {/* Right White Touch-and-Pull Text Trim Handle (>) */}
                            {isSelected && (
                              <div
                                role="slider"
                                tabIndex={0}
                                data-trim-handle="true"
                                aria-label="Trim text end"
                                aria-valuemin={Number((liveStart + 0.3).toFixed(1))}
                                aria-valuemax={Number(timelineCap.toFixed(1))}
                                aria-valuenow={Number(liveEnd.toFixed(1))}
                                style={{ right: '-16px' }}
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  try {
                                    e.currentTarget.setPointerCapture(e.pointerId);
                                  } catch {
                                    // ignore capture unsupported
                                  }
                                  pauseAllSplitVideos();
                                  setIsPlaying(false);
                                  isUserScrubbingTimelineRef.current = true;

                                  const startClientX = e.clientX;
                                  const frozenPx = splitPxPerSec;
                                  const initialOverlays = splitTextOverlays;
                                  const fixedStart = storedStart;
                                  const initialEnd = storedEnd;
                                  const maxAllowedEnd = Math.max(timelineCap, initialEnd);
                                  let latestEnd = initialEnd;

                                  setActiveTextTrimDrag({
                                    id: ov.id,
                                    side: 'right',
                                    initialStart: fixedStart,
                                    initialEnd,
                                    liveStart: fixedStart,
                                    liveEnd: initialEnd,
                                    frozenPxPerSec: frozenPx,
                                  });

                                  const onMove = (ev: PointerEvent) => {
                                    const dx = ev.clientX - startClientX;
                                    const nextEnd = Math.min(
                                      maxAllowedEnd,
                                      Math.max(
                                        fixedStart + 0.3,
                                        Number((initialEnd + dx / frozenPx).toFixed(2))
                                      )
                                    );
                                    if (nextEnd === latestEnd) return;
                                    latestEnd = nextEnd;
                                    setActiveTextTrimDrag((prev) =>
                                      prev ? { ...prev, liveEnd: nextEnd } : null
                                    );
                                  };

                                  const onUp = () => {
                                    window.removeEventListener('pointermove', onMove);
                                    window.removeEventListener('pointerup', onUp);
                                    window.removeEventListener('pointercancel', onUp);
                                    isUserScrubbingTimelineRef.current = false;
                                    setActiveTextTrimDrag(null);

                                    if (Math.abs(latestEnd - initialEnd) >= 0.05) {
                                      const nextOverlays = initialOverlays.map((item) =>
                                        item.id === ov.id
                                          ? { ...item, startTime: fixedStart, endTime: latestEnd }
                                          : item
                                      );
                                      setSplitUndoStack((prev) => [
                                        ...prev.slice(-19),
                                        {
                                          video: splitSegments,
                                          audio: splitAudioSegments,
                                          text: initialOverlays,
                                          overlays: splitOverlays,
                                        },
                                      ]);
                                      setSplitRedoStack([]);
                                      setSplitTextOverlays(nextOverlays);
                                      const previewTime = Math.max(fixedStart, latestEnd - 0.1);
                                      setCurrentTime(previewTime);
                                      trimBoundsRef.current.currentTime = previewTime;
                                      setEditStatusMessage(null);
                                      setEditErrorMessage(null);
                                    }
                                  };

                                  window.addEventListener('pointermove', onMove);
                                  window.addEventListener('pointerup', onUp);
                                  window.addEventListener('pointercancel', onUp);
                                }}
                                className="absolute top-0 bottom-0 w-8 flex items-center justify-center cursor-ew-resize touch-none z-30 select-none"
                                title="Touch and pull to trim text end"
                              >
                                <div className="w-5 h-full rounded-r-lg bg-white text-slate-950 flex items-center justify-center shadow-lg pointer-events-none">
                                  <ChevronRight className="w-4 h-4 stroke-[3]" />
                                </div>
                              </div>
                            )}
                                </div>
                              );
                            })}
                            {rowLastEnd < timelineCap - 0.35 && (
                              <button
                                type="button"
                                data-keep-selection="true"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openAddTextEditor(undefined, { row: rowIdx, startAt: rowLastEnd });
                                }}
                                style={{
                                  left: `${rowLastEnd * splitPxPerSec + 4}px`,
                                  width: `${Math.max(76, (timelineCap - rowLastEnd) * splitPxPerSec - 4)}px`,
                                }}
                                className="absolute top-0 bottom-0 rounded-lg border border-dashed border-amber-400/45 bg-amber-500/[0.08] hover:bg-amber-500/20 px-2.5 flex items-center gap-1 text-[11px] font-semibold text-amber-200 cursor-pointer transition-colors truncate"
                                title="Add another text in front on this line"
                              >
                                <Plus className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">Add text</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}

                  {/* Dedicated "+ Add text line" strip below existing text rows */}
                  {hasTextAddLineRow && (
                    <div className="relative h-[30px] mt-1.5">
                      <button
                        type="button"
                        data-keep-selection="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          openAddTextEditor(undefined, { row: textRowCount });
                        }}
                        style={{ width: `${Math.max(140, maxSplitTimelineDuration * splitPxPerSec)}px` }}
                        className="h-full rounded-lg bg-white/[0.04] hover:bg-white/[0.09] border border-dashed border-white/15 px-3 flex items-center gap-1.5 text-slate-300 hover:text-white text-[11px] font-medium cursor-pointer transition-colors text-left"
                        title="Create another text line below"
                      >
                        <Plus className="w-3 h-3 text-amber-300 shrink-0" />
                        <span className="truncate">Add text line below</span>
                      </button>
                    </div>
                  )}

                  {/* Row 4: Overlay Track Line (Video & Photo Overlays with Touch-and-Pull < > Trim Handles) */}
                  {splitOverlays.length > 0 && (
                    <div className="relative h-[40px] mt-1.5">
                      {splitOverlays.map((ov) => {
                        const isDraggingTrim = activeOverlayTrimDrag?.id === ov.id;
                        const isDraggingMove = activeOverlayMoveDrag?.id === ov.id;
                        const pxPerSec = isDraggingTrim
                          ? activeOverlayTrimDrag.frozenPxPerSec
                          : isDraggingMove
                          ? activeOverlayMoveDrag.frozenPxPerSec
                          : splitPxPerSec;
                        const liveTimelineStart = isDraggingTrim
                          ? activeOverlayTrimDrag.liveTimelineStart
                          : isDraggingMove
                          ? activeOverlayMoveDrag.liveTimelineStart
                          : ov.timelineStart;
                        const liveSourceStart = isDraggingTrim
                          ? activeOverlayTrimDrag.liveSourceStart
                          : ov.sourceStart;
                        const liveSourceEnd = isDraggingTrim
                          ? activeOverlayTrimDrag.liveSourceEnd
                          : ov.sourceEnd;
                        const leftPx = liveTimelineStart * pxPerSec;
                        const barWidth = Math.max(28, (liveSourceEnd - liveSourceStart) * pxPerSec);
                        const isSelected =
                          selectedTrackType === 'overlay' && selectedOverlayId === ov.id;
                        const sourceFrames =
                          ov.mediaType === 'video' ? splitFramesBySource[ov.sourceUrl] || [] : [];
                        const segThumbs =
                          sourceFrames.length > 0
                            ? sourceFrames.filter(
                                (f) => f.time >= liveSourceStart - 2 && f.time <= liveSourceEnd + 2
                              )
                            : [];
                        const displayFrames =
                          segThumbs.length > 0 ? segThumbs : sourceFrames.slice(0, 3);

                        return (
                          <div
                            key={ov.id}
                            data-keep-selection="true"
                            style={{ left: `${leftPx}px`, width: `${barWidth}px` }}
                            className={`absolute top-0 bottom-0 ${
                              isDraggingMove ? 'z-30 opacity-95' : isSelected ? 'z-20' : 'z-10'
                            }`}
                          >
                            <button
                              type="button"
                              onPointerDown={(e) => {
                                if (!isSelected && e.pointerType !== 'mouse') return;
                                e.stopPropagation();
                                try {
                                  e.currentTarget.setPointerCapture(e.pointerId);
                                } catch {
                                  // ignore capture unsupported
                                }
                                const startClientX = e.clientX;
                                const frozenPx = splitPxPerSec;
                                const initialOverlays = splitOverlays;
                                const initTlStart = ov.timelineStart;
                                const ovDur = Math.max(0.1, ov.sourceEnd - ov.sourceStart);
                                let latestTlStart = initTlStart;
                                let moved = false;

                                const onMove = (ev: PointerEvent) => {
                                  const dx = ev.clientX - startClientX;
                                  if (!moved && Math.abs(dx) < 5) return;
                                  if (!moved) {
                                    moved = true;
                                    pauseAllSplitVideos();
                                    setIsPlaying(false);
                                    isUserScrubbingTimelineRef.current = true;
                                    setSelectedTrackType('overlay');
                                    setSelectedOverlayId(ov.id);
                                    setActiveOverlayMoveDrag({
                                      id: ov.id,
                                      initialTimelineStart: initTlStart,
                                      liveTimelineStart: initTlStart,
                                      duration: ovDur,
                                      frozenPxPerSec: frozenPx,
                                    });
                                  }
                                  const snapped = snapTimelinePosition(
                                    initTlStart + dx / frozenPx,
                                    frozenPx
                                  );
                                  if (snapped === latestTlStart) return;
                                  latestTlStart = snapped;
                                  setActiveOverlayMoveDrag((prev) =>
                                    prev ? { ...prev, liveTimelineStart: snapped } : null
                                  );
                                  const liveNext = initialOverlays.map((item) =>
                                    item.id === ov.id ? { ...item, timelineStart: snapped } : item
                                  );
                                  trimBoundsRef.current.splitOverlays = liveNext;
                                  syncOverlaysToTime(trimBoundsRef.current.currentTime, false);
                                };

                                const onUp = () => {
                                  window.removeEventListener('pointermove', onMove);
                                  window.removeEventListener('pointerup', onUp);
                                  window.removeEventListener('pointercancel', onUp);
                                  isUserScrubbingTimelineRef.current = false;
                                  setActiveOverlayMoveDrag(null);

                                  if (moved && Math.abs(latestTlStart - initTlStart) >= 0.02) {
                                    const nextOverlays = initialOverlays.map((item) =>
                                      item.id === ov.id
                                        ? { ...item, timelineStart: latestTlStart }
                                        : item
                                    );
                                    setSplitUndoStack((prev) => [
                                      ...prev.slice(-19),
                                      {
                                        video: splitSegments,
                                        audio: splitAudioSegments,
                                        text: splitTextOverlays,
                                        overlays: initialOverlays,
                                        crop: mainVideoCrop,
                                      },
                                    ]);
                                    setSplitRedoStack([]);
                                    setSplitOverlays(nextOverlays);
                                    trimBoundsRef.current.splitOverlays = nextOverlays;
                                    syncOverlaysToTime(trimBoundsRef.current.currentTime, false);
                                    setEditStatusMessage(null);
                                    setEditErrorMessage(null);
                                  } else if (!moved) {
                                    setSelectedTrackType('overlay');
                                    setSelectedOverlayId(ov.id);
                                  }
                                };

                                window.addEventListener('pointermove', onMove);
                                window.addEventListener('pointerup', onUp);
                                window.addEventListener('pointercancel', onUp);
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTrackType('overlay');
                                setSelectedOverlayId(ov.id);
                              }}
                              className={`relative w-full h-full overflow-hidden rounded-lg flex items-center ${
                                isSelected
                                  ? 'bg-violet-950/90 touch-none cursor-grab active:cursor-grabbing'
                                  : 'bg-violet-950/75 border border-violet-400/45 cursor-pointer'
                              }`}
                              title="Drag along line to move · pull < or > handles to trim"
                            >
                              {ov.mediaType === 'image' ? (
                                <div className="absolute inset-0 flex opacity-65">
                                  {Array.from({
                                    length: Math.max(2, Math.ceil(barWidth / 38)),
                                  }).map((_, tileIdx) => (
                                    <img
                                      key={tileIdx}
                                      src={ov.thumbnailUrl || ov.sourceUrl}
                                      alt=""
                                      draggable={false}
                                      className="h-full flex-1 min-w-0 object-cover pointer-events-none select-none"
                                    />
                                  ))}
                                </div>
                              ) : displayFrames.length > 0 ? (
                                <div className="absolute inset-0 flex opacity-65">
                                  {Array.from({
                                    length: Math.max(2, Math.ceil(barWidth / 38)),
                                  }).map((_, tileIdx) => {
                                    const frame =
                                      displayFrames[
                                        Math.min(
                                          displayFrames.length - 1,
                                          Math.floor(
                                            (tileIdx /
                                              Math.max(1, Math.ceil(barWidth / 38))) *
                                              displayFrames.length
                                          )
                                        )
                                      ];
                                    return (
                                      <img
                                        key={tileIdx}
                                        src={frame?.url}
                                        alt=""
                                        draggable={false}
                                        className="h-full flex-1 min-w-0 object-cover pointer-events-none select-none"
                                      />
                                    );
                                  })}
                                </div>
                              ) : null}

                              <div className="relative z-10 w-full px-2 flex items-center gap-1.5 bg-gradient-to-r from-violet-950/75 via-violet-950/40 to-violet-950/75 h-full">
                                <Layers className="w-3.5 h-3.5 text-violet-200 shrink-0" />
                                {isDraggingMove ? (
                                  <span className="text-[11px] font-mono font-bold text-emerald-300 truncate drop-shadow">
                                    @{formatTimePadded(liveTimelineStart)}
                                  </span>
                                ) : (
                                  barWidth >= 60 && (
                                    <span className="text-[11px] font-semibold text-white truncate drop-shadow">
                                      {ov.title}
                                    </span>
                                  )
                                )}
                                {barWidth >= 96 && (
                                  <span className="text-[10px] font-mono tabular-nums text-violet-100/95 shrink-0 ml-auto drop-shadow">
                                    {(liveSourceEnd - liveSourceStart).toFixed(1)}s
                                  </span>
                                )}
                              </div>
                            </button>

                            {/* Active White Selection Bracket Frame */}
                            {isSelected && (
                              <div className="absolute inset-0 border-y-[3px] border-white pointer-events-none z-20" />
                            )}

                            {/* Left White Touch-and-Pull Overlay Trim Handle (<) */}
                            {isSelected && (
                              <div
                                role="slider"
                                tabIndex={0}
                                data-trim-handle="true"
                                aria-label="Trim overlay start"
                                aria-valuemin={0}
                                aria-valuemax={Number(
                                  (
                                    liveTimelineStart +
                                    (liveSourceEnd - liveSourceStart) -
                                    0.3
                                  ).toFixed(1)
                                )}
                                aria-valuenow={Number(liveTimelineStart.toFixed(1))}
                                style={{ left: '-16px' }}
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  try {
                                    e.currentTarget.setPointerCapture(e.pointerId);
                                  } catch {
                                    // ignore capture unsupported
                                  }
                                  pauseAllSplitVideos();
                                  setIsPlaying(false);
                                  isUserScrubbingTimelineRef.current = true;

                                  const startClientX = e.clientX;
                                  const frozenPx = splitPxPerSec;
                                  const initialOverlays = splitOverlays;
                                  const initTlStart = ov.timelineStart;
                                  const initSrcStart = ov.sourceStart;
                                  const fixedSrcEnd = ov.sourceEnd;
                                  const origEndTimeline =
                                    initTlStart + (fixedSrcEnd - initSrcStart);
                                  const minTlStart =
                                    ov.mediaType === 'video'
                                      ? Math.max(0, initTlStart - initSrcStart)
                                      : 0;
                                  const maxTlStart = origEndTimeline - 0.3;

                                  let latestTlStart = initTlStart;
                                  let latestSrcStart = initSrcStart;
                                  let latestSrcEnd = fixedSrcEnd;

                                  setActiveOverlayTrimDrag({
                                    id: ov.id,
                                    side: 'left',
                                    initialTimelineStart: initTlStart,
                                    initialSourceStart: initSrcStart,
                                    initialSourceEnd: fixedSrcEnd,
                                    liveTimelineStart: initTlStart,
                                    liveSourceStart: initSrcStart,
                                    liveSourceEnd: fixedSrcEnd,
                                    frozenPxPerSec: frozenPx,
                                  });

                                  const onMove = (ev: PointerEvent) => {
                                    const dx = ev.clientX - startClientX;
                                    const nextTlStart = Math.max(
                                      minTlStart,
                                      Math.min(
                                        maxTlStart,
                                        Number((initTlStart + dx / frozenPx).toFixed(2))
                                      )
                                    );
                                    if (nextTlStart === latestTlStart) return;
                                    latestTlStart = nextTlStart;
                                    if (ov.mediaType === 'video') {
                                      const delta = nextTlStart - initTlStart;
                                      latestSrcStart = Number((initSrcStart + delta).toFixed(2));
                                      latestSrcEnd = fixedSrcEnd;
                                    } else {
                                      const nextDur = Math.max(0.3, origEndTimeline - nextTlStart);
                                      latestSrcStart = initSrcStart;
                                      latestSrcEnd = Number((initSrcStart + nextDur).toFixed(2));
                                    }
                                    setActiveOverlayTrimDrag((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            liveTimelineStart: latestTlStart,
                                            liveSourceStart: latestSrcStart,
                                            liveSourceEnd: latestSrcEnd,
                                          }
                                        : null
                                    );
                                  };

                                  const onUp = () => {
                                    window.removeEventListener('pointermove', onMove);
                                    window.removeEventListener('pointerup', onUp);
                                    window.removeEventListener('pointercancel', onUp);
                                    isUserScrubbingTimelineRef.current = false;
                                    setActiveOverlayTrimDrag(null);

                                    if (Math.abs(latestTlStart - initTlStart) >= 0.05) {
                                      const nextOverlays = initialOverlays.map((item) =>
                                        item.id === ov.id
                                          ? {
                                              ...item,
                                              timelineStart: latestTlStart,
                                              sourceStart: latestSrcStart,
                                              sourceEnd: latestSrcEnd,
                                            }
                                          : item
                                      );
                                      setSplitUndoStack((prev) => [
                                        ...prev.slice(-19),
                                        {
                                          video: splitSegments,
                                          audio: splitAudioSegments,
                                          text: splitTextOverlays,
                                          overlays: initialOverlays,
                                        },
                                      ]);
                                      setSplitRedoStack([]);
                                      setSplitOverlays(nextOverlays);
                                      setCurrentTime(latestTlStart);
                                      trimBoundsRef.current.currentTime = latestTlStart;
                                      syncOverlaysToTime(latestTlStart, false);
                                      setEditStatusMessage(null);
                                      setEditErrorMessage(null);
                                    }
                                  };

                                  window.addEventListener('pointermove', onMove);
                                  window.addEventListener('pointerup', onUp);
                                  window.addEventListener('pointercancel', onUp);
                                }}
                                className="absolute top-0 bottom-0 w-8 flex items-center justify-center cursor-ew-resize touch-none z-30 select-none"
                                title="Touch and pull to trim overlay start"
                              >
                                <div className="w-5 h-full rounded-l-lg bg-white text-slate-950 flex items-center justify-center shadow-lg pointer-events-none">
                                  <ChevronLeft className="w-4 h-4 stroke-[3]" />
                                </div>
                              </div>
                            )}

                            {/* Right White Touch-and-Pull Overlay Trim Handle (>) */}
                            {isSelected && (
                              <div
                                role="slider"
                                tabIndex={0}
                                data-trim-handle="true"
                                aria-label="Trim overlay end"
                                aria-valuemin={Number((liveSourceStart + 0.3).toFixed(1))}
                                aria-valuemax={Number(ov.maxSourceDuration.toFixed(1))}
                                aria-valuenow={Number(liveSourceEnd.toFixed(1))}
                                style={{ right: '-16px' }}
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  try {
                                    e.currentTarget.setPointerCapture(e.pointerId);
                                  } catch {
                                    // ignore capture unsupported
                                  }
                                  pauseAllSplitVideos();
                                  setIsPlaying(false);
                                  isUserScrubbingTimelineRef.current = true;

                                  const startClientX = e.clientX;
                                  const frozenPx = splitPxPerSec;
                                  const initialOverlays = splitOverlays;
                                  const fixedTlStart = ov.timelineStart;
                                  const fixedSrcStart = ov.sourceStart;
                                  const initialSrcEnd = ov.sourceEnd;
                                  const maxAllowedEnd =
                                    ov.maxSourceDuration || Math.max(initialSrcEnd, 10);
                                  let latestSrcEnd = initialSrcEnd;

                                  setActiveOverlayTrimDrag({
                                    id: ov.id,
                                    side: 'right',
                                    initialTimelineStart: fixedTlStart,
                                    initialSourceStart: fixedSrcStart,
                                    initialSourceEnd: initialSrcEnd,
                                    liveTimelineStart: fixedTlStart,
                                    liveSourceStart: fixedSrcStart,
                                    liveSourceEnd: initialSrcEnd,
                                    frozenPxPerSec: frozenPx,
                                  });

                                  const onMove = (ev: PointerEvent) => {
                                    const dx = ev.clientX - startClientX;
                                    const nextEnd = Math.min(
                                      maxAllowedEnd,
                                      Math.max(
                                        fixedSrcStart + 0.3,
                                        Number((initialSrcEnd + dx / frozenPx).toFixed(2))
                                      )
                                    );
                                    if (nextEnd === latestSrcEnd) return;
                                    latestSrcEnd = nextEnd;
                                    setActiveOverlayTrimDrag((prev) =>
                                      prev ? { ...prev, liveSourceEnd: nextEnd } : null
                                    );
                                  };

                                  const onUp = () => {
                                    window.removeEventListener('pointermove', onMove);
                                    window.removeEventListener('pointerup', onUp);
                                    window.removeEventListener('pointercancel', onUp);
                                    isUserScrubbingTimelineRef.current = false;
                                    setActiveOverlayTrimDrag(null);

                                    if (Math.abs(latestSrcEnd - initialSrcEnd) >= 0.05) {
                                      const nextOverlays = initialOverlays.map((item) =>
                                        item.id === ov.id
                                          ? { ...item, sourceEnd: latestSrcEnd }
                                          : item
                                      );
                                      setSplitUndoStack((prev) => [
                                        ...prev.slice(-19),
                                        {
                                          video: splitSegments,
                                          audio: splitAudioSegments,
                                          text: splitTextOverlays,
                                          overlays: initialOverlays,
                                        },
                                      ]);
                                      setSplitRedoStack([]);
                                      setSplitOverlays(nextOverlays);
                                      const previewTime = Math.max(
                                        fixedTlStart,
                                        fixedTlStart + (latestSrcEnd - fixedSrcStart) - 0.1
                                      );
                                      setCurrentTime(previewTime);
                                      trimBoundsRef.current.currentTime = previewTime;
                                      syncOverlaysToTime(previewTime, false);
                                      setEditStatusMessage(null);
                                      setEditErrorMessage(null);
                                    }
                                  };

                                  window.addEventListener('pointermove', onMove);
                                  window.addEventListener('pointerup', onUp);
                                  window.addEventListener('pointercancel', onUp);
                                }}
                                className="absolute top-0 bottom-0 w-8 flex items-center justify-center cursor-ew-resize touch-none z-30 select-none"
                                title="Touch and pull to trim overlay end"
                              >
                                <div className="w-5 h-full rounded-r-lg bg-white text-slate-950 flex items-center justify-center shadow-lg pointer-events-none">
                                  <ChevronRight className="w-4 h-4 stroke-[3]" />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
              );
            })()}

            {/* + Two-Option Popover Menu: Add Video / Add Image */}
            {showAddMediaMenu && (
              <div data-keep-selection="true" className="px-3">
                <div className="rounded-2xl bg-slate-900 border border-white/15 p-2 flex items-center gap-2 shadow-2xl">
                  <button
                    type="button"
                    onClick={openAddVideoPickerModal}
                    className="flex-1 min-h-[48px] px-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors whitespace-nowrap"
                  >
                    <Film className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Add Video</span>
                  </button>
                  <button
                    type="button"
                    onClick={openAddImagePickerModal}
                    className="flex-1 min-h-[48px] px-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors whitespace-nowrap"
                  >
                    <ImageIcon className="w-4 h-4 text-cyan-300 shrink-0" />
                    <span>Add Image</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddMediaMenu(false)}
                    className="min-w-[44px] min-h-[48px] rounded-xl bg-white/5 hover:bg-white/15 text-slate-300 flex items-center justify-center cursor-pointer"
                    aria-label="Close Add Menu"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Compact Status / Error Strip */}
            {(editErrorMessage || editStatusMessage) && (
              <div className="px-3.5">
                {editErrorMessage && (
                  <div className="p-2 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="truncate">{editErrorMessage}</span>
                  </div>
                )}
                {editStatusMessage && (
                  <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-emerald-200 text-xs flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="truncate">{editStatusMessage}</span>
                    </div>
                    {lastSavedClip && (
                      <button
                        type="button"
                        onClick={() => void playVideoItem(lastSavedClip)}
                        className="px-2.5 py-1 rounded-lg bg-emerald-400 text-slate-950 font-bold text-[11px] whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Play Clip
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Bottom Tool Dock: Split, Remove, Audio, Text, Overlay */}
            {(() => {
              const activeSeg =
                splitSegments.find((s) => s.id === selectedSplitSegId) ||
                activeSplitSegAtPlayhead ||
                splitSegments[0];
              const isAudioTrackSelected =
                selectedTrackType === 'audio' && splitAudioSegments.length > 0;
              const isTextTrackSelected =
                selectedTrackType === 'text' && splitTextOverlays.length > 0;
              const isOverlayTrackSelected =
                selectedTrackType === 'overlay' && splitOverlays.length > 0;
              const isSelectedRemoved =
                !isAudioTrackSelected &&
                !isTextTrackSelected &&
                !isOverlayTrackSelected &&
                Boolean(activeSeg?.removed);
              const keptCount = splitSegments.filter((s) => !s.removed).length;
              const canRemoveSelected = isOverlayTrackSelected
                ? splitOverlays.length > 0
                : isAudioTrackSelected
                ? splitAudioSegments.length > 0
                : isTextTrackSelected
                ? splitTextOverlays.length > 0
                : isSelectedRemoved || keptCount > 1;
              const hasTrimmedHandles = splitSegments.some(
                (s) => s.sourceStart > 0.05 || s.sourceEnd < s.maxSourceDuration - 0.05
              );
              const hasAnyEdits =
                splitSegments.some((s) => s.removed) ||
                splitSegments.length > 1 ||
                splitSegments.some((s) => s.mediaType === 'image' || s.sourceUri !== currentVideo?.uri) ||
                hasTrimmedHandles ||
                Boolean(splitCustomAudio) ||
                splitAudioSegments.length > 0 ||
                isMuted ||
                splitTextOverlays.length > 0 ||
                splitOverlays.length > 0 ||
                isCropModified(mainVideoCrop);

              return (
                <div className="px-2 sm:px-3 flex items-center justify-center gap-1.5 sm:gap-2.5 overflow-x-auto no-scrollbar">
                  <button
                    type="button"
                    data-keep-selection="true"
                    onClick={handleSplitAtPlayhead}
                    disabled={isProcessingEdit}
                    className="min-w-[54px] sm:min-w-[64px] h-[56px] px-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors shrink-0 disabled:opacity-40"
                    title={
                      isOverlayTrackSelected
                        ? 'Split overlay at white playhead line'
                        : isTextTrackSelected
                        ? 'Split text at white playhead line'
                        : isAudioTrackSelected
                        ? 'Split audio at white playhead line'
                        : 'Split video at white playhead line'
                    }
                  >
                    <Scissors className="w-4 h-4" />
                    <span className="text-[11px] font-medium whitespace-nowrap">Split</span>
                  </button>

                  <button
                    type="button"
                    data-keep-selection="true"
                    onClick={handleToggleRemoveSelectedSegment}
                    disabled={isProcessingEdit || !canRemoveSelected}
                    className={`min-w-[54px] sm:min-w-[64px] h-[56px] px-2 rounded-xl border flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors shrink-0 disabled:opacity-35 ${
                      isSelectedRemoved
                        ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                        : 'bg-red-500/15 hover:bg-red-500/25 border-red-400/30 text-red-200'
                    }`}
                    title={
                      isOverlayTrackSelected
                        ? 'Remove selected overlay'
                        : isTextTrackSelected
                        ? 'Remove selected text overlay'
                        : isAudioTrackSelected
                        ? 'Remove selected audio part'
                        : isSelectedRemoved
                        ? 'Restore selected part'
                        : 'Remove selected part'
                    }
                  >
                    {isSelectedRemoved ? (
                      <>
                        <RotateCcw className="w-4 h-4" />
                        <span className="text-[11px] font-medium whitespace-nowrap">Restore</span>
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        <span className="text-[11px] font-medium whitespace-nowrap">Remove</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    data-keep-selection="true"
                    onClick={() => void openAudioPickerModal()}
                    disabled={isProcessingEdit}
                    className={`min-w-[54px] sm:min-w-[64px] h-[56px] px-2 rounded-xl border flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors shrink-0 disabled:opacity-40 ${
                      splitCustomAudio
                        ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                        : 'bg-white/10 hover:bg-white/15 border-white/10 text-white'
                    }`}
                    title="Add or replace audio track"
                  >
                    <Music className="w-4 h-4" />
                    <span className="text-[11px] font-medium whitespace-nowrap">Audio</span>
                  </button>

                  <button
                    type="button"
                    data-keep-selection="true"
                    onClick={() => openAddTextEditor()}
                    disabled={isProcessingEdit}
                    className={`min-w-[54px] sm:min-w-[64px] h-[56px] px-2 rounded-xl border flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors shrink-0 disabled:opacity-40 ${
                      splitTextOverlays.length > 0
                        ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200'
                        : 'bg-white/10 hover:bg-white/15 border-white/10 text-white'
                    }`}
                    title="Add text overlay to video"
                  >
                    <Type className="w-4 h-4" />
                    <span className="text-[11px] font-medium whitespace-nowrap">Text</span>
                  </button>

                  <button
                    type="button"
                    data-keep-selection="true"
                    onClick={openOverlayPickerModal}
                    disabled={isProcessingEdit}
                    className={`min-w-[54px] sm:min-w-[64px] h-[56px] px-2 rounded-xl border flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors shrink-0 disabled:opacity-40 ${
                      splitOverlays.length > 0
                        ? 'bg-violet-500/20 border-violet-400/50 text-violet-200'
                        : 'bg-white/10 hover:bg-white/15 border-white/10 text-white'
                    }`}
                    title="Add overlay video or photo on top of video"
                  >
                    <Layers className="w-4 h-4" />
                    <span className="text-[11px] font-medium whitespace-nowrap">Overlay</span>
                  </button>
                </div>
              );
            })()}
          </div>
        )}

        {/* Text Overlay Editor Modal inside Split Studio */}
        {isTextEditorOpen && (
          <div
            data-keep-selection="true"
            className="absolute inset-0 z-40 bg-black/85 backdrop-blur-md flex flex-col justify-between p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setIsTextEditorOpen(false)}
                className="min-w-[44px] min-h-[44px] px-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center justify-center cursor-pointer"
              >
                Cancel
              </button>

              <div className="flex items-center gap-2">
                {selectedTextId && (
                  <button
                    type="button"
                    onClick={() => handleDeleteTextOverlay(selectedTextId)}
                    className="min-w-[44px] min-h-[44px] px-3 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-400/40 text-red-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleSaveTextOverlay}
                  className="min-h-[44px] px-5 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 text-xs font-bold cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>

            {/* Live Styled Text Input Area */}
            {(() => {
              const hasBg = draftTextBgStyle !== 'none';
              const resolvedBg = hasBg
                ? draftTextBgColor || (draftTextBgStyle === 'solid' ? '#ffffff' : 'rgba(15, 23, 42, 0.82)')
                : 'transparent';
              const resolvedColor =
                hasBg &&
                resolvedBg.toLowerCase() === '#ffffff' &&
                draftTextColor.toLowerCase() === '#ffffff'
                  ? '#111827'
                  : draftTextColor;
              const previewText = draftTextValue.trim() || 'Sample Text';
              const previewAnim = computeTextAnimationState(
                draftTextAnimation,
                animPreviewElapsed,
                previewText.length
              );
              const revealPct =
                draftTextAnimation === 'typewriter' && previewText.length > 0
                  ? Math.min(100, Math.round((previewAnim.visibleChars / previewText.length) * 100))
                  : 100;

              return (
                <div className="flex-1 flex flex-col items-center justify-center px-2">
                  <textarea
                    autoFocus
                    rows={3}
                    value={draftTextValue}
                    onChange={(e) => setDraftTextValue(e.target.value)}
                    placeholder="Type your video text..."
                    style={{
                      fontSize: `${Math.round(draftTextSize * 0.92)}px`,
                      fontFamily: resolveOverlayFontCss(draftTextFont),
                      color: resolvedColor,
                      backgroundColor: resolvedBg,
                      textTransform: draftTextStyleEffect === 'uppercase' ? 'uppercase' : 'none',
                      textShadow: resolveTextEffectShadow(draftTextStyleEffect, resolvedColor, hasBg),
                      opacity: previewAnim.opacity,
                      transform: `translate(${previewAnim.offsetX}px, ${previewAnim.offsetY}px) scale(${previewAnim.scale})`,
                      clipPath:
                        draftTextAnimation === 'typewriter' && revealPct < 100
                          ? `inset(0 ${100 - revealPct}% 0 0)`
                          : undefined,
                    }}
                    className={`w-full max-w-md rounded-2xl px-4 py-3 text-center leading-tight resize-none focus:outline-none placeholder:text-slate-400 ${
                      draftTextFont === 'display' ? 'font-black' : 'font-bold'
                    } ${hasBg ? 'shadow-xl' : ''}`}
                  />
                  <p className="text-[11px] text-slate-400 mt-2">
                    Drag text anywhere on the video after tapping Done
                  </p>
                </div>
              );
            })()}

            {/* Expandable Section Drawer + Text Line/Section Selector + Style Tabs */}
            <div className="max-w-lg w-full mx-auto space-y-2.5">
              {/* Text Track Line & Section Bar (same line in front OR new line below) */}
              {(() => {
                const maxExistingRow = splitTextOverlays.reduce(
                  (m, t) => Math.max(m, t.trackRow ?? 0),
                  0
                );
                const visibleLineCount = Math.max(maxExistingRow + 1, draftTextRow + 1);
                return (
                  <div className="flex flex-wrap items-center justify-between gap-1.5 px-1">
                    <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                      {Array.from({ length: visibleLineCount }).map((_, rIdx) => (
                        <button
                          key={rIdx}
                          type="button"
                          onClick={() => setDraftTextRow(rIdx)}
                          className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                            draftTextRow === rIdx
                              ? 'bg-amber-400 text-slate-950 font-bold'
                              : 'bg-white/10 text-slate-300 hover:bg-white/20'
                          }`}
                        >
                          Line {rIdx + 1}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setDraftTextRow(maxExistingRow + 1)}
                        className="min-h-[30px] px-2 rounded-lg text-[11px] font-semibold bg-white/10 hover:bg-white/20 text-amber-300 border border-dashed border-amber-400/40 cursor-pointer whitespace-nowrap flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        <span>New Line</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setDraftTextInsertStart(null);
                          setDraftTextTiming('all');
                        }}
                        className={`min-h-[30px] px-2 rounded-lg text-[11px] font-semibold cursor-pointer whitespace-nowrap ${
                          draftTextTiming === 'all'
                            ? 'bg-cyan-400 text-slate-950 font-bold'
                            : 'bg-white/10 text-slate-300 hover:bg-white/20'
                        }`}
                      >
                        Whole Video
                      </button>
                      <button
                        type="button"
                        onClick={() => setDraftTextTiming('4s')}
                        className={`min-h-[30px] px-2 rounded-lg text-[11px] font-semibold cursor-pointer whitespace-nowrap ${
                          draftTextTiming === '4s'
                            ? 'bg-cyan-400 text-slate-950 font-bold'
                            : 'bg-white/10 text-slate-300 hover:bg-white/20'
                        }`}
                      >
                        {draftTextInsertStart !== null
                          ? `From ${formatTimePadded(draftTextInsertStart)}`
                          : '4s Section'}
                      </button>
                    </div>
                  </div>
                );
              })()}
              {activeTextSection !== 'none' && (
                <div className="bg-slate-900/95 border border-white/15 rounded-2xl p-3 shadow-2xl">
                  {activeTextSection === 'color' && (
                    <div className="flex flex-wrap items-center gap-2.5">
                      {TEXT_COLOR_PALETTE.map((col) => (
                        <button
                          key={col}
                          type="button"
                          onClick={() => setDraftTextColor(col)}
                          style={{ backgroundColor: col }}
                          aria-label={`Text color ${col}`}
                          className={`w-8 h-8 rounded-full border-2 cursor-pointer transition-transform ${
                            draftTextColor.toLowerCase() === col.toLowerCase()
                              ? 'border-emerald-400 scale-110 ring-2 ring-emerald-400/40'
                              : 'border-white/30 hover:scale-105'
                          }`}
                        />
                      ))}
                    </div>
                  )}

                  {activeTextSection === 'bg' && (
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setDraftTextBgStyle('none');
                          setDraftTextBgColor(undefined);
                        }}
                        className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
                          draftTextBgStyle === 'none'
                            ? 'bg-emerald-400 border-emerald-300 text-slate-950 font-bold'
                            : 'bg-white/10 border-white/15 text-white hover:bg-white/20'
                        }`}
                      >
                        None
                      </button>
                      {TEXT_BG_PALETTE.map((col) => {
                        const isSelectedBg =
                          draftTextBgStyle !== 'none' &&
                          (draftTextBgColor || (draftTextBgStyle === 'solid' ? '#ffffff' : '#111827')).toLowerCase() ===
                            col.toLowerCase();
                        return (
                          <button
                            key={col}
                            type="button"
                            onClick={() => {
                              setDraftTextBgColor(col);
                              setDraftTextBgStyle(col === '#ffffff' ? 'solid' : 'dark');
                            }}
                            style={{ backgroundColor: col }}
                            aria-label={`Text background color ${col}`}
                            className={`w-8 h-8 rounded-full border-2 cursor-pointer transition-transform ${
                              isSelectedBg
                                ? 'border-emerald-400 scale-110 ring-2 ring-emerald-400/40'
                                : 'border-white/30 hover:scale-105'
                            }`}
                          />
                        );
                      })}
                    </div>
                  )}

                  {activeTextSection === 'fonts' && (
                    <div className="grid grid-cols-3 gap-2">
                      {TEXT_FONT_OPTIONS.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setDraftTextFont(f.id)}
                          style={{ fontFamily: resolveOverlayFontCss(f.id) }}
                          className={`min-h-[40px] px-2.5 rounded-xl text-xs border cursor-pointer transition-colors ${
                            draftTextFont === f.id
                              ? 'bg-emerald-400 border-emerald-300 text-slate-950 font-bold'
                              : 'bg-white/10 border-white/10 text-white hover:bg-white/20'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {activeTextSection === 'styles' && (
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {TEXT_STYLE_OPTIONS.map((st) => (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => setDraftTextStyleEffect(st.id)}
                            className={`min-h-[36px] px-2.5 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                              draftTextStyleEffect === st.id
                                ? 'bg-emerald-400 text-slate-950 font-bold'
                                : 'bg-white/10 hover:bg-white/20 text-white'
                            }`}
                          >
                            {st.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/10">
                        <div className="flex items-center gap-1">
                          {(
                            [
                              { val: 20, label: 'S' },
                              { val: 26, label: 'M' },
                              { val: 34, label: 'L' },
                            ] as const
                          ).map((sz) => (
                            <button
                              key={sz.val}
                              type="button"
                              onClick={() => setDraftTextSize(sz.val)}
                              className={`min-w-[36px] min-h-[36px] rounded-lg text-xs font-bold cursor-pointer ${
                                draftTextSize === sz.val
                                  ? 'bg-white text-slate-950'
                                  : 'bg-white/10 text-slate-300 hover:bg-white/20'
                              }`}
                            >
                              {sz.label}
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDraftTextTiming('all')}
                            className={`min-h-[36px] px-2.5 rounded-lg text-[11px] font-semibold cursor-pointer ${
                              draftTextTiming === 'all'
                                ? 'bg-cyan-400 text-slate-950 font-bold'
                                : 'bg-white/10 text-slate-300 hover:bg-white/20'
                            }`}
                          >
                            Whole Video
                          </button>
                          <button
                            type="button"
                            onClick={() => setDraftTextTiming('4s')}
                            className={`min-h-[36px] px-2.5 rounded-lg text-[11px] font-semibold cursor-pointer ${
                              draftTextTiming === '4s'
                                ? 'bg-cyan-400 text-slate-950 font-bold'
                                : 'bg-white/10 text-slate-300 hover:bg-white/20'
                            }`}
                          >
                            From Here (4s)
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTextSection === 'templates' && (
                    <div className="grid grid-cols-4 gap-2">
                      {TEXT_TEMPLATE_OPTIONS.map((tpl) => {
                        const tplHasBg = tpl.bgStyle !== 'none';
                        return (
                          <button
                            key={tpl.id}
                            type="button"
                            onClick={() => {
                              setDraftTextColor(tpl.color);
                              setDraftTextBgStyle(tpl.bgStyle);
                              setDraftTextBgColor(tpl.bgColor);
                              setDraftTextFont(tpl.fontFamily);
                              setDraftTextStyleEffect(tpl.textStyle);
                              setDraftTextSize(tpl.fontSize);
                            }}
                            style={{
                              fontFamily: resolveOverlayFontCss(tpl.fontFamily),
                              color: tpl.color,
                              backgroundColor: tplHasBg ? tpl.bgColor : 'rgba(255,255,255,0.06)',
                              textTransform: tpl.textStyle === 'uppercase' ? 'uppercase' : 'none',
                              textShadow: resolveTextEffectShadow(tpl.textStyle, tpl.color, tplHasBg),
                            }}
                            className="min-h-[42px] px-1.5 rounded-xl border border-white/15 text-[11px] font-bold flex items-center justify-center cursor-pointer hover:scale-[1.03] transition-transform truncate"
                          >
                            {tpl.label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {activeTextSection === 'animations' && (
                    <div className="grid grid-cols-4 gap-2">
                      {TEXT_ANIMATION_OPTIONS.map((animOpt) => (
                        <button
                          key={animOpt.id}
                          type="button"
                          onClick={() => {
                            setDraftTextAnimation(animOpt.id);
                            setAnimPreviewTrigger((prev) => prev + 1);
                          }}
                          className={`min-h-[40px] px-2 rounded-xl text-[11px] font-semibold border cursor-pointer transition-colors ${
                            draftTextAnimation === animOpt.id
                              ? 'bg-emerald-400 border-emerald-300 text-slate-950 font-bold'
                              : 'bg-white/10 border-white/10 text-white hover:bg-white/20'
                          }`}
                        >
                          {animOpt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Clickable Section Headings Bar */}
              <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {(
                  [
                    { id: 'color', label: 'Text color' },
                    { id: 'bg', label: 'Text Bg color' },
                    { id: 'fonts', label: 'Fonts' },
                    { id: 'styles', label: 'Styles' },
                    { id: 'templates', label: 'Templates' },
                    { id: 'animations', label: 'Animations' },
                  ] as const
                ).map((sec) => {
                  const isOpen = activeTextSection === sec.id;
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      onClick={() => setActiveTextSection(isOpen ? 'none' : sec.id)}
                      className={`min-h-[42px] px-3 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                        isOpen
                          ? 'bg-emerald-400 text-slate-950 font-bold'
                          : 'bg-white/5 hover:bg-white/15 text-slate-200'
                      }`}
                    >
                      {sec.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Full-Screen Modal Pickers inside Split Studio: Audio / Phone Videos / Phone Images / Overlay */}
        {activeSplitPicker !== 'none' && (
          <div className="absolute inset-0 z-40 bg-black/95 backdrop-blur-md flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => setActiveSplitPicker('none')}
                  className="min-w-[44px] min-h-[44px] rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer shrink-0"
                  aria-label="Close Picker"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <h3 className="text-sm sm:text-base font-bold text-white truncate">
                  {activeSplitPicker === 'audio'
                    ? 'Add / Replace Audio'
                    : activeSplitPicker === 'video'
                    ? 'Add Video from Phone'
                    : activeSplitPicker === 'overlay'
                    ? 'Add Overlay'
                    : 'Add Image from Phone'}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (activeSplitPicker === 'audio') splitAudioUploadInputRef.current?.click();
                  else if (activeSplitPicker === 'video') splitAddVideoInputRef.current?.click();
                  else if (activeSplitPicker === 'overlay') {
                    if (overlayPickerTab === 'video') splitOverlayVideoInputRef.current?.click();
                    else splitOverlayImageInputRef.current?.click();
                  } else splitAddImageInputRef.current?.click();
                }}
                disabled={isPreparingSplitMedia}
                className="min-h-[44px] px-3.5 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap disabled:opacity-50"
              >
                <Upload className="w-4 h-4 shrink-0" />
                <span>
                  {activeSplitPicker === 'audio'
                    ? 'Upload Audio'
                    : activeSplitPicker === 'video'
                    ? 'Upload Video'
                    : activeSplitPicker === 'overlay'
                    ? overlayPickerTab === 'video'
                      ? 'Upload Video'
                      : 'Upload Photo'
                    : 'Upload Image'}
                </span>
              </button>
            </div>

            {/* Overlay Tab Toggle (Overlay Video / Overlay Photo) */}
            {activeSplitPicker === 'overlay' && (
              <div className="shrink-0 px-4 pt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOverlayPickerTab('video')}
                  className={`flex-1 min-h-[44px] px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors border ${
                    overlayPickerTab === 'video'
                      ? 'bg-violet-500 border-violet-300 text-white'
                      : 'bg-white/10 border-white/10 text-slate-300 hover:bg-white/15'
                  }`}
                >
                  <Film className="w-4 h-4 shrink-0" />
                  <span>Overlay Video</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOverlayPickerTab('image');
                    if (deviceImages.length === 0) void loadDeviceImages();
                  }}
                  className={`flex-1 min-h-[44px] px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors border ${
                    overlayPickerTab === 'image'
                      ? 'bg-violet-500 border-violet-300 text-white'
                      : 'bg-white/10 border-white/10 text-slate-300 hover:bg-white/15'
                  }`}
                >
                  <ImageIcon className="w-4 h-4 shrink-0" />
                  <span>Overlay Photo</span>
                </button>
              </div>
            )}

            {/* Search Input */}
            <div className="shrink-0 px-4 py-3 border-b border-white/10">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={
                    activeSplitPicker === 'audio'
                      ? audioPickerSearch
                      : activeSplitPicker === 'video' ||
                        (activeSplitPicker === 'overlay' && overlayPickerTab === 'video')
                      ? videoPickerSearch
                      : imagePickerSearch
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (activeSplitPicker === 'audio') setAudioPickerSearch(val);
                    else if (
                      activeSplitPicker === 'video' ||
                      (activeSplitPicker === 'overlay' && overlayPickerTab === 'video')
                    )
                      setVideoPickerSearch(val);
                    else setImagePickerSearch(val);
                  }}
                  placeholder={
                    activeSplitPicker === 'audio'
                      ? 'Search songs on your phone...'
                      : activeSplitPicker === 'video' ||
                        (activeSplitPicker === 'overlay' && overlayPickerTab === 'video')
                      ? 'Search videos on your phone...'
                      : 'Search photos on your phone...'
                  }
                  className="w-full min-h-[44px] bg-white/10 border border-white/15 focus:border-emerald-400 rounded-xl pl-9 pr-4 py-2 text-xs sm:text-sm text-white placeholder-slate-400 focus:outline-none"
                />
              </div>
            </div>

            {/* Picker Content Area */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 relative">
              {isPreparingSplitMedia && (
                <div className="absolute inset-0 bg-black/75 z-20 flex items-center justify-center">
                  <div className="flex items-center gap-2.5 bg-slate-900 border border-white/15 px-4 py-3 rounded-xl">
                    <div className="w-5 h-5 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
                    <span className="text-xs font-semibold text-white">Adding to timeline...</span>
                  </div>
                </div>
              )}

              {activeSplitPicker === 'audio' && (
                <>
                  {audioPermissionDenied ? (
                    <div className="py-10 text-center space-y-3">
                      <ShieldAlert className="w-10 h-10 text-amber-400 mx-auto" />
                      <p className="text-sm font-semibold text-white">Audio Permission Required</p>
                      <button
                        type="button"
                        onClick={() => void openAudioPickerModal()}
                        className="min-h-[44px] px-5 rounded-xl bg-emerald-400 text-slate-950 text-xs font-bold cursor-pointer"
                      >
                        Allow Audio Access
                      </button>
                    </div>
                  ) : isLoadingAudioPicker ? (
                    <div className="py-12 text-center space-y-2">
                      <div className="w-8 h-8 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin mx-auto" />
                      <p className="text-xs text-slate-400 font-mono">Scanning phone audio...</p>
                    </div>
                  ) : filteredDeviceSongs.length === 0 ? (
                    <div className="py-12 text-center space-y-3">
                      <Music className="w-10 h-10 text-slate-600 mx-auto" />
                      <p className="text-sm font-semibold text-slate-300">
                        Tap Upload Audio above to pick an audio file
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-white/10">
                      {filteredDeviceSongs.map((song) => (
                        <button
                          key={song.id}
                          type="button"
                          onClick={() => void handleSelectReplacementAudio(song)}
                          className="w-full min-h-[58px] px-3 py-2.5 flex items-center justify-between gap-3 hover:bg-white/10 rounded-xl transition-colors cursor-pointer text-left"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-400/30 overflow-hidden shrink-0">
                              <AudioArtwork song={song} className="w-full h-full" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs sm:text-sm font-semibold text-white truncate">
                                {song.title || song.displayName}
                              </p>
                              <p className="text-[11px] text-slate-400 truncate">
                                {song.artist || song.displayName}
                              </p>
                            </div>
                          </div>
                          {song.durationMs > 0 && (
                            <span className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
                              {formatTime(song.durationMs / 1000)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {activeSplitPicker === 'video' && (
                <>
                  {permissionDenied ? (
                    <div className="py-10 text-center space-y-3">
                      <ShieldAlert className="w-10 h-10 text-amber-400 mx-auto" />
                      <p className="text-sm font-semibold text-white">Video Permission Required</p>
                      <button
                        type="button"
                        onClick={() => void loadDeviceVideos()}
                        className="min-h-[44px] px-5 rounded-xl bg-emerald-400 text-slate-950 text-xs font-bold cursor-pointer"
                      >
                        Allow Video Access
                      </button>
                    </div>
                  ) : isLoadingLibrary ? (
                    <div className="py-12 text-center space-y-2">
                      <div className="w-8 h-8 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin mx-auto" />
                      <p className="text-xs text-slate-400 font-mono">Scanning phone videos...</p>
                    </div>
                  ) : filteredPickerVideos.length === 0 ? (
                    <div className="py-12 text-center space-y-3">
                      <Film className="w-10 h-10 text-slate-600 mx-auto" />
                      <p className="text-sm font-semibold text-slate-300">
                        No videos found · Tap Upload Video above
                      </p>
                    </div>
                  ) : (
                    <div className="dark grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
                      {filteredPickerVideos.map((vid) => (
                        <VideoThumbnailCard
                          key={`pick-${vid.id}`}
                          video={vid}
                          isSelected={false}
                          onSelect={(selected) => void appendVideoToTimeline(selected)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}

              {activeSplitPicker === 'image' && (
                <>
                  {imagePermissionDenied ? (
                    <div className="py-10 text-center space-y-3">
                      <ShieldAlert className="w-10 h-10 text-amber-400 mx-auto" />
                      <p className="text-sm font-semibold text-white">Photos Permission Required</p>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto">
                        Allow photos & images access so Mo Vibe can show all images on your phone.
                      </p>
                      <button
                        type="button"
                        onClick={() => void loadDeviceImages()}
                        className="min-h-[44px] px-5 rounded-xl bg-emerald-400 text-slate-950 text-xs font-bold cursor-pointer"
                      >
                        Allow Photos Access
                      </button>
                    </div>
                  ) : isLoadingImagePicker ? (
                    <div className="py-12 text-center space-y-2">
                      <div className="w-8 h-8 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin mx-auto" />
                      <p className="text-xs text-slate-400 font-mono">Scanning phone images...</p>
                    </div>
                  ) : filteredDeviceImages.length === 0 ? (
                    <div className="py-12 text-center space-y-3">
                      <ImageIcon className="w-10 h-10 text-slate-600 mx-auto" />
                      <p className="text-sm font-semibold text-slate-300">
                        No images found · Tap Upload Image above
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3">
                      {filteredDeviceImages.map((img) => (
                        <ImageThumbnailCard
                          key={`img-${img.id}`}
                          image={img}
                          onSelect={(selected) => void appendImageToTimeline(selected)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
              {activeSplitPicker === 'overlay' && overlayPickerTab === 'video' && (
                <>
                  {permissionDenied ? (
                    <div className="py-10 text-center space-y-3">
                      <ShieldAlert className="w-10 h-10 text-amber-400 mx-auto" />
                      <p className="text-sm font-semibold text-white">Video Permission Required</p>
                      <button
                        type="button"
                        onClick={() => void loadDeviceVideos()}
                        className="min-h-[44px] px-5 rounded-xl bg-emerald-400 text-slate-950 text-xs font-bold cursor-pointer"
                      >
                        Allow Video Access
                      </button>
                    </div>
                  ) : isLoadingLibrary ? (
                    <div className="py-12 text-center space-y-2">
                      <div className="w-8 h-8 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin mx-auto" />
                      <p className="text-xs text-slate-400 font-mono">Scanning phone videos...</p>
                    </div>
                  ) : filteredPickerVideos.length === 0 ? (
                    <div className="py-12 text-center space-y-3">
                      <Film className="w-10 h-10 text-slate-600 mx-auto" />
                      <p className="text-sm font-semibold text-slate-300">
                        No videos found · Tap Upload Video above
                      </p>
                    </div>
                  ) : (
                    <div className="dark grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
                      {filteredPickerVideos.map((vid) => (
                        <VideoThumbnailCard
                          key={`ov-vid-${vid.id}`}
                          video={vid}
                          isSelected={false}
                          onSelect={(selected) => void addOverlayVideoToTimeline(selected)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}

              {activeSplitPicker === 'overlay' && overlayPickerTab === 'image' && (
                <>
                  {imagePermissionDenied ? (
                    <div className="py-10 text-center space-y-3">
                      <ShieldAlert className="w-10 h-10 text-amber-400 mx-auto" />
                      <p className="text-sm font-semibold text-white">Photos Permission Required</p>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto">
                        Allow photos & images access so Mo Vibe can show photos on your phone.
                      </p>
                      <button
                        type="button"
                        onClick={() => void loadDeviceImages()}
                        className="min-h-[44px] px-5 rounded-xl bg-emerald-400 text-slate-950 text-xs font-bold cursor-pointer"
                      >
                        Allow Photos Access
                      </button>
                    </div>
                  ) : isLoadingImagePicker ? (
                    <div className="py-12 text-center space-y-2">
                      <div className="w-8 h-8 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin mx-auto" />
                      <p className="text-xs text-slate-400 font-mono">Scanning phone photos...</p>
                    </div>
                  ) : filteredDeviceImages.length === 0 ? (
                    <div className="py-12 text-center space-y-3">
                      <ImageIcon className="w-10 h-10 text-slate-600 mx-auto" />
                      <p className="text-sm font-semibold text-slate-300">
                        No photos found · Tap Upload Photo above
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3">
                      {filteredDeviceImages.map((img) => (
                        <ImageThumbnailCard
                          key={`ov-img-${img.id}`}
                          image={img}
                          onSelect={(selected) => void addOverlayImageToTimeline(selected)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Phone Video Library List */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-lg dark:shadow-2xl min-w-0">
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between gap-3 min-w-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                <Video className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                  Phone Videos
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums truncate">
                  {videoLibraryFilter === 'playlists' && !selectedVideoPlaylistId
                    ? `${videoPlaylists.length} ${videoPlaylists.length === 1 ? 'playlist' : 'playlists'} · Open a folder to play only its videos`
                    : `${filteredVideos.length} ${filteredVideos.length === 1 ? 'video' : 'videos'} · Tap any video to open player`}
                </p>
              </div>
            </div>

            <div className="shrink-0">
              {isNativeAndroid() ? (
                <button
                  type="button"
                  onClick={() => void loadDeviceVideos()}
                  disabled={isLoadingLibrary}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-950 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-60"
                  title="Refresh Phone Video List"
                >
                  <RefreshCw className={`w-4 h-4 text-emerald-600 dark:text-emerald-400 ${isLoadingLibrary ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => webFileInputRef.current?.click()}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 dark:bg-emerald-400 dark:hover:bg-emerald-300 text-white dark:text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <FolderPlus className="w-4 h-4" />
                  <span>Add Video</span>
                </button>
              )}
            </div>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search videos on your phone..."
              className="w-full min-h-[44px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-emerald-500/60 rounded-xl pl-9 pr-9 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer p-1"
                aria-label="Clear video search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Video Library Category Tabs: All, Favorites, Playlists, Hidden */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'favorites', label: `Favorites (${videoFavoriteIds.length})` },
                { id: 'playlists', label: `Playlists (${videoPlaylists.length})` },
                { id: 'hidden', label: `Hidden (${videoHiddenIds.length})` },
              ] as Array<{ id: VideoLibraryFilterTab; label: string }>
            ).map((tab) => {
              const active = videoLibraryFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setVideoLibraryFilter(tab.id);
                    if (tab.id === 'playlists') {
                      setSelectedVideoPlaylistId(null);
                      setIsCreateVideoPlaylistOpen(false);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap border transition-colors cursor-pointer shrink-0 ${
                    active
                      ? 'bg-emerald-500 text-white dark:text-slate-950 border-emerald-500 font-bold'
                      : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-950 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {videoToast && (
            <div className="px-3.5 py-2.5 rounded-xl bg-emerald-500/12 border border-emerald-500/35 text-emerald-800 dark:text-emerald-300 text-xs font-medium flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span className="truncate">{videoToast}</span>
              </span>
              <button
                type="button"
                onClick={() => setVideoToast(null)}
                className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Special View: Video Playlists */}
        {videoLibraryFilter === 'playlists' && !selectedVideoPlaylistId ? (
          <div className="p-4 space-y-3">
            {!isCreateVideoPlaylistOpen ? (
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setIsCreateVideoPlaylistOpen(true)}
                  className="min-h-[42px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white dark:text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newVideoPlaylistNameInput}
                  onChange={(e) => setNewVideoPlaylistNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateVideoPlaylistDirect();
                    if (e.key === 'Escape') {
                      setIsCreateVideoPlaylistOpen(false);
                      setNewVideoPlaylistNameInput('');
                    }
                  }}
                  autoFocus
                  placeholder="Write playlist name..."
                  className="flex-1 min-h-[44px] bg-slate-50 dark:bg-slate-950 border border-emerald-500/60 focus:border-emerald-500 rounded-xl px-3.5 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleCreateVideoPlaylistDirect}
                  disabled={!newVideoPlaylistNameInput.trim()}
                  className="min-h-[44px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white dark:text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
                >
                  <Check className="w-4 h-4" />
                  <span>Save</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateVideoPlaylistOpen(false);
                    setNewVideoPlaylistNameInput('');
                  }}
                  className="min-h-[44px] min-w-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center cursor-pointer shrink-0 transition-colors"
                  aria-label="Cancel creating playlist"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {videoPlaylists.length === 0 ? (
              <div className="py-9 text-center space-y-2">
                <ListMusic className="w-10 h-10 text-slate-400 dark:text-slate-700 mx-auto" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  No Video Playlists Yet
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                  Tap + Create to organize and play videos strictly inside your own playlist folder.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {videoPlaylists.map((pl) => {
                  const availableCount = pl.trackIds.filter((tid) =>
                    nonHiddenVideos.some((v) => v.id === tid)
                  ).length;
                  const isThisPlaying =
                    videoPlaybackScope.type === 'playlist' &&
                    videoPlaybackScope.playlistId === pl.id &&
                    Boolean(currentVideo);
                  const isRenamingThis = renamingVideoPlaylistId === pl.id;

                  return (
                    <div
                      key={pl.id}
                      className={`flex items-center justify-between gap-2 px-3.5 py-3 rounded-xl border transition-colors ${
                        isThisPlaying
                          ? 'bg-emerald-500/8 border-emerald-500/45'
                          : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      {isRenamingThis ? (
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <input
                            type="text"
                            value={renamingVideoPlaylistDraft}
                            onChange={(e) => setRenamingVideoPlaylistDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && renamingVideoPlaylistDraft.trim()) {
                                const trimmed = renamingVideoPlaylistDraft.trim();
                                setVideoPlaylists((prev) =>
                                  prev.map((item) =>
                                    item.id === pl.id ? { ...item, name: trimmed } : item
                                  )
                                );
                                setRenamingVideoPlaylistId(null);
                              }
                            }}
                            autoFocus
                            className="flex-1 min-h-[38px] bg-white dark:bg-slate-900 border border-emerald-500 rounded-lg px-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const trimmed = renamingVideoPlaylistDraft.trim();
                              if (!trimmed) return;
                              setVideoPlaylists((prev) =>
                                prev.map((item) =>
                                  item.id === pl.id ? { ...item, name: trimmed } : item
                                )
                              );
                              setRenamingVideoPlaylistId(null);
                            }}
                            className="p-2 rounded-lg bg-emerald-500 text-white cursor-pointer"
                            aria-label="Save playlist name"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingVideoPlaylistId(null)}
                            className="p-2 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                            aria-label="Cancel rename"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setSelectedVideoPlaylistId(pl.id)}
                            className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
                          >
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                              <ListMusic className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                                {pl.name}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                {availableCount} {availableCount === 1 ? 'video' : 'videos'}
                                {isThisPlaying ? ' · Playing folder' : ''}
                              </div>
                            </div>
                          </button>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handlePlayVideoPlaylistFolder(pl.id)}
                              className="w-9 h-9 rounded-lg bg-emerald-500/12 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 flex items-center justify-center cursor-pointer"
                              title={`Play "${pl.name}" folder`}
                              aria-label={`Play playlist ${pl.name}`}
                            >
                              <Play className="w-4 h-4 fill-current ml-0.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingVideoPlaylistId(pl.id);
                                setRenamingVideoPlaylistDraft(pl.name);
                              }}
                              className="w-9 h-9 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center cursor-pointer"
                              title={`Rename ${pl.name}`}
                              aria-label={`Rename playlist ${pl.name}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setVideoPlaylists((prev) => prev.filter((item) => item.id !== pl.id));
                                if (selectedVideoPlaylistId === pl.id) {
                                  setSelectedVideoPlaylistId(null);
                                }
                                if (
                                  videoPlaybackScopeRef.current.type === 'playlist' &&
                                  videoPlaybackScopeRef.current.playlistId === pl.id
                                ) {
                                  videoPlaybackScopeRef.current = { type: 'all' };
                                  setVideoPlaybackScope({ type: 'all' });
                                }
                              }}
                              className="w-9 h-9 rounded-lg text-slate-400 hover:text-red-500 flex items-center justify-center cursor-pointer"
                              aria-label={`Delete playlist ${pl.name}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : permissionDenied ? (
          <div className="py-12 px-6 text-center space-y-3">
            <ShieldAlert className="w-10 h-10 text-amber-500 dark:text-amber-400 mx-auto" />
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Video Permission Required</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm mx-auto">
              Allow video access so Mo Vibe can list and play all videos stored on your phone.
            </p>
            <button
              type="button"
              onClick={() => void loadDeviceVideos()}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 dark:bg-emerald-400 dark:hover:bg-emerald-300 text-white dark:text-slate-950 text-xs font-bold cursor-pointer transition-colors"
            >
              Allow Video Access
            </button>
          </div>
        ) : isLoadingLibrary ? (
          <div className="py-12 px-6 text-center space-y-2">
            <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 dark:border-t-emerald-400 rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">Scanning phone videos...</p>
          </div>
        ) : (
          <div>
            {videoLibraryFilter === 'playlists' && selectedVideoPlaylistId && currentOpenVideoPlaylist && (
              <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950 border-b border-slate-200/80 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => setSelectedVideoPlaylistId(null)}
                    className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer shrink-0"
                  >
                    &larr; Playlists
                  </button>
                  <span className="text-slate-300 dark:text-slate-700">|</span>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                    {currentOpenVideoPlaylist.name}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setAddVideosModalPlaylistId(currentOpenVideoPlaylist.id)}
                    className="min-h-[36px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-500/50 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <ListPlus className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Add Videos</span>
                  </button>

                  {visibleBaseVideos.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handlePlayVideoPlaylistFolder(currentOpenVideoPlaylist.id)}
                      className="min-h-[36px] px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white dark:text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Play Folder</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {filteredVideos.length === 0 ? (
              <div className="py-12 px-6 text-center space-y-3">
                <Video className="w-10 h-10 text-slate-400 dark:text-slate-700 mx-auto" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {videoLibraryFilter === 'playlists' && selectedVideoPlaylistId
                    ? `No videos in "${currentOpenVideoPlaylist?.name || 'Playlist'}" yet`
                    : videos.length === 0
                    ? 'No videos loaded yet'
                    : videoLibraryFilter === 'favorites'
                    ? 'No favorite videos yet'
                    : videoLibraryFilter === 'hidden'
                    ? 'No hidden videos'
                    : 'No matching videos'}
                </p>
                {videoLibraryFilter === 'playlists' && selectedVideoPlaylistId && currentOpenVideoPlaylist && (
                  <button
                    type="button"
                    onClick={() => setAddVideosModalPlaylistId(currentOpenVideoPlaylist.id)}
                    className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 dark:bg-emerald-400 dark:hover:bg-emerald-300 text-white dark:text-slate-950 text-xs font-bold inline-flex items-center gap-2 cursor-pointer transition-colors"
                  >
                    <ListPlus className="w-4 h-4" />
                    <span>Add Videos to {currentOpenVideoPlaylist.name}</span>
                  </button>
                )}
                {!isNativeAndroid() && videos.length === 0 && (
                  <button
                    type="button"
                    onClick={() => webFileInputRef.current?.click()}
                    className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 dark:bg-emerald-400 dark:hover:bg-emerald-300 text-white dark:text-slate-950 text-xs font-bold inline-flex items-center gap-2 cursor-pointer transition-colors"
                  >
                    <FolderPlus className="w-4 h-4" />
                    <span>Choose Video Files</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4 p-3 sm:p-4">
                {filteredVideos.map((vid) => (
                  <VideoThumbnailCard
                    key={vid.id}
                    video={vid}
                    isSelected={currentVideo?.id === vid.id}
                    isFavorite={videoFavoriteIds.includes(vid.id)}
                    isHidden={
                      videoHiddenIds.includes(vid.id) ||
                      (Boolean(vid.uri) && videoHiddenIds.includes(vid.uri))
                    }
                    onSelect={(selected) => {
                      if (videoLibraryFilter === 'playlists' && selectedVideoPlaylistId) {
                        void playVideoItem(selected, {
                          type: 'playlist',
                          playlistId: selectedVideoPlaylistId,
                        });
                      } else {
                        void playVideoItem(selected);
                      }
                    }}
                    onOpenMenu={(v) => setMenuVideo(v)}
                    onUnhide={(v) => handleToggleVideoHidden(v)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Video 3-Dots Organization Sheet */}
      <VideoActionSheetModal
        video={menuVideo}
        thumbUrl={
          menuVideo
            ? videoThumbnailCache.get(menuVideo.id) || menuVideo.thumbnailUrl || ''
            : ''
        }
        isFavorite={menuVideo ? videoFavoriteIds.includes(menuVideo.id) : false}
        isHidden={
          menuVideo
            ? videoHiddenIds.includes(menuVideo.id) ||
              (Boolean(menuVideo.uri) && videoHiddenIds.includes(menuVideo.uri))
            : false
        }
        isInsidePlaylist={
          videoLibraryFilter === 'playlists' && Boolean(selectedVideoPlaylistId)
        }
        onClose={() => setMenuVideo(null)}
        onToggleFavorite={handleToggleVideoFavorite}
        onOpenAddToPlaylist={(v) => setPlaylistModalVideo(v)}
        onToggleHide={handleToggleVideoHidden}
        onRemoveFromPlaylist={(v) => {
          if (selectedVideoPlaylistId) {
            handleRemoveVideoFromPlaylist(selectedVideoPlaylistId, v.id);
          }
        }}
      />

      {/* Single Video -> Add to Playlist Modal */}
      <VideoAddToPlaylistModal
        video={playlistModalVideo}
        playlists={videoPlaylists}
        onClose={() => setPlaylistModalVideo(null)}
        onToggleVideoInPlaylist={(playlistId, videoId) => {
          setVideoPlaylists((prev) =>
            prev.map((pl) => {
              if (pl.id !== playlistId) return pl;
              const exists = pl.trackIds.includes(videoId);
              return {
                ...pl,
                trackIds: exists
                  ? pl.trackIds.filter((id) => id !== videoId)
                  : [...pl.trackIds, videoId],
              };
            })
          );
        }}
        onCreatePlaylist={(name, initialVideoId) => {
          const newPl: VideoPlaylist = {
            id: `vpl-${Date.now()}`,
            name,
            trackIds: initialVideoId ? [initialVideoId] : [],
            createdAt: Date.now(),
          };
          setVideoPlaylists((prev) => [newPl, ...prev]);
          showVideoToast(`Created playlist "${name}"`);
        }}
      />

      {/* Batch Add Videos to Playlist Folder Modal */}
      <VideoPlaylistAddVideosModal
        playlist={
          addVideosModalPlaylistId
            ? videoPlaylists.find((p) => p.id === addVideosModalPlaylistId) ?? null
            : null
        }
        videos={nonHiddenVideos}
        getThumbnail={(id, fallback) =>
          videoThumbnailCache.get(id) || fallback || ''
        }
        onClose={() => setAddVideosModalPlaylistId(null)}
        onSavePlaylistTracks={(playlistId, trackIds) => {
          setVideoPlaylists((prev) =>
            prev.map((pl) => (pl.id === playlistId ? { ...pl, trackIds } : pl))
          );
          const plName =
            videoPlaylists.find((p) => p.id === playlistId)?.name || 'playlist';
          showVideoToast(
            `Updated "${plName}" (${trackIds.length} ${trackIds.length === 1 ? 'video' : 'videos'})`
          );
        }}
      />
    </div>
  );
};
