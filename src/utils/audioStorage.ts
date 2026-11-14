/**
 * Local IndexedDB storage for recently analyzed audio files.
 * Allows history songs to reload instantly offline in both Web and Capacitor Android.
 */

const DB_NAME = 'beatpulse_audio_cache';
const STORE_NAME = 'tracks';
const DB_VERSION = 1;
const MAX_CACHED_TRACKS = 15;

export interface CachedAudioRecord {
  id: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
  updatedAt: number;
}

function openAudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
}

export async function saveAudioToCache(
  id: string,
  blob: Blob,
  fileName: string
): Promise<void> {
  try {
    const db = await openAudioDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record: CachedAudioRecord = {
        id,
        fileName,
        mimeType: blob.type || 'audio/mpeg',
        blob,
        updatedAt: Date.now(),
      };
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Trim oldest entries beyond MAX_CACHED_TRACKS
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as CachedAudioRecord[]) || [];
        if (all.length > MAX_CACHED_TRACKS) {
          all.sort((a, b) => b.updatedAt - a.updatedAt);
          for (const stale of all.slice(MAX_CACHED_TRACKS)) {
            store.delete(stale.id);
          }
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });

    db.close();
  } catch (err) {
    console.warn('Could not cache audio in IndexedDB:', err);
  }
}

export async function getAudioFromCache(id: string): Promise<CachedAudioRecord | null> {
  try {
    const db = await openAudioDb();
    const record = await new Promise<CachedAudioRecord | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve((req.result as CachedAudioRecord) || null);
      req.onerror = () => resolve(null);
    });
    db.close();
    return record;
  } catch {
    return null;
  }
}

export async function removeAudioFromCache(id: string): Promise<void> {
  try {
    const db = await openAudioDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function clearAudioCache(): Promise<void> {
  try {
    const db = await openAudioDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // ignore
  }
}
