import React, { useState, useEffect, useRef } from 'react';
import {
  Folder,
  FolderPlus,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Archive,
  Search,
  CheckSquare,
  Square,
  Edit3,
  Copy,
  Move,
  Share2,
  Trash2,
  ExternalLink,
  FolderOpen,
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  HardDrive,
  LayoutGrid,
  List as ListIcon,
  Play,
  X,
  ChevronLeft,
  ChevronRight,
  Check,
  Download,
  RefreshCw,
} from 'lucide-react';
import {
  AudioLibrary,
  isNativeAndroid,
  resolvePlayableAudioUrl,
} from '../../plugins/audioLibrary';
import {
  PhoneFileItem,
  PhoneManager,
  StorageRootItem,
  formatBytes,
  formatShortDate,
  formatShortDateTime,
} from '../../plugins/phoneManager';
import {
  CachedPhoneIndexState,
  getCachedCategoryItems,
  getCachedPhoneIndexState,
  hasCachedPhoneIndex,
  subscribePhoneIndexCache,
  syncCachedPhoneIndex,
} from '../../utils/fileIndexCache';
import {
  createWebZipArchive,
  deleteWebItems,
  extractWebZipArchive,
  getAllWebFileItems,
  getWebStoredEntry,
  pickWebFolderForWorkspace,
  triggerWebBlobDownload,
} from '../../utils/localStorageAnalyzer';
import {
  AudioCoverThumbnail,
  DocumentBadgeTile,
  MediaThumbnail,
  PdfThumbnail,
  formatVideoDurationShort,
  isAudioFileItem,
  isImageFileItem,
  isPdfFileItem,
  isVideoFileItem,
} from './MediaThumbnail';

interface FileManagerViewProps {
  onStorageMutated: () => Promise<void>;
  allFilesGranted?: boolean;
  onRequestAllFilesAccess?: () => Promise<void>;
  refreshKey?: number;
}

type FileBrowseMode =
  | 'folder'
  | 'images'
  | 'videos'
  | 'audio'
  | 'documents'
  | 'downloads';

