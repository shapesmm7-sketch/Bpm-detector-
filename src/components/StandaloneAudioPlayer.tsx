import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLibrary,
  AudioTrackItem,
  isNativeAndroid,
  resolvePlayableAudioUrl,
} from '../plugins/audioLibrary';
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
} from 'lucide-react';

interface StandaloneAudioPlayerProps {
  isActiveTab: boolean;
  pauseSignal: number;
  onPlaybackStarted: () => void;
  sharedSongs: AudioTrackItem[];
  onSongsLoaded: (songs: AudioTrackItem[]) => void;
  externalTrackRequest?: { requestId: string; track: AudioTrackItem } | null;
}

type RepeatMode = 'off' | 'all' | 'one';

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

  const [songs, setSongs] = useState<AudioTrackItem[]>(sharedSongs);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoadingLibrary, setIsLoadingLibrary] = useState<boolean>(false);
  const [permissionDenied, setPermissionDenied] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [currentTrack, setCurrentTrack] = useState<AudioTrackItem | null>(null);
  const [isLoadingTrack, setIsLoadingTrack] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isShuffle, setIsShuffle] = useState<boolean>(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('all');

  useEffect(() => {
    if (sharedSongs.length > 0 && songs.length === 0) {
      setSongs(sharedSongs);
    }
  }, [sharedSongs, songs.length]);

  useEffect(() => {
    return () => {
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

  // Pause standalone audio player if another section (Home BPM Analyzer or Video Player) starts playing
  useEffect(() => {
    if (pauseSignal > 0 && audioRef.current && !audioRef.current.paused) {
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

  const playTrack = async (track: AudioTrackItem) => {
    setErrorMessage(null);
    setIsLoadingTrack(true);
    onPlaybackStarted();

    try {
      let playableUrl = track.webUrl || '';
      if (!playableUrl && isNativeAndroid()) {
        const prepared = await AudioLibrary.prepareMediaFile({
          uri: track.uri,
          displayName: track.displayName || track.title,
          mediaKind: 'audio',
        });
        playableUrl = resolvePlayableAudioUrl(prepared);
      }

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
      audioEl.load();
      await audioEl.play();
      setIsPlaying(true);
    } catch (err) {
      console.error('Audio playback failed:', err);
      setErrorMessage(`Could not play "${track.title || track.displayName}".`);
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
    const audioEl = audioRef.current;
    if (!audioEl) return;

    if (!currentTrack) {
      if (filteredSongs.length > 0) {
        await playTrack(filteredSongs[0]);
      }
      return;
    }

    if (audioEl.paused) {
      onPlaybackStarted();
      try {
        await audioEl.play();
        setIsPlaying(true);
      } catch (err) {
        console.error('Resume failed:', err);
      }
    } else {
      audioEl.pause();
      setIsPlaying(false);
    }
  };

  const handleStepTrack = (direction: -1 | 1) => {
    const pool = filteredSongs.length > 0 ? filteredSongs : songs;
    if (pool.length === 0) return;

    if (!currentTrack) {
      void playTrack(pool[0]);
      return;
    }

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
      void audioEl.play();
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

  const handleWebFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const added: AudioTrackItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const url = URL.createObjectURL(file);
      webObjectUrlsRef.current.push(url);
      added.push({
        id: `web-audio-${Date.now()}-${i}`,
        title: file.name.replace(/\.[^/.]+$/, ''),
        displayName: file.name,
        artist: 'Local File',
        album: '',
        durationMs: 0,
        size: file.size,
        mimeType: file.type || 'audio/*',
        uri: url,
        webUrl: url,
      });
    }
    const merged = [...added, ...songs];
    setSongs(merged);
  };

  const cycleRepeat = () => {
    setRepeatMode((prev) => (prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'));
  };

  return (
    <div className="space-y-5 min-w-0">
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={() => {
          if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
        }}
        onLoadedMetadata={() => {
          if (audioRef.current && isFinite(audioRef.current.duration)) {
            setDuration(audioRef.current.duration);
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
          handleWebFilesSelected(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Audio Player Deck — visible only once user taps a song */}
      {currentTrack && (
        <section className="bg-white dark:bg-slate-900 border border-emerald-500/40 dark:border-emerald-500/35 rounded-2xl p-5 shadow-xl dark:shadow-2xl space-y-5 overflow-hidden min-w-0">
          <div className="flex items-center justify-between gap-3 min-w-0">
            <div className="flex items-center gap-3.5 min-w-0 flex-1">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                {isLoadingTrack ? (
                  <div className="w-5 h-5 border-2 border-emerald-500/30 border-t-emerald-500 dark:border-t-emerald-400 rounded-full animate-spin" />
                ) : (
                  <Music className="w-6 h-6" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                  {currentTrack.title || currentTrack.displayName}
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 truncate">
                  {currentTrack.artist}
                  {currentTrack.album ? ` · ${currentTrack.album}` : ''}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                if (audioRef.current) {
                  audioRef.current.pause();
                  audioRef.current.currentTime = 0;
                }
                setIsPlaying(false);
                setCurrentTime(0);
                setCurrentTrack(null);
              }}
              className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-950 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="Close Audio Player"
              aria-label="Close Audio Player"
            >
              <X className="w-4 h-4" />
            </button>
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
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                setCurrentTime(next);
                if (audioRef.current) {
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
          <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
            <div className="flex items-center justify-center gap-2 sm:gap-3 flex-1 sm:flex-initial">
              <button
                type="button"
                onClick={() => setIsShuffle((prev) => !prev)}
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
                disabled={songs.length === 0}
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
                disabled={songs.length === 0}
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

            {/* Volume */}
            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 mx-auto sm:mx-0">
              <button
                type="button"
                onClick={() => {
                  const nextMuted = !isMuted;
                  setIsMuted(nextMuted);
                  if (audioRef.current) {
                    audioRef.current.volume = nextMuted ? 0 : volume;
                  }
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
                  setVolume(next);
                  setIsMuted(next === 0);
                  if (audioRef.current) {
                    audioRef.current.volume = next;
                  }
                }}
                aria-label="Audio volume"
                className="w-24 accent-emerald-500 dark:accent-emerald-400 cursor-pointer"
              />
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
              Allow audio access so BeatPulse can list and play all songs stored on your phone.
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
                      className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-emerald-500/15 dark:bg-emerald-500/20 border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                          : 'bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {isSelected && isPlaying ? (
                        <Pause className="w-4 h-4 fill-current" />
                      ) : (
                        <Play className="w-4 h-4 fill-current ml-0.5" />
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
