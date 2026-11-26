import React, { useState } from 'react';
import { ArrowRight, AlertCircle, FileAudio, Upload } from 'lucide-react';

interface SongUploaderProps {
  onFileSelected: (file: File) => void;
  onTriggerUpload: () => void;
  isAnalyzing: boolean;
  error?: string | null;
  loadedTrackName?: string;
  loadedBpm?: number;
}

const PREVIEW_BAR_HEIGHTS = [
  22, 42, 30, 56, 72, 40, 88, 60, 44, 78, 52, 92, 68, 36, 54, 48, 28, 62, 40, 50, 32, 24,
];

export const SongUploader: React.FC<SongUploaderProps> = ({
  onFileSelected,
  onTriggerUpload,
  isAnalyzing,
  error,
  loadedTrackName,
  loadedBpm,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (
        file.type.startsWith('audio/') ||
        file.name.match(/\.(mp3|wav|ogg|flac|m4a|aac|webm)$/i)
      ) {
        onFileSelected(file);
      }
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={`rounded-3xl p-5 sm:p-6 border transition-all overflow-hidden min-w-0 space-y-5 ${
        isDragOver
          ? 'border-emerald-500 bg-emerald-50 dark:bg-[#09241B] shadow-md'
          : 'border-emerald-500/35 bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/70 dark:from-[#08221A] dark:via-[#0B1822] dark:to-[#0A171E] shadow-sm'
      } ${isAnalyzing ? 'opacity-80 pointer-events-none' : ''}`}
    >
      {/* Top Row: Audio Analyzer Title + PulseBPM label */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Audio Analyzer
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-md">
            Detect the BPM of any audio, then change its key and tempo.
          </p>
        </div>
        <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 shrink-0 pt-1">
          PulseBPM
        </span>
      </div>

      {/* When no song is loaded yet, show the signature 128 BPM + waveform preview card from mockup */}
      {!loadedTrackName && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="text-5xl sm:text-6xl font-black font-mono tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400 leading-none">
              128
            </span>
            <div className="space-y-0.5 font-mono text-xs sm:text-sm leading-tight">
              <div className="font-bold text-slate-900 dark:text-white tracking-wider">BPM</div>
              <div className="text-slate-500 dark:text-slate-400 tracking-wider uppercase text-[11px] sm:text-xs">
                KEY: A MINOR
              </div>
            </div>
          </div>

          {/* Graphic Audio Bar Waveform */}
          <div
            className="flex items-center justify-between gap-1 sm:gap-1.5 h-16 px-0.5"
            aria-hidden="true"
          >
            {PREVIEW_BAR_HEIGHTS.map((heightPct, idx) => {
              const isPlayedRegion = idx < 12;
              return (
                <span
                  key={idx}
                  className={`flex-1 rounded-full transition-colors ${
                    isPlayedRegion
                      ? 'bg-emerald-500 dark:bg-emerald-400'
                      : 'bg-emerald-500/20 dark:bg-emerald-400/20'
                  }`}
                  style={{ height: `${heightPct}%` }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* When a song is loaded, show concise loaded track status */}
      {loadedTrackName && !isAnalyzing && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-emerald-500/20 text-xs font-mono min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <FileAudio className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="text-slate-700 dark:text-slate-200 truncate font-semibold">
              {loadedTrackName}
            </span>
          </div>
          {loadedBpm && (
            <span className="text-emerald-600 dark:text-emerald-400 font-bold tabular-nums shrink-0">
              {loadedBpm} BPM
            </span>
          )}
        </div>
      )}

      {/* Primary Upload Song CTA Button */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={onTriggerUpload}
          disabled={isAnalyzing}
          className="w-full min-h-[48px] px-5 py-3 rounded-2xl font-bold text-xs sm:text-sm uppercase tracking-wider text-slate-950 bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] transition-all flex items-center justify-center gap-2.5 shadow-md shadow-emerald-500/20 cursor-pointer disabled:opacity-60"
        >
          {isAnalyzing ? (
            <>
              <span className="w-4 h-4 border-2 border-slate-950/35 border-t-slate-950 rounded-full animate-spin" />
              <span>Analyzing Audio...</span>
            </>
          ) : (
            <>
              {loadedTrackName ? <Upload className="w-4 h-4" /> : null}
              <span>{loadedTrackName ? 'Upload Another Song' : 'Upload Song'}</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
        <p className="text-[11px] text-center text-slate-500 dark:text-slate-400">
          Drop MP3, WAV, FLAC, M4A, AAC or OGG files anywhere on this card
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/25 rounded-xl text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
