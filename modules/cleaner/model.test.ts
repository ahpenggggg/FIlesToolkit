import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CleanItem } from './engine.ts';
import { REVIEW_BYTES, defaultSelection, displayName, needsReview, resultRows } from './model.ts';

function item(over: Partial<CleanItem>): CleanItem {
  return { path: '/storage/emulated/0/a', name: 'a', kind: 'temp', isDirectory: false, size: 10, files: 1, modified: 0, ...over };
}

const MB = 1024 * 1024;

test('only items over 50 MB need checking first', () => {
  assert.equal(needsReview(item({ size: 50 * MB })), false);
  assert.equal(needsReview(item({ size: 50 * MB + 1 })), true);
  assert.equal(REVIEW_BYTES, 50 * MB);
});

test('everything up to 50 MB is selected; bigger items are not', () => {
  const small = item({ path: '/s', size: 3 * MB });
  const big = item({ path: '/b', size: 60 * MB, kind: 'orphanApp', isDirectory: true });
  assert.deepEqual([...defaultSelection([small, big])], ['/s']);
});

test('MediaStore prefixes are dropped from names', () => {
  assert.equal(displayName(item({ name: '.trashed-1700000000-IMG_1.jpg', kind: 'expiredTrash' })), 'IMG_1.jpg');
  assert.equal(displayName(item({ name: '.pending-1700000000-VID.mp4', kind: 'expiredPending' })), 'VID.mp4');
  assert.equal(displayName(item({ name: 'report.tmp' })), 'report.tmp');
});

test('big items are listed once, first, to check; the rest by kind, biggest first', () => {
  const rows = resultRows([
    item({ path: '/t1', size: 5 }),
    item({ path: '/big', size: 80 * MB, kind: 'temp' }),
    item({ path: '/e', size: 0, kind: 'emptyFolder', isDirectory: true }),
    item({ path: '/t2', size: 9 }),
  ]);
  assert.deepEqual(
    rows.map((r) => (r.type === 'head' ? `head:${r.section}:${r.count}` : r.item.path)),
    ['head:review:1', '/big', 'head:temp:2', '/t2', '/t1', 'head:emptyFolder:1', '/e'],
  );
  assert.equal(rows.filter((r) => r.type === 'item' && r.review).length, 1);
});
