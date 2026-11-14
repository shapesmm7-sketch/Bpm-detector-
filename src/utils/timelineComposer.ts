export interface TimelineComposeClip {
  mediaType: 'video' | 'image';
  sourceUrl: string;
  sourceStart: number;
  sourceEnd: number;
}

export interface ComposeTimelineOptions {
  baseTitle: string;
  videoMuted: boolean;
  customAudioUrl?: string | null;
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

function drawContainedFrame(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  canvasWidth: number,
  canvasHeight: number
): void {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  if (srcWidth <= 0 || srcHeight <= 0) return;

  const scale = Math.min(canvasWidth / srcWidth, canvasHeight / srcHeight);
  const drawW = srcWidth * scale;
  const drawH = srcHeight * scale;
  const dx = (canvasWidth - drawW) / 2;
  const dy = (canvasHeight - drawH) / 2;
  ctx.drawImage(source, dx, dy, drawW, drawH);
}

/**
 * Renders a multi-clip timeline (videos + images + optional muted original / replacement audio)
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

  const maxSide = 1280;
  const downScale = Math.min(1, maxSide / Math.max(baseW, baseH));
  const canvasWidth = makeEvenDimension(baseW * downScale, 720);
  const canvasHeight = makeEvenDimension(baseH * downScale, 1280);

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

  let customAudioBuffer: AudioBuffer | null = null;
  if (options.customAudioUrl) {
    const resp = await fetch(options.customAudioUrl);
    if (!resp.ok) {
      await audioCtx.close();
      throw new Error('Could not read the added audio track.');
    }
    const arrayBuf = await resp.arrayBuffer();
    customAudioBuffer = await audioCtx.decodeAudioData(arrayBuf);
  }

  const canvasStream = canvas.captureStream(30);
  const combinedTracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
  const hasAnyAudio = !options.videoMuted || Boolean(customAudioBuffer);
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

  // Preload images for instant zero-gap rendering
  const preloadedImages = new Map<string, HTMLImageElement>();
  for (const c of activeClips) {
    if (c.mediaType === 'image' && !preloadedImages.has(c.sourceUrl)) {
      preloadedImages.set(c.sourceUrl, await loadHtmlImage(c.sourceUrl));
    }
  }

  recorder.start(250);
  options.onProgress?.(2);

  let completedTimelineSec = 0;

  const startCustomAudioSlice = (offsetSec: number): AudioBufferSourceNode | null => {
    if (!customAudioBuffer || customAudioBuffer.duration <= 0) return null;
    const src = audioCtx.createBufferSource();
    src.buffer = customAudioBuffer;
    src.loop = true;
    const gain = audioCtx.createGain();
    gain.gain.value = 1;
    src.connect(gain);
    gain.connect(audioDest);
    const wrappedOffset = ((offsetSec % customAudioBuffer.duration) + customAudioBuffer.duration) % customAudioBuffer.duration;
    src.start(0, wrappedOffset);
    return src;
  };

  try {
    for (let idx = 0; idx < activeClips.length; idx++) {
      const clip = activeClips[idx];
      const clipDurationSec = Math.max(0.1, clip.sourceEnd - clip.sourceStart);

      if (clip.mediaType === 'image') {
        const img = preloadedImages.get(clip.sourceUrl) || (await loadHtmlImage(clip.sourceUrl));
        const customAudioNode = startCustomAudioSlice(completedTimelineSec);

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
              canvasHeight
            );
            const curTotalSec = completedTimelineSec + Math.min(clipDurationSec, elapsedMs / 1000);
            options.onProgress?.(Math.min(98, Math.round((curTotalSec / totalDurationSec) * 96) + 2));

            if (elapsedMs >= targetMs) {
              resolve();
              return;
            }
            window.requestAnimationFrame(step);
          };
          window.requestAnimationFrame(step);
        });

        if (customAudioNode) {
          try {
            customAudioNode.stop();
            customAudioNode.disconnect();
          } catch {
            // ignore stop errors
          }
        }
        completedTimelineSec += clipDurationSec;
      } else {
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

        // Seek cleanly to clip.sourceStart before playing
        await new Promise<void>((resolve) => {
          if (clip.sourceStart <= 0.02) {
            resolve();
            return;
          }
          const seekTimeout = window.setTimeout(resolve, 1500);
          tempVideo.onseeked = () => {
            window.clearTimeout(seekTimeout);
            resolve();
          };
          tempVideo.currentTime = clip.sourceStart;
        });

        drawContainedFrame(ctx, tempVideo, vw, vh, canvasWidth, canvasHeight);
        const customAudioNode = startCustomAudioSlice(completedTimelineSec);

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
            drawContainedFrame(ctx, tempVideo, vw, vh, canvasWidth, canvasHeight);
            const clipElapsed = Math.max(0, tempVideo.currentTime - clip.sourceStart);
            const curTotalSec = completedTimelineSec + Math.min(clipDurationSec, clipElapsed);
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

        if (customAudioNode) {
          try {
            customAudioNode.stop();
            customAudioNode.disconnect();
          } catch {
            // ignore
          }
        }
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
