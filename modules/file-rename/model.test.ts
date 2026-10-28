/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLLAPSED_FILE_ROWS, groupRows, type FileGroup, type FileScan } from './model.ts';

const scan: FileScan = {
  rootName: 'Root',
  allNames: new Set(),
  files: Array.from({ length: 10 }, (_, i) => ({ uri: `/r/IMG_${i}.jpg`, name: `IMG_${i}.jpg`, stem: 'img' })).concat([
    { uri: '/r/notes.txt', name: 'notes.txt', stem: 'notes' },
  ]),
};
const groups: FileGroup[] = [
  { files: Array.from({ length: 10 }, (_, i) => i), suggestion: 'IMG', name: '', other: false, expanded: false, collapsed: false },
  { files: [10], suggestion: '', name: '', other: true, expanded: false, collapsed: false },
];

test('open groups show their first rows and a footer counting the rest', () => {
  const { rows, matches } = groupRows(scan, groups, '');
  assert.equal(matches, 11);
  assert.deepEqual(
    rows.map((r) => r.type),
    ['head', ...Array(COLLAPSED_FILE_ROWS).fill('file'), 'foot', 'head', 'file', 'foot'],
  );
  const foot = rows[COLLAPSED_FILE_ROWS + 1];
  assert.equal(foot.type === 'foot' && foot.hidden, 10 - COLLAPSED_FILE_ROWS);
});

test('expanded groups show every file', () => {
  const { rows } = groupRows(scan, [{ ...groups[0], expanded: true }, groups[1]], '');
  assert.equal(rows.filter((r) => r.type === 'file').length, 11);
});

test('closed groups show only their header and footer', () => {
  const { rows, matches } = groupRows(scan, [{ ...groups[0], collapsed: true, expanded: true }, groups[1]], '');
  assert.equal(matches, 11);
  assert.deepEqual(
    rows.map((r) => r.type),
    ['head', 'foot', 'head', 'file', 'foot'],
  );
  const [head, foot] = rows;
  assert.equal(head.type === 'head' && head.collapsed, true);
  assert.equal(foot.type === 'foot' && (foot.hidden > 0 || foot.expanded), false);
});

test('a search opens closed groups to show their matches', () => {
  const { rows } = groupRows(scan, [{ ...groups[0], collapsed: true }, groups[1]], 'img_1');
  assert.deepEqual(
    rows.map((r) => r.type),
    ['head', 'file', 'foot'],
  );
});

test('search keeps matching files, drops empty groups and shows every match', () => {
  const { rows, matches } = groupRows(scan, groups, ' img_1 ');
  assert.equal(matches, 1);
  assert.deepEqual(
    rows.map((r) => r.type),
    ['head', 'file', 'foot'],
  );
  const { matches: none } = groupRows(scan, groups, 'zzz');
  assert.equal(none, 0);
});
