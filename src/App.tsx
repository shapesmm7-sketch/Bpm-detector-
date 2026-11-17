import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { SongUploader } from './components/SongUploader';
import { WaveformVisualizer } from './components/WaveformVisualizer';
import { AudioPlayerControls } from './components/AudioPlayerControls';
import { HistoryLogPanel, HistoryItem } from './components/HistoryLogPanel';
import { MenuPanel } from './components/MenuPanel';
import { PhoneAudioPickerModal } from './components/PhoneAudioPickerModal';
import { ExportFormatModal } from './components/ExportFormatModal';
import { StandaloneAudioPlayer } from './components/StandaloneAudioPlayer';
import { StandaloneVideoPlayer } from './components/StandaloneVideoPlayer';
import {
  AppThemeMode,
  AudioLibrary,
  AudioTrackItem,
  ExternalMediaPayload,
  VideoTrackItem,
  isNativeAndroid,
  resolvePlayableAudioUrl,
  saveExportedAudioBlob,
} from './plugins/audioLibrary';

import {
  getAudioContext,
  suspendAudioContext,
  decodeAudioData,
  extractId3Bpm,
  detectBPM,
  BpmAnalysisResult,
} from './utils/audioAnalyzer';
import { SoundTouchPitchPlayer, exportTempoAdjustedAudio } from './utils/pitchShifterDsp';
import { AudioExportFormat, getAudioFormatOption } from './utils/audioEncoders';
import {
  saveAudioToCache,
  getAudioFromCache,
  removeAudioFromCache,
  clearAudioCache,
} from './utils/audioStorage';

import { Music, Home, Video } from 'lucide-react';

const THEME_STORAGE_KEY = 'movibe_theme';

