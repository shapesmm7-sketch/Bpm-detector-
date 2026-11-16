/**
 * Pure TypeScript lossless ISO-BMFF (MP4 / M4V / MOV) video trimmer & splitter.
 * Copies compressed video and audio bitstreams verbatim from source `mdat` boxes
 * without decoding or re-encoding, preserving 100% original video & audio quality.
 */

interface Mp4Box {
  type: string;
  start: number;
  headerSize: number;
  end: number;
}

interface ParsedSample {
  offset: number;
  size: number;
  dts: number;
  pts: number;
  duration: number;
  ctsOffset: number;
  isSync: boolean;
}

interface ParsedTrack {
  rawTrakBytes: Uint8Array;
  handlerType: string; // 'vide' | 'soun' | other
  trackId: number;
  tkhdBytes: Uint8Array;
  mdhdBytes: Uint8Array;
  mdiaNonMinfBoxes: Uint8Array[];
  minfNonStblBoxes: Uint8Array[];
  stsdBox: Uint8Array;
  timescale: number;
  samples: ParsedSample[];
  hasCtts: boolean;
  cttsVersion: number;
  hasStss: boolean;
}

export interface LosslessVideoClip {
  blob: Blob;
  fileName: string;
  durationMs: number;
  actualStartSec: number;
  actualEndSec: number;
  partLabel?: string;
}

function readU32(bytes: Uint8Array, pos: number): number {
  return (
    ((bytes[pos] << 24) |
      (bytes[pos + 1] << 16) |
      (bytes[pos + 2] << 8) |
      bytes[pos + 3]) >>>
    0
  );
}

function readI32(bytes: Uint8Array, pos: number): number {
  return (
    (bytes[pos] << 24) |
    (bytes[pos + 1] << 16) |
    (bytes[pos + 2] << 8) |
    bytes[pos + 3]
  );
}

function readU64(bytes: Uint8Array, pos: number): number {
  const hi = readU32(bytes, pos);
  const lo = readU32(bytes, pos + 4);
  return hi * 4294967296 + lo;
}

function readType(bytes: Uint8Array, pos: number): string {
  return String.fromCharCode(
    bytes[pos],
    bytes[pos + 1],
    bytes[pos + 2],
    bytes[pos + 3]
  );
}

function writeU32(bytes: Uint8Array, pos: number, val: number): void {
  bytes[pos] = (val >>> 24) & 0xff;
  bytes[pos + 1] = (val >>> 16) & 0xff;
  bytes[pos + 2] = (val >>> 8) & 0xff;
  bytes[pos + 3] = val & 0xff;
}

function writeU64(bytes: Uint8Array, pos: number, val: number): void {
  const hi = Math.floor(val / 4294967296);
  const lo = val >>> 0;
  writeU32(bytes, pos, hi);
  writeU32(bytes, pos + 4, lo);
}

function makeBox(type: string, payload: Uint8Array): Uint8Array {
  const total = 8 + payload.length;
  const out = new Uint8Array(total);
  writeU32(out, 0, total);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(payload, 8);
  return out;
}

function makeFullBox(
  type: string,
  version: number,
  flags: number,
  payload: Uint8Array
): Uint8Array {
  const body = new Uint8Array(4 + payload.length);
  body[0] = version & 0xff;
  body[1] = (flags >>> 16) & 0xff;
  body[2] = (flags >>> 8) & 0xff;
  body[3] = flags & 0xff;
  body.set(payload, 4);
  return makeBox(type, body);
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function parseChildBoxes(
  bytes: Uint8Array,
  start: number,
  end: number
): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    const size32 = readU32(bytes, pos);
    const type = readType(bytes, pos + 4);
    let headerSize = 8;
    let boxSize = size32;
    if (size32 === 1) {
      if (pos + 16 > end) break;
      boxSize = readU64(bytes, pos + 8);
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = end - pos;
    }
    if (boxSize < headerSize || pos + boxSize > end) break;
    boxes.push({
      type,
      start: pos,
      headerSize,
      end: pos + boxSize,
    });
    pos += boxSize;
  }
  return boxes;
}

async function scanTopLevelBoxes(
  blob: Blob
): Promise<{
  ftypBytes: Uint8Array | null;
  moovBytes: Uint8Array | null;
  hasMoof: boolean;
}> {
  let pos = 0;
  const total = blob.size;
  let ftypBytes: Uint8Array | null = null;
  let moovBytes: Uint8Array | null = null;
  let hasMoof = false;

  while (pos + 8 <= total) {
    const headerBuf = new Uint8Array(
      await blob.slice(pos, Math.min(pos + 16, total)).arrayBuffer()
    );
    if (headerBuf.length < 8) break;
    const size32 = readU32(headerBuf, 0);
    const type = readType(headerBuf, 4);
    let headerSize = 8;
    let boxSize = size32;
    if (size32 === 1) {
      if (headerBuf.length < 16) break;
      boxSize = readU64(headerBuf, 8);
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = total - pos;
    }
    if (boxSize < headerSize || pos + boxSize > total) break;

    if (type === 'ftyp' && !ftypBytes) {
      ftypBytes = new Uint8Array(
        await blob.slice(pos, pos + boxSize).arrayBuffer()
      );
    } else if (type === 'moov' && !moovBytes) {
      moovBytes = new Uint8Array(
        await blob.slice(pos, pos + boxSize).arrayBuffer()
      );
    } else if (type === 'moof') {
      hasMoof = true;
    }

    pos += boxSize;
  }

  return { ftypBytes, moovBytes, hasMoof };
}

