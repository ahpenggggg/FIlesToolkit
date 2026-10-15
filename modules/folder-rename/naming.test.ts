/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentPrefix, formatTargetName, planFolderNames, withPrefix } from './naming.ts';

test('zero-count segments are left out', () => {
  assert.equal(formatTargetName(1, 20), '1V20P');
  assert.equal(formatTargetName(0, 20), '20P');
  assert.equal(formatTargetName(22, 0), '22V');
  assert.equal(formatTargetName(0, 0), '0');
});

test('a prefix is joined with one underscore', () => {
  assert.equal(withPrefix(currentPrefix('JAMES'), '1V2P'), 'JAMES_1V2P');
  assert.equal(withPrefix(currentPrefix(' JAMES__ '), '1V2P'), 'JAMES_1V2P');
  assert.equal(withPrefix(currentPrefix(''), '1V2P'), '1V2P');
});

test('conflicting targets are skipped', () => {
  const planned = planFolderNames(
    {
      rootName: 'FFF',
      otherNames: new Set(['2p']),
      entries: [
        { uri: 'a', name: 'a', videos: 1, photos: 1 },
        { uri: 'b', name: 'b', videos: 1, photos: 1 },
        { uri: 'c', name: 'c', videos: 0, photos: 2 },
        { uri: 'd', name: '3V', videos: 3, photos: 0 },
        { uri: 'e', name: 'e', videos: 0, photos: 3 },
        { uri: 'f', name: '3P', videos: 0, photos: 5 },
      ],
    },
    '',
  );
  const conflict = Object.fromEntries(planned.map((p) => [p.name, p.conflict]));
  assert.equal(conflict.a, 'Another folder has the same media count');
  assert.equal(conflict.b, 'Another folder has the same media count');
  assert.equal(conflict.c, 'A file already uses this name');
  assert.equal(conflict['3V'], null);
  // "3P" is free once that folder becomes 5P, so e may take it.
  assert.equal(conflict.e, null);
  assert.equal(planned.find((p) => p.name === '3V')!.target, '3V');
});

test('a folder that stays put blocks others from taking its name', () => {
  const planned = planFolderNames(
    { rootName: 'FFF', otherNames: new Set(), entries: [{ uri: 'x', name: '2P', videos: 0, photos: 2 }, { uri: 'y', name: 'old', videos: 0, photos: 2 }] },
    '',
  );
  assert.equal(planned[0].conflict, 'Another folder has the same media count');
  assert.equal(planned[1].conflict, 'Another folder will keep this name');
});
