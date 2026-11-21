import React, { useEffect, useRef, useState } from 'react';
import {
  AudioLibrary,
  AudioTrackItem,
  isNativeAndroid,
} from '../plugins/audioLibrary';
import {
  applyDisappearTimerToTrackedRecordings,
  CallRecorderSettings,
  DISAPPEAR_PRESETS,
  formatDisappearDuration,
  formatRemainingDisappearTime,
  readCallRecorderSettings,
  readTrackedCallRecordings,
  saveCallRecorderSettings,
  trackCallRecordingExpiry,
  TrackedCallRecording,
} from '../utils/callRecordingSettings';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Mic,
  Pause,
  PhoneCall,
  Play,
  Settings,
  Square,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';

export type RecorderMode = 'voice' | 'call';

interface AudioRecorderModalProps {
  isOpen: boolean;
  initialMode: RecorderMode;
  onClose: () => void;
  onRecordingSaved: (song: AudioTrackItem, displayPath?: string) => void;
  onPlayRecordedTrack: (song: AudioTrackItem) => void;
  onCallSettingsChange?: (settings: CallRecorderSettings) => void;
  onExpiredRecordingsRemoved?: (removedIds: string[]) => void;
  allSongs?: AudioTrackItem[];
}

function formatRecClock(ms: number): string {
  const totalTenths = Math.max(0, Math.floor(ms / 100));
  const tenths = totalTenths % 10;
  const totalSec = Math.floor(totalTenths / 10);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins.toString().padStart(2, '0')}:${secs
    .toString()
    .padStart(2, '0')}.${tenths}`;
}

export const AudioRecorderModal: React.FC<AudioRecorderModalProps> = ({
  isOpen,
  initialMode,
  onClose,
  onRecordingSaved,
  onPlayRecordedTrack,
  onCallSettingsChange,
  onExpiredRecordingsRemoved,
  allSongs,
}) => {
  const mode: RecorderMode = initialMode;
  const [showCallSettings, setShowCallSettings] = useState(false);
  const [recordingName, setRecordingName] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [otherModeBusy, setOtherModeBusy] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => new Array(24).fill(8));

  const [callSettings, setCallSettings] = useState<CallRecorderSettings>(() =>
    readCallRecorderSettings()
  );
  const [customValue, setCustomValue] = useState('15');
  const [customUnit, setCustomUnit] = useState<'minutes' | 'hours' | 'days'>('minutes');
  const [trackedCalls, setTrackedCalls] = useState<TrackedCallRecording[]>(() =>
    readTrackedCallRecordings()
  );
  const [clockNow, setClockNow] = useState(() => Date.now());

  const [isBusy, setIsBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [recentVoiceSaved, setRecentVoiceSaved] = useState<AudioTrackItem[]>([]);
  const [recentCallSaved, setRecentCallSaved] = useState<AudioTrackItem[]>([]);

  // Web MediaRecorder refs
  const webRecorderRef = useRef<MediaRecorder | null>(null);
  const webChunksRef = useRef<BlobPart[]>([]);
  const webStreamsRef = useRef<MediaStream[]>([]);
  const webAudioCtxRef = useRef<AudioContext | null>(null);
  const webAnalyserRef = useRef<AnalyserNode | null>(null);
  const webRafRef = useRef<number | null>(null);
  const webStartMsRef = useRef<number>(0);
  const webPausedAtRef = useRef<number>(0);
  const webPausedAccumMsRef = useRef<number>(0);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setShowCallSettings(false);
    setErrorMsg(null);
    setStatusMsg(null);
    setOtherModeBusy(false);
    setTrackedCalls(readTrackedCallRecordings());
    setClockNow(Date.now());

    if (isNativeAndroid()) {
      void AudioLibrary.getRecordingStatus()
        .then((st) => {
          const activeMatchesMode = Boolean(st.isRecording) && st.mode === initialMode;
          setOtherModeBusy(Boolean(st.isRecording) && st.mode !== initialMode);
          setIsRecording(activeMatchesMode);
          setIsPaused(activeMatchesMode ? Boolean(st.isPaused) : false);
          setElapsedMs(activeMatchesMode ? st.elapsedMs || 0 : 0);

          const merged: CallRecorderSettings = {
            ...readCallRecorderSettings(),
            alwaysAutoRecord: Boolean(st.autoCallRecording),
            speakerphoneBoost:
              typeof st.speakerphone === 'boolean'
                ? st.speakerphone
                : readCallRecorderSettings().speakerphoneBoost,
            disappearAfterMs:
              typeof st.disappearAfterMs === 'number'
                ? st.disappearAfterMs
                : readCallRecorderSettings().disappearAfterMs,
          };
          setCallSettings(merged);
          saveCallRecorderSettings(merged);
          onCallSettingsChange?.(merged);
        })
        .catch(() => {
          // ignore status read errors
        });
    } else {
      const local = readCallRecorderSettings();
      setCallSettings(local);
      onCallSettingsChange?.(local);
    }
    // Sync on modal open or mode change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialMode]);

  // Update countdown clock in Call Recorder every second when needed
  useEffect(() => {
    if (!isOpen || mode !== 'call') return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setClockNow(now);
      const tracked = readTrackedCallRecordings();
      setTrackedCalls(tracked);
      const expiredSet = new Set(
        tracked.filter((t) => t.expiresAt > 0 && now >= t.expiresAt).map((t) => t.id)
      );
      if (expiredSet.size > 0) {
        setRecentCallSaved((prev) => prev.filter((s) => !expiredSet.has(s.id)));
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [isOpen, mode]);

  // Native Android live timer + amplitude polling
  useEffect(() => {
    if (!isOpen || !isNativeAndroid() || !isRecording) {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    pollTimerRef.current = window.setInterval(() => {
      void AudioLibrary.getRecordingStatus()
        .then((st) => {
          const activeMatchesMode = Boolean(st.isRecording) && st.mode === mode;
          setIsRecording(activeMatchesMode);
          setIsPaused(activeMatchesMode ? Boolean(st.isPaused) : false);
          setElapsedMs(activeMatchesMode ? st.elapsedMs || 0 : 0);
          const amp = Math.max(6, Math.min(100, st.amplitude || 6));
          setLevels((prev) => [...prev.slice(1), st.isPaused ? 6 : amp]);
        })
        .catch(() => {
          // ignore transient poll errors
        });
    }, 90);

    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isOpen, isRecording, mode]);

  // Cleanup web media streams on unmount
  useEffect(() => {
    return () => {
      if (webRafRef.current !== null) window.cancelAnimationFrame(webRafRef.current);
      webStreamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      if (webAudioCtxRef.current) {
        void webAudioCtxRef.current.close().catch(() => undefined);
      }
    };
  }, []);

  if (!isOpen) return null;

  const stopWebMetersAndStreams = () => {
    if (webRafRef.current !== null) {
      window.cancelAnimationFrame(webRafRef.current);
      webRafRef.current = null;
    }
    webStreamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    webStreamsRef.current = [];
    if (webAudioCtxRef.current) {
      void webAudioCtxRef.current.close().catch(() => undefined);
      webAudioCtxRef.current = null;
    }
    webAnalyserRef.current = null;
  };

  const persistCallSettings = async (
    partial: Partial<CallRecorderSettings>,
    applyToExisting = false,
    feedbackMsg?: string
  ) => {
    setErrorMsg(null);
    const next: CallRecorderSettings = { ...callSettings, ...partial };
    setCallSettings(next);
    saveCallRecorderSettings(next);
    onCallSettingsChange?.(next);

    if (applyToExisting) {
      const updated = applyDisappearTimerToTrackedRecordings(
        next.disappearAfterMs,
        allSongs
      );
      setTrackedCalls(updated);
    }

    if (isNativeAndroid()) {
      try {
        const res = await AudioLibrary.setCallRecorderSettings({
          autoCallRecording: next.alwaysAutoRecord,
          speakerphone: next.speakerphoneBoost,
          disappearAfterMs: next.disappearAfterMs,
          applyToExisting,
        });
        const synced: CallRecorderSettings = {
          ...next,
          alwaysAutoRecord: Boolean(res.autoCallRecording),
          speakerphoneBoost: Boolean(res.speakerphone),
          disappearAfterMs: res.disappearAfterMs || 0,
        };
        setCallSettings(synced);
        saveCallRecorderSettings(synced);
        onCallSettingsChange?.(synced);
        if (synced.disappearAfterMs > 0) {
          const purge = await AudioLibrary.purgeExpiredCallRecordings();
          if (purge.removedIds && purge.removedIds.length > 0) {
            onExpiredRecordingsRemoved?.(purge.removedIds);
          }
        }
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? err.message : 'Could not update call recorder settings.'
        );
        return;
      }
    }

    if (feedbackMsg) {
      setStatusMsg(feedbackMsg);
    }
  };

  const handleApplyCustomDisappear = () => {
    const raw = Number.parseFloat(customValue);
    if (!Number.isFinite(raw) || raw <= 0) {
      setErrorMsg('Enter a valid positive time for disappearing recordings.');
      return;
    }
    const multiplier =
      customUnit === 'days'
        ? 24 * 60 * 60 * 1000
        : customUnit === 'hours'
        ? 60 * 60 * 1000
        : 60 * 1000;
    const ms = Math.round(raw * multiplier);
    void persistCallSettings(
      { disappearAfterMs: ms },
      false,
      `New call recordings will disappear after ${formatDisappearDuration(ms)}.`
    );
  };

  const handleStartRecording = async () => {
    if (otherModeBusy) {
      setErrorMsg('Another recording is currently active. Stop it before starting a new one.');
      return;
    }

    setErrorMsg(null);
    setStatusMsg(null);
    const defaultLabel =
      mode === 'call'
        ? `Call Recording ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : `Voice Note ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const chosenTitle = recordingName.trim() || defaultLabel;

    if (isNativeAndroid()) {
      setIsBusy(true);
      try {
        await AudioLibrary.startAudioRecording({
          mode,
          title: chosenTitle,
          speakerphone: mode === 'call' ? callSettings.speakerphoneBoost : false,
        });
        setIsRecording(true);
        setIsPaused(false);
        setElapsedMs(0);
        setLevels(new Array(24).fill(10));
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? err.message : 'Could not start recording.'
        );
      } finally {
        setIsBusy(false);
      }
      return;
    }

    // Web / Browser Recording
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErrorMsg('Audio recording is not supported in this browser.');
      return;
    }
    setIsBusy(true);
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      webStreamsRef.current = [micStream];

      const ACtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const audioCtx = new ACtx();
      webAudioCtxRef.current = audioCtx;
      const dest = audioCtx.createMediaStreamDestination();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      webAnalyserRef.current = analyser;

      const micSource = audioCtx.createMediaStreamSource(micStream);
      micSource.connect(analyser);
      micSource.connect(dest);

      if (
        mode === 'call' &&
        callSettings.includeTabCallAudio &&
        navigator.mediaDevices.getDisplayMedia
      ) {
        try {
          const dispStream = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: true,
          });
          webStreamsRef.current.push(dispStream);
          if (dispStream.getAudioTracks().length > 0) {
            const dispAudioStream = new MediaStream(dispStream.getAudioTracks());
            const dispSource = audioCtx.createMediaStreamSource(dispAudioStream);
            dispSource.connect(analyser);
            dispSource.connect(dest);
          }
          dispStream.getVideoTracks().forEach((vt) => vt.stop());
        } catch {
          // Proceed with mic if user cancels tab audio share
        }
      }

      const preferredMime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(
        (m) => MediaRecorder.isTypeSupported(m)
      );
      const recorder = preferredMime
        ? new MediaRecorder(dest.stream, { mimeType: preferredMime })
        : new MediaRecorder(dest.stream);

      webChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          webChunksRef.current.push(ev.data);
        }
      };

      webRecorderRef.current = recorder;
      recorder.start(200);
      webStartMsRef.current = performance.now();
      webPausedAtRef.current = 0;
      webPausedAccumMsRef.current = 0;
      setIsRecording(true);
      setIsPaused(false);
      setElapsedMs(0);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!webRecorderRef.current || webRecorderRef.current.state === 'inactive') {
          return;
        }
        if (webRecorderRef.current.state === 'recording') {
          const el =
            performance.now() - webStartMsRef.current - webPausedAccumMsRef.current;
          setElapsedMs(Math.max(0, el));
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = dataArray.length > 0 ? sum / dataArray.length : 0;
          const pct = Math.max(8, Math.min(100, Math.round((avg / 140) * 100)));
          setLevels((prev) => [...prev.slice(1), pct]);
        }
        webRafRef.current = window.requestAnimationFrame(tick);
      };
      webRafRef.current = window.requestAnimationFrame(tick);
    } catch (err) {
      stopWebMetersAndStreams();
      setErrorMsg(
        err instanceof Error ? err.message : 'Microphone access denied.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handlePauseResume = async () => {
    setErrorMsg(null);
    if (isNativeAndroid()) {
      try {
        if (isPaused) {
          await AudioLibrary.resumeAudioRecording();
          setIsPaused(false);
        } else {
          await AudioLibrary.pauseAudioRecording();
          setIsPaused(true);
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Pause/resume failed.');
      }
      return;
    }

    const rec = webRecorderRef.current;
    if (!rec) return;
    if (isPaused) {
      rec.resume();
      if (webPausedAtRef.current > 0) {
        webPausedAccumMsRef.current += Math.max(
          0,
          performance.now() - webPausedAtRef.current
        );
      }
      webPausedAtRef.current = 0;
      setIsPaused(false);
    } else {
      rec.pause();
      webPausedAtRef.current = performance.now();
      setIsPaused(true);
    }
  };

  const handleStopAndSave = async (discard = false) => {
    setErrorMsg(null);
    setIsBusy(true);

    if (isNativeAndroid()) {
      try {
        const res = await AudioLibrary.stopAudioRecording({
          discard,
          customTitle: recordingName.trim() || undefined,
        });
        setIsRecording(false);
        setIsPaused(false);
        setLevels(new Array(24).fill(8));
        if (discard) {
          setElapsedMs(0);
          setStatusMsg('Recording discarded.');
        } else if (res.saved && res.song) {
          if (mode === 'call') {
            setRecentCallSaved((prev) => [res.song!, ...prev]);
            const updated = trackCallRecordingExpiry(
              res.song,
              callSettings.disappearAfterMs
            );
            setTrackedCalls(updated);
          } else {
            setRecentVoiceSaved((prev) => [res.song!, ...prev]);
          }
          onRecordingSaved(res.song, res.displayPath);
          setRecordingName('');
          setStatusMsg(`Saved "${res.song.title}" to ${res.displayPath || 'Audio Library'}`);
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Could not save recording.');
      } finally {
        setIsBusy(false);
      }
      return;
    }

    // Web Stop
    const rec = webRecorderRef.current;
    if (!rec) {
      setIsBusy(false);
      setIsRecording(false);
      return;
    }

    try {
      const totalDurationMs = Math.max(
        500,
        Math.round(
          (isPaused && webPausedAtRef.current > 0
            ? webPausedAtRef.current
            : performance.now()) -
            webStartMsRef.current -
            webPausedAccumMsRef.current
        )
      );

      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        if (rec.state !== 'inactive') {
          rec.stop();
        } else {
          resolve();
        }
      });

      stopWebMetersAndStreams();
      webRecorderRef.current = null;
      setIsRecording(false);
      setIsPaused(false);
      setLevels(new Array(24).fill(8));

      if (discard || webChunksRef.current.length === 0) {
        webChunksRef.current = [];
        setElapsedMs(0);
        setStatusMsg('Recording discarded.');
        setIsBusy(false);
        return;
      }

      const mime = rec.mimeType || 'audio/webm';
      const ext = mime.includes('mp4') ? 'm4a' : 'webm';
      const blob = new Blob(webChunksRef.current, { type: mime });
      webChunksRef.current = [];
      const url = URL.createObjectURL(blob);

      const defaultTitle =
        mode === 'call'
          ? `Call Recording ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          : `Voice Note ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const finalTitle = recordingName.trim() || defaultTitle;
      const safeDisplayName = `${finalTitle.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;

      const newTrack: AudioTrackItem = {
        id: `rec-${Date.now()}`,
        title: finalTitle,
        displayName: safeDisplayName,
        artist: mode === 'call' ? 'Call Recording' : 'Voice Recording',
        album: mode === 'call' ? 'Mo Vibe Calls' : 'Mo Vibe Voice Notes',
        durationMs: totalDurationMs,
        size: blob.size,
        mimeType: mime,
        uri: url,
        webUrl: url,
      };

      if (mode === 'call') {
        setRecentCallSaved((prev) => [newTrack, ...prev]);
        const updated = trackCallRecordingExpiry(
          newTrack,
          callSettings.disappearAfterMs
        );
        setTrackedCalls(updated);
      } else {
        setRecentVoiceSaved((prev) => [newTrack, ...prev]);
      }

      onRecordingSaved(newTrack, 'Phone Audio Library');
      setRecordingName('');
      setStatusMsg(
        mode === 'call' && callSettings.disappearAfterMs > 0
          ? `Saved "${finalTitle}" · disappears in ${formatDisappearDuration(
              callSettings.disappearAfterMs
            )}`
          : `Saved "${finalTitle}" to Audio Library.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to finish recording.');
    } finally {
      setIsBusy(false);
    }
  };

  const recentList = mode === 'call' ? recentCallSaved : recentVoiceSaved;
  const trackedExpiryMap = new Map(trackedCalls.map((t) => [t.id, t.expiresAt]));
  const presetMatched = DISAPPEAR_PRESETS.some(
    (p) => p.ms === callSettings.disappearAfterMs
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/65 dark:bg-slate-950/85 backdrop-blur-sm p-0 sm:p-4"
      onClick={() => {
        if (!isRecording && !isBusy) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-md max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header — Strict Single Mode */}
        <div className="flex items-center justify-between gap-2 px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {mode === 'call' && showCallSettings ? (
              <button
                type="button"
                onClick={() => setShowCallSettings(false)}
                className="min-w-[36px] min-h-[36px] rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer shrink-0"
                aria-label="Back to Call Recorder"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  mode === 'call'
                    ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                    : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {mode === 'call' ? (
                  <PhoneCall className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </div>
            )}
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                {mode === 'call'
                  ? showCallSettings
                    ? 'Call Recorder Settings'
                    : 'Call Recorder'
                  : 'Voice Recorder'}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {mode === 'call'
                  ? showCallSettings
                    ? 'Auto-record & disappearing timer preferences'
                    : 'Record phone calls & conversations cleanly'
                  : 'Record voice memos & vocals to your library'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {mode === 'call' && !showCallSettings && (
              <button
                type="button"
                onClick={() => setShowCallSettings(true)}
                className="min-h-[36px] px-2.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-700 dark:text-sky-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                title="Call Recorder Settings"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Settings</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="min-w-[36px] min-h-[36px] rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
              aria-label="Close recorder"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {mode === 'call' && showCallSettings ? (
            /* ================= CALL RECORDER SETTINGS PANEL ================= */
            <div className="space-y-4">
              {/* Auto-Record Always Setting */}
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3.5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                      Always Auto-Record Calls
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {isNativeAndroid()
                        ? 'Automatically starts recording whenever a phone call connects and saves automatically on hang-up.'
                        : 'Remembers auto-record preference for calls (automatic phone call detection activates on the Android app).'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const nextVal = !callSettings.alwaysAutoRecord;
                      void persistCallSettings(
                        { alwaysAutoRecord: nextVal },
                        false,
                        nextVal
                          ? 'Auto-Record Calls is ON. Calls will record automatically.'
                          : 'Auto-Record Calls turned OFF.'
                      );
                    }}
                    className={`min-h-[36px] px-3.5 rounded-xl text-xs font-bold cursor-pointer transition-colors shrink-0 ${
                      callSettings.alwaysAutoRecord
                        ? 'bg-emerald-500 text-white dark:text-slate-950 shadow-sm'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {callSettings.alwaysAutoRecord ? 'ON' : 'OFF'}
                  </button>
                </div>

                {/* Call Audio Capture Boost */}
                <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800">
                  {isNativeAndroid() ? (
                    <label className="flex items-center justify-between gap-3 cursor-pointer">
                      <div className="flex items-center gap-2 min-w-0">
                        <Volume2 className="w-4 h-4 text-sky-500 shrink-0" />
                        <div>
                          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                            Speakerphone Boost
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            Helps capture both caller &amp; your voice clearly
                          </div>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={callSettings.speakerphoneBoost}
                        onChange={(e) =>
                          void persistCallSettings(
                            { speakerphoneBoost: e.target.checked },
                            false
                          )
                        }
                        className="w-4 h-4 accent-sky-500 cursor-pointer shrink-0"
                      />
                    </label>
                  ) : (
                    <label className="flex items-center justify-between gap-3 cursor-pointer">
                      <div className="flex items-center gap-2 min-w-0">
                        <Volume2 className="w-4 h-4 text-sky-500 shrink-0" />
                        <div>
                          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                            Include Browser / App Call Audio
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            Mixes browser/tab call audio with your microphone
                          </div>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={callSettings.includeTabCallAudio}
                        onChange={(e) =>
                          void persistCallSettings(
                            { includeTabCallAudio: e.target.checked },
                            false
                          )
                        }
                        className="w-4 h-4 accent-sky-500 cursor-pointer shrink-0"
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Recordings Disappearing Time Setting */}
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-sky-500 shrink-0" />
                    <div>
                      <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                        Recordings Disappearing Time
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Automatically delete call recordings after selected time
                      </div>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-lg bg-sky-500/15 text-sky-700 dark:text-sky-300 text-[11px] font-bold shrink-0">
                    {formatDisappearDuration(callSettings.disappearAfterMs)}
                  </span>
                </div>

                {/* Preset Grid */}
                <div className="grid grid-cols-3 gap-2">
                  {DISAPPEAR_PRESETS.map((preset) => {
                    const active = callSettings.disappearAfterMs === preset.ms;
                    return (
                      <button
                        key={preset.shortLabel}
                        type="button"
                        onClick={() =>
                          void persistCallSettings(
                            { disappearAfterMs: preset.ms },
                            false,
                            preset.ms === 0
                              ? 'Call recordings will be kept forever (Never disappear).'
                              : `Call recordings set to disappear after ${preset.label}.`
                          )
                        }
                        className={`min-h-[38px] px-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                          active
                            ? 'bg-sky-500 border-sky-500 text-white dark:text-slate-950 shadow-sm'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-sky-500/40'
                        }`}
                      >
                        {preset.shortLabel}
                      </button>
                    );
                  })}
                </div>

                {/* Custom Disappearing Duration */}
                <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 space-y-1.5">
                  <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 flex items-center justify-between">
                    <span>Custom Disappearing Time</span>
                    {!presetMatched && callSettings.disappearAfterMs > 0 && (
                      <span className="text-sky-600 dark:text-sky-400 font-bold">
                        Active: {formatDisappearDuration(callSettings.disappearAfterMs)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={customValue}
                      onChange={(e) => setCustomValue(e.target.value)}
                      className="w-20 min-h-[38px] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2.5 text-xs font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                    />
                    <select
                      value={customUnit}
                      onChange={(e) =>
                        setCustomUnit(e.target.value as 'minutes' | 'hours' | 'days')
                      }
                      className="flex-1 min-h-[38px] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2.5 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500 cursor-pointer"
                    >
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </select>
                    <button
                      type="button"
                      onClick={handleApplyCustomDisappear}
                      className="min-h-[38px] px-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white dark:text-slate-950 text-xs font-bold cursor-pointer shrink-0"
                    >
                      Set
                    </button>
                  </div>
                </div>

                {/* Apply to Existing Call Recordings */}
                {(trackedCalls.length > 0 || recentCallSaved.length > 0) && (
                  <button
                    type="button"
                    onClick={() =>
                      void persistCallSettings(
                        { disappearAfterMs: callSettings.disappearAfterMs },
                        true,
                        callSettings.disappearAfterMs === 0
                          ? 'Removed disappearing timer from existing call recordings.'
                          : `Updated disappearing timer (${formatDisappearDuration(
                              callSettings.disappearAfterMs
                            )}) on existing call recordings.`
                      )
                    }
                    className="w-full min-h-[38px] px-3 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                  >
                    Apply timer to existing call recordings
                  </button>
                )}
              </div>

              {statusMsg && (
                <div className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/35 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{statusMsg}</span>
                </div>
              )}

              {errorMsg && (
                <div className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/35 text-red-600 dark:text-red-400 text-xs font-medium">
                  {errorMsg}
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowCallSettings(false)}
                className="w-full min-h-[42px] rounded-xl bg-sky-500 hover:bg-sky-400 text-white dark:text-slate-950 text-xs sm:text-sm font-bold cursor-pointer"
              >
                Done
              </button>
            </div>
          ) : (
            /* ================= MAIN SINGLE-MODE RECORDER VIEW ================= */
            <>
              {otherModeBusy && (
                <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/35 text-amber-700 dark:text-amber-300 text-xs font-medium">
                  Another recording is currently active. Stop it before starting a new{' '}
                  {mode === 'call' ? 'call recording' : 'voice recording'}.
                </div>
              )}

              {/* Call Recorder Settings Quick Status Strip */}
              {mode === 'call' && (
                <button
                  type="button"
                  onClick={() => setShowCallSettings(true)}
                  className="w-full px-3 py-2.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/15 border border-sky-500/30 flex items-center justify-between gap-2 text-left cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-wrap text-xs">
                    <span className="font-bold text-sky-800 dark:text-sky-200">
                      Auto-Record:{' '}
                      <span
                        className={
                          callSettings.alwaysAutoRecord
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-600 dark:text-slate-400'
                        }
                      >
                        {callSettings.alwaysAutoRecord ? 'Always ON' : 'OFF'}
                      </span>
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="font-semibold text-sky-700 dark:text-sky-300 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Disappear: {formatDisappearDuration(callSettings.disappearAfterMs)}
                      </span>
                    </span>
                  </div>
                  <span className="text-[11px] font-bold text-sky-600 dark:text-sky-400 shrink-0">
                    Settings ›
                  </span>
                </button>
              )}

              {/* Recording Title Input */}
              <input
                type="text"
                value={recordingName}
                onChange={(e) => setRecordingName(e.target.value)}
                placeholder={
                  mode === 'call'
                    ? 'Recording title (e.g. Call with Studio)'
                    : 'Recording title (e.g. Song Idea)'
                }
                className="w-full min-h-[40px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-emerald-500 rounded-xl px-3 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none"
              />

              {/* Live Waveform & Timer Stage */}
              <div className="rounded-2xl bg-slate-950 border border-slate-800 p-4 space-y-3 text-center">
                <div className="flex items-center justify-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      isRecording && !isPaused
                        ? 'bg-red-500 animate-pulse'
                        : isPaused
                        ? 'bg-amber-400'
                        : 'bg-slate-600'
                    }`}
                  />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                    {isRecording
                      ? isPaused
                        ? 'Paused'
                        : mode === 'call'
                        ? 'Recording Call'
                        : 'Recording Voice'
                      : 'Ready to Record'}
                  </span>
                </div>

                <div className="text-3xl font-mono font-bold tabular-nums text-white tracking-tight">
                  {formatRecClock(elapsedMs)}
                </div>

                {/* Live Level Bars */}
                <div className="h-12 flex items-center justify-center gap-1 px-2">
                  {levels.map((lvl, i) => (
                    <div
                      key={i}
                      style={{ height: `${Math.max(10, lvl)}%` }}
                      className={`w-1.5 rounded-full transition-all duration-75 ${
                        isRecording && !isPaused
                          ? mode === 'call'
                            ? 'bg-sky-400'
                            : 'bg-emerald-400'
                          : 'bg-slate-700'
                      }`}
                    />
                  ))}
                </div>

                {/* Recorder Controls */}
                <div className="flex items-center justify-center gap-3 pt-1">
                  {!isRecording ? (
                    <button
                      type="button"
                      disabled={isBusy || otherModeBusy}
                      onClick={() => void handleStartRecording()}
                      className={`min-h-[48px] px-7 rounded-2xl font-bold text-xs sm:text-sm text-white flex items-center gap-2 shadow-lg cursor-pointer transition-transform active:scale-95 disabled:opacity-50 ${
                        mode === 'call'
                          ? 'bg-sky-500 hover:bg-sky-400'
                          : 'bg-red-500 hover:bg-red-400'
                      }`}
                    >
                      {mode === 'call' ? (
                        <PhoneCall className="w-4 h-4" />
                      ) : (
                        <Mic className="w-4 h-4" />
                      )}
                      <span>
                        {mode === 'call' ? 'Start Call Recording' : 'Start Voice Recording'}
                      </span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleStopAndSave(true)}
                        className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-red-400 flex items-center justify-center cursor-pointer"
                        title="Discard recording"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handlePauseResume()}
                        className="min-h-[46px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        {isPaused ? (
                          <>
                            <Play className="w-4 h-4 fill-current" />
                            <span>Resume</span>
                          </>
                        ) : (
                          <>
                            <Pause className="w-4 h-4 fill-current" />
                            <span>Pause</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleStopAndSave(false)}
                        className="min-h-[46px] px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-lg"
                      >
                        <Square className="w-3.5 h-3.5 fill-current" />
                        <span>Save</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {statusMsg && (
                <div className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/35 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{statusMsg}</span>
                </div>
              )}

              {errorMsg && (
                <div className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/35 text-red-600 dark:text-red-400 text-xs font-medium">
                  {errorMsg}
                </div>
              )}

              {/* Recent Recordings for Active Mode Only */}
              {recentList.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {mode === 'call' ? 'Recent Call Recordings' : 'Recent Voice Recordings'}
                  </div>
                  <div className="space-y-1.5">
                    {recentList.map((rec) => {
                      const expiresAt = mode === 'call' ? trackedExpiryMap.get(rec.id) : undefined;
                      return (
                        <div
                          key={rec.id}
                          className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                              {rec.title}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate flex items-center gap-1.5">
                              <span>{formatRecClock(rec.durationMs || 0)}</span>
                              {expiresAt && expiresAt > 0 ? (
                                <span className="text-sky-600 dark:text-sky-400 font-semibold">
                                  · {formatRemainingDisappearTime(expiresAt, clockNow)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              onPlayRecordedTrack(rec);
                              onClose();
                            }}
                            className="min-h-[34px] px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white dark:text-slate-950 text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Play</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
