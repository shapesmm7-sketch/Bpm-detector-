import React, { useState, useEffect } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Copy,
  Check,
  Repeat,
  Sliders,
  Plus,
  Minus,
  Music,
  Download,
  AlertCircle,
} from 'lucide-react';

interface AudioPlayerControlsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  onCue: () => void;
  onRestart: () => void;
  volume: number;
  onVolumeChange: (vol: number) => void;
  pitchPercent: number; // e.g. 0.0 = original, +2.5 = +2.5%
  onPitchChange: (percent: number) => void;
  onPitchBend: (direction: number) => void;
  keySemitones: number; // -12 to +12 integer semitones
  onKeySemitonesChange: (semitones: number) => void;
  onResetKeyShift: () => void;
  onExportAudio: () => void;
  isExporting: boolean;
  exportProgress: number;
  exportStatusMessage: string | null;
  exportErrorMessage: string | null;
  loopBarCount: number; // 0 = off, 1, 2, 4, 8
  onSetLoopBarCount: (bars: number) => void;
  bpm: number;
  liveBpm: number;
  onCopyInfo: () => void;
  copied: boolean;
  onHalfBpm?: () => void;
  onDoubleBpm?: () => void;
}

function formatSemitoneLabel(semitones: number): string {
  const abs = Math.abs(semitones);
  const unit = abs === 1 ? 'semitone' : 'semitones';
  if (semitones > 0) return `+${semitones} ${unit}`;
  if (semitones < 0) return `${semitones} ${unit}`;
  return `0 semitones`;
}

function formatSemitoneSigned(semitones: number): string {
  if (semitones > 0) return `+${semitones}`;
  return `${semitones}`;
}

