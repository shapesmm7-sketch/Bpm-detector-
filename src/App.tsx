import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { SongUploader } from './components/SongUploader';
import { WaveformVisualizer } from './components/WaveformVisualizer';
import { AudioPlayerControls } from './components/AudioPlayerControls';
import { HistoryLogPanel, HistoryItem } from './components/HistoryLogPanel';
import { MenuPanel } from './components/MenuPanel';
import { PhoneAudioPickerModal } from './components/PhoneAudioPickerModal';
import { AudioLibrary, AudioTrackItem, isNativeAndroid, resolvePlayableAudioUrl, saveExportedAudioBlob } from './plugins/audioLibrary';

import {
  getAudioContext,
  suspendAudioContext,
  decodeAudioData,
  extractId3Bpm,
  detectBPM,
  BpmAnalysisResult,
} from './utils/audioAnalyzer';
import { SoundTouchPitchPlayer, exportPitchShiftedWav, exportTempoAdjustedWav } from './utils/pitchShifterDsp';
import {
  saveAudioToCache,
  getAudioFromCache,
  removeAudioFromCache,
  clearAudioCache,
} from './utils/audioStorage';

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
  const [isPhonePickerOpen, setIsPhonePickerOpen] = useState<boolean>(false);
  const [phoneSongs, setPhoneSongs] = useState<AudioTrackItem[]>([]);

  // DJ Engine & Playback State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1.0);
  const [pitchPercent, setPitchPercent] = useState<number>(0); // -50% to +50% tempo
  const [keySemitones, setKeySemitones] = useState<number>(0); // -12 to +12 semitones
  const [cuePoint, setCuePoint] = useState<number>(0);
  const [loopBarCount, setLoopBarCount] = useState<number>(0);
  const [loopRegion, setLoopRegion] = useState<{ start: number; end: number } | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Pitch-shifted Audio Export State
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportStatusMessage, setExportStatusMessage] = useState<string | null>(null);
  const [exportErrorMessage, setExportErrorMessage] = useState<string | null>(null);

  // Tempo-adjusted Audio Export State
  const [isExportingTempo, setIsExportingTempo] = useState<boolean>(false);
  const [tempoExportProgress, setTempoExportProgress] = useState<number>(0);
  const [tempoExportStatusMessage, setTempoExportStatusMessage] = useState<string | null>(null);
  const [tempoExportErrorMessage, setTempoExportErrorMessage] = useState<string | null>(null);
  const [loadingHistoryId, setLoadingHistoryId] = useState<string | null>(null);

  // History State
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('pulsebpm_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Native HTMLAudioElement for lossless/uncompressed direct OS media playback
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const loopRegionRef = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    loopRegionRef.current = loopRegion;
  }, [loopRegion]);

  // Web Audio / SoundTouch DSP Nodes
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const pitchPlayerRef = useRef<SoundTouchPitchPlayer | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const tempoExportAbortRef = useRef<AbortController | null>(null);
  const playbackStartTimeRef = useRef<number>(0);
  const startOffsetRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);
  const currentTimeRef = useRef<number>(0);
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);
  const keySemitonesRef = useRef<number>(keySemitones);
  useEffect(() => {
    keySemitonesRef.current = keySemitones;
  }, [keySemitones]);

  // Effective playback rate from pitch slider
  const playbackRate = 1 + pitchPercent / 100;
  const playbackRateRef = useRef<number>(playbackRate);
  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);
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

  // Clean up native audio element, SoundTouch player, and object URL on unmount
  useEffect(() => {
    return () => {
      if (exportAbortRef.current) {
        exportAbortRef.current.abort();
        exportAbortRef.current = null;
      }
      if (tempoExportAbortRef.current) {
        tempoExportAbortRef.current.abort();
        tempoExportAbortRef.current = null;
      }
      if (pitchPlayerRef.current) {
        pitchPlayerRef.current.dispose();
        pitchPlayerRef.current = null;
      }
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current.src = '';
        audioElementRef.current = null;
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  // Stop audio playback (Pause preserves currentTime)
  const stopAudio = () => {
    if (pitchPlayerRef.current) {
      pitchPlayerRef.current.dispose();
      pitchPlayerRef.current = null;
    }
    if (audioElementRef.current) {
      audioElementRef.current.pause();
    }
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

  // Play audio from specific offset:
  // - Uses SoundTouch DSP pitch shifter when keySemitones !== 0 (preserving exact BPM/tempo)
  // - Uses native HTMLAudioElement when keySemitones === 0 (uncompressed direct playback)
  const playAudio = (startSec: number = currentTime, overrideSemitones?: number) => {
    if (!audioBuffer && !audioElementRef.current) return;

    const activeSemitones = overrideSemitones !== undefined ? overrideSemitones : keySemitonesRef.current;

    stopAudio();

    if (activeSemitones !== 0 && audioBuffer) {
      const ctx = getAudioContext();
      audioCtxRef.current = ctx;

      const player = new SoundTouchPitchPlayer(
        ctx,
        audioBuffer,
        {
          startSec,
          semitones: activeSemitones,
          tempo: playbackRateRef.current,
          volume,
          loopRegion: loopRegionRef.current,
        },
        {
          onTimeUpdate: (timeSec) => setCurrentTime(timeSec),
          onEnded: () => {
            stopAudio();
            setCurrentTime(0);
          },
        }
      );

      pitchPlayerRef.current = player;
      player.start();
      setIsPlaying(true);
      return;
    }

    const audioEl = audioElementRef.current;
    if (audioEl) {
      const maxDur = duration || audioEl.duration || 0;
      const validStart = Math.max(0, Math.min(maxDur, startSec));
      audioEl.volume = volume;
      audioEl.playbackRate = playbackRate;
      audioEl.preservesPitch = false;
      (audioEl as HTMLAudioElement & { mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean }).mozPreservesPitch = false;
      (audioEl as HTMLAudioElement & { mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean }).webkitPreservesPitch = false;

      if (Math.abs(audioEl.currentTime - validStart) > 0.02) {
        audioEl.currentTime = validStart;
      }

      audioEl.play().catch((err) => {
        console.warn('Native audio playback error:', err);
      });
      setIsPlaying(true);

      const tickNative = () => {
        if (!audioElementRef.current || audioElementRef.current.paused) return;
        const nowPos = audioElementRef.current.currentTime;
        const activeLoop = loopRegionRef.current;

        if (activeLoop && nowPos >= activeLoop.end) {
          audioElementRef.current.currentTime = activeLoop.start;
          setCurrentTime(activeLoop.start);
          animFrameRef.current = requestAnimationFrame(tickNative);
          return;
        }

        if (audioElementRef.current.ended) {
          stopAudio();
          setCurrentTime(0);
          return;
        }

        setCurrentTime(nowPos);
        animFrameRef.current = requestAnimationFrame(tickNative);
      };

      animFrameRef.current = requestAnimationFrame(tickNative);
      return;
    }

    if (!audioBuffer) return;

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
      const elapsed = (ctx.currentTime - playbackStartTimeRef.current) * playbackRateRef.current;
      const nowPos = startOffsetRef.current + elapsed;
      const activeLoop = loopRegionRef.current;

      if (activeLoop && nowPos >= activeLoop.end) {
        playAudio(activeLoop.start);
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
      if (audioElementRef.current) {
        audioElementRef.current.currentTime = cuePoint;
      }
    } else {
      setCuePoint(currentTime);
    }
  };

  const handleSeek = (newTimeSec: number) => {
    setCurrentTime(newTimeSec);
    if (pitchPlayerRef.current) {
      pitchPlayerRef.current.seek(newTimeSec);
      return;
    }
    if (audioElementRef.current && keySemitonesRef.current === 0) {
      const maxDur = duration || audioElementRef.current.duration || 0;
      audioElementRef.current.currentTime = Math.max(0, Math.min(maxDur, newTimeSec));
      return;
    }
    if (isPlaying) {
      playAudio(newTimeSec);
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    if (pitchPlayerRef.current) {
      pitchPlayerRef.current.setVolume(newVol);
    }
    if (audioElementRef.current) {
      audioElementRef.current.volume = newVol;
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = newVol;
    }
  };

  const handlePitchChange = (percent: number) => {
    const clamped = Math.max(-50, Math.min(50, percent));
    setPitchPercent(clamped);
    setTempoExportStatusMessage(null);
    setTempoExportErrorMessage(null);
    const newRate = 1 + clamped / 100;
    if (pitchPlayerRef.current) {
      pitchPlayerRef.current.setTempo(newRate);
    }
    if (audioElementRef.current) {
      audioElementRef.current.playbackRate = newRate;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.playbackRate.value = newRate;
    }
  };

  const handlePitchBend = (delta: number) => {
    handlePitchChange(Number((pitchPercent + delta).toFixed(1)));
  };

  const handleExportTempoAudio = async () => {
    if (!audioBuffer || isExportingTempo) return;

    if (tempoExportAbortRef.current) {
      tempoExportAbortRef.current.abort();
    }
    const controller = new AbortController();
    tempoExportAbortRef.current = controller;

    setIsExportingTempo(true);
    setTempoExportProgress(0);
    setTempoExportStatusMessage(null);
    setTempoExportErrorMessage(null);

    try {
      const rate = 1 + pitchPercent / 100;
      const wavBlob = await exportTempoAdjustedWav(
        audioBuffer,
        rate,
        keySemitones,
        (dspPct) => {
          setTempoExportProgress(Math.round(dspPct * (isNativeAndroid() ? 0.75 : 0.98)));
        },
        controller.signal
      );

      const safeBase = (trackName || 'BeatPulse_Track')
        .replace(/[\\/:*?"<>|]/g, '_')
        .trim();
      const targetBpm = bpmResult ? (bpmResult.bpm * rate).toFixed(2) : liveBpm.toFixed(2);
      const semitoneSuffix =
        keySemitones !== 0
          ? `_${keySemitones > 0 ? `+${keySemitones}st` : `${keySemitones}st`}`
          : '';
      const fileName = `${safeBase}_${targetBpm}BPM${semitoneSuffix}.wav`;

      const { displayPath } = await saveExportedAudioBlob(wavBlob, fileName, (savePct) => {
        if (isNativeAndroid()) {
          setTempoExportProgress(75 + Math.round(savePct * 0.25));
        } else {
          setTempoExportProgress(savePct);
        }
      });

      setTempoExportStatusMessage(
        isNativeAndroid()
          ? `Saved to ${displayPath}`
          : `Downloaded ${displayPath}`
      );
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        console.error('Tempo audio export failed:', err);
        setTempoExportErrorMessage('Could not export tempo-adjusted audio. Please try again.');
      }
    } finally {
      setIsExportingTempo(false);
      tempoExportAbortRef.current = null;
    }
  };

  const handleKeySemitonesChange = (semitones: number) => {
    const clamped = Math.max(-12, Math.min(12, Math.round(semitones)));
    const prev = keySemitonesRef.current;
    setKeySemitones(clamped);
    keySemitonesRef.current = clamped;
    setExportStatusMessage(null);
    setExportErrorMessage(null);

    if (!isPlaying) return;

    if (clamped === 0) {
      // Transition cleanly from SoundTouch back to native playback
      const pos = pitchPlayerRef.current ? pitchPlayerRef.current.getCurrentTime() : currentTimeRef.current;
      playAudio(pos, 0);
    } else if (prev === 0 || !pitchPlayerRef.current) {
      // Transition cleanly from native playback to SoundTouch DSP
      const pos = audioElementRef.current ? audioElementRef.current.currentTime : currentTimeRef.current;
      playAudio(pos, clamped);
    } else {
      // Update semitones live in active SoundTouch player
      pitchPlayerRef.current.setPitchSemitones(clamped);
    }
  };

  const handleResetKeyShift = () => {
    handleKeySemitonesChange(0);
  };

  const handleExportAudio = async () => {
    if (!audioBuffer || isExporting) return;

    if (exportAbortRef.current) {
      exportAbortRef.current.abort();
    }
    const controller = new AbortController();
    exportAbortRef.current = controller;

    setIsExporting(true);
    setExportProgress(0);
    setExportStatusMessage(null);
    setExportErrorMessage(null);

    try {
      const wavBlob = await exportPitchShiftedWav(
        audioBuffer,
        keySemitones,
        (dspPct) => {
          setExportProgress(Math.round(dspPct * (isNativeAndroid() ? 0.75 : 0.98)));
        },
        controller.signal
      );

      const safeBase = (trackName || 'BeatPulse_Track')
        .replace(/[\\/:*?"<>|]/g, '_')
        .trim();
      const semitoneTag = keySemitones > 0 ? `+${keySemitones}st` : `${keySemitones}st`;
      const fileName = `${safeBase}_${semitoneTag}.wav`;

      const { displayPath } = await saveExportedAudioBlob(wavBlob, fileName, (savePct) => {
        if (isNativeAndroid()) {
          setExportProgress(75 + Math.round(savePct * 0.25));
        } else {
          setExportProgress(savePct);
        }
      });

      setExportStatusMessage(
        isNativeAndroid()
          ? `Saved to ${displayPath}`
          : `Downloaded ${displayPath}`
      );
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        console.error('Audio export failed:', err);
        setExportErrorMessage('Could not export audio file. Please try again.');
      }
    } finally {
      setIsExporting(false);
      exportAbortRef.current = null;
    }
  };

  const handleSetLoopBarCount = (bars: number) => {
    setLoopBarCount(bars);
    if (bars === 0 || !bpmResult) {
      setLoopRegion(null);
      if (pitchPlayerRef.current) {
        pitchPlayerRef.current.setLoopRegion(null);
      }
    } else {
      const beatPeriod = 60 / liveBpm;
      const loopDuration = beatPeriod * 4 * bars;
      const start = currentTime;
      const end = Math.min(duration, start + loopDuration);
      const nextLoop = { start, end };
      setLoopRegion(nextLoop);
      if (pitchPlayerRef.current) {
        pitchPlayerRef.current.setLoopRegion(nextLoop);
      }
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
  const processAudioBuffer = async (
    buffer: AudioBuffer,
    title: string,
    id3Bpm?: number | null,
    metadata?: {
      historyId?: string;
      sourceUri?: string;
      displayName?: string;
      preserveExistingId?: string;
    }
  ) => {
    if (exportAbortRef.current) {
      exportAbortRef.current.abort();
      exportAbortRef.current = null;
    }
    if (tempoExportAbortRef.current) {
      tempoExportAbortRef.current.abort();
      tempoExportAbortRef.current = null;
    }
    stopAudio();
    setIsAnalyzing(true);
    setAnalysisError(null);
    setTrackName(title);
    setAudioBuffer(buffer);
    setDuration(buffer.duration);
    setCurrentTime(0);
    setCuePoint(0);
    setPitchPercent(0);
    setKeySemitones(0);
    keySemitonesRef.current = 0;
    setIsExporting(false);
    setExportProgress(0);
    setExportStatusMessage(null);
    setExportErrorMessage(null);
    setIsExportingTempo(false);
    setTempoExportProgress(0);
    setTempoExportStatusMessage(null);
    setTempoExportErrorMessage(null);
    setLoopBarCount(0);
    setLoopRegion(null);

    try {
      // Accurate multi-engine BPM detection
      const bpm = await detectBPM(buffer, id3Bpm);
      setBpmResult(bpm);

      const entryId = metadata?.preserveExistingId || metadata?.historyId || Date.now().toString();
      const historyEntry: HistoryItem = {
        id: entryId,
        name: title,
        bpm: bpm.bpm,
        durationSec: buffer.duration,
        confidence: bpm.confidence,
        timestamp: Date.now(),
        sourceUri: metadata?.sourceUri,
        displayName: metadata?.displayName,
      };
      setHistory((prev) => {
        const replaced = prev.filter(
          (item) => (item.id === entryId || item.name === title) && item.id !== entryId
        );
        for (const oldItem of replaced) {
          void removeAudioFromCache(oldItem.id);
        }
        return [
          historyEntry,
          ...prev.filter((item) => item.id !== entryId && item.name !== title).slice(0, 19),
        ];
      });
    } catch (err) {
      console.error('Audio detection error:', err);
      setAnalysisError('Could not process audio track. Please try a different audio file.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const attachNativeAudio = (url: string, isObjectUrl: boolean) => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = '';
      audioElementRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }

    if (isObjectUrl) {
      audioUrlRef.current = url;
    }

    const nativeAudio = new Audio(url);
    nativeAudio.preload = 'auto';
    nativeAudio.volume = volume;
    nativeAudio.preservesPitch = false;
    (nativeAudio as HTMLAudioElement & { mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean }).mozPreservesPitch = false;
    (nativeAudio as HTMLAudioElement & { mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean }).webkitPreservesPitch = false;
    nativeAudio.onended = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    nativeAudio.onerror = () => {
      console.warn('Native HTMLAudioElement could not play file directly; falling back to Web Audio playback.');
      audioElementRef.current = null;
    };
    audioElementRef.current = nativeAudio;
  };

  // File Upload handler
  const handleFileSelected = async (file: File) => {
    try {
      stopAudio();
      setIsAnalyzing(true);
      setAnalysisError(null);

      // Attach original uncompressed file directly to HTMLAudioElement
      const objectUrl = URL.createObjectURL(file);
      attachNativeAudio(objectUrl, true);

      const arrayBuf = await file.arrayBuffer();

      // Read ID3v2 TBPM tag if present (instant studio master check)
      const id3Bpm = extractId3Bpm(arrayBuf);

      // Decode audio solely for BPM analysis & waveform rendering (never alters playback quality)
      const decodedBuf = await decodeAudioData(arrayBuf);
      const cleanTitle = file.name.replace(/\.[^/.]+$/, '');
      const historyId = Date.now().toString();
      await saveAudioToCache(historyId, file, file.name);

      await processAudioBuffer(decodedBuf, cleanTitle, id3Bpm, {
        historyId,
        displayName: file.name,
      });
      await suspendAudioContext();
    } catch (err) {
      console.error('File decode failed:', err);
      setAnalysisError('Failed to decode audio file. Make sure it is a valid MP3, WAV, or audio file.');
      setIsAnalyzing(false);
    }
  };

  // Load audio file picked from Android MediaStore phone library
  const handleSelectPhoneSong = async (song: AudioTrackItem) => {
    setIsPhonePickerOpen(false);
    try {
      stopAudio();
      setIsAnalyzing(true);
      setAnalysisError(null);

      const prepared = await AudioLibrary.prepareAudioFile({
        uri: song.uri,
        displayName: song.displayName || song.title,
      });
      const localUrl = resolvePlayableAudioUrl(prepared);

      attachNativeAudio(localUrl, false);

      const response = await fetch(localUrl);
      const arrayBuf = await response.arrayBuffer();
      const id3Bpm = extractId3Bpm(arrayBuf);
      const decodedBuf = await decodeAudioData(arrayBuf);
      const cleanTitle = (song.title || song.displayName).replace(/\.[^/.]+$/, '');

      await processAudioBuffer(decodedBuf, cleanTitle, id3Bpm, {
        sourceUri: song.uri,
        displayName: song.displayName || song.title,
      });
      await suspendAudioContext();
    } catch (err) {
      console.error('Failed to load selected phone song:', err);
      setAnalysisError('Failed to load selected audio file. Please try another track.');
      setIsAnalyzing(false);
    }
  };

  // Reload a song directly when clicked from Session History
  const handleSelectHistorySong = async (item: HistoryItem) => {
    if (loadingHistoryId) return;
    setLoadingHistoryId(item.id);
    setAnalysisError(null);

    try {
      if (isNativeAndroid() && item.sourceUri) {
        try {
          const prepared = await AudioLibrary.prepareAudioFile({
            uri: item.sourceUri,
            displayName: item.displayName || item.name,
          });
          const localUrl = resolvePlayableAudioUrl(prepared);
          attachNativeAudio(localUrl, false);

          const response = await fetch(localUrl);
          const arrayBuf = await response.arrayBuffer();
          const id3Bpm = extractId3Bpm(arrayBuf);
          const decodedBuf = await decodeAudioData(arrayBuf);

          setActiveTab('analyzer');
          await processAudioBuffer(decodedBuf, item.name, id3Bpm, {
            preserveExistingId: item.id,
            sourceUri: item.sourceUri,
            displayName: item.displayName,
          });
          await suspendAudioContext();
          return;
        } catch (nativeErr) {
          console.warn('Could not reload via MediaStore URI, checking local cache:', nativeErr);
        }
      }

      const cached = await getAudioFromCache(item.id);
      if (cached) {
        const objectUrl = URL.createObjectURL(cached.blob);
        attachNativeAudio(objectUrl, true);

        const arrayBuf = await cached.blob.arrayBuffer();
        const id3Bpm = extractId3Bpm(arrayBuf);
        const decodedBuf = await decodeAudioData(arrayBuf);

        setActiveTab('analyzer');
        await processAudioBuffer(decodedBuf, item.name, id3Bpm, {
          preserveExistingId: item.id,
          sourceUri: item.sourceUri,
          displayName: item.displayName || cached.fileName,
        });
        await suspendAudioContext();
        return;
      }

      setActiveTab('analyzer');
      setAnalysisError(`"${item.name}" is no longer cached on this device. Tap Upload Song to load it again.`);
    } catch (err) {
      console.error('Failed to reload history track:', err);
      setActiveTab('analyzer');
      setAnalysisError(`Could not reload "${item.name}". Please upload it again.`);
    } finally {
      setLoadingHistoryId(null);
    }
  };

  const triggerSystemFilePicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  // Open phone audio library on Android (via MediaStore) or system file picker on Web
  const handleOpenUpload = async () => {
    setActiveTab('analyzer');
    if (isNativeAndroid()) {
      try {
        const res = await AudioLibrary.getAllAudioFiles();
        if (res.granted) {
          setPhoneSongs(res.songs || []);
          setIsPhonePickerOpen(true);
        }
        return;
      } catch (err) {
        console.warn('MediaStore query failed, falling back to system file picker:', err);
      }
    }
    triggerSystemFilePicker();
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

                {/* DJ Player Controls, Tempo Fader & Song Key Changer */}
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
                      onExportTempoAudio={handleExportTempoAudio}
                      isExportingTempo={isExportingTempo}
                      tempoExportProgress={tempoExportProgress}
                      tempoExportStatusMessage={tempoExportStatusMessage}
                      tempoExportErrorMessage={tempoExportErrorMessage}
                      keySemitones={keySemitones}
                      onKeySemitonesChange={handleKeySemitonesChange}
                      onResetKeyShift={handleResetKeyShift}
                      onExportAudio={handleExportAudio}
                      isExporting={isExporting}
                      exportProgress={exportProgress}
                      exportStatusMessage={exportStatusMessage}
                      exportErrorMessage={exportErrorMessage}
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
              onClearHistory={() => {
                setHistory([]);
                void clearAudioCache();
              }}
              onRemoveItem={(id) => {
                setHistory((prev) => prev.filter((item) => item.id !== id));
                void removeAudioFromCache(id);
              }}
              onSelectItem={handleSelectHistorySong}
              loadingItemId={loadingHistoryId}
              onBackToAnalyzer={() => setActiveTab('analyzer')}
            />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-4 px-6 text-center text-xs text-slate-500 font-mono">
        <p>PulseBPM — High Precision Beat Induction & Exact Tempo Detection</p>
      </footer>

      {/* Android MediaStore Phone Audio Picker Modal */}
      <PhoneAudioPickerModal
        isOpen={isPhonePickerOpen}
        songs={phoneSongs}
        onClose={() => setIsPhonePickerOpen(false)}
        onSelectSong={handleSelectPhoneSong}
        onBrowseFiles={triggerSystemFilePicker}
      />
    </div>
  );
}
