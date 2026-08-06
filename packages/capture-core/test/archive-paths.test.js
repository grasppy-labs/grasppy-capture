// Purpose: Verifies standardized archive setup, canonical containment, symlink rejection, and stable filename rules.

import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  ARCHIVE_DIRECTORY_NAME,
  ERROR_CODES,
  createStableArchiveFilename,
  resolveContainedArchiveFile,
  setupArchiveDirectory,
} from '../src/index.js';
import { createTemporaryHome } from './helpers.js';

const SESSION_ID = '12345678-1234-4abc-8def-1234567890ab';

test('archive setup creates the exact standardized leaf and rejects symlink destinations', async (testContext) => {
  const temporaryHome = await createTemporaryHome(testContext);
  const selectedParent = path.join(temporaryHome, 'selected');
  await mkdir(selectedParent);

  const archivePath = await setupArchiveDirectory(selectedParent);
  assert.equal(path.basename(archivePath), ARCHIVE_DIRECTORY_NAME);

  const unsafeParent = path.join(temporaryHome, 'unsafe');
  const outside = path.join(temporaryHome, 'outside');
  await mkdir(unsafeParent);
  await mkdir(outside);
  await symlink(outside, path.join(unsafeParent, ARCHIVE_DIRECTORY_NAME));
  await assert.rejects(
    () => setupArchiveDirectory(unsafeParent),
    (error) => error.code === ERROR_CODES.ARCHIVE_UNAVAILABLE,
  );
});

test('archive output containment rejects traversal and existing symlink files', async (testContext) => {
  const temporaryHome = await createTemporaryHome(testContext);
  const selectedParent = path.join(temporaryHome, 'selected');
  await mkdir(selectedParent);
  const archivePath = await setupArchiveDirectory(selectedParent);
  const outsideFile = path.join(selectedParent, 'outside.md');
  await writeFile(outsideFile, 'outside', 'utf8');

  await assert.rejects(
    () => resolveContainedArchiveFile(archivePath, outsideFile),
    (error) => error.code === ERROR_CODES.ARCHIVE_UNAVAILABLE,
  );

  const linkedFile = path.join(archivePath, 'linked.md');
  await symlink(outsideFile, linkedFile);
  await assert.rejects(
    () => resolveContainedArchiveFile(archivePath, linkedFile),
    (error) => error.code === ERROR_CODES.ARCHIVE_UNAVAILABLE,
  );
});

test('stable filenames lead with provider then fixed-slot short id, omit dates, and sanitize hostile labels', () => {
  const filename = createStableArchiveFilename({
    provider: 'codex',
    title: 'CON: Quarterly / archive? 2026.08.02.',
    fullSessionId: SESSION_ID,
  });

  assert.equal(filename.startsWith('codex--12345678--'), true);
  assert.equal(filename.includes(SESSION_ID), false); // full uuid lives in the file header, not the name
  assert.equal(filename.includes('/'), false);
  assert.equal(filename.includes('?'), false);
  assert.equal(filename.includes('2026-08-02T'), false);
  assert.match(filename, /^(claude-code|codex|cursor)--[0-9a-f]{8}--/);
  assert.equal(filename, createStableArchiveFilename({
    provider: 'codex',
    title: 'CON: Quarterly / archive? 2026.08.02.',
    fullSessionId: SESSION_ID,
  }));
});

test('id segment escalates cleanly and labels can never contain the -- separator', () => {
  assert.equal(
    createStableArchiveFilename({ provider: 'codex', title: 'x', fullSessionId: SESSION_ID, idLength: 12 })
      .startsWith('codex--123456781234--'),
    true,
  );
  assert.equal(
    createStableArchiveFilename({ provider: 'codex', title: 'x', fullSessionId: SESSION_ID, idLength: 36 })
      .startsWith(`codex--${SESSION_ID}--`),
    true,
  );
  const hostile = createStableArchiveFilename({
    provider: 'claude-code',
    title: 'A -- B ---- C — D    E' + 'y'.repeat(200),
    fullSessionId: SESSION_ID,
  });
  const label = hostile.replace(/^claude-code--[0-9a-f]{8}--/, '').replace(/\.md$/, '');
  assert.equal(label.includes('--'), false);
  assert.equal(label.length <= 60, true);
});
