// Purpose: Creates and validates Capture's content-free local operational manifest schema.

import { CaptureError, ERROR_CODES } from '../errors.js';
import { createSessionKey, normalizeFullSessionId, normalizeProvider } from './identity.js';

export const OPERATIONAL_MANIFEST_SCHEMA_VERSION = 1;
export const RUN_RESULT_FIELDS = Object.freeze([
  'created',
  'replaced',
  'unchanged',
  'unavailable',
  'excluded',
  'skipped',
  'failed',
]);

const RUN_STATUS_VALUES = new Set(['success', 'partial-failure', 'failed']);
const MANIFEST_FIELDS = new Set([
  'schemaVersion',
  'archivePath',
  'createdAt',
  'updatedAt',
  'sessions',
  'runs',
]);
const SESSION_FIELDS = new Set([
  'provider',
  'fullSessionId',
  'sourcePath',
  'sourceMtimeMs',
  'sourceSizeBytes',
  'outputPath',
  'formatVersion',
  'lastSuccessfulExportAt',
  'lastMarkdownSizeBytes',
  'excluded',
]);
const RUN_FIELDS = new Set([
  'runId',
  'startedAt',
  'completedAt',
  'status',
  'providers',
  'filesChecked',
  'bytesWritten',
  'results',
]);

function assertRecord(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CaptureError(ERROR_CODES.INVALID_MANIFEST, message);
  }
}

function assertExactFields(record, allowedFields, message) {
  const unexpectedField = Object.keys(record).find((field) => !allowedFields.has(field));
  if (unexpectedField) {
    throw new CaptureError(ERROR_CODES.INVALID_MANIFEST, message);
  }
}

function assertNonEmptyString(value, message) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CaptureError(ERROR_CODES.INVALID_MANIFEST, message);
  }
}

function assertTimestamp(value, message, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new CaptureError(ERROR_CODES.INVALID_MANIFEST, message);
  }
}

function assertNonNegativeNumber(value, message, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (!Number.isFinite(value) || value < 0) {
    throw new CaptureError(ERROR_CODES.INVALID_MANIFEST, message);
  }
}

function validateSessionEntry(sessionKey, entry) {
  assertRecord(entry, 'Operational manifest session entry is invalid.');
  assertExactFields(entry, SESSION_FIELDS, 'Operational manifest session fields are invalid.');
  const provider = normalizeProvider(entry.provider);
  const fullSessionId = normalizeFullSessionId(entry.fullSessionId);
  if (createSessionKey(provider, fullSessionId) !== sessionKey) {
    throw new CaptureError(
      ERROR_CODES.INVALID_MANIFEST,
      'Operational manifest session identity does not match its key.',
    );
  }

  assertNonEmptyString(entry.sourcePath, 'Operational manifest source path is invalid.');
  assertNonNegativeNumber(entry.sourceMtimeMs, 'Operational manifest source time is invalid.');
  assertNonNegativeNumber(entry.sourceSizeBytes, 'Operational manifest source size is invalid.');
  if (entry.outputPath !== null) {
    assertNonEmptyString(entry.outputPath, 'Operational manifest output path is invalid.');
  }
  assertNonNegativeNumber(entry.formatVersion, 'Operational manifest format is invalid.', {
    nullable: true,
  });
  assertTimestamp(
    entry.lastSuccessfulExportAt,
    'Operational manifest processing time is invalid.',
    { nullable: true },
  );
  assertNonNegativeNumber(
    entry.lastMarkdownSizeBytes,
    'Operational manifest Markdown size is invalid.',
    { nullable: true },
  );
  if (typeof entry.excluded !== 'boolean') {
    throw new CaptureError(
      ERROR_CODES.INVALID_MANIFEST,
      'Operational manifest exclusion preference is invalid.',
    );
  }
}

function validateRunEntry(run) {
  assertRecord(run, 'Operational manifest run entry is invalid.');
  assertExactFields(run, RUN_FIELDS, 'Operational manifest run fields are invalid.');
  assertNonEmptyString(run.runId, 'Operational manifest run identity is invalid.');
  assertTimestamp(run.startedAt, 'Operational manifest run start time is invalid.');
  assertTimestamp(run.completedAt, 'Operational manifest run completion time is invalid.');
  if (!RUN_STATUS_VALUES.has(run.status)) {
    throw new CaptureError(ERROR_CODES.INVALID_MANIFEST, 'Operational manifest run status is invalid.');
  }
  if (!Array.isArray(run.providers)) {
    throw new CaptureError(ERROR_CODES.INVALID_MANIFEST, 'Operational manifest providers are invalid.');
  }
  run.providers.forEach(normalizeProvider);
  assertNonNegativeNumber(run.filesChecked, 'Operational manifest files checked is invalid.');
  assertNonNegativeNumber(run.bytesWritten, 'Operational manifest bytes written is invalid.');
  assertRecord(run.results, 'Operational manifest run results are invalid.');
  assertExactFields(
    run.results,
    new Set(RUN_RESULT_FIELDS),
    'Operational manifest result fields are invalid.',
  );
  for (const fieldName of RUN_RESULT_FIELDS) {
    assertNonNegativeNumber(
      run.results[fieldName],
      `Operational manifest result ${fieldName} is invalid.`,
    );
  }
}

export function createEmptyOperationalManifest({ archivePath, now = new Date().toISOString() }) {
  assertNonEmptyString(archivePath, 'Operational manifest archive path is invalid.');
  assertTimestamp(now, 'Operational manifest timestamp is invalid.');

  return {
    schemaVersion: OPERATIONAL_MANIFEST_SCHEMA_VERSION,
    archivePath,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    sessions: {},
    runs: [],
  };
}

export function validateOperationalManifest(manifest) {
  assertRecord(manifest, 'Operational manifest is invalid.');
  assertExactFields(manifest, MANIFEST_FIELDS, 'Operational manifest fields are invalid.');
  if (manifest.schemaVersion !== OPERATIONAL_MANIFEST_SCHEMA_VERSION) {
    throw new CaptureError(
      ERROR_CODES.INVALID_MANIFEST,
      'Operational manifest version is unsupported.',
    );
  }
  assertNonEmptyString(manifest.archivePath, 'Operational manifest archive path is invalid.');
  assertTimestamp(manifest.createdAt, 'Operational manifest creation time is invalid.');
  assertTimestamp(manifest.updatedAt, 'Operational manifest update time is invalid.');
  assertRecord(manifest.sessions, 'Operational manifest sessions are invalid.');
  for (const [sessionKey, entry] of Object.entries(manifest.sessions)) {
    validateSessionEntry(sessionKey, entry);
  }
  if (!Array.isArray(manifest.runs)) {
    throw new CaptureError(ERROR_CODES.INVALID_MANIFEST, 'Operational manifest runs are invalid.');
  }
  manifest.runs.forEach(validateRunEntry);
  return manifest;
}
