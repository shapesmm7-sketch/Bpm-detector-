import React, { useMemo, useState } from 'react';
import { AudioTrackItem } from '../plugins/audioLibrary';
import { Music, Search, X, FolderOpen, Clock, HardDrive } from 'lucide-react';

interface PhoneAudioPickerModalProps {
  isOpen: boolean;
  songs: AudioTrackItem[];
  onClose: () => void;
  onSelectSong: (song: AudioTrackItem) => void;
  onBrowseFiles: () => void;
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export const PhoneAudioPickerModal: React.FC<PhoneAudioPickerModalProps> = ({
  isOpen,
  songs,
  onClose,
  onSelectSong,
  onBrowseFiles,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/85 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/95">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Music className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-100">
                Phone Audio Library
              </h2>
              <p className="text-xs text-slate-400 font-mono">
                {songs.length} audio {songs.length === 1 ? 'file' : 'files'} found
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onBrowseFiles();
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors cursor-pointer"
              title="Open System File Picker"
            >
              <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">File Manager</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
              aria-label="Close song picker"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search Input */}
        <div className="p-3.5 border-b border-slate-800/80 bg-slate-950/60">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search all songs on your phone..."
              className="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500/60 rounded-xl pl-10 pr-9 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Song List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
          {filteredSongs.length === 0 ? (
            <div className="py-14 px-6 text-center space-y-2">
              <Music className="w-10 h-10 text-slate-600 mx-auto" />
              <p className="text-sm font-semibold text-slate-300">
                {songs.length === 0 ? 'No audio files found on this device' : 'No matching songs'}
              </p>
              <p className="text-xs text-slate-500">
                {songs.length === 0
                  ? 'Try using File Manager above to pick an audio file.'
                  : 'Try a different song title or artist name.'}
              </p>
            </div>
          ) : (
            filteredSongs.map((song) => (
              <button
                key={song.id}
                type="button"
                onClick={() => onSelectSong(song)}
                className="w-full px-5 py-3.5 text-left hover:bg-slate-800/70 active:bg-slate-800 transition-colors flex items-center justify-between gap-3 cursor-pointer"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-emerald-400 shrink-0">
                    <Music className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-100 truncate">
                      {song.title || song.displayName}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {song.artist} · {song.displayName}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0 text-[11px] font-mono text-slate-400">
                  <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                    <Clock className="w-3 h-3" />
                    {formatDuration(song.durationMs)}
                  </span>
                  <span className="flex items-center gap-1 text-slate-500">
                    <HardDrive className="w-3 h-3" />
                    {formatSize(song.size)}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
