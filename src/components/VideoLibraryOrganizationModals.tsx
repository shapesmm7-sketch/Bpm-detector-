import React, { useEffect, useRef, useState } from 'react';
import { VideoTrackItem } from '../plugins/audioLibrary';
import {
  Bell,
  Check,
  Copy,
  Eye,
  EyeOff,
  FolderInput,
  Headphones,
  Heart,
  ListMusic,
  ListPlus,
  Music,
  Pencil,
  Plus,
  RefreshCw,
  Scissors,
  Search,
  Share2,
  Shield,
  SplitSquareHorizontal,
  Trash2,
  Video,
  X,
} from 'lucide-react';

export interface VideoPlaylist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

export type VideoMenuActionId =
  | 'add_to_playlist'
  | 'add_to_favorites'
  | 'hide_from_phone'
  | 'play_as_audio'
  | 'video_to_audio'
  | 'video_converter'
  | 'trim'
  | 'edit'
  | 'rename'
  | 'share'
  | 'move'
  | 'copy'
  | 'move_to_secure_folder'
  | 'set_as_ringtone'
  | 'delete'
  | 'remove_from_playlist';

function formatVideoClock(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '0:00';
  const total = Math.floor(sec);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/* ---------------- Video 3-Dots Action Sheet ---------------- */
interface VideoActionSheetModalProps {
  video: VideoTrackItem | null;
  thumbUrl?: string;
  isFavorite: boolean;
  isHidden: boolean;
  isInsidePlaylist?: boolean;
  onClose: () => void;
  onAction: (action: VideoMenuActionId, video: VideoTrackItem) => void;
}

export const VideoActionSheetModal: React.FC<VideoActionSheetModalProps> = ({
  video,
  thumbUrl,
  isFavorite,
  isHidden,
  isInsidePlaylist,
  onClose,
  onAction,
}) => {
  if (!video) return null;

  const items: Array<{
    id: VideoMenuActionId;
    label: string;
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
      id: 'add_to_favorites',
      label: isFavorite ? 'Favorited' : 'Add to Favorites',
      icon: (
        <Heart
          className={`w-4 h-4 ${
            isFavorite ? 'text-rose-500 fill-rose-500' : 'text-rose-500 dark:text-rose-400'
          }`}
        />
      ),
      highlight: isFavorite,
    },
    {
      id: 'play_as_audio',
      label: 'Play as audio',
      icon: <Headphones className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
    },
    {
      id: 'video_to_audio',
      label: 'Video to audio',
      icon: <Music className="w-4 h-4 text-sky-600 dark:text-sky-400" />,
    },
    {
      id: 'video_converter',
      label: 'Video converter',
      icon: <RefreshCw className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />,
    },
    {
      id: 'trim',
      label: 'Trim',
      icon: <Scissors className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
    },
    {
      id: 'edit',
      label: 'Edit',
      icon: <SplitSquareHorizontal className="w-4 h-4 text-violet-600 dark:text-violet-400" />,
    },
    {
      id: 'rename',
      label: 'Rename',
      icon: <Pencil className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
    },
    {
      id: 'share',
      label: 'Share',
      icon: <Share2 className="w-4 h-4 text-sky-600 dark:text-sky-400" />,
    },
    {
      id: 'set_as_ringtone',
      label: 'Set as ringtone',
      icon: <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
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
      label: 'Move to secure folder',
      icon: <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
    },
    {
      id: 'hide_from_phone',
      label: isHidden ? 'Unhide video' : 'Hide from phone',
      icon: isHidden ? (
        <Eye className="w-4 h-4 text-slate-600 dark:text-slate-300" />
      ) : (
        <EyeOff className="w-4 h-4 text-slate-600 dark:text-slate-300" />
      ),
    },
    ...(isInsidePlaylist
      ? [
          {
            id: 'remove_from_playlist' as VideoMenuActionId,
            label: 'Remove from playlist',
            icon: <X className="w-4 h-4 text-red-500 dark:text-red-400" />,
            danger: true,
          },
        ]
      : []),
    {
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 className="w-4 h-4 text-red-500 dark:text-red-400" />,
      danger: true,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-md max-h-[94vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2.5 px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-11 h-8 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 overflow-hidden flex items-center justify-center shrink-0">
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
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                {video.title || video.displayName}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {video.durationMs > 0 ? formatVideoClock(video.durationMs / 1000) : video.displayName}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-w-[34px] min-h-[34px] rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer shrink-0"
            aria-label="Close video options"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-2.5 grid grid-cols-2 gap-1.5">
          {items.map((item, idx) => {
            const isFullWidthLast = idx === items.length - 1 && items.length % 2 === 1;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onAction(item.id, video)}
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

/* ---------------- Single Video -> Add to Playlist Modal ---------------- */
interface VideoAddToPlaylistModalProps {
  video: VideoTrackItem | null;
  playlists: VideoPlaylist[];
  onClose: () => void;
  onSaveVideoPlaylists: (videoId: string, selectedPlaylistIds: string[]) => void;
  onCreatePlaylist: (name: string, initialVideoId?: string) => string | void;
}

export const VideoAddToPlaylistModal: React.FC<VideoAddToPlaylistModalProps> = ({
  video,
  playlists,
  onClose,
  onSaveVideoPlaylists,
  onCreatePlaylist,
}) => {
  const [showNameBox, setShowNameBox] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<string[]>([]);
  const knownPlaylistIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setShowNameBox(false);
    setNewName('');
    if (video) {
      setSelectedPlaylistIds(
        playlists.filter((pl) => pl.trackIds.includes(video.id)).map((pl) => pl.id)
      );
      knownPlaylistIdsRef.current = new Set(playlists.map((pl) => pl.id));
    } else {
      setSelectedPlaylistIds([]);
      knownPlaylistIdsRef.current = new Set();
    }
    // Initialize selection when modal opens for a video
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id]);

  useEffect(() => {
    if (!video) return;
    const newlyAdded = playlists.filter((pl) => !knownPlaylistIdsRef.current.has(pl.id));
    if (newlyAdded.length > 0) {
      newlyAdded.forEach((pl) => knownPlaylistIdsRef.current.add(pl.id));
      const autoCheckIds = newlyAdded
        .filter((pl) => pl.trackIds.includes(video.id))
        .map((pl) => pl.id);
      if (autoCheckIds.length > 0) {
        setSelectedPlaylistIds((prev) => Array.from(new Set([...prev, ...autoCheckIds])));
      }
    }
  }, [playlists, video]);

  if (!video) return null;

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
    const createdId = onCreatePlaylist(trimmed, video.id);
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
    onSaveVideoPlaylists(video.id, selectedPlaylistIds);
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
                Add Video to Playlist
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {video.title || video.displayName}
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
              No video playlists yet. Tap + Create to make one.
            </p>
          ) : (
            <div className="space-y-2">
              {playlists.map((pl) => {
                const originallyInList = pl.trackIds.includes(video.id);
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
                        {displayedCount} {displayedCount === 1 ? 'video' : 'videos'}
                      </div>
                    </div>
                    <div
                      className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 ${
                        inList
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : 'border-slate-300 dark:border-slate-700'
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

/* ---------------- Batch Add Videos to Playlist Folder Modal ---------------- */
interface VideoPlaylistAddVideosModalProps {
  playlist: VideoPlaylist | null;
  videos: VideoTrackItem[];
  getThumbnail: (id: string, fallback?: string) => string;
  onClose: () => void;
  onSavePlaylistTracks: (playlistId: string, trackIds: string[]) => void;
}

export const VideoPlaylistAddVideosModal: React.FC<VideoPlaylistAddVideosModalProps> = ({
  playlist,
  videos,
  getThumbnail,
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
    ? videos.filter(
        (v) =>
          (v.title || '').toLowerCase().includes(q) ||
          (v.displayName || '').toLowerCase().includes(q)
      )
    : videos;

  const toggleId = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectAllFiltered = () => {
    const ids = filtered.map((v) => v.id);
    setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])));
  };

  const clearFiltered = () => {
    const filteredSet = new Set(filtered.map((v) => v.id));
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
                Add Videos to &ldquo;{playlist.name}&rdquo;
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {selectedIds.length} {selectedIds.length === 1 ? 'video' : 'videos'} selected
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

        <div className="p-4 pb-2 space-y-2.5 border-b border-slate-200/80 dark:border-slate-800/80 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search videos to add..."
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
                Showing {filtered.length} {filtered.length === 1 ? 'video' : 'videos'}
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
              <Video className="w-8 h-8 text-slate-400 dark:text-slate-600 mx-auto" />
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                {videos.length === 0
                  ? 'No videos loaded yet. Load or add videos first.'
                  : 'No matching videos found.'}
              </p>
            </div>
          ) : (
            filtered.map((v) => {
              const checked = selectedIds.includes(v.id);
              const thumb = getThumbnail(v.id, v.thumbnailUrl);
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => toggleId(v.id)}
                  className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                    checked
                      ? 'bg-emerald-500/8 dark:bg-emerald-500/12'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-12 h-9 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 overflow-hidden flex items-center justify-center shrink-0">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={v.title || v.displayName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Video className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {v.title || v.displayName}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {v.durationMs > 0 ? formatVideoClock(v.durationMs / 1000) : v.displayName}
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
