// Purpose: Verifies operational-manifest initialization, atomic persistence, exclusions, and archive ownership checks.

import assert from 'node:assert/strict';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  ERROR_CODES,
  initializeOperationalManifest,
  persistSessionExclusion,
  saveOperationalManifest,
  setupArchiveDirectory,
} from '../src/index.js';
import { createTemporaryHome } from './helpers.js';

const SESSION_ID = '12345678-1234-4abc-8def-1234567890ab';
const SESSION_KEY = `codex:${SESSION_ID}`;
const NOW = '2026-08-02T12:00:00.000Z';

test('manifest persists ordinary bookkeeping and remembered exclusions outside the archive', async (testContext) => {
  const temporaryHome = await createTemporaryHome(testContext);
  const selectedParent = path.join(temporaryHome, 'selected');
  const appDataDirectory = path.join(temporaryHome, 'app-data');
  await mkdir(selectedParent);
  const archivePath = await setupArchiveDirectory(selectedParent);
  const initialized = await initializeOperationalManifest({ appDataDirectory, archivePath, now: NOW });

  initialized.manifest.sessions[SESSION_KEY] = {
    provider: 'codex',
    fullSessionId: SESSION_ID,
    sourcePath: path.join(temporaryHome, 'invented.jsonl'),
    sourceMtimeMs: 0,
    sourceSizeBytes: 0,
    outputPath: null,
    formatVersion: null,
    lastSuccessfulExportAt: null,
    lastMarkdownSizeBytes: null,
    excluded: false,
  };
  await saveOperationalManifest(initialized.manifestPath, initialized.manifest);
  const excluded = await persistSessionExclusion({
    manifestPath: initialized.manifestPath,
    manifest: initialized.manifest,
    sessionKey: SESSION_KEY,
    excluded: true,
    now: '2026-08-02T12:01:00.000Z',
  });

  const persisted = JSON.parse(await readFile(initialized.manifestPath, 'utf8'));
  assert.equal(excluded.sessions[SESSION_KEY].excluded, true);
  assert.equal(persisted.sessions[SESSION_KEY].excluded, true);
  assert.equal(persisted.updatedAt, '2026-08-02T12:01:00.000Z');
  assert.equal(path.dirname(initialized.manifestPath), await realpath(appDataDirectory));
  assert.notEqual(path.dirname(initialized.manifestPath), archivePath);
});

test('existing application data cannot silently switch to a different archive', async (testContext) => {
  const temporaryHome = await createTemporaryHome(testContext);
  const firstParent = path.join(temporaryHome, 'first');
  const secondParent = path.join(temporaryHome, 'second');
  const appDataDirectory = path.join(temporaryHome, 'app-data');
  await mkdir(firstParent);
  await mkdir(secondParent);
  const firstArchive = await setupArchiveDirectory(firstParent);
  const secondArchive = await setupArchiveDirectory(secondParent);
  await initializeOperationalManifest({ appDataDirectory, archivePath: firstArchive, now: NOW });

  await assert.rejects(
    () => initializeOperationalManifest({ appDataDirectory, archivePath: secondArchive, now: NOW }),
    (error) => error.code === ERROR_CODES.INVALID_MANIFEST,
  );
});
