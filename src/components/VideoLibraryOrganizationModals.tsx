import React, { useEffect, useState } from 'react';
import { VideoTrackItem } from '../plugins/audioLibrary';
import {
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Heart,
  ListMusic,
  ListPlus,
  Plus,
  Search,
  Video,
  X,
} from 'lucide-react';

export interface VideoPlaylist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

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
  onToggleFavorite: (video: VideoTrackItem) => void;
  onOpenAddToPlaylist: (video: VideoTrackItem) => void;
  onToggleHide: (video: VideoTrackItem) => void;
  onRemoveFromPlaylist?: (video: VideoTrackItem) => void;
}

export const VideoActionSheetModal: React.FC<VideoActionSheetModalProps> = ({
  video,
  thumbUrl,
  isFavorite,
  isHidden,
  isInsidePlaylist,
  onClose,
  onToggleFavorite,
  onOpenAddToPlaylist,
  onToggleHide,
  onRemoveFromPlaylist,
}) => {
  if (!video) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-md max-h-[82vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-9 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 overflow-hidden flex items-center justify-center shrink-0">
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
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                {video.title || video.displayName}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {video.durationMs > 0 ? formatVideoClock(video.durationMs / 1000) : video.displayName}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-w-[38px] min-h-[38px] rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer shrink-0"
            aria-label="Close video options"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="py-1.5 divide-y divide-slate-100 dark:divide-slate-800/60">
          <button
            type="button"
            onClick={() => {
              onOpenAddToPlaylist(video);
              onClose();
            }}
            className="w-full min-h-[50px] px-4 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/70 text-slate-800 dark:text-slate-100 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                <ListPlus className="w-4 h-4" />
              </div>
              <span className="text-sm font-semibold">Add to Playlist</span>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => {
              onToggleFavorite(video);
              onClose();
            }}
            className="w-full min-h-[50px] px-4 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/70 text-slate-800 dark:text-slate-100 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-rose-500">
                <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
              </div>
              <span className="text-sm font-semibold">
                {isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
              </span>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => {
              onToggleHide(video);
              onClose();
            }}
            className="w-full min-h-[50px] px-4 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/70 text-slate-800 dark:text-slate-100 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300">
                {isHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </div>
              <span className="text-sm font-semibold">
                {isHidden ? 'Unhide video' : 'Hide from phone'}
              </span>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </button>

          {isInsidePlaylist && onRemoveFromPlaylist && (
            <button
              type="button"
              onClick={() => {
                onRemoveFromPlaylist(video);
                onClose();
              }}
              className="w-full min-h-[50px] px-4 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 dark:text-red-400 cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-950/40 flex items-center justify-center">
                  <X className="w-4 h-4" />
                </div>
                <span className="text-sm font-semibold">Remove from this playlist</span>
              </div>
              <ChevronRight className="w-4 h-4 shrink-0" />
            </button>
          )}
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
  onToggleVideoInPlaylist: (playlistId: string, videoId: string) => void;
  onCreatePlaylist: (name: string, initialVideoId?: string) => void;
}

export const VideoAddToPlaylistModal: React.FC<VideoAddToPlaylistModalProps> = ({
  video,
  playlists,
  onClose,
  onToggleVideoInPlaylist,
  onCreatePlaylist,
}) => {
  const [showNameBox, setShowNameBox] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    setShowNameBox(false);
    setNewName('');
  }, [video]);

  if (!video) return null;

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onCreatePlaylist(trimmed, video.id);
    setNewName('');
    setShowNameBox(false);
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
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

        <div className="p-4 space-y-4 overflow-y-auto">
          {!showNameBox ? (
            <div className="flex justify-end">
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
                const inList = pl.trackIds.includes(video.id);
                return (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => onToggleVideoInPlaylist(pl.id, video.id)}
                    className={`w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-3 text-left cursor-pointer transition-colors ${
                      inList
                        ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-800 dark:text-emerald-200'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{pl.name}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {pl.trackIds.length} {pl.trackIds.length === 1 ? 'video' : 'videos'}
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
