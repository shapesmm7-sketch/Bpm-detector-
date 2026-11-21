import { AudioTrackItem } from '../plugins/audioLibrary';

export interface CallRecorderSettings {
  alwaysAutoRecord: boolean;
  speakerphoneBoost: boolean;
  includeTabCallAudio: boolean;
  disappearAfterMs: number;
}

export interface TrackedCallRecording {
  id: string;
  uri: string;
  title: string;
  createdAt: number;
  expiresAt: number;
}

export const CALL_SETTINGS_STORAGE_KEY = 'movibe_call_recorder_settings';
export const CALL_EXPIRY_STORAGE_KEY = 'movibe_call_expiry_entries';

export const DEFAULT_CALL_RECORDER_SETTINGS: CallRecorderSettings = {
  alwaysAutoRecord: false,
  speakerphoneBoost: true,
  includeTabCallAudio: false,
  disappearAfterMs: 0,
};

export interface DisappearPresetOption {
  label: string;
  shortLabel: string;
  ms: number;
}

export const DISAPPEAR_PRESETS: DisappearPresetOption[] = [
  { label: 'Never (Keep Forever)', shortLabel: 'Never', ms: 0 },
  { label: '5 Minutes', shortLabel: '5 Min', ms: 5 * 60 * 1000 },
  { label: '1 Hour', shortLabel: '1 Hour', ms: 60 * 60 * 1000 },
  { label: '24 Hours', shortLabel: '24 Hours', ms: 24 * 60 * 60 * 1000 },
  { label: '7 Days', shortLabel: '7 Days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 Days', shortLabel: '30 Days', ms: 30 * 24 * 60 * 60 * 1000 },
];

export function readCallRecorderSettings(): CallRecorderSettings {
  try {
    const raw = localStorage.getItem(CALL_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_CALL_RECORDER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<CallRecorderSettings>;
    return {
      alwaysAutoRecord: Boolean(parsed.alwaysAutoRecord),
      speakerphoneBoost:
        typeof parsed.speakerphoneBoost === 'boolean' ? parsed.speakerphoneBoost : true,
      includeTabCallAudio: Boolean(parsed.includeTabCallAudio),
      disappearAfterMs:
        typeof parsed.disappearAfterMs === 'number' && parsed.disappearAfterMs > 0
          ? parsed.disappearAfterMs
          : 0,
    };
  } catch {
    return DEFAULT_CALL_RECORDER_SETTINGS;
  }
}

export function saveCallRecorderSettings(settings: CallRecorderSettings): void {
  try {
    localStorage.setItem(CALL_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage errors
  }
}

export function readTrackedCallRecordings(): TrackedCallRecording[] {
  try {
    const raw = localStorage.getItem(CALL_EXPIRY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is TrackedCallRecording =>
        Boolean(item) &&
        typeof item.id === 'string' &&
        typeof item.expiresAt === 'number' &&
        typeof item.createdAt === 'number'
    );
  } catch {
    return [];
  }
}

export function saveTrackedCallRecordings(entries: TrackedCallRecording[]): void {
  try {
    localStorage.setItem(CALL_EXPIRY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore storage errors
  }
}

export function trackCallRecordingExpiry(
  song: AudioTrackItem,
  disappearAfterMs: number,
  createdAt = Date.now()
): TrackedCallRecording[] {
  const existing = readTrackedCallRecordings().filter((e) => e.id !== song.id);
  const next: TrackedCallRecording[] = [
    {
      id: song.id,
      uri: song.uri,
      title: song.title || song.displayName,
      createdAt,
      expiresAt: disappearAfterMs > 0 ? createdAt + disappearAfterMs : 0,
    },
    ...existing,
  ];
  saveTrackedCallRecordings(next);
  return next;
}

export function applyDisappearTimerToTrackedRecordings(
  disappearAfterMs: number,
  allSongs?: AudioTrackItem[]
): TrackedCallRecording[] {
  const now = Date.now();
  const existing = readTrackedCallRecordings();
  if (disappearAfterMs <= 0) {
    saveTrackedCallRecordings([]);
    return [];
  }

  const byId = new Map<string, TrackedCallRecording>();
  for (const item of existing) {
    byId.set(item.id, {
      ...item,
      expiresAt: Math.max(now + 1500, item.createdAt + disappearAfterMs),
    });
  }

  if (allSongs) {
    for (const s of allSongs) {
      const isCall =
        s.artist === 'Call Recording' ||
        s.album === 'Mo Vibe Calls' ||
        s.title.toLowerCase().startsWith('call recording');
      if (isCall && !byId.has(s.id)) {
        byId.set(s.id, {
          id: s.id,
          uri: s.uri,
          title: s.title || s.displayName,
          createdAt: now,
          expiresAt: now + disappearAfterMs,
        });
      }
    }
  }

  const next = Array.from(byId.values());
  saveTrackedCallRecordings(next);
  return next;
}

export function removeTrackedCallRecordings(ids: string[]): TrackedCallRecording[] {
  if (ids.length === 0) return readTrackedCallRecordings();
  const idSet = new Set(ids);
  const next = readTrackedCallRecordings().filter((e) => !idSet.has(e.id));
  saveTrackedCallRecordings(next);
  return next;
}

export function formatDisappearDuration(ms: number): string {
  if (!ms || ms <= 0) return 'Never';
  const preset = DISAPPEAR_PRESETS.find((p) => p.ms === ms);
  if (preset) return preset.shortLabel;

  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) {
    return `${Math.max(1, totalMinutes)} Min`;
  }
  const totalHours = Math.round(ms / 3_600_000);
  if (totalHours < 24 || ms % 86_400_000 !== 0) {
    return `${totalHours} ${totalHours === 1 ? 'Hour' : 'Hours'}`;
  }
  const totalDays = Math.round(ms / 86_400_000);
  return `${totalDays} ${totalDays === 1 ? 'Day' : 'Days'}`;
}

export function formatRemainingDisappearTime(expiresAt: number, now = Date.now()): string {
  const diff = expiresAt - now;
  if (diff <= 0) return 'Expired';
  const totalSec = Math.ceil(diff / 1000);
  if (totalSec < 60) return `${totalSec}s left`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m left`;
  const totalHours = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  if (totalHours < 24) {
    return remMin > 0 ? `${totalHours}h ${remMin}m left` : `${totalHours}h left`;
  }
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours > 0 ? `${days}d ${remHours}h left` : `${days}d left`;
}
