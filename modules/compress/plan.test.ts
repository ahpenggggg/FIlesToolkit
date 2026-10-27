import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VideoAsset } from './engine.ts';
import { outputSize, skipReason } from './plan.ts';

function video(over: Partial<VideoAsset>): VideoAsset {
  return {
    id: 'v', uri: 'content://v', name: 'v.mp4', size: 60e6, width: 1920, height: 1080, durationMs: 30_000,
    readable: true, fps: 30, videoBitrate: 16e6, rotation: 0, codedWidth: 1920, codedHeight: 1080,
    probedDurationMs: 30_000, cloudOnly: false, ...over,
  } as VideoAsset;
}

test('fits inside 720p HD like HandBrake, keeping the aspect ratio', () => {
  assert.deepEqual(outputSize(video({})), { width: 1280, height: 720 });
  assert.deepEqual(outputSize(video({ codedWidth: 3840, codedHeight: 2160 })), { width: 1280, height: 720 });
  // 4:3 and ultra-wide keep their shape.
  assert.deepEqual(outputSize(video({ codedWidth: 1440, codedHeight: 1080 })), { width: 960, height: 720 });
  assert.deepEqual(outputSize(video({ codedWidth: 2560, codedHeight: 1080 })), { width: 1280, height: 540 });
});

test('portrait videos become 720×1280, and small ones are never enlarged', () => {
  assert.deepEqual(outputSize(video({ rotation: 90 })), { width: 720, height: 1280 });
  assert.deepEqual(outputSize(video({ codedWidth: 1080, codedHeight: 1920 })), { width: 720, height: 1280 });
  assert.deepEqual(outputSize(video({ codedWidth: 640, codedHeight: 360 })), { width: 640, height: 360 });
});

test('unreadable and HDR videos are skipped', () => {
  assert.equal(skipReason(video({})), null);
  assert.match(skipReason(video({ hdr: true })) ?? '', /HDR/);
  assert.match(skipReason(video({ readable: false })) ?? '', /read/);
});
