import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLibrary,
  VideoTrackItem,
  isNativeAndroid,
  resolvePlayableAudioUrl,
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
  Search,
  RefreshCw,
  FolderPlus,
  ShieldAlert,
  Expand,
  Shrink,
  X,
} from 'lucide-react';

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
      for (const url of webObjectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      webObjectUrlsRef.current = [];
    };
  }, []);

  // Auto-hide HUD while playing, always reveal HUD when paused
  useEffect(() => {
    if (!isPlayerOpen) return;
    if (isPlaying && showControls) {
      scheduleHideControls();
    } else if (!isPlaying) {
      clearHideTimer();
      setShowControls(true);
    }
    return () => clearHideTimer();
  }, [isPlayerOpen, isPlaying, showControls]);

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
    setIsPlaying(false);
    setIsPlayerOpen(false);
  };

  // Close VLC overlay cleanly with Escape key
  useEffect(() => {
    if (!isPlayerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) {
        void closePlayer();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPlayerOpen]);

  const playVideoItem = async (item: VideoTrackItem) => {
    setErrorMessage(null);
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
    if (videoEl.paused) {
      onPlaybackStarted();
      try {
        await videoEl.play();
        setIsPlaying(true);
      } catch (err) {
        console.error('Video resume failed:', err);
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
    const next = Math.max(0, Math.min(maxDur || 0, videoEl.currentTime + deltaSec));
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

      {/* VLC-Style Full-Viewport Video Player Screen (Zero Scrolling) */}
      <div
        ref={playerContainerRef}
        className={
          isPlayerOpen
            ? 'fixed inset-0 z-50 bg-black flex flex-col w-full h-full overflow-hidden select-none'
            : 'hidden'
        }
      >
        {/* Video Viewport Stage */}
        <div
          className="relative flex-1 min-h-0 w-full flex items-center justify-center bg-black overflow-hidden"
          onClick={() => setShowControls((prev) => !prev)}
        >
          <video
            ref={videoRef}
            playsInline
            onTimeUpdate={() => {
              if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
            }}
            onLoadedMetadata={() => {
              const el = videoRef.current;
              if (!el) return;
              if (isFinite(el.duration)) {
                setDuration(el.duration);
              }
            }}
            onPlay={() => {
              onPlaybackStarted();
              setIsPlaying(true);
            }}
            onPause={() => setIsPlaying(false)}
            onEnded={() => {
              setIsPlaying(false);
              setShowControls(true);
            }}
            className={`w-full h-full bg-black ${
              fitMode === 'cover' ? 'object-cover' : 'object-contain'
            }`}
          />

          {isLoadingVideo && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center pointer-events-none">
              <div className="w-10 h-10 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />
            </div>
          )}

          {/* Top VLC Overlay Bar: Back, Title, Speed, Fit/Fill, Fullscreen */}
          <div
            onClick={(e) => e.stopPropagation()}
            className={`absolute top-0 left-0 right-0 z-10 px-3 sm:px-5 pt-3 pb-8 bg-gradient-to-b from-black/90 via-black/55 to-transparent flex items-center justify-between gap-2 transition-opacity duration-200 ${
              showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
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
                <h2 className="text-sm sm:text-base font-bold text-white truncate">
                  {currentVideo?.title || currentVideo?.displayName || 'Video Player'}
                </h2>
                {currentVideo?.resolution && (
                  <p className="text-[11px] font-mono text-slate-300 truncate">
                    {currentVideo.resolution}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={cycleSpeed}
                className="min-w-[44px] min-h-[40px] px-2.5 rounded-lg bg-black/55 hover:bg-white/15 border border-white/15 text-white text-xs font-mono font-bold cursor-pointer transition-colors"
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
                className="min-w-[44px] min-h-[40px] px-2.5 rounded-lg bg-black/55 hover:bg-white/15 border border-white/15 text-white flex items-center justify-center gap-1 text-xs font-semibold cursor-pointer transition-colors"
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
                className="min-w-[44px] min-h-[40px] rounded-lg bg-black/55 hover:bg-white/15 border border-white/15 text-white flex items-center justify-center cursor-pointer transition-colors"
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

          {/* Center Play/Pause Quick Button when paused or HUD visible */}
          {!isLoadingVideo && (
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

          {/* Bottom VLC Overlay Controls: Seek Bar + Transport */}
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
        </div>
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
