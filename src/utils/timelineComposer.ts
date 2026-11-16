export interface TimelineComposeClip {
  mediaType: 'video' | 'image';
  sourceUrl: string;
  sourceStart: number;
  sourceEnd: number;
}

export type TextFontKey = 'sans' | 'serif' | 'mono' | 'display' | 'handwriting' | 'condensed';
export type TextEffectStyle = 'clean' | 'outline' | 'shadow' | 'glow' | 'uppercase';
export type TextAnimationType =
  | 'none'
  | 'fade'
  | 'pop'
  | 'slide-up'
  | 'slide-left'
  | 'bounce'
  | 'typewriter'
  | 'pulse';

export interface TimelineTextOverlay {
  id: string;
  text: string;
  x: number; // 0..1 normalized horizontal center
  y: number; // 0..1 normalized vertical center
  color: string;
  bgStyle: 'none' | 'solid' | 'dark';
  bgColor?: string;
  fontFamily?: TextFontKey;
  textStyle?: TextEffectStyle;
  animation?: TextAnimationType;
  fontSize: number; // reference px at 360px short side
  startTime: number;
  endTime: number;
}

export interface TextAnimationFrameState {
  opacity: number;
  scale: number;
  offsetX: number; // logical px at 360px short side
  offsetY: number; // logical px at 360px short side
  visibleChars: number;
}

export function computeTextAnimationState(
  animation: TextAnimationType | undefined,
  elapsedSec: number,
  totalChars: number
): TextAnimationFrameState {
  const t = Math.max(0, elapsedSec);
  switch (animation) {
    case 'fade': {
      const p = Math.min(1, t / 0.55);
      const eased = 1 - Math.pow(1 - p, 2);
      return { opacity: eased, scale: 1, offsetX: 0, offsetY: 0, visibleChars: totalChars };
    }
    case 'pop': {
      const p = Math.min(1, t / 0.45);
      const scale =
        p < 0.7
          ? 0.35 + (p / 0.7) * 0.75
          : 1.1 - ((p - 0.7) / 0.3) * 0.1;
      return {
        opacity: Math.min(1, p * 2.2),
        scale: p >= 1 ? 1 : scale,
        offsetX: 0,
        offsetY: 0,
        visibleChars: totalChars,
      };
    }
    case 'slide-up': {
      const p = Math.min(1, t / 0.5);
      const eased = 1 - Math.pow(1 - p, 3);
      return {
        opacity: eased,
        scale: 1,
        offsetX: 0,
        offsetY: (1 - eased) * 28,
        visibleChars: totalChars,
      };
    }
    case 'slide-left': {
      const p = Math.min(1, t / 0.5);
      const eased = 1 - Math.pow(1 - p, 3);
      return {
        opacity: eased,
        scale: 1,
        offsetX: (1 - eased) * 42,
        offsetY: 0,
        visibleChars: totalChars,
      };
    }
    case 'bounce': {
      const p = Math.min(1, t / 0.65);
      let bounceFactor = 1;
      if (p < 1) {
        const damped = Math.exp(-5 * p) * Math.cos(p * Math.PI * 3.5);
        bounceFactor = 1 - damped;
      }
      return {
        opacity: Math.min(1, p * 3),
        scale: Math.max(0.5, 0.72 + 0.28 * bounceFactor),
        offsetX: 0,
        offsetY: (1 - bounceFactor) * -22,
        visibleChars: totalChars,
      };
    }
    case 'typewriter': {
      const revealDur = Math.max(0.45, Math.min(1.6, totalChars * 0.06));
      const p = Math.min(1, t / revealDur);
      const count = totalChars <= 0 ? 0 : Math.max(1, Math.round(p * totalChars));
      return {
        opacity: 1,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        visibleChars: Math.min(totalChars, count),
      };
    }
    case 'pulse': {
      const pulse = 1 + 0.06 * Math.sin(t * Math.PI * 2.2);
      return {
        opacity: 1,
        scale: pulse,
        offsetX: 0,
        offsetY: 0,
        visibleChars: totalChars,
      };
    }
    case 'none':
    default:
      return { opacity: 1, scale: 1, offsetX: 0, offsetY: 0, visibleChars: totalChars };
  }
}

