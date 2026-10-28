/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorMessage, isCancelled } from './errors.ts';
import { listSummary, plural } from './format.ts';
import { toggled } from './sets.ts';

test('plural picks the word for the count', () => {
  assert.equal(plural(1, 'file'), '1 file');
  assert.equal(plural(0, 'file'), '0 files');
  assert.equal(plural(3, 'folder has', 'folders have'), '3 folders have');
});

test('listSummary names the first two and counts the rest', () => {
  assert.equal(listSummary(['a']), 'a');
  assert.equal(listSummary(['a', 'b']), 'a, b');
  assert.equal(listSummary(['a', 'b', 'c', 'd']), 'a, b +2 more');
});

test('errorMessage reads a rejection', () => {
  assert.equal(errorMessage(new Error('Disk full')), 'Disk full');
  assert.equal(errorMessage('plain'), 'plain');
  assert.equal(errorMessage({}, 'Wrong password.'), 'Wrong password.');
  assert.equal(errorMessage(null), 'null');
  assert.equal(isCancelled({ code: 'E_CANCELLED' }), true);
  assert.equal(isCancelled(new Error('x')), false);
});

test('toggled adds or removes without changing the original', () => {
  const start = new Set(['a']);
  assert.deepEqual([...toggled(start, 'b')], ['a', 'b']);
  assert.deepEqual([...toggled(start, 'a')], []);
  assert.deepEqual([...start], ['a']);
});