export const FileManagerView: React.FC<FileManagerViewProps> = ({
  onStorageMutated,
  allFilesGranted = false,
  onRequestAllFilesAccess,
  refreshKey = 0,
}) => {
  const [browseMode, setBrowseMode] = useState<FileBrowseMode>('folder');
  const [roots, setRoots] = useState<StorageRootItem[]>([]);
  const [activeRoot, setActiveRoot] = useState<StorageRootItem | null>(null);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [parentPath, setParentPath] = useState<string>('');
  const [docStack, setDocStack] = useState<string[]>([]);
  const [emptyAndroidNote, setEmptyAndroidNote] = useState(false);

  const [items, setItems] = useState<PhoneFileItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [globalSearchActive, setGlobalSearchActive] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'date' | 'type'>('date');
  const [viewLayoutOverride, setViewLayoutOverride] = useState<'auto' | 'grid' | 'list'>('auto');
  const [selectedUris, setSelectedUris] = useState<Set<string>>(new Set());

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [indexState, setIndexState] = useState<CachedPhoneIndexState>(() =>
    getCachedPhoneIndexState()
  );

  // Gallery Lightbox Preview
  const [previewItem, setPreviewItem] = useState<PhoneFileItem | null>(null);
  const [previewSrcUrl, setPreviewSrcUrl] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);

  // Modals (Zero window.alert / window.confirm / window.prompt)
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameTarget, setRenameTarget] = useState<PhoneFileItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [transferModal, setTransferModal] = useState<{
    mode: 'copy' | 'move';
    items: PhoneFileItem[];
    targetPath: string;
    targetTreeUri: string;
  } | null>(null);
  const [zipModalOpen, setZipModalOpen] = useState(false);
  const [zipArchiveName, setZipArchiveName] = useState('MoVibe_Archive');
  const [confirmDeleteList, setConfirmDeleteList] = useState<PhoneFileItem[] | null>(null);

  const webZipExtractInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return subscribePhoneIndexCache((next) => {
      setIndexState(next);
    });
  }, []);

  useEffect(() => {
    void loadRoots();
    if (!hasCachedPhoneIndex()) {
      void syncCachedPhoneIndex(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSelectedUris(new Set());
    setViewLayoutOverride('auto');
    setGlobalSearchActive(false);
    if (browseMode === 'folder') {
      if (isNativeAndroid() && activeRoot) {
        setItems([]);
        void loadAndroidFolder(activeRoot, currentPath, docStack[docStack.length - 1]);
      } else if (!isNativeAndroid()) {
        setItems(getAllWebFileItems());
      }
    } else {
      void loadCategoryFiles(browseMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseMode, activeRoot?.id]);

  // Keep active category view synced instantaneously whenever the shared cache updates
  useEffect(() => {
    if (browseMode === 'folder' || globalSearchActive) return;
    if (indexState.ready) {
      setItems(getCachedCategoryItems(browseMode));
      setIsLoading(false);
    }
  }, [browseMode, globalSearchActive, indexState.ready, indexState.indexedAt]);

  // Auto-refresh File Manager when All Files Access permission is granted on resume
  useEffect(() => {
    if (!refreshKey || refreshKey <= 0 || !isNativeAndroid()) return;
    setGlobalSearchActive(false);
    void loadRoots();
    if (browseMode === 'folder' && activeRoot) {
      void loadAndroidFolder(activeRoot, currentPath, docStack[docStack.length - 1]);
    } else if (browseMode !== 'folder') {
      void loadCategoryFiles(browseMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    if (!previewItem) {
      setPreviewSrcUrl('');
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    let createdBlobUrl = '';
    const mediaKind = isVideoFileItem(previewItem) ? 'video' : 'image';
    setPreviewLoading(true);
    setPreviewSrcUrl('');

    const resolveFullMedia = async () => {
      try {
        if (!isNativeAndroid()) {
          const entry = getWebStoredEntry(previewItem.id);
          if (entry && !cancelled) {
            createdBlobUrl = URL.createObjectURL(entry.file);
            setPreviewSrcUrl(createdBlobUrl);
          }
          return;
        }
        const prepared = await AudioLibrary.prepareMediaFile({
          uri: previewItem.uri,
          displayName: previewItem.name,
          mediaKind,
          keepAlive: true,
        });
        if (!cancelled) {
          setPreviewSrcUrl(resolvePlayableAudioUrl(prepared));
        }
      } catch {
        if (!cancelled) {
          setPreviewSrcUrl('');
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    };

    void resolveFullMedia();
    return () => {
      cancelled = true;
      if (createdBlobUrl) {
        URL.revokeObjectURL(createdBlobUrl);
      }
    };
  }, [previewItem]);

  const loadRoots = async () => {
    if (!isNativeAndroid()) {
      setItems(getAllWebFileItems());
      return;
    }
    try {
      const res = await PhoneManager.getStorageRoots();
      const loadedRoots = res.roots || [];
      setRoots(loadedRoots);
      if (loadedRoots.length > 0 && !activeRoot) {
        const first = loadedRoots[0];
        setActiveRoot(first);
        await loadAndroidFolder(first, first.path || '', undefined);
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Could not inspect device storage roots.');
    }
  };

  const loadAndroidFolder = async (
    root: StorageRootItem,
    pathOverride?: string,
    docUri?: string
  ) => {
    setIsLoading(true);
    setErrorMsg(null);
    setGlobalSearchActive(false);
    try {
      const res = await PhoneManager.listDirectory(
        root.type === 'saf'
          ? { treeUri: root.treeUri, documentUri: docUri }
          : { path: pathOverride || root.path }
      );
      setItems(res.items || []);
      setCurrentPath(res.currentPath || '');
      setParentPath(res.parentPath || '');
      setEmptyAndroidNote(Boolean(res.emptyNote));
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Could not read folder contents.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGlobalDeviceSearch = async () => {
    const q = searchQuery.trim();
    if (!q || !isNativeAndroid()) return;
    setIsLoading(true);
    setErrorMsg(null);
    setEmptyAndroidNote(false);
    try {
      const res = await PhoneManager.searchFiles({
        query: q,
        category: browseMode === 'folder' ? 'all' : browseMode,
        maxResults: 250,
      });
      setGlobalSearchActive(true);
      setItems(res.files || []);
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Search across storage failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearGlobalSearch = async () => {
    setSearchQuery('');
    setGlobalSearchActive(false);
    if (browseMode === 'folder' && activeRoot && isNativeAndroid()) {
      await loadAndroidFolder(activeRoot, currentPath, docStack[docStack.length - 1]);
    } else if (browseMode !== 'folder') {
      await loadCategoryFiles(browseMode);
    }
  };

  const loadCategoryFiles = async (
    cat: Exclude<FileBrowseMode, 'folder'>,
    forceRescan = false
  ) => {
    setErrorMsg(null);
    setEmptyAndroidNote(false);

    if (!isNativeAndroid()) {
      setItems(getAllWebFileItems().filter((f) => f.category === cat));
      setIsLoading(false);
      return;
    }

    if (!forceRescan && hasCachedPhoneIndex()) {
      setItems(getCachedCategoryItems(cat));
      setIsLoading(false);
      return;
    }

    // Clear previous category items immediately so stale counts never show on the new tab
    setItems([]);
    setIsLoading(true);
    try {
      const next = await syncCachedPhoneIndex(forceRescan);
      if (next.ready) {
        setItems(next.categoriesFiles[cat] || []);
      } else {
        const res = await PhoneManager.getCategoryFiles({
          category: cat,
          limit: 2500,
        });
        setItems(res.files || []);
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Could not load category files.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGrantSaf = async () => {
    if (!isNativeAndroid()) {
      try {
        const next = await pickWebFolderForWorkspace();
        setItems(next);
        await onStorageMutated();
        setStatusMsg(`Loaded ${next.length} files from your selected folder.`);
      } catch (err) {
        if (!(err as Error)?.message?.toLowerCase().includes('abort')) {
          setErrorMsg((err as Error)?.message || 'Folder access cancelled.');
        }
      }
      return;
    }

    try {
      const targetPreset = browseMode === 'documents' ? 'documents' : 'default';
      const res = await PhoneManager.requestSafFolderAccess({ preset: targetPreset });
      if (res.granted && res.treeUri) {
        const updatedRoots = await PhoneManager.getStorageRoots();
        setRoots(updatedRoots.roots || []);
        const safRoot =
          (updatedRoots.roots || []).find((r) => r.treeUri === res.treeUri) ||
          (updatedRoots.roots || [])[0];
        if (browseMode === 'documents') {
          setStatusMsg(`Folder access granted (${res.label || 'Documents'}). Updating file index...`);
          await onStorageMutated();
        } else if (safRoot) {
          setBrowseMode('folder');
          setActiveRoot(safRoot);
          setDocStack([]);
          await loadAndroidFolder(safRoot, safRoot.path, undefined);
          void onStorageMutated();
        }
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Could not open Android SAF folder picker.');
    }
  };

  const handlePickDocumentFiles = async (preset: 'documents' | 'downloads' = 'documents') => {
    if (!isNativeAndroid()) {
      await handleGrantSaf();
      return;
    }
    try {
      const res = await PhoneManager.requestSafDocumentFiles({ preset });
      if (!res.cancelled && res.addedCount > 0) {
        setStatusMsg(`Added ${res.addedCount} file(s) to File Manager.`);
        await onStorageMutated();
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Could not open Android file picker.');
    }
  };

  const openExternally = async (item: PhoneFileItem) => {
    try {
      if (isNativeAndroid()) {
        await PhoneManager.openFileItem({ uri: item.uri, mimeType: item.mimeType });
      } else {
        const entry = getWebStoredEntry(item.id);
        if (entry) {
          triggerWebBlobDownload(entry.file, item.name);
          setStatusMsg(`Opened local file download for ${item.name}.`);
        }
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'No application available to open this file.');
    }
  };

  const handleOpenFolderOrFile = async (item: PhoneFileItem) => {
    if (item.isDirectory && activeRoot) {
      if (activeRoot.type === 'saf') {
        setDocStack((prev) => [...prev, item.uri]);
        await loadAndroidFolder(activeRoot, undefined, item.uri);
      } else {
        await loadAndroidFolder(activeRoot, item.path, undefined);
      }
      return;
    }

    if (item.name.toLowerCase().endsWith('.zip')) {
      await handleExtractZip(item);
      return;
    }

    if (isImageFileItem(item) || isVideoFileItem(item)) {
      setPreviewItem(item);
      return;
    }

    await openExternally(item);
  };

  const handleStepUp = async () => {
    if (!activeRoot) return;
    if (activeRoot.type === 'saf') {
      const nextStack = docStack.slice(0, -1);
      setDocStack(nextStack);
      await loadAndroidFolder(activeRoot, undefined, nextStack[nextStack.length - 1]);
    } else if (parentPath && parentPath !== currentPath) {
      await loadAndroidFolder(activeRoot, parentPath, undefined);
    }
  };

  const handleCreateFolder = async () => {
    const clean = newFolderName.trim();
    if (!clean) return;
    setShowNewFolderModal(false);
    setNewFolderName('');
    try {
      if (!isNativeAndroid()) {
        setErrorMsg('Browser sandboxing cannot create arbitrary OS folders; use Android File Manager for native directory creation.');
        return;
      }
      await PhoneManager.createFolder({
        parentPath: activeRoot?.type === 'file' ? currentPath : undefined,
        treeUri: activeRoot?.type === 'saf' ? activeRoot.treeUri : undefined,
        documentUri: docStack[docStack.length - 1],
        name: clean,
      });
      setStatusMsg(`Created folder "${clean}".`);
      if (activeRoot) {
        await loadAndroidFolder(activeRoot, currentPath, docStack[docStack.length - 1]);
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Folder creation failed.');
    }
  };

  const handleRenameSubmit = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    const target = renameTarget;
    const nextName = renameValue.trim();
    setRenameTarget(null);
    try {
      if (!isNativeAndroid()) {
        setItems((prev) =>
          prev.map((i) => (i.uri === target.uri ? { ...i, name: nextName } : i))
        );
        setStatusMsg(`Renamed "${target.name}" to "${nextName}".`);
        return;
      }
      await PhoneManager.renameFileItem({
        uri: target.uri,
        path: target.path,
        newName: nextName,
      });
      setStatusMsg(`Renamed "${target.name}" to "${nextName}".`);
      await onStorageMutated();
      if (browseMode === 'folder' && activeRoot) {
        await loadAndroidFolder(activeRoot, currentPath, docStack[docStack.length - 1]);
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Rename failed.');
    }
  };

  const handleTransferSubmit = async () => {
    if (!transferModal) return;
    const req = transferModal;
    setTransferModal(null);
    setIsLoading(true);
    try {
      if (!isNativeAndroid()) {
        setStatusMsg(
          `In browser mode, ${req.items.length} file(s) prepared. Use Android File Manager for full filesystem ${req.mode}.`
        );
        return;
      }
      const res = await PhoneManager.copyOrMoveFileItems({
        items: req.items.map((i) => ({
          uri: i.uri,
          path: i.path,
          name: i.name,
          mimeType: i.mimeType,
        })),
        targetPath: req.targetTreeUri ? undefined : req.targetPath,
        targetTreeUri: req.targetTreeUri || undefined,
        mode: req.mode,
      });
      setSelectedUris(new Set());
      setStatusMsg(
        `${req.mode === 'move' ? 'Moved' : 'Copied'} ${res.processedCount} item(s).`
      );
      await onStorageMutated();
      if (browseMode === 'folder' && activeRoot) {
        await loadAndroidFolder(activeRoot, currentPath, docStack[docStack.length - 1]);
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || `File ${req.mode} failed.`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleShareSingle = async (item: PhoneFileItem) => {
    try {
      if (isNativeAndroid()) {
        await PhoneManager.shareFileItem({
          uri: item.uri,
          mimeType: item.mimeType,
          title: `Share ${item.name}`,
        });
      } else {
        const entry = getWebStoredEntry(item.id);
        if (entry && navigator.share) {
          await navigator.share({ title: item.name, files: [entry.file] });
        } else if (entry) {
          triggerWebBlobDownload(entry.file, item.name);
        }
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Share cancelled or unsupported.');
    }
  };

  const handleCompressToZip = async () => {
    const selected = visibleItems.filter((i) => selectedUris.has(i.uri) && !i.isDirectory);
    if (selected.length === 0) return;
    setZipModalOpen(false);
    setIsLoading(true);
    setErrorMsg(null);
    try {
      if (isNativeAndroid()) {
        const res = await PhoneManager.compressToZip({
          items: selected.map((s) => ({ uri: s.uri, name: s.name })),
          archiveName: zipArchiveName || 'MoVibe_Archive',
        });
        setStatusMsg(`Created ZIP (${formatBytes(res.size)}) at ${res.displayPath}`);
      } else {
        const res = await createWebZipArchive(selected, zipArchiveName || 'MoVibe_Archive');
        triggerWebBlobDownload(res.blob, res.fileName);
        setStatusMsg(`Created and downloaded ${res.fileName} (${formatBytes(res.size)}).`);
      }
      setSelectedUris(new Set());
      await onStorageMutated();
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'ZIP compression failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExtractZip = async (item: PhoneFileItem) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      if (isNativeAndroid()) {
        const folderName = item.name.replace(/\.zip$/i, '') || 'Extracted';
        const res = await PhoneManager.extractZipArchive({
          uri: item.uri,
          folderName,
        });
        setStatusMsg(`Extracted ${res.extractedCount} files to ${res.outputPath}`);
      } else {
        const entry = getWebStoredEntry(item.id);
        if (!entry) throw new Error('Pick a local ZIP file first.');
        const res = await extractWebZipArchive(entry.file);
        res.extractedFiles.forEach((ef) => triggerWebBlobDownload(ef.blob, ef.name));
        setStatusMsg(`Extracted ${res.extractedFiles.length} file(s) cleanly.`);
      }
      await onStorageMutated();
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'ZIP extraction failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteList) return;
    const list = confirmDeleteList;
    setConfirmDeleteList(null);
    setIsLoading(true);
    try {
      if (isNativeAndroid()) {
        const res = await PhoneManager.deleteFileItems({
          items: list.map((i) => ({ uri: i.uri, path: i.path })),
        });
        setStatusMsg(res.cancelled ? 'Deletion cancelled.' : `Deleted ${res.deletedCount} item(s).`);
      } else {
        const removed = deleteWebItems(list.map((i) => i.id));
        setStatusMsg(`Removed ${removed} file(s) from browser workspace.`);
      }
      setSelectedUris(new Set());
      await onStorageMutated();
      if (browseMode === 'folder' && activeRoot) {
        await loadAndroidFolder(activeRoot, currentPath, docStack[docStack.length - 1]);
      } else if (!isNativeAndroid() && browseMode === 'folder') {
        setItems(getAllWebFileItems());
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Delete failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelect = (uri: string) => {
    setSelectedUris((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
  };

  const visibleItems = items
    .filter((i) => i.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    .sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      if (sortBy === 'size') return b.size - a.size;
      if (sortBy === 'date') return b.dateModified - a.dateModified;
      if (sortBy === 'type') return a.category.localeCompare(b.category);
      return a.name.localeCompare(b.name);
    });

  const selectedItems = visibleItems.filter((i) => selectedUris.has(i.uri));
  const useGalleryGrid =
    viewLayoutOverride === 'grid' ||
    (viewLayoutOverride === 'auto' && (browseMode === 'images' || browseMode === 'videos'));

  const previewableItems = visibleItems.filter(
    (i) => !i.isDirectory && (isImageFileItem(i) || isVideoFileItem(i))
  );
  const previewIndex = previewItem
    ? previewableItems.findIndex((i) => i.uri === previewItem.uri)
    : -1;

  const totalVisibleBytes = visibleItems.reduce(
    (sum, item) => sum + (item.isDirectory ? 0 : item.size || 0),
    0
  );

  const categoryTitleLabel =
    browseMode === 'images'
      ? 'Images'
      : browseMode === 'videos'
      ? 'Videos'
      : browseMode === 'audio'
      ? 'Audio files'
      : browseMode === 'documents'
      ? 'Documents'
      : browseMode === 'downloads'
      ? 'Downloads'
      : 'Folders';

  const getFileThumbnailOrIcon = (item: PhoneFileItem) => {
    if (item.isDirectory) {
      return (
        <div className="w-11 h-11 rounded-xl bg-amber-500/12 flex items-center justify-center shrink-0">
          <Folder className="w-5 h-5 text-amber-500" />
        </div>
      );
    }
    if (isImageFileItem(item)) {
      return (
        <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 border border-slate-200 dark:border-slate-800">
          <MediaThumbnail item={item} iconSizeClass="w-4 h-4" />
        </div>
      );
    }
    if (isVideoFileItem(item)) {
      return (
        <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 relative border border-slate-200 dark:border-slate-800">
          <MediaThumbnail item={item} iconSizeClass="w-4 h-4" />
          <span className="absolute bottom-1 left-1 w-4 h-4 rounded-full bg-black/60 flex items-center justify-center pointer-events-none">
            <Play className="w-2.5 h-2.5 text-white fill-white ml-0.5" />
          </span>
        </div>
      );
    }
    if (isAudioFileItem(item)) {
      return <AudioCoverThumbnail item={item} />;
    }
    if (isPdfFileItem(item)) {
      return <PdfThumbnail item={item} />;
    }
    return <DocumentBadgeTile item={item} />;
  };

  return (
    <div className="space-y-4">
      <input
        ref={webZipExtractInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setIsLoading(true);
          try {
            const res = await extractWebZipArchive(f);
            res.extractedFiles.forEach((ef) => triggerWebBlobDownload(ef.blob, ef.name));
            setStatusMsg(`Extracted ${res.extractedFiles.length} files from ${f.name}.`);
          } catch (err) {
            setErrorMsg((err as Error)?.message || 'ZIP extraction failed.');
          } finally {
            setIsLoading(false);
          }
        }}
      />

      {/* Category & Root Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {(
              [
                { id: 'folder', label: 'Folders' },
                { id: 'images', label: 'Images' },
                { id: 'videos', label: 'Videos' },
                { id: 'audio', label: 'Audio' },
                { id: 'documents', label: 'Documents' },
                { id: 'downloads', label: 'Downloads' },
              ] as Array<{ id: FileBrowseMode; label: string }>
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setBrowseMode(m.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer border whitespace-nowrap ${
                  browseMode === m.id
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isNativeAndroid() && allFilesGranted ? (
              <>
                <button
                  type="button"
                  disabled={indexState.isIndexing}
                  onClick={() => void onStorageMutated()}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${indexState.isIndexing ? 'animate-spin text-emerald-500' : ''}`} />
                  <span>{indexState.isIndexing ? 'Indexing...' : 'Rescan Files'}</span>
                </button>
                {browseMode === 'folder' && (
                  <button
                    type="button"
                    onClick={() => void handleGrantSaf()}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Open Folder (SAF)</span>
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void handleGrantSaf()}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>
                    {isNativeAndroid()
                      ? browseMode === 'documents'
                        ? 'Grant Documents Folder (SAF)'
                        : 'Open Folder (SAF)'
                      : 'Pick Local Folder'}
                  </span>
                </button>
                {isNativeAndroid() && (browseMode === 'documents' || browseMode === 'downloads') && (
                  <button
                    type="button"
                    onClick={() =>
                      void handlePickDocumentFiles(
                        browseMode === 'downloads' ? 'downloads' : 'documents'
                      )
                    }
                    className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>
                      {browseMode === 'downloads' ? 'Add Files from Downloads' : 'Add Document Files'}
                    </span>
                  </button>
                )}
              </>
            )}
            {!isNativeAndroid() && (
              <button
                type="button"
                onClick={() => webZipExtractInputRef.current?.click()}
                className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Archive className="w-3.5 h-3.5" />
                <span>Extract ZIP</span>
              </button>
            )}
          </div>
        </div>

        {/* Storage Roots (Internal / SD Card / SAF Trees) */}
        {browseMode === 'folder' && roots.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {roots.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  setActiveRoot(r);
                  setDocStack([]);
                  void loadAndroidFolder(r, r.path, undefined);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer border ${
                  activeRoot?.id === r.id
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                <HardDrive className="w-3 h-3" />
                <span>{r.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Search, Sort & New Folder */}
        <div className="flex flex-wrap items-center gap-2">
          {browseMode === 'folder' && isNativeAndroid() && (parentPath || docStack.length > 0) && (
            <button
              type="button"
              onClick={() => void handleStepUp()}
              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
              title="Parent Folder"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="relative flex-1 min-w-[180px] flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  const next = e.target.value;
                  setSearchQuery(next);
                  if (!next.trim() && globalSearchActive) {
                    void handleClearGlobalSearch();
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isNativeAndroid() && searchQuery.trim().length >= 2) {
                    void handleGlobalDeviceSearch();
                  }
                }}
                placeholder="Search files by name..."
                className="w-full pl-8 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
              />
            </div>
            {isNativeAndroid() && browseMode === 'folder' && searchQuery.trim().length >= 2 && (
              <button
                type="button"
                onClick={() => void handleGlobalDeviceSearch()}
                className="px-2.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold whitespace-nowrap cursor-pointer"
              >
                Search All Storage
              </button>
            )}
            {globalSearchActive && (
              <button
                type="button"
                onClick={() => void handleClearGlobalSearch()}
                className="px-2.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-semibold whitespace-nowrap cursor-pointer"
              >
                Back to Folder
              </button>
            )}
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'name' | 'size' | 'date' | 'type')}
            className="px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-semibold"
          >
            <option value="date">Sort: Date</option>
            <option value="name">Sort: Name</option>
            <option value="size">Sort: Size</option>
            <option value="type">Sort: Type</option>
          </select>
          <div
            className="flex items-center p-0.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
            role="group"
            aria-label="Layout view"
          >
            <button
              type="button"
              onClick={() => setViewLayoutOverride('grid')}
              className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                useGalleryGrid
                  ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
              title="Gallery Grid View"
              aria-label="Gallery Grid View"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewLayoutOverride('list')}
              className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                !useGalleryGrid
                  ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
              title="Detailed List View"
              aria-label="Detailed List View"
            >
              <ListIcon className="w-3.5 h-3.5" />
            </button>
          </div>
          {browseMode === 'folder' && isNativeAndroid() && (
            <button
              type="button"
              onClick={() => setShowNewFolderModal(true)}
              className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>New Folder</span>
            </button>
          )}
        </div>
      </div>

      {/* Banners */}
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

      {/* Scoped Storage Notice (Non-blocking fallback when All Files Access is not granted) */}
      {emptyAndroidNote && (
        <div className="p-3.5 rounded-2xl bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-300 text-xs flex flex-wrap items-center justify-between gap-2.5">
          <span className="flex-1 min-w-[200px]">
            Android scoped storage limits direct folder listing without All Files Access. Allow All Files Access for full shared storage browsing, or use <strong>Open Folder (SAF)</strong> as fallback.
          </span>
          {isNativeAndroid() && !allFilesGranted && onRequestAllFilesAccess && (
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

      {/* Batch Actions Bar when items are checked */}
      {selectedItems.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-emerald-500/40 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2 shadow-sm">
          <span className="text-xs font-bold text-slate-900 dark:text-white">
            {selectedItems.length} item(s) selected
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedItems.length === 1 && (
              <button
                type="button"
                onClick={() => {
                  setRenameTarget(selectedItems[0]);
                  setRenameValue(selectedItems[0].name);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Edit3 className="w-3 h-3" />
                <span>Rename</span>
              </button>
            )}
            {selectedItems.length === 1 && !selectedItems[0].isDirectory && (
              <button
                type="button"
                onClick={() => void handleShareSingle(selectedItems[0])}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Share2 className="w-3 h-3" />
                <span>Share</span>
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                setTransferModal({
                  mode: 'copy',
                  items: selectedItems,
                  targetPath: currentPath && currentPath.startsWith('/') ? currentPath : '',
                  targetTreeUri: activeRoot?.type === 'saf' ? activeRoot.treeUri || '' : '',
                })
              }
              className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </button>
            <button
              type="button"
              onClick={() =>
                setTransferModal({
                  mode: 'move',
                  items: selectedItems,
                  targetPath: currentPath && currentPath.startsWith('/') ? currentPath : '',
                  targetTreeUri: activeRoot?.type === 'saf' ? activeRoot.treeUri || '' : '',
                })
              }
              className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Move className="w-3 h-3" />
              <span>Move</span>
            </button>
            <button
              type="button"
              onClick={() => setZipModalOpen(true)}
              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Archive className="w-3 h-3" />
              <span>Compress ZIP</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteList(selectedItems)}
              className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}

      {/* Files List / Gallery */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-slate-100 dark:border-slate-800">
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
              {categoryTitleLabel}
            </p>
            {currentPath && browseMode === 'folder' && (
              <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">
                {currentPath}
              </p>
            )}
          </div>
          <span className="text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
            {isLoading
              ? 'Scanning...'
              : `${visibleItems.length} item${visibleItems.length === 1 ? '' : 's'} · ${formatBytes(totalVisibleBytes)}`}
          </span>
        </div>

        {/* Phone Category Quick Folders when browsing Folders */}
        {browseMode === 'folder' && docStack.length === 0 && (
          <div className="grid grid-cols-5 gap-1.5 pb-3 mb-3 border-b border-slate-100 dark:border-slate-800">
            {(
              [
                { id: 'images', label: 'Images', icon: ImageIcon, tone: 'text-emerald-600 bg-emerald-500/12' },
                { id: 'videos', label: 'Videos', icon: Film, tone: 'text-cyan-600 bg-cyan-500/12' },
                { id: 'audio', label: 'Audio', icon: Music, tone: 'text-sky-600 bg-sky-500/12' },
                { id: 'downloads', label: 'Downloads', icon: Download, tone: 'text-indigo-600 bg-indigo-500/12' },
                { id: 'documents', label: 'Documents', icon: FileText, tone: 'text-amber-600 bg-amber-500/12' },
              ] as Array<{
                id: Exclude<FileBrowseMode, 'folder'>;
                label: string;
                icon: React.ComponentType<{ className?: string }>;
                tone: string;
              }>
            ).map((cat) => {
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setBrowseMode(cat.id)}
                  className="p-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 hover:border-emerald-500/40 flex flex-col items-center gap-1 cursor-pointer"
                >
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${cat.tone}`}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="text-[10px] font-semibold text-slate-700 dark:text-slate-200 truncate max-w-full">
                    {cat.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {isLoading ? (
          <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
            <span>
              {indexState.isIndexing ? 'Indexing accessible files once...' : 'Loading files...'}
            </span>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3">
            {(browseMode === 'documents' || browseMode === 'downloads') && isNativeAndroid() ? (
              <>
                <p className="max-w-md mx-auto leading-relaxed">
                  {allFilesGranted
                    ? `No files matched inside ${browseMode === 'downloads' ? 'Downloads' : 'Documents'}. You can still pick external folders via SAF below.`
                    : browseMode === 'downloads'
                      ? 'Allow All Files Access to scan your Downloads folder directly, or pick files with SAF below.'
                      : 'Allow All Files Access to index PDF, Word, Excel, and text documents directly across shared storage, or use Grant Documents Folder (SAF) as fallback.'}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {!allFilesGranted && onRequestAllFilesAccess && (
                    <button
                      type="button"
                      onClick={() => void onRequestAllFilesAccess()}
                      className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold cursor-pointer"
                    >
                      Allow All Files Access
                    </button>
                  )}
                  {browseMode === 'documents' && (
                    <button
                      type="button"
                      onClick={() => void handleGrantSaf()}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                    >
                      Grant Documents Folder (SAF)
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      void handlePickDocumentFiles(
                        browseMode === 'downloads' ? 'downloads' : 'documents'
                      )
                    }
                    className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs font-semibold cursor-pointer"
                  >
                    {browseMode === 'downloads' ? 'Add Files from Downloads' : 'Add Document Files'}
                  </button>
                </div>
              </>
            ) : (
              <span>No accessible files in this view.</span>
            )}
          </div>
        ) : useGalleryGrid ? (
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-1 sm:gap-1.5 max-h-[36rem] overflow-y-auto pr-0.5">
            {visibleItems.map((item) => {
              const checked = selectedUris.has(item.uri);
              const isImg = isImageFileItem(item);
              const isVid = isVideoFileItem(item);
              const durLabel = isVid ? formatVideoDurationShort(item.durationMs) : '';

              return (
                <div
                  key={item.uri}
                  className={`group relative aspect-square rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 border transition-all ${
                    checked
                      ? 'border-emerald-500 ring-2 ring-emerald-500/70'
                      : 'border-slate-200/70 dark:border-slate-800'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedUris.size > 0) {
                        toggleSelect(item.uri);
                      } else {
                        void handleOpenFolderOrFile(item);
                      }
                    }}
                    className="w-full h-full block cursor-pointer text-left"
                    aria-label={item.name}
                  >
                    {isImg || isVid ? (
                      <MediaThumbnail item={item} iconSizeClass="w-6 h-6" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-1.5 bg-slate-50 dark:bg-slate-900">
                        {item.isDirectory ? (
                          <Folder className="w-6 h-6 text-amber-500" />
                        ) : isAudioFileItem(item) ? (
                          <AudioCoverThumbnail item={item} className="w-10 h-10 rounded-lg" />
                        ) : isPdfFileItem(item) ? (
                          <PdfThumbnail item={item} className="w-10 h-10 rounded-lg" />
                        ) : (
                          <DocumentBadgeTile item={item} className="w-10 h-10 rounded-lg" />
                        )}
                      </div>
                    )}
                  </button>

                  {/* Bottom gradient + filename strip matching Samsung My Files */}
                  <div className="absolute inset-x-0 bottom-0 pt-5 pb-1 px-1.5 bg-gradient-to-t from-black/80 via-black/45 to-transparent pointer-events-none">
                    {isVid && (
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/25 backdrop-blur-xs">
                          <Play className="w-2.5 h-2.5 text-white fill-white ml-0.5" />
                        </span>
                        {durLabel && (
                          <span className="text-[9px] font-mono font-semibold tabular-nums text-white/95 drop-shadow">
                            {durLabel}
                          </span>
                        )}
                      </div>
                    )}
                    <p className="text-[10px] font-medium text-white truncate drop-shadow-xs leading-tight">
                      {item.name}
                    </p>
                  </div>

                  {/* Select checkbox target */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(item.uri);
                    }}
                    className="absolute top-0 right-0 w-8 h-8 flex items-start justify-end p-1 cursor-pointer"
                    aria-label={checked ? `Deselect ${item.name}` : `Select ${item.name}`}
                  >
                    <span
                      className={`w-4 h-4 rounded-full flex items-center justify-center border transition-colors ${
                        checked
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'bg-black/35 border-white/75 text-transparent'
                      }`}
                    >
                      <Check className="w-2.5 h-2.5" />
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[34rem] overflow-y-auto">
            {visibleItems.map((item) => {
              const checked = selectedUris.has(item.uri);
              const isZip = item.name.toLowerCase().endsWith('.zip');
              const durLabel = isVideoFileItem(item)
                ? formatVideoDurationShort(item.durationMs)
                : '';
              const leftMeta = item.isDirectory
                ? 'Folder'
                : [
                    ...(item.dateModified > 0
                      ? [formatShortDateTime(item.dateModified)]
                      : ['Unknown date']),
                    ...(durLabel ? [durLabel] : []),
                  ].join(' · ');

              return (
                <div
                  key={item.uri}
                  className="py-2.5 flex items-center gap-2.5 hover:bg-slate-50 dark:hover:bg-slate-950/40 px-1 rounded-xl"
                >
                  <button
                    type="button"
                    onClick={() => toggleSelect(item.uri)}
                    className="cursor-pointer shrink-0 p-1"
                    aria-label="Select item"
                  >
                    {checked ? (
                      <CheckSquare className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleOpenFolderOrFile(item)}
                    className="flex-1 min-w-0 flex items-center gap-3 text-left cursor-pointer"
                  >
                    {getFileThumbnailOrIcon(item)}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100 truncate">
                        {item.name}
                      </p>
                      <div className="flex items-center justify-between gap-2 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                        <span className="truncate">{leftMeta}</span>
                        {!item.isDirectory && (
                          <span className="shrink-0 font-medium">
                            {formatBytes(item.size)}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  {!item.isDirectory && (
                    <div className="flex items-center gap-1 shrink-0">
                      {isZip && (
                        <button
                          type="button"
                          onClick={() => void handleExtractZip(item)}
                          className="px-2 py-1 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-bold cursor-pointer"
                        >
                          Extract
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void openExternally(item)}
                        className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 cursor-pointer"
                        title="Open in external app"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Full-Screen Phone Gallery Photo & Video Lightbox */}
      {previewItem && (
        <div className="fixed inset-0 z-50 bg-black/95 text-white flex flex-col">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
            <button
              type="button"
              onClick={() => setPreviewItem(null)}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer shrink-0"
              aria-label="Close preview"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="text-xs sm:text-sm font-semibold truncate">{previewItem.name}</p>
              <p className="text-[11px] text-white/65 tabular-nums truncate">
                {formatBytes(previewItem.size)}
                {previewItem.dateModified > 0 ? ` · ${formatShortDate(previewItem.dateModified)}` : ''}
                {previewIndex >= 0 ? ` · ${previewIndex + 1} / ${previewableItems.length}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => void handleShareSingle(previewItem)}
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer"
                title="Share"
                aria-label="Share"
              >
                <Share2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => void openExternally(previewItem)}
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer"
                title="Open with external app"
                aria-label="Open with external app"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const toDel = previewItem;
                  setPreviewItem(null);
                  setConfirmDeleteList([toDel]);
                }}
                className="w-9 h-9 rounded-full bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 flex items-center justify-center cursor-pointer"
                title="Delete"
                aria-label="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="relative flex-1 min-h-0 flex items-center justify-center p-2 sm:p-6">
            {previewIndex > 0 && (
              <button
                type="button"
                onClick={() => setPreviewItem(previewableItems[previewIndex - 1])}
                className="absolute left-2 sm:left-4 z-10 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 border border-white/15 flex items-center justify-center cursor-pointer"
                aria-label="Previous item"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}

            {previewLoading ? (
              <div className="flex flex-col items-center gap-2 text-xs text-white/75">
                <Loader2 className="w-7 h-7 animate-spin text-emerald-400" />
                <span>Loading preview...</span>
              </div>
            ) : previewSrcUrl ? (
              isVideoFileItem(previewItem) ? (
                <video
                  key={previewSrcUrl}
                  src={previewSrcUrl}
                  controls
                  autoPlay
                  playsInline
                  className="max-w-full max-h-full rounded-xl bg-black"
                />
              ) : (
                <img
                  key={previewSrcUrl}
                  src={previewSrcUrl}
                  alt={previewItem.name}
                  referrerPolicy="no-referrer"
                  className="max-w-full max-h-full object-contain rounded-lg"
                />
              )
            ) : (
              <div className="flex flex-col items-center gap-3 text-center max-w-xs">
                <div className="w-48 h-48 rounded-2xl overflow-hidden border border-white/15">
                  <MediaThumbnail item={previewItem} iconSizeClass="w-12 h-12" />
                </div>
                <button
                  type="button"
                  onClick={() => void openExternally(previewItem)}
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                >
                  Open in Default App
                </button>
              </div>
            )}

            {previewIndex >= 0 && previewIndex < previewableItems.length - 1 && (
              <button
                type="button"
                onClick={() => setPreviewItem(previewableItems[previewIndex + 1])}
                className="absolute right-2 sm:right-4 z-10 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 border border-white/15 flex items-center justify-center cursor-pointer"
                aria-label="Next item"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Create Folder Modal */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">Create New Folder</h4>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewFolderModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateFolder()}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">Rename Item</h4>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleRenameSubmit()}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copy / Move Destination Modal */}
      {transferModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white capitalize">
              {transferModal.mode} {transferModal.items.length} File(s)
            </h4>
            <div className="space-y-2 text-xs">
              <label className="font-semibold block">Destination Folder Path or Granted SAF Tree</label>
              {roots.some((r) => r.type === 'saf') && (
                <select
                  value={transferModal.targetTreeUri}
                  onChange={(e) =>
                    setTransferModal({ ...transferModal, targetTreeUri: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                >
                  <option value="">Use standard Download/folder path below</option>
                  {roots
                    .filter((r) => r.type === 'saf')
                    .map((r) => (
                      <option key={r.id} value={r.treeUri || ''}>
                        {r.label}
                      </option>
                    ))}
                </select>
              )}
              {!transferModal.targetTreeUri && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={transferModal.targetPath}
                    onChange={(e) =>
                      setTransferModal({ ...transferModal, targetPath: e.target.value })
                    }
                    placeholder="/storage/emulated/0/Download"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                  />
                  {isNativeAndroid() && (
                    <div className="flex flex-wrap gap-1.5">
                      {currentPath && currentPath.startsWith('/') && (
                        <button
                          type="button"
                          onClick={() =>
                            setTransferModal({ ...transferModal, targetPath: currentPath })
                          }
                          className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold cursor-pointer"
                        >
                          Current Folder
                        </button>
                      )}
                      {(() => {
                        const primaryPath =
                          roots.find((r) => r.id === 'internal')?.path || '/storage/emulated/0';
                        return (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setTransferModal({
                                  ...transferModal,
                                  targetPath: `${primaryPath}/Download`,
                                })
                              }
                              className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold cursor-pointer"
                            >
                              Downloads
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setTransferModal({
                                  ...transferModal,
                                  targetPath: `${primaryPath}/Documents`,
                                })
                              }
                              className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold cursor-pointer"
                            >
                              Documents
                            </button>
                          </>
                        );
                      })()}
                      {roots
                        .filter((r) => r.type === 'file' && r.id !== 'internal' && r.path)
                        .map((sd) => (
                          <button
                            key={sd.id}
                            type="button"
                            onClick={() =>
                              setTransferModal({
                                ...transferModal,
                                targetPath: sd.path || '',
                              })
                            }
                            className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold cursor-pointer"
                          >
                            {sd.label}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTransferModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleTransferSubmit()}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold capitalize cursor-pointer"
              >
                {transferModal.mode} Here
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Compress to ZIP Modal */}
      {zipModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              Compress {selectedItems.length} File(s) to ZIP
            </h4>
            <input
              type="text"
              value={zipArchiveName}
              onChange={(e) => setZipArchiveName(e.target.value)}
              placeholder="Archive name"
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setZipModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCompressToZip()}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
              >
                Create ZIP
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteList && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              Confirm Deletion
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Permanently delete {confirmDeleteList.length} selected item(s)? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteList(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold cursor-pointer"
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
