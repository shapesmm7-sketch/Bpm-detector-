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
  FileArchive,
  HardDrive,
} from 'lucide-react';
import { AudioLibrary, isNativeAndroid } from '../../plugins/audioLibrary';
import {
  PhoneFileItem,
  PhoneManager,
  StorageRootItem,
  formatBytes,
  formatShortDate,
} from '../../plugins/phoneManager';
import {
  createWebZipArchive,
  deleteWebItems,
  extractWebZipArchive,
  getAllWebFileItems,
  getWebStoredEntry,
  pickWebFolderForWorkspace,
  triggerWebBlobDownload,
} from '../../utils/localStorageAnalyzer';

interface FileManagerViewProps {
  onStorageMutated: () => Promise<void>;
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
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'date' | 'type'>('name');
  const [selectedUris, setSelectedUris] = useState<Set<string>>(new Set());

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

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
    void loadRoots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSelectedUris(new Set());
    if (browseMode === 'folder') {
      if (isNativeAndroid() && activeRoot) {
        void loadAndroidFolder(activeRoot, currentPath, docStack[docStack.length - 1]);
      } else if (!isNativeAndroid()) {
        setItems(getAllWebFileItems());
      }
    } else {
      void loadCategoryFiles(browseMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseMode, activeRoot?.id]);

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

