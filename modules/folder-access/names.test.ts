/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanNameInput, javaTrim } from './names.ts';
import { baseName, parentOf } from './paths.ts';

test('characters a name cannot hold are dropped as typed', () => {
  assert.equal(cleanNameInput('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij');
  assert.equal(cleanNameInput('tab\there\u0085'), 'tabhere');
  assert.equal(cleanNameInput('Holiday 2024 ✈️'), 'Holiday 2024 ✈️');
});

test('javaTrim strips control characters and spaces at both ends only', () => {
  assert.equal(javaTrim('\t JAMES \n'), 'JAMES');
  assert.equal(javaTrim('a b'), 'a b');
  assert.equal(javaTrim('\u00A0x\u00A0'), '\u00A0x\u00A0');
});

test('paths split into folder and name', () => {
  assert.equal(baseName('/storage/emulated/0/Download/a.zip'), 'a.zip');
  assert.equal(parentOf('/storage/emulated/0/Download/a.zip'), '/storage/emulated/0/Download');
  assert.equal(baseName('a.zip'), 'a.zip');
});
