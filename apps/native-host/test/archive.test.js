// Purpose: Verifies atomic browser saves, stable identity, replay semantics, locking, and preservation on failure.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  NativeHostError,
  NATIVE_ERROR_CODES,
  loadBrowserManifest,
  saveBrowserArchiveRequest,
  validateBrowserCaptureMarkdown,
  validateNativeSaveRequest,
  writeBrowserArchiveFile,
} from '../src/index.js';
import {
  createConfiguredTestArchive,
  inventedMarkdown,
  inventedRequest,
} from './helpers.js';

const SECOND_REQUEST_ID = '00000000-0000-4000-8000-000000000003';

test('an app-data directory without desktop setup returns CAPTURE_UNCONFIGURED', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'grasppy-capture-unconfigured-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    saveBrowserArchiveRequest({
      appDataDirectory: path.join(root, 'new-application-data'),
      request: validateNativeSaveRequest(inventedRequest()),
    }),
    (error) => error.code === NATIVE_ERROR_CODES.CAPTURE_UNCONFIGURED,
  );
});

test('browser saves create, replace, and idempotently replay without fingerprints', async (t) => {
  const environment = await createConfiguredTestArchive();
  t.after(environment.cleanup);
  const firstRequest = validateNativeSaveRequest(inventedRequest());
  const first = await saveBrowserArchiveRequest({
    appDataDirectory: environment.appDataDirectory,
    request: firstRequest,
    now: () => '2026-08-03T08:00:00.000Z',
  });
  assert.equal(first.disposition, 'created');

  let loaded = await loadBrowserManifest({ appDataDirectory: environment.appDataDirectory });
  const firstEntry = loaded.manifest.sessions[firstRequest.sessionKey];
  const outputPath = path.join(environment.archivePath, firstEntry.outputFilename);
  const firstMarkdown = await readFile(outputPath, 'utf8');
  validateBrowserCaptureMarkdown(firstMarkdown, firstRequest);
  assert.match(firstMarkdown, /\*\*Provider:\*\* claude/);
  assert.equal(JSON.stringify(loaded.manifest).includes('Invented planning conversation'), false);
  assert.equal(JSON.stringify(loaded.manifest).includes('sourceUrl'), false);
  assert.equal(JSON.stringify(loaded.manifest).toLowerCase().includes('fingerprint'), false);

  const replacementRequest = validateNativeSaveRequest(inventedRequest({
    requestId: SECOND_REQUEST_ID,
    markdown: inventedMarkdown('Invented replacement answer.'),
  }));
  const replaced = await saveBrowserArchiveRequest({
    appDataDirectory: environment.appDataDirectory,
    request: replacementRequest,
    now: () => '2026-08-03T08:01:00.000Z',
  });
  assert.equal(replaced.disposition, 'replaced');
  loaded = await loadBrowserManifest({ appDataDirectory: environment.appDataDirectory });
  assert.equal(loaded.manifest.sessions[firstRequest.sessionKey].outputFilename, firstEntry.outputFilename);
  assert.equal(loaded.manifest.runs.length, 2);
  assert.match(await readFile(outputPath, 'utf8'), /Invented replacement answer\./);

  const replay = await saveBrowserArchiveRequest({
    appDataDirectory: environment.appDataDirectory,
    request: replacementRequest,
    now: () => '2026-08-03T08:02:00.000Z',
  });
  assert.deepEqual(replay, {
    disposition: 'unchanged',
    bytesWritten: 0,
    processedAt: '2026-08-03T08:01:00.000Z',
    outputFilename: firstEntry.outputFilename,
  });
  loaded = await loadBrowserManifest({ appDataDirectory: environment.appDataDirectory });
  assert.equal(loaded.manifest.runs.length, 2);
});

test('request-id conflicts and writer failures preserve the previous valid export', async (t) => {
  const environment = await createConfiguredTestArchive();
  t.after(environment.cleanup);
  const firstRequest = validateNativeSaveRequest(inventedRequest());
  await saveBrowserArchiveRequest({
    appDataDirectory: environment.appDataDirectory,
    request: firstRequest,
  });
  const loaded = await loadBrowserManifest({ appDataDirectory: environment.appDataDirectory });
  const outputPath = path.join(
    environment.archivePath,
    loaded.manifest.sessions[firstRequest.sessionKey].outputFilename,
  );
  const preservedMarkdown = await readFile(outputPath, 'utf8');

  const otherIdentity = '00000000-0000-4000-8000-000000000004';
  const conflictRequest = validateNativeSaveRequest(inventedRequest({
    conversationId: otherIdentity,
    sourceUrl: `https://claude.ai/chat/${otherIdentity}`,
  }));
  await assert.rejects(
    saveBrowserArchiveRequest({
      appDataDirectory: environment.appDataDirectory,
      request: conflictRequest,
    }),
    (error) => error.code === NATIVE_ERROR_CODES.REQUEST_ID_CONFLICT,
  );

  const replacementRequest = validateNativeSaveRequest(inventedRequest({
    requestId: SECOND_REQUEST_ID,
    markdown: inventedMarkdown('This must not replace the prior file.'),
  }));
  await assert.rejects(
    saveBrowserArchiveRequest({
      appDataDirectory: environment.appDataDirectory,
      request: replacementRequest,
      archiveWriter: async () => {
        throw new NativeHostError(
          NATIVE_ERROR_CODES.ARCHIVE_WRITE_FAILED,
          'The invented archive write failed.',
        );
      },
    }),
    (error) => error.code === NATIVE_ERROR_CODES.ARCHIVE_WRITE_FAILED,
  );
  assert.equal(await readFile(outputPath, 'utf8'), preservedMarkdown);
});

test('overlapping browser saves fail busy rather than racing manifest state', async (t) => {
  const environment = await createConfiguredTestArchive();
  t.after(environment.cleanup);
  let releaseWriter;
  let markWriterStarted;
  const writerStarted = new Promise((resolve) => { markWriterStarted = resolve; });
  const writerRelease = new Promise((resolve) => { releaseWriter = resolve; });
  const firstRequest = validateNativeSaveRequest(inventedRequest());
  const firstSave = saveBrowserArchiveRequest({
    appDataDirectory: environment.appDataDirectory,
    request: firstRequest,
    archiveWriter: async (options) => {
      markWriterStarted();
      await writerRelease;
      return writeBrowserArchiveFile(options);
    },
  });
  await writerStarted;
  await assert.rejects(
    saveBrowserArchiveRequest({
      appDataDirectory: environment.appDataDirectory,
      request: validateNativeSaveRequest(inventedRequest({ requestId: SECOND_REQUEST_ID })),
    }),
    (error) => error.code === NATIVE_ERROR_CODES.HOST_BUSY,
  );
  releaseWriter();
  assert.equal((await firstSave).disposition, 'created');
});
