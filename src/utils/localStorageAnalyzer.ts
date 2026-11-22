import JSZip from 'jszip';
import type {
  DuplicateGroup,
  PhoneFileItem,
  StorageCategoryKey,
  StorageCategoryStat,
  StorageSummaryResult,
} from '../plugins/phoneManager';

export interface WebStoredFileEntry {
  item: PhoneFileItem;
  file: File;
  handle?: FileSystemFileHandle;
  parentHandle?: FileSystemDirectoryHandle;
}

const webFileRegistry = new Map<string, WebStoredFileEntry>();
let webRootFolderName = '';
let webRootDirHandle: FileSystemDirectoryHandle | null = null;

export function hasWebWorkspaceFiles(): boolean {
  return webFileRegistry.size > 0;
}

export function getWebRootFolderName(): string {
  return webRootFolderName;
}

export function getWebStoredEntry(idOrUri: string): WebStoredFileEntry | undefined {
  const direct = webFileRegistry.get(idOrUri);
  if (direct) return direct;
  for (const entry of webFileRegistry.values()) {
    if (entry.item.uri === idOrUri || entry.item.path === idOrUri) {
      return entry;
    }
  }
  return undefined;
}

export function getAllWebFileItems(): PhoneFileItem[] {
  return Array.from(webFileRegistry.values()).map((e) => e.item);
}

export function classifyLocalCategory(name: string, mime: string, pathLower: string): StorageCategoryKey {
  const lower = (name || '').toLowerCase();
  const m = (mime || '').toLowerCase();
  if (
    m.startsWith('image/') ||
    /\.(jpg|jpeg|png|webp|gif|heic|bmp)$/.test(lower)
  ) {
    return 'images';
  }
  if (
    m.startsWith('video/') ||
    /\.(mp4|mkv|mov|webm|3gp|avi)$/.test(lower)
  ) {
    return 'videos';
  }
  if (
    m.startsWith('audio/') ||
    /\.(mp3|wav|m4a|flac|aac|ogg|opus)$/.test(lower)
  ) {
    return 'audio';
  }
  if (pathLower.includes('download')) {
    return 'downloads';
  }
  if (
    m.includes('pdf') ||
    m.includes('word') ||
    m.includes('text') ||
    /\.(pdf|doc|docx|txt|csv|xls|xlsx|ppt|pptx)$/.test(lower)
  ) {
    return 'documents';
  }
  return 'other';
}

export function classifyWhatsAppWebCategory(item: PhoneFileItem): string {
  const combined = `${item.path}/${item.name}`.toLowerCase();
  if (combined.includes('/sent') || combined.includes('sent/') || combined.includes('forwarded')) {
    return 'forwarded';
  }
  if (combined.includes('voice note') || combined.endsWith('.opus') || combined.includes('ptt')) {
    return 'voice_notes';
  }
  if (item.category === 'images') return 'images';
  if (item.category === 'videos') return 'videos';
  return 'documents';
}

