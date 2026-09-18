// Purpose: Verifies manual fixed-set synchronization, mtime-size truth, exclusions, replacement, and failure preservation.

import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  ERROR_CODES,
  PROVIDERS,
  buildReviewCatalog,
  createFixedRunSet,
  createNormalizedSession,
  initializeOperationalManifest,
  persistSessionExclusion,
  runManualArchiveSync,
  setupArchiveDirectory,
  writeValidatedArchiveFile,
} from '../src/index.js';
import { createTemporaryHome, setFileTime } from './helpers.js';

const SESSION_ID = '12345678-1234-4abc-8def-1234567890ab';
const SECOND_SESSION_ID = '87654321-4321-4abc-8def-1234567890ab';
const SESSION_KEY = `codex:${SESSION_ID}`;
const NOW = '2026-08-02T12:00:00.000Z';

async function createCandidate(sourcePath, fullSessionId = SESSION_ID) {
  const sourceStat = await lstat(sourcePath);
  return {
    provider: PROVIDERS.CODEX,
    fullSessionId,
    shortSessionId: fullSessionId.slice(0, 8),
    sessionKey: `codex:${fullSessionId}`,
    sourcePath,
    providerProjectKey: 'invented-project',
    workspacePath: null,
    storageState: 'active',
    sourceStat: {
      mtimeMs: sourceStat.mtimeMs,
      sizeBytes: sourceStat.size,
      birthtimeMs: sourceStat.birthtimeMs,
    },
    sourceFormat: 'Invented JSONL',
    sourceSchemaVersion: 'test-v1',
    title: { value: 'Invented manual archive', source: 'invented test data' },
    activity: { timestamp: NOW, source: 'invented event timestamp', confidence: 'high' },
    completeness: { isComplete: true, warnings: [] },
    observations: [],
    metadata: {},
  };
}

function normalizedFromCandidate(candidate, answer = 'Invented answer') {
  return createNormalizedSession({
    provider: candidate.provider,
    fullSessionId: candidate.fullSessionId,
    source: {
      path: candidate.sourcePath,
      providerProjectKey: candidate.providerProjectKey,
      workspacePath: null,
      format: candidate.sourceFormat,
      schemaVersion: candidate.sourceSchemaVersion,
      observations: [],
    },
    title: candidate.title,
    activity: candidate.activity,
    events: [
      { type: 'user', content: 'Invented question' },
      { type: 'assistant', content: answer },
    ],
    completeness: candidate.completeness,
  });
}

function providerResults(candidate) {
  return [{
    provider: PROVIDERS.CODEX,
    status: 'ready',
    roots: {},
    sessions: [candidate],
    observations: [],
  }];
}

async function setupSync(testContext) {
  const temporaryHome = await createTemporaryHome(testContext);
  const selectedParent = path.join(temporaryHome, 'selected');
  const sourcePath = path.join(temporaryHome, 'provider', 'invented.jsonl');
  await mkdir(selectedParent);
  await mkdir(path.dirname(sourcePath));
  await writeFile(sourcePath, '{"invented":1}\n', 'utf8');
  await setFileTime(sourcePath, NOW);
  const archivePath = await setupArchiveDirectory(selectedParent);
  const initialized = await initializeOperationalManifest({
    appDataDirectory: path.join(temporaryHome, 'app-data'),
    archivePath,
    now: NOW,
  });
  return { temporaryHome, sourcePath, archivePath, initialized };
}