export const AudioPlayerControls: React.FC<AudioPlayerControlsProps> = ({
  isPlaying,
  onPlayPause,
  onCue,
  onRestart,
  volume,
  onVolumeChange,
  pitchPercent,
  onPitchChange,
  onPitchBend,
  keySemitones,
  onKeySemitonesChange,
  onResetKeyShift,
  onExportAudio,
  isExporting,
  exportProgress,
  exportStatusMessage,
  exportErrorMessage,
  loopBarCount,
  onSetLoopBarCount,
  bpm,
  liveBpm,
  onCopyInfo,
  copied,
}) => {
  const [bpmInputVal, setBpmInputVal] = useState<string>(liveBpm ? liveBpm.toFixed(2) : '');
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const lastPropBpmRef = React.useRef<number>(liveBpm);

  // Sync input value only when liveBpm prop changes from external controls
  useEffect(() => {
    if (liveBpm !== lastPropBpmRef.current) {
      lastPropBpmRef.current = liveBpm;
      if (!isFocused && liveBpm > 0) {
        setBpmInputVal(liveBpm.toFixed(2));
      }
    }
  }, [liveBpm, isFocused]);

  // Convert target BPM to required pitch percentage
  const applyTargetBpm = (targetBpm: number) => {
    const base = bpm > 0 ? bpm : 120;
    if (isNaN(targetBpm) || targetBpm <= 0) return;
    const rawPitchPercent = ((targetBpm / base) - 1) * 100;
    const clamped = Math.max(-50, Math.min(50, rawPitchPercent));
    onPitchChange(Number(clamped.toFixed(2)));
    setBpmInputVal(targetBpm.toFixed(2));
  };

  // Step target BPM up (+1) or down (-1)
  const handleStepBpm = (delta: number) => {
    const current = parseFloat(bpmInputVal) || (liveBpm > 0 ? liveBpm : (bpm > 0 ? bpm : 120));
    const nextBpm = Math.max(30, Math.min(300, Number((current + delta).toFixed(2))));
    applyTargetBpm(nextBpm);
  };

  // Handle direct text editing
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(',', '.');
    if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
    setBpmInputVal(raw);
    const parsed = parseFloat(raw);
    if (!isNaN(parsed) && parsed >= 30 && parsed <= 300) {
      applyTargetBpm(parsed);
    }
  };

  const handleInputBlur = () => {
    setIsFocused(false);
    const parsed = parseFloat(bpmInputVal);
    if (!isNaN(parsed) && parsed >= 30 && parsed <= 300) {
      applyTargetBpm(parsed);
    } else if (liveBpm > 0) {
      setBpmInputVal(liveBpm.toFixed(2));
    }
  };

  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg dark:shadow-2xl space-y-4">
      {/* Top DJ Deck Transport Controls: CUE, PLAY/PAUSE, SYNC */}
      <div className="flex items-center justify-center gap-3.5 pb-2 border-b border-slate-200 dark:border-slate-800/80">
        {/* CUE Button */}
        <button
          type="button"
          onClick={onCue}
          className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-amber-500/15 hover:bg-amber-500/25 dark:bg-amber-500/20 dark:hover:bg-amber-500/30 text-amber-700 dark:text-amber-400 border-2 border-amber-500/50 hover:border-amber-500 dark:hover:border-amber-400 flex flex-col items-center justify-center font-extrabold text-xs shadow-sm dark:shadow-[0_0_20px_rgba(245,158,11,0.25)] active:scale-95 transition-all cursor-pointer select-none shrink-0"
          title="Set / Return to Cue Point"
        >
          <span className="tracking-wider text-xs sm:text-sm">CUE</span>
          <span className="text-[8px] sm:text-[9px] text-amber-600 dark:text-amber-300 font-mono">POINT</span>
        </button>

        {/* PLAY / PAUSE Button */}
        <button
          type="button"
          onClick={onPlayPause}
          className={`w-20 h-20 sm:w-24 sm:h-24 rounded-2xl flex flex-col items-center justify-center font-extrabold transition-all active:scale-95 cursor-pointer select-none border-2 shadow-xl dark:shadow-2xl shrink-0 ${
            isPlaying
              ? 'bg-emerald-500 text-white dark:text-slate-950 border-emerald-400 dark:border-emerald-300 shadow-[0_0_25px_rgba(16,185,129,0.45)] dark:shadow-[0_0_30px_rgba(16,185,129,0.6)] scale-102'
              : 'bg-emerald-500/15 hover:bg-emerald-500/25 dark:bg-emerald-950/80 dark:hover:bg-emerald-900/80 text-emerald-700 dark:text-emerald-400 border-emerald-500/60 shadow-sm dark:shadow-[0_0_20px_rgba(16,185,129,0.25)]'
          }`}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <>
              <Pause className="w-8 h-8 sm:w-10 sm:h-10 fill-current" />
              <span className="text-[10px] sm:text-xs tracking-wider font-mono mt-0.5">PAUSE</span>
            </>
          ) : (
            <>
              <Play className="w-8 h-8 sm:w-10 sm:h-10 fill-current ml-1" />
              <span className="text-[10px] sm:text-xs tracking-wider font-mono mt-0.5">PLAY</span>
            </>
          )}
        </button>

        {/* SYNC / RESET Pitch */}
        <button
          type="button"
          onClick={() => {
            onPitchChange(0);
          }}
          className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white hover:bg-slate-100 dark:bg-slate-950 dark:hover:bg-slate-800 text-cyan-700 dark:text-cyan-400 border-2 border-cyan-500/40 hover:border-cyan-500 dark:hover:border-cyan-400 flex flex-col items-center justify-center font-bold text-xs transition-all cursor-pointer shrink-0 shadow-sm dark:shadow-[0_0_15px_rgba(6,182,212,0.15)] active:scale-95"
          title="Reset Tempo to 0.0%"
        >
          <span className="tracking-wider text-xs sm:text-sm">SYNC</span>
          <span className="text-[9px] sm:text-[10px] text-cyan-600 dark:text-cyan-300 font-mono">0.0%</span>
        </button>
      </div>

      {/* Main DJ Deck Controls: Tempo Pitch Fader, Song Key Changer, Loop Roll */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4 items-stretch">
        {/* 1. Tempo/Bpm Changer */}
        <div
          id="studio-tempo-section"
          className="order-1 xl:col-span-8 bg-white dark:bg-slate-950 p-3.5 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3 scroll-mt-20"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-600 dark:text-slate-400 font-medium flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
              <span>Tempo/Bpm Changer</span>
            </span>
            <div className="flex items-center gap-1.5 font-mono tabular-nums text-xs font-bold">
              <span
                className={
                  pitchPercent === 0
                    ? 'text-slate-500 dark:text-slate-400'
                    : pitchPercent > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }
              >
                {pitchPercent > 0 ? `+${pitchPercent.toFixed(1)}%` : `${pitchPercent.toFixed(1)}%`}
              </span>
            </div>
          </div>

          {/* Direct BPM Controls: (-) Button, Editable Target Input, (+) Button */}
          <div className="bg-slate-50 dark:bg-slate-900/90 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-inner space-y-1.5 sm:space-y-0 sm:flex sm:items-center sm:justify-between sm:gap-3">
            <span className="block text-[10px] sm:text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase font-mono tracking-wider shrink-0">
              Set Tempo (BPM)
            </span>

            <div className="flex items-center gap-2 flex-1 sm:max-w-[230px]">
              {/* - Button */}
              <button
                type="button"
                onClick={() => handleStepBpm(-1)}
                className="w-9 h-9 rounded-lg bg-white hover:bg-slate-100 dark:bg-slate-950 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-mono font-black text-base flex items-center justify-center border border-slate-200 dark:border-slate-800 transition-all cursor-pointer active:scale-95 shrink-0 shadow-sm"
                title="Decrease Tempo (-1 BPM)"
              >
                <Minus className="w-4 h-4 text-slate-700 dark:text-slate-300" />
              </button>

              {/* Clean Editable Target BPM Input */}
              <div className="flex-1 min-w-[96px] flex items-center justify-center bg-white dark:bg-slate-950 px-2 py-1 rounded-lg border border-emerald-500/50 dark:border-emerald-500/40 focus-within:border-emerald-500 dark:focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-500 dark:focus-within:ring-emerald-400 shadow-inner">
                <input
                  type="text"
                  inputMode="decimal"
                  value={bpmInputVal}
                  onFocus={() => setIsFocused(true)}
                  onChange={handleInputChange}
                  onBlur={handleInputBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="w-full min-w-0 bg-transparent text-emerald-700 dark:text-emerald-400 font-mono tabular-nums font-black text-center text-base sm:text-sm py-0.5 border-none focus:outline-none"
                  placeholder="120.00"
                  title="Tap to type exact target BPM"
                />
              </div>

              {/* + Button */}
              <button
                type="button"
                onClick={() => handleStepBpm(1)}
                className="w-9 h-9 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 dark:bg-emerald-500/20 dark:hover:bg-emerald-500/30 text-emerald-700 dark:text-emerald-400 font-mono font-black text-base flex items-center justify-center border border-emerald-500/40 transition-all cursor-pointer active:scale-95 shrink-0 shadow-sm"
                title="Increase Tempo (+1 BPM)"
              >
                <Plus className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              </button>
            </div>
          </div>

          {/* Tempo Fader Slider */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onPitchBend(-0.2)}
                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold rounded border border-slate-200 dark:border-slate-800 cursor-pointer"
                title="Pitch Bend -"
              >
                -
              </button>
              <input
                type="range"
                min="-50"
                max="50"
                step="0.1"
                value={pitchPercent}
                onChange={(e) => onPitchChange(parseFloat(e.target.value))}
                className="flex-1 accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
              />
              <button
                type="button"
                onClick={() => onPitchBend(0.2)}
                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold rounded border border-slate-200 dark:border-slate-800 cursor-pointer"
                title="Pitch Bend +"
              >
                +
              </button>
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
              <span>-50%</span>
              <button
                type="button"
                onClick={() => onPitchChange(0)}
                className="text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white underline cursor-pointer"
              >
                CENTER (0.0%)
              </button>
              <span>+50%</span>
            </div>
          </div>
        </div>

        {/* 2. Song Key Changer (Pitch Shifter directly after Tempo Fader on mobile, full-width below on desktop) */}
        <div
          id="studio-key-section"
          className="order-2 md:col-span-2 xl:order-3 xl:col-span-12 bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-4 scroll-mt-20"
        >
          {/* Header Row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Music className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 leading-tight">
                  Song Key Changer
                </h4>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Pitch Shifter
                </p>
              </div>
            </div>

            <div className="font-mono tabular-nums text-xs sm:text-sm font-bold">
              <span
                className={
                  keySemitones === 0
                    ? 'text-slate-700 dark:text-slate-300'
                    : keySemitones > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }
              >
                {formatSemitoneLabel(keySemitones)}
              </span>
            </div>
          </div>

          {/* Semitone Stepper (- / Readout / +) + Slider */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
            {/* Stepper Controls */}
            <div className="lg:col-span-5 flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-900/90 p-2 rounded-xl border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => onKeySemitonesChange(Math.max(-12, keySemitones - 1))}
                disabled={keySemitones <= -12}
                aria-label="Decrease pitch by 1 semitone"
                className="min-w-[44px] min-h-[44px] rounded-lg bg-white hover:bg-slate-100 dark:bg-slate-950 dark:hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none text-slate-700 dark:text-slate-200 flex items-center justify-center border border-slate-200 dark:border-slate-800 transition-colors cursor-pointer active:scale-95 shrink-0"
                title="Pitch Down (-1 semitone)"
              >
                <Minus className="w-4 h-4" />
              </button>

              <div className="flex-1 text-center px-2 py-1">
                <div
                  className={`font-mono tabular-nums text-xl sm:text-2xl font-black leading-none ${
                    keySemitones === 0
                      ? 'text-slate-900 dark:text-slate-100'
                      : keySemitones > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {formatSemitoneSigned(keySemitones)}
                </div>
                <div className="text-[10px] font-mono text-slate-600 dark:text-slate-400 mt-1">
                  {keySemitones === 0 ? 'original pitch' : Math.abs(keySemitones) === 1 ? 'semitone' : 'semitones'}
                </div>
              </div>

              <button
                type="button"
                onClick={() => onKeySemitonesChange(Math.min(12, keySemitones + 1))}
                disabled={keySemitones >= 12}
                aria-label="Increase pitch by 1 semitone"
                className="min-w-[44px] min-h-[44px] rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 dark:bg-emerald-500/20 dark:hover:bg-emerald-500/30 disabled:opacity-40 disabled:pointer-events-none text-emerald-700 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/40 transition-colors cursor-pointer active:scale-95 shrink-0"
                title="Pitch Up (+1 semitone)"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* Semitone Range Slider (-12 to +12) */}
            <div className="lg:col-span-7 space-y-1.5">
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="1"
                  value={keySemitones}
                  onChange={(e) => onKeySemitonesChange(parseInt(e.target.value, 10))}
                  aria-label="Pitch shift in semitones"
                  className="w-full h-2 accent-emerald-500 dark:accent-emerald-400 cursor-pointer"
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                <span>-12 st</span>
                <button
                  type="button"
                  onClick={onResetKeyShift}
                  className="text-slate-700 hover:text-emerald-600 dark:text-slate-300 dark:hover:text-emerald-400 underline cursor-pointer px-2 py-0.5"
                >
                  Center (0)
                </button>
                <span>+12 st</span>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Right: Quick Loop Pads */}
        <div className="order-3 xl:order-2 xl:col-span-4 flex flex-col justify-center space-y-2">
          {/* Loop Roll Controls */}
          <div className="flex flex-col gap-2 bg-white dark:bg-slate-950 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 h-full justify-center">
            <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 font-semibold">
              <Repeat className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Loop Roll</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5 pt-1">
              {[0, 1, 2, 4, 8].map((bars) => (
                <button
                  key={bars}
                  type="button"
                  onClick={() => onSetLoopBarCount(bars)}
                  className={`py-2 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                    loopBarCount === bars
                      ? 'bg-emerald-500 text-white dark:text-slate-950 shadow-md font-black'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-900 border border-slate-200 dark:border-slate-800/80'
                  }`}
                >
                  {bars === 0 ? 'OFF' : `${bars}B`}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Utility Strip: Volume + Restart + Copy Details */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800/80 text-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onRestart}
            className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 dark:bg-slate-950 dark:hover:bg-slate-800 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Jump to Start (0:00)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Top of Track</span>
          </button>

          {/* Volume */}
          <div className="flex items-center gap-2 bg-white dark:bg-slate-950 px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => onVolumeChange(volume > 0 ? 0 : 1)}
              className="text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
            >
              {volume === 0 ? (
                <VolumeX className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
              className="w-20 accent-emerald-500 cursor-pointer"
            />
            <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400 text-[11px] w-7 text-right">
              {Math.round(volume * 100)}%
            </span>
          </div>
        </div>

        {/* Copy Results */}
        <button
          type="button"
          onClick={onCopyInfo}
          className="px-3.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 dark:bg-slate-950 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-emerald-600 dark:text-emerald-400 font-bold">BPM Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy Song BPM ({liveBpm.toFixed(2)})</span>
            </>
          )}
        </button>
      </div>

      {/* Unified Bottom Download Action (Exports both Tempo/BPM and Song Key changes) */}
      <div className="pt-3 border-t border-slate-200 dark:border-slate-800/80 space-y-2.5">
        <button
          type="button"
          onClick={onExportAudio}
          disabled={isExporting}
          className="w-full min-h-[48px] px-4 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 dark:bg-emerald-400 dark:hover:bg-emerald-300 disabled:opacity-70 text-white dark:text-slate-950 transition-colors cursor-pointer active:scale-95 whitespace-nowrap shadow-lg shadow-emerald-500/15"
        >
          {isExporting ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white dark:border-slate-900/30 dark:border-t-slate-950 rounded-full animate-spin" />
              <span className="font-mono tabular-nums">Saving {exportProgress}%</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4 shrink-0" />
              <span className="truncate">
                Download ({(liveBpm > 0 ? liveBpm : bpm).toFixed(2)} BPM · {formatSemitoneSigned(keySemitones)} st)
              </span>
            </>
          )}
        </button>

        {isExporting && (
          <div className="space-y-1.5">
            <div className="w-full h-2 bg-slate-200 dark:bg-slate-950 rounded-full overflow-hidden border border-slate-300 dark:border-slate-800">
              <div
                className="h-full bg-emerald-500 dark:bg-emerald-400 transition-all duration-150"
                style={{ width: `${exportProgress}%` }}
              />
            </div>
            <p className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
              Processing tempo &amp; key changes locally ({exportProgress}%)...
            </p>
          </div>
        )}

        {exportStatusMessage && !isExporting && (
          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="break-all">{exportStatusMessage}</span>
          </div>
        )}

        {exportErrorMessage && !isExporting && (
          <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{exportErrorMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
};