export async function pickWebFolderForWorkspace(): Promise<PhoneFileItem[]> {
  const picker = (window as unknown as {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;

  if (!picker) {
    throw new Error('Directory Picker is not supported in this browser. Use the multi-file selector instead.');
  }

  const rootHandle = await picker({ mode: 'readwrite' });
  webFileRegistry.clear();
  webRootDirHandle = rootHandle;
  webRootFolderName = rootHandle.name;

  async function walk(dir: FileSystemDirectoryHandle, relPath: string, depth: number) {
    if (depth > 5) return;
    const entriesFn = (dir as unknown as {
      values: () => AsyncIterable<FileSystemHandle>;
    }).values;
    for await (const handle of entriesFn.call(dir)) {
      if (handle.kind === 'file') {
        const fileHandle = handle as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        const fullPath = relPath ? `${relPath}/${file.name}` : file.name;
        const id = `web-${fullPath}-${file.size}`;
        const url = URL.createObjectURL(file);
        const category = classifyLocalCategory(file.name, file.type, fullPath.toLowerCase());
        const item: PhoneFileItem = {
          id,
          name: file.name,
          uri: url,
          path: fullPath,
          size: file.size,
          dateModified: file.lastModified || Date.now(),
          mimeType: file.type || 'application/octet-stream',
          category,
        };
        webFileRegistry.set(id, { item, file, handle: fileHandle, parentHandle: dir });
      } else if (handle.kind === 'directory') {
        const subDir = handle as FileSystemDirectoryHandle;
        const nextRel = relPath ? `${relPath}/${subDir.name}` : subDir.name;
        await walk(subDir, nextRel, depth + 1);
      }
    }
  }

  await walk(rootHandle, rootHandle.name, 0);
  return getAllWebFileItems();
}

export function ingestWebFileList(fileList: FileList): PhoneFileItem[] {
  for (const existing of webFileRegistry.values()) {
    if (existing.item.uri.startsWith('blob:')) {
      URL.revokeObjectURL(existing.item.uri);
    }
  }
  webFileRegistry.clear();
  webRootDirHandle = null;
  webRootFolderName = 'Selected Local Files';

  Array.from(fileList).forEach((file, index) => {
    const relPath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const id = `web-${index}-${file.name}-${file.size}`;
    const url = URL.createObjectURL(file);
    const category = classifyLocalCategory(file.name, file.type, relPath.toLowerCase());
    const item: PhoneFileItem = {
      id,
      name: file.name,
      uri: url,
      path: relPath,
      size: file.size,
      dateModified: file.lastModified || Date.now(),
      mimeType: file.type || 'application/octet-stream',
      category,
    };
    webFileRegistry.set(id, { item, file });
  });

  return getAllWebFileItems();
}

export async function getWebStorageSummary(): Promise<StorageSummaryResult> {
  const categories: Record<StorageCategoryKey, StorageCategoryStat> = {
    images: { bytes: 0, count: 0 },
    videos: { bytes: 0, count: 0 },
    audio: { bytes: 0, count: 0 },
    documents: { bytes: 0, count: 0 },
    downloads: { bytes: 0, count: 0 },
    other: { bytes: 0, count: 0 },
  };

  const allItems = getAllWebFileItems();
  let scannedBytes = 0;
  for (const item of allItems) {
    const cat = (item.category in categories ? item.category : 'other') as StorageCategoryKey;
    categories[cat].bytes += item.size;
    categories[cat].count += 1;
    scannedBytes += item.size;
  }

  let totalBytes = 0;
  let usedBytes = scannedBytes;
  let availableBytes = 0;

  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      if (est.quota && est.quota > 0) {
        totalBytes = est.quota;
        usedBytes = Math.max(est.usage || 0, scannedBytes);
        availableBytes = Math.max(0, totalBytes - usedBytes);
      }
    } catch {
      // ignore
    }
  }

  const recentFiles = [...allItems]
    .sort((a, b) => b.dateModified - a.dateModified)
    .slice(0, 12);

  return {
    totalBytes,
    availableBytes,
    usedBytes,
    hasStoragePermission: true,
    categories,
    recentFiles,
    safTrees: webRootDirHandle ? [{ uri: 'web-root', label: webRootFolderName }] : [],
  };
}

export async function findWebDuplicates(): Promise<{
  groups: DuplicateGroup[];
  totalWastedBytes: number;
}> {
  const entries = Array.from(webFileRegistry.values());
  const bySize = new Map<number, WebStoredFileEntry[]>();
  for (const e of entries) {
    if (e.item.size <= 0 || e.item.size > 250 * 1024 * 1024) continue;
    const list = bySize.get(e.item.size) || [];
    list.push(e);
    bySize.set(e.item.size, list);
  }

  const byHash = new Map<string, WebStoredFileEntry[]>();
  for (const [, sameSize] of bySize) {
    if (sameSize.length < 2) continue;
    for (const entry of sameSize) {
      const buf = await entry.file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const key = `${entry.item.size}:${hex}`;
      const list = byHash.get(key) || [];
      list.push(entry);
      byHash.set(key, list);
    }
  }

  const groups: DuplicateGroup[] = [];
  let totalWastedBytes = 0;
  for (const [key, list] of byHash) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.item.dateModified - b.item.dateModified);
    const [, hash] = key.split(':');
    const wastedBytes = list[0].item.size * (list.length - 1);
    totalWastedBytes += wastedBytes;
    groups.push({
      hash,
      size: list[0].item.size,
      category: list[0].item.category,
      wastedBytes,
      files: list.map((e) => e.item),
    });
  }

  return { groups, totalWastedBytes };
}