export function resolveOverlayFontCss(font?: TextFontKey): string {
  switch (font) {
    case 'serif':
      return 'Georgia, "Times New Roman", serif';
    case 'mono':
      return '"Courier New", ui-monospace, SFMono-Regular, monospace';
    case 'display':
      return 'Impact, "Arial Black", "Segoe UI", sans-serif';
    case 'handwriting':
      return '"Brush Script MT", "Comic Sans MS", cursive, sans-serif';
    case 'condensed':
      return '"Trebuchet MS", "Arial Narrow", sans-serif';
    case 'sans':
    default:
      return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  }
}

export interface TimelineAudioComposeClip {
  sourceUrl: string;
  sourceStart: number;
  sourceEnd: number;
}

export interface VideoCropRect {
  left: number; // 0..1 normalized
  top: number; // 0..1 normalized
  right: number; // 0..1 normalized
  bottom: number; // 0..1 normalized
}

export interface TimelineOverlayComposeClip {
  id: string;
  mediaType: 'video' | 'image';
  sourceUrl: string;
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
  x: number; // 0..1 normalized horizontal center
  y: number; // 0..1 normalized vertical center
  scale: number; // 0.15..1.85 normalized width fraction of stage
  rotation?: number; // degrees clockwise
  muted?: boolean;
}

export interface ComposeTimelineOptions {
  baseTitle: string;
  videoMuted: boolean;
  customAudioUrl?: string | null;
  customAudioClips?: TimelineAudioComposeClip[];
  textOverlays?: TimelineTextOverlay[];
  overlayClips?: TimelineOverlayComposeClip[];
  mainVideoCrop?: VideoCropRect;
  onProgress?: (percent: number) => void;
}

export interface ComposedVideoResult {
  blob: Blob;
  fileName: string;
  mimeType: string;
  durationMs: number;
  resolution: string;
}

function sanitizeBaseName(name: string): string {
  const clean = name
    .replace(/\.[^/.]+$/, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  return clean || 'BeatPulse_Video';
}

function pickSupportedRecorderFormat(): {
  recorderMime: string;
  baseMime: string;
  extension: string;
} {
  const candidates = [
    { recorderMime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', baseMime: 'video/mp4', extension: 'mp4' },
    { recorderMime: 'video/mp4;codecs=avc1,mp4a.40.2', baseMime: 'video/mp4', extension: 'mp4' },
    { recorderMime: 'video/mp4', baseMime: 'video/mp4', extension: 'mp4' },
    { recorderMime: 'video/webm;codecs=vp9,opus', baseMime: 'video/webm', extension: 'webm' },
    { recorderMime: 'video/webm;codecs=vp8,opus', baseMime: 'video/webm', extension: 'webm' },
    { recorderMime: 'video/webm', baseMime: 'video/webm', extension: 'webm' },
  ];

  if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c.recorderMime)) {
        return c;
      }
    }
  }

  return { recorderMime: '', baseMime: 'video/webm', extension: 'webm' };
}

function makeEvenDimension(val: number, fallback: number): number {
  const safe = Number.isFinite(val) && val > 0 ? Math.round(val) : fallback;
  const clamped = Math.max(2, safe);
  return clamped % 2 === 0 ? clamped : clamped - 1;
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image clip for export.'));
    img.src = url;
  });
}

function loadVideoMetadata(url: string): Promise<{ video: HTMLVideoElement; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    const timer = window.setTimeout(() => {
      video.removeAttribute('src');
      video.load();
      reject(new Error('Timed out loading video clip for export.'));
    }, 10000);

    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      resolve({
        video,
        width: video.videoWidth || 1280,
        height: video.videoHeight || 720,
      });
    };

    video.onerror = () => {
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      reject(new Error('Could not decode one of the selected video clips.'));
    };

    video.src = url;
  });
}

function normalizeCropRect(crop?: VideoCropRect): VideoCropRect {
  if (!crop) return { left: 0, top: 0, right: 1, bottom: 1 };
  const left = Math.max(0, Math.min(0.85, crop.left));
  const top = Math.max(0, Math.min(0.85, crop.top));
  const right = Math.max(left + 0.1, Math.min(1, crop.right));
  const bottom = Math.max(top + 0.1, Math.min(1, crop.bottom));
  return { left, top, right, bottom };
}

