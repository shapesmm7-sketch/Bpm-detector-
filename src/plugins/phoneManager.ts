import { PluginListenerHandle, registerPlugin } from '@capacitor/core';

export type StorageCategoryKey =
  | 'images'
  | 'videos'
  | 'audio'
  | 'documents'
  | 'downloads'
  | 'other';

export interface PhoneFileItem {
  id: string;
  name: string;
  uri: string;
  path: string;
  size: number;
  dateModified: number;
  mimeType: string;
  category: string;
  isDirectory?: boolean;
  durationMs?: number;
  resolution?: string;
  width?: number;
  height?: number;
}

export interface StorageCategoryStat {
  bytes: number;
  count: number;
}

export interface SafTreeRef {
  uri: string;
  label: string;
}

export interface AllFilesAccessStatus {
  granted: boolean;
  supported: boolean;
  hasMediaRead: boolean;
  sdkInt: number;
  openedSettings?: boolean;
  alreadyGranted?: boolean;
}

export interface StorageSummaryResult {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  hasStoragePermission: boolean;
  hasAllFilesAccess?: boolean;
  sdkInt?: number;
  indexedAt?: number;
  totalIndexedFiles?: number;
  fromCache?: boolean;
  categories: Record<StorageCategoryKey, StorageCategoryStat>;
  recentFiles: PhoneFileItem[];
  safTrees: SafTreeRef[];
}

export type IndexedFilesCategoryKey = StorageCategoryKey | 'whatsapp';

export type IndexedFilesMap = Record<IndexedFilesCategoryKey, PhoneFileItem[]>;

export interface IndexedCatalogResult {
  indexedAt: number;
  fromCache: boolean;
  scanDurationMs: number;
  totalIndexedFiles: number;
  hasAllFilesAccess: boolean;
  hasStoragePermission: boolean;
  summary: StorageSummaryResult;
  categoriesFiles: IndexedFilesMap;
  largeFiles?: PhoneFileItem[];
  duplicateGroups?: DuplicateGroup[];
  duplicateWastedBytes?: number;
  duplicatesReady?: boolean;
}

export interface DuplicateGroup {
  hash: string;
  size: number;
  category: string;
  wastedBytes: number;
  files: PhoneFileItem[];
}

export interface StorageRootItem {
  id: string;
  label: string;
  type: 'file' | 'saf';
  path?: string;
  treeUri?: string;
  writable: boolean;
}

export interface PrivacyOverviewResult {
  permissions: {
    microphone: boolean;
    phoneState: boolean;
    camera: boolean;
    location: boolean;
    notifications: boolean;
    mediaStorage: boolean;
    allFilesAccess?: boolean;
  };
  packageName: string;
  versionName: string;
  androidVersion: string;
  sdkInt: number;
  totalStorageBytes: number;
  availableStorageBytes: number;
  hasClipboardItem: boolean;
  clipboardMime: string;
}

