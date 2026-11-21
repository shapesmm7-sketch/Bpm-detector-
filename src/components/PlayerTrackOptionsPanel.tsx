import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  Star,
} from 'lucide-react';

export type MediaKindOption =
  | 'Music'
  | 'Podcast'
  | 'Audiobook'
  | 'Voice Memo'
  | 'Ringtone'
  | 'Sound Effect';

export const MEDIA_KIND_OPTIONS: MediaKindOption[] = [
  'Music',
  'Podcast',
  'Audiobook',
  'Voice Memo',
  'Ringtone',
  'Sound Effect',
];

export interface EqualizerPresetDef {
  name: string;
  lowDb: number;
  midDb: number;
  highDb: number;
}

export const EQUALIZER_PRESETS: EqualizerPresetDef[] = [
  { name: 'None', lowDb: 0, midDb: 0, highDb: 0 },
  { name: 'Acoustic', lowDb: 3.5, midDb: 1.5, highDb: 3.0 },
  { name: 'Bass Booster', lowDb: 7.5, midDb: 0, highDb: -0.5 },
  { name: 'Bass Reducer', lowDb: -7.5, midDb: 0, highDb: 0.5 },
  { name: 'Classical', lowDb: 3.0, midDb: -1.5, highDb: 3.5 },
  { name: 'Dance', lowDb: 6.0, midDb: 1.5, highDb: 4.5 },
  { name: 'Deep', lowDb: 6.5, midDb: 1.0, highDb: -2.0 },
  { name: 'Electronic', lowDb: 5.5, midDb: -1.0, highDb: 5.0 },
  { name: 'Flat', lowDb: 0, midDb: 0, highDb: 0 },
  { name: 'Hip-Hop', lowDb: 6.5, midDb: -1.0, highDb: 2.5 },
  { name: 'Jazz', lowDb: 3.0, midDb: 2.5, highDb: 3.0 },
  { name: 'Latin', lowDb: 4.0, midDb: 0, highDb: 4.0 },
  { name: 'Loudness', lowDb: 5.5, midDb: -1.5, highDb: 5.5 },
  { name: 'Lounge', lowDb: -2.0, midDb: 3.0, highDb: 1.0 },
  { name: 'Piano', lowDb: 1.5, midDb: 2.5, highDb: 3.5 },
  { name: 'Pop', lowDb: -1.5, midDb: 4.0, highDb: 2.0 },
  { name: 'R&B', lowDb: 6.0, midDb: -2.0, highDb: 2.5 },
  { name: 'Rock', lowDb: 4.5, midDb: 1.5, highDb: 4.5 },
  { name: 'Small Speakers', lowDb: 5.0, midDb: 2.0, highDb: 2.0 },
  { name: 'Spoken Word', lowDb: -3.5, midDb: 5.0, highDb: 1.5 },
  { name: 'Treble Booster', lowDb: -0.5, midDb: 1.0, highDb: 7.0 },
  { name: 'Treble Reducer', lowDb: 0.5, midDb: -1.0, highDb: -7.0 },
  { name: 'Vocal Booster', lowDb: -2.5, midDb: 5.5, highDb: 2.5 },
];

export interface TrackPlaybackOptions {
  volumeAdjustmentPct: number;
  equalizerPreset: string;
  mediaKind: MediaKindOption;
  rating: number;
  startTimeEnabled: boolean;
  startTimeSec: number;
  stopTimeEnabled: boolean;
  stopTimeSec?: number;
  rememberPosition: boolean;
  skipWhenShuffling: boolean;
}

export const DEFAULT_TRACK_PLAYBACK_OPTIONS: TrackPlaybackOptions = {
  volumeAdjustmentPct: 0,
  equalizerPreset: 'None',
  mediaKind: 'Music',
  rating: 0,
  startTimeEnabled: false,
  startTimeSec: 0,
  stopTimeEnabled: false,
  stopTimeSec: undefined,
  rememberPosition: false,
  skipWhenShuffling: false,
};

export function formatOptionTimestamp(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const totalMs = Math.round(sec * 1000);
  const mins = Math.floor(totalMs / 60000);
  const remSec = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  const base = `${mins}:${remSec.toString().padStart(2, '0')}`;
  if (ms === 0) return base;
  return `${base}.${ms.toString().padStart(3, '0')}`;
}

export function parseOptionTimestamp(raw: string): number | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  if (cleaned.includes(':')) {
    const parts = cleaned.split(':');
    if (parts.length === 2) {
      const m = Number(parts[0]);
      const s = Number(parts[1]);
      if (isFinite(m) && isFinite(s) && m >= 0 && s >= 0 && s < 60) {
        return m * 60 + s;
      }
    } else if (parts.length === 3) {
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      const s = Number(parts[2]);
      if (isFinite(h) && isFinite(m) && isFinite(s) && h >= 0 && m >= 0 && m < 60 && s >= 0 && s < 60) {
        return h * 3600 + m * 60 + s;
      }
    }
    return null;
  }
  const num = Number(cleaned);
  return isFinite(num) && num >= 0 ? num : null;
}

