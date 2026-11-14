import React, { useRef, useEffect, useState } from 'react';
import { Volume2, RefreshCw, ZoomIn, ZoomOut, Disc } from 'lucide-react';

interface WaveformVisualizerProps {
  audioBuffer: AudioBuffer | null;
  bpm: number;
  firstBeatOffset: number;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
  cuePoint: number;
  onSeek: (time: number) => void;
  onOffsetChange: (offset: number) => void;
  loopRegion: { start: number; end: number } | null;
  onLoopChange: (region: { start: number; end: number } | null) => void;
  isDarkMode?: boolean;
}

export const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
  audioBuffer,
  bpm,
  firstBeatOffset,
  currentTime,
  duration,
  isPlaying,
  playbackRate,
  cuePoint,
  onSeek,
  onOffsetChange,
  loopRegion,
  onLoopChange,
  isDarkMode = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(2); // 1x to 6x
  const [customOffset, setCustomOffset] = useState<number>(firstBeatOffset);
  const [jogRotation, setJogRotation] = useState<number>(0);

  useEffect(() => {
    setCustomOffset(firstBeatOffset);
  }, [firstBeatOffset]);

  // Jog wheel rotation ticker in sync with BPM
  useEffect(() => {
    if (!isPlaying || bpm <= 0) return;
    let animId: number;
    let lastTime = performance.now();

    const animateJog = (now: number) => {
      const deltaSec = (now - lastTime) / 1000;
      lastTime = now;
      // Degrees per second = (BPM / 60) * 360 * playbackRate (1 full rotation per beat)
      const degDelta = (bpm / 60) * 360 * playbackRate * deltaSec;
      setJogRotation((prev) => (prev + degDelta) % 360);
      animId = requestAnimationFrame(animateJog);
    };

    animId = requestAnimationFrame(animateJog);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, bpm, playbackRate]);

  // Render Full Overview Track Strip
  useEffect(() => {
    const canvas = overviewCanvasRef.current;
    if (!canvas || !audioBuffer) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Theme-aware background
    ctx.fillStyle = isDarkMode ? '#080c14' : '#f1f5f9';
    ctx.fillRect(0, 0, width, height);

    const channelData = audioBuffer.getChannelData(0);
    const totalSamples = channelData.length;
    const step = Math.ceil(totalSamples / width);

    // Waveform envelope
    ctx.fillStyle = '#0284c7';
    const centerY = height / 2;

    for (let x = 0; x < width; x++) {
      const sampleIdx = x * step;
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j += 6) {
        const val = channelData[sampleIdx + j] || 0;
        if (val < min) min = val;
        if (val > max) max = val;
      }
      const topY = centerY - max * (centerY - 2);
      const bottomY = centerY - min * (centerY - 2);
      ctx.fillRect(x, topY, 1, Math.max(1, bottomY - topY));
    }

    // Loop region in overview
    if (loopRegion && duration > 0) {
      const x1 = (loopRegion.start / duration) * width;
      const x2 = (loopRegion.end / duration) * width;
      ctx.fillStyle = 'rgba(16, 185, 129, 0.3)';
      ctx.fillRect(x1, 0, x2 - x1, height);
    }

    // Cue Point flag
    if (cuePoint > 0 && duration > 0) {
      const cueX = (cuePoint / duration) * width;
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(cueX - 1, 0, 2, height);
      // Small triangle
      ctx.beginPath();
      ctx.moveTo(cueX - 4, 0);
      ctx.lineTo(cueX + 4, 0);
      ctx.lineTo(cueX, 6);
      ctx.fill();
    }

    // Playhead line
    if (duration > 0) {
      const curX = (currentTime / duration) * width;
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(curX - 1, 0, 2, height);
    }
  }, [audioBuffer, currentTime, duration, loopRegion, cuePoint]);

  // Render Detailed Scrolling Beat Grid Waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Theme-aware background
    ctx.fillStyle = isDarkMode ? '#060910' : '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    // Subtle horizontal center grid lines
    ctx.strokeStyle = isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(15, 23, 42, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    const channelData = audioBuffer.getChannelData(0);
    const totalSamples = channelData.length;
    const samplesPerPixel = Math.floor(totalSamples / (width * zoomLevel));

    // View window centered on currentTime when zoomed
    let startSample = 0;
    if (zoomLevel > 1 && duration > 0) {
      const currentSample = Math.floor((currentTime / duration) * totalSamples);
      const halfViewSamples = (width * samplesPerPixel) / 2;
      startSample = Math.max(0, Math.min(totalSamples - width * samplesPerPixel, currentSample - halfViewSamples));
    }

    const startSec = (startSample / totalSamples) * duration;
    const visibleDuration = ((width * samplesPerPixel) / totalSamples) * duration;
    const centerY = height / 2;

    // Draw Loop bounds
    if (loopRegion) {
      const loopX1 = ((loopRegion.start - startSec) / visibleDuration) * width;
      const loopX2 = ((loopRegion.end - startSec) / visibleDuration) * width;

      ctx.fillStyle = 'rgba(16, 185, 129, 0.18)';
      ctx.fillRect(loopX1, 0, loopX2 - loopX1, height);

      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(loopX1, 0); ctx.lineTo(loopX1, height);
      ctx.moveTo(loopX2, 0); ctx.lineTo(loopX2, height);
      ctx.stroke();
    }

    // Draw Waveform bars (Tri-band color: Bass/Mid/High)
    for (let x = 0; x < width; x++) {
      const sampleIndex = Math.floor(startSample + x * samplesPerPixel);
      if (sampleIndex >= totalSamples) break;

      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < samplesPerPixel; j += 4) {
        const val = channelData[sampleIndex + j] || 0;
        if (val < min) min = val;
        if (val > max) max = val;
      }

      const amp = Math.max(Math.abs(min), Math.abs(max));
      const topY = centerY - max * (centerY - 8);
      const bottomY = centerY - min * (centerY - 8);

      // Dynamic waveform gradient based on energy
      if (amp > 0.6) {
        ctx.fillStyle = '#06b6d4'; // High intensity Cyan
      } else if (amp > 0.3) {
        ctx.fillStyle = '#0284c7'; // Mid Blue
      } else {
        ctx.fillStyle = '#1e3a8a'; // Deep Bass Indigo
      }

      ctx.fillRect(x, topY, 1, Math.max(1, bottomY - topY));
    }

    // Render Beat Grid Lines
    if (bpm > 0) {
      const beatPeriodSec = 60 / bpm;
      const endSec = startSec + visibleDuration;

      let currentBeatSec = customOffset;
      while (currentBeatSec < startSec) {
        currentBeatSec += beatPeriodSec;
      }

      let beatCount = Math.floor((currentBeatSec - customOffset) / beatPeriodSec);

      while (currentBeatSec <= endSec) {
        const beatX = ((currentBeatSec - startSec) / visibleDuration) * width;
        const isDownbeat = beatCount % 4 === 0;

        ctx.beginPath();
        ctx.lineWidth = isDownbeat ? 2 : 1;
        ctx.strokeStyle = isDownbeat ? '#ef4444' : 'rgba(56, 189, 248, 0.6)';

        ctx.moveTo(beatX, 0);
        ctx.lineTo(beatX, height);
        ctx.stroke();

        // Beat numbers in header
        ctx.fillStyle = isDownbeat ? '#ef4444' : 'rgba(148, 163, 184, 0.7)';
        ctx.font = '10px "JetBrains Mono", monospace';
        const beatNum = (beatCount % 4) + 1;
        ctx.fillText(`${beatNum}`, beatX + 3, 13);

        beatCount++;
        currentBeatSec += beatPeriodSec;
      }
    }

    // Cue Point Marker
    if (cuePoint >= startSec && cuePoint <= startSec + visibleDuration) {
      const cueX = ((cuePoint - startSec) / visibleDuration) * width;
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cueX, 0);
      ctx.lineTo(cueX, height);
      ctx.stroke();

      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.fillText('CUE', cueX + 3, height - 8);
    }

    // Center Playhead
    const playheadX = ((currentTime - startSec) / visibleDuration) * width;
    if (playheadX >= 0 && playheadX <= width) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      // Top triangle pointer
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(playheadX - 6, 0);
      ctx.lineTo(playheadX + 6, 0);
      ctx.lineTo(playheadX, 9);
      ctx.fill();
    }
  }, [audioBuffer, bpm, customOffset, currentTime, duration, zoomLevel, loopRegion, cuePoint, isDarkMode]);

  // Click on main waveform to seek
  const handleMainCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !duration) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = clickX / rect.width;

    if (zoomLevel === 1) {
      onSeek(ratio * duration);
    } else {
      const visibleDuration = duration / zoomLevel;
      const startSec = Math.max(0, Math.min(duration - visibleDuration, currentTime - visibleDuration / 2));
      onSeek(startSec + ratio * visibleDuration);
    }
  };

  // Click on overview strip to jump
  const handleOverviewClick = (e: React.MouseEvent<HTMLElement>) => {
    const canvas = overviewCanvasRef.current;
    if (!canvas || !duration) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    onSeek(ratio * duration);
  };

  const handleNudgeOffset = (deltaSec: number) => {
    const newOff = Math.max(0, Number((customOffset + deltaSec).toFixed(3)));
    setCustomOffset(newOff);
    onOffsetChange(newOff);
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm dark:shadow-2xl space-y-3 transition-colors">
      {/* Waveform Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100">
            <Volume2 className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
            <span>Beat-Grid Waveform</span>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-slate-600 dark:text-slate-400 font-mono text-[11px] bg-slate-100 dark:bg-slate-950 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800">
            <span>GRID:</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-bold">{bpm > 0 ? `${bpm} BPM` : '--'}</span>
            <span>·</span>
            <span className="text-cyan-600 dark:text-cyan-400">OFFSET: {(customOffset * 1000).toFixed(0)}ms</span>
          </div>
        </div>

        {/* Nudge Grid & Zoom Controls */}
        <div className="flex items-center gap-2">
          {/* Nudge beat offset */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-950 px-1.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800">
            <span className="text-slate-600 dark:text-slate-400 text-[10px] uppercase font-semibold">Grid Shift:</span>
            <button
              onClick={() => handleNudgeOffset(-0.01)}
              className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-transparent font-mono text-[10px] transition-colors cursor-pointer"
              title="Shift beat grid -10ms"
            >
              -10ms
            </button>
            <button
              onClick={() => handleNudgeOffset(0.01)}
              className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-transparent font-mono text-[10px] transition-colors cursor-pointer"
              title="Shift beat grid +10ms"
            >
              +10ms
            </button>
            <button
              onClick={() => {
                setCustomOffset(firstBeatOffset);
                onOffsetChange(firstBeatOffset);
              }}
              className="p-1 rounded text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
              title="Reset offset"
            >
              <RefreshCw className="w-2.5 h-2.5" />
            </button>
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-950 px-1.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setZoomLevel((z) => Math.max(1, z - 1))}
              className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded transition-colors cursor-pointer"
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-slate-800 dark:text-slate-300 font-mono text-xs px-1 font-bold">{zoomLevel}x</span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(6, z + 1))}
              className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded transition-colors cursor-pointer"
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Detailed Waveform Canvas */}
      <div className="relative w-full h-32 bg-slate-50 dark:bg-slate-950 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 cursor-pointer shadow-inner">
        <canvas
          ref={canvasRef}
          width={1000}
          height={128}
          onClick={handleMainCanvasClick}
          className="w-full h-full block"
        />

        {!audioBuffer && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs font-semibold">
            Drop an audio track above to load waveform &amp; beat grid
          </div>
        )}
      </div>

      {/* Full Track Overview Mini-Strip */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 font-mono">
          <span>TRACK OVERVIEW (CLICK TO JUMP)</span>
          <span>{Math.floor(duration / 60)}:{Math.floor(duration % 60).toString().padStart(2, '0')} TOTAL</span>
        </div>
        <div
          onClick={handleOverviewClick}
          className="relative w-full h-8 bg-slate-100 dark:bg-slate-950 rounded border border-slate-200 dark:border-slate-800 overflow-hidden cursor-pointer hover:border-slate-300 dark:hover:border-slate-700 transition-colors shadow-inner"
        >
          <canvas
            ref={overviewCanvasRef}
            width={1000}
            height={32}
            className="w-full h-full block"
          />
        </div>
      </div>

      {/* Legend & Jog Indicator */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-[11px] text-slate-600 dark:text-slate-400">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
            Beat 1 (Downbeat)
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 dark:bg-cyan-400 inline-block" />
            Beats 2, 3, 4
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <span className="w-2.5 h-2.5 rounded bg-amber-500 inline-block" />
            Cue Point
          </span>
        </div>

        {/* Real-time Spinning Jog Indicator */}
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <div
            style={{ transform: `rotate(${jogRotation}deg)` }}
            className="w-4 h-4 rounded-full border-2 border-dashed border-emerald-500 dark:border-emerald-400 flex items-center justify-center transition-transform"
          >
            <div className="w-1 h-1 rounded-full bg-emerald-500 dark:bg-emerald-400" />
          </div>
          <span className={isPlaying ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-slate-500'}>
            {isPlaying ? 'PLATTEN ACTIVE' : 'STOPPED'}
          </span>
        </div>
      </div>
    </div>
  );
};
