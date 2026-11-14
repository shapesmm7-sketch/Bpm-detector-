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
  Image as ImageIcon,
  Film,
  Upload,
} from 'lucide-react';
import {
  exportVideoSegmentsBlobLossless,
  splitVideoBlobLossless,
  trimVideoBlobLossless,
  triggerWebVideoDownload,
} from '../utils/losslessVideoTrim';
import { composeSplitTimelineBlob } from '../utils/timelineComposer';

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
  onSelect: (video: VideoTrackItem) => void;
}

const VideoThumbnailCard: React.FC<VideoThumbnailCardProps> = ({
  video,
  isSelected,
  onSelect,
}) => {
  const cardRef = useRef<HTMLButtonElement | null>(null);
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
    <button
      ref={cardRef}
      type="button"
      onClick={() => onSelect(video)}
      className={`group text-left flex flex-col gap-1.5 min-w-0 cursor-pointer rounded-xl p-1.5 transition-colors ${
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

        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/35 pointer-events-none" />

        {qualityLabel && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-mono font-bold text-white leading-none">
            {qualityLabel}
          </span>
        )}

        {durationLabel && (
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-mono font-semibold tabular-nums text-white leading-none">
            {durationLabel}
          </span>
        )}
      </div>

      <div className="min-w-0 px-0.5">
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
      </div>
    </button>
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
  const mainVideoUrlRef = useRef<string>('');
  const activeSplitVideoUrlRef = useRef<string>('');
  const pendingSplitSeekRef = useRef<{ sourceUrl: string; sourceTime: number; autoPlay: boolean } | null>(null);
  const splitLastRafMsRef = useRef<number>(0);

  const [editMode, setEditMode] = useState<'none' | 'trim' | 'split'>('none');
  const [trimStart, setTrimStart] = useState<number>(0);
  const [trimEnd, setTrimEnd] = useState<number>(0);
  const [splitSegments, setSplitSegments] = useState<TimelineClipSegment[]>([]);
  const [selectedSplitSegId, setSelectedSplitSegId] = useState<string | null>(null);
  const [splitUndoStack, setSplitUndoStack] = useState<TimelineClipSegment[][]>([]);
  const [splitRedoStack, setSplitRedoStack] = useState<TimelineClipSegment[][]>([]);
  const [splitFramesBySource, setSplitFramesBySource] = useState<
    Record<string, Array<{ time: number; url: string }>>
  >({});
  const [extractingSources, setExtractingSources] = useState<Record<string, boolean>>({});
  const splitTimelineRef = useRef<HTMLDivElement | null>(null);
  const isSyncingTimelineScrollRef = useRef<boolean>(false);
  const isUserScrubbingTimelineRef = useRef<boolean>(false);

  // Replacement audio + Add Video/Add Image picker states in Split studio
  const [splitCustomAudio, setSplitCustomAudio] = useState<SplitCustomAudio | null>(null);
  const [showAddMediaMenu, setShowAddMediaMenu] = useState<boolean>(false);
  const [activeSplitPicker, setActiveSplitPicker] = useState<'none' | 'audio' | 'video' | 'image'>('none');
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

  const activeSplitDuration = editMode === 'split' ? totalSplitDuration : duration;

  const activeSplitSegAtPlayhead = useMemo(() => {
    if (editMode !== 'split' || mappedSplitSegments.length === 0) return null;
    return (
      mappedSplitSegments.find((s) => currentTime >= s.globalStart - 0.01 && currentTime < s.globalEnd) ||
      mappedSplitSegments[mappedSplitSegments.length - 1]
    );
  }, [editMode, mappedSplitSegments, currentTime]);

  const canExportSplitLossless = useMemo(() => {
    if (!currentVideo || editMode !== 'split') return true;
    const kept = splitSegments.filter((s) => !s.removed && s.sourceEnd - s.sourceStart > 0.1);
    if (kept.length === 0 || splitCustomAudio || isMuted) return false;
    return kept.every(
      (s) =>
        s.mediaType === 'video' &&
        (s.sourceUri === currentVideo.uri || s.sourceUrl === mainVideoUrlRef.current)
    );
  }, [currentVideo, editMode, splitSegments, splitCustomAudio, isMuted]);

  const trimBoundsRef = useRef({
    editMode,
    trimStart,
    trimEnd,
    isPreviewingTrim,
    mappedSplitSegments,
    totalSplitDuration,
    currentTime,
    playbackSpeed,
    isMuted,
    splitCustomAudio,
  });
  trimBoundsRef.current = {
    editMode,
    trimStart,
    trimEnd,
    isPreviewingTrim,
    mappedSplitSegments,
    totalSplitDuration,
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

  const syncCustomAudioToTime = (globalSec: number, shouldPlay: boolean) => {
    const audioEl = splitAudioRef.current;
    if (!audioEl || !trimBoundsRef.current.splitCustomAudio) return;
    const dur = isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
    if (dur > 0) {
      const targetOffset = ((globalSec % dur) + dur) % dur;
      if (Math.abs(audioEl.currentTime - targetOffset) > 0.18) {
        audioEl.currentTime = targetOffset;
      }
    }
    audioEl.playbackRate = trimBoundsRef.current.playbackSpeed;
    audioEl.muted = false;
    if (shouldPlay && audioEl.paused) {
      void audioEl.play().catch(() => {
        // ignore play interruption
      });
    } else if (!shouldPlay && !audioEl.paused) {
      audioEl.pause();
    }
  };

  const seekSplitTimelineTo = (globalTimeSec: number, autoPlay?: boolean) => {
    const { mappedSplitSegments: mapped, totalSplitDuration: totalDur, isMuted: mutedNow, playbackSpeed: spd } =
      trimBoundsRef.current;
    if (mapped.length === 0) return;

    const clamped = Math.max(0, Math.min(totalDur, globalTimeSec));
    setCurrentTime(clamped);
    trimBoundsRef.current.currentTime = clamped;

    const seg =
      mapped.find((s) => clamped >= s.globalStart - 0.005 && clamped < s.globalEnd) ||
      mapped[mapped.length - 1];

    const videoEl = videoRef.current;
    if (seg.mediaType === 'image') {
      if (videoEl && !videoEl.paused) {
        videoEl.pause();
      }
    } else if (videoEl) {
      const localSec = Math.max(
        seg.sourceStart,
        Math.min(seg.sourceEnd, seg.sourceStart + (clamped - seg.globalStart))
      );
      if (activeSplitVideoUrlRef.current !== seg.sourceUrl) {
        pendingSplitSeekRef.current = {
          sourceUrl: seg.sourceUrl,
          sourceTime: localSec,
          autoPlay: Boolean(autoPlay),
        };
        activeSplitVideoUrlRef.current = seg.sourceUrl;
        videoEl.src = seg.sourceUrl;
        videoEl.muted = mutedNow;
        videoEl.playbackRate = spd;
        videoEl.load();
      } else {
        if (Math.abs(videoEl.currentTime - localSec) > 0.04) {
          videoEl.currentTime = localSec;
        }
        videoEl.muted = mutedNow;
        videoEl.playbackRate = spd;
        if (autoPlay && videoEl.paused) {
          void videoEl.play().catch(() => {});
        }
      }
    }

    syncCustomAudioToTime(clamped, Boolean(autoPlay));
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

  // High-precision rAF guard for Trim selection bounds AND TikTok Multi-Clip Split playback
  useEffect(() => {
    if (!isPlayerOpen || editMode === 'none') return;

    if (editMode === 'split' && !isPlaying && splitTimelineRef.current && !isUserScrubbingTimelineRef.current) {
      isSyncingTimelineScrollRef.current = true;
      splitTimelineRef.current.scrollLeft = currentTime * splitPxPerSec;
      const resetId = window.requestAnimationFrame(() => {
        isSyncingTimelineScrollRef.current = false;
      });
      return () => window.cancelAnimationFrame(resetId);
    }

    if (!isPlaying) return;
    let rafId = 0;
    splitLastRafMsRef.current = performance.now();

    const tick = (nowMs: number) => {
      const dtSec = Math.min(0.1, Math.max(0, (nowMs - splitLastRafMsRef.current) / 1000));
      splitLastRafMsRef.current = nowMs;

      const el = videoRef.current;
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
          if (el && !el.paused) el.pause();
          if (splitAudioRef.current && !splitAudioRef.current.paused) splitAudioRef.current.pause();
          setIsPlaying(false);
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
            if (el && !el.paused) el.pause();
            if (splitAudioRef.current && !splitAudioRef.current.paused) splitAudioRef.current.pause();
            setCurrentTime(lastEnd);
            trimBoundsRef.current.currentTime = lastEnd;
            setIsPlaying(false);
            if (splitTimelineRef.current) {
              isSyncingTimelineScrollRef.current = true;
              splitTimelineRef.current.scrollLeft = lastEnd * splitPxPerSec;
              window.requestAnimationFrame(() => {
                isSyncingTimelineScrollRef.current = false;
              });
            }
            return;
          }
        }

        if (currentSeg.mediaType === 'image') {
          if (el && !el.paused) el.pause();
          const nextGlobal = curGlobal + dtSec * spd;
          if (nextGlobal >= currentSeg.globalEnd - 0.02) {
            const nextKept = kept.find((s) => s.globalStart >= currentSeg.globalEnd - 0.01);
            if (nextKept) {
              seekSplitTimelineTo(nextKept.globalStart, true);
            } else {
              if (splitAudioRef.current && !splitAudioRef.current.paused) splitAudioRef.current.pause();
              setCurrentTime(currentSeg.globalEnd);
              trimBoundsRef.current.currentTime = currentSeg.globalEnd;
              setIsPlaying(false);
              return;
            }
          } else {
            setCurrentTime(nextGlobal);
            trimBoundsRef.current.currentTime = nextGlobal;
            syncCustomAudioToTime(nextGlobal, true);
            if (splitTimelineRef.current && !isUserScrubbingTimelineRef.current) {
              isSyncingTimelineScrollRef.current = true;
              splitTimelineRef.current.scrollLeft = nextGlobal * splitPxPerSec;
              window.requestAnimationFrame(() => {
                isSyncingTimelineScrollRef.current = false;
              });
            }
          }
        } else if (el) {
          if (activeSplitVideoUrlRef.current !== currentSeg.sourceUrl) {
            seekSplitTimelineTo(curGlobal, true);
            rafId = window.requestAnimationFrame(tick);
            return;
          }
          el.muted = mutedNow;
          el.playbackRate = spd;
          if (el.paused && !pendingSplitSeekRef.current && el.readyState >= 2) {
            void el.play().catch(() => {});
          }

          if (!pendingSplitSeekRef.current && el.readyState >= 2) {
            const mappedNow = Math.max(
              currentSeg.globalStart,
              Math.min(
                currentSeg.globalEnd,
                currentSeg.globalStart + (el.currentTime - currentSeg.sourceStart)
              )
            );
            if (el.currentTime >= currentSeg.sourceEnd - 0.025 || el.ended) {
              const nextKept = kept.find((s) => s.globalStart >= currentSeg.globalEnd - 0.02);
              if (nextKept) {
                const isSeamlessSameSource =
                  nextKept.mediaType === 'video' &&
                  nextKept.sourceUrl === currentSeg.sourceUrl &&
                  Math.abs(nextKept.sourceStart - currentSeg.sourceEnd) < 0.05 &&
                  Math.abs(nextKept.globalStart - currentSeg.globalEnd) < 0.05;
                if (isSeamlessSameSource) {
                  setCurrentTime(nextKept.globalStart);
                  trimBoundsRef.current.currentTime = nextKept.globalStart;
                } else {
                  seekSplitTimelineTo(nextKept.globalStart, true);
                }
              } else {
                el.pause();
                if (splitAudioRef.current && !splitAudioRef.current.paused) splitAudioRef.current.pause();
                setCurrentTime(currentSeg.globalEnd);
                trimBoundsRef.current.currentTime = currentSeg.globalEnd;
                setIsPlaying(false);
                return;
              }
            } else {
              setCurrentTime(mappedNow);
              trimBoundsRef.current.currentTime = mappedNow;
              syncCustomAudioToTime(mappedNow, true);
              if (splitTimelineRef.current && !isUserScrubbingTimelineRef.current) {
                isSyncingTimelineScrollRef.current = true;
                splitTimelineRef.current.scrollLeft = mappedNow * splitPxPerSec;
                window.requestAnimationFrame(() => {
                  isSyncingTimelineScrollRef.current = false;
                });
              }
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
  }, [isPlayerOpen, isPlaying, editMode, currentTime, splitPxPerSec]);

  // Extract filmstrip frames per unique video source on the Split timeline
  const splitVideoSourcesKey = useMemo(() => {
    const urls = Array.from(
      new Set(
        splitSegments
          .filter((s) => s.mediaType === 'video' && s.sourceUrl)
          .map((s) => s.sourceUrl)
      )
    );
    return urls.join('|');
  }, [splitSegments]);

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
    if (pauseSignal > 0 && videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
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

  const filteredVideos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return videos;
    return videos.filter(
      (v) =>
        v.title.toLowerCase().includes(q) ||
        v.displayName.toLowerCase().includes(q)
    );
  }, [videos, searchQuery]);

  const closePlayer = async () => {
    clearHideTimer();
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // ignore fullscreen exit error
      }
    }
    if (videoRef.current) {
      videoRef.current.pause();
    }
    if (splitAudioRef.current) {
      splitAudioRef.current.pause();
    }
    setIsPlaying(false);
    setIsPreviewingTrim(false);
    setEditMode('none');
    setShowAddMediaMenu(false);
    setActiveSplitPicker('none');
    setSplitCustomAudio(null);
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
        if (activeSplitPicker !== 'none') {
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
  }, [isPlayerOpen, editMode, isPreviewingTrim, activeSplitPicker, showAddMediaMenu]);

  const playVideoItem = async (item: VideoTrackItem) => {
    setErrorMessage(null);
    setEditMode('none');
    setShowAddMediaMenu(false);
    setActiveSplitPicker('none');
    setSplitCustomAudio(null);
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

      mainVideoUrlRef.current = playableUrl;
      activeSplitVideoUrlRef.current = playableUrl;

      const videoEl = videoRef.current;
      if (!videoEl) return;

      videoEl.src = playableUrl;
      videoEl.muted = isMuted;
      videoEl.playbackRate = playbackSpeed;
      videoEl.load();
      await videoEl.play();
      setIsPlaying(true);
    } catch (err) {
      console.error('Video playback failed:', err);
      setErrorMessage(`Could not play "${item.title || item.displayName}".`);
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
        videoEl.pause();
        if (splitAudioRef.current && !splitAudioRef.current.paused) {
          splitAudioRef.current.pause();
        }
        setIsPlaying(false);
      } else {
        onPlaybackStarted();
        const kept = mappedSplitSegments.filter((s) => !s.removed);
        if (kept.length === 0) return;

        let targetTime = currentTime;
        const inKept = kept.find(
          (s) => currentTime >= s.globalStart - 0.03 && currentTime < s.globalEnd - 0.04
        );
        if (!inKept) {
          const nextKept = kept.find((s) => s.globalStart >= currentTime) || kept[0];
          targetTime = nextKept.globalStart;
        }
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
        console.error('Video resume failed:', err);
        setIsMaskingTrimSeek(false);
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
    const pool = filteredVideos.length > 0 ? filteredVideos : videos;
    if (pool.length === 0) return;

    if (!currentVideo) {
      void playVideoItem(pool[0]);
      return;
    }

    const idx = pool.findIndex((v) => v.id === currentVideo.id);
    const baseIdx = idx >= 0 ? idx : 0;
    const nextIdx = (baseIdx + direction + pool.length) % pool.length;
    void playVideoItem(pool[nextIdx]);
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
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
    if (splitAudioRef.current && !splitAudioRef.current.paused) {
      splitAudioRef.current.pause();
    }
    setIsPlaying(false);
    setShowAddMediaMenu(false);
    setActiveSplitPicker('none');
    setEditMode('none');
    // Restore original main video source if multi-clip playback switched it
    if (videoRef.current && mainVideoUrlRef.current && activeSplitVideoUrlRef.current !== mainVideoUrlRef.current) {
      activeSplitVideoUrlRef.current = mainVideoUrlRef.current;
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
    setSplitCustomAudio(null);
    setExportProgressPct(null);

    if (editMode === 'split') {
      exitSplitToPlayer();
      return;
    }

    const playableUrl = mainVideoUrlRef.current || currentVideo.webUrl || videoRef.current?.currentSrc || '';
    mainVideoUrlRef.current = playableUrl;
    activeSplitVideoUrlRef.current = playableUrl;

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
      removed: false,
    };
    setSplitSegments([initialSeg]);
    setSelectedSplitSegId(initialSeg.id);
    setSplitUndoStack([]);
    setSplitRedoStack([]);
    setEditMode('split');

    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
      setIsPlaying(false);
    }

    // Align scroll position cleanly to currentTime on next frame
    window.requestAnimationFrame(() => {
      if (splitTimelineRef.current && videoRef.current) {
        isSyncingTimelineScrollRef.current = true;
        splitTimelineRef.current.scrollLeft = videoRef.current.currentTime * splitPxPerSec;
        window.requestAnimationFrame(() => {
          isSyncingTimelineScrollRef.current = false;
        });
      }
    });
  };

  const commitSplitSegments = (next: TimelineClipSegment[], nextSelectedId?: string | null) => {
    setSplitUndoStack((prev) => [...prev.slice(-19), splitSegments]);
    setSplitRedoStack([]);
    setSplitSegments(next);
    if (nextSelectedId !== undefined) {
      setSelectedSplitSegId(nextSelectedId);
    }
    setEditStatusMessage(null);
    setEditErrorMessage(null);
  };

  const handleUndoSplit = () => {
    if (splitUndoStack.length === 0) return;
    const previous = splitUndoStack[splitUndoStack.length - 1];
    setSplitUndoStack((prev) => prev.slice(0, -1));
    setSplitRedoStack((prev) => [...prev, splitSegments]);
    setSplitSegments(previous);
    if (!previous.some((s) => s.id === selectedSplitSegId)) {
      setSelectedSplitSegId(previous[0]?.id || null);
    }
    setEditErrorMessage(null);
  };

  const handleRedoSplit = () => {
    if (splitRedoStack.length === 0) return;
    const nextState = splitRedoStack[splitRedoStack.length - 1];
    setSplitRedoStack((prev) => prev.slice(0, -1));
    setSplitUndoStack((prev) => [...prev, splitSegments]);
    setSplitSegments(nextState);
    if (!nextState.some((s) => s.id === selectedSplitSegId)) {
      setSelectedSplitSegId(nextState[0]?.id || null);
    }
    setEditErrorMessage(null);
  };

  const handleSplitAtPlayhead = () => {
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
    commitSplitSegments(next, rightSeg.id);
  };

  const handleToggleRemoveSelectedSegment = () => {
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
    commitSplitSegments(next, targetId);

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

  const handleKeepOnlySelectedSegment = () => {
    const targetId =
      selectedSplitSegId ||
      mappedSplitSegments.find((s) => currentTime >= s.globalStart && currentTime <= s.globalEnd)?.id ||
      null;
    if (!targetId || splitSegments.length <= 1) return;

    const target = mappedSplitSegments.find((s) => s.id === targetId);
    if (!target) return;

    const next = splitSegments.map((s) => ({
      ...s,
      removed: s.id !== targetId,
    }));
    commitSplitSegments(next, targetId);
    seekSplitTimelineTo(target.globalStart, false);
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

      setSplitCustomAudio({
        id: song.id,
        title: song.title || song.displayName,
        displayName: song.displayName,
        url: playableUrl,
      });
      setActiveSplitPicker('none');
      setEditStatusMessage(null);
      setEditErrorMessage(null);
    } catch (err) {
      console.error('Failed to load replacement audio:', err);
      setEditErrorMessage('Could not load selected audio file.');
    } finally {
      setIsPreparingSplitMedia(false);
    }
  };

  const handleUploadReplacementAudioFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const url = URL.createObjectURL(file);
    webObjectUrlsRef.current.push(url);
    const title = file.name.replace(/\.[^/.]+$/, '');
    const uploadedTrack: AudioTrackItem = {
      id: `upload-audio-${Date.now()}`,
      title,
      displayName: file.name,
      artist: 'Uploaded Audio',
      album: '',
      durationMs: 0,
      size: file.size,
      mimeType: file.type || 'audio/*',
      uri: url,
      webUrl: url,
    };
    setDeviceSongs((prev) => [uploadedTrack, ...prev]);
    setSplitCustomAudio({
      id: uploadedTrack.id,
      title,
      displayName: file.name,
      url,
    });
    setActiveSplitPicker('none');
    setEditStatusMessage(null);
    setEditErrorMessage(null);
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

      const newSeg: TimelineClipSegment = {
        id: `seg-vid-${Date.now()}`,
        mediaType: 'video',
        title: vid.title || vid.displayName,
        sourceUrl: playableUrl,
        sourceUri: vid.uri,
        sourceDisplayName: vid.displayName || 'video.mp4',
        thumbnailUrl: vid.thumbnailUrl || videoThumbnailCache.get(vid.id),
        sourceStart: 0,
        sourceEnd: Math.max(0.5, Number(clipDur.toFixed(2))),
        removed: false,
      };
      const prevTotal = totalSplitDuration;
      const next = [...splitSegments, newSeg];
      commitSplitSegments(next, newSeg.id);
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
        removed: false,
      };
      const prevTotal = totalSplitDuration;
      const next = [...splitSegments, newSeg];
      commitSplitSegments(next, newSeg.id);
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
      console.warn('Preview trim playback error:', err);
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
    const hasChanges =
      removedCount > 0 || splitSegments.length > 1 || hasExtraClips || Boolean(splitCustomAudio) || isMuted;

    if (keptSegments.length === 0) {
      setEditErrorMessage('Keep at least one clip before saving.');
      return;
    }

    if (!hasChanges) {
      setEditErrorMessage('Tap Split, Add sound, or + to edit your video first.');
      return;
    }

    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
    if (splitAudioRef.current && !splitAudioRef.current.paused) {
      splitAudioRef.current.pause();
    }
    setIsPlaying(false);

    setIsProcessingEdit(true);
    setExportProgressPct(null);
    setEditErrorMessage(null);
    setEditStatusMessage(null);

    try {
      // Fast 100% lossless zero-re-encoding path when only original video parts are split/removed without audio/media changes
      if (canExportSplitLossless) {
        if (removedCount === 0 && keptSegments.length === 2) {
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
            setEditStatusMessage('Split into 2 original-quality clips in Movies/BeatPulse/');
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

      // Composed export path (replaced/muted audio, added videos, or added images)
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
          handleUploadReplacementAudioFiles(e.target.files);
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

      <audio
        ref={splitAudioRef}
        src={splitCustomAudio?.url || undefined}
        loop
        preload="auto"
        className="hidden"
      />

      {/* VLC-Style Full-Viewport Video Player Screen (Zero Scrolling) */}
      <div
        ref={playerContainerRef}
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
                  ? `Saving video... ${exportProgressPct}%`
                  : canExportSplitLossless
                  ? 'Original quality · No re-encoding'
                  : 'Custom audio & media mix'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleSaveSplitTimeline()}
              disabled={isProcessingEdit}
              className="min-h-[44px] px-4 rounded-full bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shrink-0 transition-colors whitespace-nowrap"
              title="Save Video"
              aria-label="Save Edited Video"
            >
              {isProcessingEdit ? (
                <div className="w-4 h-4 border-2 border-slate-900/30 border-t-slate-950 rounded-full animate-spin" />
              ) : (
                <>
                  <span>Save</span>
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
            if (editMode === 'split' || isPreviewingTrim) {
              void handleTogglePlayPause();
            } else {
              setShowControls((prev) => !prev);
            }
          }}
        >
          {/* Image clip preview when Split playhead stands on an added Image */}
          {editMode === 'split' && activeSplitSegAtPlayhead?.mediaType === 'image' && (
            <img
              src={activeSplitSegAtPlayhead.sourceUrl}
              alt={activeSplitSegAtPlayhead.title}
              className="max-w-full max-h-full w-auto h-full rounded-xl object-contain"
            />
          )}

          <video
            ref={videoRef}
            playsInline
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
            }}
            onLoadedMetadata={() => {
              const el = videoRef.current;
              if (!el) return;
              const pending = pendingSplitSeekRef.current;
              if (trimBoundsRef.current.editMode === 'split' && pending && activeSplitVideoUrlRef.current === pending.sourceUrl) {
                pendingSplitSeekRef.current = null;
                el.currentTime = pending.sourceTime;
                el.muted = trimBoundsRef.current.isMuted;
                el.playbackRate = trimBoundsRef.current.playbackSpeed;
                if (pending.autoPlay) {
                  void el.play().catch(() => {});
                }
                return;
              }
              if (trimBoundsRef.current.editMode !== 'split' && isFinite(el.duration) && el.duration > 0) {
                setDuration(el.duration);
                setTrimEnd((prev) => (prev <= 0 ? el.duration : Math.min(prev, el.duration)));
              }
            }}
            onPlay={() => {
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
                setIsPlaying(false);
                setShowControls(true);
              }
            }}
            className={`bg-black transition-opacity duration-75 ${
              editMode === 'split' && activeSplitSegAtPlayhead?.mediaType === 'image'
                ? 'hidden'
                : editMode === 'split'
                ? 'max-w-full max-h-full w-auto h-full rounded-xl object-contain'
                : `w-full h-full ${fitMode === 'cover' ? 'object-cover' : 'object-contain'}`
            } ${isMaskingTrimSeek ? 'opacity-0' : 'opacity-100'}`}
          />

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
                  onClick={() => void handleFullscreen()}
                  className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-white/10 text-white flex items-center justify-center cursor-pointer"
                  title="Fullscreen"
                  aria-label="Toggle Fullscreen"
                >
                  {isOsFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Horizontal Scrolling Frame-Strip Timeline + Pinned + Add Media Button */}
            <div className="relative w-full h-[90px] bg-black overflow-hidden">
              {/* Fixed Mute Button on Left Edge */}
              <button
                type="button"
                onClick={() => {
                  const next = !isMuted;
                  setIsMuted(next);
                  if (videoRef.current) videoRef.current.muted = next;
                }}
                className={`absolute left-2 top-8 z-30 w-10 h-10 rounded-full border flex items-center justify-center cursor-pointer transition-colors ${
                  isMuted
                    ? 'bg-red-500/20 border-red-400/50 text-red-300'
                    : 'bg-black/80 border-white/15 text-white hover:bg-white/15'
                }`}
                title={isMuted ? 'Unmute Video Sound' : 'Mute Video Sound'}
                aria-label={isMuted ? 'Unmute Video Sound' : 'Mute Video Sound'}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              {/* Floating + Add Video / Image Button on Right Edge (TikTok style) */}
              <button
                type="button"
                onClick={() => setShowAddMediaMenu((prev) => !prev)}
                disabled={isPreparingSplitMedia || isProcessingEdit}
                className="absolute right-2.5 top-8 z-30 w-10 h-10 rounded-xl bg-white hover:bg-slate-200 text-slate-950 shadow-lg flex items-center justify-center cursor-pointer active:scale-95 transition-transform disabled:opacity-50"
                title="Add Video or Image"
                aria-label="Add Video or Image"
              >
                <Plus className={`w-5 h-5 stroke-[2.5] transition-transform ${showAddMediaMenu ? 'rotate-45' : ''}`} />
              </button>

              {/* Center Fixed Vertical White Playhead */}
              <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[2.5px] bg-white z-30 pointer-events-none rounded-full shadow-[0_0_8px_rgba(255,255,255,0.75)]" />

              {/* Scrollable Time Ruler + Multi-Clip Filmstrip Segments */}
              <div
                ref={splitTimelineRef}
                onPointerDown={(e) => {
                  isUserScrubbingTimelineRef.current = true;
                  if (videoRef.current && !videoRef.current.paused) {
                    videoRef.current.pause();
                  }
                  if (splitAudioRef.current && !splitAudioRef.current.paused) {
                    splitAudioRef.current.pause();
                  }
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
                  if (isSyncingTimelineScrollRef.current) return;
                  const target = e.currentTarget;
                  const nextTime = Math.max(0, Math.min(totalSplitDuration, target.scrollLeft / splitPxPerSec));
                  seekSplitTimelineTo(nextTime, false);
                }}
                className="w-full h-full overflow-x-auto overflow-y-hidden no-scrollbar cursor-grab active:cursor-grabbing"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                <div
                  className="relative h-full box-content"
                  style={{
                    width: `${Math.max(120, totalSplitDuration * splitPxPerSec)}px`,
                    paddingLeft: '50%',
                    paddingRight: '50%',
                  }}
                >
                  {/* Top Time Ruler Ticks */}
                  <div className="relative h-5 w-full">
                    {(() => {
                      const stepSec =
                        totalSplitDuration <= 45
                          ? 1
                          : totalSplitDuration <= 150
                          ? 5
                          : totalSplitDuration <= 480
                          ? 15
                          : 30;
                      const ticks: number[] = [];
                      for (let t = 0; t <= Math.ceil(totalSplitDuration); t += stepSec) {
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

                  {/* Multi-Clip Filmstrip Segments */}
                  <div className="relative h-[58px] mt-1 flex items-center">
                    {mappedSplitSegments.map((seg, idx) => {
                      const segWidth = Math.max(24, (seg.globalEnd - seg.globalStart) * splitPxPerSec);
                      const isSelected = selectedSplitSegId === seg.id;
                      const sourceFrames = seg.mediaType === 'video' ? splitFramesBySource[seg.sourceUrl] || [] : [];
                      const segThumbs =
                        sourceFrames.length > 0
                          ? sourceFrames.filter(
                              (f) => f.time >= seg.sourceStart - 2 && f.time <= seg.sourceEnd + 2
                            )
                          : [];
                      const displayFrames = segThumbs.length > 0 ? segThumbs : sourceFrames.slice(0, 3);
                      const isSourceExtracting = Boolean(extractingSources[seg.sourceUrl]);

                      return (
                        <button
                          key={seg.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSplitSegId(seg.id);
                          }}
                          style={{ width: `${segWidth}px` }}
                          className={`relative h-full shrink-0 overflow-hidden rounded-lg transition-all cursor-pointer ${
                            idx > 0 ? 'ml-0.5' : ''
                          } ${
                            seg.removed
                              ? 'opacity-35 grayscale border border-red-400/50 bg-slate-900'
                              : isSelected
                              ? 'ring-2 ring-white z-10 bg-slate-900'
                              : 'border border-white/20 bg-slate-900'
                          }`}
                        >
                          {/* Image or Video Frame Strip Background */}
                          {seg.mediaType === 'image' ? (
                            <div className="absolute inset-0 flex">
                              {Array.from({ length: Math.max(2, Math.ceil(segWidth / 44)) }).map((_, tileIdx) => (
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
                              {Array.from({ length: Math.max(2, Math.ceil(segWidth / 44)) }).map(
                                (_, tileIdx) => {
                                  const frame =
                                    displayFrames[
                                      Math.min(
                                        displayFrames.length - 1,
                                        Math.floor(
                                          (tileIdx / Math.max(1, Math.ceil(segWidth / 44))) *
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

                          {/* Removed Overlay */}
                          {seg.removed && (
                            <div className="absolute inset-0 bg-red-950/60 flex items-center justify-center">
                              <span className="px-1.5 py-0.5 rounded bg-black/80 text-red-200 text-[10px] font-bold uppercase tracking-wider">
                                Removed
                              </span>
                            </div>
                          )}

                          {/* Segment Duration Label */}
                          {!seg.removed && segWidth >= 44 && (
                            <span className="absolute bottom-1 left-1 px-1 py-0.5 rounded bg-black/75 text-[9px] font-mono tabular-nums text-white leading-none">
                              {formatPreciseTime(seg.globalEnd - seg.globalStart)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* + Two-Option Popover Menu: Add Video / Add Image */}
            {showAddMediaMenu && (
              <div className="px-3">
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

            {/* Add / Replace Audio Track Lane (TikTok "Add sound" bar) */}
            <div className="px-3">
              <div className="min-h-[44px] rounded-xl bg-white/[0.08] border border-white/10 flex items-center justify-between gap-2 px-2">
                <button
                  type="button"
                  onClick={() => void openAudioPickerModal()}
                  className="flex-1 min-h-[44px] px-2 flex items-center gap-2 text-left text-xs font-semibold text-white hover:text-emerald-300 transition-colors cursor-pointer min-w-0"
                >
                  <Music className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="truncate">
                    {splitCustomAudio ? splitCustomAudio.title : 'Add sound'}
                  </span>
                </button>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !isMuted;
                      setIsMuted(next);
                      if (videoRef.current) videoRef.current.muted = next;
                    }}
                    className={`min-h-[34px] px-2.5 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                      isMuted
                        ? 'bg-red-500/20 text-red-200 border border-red-400/30'
                        : 'bg-white/10 hover:bg-white/20 text-slate-200'
                    }`}
                  >
                    {isMuted ? 'Video Muted' : 'Mute Video'}
                  </button>

                  {splitCustomAudio && (
                    <button
                      type="button"
                      onClick={() => {
                        if (splitAudioRef.current) splitAudioRef.current.pause();
                        setSplitCustomAudio(null);
                      }}
                      className="min-w-[34px] min-h-[34px] rounded-lg bg-white/10 hover:bg-red-500/25 text-slate-200 hover:text-red-200 flex items-center justify-center cursor-pointer"
                      title="Remove added sound"
                      aria-label="Remove added sound"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>

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

            {/* Bottom TikTok Tool Dock */}
            {(() => {
              const activeSeg =
                splitSegments.find((s) => s.id === selectedSplitSegId) ||
                activeSplitSegAtPlayhead ||
                splitSegments[0];
              const isSelectedRemoved = Boolean(activeSeg?.removed);
              const keptCount = splitSegments.filter((s) => !s.removed).length;
              const hasAnyEdits =
                splitSegments.some((s) => s.removed) ||
                splitSegments.length > 1 ||
                splitSegments.some((s) => s.mediaType === 'image' || s.sourceUri !== currentVideo?.uri) ||
                Boolean(splitCustomAudio) ||
                isMuted;

              return (
                <div className="px-3 flex items-center justify-center gap-2 overflow-x-auto no-scrollbar">
                  <button
                    type="button"
                    onClick={handleSplitAtPlayhead}
                    disabled={isProcessingEdit}
                    className="min-w-[66px] h-[58px] px-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors shrink-0 disabled:opacity-40"
                    title="Split at white playhead line"
                  >
                    <Scissors className="w-4 h-4" />
                    <span className="text-[11px] font-medium whitespace-nowrap">Split</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleRemoveSelectedSegment}
                    disabled={isProcessingEdit || (!isSelectedRemoved && keptCount <= 1)}
                    className={`min-w-[66px] h-[58px] px-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors shrink-0 disabled:opacity-35 ${
                      isSelectedRemoved
                        ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                        : 'bg-red-500/15 hover:bg-red-500/25 border-red-400/30 text-red-200'
                    }`}
                    title={isSelectedRemoved ? 'Restore selected part' : 'Remove selected part'}
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

                  {splitSegments.length > 1 && (
                    <button
                      type="button"
                      onClick={handleKeepOnlySelectedSegment}
                      disabled={isProcessingEdit}
                      className="min-w-[74px] h-[58px] px-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors shrink-0 disabled:opacity-40"
                      title="Remove all other parts and keep only the selected clip"
                    >
                      <Check className="w-4 h-4 text-cyan-300" />
                      <span className="text-[11px] font-medium whitespace-nowrap">Keep Only</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleSaveSplitTimeline()}
                    disabled={isProcessingEdit || !hasAnyEdits}
                    className="min-w-[74px] h-[58px] px-3 rounded-xl bg-emerald-400 hover:bg-emerald-300 disabled:bg-white/10 disabled:text-slate-400 disabled:border disabled:border-white/10 text-slate-950 font-bold flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors shrink-0"
                    title="Save edited video"
                  >
                    {isProcessingEdit ? (
                      <div className="w-4 h-4 border-2 border-slate-900/30 border-t-slate-950 rounded-full animate-spin" />
                    ) : (
                      <ArrowRight className="w-4 h-4" />
                    )}
                    <span className="text-[11px] whitespace-nowrap">
                      {isProcessingEdit && exportProgressPct !== null ? `${exportProgressPct}%` : 'Save'}
                    </span>
                  </button>
                </div>
              );
            })()}
          </div>
        )}

        {/* Full-Screen Modal Pickers inside Split Studio: Audio / Phone Videos / Phone Images */}
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
                    : 'Add Image from Phone'}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (activeSplitPicker === 'audio') splitAudioUploadInputRef.current?.click();
                  else if (activeSplitPicker === 'video') splitAddVideoInputRef.current?.click();
                  else splitAddImageInputRef.current?.click();
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
                    : 'Upload Image'}
                </span>
              </button>
            </div>

            {/* Search Input */}
            <div className="shrink-0 px-4 py-3 border-b border-white/10">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={
                    activeSplitPicker === 'audio'
                      ? audioPickerSearch
                      : activeSplitPicker === 'video'
                      ? videoPickerSearch
                      : imagePickerSearch
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (activeSplitPicker === 'audio') setAudioPickerSearch(val);
                    else if (activeSplitPicker === 'video') setVideoPickerSearch(val);
                    else setImagePickerSearch(val);
                  }}
                  placeholder={
                    activeSplitPicker === 'audio'
                      ? 'Search songs on your phone...'
                      : activeSplitPicker === 'video'
                      ? 'Search videos on your phone...'
                      : 'Search images on your phone...'
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
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-400 shrink-0">
                              <Music className="w-4 h-4" />
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
                        Allow photos & images access so BeatPulse can show all images on your phone.
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
                <p className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                  {filteredVideos.length} {filteredVideos.length === 1 ? 'video' : 'videos'} · Tap any video to open player
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
        </div>

        {permissionDenied ? (
          <div className="py-12 px-6 text-center space-y-3">
            <ShieldAlert className="w-10 h-10 text-amber-500 dark:text-amber-400 mx-auto" />
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Video Permission Required</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm mx-auto">
              Allow video access so BeatPulse can list and play all videos stored on your phone.
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
        ) : filteredVideos.length === 0 ? (
          <div className="py-12 px-6 text-center space-y-3">
            <Video className="w-10 h-10 text-slate-400 dark:text-slate-700 mx-auto" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {videos.length === 0 ? 'No videos loaded yet' : 'No matching videos'}
            </p>
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
                onSelect={(selected) => void playVideoItem(selected)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
