import type { VideoAsset } from './engine';

/** A compressed file is only kept if it is at least this much smaller than the original. */
export const MIN_SAVING = 1024 * 1024;
/** Videos smaller than this are hidden: saving ≥ 1 MB from them is unrealistic. */
export const AUTO_MIN_VIDEO_BYTES = 5 * 1024 * 1024;

export type PresetKey = 'high' | 'balanced' | 'small';
export type ResolutionKey = 'original' | 'p1080' | 'p720';

export interface Preset {
  key: PresetKey;
  label: string;
  description: string;
  /** Bits per pixel per frame for HEVC (H.264 gets 1.5×). */
  bppHevc: number;
  /** Never exceed this fraction of the source's video bitrate (adapts to already-compressed downloads). */
  sourceRatio: number;
  /** Cap frame rate; 0 = keep. */
  maxFps: number;
}

export const PRESETS: Preset[] = [
  { key: 'high', label: 'High', description: 'Looks identical to the original', bppHevc: 0.07, sourceRatio: 1, maxFps: 0 },
  {
    key: 'balanced',
    label: 'Balanced',
    description: 'Streaming quality · max 30 fps — big savings, hard to tell apart',
    bppHevc: 0.035,
    sourceRatio: 0.45,
    maxFps: 30,
  },
  {
    key: 'small',
    label: 'Small',
    description: 'Smallest files · max 30 fps — fine on a phone, softer on a TV',
    bppHevc: 0.02,
    sourceRatio: 0.25,
    maxFps: 30,
  },
];

export interface Resolution {
  key: ResolutionKey;
  label: string;
  /** Short side in px; 0 = keep original. */
  shortSide: number;
}

export const RESOLUTIONS: Resolution[] = [
  { key: 'original', label: 'Original', shortSide: 0 },
  { key: 'p1080', label: '1080p', shortSide: 1080 },
  { key: 'p720', label: '720p', shortSide: 720 },
];

export const presetOf = (k: PresetKey) => PRESETS.find((p) => p.key === k) ?? PRESETS[1];
export const resolutionOf = (k: ResolutionKey) => RESOLUTIONS.find((r) => r.key === k) ?? RESOLUTIONS[0];

export interface Plan {
  scale: number;
  outShortSide: number;
  fps: number;
  dropFrames: boolean;
  bitrate: number;
  estimateBytes: number;
  skipReason: string | null;
}

/** Decides how to encode one video and estimates the result. Same logic on Android and iOS. */
export function planVideo(v: VideoAsset, presetKey: PresetKey, resKey: ResolutionKey, hevc: boolean): Plan {
  const preset = presetOf(presetKey);
  const res = resolutionOf(resKey);

  const w = v.codedWidth || v.width;
  const h = v.codedHeight || v.height;
  const short = Math.min(w, h);
  const scale = res.shortSide > 0 && res.shortSide < short ? res.shortSide / short : 1;
  const ow = even(w * scale);
  const oh = even(h * scale);

  const srcFps = v.fps > 0 ? v.fps : 30;
  const dropFrames = preset.maxFps > 0 && srcFps > preset.maxFps + 1;
  const fps = dropFrames ? preset.maxFps : srcFps;

  const bpp = hevc ? preset.bppHevc : preset.bppHevc * 1.5;
  let bitrate = ow * oh * fps * bpp;
  if (v.videoBitrate > 0 && preset.sourceRatio < 1) bitrate = Math.min(bitrate, v.videoBitrate * preset.sourceRatio);
  bitrate = clamp(Math.round(bitrate), 300_000, 80_000_000);

  const durMs = v.probedDurationMs || v.durationMs;
  const durS = durMs / 1000;
  const videoBytes = v.videoBitrate > 0 ? (v.videoBitrate * durS) / 8 : v.size * 0.95;
  const audioBytes = Math.max(0, v.size - videoBytes);
  const estimateBytes = Math.round(audioBytes + (bitrate * durS) / 8 + 64 * 1024);

  let skipReason: string | null = null;
  if (!v.readable) skipReason = "Can't read video";
  else if (v.cloudOnly) skipReason = 'Only in iCloud — download it in Photos first';
  else if (durMs <= 0) skipReason = 'Unknown duration';
  else if (scale === 1 && !dropFrames && v.videoBitrate > 0 && bitrate > v.videoBitrate * 0.8)
    skipReason = `Already efficiently encoded (${mbps(v.videoBitrate)}) — try a smaller preset or resolution`;
  else if (estimateBytes > v.size - MIN_SAVING) skipReason = 'Estimated saving < 1 MB';

  return { scale, outShortSide: Math.min(ow, oh), fps, dropFrames, bitrate, estimateBytes, skipReason };
}

function even(v: number) {
  const r = Math.round(v);
  return Math.max(2, r - (r % 2));
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function mbps(bps: number) {
  return `${(bps / 1_000_000).toFixed(1)} Mbps`;
}