function drawContainedFrame(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  crop?: VideoCropRect
): void {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  if (srcWidth <= 0 || srcHeight <= 0) return;

  const c = normalizeCropRect(crop);
  const sx = c.left * srcWidth;
  const sy = c.top * srcHeight;
  const sw = Math.max(2, (c.right - c.left) * srcWidth);
  const sh = Math.max(2, (c.bottom - c.top) * srcHeight);

  const scale = Math.min(canvasWidth / sw, canvasHeight / sh);
  const drawW = sw * scale;
  const drawH = sh * scale;
  const dx = (canvasWidth - drawW) / 2;
  const dy = (canvasHeight - drawH) / 2;
  ctx.drawImage(source, sx, sy, sw, sh, dx, dy, drawW, drawH);
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawTextOverlays(
  ctx: CanvasRenderingContext2D,
  overlays: TimelineTextOverlay[] | undefined,
  timelineSec: number,
  canvasWidth: number,
  canvasHeight: number
): void {
  if (!overlays || overlays.length === 0) return;
  const shortSide = Math.min(canvasWidth, canvasHeight);

  for (const ov of overlays) {
    const rawBase = ov.textStyle === 'uppercase' ? ov.text.toUpperCase() : ov.text;
    if (!rawBase.trim()) continue;
    if (timelineSec < ov.startTime - 0.01 || timelineSec > ov.endTime + 0.01) continue;

    const anim = computeTextAnimationState(
      ov.animation,
      Math.max(0, timelineSec - ov.startTime),
      rawBase.length
    );
    if (anim.opacity <= 0.01) continue;
    const rawContent =
      ov.animation === 'typewriter' ? rawBase.slice(0, anim.visibleChars) : rawBase;
    if (!rawContent) continue;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, anim.opacity));
    const scaledFontPx = Math.max(18, Math.round(ov.fontSize * (shortSide / 360)));
    const fontWeight = ov.fontFamily === 'display' ? '900' : '700';
    ctx.font = `${fontWeight} ${scaledFontPx}px ${resolveOverlayFontCss(ov.fontFamily)}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const maxLineW = canvasWidth * 0.84;
    const rawLines = rawContent.split(/\r?\n/);
    const lines: string[] = [];
    for (const raw of rawLines) {
      const words = raw.split(' ');
      let current = '';
      for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (ctx.measureText(test).width > maxLineW && current) {
          lines.push(current);
          current = word;
        } else {
          current = test;
        }
      }
      lines.push(current);
    }

    const lineHeight = Math.round(scaledFontPx * 1.24);
    const totalH = lines.length * lineHeight;
    const maxActualW = Math.max(...lines.map((l) => ctx.measureText(l).width), scaledFontPx);
    const centerX = Math.max(0.08, Math.min(0.92, ov.x)) * canvasWidth;
    const centerY = Math.max(0.08, Math.min(0.92, ov.y)) * canvasHeight;

    const anchorX = centerX + anim.offsetX * (shortSide / 360);
    const anchorY = centerY + anim.offsetY * (shortSide / 360);
    ctx.translate(anchorX, anchorY);
    if (anim.scale !== 1) {
      ctx.scale(anim.scale, anim.scale);
    }
    ctx.translate(-centerX, -centerY);

    const hasBg = ov.bgStyle !== 'none';
    const boxFill = hasBg
      ? ov.bgColor || (ov.bgStyle === 'solid' ? '#ffffff' : 'rgba(15, 23, 42, 0.82)')
      : '';

    if (hasBg && boxFill) {
      const padX = Math.round(scaledFontPx * 0.55);
      const padY = Math.round(scaledFontPx * 0.3);
      const boxW = maxActualW + padX * 2;
      const boxH = totalH + padY * 2;
      drawRoundRect(
        ctx,
        centerX - boxW / 2,
        centerY - boxH / 2,
        boxW,
        boxH,
        Math.round(scaledFontPx * 0.36)
      );
      ctx.fillStyle = boxFill;
      ctx.fill();
    }

    const textColor =
      hasBg && boxFill.toLowerCase() === '#ffffff' && ov.color.toLowerCase() === '#ffffff'
        ? '#0f172a'
        : ov.color;
    const effect = ov.textStyle || 'clean';

    for (let i = 0; i < lines.length; i++) {
      const ly = centerY - totalH / 2 + lineHeight * (i + 0.5);
      ctx.save();
      if (effect === 'outline') {
        ctx.lineWidth = Math.max(3, Math.round(scaledFontPx * 0.14));
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.92)';
        ctx.lineJoin = 'round';
        ctx.strokeText(lines[i], centerX, ly);
      } else if (effect === 'glow') {
        ctx.shadowColor = textColor;
        ctx.shadowBlur = Math.max(10, Math.round(scaledFontPx * 0.45));
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      } else if (effect === 'shadow') {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.88)';
        ctx.shadowBlur = Math.max(6, Math.round(scaledFontPx * 0.28));
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 3;
      } else if (!hasBg) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.68)';
        ctx.shadowBlur = Math.max(4, Math.round(scaledFontPx * 0.18));
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;
      }
      ctx.fillStyle = textColor;
      ctx.fillText(lines[i], centerX, ly);
      if (effect === 'glow') {
        ctx.fillText(lines[i], centerX, ly);
      }
      ctx.restore();
    }

    ctx.restore();
  }
}

function drawMediaOverlays(
  ctx: CanvasRenderingContext2D,
  overlayClips: TimelineOverlayComposeClip[],
  preloadedImages: Map<string, HTMLImageElement>,
  preparedVideos: Map<string, { video: HTMLVideoElement; vw: number; vh: number }>,
  timelineSec: number,
  canvasWidth: number,
  canvasHeight: number
): void {
  if (!overlayClips || overlayClips.length === 0) return;

  for (const ov of overlayClips) {
    const dur = Math.max(0.1, ov.sourceEnd - ov.sourceStart);
    const ovEnd = ov.timelineStart + dur;
    if (timelineSec < ov.timelineStart - 0.015 || timelineSec > ovEnd + 0.015) continue;

    let src: CanvasImageSource | null = null;
    let srcW = 0;
    let srcH = 0;

    if (ov.mediaType === 'image') {
      const img = preloadedImages.get(ov.sourceUrl);
      if (!img) continue;
      src = img;
      srcW = img.naturalWidth || canvasWidth;
      srcH = img.naturalHeight || canvasHeight;
    } else {
      const prep = preparedVideos.get(ov.id);
      if (!prep || prep.video.readyState < 2) continue;
      src = prep.video;
      srcW = prep.vw || prep.video.videoWidth || canvasWidth;
      srcH = prep.vh || prep.video.videoHeight || canvasHeight;
    }

    if (!src || srcW <= 0 || srcH <= 0) continue;

    const targetWidthFrac = Math.max(0.15, Math.min(1.85, ov.scale || 0.42));
    const drawW = canvasWidth * targetWidthFrac;
    const drawH = drawW * (srcH / srcW);

    const cx = Math.max(0.02, Math.min(0.98, ov.x)) * canvasWidth;
    const cy = Math.max(0.02, Math.min(0.98, ov.y)) * canvasHeight;
    const rotRad = (((ov.rotation || 0) % 360) * Math.PI) / 180;
    const cornerRadius = Math.max(8, Math.round(Math.min(drawW, drawH) * 0.05));

    ctx.save();
    ctx.translate(cx, cy);
    if (rotRad !== 0) {
      ctx.rotate(rotRad);
    }
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = Math.max(8, Math.round(canvasWidth * 0.02));
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;
    drawRoundRect(ctx, -drawW / 2, -drawH / 2, drawW, drawH, cornerRadius);
    ctx.fillStyle = '#000000';
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    if (rotRad !== 0) {
      ctx.rotate(rotRad);
    }
    drawRoundRect(ctx, -drawW / 2, -drawH / 2, drawW, drawH, cornerRadius);
    ctx.clip();
    ctx.drawImage(src, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }
}

/**
 * Renders a multi-clip timeline (videos + images + optional muted original / replacement audio + media overlays + text overlays)
 * using an offscreen Canvas + WebAudio MediaStream + MediaRecorder.
 */
export async function composeSplitTimelineBlob(
  clips: TimelineComposeClip[],
  options: ComposeTimelineOptions
): Promise<ComposedVideoResult> {
  const activeClips = clips.filter((c) => c.sourceEnd - c.sourceStart > 0.05);
  if (activeClips.length === 0) {
    throw new Error('Keep at least one clip before saving.');
  }

  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Video composition is not supported on this device.');
  }

  const totalDurationSec = activeClips.reduce(
    (sum, c) => sum + Math.max(0.1, c.sourceEnd - c.sourceStart),
    0
  );

  // Determine output resolution from the first video (or first image) clamped to <= 1280px
  let baseW = 720;
  let baseH = 1280;
  const firstVideoClip = activeClips.find((c) => c.mediaType === 'video');
  if (firstVideoClip) {
    const meta = await loadVideoMetadata(firstVideoClip.sourceUrl);
    baseW = meta.width;
    baseH = meta.height;
    meta.video.removeAttribute('src');
    meta.video.load();
  } else {
    const firstImg = await loadHtmlImage(activeClips[0].sourceUrl);
    baseW = firstImg.naturalWidth || 720;
    baseH = firstImg.naturalHeight || 1280;
  }

  const cropRect = normalizeCropRect(options.mainVideoCrop);
  const croppedBaseW = baseW * (cropRect.right - cropRect.left);
  const croppedBaseH = baseH * (cropRect.bottom - cropRect.top);
  const maxSide = 1280;
  const downScale = Math.min(1, maxSide / Math.max(croppedBaseW, croppedBaseH));
  const canvasWidth = makeEvenDimension(croppedBaseW * downScale, 720);
  const canvasHeight = makeEvenDimension(croppedBaseH * downScale, 1280);

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize video canvas.');
  }
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  const audioDest = audioCtx.createMediaStreamDestination();

  type DecodedAudioSlice = {
    buffer: AudioBuffer;
    sourceStart: number;
    sourceEnd: number;
    globalStart: number;
    globalEnd: number;
  };

  const audioSlices: DecodedAudioSlice[] = [];
  let customAudioBuffer: AudioBuffer | null = null;

  if (options.customAudioClips && options.customAudioClips.length > 0) {
    const activeAudioClips = options.customAudioClips.filter(
      (c) => c.sourceEnd - c.sourceStart > 0.05
    );
    const decodedAudioByUrl = new Map<string, AudioBuffer>();
    for (const ac of activeAudioClips) {
      if (!decodedAudioByUrl.has(ac.sourceUrl)) {
        const resp = await fetch(ac.sourceUrl);
        if (!resp.ok) {
          await audioCtx.close();
          throw new Error('Could not read the added audio track.');
        }
        const arrayBuf = await resp.arrayBuffer();
        const decoded = await audioCtx.decodeAudioData(arrayBuf);
        decodedAudioByUrl.set(ac.sourceUrl, decoded);
      }
    }
    let audioCursor = 0;
    for (const ac of activeAudioClips) {
      const buf = decodedAudioByUrl.get(ac.sourceUrl);
      if (!buf || buf.duration <= 0) continue;
      const clampedStart = Math.max(0, Math.min(buf.duration - 0.05, ac.sourceStart));
      const clampedEnd = Math.max(clampedStart + 0.05, Math.min(buf.duration, ac.sourceEnd));
      const sliceLen = clampedEnd - clampedStart;
      audioSlices.push({
        buffer: buf,
        sourceStart: clampedStart,
        sourceEnd: clampedEnd,
        globalStart: audioCursor,
        globalEnd: audioCursor + sliceLen,
      });
      audioCursor += sliceLen;
    }
  } else if (options.customAudioUrl) {
    const resp = await fetch(options.customAudioUrl);
    if (!resp.ok) {
      await audioCtx.close();
      throw new Error('Could not read the added audio track.');
    }
    const arrayBuf = await resp.arrayBuffer();
    customAudioBuffer = await audioCtx.decodeAudioData(arrayBuf);
  }

  const activeOverlays = (options.overlayClips || []).filter(
    (ov) => ov.sourceEnd - ov.sourceStart > 0.05
  );
  const hasUnmutedVideoOverlay = activeOverlays.some(
    (ov) => ov.mediaType === 'video' && !ov.muted
  );

  const canvasStream = canvas.captureStream(30);
  const combinedTracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
  const hasAnyAudio =
    !options.videoMuted ||
    audioSlices.length > 0 ||
    Boolean(customAudioBuffer) ||
    hasUnmutedVideoOverlay;
  if (hasAnyAudio) {
    combinedTracks.push(...audioDest.stream.getAudioTracks());
  }
  const combinedStream = new MediaStream(combinedTracks);

  const format = pickSupportedRecorderFormat();
  const recorderOptions: MediaRecorderOptions = {
    videoBitsPerSecond: 4_500_000,
    ...(hasAnyAudio ? { audioBitsPerSecond: 192_000 } : {}),
    ...(format.recorderMime ? { mimeType: format.recorderMime } : {}),
  };
  const recorder = new MediaRecorder(combinedStream, recorderOptions);
  const recordedChunks: Blob[] = [];

  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) {
      recordedChunks.push(ev.data);
    }
  };

  const stopPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      const resolvedMime = (recorder.mimeType || format.baseMime).split(';')[0].trim() || format.baseMime;
      resolve(new Blob(recordedChunks, { type: resolvedMime }));
    };
    recorder.onerror = () => {
      reject(new Error('MediaRecorder failed while saving video.'));
    };
  });

  // Preload images for instant zero-gap rendering (both main timeline & overlays)
  const preloadedImages = new Map<string, HTMLImageElement>();
  for (const c of activeClips) {
    if (c.mediaType === 'image' && !preloadedImages.has(c.sourceUrl)) {
      preloadedImages.set(c.sourceUrl, await loadHtmlImage(c.sourceUrl));
    }
  }
  for (const ov of activeOverlays) {
    if (ov.mediaType === 'image' && !preloadedImages.has(ov.sourceUrl)) {
      preloadedImages.set(ov.sourceUrl, await loadHtmlImage(ov.sourceUrl));
    }
  }

  // Prepare PiP overlay video elements & optional audio routing
  const preparedOverlayVideos = new Map<
    string,
    { video: HTMLVideoElement; vw: number; vh: number; mediaSrcNode: MediaElementAudioSourceNode | null }
  >();
  for (const ov of activeOverlays) {
    if (ov.mediaType !== 'video') continue;
    const { video: ovVideo, width: vw, height: vh } = await loadVideoMetadata(ov.sourceUrl);
    ovVideo.muted = Boolean(ov.muted);
    ovVideo.volume = 1;
    let ovSrcNode: MediaElementAudioSourceNode | null = null;
    if (!ov.muted) {
      try {
        ovSrcNode = audioCtx.createMediaElementSource(ovVideo);
        ovSrcNode.connect(audioDest);
      } catch {
        // Overlay video might have no audio track
      }
    }
    if (ov.sourceStart > 0.02) {
      await new Promise<void>((resolve) => {
        const seekTimeout = window.setTimeout(resolve, 1200);
        ovVideo.onseeked = () => {
          window.clearTimeout(seekTimeout);
          resolve();
        };
        ovVideo.currentTime = ov.sourceStart;
      });
    }
    preparedOverlayVideos.set(ov.id, { video: ovVideo, vw, vh, mediaSrcNode: ovSrcNode });
  }

  const overlayLastSeekMs = new Map<string, number>();

  const syncOverlayVideosAtTime = (curTotalSec: number) => {
    const nowMs = performance.now();
    for (const ov of activeOverlays) {
      if (ov.mediaType !== 'video') continue;
      const entry = preparedOverlayVideos.get(ov.id);
      if (!entry) continue;
      const ovDur = Math.max(0.1, ov.sourceEnd - ov.sourceStart);
      const ovEnd = ov.timelineStart + ovDur;
      const isVisible = curTotalSec >= ov.timelineStart - 0.02 && curTotalSec <= ovEnd - 0.01;
      const el = entry.video;
      if (isVisible) {
        const targetTime = Math.max(
          ov.sourceStart,
          Math.min(ov.sourceEnd, ov.sourceStart + Math.max(0, curTotalSec - ov.timelineStart))
        );
        const lastSeekMs = overlayLastSeekMs.get(ov.id) || 0;
        const nearEnd = ov.sourceEnd - targetTime <= 0.15;
        if (
          !el.seeking &&
          !nearEnd &&
          Math.abs(el.currentTime - targetTime) > 0.65 &&
          nowMs - lastSeekMs >= 900
        ) {
          overlayLastSeekMs.set(ov.id, nowMs);
          el.currentTime = targetTime;
        }
        if (el.paused && !el.ended && !el.seeking && el.readyState >= 2 && targetTime < ov.sourceEnd - 0.04) {
          void el.play().catch((err: unknown) => {
            if ((err as { name?: string })?.name === 'NotAllowedError') {
              el.muted = true;
              void el.play().catch(() => {});
            }
          });
        }
      } else if (!el.paused) {
        el.pause();
      }
    }
  };

  type PreparedExportVideo = {
    video: HTMLVideoElement;
    vw: number;
    vh: number;
    mediaSrcNode: MediaElementAudioSourceNode | null;
  };

  const prepareVideoForExport = async (clip: TimelineComposeClip): Promise<PreparedExportVideo> => {
    const { video: tempVideo, width: vw, height: vh } = await loadVideoMetadata(clip.sourceUrl);
    tempVideo.muted = options.videoMuted;
    tempVideo.volume = 1;

    let mediaSrcNode: MediaElementAudioSourceNode | null = null;
    if (!options.videoMuted) {
      try {
        mediaSrcNode = audioCtx.createMediaElementSource(tempVideo);
        mediaSrcNode.connect(audioDest);
      } catch {
        // Video might not have an audio track
      }
    }

    if (clip.sourceStart > 0.02) {
      await new Promise<void>((resolve) => {
        const seekTimeout = window.setTimeout(resolve, 1500);
        tempVideo.onseeked = () => {
          window.clearTimeout(seekTimeout);
          resolve();
        };
        tempVideo.currentTime = clip.sourceStart;
      });
    }

    return { video: tempVideo, vw, vh, mediaSrcNode };
  };

  let pendingVideoPromise: Promise<PreparedExportVideo> | null =
    activeClips[0]?.mediaType === 'video' ? prepareVideoForExport(activeClips[0]) : null;

  if (pendingVideoPromise) {
    await pendingVideoPromise;
  }

  recorder.start(250);
  options.onProgress?.(2);

  let completedTimelineSec = 0;

  const startCustomAudioSlices = (
    clipGlobalStartSec: number,
    clipDurationSec: number
  ): AudioBufferSourceNode[] => {
    const nodes: AudioBufferSourceNode[] = [];
    if (audioSlices.length > 0) {
      const clipGlobalEnd = clipGlobalStartSec + clipDurationSec;
      for (const slice of audioSlices) {
        if (slice.globalEnd <= clipGlobalStartSec + 0.005 || slice.globalStart >= clipGlobalEnd - 0.005) {
          continue;
        }
        const overlapStart = Math.max(clipGlobalStartSec, slice.globalStart);
        const overlapEnd = Math.min(clipGlobalEnd, slice.globalEnd);
        const playDur = overlapEnd - overlapStart;
        if (playDur <= 0.01) continue;

        const delaySec = Math.max(0, overlapStart - clipGlobalStartSec);
        const offsetSec = Math.max(
          0,
          Math.min(slice.buffer.duration - 0.01, slice.sourceStart + (overlapStart - slice.globalStart))
        );
        const boundedDur = Math.min(playDur, Math.max(0.01, slice.buffer.duration - offsetSec));

        const src = audioCtx.createBufferSource();
        src.buffer = slice.buffer;
        const gain = audioCtx.createGain();
        gain.gain.value = 1;
        src.connect(gain);
        gain.connect(audioDest);
        src.start(audioCtx.currentTime + delaySec, offsetSec, boundedDur);
        nodes.push(src);
      }
      return nodes;
    }

    if (!customAudioBuffer || customAudioBuffer.duration <= 0) return nodes;
    const src = audioCtx.createBufferSource();
    src.buffer = customAudioBuffer;
    src.loop = true;
    const gain = audioCtx.createGain();
    gain.gain.value = 1;
    src.connect(gain);
    gain.connect(audioDest);
    const wrappedOffset =
      ((clipGlobalStartSec % customAudioBuffer.duration) + customAudioBuffer.duration) %
      customAudioBuffer.duration;
    src.start(0, wrappedOffset);
    nodes.push(src);
    return nodes;
  };

  const stopAudioNodes = (nodes: AudioBufferSourceNode[]) => {
    for (const node of nodes) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        // ignore stop errors
      }
    }
  };

  try {
    for (let idx = 0; idx < activeClips.length; idx++) {
      const clip = activeClips[idx];
      const clipDurationSec = Math.max(0.1, clip.sourceEnd - clip.sourceStart);
      const nextClip = idx + 1 < activeClips.length ? activeClips[idx + 1] : null;

      if (clip.mediaType === 'image') {
        if (!pendingVideoPromise && nextClip?.mediaType === 'video') {
          pendingVideoPromise = prepareVideoForExport(nextClip);
        }
        const img = preloadedImages.get(clip.sourceUrl) || (await loadHtmlImage(clip.sourceUrl));
        const customAudioNodes = startCustomAudioSlices(completedTimelineSec, clipDurationSec);

        await new Promise<void>((resolve) => {
          const startMs = performance.now();
          const targetMs = clipDurationSec * 1000;
          const step = () => {
            const elapsedMs = performance.now() - startMs;
            drawContainedFrame(
              ctx,
              img,
              img.naturalWidth || canvasWidth,
              img.naturalHeight || canvasHeight,
              canvasWidth,
              canvasHeight,
              cropRect
            );
            const curTotalSec = completedTimelineSec + Math.min(clipDurationSec, elapsedMs / 1000);
            syncOverlayVideosAtTime(curTotalSec);
            drawMediaOverlays(
              ctx,
              activeOverlays,
              preloadedImages,
              preparedOverlayVideos,
              curTotalSec,
              canvasWidth,
              canvasHeight
            );
            drawTextOverlays(ctx, options.textOverlays, curTotalSec, canvasWidth, canvasHeight);
            options.onProgress?.(Math.min(98, Math.round((curTotalSec / totalDurationSec) * 96) + 2));

            if (elapsedMs >= targetMs) {
              resolve();
              return;
            }
            window.requestAnimationFrame(step);
          };
          window.requestAnimationFrame(step);
        });

        stopAudioNodes(customAudioNodes);
        completedTimelineSec += clipDurationSec;
      } else {
        const prepared = pendingVideoPromise
          ? await pendingVideoPromise
          : await prepareVideoForExport(clip);
        pendingVideoPromise =
          nextClip?.mediaType === 'video' ? prepareVideoForExport(nextClip) : null;

        const { video: tempVideo, vw, vh, mediaSrcNode } = prepared;

        syncOverlayVideosAtTime(completedTimelineSec);
        drawContainedFrame(ctx, tempVideo, vw, vh, canvasWidth, canvasHeight, cropRect);
        drawMediaOverlays(
          ctx,
          activeOverlays,
          preloadedImages,
          preparedOverlayVideos,
          completedTimelineSec,
          canvasWidth,
          canvasHeight
        );
        drawTextOverlays(ctx, options.textOverlays, completedTimelineSec, canvasWidth, canvasHeight);
        const customAudioNodes = startCustomAudioSlices(completedTimelineSec, clipDurationSec);

        try {
          await tempVideo.play();
        } catch {
          // If audio blocked unmuted autoplay fallback, force mute video element
          tempVideo.muted = true;
          await tempVideo.play();
        }

        await new Promise<void>((resolve) => {
          const startedAt = performance.now();
          const maxSafetyMs = clipDurationSec * 1000 + 3000;
          let finished = false;

          const finishClip = () => {
            if (finished) return;
            finished = true;
            tempVideo.pause();
            resolve();
          };

          const drawStep = () => {
            if (finished) return;
            drawContainedFrame(ctx, tempVideo, vw, vh, canvasWidth, canvasHeight, cropRect);
            const clipElapsed = Math.max(0, tempVideo.currentTime - clip.sourceStart);
            const curTotalSec = completedTimelineSec + Math.min(clipDurationSec, clipElapsed);
            syncOverlayVideosAtTime(curTotalSec);
            drawMediaOverlays(
              ctx,
              activeOverlays,
              preloadedImages,
              preparedOverlayVideos,
              curTotalSec,
              canvasWidth,
              canvasHeight
            );
            drawTextOverlays(ctx, options.textOverlays, curTotalSec, canvasWidth, canvasHeight);
            options.onProgress?.(Math.min(98, Math.round((curTotalSec / totalDurationSec) * 96) + 2));

            if (
              tempVideo.currentTime >= clip.sourceEnd - 0.03 ||
              tempVideo.ended ||
              performance.now() - startedAt >= maxSafetyMs
            ) {
              finishClip();
              return;
            }
            window.requestAnimationFrame(drawStep);
          };

          window.requestAnimationFrame(drawStep);
        });

        stopAudioNodes(customAudioNodes);
        if (mediaSrcNode) {
          try {
            mediaSrcNode.disconnect();
          } catch {
            // ignore
          }
        }
        tempVideo.removeAttribute('src');
        tempVideo.load();
        completedTimelineSec += clipDurationSec;
      }
    }

    await new Promise((r) => window.setTimeout(r, 120));
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }

    const finalBlob = await stopPromise;
    options.onProgress?.(100);

    const resolvedMime = (finalBlob.type || format.baseMime).split(';')[0].trim() || format.baseMime;
    const ext = resolvedMime.includes('webm') ? 'webm' : 'mp4';
    const safeBase = sanitizeBaseName(options.baseTitle);

    return {
      blob: finalBlob,
      fileName: `${safeBase}_edited.${ext}`,
      mimeType: resolvedMime,
      durationMs: Math.round(totalDurationSec * 1000),
      resolution: `${canvasWidth}x${canvasHeight}`,
    };
  } finally {
    for (const entry of preparedOverlayVideos.values()) {
      entry.video.pause();
      if (entry.mediaSrcNode) {
        try {
          entry.mediaSrcNode.disconnect();
        } catch {
          // ignore
        }
      }
      entry.video.removeAttribute('src');
      entry.video.load();
    }
    preparedOverlayVideos.clear();
    for (const track of combinedStream.getTracks()) {
      track.stop();
    }
    if (audioCtx.state !== 'closed') {
      try {
        await audioCtx.close();
      } catch {
        // ignore close errors
      }
    }
  }
}