interface PhoneManagerPluginInterface {
  getAllFilesAccessStatus(): Promise<AllFilesAccessStatus>;
  requestAllFilesAccess(): Promise<AllFilesAccessStatus>;
  syncAllFilesIndex(options?: {
    forceRefresh?: boolean;
    categoryLimit?: number;
  }): Promise<IndexedCatalogResult>;
  getCategoryFiles(options: {
    category: IndexedFilesCategoryKey | 'all';
    limit?: number;
    offset?: number;
  }): Promise<{
    files: PhoneFileItem[];
    totalCount: number;
    totalBytes: number;
    indexedAt?: number;
    fromCache?: boolean;
  }>;
  getStorageSummary(options?: {
    forceRefresh?: boolean;
  }): Promise<StorageSummaryResult>;
  findDuplicates(options?: {
    forceRefresh?: boolean;
  }): Promise<{
    groups: DuplicateGroup[];
    totalWastedBytes: number;
  }>;
  findLargeFiles(options?: {
    minSizeBytes?: number;
    category?: string;
  }): Promise<{
    files: PhoneFileItem[];
    totalBytes: number;
  }>;
  searchFiles(options: {
    query: string;
    category?: string;
    maxResults?: number;
  }): Promise<{
    files: PhoneFileItem[];
    totalMatched: number;
  }>;
  scanWhatsAppMedia(): Promise<{
    files: PhoneFileItem[];
    totalBytes: number;
    requiresSafHint?: boolean;
  }>;
  scanDownloads(): Promise<{
    files: PhoneFileItem[];
    totalBytes: number;
  }>;
  compressImage(options: {
    uri: string;
    quality: number;
    maxDimension: number;
    overwriteOriginal?: boolean;
  }): Promise<{
    saved: boolean;
    uri: string;
    displayPath: string;
    originalSize: number;
    compressedSize: number;
    width: number;
    height: number;
  }>;
  compressVideo(options: {
    uri: string;
    maxDimension: number;
    bitrateKbps: number;
  }): Promise<{
    saved: boolean;
    uri: string;
    displayPath: string;
    originalSize: number;
    compressedSize: number;
  }>;
  getStorageRoots(): Promise<{
    roots: StorageRootItem[];
    hasAllFilesAccess?: boolean;
  }>;
  listDirectory(options: {
    path?: string;
    treeUri?: string;
    documentUri?: string;
  }): Promise<{
    items: PhoneFileItem[];
    currentPath: string;
    parentPath: string;
    emptyNote?: boolean;
  }>;
  requestSafFolderAccess(options?: {
    preset?: 'whatsapp' | 'documents' | 'default';
    initialPath?: string;
  }): Promise<{
    granted: boolean;
    cancelled?: boolean;
    treeUri?: string;
    label?: string;
  }>;
  requestSafDocumentFiles(options?: {
    preset?: 'documents' | 'downloads';
  }): Promise<{
    addedCount: number;
    cancelled?: boolean;
  }>;
  getPdfThumbnail(options: {
    id?: string;
    uri: string;
  }): Promise<{
    filePath?: string;
    localUrl: string;
  }>;
  createFolder(options: {
    parentPath?: string;
    treeUri?: string;
    documentUri?: string;
    name: string;
  }): Promise<{
    created: boolean;
    path: string;
  }>;
  renameFileItem(options: {
    uri: string;
    path?: string;
    newName: string;
  }): Promise<{
    renamed: boolean;
    newUri: string;
    newPath: string;
  }>;
  copyOrMoveFileItems(options: {
    items: Array<{ uri: string; path?: string; name: string; mimeType?: string }>;
    targetPath?: string;
    targetTreeUri?: string;
    targetDocumentUri?: string;
    mode: 'copy' | 'move';
  }): Promise<{
    processedCount: number;
  }>;
  deleteFileItems(options: {
    items: Array<{ uri: string; path?: string }>;
  }): Promise<{
    deletedCount: number;
    cancelled?: boolean;
  }>;
  shareFileItem(options: {
    uri: string;
    mimeType?: string;
    title?: string;
  }): Promise<{
    shared: boolean;
  }>;
  openFileItem(options: {
    uri: string;
    mimeType?: string;
  }): Promise<{
    opened: boolean;
  }>;
  compressToZip(options: {
    items: Array<{ uri: string; name: string }>;
    archiveName: string;
  }): Promise<{
    saved: boolean;
    uri: string;
    displayPath: string;
    size: number;
  }>;
  extractZipArchive(options: {
    uri: string;
    folderName: string;
  }): Promise<{
    extracted: boolean;
    extractedCount: number;
    outputPath: string;
  }>;
  getPrivacyOverview(): Promise<PrivacyOverviewResult>;
  clearClipboard(): Promise<{
    cleared: boolean;
  }>;
  openPrivacySetting(options: {
    target: 'app_details' | 'privacy_dashboard' | 'notifications' | 'all_apps' | 'all_files_access';
  }): Promise<{
    opened: boolean;
  }>;
  addListener(
    eventName: 'videoCompressProgress',
    listenerFunc: (payload: { percent: number }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'allFilesAccessChanged',
    listenerFunc: (payload: { granted: boolean; hasMediaRead: boolean; sdkInt: number }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'fileIndexUpdated',
    listenerFunc: (payload: StorageSummaryResult) => void
  ): Promise<PluginListenerHandle>;
}

export const PhoneManager = registerPlugin<PhoneManagerPluginInterface>('PhoneManager');

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  const formatted = idx === 0 || value >= 100 ? value.toFixed(0) : value.toFixed(2);
  return `${formatted} ${units[idx]}`;
}

export function formatShortDate(ms: number): string {
  if (!ms || ms <= 0) return 'Unknown date';
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Unknown date';
  }
}

export function formatShortDateTime(ms: number): string {
  if (!ms || ms <= 0) return 'Unknown date';
  try {
    const d = new Date(ms);
    const now = new Date();
    const datePart = d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    });
    const timePart = d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    return `${datePart} ${timePart}`;
  } catch {
    return 'Unknown date';
  }
}