test('manual sync creates, recognizes unchanged, remembers exclusion, and safely replaces', async (testContext) => {
  const { sourcePath, initialized } = await setupSync(testContext);
  let candidate = await createCandidate(sourcePath);
  const adapterResolver = () => ({ normalizeSession: (item) => normalizedFromCandidate(item) });
  const first = await runManualArchiveSync({
    ...initialized,
    providerResults: providerResults(candidate),
    now: () => NOW,
    adapterResolver,
  });

  assert.equal(first.run.results.created, 1);
  assert.equal(first.run.filesChecked, 1);
  assert.equal(first.manifest.sessions[SESSION_KEY].outputPath.includes(`--${SESSION_ID.slice(0, 8)}--`), true);
  assert.equal(first.manifest.sessions[SESSION_KEY].outputPath.includes('2026-08-02T'), false);
  const stableOutputPath = first.manifest.sessions[SESSION_KEY].outputPath;

  await writeFile(sourcePath, '{"invented":9}\n', 'utf8');
  await setFileTime(sourcePath, NOW);
  const unchanged = await runManualArchiveSync({
    manifestPath: initialized.manifestPath,
    manifest: first.manifest,
    providerResults: providerResults(candidate),
    now: () => NOW,
    adapterResolver,
  });
  assert.equal(unchanged.run.results.unchanged, 1);
  assert.deepEqual(unchanged.fixedRunSessionKeys, []);

  await writeFile(sourcePath, '{"invented":2,"changed":true}\n', 'utf8');
  await setFileTime(sourcePath, '2026-08-02T12:10:00.000Z');
  candidate = await createCandidate(sourcePath);
  const excludedManifest = await persistSessionExclusion({
    manifestPath: initialized.manifestPath,
    manifest: unchanged.manifest,
    sessionKey: SESSION_KEY,
    excluded: true,
    now: '2026-08-02T12:10:00.000Z',
  });
  const excluded = await runManualArchiveSync({
    manifestPath: initialized.manifestPath,
    manifest: excludedManifest,
    providerResults: providerResults(candidate),
    now: () => '2026-08-02T12:11:00.000Z',
    adapterResolver,
  });
  assert.equal(excluded.run.results.excluded, 1);
  assert.deepEqual(excluded.fixedRunSessionKeys, []);
  assert.equal(excluded.manifest.sessions[SESSION_KEY].excluded, true);

  const includedManifest = await persistSessionExclusion({
    manifestPath: initialized.manifestPath,
    manifest: excluded.manifest,
    sessionKey: SESSION_KEY,
    excluded: false,
    now: '2026-08-02T12:12:00.000Z',
  });
  const replaced = await runManualArchiveSync({
    manifestPath: initialized.manifestPath,
    manifest: includedManifest,
    providerResults: providerResults(candidate),
    now: () => '2026-08-02T12:13:00.000Z',
    adapterResolver,
  });
  assert.equal(replaced.run.results.replaced, 1);
  assert.equal(replaced.manifest.sessions[SESSION_KEY].outputPath, stableOutputPath);
  assert.equal(replaced.manifest.runs.length, 4);
});

test('a source mutation during normalization fails safely and preserves the previous archive', async (testContext) => {
  const { sourcePath, initialized } = await setupSync(testContext);
  let candidate = await createCandidate(sourcePath);
  const normalAdapter = () => ({ normalizeSession: (item) => normalizedFromCandidate(item) });
  const first = await runManualArchiveSync({
    ...initialized,
    providerResults: providerResults(candidate),
    now: () => NOW,
    adapterResolver: normalAdapter,
  });
  const outputPath = first.manifest.sessions[SESSION_KEY].outputPath;
  const previousMarkdown = await readFile(outputPath, 'utf8');

  await writeFile(sourcePath, '{"invented":2}\n', 'utf8');
  await setFileTime(sourcePath, '2026-08-02T12:20:00.000Z');
  candidate = await createCandidate(sourcePath);
  const racingAdapter = () => ({
    normalizeSession: async (item) => {
      await writeFile(sourcePath, '{"invented":3,"changed-during-read":true}\n', 'utf8');
      return normalizedFromCandidate(item, 'This output must never replace the previous archive.');
    },
  });
  const failed = await runManualArchiveSync({
    manifestPath: initialized.manifestPath,
    manifest: first.manifest,
    providerResults: providerResults(candidate),
    now: () => '2026-08-02T12:21:00.000Z',
    adapterResolver: racingAdapter,
  });

  assert.equal(failed.run.status, 'failed');
  assert.equal(failed.run.results.failed, 1);
  assert.equal(failed.failures[0].code, ERROR_CODES.SOURCE_READ_FAILED);
  assert.equal(await readFile(outputPath, 'utf8'), previousMarkdown);
  assert.equal(failed.manifest.sessions[SESSION_KEY].lastSuccessfulExportAt, NOW);
});

test('the fixed run set does not absorb a candidate discovered during processing', async (testContext) => {
  const { temporaryHome, sourcePath, initialized } = await setupSync(testContext);
  const firstCandidate = await createCandidate(sourcePath);
  const secondSource = path.join(temporaryHome, 'provider', 'second.jsonl');
  await writeFile(secondSource, '{"invented":2}\n', 'utf8');
  await setFileTime(secondSource, NOW);
  const secondCandidate = await createCandidate(secondSource, SECOND_SESSION_ID);
  const results = providerResults(firstCandidate);
  const adapterResolver = () => ({
    normalizeSession: (item) => {
      results[0].sessions.push(secondCandidate);
      return normalizedFromCandidate(item);
    },
  });

  const synced = await runManualArchiveSync({
    ...initialized,
    providerResults: results,
    now: () => NOW,
    adapterResolver,
  });
  assert.deepEqual(synced.fixedRunSessionKeys, [SESSION_KEY]);
  assert.equal(synced.manifest.sessions[`codex:${SECOND_SESSION_ID}`], undefined);
});

