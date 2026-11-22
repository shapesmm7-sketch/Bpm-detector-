import React, { useEffect, useRef, useState } from 'react';
import { FileText, Film, Folder, Image as ImageIcon, Music } from 'lucide-react';
import {
  AudioLibrary,
  isNativeAndroid,
  resolvePlayableAudioUrl,
} from '../../plugins/audioLibrary';
import { PhoneFileItem, PhoneManager } from '../../plugins/phoneManager';
import { getWebStoredEntry } from '../../utils/localStorageAnalyzer';

const MAX_CONCURRENT_THUMBS = 3;
let activeThumbLoads = 0;
const thumbQueue: Array<() => void> = [];

function withThumbSlot<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeThumbLoads++;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          activeThumbLoads = Math.max(0, activeThumbLoads - 1);
          const next = thumbQueue.shift();
          if (next) next();
        });
    };
    if (activeThumbLoads < MAX_CONCURRENT_THUMBS) {
      run();
    } else {
      thumbQueue.push(run);
    }
  });
}

const fileThumbCache = new Map<string, string>();
const EMPTY_SENTINEL = '__NONE__';

async function extractWebVideoFrame(file: File): Promise<string> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;
    const finish = (out: string) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
      resolve(out);
    };

    const timer = window.setTimeout(() => finish(''), 4000);

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      try {
        video.currentTime = Math.min(1, Math.max(0.1, (video.duration || 2) * 0.15));
      } catch {
        // ignore seek issue
      }
    };
    video.onseeked = () => {
      window.clearTimeout(timer);
      try {
        const w = Math.max(1, Math.min(360, video.videoWidth || 320));
        const ratio = video.videoHeight && video.videoWidth ? video.videoHeight / video.videoWidth : 9 / 16;
        const h = Math.max(1, Math.round(w * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          finish(canvas.toDataURL('image/jpeg', 0.8));
          return;
        }
      } catch {
        // ignore canvas errors
      }
      finish('');
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      finish('');
    };
    video.src = objectUrl;
  });
}

export function isImageFileItem(item: PhoneFileItem): boolean {
  if (item.isDirectory) return false;
  if (item.category === 'images') return true;
  if (item.mimeType?.toLowerCase().startsWith('image/')) return true;
  return /\.(jpg|jpeg|png|webp|gif|heic|heif|bmp)$/i.test(item.name || '');
}

export function isVideoFileItem(item: PhoneFileItem): boolean {
  if (item.isDirectory) return false;
  if (item.category === 'videos') return true;
  if (item.mimeType?.toLowerCase().startsWith('video/')) return true;
  return /\.(mp4|mkv|mov|webm|3gp|avi|m4v)$/i.test(item.name || '');
}

export function isAudioFileItem(item: PhoneFileItem): boolean {
  if (item.isDirectory) return false;
  if (item.category === 'audio') return true;
  if (item.mimeType?.toLowerCase().startsWith('audio/')) return true;
  return /\.(mp3|wav|m4a|flac|aac|ogg|opus|wma|amr)$/i.test(item.name || '');
}

export function isPdfFileItem(item: PhoneFileItem): boolean {
  if (item.isDirectory) return false;
  if (item.mimeType?.toLowerCase() === 'application/pdf') return true;
  return /\.pdf$/i.test(item.name || '');
}

export function getFileExtensionBadge(name: string): string {
  const idx = (name || '').lastIndexOf('.');
  if (idx < 0 || idx === name.length - 1) return 'FILE';
  return name.slice(idx + 1, idx + 5).toUpperCase();
}

