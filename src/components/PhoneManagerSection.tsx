import React, { useState, useEffect, useRef } from 'react';
import {
  HardDrive,
  Mail,
  FolderOpen,
  ShieldCheck,
  ArrowLeft,
  ChevronRight,
  FileText,
  Settings,
  Sparkles,
  Copy,
  ShieldAlert,
  X,
  Loader2,
} from 'lucide-react';
import { isNativeAndroid } from '../plugins/audioLibrary';
import {
  AllFilesAccessStatus,
  PhoneManager,
  formatBytes,
  formatShortDate,
} from '../plugins/phoneManager';
import {
  CachedPhoneIndexState,
  clearCachedPhoneIndex,
  getCachedPhoneIndexState,
  subscribePhoneIndexCache,
  syncCachedPhoneIndex,
} from '../utils/fileIndexCache';
import {
  ConnectedEmailAccount,
  getConnectedEmailAccounts,
  subscribeConnectedAccounts,
} from '../utils/emailAuthAndApi';
import { StorageManagerView, StorageSubTool } from './phone-manager/StorageManagerView';
import { EmailManagerView } from './phone-manager/EmailManagerView';
import { FileManagerView } from './phone-manager/FileManagerView';
import { PrivacyToolsView } from './phone-manager/PrivacyToolsView';

type PhoneManagerScreen = 'home' | 'storage' | 'email' | 'files' | 'privacy';

interface PhoneManagerSectionProps {
  isActiveTab: boolean;
}

