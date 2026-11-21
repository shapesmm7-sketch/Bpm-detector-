import React, { useEffect, useRef, useState } from 'react';
import { AudioTrackItem } from '../plugins/audioLibrary';
import { AudioArtwork } from './AudioArtwork';
import {
  AUDIO_EXPORT_FORMATS,
  AudioExportFormat,
} from '../utils/audioEncoders';
import {
  Bell,
  Check,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Folder,
  FolderInput,
  FolderOpen,
  Gauge,
  Heart,
  ImagePlus,
  Info,
  ListMusic,
  ListPlus,
  Lock,
  Music,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  Search,
  Share2,
  Shield,
  Sliders,
  Smartphone,
  Square,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';

export interface AudioPlaylist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

export interface LockedTrackInfo {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  grouping?: string;
  composer?: string;
  comments?: string;
  notes?: string;
  genre?: string;
  year?: string;
  trackNumber?: string;
  trackTotal?: string;
  discNumber?: string;
  discTotal?: string;
  bpm?: string;
  partOfCompilation?: boolean;
  artworkDataUrl?: string;
  locked: boolean;
  updatedAt: number;
}

export interface AudioDetailsSnapshot {
  title: string;
  displayName: string;
  artist: string;
  album: string;
  durationMs: number;
  size: number;
  mimeType: string;
  bitrateKbps?: number;
  sampleRateHz?: number;
  folderPath?: string;
  isLoading: boolean;
}

export type AudioMenuActionId =
  | 'add_to_playlist'
  | 'set_as_ringtone'
  | 'add_to_favorites'
  | 'delete'
  | 'share'
  | 'details'
  | 'add_and_lock_info'
  | 'convert_audio'
  | 'trim'
  | 'hide_from_phone'
  | 'rename'
  | 'change_key_pitch'
  | 'tempo'
  | 'move'
  | 'copy'
  | 'move_to_secure_folder'
  | 'add_to_home_screen';

function formatClock(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const mins = Math.floor(sec / 60);
  const secs = Math.floor(sec % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatPreciseClock(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00.0';
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${mins}:${rem < 10 ? '0' : ''}${rem.toFixed(1)}`;
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return 'Unknown';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(2)} MB` : `${Math.round(bytes / 1024)} KB`;
}

interface ThreeDotsMenuProps {
  song: AudioTrackItem | null;
  isFavorite: boolean;
  isHidden: boolean;
  isInfoLocked: boolean;
  onClose: () => void;
  onAction: (action: AudioMenuActionId, song: AudioTrackItem) => void;
}

export const AudioThreeDotsMenuSheet: React.FC<ThreeDotsMenuProps> = ({
  song,
  isFavorite,
  isHidden,
  isInfoLocked,
  onClose,
  onAction,
}) => {
  if (!song) return null;

  const items: Array<{
    id: AudioMenuActionId;
    label: string;
    subtitle?: string;
    icon: React.ReactNode;
    danger?: boolean;
    highlight?: boolean;
  }> = [
    {
      id: 'add_to_playlist',
      label: 'Add to Playlist',
      icon: <ListPlus className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
    },
    {
      id: 'set_as_ringtone',
      label: 'Set as ringtone',
      icon: <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
    },
    {
      id: 'add_to_favorites',
      label: isFavorite ? 'Favorited' : 'Add to favorites',
      icon: (
        <Heart
          className={`w-4 h-4 ${
            isFavorite
              ? 'text-rose-500 fill-rose-500'
              : 'text-rose-500 dark:text-rose-400'
          }`}
        />
      ),
      highlight: isFavorite,
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 className="w-4 h-4 text-red-500 dark:text-red-400" />,
      danger: true,
    },
    {
      id: 'share',
      label: 'Share',
      icon: <Share2 className="w-4 h-4 text-sky-600 dark:text-sky-400" />,
    },
    {
      id: 'details',
      label: 'Details',
      icon: <Info className="w-4 h-4 text-slate-600 dark:text-slate-300" />,
    },
    {
      id: 'add_and_lock_info',
      label: isInfoLocked ? 'Info locked' : 'Add & lock info',
      icon: isInfoLocked ? (
        <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
      ) : (
        <Unlock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
      ),
      highlight: isInfoLocked,
    },
    {
      id: 'convert_audio',
      label: 'Convert audio',
      icon: <RefreshCw className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />,
    },
    {
      id: 'trim',
      label: 'Trim',
      icon: <Scissors className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
    },
    {
      id: 'hide_from_phone',
      label: isHidden ? 'Unhide from phone' : 'Hide from phone',
      icon: isHidden ? (
        <Eye className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <EyeOff className="w-4 h-4 text-slate-600 dark:text-slate-400" />
      ),
    },
    {
      id: 'rename',
      label: 'Rename',
      icon: <Pencil className="w-4 h-4 text-slate-600 dark:text-slate-300" />,
    },
    {
      id: 'change_key_pitch',
      label: 'Change key/pitch',
      icon: <Sliders className="w-4 h-4 text-violet-600 dark:text-violet-400" />,
    },
    {
      id: 'tempo',
      label: 'Tempo',
      icon: <Gauge className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
    },
    {
      id: 'move',
      label: 'Move',
      icon: <FolderInput className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
    },
    {
      id: 'copy',
      label: 'Copy',
      icon: <Copy className="w-4 h-4 text-sky-600 dark:text-sky-400" />,
    },
    {
      id: 'move_to_secure_folder',
      label: 'Move to Secure folder',
      icon: <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
    },
    {
      id: 'add_to_home_screen',
      label: 'Add to home screen',
      icon: <Smartphone className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/55 dark:bg-slate-950/80 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-md max-h-[94vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Compact Header with Song Summary */}
        <div className="flex items-center justify-between gap-2.5 px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shrink-0">
              <AudioArtwork song={song} className="w-full h-full" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                {song.title || song.displayName}
              </h3>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                {song.artist}
                {song.durationMs > 0 ? ` · ${formatClock(song.durationMs / 1000)}` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-w-[34px] min-h-[34px] rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer shrink-0"
            aria-label="Close track options"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* All 17 Features Grid — visible together without scrolling on Android */}
        <div className="overflow-y-auto p-2.5 grid grid-cols-2 gap-1.5">
          {items.map((item, idx) => {
            const isFullWidthLast = idx === items.length - 1 && items.length % 2 === 1;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onAction(item.id, song)}
                className={`min-h-[40px] px-2.5 py-1.5 rounded-xl border flex items-center gap-2 text-left transition-colors cursor-pointer ${
                  isFullWidthLast ? 'col-span-2 justify-center' : ''
                } ${
                  item.danger
                    ? 'bg-red-50/70 hover:bg-red-100/80 dark:bg-red-950/25 dark:hover:bg-red-950/45 border-red-200/80 dark:border-red-900/60 text-red-600 dark:text-red-400'
                    : item.highlight
                    ? 'bg-emerald-500/10 hover:bg-emerald-500/15 border-emerald-500/40 text-emerald-800 dark:text-emerald-200'
                    : 'bg-slate-50/80 hover:bg-slate-100 dark:bg-slate-950/80 dark:hover:bg-slate-800 border-slate-200/80 dark:border-slate-800 text-slate-800 dark:text-slate-100'
                }`}
              >
                <div className="w-7 h-7 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 flex items-center justify-center shrink-0">
                  {item.icon}
                </div>
                <span className="text-[12px] font-semibold leading-tight break-words min-w-0">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* ---------------- Playlist Modal ---------------- */
interface PlaylistModalProps {
  song: AudioTrackItem | null;
  playlists: AudioPlaylist[];
  onClose: () => void;
  onSaveTrackPlaylists: (trackId: string, selectedPlaylistIds: string[]) => void;
  onCreatePlaylist: (name: string, initialTrackId?: string) => string | void;
}

export const AudioPlaylistModal: React.FC<PlaylistModalProps> = ({
  song,
  playlists,
  onClose,
  onSaveTrackPlaylists,
  onCreatePlaylist,
}) => {
  const [showNameBox, setShowNameBox] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<string[]>([]);
  const knownPlaylistIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setShowNameBox(false);
    setNewName('');
    if (song) {
      setSelectedPlaylistIds(
        playlists.filter((pl) => pl.trackIds.includes(song.id)).map((pl) => pl.id)
      );
      knownPlaylistIdsRef.current = new Set(playlists.map((pl) => pl.id));
    } else {
      setSelectedPlaylistIds([]);
      knownPlaylistIdsRef.current = new Set();
    }
    // Initialize selection when modal opens for a song
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id]);

  // Auto-check any brand-new playlist created while this modal is open
  useEffect(() => {
    if (!song) return;
    const newlyAdded = playlists.filter((pl) => !knownPlaylistIdsRef.current.has(pl.id));
    if (newlyAdded.length > 0) {
      newlyAdded.forEach((pl) => knownPlaylistIdsRef.current.add(pl.id));
      const autoCheckIds = newlyAdded
        .filter((pl) => pl.trackIds.includes(song.id))
        .map((pl) => pl.id);
      if (autoCheckIds.length > 0) {
        setSelectedPlaylistIds((prev) => Array.from(new Set([...prev, ...autoCheckIds])));
      }
    }
  }, [playlists, song]);

  if (!song) return null;

  const togglePlaylistSelection = (playlistId: string) => {
    setSelectedPlaylistIds((prev) =>
      prev.includes(playlistId)
        ? prev.filter((id) => id !== playlistId)
        : [...prev, playlistId]
    );
  };

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const createdId = onCreatePlaylist(trimmed, song.id);
    if (typeof createdId === 'string' && createdId) {
      knownPlaylistIdsRef.current.add(createdId);
      setSelectedPlaylistIds((prev) =>
        prev.includes(createdId) ? prev : [...prev, createdId]
      );
    }
    setNewName('');
    setShowNameBox(false);
  };

  const handleDone = () => {
    onSaveTrackPlaylists(song.id, selectedPlaylistIds);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-md max-h-[82vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <ListPlus className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Add to Playlist
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {song.title || song.displayName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[38px] min-h-[38px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {!showNameBox ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Select playlist {playlists.length === 1 ? 'folder' : 'folders'}
              </span>
              <button
                type="button"
                onClick={() => setShowNameBox(true)}
                className="min-h-[40px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white dark:text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Create</span>
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') {
                    setShowNameBox(false);
                    setNewName('');
                  }
                }}
                autoFocus
                placeholder="Write playlist name..."
                className="flex-1 min-h-[42px] bg-slate-50 dark:bg-slate-950 border border-emerald-500/60 focus:border-emerald-500 rounded-xl px-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="min-h-[42px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white dark:text-slate-950 text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Save</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNameBox(false);
                  setNewName('');
                }}
                className="min-h-[42px] min-w-[42px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {playlists.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-4">
              No playlists yet. Tap + Create to make one.
            </p>
          ) : (
            <div className="space-y-2">
              {playlists.map((pl) => {
                const originallyInList = pl.trackIds.includes(song.id);
                const inList = selectedPlaylistIds.includes(pl.id);
                const displayedCount =
                  pl.trackIds.length + (inList === originallyInList ? 0 : inList ? 1 : -1);
                return (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => togglePlaylistSelection(pl.id)}
                    className={`w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-3 text-left cursor-pointer transition-colors ${
                      inList
                        ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-800 dark:text-emerald-200'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{pl.name}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {displayedCount} {displayedCount === 1 ? 'song' : 'songs'}
                      </div>
                    </div>
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                        inList
                          ? 'bg-emerald-500 text-white'
                          : 'border border-slate-300 dark:border-slate-700'
                      }`}
                    >
                      {inList && <Check className="w-3.5 h-3.5" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 shrink-0 bg-white dark:bg-slate-900">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDone}
            className="min-h-[42px] px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white dark:text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>
              {selectedPlaylistIds.length > 0
                ? `Done (${selectedPlaylistIds.length})`
                : 'Done'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------------- Delete Confirm Modal ---------------- */
interface DeleteConfirmModalProps {
  song: AudioTrackItem | null;
  isBusy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const AudioDeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  song,
  isBusy,
  onClose,
  onConfirm,
}) => {
  if (!song) return null;
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
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/15 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
            <Trash2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Delete Audio File?
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {song.title || song.displayName}
            </p>
          </div>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          This will permanently remove <span className="font-semibold">{song.displayName}</span> from your device storage.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            className="min-h-[40px] px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onConfirm}
            className="min-h-[40px] px-4 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
          >
            {isBusy ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------------- Details Modal ---------------- */
interface DetailsModalProps {
  details: AudioDetailsSnapshot | null;
  lockedInfo?: LockedTrackInfo;
  onClose: () => void;
}

export const AudioDetailsModal: React.FC<DetailsModalProps> = ({
  details,
  lockedInfo,
  onClose,
}) => {
  if (!details) return null;

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Title', value: details.title || details.displayName },
    { label: 'File Name', value: details.displayName },
    { label: 'Artist', value: details.artist || 'Unknown Artist' },
    { label: 'Album', value: details.album || '—' },
    {
      label: 'Duration',
      value: details.durationMs > 0 ? formatClock(details.durationMs / 1000) : '—',
    },
    { label: 'File Size', value: formatFileSize(details.size) },
    { label: 'Format / MIME', value: details.mimeType || 'audio/*' },
    {
      label: 'Bitrate',
      value: details.bitrateKbps ? `${details.bitrateKbps} kbps` : '—',
    },
    {
      label: 'Sample Rate',
      value: details.sampleRateHz ? `${details.sampleRateHz} Hz` : '—',
    },
    { label: 'Folder', value: details.folderPath || 'Phone Storage' },
    {
      label: 'Info Lock',
      value: lockedInfo?.locked ? 'Locked' : 'Unlocked',
    },
  ];
  if (lockedInfo?.albumArtist) rows.push({ label: 'Album Artist', value: lockedInfo.albumArtist });
  if (lockedInfo?.year) rows.push({ label: 'Year', value: lockedInfo.year });
  if (lockedInfo?.genre) rows.push({ label: 'Genre', value: lockedInfo.genre });
  if (lockedInfo?.bpm) rows.push({ label: 'BPM', value: lockedInfo.bpm });
  if (lockedInfo?.trackNumber || lockedInfo?.trackTotal) {
    rows.push({
      label: 'Track Number',
      value: `${lockedInfo.trackNumber || '—'}${lockedInfo.trackTotal ? ` of ${lockedInfo.trackTotal}` : ''}`,
    });
  }
  if (lockedInfo?.discNumber || lockedInfo?.discTotal) {
    rows.push({
      label: 'Disc Number',
      value: `${lockedInfo.discNumber || '—'}${lockedInfo.discTotal ? ` of ${lockedInfo.discTotal}` : ''}`,
    });
  }
  if (lockedInfo?.grouping) rows.push({ label: 'Grouping', value: lockedInfo.grouping });
  if (lockedInfo?.composer) rows.push({ label: 'Composer', value: lockedInfo.composer });
  if (lockedInfo?.partOfCompilation) rows.push({ label: 'Compilation', value: 'Yes' });
  const commentText = lockedInfo?.comments || lockedInfo?.notes;
  if (commentText) {
    rows.push({ label: 'Comments', value: commentText });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-md max-h-[82vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Info className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Audio Details
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[38px] min-h-[38px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
          {details.isLoading && (
            <div className="pb-2 text-emerald-600 dark:text-emerald-400 font-mono">
              Reading audio codec metadata...
            </div>
          )}
          {rows.map((r) => (
            <div key={r.label} className="py-2.5 flex items-start justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400 font-medium shrink-0">
                {r.label}
              </span>
              <span className="text-slate-900 dark:text-slate-100 font-semibold text-right break-all">
                {r.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ---------------- Add & Lock Info Modal ---------------- */
export interface AddLockInfoSavePayload {
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  grouping: string;
  composer: string;
  comments: string;
  genre: string;
  year: string;
  trackNumber: string;
  trackTotal: string;
  discNumber: string;
  discTotal: string;
  bpm: string;
  partOfCompilation: boolean;
  artworkDataUrl?: string;
  removeCustomArtwork?: boolean;
  locked: boolean;
}

const GENRE_SUGGESTIONS = [
  'Afrobeat',
  'Gospel',
  'R&B',
  'Hip-Hop',
  'Pop',
  'Dancehall',
  'Reggae',
  'Electronic',
  'House',
  'Acoustic',
  'Jazz',
  'Rock',
  'Classical',
  'Instrumental',
  'Podcast',
];

async function compressUploadedArtworkFile(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Invalid image file'));
      el.src = objectUrl;
    });

    const maxDim = 512;
    const scale = Math.min(1, maxDim / Math.max(img.width || maxDim, img.height || maxDim));
    const targetW = Math.max(1, Math.round((img.width || maxDim) * scale));
    const targetH = Math.max(1, Math.round((img.height || maxDim) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0, targetW, targetH);
      return canvas.toDataURL('image/jpeg', 0.86);
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Could not read artwork file'));
    reader.readAsDataURL(file);
  });
}

interface AddLockInfoModalProps {
  song: AudioTrackItem | null;
  existingInfo?: LockedTrackInfo;
  isBusy: boolean;
  onClose: () => void;
  onSave: (data: AddLockInfoSavePayload) => void;
}

export const AudioAddLockInfoModal: React.FC<AddLockInfoModalProps> = ({
  song,
  existingInfo,
  isBusy,
  onClose,
  onSave,
}) => {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [albumArtist, setAlbumArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [grouping, setGrouping] = useState('');
  const [composer, setComposer] = useState('');
  const [comments, setComments] = useState('');
  const [genre, setGenre] = useState('');
  const [year, setYear] = useState('');
  const [trackNumber, setTrackNumber] = useState('');
  const [trackTotal, setTrackTotal] = useState('');
  const [discNumber, setDiscNumber] = useState('');
  const [discTotal, setDiscTotal] = useState('');
  const [bpm, setBpm] = useState('');
  const [partOfCompilation, setPartOfCompilation] = useState(false);
  const [artworkDataUrl, setArtworkDataUrl] = useState<string | undefined>(undefined);
  const [removeCustomArtwork, setRemoveCustomArtwork] = useState(false);
  const [isProcessingArtwork, setIsProcessingArtwork] = useState(false);
  const [artworkError, setArtworkError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const artworkInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!song) return;
    setTitle(existingInfo?.title ?? song.title ?? '');
    setArtist(existingInfo?.artist ?? song.artist ?? '');
    setAlbumArtist(existingInfo?.albumArtist ?? '');
    setAlbum(existingInfo?.album ?? song.album ?? '');
    setGrouping(existingInfo?.grouping ?? '');
    setComposer(existingInfo?.composer ?? '');
    setComments(existingInfo?.comments ?? existingInfo?.notes ?? '');
    setGenre(existingInfo?.genre ?? '');
    setYear(existingInfo?.year ?? '');
    setTrackNumber(existingInfo?.trackNumber ?? '');
    setTrackTotal(existingInfo?.trackTotal ?? '');
    setDiscNumber(existingInfo?.discNumber ?? '');
    setDiscTotal(existingInfo?.discTotal ?? '');
    setBpm(existingInfo?.bpm ?? '');
    setPartOfCompilation(Boolean(existingInfo?.partOfCompilation));
    setArtworkDataUrl(existingInfo?.artworkDataUrl);
    setRemoveCustomArtwork(false);
    setArtworkError(null);
    setLocked(Boolean(existingInfo?.locked));
  }, [song, existingInfo]);

  if (!song) return null;

  const isCurrentlyLocked = Boolean(existingInfo?.locked) && locked;
  const previewSong: AudioTrackItem = artworkDataUrl
    ? { ...song, thumbnailUrl: artworkDataUrl }
    : removeCustomArtwork
    ? { ...song, thumbnailUrl: undefined }
    : song;

  const handleArtworkFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setArtworkError(null);
    setIsProcessingArtwork(true);
    try {
      const compressed = await compressUploadedArtworkFile(file);
      if (!compressed) {
        setArtworkError('Could not load selected artwork image.');
        return;
      }
      setArtworkDataUrl(compressed);
      setRemoveCustomArtwork(false);
    } catch {
      setArtworkError('Unsupported image file. Try PNG, JPG, or WebP.');
    } finally {
      setIsProcessingArtwork(false);
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
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            {locked ? (
              <Lock className="w-5 h-5 text-amber-500" />
            ) : (
              <Unlock className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            )}
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Add &amp; lock info
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="min-w-[38px] min-h-[38px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto text-xs flex-1">
          {/* Song Artwork Upload Section */}
          <div className="flex items-center gap-3.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="w-16 h-16 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shrink-0 bg-slate-200 dark:bg-slate-900">
              <AudioArtwork song={previewSong} className="w-full h-full" />
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="font-bold text-slate-900 dark:text-slate-100">
                Song Artwork / Thumbnail
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Uploaded artwork updates this song&apos;s thumbnail immediately.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={artworkInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handleArtworkFileChange(e)}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isCurrentlyLocked || isProcessingArtwork}
                  onClick={() => artworkInputRef.current?.click()}
                  className="min-h-[32px] px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white dark:text-slate-950 font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>
                    {isProcessingArtwork
                      ? 'Loading...'
                      : artworkDataUrl
                      ? 'Change Artwork'
                      : 'Upload Artwork'}
                  </span>
                </button>
                {(artworkDataUrl || existingInfo?.artworkDataUrl) && !removeCustomArtwork && (
                  <button
                    type="button"
                    disabled={isCurrentlyLocked}
                    onClick={() => {
                      setArtworkDataUrl(undefined);
                      setRemoveCustomArtwork(true);
                    }}
                    className="min-h-[32px] px-2.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Reset</span>
                  </button>
                )}
              </div>
              {artworkError && (
                <p className="text-[11px] text-red-600 dark:text-red-400 font-medium">
                  {artworkError}
                </p>
              )}
            </div>
          </div>

          {/* Lock Info Protection Card */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div>
              <div className="font-bold text-slate-900 dark:text-slate-100">
                {locked ? 'Track Info Locked' : 'Lock Info Protection'}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {locked
                  ? 'Unlock to edit song details or artwork.'
                  : 'Prevent accidental renames or tag changes.'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLocked((v) => !v)}
              className={`min-h-[36px] px-3 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer ${
                locked
                  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40'
                  : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40'
              }`}
            >
              {locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              <span>{locked ? 'Unlock' : 'Lock'}</span>
            </button>
          </div>

          {/* Name */}
          <label className="block space-y-1">
            <span className="font-semibold text-slate-600 dark:text-slate-300">Name</span>
            <input
              type="text"
              value={title}
              disabled={isCurrentlyLocked}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Song name"
              className="w-full min-h-[38px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
            />
          </label>

          {/* Artist + Year */}
          <div className="grid grid-cols-12 gap-2.5">
            <label className="col-span-8 space-y-1">
              <span className="font-semibold text-slate-600 dark:text-slate-300">Artist</span>
              <input
                type="text"
                value={artist}
                disabled={isCurrentlyLocked}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="Artist name"
                className="w-full min-h-[38px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
              />
            </label>
            <label className="col-span-4 space-y-1">
              <span className="font-semibold text-slate-600 dark:text-slate-300">Year</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={year}
                disabled={isCurrentlyLocked}
                onChange={(e) => setYear(e.target.value)}
                placeholder="2026"
                className="w-full min-h-[38px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
              />
            </label>
          </div>

          {/* Album Artist + Track Number */}
          <div className="grid grid-cols-12 gap-2.5">
            <label className="col-span-7 space-y-1">
              <span className="font-semibold text-slate-600 dark:text-slate-300">Album Artist</span>
              <input
                type="text"
                value={albumArtist}
                disabled={isCurrentlyLocked}
                onChange={(e) => setAlbumArtist(e.target.value)}
                placeholder="Album artist"
                className="w-full min-h-[38px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
              />
            </label>
            <div className="col-span-5 space-y-1">
              <span className="font-semibold text-slate-600 dark:text-slate-300 block">
                Track Number
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  inputMode="numeric"
                  value={trackNumber}
                  disabled={isCurrentlyLocked}
                  onChange={(e) => setTrackNumber(e.target.value)}
                  aria-label="Track number"
                  className="w-full min-h-[38px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-2 text-center text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
                />
                <span className="text-slate-500 dark:text-slate-400 font-semibold shrink-0">
                  of
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={trackTotal}
                  disabled={isCurrentlyLocked}
                  onChange={(e) => setTrackTotal(e.target.value)}
                  aria-label="Total tracks"
                  className="w-full min-h-[38px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-2 text-center text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
                />
              </div>
            </div>
          </div>

          {/* Album + Disc Number */}
          <div className="grid grid-cols-12 gap-2.5">
            <label className="col-span-7 space-y-1">
              <span className="font-semibold text-slate-600 dark:text-slate-300">Album</span>
              <input
                type="text"
                value={album}
                disabled={isCurrentlyLocked}
                onChange={(e) => setAlbum(e.target.value)}
                placeholder="Album name"
                className="w-full min-h-[38px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
              />
            </label>
            <div className="col-span-5 space-y-1">
              <span className="font-semibold text-slate-600 dark:text-slate-300 block">
                Disc Number
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  inputMode="numeric"
                  value={discNumber}
                  disabled={isCurrentlyLocked}
                  onChange={(e) => setDiscNumber(e.target.value)}
                  aria-label="Disc number"
                  className="w-full min-h-[38px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-2 text-center text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
                />
                <span className="text-slate-500 dark:text-slate-400 font-semibold shrink-0">
                  of
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={discTotal}
                  disabled={isCurrentlyLocked}
                  onChange={(e) => setDiscTotal(e.target.value)}
                  aria-label="Total discs"
                  className="w-full min-h-[38px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-2 text-center text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
                />
              </div>
            </div>
          </div>

          {/* Grouping + BPM */}
          <div className="grid grid-cols-12 gap-2.5">
            <label className="col-span-8 space-y-1">
              <span className="font-semibold text-slate-600 dark:text-slate-300">Grouping</span>
              <input
                type="text"
                value={grouping}
                disabled={isCurrentlyLocked}
                onChange={(e) => setGrouping(e.target.value)}
                placeholder="Grouping"
                className="w-full min-h-[38px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
              />
            </label>
            <label className="col-span-4 space-y-1">
              <span className="font-semibold text-slate-600 dark:text-slate-300">BPM</span>
              <input
                type="text"
                inputMode="decimal"
                value={bpm}
                disabled={isCurrentlyLocked}
                onChange={(e) => setBpm(e.target.value)}
                placeholder="120"
                className="w-full min-h-[38px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
              />
            </label>
          </div>

          {/* Composer */}
          <label className="block space-y-1">
            <span className="font-semibold text-slate-600 dark:text-slate-300">Composer</span>
            <input
              type="text"
              value={composer}
              disabled={isCurrentlyLocked}
              onChange={(e) => setComposer(e.target.value)}
              placeholder="Composer"
              className="w-full min-h-[38px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
            />
          </label>

          {/* Comments */}
          <label className="block space-y-1">
            <span className="font-semibold text-slate-600 dark:text-slate-300">Comments</span>
            <textarea
              rows={2}
              value={comments}
              disabled={isCurrentlyLocked}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Comments, studio notes, cue points..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
            />
          </label>

          {/* Genre + Part of a compilation */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
            <label className="sm:col-span-7 space-y-1">
              <span className="font-semibold text-slate-600 dark:text-slate-300">Genre</span>
              <input
                type="text"
                list="movibe-genre-suggestions"
                value={genre}
                disabled={isCurrentlyLocked}
                onChange={(e) => setGenre(e.target.value)}
                placeholder="Select or type genre..."
                className="w-full min-h-[38px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
              />
              <datalist id="movibe-genre-suggestions">
                {GENRE_SUGGESTIONS.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </label>
            <label className="sm:col-span-5 min-h-[38px] px-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={partOfCompilation}
                disabled={isCurrentlyLocked}
                onChange={(e) => setPartOfCompilation(e.target.checked)}
                className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
              />
              <span className="font-semibold text-slate-700 dark:text-slate-200 text-xs">
                Part of a compilation
              </span>
            </label>
          </div>
        </div>

        <div className="px-4 py-3.5 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2 shrink-0 bg-white dark:bg-slate-900">
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
            disabled={isBusy || isProcessingArtwork || !title.trim()}
            onClick={() =>
              onSave({
                title: title.trim(),
                artist: artist.trim() || 'Unknown Artist',
                albumArtist: albumArtist.trim(),
                album: album.trim(),
                grouping: grouping.trim(),
                composer: composer.trim(),
                comments: comments.trim(),
                genre: genre.trim(),
                year: year.trim(),
                trackNumber: trackNumber.trim(),
                trackTotal: trackTotal.trim(),
                discNumber: discNumber.trim(),
                discTotal: discTotal.trim(),
                bpm: bpm.trim(),
                partOfCompilation,
                artworkDataUrl,
                removeCustomArtwork,
                locked,
              })
            }
            className="min-h-[40px] px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white dark:text-slate-950 text-xs font-bold cursor-pointer"
          >
            {isBusy ? 'Saving...' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------------- Rename Modal ---------------- */
interface RenameModalProps {
  song: AudioTrackItem | null;
  isBusy: boolean;
  onClose: () => void;
  onConfirm: (newTitle: string) => void;
}

export const AudioRenameModal: React.FC<RenameModalProps> = ({
  song,
  isBusy,
  onClose,
  onConfirm,
}) => {
  const [name, setName] = useState('');

  useEffect(() => {
    if (song) {
      setName(song.title || song.displayName.replace(/\.[^/.]+$/, ''));
    }
  }, [song]);

  if (!song) return null;

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
            Rename Audio
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
          placeholder="Enter new song name"
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

/* ---------------- Move / Copy Folder Picker Modal ---------------- */
interface MoveCopyModalProps {
  mode: 'move' | 'copy' | null;
  song: AudioTrackItem | null;
  folders: string[];
  isLoadingFolders?: boolean;
  isNativeAndroid?: boolean;
  isBusy: boolean;
  onClose: () => void;
  onConfirm: (targetFolder: string) => void;
  onBrowsePhoneFolders?: () => void;
}

const DEFAULT_PHONE_FOLDERS = [
  'Music/Mo Vibe',
  'Music',
  'Download',
  'Download/Mo Vibe',
  'Documents',
  'Recordings',
  'Podcasts',
  'Audiobooks',
  'Ringtones',
  'Alarms',
  'Notifications',
  'DCIM',
  'Pictures',
  'Movies',
];

export const AudioMoveCopyModal: React.FC<MoveCopyModalProps> = ({
  mode,
  song,
  folders,
  isLoadingFolders = false,
  isNativeAndroid = false,
  isBusy,
  onClose,
  onConfirm,
  onBrowsePhoneFolders,
}) => {
  const [selectedFolder, setSelectedFolder] = useState('Music/Mo Vibe');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (mode && song) {
      setSearchQuery('');
      setSelectedFolder('Music/Mo Vibe');
    }
  }, [mode, song]);

  if (!mode || !song) return null;

  const availableFolders = folders.length > 0 ? folders : DEFAULT_PHONE_FOLDERS;
  const trimmedSearch = searchQuery.trim().replace(/^\/+|\/+$/g, '');
  const filteredFolders = trimmedSearch
    ? availableFolders.filter((folder) =>
        folder.toLowerCase().includes(trimmedSearch.toLowerCase())
      )
    : availableFolders;

  const hasExactMatch =
    trimmedSearch.length > 0 &&
    availableFolders.some((f) => f.toLowerCase() === trimmedSearch.toLowerCase());

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm p-0 sm:p-4"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-md p-5 space-y-3.5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            {mode === 'move' ? (
              <FolderInput className="w-5 h-5 text-amber-500 shrink-0" />
            ) : (
              <Copy className="w-5 h-5 text-sky-500 shrink-0" />
            )}
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {mode === 'move' ? 'Move Audio' : 'Copy Audio'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {song.title || song.displayName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="min-w-[38px] min-h-[38px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search or type custom folder path */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search folders or enter folder path (e.g. Documents/Beats)"
            disabled={isBusy}
            className="w-full min-h-[40px] pl-9 pr-8 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear folder search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Folder count & native device picker shortcut */}
        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span>
            {isLoadingFolders
              ? 'Scanning phone folders...'
              : `${filteredFolders.length} ${filteredFolders.length === 1 ? 'folder' : 'folders'} on phone`}
          </span>
          {isNativeAndroid && onBrowsePhoneFolders && (
            <button
              type="button"
              disabled={isBusy}
              onClick={onBrowsePhoneFolders}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer disabled:opacity-50"
            >
              <FolderOpen className="w-3.5 h-3.5 text-emerald-500" />
              <span>Browse Phone Storage</span>
            </button>
          )}
        </div>

        {/* Scrollable Phone Folders List */}
        <div className="max-h-[42vh] overflow-y-auto pr-0.5 space-y-1.5">
          {trimmedSearch && !hasExactMatch && (
            <button
              type="button"
              onClick={() => setSelectedFolder(trimmedSearch)}
              className={`w-full min-h-[44px] px-3.5 py-2 rounded-xl border flex items-center justify-between text-xs font-semibold cursor-pointer ${
                selectedFolder === trimmedSearch
                  ? 'bg-emerald-500/10 border-emerald-500/60 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-50 dark:bg-slate-950 border-dashed border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Plus className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="truncate">Use folder &ldquo;{trimmedSearch}&rdquo;</span>
              </span>
              {selectedFolder === trimmedSearch && (
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
              )}
            </button>
          )}

          {filteredFolders.map((folder) => {
            const active = selectedFolder === folder;
            return (
              <button
                key={folder}
                type="button"
                onClick={() => setSelectedFolder(folder)}
                className={`w-full min-h-[44px] px-3.5 py-2 rounded-xl border flex items-center justify-between text-xs font-semibold cursor-pointer ${
                  active
                    ? 'bg-emerald-500/10 border-emerald-500/60 text-emerald-700 dark:text-emerald-300'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Folder className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                  <span className="truncate text-left">{folder}</span>
                </span>
                {active && <Check className="w-4 h-4 text-emerald-500 shrink-0" />}
              </button>
            );
          })}

          {!isLoadingFolders && filteredFolders.length === 0 && !trimmedSearch && (
            <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No folders matched.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            To: <span className="font-semibold text-slate-700 dark:text-slate-200">{selectedFolder}</span>
          </span>
          <div className="flex items-center gap-2 shrink-0">
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
    </div>
  );
};

/* ---------------- Audio Trimmer Modal ---------------- */
interface AudioTrimModalProps {
  song: AudioTrackItem | null;
  buffer: AudioBuffer | null;
  isDecoding: boolean;
  isSaving: boolean;
  saveProgress: number;
  error: string | null;
  onClose: () => void;
  onSaveTrim: (startSec: number, endSec: number, format: AudioExportFormat) => void;
}

export const AudioTrimModal: React.FC<AudioTrimModalProps> = ({
  song,
  buffer,
  isDecoding,
  isSaving,
  saveProgress,
  error,
  onClose,
  onSaveTrim,
}) => {
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);
  const [format, setFormat] = useState<AudioExportFormat>('mp3-320');
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  const previewCtxRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stopPreview = () => {
    if (previewSourceRef.current) {
      try {
        previewSourceRef.current.stop();
        previewSourceRef.current.disconnect();
      } catch {
        // ignore
      }
      previewSourceRef.current = null;
    }
    setIsPreviewPlaying(false);
  };

  useEffect(() => {
    stopPreview();
    if (buffer) {
      setStartSec(0);
      setEndSec(Number(buffer.duration.toFixed(1)));
    }
    return () => {
      stopPreview();
      if (previewCtxRef.current && previewCtxRef.current.state !== 'closed') {
        void previewCtxRef.current.close().catch(() => {});
        previewCtxRef.current = null;
      }
    };
  }, [buffer]);

  if (!song) return null;

  const totalDur = buffer
    ? Math.max(0.5, Number(buffer.duration.toFixed(1)))
    : Math.max(1, Number((song.durationMs / 1000).toFixed(1)));
  const minGap = Math.min(0.5, Math.max(0.1, Number((totalDur * 0.1).toFixed(1))));

  const clampedEnd = Math.min(totalDur, Math.max(minGap, endSec));
  const clampedStart = Math.max(0, Math.min(startSec, Math.max(0, clampedEnd - minGap)));
  const cutDur = Math.max(minGap, clampedEnd - clampedStart);

  const handleStartChange = (nextVal: number) => {
    const safeStart = Math.max(0, Math.min(nextVal, Math.max(0, clampedEnd - minGap)));
    setStartSec(Number(safeStart.toFixed(1)));
  };

  const handleEndChange = (nextVal: number) => {
    const safeEnd = Math.min(totalDur, Math.max(nextVal, Math.min(totalDur, clampedStart + minGap)));
    setEndSec(Number(safeEnd.toFixed(1)));
  };

  const togglePreview = () => {
    if (!buffer) return;
    if (isPreviewPlaying) {
      stopPreview();
      return;
    }
    try {
      if (!previewCtxRef.current || previewCtxRef.current.state === 'closed') {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        previewCtxRef.current = new AudioCtx();
      }
      const ctx = previewCtxRef.current;
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.onended = () => setIsPreviewPlaying(false);
      src.start(0, clampedStart, cutDur);
      previewSourceRef.current = src;
      setIsPreviewPlaying(true);
    } catch {
      setIsPreviewPlaying(false);
    }
  };

  const leftPct = totalDur > 0 ? (clampedStart / totalDur) * 100 : 0;
  const widthPct = totalDur > 0 ? ((clampedEnd - clampedStart) / totalDur) * 100 : 100;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm p-0 sm:p-4"
      onClick={() => {
        if (!isSaving) {
          stopPreview();
          onClose();
        }
      }}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-md max-h-[88vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <Scissors className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Trim Audio
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {song.title || song.displayName}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => {
              stopPreview();
              onClose();
            }}
            className="min-w-[38px] min-h-[38px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto text-xs">
          {isDecoding ? (
            <div className="py-10 text-center space-y-2">
              <div className="w-7 h-7 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto" />
              <p className="text-slate-600 dark:text-slate-400 font-mono">
                Decoding audio waveform for trimming...
              </p>
            </div>
          ) : error ? (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400">
              {error}
            </div>
          ) : buffer ? (
            <>
              {/* Visual Cut Range Bar */}
              <div className="space-y-2 bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="flex justify-between font-mono text-[11px] text-slate-600 dark:text-slate-400">
                  <span>Start: {formatPreciseClock(clampedStart)}</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                    Cut: {formatPreciseClock(cutDur)}
                  </span>
                  <span>End: {formatPreciseClock(clampedEnd)}</span>
                </div>
                <div className="relative h-5 rounded-lg bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="absolute top-0 bottom-0 bg-emerald-500/40 dark:bg-emerald-400/35 border-x-2 border-emerald-600 dark:border-emerald-400"
                    style={{ left: `${leftPct}%`, width: `${Math.max(1, widthPct)}%` }}
                  />
                </div>
              </div>

              {/* Start Slider */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Start Point ({formatPreciseClock(clampedStart)})
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleStartChange(clampedStart - 0.5)}
                      className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono cursor-pointer"
                    >
                      -0.5s
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStartChange(clampedStart + 0.5)}
                      className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono cursor-pointer"
                    >
                      +0.5s
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={totalDur}
                  step={0.1}
                  value={clampedStart}
                  onChange={(e) => handleStartChange(parseFloat(e.target.value))}
                  aria-label="Trim start point"
                  className="w-full h-7 touch-none accent-emerald-500 cursor-pointer"
                />
              </div>

              {/* End Slider */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    End Point ({formatPreciseClock(clampedEnd)})
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleEndChange(clampedEnd - 0.5)}
                      className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono cursor-pointer"
                    >
                      -0.5s
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEndChange(clampedEnd + 0.5)}
                      className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono cursor-pointer"
                    >
                      +0.5s
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={totalDur}
                  step={0.1}
                  value={clampedEnd}
                  onChange={(e) => handleEndChange(parseFloat(e.target.value))}
                  aria-label="Trim end point"
                  className="w-full h-7 touch-none accent-emerald-500 cursor-pointer"
                />
              </div>

              {/* Output Format */}
              <div className="space-y-1.5">
                <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                  Output Format
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {AUDIO_EXPORT_FORMATS.slice(0, 3).map((fmt) => (
                    <button
                      key={fmt.id}
                      type="button"
                      onClick={() => setFormat(fmt.id)}
                      className={`py-2 px-2 rounded-xl border text-[11px] font-bold cursor-pointer ${
                        format === fmt.id
                          ? 'bg-emerald-500/15 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                          : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {fmt.label} · {fmt.qualityTag.replace('16-bit ', '')}
                    </button>
                  ))}
                </div>
              </div>

              {isSaving && (
                <div className="space-y-1">
                  <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${saveProgress}%` }}
                    />
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    Exporting trimmed cut ({saveProgress}%)...
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={togglePreview}
                  className="min-h-[42px] px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-bold flex items-center gap-2 cursor-pointer"
                >
                  {isPreviewPlaying ? (
                    <>
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>Stop Preview</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Preview Trim</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => {
                    stopPreview();
                    onSaveTrim(clampedStart, clampedEnd, format);
                  }}
                  className="min-h-[42px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-white dark:text-slate-950 font-bold flex items-center gap-2 cursor-pointer"
                >
                  <Scissors className="w-4 h-4" />
                  <span>{isSaving ? 'Saving...' : 'Save Trimmed Audio'}</span>
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};

/* ---------------- Playlist Batch Song Picker Modal ---------------- */
interface PlaylistAddSongsModalProps {
  playlist: AudioPlaylist | null;
  songs: AudioTrackItem[];
  onClose: () => void;
  onSavePlaylistTracks: (playlistId: string, trackIds: string[]) => void;
}

export const PlaylistAddSongsModal: React.FC<PlaylistAddSongsModalProps> = ({
  playlist,
  songs,
  onClose,
  onSavePlaylistTracks,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (playlist) {
      setSelectedIds(playlist.trackIds);
      setQuery('');
    }
  }, [playlist]);

  if (!playlist) return null;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? songs.filter(
        (s) =>
          (s.title || '').toLowerCase().includes(q) ||
          (s.displayName || '').toLowerCase().includes(q) ||
          (s.artist || '').toLowerCase().includes(q)
      )
    : songs;

  const toggleId = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectAllFiltered = () => {
    const filteredIds = filtered.map((s) => s.id);
    setSelectedIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
  };

  const clearFiltered = () => {
    const filteredSet = new Set(filtered.map((s) => s.id));
    setSelectedIds((prev) => prev.filter((id) => !filteredSet.has(id)));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-md max-h-[86vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <ListMusic className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                Add Songs to &ldquo;{playlist.name}&rdquo;
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {selectedIds.length} {selectedIds.length === 1 ? 'song' : 'songs'} selected
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[38px] min-h-[38px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
            aria-label="Close song picker"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 pb-2 space-y-2.5 border-b border-slate-200/80 dark:border-slate-800/80 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search songs to add..."
              className="w-full min-h-[40px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-emerald-500 rounded-xl pl-9 pr-8 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {filtered.length > 0 && (
            <div className="flex items-center justify-between text-[11px] font-semibold">
              <span className="text-slate-500 dark:text-slate-400">
                Showing {filtered.length} {filtered.length === 1 ? 'song' : 'songs'}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={clearFiltered}
                  className="text-slate-500 dark:text-slate-400 hover:underline cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
          {filtered.length === 0 ? (
            <div className="py-10 px-4 text-center space-y-2">
              <Music className="w-8 h-8 text-slate-400 dark:text-slate-600 mx-auto" />
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                {songs.length === 0
                  ? 'No audio songs loaded yet. Add or load audio files first.'
                  : 'No matching songs found.'}
              </p>
            </div>
          ) : (
            filtered.map((s) => {
              const checked = selectedIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleId(s.id)}
                  className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                    checked
                      ? 'bg-emerald-500/8 dark:bg-emerald-500/12'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shrink-0">
                      <AudioArtwork song={s} className="w-full h-full" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {s.title || s.displayName}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {s.artist}
                        {s.durationMs > 0 ? ` · ${formatClock(s.durationMs / 1000)}` : ''}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                      checked
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950'
                    }`}
                  >
                    {checked && <Check className="w-3.5 h-3.5" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 shrink-0 bg-white dark:bg-slate-900">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSavePlaylistTracks(playlist.id, selectedIds);
              onClose();
            }}
            className="min-h-[42px] px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white dark:text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Save ({selectedIds.length})</span>
          </button>
        </div>
      </div>
    </div>
  );
};

