/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archiveBaseName, defaultZipName, isArchiveName, splitBytes } from './naming.ts';

test('only first RAR volumes and known archives are offered', () => {
  assert.equal(isArchiveName('Photos.zip'), true);
  assert.equal(isArchiveName('Photos.RAR'), true);
  assert.equal(isArchiveName('Photos.part1.rar'), true);
  assert.equal(isArchiveName('Photos.part01.rar'), true);
  assert.equal(isArchiveName('Photos.part2.rar'), false);
  assert.equal(isArchiveName('Photos.z01'), false);
  assert.equal(isArchiveName('backup.tar.gz'), true);
  assert.equal(isArchiveName('notes.txt'), false);
  assert.equal(isArchiveName('myfile.zip.001'), true);
  assert.equal(isArchiveName('myfile.zip.002'), false);
  assert.equal(isArchiveName('myfile.rar.001'), true);
  assert.equal(isArchiveName('myfile.7z.0001'), true);
  assert.equal(isArchiveName('myfile.7z.010'), false);
});

test('archive extensions are dropped for the folder name', () => {
  assert.equal(archiveBaseName('Photos.part1.rar'), 'Photos');
  assert.equal(archiveBaseName('backup.tar.gz'), 'backup');
  assert.equal(archiveBaseName('Trip 2024.zip'), 'Trip 2024');
  assert.equal(archiveBaseName('myfile.zip.001'), 'myfile');
  assert.equal(archiveBaseName('myfile.rar.001'), 'myfile');
  assert.equal(archiveBaseName('.zip'), '.zip');
});

test('a new ZIP is named after its item or their folder', () => {
  assert.equal(defaultZipName(['/s/Download/report.pdf']), 'report');
  assert.equal(defaultZipName(['/s/Download/Photos']), 'Photos');
  assert.equal(defaultZipName(['/s/Download/a.jpg', '/s/Download/b.jpg']), 'Download');
  assert.equal(defaultZipName([]), '');
});

test('part sizes', () => {
  assert.equal(splitBytes('100', ''), 100 * 1024 * 1024);
  assert.equal(splitBytes('custom', '2.5'), Math.round(2.5 * 1024 * 1024));
  assert.equal(splitBytes('custom', '0.5'), null);
  assert.equal(splitBytes('custom', 'abc'), null);
});