export default function App() {
  const [activeSection, setActiveSection] = useState<'home' | 'audio' | 'video'>('home');
  const [activeTab, setActiveTab] = useState<'analyzer' | 'menu' | 'history'>('analyzer');
  const [themeMode, setThemeMode] = useState<AppThemeMode>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        return saved;
      }
    } catch {
      // ignore storage errors
    }
    return 'light';
  });
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });
  const [audioPauseSignal, setAudioPauseSignal] = useState<number>(0);
  const [videoPauseSignal, setVideoPauseSignal] = useState<number>(0);
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

  // Unified Audio Export State (Tempo/BPM + Song Key changes combined)
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportStatusMessage, setExportStatusMessage] = useState<string | null>(null);
  const [exportErrorMessage, setExportErrorMessage] = useState<string | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [loadingHistoryId, setLoadingHistoryId] = useState<string | null>(null);
  const [externalTrackRequest, setExternalTrackRequest] = useState<{
    requestId: string;
    track: AudioTrackItem;
  } | null>(null);
  const [externalVideoRequest, setExternalVideoRequest] = useState<{
    requestId: string;
    video: VideoTrackItem;
  } | null>(null);
  const handledExternalIdsRef = useRef<Set<string>>(new Set());

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

  const resolvedIsDark =
    themeMode === 'dark' || (themeMode === 'system' && systemPrefersDark);

  // Listen to OS/browser dark mode preference changes for "System" appearance mode
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      setSystemPrefersDark(e.matches);
    };
    setSystemPrefersDark(mq.matches);
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  // Apply theme to document root, meta theme-color, localStorage, and native Android bars/WebView
  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // ignore storage errors
    }

    const root = document.documentElement;
    root.classList.toggle('dark', resolvedIsDark);
    root.style.colorScheme = resolvedIsDark ? 'dark' : 'light';

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', resolvedIsDark ? '#020617' : '#f8fafc');
    }

    if (isNativeAndroid()) {
      void AudioLibrary.setAppAppearance({ theme: themeMode }).catch((err) => {
        console.warn('Could not sync appearance with Android shell:', err);
      });
    }
  }, [themeMode, resolvedIsDark]);

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

  // Handle audio/video files opened from Android (when BeatPulse is default or chosen player)
  useEffect(() => {
    if (!isNativeAndroid()) return;

    const handleIncomingMedia = (payload: ExternalMediaPayload | null | undefined) => {
      if (!payload || !payload.requestId) return;
      if (handledExternalIdsRef.current.has(payload.requestId)) return;
      handledExternalIdsRef.current.add(payload.requestId);

      const webUrl = resolvePlayableAudioUrl({
        filePath: payload.filePath,
        localUrl: payload.localUrl,
      });

      stopAudio();

      if (payload.mediaKind === 'video') {
        setAudioPauseSignal((n) => n + 1);
        setActiveSection('video');
        setExternalVideoRequest({
          requestId: payload.requestId,
          video: {
            id: `ext-video-${payload.requestId}`,
            title: payload.title || payload.displayName || 'Video',
            displayName: payload.displayName || payload.title || 'video.mp4',
            durationMs: payload.durationMs || 0,
            size: payload.size || 0,
            mimeType: payload.mimeType || 'video/*',
            resolution: payload.resolution || '',
            uri: payload.uri,
            webUrl,
          },
        });
      } else {
        setVideoPauseSignal((n) => n + 1);
        setActiveSection('audio');
        setExternalTrackRequest({
          requestId: payload.requestId,
          track: {
            id: `ext-audio-${payload.requestId}`,
            title: payload.title || payload.displayName || 'Audio Track',
            displayName: payload.displayName || payload.title || 'audio.mp3',
            artist: 'External Audio',
            album: '',
            durationMs: payload.durationMs || 0,
            size: payload.size || 0,
            mimeType: payload.mimeType || 'audio/*',
            uri: payload.uri,
            webUrl,
          },
        });
      }
    };

    let listenerHandle: { remove: () => Promise<void> } | null = null;
    void AudioLibrary.addListener('externalMediaOpened', handleIncomingMedia).then((handle) => {
      listenerHandle = handle;
    });

    let sectionListenerHandle: { remove: () => Promise<void> } | null = null;
    void AudioLibrary.addListener('openSectionRequested', (payload) => {
      if (payload?.section === 'home' || payload?.section === 'audio' || payload?.section === 'video') {
        setActiveSection(payload.section);
      }
    }).then((handle) => {
      sectionListenerHandle = handle;
    });

    void AudioLibrary.consumePendingExternalMedia()
      .then((res) => {
        if (res?.media) {
          handleIncomingMedia(res.media);
        }
      })
      .catch((err) => {
        console.warn('Could not check pending external media:', err);
      });

    void AudioLibrary.consumePendingOpenSection()
      .then((res) => {
        if (res?.section === 'home' || res?.section === 'audio' || res?.section === 'video') {
          setActiveSection(res.section);
        }
      })
      .catch(() => {
        // ignore if no pending section
      });

    return () => {
      if (listenerHandle) {
        void listenerHandle.remove();
      }
      if (sectionListenerHandle) {
        void sectionListenerHandle.remove();
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

    setAudioPauseSignal((n) => n + 1);
    setVideoPauseSignal((n) => n + 1);
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
    setExportStatusMessage(null);
    setExportErrorMessage(null);
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

  const handleExportAudio = async (format: AudioExportFormat) => {
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
      const rate = 1 + pitchPercent / 100;
      const exportedBlob = await exportTempoAdjustedAudio(
        audioBuffer,
        rate,
        keySemitones,
        format,
        (dspPct) => {
          setExportProgress(Math.round(dspPct * (isNativeAndroid() ? 0.75 : 0.98)));
        },
        controller.signal
      );

      const safeBase = (trackName || 'MoVibe_Track')
        .replace(/[\\/:*?"<>|]/g, '_')
        .trim();
      const targetBpm = bpmResult ? (bpmResult.bpm * rate).toFixed(2) : liveBpm.toFixed(2);
      const semitoneTag = keySemitones > 0 ? `+${keySemitones}st` : `${keySemitones}st`;
      const fmtOption = getAudioFormatOption(format);
      const fileName = `${safeBase}_${targetBpm}BPM_${semitoneTag}.${fmtOption.extension}`;

      const { displayPath } = await saveExportedAudioBlob(exportedBlob, fileName, (savePct) => {
        if (isNativeAndroid()) {
          setExportProgress(75 + Math.round(savePct * 0.25));
        } else {
          setExportProgress(savePct);
        }
      });

      setExportStatusMessage(
        isNativeAndroid()
          ? `Saved ${fmtOption.label} (${fmtOption.qualityTag}) to ${displayPath}`
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
    setIsExportModalOpen(false);
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200">
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
        activeSection={activeSection}
        onSelectHome={() => setActiveSection('home')}
      />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 pt-6 pb-24 space-y-6 overflow-x-hidden">
        {/* Section 1: Home (Existing BPM Analyzer App + Menu + History) */}
        <div className={activeSection === 'home' ? 'block space-y-6 min-w-0' : 'hidden'}>
          {activeTab === 'analyzer' && (
            <div className="space-y-6 min-w-0">
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
              <div className="bg-white dark:bg-slate-900 border-2 border-emerald-500/40 rounded-3xl p-5 sm:p-8 shadow-xl dark:shadow-[0_0_50px_rgba(16,185,129,0.15)] space-y-6 text-center overflow-hidden min-w-0">
                {/* Track Title Banner */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200 dark:border-slate-800 text-xs min-w-0">
                  <div className="flex items-center justify-center sm:justify-start gap-2 w-full sm:w-auto sm:flex-1 min-w-0">
                    <Music className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span
                      className="font-bold text-slate-900 dark:text-slate-200 text-sm min-w-0 max-w-full break-all line-clamp-2 text-center sm:text-left"
                      title={trackName || 'Audio Track'}
                    >
                      {trackName || 'Audio Track'}
                    </span>
                  </div>
                  <div className="flex items-center justify-center sm:justify-end gap-2 text-slate-600 dark:text-slate-400 font-mono text-xs shrink-0">
                    <span>{Math.floor(duration / 60)}:{Math.floor(duration % 60).toString().padStart(2, '0')}</span>
                    <span>·</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{bpmResult.source}</span>
                  </div>
                </div>

                {/* THE CORE BPM HERO */}
                <div className="py-2 space-y-3">
                  <span className="text-xs font-mono uppercase tracking-widest text-slate-500 dark:text-slate-400 font-bold block">
                    DETECTED SONG BPM
                  </span>

                  <div className="flex items-center justify-center gap-2.5 sm:gap-6">
                    {/* /2 button */}
                    <button
                      onClick={handleHalfBpm}
                      className="px-3 sm:px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-950 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 text-xs sm:text-sm font-mono font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      title="Halve BPM (/ 2)"
                    >
                      / 2
                    </button>

                    {/* Massive BPM Number */}
                    <div className="flex items-baseline justify-center gap-1.5 sm:gap-2 min-w-0">
                      <span className="text-5xl sm:text-8xl md:text-9xl font-black font-mono tracking-tight text-slate-950 dark:text-white dark:drop-shadow-[0_0_30px_rgba(16,185,129,0.35)] select-all">
                        {liveBpm > 0 ? liveBpm.toFixed(2) : bpmResult.bpmFormatted}
                      </span>
                      <span className="text-base sm:text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 shrink-0">
                        BPM
                      </span>
                    </div>

                    {/* x2 button */}
                    <button
                      onClick={handleDoubleBpm}
                      className="px-3 sm:px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-950 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 text-xs sm:text-sm font-mono font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      title="Double BPM (x 2)"
                    >
                      x 2
                    </button>
                  </div>

                  {/* Pitch-adjusted live BPM indicator */}
                  {pitchPercent !== 0 && (
                    <div className="text-xs font-mono text-cyan-700 dark:text-cyan-400 font-bold">
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
                      isDarkMode={resolvedIsDark}
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
                      keySemitones={keySemitones}
                      onKeySemitonesChange={handleKeySemitonesChange}
                      onResetKeyShift={handleResetKeyShift}
                      onExportAudio={() => {
                        if (audioBuffer && !isExporting) {
                          setIsExportModalOpen(true);
                        }
                      }}
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
            themeMode={themeMode}
            onThemeChange={setThemeMode}
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
        </div>

        {/* Section 2: Standalone Phone Audio Player (separate from BPM Analyzer) */}
        <div className={activeSection === 'audio' ? 'block min-w-0' : 'hidden'}>
          <StandaloneAudioPlayer
            isActiveTab={activeSection === 'audio'}
            pauseSignal={audioPauseSignal}
            onPlaybackStarted={() => {
              stopAudio();
              setVideoPauseSignal((n) => n + 1);
            }}
            sharedSongs={phoneSongs}
            onSongsLoaded={setPhoneSongs}
            externalTrackRequest={externalTrackRequest}
          />
        </div>

        {/* Section 3: Standalone Phone Video Player (separate from BPM Analyzer) */}
        <div className={activeSection === 'video' ? 'block min-w-0' : 'hidden'}>
          <StandaloneVideoPlayer
            isActiveTab={activeSection === 'video'}
            pauseSignal={videoPauseSignal}
            onPlaybackStarted={() => {
              stopAudio();
              setAudioPauseSignal((n) => n + 1);
            }}
            externalVideoRequest={externalVideoRequest}
          />
        </div>
      </main>

      {/* Fixed 3-Section App Footer: Home, Audio, Video */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 transition-colors duration-200">
        <nav
          aria-label="Main Sections"
          className="max-w-5xl mx-auto grid grid-cols-3 h-16"
        >
          <button
            type="button"
            onClick={() => {
              if (activeSection === 'video') {
                setVideoPauseSignal((n) => n + 1);
              }
              setActiveSection('home');
            }}
            className={`relative min-h-[44px] flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
              activeSection === 'home'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {activeSection === 'home' && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
            )}
            <Home className="w-5 h-5" />
            <span className="text-[11px] font-semibold tracking-tight leading-none">
              Home
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (activeSection === 'video') {
                setVideoPauseSignal((n) => n + 1);
              }
              setActiveSection('audio');
            }}
            className={`relative min-h-[44px] flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
              activeSection === 'audio'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {activeSection === 'audio' && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
            )}
            <Music className="w-5 h-5" />
            <span className="text-[11px] font-semibold tracking-tight leading-none">
              Audio
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveSection('video');
            }}
            className={`relative min-h-[44px] flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
              activeSection === 'video'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {activeSection === 'video' && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
            )}
            <Video className="w-5 h-5" />
            <span className="text-[11px] font-semibold tracking-tight leading-none">
              Video
            </span>
          </button>
        </nav>
      </footer>

      {/* Android MediaStore Phone Audio Picker Modal */}
      <PhoneAudioPickerModal
        isOpen={isPhonePickerOpen}
        songs={phoneSongs}
        onClose={() => setIsPhonePickerOpen(false)}
        onSelectSong={handleSelectPhoneSong}
        onBrowseFiles={triggerSystemFilePicker}
      />

      {/* Choose Audio Format Modal before Downloading */}
      <ExportFormatModal
        isOpen={isExportModalOpen}
        title="Choose Audio Format"
        subtitle={`${(liveBpm > 0 ? liveBpm : bpmResult?.bpm || 0).toFixed(2)} BPM · ${keySemitones > 0 ? `+${keySemitones}` : keySemitones} st`}
        durationSec={playbackRate > 0 ? duration / playbackRate : duration}
        sampleRate={audioBuffer?.sampleRate || 44100}
        onClose={() => setIsExportModalOpen(false)}
        onSelectFormat={(format) => {
          setIsExportModalOpen(false);
          void handleExportAudio(format);
        }}
      />
    </div>
  );
}
