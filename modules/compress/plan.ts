import type { VideoAsset } from './engine';

/** Videos smaller than this are hidden: not worth compressing. */
export const AUTO_MIN_VIDEO_BYTES = 5 * 1024 * 1024;

/**
 * HandBrake's default preset ("Fast 1080p30") with Resolution Limit "720p HD", at RF 26. Fixed on
 * purpose: these are the settings that looked right, so there's nothing to choose.
 */
export const HANDBRAKE = {
  /** Constant quality: lower is finer and bigger. Keep in step with HandBrake.RF in Transcoder.kt. */
  rf: 26,
  summary: 'H.264 · up to 720p · RF 26 · max 30 fps · AAC 160 kbps',
  maxLong: 1280,
  maxShort: 720,
} as const;

/** The output size as it plays (rotation applied): fitted inside 1280×720 (720×1280 for portrait), never enlarged. */
export function outputSize(v: VideoAsset): { width: number; height: number } {
  const turned = v.rotation === 90 || v.rotation === 270;
  const cw = v.codedWidth || v.width;
  const ch = v.codedHeight || v.height;
  const w = turned ? ch : cw;
  const h = turned ? cw : ch;
  const landscape = w >= h;
  const maxW = landscape ? HANDBRAKE.maxLong : HANDBRAKE.maxShort;
  const maxH = landscape ? HANDBRAKE.maxShort : HANDBRAKE.maxLong;
  const scale = Math.min(1, maxW / w, maxH / h);
  return { width: even(w * scale), height: even(h * scale) };
}

/** Why a video can't be compressed, or null. */
export function skipReason(v: VideoAsset): string | null {
  if (!v.readable) return "Can't read video";
  if ((v.probedDurationMs || v.durationMs) <= 0) return 'Unknown duration';
  if (v.hdr) return "HDR video isn't supported yet";
  return null;
}

function even(v: number) {
  const r = Math.round(v);
  return Math.max(2, r - (r % 2));
}