function parseTrackBox(trakBytes: Uint8Array): ParsedTrack | null {
  const trakChildren = parseChildBoxes(trakBytes, 8, trakBytes.length);
  const tkhdBox = trakChildren.find((b) => b.type === 'tkhd');
  const mdiaBox = trakChildren.find((b) => b.type === 'mdia');
  if (!tkhdBox || !mdiaBox) return null;

  const tkhdBytes = trakBytes.slice(tkhdBox.start, tkhdBox.end);
  const tkhdVersion = tkhdBytes[8];
  const trackId =
    tkhdVersion === 1
      ? readU32(tkhdBytes, 8 + 4 + 16)
      : readU32(tkhdBytes, 8 + 4 + 8);

  const mdiaChildren = parseChildBoxes(
    trakBytes,
    mdiaBox.start + mdiaBox.headerSize,
    mdiaBox.end
  );
  const mdhdBox = mdiaChildren.find((b) => b.type === 'mdhd');
  const hdlrBox = mdiaChildren.find((b) => b.type === 'hdlr');
  const minfBox = mdiaChildren.find((b) => b.type === 'minf');
  if (!mdhdBox || !hdlrBox || !minfBox) return null;

  const mdhdBytes = trakBytes.slice(mdhdBox.start, mdhdBox.end);
  const mdhdVersion = mdhdBytes[8];
  const timescale =
    mdhdVersion === 1
      ? readU32(mdhdBytes, 8 + 4 + 16)
      : readU32(mdhdBytes, 8 + 4 + 8);
  if (!timescale || timescale <= 0) return null;

  const handlerType = readType(trakBytes, hdlrBox.start + hdlrBox.headerSize + 8);

  const mdiaNonMinfBoxes = mdiaChildren
    .filter((b) => b.type !== 'mdhd' && b.type !== 'minf')
    .map((b) => trakBytes.slice(b.start, b.end));

  const minfChildren = parseChildBoxes(
    trakBytes,
    minfBox.start + minfBox.headerSize,
    minfBox.end
  );
  const stblBox = minfChildren.find((b) => b.type === 'stbl');
  if (!stblBox) return null;

  const minfNonStblBoxes = minfChildren
    .filter((b) => b.type !== 'stbl')
    .map((b) => trakBytes.slice(b.start, b.end));

  const stblChildren = parseChildBoxes(
    trakBytes,
    stblBox.start + stblBox.headerSize,
    stblBox.end
  );

  const stsdMeta = stblChildren.find((b) => b.type === 'stsd');
  const sttsMeta = stblChildren.find((b) => b.type === 'stts');
  const stscMeta = stblChildren.find((b) => b.type === 'stsc');
  const stszMeta = stblChildren.find((b) => b.type === 'stsz');
  const stcoMeta = stblChildren.find((b) => b.type === 'stco');
  const co64Meta = stblChildren.find((b) => b.type === 'co64');
  const stssMeta = stblChildren.find((b) => b.type === 'stss');
  const cttsMeta = stblChildren.find((b) => b.type === 'ctts');

  if (!stsdMeta || !sttsMeta || !stscMeta || !stszMeta || (!stcoMeta && !co64Meta)) {
    return null;
  }

  const stsdBox = trakBytes.slice(stsdMeta.start, stsdMeta.end);

  // Parse stsz (sample sizes)
  const stszOff = stszMeta.start + stszMeta.headerSize;
  const fixedSampleSize = readU32(trakBytes, stszOff + 4);
  const sampleCount = readU32(trakBytes, stszOff + 8);
  const sizes = new Uint32Array(sampleCount);
  if (fixedSampleSize !== 0) {
    sizes.fill(fixedSampleSize);
  } else {
    for (let i = 0; i < sampleCount; i++) {
      sizes[i] = readU32(trakBytes, stszOff + 12 + i * 4);
    }
  }

  // Parse chunk offsets (stco or co64)
  let chunkOffsets: number[] = [];
  if (co64Meta) {
    const off = co64Meta.start + co64Meta.headerSize;
    const count = readU32(trakBytes, off + 4);
    chunkOffsets = new Array(count);
    for (let i = 0; i < count; i++) {
      chunkOffsets[i] = readU64(trakBytes, off + 8 + i * 8);
    }
  } else if (stcoMeta) {
    const off = stcoMeta.start + stcoMeta.headerSize;
    const count = readU32(trakBytes, off + 4);
    chunkOffsets = new Array(count);
    for (let i = 0; i < count; i++) {
      chunkOffsets[i] = readU32(trakBytes, off + 8 + i * 4);
    }
  }

  // Parse stsc (sample to chunk) -> derive exact file offset for each sample
  const stscOff = stscMeta.start + stscMeta.headerSize;
  const stscCount = readU32(trakBytes, stscOff + 4);
  const stscEntries: Array<{ firstChunk: number; samplesPerChunk: number }> = [];
  for (let i = 0; i < stscCount; i++) {
    stscEntries.push({
      firstChunk: readU32(trakBytes, stscOff + 8 + i * 12),
      samplesPerChunk: readU32(trakBytes, stscOff + 8 + i * 12 + 4),
    });
  }

  const sampleOffsets = new Float64Array(sampleCount);
  let sampleIdx = 0;
  for (let chunkIdx = 0; chunkIdx < chunkOffsets.length && sampleIdx < sampleCount; chunkIdx++) {
    const chunkNum = chunkIdx + 1;
    let samplesInChunk = 1;
    for (let e = 0; e < stscEntries.length; e++) {
      if (stscEntries[e].firstChunk <= chunkNum) {
        samplesInChunk = stscEntries[e].samplesPerChunk;
      } else {
        break;
      }
    }
    let curOffset = chunkOffsets[chunkIdx];
    for (let s = 0; s < samplesInChunk && sampleIdx < sampleCount; s++) {
      sampleOffsets[sampleIdx] = curOffset;
      curOffset += sizes[sampleIdx];
      sampleIdx++;
    }
  }

  // Parse stts (decoding sample durations)
  const sttsOff = sttsMeta.start + sttsMeta.headerSize;
  const sttsCount = readU32(trakBytes, sttsOff + 4);
  const durations = new Uint32Array(sampleCount);
  let dIdx = 0;
  for (let i = 0; i < sttsCount && dIdx < sampleCount; i++) {
    const runCount = readU32(trakBytes, sttsOff + 8 + i * 8);
    const delta = readU32(trakBytes, sttsOff + 8 + i * 8 + 4);
    for (let r = 0; r < runCount && dIdx < sampleCount; r++) {
      durations[dIdx++] = delta;
    }
  }

  // Parse ctts (optional composition time offsets)
  const ctsOffsets = new Int32Array(sampleCount);
  let hasCtts = false;
  let cttsVersion = 0;
  if (cttsMeta) {
    hasCtts = true;
    const cttsOff = cttsMeta.start + cttsMeta.headerSize;
    cttsVersion = trakBytes[cttsOff];
    const cttsCount = readU32(trakBytes, cttsOff + 4);
    let cIdx = 0;
    for (let i = 0; i < cttsCount && cIdx < sampleCount; i++) {
      const runCount = readU32(trakBytes, cttsOff + 8 + i * 8);
      const val =
        cttsVersion === 0
          ? readU32(trakBytes, cttsOff + 8 + i * 8 + 4)
          : readI32(trakBytes, cttsOff + 8 + i * 8 + 4);
      for (let r = 0; r < runCount && cIdx < sampleCount; r++) {
        ctsOffsets[cIdx++] = val;
      }
    }
  }

  // Parse stss (optional sync samples)
  const hasStss = Boolean(stssMeta);
  const syncSet = new Set<number>();
  if (stssMeta) {
    const stssOff = stssMeta.start + stssMeta.headerSize;
    const stssCount = readU32(trakBytes, stssOff + 4);
    for (let i = 0; i < stssCount; i++) {
      syncSet.add(readU32(trakBytes, stssOff + 8 + i * 4) - 1);
    }
  }

  const samples: ParsedSample[] = new Array(sampleCount);
  let dts = 0;
  for (let i = 0; i < sampleCount; i++) {
    const dur = durations[i];
    const ctsOffset = ctsOffsets[i];
    samples[i] = {
      offset: sampleOffsets[i],
      size: sizes[i],
      dts,
      pts: dts + ctsOffset,
      duration: dur,
      ctsOffset,
      isSync: hasStss ? syncSet.has(i) : true,
    };
    dts += dur;
  }

  return {
    rawTrakBytes: trakBytes,
    handlerType,
    trackId,
    tkhdBytes,
    mdhdBytes,
    mdiaNonMinfBoxes,
    minfNonStblBoxes,
    stsdBox,
    timescale,
    samples,
    hasCtts,
    cttsVersion,
    hasStss,
  };
}

