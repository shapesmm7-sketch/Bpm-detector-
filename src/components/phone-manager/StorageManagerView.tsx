import React, { useState, useEffect, useRef } from 'react';
import {
  HardDrive,
  Copy,
  FileWarning,
  MessageCircle,
  Download,
  Image as ImageIcon,
  Film,
  Sparkles,
  Trash2,
  FolderOpen,
  RefreshCw,
  CheckSquare,
  Square,
  ShieldAlert,
  ArrowRight,
  Sliders,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Play,
} from 'lucide-react';
import { AudioLibrary, isNativeAndroid } from '../../plugins/audioLibrary';
import {
  AudioCoverThumbnail,
  DocumentBadgeTile,
  MediaThumbnail,
  PdfThumbnail,
  isAudioFileItem,
  isImageFileItem,
  isPdfFileItem,
  isVideoFileItem,
} from './MediaThumbnail';
import {
  DuplicateGroup,
  PhoneFileItem,
  PhoneManager,
  StorageCategoryKey,
  StorageSummaryResult,
  formatBytes,
  formatShortDate,
  formatShortDateTime,
} from '../../plugins/phoneManager';
import {
  StorageRecommendationItem,
  buildStorageRecommendations,
  classifyWhatsAppWebCategory,
  compressWebImageFile,
  compressWebVideoFile,
  deleteWebItems,
  findWebDuplicates,
  getAllWebFileItems,
  getWebStorageSummary,
  getWebStoredEntry,
  ingestWebFileList,
  pickWebFolderForWorkspace,
  triggerWebBlobDownload,
} from '../../utils/localStorageAnalyzer';

export type StorageSubTool =
  | 'analyzer'
  | 'duplicates'
  | 'large'
  | 'whatsapp'
  | 'downloads'
  | 'photo_compress'
  | 'video_compress'
  | 'recommendations';

interface StorageManagerViewProps {
  initialTool?: StorageSubTool;
  summary: StorageSummaryResult | null;
  onRefreshSummary: () => Promise<void>;
  allFilesGranted?: boolean;
  onRequestAllFilesAccess?: () => Promise<void>;
  refreshKey?: number;
}

const CATEGORY_META: Array<{
  key: StorageCategoryKey;
  label: string;
  barColor: string;
  badgeColor: string;
}> = [
  { key: 'images', label: 'Images', barColor: 'bg-emerald-500', badgeColor: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'videos', label: 'Videos', barColor: 'bg-cyan-500', badgeColor: 'text-cyan-600 dark:text-cyan-400' },
  { key: 'audio', label: 'Audio', barColor: 'bg-violet-500', badgeColor: 'text-violet-600 dark:text-violet-400' },
  { key: 'documents', label: 'Documents', barColor: 'bg-amber-500', badgeColor: 'text-amber-600 dark:text-amber-400' },
  { key: 'downloads', label: 'Downloads', barColor: 'bg-blue-500', badgeColor: 'text-blue-600 dark:text-blue-400' },
  { key: 'other', label: 'Other Files', barColor: 'bg-slate-400', badgeColor: 'text-slate-600 dark:text-slate-400' },
];

