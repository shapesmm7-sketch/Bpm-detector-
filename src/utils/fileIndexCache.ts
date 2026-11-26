import { isNativeAndroid } from '../plugins/audioLibrary';
import {
  DuplicateGroup,
  IndexedCatalogResult,
  IndexedFilesCategoryKey,
  IndexedFilesMap,
  PhoneFileItem,
  PhoneManager,
  StorageSummaryResult,
} from '../plugins/phoneManager';
import {
  classifyWhatsAppWebCategory,
  findWebDuplicates,
  getAllWebFileItems,
  getWebStorageSummary,
} from './localStorageAnalyzer';

export interface CachedPhoneIndexState {
  ready: boolean;
  isIndexing: boolean;
  indexedAt: number;
  totalIndexedFiles: number;
  hasAllFilesAccess: boolean;
  hasStoragePermission: boolean;
  summary: StorageSummaryResult | null;
  categoriesFiles: IndexedFilesMap;
  largeFiles: PhoneFileItem[];
  duplicateGroups: DuplicateGroup[];
  duplicateWastedBytes: number;
  duplicatesReady: boolean;
}

const EMPTY_CATEGORIES: IndexedFilesMap = {
  images: [],
  videos: [],
  audio: [],
  documents: [],
  downloads: [],
  other: [],
  whatsapp: [],
};

let cacheState: CachedPhoneIndexState = {
  ready: false,
  isIndexing: false,
  indexedAt: 0,
  totalIndexedFiles: 0,
  hasAllFilesAccess: false,
  hasStoragePermission: false,
  summary: null,
  categoriesFiles: { ...EMPTY_CATEGORIES },
  largeFiles: [],
  duplicateGroups: [],
  duplicateWastedBytes: 0,
  duplicatesReady: false,
};

let inflightSyncPromise: Promise<CachedPhoneIndexState> | null = null;
const listeners = new Set<(state: CachedPhoneIndexState) => void>();

function notifySubscribers() {
  for (const fn of listeners) {
    try {
      fn(cacheState);
    } catch {
      // ignore subscriber errors
    }
  }
}

export function subscribePhoneIndexCache(
  fn: (state: CachedPhoneIndexState) => void
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getCachedPhoneIndexState(): CachedPhoneIndexState {
  return cacheState;
}

export function hasCachedPhoneIndex(): boolean {
  return cacheState.ready;
}

export function getCachedCategoryItems(category: IndexedFilesCategoryKey): PhoneFileItem[] {
  return cacheState.categoriesFiles[category] || [];
}

export function getCachedLargeFiles(): PhoneFileItem[] {
  return cacheState.largeFiles || [];
}

export function getCachedDuplicates(): {
  ready: boolean;
  groups: DuplicateGroup[];
  totalWastedBytes: number;
} {
  return {
    ready: cacheState.duplicatesReady,
    groups: cacheState.duplicateGroups || [],
    totalWastedBytes: cacheState.duplicateWastedBytes || 0,
  };
}

export function updateCachedDuplicates(
  groups: DuplicateGroup[],
  totalWastedBytes: number
): void {
  cacheState = {
    ...cacheState,
    duplicateGroups: groups,
    duplicateWastedBytes: totalWastedBytes,
    duplicatesReady: true,
  };
  notifySubscribers();
}

export function clearCachedPhoneIndex(): void {
  cacheState = {
    ready: false,
    isIndexing: false,
    indexedAt: 0,
    totalIndexedFiles: 0,
    hasAllFilesAccess: false,
    hasStoragePermission: false,
    summary: null,
    categoriesFiles: { ...EMPTY_CATEGORIES },
    largeFiles: [],
    duplicateGroups: [],
    duplicateWastedBytes: 0,
    duplicatesReady: false,
  };
  notifySubscribers();
}

function applyNativeCatalogResult(res: IndexedCatalogResult): CachedPhoneIndexState {
  cacheState = {
    ready: true,
    isIndexing: false,
    indexedAt: res.indexedAt || Date.now(),
    totalIndexedFiles: res.totalIndexedFiles || 0,
    hasAllFilesAccess: Boolean(res.hasAllFilesAccess),
    hasStoragePermission: Boolean(res.hasStoragePermission),
    summary: res.summary,
    categoriesFiles: {
      images: res.categoriesFiles?.images || [],
      videos: res.categoriesFiles?.videos || [],
      audio: res.categoriesFiles?.audio || [],
      documents: res.categoriesFiles?.documents || [],
      downloads: res.categoriesFiles?.downloads || [],
      other: res.categoriesFiles?.other || [],
      whatsapp: res.categoriesFiles?.whatsapp || [],
    },
    largeFiles: res.largeFiles || [],
    duplicateGroups: res.duplicateGroups || [],
    duplicateWastedBytes: res.duplicateWastedBytes || 0,
    duplicatesReady: Boolean(res.duplicatesReady),
  };
  notifySubscribers();
  return cacheState;
}

async function buildWebIndexState(): Promise<CachedPhoneIndexState> {
  const summary = await getWebStorageSummary();
  const all = getAllWebFileItems();
  const categoriesFiles: IndexedFilesMap = {
    images: all.filter((f) => f.category === 'images'),
    videos: all.filter((f) => f.category === 'videos'),
    audio: all.filter((f) => f.category === 'audio'),
    documents: all.filter((f) => f.category === 'documents'),
    downloads: all.filter(
      (f) => f.category === 'downloads' || f.path.toLowerCase().includes('download')
    ),
    other: all.filter((f) => f.category === 'other'),
    whatsapp: all
      .filter((f) => `${f.path}/${f.name}`.toLowerCase().includes('whatsapp'))
      .map((f) => ({ ...f, category: classifyWhatsAppWebCategory(f) })),
  };
  const largeFiles = all
    .filter((f) => f.size >= 5 * 1024 * 1024)
    .sort((a, b) => b.size - a.size);
  const dup = await findWebDuplicates();

  cacheState = {
    ready: true,
    isIndexing: false,
    indexedAt: Date.now(),
    totalIndexedFiles: all.length,
    hasAllFilesAccess: true,
    hasStoragePermission: true,
    summary,
    categoriesFiles,
    largeFiles,
    duplicateGroups: dup.groups,
    duplicateWastedBytes: dup.totalWastedBytes,
    duplicatesReady: true,
  };
  notifySubscribers();
  return cacheState;
}

/**
 * Performs a single deduplicated index scan across shared storage and caches every category,
 * large files, and duplicate groups both natively on disk/memory and in the JS store so opening
 * any folder or tool is instantaneous.
 */
export async function syncCachedPhoneIndex(forceRefresh = false): Promise<CachedPhoneIndexState> {
  if (!forceRefresh && cacheState.ready) {
    return cacheState;
  }
  if (inflightSyncPromise && !forceRefresh) {
    return inflightSyncPromise;
  }

  cacheState = { ...cacheState, isIndexing: true };
  notifySubscribers();

  const task = (async () => {
    try {
      if (!isNativeAndroid()) {
        return await buildWebIndexState();
      }
      const res = await PhoneManager.syncAllFilesIndex({
        forceRefresh,
        categoryLimit: 2500,
      });
      return applyNativeCatalogResult(res);
    } catch {
      cacheState = { ...cacheState, isIndexing: false };
      notifySubscribers();
      return cacheState;
    } finally {
      if (inflightSyncPromise === task) {
        inflightSyncPromise = null;
      }
    }
  })();

  inflightSyncPromise = task;
  return task;
}
