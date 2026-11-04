import React, { useState } from 'react';
import { Upload, Disc, AlertCircle, FileAudio } from 'lucide-react';

interface SongUploaderProps {
  onFileSelected: (file: File) => void;
  onTriggerUpload: () => void;
  isAnalyzing: boolean;
  error?: string | null;
  loadedTrackName?: string;
  loadedBpm?: number;
}

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
      if (file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|ogg|flac|m4a|aac|webm)$/i)) {
        onFileSelected(file);
      }
    }
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4">
      {/* Drop Zone Deck */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={onTriggerUpload}
        className={`relative border-2 border-dashed rounded-xl p-6 sm:p-8 text-center transition-all cursor-pointer flex flex-col items-center justify-center space-y-4 ${
          isDragOver
            ? 'border-emerald-400 bg-emerald-500/10 scale-[1.005]'
            : 'border-slate-800 hover:border-emerald-500/50 bg-slate-950/70 hover:bg-slate-950'
        } ${isAnalyzing ? 'opacity-70 pointer-events-none' : ''}`}
      >
        <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-emerald-400 shadow-inner shrink-0">
            {isAnalyzing ? (
              <div className="w-7 h-7 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />
            ) : (
              <Disc className="w-7 h-7 text-emerald-400 animate-spin-slow" />
            )}
          </div>

          <div className="space-y-1">
            <h3 className="font-bold text-slate-100 text-base sm:text-lg flex flex-wrap items-center justify-center sm:justify-start gap-2">
              <span>Drop any audio track to detect BPM instantly</span>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                PulseBPM Precision
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Compatible with MP3, WAV, FLAC, M4A, AAC, OGG · Drag & drop or{' '}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTriggerUpload();
                }}
                className="text-emerald-400 underline font-medium hover:text-emerald-300 cursor-pointer inline p-0 bg-transparent border-none"
              >
                click to browse
              </button>
            </p>
          </div>
        </div>

        {/* Dedicated, prominent Upload Song Button */}
        <div className="pt-2 flex items-center justify-center">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTriggerUpload();
            }}
            disabled={isAnalyzing}
            className="px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider text-slate-950 bg-emerald-400 hover:bg-emerald-300 active:scale-95 transition-all flex items-center gap-2.5 shadow-lg shadow-emerald-500/20 cursor-pointer disabled:opacity-50"
          >
            {isAnalyzing ? (
              <>
                <div className="w-4 h-4 border-2 border-slate-900/40 border-t-slate-900 rounded-full animate-spin" />
                <span>Analyzing Audio...</span>
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                <span>Upload Song</span>
              </>
            )}
          </button>
        </div>

        {loadedTrackName && !isAnalyzing && (
          <div className="pt-1 flex items-center gap-2 text-xs text-slate-400 font-mono">
            <FileAudio className="w-3.5 h-3.5 text-emerald-400" />
            <span>Currently loaded: <strong className="text-slate-200">{loadedTrackName}</strong></span>
            {loadedBpm && (
              <span className="text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                {loadedBpm} BPM
              </span>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