export const StorageManagerView: React.FC<StorageManagerViewProps> = ({
  initialTool = 'analyzer',
  summary,
  onRefreshSummary,
  allFilesGranted = false,
  onRequestAllFilesAccess,
  refreshKey = 0,
}) => {
  const [activeTool, setActiveTool] = useState<StorageSubTool>(initialTool);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Tool states
  const [dupGroups, setDupGroups] = useState<DuplicateGroup[]>([]);
  const [dupWastedBytes, setDupWastedBytes] = useState(0);
  const [largeFiles, setLargeFiles] = useState<PhoneFileItem[]>([]);
  const [largeMinMb, setLargeMinMb] = useState<number>(10);
  const [largeCategory, setLargeCategory] = useState<string>('all');
  const [whatsappFiles, setWhatsappFiles] = useState<PhoneFileItem[]>([]);
  const [waFilter, setWaFilter] = useState<string>('all');
  const [waRequiresSafHint, setWaRequiresSafHint] = useState(false);
  const [downloadsFiles, setDownloadsFiles] = useState<PhoneFileItem[]>([]);
  const [dlSortBy, setDlSortBy] = useState<'size_desc' | 'date_desc' | 'date_asc'>('size_desc');
  const [dlFilter, setDlFilter] = useState<string>('all');
  const [recommendations, setRecommendations] = useState<StorageRecommendationItem[]>([]);

  // Multi-select & Confirmation dialog
  const [selectedUris, setSelectedUris] = useState<Set<string>>(new Set());
  const [confirmDeleteItems, setConfirmDeleteItems] = useState<{
    items: PhoneFileItem[];
    warningText: string;
  } | null>(null);

  // Photo Compressor state
  const [photoCandidates, setPhotoCandidates] = useState<PhoneFileItem[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<{
    item?: PhoneFileItem;
    webFile?: File;
    name: string;
    size: number;
  } | null>(null);
  const [photoQuality, setPhotoQuality] = useState(75);
  const [photoMaxDim, setPhotoMaxDim] = useState(1600);
  const [photoOverwrite, setPhotoOverwrite] = useState(false);
  const [photoResult, setPhotoResult] = useState<{
    originalSize: number;
    compressedSize: number;
    displayPath: string;
    width: number;
    height: number;
  } | null>(null);

  // Video Compressor state
  const [videoCandidates, setVideoCandidates] = useState<PhoneFileItem[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<{
    item?: PhoneFileItem;
    webFile?: File;
    name: string;
    size: number;
  } | null>(null);
  const [videoMaxDim, setVideoMaxDim] = useState(1280);
  const [videoBitrateKbps, setVideoBitrateKbps] = useState(1800);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoResult, setVideoResult] = useState<{
    originalSize: number;
    compressedSize: number;
    displayPath: string;
  } | null>(null);

  const webFolderInputRef = useRef<HTMLInputElement | null>(null);
  const webPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const webVideoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setActiveTool(initialTool);
  }, [initialTool]);

  useEffect(() => {
    if (!isNativeAndroid()) return;
    let handle: { remove: () => Promise<void> } | null = null;
    void PhoneManager.addListener('videoCompressProgress', (payload) => {
      setVideoProgress(payload.percent || 0);
    }).then((h) => {
      handle = h;
    });
    return () => {
      if (handle) void handle.remove();
    };
  }, []);

  // Load current sub-tool automatically when switching
  useEffect(() => {
    setSelectedUris(new Set());
    setErrorMsg(null);
    setStatusMsg(null);
    if (activeTool === 'duplicates') void runDuplicateScan();
    if (activeTool === 'large') void runLargeScan(largeMinMb, largeCategory);
    if (activeTool === 'whatsapp') void runWhatsAppScan();
    if (activeTool === 'downloads') void runDownloadsScan();
    if (activeTool === 'recommendations') void runRecommendationsScan();
    if (activeTool === 'photo_compress') void loadMediaCandidates('photo');
    if (activeTool === 'video_compress') void loadMediaCandidates('video');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  // Automatically re-scan active Storage Manager view when All Files Access permission is granted on resume
  useEffect(() => {
    if (!refreshKey || refreshKey <= 0) return;
    if (activeTool === 'analyzer') void onRefreshSummary();
    if (activeTool === 'duplicates') void runDuplicateScan();
    if (activeTool === 'large') void runLargeScan(largeMinMb, largeCategory);
    if (activeTool === 'whatsapp') void runWhatsAppScan();
    if (activeTool === 'downloads') void runDownloadsScan();
    if (activeTool === 'recommendations') void runRecommendationsScan();
    if (activeTool === 'photo_compress') void loadMediaCandidates('photo');
    if (activeTool === 'video_compress') void loadMediaCandidates('video');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const handleWebFolderPick = async () => {
    setErrorMsg(null);
    setIsLoading(true);
    try {
      const items = await pickWebFolderForWorkspace();
      await onRefreshSummary();
      setStatusMsg(`Scanned ${items.length} local files from your selected folder.`);
    } catch (err) {
      const msg = (err as Error)?.message || '';
      if (msg.includes('not supported') && webFolderInputRef.current) {
        webFolderInputRef.current.click();
      } else if (!msg.toLowerCase().includes('abort')) {
        setErrorMsg(msg || 'Could not scan folder.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleWebFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const items = ingestWebFileList(files);
    await onRefreshSummary();
    setStatusMsg(`Loaded ${items.length} local files for storage inspection.`);
  };

  const runDuplicateScan = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      if (isNativeAndroid()) {
        const res = await PhoneManager.findDuplicates();
        setDupGroups(res.groups || []);
        setDupWastedBytes(res.totalWastedBytes || 0);
      } else {
        const res = await findWebDuplicates();
        setDupGroups(res.groups);
        setDupWastedBytes(res.totalWastedBytes);
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Duplicate scan failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const runLargeScan = async (minMb: number, cat: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    const minBytes = minMb * 1024 * 1024;
    try {
      if (isNativeAndroid()) {
        const res = await PhoneManager.findLargeFiles({
          minSizeBytes: minBytes,
          category: cat,
        });
        setLargeFiles(res.files || []);
      } else {
        const all = getAllWebFileItems()
          .filter((f) => f.size >= minBytes && (cat === 'all' || f.category === cat))
          .sort((a, b) => b.size - a.size);
        setLargeFiles(all);
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Large file scan failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const runWhatsAppScan = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      if (isNativeAndroid()) {
        const res = await PhoneManager.scanWhatsAppMedia();
        setWhatsappFiles(res.files || []);
        setWaRequiresSafHint(Boolean(res.requiresSafHint));
      } else {
        const all = getAllWebFileItems()
          .filter((f) => `${f.path}/${f.name}`.toLowerCase().includes('whatsapp'))
          .map((f) => ({ ...f, category: classifyWhatsAppWebCategory(f) }));
        setWhatsappFiles(all);
        setWaRequiresSafHint(false);
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'WhatsApp media scan failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGrantWhatsAppSaf = async () => {
    if (!isNativeAndroid()) {
      await handleWebFolderPick();
      return;
    }
    try {
      const res = await PhoneManager.requestSafFolderAccess({ preset: 'whatsapp' });
      if (res.granted) {
        setStatusMsg(`Granted access to ${res.label || 'WhatsApp Media'}. Scanning WhatsApp media...`);
        await runWhatsAppScan();
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Could not open Android folder picker.');
    }
  };

  const runDownloadsScan = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      if (isNativeAndroid()) {
        const res = await PhoneManager.scanDownloads();
        setDownloadsFiles(res.files || []);
      } else {
        const thirtyDaysAgo = Date.now() - 30 * 86400_000;
        const all = getAllWebFileItems()
          .filter((f) => f.path.toLowerCase().includes('download') || f.category === 'downloads')
          .map((f) => {
            const lower = f.name.toLowerCase();
            let cat = 'other';
            if (/\.(apk|apks|xapk)$/.test(lower)) cat = 'apk';
            else if (/\.(zip|rar|7z|tar|gz)$/.test(lower)) cat = 'archive';
            else if (lower.endsWith('.pdf')) cat = 'pdf';
            else if (f.dateModified > 0 && f.dateModified < thirtyDaysAgo) cat = 'old';
            return { ...f, category: cat };
          });
        setDownloadsFiles(all);
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Downloads scan failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const runRecommendationsScan = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      let groups: DuplicateGroup[] = [];
      let large: PhoneFileItem[] = [];
      let dls: PhoneFileItem[] = [];
      let wa: PhoneFileItem[] = [];

      if (isNativeAndroid()) {
        const [dRes, lRes, dlRes, waRes] = await Promise.all([
          PhoneManager.findDuplicates(),
          PhoneManager.findLargeFiles({ minSizeBytes: 50 * 1024 * 1024, category: 'all' }),
          PhoneManager.scanDownloads(),
          PhoneManager.scanWhatsAppMedia(),
        ]);
        groups = dRes.groups || [];
        large = lRes.files || [];
        dls = dlRes.files || [];
        wa = waRes.files || [];
      } else {
        const dup = await findWebDuplicates();
        groups = dup.groups;
        const all = getAllWebFileItems();
        large = all.filter((f) => f.size >= 50 * 1024 * 1024);
        dls = all.filter((f) => f.category === 'downloads' || f.path.toLowerCase().includes('download'));
        wa = all
          .filter((f) => f.path.toLowerCase().includes('whatsapp'))
          .map((f) => ({ ...f, category: classifyWhatsAppWebCategory(f) }));
      }

      setRecommendations(
        buildStorageRecommendations({
          duplicateGroups: groups,
          largeFiles: large,
          downloads: dls,
          whatsappFiles: wa,
        })
      );
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Could not compute recommendations.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadMediaCandidates = async (kind: 'photo' | 'video') => {
    setIsLoading(true);
    try {
      if (isNativeAndroid()) {
        if (kind === 'photo') {
          const res = await AudioLibrary.getAllImageFiles();
          setPhotoCandidates(
            (res.images || []).slice(0, 60).map((img) => ({
              id: img.id,
              name: img.displayName || img.title,
              uri: img.uri,
              path: '',
              size: img.size,
              dateModified: 0,
              mimeType: img.mimeType,
              category: 'images',
            }))
          );
        } else {
          const res = await AudioLibrary.getAllVideoFiles();
          setVideoCandidates(
            (res.videos || []).slice(0, 50).map((vid) => ({
              id: vid.id,
              name: vid.displayName || vid.title,
              uri: vid.uri,
              path: '',
              size: vid.size,
              dateModified: 0,
              mimeType: vid.mimeType,
              category: 'videos',
            }))
          );
        }
      } else {
        const all = getAllWebFileItems();
        if (kind === 'photo') {
          setPhotoCandidates(all.filter((f) => f.category === 'images'));
        } else {
          setVideoCandidates(all.filter((f) => f.category === 'videos'));
        }
      }
    } catch {
      // ignore permission warnings here
    } finally {
      setIsLoading(false);
    }
  };

  const toggleUriSelection = (uri: string) => {
    setSelectedUris((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
  };

  const selectAllDuplicateExtras = () => {
    const next = new Set<string>();
    for (const grp of dupGroups) {
      // Preserve copy 0 (oldest original); mark remaining copies for cleanup
      for (let i = 1; i < grp.files.length; i++) {
        next.add(grp.files[i].uri);
      }
    }
    setSelectedUris(next);
  };

  const requestDeleteWithSafetyCheck = (itemsToDelete: PhoneFileItem[], isDuplicates = false) => {
    if (itemsToDelete.length === 0) return;

    let warningText = `Permanently delete ${itemsToDelete.length} selected file(s) from your device? This action cannot be undone.`;
    if (isDuplicates) {
      const delSet = new Set(itemsToDelete.map((i) => i.uri));
      const allCopiesRemovedGroups = dupGroups.filter((g) =>
        g.files.every((f) => delSet.has(f.uri))
      );
      if (allCopiesRemovedGroups.length > 0) {
        warningText = `Warning: Your selection deletes ALL copies in ${allCopiesRemovedGroups.length} duplicate group(s), leaving zero copies on disk. Confirm only if you want to erase every copy.`;
      }
    }

    setConfirmDeleteItems({ items: itemsToDelete, warningText });
  };

  const executeConfirmedDelete = async () => {
    if (!confirmDeleteItems) return;
    const itemsToDelete = confirmDeleteItems.items;
    setConfirmDeleteItems(null);
    setIsLoading(true);
    setErrorMsg(null);
    try {
      if (isNativeAndroid()) {
        const res = await PhoneManager.deleteFileItems({
          items: itemsToDelete.map((i) => ({ uri: i.uri, path: i.path })),
        });
        if (res.cancelled) {
          setStatusMsg('Deletion cancelled by system confirmation dialog.');
        } else {
          setStatusMsg(`Deleted ${res.deletedCount} file(s) from device storage.`);
        }
      } else {
        const removed = deleteWebItems(itemsToDelete.map((i) => i.id));
        setStatusMsg(`Removed ${removed} file(s) from your active browser workspace.`);
      }
      setSelectedUris(new Set());
      await onRefreshSummary();
      if (activeTool === 'duplicates') await runDuplicateScan();
      if (activeTool === 'large') await runLargeScan(largeMinMb, largeCategory);
      if (activeTool === 'whatsapp') await runWhatsAppScan();
      if (activeTool === 'downloads') await runDownloadsScan();
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Failed to delete selected files.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompressPhoto = async () => {
    if (!selectedPhoto) return;
    setIsLoading(true);
    setErrorMsg(null);
    setPhotoResult(null);
    try {
      if (isNativeAndroid() && selectedPhoto.item) {
        const res = await PhoneManager.compressImage({
          uri: selectedPhoto.item.uri,
          quality: photoQuality,
          maxDimension: photoMaxDim,
          overwriteOriginal: photoOverwrite,
        });
        setPhotoResult({
          originalSize: res.originalSize || selectedPhoto.size,
          compressedSize: res.compressedSize,
          displayPath: res.displayPath,
          width: res.width,
          height: res.height,
        });
        await onRefreshSummary();
      } else {
        const file =
          selectedPhoto.webFile ||
          (selectedPhoto.item ? getWebStoredEntry(selectedPhoto.item.id)?.file : undefined);
        if (!file) throw new Error('Pick a photo file first.');
        const res = await compressWebImageFile(file, photoQuality, photoMaxDim);
        triggerWebBlobDownload(res.blob, res.fileName);
        setPhotoResult({
          originalSize: res.originalSize,
          compressedSize: res.compressedSize,
          displayPath: `Downloaded: ${res.fileName}`,
          width: res.width,
          height: res.height,
        });
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Image compression failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompressVideo = async () => {
    if (!selectedVideo) return;
    setIsLoading(true);
    setErrorMsg(null);
    setVideoResult(null);
    setVideoProgress(0);
    try {
      if (isNativeAndroid() && selectedVideo.item) {
        const res = await PhoneManager.compressVideo({
          uri: selectedVideo.item.uri,
          maxDimension: videoMaxDim,
          bitrateKbps: videoBitrateKbps,
        });
        setVideoResult({
          originalSize: res.originalSize || selectedVideo.size,
          compressedSize: res.compressedSize,
          displayPath: res.displayPath,
        });
        await onRefreshSummary();
      } else {
        const file =
          selectedVideo.webFile ||
          (selectedVideo.item ? getWebStoredEntry(selectedVideo.item.id)?.file : undefined);
        if (!file) throw new Error('Pick a video file first.');
        const res = await compressWebVideoFile(file, videoMaxDim, videoBitrateKbps, (pct) =>
          setVideoProgress(pct)
        );
        triggerWebBlobDownload(res.blob, res.fileName);
        setVideoResult({
          originalSize: res.originalSize,
          compressedSize: res.compressedSize,
          displayPath: `Downloaded: ${res.fileName}`,
        });
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Video compression failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const usedPercent =
    summary && summary.totalBytes > 0
      ? Math.min(100, Math.round((summary.usedBytes / summary.totalBytes) * 100))
      : 0;

  const filteredWhatsapp = whatsappFiles.filter(
    (f) => waFilter === 'all' || f.category === waFilter
  );

  const sortedDownloads = [...downloadsFiles]
    .filter((f) => dlFilter === 'all' || f.category === dlFilter)
    .sort((a, b) => {
      if (dlSortBy === 'size_desc') return b.size - a.size;
      if (dlSortBy === 'date_asc') return a.dateModified - b.dateModified;
      return b.dateModified - a.dateModified;
    });

  const navTools: Array<{ id: StorageSubTool; label: string; icon: React.ReactNode }> = [
    { id: 'analyzer', label: 'Analyzer', icon: <HardDrive className="w-3.5 h-3.5" /> },
    { id: 'duplicates', label: 'Duplicates', icon: <Copy className="w-3.5 h-3.5" /> },
    { id: 'large', label: 'Large Files', icon: <FileWarning className="w-3.5 h-3.5" /> },
    { id: 'whatsapp', label: 'WhatsApp', icon: <MessageCircle className="w-3.5 h-3.5" /> },
    { id: 'downloads', label: 'Downloads', icon: <Download className="w-3.5 h-3.5" /> },
    { id: 'photo_compress', label: 'Photo Size', icon: <ImageIcon className="w-3.5 h-3.5" /> },
    { id: 'video_compress', label: 'Video Size', icon: <Film className="w-3.5 h-3.5" /> },
    { id: 'recommendations', label: 'Tips', icon: <Sparkles className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="space-y-4">
      {/* Hidden inputs for Web / Desktop file selection */}
      <input
        ref={webFolderInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => void handleWebFilesSelected(e.target.files)}
      />
      <input
        ref={webPhotoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setSelectedPhoto({ webFile: f, name: f.name, size: f.size });
            setPhotoResult(null);
          }
        }}
      />
      <input
        ref={webVideoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setSelectedVideo({ webFile: f, name: f.name, size: f.size });
            setVideoResult(null);
          }
        }}
      />

      {/* Horizontal Sub-Tool Navigation */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {navTools.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTool(t.id)}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer border ${
              activeTool === t.id
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-emerald-500/40'
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Status & Error Banners */}
      {errorMsg && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{errorMsg}</span>
        </div>
      )}
      {statusMsg && (
        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{statusMsg}</span>
        </div>
      )}

      {/* A. STORAGE ANALYZER */}
      {activeTool === 'analyzer' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Device Storage Overview
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isNativeAndroid()
                    ? allFilesGranted
                      ? 'Live Android StatFs & All Files shared-storage readings'
                      : 'Live Android StatFs & MediaStore readings'
                    : 'Real browser storage estimate + local folder workspace'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!isNativeAndroid() && (
                  <button
                    type="button"
                    onClick={() => void handleWebFolderPick()}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Scan Local Folder</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void onRefreshSummary()}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            {isNativeAndroid() && !allFilesGranted && onRequestAllFilesAccess && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex flex-wrap items-center justify-between gap-2.5">
                <span className="flex-1 min-w-[200px]">
                  {summary && !summary.hasStoragePermission
                    ? 'Grant All Files Access or Media Storage permission to calculate all categories across internal & SD storage.'
                    : 'Allow All Files Access to scan shared internal folders, SD card files, documents, and Downloads in full.'}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {summary && !summary.hasStoragePermission && (
                    <button
                      type="button"
                      onClick={() => void AudioLibrary.getAllAudioFiles().then(() => onRefreshSummary())}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 text-white font-semibold cursor-pointer"
                    >
                      Media Permission
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void onRequestAllFilesAccess()}
                    className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold cursor-pointer"
                  >
                    Allow All Files Access
                  </button>
                </div>
              </div>
            )}

            {/* Total / Used / Available Bar */}
            <div className="space-y-2">
              <div className="flex items-end justify-between text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  Used: {summary ? formatBytes(summary.usedBytes) : '—'} ({usedPercent}%)
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  Available: {summary ? formatBytes(summary.availableBytes) : '—'} of{' '}
                  {summary ? formatBytes(summary.totalBytes) : '—'}
                </span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${usedPercent}%` }}
                />
              </div>
            </div>

            {/* Category Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
              {CATEGORY_META.map((cat) => {
                const stat = summary?.categories[cat.key] || { bytes: 0, count: 0 };
                return (
                  <div
                    key={cat.key}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {cat.label}
                      </span>
                      <span className={`text-[11px] font-mono font-bold ${cat.badgeColor}`}>
                        {formatBytes(stat.bytes)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full ${cat.barColor}`}
                        style={{
                          width:
                            summary && summary.usedBytes > 0
                              ? `${Math.min(100, Math.max(stat.bytes > 0 ? 4 : 0, Math.round((stat.bytes / Math.max(1, summary.usedBytes)) * 100)))}%`
                              : '0%',
                        }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {stat.count.toLocaleString()} accessible file{stat.count === 1 ? '' : 's'}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* B. DUPLICATE FILE FINDER */}
      {activeTool === 'duplicates' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                SHA-256 Duplicate File Finder
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Exact byte-level hash matching across images, videos, audio, and documents. Reclaimable:{' '}
                <strong className="text-emerald-600 dark:text-emerald-400">
                  {formatBytes(dupWastedBytes)}
                </strong>
              </p>
            </div>
            <div className="flex items-center gap-2">
              {dupGroups.length > 0 && (
                <button
                  type="button"
                  onClick={selectAllDuplicateExtras}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  Select Extra Copies Only
                </button>
              )}
              <button
                type="button"
                onClick={() => void runDuplicateScan()}
                disabled={isLoading}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                <span>Rescan</span>
              </button>
            </div>
          </div>

          {!isLoading && dupGroups.length === 0 ? (
            <div className="p-6 text-center rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-dashed border-slate-200 dark:border-slate-800 space-y-2">
              <Copy className="w-7 h-7 mx-auto text-slate-400" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                No exact duplicate files found
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isNativeAndroid()
                  ? 'All accessible media files have unique SHA-256 hashes.'
                  : 'Scan a local folder from Analyzer if you want to inspect additional desktop directories.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {dupGroups.map((grp) => (
                <div
                  key={grp.hash}
                  className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 space-y-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
                      {grp.files.length} identical copies · {formatBytes(grp.size)} each
                    </span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      Save {formatBytes(grp.wastedBytes)}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-200/70 dark:divide-slate-800">
                    {grp.files.map((file, idx) => {
                      const checked = selectedUris.has(file.uri);
                      return (
                        <button
                          key={file.uri}
                          type="button"
                          onClick={() => toggleUriSelection(file.uri)}
                          className="w-full py-2 flex items-center gap-3 text-left cursor-pointer"
                        >
                          {checked ? (
                            <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {file.name}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {file.path || 'MediaStore'} · {formatShortDate(file.dateModified)}
                            </p>
                          </div>
                          {idx === 0 && (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold shrink-0">
                              Keep 1st Copy
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedUris.size > 0 && (
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {selectedUris.size} duplicate file(s) selected
              </span>
              <button
                type="button"
                onClick={() => {
                  const list = dupGroups
                    .flatMap((g) => g.files)
                    .filter((f) => selectedUris.has(f.uri));
                  requestDeleteWithSafetyCheck(list, true);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Selected</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* C. LARGE FILE FINDER */}
      {activeTool === 'large' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Large File Finder
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sorted largest first across accessible files
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={largeCategory}
                onChange={(e) => {
                  setLargeCategory(e.target.value);
                  void runLargeScan(largeMinMb, e.target.value);
                }}
                className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
              >
                <option value="all">All Categories</option>
                <option value="videos">Videos</option>
                <option value="images">Images</option>
                <option value="audio">Audio</option>
                <option value="documents">Documents</option>
                <option value="downloads">Downloads</option>
              </select>
              <select
                value={largeMinMb}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setLargeMinMb(val);
                  void runLargeScan(val, largeCategory);
                }}
                className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
              >
                <option value={5}>&ge; 5 MB</option>
                <option value={10}>&ge; 10 MB</option>
                <option value={50}>&ge; 50 MB</option>
                <option value={100}>&ge; 100 MB</option>
              </select>
            </div>
          </div>

          {!isLoading && largeFiles.length === 0 ? (
            <div className="p-6 text-center rounded-xl bg-slate-50 dark:bg-slate-950/50 text-xs text-slate-500 dark:text-slate-400">
              No accessible files larger than {largeMinMb} MB matched this filter.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-96 overflow-y-auto">
              {largeFiles.map((file) => {
                const checked = selectedUris.has(file.uri);
                return (
                  <button
                    key={file.uri}
                    type="button"
                    onClick={() => toggleUriSelection(file.uri)}
                    className="w-full py-2.5 flex items-center gap-3 text-left cursor-pointer"
                  >
                    {checked ? (
                      <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {file.name}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {file.category} · {formatShortDate(file.dateModified)}
                      </p>
                    </div>
                    <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200 shrink-0">
                      {formatBytes(file.size)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {selectedUris.size > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {selectedUris.size} selected
              </span>
              <button
                type="button"
                onClick={() =>
                  requestDeleteWithSafetyCheck(
                    largeFiles.filter((f) => selectedUris.has(f.uri))
                  )
                }
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Selected</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* D. WHATSAPP MEDIA CLEANER */}
      {activeTool === 'whatsapp' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                WhatsApp & WhatsApp Business Media
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Images, Videos, Documents, Voice Notes & Forwarded/Sent items
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleGrantWhatsAppSaf()}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>{isNativeAndroid() ? 'Select WhatsApp Media Folder (SAF)' : 'Pick WhatsApp Media Folder'}</span>
            </button>
          </div>

          {waRequiresSafHint && (
            <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-300 text-xs flex flex-wrap items-center justify-between gap-2.5">
              <span className="flex-1 min-w-[200px]">
                {!allFilesGranted
                  ? 'Allow All Files Access to scan shared WhatsApp Media folders (WhatsApp databases remain protected), or select the WhatsApp Media folder via SAF.'
                  : 'Use Select WhatsApp Media Folder (SAF) if your Android OS keeps Android/media restricted on this device.'}
              </span>
              {!allFilesGranted && onRequestAllFilesAccess && (
                <button
                  type="button"
                  onClick={() => void onRequestAllFilesAccess()}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold cursor-pointer shrink-0"
                >
                  Allow All Files Access
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {[
              { id: 'all', label: 'All' },
              { id: 'images', label: 'Images' },
              { id: 'videos', label: 'Videos' },
              { id: 'documents', label: 'Documents' },
              { id: 'voice_notes', label: 'Voice Notes' },
              { id: 'forwarded', label: 'Sent / Forwarded' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setWaFilter(tab.id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
                  waFilter === tab.id
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {!isLoading && filteredWhatsapp.length === 0 ? (
            <div className="p-6 text-center rounded-xl bg-slate-50 dark:bg-slate-950/50 text-xs text-slate-500 dark:text-slate-400">
              No WhatsApp media found in this category yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-96 overflow-y-auto">
              {filteredWhatsapp.map((file) => {
                const checked = selectedUris.has(file.uri);
                const isImg = isImageFileItem(file);
                const isVid = isVideoFileItem(file);
                return (
                  <button
                    key={file.uri}
                    type="button"
                    onClick={() => toggleUriSelection(file.uri)}
                    className="w-full py-2.5 flex items-center gap-3 text-left cursor-pointer"
                  >
                    {checked ? (
                      <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    {(isImg || isVid) && (
                      <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 relative border border-slate-200 dark:border-slate-800">
                        <MediaThumbnail item={file} iconSizeClass="w-4 h-4" />
                        {isVid && (
                          <span className="absolute inset-0 flex items-center justify-center bg-black/25 pointer-events-none">
                            <Play className="w-3 h-3 text-white fill-white" />
                          </span>
                        )}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {file.name}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {file.category.replace('_', ' ')} · {formatShortDate(file.dateModified)}
                      </p>
                    </div>
                    <span className="text-xs font-mono font-bold tabular-nums text-slate-700 dark:text-slate-200 shrink-0">
                      {formatBytes(file.size)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {selectedUris.size > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {selectedUris.size} selected
              </span>
              <button
                type="button"
                onClick={() =>
                  requestDeleteWithSafetyCheck(
                    filteredWhatsapp.filter((f) => selectedUris.has(f.uri))
                  )
                }
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Selected</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* E. DOWNLOADS CLEANER */}
      {activeTool === 'downloads' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Downloads Cleaner
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                APKs, ZIP archives, PDFs & downloads older than 30 days
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={dlFilter}
                onChange={(e) => setDlFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
              >
                <option value="all">All Downloads</option>
                <option value="apk">APKs</option>
                <option value="archive">ZIP / Archives</option>
                <option value="pdf">PDFs</option>
                <option value="old">Older than 30d</option>
              </select>
              <select
                value={dlSortBy}
                onChange={(e) => setDlSortBy(e.target.value as 'size_desc' | 'date_desc' | 'date_asc')}
                className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
              >
                <option value="size_desc">Largest First</option>
                <option value="date_desc">Newest First</option>
                <option value="date_asc">Oldest First</option>
              </select>
            </div>
          </div>

          {!isLoading && sortedDownloads.length === 0 ? (
            <div className="p-6 text-center rounded-xl bg-slate-50 dark:bg-slate-950/50 text-xs text-slate-500 dark:text-slate-400 space-y-2.5">
              <p>No downloaded files found for this filter.</p>
              {isNativeAndroid() && !allFilesGranted && onRequestAllFilesAccess && (
                <button
                  type="button"
                  onClick={() => void onRequestAllFilesAccess()}
                  className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold cursor-pointer"
                >
                  Allow All Files Access to Scan Downloads
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-96 overflow-y-auto">
              {sortedDownloads.map((file) => {
                const checked = selectedUris.has(file.uri);
                return (
                  <button
                    key={file.uri}
                    type="button"
                    onClick={() => toggleUriSelection(file.uri)}
                    className="w-full py-2.5 flex items-center gap-3 text-left cursor-pointer"
                  >
                    {checked ? (
                      <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    {isImageFileItem(file) || isVideoFileItem(file) ? (
                      <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-slate-200 dark:border-slate-800">
                        <MediaThumbnail item={file} iconSizeClass="w-4 h-4" />
                      </div>
                    ) : isAudioFileItem(file) ? (
                      <AudioCoverThumbnail item={file} className="w-10 h-10 rounded-lg" />
                    ) : isPdfFileItem(file) ? (
                      <PdfThumbnail item={file} className="w-10 h-10 rounded-lg" />
                    ) : (
                      <DocumentBadgeTile item={file} className="w-10 h-10 rounded-lg" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {file.name}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {file.dateModified > 0 ? formatShortDateTime(file.dateModified) : 'Unknown date'}
                      </p>
                    </div>
                    <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-200 shrink-0">
                      {formatBytes(file.size)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {selectedUris.size > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {selectedUris.size} selected
              </span>
              <button
                type="button"
                onClick={() =>
                  requestDeleteWithSafetyCheck(
                    sortedDownloads.filter((f) => selectedUris.has(f.uri))
                  )
                }
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Selected</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* F. PHOTO COMPRESSOR */}
      {activeTool === 'photo_compress' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Local Photo Compressor
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Saves a compressed JPEG copy locally — originals are never overwritten without explicit opt-in
              </p>
            </div>
            <button
              type="button"
              onClick={() => webPhotoInputRef.current?.click()}
              className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              Pick Any Photo File
            </button>
          </div>

          {photoCandidates.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                Or select from device images:
              </label>
              <select
                value={selectedPhoto?.item?.uri || ''}
                onChange={(e) => {
                  const found = photoCandidates.find((p) => p.uri === e.target.value);
                  if (found) {
                    setSelectedPhoto({ item: found, name: found.name, size: found.size });
                    setPhotoResult(null);
                  }
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="">-- Choose an image --</option>
                {photoCandidates.map((img) => (
                  <option key={img.uri} value={img.uri}>
                    {img.name} ({formatBytes(img.size)})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex justify-between text-xs font-semibold">
                <span>JPEG Quality</span>
                <span className="text-emerald-600 dark:text-emerald-400">{photoQuality}%</span>
              </div>
              <input
                type="range"
                min={35}
                max={95}
                step={5}
                value={photoQuality}
                onChange={(e) => setPhotoQuality(Number(e.target.value))}
                className="w-full accent-emerald-600"
              />
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <label className="text-xs font-semibold block">Output Max Dimension</label>
              <select
                value={photoMaxDim}
                onChange={(e) => setPhotoMaxDim(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
              >
                <option value={1080}>1080 px (Lightest)</option>
                <option value={1600}>1600 px (Balanced)</option>
                <option value={2160}>2160 px (High Detail)</option>
                <option value={0}>Keep Original Dimensions</option>
              </select>
            </div>
          </div>

          {isNativeAndroid() && (
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={photoOverwrite}
                onChange={(e) => setPhotoOverwrite(e.target.checked)}
                className="rounded accent-emerald-600"
              />
              <span>Overwrite original image file (if off, saves a new copy to Pictures/Mo Vibe Compressed)</span>
            </label>
          )}

          {selectedPhoto && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-100/70 dark:bg-slate-800/60">
              <div className="text-xs">
                <p className="font-bold text-slate-900 dark:text-white">{selectedPhoto.name}</p>
                <p className="text-slate-500 dark:text-slate-400">
                  Original size: {formatBytes(selectedPhoto.size)}
                </p>
              </div>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => void handleCompressPhoto()}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sliders className="w-3.5 h-3.5" />}
                <span>Compress Photo</span>
              </button>
            </div>
          )}

          {photoResult && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs space-y-1">
              <p className="font-bold text-emerald-700 dark:text-emerald-300">
                Compressed: {formatBytes(photoResult.originalSize)} &rarr;{' '}
                {formatBytes(photoResult.compressedSize)} ({photoResult.width}x{photoResult.height})
              </p>
              <p className="text-slate-600 dark:text-slate-300">
                Saved {formatBytes(Math.max(0, photoResult.originalSize - photoResult.compressedSize))} ·{' '}
                {photoResult.displayPath}
              </p>
            </div>
          )}
        </div>
      )}

      {/* G. VIDEO COMPRESSOR */}
      {activeTool === 'video_compress' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Local Video Compressor
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isNativeAndroid()
                  ? 'Hardware MediaCodec H.264/AAC transcoder saved to Movies/Mo Vibe Compressed'
                  : 'Browser local re-encoder saving compressed WebM copy'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => webVideoInputRef.current?.click()}
              className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              Pick Video File
            </button>
          </div>

          {videoCandidates.length > 0 && (
            <select
              value={selectedVideo?.item?.uri || ''}
              onChange={(e) => {
                const found = videoCandidates.find((v) => v.uri === e.target.value);
                if (found) {
                  setSelectedVideo({ item: found, name: found.name, size: found.size });
                  setVideoResult(null);
                }
              }}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100"
            >
              <option value="">-- Choose a video --</option>
              {videoCandidates.map((vid) => (
                <option key={vid.uri} value={vid.uri}>
                  {vid.name} ({formatBytes(vid.size)})
                </option>
              ))}
            </select>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <label className="text-xs font-semibold block">Target Resolution</label>
              <select
                value={videoMaxDim}
                onChange={(e) => setVideoMaxDim(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
              >
                <option value={640}>480p SD (Compact)</option>
                <option value={1280}>720p HD (Recommended)</option>
                <option value={1920}>1080p Full HD</option>
              </select>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <label className="text-xs font-semibold block">Target Quality / Bitrate</label>
              <select
                value={videoBitrateKbps}
                onChange={(e) => setVideoBitrateKbps(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
              >
                <option value={900}>Small File (900 kbps)</option>
                <option value={1800}>Balanced (1.8 Mbps)</option>
                <option value={3200}>High Quality (3.2 Mbps)</option>
              </select>
            </div>
          </div>

          {selectedVideo && (
            <div className="p-3 rounded-xl bg-slate-100/70 dark:bg-slate-800/60 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <p className="font-bold text-slate-900 dark:text-white">{selectedVideo.name}</p>
                  <p className="text-slate-500 dark:text-slate-400">
                    Original: {formatBytes(selectedVideo.size)} · Estimated target ratio:{' '}
                    ~{videoMaxDim <= 640 ? '30–45%' : videoMaxDim <= 1280 ? '45–65%' : '65–85%'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => void handleCompressVideo()}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Film className="w-3.5 h-3.5" />}
                  <span>Compress Video</span>
                </button>
              </div>
              {isLoading && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono">
                    <span>Compressing offline...</span>
                    <span>{videoProgress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${videoProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {videoResult && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs space-y-1">
              <p className="font-bold text-emerald-700 dark:text-emerald-300">
                Video Compressed: {formatBytes(videoResult.originalSize)} &rarr;{' '}
                {formatBytes(videoResult.compressedSize)}
              </p>
              <p className="text-slate-600 dark:text-slate-300">
                Actual space saved:{' '}
                {formatBytes(Math.max(0, videoResult.originalSize - videoResult.compressedSize))} ·{' '}
                {videoResult.displayPath}
              </p>
            </div>
          )}
        </div>
      )}

      {/* H. STORAGE RECOMMENDATIONS */}
      {activeTool === 'recommendations' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Storage Recommendations
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Inspect real cleanup opportunities — nothing is ever deleted automatically
              </p>
            </div>
            <button
              type="button"
              onClick={() => void runRecommendationsScan()}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer"
            >
              {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span>Refresh</span>
            </button>
          </div>

          {!isLoading && recommendations.length === 0 ? (
            <div className="p-6 text-center rounded-xl bg-slate-50 dark:bg-slate-950/50 text-xs text-slate-500 dark:text-slate-400">
              No redundant duplicates, oversized archives, or stale download suggestions detected in your accessible storage right now.
            </div>
          ) : (
            <div className="space-y-2.5">
              {recommendations.map((rec) => (
                <div
                  key={rec.id}
                  className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xs font-bold text-slate-900 dark:text-white">
                      {rec.title}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {rec.description}
                    </p>
                    <span className="inline-block text-[11px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      Estimated savings: {formatBytes(rec.estimatedSavingsBytes)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTool(rec.targetTool)}
                    className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <span>Review</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Explicit Confirmation Modal for Permanent Deletion */}
      {confirmDeleteItems && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  Confirm File Deletion
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {confirmDeleteItems.warningText}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteItems(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void executeConfirmedDelete()}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