export function deleteWebItems(ids: string[]): number {
  let removed = 0;
  for (const id of ids) {
    const entry = webFileRegistry.get(id);
    if (!entry) continue;
    if (entry.item.uri.startsWith('blob:')) {
      URL.revokeObjectURL(entry.item.uri);
    }
    webFileRegistry.delete(id);
    removed++;
  }
  return removed;
}

export async function compressWebImageFile(
  file: File,
  qualityPercent: number,
  maxDimension: number
): Promise<{
  blob: Blob;
  originalSize: number;
  compressedSize: number;
  width: number;
  height: number;
  fileName: string;
}> {
  const bitmap = await createImageBitmap(file);
  try {
    let targetW = bitmap.width;
    let targetH = bitmap.height;
    if (maxDimension > 0 && Math.max(targetW, targetH) > maxDimension) {
      const scale = maxDimension / Math.max(targetW, targetH);
      targetW = Math.max(1, Math.round(targetW * scale));
      targetH = Math.max(1, Math.round(targetH * scale));
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not encode JPEG image.'))),
        'image/jpeg',
        Math.max(0.1, Math.min(0.98, qualityPercent / 100))
      );
    });

    const baseName = file.name.replace(/\.[^/.]+$/, '');
    return {
      blob,
      originalSize: file.size,
      compressedSize: blob.size,
      width: targetW,
      height: targetH,
      fileName: `${baseName}_compressed.jpg`,
    };
  } finally {
    bitmap.close();
  }
}

export async function compressWebVideoFile(
  file: File,
  maxDimension: number,
  bitrateKbps: number,
  onProgress?: (percent: number) => void
): Promise<{
  blob: Blob;
  originalSize: number;
  compressedSize: number;
  fileName: string;
}> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = false;
  video.playsInline = true;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not decode selected video file.'));
    });

    const srcW = video.videoWidth || 1280;
    const srcH = video.videoHeight || 720;
    const maxSide = Math.max(srcW, srcH);
    const scale = maxSide > maxDimension ? maxDimension / maxSide : 1;
    const outW = Math.max(2, Math.round(srcW * scale) & ~1);
    const outH = Math.max(2, Math.round(srcH * scale) & ~1);

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Video canvas context unavailable.');

    const stream = canvas.captureStream(30);
    // Capture audio track if supported
    const videoWithCapture = video as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    const mediaStream =
      typeof videoWithCapture.captureStream === 'function'
        ? videoWithCapture.captureStream()
        : typeof videoWithCapture.mozCaptureStream === 'function'
          ? videoWithCapture.mozCaptureStream()
          : null;
    if (mediaStream) {
      for (const track of mediaStream.getAudioTracks()) {
        stream.addTrack(track);
      }
    }

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : 'video/webm';

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: bitrateKbps * 1000,
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };

    const donePromise = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunks, { type: mimeType }));
      };
    });

    recorder.start(250);
    await video.play();

    const durationSec = Math.max(0.1, video.duration || 1);
    let stopped = false;

    const drawLoop = () => {
      if (stopped || video.paused || video.ended) return;
      ctx.drawImage(video, 0, 0, outW, outH);
      onProgress?.(Math.min(99, Math.round((video.currentTime / durationSec) * 100)));
      requestAnimationFrame(drawLoop);
    };
    requestAnimationFrame(drawLoop);

    await new Promise<void>((resolve) => {
      video.onended = () => resolve();
    });
    stopped = true;
    recorder.stop();
    const outBlob = await donePromise;
    onProgress?.(100);

    const baseName = file.name.replace(/\.[^/.]+$/, '');
    return {
      blob: outBlob,
      originalSize: file.size,
      compressedSize: outBlob.size,
      fileName: `${baseName}_${maxDimension}p_compressed.webm`,
    };
  } finally {
    video.pause();
    video.src = '';
    URL.revokeObjectURL(url);
  }
}

export async function createWebZipArchive(
  items: PhoneFileItem[],
  archiveName: string
): Promise<{ blob: Blob; fileName: string; size: number }> {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const item of items) {
    const entry = getWebStoredEntry(item.id) || getWebStoredEntry(item.uri);
    if (!entry) continue;
    let safeName = item.name.replace(/^[/\\]+/, '');
    if (used.has(safeName)) {
      const dot = safeName.lastIndexOf('.');
      const base = dot > 0 ? safeName.slice(0, dot) : safeName;
      const ext = dot > 0 ? safeName.slice(dot) : '';
      let n = 2;
      while (used.has(`${base}_${n}${ext}`)) n++;
      safeName = `${base}_${n}${ext}`;
    }
    used.add(safeName);
    zip.file(safeName, entry.file);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const finalName = archiveName.toLowerCase().endsWith('.zip')
    ? archiveName
    : `${archiveName}.zip`;
  return { blob, fileName: finalName, size: blob.size };
}

