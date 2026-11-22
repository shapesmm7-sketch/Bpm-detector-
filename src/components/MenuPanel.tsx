import React, { useCallback, useEffect, useState } from 'react';
import {
  Music,
  History,
  ArrowRight,
  Check,
  CheckCircle2,
  PlayCircle,
  Video,
  Settings,
  ExternalLink,
  Info,
  Sun,
  Moon,
  Monitor,
  Palette,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  AppThemeMode,
  AudioLibrary,
  DefaultPlayerStatus,
  isNativeAndroid,
} from '../plugins/audioLibrary';

interface MenuPanelProps {
  onNavigate: (tab: 'analyzer' | 'history') => void;
  historyCount?: number;
  themeMode: AppThemeMode;
  onThemeChange: (theme: AppThemeMode) => void;
}

export const MenuPanel: React.FC<MenuPanelProps> = ({
  onNavigate,
  historyCount = 0,
  themeMode,
  onThemeChange,
}) => {
  const nativeAndroid = isNativeAndroid();
  const [isAppearanceExpanded, setIsAppearanceExpanded] = useState<boolean>(false);
  const [isDefaultPlayerExpanded, setIsDefaultPlayerExpanded] = useState<boolean>(false);
  const [defaultStatus, setDefaultStatus] = useState<DefaultPlayerStatus | null>(null);
  const [isApplyingDefault, setIsApplyingDefault] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<'success' | 'info' | 'warn'>('info');

  const refreshDefaultStatus = useCallback(async () => {
    if (!nativeAndroid) return;
    try {
      const status = await AudioLibrary.getDefaultPlayerStatus();
      setDefaultStatus(status);
    } catch (err) {
      console.warn('Could not read default player status:', err);
    }
  }, [nativeAndroid]);

  useEffect(() => {
    if (!nativeAndroid) return;
    void refreshDefaultStatus();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshDefaultStatus();
      }
    };
    const handleFocus = () => {
      void refreshDefaultStatus();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    let listenerHandle: { remove: () => Promise<void> } | null = null;
    void AudioLibrary.addListener('defaultPlayerStatusChanged', (status) => {
      setDefaultStatus(status);
      if (status.isAudioDefault && status.isVideoDefault) {
        setFeedbackTone('success');
        setFeedbackMessage('Mo Vibe is now your default Audio & Video player.');
      } else if (status.isAudioDefault) {
        setFeedbackTone('success');
        setFeedbackMessage('Mo Vibe is now set for Audio files. Tap Set Video to finish video files too.');
      } else if (status.isVideoDefault) {
        setFeedbackTone('success');
        setFeedbackMessage('Mo Vibe is now set for Video files. Tap Set Audio to finish audio files too.');
      }
    }).then((handle) => {
      listenerHandle = handle;
    });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      if (listenerHandle) {
        void listenerHandle.remove();
      }
    };
  }, [nativeAndroid, refreshDefaultStatus]);

  const handleSetDefault = async (mediaType: 'auto' | 'audio' | 'video' = 'auto') => {
    if (!nativeAndroid) {
      setFeedbackTone('info');
      setFeedbackMessage(
        'Default system player setup works on the Mo Vibe Android app. On Android, tapping Set as Default lets Mo Vibe open every audio and video file.'
      );
      return;
    }

    setIsApplyingDefault(true);
    try {
      const res = await AudioLibrary.setAsDefaultPlayer({ mediaType });
      setDefaultStatus({
        supported: res.supported,
        isAudioDefault: res.isAudioDefault,
        isVideoDefault: res.isVideoDefault,
        audioDefaultApp: res.audioDefaultApp,
        audioDefaultPkg: res.audioDefaultPkg,
        videoDefaultApp: res.videoDefaultApp,
        videoDefaultPkg: res.videoDefaultPkg,
      });

      if (res.action === 'already_default') {
        setFeedbackTone('success');
        setFeedbackMessage(
          res.target === 'both'
            ? 'Mo Vibe is already your default Audio and Video player.'
            : `Mo Vibe is already set as your default ${res.target} player.`
        );
      } else if (res.action === 'prompted_chooser') {
        setFeedbackTone('info');
        setFeedbackMessage(
          `In the Android popup, select Mo Vibe and tap "Always" to set it as your default ${res.target} player.`
        );
      } else if (res.action === 'opened_clear_defaults') {
        setFeedbackTone('warn');
        setFeedbackMessage(
          `${res.lockedApp || 'Another app'} is currently set as default for ${res.target}. Tap "Clear defaults" (or "Open by default") there, then return and tap Set again.`
        );
      } else {
        setFeedbackTone('info');
        setFeedbackMessage('Opened Android default apps settings. Select Mo Vibe for audio and video.');
      }
    } catch (err) {
      console.error('Failed to set Mo Vibe as default player:', err);
      setFeedbackTone('warn');
      setFeedbackMessage('Could not open Android default player prompt. Use Android Settings below.');
    } finally {
      setIsApplyingDefault(false);
    }
  };

  const handleOpenSettings = async () => {
    if (!nativeAndroid) {
      setFeedbackTone('info');
      setFeedbackMessage('Android Default Apps settings are only available inside the Mo Vibe Android app.');
      return;
    }
    try {
      await AudioLibrary.openDefaultAppsSettings();
    } catch (err) {
      console.warn('Could not open default apps settings:', err);
    }
  };

  const isFullyDefault = Boolean(defaultStatus?.isAudioDefault && defaultStatus?.isVideoDefault);

  const appearanceOptions: Array<{
    id: AppThemeMode;
    label: string;
    icon: React.ReactNode;
  }> = [
    { id: 'dark', label: 'Dark', icon: <Moon className="w-4 h-4 shrink-0" /> },
    { id: 'light', label: 'Light', icon: <Sun className="w-4 h-4 shrink-0" /> },
    { id: 'system', label: 'System', icon: <Monitor className="w-4 h-4 shrink-0" /> },
  ];

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-4">
      <div className="space-y-4">
        {/* BPM Analyzer & Player Heading Button */}
        <button
          type="button"
          onClick={() => onNavigate('analyzer')}
          className="w-full bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border-2 border-slate-200 dark:border-slate-800 hover:border-emerald-500/60 rounded-2xl p-6 text-left transition-all cursor-pointer flex items-center justify-between group shadow-sm dark:shadow-xl active:scale-[0.99]"
        >
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-500 group-hover:text-slate-950 transition-colors shrink-0">
              <Music className="w-6 h-6" />
            </div>
            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors truncate">
              BPM Analyzer &amp; Player
            </span>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-400 dark:text-slate-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:translate-x-1 transition-all shrink-0" />
        </button>

        {/* History Log Heading Button */}
        <button
          type="button"
          onClick={() => onNavigate('history')}
          className="w-full bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border-2 border-slate-200 dark:border-slate-800 hover:border-emerald-500/60 rounded-2xl p-6 text-left transition-all cursor-pointer flex items-center justify-between group shadow-sm dark:shadow-xl active:scale-[0.99]"
        >
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-500 group-hover:text-slate-950 transition-colors shrink-0">
              <History className="w-6 h-6" />
            </div>
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors truncate">
                History Log
              </span>
              {historyCount > 0 && (
                <span className="text-xs font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                  · {historyCount}
                </span>
              )}
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-400 dark:text-slate-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:translate-x-1 transition-all shrink-0" />
        </button>

        {/* Collapsible Appearance Section */}
        <section className="bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm dark:shadow-xl overflow-hidden">
          <button
            type="button"
            aria-expanded={isAppearanceExpanded}
            onClick={() => setIsAppearanceExpanded((v) => !v)}
            className="w-full p-6 text-left flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                <Palette className="w-6 h-6" />
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 leading-tight truncate">
                Appearance
              </h3>
            </div>
            {isAppearanceExpanded ? (
              <ChevronDown className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <ChevronRight className="w-5 h-5 text-slate-400 dark:text-slate-500 shrink-0" />
            )}
          </button>

          {isAppearanceExpanded && (
            <div className="px-5 pb-5 sm:px-6 sm:pb-6 pt-1 border-t border-slate-100 dark:border-slate-800 space-y-4">
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed pt-2">
                Choose Dark Mode, Light Mode, or match your phone system theme.
              </p>

              <div
                role="radiogroup"
                aria-label="App appearance theme"
                className="grid grid-cols-3 gap-2 p-1.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
              >
                {appearanceOptions.map((opt) => {
                  const isSelected = themeMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => onThemeChange(opt.id)}
                      className={`min-h-[48px] px-3 py-2.5 rounded-lg text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
                        isSelected
                          ? 'bg-emerald-500 text-slate-950 shadow-sm'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-white/80 dark:hover:bg-slate-800/80'
                      }`}
                    >
                      {opt.icon}
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Collapsible Set Mo Vibe as Default Player Card */}
        <section className="bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm dark:shadow-xl overflow-hidden">
          <button
            type="button"
            aria-expanded={isDefaultPlayerExpanded}
            onClick={() => setIsDefaultPlayerExpanded((v) => !v)}
            className="w-full p-6 text-left flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-4 min-w-0">
              <div
                className={`w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 ${
                  isFullyDefault
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                    : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {isFullyDefault ? (
                  <CheckCircle2 className="w-6 h-6" />
                ) : (
                  <PlayCircle className="w-6 h-6" />
                )}
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 leading-tight truncate">
                Set Mo Vibe as Default Player
              </h3>
            </div>
            {isDefaultPlayerExpanded ? (
              <ChevronDown className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <ChevronRight className="w-5 h-5 text-slate-400 dark:text-slate-500 shrink-0" />
            )}
          </button>

          {isDefaultPlayerExpanded && (
            <div className="px-5 pb-5 sm:px-6 sm:pb-6 pt-1 border-t border-slate-100 dark:border-slate-800 space-y-4">
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed pt-2">
                Open and play any audio or video file clicked on your phone directly in Mo Vibe.
              </p>

              {/* Primary Action Button */}
              <button
                type="button"
                onClick={() => void handleSetDefault('auto')}
                disabled={isApplyingDefault}
                className={`w-full min-h-[48px] px-4 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer active:scale-[0.99] disabled:opacity-70 ${
                  isFullyDefault
                    ? 'bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/15'
                }`}
              >
                {isFullyDefault ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Mo Vibe is Default Player</span>
                  </>
                ) : (
                  <>
                    <PlayCircle className="w-4 h-4 shrink-0" />
                    <span>
                      {defaultStatus?.isAudioDefault && !defaultStatus?.isVideoDefault
                        ? 'Set Mo Vibe Default for Video'
                        : !defaultStatus?.isAudioDefault && defaultStatus?.isVideoDefault
                        ? 'Set Mo Vibe Default for Audio'
                        : 'Set as Default Player'}
                    </span>
                  </>
                )}
              </button>

              {/* Per-Media-Type Controls on Native Android */}
              {nativeAndroid && defaultStatus && (
                <div className="divide-y divide-slate-200 dark:divide-slate-800/80 border-t border-slate-200 dark:border-slate-800/80 pt-1">
                  {/* Audio Default Row */}
                  <div className="py-3 flex items-center justify-between gap-3 min-w-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Music className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-200 truncate">
                          Audio Files
                        </p>
                        <p
                          className={`text-xs truncate ${
                            defaultStatus.isAudioDefault
                              ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                              : defaultStatus.audioDefaultApp
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {defaultStatus.isAudioDefault
                            ? 'Default · Mo Vibe'
                            : defaultStatus.audioDefaultApp
                            ? `Current · ${defaultStatus.audioDefaultApp}`
                            : 'Not set yet'}
                        </p>
                      </div>
                    </div>

                    {defaultStatus.isAudioDefault ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                        <Check className="w-4 h-4" />
                        <span>Ready</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleSetDefault('audio')}
                        disabled={isApplyingDefault}
                        className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold cursor-pointer transition-colors shrink-0"
                      >
                        {defaultStatus.audioDefaultApp ? 'Clear & Set' : 'Set Audio'}
                      </button>
                    )}
                  </div>

                  {/* Video Default Row */}
                  <div className="py-3 flex items-center justify-between gap-3 min-w-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Video className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-200 truncate">
                          Video Files
                        </p>
                        <p
                          className={`text-xs truncate ${
                            defaultStatus.isVideoDefault
                              ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                              : defaultStatus.videoDefaultApp
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {defaultStatus.isVideoDefault
                            ? 'Default · Mo Vibe'
                            : defaultStatus.videoDefaultApp
                            ? `Current · ${defaultStatus.videoDefaultApp}`
                            : 'Not set yet'}
                        </p>
                      </div>
                    </div>

                    {defaultStatus.isVideoDefault ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                        <Check className="w-4 h-4" />
                        <span>Ready</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleSetDefault('video')}
                        disabled={isApplyingDefault}
                        className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold cursor-pointer transition-colors shrink-0"
                      >
                        {defaultStatus.videoDefaultApp ? 'Clear & Set' : 'Set Video'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Action Feedback Banner */}
              {feedbackMessage && (
                <div
                  className={`p-3 rounded-xl border text-xs leading-relaxed flex items-start gap-2.5 ${
                    feedbackTone === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                      : feedbackTone === 'warn'
                      ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300'
                      : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{feedbackMessage}</span>
                </div>
              )}

              {/* Secondary System Settings Link */}
              {nativeAndroid && (
                <button
                  type="button"
                  onClick={() => void handleOpenSettings()}
                  className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Settings className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                  <span>Open Android Default Apps Settings</span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