export function formatVideoDurationShort(durationMs?: number): string {
  if (!durationMs || durationMs <= 0) return '';
  const totalSec = Math.floor(durationMs / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

interface MediaThumbnailProps {
  item: PhoneFileItem;
  className?: string;
  iconSizeClass?: string;
}

export const MediaThumbnail: React.FC<MediaThumbnailProps> = ({
  item,
  className = 'w-full h-full object-cover',
  iconSizeClass = 'w-6 h-6',
}) => {
  const isVideo = isVideoFileItem(item);
  const kind = isVideo ? 'videos' : 'images';
  const cacheKey = `${kind}:${item.uri || item.id}`;

  const boxRef = useRef<HTMLDivElement | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string>(() => {
    const c = fileThumbCache.get(cacheKey);
    return c && c !== EMPTY_SENTINEL ? c : '';
  });
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    setHasFailed(false);
    const cached = fileThumbCache.get(cacheKey);
    if (cached) {
      setThumbUrl(cached === EMPTY_SENTINEL ? '' : cached);
      return;
    }
    setThumbUrl('');

    const node = boxRef.current;
    if (!node) return;

    let cancelled = false;
    const load = async () => {
      const url = await withThumbSlot(async () => {
        if (cancelled) return '';
        if (!isNativeAndroid()) {
          const entry = getWebStoredEntry(item.id);
          if (!entry) return '';
          if (isVideo) {
            return await extractWebVideoFrame(entry.file);
          }
          return URL.createObjectURL(entry.file);
        }
        try {
          if (isVideo) {
            const res = await AudioLibrary.getVideoThumbnail({
              id: item.id || item.uri,
              uri: item.uri,
            });
            return res.filePath ? resolvePlayableAudioUrl(res) : res.localUrl || '';
          }
          const res = await AudioLibrary.getImageThumbnail({
            id: item.id || item.uri,
            uri: item.uri,
          });
          return res.filePath ? resolvePlayableAudioUrl(res) : res.localUrl || '';
        } catch {
          return '';
        }
      });

      if (!cancelled) {
        fileThumbCache.set(cacheKey, url || EMPTY_SENTINEL);
        if (url) setThumbUrl(url);
      }
    };

    if (typeof IntersectionObserver === 'undefined') {
      void load();
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: '260px' }
    );
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [cacheKey, isVideo, item.id, item.uri]);

  return (
    <div
      ref={boxRef}
      className="w-full h-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 overflow-hidden"
    >
      {thumbUrl && !hasFailed ? (
        <img
          src={thumbUrl}
          alt={item.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setHasFailed(true)}
          className={className}
        />
      ) : isVideo ? (
        <Film className={`${iconSizeClass} text-cyan-600/80 dark:text-cyan-400/80`} />
      ) : (
        <ImageIcon className={`${iconSizeClass} text-emerald-600/80 dark:text-emerald-400/80`} />
      )}
    </div>
  );
};