export async function extractWebZipArchive(file: File): Promise<{
  extractedFiles: Array<{ name: string; size: number; blob: Blob }>;
}> {
  const zip = await JSZip.loadAsync(file);
  const extractedFiles: Array<{ name: string; size: number; blob: Blob }> = [];
  for (const [entryPath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;
    // Zip-Slip guard
    const normalized = entryPath.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.includes('../') || normalized === '..') {
      continue;
    }
    const blob = await zipEntry.async('blob');
    extractedFiles.push({
      name: normalized.split('/').pop() || normalized,
      size: blob.size,
      blob,
    });
  }
  return { extractedFiles };
}

export interface StorageRecommendationItem {
  id: string;
  kind: 'duplicates' | 'large_files' | 'old_downloads' | 'whatsapp_forwarded';
  title: string;
  description: string;
  estimatedSavingsBytes: number;
  itemCount: number;
  targetTool: 'duplicates' | 'large' | 'downloads' | 'whatsapp';
}

export function buildStorageRecommendations(params: {
  duplicateGroups: DuplicateGroup[];
  largeFiles: PhoneFileItem[];
  downloads: PhoneFileItem[];
  whatsappFiles: PhoneFileItem[];
}): StorageRecommendationItem[] {
  const recs: StorageRecommendationItem[] = [];

  if (params.duplicateGroups.length > 0) {
    const dupBytes = params.duplicateGroups.reduce((s, g) => s + g.wastedBytes, 0);
    const extraCopies = params.duplicateGroups.reduce((s, g) => s + Math.max(0, g.files.length - 1), 0);
    if (extraCopies > 0) {
      recs.push({
        id: 'rec-duplicates',
        kind: 'duplicates',
        title: `Review ${extraCopies} exact duplicate copies`,
        description: `${params.duplicateGroups.length} SHA-256 verified groups found. Keeping 1 original copy frees space safely.`,
        estimatedSavingsBytes: dupBytes,
        itemCount: extraCopies,
        targetTool: 'duplicates',
      });
    }
  }

  const veryLarge = params.largeFiles.filter((f) => f.size >= 50 * 1024 * 1024);
  if (veryLarge.length > 0) {
    const bytes = veryLarge.reduce((s, f) => s + f.size, 0);
    recs.push({
      id: 'rec-large',
      kind: 'large_files',
      title: `Review ${veryLarge.length} files over 50 MB`,
      description: 'Large videos or archives occupy the most storage. Delete unused ones or compress videos locally.',
      estimatedSavingsBytes: bytes,
      itemCount: veryLarge.length,
      targetTool: 'large',
    });
  }

  const cleanableDl = params.downloads.filter(
    (f) => f.category === 'apk' || f.category === 'old' || f.category === 'archive'
  );
  if (cleanableDl.length > 0) {
    const bytes = cleanableDl.reduce((s, f) => s + f.size, 0);
    recs.push({
      id: 'rec-downloads',
      kind: 'old_downloads',
      title: `Inspect ${cleanableDl.length} APK installers, archives & old downloads`,
      description: 'Old installers and ZIP files in Downloads are often no longer needed.',
      estimatedSavingsBytes: bytes,
      itemCount: cleanableDl.length,
      targetTool: 'downloads',
    });
  }

  const waForwarded = params.whatsappFiles.filter((f) => f.category === 'forwarded');
  if (waForwarded.length > 0) {
    const bytes = waForwarded.reduce((s, f) => s + f.size, 0);
    recs.push({
      id: 'rec-whatsapp',
      kind: 'whatsapp_forwarded',
      title: `Review ${waForwarded.length} WhatsApp Sent/Forwarded media items`,
      description: 'Copies of videos and images you sent or forwarded are often already backed up elsewhere.',
      estimatedSavingsBytes: bytes,
      itemCount: waForwarded.length,
      targetTool: 'whatsapp',
    });
  }

  return recs;
}

export function triggerWebBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
