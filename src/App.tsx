import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { SongUploader } from './components/SongUploader';
import { WaveformVisualizer } from './components/WaveformVisualizer';
import { AudioPlayerControls } from './components/AudioPlayerControls';
import { HistoryLogPanel, HistoryItem } from './components/HistoryLogPanel';
import { MenuPanel } from './components/MenuPanel';

import {
  getAudioContext,
  decodeAudioData,
  extractId3Bpm,
  detectBPM,
  BpmAnalysisResult,
} from './utils/audioAnalyzer';

import { Music, Play, Pause } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'analyzer' | 'menu' | 'history'>('analyzer');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Audio Track State
  const [trackName, setTrackName] = useState<string>('');
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [bpmResult, setBpmResult] = useState<BpmAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // DJ Engine & Playback State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(0.85);
  const [pitchPercent, setPitchPercent] = useState<number>(0); // -50% to +50% tempo
  const [cuePoint, setCuePoint] = useState<number>(0);
  const [loopBarCount, setLoopBarCount] = useState<number>(0);
  const [loopRegion, setLoopRegion] = useState<{ start: number; end: number } | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // History State
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('pulsebpm_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Web Audio Nodes
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const playbackStartTimeRef = useRef<number>(0);
  const startOffsetRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);

  // Effective playback rate from pitch slider
  const playbackRate = 1 + pitchPercent / 100;
  // Live dynamic BPM based on pitch slider
  const liveBpm = bpmResult ? bpmResult.bpm * playbackRate : 0;

  // Save history
  useEffect(() => {
    try {
      localStorage.setItem('pulsebpm_history', JSON.stringify(history));
    } catch (e) {
      console.warn('History save error', e);
    }
  }, [history]);

  // Stop audio playback
  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {
        // already stopped
      }
      sourceNodeRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setIsPlaying(false);
  };

  // Play audio buffer from specific offset
  const playAudio = (startSec: number = currentTime) => {
    if (!audioBuffer) return;

    stopAudio();

    const ctx = getAudioContext();
    audioCtxRef.current = ctx;

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = playbackRate;

    const gain = ctx.createGain();
    gain.gain.value = volume;
    gainNodeRef.current = gain;

    source.connect(gain);
    gain.connect(ctx.destination);

    const validStart = Math.max(0, Math.min(audioBuffer.duration, startSec));
    source.start(0, validStart);

    playbackStartTimeRef.current = ctx.currentTime;
    startOffsetRef.current = validStart;
    sourceNodeRef.current = source;
    setIsPlaying(true);

    const tick = () => {
      if (!sourceNodeRef.current || !audioBuffer) return;
      const elapsed = (ctx.currentTime - playbackStartTimeRef.current) * playbackRate;
      const nowPos = startOffsetRef.current + elapsed;

      if (loopRegion && nowPos >= loopRegion.end) {
        playAudio(loopRegion.start);
        return;
      }

      if (nowPos >= audioBuffer.duration) {
        stopAudio();
        setCurrentTime(0);
        return;
      }

      setCurrentTime(nowPos);
      animFrameRef.current = requestAnimationFrame(tick);
    };

    tick();
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      stopAudio();
    } else {
      playAudio(currentTime);
    }
  };

  const handleCue = () => {
    if (isPlaying) {
      stopAudio();
      setCurrentTime(cuePoint);
    } else {
      setCuePoint(currentTime);
    }
  };

  const handleSeek = (newTimeSec: number) => {
    setCurrentTime(newTimeSec);
    if (isPlaying) {
      playAudio(newTimeSec);
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = newVol;
    }
  };

  const handlePitchChange = (percent: number) => {
    const clamped = Math.max(-50, Math.min(50, percent));
    setPitchPercent(clamped);
    const newRate = 1 + clamped / 100;
    if (sourceNodeRef.current) {
      sourceNodeRef.current.playbackRate.value = newRate;
    }
  };

  const handlePitchBend = (delta: number) => {
    handlePitchChange(Number((pitchPercent + delta).toFixed(1)));
  };

  const handleSetLoopBarCount = (bars: number) => {
    setLoopBarCount(bars);
    if (bars === 0 || !bpmResult) {
      setLoopRegion(null);
    } else {
      const beatPeriod = 60 / liveBpm;
      const loopDuration = beatPeriod * 4 * bars;
      const start = currentTime;
      const end = Math.min(duration, start + loopDuration);
      setLoopRegion({ start, end });
    }
  };

  const handleHalfBpm = () => {
    if (!bpmResult) return;
    const newBpm = Number((bpmResult.bpm / 2).toFixed(2));
    setBpmResult({
      ...bpmResult,
      bpm: newBpm,
      bpmFormatted: newBpm.toFixed(2),
      halfTimeBpm: Number((newBpm / 2).toFixed(2)),
      doubleTimeBpm: Number((newBpm * 2).toFixed(2)),
    });
  };

  const handleDoubleBpm = () => {
    if (!bpmResult) return;
    const newBpm = Number((bpmResult.bpm * 2).toFixed(2));
    setBpmResult({
      ...bpmResult,
      bpm: newBpm,
      bpmFormatted: newBpm.toFixed(2),
      halfTimeBpm: Number((newBpm / 2).toFixed(2)),
      doubleTimeBpm: Number((newBpm * 2).toFixed(2)),
    });
  };

  const handleSelectCandidate = (candidateBpm: number) => {
    if (!bpmResult) return;
    setBpmResult({
      ...bpmResult,
      bpm: candidateBpm,
      bpmFormatted: candidateBpm.toFixed(2),
      halfTimeBpm: Number((candidateBpm / 2).toFixed(2)),
      doubleTimeBpm: Number((candidateBpm * 2).toFixed(2)),
    });
  };

  // Instant accurate audio processing
  const processAudioBuffer = async (buffer: AudioBuffer, title: string, id3Bpm?: number | null) => {
    stopAudio();
    setIsAnalyzing(true);
    setAnalysisError(null);
    setTrackName(title);
    setAudioBuffer(buffer);
    setDuration(buffer.duration);
    setCurrentTime(0);
    setCuePoint(0);
    setPitchPercent(0);

    try {
      // Accurate multi-engine BPM detection
      const bpm = await detectBPM(buffer, id3Bpm);
      setBpmResult(bpm);

      // Session history
      const historyEntry: HistoryItem = {
        id: Date.now().toString(),
        name: title,
        bpm: bpm.bpm,
        durationSec: buffer.duration,
        confidence: bpm.confidence,
        timestamp: Date.now(),
      };
      setHistory(prev => [historyEntry, ...prev.filter(item => item.name !== title).slice(0, 19)]);
    } catch (err) {
      console.error('Audio detection error:', err);
      setAnalysisError('Could not process audio track. Please try a different audio file.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // File Upload handler
  const handleFileSelected = async (file: File) => {
    try {
      setIsAnalyzing(true);
      setAnalysisError(null);
      const arrayBuf = await file.arrayBuffer();

      // Read ID3v2 TBPM tag if present (instant studio master check)
      const id3Bpm = extractId3Bpm(arrayBuf);

      // Decode audio
      const decodedBuf = await decodeAudioData(arrayBuf);
      const cleanTitle = file.name.replace(/\.[^/.]+$/, '');

      await processAudioBuffer(decodedBuf, cleanTitle, id3Bpm);
    } catch (err) {
      console.error('File decode failed:', err);
      setAnalysisError('Failed to decode audio file. Make sure it is a valid MP3, WAV, or audio file.');
      setIsAnalyzing(false);
    }
  };

  // Open file dialog when user clicks "Upload Song" anywhere
  const handleOpenUpload = () => {
    setActiveTab('analyzer');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  // Copy info
  const handleCopyInfo = () => {
    if (!bpmResult) return;
    const text = `Track: ${trackName || 'Audio Track'}\nBPM: ${liveBpm.toFixed(2)} (Original: ${bpmResult.bpmFormatted})\nDuration: ${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, '0')}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Universal Hidden File Input - Always Available */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac,.webm"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            handleFileSelected(e.target.files[0]);
          }
        }}
      />

      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {activeTab === 'analyzer' && (
          <div className="space-y-6">
            {/* Song Upload Area */}
            <SongUploader
              onFileSelected={handleFileSelected}
              onTriggerUpload={handleOpenUpload}
              isAnalyzing={isAnalyzing}
              error={analysisError}
              loadedTrackName={trackName}
              loadedBpm={bpmResult?.bpm}
            />

            {/* HERO BPM DISPLAY */}
            {bpmResult && (
              <div className="bg-slate-900 border-2 border-emerald-500/40 rounded-3xl p-6 sm:p-8 shadow-[0_0_50px_rgba(16,185,129,0.15)] space-y-6 text-center">
                {/* Track Title Banner */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pb-4 border-b border-slate-800 text-xs">
                  <div className="flex items-center gap-2">
                    <Music className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="font-bold text-slate-200 text-sm truncate max-w-md">
                      {trackName || 'Audio Track'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-400 font-mono text-xs">
                    <span>{Math.floor(duration / 60)}:{Math.floor(duration % 60).toString().padStart(2, '0')}</span>
                    <span>·</span>
                    <span className="text-emerald-400 font-semibold">{bpmResult.source}</span>
                  </div>
                </div>

                {/* THE CORE BPM HERO */}
                <div className="py-2 space-y-3">
                  <span className="text-xs font-mono uppercase tracking-widest text-slate-400 font-bold block">
                    DETECTED SONG BPM
                  </span>

                  <div className="flex items-center justify-center gap-4 sm:gap-6">
                    {/* /2 button */}
                    <button
                      onClick={handleHalfBpm}
                      className="px-3.5 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-emerald-400 text-xs sm:text-sm font-mono font-bold transition-colors cursor-pointer"
                      title="Halve BPM (/ 2)"
                    >
                      / 2
                    </button>

                    {/* Massive BPM Number */}
                    <div className="flex items-baseline justify-center gap-2">
                      <span className="text-6xl sm:text-8xl md:text-9xl font-black font-mono tracking-tight text-white drop-shadow-[0_0_30px_rgba(16,185,129,0.35)] select-all">
                        {liveBpm > 0 ? liveBpm.toFixed(2) : bpmResult.bpmFormatted}
                      </span>
                      <span className="text-lg sm:text-2xl font-bold font-mono text-emerald-400">
                        BPM
                      </span>
                    </div>

                    {/* x2 button */}
                    <button
                      onClick={handleDoubleBpm}
                      className="px-3.5 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-emerald-400 text-xs sm:text-sm font-mono font-bold transition-colors cursor-pointer"
                      title="Double BPM (x 2)"
                    >
                      x 2
                    </button>
                  </div>

                  {/* Pitch-adjusted live BPM indicator */}
                  {pitchPercent !== 0 && (
                    <div className="text-xs font-mono text-cyan-400 font-bold">
                      Original Tempo: {bpmResult.bpmFormatted} BPM ({pitchPercent > 0 ? `+${pitchPercent.toFixed(1)}%` : `${pitchPercent.toFixed(1)}%`} pitch shift)
                    </div>
                  )}
                </div>



                {/* Waveform Beat Grid Visualizer */}
                {audioBuffer && (
                  <div className="pt-2 text-left">
                    <WaveformVisualizer
                      audioBuffer={audioBuffer}
                      bpm={liveBpm}
                      firstBeatOffset={bpmResult.firstBeatOffset}
                      currentTime={currentTime}
                      duration={duration}
                      isPlaying={isPlaying}
                      playbackRate={playbackRate}
                      cuePoint={cuePoint}
                      onSeek={handleSeek}
                      onOffsetChange={(newOffset) => {
                        setBpmResult(prev => prev ? { ...prev, firstBeatOffset: newOffset } : null);
                      }}
                      loopRegion={loopRegion}
                      onLoopChange={setLoopRegion}
                    />
                  </div>
                )}

                {/* DJ Player Controls & Pitch Fader */}
                {audioBuffer && (
                  <div className="text-left">
                    <AudioPlayerControls
                      isPlaying={isPlaying}
                      onPlayPause={handlePlayPause}
                      onCue={handleCue}
                      onRestart={() => handleSeek(0)}
                      volume={volume}
                      onVolumeChange={handleVolumeChange}
                      pitchPercent={pitchPercent}
                      onPitchChange={handlePitchChange}
                      onPitchBend={handlePitchBend}
                      loopBarCount={loopBarCount}
                      onSetLoopBarCount={handleSetLoopBarCount}
                      bpm={bpmResult.bpm}
                      liveBpm={liveBpm}
                      onCopyInfo={handleCopyInfo}
                      copied={copied}
                      onHalfBpm={handleHalfBpm}
                      onDoubleBpm={handleDoubleBpm}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Full Menu Page View */}
        {activeTab === 'menu' && (
          <MenuPanel
            onNavigate={setActiveTab}
            historyCount={history.length}
          />
        )}

        {/* Tab 3: History View */}
        {activeTab === 'history' && (
          <div className="max-w-3xl mx-auto">
            <HistoryLogPanel
              history={history}
              onClearHistory={() => setHistory([])}
              onRemoveItem={(id) => setHistory(prev => prev.filter(item => item.id !== id))}
              onBackToAnalyzer={() => setActiveTab('analyzer')}
            />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-4 px-6 text-center text-xs text-slate-500 font-mono">
        <p>PulseBPM — High Precision Beat Induction & Exact Tempo Detection</p>
      </footer>
    </div>
  );
}
