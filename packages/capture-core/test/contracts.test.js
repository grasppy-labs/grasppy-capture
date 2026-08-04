// Purpose: Verifies Capture identity, normalization, Markdown, manifest, adapter, and error contracts.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPTURE_FORMAT_VERSION,
  CaptureError,
  ERROR_CODES,
  OPERATIONAL_MANIFEST_SCHEMA_VERSION,
  PROVIDERS,
  assertProviderAdapter,
  createEmptyOperationalManifest,
  createMarkdownEnvelope,
  createNormalizedSession,
  createSessionKey,
  getShortSessionId,
  toPublicError,
  validateOperationalManifest,
} from '../src/index.js';

const FULL_SESSION_ID = '12345678-1234-4abc-8def-1234567890ab';
const SESSION_KEY = `codex:${FULL_SESSION_ID}`;
const NOW = '2026-08-02T12:00:00.000Z';

function createSessionInput() {
  return {
    provider: PROVIDERS.CODEX,
    fullSessionId: FULL_SESSION_ID,
    source: {
      path: '/local/provider/session.jsonl',
      providerProjectKey: 'capture-project',
      workspacePath: '/local/project',
      format: 'provider-jsonl',
      schemaVersion: 'observed-v1',
      observations: ['session_meta observed'],
    },
    title: { value: 'Capture planning', source: 'provider metadata' },
    activity: { timestamp: NOW, source: 'provider record', confidence: 'high' },
    events: [
      { type: 'user', content: 'Start the archive.' },
      { type: 'assistant', content: 'Archive ready.' },
    ],
    completeness: { isComplete: true, warnings: [] },
  };
}

function createManifestSessionEntry() {
  return {
    provider: PROVIDERS.CODEX,
    fullSessionId: FULL_SESSION_ID,
    sourcePath: '/local/provider/session.jsonl',
    sourceMtimeMs: 100,
    sourceSizeBytes: 200,
    outputPath: null,
    formatVersion: null,
    lastSuccessfulExportAt: null,
    lastMarkdownSizeBytes: null,
    excluded: false,
  };
}

test('canonical identity requires the full provider UUID', () => {
  assert.equal(createSessionKey('CODEX', FULL_SESSION_ID.toUpperCase()), SESSION_KEY);
  assert.equal(getShortSessionId(FULL_SESSION_ID), '12345678');
  assert.throws(
    () => createSessionKey(PROVIDERS.CODEX, '12345678'),
    (error) => error instanceof CaptureError && error.code === ERROR_CODES.INVALID_SESSION_ID,
  );
});

test('normalized sessions preserve ordered events and evidence', () => {
  const session = createNormalizedSession(createSessionInput());

  assert.equal(session.sessionKey, SESSION_KEY);
  assert.equal(session.events[0].sequence, 1);
  assert.equal(session.events[1].type, 'assistant');
  assert.equal(session.activity.timestamp, NOW);
  assert.deepEqual(session.source.observations, ['session_meta observed']);
});

test('normalized sessions reject unsupported event types', () => {
  const input = createSessionInput();
  input.events.push({ type: 'invented', content: 'Do not fabricate this.' });

  assert.throws(
    () => createNormalizedSession(input),
    (error) => error.code === ERROR_CODES.INVALID_NORMALIZED_SESSION,
  );
});

test('provider adapters must implement the shared interface', () => {
  const adapter = {
    provider: PROVIDERS.CURSOR,
    getDefaultRoots() {},
    discoverSessions() {},
    normalizeSession() {},
  };

  assert.equal(assertProviderAdapter(adapter).provider, PROVIDERS.CURSOR);
  assert.throws(
    () => assertProviderAdapter({ provider: PROVIDERS.CURSOR }),
    (error) => error.code === ERROR_CODES.INVALID_PROVIDER_ADAPTER,
  );
});

test('Markdown envelopes carry full stable identity and validated counts', () => {
  const envelope = createMarkdownEnvelope({
    provider: PROVIDERS.CODEX,
    fullSessionId: FULL_SESSION_ID,
    sourceUpdatedAt: NOW,
    sourceUpdatedSource: 'provider record',
    exportedAt: NOW,
    messageCount: 2,
    conversationTurnCount: 1,
    sourceFormat: 'provider-jsonl',
  });

  assert.equal(envelope.captureFormat, CAPTURE_FORMAT_VERSION);
  assert.equal(envelope.fullSessionId, FULL_SESSION_ID);
  assert.equal(envelope.sessionKey, SESSION_KEY);
});

test('empty operational manifests contain no transcript content', () => {
  const manifest = createEmptyOperationalManifest({ archivePath: '/local/archive', now: NOW });

  assert.equal(manifest.schemaVersion, OPERATIONAL_MANIFEST_SCHEMA_VERSION);
  assert.deepEqual(manifest.sessions, {});
  assert.deepEqual(manifest.runs, []);
  assert.equal(validateOperationalManifest(manifest), manifest);
});

test('operational manifests validate session identity and exclusions', () => {
  const manifest = createEmptyOperationalManifest({ archivePath: '/local/archive', now: NOW });
  manifest.sessions[SESSION_KEY] = createManifestSessionEntry();

  assert.equal(validateOperationalManifest(manifest), manifest);
  manifest.sessions[SESSION_KEY].excluded = true;
  assert.equal(validateOperationalManifest(manifest), manifest);
});

test('operational manifests reject fingerprint and checksum fields', () => {
  const manifest = createEmptyOperationalManifest({ archivePath: '/local/archive', now: NOW });
  manifest.sessions[SESSION_KEY] = {
    ...createManifestSessionEntry(),
    sourceChecksum: 'not-approved',
  };

  assert.throws(
    () => validateOperationalManifest(manifest),
    (error) => error.code === ERROR_CODES.INVALID_MANIFEST,
  );
});

test('operational run history records dispositions without conversation text', () => {
  const manifest = createEmptyOperationalManifest({ archivePath: '/local/archive', now: NOW });
  manifest.runs.push({
    runId: 'run-1',
    startedAt: NOW,
    completedAt: NOW,
    status: 'success',
    providers: [PROVIDERS.CODEX],
    filesChecked: 3,
    bytesWritten: 512,
    results: {
      created: 1,
      replaced: 1,
      unchanged: 1,
      unavailable: 0,
      excluded: 0,
      skipped: 0,
      failed: 0,
    },
  });

  assert.equal(validateOperationalManifest(manifest), manifest);
});

test('public errors omit internal context and unknown error details', () => {
  const captureError = new CaptureError(ERROR_CODES.ARCHIVE_WRITE_FAILED, 'Archive write failed.', {
    context: { privatePath: '/local/archive/file.md' },
  });

  assert.deepEqual(toPublicError(captureError), {
    success: false,
    error: 'Archive write failed.',
    code: ERROR_CODES.ARCHIVE_WRITE_FAILED,
  });
  assert.equal(toPublicError(new Error('private failure')).error, 'Something went wrong while processing the local archive.');
});
