/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanNameInput } from './names.ts';

test('characters a name cannot hold are dropped as typed', () => {
  assert.equal(cleanNameInput('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij');
  assert.equal(cleanNameInput('tab\there\u0085'), 'tabhere');
  assert.equal(cleanNameInput('Holiday 2024 ✈️'), 'Holiday 2024 ✈️');
});