function updateMvhdDuration(
  mvhdBytes: Uint8Array,
  newDurationInMovieScale: number
): { updated: Uint8Array; movieTimescale: number } {
  const copy = new Uint8Array(mvhdBytes);
  const version = copy[8];
  let movieTimescale = 1000;
  if (version === 1) {
    movieTimescale = readU32(copy, 8 + 4 + 16);
    writeU64(copy, 8 + 4 + 20, Math.round(newDurationInMovieScale));
  } else {
    movieTimescale = readU32(copy, 8 + 4 + 8);
    writeU32(copy, 8 + 4 + 12, Math.round(newDurationInMovieScale));
  }
  return { updated: copy, movieTimescale: movieTimescale || 1000 };
}

function updateTkhdDuration(
  tkhdBytes: Uint8Array,
  newDurationInMovieScale: number
): Uint8Array {
  const copy = new Uint8Array(tkhdBytes);
  const version = copy[8];
  if (version === 1) {
    writeU64(copy, 8 + 4 + 24, Math.round(newDurationInMovieScale));
  } else {
    writeU32(copy, 8 + 4 + 16, Math.round(newDurationInMovieScale));
  }
  return copy;
}

function updateMdhdDuration(
  mdhdBytes: Uint8Array,
  newDurationInTrackScale: number
): Uint8Array {
  const copy = new Uint8Array(mdhdBytes);
  const version = copy[8];
  if (version === 1) {
    writeU64(copy, 8 + 4 + 20, Math.round(newDurationInTrackScale));
  } else {
    writeU32(copy, 8 + 4 + 12, Math.round(newDurationInTrackScale));
  }
  return copy;
}

