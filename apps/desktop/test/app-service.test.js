// Purpose: Verifies first-run setup and renderer-safe desktop service responses using invented temporary state only.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { discoverCodexSessions } from '../../../packages/capture-core/src/index.js';
import { createCaptureAppService } from '../src/main/app-service.js';

const STARTUP_SESSION_ID = '11111111-1111-4111-8111-111111111111';
const LATER_SESSION_ID = '22222222-2222-4222-8222-222222222222';
const EXCLUDED_SESSION_ID = '33333333-3333-4333-8333-333333333333';

function emptyProviderResults() {
  return [
    { provider: 'claude-code', status: 'not-found', roots: { private: '/not-returned' }, sessions: [], observations: [] },
    { provider: 'codex', status: 'not-found', roots: { private: '/not-returned' }, sessions: [], observations: [] },
    { provider: 'cursor', status: 'not-found', roots: { private: '/not-returned' }, sessions: [], observations: [] },
  ];
}

// An invented Codex rollout — no repository transcript fixtures.
async function writeInventedCodexSession(codexRoot, fullSessionId) {
  const records = [
    { timestamp: '2026-08-09T10:00:00.000Z', type: 'session_meta', payload: { id: fullSessionId, cwd: '/invented/workspace', cli_version: 'test-version' } },
    { timestamp: '2026-08-09T10:01:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Invented question.' }] } },
    { timestamp: '2026-08-09T10:02:00.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Invented answer.' }] } },
  ];
  const filePath = path.join(codexRoot, 'sessions', '2026', '08', '09', `rollout-2026-08-09T10-00-00-${fullSessionId}.jsonl`);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  return filePath;
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

// Regression: Sync Now used to reuse the catalog snapshot taken when the window
// opened, so a conversation started afterwards was never in the run set. The app
// reported "up to date" while that conversation sat Pending — for days.
test('sync exports a conversation that started after the first catalog', async (testContext) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'grasppy-capture-stale-catalog-test-'));
  testContext.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const selectedParent = path.join(temporaryRoot, 'selected');
  const codexRoot = path.join(temporaryRoot, '.codex');
  await mkdir(selectedParent);
  await writeInventedCodexSession(codexRoot, STARTUP_SESSION_ID);

  const service = createCaptureAppService({
    appDataDirectory: path.join(temporaryRoot, 'app-data'),
    // Rescans the invented tree on every call, exactly as the real
    // catalogProviders rescans the provider folders on every call.
    catalogFunction: async (options) => [
      await discoverCodexSessions({ ...options, homeDirectory: temporaryRoot, codexRoot }),
    ],
  });

  await service.setup(selectedParent);
  // The renderer catalogs once when the window opens. That is the snapshot the
  // bug froze; everything after this point happens without a restart.
  const startup = await service.refreshCatalog();
  assert.equal(startup.catalog.counts.all, 1);

  await writeInventedCodexSession(codexRoot, LATER_SESSION_ID);

  const synced = await service.syncArchive();
  assert.equal(synced.run.status, 'success');
  assert.equal(synced.run.results.created, 2);
  assert.equal(synced.run.results.unavailable, 0);
  assert.equal(synced.catalog.counts.pending, 0);

  const laterKey = `codex:${LATER_SESSION_ID}`;
  const laterItem = synced.catalog.items.find((item) => item.sessionKey === laterKey);
  assert.equal(laterItem?.syncState, 'synced');
  // The Markdown is the only thing Grasppy reads, so prove it is really on disk.
  assert.equal(path.extname(await service.getArchivedSessionPath(laterKey)), '.md');
});

// setExclusion reuses the same cached catalog, but it only shapes the table it
// returns — the preference itself is written against a freshly read manifest,
// and the next sync re-catalogs and honors it. Excluding stays a decision about
// a conversation, never a way to lose one.
test('an exclusion saved against an older catalog still governs the next sync', async (testContext) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'grasppy-capture-exclusion-test-'));
  testContext.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const selectedParent = path.join(temporaryRoot, 'selected');
  const codexRoot = path.join(temporaryRoot, '.codex');
  await mkdir(selectedParent);
  await writeInventedCodexSession(codexRoot, STARTUP_SESSION_ID);
  await writeInventedCodexSession(codexRoot, EXCLUDED_SESSION_ID);

  const service = createCaptureAppService({
    appDataDirectory: path.join(temporaryRoot, 'app-data'),
    catalogFunction: async (options) => [
      await discoverCodexSessions({ ...options, homeDirectory: temporaryRoot, codexRoot }),
    ],
  });

  await service.setup(selectedParent);
  await service.refreshCatalog();
  await writeInventedCodexSession(codexRoot, LATER_SESSION_ID);

  const excludedKey = `codex:${EXCLUDED_SESSION_ID}`;
  const saved = await service.setExclusion(excludedKey, true);
  assert.equal(saved.saved, true);

  const synced = await service.syncArchive();
  assert.equal(synced.run.status, 'success');
  assert.equal(synced.run.results.excluded, 1);
  assert.equal(synced.run.results.created, 2);
  assert.equal(synced.catalog.items.find((item) => item.sessionKey === excludedKey)?.excluded, true);
  await assert.rejects(() => service.getArchivedSessionPath(excludedKey), /No archived Markdown/);
});