  const loadCategoryFiles = async (cat: Exclude<FileBrowseMode, 'folder'>) => {
    setIsLoading(true);
    setErrorMsg(null);
    setEmptyAndroidNote(false);
    try {
      if (!isNativeAndroid()) {
        setItems(getAllWebFileItems().filter((f) => f.category === cat));
        return;
      }
      if (cat === 'images') {
        const res = await AudioLibrary.getAllImageFiles();
        setItems(
          (res.images || []).map((i) => ({
            id: i.id,
            name: i.displayName || i.title,
            uri: i.uri,
            path: '',
            size: i.size,
            dateModified: 0,
            mimeType: i.mimeType,
            category: 'images',
          }))
        );
      } else if (cat === 'videos') {
        const res = await AudioLibrary.getAllVideoFiles();
        setItems(
          (res.videos || []).map((v) => ({
            id: v.id,
            name: v.displayName || v.title,
            uri: v.uri,
            path: '',
            size: v.size,
            dateModified: 0,
            mimeType: v.mimeType,
            category: 'videos',
          }))
        );
      } else if (cat === 'audio') {
        const res = await AudioLibrary.getAllAudioFiles();
        setItems(
          (res.songs || []).map((s) => ({
            id: s.id,
            name: s.displayName || s.title,
            uri: s.uri,
            path: '',
            size: s.size,
            dateModified: 0,
            mimeType: s.mimeType,
            category: 'audio',
          }))
        );
      } else if (cat === 'downloads') {
        const res = await PhoneManager.scanDownloads();
        setItems(res.files || []);
      } else {
        const res = await PhoneManager.findLargeFiles({ minSizeBytes: 0, category: 'documents' });
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
      const res = await PhoneManager.requestSafFolderAccess();
      if (res.granted && res.treeUri) {
        const updatedRoots = await PhoneManager.getStorageRoots();
        setRoots(updatedRoots.roots || []);
        const safRoot =
          (updatedRoots.roots || []).find((r) => r.treeUri === res.treeUri) ||
          (updatedRoots.roots || [])[0];
        if (safRoot) {
          setBrowseMode('folder');
          setActiveRoot(safRoot);
          setDocStack([]);
          await loadAndroidFolder(safRoot, safRoot.path, undefined);
        }
      }
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Could not open Android SAF folder picker.');
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
      if (browseMode === 'folder' && activeRoot) {
        await loadAndroidFolder(activeRoot, currentPath, docStack[docStack.length - 1]);
      } else if (browseMode !== 'folder') {
        await loadCategoryFiles(browseMode);
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
      if (browseMode === 'folder' && activeRoot) {
        await loadAndroidFolder(activeRoot, currentPath, docStack[docStack.length - 1]);
      } else if (browseMode !== 'folder') {
        await loadCategoryFiles(browseMode);
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
      } else if (browseMode !== 'folder') {
        await loadCategoryFiles(browseMode);
      } else {
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

  const getFileIcon = (item: PhoneFileItem) => {
    if (item.isDirectory) return <Folder className="w-4 h-4 text-amber-500 shrink-0" />;
    if (item.category === 'images') return <ImageIcon className="w-4 h-4 text-emerald-500 shrink-0" />;
    if (item.category === 'videos') return <Film className="w-4 h-4 text-cyan-500 shrink-0" />;
    if (item.category === 'audio') return <Music className="w-4 h-4 text-violet-500 shrink-0" />;
    if (item.name.toLowerCase().endsWith('.zip')) return <FileArchive className="w-4 h-4 text-orange-500 shrink-0" />;
    return <FileText className="w-4 h-4 text-slate-400 shrink-0" />;
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

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleGrantSaf()}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>{isNativeAndroid() ? 'Open Folder (SAF)' : 'Pick Local Folder'}</span>
            </button>
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
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files by name..."
              className="w-full pl-8 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'name' | 'size' | 'date' | 'type')}
            className="px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-semibold"
          >
            <option value="name">Sort: Name</option>
            <option value="size">Sort: Size</option>
            <option value="date">Sort: Date</option>
            <option value="type">Sort: Type</option>
          </select>
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

      {/* Scoped Storage Notice (No MANAGE_EXTERNAL_STORAGE) */}
      {emptyAndroidNote && (
        <div className="p-3.5 rounded-2xl bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-300 text-xs">
          Android scoped storage limits direct raw folder listing here. Use the{' '}
          <strong>Open Folder (SAF)</strong> button above or switch to{' '}
          <strong>Images / Videos / Audio / Documents / Downloads</strong> tabs to manage files safely without Play-restricted permissions.
        </div>
      )}

      {/* Batch Actions Bar when items are checked */}
      {selectedItems.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-emerald-500/40 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2 shadow-sm">
          <span className="text-xs font-bold text-slate-900 dark:text-white">
            {selectedItems.length} item(s) selected
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedItems.length === 1 && !selectedItems[0].isDirectory && (
              <>
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
                <button
                  type="button"
                  onClick={() => void handleShareSingle(selectedItems[0])}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Share2 className="w-3 h-3" />
                  <span>Share</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() =>
                setTransferModal({
                  mode: 'copy',
                  items: selectedItems,
                  targetPath: currentPath || '',
                  targetTreeUri: roots.find((r) => r.type === 'saf')?.treeUri || '',
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
                  targetPath: currentPath || '',
                  targetTreeUri: roots.find((r) => r.type === 'saf')?.treeUri || '',
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

      {/* Files List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 sm:p-4">
        {currentPath && browseMode === 'folder' && (
          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 pb-2 mb-2 border-b border-slate-100 dark:border-slate-800 truncate">
            {currentPath}
          </p>
        )}

        {isLoading ? (
          <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
            <span>Loading files...</span>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No accessible files in this view.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[28rem] overflow-y-auto">
            {visibleItems.map((item) => {
              const checked = selectedUris.has(item.uri);
              const isZip = item.name.toLowerCase().endsWith('.zip');
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
                    className="flex-1 min-w-0 flex items-center gap-2.5 text-left cursor-pointer"
                  >
                    {getFileIcon(item)}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {item.name}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {item.isDirectory
                          ? 'Folder'
                          : `${formatBytes(item.size)} · ${formatShortDate(item.dateModified)}`}
                      </p>
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
                        onClick={() => void handleOpenFolderOrFile(item)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 cursor-pointer"
                        title="Open file"
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
                <input
                  type="text"
                  value={transferModal.targetPath}
                  onChange={(e) =>
                    setTransferModal({ ...transferModal, targetPath: e.target.value })
                  }
                  placeholder="/storage/emulated/0/Download"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                />
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