function buildSttsBox(samples: ParsedSample[]): Uint8Array {
  const runs: Array<{ count: number; delta: number }> = [];
  for (const s of samples) {
    const delta = Math.max(0, Math.round(s.duration));
    const last = runs[runs.length - 1];
    if (last && last.delta === delta) {
      last.count++;
    } else {
      runs.push({ count: 1, delta });
    }
  }
  const payload = new Uint8Array(4 + runs.length * 8);
  writeU32(payload, 0, runs.length);
  for (let i = 0; i < runs.length; i++) {
    writeU32(payload, 4 + i * 8, runs[i].count);
    writeU32(payload, 4 + i * 8 + 4, runs[i].delta);
  }
  return makeFullBox('stts', 0, 0, payload);
}

function buildCttsBox(samples: ParsedSample[], version: number): Uint8Array {
  const runs: Array<{ count: number; offset: number }> = [];
  for (const s of samples) {
    const off = Math.round(s.ctsOffset);
    const last = runs[runs.length - 1];
    if (last && last.offset === off) {
      last.count++;
    } else {
      runs.push({ count: 1, offset: off });
    }
  }
  const payload = new Uint8Array(4 + runs.length * 8);
  writeU32(payload, 0, runs.length);
  for (let i = 0; i < runs.length; i++) {
    writeU32(payload, 4 + i * 8, runs[i].count);
    writeU32(payload, 4 + i * 8 + 4, runs[i].offset >>> 0);
  }
  return makeFullBox('ctts', version, 0, payload);
}

function buildStssBox(samples: ParsedSample[]): Uint8Array {
  const syncIndices: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].isSync) {
      syncIndices.push(i + 1);
    }
  }
  const payload = new Uint8Array(4 + syncIndices.length * 4);
  writeU32(payload, 0, syncIndices.length);
  for (let i = 0; i < syncIndices.length; i++) {
    writeU32(payload, 4 + i * 4, syncIndices[i]);
  }
  return makeFullBox('stss', 0, 0, payload);
}

function buildStszBox(samples: ParsedSample[]): Uint8Array {
  const payload = new Uint8Array(8 + samples.length * 4);
  writeU32(payload, 0, 0); // variable sample size
  writeU32(payload, 4, samples.length);
  for (let i = 0; i < samples.length; i++) {
    writeU32(payload, 8 + i * 4, samples[i].size);
  }
  return makeFullBox('stsz', 0, 0, payload);
}

function buildStscSingleChunkBox(sampleCount: number): Uint8Array {
  const payload = new Uint8Array(4 + 12);
  writeU32(payload, 0, 1);
  writeU32(payload, 4, 1); // first chunk = 1
  writeU32(payload, 8, sampleCount);
  writeU32(payload, 12, 1); // sample description index = 1
  return makeFullBox('stsc', 0, 0, payload);
}

function buildChunkOffsetBox(
  offset: number,
  use64Bit: boolean
): Uint8Array {
  if (use64Bit) {
    const payload = new Uint8Array(4 + 8);
    writeU32(payload, 0, 1);
    writeU64(payload, 4, offset);
    return makeFullBox('co64', 0, 0, payload);
  }
  const payload = new Uint8Array(4 + 4);
  writeU32(payload, 0, 1);
  writeU32(payload, 4, offset);
  return makeFullBox('stco', 0, 0, payload);
}

interface ParsedMp4Context {
  sourceBlob: Blob;
  ftypBytes: Uint8Array;
  mvhdBytes: Uint8Array;
  movieTimescale: number;
  tracks: ParsedTrack[];
  durationSec: number;
}

async function parseMp4Source(sourceUrlOrBlob: string | Blob): Promise<ParsedMp4Context> {
  const sourceBlob =
    typeof sourceUrlOrBlob === 'string'
      ? await (await fetch(sourceUrlOrBlob)).blob()
      : sourceUrlOrBlob;

  const { ftypBytes, moovBytes, hasMoof } = await scanTopLevelBoxes(sourceBlob);
  if (hasMoof) {
    throw new Error(
      'Fragmented MP4 streams are not supported for browser-side lossless cutting.'
    );
  }
  if (!moovBytes) {
    throw new Error(
      'Lossless browser video cutting supports MP4, MOV, and M4V files.'
    );
  }

  const moovChildren = parseChildBoxes(moovBytes, 8, moovBytes.length);
  const mvhdMeta = moovChildren.find((b) => b.type === 'mvhd');
  if (!mvhdMeta) {
    throw new Error('Invalid MP4 header (missing mvhd).');
  }

  const mvhdBytes = moovBytes.slice(mvhdMeta.start, mvhdMeta.end);
  const mvhdVer = mvhdBytes[8];
  const movieTimescale =
    mvhdVer === 1
      ? readU32(mvhdBytes, 8 + 4 + 16)
      : readU32(mvhdBytes, 8 + 4 + 8);

  const tracks: ParsedTrack[] = [];
  for (const child of moovChildren) {
    if (child.type === 'trak') {
      const parsed = parseTrackBox(moovBytes.slice(child.start, child.end));
      if (parsed && (parsed.handlerType === 'vide' || parsed.handlerType === 'soun')) {
        tracks.push(parsed);
      }
    }
  }

  if (tracks.length === 0) {
    throw new Error('No audio or video tracks found in MP4 file.');
  }

  let maxTrackSec = 0;
  for (const t of tracks) {
    const totalUnits = t.samples.reduce((acc, s) => acc + s.duration, 0);
    const sec = totalUnits / t.timescale;
    if (sec > maxTrackSec) maxTrackSec = sec;
  }

  const defaultFtyp =
    ftypBytes ||
    makeBox(
      'ftyp',
      new Uint8Array([
        0x69, 0x73, 0x6f, 0x6d, // isom
        0x00, 0x00, 0x02, 0x00,
        0x69, 0x73, 0x6f, 0x6d, // isom
        0x6d, 0x70, 0x34, 0x31, // mp41
      ])
    );

  return {
    sourceBlob,
    ftypBytes: defaultFtyp,
    mvhdBytes,
    movieTimescale: movieTimescale || 1000,
    tracks,
    durationSec: maxTrackSec,
  };
}

