import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  AudioLibrary,
  AudioTrackItem,
  MusicPlaybackState,
  MusicRepeatMode,
  isNativeAndroid,
  resolvePlayableAudioUrl,
  saveExportedAudioBlob,
} from '../plugins/audioLibrary';
import { AudioArtwork } from './AudioArtwork';
import { ExportFormatModal } from './ExportFormatModal';
import {
  AudioAddLockInfoModal,
  AudioDeleteConfirmModal,
  AudioDetailsModal,
  AudioDetailsSnapshot,
  AudioMenuActionId,
  AudioMoveCopyModal,
  AudioPlaylist,
  AudioPlaylistModal,
  AudioRenameModal,
  AudioThreeDotsMenuSheet,
  AudioTrimModal,
  LockedTrackInfo,
  PlaylistAddSongsModal,
} from './AudioTrackActionModals';
import {
  extractWebAudioCoverArt,
  getGeneratedAudioArtworkUrl,
} from '../utils/audioArtwork';
import { decodeAudioData } from '../utils/audioAnalyzer';
import {
  AudioExportFormat,
  encodeAudioFormatBlob,
  getAudioFormatOption,
} from '../utils/audioEncoders';
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
  MoreVertical,
  Heart,
  Lock,
  Trash2,
  Eye,
  ListMusic,
  ListPlus,
  Pencil,
  Check,
  CheckCircle2,
} from 'lucide-react';

type LibraryFilterTab = 'all' | 'favorites' | 'playlists' | 'hidden';
type PlaybackScope =
  | { type: 'all' }
  | { type: 'favorites' }
  | { type: 'hidden' }
  | { type: 'playlist'; playlistId: string };

const PLAYLISTS_STORAGE_KEY = 'movibe_audio_playlists';
const FAVORITES_STORAGE_KEY = 'movibe_favorite_audio_ids';
const HIDDEN_STORAGE_KEY = 'movibe_hidden_audio_ids';
const LOCKED_INFO_STORAGE_KEY = 'movibe_locked_audio_info';

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

interface StandaloneAudioPlayerProps {
  isActiveTab: boolean;
  pauseSignal: number;
  onPlaybackStarted: () => void;
  sharedSongs: AudioTrackItem[];
  onSongsLoaded: (songs: AudioTrackItem[]) => void;
  externalTrackRequest?: { requestId: string; track: AudioTrackItem } | null;
  onOpenTrackInStudio?: (song: AudioTrackItem, focus: 'key' | 'tempo') => void;
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
  onOpenTrackInStudio,
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
          const scopedQueue = resolveScopeQueue(playbackScopeRef.current, list);
          if (scopedQueue.length > 0) {
            void AudioLibrary.updateMusicQueue({ songs: scopedQueue }).catch(() => {});
          }
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

