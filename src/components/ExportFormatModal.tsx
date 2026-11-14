import React from 'react';
import {
  AUDIO_EXPORT_FORMATS,
  AudioExportFormat,
  AudioFormatOption,
  estimateExportSizeLabel,
} from '../utils/audioEncoders';
import { Download, FileAudio, X } from 'lucide-react';

interface ExportFormatModalProps {
  isOpen: boolean;
  title: string;
  subtitle: string;
  durationSec: number;
  sampleRate: number;
  onClose: () => void;
  onSelectFormat: (format: AudioExportFormat) => void;
}

export const ExportFormatModal: React.FC<ExportFormatModalProps> = ({
  isOpen,
  title,
  subtitle,
  durationSec,
  sampleRate,
  onClose,
  onSelectFormat,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-md flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <FileAudio className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                {title}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 font-mono truncate">
                {subtitle}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center transition-colors cursor-pointer shrink-0"
            aria-label="Close format picker"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Audio Formats List */}
        <div className="p-3 space-y-2 max-h-[70vh] overflow-y-auto">
          {AUDIO_EXPORT_FORMATS.map((fmt: AudioFormatOption) => {
            const sizeLabel = estimateExportSizeLabel(durationSec, sampleRate, fmt.id);
            return (
              <button
                key={fmt.id}
                type="button"
                onClick={() => onSelectFormat(fmt.id)}
                className="w-full min-h-[56px] px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-slate-200 dark:border-slate-800 hover:border-emerald-500/50 active:scale-[0.99] transition-all flex items-center justify-between gap-3 text-left cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {fmt.label}
                    </span>
                    <span className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                      {fmt.qualityTag}
                    </span>
                    <span className="text-xs font-mono text-slate-500">
                      .{fmt.extension}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-snug">
                    {fmt.description}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {sizeLabel && (
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {sizeLabel}
                    </span>
                  )}
                  <Download className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