export const AudioCoverThumbnail: React.FC<{
  item: PhoneFileItem;
  className?: string;
}> = ({ item, className = 'w-11 h-11 rounded-xl' }) => {
  const cacheKey = `audio_art:${item.uri || item.id}`;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [artUrl, setArtUrl] = useState<string>(() => {
    const c = fileThumbCache.get(cacheKey);
    return c && c !== EMPTY_SENTINEL ? c : '';
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    const cached = fileThumbCache.get(cacheKey);
    if (cached) {
      setArtUrl(cached === EMPTY_SENTINEL ? '' : cached);
      return;
    }
    setArtUrl('');

    if (!isNativeAndroid()) return;
    const node = boxRef.current;
    if (!node) return;

    let cancelled = false;
    const load = async () => {
      const url = await withThumbSlot(async () => {
        if (cancelled) return '';
        try {
          const res = await AudioLibrary.getAudioThumbnail({
            id: item.id || item.uri,
            uri: item.uri,
            title: item.name,
          });
          if (!res.hasEmbeddedArt) return '';
          return res.filePath ? resolvePlayableAudioUrl(res) : res.localUrl || '';
        } catch {
          return '';
        }
      });

      if (!cancelled) {
        fileThumbCache.set(cacheKey, url || EMPTY_SENTINEL);
        if (url) setArtUrl(url);
      }
    };

    if (typeof IntersectionObserver === 'undefined') {
      void load();
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: '220px' }
    );
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [cacheKey, item.id, item.name, item.uri]);

  if (artUrl && !failed) {
    return (
      <div
        ref={boxRef}
        className={`${className} overflow-hidden shrink-0 border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800`}
      >
        <img
          src={artUrl}
          alt={item.name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      className={`${className} shrink-0 bg-sky-500 flex items-center justify-center shadow-xs`}
    >
      <Music className="w-5 h-5 text-white" />
    </div>
  );
};

export const PdfThumbnail: React.FC<{
  item: PhoneFileItem;
  className?: string;
}> = ({ item, className = 'w-11 h-11 rounded-xl' }) => {
  const cacheKey = `pdf:${item.uri || item.id}`;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string>(() => {
    const c = fileThumbCache.get(cacheKey);
    return c && c !== EMPTY_SENTINEL ? c : '';
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    const cached = fileThumbCache.get(cacheKey);
    if (cached) {
      setPdfUrl(cached === EMPTY_SENTINEL ? '' : cached);
      return;
    }
    setPdfUrl('');

    if (!isNativeAndroid()) return;
    const node = boxRef.current;
    if (!node) return;

    let cancelled = false;
    const load = async () => {
      const url = await withThumbSlot(async () => {
        if (cancelled) return '';
        try {
          const res = await PhoneManager.getPdfThumbnail({
            id: item.id || item.uri,
            uri: item.uri,
          });
          return res.filePath ? resolvePlayableAudioUrl(res) : res.localUrl || '';
        } catch {
          return '';
        }
      });

      if (!cancelled) {
        fileThumbCache.set(cacheKey, url || EMPTY_SENTINEL);
        if (url) setPdfUrl(url);
      }
    };

    if (typeof IntersectionObserver === 'undefined') {
      void load();
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: '220px' }
    );
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [cacheKey, item.id, item.uri]);

  if (pdfUrl && !failed) {
    return (
      <div
        ref={boxRef}
        className={`${className} overflow-hidden shrink-0 bg-white border border-slate-200 dark:border-slate-700`}
      >
        <img
          src={pdfUrl}
          alt={item.name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover object-top"
        />
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      className={`${className} shrink-0 bg-rose-500/12 border border-rose-500/25 flex items-center justify-center`}
    >
      <span className="text-[10px] font-extrabold tracking-tight text-rose-600 dark:text-rose-400">
        PDF
      </span>
    </div>
  );
};

export const DocumentBadgeTile: React.FC<{
  item: PhoneFileItem;
  className?: string;
}> = ({ item, className = 'w-11 h-11 rounded-xl' }) => {
  if (item.isDirectory) {
    return (
      <div className={`${className} bg-amber-500/15 flex items-center justify-center shrink-0`}>
        <Folder className="w-5 h-5 text-amber-500" />
      </div>
    );
  }

  const ext = getFileExtensionBadge(item.name);
  if (ext === 'TXT' || ext === 'DOC' || ext === 'DOCX' || ext === 'XLS' || ext === 'XLSX' || ext === 'PPT' || ext === 'PPTX' || ext === 'CSV' || ext === 'ZIP' || ext === 'APK' || ext === 'EPUB' || ext === 'RTF') {
    const toneClass =
      ext === 'DOC' || ext === 'DOCX'
        ? 'bg-blue-500/12 text-blue-700 dark:text-blue-300 border-blue-500/20'
        : ext === 'XLS' || ext === 'XLSX' || ext === 'CSV'
        ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/20'
        : ext === 'PPT' || ext === 'PPTX'
        ? 'bg-orange-500/12 text-orange-700 dark:text-orange-300 border-orange-500/20'
        : ext === 'ZIP' || ext === 'APK'
        ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/20'
        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700';

    return (
      <div className={`${className} shrink-0 border flex items-center justify-center ${toneClass}`}>
        <span className="text-[10px] font-extrabold tracking-tight">{ext}</span>
      </div>
    );
  }

  return (
    <div className={`${className} bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0`}>
      <FileText className="w-4 h-4 text-slate-400" />
    </div>
  );
};
