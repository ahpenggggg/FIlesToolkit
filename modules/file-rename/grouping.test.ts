/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignTargets, extensionOf, group, naturalCompare, stemOf, suggestionFor, takePatternless } from './grouping.ts';

const groupNames = (names: string[], strict: boolean, minGroupSize = 2) => {
  const stems = names.map(stemOf);
  const groups = group(stems, strict);
  const others = takePatternless(groups, stems, minGroupSize);
  return { groups: groups.map((g) => g.map((i) => names[i])), others: others.map((i) => names[i]) };
};

test('stems keep letters only, lower-cased, repeats collapsed', () => {
  assert.equal(stemOf('photo1.jpg'), 'photo');
  assert.equal(stemOf('photooo123.jpg'), 'photo');
  assert.equal(stemOf('photo-233.png'), 'photo');
  assert.equal(stemOf('photobooth~1.jpg'), 'photoboth');
});

test('strict match groups only the same letter pattern', () => {
  const { groups, others } = groupNames(['own.jpg', 'ownnnn.jpg', 'ownn_.jpg', 'ownxlee.jpg', 'ownxbob.jpg', 'ownxlee2.jpg', 'ownxbob2.jpg'], true);
  assert.deepEqual(groups, [['own.jpg', 'ownnnn.jpg', 'ownn_.jpg'], ['ownxlee.jpg', 'ownxlee2.jpg'], ['ownxbob.jpg', 'ownxbob2.jpg']]);
  assert.deepEqual(others, []);
  assert.notEqual(stemOf('IMG_123.jpg'), stemOf('Img 12002-wa-223.jpg'));
});

test('loose match also groups names that start alike', () => {
  const { groups } = groupNames(['file1.txt', 'fileee12.txt', 'file(2).txt', 'filexyz~1.txt'], false);
  assert.deepEqual(groups, [['file1.txt', 'fileee12.txt', 'file(2).txt', 'filexyz~1.txt']]);
});

test('single files and names with under two letters go to Other files', () => {
  const { groups, others } = groupNames(['a1.jpg', 'x_2024.jpg', '2024.jpg', 'cat1.jpg', 'cat2.jpg', 'dog.jpg'], true);
  assert.deepEqual(groups, [['cat1.jpg', 'cat2.jpg']]);
  assert.deepEqual(others, ['a1.jpg', 'x_2024.jpg', '2024.jpg', 'dog.jpg']);
});

test('gathering small groups moves groups under the size into Other files', () => {
  const big = ['p1', 'p2', 'p3', 'p4', 'p5'].map((n) => `photo${n}.jpg`);
  const { groups, others } = groupNames([...big, 'cat1.jpg', 'cat2.jpg'], true, 5);
  assert.deepEqual(groups, [big]);
  assert.deepEqual(others, ['cat1.jpg', 'cat2.jpg']);
});

test('suggestion comes from the shortest stem', () => {
  assert.equal(suggestionFor(['photo(1).jpg', 'photobooth2.jpg']), 'Photo');
  assert.equal(suggestionFor(['2024.jpg']), '');
});

test('extensions are kept, compound archive ones whole', () => {
  assert.equal(extensionOf('photo.JPG'), '.JPG');
  assert.equal(extensionOf('backup.tar.gz'), '.tar.gz');
  assert.equal(extensionOf('.hidden'), '');
  assert.equal(extensionOf('trailing.'), '');
});

test('targets are numbered per name, skipping taken numbers', () => {
  const names = ['a.jpg', 'b.mp4', 'c.png', 'solo.txt'];
  const targets = assignTargets(['Name', 'Name', 'name', 'Solo'], names, new Set(['name_00002.mp4']));
  assert.deepEqual(targets, ['Name_00001.jpg', 'Name_00003.mp4', 'name_00004.png', 'Solo.txt']);
  assert.deepEqual(assignTargets([null, 'X'], ['keep.jpg', 'y.jpg'], new Set()), [null, 'X.jpg']);
  assert.deepEqual(assignTargets(['X'], ['y.jpg'], new Set(['x.jpg'])), ['X_00001.jpg']);
});

test('natural order compares digit runs by value', () => {
  const sorted = ['file10.jpg', 'File2.jpg', 'file1.jpg', 'file002.jpg'].sort(naturalCompare);
  assert.deepEqual(sorted, ['file1.jpg', 'File2.jpg', 'file002.jpg', 'file10.jpg']);
});

test('assignTargets widens the numbers past 99999 so the whole sequence keeps one width', () => {
  const count = 100_000;
  const targets = assignTargets(Array(count).fill('A'), Array(count).fill('f.jpg'), new Set());
  assert.equal(targets[0], 'A_000001.jpg');
  assert.equal(targets[count - 1], 'A_100000.jpg');
  // Skipped numbers can push a sequence that starts at 5 digits past 99999 too.
  const occupied = new Set(['b_00001.jpg', 'b_00002.jpg']);
  const big = assignTargets(Array(99_999).fill('B'), Array(99_999).fill('f.jpg'), occupied);
  assert.equal(big[0], 'B_000001.jpg');
  assert.equal(big[big.length - 1], 'B_099999.jpg');
});