interface PlayerTrackOptionsPanelProps {
  trackTitle: string;
  trackDurationSec: number;
  currentPlayheadSec: number;
  options: TrackPlaybackOptions;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onChange: (next: TrackPlaybackOptions) => void;
}

export const PlayerTrackOptionsPanel: React.FC<PlayerTrackOptionsPanelProps> = ({
  trackDurationSec,
  currentPlayheadSec,
  options,
  isExpanded,
  onToggleExpand,
  onChange,
}) => {
  const effectiveDefaultStop =
    options.stopTimeSec !== undefined
      ? options.stopTimeSec
      : trackDurationSec > 0
      ? trackDurationSec
      : 0;

  const [startInput, setStartInput] = useState(
    formatOptionTimestamp(options.startTimeSec || 0)
  );
  const [stopInput, setStopInput] = useState(
    formatOptionTimestamp(effectiveDefaultStop)
  );

  useEffect(() => {
    setStartInput(formatOptionTimestamp(options.startTimeSec || 0));
  }, [options.startTimeSec]);

  useEffect(() => {
    const target =
      options.stopTimeSec !== undefined
        ? options.stopTimeSec
        : trackDurationSec > 0
        ? trackDurationSec
        : 0;
    setStopInput(formatOptionTimestamp(target));
  }, [options.stopTimeSec, trackDurationSec]);

  const commitStartTime = () => {
    const parsed = parseOptionTimestamp(startInput);
    if (parsed === null) {
      setStartInput(formatOptionTimestamp(options.startTimeSec || 0));
      return;
    }
    const maxStart =
      trackDurationSec > 0 ? Math.max(0, trackDurationSec - 0.1) : parsed;
    const clamped = Math.max(0, Math.min(parsed, maxStart));
    onChange({
      ...options,
      startTimeSec: Number(clamped.toFixed(3)),
    });
    setStartInput(formatOptionTimestamp(clamped));
  };

  const commitStopTime = () => {
    const parsed = parseOptionTimestamp(stopInput);
    if (parsed === null) {
      setStopInput(formatOptionTimestamp(effectiveDefaultStop));
      return;
    }
    const minStop = options.startTimeEnabled ? options.startTimeSec + 0.1 : 0.1;
    const maxStop = trackDurationSec > 0 ? trackDurationSec : parsed;
    const clamped = Math.max(minStop, Math.min(parsed, Math.max(minStop, maxStop)));
    onChange({
      ...options,
      stopTimeSec: Number(clamped.toFixed(3)),
    });
    setStopInput(formatOptionTimestamp(clamped));
  };

  const volLabel =
    options.volumeAdjustmentPct === 0
      ? 'None'
      : `${options.volumeAdjustmentPct > 0 ? '+' : ''}${options.volumeAdjustmentPct}%`;

  const hasCustomOptions =
    options.volumeAdjustmentPct !== 0 ||
    options.equalizerPreset !== 'None' ||
    options.mediaKind !== 'Music' ||
    options.rating > 0 ||
    options.startTimeEnabled ||
    options.stopTimeEnabled ||
    options.rememberPosition ||
    options.skipWhenShuffling;

  return (
    <div className="rounded-xl bg-slate-50/90 dark:bg-slate-950/90 border border-slate-200 dark:border-slate-800 overflow-hidden">
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-slate-100/80 dark:hover:bg-slate-900/70 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <SlidersHorizontal className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
            Track Options
          </span>
          {hasCustomOptions && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 truncate">
              {[
                options.volumeAdjustmentPct !== 0 ? volLabel : '',
                options.equalizerPreset !== 'None' ? options.equalizerPreset : '',
                options.rating > 0 ? `${options.rating}★` : '',
                options.mediaKind !== 'Music' ? options.mediaKind : '',
              ]
                .filter(Boolean)
                .join(' · ') || 'Custom'}
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
        )}
      </button>

      {isExpanded && (
        <div className="px-3.5 pb-3.5 pt-2 border-t border-slate-200/80 dark:border-slate-800/80 space-y-3 text-xs">
          {/* Volume Adjustment (-100% to +100%) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Volume Adjustment
              </span>
              <button
                type="button"
                onClick={() => onChange({ ...options, volumeAdjustmentPct: 0 })}
                title="Reset Volume Adjustment to None"
                className="font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
              >
                {volLabel}
              </button>
            </div>
            <input
              type="range"
              min={-100}
              max={100}
              step={5}
              value={options.volumeAdjustmentPct}
              onChange={(e) =>
                onChange({
                  ...options,
                  volumeAdjustmentPct: parseInt(e.target.value, 10) || 0,
                })
              }
              aria-label="Volume Adjustment"
              className="w-full h-6 touch-none accent-emerald-500 dark:accent-emerald-400 cursor-pointer"
            />
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400">
              <span>-100%</span>
              <span>None</span>
              <span>+100%</span>
            </div>
          </div>

          {/* Equalizer Preset + Media Kind */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="space-y-1 block">
              <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                Equalizer Preset
              </span>
              <select
                value={options.equalizerPreset}
                onChange={(e) =>
                  onChange({ ...options, equalizerPreset: e.target.value })
                }
                className="w-full min-h-[36px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                {EQUALIZER_PRESETS.map((preset) => (
                  <option key={preset.name} value={preset.name}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 block">
              <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                Media Kind
              </span>
              <select
                value={options.mediaKind}
                onChange={(e) =>
                  onChange({
                    ...options,
                    mediaKind: e.target.value as MediaKindOption,
                  })
                }
                className="w-full min-h-[36px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                {MEDIA_KIND_OPTIONS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Rating (5 stars) */}
          <div className="flex items-center justify-between gap-2 py-0.5">
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Rating
            </span>
            <div className="flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1">
              {[1, 2, 3, 4, 5].map((star) => {
                const filled = options.rating >= star;
                return (
                  <button
                    key={star}
                    type="button"
                    onClick={() =>
                      onChange({
                        ...options,
                        rating: options.rating === star ? 0 : star,
                      })
                    }
                    aria-label={`Rate ${star} ${star === 1 ? 'star' : 'stars'}`}
                    className="p-0.5 cursor-pointer"
                  >
                    <Star
                      className={`w-4 h-4 transition-colors ${
                        filled
                          ? 'text-amber-400 fill-amber-400'
                          : 'text-slate-300 dark:text-slate-600'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Start Time & Stop Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5">
              <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
                <input
                  type="checkbox"
                  checked={options.startTimeEnabled}
                  onChange={(e) =>
                    onChange({ ...options, startTimeEnabled: e.target.checked })
                  }
                  className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Start Time
                </span>
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={startInput}
                  disabled={!options.startTimeEnabled}
                  onChange={(e) => setStartInput(e.target.value)}
                  onBlur={commitStartTime}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitStartTime();
                  }}
                  aria-label="Start Time"
                  className="w-20 min-h-[28px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 text-right font-mono text-xs text-slate-900 dark:text-slate-100 disabled:opacity-50"
                />
                {options.startTimeEnabled && (
                  <button
                    type="button"
                    onClick={() => {
                      const snapped = Number(currentPlayheadSec.toFixed(3));
                      onChange({ ...options, startTimeSec: snapped });
                      setStartInput(formatOptionTimestamp(snapped));
                    }}
                    title="Set Start Time to current playback position"
                    className="px-1.5 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-[10px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    Now
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5">
              <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
                <input
                  type="checkbox"
                  checked={options.stopTimeEnabled}
                  onChange={(e) =>
                    onChange({
                      ...options,
                      stopTimeEnabled: e.target.checked,
                      stopTimeSec:
                        options.stopTimeSec !== undefined
                          ? options.stopTimeSec
                          : trackDurationSec > 0
                          ? Number(trackDurationSec.toFixed(3))
                          : 0,
                    })
                  }
                  className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Stop Time
                </span>
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={stopInput}
                  disabled={!options.stopTimeEnabled}
                  onChange={(e) => setStopInput(e.target.value)}
                  onBlur={commitStopTime}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitStopTime();
                  }}
                  aria-label="Stop Time"
                  className="w-20 min-h-[28px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 text-right font-mono text-xs text-slate-900 dark:text-slate-100 disabled:opacity-50"
                />
                {options.stopTimeEnabled && (
                  <button
                    type="button"
                    onClick={() => {
                      const snapped = Number(Math.max(0.1, currentPlayheadSec).toFixed(3));
                      onChange({ ...options, stopTimeSec: snapped });
                      setStopInput(formatOptionTimestamp(snapped));
                    }}
                    title="Set Stop Time to current playback position"
                    className="px-1.5 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-[10px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    Now
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Checkboxes: Remember playback position & Skip when shuffling */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-5 pt-0.5">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={options.rememberPosition}
                onChange={(e) =>
                  onChange({ ...options, rememberPosition: e.target.checked })
                }
                className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
              />
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Remember playback position
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={options.skipWhenShuffling}
                onChange={(e) =>
                  onChange({ ...options, skipWhenShuffling: e.target.checked })
                }
                className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
              />
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Skip when shuffling
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};