  // Library organization & 3-dots menu states
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilterTab>('all');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [playbackScope, setPlaybackScope] = useState<PlaybackScope>({ type: 'all' });
  const playbackScopeRef = useRef<PlaybackScope>({ type: 'all' });
  const [newPlaylistNameInput, setNewPlaylistNameInput] = useState<string>('');
  const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = useState<boolean>(false);
  const [addSongsModalPlaylistId, setAddSongsModalPlaylistId] = useState<string | null>(null);
  const [renamingPlaylistId, setRenamingPlaylistId] = useState<string | null>(null);
  const [renamingPlaylistDraft, setRenamingPlaylistDraft] = useState<string>('');
  const [playlists, setPlaylists] = useState<AudioPlaylist[]>(() =>
    readJsonStorage<AudioPlaylist[]>(PLAYLISTS_STORAGE_KEY, [])
  );
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() =>
    readJsonStorage<string[]>(FAVORITES_STORAGE_KEY, [])
  );
  const [hiddenIds, setHiddenIds] = useState<string[]>(() =>
    readJsonStorage<string[]>(HIDDEN_STORAGE_KEY, [])
  );
  const [lockedInfoMap, setLockedInfoMap] = useState<Record<string, LockedTrackInfo>>(() =>
    readJsonStorage<Record<string, LockedTrackInfo>>(LOCKED_INFO_STORAGE_KEY, {})
  );

  const [menuTrack, setMenuTrack] = useState<AudioTrackItem | null>(null);
  const [playlistModalSong, setPlaylistModalSong] = useState<AudioTrackItem | null>(null);
  const [deleteModalSong, setDeleteModalSong] = useState<AudioTrackItem | null>(null);
  const [isDeletingSong, setIsDeletingSong] = useState<boolean>(false);
  const [detailsSnapshot, setDetailsSnapshot] = useState<AudioDetailsSnapshot | null>(null);
  const [detailsSongId, setDetailsSongId] = useState<string | null>(null);
  const [infoLockModalSong, setInfoLockModalSong] = useState<AudioTrackItem | null>(null);
  const [isSavingLockedInfo, setIsSavingLockedInfo] = useState<boolean>(false);
  const [renameModalSong, setRenameModalSong] = useState<AudioTrackItem | null>(null);
  const [isRenamingSong, setIsRenamingSong] = useState<boolean>(false);
  const [convertModalSong, setConvertModalSong] = useState<AudioTrackItem | null>(null);
  const [convertProgress, setConvertProgress] = useState<number | null>(null);
  const [trimModalSong, setTrimModalSong] = useState<AudioTrackItem | null>(null);
  const [trimBuffer, setTrimBuffer] = useState<AudioBuffer | null>(null);
  const [isTrimDecoding, setIsTrimDecoding] = useState<boolean>(false);
  const [isTrimSaving, setIsTrimSaving] = useState<boolean>(false);
  const [trimSaveProgress, setTrimSaveProgress] = useState<number>(0);
  const [trimError, setTrimError] = useState<string | null>(null);
  const [moveCopyState, setMoveCopyState] = useState<{
    mode: 'move' | 'copy';
    song: AudioTrackItem;
  } | null>(null);
  const [isMovingOrCopying, setIsMovingOrCopying] = useState<boolean>(false);
  const [actionToast, setActionToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = (msg: string, durationMs = 3500) => {
    setActionToast(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setActionToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  };

  useEffect(() => {
    try {
      localStorage.setItem(PLAYLISTS_STORAGE_KEY, JSON.stringify(playlists));
    } catch {
      // ignore storage quota errors
    }
  }, [playlists]);

  useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteIds));
    } catch {
      // ignore
    }
  }, [favoriteIds]);

  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(hiddenIds));
    } catch {
      // ignore
    }
  }, [hiddenIds]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCKED_INFO_STORAGE_KEY, JSON.stringify(lockedInfoMap));
    } catch {
      // ignore
    }
  }, [lockedInfoMap]);

  const enrichedSongs = useMemo(() => {
    return songs.map((s) => {
      const override = lockedInfoMap[s.id];
      if (!override) return s;
      return {
        ...s,
        title: override.title || s.title,
        artist: override.artist || s.artist,
        album: override.album !== undefined ? override.album : s.album,
      };
    });
  }, [songs, lockedInfoMap]);

  const enrichedSongsRef = useRef<AudioTrackItem[]>(enrichedSongs);
  enrichedSongsRef.current = enrichedSongs;
  const playlistsRef = useRef<AudioPlaylist[]>(playlists);
  playlistsRef.current = playlists;
  const favoriteIdsRef = useRef<string[]>(favoriteIds);
  favoriteIdsRef.current = favoriteIds;
  const hiddenIdsRef = useRef<string[]>(hiddenIds);
  hiddenIdsRef.current = hiddenIds;

  const resolveScopeQueue = (
    scope: PlaybackScope,
    customSongs?: AudioTrackItem[]
  ): AudioTrackItem[] => {
    const baseList = customSongs ?? enrichedSongsRef.current;
    const hidden = hiddenIdsRef.current;
    if (scope.type === 'hidden') {
      return baseList.filter((s) => hidden.includes(s.id) || hidden.includes(s.uri));
    }
    const visible = baseList.filter(
      (s) => !hidden.includes(s.id) && !hidden.includes(s.uri)
    );
    if (scope.type === 'favorites') {
      const favs = favoriteIdsRef.current;
      return visible.filter((s) => favs.includes(s.id));
    }
    if (scope.type === 'playlist') {
      const pl = playlistsRef.current.find((p) => p.id === scope.playlistId);
      if (!pl) return [];
      const byId = new Map(visible.map((s) => [s.id, s]));
      return pl.trackIds
        .map((id) => byId.get(id))
        .filter((item): item is AudioTrackItem => Boolean(item));
    }
    return visible;
  };

  useEffect(() => {
    if (!isNativeAndroid() || !currentTrackRef.current) return;
    if (playbackScopeRef.current.type !== 'playlist') return;
    const updatedQueue = resolveScopeQueue(playbackScopeRef.current);
    if (updatedQueue.length > 0) {
      void AudioLibrary.updateMusicQueue({ songs: updatedQueue }).catch(() => {});
    }
  }, [playlists]);

  const nonHiddenSongs = useMemo(() => {
    return enrichedSongs.filter(
      (s) => !hiddenIds.includes(s.id) && !hiddenIds.includes(s.uri)
    );
  }, [enrichedSongs, hiddenIds]);

  const activePlayingPlaylist = useMemo(() => {
    if (playbackScope.type !== 'playlist') return null;
    return playlists.find((p) => p.id === playbackScope.playlistId) ?? null;
  }, [playbackScope, playlists]);

  const currentOpenPlaylist = useMemo(() => {
    if (!selectedPlaylistId) return null;
    return playlists.find((p) => p.id === selectedPlaylistId) ?? null;
  }, [playlists, selectedPlaylistId]);

  const visibleBaseSongs = useMemo(() => {
    if (libraryFilter === 'hidden') {
      return enrichedSongs.filter(
        (s) => hiddenIds.includes(s.id) || hiddenIds.includes(s.uri)
      );
    }
    const visible = nonHiddenSongs;
    if (libraryFilter === 'favorites') {
      return visible.filter((s) => favoriteIds.includes(s.id));
    }
    if (libraryFilter === 'playlists') {
      const activePlaylist = playlists.find((p) => p.id === selectedPlaylistId);
      if (!activePlaylist) return [];
      const byId = new Map(visible.map((s) => [s.id, s]));
      return activePlaylist.trackIds
        .map((id) => byId.get(id))
        .filter((item): item is AudioTrackItem => Boolean(item));
    }
    return visible;
  }, [
    enrichedSongs,
    nonHiddenSongs,
    libraryFilter,
    hiddenIds,
    favoriteIds,
    playlists,
    selectedPlaylistId,
  ]);

  const filteredSongs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return visibleBaseSongs;
    return visibleBaseSongs.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.displayName.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q)
    );
  }, [visibleBaseSongs, searchQuery]);

  const shouldUseNativeService = (track: AudioTrackItem): boolean => {
    return isNativeAndroid() && Boolean(track.uri) && !track.uri.startsWith('blob:');
  };

  const playTrack = async (track: AudioTrackItem, explicitScope?: PlaybackScope) => {
    setErrorMessage(null);
    setIsLoadingTrack(true);
    onPlaybackStarted();

    const targetScope: PlaybackScope =
      explicitScope ??
      (libraryFilter === 'playlists' && selectedPlaylistId
        ? { type: 'playlist', playlistId: selectedPlaylistId }
        : libraryFilter === 'favorites'
        ? { type: 'favorites' }
        : libraryFilter === 'hidden'
        ? { type: 'hidden' }
        : { type: 'all' });

    playbackScopeRef.current = targetScope;
    setPlaybackScope(targetScope);

    if (shouldUseNativeService(track)) {
      try {
        if (audioRef.current && !audioRef.current.paused) {
          audioRef.current.pause();
        }
        const scopedPool = resolveScopeQueue(targetScope);
        const pool =
          targetScope.type === 'playlist'
            ? scopedPool
            : scopedPool.length > 0
            ? scopedPool
            : songs;
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

  const handleCreatePlaylistDirect = () => {
    const trimmed = newPlaylistNameInput.trim();
    if (!trimmed) return;
    const newPl: AudioPlaylist = {
      id: `pl-${Date.now()}`,
      name: trimmed,
      trackIds: [],
      createdAt: Date.now(),
    };
    setPlaylists((prev) => [newPl, ...prev]);
    setNewPlaylistNameInput('');
    setIsCreatePlaylistOpen(false);
    setLibraryFilter('playlists');
    setSelectedPlaylistId(newPl.id);
    showToast(`Created playlist "${trimmed}"`);
    if (nonHiddenSongs.length > 0) {
      setAddSongsModalPlaylistId(newPl.id);
    }
  };

  const handlePlayPlaylistFolder = (playlistId: string, startTrack?: AudioTrackItem) => {
    const scope: PlaybackScope = { type: 'playlist', playlistId };
    const folderTracks = resolveScopeQueue(scope);
    if (folderTracks.length === 0) {
      showToast('Add songs to this playlist first.');
      setAddSongsModalPlaylistId(playlistId);
      return;
    }
    const target = startTrack && folderTracks.some((t) => t.id === startTrack.id)
      ? startTrack
      : folderTracks[0];
    void playTrack(target, scope);
  };

  const handleRemoveTrackFromPlaylist = (playlistId: string, trackId: string) => {
    setPlaylists((prev) =>
      prev.map((pl) =>
        pl.id === playlistId
          ? { ...pl, trackIds: pl.trackIds.filter((id) => id !== trackId) }
          : pl
      )
    );
    showToast('Removed song from playlist');
  };

  const handleTogglePlayPause = async () => {
    if (!currentTrack) {
      if (libraryFilter === 'playlists' && selectedPlaylistId) {
        handlePlayPlaylistFolder(selectedPlaylistId);
        return;
      }
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
    const scope = playbackScopeRef.current;
    const scopedPool = resolveScopeQueue(scope);
    const pool =
      scope.type === 'playlist'
        ? scopedPool
        : scopedPool.length > 0
        ? scopedPool
        : songs;

    if (!currentTrack) {
      if (libraryFilter === 'playlists' && selectedPlaylistId) {
        handlePlayPlaylistFolder(selectedPlaylistId);
      } else if (pool.length > 0) {
        void playTrack(pool[0], scope);
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
      if (next) void playTrack(next, scope);
      return;
    }

    const idx = pool.findIndex((s) => s.id === currentTrack.id);
    const baseIdx = idx >= 0 ? idx : 0;
    const nextIdx = (baseIdx + direction + pool.length) % pool.length;
    void playTrack(pool[nextIdx], scope);
  };

  const handleTrackEnded = () => {
    const audioEl = audioRef.current;
    if (repeatMode === 'one' && audioEl) {
      audioEl.currentTime = 0;
      void audioEl.play().catch(() => {});
      return;
    }

    const scope = playbackScopeRef.current;
    const scopedPool = resolveScopeQueue(scope);
    const pool =
      scope.type === 'playlist'
        ? scopedPool
        : scopedPool.length > 0
        ? scopedPool
        : songs;
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
      void playTrack(pool[idx + 1], scope);
    } else if (repeatMode === 'all') {
      void playTrack(pool[0], scope);
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

  // Helper: fetch playable ArrayBuffer & decode AudioBuffer for any phone/web song
  const decodeSongBuffer = async (song: AudioTrackItem): Promise<AudioBuffer> => {
    let url = song.webUrl || song.uri;
    if (isNativeAndroid() && song.uri && !song.uri.startsWith('blob:')) {
      if (song.uri.startsWith('file://')) {
        url = Capacitor.convertFileSrc(song.uri.replace('file://', ''));
      } else {
        const prepared = await AudioLibrary.prepareAudioFile({
          uri: song.uri,
          displayName: song.displayName || song.title,
        });
        url = resolvePlayableAudioUrl(prepared);
      }
    }
    if (!url) throw new Error('Audio source unavailable');
    const resp = await fetch(url);
    const arrayBuf = await resp.arrayBuffer();
    return decodeAudioData(arrayBuf);
  };

  const stopSongIfPlaying = (song: AudioTrackItem) => {
    const active = currentTrackRef.current;
    if (!active) return;
    if (active.id === song.id || (active.uri && active.uri === song.uri)) {
      if (shouldUseNativeService(active)) {
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
    }
  };

  const handleToggleFavorite = (song: AudioTrackItem) => {
    setFavoriteIds((prev) => {
      const exists = prev.includes(song.id);
      const next = exists ? prev.filter((id) => id !== song.id) : [...prev, song.id];
      showToast(
        exists
          ? `Removed "${song.title || song.displayName}" from favorites`
          : `Added "${song.title || song.displayName}" to favorites`
      );
      return next;
    });
  };

  const handleSetAsRingtone = async (song: AudioTrackItem) => {
    if (!isNativeAndroid()) {
      showToast('Set as ringtone works on Android devices.');
      return;
    }
    try {
      const res = await AudioLibrary.setAsRingtone({
        uri: song.uri,
        title: song.title || song.displayName,
        displayName: song.displayName,
      });
      if (res.status === 'permission_required') {
        showToast(res.message || 'Allow Modify System Settings, then tap Set as ringtone again.', 5000);
      } else if (res.status === 'set') {
        showToast(res.message || `"${song.title}" set as phone ringtone`);
      } else {
        showToast(res.message || 'Could not set ringtone');
      }
    } catch {
      showToast('Could not set song as ringtone.');
    }
  };

  const handleShareSong = async (song: AudioTrackItem) => {
    if (isNativeAndroid() && song.uri && !song.uri.startsWith('blob:')) {
      try {
        await AudioLibrary.shareAudioFile({
          uri: song.uri,
          title: song.title || song.displayName,
          displayName: song.displayName,
          mimeType: song.mimeType || 'audio/*',
        });
        return;
      } catch {
        showToast('Could not open Android Share sheet.');
        return;
      }
    }
    try {
      const srcUrl = song.webUrl || song.uri;
      const resp = await fetch(srcUrl);
      const blob = await resp.blob();
      const file = new File([blob], song.displayName || 'audio.mp3', {
        type: blob.type || song.mimeType || 'audio/mpeg',
      });
      if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: song.title || song.displayName,
        });
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: song.title || song.displayName,
          text: `${song.title || song.displayName} - ${song.artist}`,
        });
        return;
      }
      await saveExportedAudioBlob(blob, song.displayName || 'audio.mp3');
      showToast(`Saved "${song.displayName}" for sharing`);
    } catch {
      showToast('Share cancelled or unavailable on this browser.');
    }
  };

  const handleOpenDetails = async (song: AudioTrackItem) => {
    setDetailsSongId(song.id);
    setDetailsSnapshot({
      title: song.title || song.displayName,
      displayName: song.displayName,
      artist: song.artist || 'Unknown Artist',
      album: song.album || '',
      durationMs: song.durationMs || 0,
      size: song.size || 0,
      mimeType: song.mimeType || 'audio/*',
      folderPath: isNativeAndroid() ? 'Reading...' : 'Browser Storage',
      isLoading: isNativeAndroid() && Boolean(song.uri) && !song.uri.startsWith('blob:'),
    });

    if (isNativeAndroid() && song.uri && !song.uri.startsWith('blob:')) {
      try {
        const info = await AudioLibrary.getAudioDetails({
          uri: song.uri,
          id: song.id,
          displayName: song.displayName,
        });
        setDetailsSnapshot((prev) =>
          prev
            ? {
                ...prev,
                title: info.title || prev.title,
                artist: info.artist || prev.artist,
                album: info.album ?? prev.album,
                durationMs: info.durationMs || prev.durationMs,
                size: info.size || prev.size,
                mimeType: info.mimeType || prev.mimeType,
                bitrateKbps: info.bitrateKbps,
                sampleRateHz: info.sampleRateHz,
                folderPath: info.folderPath || 'Phone Storage',
                isLoading: false,
              }
            : null
        );
      } catch {
        setDetailsSnapshot((prev) => (prev ? { ...prev, folderPath: 'Phone Storage', isLoading: false } : null));
      }
    }
  };

  const handleConfirmDeleteSong = async () => {
    const song = deleteModalSong;
    if (!song) return;
    setIsDeletingSong(true);
    try {
      if (isNativeAndroid() && song.uri && !song.uri.startsWith('blob:')) {
        const res = await AudioLibrary.deleteAudioFile({ uri: song.uri, id: song.id });
        if (res.cancelled) {
          showToast('Delete cancelled');
          return;
        }
      }
      stopSongIfPlaying(song);
      const updatedSongs = songs.filter((s) => s.id !== song.id);
      setSongs(updatedSongs);
      onSongsLoaded(updatedSongs);
      setFavoriteIds((prev) => prev.filter((id) => id !== song.id));
      setPlaylists((prev) =>
        prev.map((p) => ({ ...p, trackIds: p.trackIds.filter((id) => id !== song.id) }))
      );
      showToast(`Deleted "${song.title || song.displayName}"`);
      setDeleteModalSong(null);
    } catch {
      showToast('Could not delete this audio file.');
    } finally {
      setIsDeletingSong(false);
    }
  };

  const handleSaveLockedInfo = async (data: {
    title: string;
    artist: string;
    album: string;
    notes: string;
    locked: boolean;
  }) => {
    const song = infoLockModalSong;
    if (!song) return;
    setIsSavingLockedInfo(true);
    try {
      const extMatch = song.displayName.match(/\.[^/.]+$/);
      const ext = extMatch ? extMatch[0] : '.mp3';
      const newDisplayName = `${data.title}${ext}`;

      if (isNativeAndroid() && song.uri && !song.uri.startsWith('blob:')) {
        try {
          await AudioLibrary.renameAudioFile({
            uri: song.uri,
            id: song.id,
            newTitle: data.title,
            newDisplayName,
            newArtist: data.artist,
            newAlbum: data.album,
          });
        } catch {
          // Local lock override still applies cleanly even if MediaStore rejects write consent
        }
      }

      setLockedInfoMap((prev) => ({
        ...prev,
        [song.id]: {
          title: data.title,
          artist: data.artist,
          album: data.album,
          notes: data.notes,
          locked: data.locked,
          updatedAt: Date.now(),
        },
      }));
      const nextSongs = songs.map((s) =>
        s.id === song.id
          ? { ...s, title: data.title, artist: data.artist, album: data.album, displayName: newDisplayName }
          : s
      );
      setSongs(nextSongs);
      onSongsLoaded(nextSongs);
      if (currentTrack?.id === song.id) {
        setCurrentTrack((prev) =>
          prev
            ? { ...prev, title: data.title, artist: data.artist, album: data.album, displayName: newDisplayName }
            : prev
        );
      }
      showToast(data.locked ? 'Track info saved & locked' : 'Track info saved');
      setInfoLockModalSong(null);
    } finally {
      setIsSavingLockedInfo(false);
    }
  };

  const handleConfirmRenameSong = async (newTitle: string) => {
    const song = renameModalSong;
    if (!song) return;
    setIsRenamingSong(true);
    try {
      const extMatch = song.displayName.match(/\.[^/.]+$/);
      const ext = extMatch ? extMatch[0] : '.mp3';
      const newDisplayName = newTitle.toLowerCase().endsWith(ext.toLowerCase())
        ? newTitle
        : `${newTitle}${ext}`;

      if (isNativeAndroid() && song.uri && !song.uri.startsWith('blob:')) {
        const res = await AudioLibrary.renameAudioFile({
          uri: song.uri,
          id: song.id,
          newTitle,
          newDisplayName,
        });
        if (res.cancelled) {
          showToast('Rename cancelled');
          return;
        }
      }

      const nextSongs = songs.map((s) =>
        s.id === song.id ? { ...s, title: newTitle, displayName: newDisplayName } : s
      );
      setSongs(nextSongs);
      onSongsLoaded(nextSongs);
      if (currentTrack?.id === song.id) {
        setCurrentTrack((prev) =>
          prev ? { ...prev, title: newTitle, displayName: newDisplayName } : prev
        );
      }
      showToast(`Renamed to "${newTitle}"`);
      setRenameModalSong(null);
    } catch {
      showToast('Could not rename audio file.');
    } finally {
      setIsRenamingSong(false);
    }
  };

  const handleConvertAudio = async (song: AudioTrackItem, format: AudioExportFormat) => {
    setConvertModalSong(null);
    setConvertProgress(5);
    try {
      const buf = await decodeSongBuffer(song);
      setConvertProgress(20);
      const numChannels = Math.min(2, buf.numberOfChannels);
      const left = buf.getChannelData(0);
      const right = numChannels > 1 ? buf.getChannelData(1) : left;

      const blob = await encodeAudioFormatBlob(
        left,
        right,
        buf.length,
        buf.sampleRate,
        numChannels,
        format,
        (pct) => setConvertProgress(20 + Math.round(pct * 0.6))
      );

      const fmt = getAudioFormatOption(format);
      const base = (song.title || song.displayName).replace(/\.[^/.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
      const fileName = `${base}_converted.${fmt.extension}`;
      const { displayPath } = await saveExportedAudioBlob(blob, fileName, (savePct) => {
        setConvertProgress(80 + Math.round(savePct * 0.2));
      });

      if (isNativeAndroid()) {
        void loadDeviceAudios();
      } else {
        const url = URL.createObjectURL(blob);
        webObjectUrlsRef.current.push(url);
        const newTrack: AudioTrackItem = {
          id: `conv-${Date.now()}`,
          title: `${base}_converted`,
          displayName: fileName,
          artist: song.artist || 'Mo Vibe',
          album: song.album || '',
          durationMs: Math.round(buf.duration * 1000),
          size: blob.size,
          mimeType: fmt.mimeType,
          uri: url,
          webUrl: url,
          thumbnailUrl: song.thumbnailUrl,
        };
        setSongs((prev) => [newTrack, ...prev]);
      }

      showToast(`Converted to ${fmt.label} (${displayPath})`);
    } catch (err) {
      console.error('Convert audio failed:', err);
      showToast('Could not convert audio file.');
    } finally {
      setConvertProgress(null);
    }
  };

  const handleOpenTrimModal = async (song: AudioTrackItem) => {
    setTrimModalSong(song);
    setTrimBuffer(null);
    setTrimError(null);
    setIsTrimDecoding(true);
    try {
      const buf = await decodeSongBuffer(song);
      setTrimBuffer(buf);
    } catch {
      setTrimError('Could not decode this audio file for trimming.');
    } finally {
      setIsTrimDecoding(false);
    }
  };

  const handleSaveTrimmedAudio = async (
    startSec: number,
    endSec: number,
    format: AudioExportFormat
  ) => {
    const song = trimModalSong;
    const buf = trimBuffer;
    if (!song || !buf) return;

    setIsTrimSaving(true);
    setTrimSaveProgress(5);
    try {
      const sr = buf.sampleRate;
      const startSample = Math.max(0, Math.floor(startSec * sr));
      const endSample = Math.min(buf.length, Math.ceil(endSec * sr));
      const frameCount = Math.max(1, endSample - startSample);
      const numChannels = Math.min(2, buf.numberOfChannels);
      const left = buf.getChannelData(0).subarray(startSample, endSample);
      const right =
        numChannels > 1 ? buf.getChannelData(1).subarray(startSample, endSample) : left;

      const blob = await encodeAudioFormatBlob(
        left,
        right,
        frameCount,
        sr,
        numChannels,
        format,
        (pct) => setTrimSaveProgress(5 + Math.round(pct * 0.75))
      );

      const fmt = getAudioFormatOption(format);
      const base = (song.title || song.displayName).replace(/\.[^/.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
      const fileName = `${base}_trimmed.${fmt.extension}`;
      const { displayPath } = await saveExportedAudioBlob(blob, fileName, (savePct) => {
        setTrimSaveProgress(80 + Math.round(savePct * 0.2));
      });

      if (isNativeAndroid()) {
        void loadDeviceAudios();
      } else {
        const url = URL.createObjectURL(blob);
        webObjectUrlsRef.current.push(url);
        const trimmedTrack: AudioTrackItem = {
          id: `trim-${Date.now()}`,
          title: `${base}_trimmed`,
          displayName: fileName,
          artist: song.artist || 'Mo Vibe',
          album: song.album || '',
          durationMs: Math.round((frameCount / sr) * 1000),
          size: blob.size,
          mimeType: fmt.mimeType,
          uri: url,
          webUrl: url,
          thumbnailUrl: song.thumbnailUrl,
        };
        setSongs((prev) => [trimmedTrack, ...prev]);
      }

      setTrimModalSong(null);
      setTrimBuffer(null);
      showToast(`Saved trimmed audio to ${displayPath}`);
    } catch {
      setTrimError('Failed to save trimmed audio.');
    } finally {
      setIsTrimSaving(false);
    }
  };

  const handleToggleHideFromPhone = (song: AudioTrackItem) => {
    const currentlyHidden = hiddenIds.includes(song.id) || hiddenIds.includes(song.uri);
    if (currentlyHidden) {
      setHiddenIds((prev) => prev.filter((id) => id !== song.id && id !== song.uri));
      showToast(`Restored "${song.title || song.displayName}" to library`);
    } else {
      stopSongIfPlaying(song);
      setHiddenIds((prev) => [...prev, song.id]);
      showToast(`Hidden "${song.title || song.displayName}". Find it anytime in Hidden tab.`);
    }
  };

  const handleConfirmMoveOrCopy = async (targetFolder: string) => {
    if (!moveCopyState) return;
    const { mode, song } = moveCopyState;
    setIsMovingOrCopying(true);
    try {
      if (isNativeAndroid() && song.uri && !song.uri.startsWith('blob:')) {
        const res = await AudioLibrary.moveOrCopyAudioFile({
          uri: song.uri,
          id: song.id,
          displayName: song.displayName,
          title: song.title,
          artist: song.artist,
          album: song.album,
          durationMs: song.durationMs,
          mimeType: song.mimeType,
          targetFolder,
          mode,
        });
        if (res.success && res.song) {
          if (mode === 'move') {
            setSongs((prev) => [res.song!, ...prev.filter((s) => s.id !== song.id)]);
          } else {
            setSongs((prev) => [res.song!, ...prev]);
          }
          showToast(
            `${mode === 'move' ? 'Moved' : 'Copied'} to ${res.displayPath || targetFolder}`
          );
          setMoveCopyState(null);
          return;
        }
      }

      // Web fallback
      const resp = await fetch(song.webUrl || song.uri);
      const blob = await resp.blob();
      await saveExportedAudioBlob(blob, song.displayName || 'audio.mp3');
      if (mode === 'copy') {
        const copyUrl = URL.createObjectURL(blob);
        webObjectUrlsRef.current.push(copyUrl);
        setSongs((prev) => [
          {
            ...song,
            id: `copy-${Date.now()}`,
            title: `${song.title || song.displayName} (Copy)`,
            uri: copyUrl,
            webUrl: copyUrl,
          },
          ...prev,
        ]);
      }
      showToast(`${mode === 'move' ? 'Moved' : 'Copied'} to ${targetFolder}`);
      setMoveCopyState(null);
    } catch {
      showToast(`Could not ${mode} this audio file.`);
    } finally {
      setIsMovingOrCopying(false);
    }
  };

  const handleMoveToAndroidSecureFolder = async (song: AudioTrackItem) => {
    if (!isNativeAndroid() || !song.uri || song.uri.startsWith('blob:')) {
      showToast('Android Secure Folder is available when running on your Android phone.');
      return;
    }
    try {
      const res = await AudioLibrary.moveToSecureFolder({
        uri: song.uri,
        id: song.id,
        title: song.title || song.displayName,
        displayName: song.displayName,
        mimeType: song.mimeType || 'audio/*',
      });
      if (res.message) {
        showToast(res.message, 4500);
      } else if (res.usedSystemSecureFolder) {
        showToast(`Opened Android Secure Folder for "${song.title || song.displayName}"`);
      } else {
        showToast('Select your phone\'s Secure Folder to move the audio file.');
      }
    } catch {
      showToast('Could not open Android Secure Folder on this device.');
    }
  };

  const handleAddToHomeScreen = async (song: AudioTrackItem) => {
    if (!isNativeAndroid()) {
      showToast('Use your browser menu "Add to Home screen" to pin Mo Vibe on Web.');
      return;
    }
    try {
      const res = await AudioLibrary.pinAudioShortcut({
        id: song.id,
        uri: song.uri,
        title: song.title || song.displayName,
        artist: song.artist || '',
        displayName: song.displayName,
      });
      if (!res.supported) {
        showToast('Your Android launcher does not support pinned shortcuts.');
      } else {
        showToast(`"${song.title || song.displayName}" shortcut requested for your Home screen`);
      }
    } catch {
      showToast('Could not add song shortcut to home screen.');
    }
  };

  const handleThreeDotsAction = (action: AudioMenuActionId, song: AudioTrackItem) => {
    setMenuTrack(null);
    switch (action) {
      case 'add_to_playlist':
        setPlaylistModalSong(song);
        break;
      case 'set_as_ringtone':
        void handleSetAsRingtone(song);
        break;
      case 'add_to_favorites':
        handleToggleFavorite(song);
        break;
      case 'delete':
        setDeleteModalSong(song);
        break;
      case 'share':
        void handleShareSong(song);
        break;
      case 'details':
        void handleOpenDetails(song);
        break;
      case 'add_and_lock_info':
        setInfoLockModalSong(song);
        break;
      case 'convert_audio':
        setConvertModalSong(song);
        break;
      case 'trim':
        void handleOpenTrimModal(song);
        break;
      case 'hide_from_phone':
        handleToggleHideFromPhone(song);
        break;
      case 'rename':
        if (lockedInfoMap[song.id]?.locked) {
          showToast('Track info is locked. Open "Add & lock info" to unlock before renaming.');
          return;
        }
        setRenameModalSong(song);
        break;
      case 'change_key_pitch':
        if (onOpenTrackInStudio) {
          onOpenTrackInStudio(song, 'key');
        } else {
          showToast('Home Studio handler unavailable');
        }
        break;
      case 'tempo':
        if (onOpenTrackInStudio) {
          onOpenTrackInStudio(song, 'tempo');
        } else {
          showToast('Home Studio handler unavailable');
        }
        break;
      case 'move':
        setMoveCopyState({ mode: 'move', song });
        break;
      case 'copy':
        setMoveCopyState({ mode: 'copy', song });
        break;
      case 'move_to_secure_folder':
        void handleMoveToAndroidSecureFolder(song);
        break;
      case 'add_to_home_screen':
        void handleAddToHomeScreen(song);
        break;
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
              <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-semibold shrink-0">
                {isPlaying ? 'Now Playing' : 'Paused'}
              </span>
              {activePlayingPlaylist && (
                <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 truncate flex items-center gap-1 min-w-0">
                  <span>·</span>
                  <ListMusic className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="truncate">{activePlayingPlaylist.name}</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setMenuTrack(currentTrack)}
                className="min-w-[40px] min-h-[40px] rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-950 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                title="Track Options"
                aria-label="Track Options"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

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
                  {libraryFilter === 'playlists' && !selectedPlaylistId
                    ? `${playlists.length} ${playlists.length === 1 ? 'playlist' : 'playlists'} · Open a folder to play only its songs`
                    : `${filteredSongs.length} ${filteredSongs.length === 1 ? 'song' : 'songs'} · Tap any song to play`}
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
          {/* Library Category Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'favorites', label: `Favorites (${favoriteIds.length})` },
                { id: 'playlists', label: `Playlists (${playlists.length})` },
                { id: 'hidden', label: `Hidden (${hiddenIds.length})` },
              ] as Array<{ id: LibraryFilterTab; label: string }>
            ).map((tab) => {
              const active = libraryFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setLibraryFilter(tab.id);
                    if (tab.id === 'playlists') {
                      setSelectedPlaylistId(null);
                      setIsCreatePlaylistOpen(false);
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

          {convertProgress !== null && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                <span>Converting audio...</span>
                <span className="font-mono">{convertProgress}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-emerald-500/20 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${convertProgress}%` }}
                />
              </div>
            </div>
          )}

          {actionToast && (
            <div className="px-3.5 py-2.5 rounded-xl bg-emerald-500/12 border border-emerald-500/35 text-emerald-800 dark:text-emerald-300 text-xs font-medium flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span className="truncate">{actionToast}</span>
              </span>
              <button
                type="button"
                onClick={() => setActionToast(null)}
                className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Special View: Playlists */}
        {libraryFilter === 'playlists' && !selectedPlaylistId ? (
          <div className="p-4 space-y-3">
            {/* Create Playlist Button -> reveals name input box only when clicked */}
            {!isCreatePlaylistOpen ? (
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setIsCreatePlaylistOpen(true)}
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
                  value={newPlaylistNameInput}
                  onChange={(e) => setNewPlaylistNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreatePlaylistDirect();
                    if (e.key === 'Escape') {
                      setIsCreatePlaylistOpen(false);
                      setNewPlaylistNameInput('');
                    }
                  }}
                  autoFocus
                  placeholder="Write playlist name (e.g. Gospel, World)..."
                  className="flex-1 min-h-[44px] bg-slate-50 dark:bg-slate-950 border border-emerald-500/60 focus:border-emerald-500 rounded-xl px-3.5 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleCreatePlaylistDirect}
                  disabled={!newPlaylistNameInput.trim()}
                  className="min-h-[44px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white dark:text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
                >
                  <Check className="w-4 h-4" />
                  <span>Save</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatePlaylistOpen(false);
                    setNewPlaylistNameInput('');
                  }}
                  className="min-h-[44px] min-w-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center cursor-pointer shrink-0 transition-colors"
                  aria-label="Cancel creating playlist"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {playlists.length === 0 ? (
              <div className="py-9 text-center space-y-2">
                <ListMusic className="w-10 h-10 text-slate-400 dark:text-slate-700 mx-auto" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  No Playlists Created Yet
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                  Tap + Create to organize and play songs strictly inside your own playlist folder.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {playlists.map((pl) => {
                  const availableCount = pl.trackIds.filter((tid) =>
                    nonHiddenSongs.some((s) => s.id === tid)
                  ).length;
                  const isThisPlaying =
                    playbackScope.type === 'playlist' &&
                    playbackScope.playlistId === pl.id &&
                    Boolean(currentTrack);
                  const isRenamingThis = renamingPlaylistId === pl.id;

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
                            value={renamingPlaylistDraft}
                            onChange={(e) => setRenamingPlaylistDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && renamingPlaylistDraft.trim()) {
                                const trimmed = renamingPlaylistDraft.trim();
                                setPlaylists((prev) =>
                                  prev.map((item) =>
                                    item.id === pl.id ? { ...item, name: trimmed } : item
                                  )
                                );
                                setRenamingPlaylistId(null);
                              }
                            }}
                            autoFocus
                            className="flex-1 min-h-[38px] bg-white dark:bg-slate-900 border border-emerald-500 rounded-lg px-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const trimmed = renamingPlaylistDraft.trim();
                              if (!trimmed) return;
                              setPlaylists((prev) =>
                                prev.map((item) =>
                                  item.id === pl.id ? { ...item, name: trimmed } : item
                                )
                              );
                              setRenamingPlaylistId(null);
                            }}
                            className="p-2 rounded-lg bg-emerald-500 text-white cursor-pointer"
                            aria-label="Save playlist name"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingPlaylistId(null)}
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
                            onClick={() => setSelectedPlaylistId(pl.id)}
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
                                {availableCount} {availableCount === 1 ? 'song' : 'songs'}
                                {isThisPlaying ? ' · Playing folder' : ''}
                              </div>
                            </div>
                          </button>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handlePlayPlaylistFolder(pl.id)}
                              className="w-9 h-9 rounded-lg bg-emerald-500/12 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 flex items-center justify-center cursor-pointer"
                              title={`Play "${pl.name}" folder`}
                              aria-label={`Play playlist ${pl.name}`}
                            >
                              <Play className="w-4 h-4 fill-current ml-0.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingPlaylistId(pl.id);
                                setRenamingPlaylistDraft(pl.name);
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
                                setPlaylists((prev) => prev.filter((item) => item.id !== pl.id));
                                if (selectedPlaylistId === pl.id) {
                                  setSelectedPlaylistId(null);
                                }
                                if (
                                  playbackScopeRef.current.type === 'playlist' &&
                                  playbackScopeRef.current.playlistId === pl.id
                                ) {
                                  playbackScopeRef.current = { type: 'all' };
                                  setPlaybackScope({ type: 'all' });
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
        ) : (
          <div>
            {libraryFilter === 'playlists' && selectedPlaylistId && currentOpenPlaylist && (
              <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950 border-b border-slate-200/80 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => setSelectedPlaylistId(null)}
                    className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer shrink-0"
                  >
                    &larr; Playlists
                  </button>
                  <span className="text-slate-300 dark:text-slate-700">|</span>
                  <div className="min-w-0">
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate block">
                      {currentOpenPlaylist.name}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setAddSongsModalPlaylistId(currentOpenPlaylist.id)}
                    className="min-h-[36px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-500/50 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <ListPlus className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Add Songs</span>
                  </button>

                  {visibleBaseSongs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handlePlayPlaylistFolder(currentOpenPlaylist.id)}
                      className="min-h-[36px] px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white dark:text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Play Folder</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {filteredSongs.length === 0 ? (
              <div className="py-12 px-6 text-center space-y-3">
                <Music className="w-10 h-10 text-slate-400 dark:text-slate-700 mx-auto" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {libraryFilter === 'playlists' && selectedPlaylistId
                    ? `No songs in "${currentOpenPlaylist?.name || 'Playlist'}" yet`
                    : songs.length === 0
                    ? 'No audio files loaded yet'
                    : libraryFilter === 'favorites'
                    ? 'No favorite songs yet'
                    : libraryFilter === 'hidden'
                    ? 'No hidden songs'
                    : 'No matching audio files'}
                </p>
                {libraryFilter === 'playlists' && selectedPlaylistId && currentOpenPlaylist && (
                  <button
                    type="button"
                    onClick={() => setAddSongsModalPlaylistId(currentOpenPlaylist.id)}
                    className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 dark:bg-emerald-400 dark:hover:bg-emerald-300 text-white dark:text-slate-950 text-xs font-bold inline-flex items-center gap-2 cursor-pointer transition-colors"
                  >
                    <ListPlus className="w-4 h-4" />
                    <span>Add Songs to {currentOpenPlaylist.name}</span>
                  </button>
                )}
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
                  const isFav = favoriteIds.includes(song.id);
                  const isLocked = Boolean(lockedInfoMap[song.id]?.locked);
                  return (
                    <div
                      key={song.id}
                      className={`w-full min-h-[60px] pl-4 pr-2 py-2.5 flex items-center justify-between gap-2 transition-colors ${
                        isSelected ? 'bg-emerald-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (libraryFilter === 'playlists' && selectedPlaylistId) {
                            void playTrack(song, {
                              type: 'playlist',
                              playlistId: selectedPlaylistId,
                            });
                          } else {
                            void playTrack(song);
                          }
                        }}
                        className="flex items-center justify-between gap-3 flex-1 min-w-0 text-left cursor-pointer"
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
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p
                                className={`text-sm font-semibold truncate ${
                                  isSelected ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-900 dark:text-slate-100'
                                }`}
                              >
                                {song.title || song.displayName}
                              </p>
                              {isFav && (
                                <Heart className="w-3 h-3 text-rose-500 fill-rose-500 shrink-0" />
                              )}
                              {isLocked && (
                                <Lock className="w-3 h-3 text-amber-500 shrink-0" />
                              )}
                            </div>
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

                      {libraryFilter === 'hidden' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleHideFromPhone(song);
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1 cursor-pointer shrink-0"
                          title="Unhide song"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Unhide</span>
                        </button>
                      )}

                      {libraryFilter === 'playlists' && selectedPlaylistId && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveTrackFromPlaylist(selectedPlaylistId, song.id);
                          }}
                          className="w-9 h-9 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-400 hover:text-red-500 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                          title="Remove from playlist"
                          aria-label={`Remove ${song.title || song.displayName} from playlist`}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}

                      {/* VLC-style 3-Dots Menu Trigger */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuTrack(song);
                        }}
                        className="w-10 h-10 rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                        title="Song options"
                        aria-label={`Options for ${song.title || song.displayName}`}
                      >
                        <MoreVertical className="w-5 h-5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* VLC-Style 3-Dots Bottom Sheet with all 17 sections */}
      <AudioThreeDotsMenuSheet
        song={menuTrack}
        isFavorite={menuTrack ? favoriteIds.includes(menuTrack.id) : false}
        isHidden={menuTrack ? hiddenIds.includes(menuTrack.id) || hiddenIds.includes(menuTrack.uri) : false}
        isInfoLocked={menuTrack ? Boolean(lockedInfoMap[menuTrack.id]?.locked) : false}
        onClose={() => setMenuTrack(null)}
        onAction={handleThreeDotsAction}
      />

      {/* Add to Playlist Modal */}
      <AudioPlaylistModal
        song={playlistModalSong}
        playlists={playlists}
        onClose={() => setPlaylistModalSong(null)}
        onToggleTrackInPlaylist={(playlistId, trackId) => {
          setPlaylists((prev) =>
            prev.map((pl) => {
              if (pl.id !== playlistId) return pl;
              const exists = pl.trackIds.includes(trackId);
              return {
                ...pl,
                trackIds: exists
                  ? pl.trackIds.filter((id) => id !== trackId)
                  : [...pl.trackIds, trackId],
              };
            })
          );
        }}
        onCreatePlaylist={(name, initialTrackId) => {
          const newPl: AudioPlaylist = {
            id: `pl-${Date.now()}`,
            name,
            trackIds: initialTrackId ? [initialTrackId] : [],
            createdAt: Date.now(),
          };
          setPlaylists((prev) => [newPl, ...prev]);
          showToast(`Created playlist "${name}"`);
        }}
      />

      {/* Delete Confirmation Modal */}
      <AudioDeleteConfirmModal
        song={deleteModalSong}
        isBusy={isDeletingSong}
        onClose={() => setDeleteModalSong(null)}
        onConfirm={() => void handleConfirmDeleteSong()}
      />

      {/* Details Modal */}
      <AudioDetailsModal
        details={detailsSnapshot}
        lockedInfo={detailsSongId ? lockedInfoMap[detailsSongId] : undefined}
        onClose={() => {
          setDetailsSnapshot(null);
          setDetailsSongId(null);
        }}
      />

      {/* Add & Lock Info Modal */}
      <AudioAddLockInfoModal
        song={infoLockModalSong}
        existingInfo={infoLockModalSong ? lockedInfoMap[infoLockModalSong.id] : undefined}
        isBusy={isSavingLockedInfo}
        onClose={() => setInfoLockModalSong(null)}
        onSave={(data) => void handleSaveLockedInfo(data)}
      />

      {/* Rename Modal */}
      <AudioRenameModal
        song={renameModalSong}
        isBusy={isRenamingSong}
        onClose={() => setRenameModalSong(null)}
        onConfirm={(newName) => void handleConfirmRenameSong(newName)}
      />

      {/* Convert Audio Format Modal */}
      <ExportFormatModal
        isOpen={Boolean(convertModalSong)}
        title="Convert Audio"
        subtitle={convertModalSong ? convertModalSong.title || convertModalSong.displayName : ''}
        durationSec={convertModalSong ? convertModalSong.durationMs / 1000 : 0}
        sampleRate={44100}
        onClose={() => setConvertModalSong(null)}
        onSelectFormat={(format) => {
          if (convertModalSong) {
            void handleConvertAudio(convertModalSong, format);
          }
        }}
      />

      {/* Trim Audio Modal */}
      <AudioTrimModal
        song={trimModalSong}
        buffer={trimBuffer}
        isDecoding={isTrimDecoding}
        isSaving={isTrimSaving}
        saveProgress={trimSaveProgress}
        error={trimError}
        onClose={() => {
          setTrimModalSong(null);
          setTrimBuffer(null);
        }}
        onSaveTrim={(s, e, fmt) => void handleSaveTrimmedAudio(s, e, fmt)}
      />

      {/* Move / Copy Modal */}
      <AudioMoveCopyModal
        mode={moveCopyState?.mode ?? null}
        song={moveCopyState?.song ?? null}
        isBusy={isMovingOrCopying}
        onClose={() => setMoveCopyState(null)}
        onConfirm={(folder) => void handleConfirmMoveOrCopy(folder)}
      />

      {/* Batch Add Songs to Playlist Folder Modal */}
      <PlaylistAddSongsModal
        playlist={
          addSongsModalPlaylistId
            ? playlists.find((p) => p.id === addSongsModalPlaylistId) ?? null
            : null
        }
        songs={nonHiddenSongs}
        onClose={() => setAddSongsModalPlaylistId(null)}
        onSavePlaylistTracks={(playlistId, trackIds) => {
          setPlaylists((prev) =>
            prev.map((pl) => (pl.id === playlistId ? { ...pl, trackIds } : pl))
          );
          const plName = playlists.find((p) => p.id === playlistId)?.name || 'playlist';
          showToast(`Updated "${plName}" (${trackIds.length} ${trackIds.length === 1 ? 'song' : 'songs'})`);
        }}
      />
    </div>
  );
};
