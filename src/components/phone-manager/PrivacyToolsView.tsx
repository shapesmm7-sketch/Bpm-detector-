import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Mic,
  Camera,
  MapPin,
  Bell,
  Settings,
  Clipboard,
  Trash2,
  Globe,
  HardDrive,
  Smartphone,
  Info,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { isNativeAndroid } from '../../plugins/audioLibrary';
import {
  PhoneManager,
  PrivacyOverviewResult,
  formatBytes,
} from '../../plugins/phoneManager';

export const PrivacyToolsView: React.FC = () => {
  const [overview, setOverview] = useState<PrivacyOverviewResult | null>(null);
  const [webPerms, setWebPerms] = useState<{
    microphone: string;
    camera: string;
    geolocation: string;
    notifications: string;
  }>({
    microphone: 'prompt',
    camera: 'prompt',
    geolocation: 'prompt',
    notifications: typeof Notification !== 'undefined' ? Notification.permission : 'default',
  });
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    void loadPrivacyStatus();
  }, []);

  const loadPrivacyStatus = async () => {
    if (isNativeAndroid()) {
      try {
        const res = await PhoneManager.getPrivacyOverview();
        setOverview(res);
      } catch (err) {
        setErrorMsg((err as Error)?.message || 'Could not load Android privacy status.');
      }
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      const querySafe = async (name: PermissionName) => {
        try {
          const st = await navigator.permissions.query({ name });
          return st.state;
        } catch {
          return 'prompt';
        }
      };
      const [mic, cam, geo] = await Promise.all([
        querySafe('microphone' as PermissionName),
        querySafe('camera' as PermissionName),
        querySafe('geolocation' as PermissionName),
      ]);
      setWebPerms({
        microphone: mic,
        camera: cam,
        geolocation: geo,
        notifications: typeof Notification !== 'undefined' ? Notification.permission : 'default',
      });
    }
  };

  const openSetting = async (
    target: 'app_details' | 'privacy_dashboard' | 'notifications' | 'all_apps',
    label: string
  ) => {
    setErrorMsg(null);
    if (!isNativeAndroid()) {
      setStatusMsg(
        `Android system settings shortcuts ("${label}") open native Android Settings when running inside the Mo Vibe Android app.`
      );
      return;
    }
    try {
      await PhoneManager.openPrivacySetting({ target });
    } catch (err) {
      setErrorMsg((err as Error)?.message || `Could not open ${label}.`);
    }
  };

  const handleClearClipboard = async () => {
    setErrorMsg(null);
    try {
      if (isNativeAndroid()) {
        await PhoneManager.clearClipboard();
        await loadPrivacyStatus();
        setStatusMsg('Device clipboard cleared.');
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText('');
        setStatusMsg('Clipboard contents cleared.');
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Clipboard write permission is required to clear clipboard in this browser.');
    }
  };

  const permissionShortcuts: Array<{
    id: string;
    label: string;
    desc: string;
    granted?: boolean;
    webState?: string;
    target: 'app_details' | 'privacy_dashboard' | 'notifications' | 'all_apps';
    icon: React.ReactNode;
  }> = [
    {
      id: 'app_perms',
      label: 'App Permissions Settings',
      desc: 'Review & revoke Mo Vibe permissions in Android Settings',
      granted: overview?.permissions.mediaStorage,
      target: 'app_details',
      icon: <Settings className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
    },
    {
      id: 'mic',
      label: 'Microphone Permission',
      desc: 'Used only when you open Voice or Call Recorder',
      granted: overview?.permissions.microphone,
      webState: webPerms.microphone,
      target: 'app_details',
      icon: <Mic className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
    },
    {
      id: 'cam',
      label: 'Camera Permission',
      desc: 'Inspect or revoke camera access in system settings',
      granted: overview?.permissions.camera,
      webState: webPerms.camera,
      target: 'app_details',
      icon: <Camera className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />,
    },
    {
      id: 'loc',
      label: 'Location Permission',
      desc: 'Manage location access via Android Privacy Settings',
      granted: overview?.permissions.location,
      webState: webPerms.geolocation,
      target: 'privacy_dashboard',
      icon: <MapPin className="w-4 h-4 text-violet-600 dark:text-violet-400" />,
    },
    {
      id: 'notif',
      label: 'Notification Permission',
      desc: 'Control media playback & recording status notifications',
      granted: overview?.permissions.notifications,
      webState: webPerms.notifications,
      target: 'notifications',
      icon: <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
    },
    {
      id: 'all_apps',
      label: 'Installed Apps Manager',
      desc: 'Open Android Installed Applications settings list',
      target: 'all_apps',
      icon: <Smartphone className="w-4 h-4 text-blue-600 dark:text-blue-400" />,
    },
  ];

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}
      {statusMsg && (
        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* System Permissions Shortcuts */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Android Permissions & Privacy Shortcuts
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Direct shortcuts to system permission controls and installed app settings
            </p>
          </div>
          <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {permissionShortcuts.map((sc) => {
            const stateLabel =
              sc.granted !== undefined
                ? sc.granted
                  ? 'Granted'
                  : 'Not Granted'
                : sc.webState
                  ? sc.webState
                  : 'Settings';
            return (
              <button
                key={sc.id}
                type="button"
                onClick={() => void openSetting(sc.target, sc.label)}
                className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 hover:border-emerald-500/40 text-left flex items-center justify-between gap-2.5 cursor-pointer transition-colors"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shrink-0">
                    {sc.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {sc.label}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                      {sc.desc}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold capitalize ${
                      stateLabel === 'Granted' || stateLabel === 'granted'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {stateLabel}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* App Info, Available Storage & Clipboard Privacy */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              App & Storage Telemetry
            </h4>
          </div>
          {overview ? (
            <div className="text-xs space-y-1 text-slate-600 dark:text-slate-300">
              <p>
                <strong>Package:</strong> {overview.packageName} (v{overview.versionName})
              </p>
              <p>
                <strong>Android OS:</strong> Android {overview.androidVersion} (API {overview.sdkInt})
              </p>
              <p>
                <strong>Available Storage:</strong> {formatBytes(overview.availableStorageBytes)} of{' '}
                {formatBytes(overview.totalStorageBytes)}
              </p>
            </div>
          ) : (
            <div className="text-xs space-y-1 text-slate-600 dark:text-slate-300">
              <p>
                <strong>Platform:</strong> Web / PWA Session
              </p>
              <p>
                <strong>User Agent:</strong>{' '}
                {typeof navigator !== 'undefined' ? navigator.platform : 'Browser'}
              </p>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clipboard className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                Clipboard Privacy
              </h4>
            </div>
            {overview && (
              <span className="text-[11px] font-mono text-slate-500">
                {overview.hasClipboardItem
                  ? `Item (${overview.clipboardMime || 'text'})`
                  : 'Empty'}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Android 12+ alerts you when apps read clipboard contents. Clear sensitive text or OTP codes stored on your clipboard when finished.
          </p>
          <button
            type="button"
            onClick={() => void handleClearClipboard()}
            className="px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Clipboard</span>
          </button>
        </div>
      </div>

      {/* Safe Browsing & Honest Flash-Storage Deletion Guidance */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              Safe Browsing & Email Hygiene
            </h4>
          </div>
          <ul className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1.5 list-disc pl-4">
            <li>Inspect sender addresses and domain names before clicking unsubscribe or password reset links.</li>
            <li>Review APK files in Downloads and delete installers from unverified sources.</li>
            <li>Use Google Play Protect and Chrome Enhanced Safe Browsing rather than third-party "antivirus" claims.</li>
          </ul>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              Secure Deletion on Flash Storage
            </h4>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
            Modern Android phones use UFS/eMMC flash memory with wear-leveling and FTL block remapping, so multi-pass "shredding" apps cannot guarantee overwriting the exact physical cells of a single file. Keep Android File-Based Encryption enabled (default on Android 7+), delete unwanted copies, empty Trash, and perform an encrypted Factory Reset before selling a device.
          </p>
        </div>
      </div>
    </div>
  );
};
