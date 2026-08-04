// Purpose: Verifies first-run setup and renderer-safe desktop service responses using invented temporary state only.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCaptureAppService } from '../src/main/app-service.js';

function emptyProviderResults() {
  return [
    { provider: 'claude-code', status: 'not-found', roots: { private: '/not-returned' }, sessions: [], observations: [] },
    { provider: 'codex', status: 'not-found', roots: { private: '/not-returned' }, sessions: [], observations: [] },
    { provider: 'cursor', status: 'not-found', roots: { private: '/not-returned' }, sessions: [], observations: [] },
  ];
}

test('desktop service creates the standardized archive and returns content-free safe state', async (testContext) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'grasppy-capture-desktop-test-'));
  testContext.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const selectedParent = path.join(temporaryRoot, 'selected');
  await mkdir(selectedParent);
  const service = createCaptureAppService({
    appDataDirectory: path.join(temporaryRoot, 'app-data'),
    catalogFunction: async () => emptyProviderResults(),
  });

  assert.deepEqual(await service.getStatus(), { configured: false });
  const setup = await service.setup(selectedParent);
  assert.equal(path.basename(setup.archivePath), 'GRASPPY Capture Archive');
  assert.equal(setup.dashboard.currentArchive.fileCount, 0);

  const refreshed = await service.refreshCatalog();
  assert.deepEqual(refreshed.catalog.counts, { pending: 0, synced: 0, all: 0 });
  assert.equal(refreshed.catalog.providers.length, 3);
  assert.equal(JSON.stringify(refreshed).includes('/not-returned'), false);

  const synced = await service.syncArchive();
  assert.equal(synced.run.status, 'success');
  assert.equal(synced.run.filesChecked, 0);
  assert.equal(synced.dashboard.recentRuns.length, 1);
  await assert.rejects(
    () => service.getArchivedSessionPath('codex:00000000-0000-4000-8000-000000000001'),
    /No archived Markdown/,
  );
});