function selectSegmentFromContext(
  ctx: ParsedMp4Context,
  requestedStartSec: number,
  requestedEndSec: number
): {
  blob: Blob;
  durationMs: number;
  actualStartSec: number;
  actualEndSec: number;
} {
  const videoTrack = ctx.tracks.find((t) => t.handlerType === 'vide');
  let actualStartSec = Math.max(0, requestedStartSec);
  let actualEndSec = Math.max(actualStartSec + 0.05, requestedEndSec);

  const selectedPerTrack = new Map<ParsedTrack, ParsedSample[]>();

  if (videoTrack && videoTrack.samples.length > 0) {
    const targetStartUnits = actualStartSec * videoTrack.timescale;
    const targetEndUnits = actualEndSec * videoTrack.timescale;

    // Pick the sync frame at or immediately before targetStartUnits so clip starts cleanly with zero frame loss
    let startIdx = 0;
    for (let i = 0; i < videoTrack.samples.length; i++) {
      const s = videoTrack.samples[i];
      if (s.pts <= targetStartUnits && s.isSync) {
        startIdx = i;
      } else if (s.pts > targetStartUnits) {
        break;
      }
    }

    let endIdx = videoTrack.samples.length - 1;
    for (let i = startIdx; i < videoTrack.samples.length; i++) {
      if (videoTrack.samples[i].pts >= targetEndUnits) {
        endIdx = Math.max(startIdx, i - 1);
        break;
      }
    }

    const vSamples = videoTrack.samples.slice(startIdx, endIdx + 1);
    if (vSamples.length === 0) {
      throw new Error('Selected range contains no video frames.');
    }

    actualStartSec = Math.max(0, vSamples[0].pts / videoTrack.timescale);
    const lastV = vSamples[vSamples.length - 1];
    actualEndSec = (lastV.pts + lastV.duration) / videoTrack.timescale;
    selectedPerTrack.set(videoTrack, vSamples);
  }

  for (const track of ctx.tracks) {
    if (track === videoTrack) continue;
    const startUnits = actualStartSec * track.timescale;
    const endUnits = actualEndSec * track.timescale;
    const aSamples = track.samples.filter(
      (s) => s.pts >= startUnits - s.duration * 0.5 && s.pts < endUnits
    );
    if (aSamples.length > 0) {
      selectedPerTrack.set(track, aSamples);
    }
  }

  const activeTracks = ctx.tracks.filter(
    (t) => (selectedPerTrack.get(t)?.length || 0) > 0
  );
  if (activeTracks.length === 0) {
    throw new Error('Selected segment is empty.');
  }

  let clipDurationSec = 0;
  for (const t of activeTracks) {
    const samples = selectedPerTrack.get(t)!;
    const dur = samples.reduce((acc, s) => acc + s.duration, 0) / t.timescale;
    if (dur > clipDurationSec) clipDurationSec = dur;
  }

  const totalMdatPayloadBytes = activeTracks.reduce((sum, t) => {
    const list = selectedPerTrack.get(t)!;
    return sum + list.reduce((a, s) => a + s.size, 0);
  }, 0);

  const mdatHeaderSize = totalMdatPayloadBytes + 8 > 0xffffffff ? 16 : 8;
  const preliminaryEstimate = ctx.ftypBytes.length + 1024 * 64 + totalMdatPayloadBytes;
  const use64BitOffsets = preliminaryEstimate > 0xffffffff;

  // Helper to assemble `moov` once exact track chunk offsets inside `mdat` are known
  const buildMoovWithOffsets = (trackOffsets: number[]): Uint8Array => {
    const movieDurUnits = Math.round(clipDurationSec * ctx.movieTimescale);
    const { updated: updatedMvhd } = updateMvhdDuration(
      ctx.mvhdBytes,
      movieDurUnits
    );
    const trakBoxes = activeTracks.map((track, idx) => {
      const samples = selectedPerTrack.get(track)!;
      const trackDurUnits = samples.reduce((acc, s) => acc + s.duration, 0);

      const stblParts: Uint8Array[] = [
        track.stsdBox,
        buildSttsBox(samples),
      ];
      if (track.hasCtts) {
        stblParts.push(buildCttsBox(samples, track.cttsVersion));
      }
      if (track.hasStss && track.handlerType === 'vide') {
        stblParts.push(buildStssBox(samples));
      }
      stblParts.push(
        buildStscSingleChunkBox(samples.length),
        buildStszBox(samples),
        buildChunkOffsetBox(trackOffsets[idx], use64BitOffsets)
      );

      const stblBox = makeBox('stbl', concatUint8Arrays(stblParts));
      const minfBox = makeBox(
        'minf',
        concatUint8Arrays([...track.minfNonStblBoxes, stblBox])
      );
      const mdhdUpdated = updateMdhdDuration(track.mdhdBytes, trackDurUnits);
      const mdiaBox = makeBox(
        'mdia',
        concatUint8Arrays([mdhdUpdated, ...track.mdiaNonMinfBoxes, minfBox])
      );
      const tkhdUpdated = updateTkhdDuration(track.tkhdBytes, movieDurUnits);
      return makeBox('trak', concatUint8Arrays([tkhdUpdated, mdiaBox]));
    });

    return makeBox('moov', concatUint8Arrays([updatedMvhd, ...trakBoxes]));
  };

  // Pass 1: measure moov byte length with zero offsets
  const dummyMoov = buildMoovWithOffsets(activeTracks.map(() => 0));
  const mdatStartOffset = ctx.ftypBytes.length + dummyMoov.length;
  const firstTrackDataOffset = mdatStartOffset + mdatHeaderSize;

  let runningOffset = firstTrackDataOffset;
  const realTrackOffsets = activeTracks.map((track) => {
    const startOff = runningOffset;
    const list = selectedPerTrack.get(track)!;
    for (const s of list) {
      runningOffset += s.size;
    }
    return startOff;
  });

  // Pass 2: build final moov with exact offsets
  const finalMoov = buildMoovWithOffsets(realTrackOffsets);

  // Build mdat header
  const mdatHeader = new Uint8Array(mdatHeaderSize);
  if (mdatHeaderSize === 16) {
    writeU32(mdatHeader, 0, 1);
    mdatHeader[4] = 'm'.charCodeAt(0);
    mdatHeader[5] = 'd'.charCodeAt(0);
    mdatHeader[6] = 'a'.charCodeAt(0);
    mdatHeader[7] = 't'.charCodeAt(0);
    writeU64(mdatHeader, 8, totalMdatPayloadBytes + 16);
  } else {
    writeU32(mdatHeader, 0, totalMdatPayloadBytes + 8);
    mdatHeader[4] = 'm'.charCodeAt(0);
    mdatHeader[5] = 'd'.charCodeAt(0);
    mdatHeader[6] = 'a'.charCodeAt(0);
    mdatHeader[7] = 't'.charCodeAt(0);
  }

  const blobParts: BlobPart[] = [
    new Uint8Array(ctx.ftypBytes),
    new Uint8Array(finalMoov),
    new Uint8Array(mdatHeader),
  ];

  // Merge adjacent sample slices per track so large videos don't create thousands of tiny Blob slices
  for (const track of activeTracks) {
    const list = selectedPerTrack.get(track)!;
    let rangeStart = -1;
    let rangeEnd = -1;
    for (const s of list) {
      if (rangeStart < 0) {
        rangeStart = s.offset;
        rangeEnd = s.offset + s.size;
      } else if (s.offset === rangeEnd) {
        rangeEnd += s.size;
      } else {
        blobParts.push(ctx.sourceBlob.slice(rangeStart, rangeEnd));
        rangeStart = s.offset;
        rangeEnd = s.offset + s.size;
      }
    }
    if (rangeStart >= 0 && rangeEnd > rangeStart) {
      blobParts.push(ctx.sourceBlob.slice(rangeStart, rangeEnd));
    }
  }

  return {
    blob: new Blob(blobParts, { type: 'video/mp4' }),
    durationMs: Math.round(clipDurationSec * 1000),
    actualStartSec,
    actualEndSec,
  };
}

