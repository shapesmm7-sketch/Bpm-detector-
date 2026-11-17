import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLibrary,
  AudioTrackItem,
  MusicPlaybackState,
  MusicRepeatMode,
  isNativeAndroid,
} from '../plugins/audioLibrary';
import { AudioArtwork } from './AudioArtwork';
import {
  extractWebAudioCoverArt,
  getGeneratedAudioArtworkUrl,
} from '../utils/audioArtwork';
import {
  Music,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Search,
  RefreshCw,
  FolderPlus,
  ShieldAlert,
  X,
  Gauge,
  Minus,
  Plus,
} from 'lucide-react';

interface StandaloneAudioPlayerProps {
  isActiveTab: boolean;
  pauseSignal: number;
  onPlaybackStarted: () => void;
  sharedSongs: AudioTrackItem[];
  onSongsLoaded: (songs: AudioTrackItem[]) => void;
  externalTrackRequest?: { requestId: string; track: AudioTrackItem } | null;
}

type RepeatMode = MusicRepeatMode;

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const mins = Math.floor(sec / 60);
  const secs = Math.floor(sec % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export const StandaloneAudioPlayer: React.FC<StandaloneAudioPlayerProps> = ({
  isActiveTab,
  pauseSignal,
  onPlaybackStarted,
  sharedSongs,
  onSongsLoaded,
  externalTrackRequest,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const webFileInputRef = useRef<HTMLInputElement | null>(null);
  const webObjectUrlsRef = useRef<string[]>([]);
  const hasAutoLoadedRef = useRef<boolean>(false);
  const lastExternalRequestIdRef = useRef<string | null>(null);
  const isScrubbingRef = useRef<boolean>(false);
  const scrubSeekTimeoutRef = useRef<number | null>(null);
  const wasPlayingNativeRef = useRef<boolean>(false);

  const [songs, setSongs] = useState<AudioTrackItem[]>(sharedSongs);
  const songsRef = useRef<AudioTrackItem[]>(songs);
  useEffect(() => {
    songsRef.current = songs;
  }, [songs]);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoadingLibrary, setIsLoadingLibrary] = useState<boolean>(false);
  const [permissionDenied, setPermissionDenied] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [currentTrack, setCurrentTrack] = useState<AudioTrackItem | null>(null);
  const currentTrackRef = useRef<AudioTrackItem | null>(null);
  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  const [isLoadingTrack, setIsLoadingTrack] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const isPlayingRef = useRef<boolean>(false);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isShuffle, setIsShuffle] = useState<boolean>(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('all');
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const playbackSpeedRef = useRef<number>(playbackSpeed);
  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  const onPlaybackStartedRef = useRef(onPlaybackStarted);
  useEffect(() => {
    onPlaybackStartedRef.current = onPlaybackStarted;
  }, [onPlaybackStarted]);

  useEffect(() => {
    if (sharedSongs.length > 0 && songs.length === 0) {
      setSongs(sharedSongs);
    }
  }, [sharedSongs, songs.length]);

  useEffect(() => {
    return () => {
      if (scrubSeekTimeoutRef.current !== null) {
        window.clearTimeout(scrubSeekTimeoutRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      for (const url of webObjectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      webObjectUrlsRef.current = [];
    };
  }, []);

  // Synchronize React player state from native Android MusicPlaybackService
  useEffect(() => {
    if (!isNativeAndroid()) return;

    const applyNativeState = (state: MusicPlaybackState | null | undefined) => {
      if (!state) return;

      if (!state.hasTrack) {
        wasPlayingNativeRef.current = false;
        const active = currentTrackRef.current;
        if (!active || !active.webUrl || !active.uri.startsWith('blob:')) {
          setCurrentTrack(null);
          setIsPlaying(false);
          setIsLoadingTrack(false);
          setCurrentTime(0);
        }
        return;
      }

      const list = songsRef.current;
      const matched = list.find(
        (s) =>
          (state.trackId && s.id === state.trackId) ||
          (state.trackUri && s.uri === state.trackUri)
      );

      const resolvedTrack: AudioTrackItem = matched || {
        id: state.trackId || state.trackUri || `track-${Date.now()}`,
        title: state.title || state.displayName || 'Audio Track',
        displayName: state.displayName || state.title || 'audio_track',
        artist: state.artist || 'Unknown Artist',
        album: state.album || '',
        durationMs: state.durationMs || 0,
        size: 0,
        mimeType: 'audio/*',
        uri: state.trackUri || '',
      };

      const nextPlaying = Boolean(state.isPlaying);
      if (!wasPlayingNativeRef.current && nextPlaying) {
        onPlaybackStartedRef.current();
      }
      wasPlayingNativeRef.current = nextPlaying;

      setCurrentTrack(resolvedTrack);
      setIsPlaying(nextPlaying);
      setIsLoadingTrack(Boolean(state.isLoading));
      if (!isScrubbingRef.current) {
        setCurrentTime(Math.max(0, (state.positionMs || 0) / 1000));
      }
      if (typeof state.durationMs === 'number' && state.durationMs >= 0) {
        setDuration(state.durationMs / 1000);
      }
      if (typeof state.isShuffle === 'boolean') {
        setIsShuffle(state.isShuffle);
      }
      if (
        state.repeatMode === 'off' ||
        state.repeatMode === 'all' ||
        state.repeatMode === 'one'
      ) {
        setRepeatMode(state.repeatMode);
      }
      if (typeof state.playbackSpeed === 'number' && state.playbackSpeed >= 0.5 && state.playbackSpeed <= 2.0) {
        setPlaybackSpeed(Number(state.playbackSpeed.toFixed(2)));
      }
      if (state.error) {
        setErrorMessage(state.error);
      } else if (nextPlaying || state.isLoading) {
        setErrorMessage(null);
      }
    };

    let listenerHandle: { remove: () => Promise<void> } | null = null;
    void AudioLibrary.addListener('musicPlaybackStateChanged', applyNativeState).then(
      (handle) => {
        listenerHandle = handle;
      }
    );

    const syncNow = () => {
      void AudioLibrary.getMusicPlaybackState()
        .then(applyNativeState)
        .catch(() => {
          // ignore transient bridge query failure
        });
    };

    syncNow();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncNow();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (listenerHandle) {
        void listenerHandle.remove();
      }
    };
  }, []);

  // Re-enrich currentTrack with full library metadata if song list loads after service hydration
  useEffect(() => {
    if (!currentTrack || songs.length === 0) return;
    const matched = songs.find(
      (s) => s.id === currentTrack.id || (s.uri && s.uri === currentTrack.uri)
    );
    if (matched && (matched.size !== currentTrack.size || matched.thumbnailUrl !== currentTrack.thumbnailUrl)) {
      setCurrentTrack(matched);
    }
  }, [songs, currentTrack]);

  // Pause standalone audio player ONLY if another section (Home BPM Analyzer or Video Player) starts playing
  useEffect(() => {
    if (pauseSignal <= 0) return;
    if (isNativeAndroid()) {
      if (isPlayingRef.current) {
        void AudioLibrary.pauseMusicPlayback();
      }
    }
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, [pauseSignal]);

  const loadDeviceAudios = async () => {
    if (!isNativeAndroid()) return;
    setIsLoadingLibrary(true);
    setErrorMessage(null);
    try {
      const res = await AudioLibrary.getAllAudioFiles();
      if (res.granted) {
        setPermissionDenied(false);
        const list = res.songs || [];
        setSongs(list);
        onSongsLoaded(list);
        if (currentTrackRef.current && list.length > 0) {
          void AudioLibrary.updateMusicQueue({ songs: list }).catch(() => {});
        }
      } else {
        setPermissionDenied(true);
      }
    } catch (err) {
      console.error('Failed to load phone audio library:', err);
      setErrorMessage('Could not read audio files from your phone.');
    } finally {
      setIsLoadingLibrary(false);
    }
  };

  useEffect(() => {
    if (isActiveTab && isNativeAndroid() && !hasAutoLoadedRef.current) {
      hasAutoLoadedRef.current = true;
      void loadDeviceAudios();
    }
  }, [isActiveTab]);

  const filteredSongs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.displayName.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q)
    );
  }, [songs, searchQuery]);

  const shouldUseNativeService = (track: AudioTrackItem): boolean => {
    return isNativeAndroid() && Boolean(track.uri) && !track.uri.startsWith('blob:');
  };

  const playTrack = async (track: AudioTrackItem) => {
    setErrorMessage(null);
    setIsLoadingTrack(true);
    onPlaybackStarted();

    if (shouldUseNativeService(track)) {
      try {
        if (audioRef.current && !audioRef.current.paused) {
          audioRef.current.pause();
        }
        const pool = filteredSongs.length > 0 ? filteredSongs : songs;
        const activeQueue = pool.some(
          (s) => s.id === track.id || (s.uri && s.uri === track.uri)
        )
          ? pool
          : [track, ...pool];
        const startIndex = Math.max(
          0,
          activeQueue.findIndex(
            (s) => s.id === track.id || (s.uri && s.uri === track.uri)
          )
        );

        setCurrentTrack(track);
        setCurrentTime(0);
        setDuration(track.durationMs > 0 ? track.durationMs / 1000 : 0);

        await AudioLibrary.startMusicPlayback({
          songs: activeQueue,
          startIndex,
          isShuffle,
          repeatMode,
          volume,
          isMuted,
          playbackSpeed: playbackSpeedRef.current,
        });
      } catch (err) {
        console.error('Native background audio playback failed:', err);
        setErrorMessage(`Could not play "${track.title || track.displayName}".`);
        setIsLoadingTrack(false);
        setIsPlaying(false);
      }
      return;
    }

    try {
      const playableUrl = track.webUrl || track.uri;
      if (!playableUrl) {
        throw new Error('Audio source unavailable');
      }

      const audioEl = audioRef.current;
      if (!audioEl) return;

      setCurrentTrack(track);
      setCurrentTime(0);
      setDuration(track.durationMs > 0 ? track.durationMs / 1000 : 0);

      audioEl.src = playableUrl;
      audioEl.volume = isMuted ? 0 : volume;
      audioEl.playbackRate = playbackSpeedRef.current;
      audioEl.preservesPitch = true;
      audioEl.load();
      audioEl.playbackRate = playbackSpeedRef.current;
      await audioEl.play();
      setIsPlaying(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const name = err instanceof DOMException ? err.name : '';
      if (
        name !== 'AbortError' &&
        !msg.includes('interrupted by a call to pause') &&
        !msg.includes('interrupted by a new load request')
      ) {
        console.error('Audio playback failed:', err);
        setErrorMessage(`Could not play "${track.title || track.displayName}".`);
      }
      setIsPlaying(false);
    } finally {
      setIsLoadingTrack(false);
    }
  };

  // Auto-play audio file opened externally when BeatPulse is chosen/default player
  useEffect(() => {
    if (!externalTrackRequest) return;
    if (lastExternalRequestIdRef.current === externalTrackRequest.requestId) return;
    lastExternalRequestIdRef.current = externalTrackRequest.requestId;

    const incoming = externalTrackRequest.track;
    setSongs((prev) => {
      const exists = prev.some((s) => s.id === incoming.id || (s.uri && s.uri === incoming.uri));
      return exists ? prev : [incoming, ...prev];
    });
    void playTrack(incoming);
  }, [externalTrackRequest]);

  const handleTogglePlayPause = async () => {
    if (!currentTrack) {
      if (filteredSongs.length > 0) {
        await playTrack(filteredSongs[0]);
      }
      return;
    }

    if (shouldUseNativeService(currentTrack)) {
      if (!isPlaying) {
        onPlaybackStarted();
      }
      try {
        await AudioLibrary.toggleMusicPlayPause();
      } catch (err) {
        console.error('Native toggle play/pause failed:', err);
      }
      return;
    }

    const audioEl = audioRef.current;
    if (!audioEl) return;

    if (audioEl.paused) {
      onPlaybackStarted();
      try {
        await audioEl.play();
        setIsPlaying(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        const name = err instanceof DOMException ? err.name : '';
        if (name !== 'AbortError' && !msg.includes('interrupted by a call to pause')) {
          console.error('Resume failed:', err);
        }
      }
    } else {
      audioEl.pause();
      setIsPlaying(false);
    }
  };

  const handleStepTrack = (direction: -1 | 1) => {
    const pool = filteredSongs.length > 0 ? filteredSongs : songs;

    if (!currentTrack) {
      if (pool.length > 0) {
        void playTrack(pool[0]);
      }
      return;
    }

    if (shouldUseNativeService(currentTrack)) {
      onPlaybackStarted();
      void AudioLibrary.stepMusicTrack({ direction }).catch((err) => {
        console.error('Native track step failed:', err);
      });
      return;
    }

    if (pool.length === 0) return;

    if (isShuffle && pool.length > 1) {
      const candidates = pool.filter((s) => s.id !== currentTrack.id);
      const next = candidates[Math.floor(Math.random() * candidates.length)];
      if (next) void playTrack(next);
      return;
    }

    const idx = pool.findIndex((s) => s.id === currentTrack.id);
    const baseIdx = idx >= 0 ? idx : 0;
    const nextIdx = (baseIdx + direction + pool.length) % pool.length;
    void playTrack(pool[nextIdx]);
  };

  const handleTrackEnded = () => {
    const audioEl = audioRef.current;
    if (repeatMode === 'one' && audioEl) {
      audioEl.currentTime = 0;
      void audioEl.play().catch(() => {});
      return;
    }

    const pool = filteredSongs.length > 0 ? filteredSongs : songs;
    if (pool.length === 0) {
      setIsPlaying(false);
      return;
    }

    if (isShuffle && pool.length > 1) {
      handleStepTrack(1);
      return;
    }

    const idx = currentTrack ? pool.findIndex((s) => s.id === currentTrack.id) : -1;
    if (idx >= 0 && idx < pool.length - 1) {
      void playTrack(pool[idx + 1]);
    } else if (repeatMode === 'all') {
      void playTrack(pool[0]);
    } else {
      setIsPlaying(false);
      setCurrentTime(0);
    }
  };

  // Web browser MediaSession integration fallback
  const stepTrackRef = useRef(handleStepTrack);
  stepTrackRef.current = handleStepTrack;
  const togglePlayPauseRef = useRef(handleTogglePlayPause);
  togglePlayPauseRef.current = handleTogglePlayPause;

  useEffect(() => {
    if (isNativeAndroid() || typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    const ms = navigator.mediaSession;
    if (!currentTrack) {
      ms.metadata = null;
      ms.playbackState = 'none';
      return;
    }

    const artUrl =
      currentTrack.thumbnailUrl ||
      getGeneratedAudioArtworkUrl(
        currentTrack.title || currentTrack.displayName,
        currentTrack.artist,
        currentTrack.id || currentTrack.uri
      );

    if (typeof MediaMetadata !== 'undefined') {
      ms.metadata = new MediaMetadata({
        title: currentTrack.title || currentTrack.displayName,
        artist: currentTrack.artist || 'Unknown Artist',
        album: currentTrack.album || '',
        artwork: artUrl ? [{ src: artUrl, sizes: '360x360', type: 'image/png' }] : [],
      });
    }
    ms.playbackState = isPlaying ? 'playing' : 'paused';

    try {
      ms.setActionHandler('play', () => void togglePlayPauseRef.current());
      ms.setActionHandler('pause', () => void togglePlayPauseRef.current());
      ms.setActionHandler('previoustrack', () => stepTrackRef.current(-1));
      ms.setActionHandler('nexttrack', () => stepTrackRef.current(1));
      ms.setActionHandler('seekto', (details) => {
        if (typeof details.seekTime === 'number' && audioRef.current) {
          audioRef.current.currentTime = details.seekTime;
          setCurrentTime(details.seekTime);
        }
      });
    } catch {
      // ignore unsupported MediaSession action handlers in older browsers
    }
  }, [currentTrack, isPlaying]);

  const handleWebFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const added: AudioTrackItem[] = [];
    const fileMap: Array<{ id: string; file: File }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const url = URL.createObjectURL(file);
      webObjectUrlsRef.current.push(url);
      const id = `web-audio-${Date.now()}-${i}`;
      const title = file.name.replace(/\.[^/.]+$/, '');
      const artist = 'Local File';
      added.push({
        id,
        title,
        displayName: file.name,
        artist,
        album: '',
        durationMs: 0,
        size: file.size,
        mimeType: file.type || 'audio/*',
        uri: url,
        webUrl: url,
        thumbnailUrl: getGeneratedAudioArtworkUrl(title, artist, id),
        hasEmbeddedArt: false,
      });
      fileMap.push({ id, file });
    }

    setSongs((prev) => [...added, ...prev]);

    // Extract embedded ID3/MP4 cover art asynchronously
    for (const entry of fileMap) {
      const coverUrl = await extractWebAudioCoverArt(entry.file);
      if (coverUrl) {
        webObjectUrlsRef.current.push(coverUrl);
        setSongs((prev) =>
          prev.map((s) =>
            s.id === entry.id ? { ...s, thumbnailUrl: coverUrl, hasEmbeddedArt: true } : s
          )
        );
        setCurrentTrack((prev) =>
          prev && prev.id === entry.id
            ? { ...prev, thumbnailUrl: coverUrl, hasEmbeddedArt: true }
            : prev
        );
      }
    }
  };

  const syncNativeSettings = (
    nextShuffle: boolean,
    nextRepeat: RepeatMode,
    nextVolume: number,
    nextMuted: boolean,
    nextSpeed: number = playbackSpeedRef.current
  ) => {
    if (!isNativeAndroid() || !currentTrackRef.current || !shouldUseNativeService(currentTrackRef.current)) {
      return;
    }
    void AudioLibrary.updateMusicSettings({
      isShuffle: nextShuffle,
      repeatMode: nextRepeat,
      volume: nextVolume,
      isMuted: nextMuted,
      playbackSpeed: nextSpeed,
    }).catch(() => {});
  };

  const applySongSpeed = (rawSpeed: number) => {
    const clamped = Math.max(0.5, Math.min(2.0, Number(rawSpeed.toFixed(2))));
    playbackSpeedRef.current = clamped;
    setPlaybackSpeed(clamped);
    if (audioRef.current) {
      audioRef.current.playbackRate = clamped;
      audioRef.current.preservesPitch = true;
    }
    syncNativeSettings(isShuffle, repeatMode, volume, isMuted, clamped);
  };

  const stepSongSpeed = (delta: number) => {
    applySongSpeed(playbackSpeedRef.current + delta);
  };

  const cycleSongSpeed = () => {
    const presets = [1.0, 1.25, 1.5, 1.75, 2.0, 0.75];
    const currentIdx = presets.findIndex((p) => Math.abs(p - playbackSpeedRef.current) < 0.05);
    const nextSpeed = currentIdx >= 0 ? presets[(currentIdx + 1) % presets.length] : 1.0;
    applySongSpeed(nextSpeed);
  };

  const toggleShuffle = () => {
    setIsShuffle((prev) => {
      const next = !prev;
      syncNativeSettings(next, repeatMode, volume, isMuted);
      return next;
    });
  };

  const cycleRepeat = () => {
    setRepeatMode((prev) => {
      const next: RepeatMode = prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off';
      syncNativeSettings(isShuffle, next, volume, isMuted);
      return next;
    });
  };

  const commitSeek = (nextSec: number) => {
    if (currentTrack && shouldUseNativeService(currentTrack)) {
      if (scrubSeekTimeoutRef.current !== null) {
        window.clearTimeout(scrubSeekTimeoutRef.current);
        scrubSeekTimeoutRef.current = null;
      }
      void AudioLibrary.seekMusicPlayback({ positionMs: Math.round(nextSec * 1000) }).catch(() => {});
    } else if (audioRef.current) {
      audioRef.current.currentTime = nextSec;
    }
  };

  return (
    <div className="space-y-5 min-w-0">
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={() => {
          if (audioRef.current && !isScrubbingRef.current) {
            setCurrentTime(audioRef.current.currentTime);
          }
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) {
            if (isFinite(audioRef.current.duration)) {
              setDuration(audioRef.current.duration);
            }
            audioRef.current.playbackRate = playbackSpeedRef.current;
            audioRef.current.preservesPitch = true;
          }
        }}
        onEnded={handleTrackEnded}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />

      <input
        ref={webFileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleWebFilesSelected(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Audio Player Deck — visible only once user taps a song */}
      {currentTrack && (
        <section className="bg-white dark:bg-slate-900 border border-emerald-500/40 dark:border-emerald-500/35 rounded-2xl p-4 sm:p-5 shadow-xl dark:shadow-2xl space-y-4 overflow-hidden min-w-0">
          {/* Player Header */}
          <div className="flex items-center justify-between gap-3 min-w-0">
            <div className="min-w-0 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-semibold truncate">
                {isPlaying ? 'Now Playing' : 'Paused'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                if (shouldUseNativeService(currentTrack)) {
                  void AudioLibrary.stopMusicPlayback().catch(() => {});
                }
                if (audioRef.current) {
                  audioRef.current.pause();
                  audioRef.current.currentTime = 0;
                }
                wasPlayingNativeRef.current = false;
                setIsPlaying(false);
                setIsLoadingTrack(false);
                setCurrentTime(0);
                setCurrentTrack(null);
              }}
              className="min-w-[40px] min-h-[40px] rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-950 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="Close Audio Player"
              aria-label="Close Audio Player"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Full-Size Cover Artwork Stage */}
          <div className="relative w-full max-w-[340px] aspect-square mx-auto rounded-2xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xl">
            <AudioArtwork song={currentTrack} className="w-full h-full" />
            {isLoadingTrack && (
              <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px] flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Track Title & Artist beneath Artwork */}
          <div className="text-center space-y-1 min-w-0 px-1">
            <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-slate-100 truncate">
              {currentTrack.title || currentTrack.displayName}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 truncate">
              {currentTrack.artist}
              {currentTrack.album ? ` · ${currentTrack.album}` : ''}
            </p>
          </div>

          {/* Timeline Scrubber */}
          <div className="space-y-1.5">
            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 100}
              step={0.1}
              value={Math.min(currentTime, duration > 0 ? duration : 100)}
              disabled={!currentTrack || duration <= 0}
              onPointerDown={() => {
                isScrubbingRef.current = true;
              }}
              onPointerUp={(e) => {
                isScrubbingRef.current = false;
                commitSeek(parseFloat((e.target as HTMLInputElement).value));
              }}
              onTouchStart={() => {
                isScrubbingRef.current = true;
              }}
              onTouchEnd={(e) => {
                isScrubbingRef.current = false;
                commitSeek(parseFloat((e.target as HTMLInputElement).value));
              }}
              onBlur={() => {
                isScrubbingRef.current = false;
              }}
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                setCurrentTime(next);
                if (currentTrack && shouldUseNativeService(currentTrack)) {
                  if (scrubSeekTimeoutRef.current !== null) {
                    window.clearTimeout(scrubSeekTimeoutRef.current);
                  }
                  scrubSeekTimeoutRef.current = window.setTimeout(() => {
                    scrubSeekTimeoutRef.current = null;
                    void AudioLibrary.seekMusicPlayback({
                      positionMs: Math.round(next * 1000),
                    }).catch(() => {});
                  }, 60);
                } else if (audioRef.current) {
                  audioRef.current.currentTime = next;
                }
              }}
              aria-label="Audio playback progress"
              className="w-full h-2 accent-emerald-500 dark:accent-emerald-400 cursor-pointer disabled:opacity-40"
            />
            <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Transport Controls */}
          <div className="flex flex-col items-center gap-4 pt-1">
            <div className="flex items-center justify-center gap-2.5 sm:gap-3">
              <button
                type="button"
                onClick={toggleShuffle}
                className={`min-w-[44px] min-h-[44px] rounded-xl border flex items-center justify-center transition-colors cursor-pointer ${
                  isShuffle
                    ? 'bg-emerald-500/15 dark:bg-emerald-500/20 border-emerald-500/50 text-emerald-700 dark:text-emerald-400'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-950 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
                title={isShuffle ? 'Shuffle On' : 'Shuffle Off'}
                aria-label="Toggle Shuffle"
              >
                <Shuffle className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => handleStepTrack(-1)}
                disabled={songs.length === 0 && !currentTrack}
                className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-950 dark:hover:bg-slate-800 disabled:opacity-40 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
                title="Previous Track"
                aria-label="Previous Track"
              >
                <SkipBack className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => void handleTogglePlayPause()}
                disabled={songs.length === 0 && !currentTrack}
                className="w-14 h-14 rounded-2xl bg-emerald-500 hover:bg-emerald-400 dark:bg-emerald-400 dark:hover:bg-emerald-300 disabled:opacity-40 text-white dark:text-slate-950 flex items-center justify-center shadow-lg shadow-emerald-500/20 active:scale-95 transition-all cursor-pointer shrink-0"
                title={isPlaying ? 'Pause' : 'Play'}
                aria-label={isPlaying ? 'Pause Audio' : 'Play Audio'}
              >
                {isPlaying ? (
                  <Pause className="w-6 h-6 fill-current" />
                ) : (
                  <Play className="w-6 h-6 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => handleStepTrack(1)}
                disabled={songs.length === 0 && !currentTrack}
                className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-950 dark:hover:bg-slate-800 disabled:opacity-40 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
                title="Next Track"
                aria-label="Next Track"
              >
                <SkipForward className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={cycleRepeat}
                className={`min-w-[44px] min-h-[44px] rounded-xl border flex items-center justify-center transition-colors cursor-pointer ${
                  repeatMode !== 'off'
                    ? 'bg-emerald-500/15 dark:bg-emerald-500/20 border-emerald-500/50 text-emerald-700 dark:text-emerald-400'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-950 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
                title={`Repeat: ${repeatMode}`}
                aria-label="Cycle Repeat Mode"
              >
                {repeatMode === 'one' ? (
                  <Repeat1 className="w-4 h-4" />
                ) : (
                  <Repeat className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Speed & Volume Strip */}
            <div className="w-full flex flex-wrap items-center justify-center sm:justify-between gap-2.5">
              {/* Song Playback Speed Control */}
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-950 px-1.5 py-1 rounded-xl border border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => stepSongSpeed(-0.25)}
                  disabled={playbackSpeed <= 0.5}
                  className="w-8 h-8 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-35 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer transition-colors"
                  title="Decrease Song Speed"
                  aria-label="Decrease Song Speed"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={cycleSongSpeed}
                  className={`min-h-[32px] px-2.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
                    playbackSpeed !== 1
                      ? 'bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                      : 'text-slate-800 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                  }`}
                  title="Tap to change song speed"
                  aria-label={`Song speed ${playbackSpeed}x`}
                >
                  <Gauge className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>{playbackSpeed.toFixed(playbackSpeed % 0.25 === 0 && playbackSpeed % 0.5 !== 0 ? 2 : 1)}x</span>
                </button>
                <button
                  type="button"
                  onClick={() => stepSongSpeed(0.25)}
                  disabled={playbackSpeed >= 2.0}
                  className="w-8 h-8 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-35 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer transition-colors"
                  title="Increase Song Speed"
                  aria-label="Increase Song Speed"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Volume */}
              <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    const nextMuted = !isMuted;
                    setIsMuted(nextMuted);
                    if (audioRef.current) {
                      audioRef.current.volume = nextMuted ? 0 : volume;
                    }
                    syncNativeSettings(isShuffle, repeatMode, volume, nextMuted);
                  }}
                  className="text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white cursor-pointer p-1"
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-red-500 dark:text-red-400" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-slate-700 dark:text-slate-300" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const next = parseFloat(e.target.value);
                    const nextMuted = next === 0;
                    setVolume(next);
                    setIsMuted(nextMuted);
                    if (audioRef.current) {
                      audioRef.current.volume = next;
                    }
                    syncNativeSettings(isShuffle, repeatMode, next, nextMuted);
                  }}
                  aria-label="Audio volume"
                  className="w-24 accent-emerald-500 dark:accent-emerald-400 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs">
              {errorMessage}
            </div>
          )}
        </section>
      )}

      {/* Phone Audio Library List */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-lg dark:shadow-2xl min-w-0">
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between gap-3 min-w-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                <Music className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                  Phone Audio Library
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums truncate">
                  {filteredSongs.length} {filteredSongs.length === 1 ? 'song' : 'songs'} · Tap any song to play
                </p>
              </div>
            </div>

            <div className="shrink-0">
              {isNativeAndroid() ? (
                <button
                  type="button"
                  onClick={() => void loadDeviceAudios()}
                  disabled={isLoadingLibrary}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-950 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-60"
                  title="Refresh Phone Audio List"
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
                  <span>Add Audio</span>
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
              placeholder="Search songs on your phone..."
              className="w-full min-h-[44px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-emerald-500/60 rounded-xl pl-9 pr-9 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer p-1"
                aria-label="Clear audio search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {permissionDenied ? (
          <div className="py-12 px-6 text-center space-y-3">
            <ShieldAlert className="w-10 h-10 text-amber-500 dark:text-amber-400 mx-auto" />
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Audio Permission Required</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm mx-auto">
              Allow audio access so Mo Vibe can list and play all songs stored on your phone.
            </p>
            <button
              type="button"
              onClick={() => void loadDeviceAudios()}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 dark:bg-emerald-400 dark:hover:bg-emerald-300 text-white dark:text-slate-950 text-xs font-bold cursor-pointer transition-colors"
            >
              Allow Audio Access
            </button>
          </div>
        ) : isLoadingLibrary ? (
          <div className="py-12 px-6 text-center space-y-2">
            <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 dark:border-t-emerald-400 rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">Scanning phone audio files...</p>
          </div>
        ) : filteredSongs.length === 0 ? (
          <div className="py-12 px-6 text-center space-y-3">
            <Music className="w-10 h-10 text-slate-400 dark:text-slate-700 mx-auto" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {songs.length === 0 ? 'No audio files loaded yet' : 'No matching audio files'}
            </p>
            {!isNativeAndroid() && songs.length === 0 && (
              <button
                type="button"
                onClick={() => webFileInputRef.current?.click()}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 dark:bg-emerald-400 dark:hover:bg-emerald-300 text-white dark:text-slate-950 text-xs font-bold inline-flex items-center gap-2 cursor-pointer transition-colors"
              >
                <FolderPlus className="w-4 h-4" />
                <span>Choose Audio Files</span>
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-200/80 dark:divide-slate-800/70">
            {filteredSongs.map((song) => {
              const isSelected = currentTrack?.id === song.id;
              return (
                <button
                  key={song.id}
                  type="button"
                  onClick={() => void playTrack(song)}
                  className={`w-full min-h-[58px] px-4 py-3 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                    isSelected ? 'bg-emerald-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      className={`relative w-11 h-11 rounded-xl border overflow-hidden flex items-center justify-center shrink-0 shadow-sm ${
                        isSelected
                          ? 'border-emerald-500/60 ring-1 ring-emerald-500/30'
                          : 'border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <AudioArtwork song={song} className="w-full h-full" />
                      {isSelected && (
                        <div className="absolute inset-0 bg-slate-950/45 flex items-center justify-center text-emerald-400">
                          {isPlaying ? (
                            <Pause className="w-4 h-4 fill-current" />
                          ) : (
                            <Play className="w-4 h-4 fill-current ml-0.5" />
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-semibold truncate ${
                          isSelected ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {song.title || song.displayName}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 truncate">
                        {song.artist} · {song.displayName}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0 font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-400 space-y-0.5">
                    {song.durationMs > 0 && (
                      <div className="text-emerald-600 dark:text-emerald-400 font-semibold">
                        {formatTime(song.durationMs / 1000)}
                      </div>
                    )}
                    {song.size > 0 && <div>{formatSize(song.size)}</div>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
