/**
 * Web Audio Metronome Engine
 * Sample-accurate phase-locked scheduling synced with audio track playback.
 */

import { getAudioContext } from './audioAnalyzer';

export interface MetronomeSyncState {
  isPlayingAudio: boolean;
  bpm: number;
  firstBeatOffsetSec: number;
  trackCurrentTimeSec: number;
  playbackRate: number;
  audioCtxStartTime: number;
  audioStartOffset: number;
}

export class MetronomeEngine {
  private ctx: AudioContext | null = null;
  private isRunning: boolean = false;
  private bpm: number = 120;
  private firstBeatOffsetSec: number = 0;
  private volume: number = 0.7;
  private timerId: number | null = null;
  private scheduledBeats = new Set<number>();
  private syncState: MetronomeSyncState | null = null;
  private standaloneNextTime: number = 0;
  private standaloneBeatIdx: number = 0;

  constructor() {
    this.ctx = getAudioContext();
  }

  public setBpm(bpm: number) {
    this.bpm = bpm > 0 ? bpm : 120;
  }

  public setFirstBeatOffset(offsetSec: number) {
    this.firstBeatOffsetSec = offsetSec;
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  /**
   * Locks metronome to the exact audio playback buffer and phase
   */
  public startSynced(
    ctxStartTime: number,
    startOffsetSec: number,
    bpm: number,
    firstBeatOffsetSec: number,
    playbackRate: number
  ) {
    this.ctx = getAudioContext();
    this.bpm = bpm > 0 ? bpm : 120;
    this.firstBeatOffsetSec = firstBeatOffsetSec;
    this.isRunning = true;
    this.scheduledBeats.clear();

    this.syncState = {
      isPlayingAudio: true,
      bpm: this.bpm,
      firstBeatOffsetSec,
      trackCurrentTimeSec: startOffsetSec,
      playbackRate: playbackRate > 0 ? playbackRate : 1.0,
      audioCtxStartTime: ctxStartTime,
      audioStartOffset: startOffsetSec,
    };

    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }

    this.scheduler();
  }

  /**
   * Starts metronome in standalone mode (when audio is paused)
   */
  public startStandalone() {
    this.ctx = getAudioContext();
    this.isRunning = true;
    this.syncState = null;
    this.scheduledBeats.clear();

    const now = this.ctx.currentTime;
    this.standaloneNextTime = now + 0.05;
    this.standaloneBeatIdx = 0;

    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }

    this.scheduler();
  }

  public stop() {
    this.isRunning = false;
    this.syncState = null;
    this.scheduledBeats.clear();
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  public updateRate(rate: number) {
    if (this.syncState) {
      this.syncState.playbackRate = rate > 0 ? rate : 1.0;
    }
  }

  private scheduler = () => {
    if (!this.isRunning || !this.ctx) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const lookaheadSec = 0.15; // 150ms lookahead window

    if (this.syncState && this.syncState.isPlayingAudio) {
      const { bpm, firstBeatOffsetSec, audioCtxStartTime, audioStartOffset, playbackRate } = this.syncState;
      const beatPeriodTrack = 60 / bpm; // Beat interval in track audio seconds

      // Current track position in seconds
      const elapsedCtxTime = (now - audioCtxStartTime) * playbackRate;
      const currentTrackSec = audioStartOffset + elapsedCtxTime;

      // Find beat indices within [currentTrackSec, currentTrackSec + lookaheadSec * playbackRate]
      const minTrackSec = Math.max(0, currentTrackSec - 0.02);
      const maxTrackSec = currentTrackSec + lookaheadSec * playbackRate;

      // First beat index k
      const startK = Math.floor((minTrackSec - firstBeatOffsetSec) / beatPeriodTrack);
      const endK = Math.ceil((maxTrackSec - firstBeatOffsetSec) / beatPeriodTrack) + 1;

      for (let k = startK; k <= endK; k++) {
        if (k < 0) continue;
        if (this.scheduledBeats.has(k)) continue;

        const beatTrackSec = firstBeatOffsetSec + k * beatPeriodTrack;
        if (beatTrackSec < minTrackSec || beatTrackSec > maxTrackSec) continue;

        // Convert beatTrackSec to exact AudioContext timestamp
        const timeFromStartOffset = beatTrackSec - audioStartOffset;
        const targetCtxTime = audioCtxStartTime + timeFromStartOffset / playbackRate;

        if (targetCtxTime >= now - 0.02 && targetCtxTime <= now + lookaheadSec) {
          const isDownbeat = ((k % 4) + 4) % 4 === 0;
          this.playClick(Math.max(now, targetCtxTime), isDownbeat);
          this.scheduledBeats.add(k);
        }
      }

      // Cleanup old scheduled beat entries to prevent memory leak
      if (this.scheduledBeats.size > 200) {
        for (const beatKey of this.scheduledBeats) {
          if (beatKey < startK - 50) this.scheduledBeats.delete(beatKey);
        }
      }
    } else {
      // Standalone mode: continuous ticking at this.bpm
      const beatPeriod = 60 / this.bpm;
      while (this.standaloneNextTime < now + lookaheadSec) {
        if (this.standaloneNextTime >= now - 0.02) {
          const isDownbeat = this.standaloneBeatIdx % 4 === 0;
          this.playClick(Math.max(now, this.standaloneNextTime), isDownbeat);
        }
        this.standaloneNextTime += beatPeriod;
        this.standaloneBeatIdx++;
      }
    }

    this.timerId = window.setTimeout(this.scheduler, 25);
  };

  private playClick(timeSec: number, isDownbeat: boolean) {
    if (!this.ctx || this.volume <= 0) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      // Downbeat 1 is a crisp high click (1400Hz), beats 2-3-4 are lower (880Hz)
      osc.frequency.setValueAtTime(isDownbeat ? 1400 : 880, timeSec);

      const dur = 0.025; // 25ms snappy percussion click
      const volMultiplier = isDownbeat ? 0.9 : 0.6;
      gain.gain.setValueAtTime(this.volume * volMultiplier, timeSec);
      gain.gain.exponentialRampToValueAtTime(0.0001, timeSec + dur);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(timeSec);
      osc.stop(timeSec + dur);
    } catch {
      // Audio context might be closing
    }
  }
}