function sanitizeBaseName(name: string): string {
  const clean = name
    .replace(/\.[^/.]+$/, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  return clean || 'MoVibe_Video';
}

export async function trimVideoBlobLossless(
  sourceUrlOrBlob: string | Blob,
  startSec: number,
  endSec: number,
  baseTitle: string
): Promise<LosslessVideoClip> {
  const ctx = await parseMp4Source(sourceUrlOrBlob);
  const res = selectSegmentFromContext(ctx, startSec, endSec);
  const safeBase = sanitizeBaseName(baseTitle);
  return {
    blob: res.blob,
    fileName: `${safeBase}_trimmed.mp4`,
    durationMs: res.durationMs,
    actualStartSec: res.actualStartSec,
    actualEndSec: res.actualEndSec,
    partLabel: 'Trimmed',
  };
}

export async function splitVideoBlobLossless(
  sourceUrlOrBlob: string | Blob,
  splitSec: number,
  keepPart: 'both' | 'part1' | 'part2',
  baseTitle: string
): Promise<LosslessVideoClip[]> {
  const ctx = await parseMp4Source(sourceUrlOrBlob);
  const videoTrack = ctx.tracks.find((t) => t.handlerType === 'vide');

  // Snap split point to exact video keyframe so Part 1 and Part 2 join seamlessly without losing a frame
  let cutSec = splitSec;
  if (videoTrack && videoTrack.samples.length > 0) {
    const targetUnits = splitSec * videoTrack.timescale;
    let cutSample = videoTrack.samples[0];
    for (let i = 0; i < videoTrack.samples.length; i++) {
      const s = videoTrack.samples[i];
      if (s.pts <= targetUnits && s.isSync) {
        cutSample = s;
      } else if (s.pts > targetUnits) {
        break;
      }
    }
    const candidateSec = cutSample.pts / videoTrack.timescale;
    if (candidateSec > 0.1 && candidateSec < ctx.durationSec - 0.1) {
      cutSec = candidateSec;
    }
  }

  const safeBase = sanitizeBaseName(baseTitle);
  const clips: LosslessVideoClip[] = [];

  if (keepPart === 'both' || keepPart === 'part1') {
    const p1 = selectSegmentFromContext(ctx, 0, cutSec);
    clips.push({
      blob: p1.blob,
      fileName: `${safeBase}_part1.mp4`,
      durationMs: p1.durationMs,
      actualStartSec: p1.actualStartSec,
      actualEndSec: p1.actualEndSec,
      partLabel: 'Part 1',
    });
  }

  if (keepPart === 'both' || keepPart === 'part2') {
    const p2 = selectSegmentFromContext(ctx, cutSec, ctx.durationSec + 1);
    clips.push({
      blob: p2.blob,
      fileName: `${safeBase}_part2.mp4`,
      durationMs: p2.durationMs,
      actualStartSec: p2.actualStartSec,
      actualEndSec: p2.actualEndSec,
      partLabel: 'Part 2',
    });
  }

  return clips;
}

export async function exportVideoSegmentsBlobLossless(
  sourceUrlOrBlob: string | Blob,
  segments: Array<{ startSec: number; endSec: number }>,
  baseTitle: string
): Promise<LosslessVideoClip> {
  const validSegments = segments.filter((s) => s.endSec - s.startSec > 0.05);
  if (validSegments.length === 0) {
    throw new Error('Keep at least one video part before saving.');
  }
  if (validSegments.length === 1) {
    return await trimVideoBlobLossless(
      sourceUrlOrBlob,
      validSegments[0].startSec,
      validSegments[0].endSec,
      baseTitle
    );
  }

  const ctx = await parseMp4Source(sourceUrlOrBlob);
  const videoTrack = ctx.tracks.find((t) => t.handlerType === 'vide');
  const combinedPerTrack = new Map<ParsedTrack, ParsedSample[]>();
  for (const t of ctx.tracks) {
    combinedPerTrack.set(t, []);
  }

  let firstStartSec = validSegments[0].startSec;
  let lastEndSec = validSegments[validSegments.length - 1].endSec;

  for (let segIdx = 0; segIdx < validSegments.length; segIdx++) {
    const seg = validSegments[segIdx];
    let segStartSec = Math.max(0, seg.startSec);
    let segEndSec = Math.max(segStartSec + 0.05, seg.endSec);

    if (videoTrack && videoTrack.samples.length > 0) {
      const targetStartUnits = segStartSec * videoTrack.timescale;
      const targetEndUnits = segEndSec * videoTrack.timescale;

      let startIdx = 0;
      for (let i = 0; i < videoTrack.samples.length; i++) {
        const s = videoTrack.samples[i];
        if (s.pts <= targetStartUnits && s.isSync) {
          startIdx = i;
        } else if (s.pts > targetStartUnits) {
          break;
        }
      }

      let endIdx = videoTrack.samples.length - 1;
      for (let i = startIdx; i < videoTrack.samples.length; i++) {
        if (videoTrack.samples[i].pts >= targetEndUnits) {
          endIdx = Math.max(startIdx, i - 1);
          break;
        }
      }

      const vSamples = videoTrack.samples.slice(startIdx, endIdx + 1);
      if (vSamples.length > 0) {
        segStartSec = Math.max(0, vSamples[0].pts / videoTrack.timescale);
        const lastV = vSamples[vSamples.length - 1];
        segEndSec = (lastV.pts + lastV.duration) / videoTrack.timescale;
        if (segIdx === 0) firstStartSec = segStartSec;
        lastEndSec = segEndSec;
        combinedPerTrack.get(videoTrack)!.push(...vSamples);
      }
    }

    for (const track of ctx.tracks) {
      if (track === videoTrack) continue;
      const startUnits = segStartSec * track.timescale;
      const endUnits = segEndSec * track.timescale;
      const aSamples = track.samples.filter(
        (s) => s.pts >= startUnits - s.duration * 0.5 && s.pts < endUnits
      );
      if (aSamples.length > 0) {
        combinedPerTrack.get(track)!.push(...aSamples);
      }
    }
  }

  const activeTracks = ctx.tracks.filter(
    (t) => (combinedPerTrack.get(t)?.length || 0) > 0
  );
  if (activeTracks.length === 0) {
    throw new Error('Selected segments contain no audio or video frames.');
  }

  let clipDurationSec = 0;
  for (const t of activeTracks) {
    const samples = combinedPerTrack.get(t)!;
    const dur = samples.reduce((acc, s) => acc + s.duration, 0) / t.timescale;
    if (dur > clipDurationSec) clipDurationSec = dur;
  }

  const totalMdatPayloadBytes = activeTracks.reduce((sum, t) => {
    const list = combinedPerTrack.get(t)!;
    return sum + list.reduce((a, s) => a + s.size, 0);
  }, 0);

  const mdatHeaderSize = totalMdatPayloadBytes + 8 > 0xffffffff ? 16 : 8;
  const preliminaryEstimate = ctx.ftypBytes.length + 1024 * 64 + totalMdatPayloadBytes;
  const use64BitOffsets = preliminaryEstimate > 0xffffffff;

  const buildMoovWithOffsets = (trackOffsets: number[]): Uint8Array => {
    const movieDurUnits = Math.round(clipDurationSec * ctx.movieTimescale);
    const { updated: updatedMvhd } = updateMvhdDuration(
      ctx.mvhdBytes,
      movieDurUnits
    );
    const trakBoxes = activeTracks.map((track, idx) => {
      const samples = combinedPerTrack.get(track)!;
      const trackDurUnits = samples.reduce((acc, s) => acc + s.duration, 0);

      const stblParts: Uint8Array[] = [
        track.stsdBox,
        buildSttsBox(samples),
      ];
      if (track.hasCtts) {
        stblParts.push(buildCttsBox(samples, track.cttsVersion));
      }
      if (track.hasStss && track.handlerType === 'vide') {
        stblParts.push(buildStssBox(samples));
      }
      stblParts.push(
        buildStscSingleChunkBox(samples.length),
        buildStszBox(samples),
        buildChunkOffsetBox(trackOffsets[idx], use64BitOffsets)
      );

      const stblBox = makeBox('stbl', concatUint8Arrays(stblParts));
      const minfBox = makeBox(
        'minf',
        concatUint8Arrays([...track.minfNonStblBoxes, stblBox])
      );
      const mdhdUpdated = updateMdhdDuration(track.mdhdBytes, trackDurUnits);
      const mdiaBox = makeBox(
        'mdia',
        concatUint8Arrays([mdhdUpdated, ...track.mdiaNonMinfBoxes, minfBox])
      );
      const tkhdUpdated = updateTkhdDuration(track.tkhdBytes, movieDurUnits);
      return makeBox('trak', concatUint8Arrays([tkhdUpdated, mdiaBox]));
    });

    return makeBox('moov', concatUint8Arrays([updatedMvhd, ...trakBoxes]));
  };

  const dummyMoov = buildMoovWithOffsets(activeTracks.map(() => 0));
  const mdatStartOffset = ctx.ftypBytes.length + dummyMoov.length;
  const firstTrackDataOffset = mdatStartOffset + mdatHeaderSize;

  let runningOffset = firstTrackDataOffset;
  const realTrackOffsets = activeTracks.map((track) => {
    const startOff = runningOffset;
    const list = combinedPerTrack.get(track)!;
    for (const s of list) {
      runningOffset += s.size;
    }
    return startOff;
  });

  const finalMoov = buildMoovWithOffsets(realTrackOffsets);

  const mdatHeader = new Uint8Array(mdatHeaderSize);
  if (mdatHeaderSize === 16) {
    writeU32(mdatHeader, 0, 1);
    mdatHeader[4] = 'm'.charCodeAt(0);
    mdatHeader[5] = 'd'.charCodeAt(0);
    mdatHeader[6] = 'a'.charCodeAt(0);
    mdatHeader[7] = 't'.charCodeAt(0);
    writeU64(mdatHeader, 8, totalMdatPayloadBytes + 16);
  } else {
    writeU32(mdatHeader, 0, totalMdatPayloadBytes + 8);
    mdatHeader[4] = 'm'.charCodeAt(0);
    mdatHeader[5] = 'd'.charCodeAt(0);
    mdatHeader[6] = 'a'.charCodeAt(0);
    mdatHeader[7] = 't'.charCodeAt(0);
  }

  const blobParts: BlobPart[] = [
    new Uint8Array(ctx.ftypBytes),
    new Uint8Array(finalMoov),
    new Uint8Array(mdatHeader),
  ];

  for (const track of activeTracks) {
    const list = combinedPerTrack.get(track)!;
    let rangeStart = -1;
    let rangeEnd = -1;
    for (const s of list) {
      if (rangeStart < 0) {
        rangeStart = s.offset;
        rangeEnd = s.offset + s.size;
      } else if (s.offset === rangeEnd) {
        rangeEnd += s.size;
      } else {
        blobParts.push(ctx.sourceBlob.slice(rangeStart, rangeEnd));
        rangeStart = s.offset;
        rangeEnd = s.offset + s.size;
      }
    }
    if (rangeStart >= 0 && rangeEnd > rangeStart) {
      blobParts.push(ctx.sourceBlob.slice(rangeStart, rangeEnd));
    }
  }

  const safeBase = sanitizeBaseName(baseTitle);
  return {
    blob: new Blob(blobParts, { type: 'video/mp4' }),
    fileName: `${safeBase}_edited.mp4`,
    durationMs: Math.round(clipDurationSec * 1000),
    actualStartSec: firstStartSec,
    actualEndSec: lastEndSec,
    partLabel: 'Edited',
  };
}

export function triggerWebVideoDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