test('cataloging is read-only and writer validation preserves an existing Markdown file', async (testContext) => {
  const { sourcePath, archivePath, initialized } = await setupSync(testContext);
  const candidate = await createCandidate(sourcePath);
  const review = await buildReviewCatalog(initialized.manifest, providerResults(candidate));
  assert.equal(review.counts.pending, 1);
  assert.equal(review.items[0].sizeBytes, null);
  assert.equal(review.items[0].processedAt, null);

  const existingPath = path.join(archivePath, 'existing.md');
  await writeFile(existingPath, 'previous valid placeholder', 'utf8');
  await assert.rejects(
    () => writeValidatedArchiveFile({
      archivePath,
      destinationPath: existingPath,
      markdown: 'invalid replacement',
      envelope: {},
    }),
    (error) => error.code === ERROR_CODES.INVALID_MARKDOWN_CONTRACT,
  );
  assert.equal(await readFile(existingPath, 'utf8'), 'previous valid placeholder');
});

test('catalog truth and fixed-run selection remain complete with 300 invented conversations', async (testContext) => {
  const { sourcePath, initialized } = await setupSync(testContext);
  const candidates = [];
  for (let index = 0; index < 300; index += 1) {
    const fullSessionId = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    candidates.push(await createCandidate(sourcePath, fullSessionId));
  }
  const results = providerResults(candidates[0]);
  results[0].sessions = candidates;

  const review = await buildReviewCatalog(initialized.manifest, results);
  assert.deepEqual(review.counts, { pending: 300, synced: 0, all: 300 });
  assert.equal(createFixedRunSet(review).length, 300);
  assert.equal(review.items.every((item) => item.status === 'new'), true);
});

test('checkpointEvery persists the manifest mid-run and the default keeps a single final save', async (testContext) => {
  const { sourcePath, initialized } = await setupSync(testContext);
  const candidate = await createCandidate(sourcePath);
  const adapterResolver = () => ({ normalizeSession: (item) => normalizedFromCandidate(item) });

  // Default: exactly one manifest write, at the end (the app's original behavior).
  const singleWrites = [];
  const single = await runManualArchiveSync({
    ...initialized,
    providerResults: providerResults(candidate),
    now: () => NOW,
    adapterResolver,
    manifestWriter: async (manifestPath, manifest) => { singleWrites.push(structuredClone(manifest)); },
  });
  assert.equal(single.run.results.created, 1);
  assert.equal(singleWrites.length, 1);
  assert.deepEqual(single.checkpoints, { every: 0, failed: 0, lastError: null });

  // checkpointEvery=1: a write after the export (without the run record) plus the final write (with it).
  const checkpointWrites = [];
  const checkpointed = await runManualArchiveSync({
    manifestPath: initialized.manifestPath,
    manifest: initialized.manifest,
    providerResults: providerResults(candidate),
    now: () => NOW,
    adapterResolver,
    checkpointEvery: 1,
    manifestWriter: async (manifestPath, manifest) => { checkpointWrites.push(structuredClone(manifest)); },
  });
  assert.equal(checkpointed.run.results.replaced, 1);
  assert.equal(checkpointWrites.length, 2);
  assert.equal(checkpointWrites[0].sessions[SESSION_KEY].lastSuccessfulExportAt, NOW);
  assert.equal(checkpointWrites[0].runs.length, initialized.manifest.runs.length);
  assert.equal(checkpointWrites[1].runs.length, initialized.manifest.runs.length + 1);
  assert.deepEqual(checkpointed.checkpoints, { every: 1, failed: 0, lastError: null });

  // A failing checkpoint does not fail the export; the final save still happens and the failure is reported.
  let calls = 0;
  const flaky = await runManualArchiveSync({
    manifestPath: initialized.manifestPath,
    manifest: initialized.manifest,
    providerResults: providerResults(candidate),
    now: () => NOW,
    adapterResolver,
    checkpointEvery: 1,
    manifestWriter: async () => { calls += 1; if (calls === 1) throw new Error('disk hiccup'); },
  });
  assert.equal(flaky.run.results.replaced, 1);
  assert.equal(flaky.run.results.failed, 0);
  assert.equal(calls, 2);
  assert.equal(flaky.checkpoints.failed, 1);
  assert.equal(flaky.checkpoints.lastError.code, ERROR_CODES.SOURCE_READ_FAILED);

  await assert.rejects(
    () => runManualArchiveSync({ ...initialized, providerResults: providerResults(candidate), checkpointEvery: -1 }),
    (error) => error.code === ERROR_CODES.INVALID_INPUT,
  );
});
