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
}

export interface StorageCategoryStat {
  bytes: number;
  count: number;
}

export interface SafTreeRef {
  uri: string;
  label: string;
}

export interface StorageSummaryResult {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  hasStoragePermission: boolean;
  categories: Record<StorageCategoryKey, StorageCategoryStat>;
  recentFiles: PhoneFileItem[];
  safTrees: SafTreeRef[];
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
  getStorageSummary(): Promise<StorageSummaryResult>;
  findDuplicates(): Promise<{
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
  requestSafFolderAccess(): Promise<{
    granted: boolean;
    cancelled?: boolean;
    treeUri?: string;
    label?: string;
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
    target: 'app_details' | 'privacy_dashboard' | 'notifications' | 'all_apps';
  }): Promise<{
    opened: boolean;
  }>;
  addListener(
    eventName: 'videoCompressProgress',
    listenerFunc: (payload: { percent: number }) => void
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
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
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
