// Purpose: Verifies Dashboard totals, provider breakdown, calendar aggregation, and invalid-output exclusion.

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  PROVIDERS,
  buildDashboardState,
  createEmptyOperationalManifest,
  createNormalizedSession,
  renderCaptureMarkdown,
  setupArchiveDirectory,
  writeValidatedArchiveFile,
} from '../src/index.js';
import { createTemporaryHome } from './helpers.js';

const FIRST_ID = '12345678-1234-4abc-8def-1234567890ab';
const SECOND_ID = '87654321-4321-4abc-8def-1234567890ab';
const NOW = '2026-08-02T12:00:00.000Z';

function session(provider, fullSessionId, sourcePath) {
  return createNormalizedSession({
    provider,
    fullSessionId,
    source: {
      path: sourcePath,
      providerProjectKey: 'invented',
      workspacePath: null,
      format: 'Invented JSONL',
      schemaVersion: 'test-v1',
      observations: [],
    },
    title: { value: 'Invented dashboard row', source: 'invented test data' },
    activity: { timestamp: NOW, source: 'invented event timestamp', confidence: 'high' },
    events: [
      { type: 'user', content: 'Invented question' },
      { type: 'assistant', content: 'Invented answer' },
    ],
    completeness: { isComplete: true, warnings: [] },
  });
}

function results(overrides = {}) {
  return {
    created: 0,
    replaced: 0,
    unchanged: 0,
    unavailable: 0,
    excluded: 0,
    skipped: 0,
    failed: 0,
    ...overrides,
  };
}

test('dashboard reconciles current validated files and completed-run history', async (testContext) => {
  const temporaryHome = await createTemporaryHome(testContext);
  const selectedParent = path.join(temporaryHome, 'selected');
  await mkdir(selectedParent);
  const archivePath = await setupArchiveDirectory(selectedParent);
  const manifest = createEmptyOperationalManifest({ archivePath, now: NOW });

  for (const [provider, fullSessionId] of [
    [PROVIDERS.CODEX, FIRST_ID],
    [PROVIDERS.CLAUDE_CODE, SECOND_ID],
  ]) {
    const normalized = session(provider, fullSessionId, path.join(temporaryHome, `${provider}.jsonl`));
    const rendered = renderCaptureMarkdown(normalized, { exportedAt: NOW });
    const written = await writeValidatedArchiveFile({
      archivePath,
      destinationPath: path.join(archivePath, `${provider}--${fullSessionId}.md`),
      markdown: rendered.markdown,
      envelope: rendered.envelope,
    });
    manifest.sessions[`${provider}:${fullSessionId}`] = {
      provider,
      fullSessionId,
      sourcePath: normalized.source.path,
      sourceMtimeMs: 100,
      sourceSizeBytes: 200,
      outputPath: written.outputPath,
      formatVersion: 1,
      lastSuccessfulExportAt: NOW,
      lastMarkdownSizeBytes: written.sizeBytes,
      excluded: false,
    };
  }

  manifest.runs.push(
    {
      runId: 'run-1',
      startedAt: '2026-08-01T10:00:00.000Z',
      completedAt: '2026-08-01T10:01:00.000Z',
      status: 'success',
      providers: [PROVIDERS.CODEX],
      filesChecked: 3,
      bytesWritten: 500,
      results: results({ created: 1, unchanged: 2 }),
    },
    {
      runId: 'run-2',
      startedAt: '2026-08-02T10:00:00.000Z',
      completedAt: '2026-08-02T10:01:00.000Z',
      status: 'partial-failure',
      providers: [PROVIDERS.CODEX, PROVIDERS.CLAUDE_CODE],
      filesChecked: 4,
      bytesWritten: 700,
      results: results({ created: 1, replaced: 1, unchanged: 1, failed: 1 }),
    },
  );

  const dashboard = await buildDashboardState(manifest);
  assert.equal(dashboard.currentArchive.fileCount, 2);
  assert.equal(dashboard.currentArchive.invalidFiles, 0);
  assert.equal(dashboard.providers.find((row) => row.provider === PROVIDERS.CODEX).fileCount, 1);
  assert.equal(dashboard.providers.find((row) => row.provider === PROVIDERS.CURSOR).fileCount, 0);
  assert.equal(dashboard.calendar[1].date, '2026-08-02');
  assert.equal(dashboard.calendar[1].filesProcessed, 3);
  assert.equal(dashboard.calendar[1].providerCount, 2);
  assert.equal(dashboard.lastSync.runId, 'run-2');
  assert.deepEqual(dashboard.recentRuns.map((run) => run.runId), ['run-2', 'run-1']);

  const tamperedPath = manifest.sessions[`codex:${FIRST_ID}`].outputPath;
  await writeFile(tamperedPath, 'tampered archive', 'utf8');
  const afterTamper = await buildDashboardState(manifest);
  assert.equal(afterTamper.currentArchive.fileCount, 1);
  assert.equal(afterTamper.currentArchive.invalidFiles, 1);
});