export const PhoneManagerSection: React.FC<PhoneManagerSectionProps> = ({
  isActiveTab,
}) => {
  const [screen, setScreen] = useState<PhoneManagerScreen>('home');
  const [storageInitialTool, setStorageInitialTool] = useState<StorageSubTool>('analyzer');
  const [indexState, setIndexState] = useState<CachedPhoneIndexState>(() =>
    getCachedPhoneIndexState()
  );
  const [allFilesStatus, setAllFilesStatus] = useState<AllFilesAccessStatus | null>(null);
  const [allFilesDismissed, setAllFilesDismissed] = useState(false);
  const [permissionRefreshKey, setPermissionRefreshKey] = useState(0);
  const lastAllFilesGrantedRef = useRef<boolean | null>(null);
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedEmailAccount[]>(() =>
    getConnectedEmailAccounts()
  );

  const summary = indexState.summary;

  useEffect(() => {
    const unsubIndex = subscribePhoneIndexCache((next) => {
      setIndexState(next);
    });
    const unsubAccounts = subscribeConnectedAccounts(() => {
      setConnectedAccounts(getConnectedEmailAccounts());
    });
    return () => {
      unsubIndex();
      unsubAccounts();
    };
  }, []);

  const refreshSummary = async (forceRefresh = false) => {
    try {
      await syncCachedPhoneIndex(forceRefresh);
    } catch {
      // ignore initial read error until permission granted
    }
  };

  const syncAllFilesStatus = async () => {
    if (!isNativeAndroid()) return;
    try {
      const status = await PhoneManager.getAllFilesAccessStatus();
      setAllFilesStatus(status);
      const prev = lastAllFilesGrantedRef.current;
      lastAllFilesGrantedRef.current = status.granted;
      if (status.granted && prev === false) {
        clearCachedPhoneIndex();
        setPermissionRefreshKey((k) => k + 1);
        await refreshSummary(true);
      }
    } catch {
      // keep UI responsive even if check fails
    }
  };

  const handleRequestAllFilesAccess = async () => {
    if (!isNativeAndroid()) return;
    try {
      const res = await PhoneManager.requestAllFilesAccess();
      setAllFilesStatus(res);
      const prev = lastAllFilesGrantedRef.current;
      lastAllFilesGrantedRef.current = res.granted;
      if (res.granted && prev !== true) {
        clearCachedPhoneIndex();
        setPermissionRefreshKey((k) => k + 1);
        await refreshSummary(true);
      }
    } catch {
      // Permission denial or canceled settings flow should never crash
    }
  };

  useEffect(() => {
    if (!isNativeAndroid()) return;
    let allFilesHandle: { remove: () => Promise<void> } | null = null;

    void PhoneManager.addListener('allFilesAccessChanged', (ev) => {
      setAllFilesStatus((prev) => ({
        granted: ev.granted,
        supported: prev?.supported ?? ev.sdkInt >= 30,
        hasMediaRead: ev.hasMediaRead,
        sdkInt: ev.sdkInt,
      }));
      const prev = lastAllFilesGrantedRef.current;
      lastAllFilesGrantedRef.current = ev.granted;
      if (ev.granted && prev !== true) {
        clearCachedPhoneIndex();
        setPermissionRefreshKey((k) => k + 1);
        void refreshSummary(true);
      }
    }).then((h) => {
      allFilesHandle = h;
    });

    const handleResumeCheck = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void syncAllFilesStatus();
    };
    document.addEventListener('visibilitychange', handleResumeCheck);
    window.addEventListener('focus', handleResumeCheck);

    return () => {
      if (allFilesHandle) void allFilesHandle.remove();
      document.removeEventListener('visibilitychange', handleResumeCheck);
      window.removeEventListener('focus', handleResumeCheck);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isActiveTab) {
      void syncAllFilesStatus();
      if (!getCachedPhoneIndexState().ready) {
        void refreshSummary(false);
      }
      setConnectedAccounts(getConnectedEmailAccounts());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActiveTab]);

  const syncEmailAccounts = () => {
    setConnectedAccounts(getConnectedEmailAccounts());
  };

  const allFilesGranted = Boolean(allFilesStatus?.granted ?? summary?.hasAllFilesAccess);

  const openStorageTool = (tool: StorageSubTool) => {
    setStorageInitialTool(tool);
    setScreen('storage');
  };

  const usedPercent =
    summary && summary.totalBytes > 0
      ? Math.min(100, Math.round((summary.usedBytes / summary.totalBytes) * 100))
      : 0;

  const toolCards: Array<{
    id: Exclude<PhoneManagerScreen, 'home'>;
    title: string;
    description: string;
    metric: string;
    icon: React.ReactNode;
    accentBg: string;
  }> = [
    {
      id: 'storage',
      title: 'Storage Manager',
      description: 'Analyzer, SHA-256 duplicates, WhatsApp & Downloads cleaner, Photo/Video compressor',
      metric: summary && summary.totalBytes > 0 ? `${usedPercent}% used` : 'Local Storage',
      icon: <HardDrive className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />,
      accentBg: 'bg-emerald-500/10 border-emerald-500/20',
    },
    {
      id: 'email',
      title: 'Email Manager',
      description: 'Official OAuth inbox cleanup, bulk trash/archive, large attachments & unsubscribe review',
      metric:
        connectedAccounts.length > 0
          ? `${connectedAccounts.length} connected`
          : 'No accounts linked',
      icon: <Mail className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
      accentBg: 'bg-blue-500/10 border-blue-500/20',
    },
    {
      id: 'files',
      title: 'File Manager',
      description: 'Browse Internal, SD Card & SAF folders, search, move/copy, ZIP compress & extract',
      metric: summary
        ? `${Object.values(summary.categories).reduce((s, c) => s + c.count, 0).toLocaleString()} indexed`
        : 'Folders & Files',
      icon: <FolderOpen className="w-5 h-5 text-amber-600 dark:text-amber-400" />,
      accentBg: 'bg-amber-500/10 border-amber-500/20',
    },
    {
      id: 'privacy',
      title: 'Privacy Tools',
      description: 'Mic, Camera, Location & Notification permission shortcuts, clipboard clear & safe guidance',
      metric: 'Controls & Info',
      icon: <ShieldCheck className="w-5 h-5 text-violet-600 dark:text-violet-400" />,
      accentBg: 'bg-violet-500/10 border-violet-500/20',
    },
  ];

  const screenTitle =
    screen === 'storage'
      ? 'Storage Manager'
      : screen === 'email'
        ? 'Email Manager'
        : screen === 'files'
          ? 'File Manager'
          : screen === 'privacy'
            ? 'Privacy Tools'
            : 'Phone Manager';

  return (
    <div className="space-y-5">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {screen !== 'home' && (
            <button
              type="button"
              onClick={() => setScreen('home')}
              className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:border-emerald-500/40 cursor-pointer"
              aria-label="Back to Phone Manager Dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              {screenTitle}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Manage device storage, email accounts, local files, and privacy shortcuts in one workspace
            </p>
          </div>
        </div>
      </div>

      {/* PHONE MANAGER HOME DASHBOARD */}
      {screen === 'home' && (
        <div className="space-y-5">
          {isNativeAndroid() && indexState.isIndexing && (
            <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-2xl px-4 py-3 flex items-center gap-3">
              <Loader2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 animate-spin shrink-0" />
              <p className="text-xs text-slate-700 dark:text-slate-200 font-medium">
                Indexing accessible device files once so Folders, Images, Videos, Audio, Documents & Downloads open instantly...
              </p>
            </div>
          )}

          {isNativeAndroid() && allFilesStatus && !allFilesStatus.granted && !allFilesDismissed && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="p-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <div className="space-y-1 min-w-0">
                  <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                    Allow All Files Access for full Storage & File Manager scans
                  </p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                    Enables scanning shared internal storage & SD card folders, Downloads, WhatsApp media cleanup, duplicate hashing, and rename/move/delete actions. Private app directories (/Android/data, /Android/obb) and protected WhatsApp databases remain restricted by Android, and you can still use SAF folder access if you decline.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleRequestAllFilesAccess()}
                  className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold cursor-pointer"
                >
                  Allow All Files Access
                </button>
                <button
                  type="button"
                  onClick={() => setAllFilesDismissed(true)}
                  className="p-2 rounded-xl bg-white/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                  aria-label="Dismiss All Files Access notice"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Quick Status Summary Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-500 dark:text-slate-400">
                  Storage Used
                </span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  {summary && summary.totalBytes > 0 ? `${usedPercent}%` : '—'}
                </span>
              </div>
              <p className="text-sm font-bold text-slate-900 dark:text-white">
                {summary ? `${formatBytes(summary.availableBytes)} free` : 'Tap Storage Manager'}
              </p>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${usedPercent}%` }}
                />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-1.5">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">
                Connected Email Accounts
              </span>
              <p className="text-sm font-bold text-slate-900 dark:text-white">
                {connectedAccounts.length > 0
                  ? connectedAccounts.map((a) => a.email).join(', ')
                  : 'None connected yet'}
              </p>
              <button
                type="button"
                onClick={() => setScreen('email')}
                className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
              >
                {connectedAccounts.length > 0 ? 'Manage Gmail →' : 'Connect Gmail →'}
              </button>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">
                Quick Privacy & Cleanup Shortcuts
              </span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => openStorageTool('duplicates')}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3 h-3 text-emerald-600" />
                  <span>Duplicates</span>
                </button>
                <button
                  type="button"
                  onClick={() => openStorageTool('recommendations')}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Sparkles className="w-3 h-3 text-amber-500" />
                  <span>Cleanup Tips</span>
                </button>
                <button
                  type="button"
                  onClick={() => setScreen('privacy')}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Settings className="w-3 h-3 text-violet-500" />
                  <span>Permissions</span>
                </button>
              </div>
            </div>
          </div>

          {/* Four Main Tool Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {toolCards.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => {
                  if (card.id === 'storage') setStorageInitialTool('analyzer');
                  setScreen(card.id);
                }}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-500/50 rounded-2xl p-4 sm:p-5 text-left transition-all shadow-sm hover:shadow-md flex items-start justify-between gap-3 cursor-pointer"
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className={`p-3 rounded-2xl border shrink-0 ${card.accentBg}`}>
                    {card.icon}
                  </div>
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                        {card.title}
                      </h3>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-mono font-semibold text-slate-600 dark:text-slate-300">
                        {card.metric}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {card.description}
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
              </button>
            ))}
          </div>

          {/* Recent Accessible Files */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Recent Files
              </h3>
              <button
                type="button"
                onClick={() => setScreen('files')}
                className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 cursor-pointer hover:underline"
              >
                Browse All &rarr;
              </button>
            </div>
            {!summary || summary.recentFiles.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                {isNativeAndroid()
                  ? 'Grant media storage access inside Storage Manager or File Manager to display recent device files.'
                  : 'Select a local folder or files inside Storage Manager or File Manager to view recent local files.'}
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {summary.recentFiles.slice(0, 6).map((f) => (
                  <div key={f.uri} className="py-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {f.name}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {f.category} · {formatShortDate(f.dateModified)}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300 shrink-0">
                      {formatBytes(f.size)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {screen === 'storage' && (
        <StorageManagerView
          initialTool={storageInitialTool}
          summary={summary}
          onRefreshSummary={() => refreshSummary(true)}
          allFilesGranted={allFilesGranted}
          onRequestAllFilesAccess={handleRequestAllFilesAccess}
          refreshKey={permissionRefreshKey}
        />
      )}

      {screen === 'email' && (
        <EmailManagerView
          accounts={connectedAccounts}
          onAccountsChanged={syncEmailAccounts}
        />
      )}

      {screen === 'files' && (
        <FileManagerView
          onStorageMutated={() => refreshSummary(true)}
          allFilesGranted={allFilesGranted}
          onRequestAllFilesAccess={handleRequestAllFilesAccess}
          refreshKey={permissionRefreshKey}
        />
      )}

      {screen === 'privacy' && <PrivacyToolsView />}
    </div>
  );
};
