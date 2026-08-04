// Purpose: Validates and atomically stores content-free browser-save bookkeeping outside the archive.

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import { NativeHostError, NATIVE_ERROR_CODES } from './errors.js';
import { validateBrowserIdentityShape } from './provider-identity.js';
import { BROWSER_CAPTURE_FORMAT_VERSION } from './render-browser-markdown.js';

export const BROWSER_MANIFEST_SCHEMA_VERSION = 1;
export const BROWSER_MANIFEST_FILENAME = 'capture-browser-manifest.json';

const MANIFEST_FIELDS = new Set(['schemaVersion', 'createdAt', 'updatedAt', 'sessions', 'runs']);
const SESSION_FIELDS = new Set([
  'provider',
  'conversationId',
  'identityFormat',
  'outputFilename',
  'formatVersion',
  'lastSuccessfulExportAt',
  'lastMarkdownSizeBytes',
  'lastRequestId',
]);
const RUN_FIELDS = new Set([
  'requestId',
  'processedAt',
  'provider',
  'conversationId',
  'identityFormat',
  'disposition',
  'bytesWritten',
]);
const DISPOSITIONS = new Set(['created', 'replaced']);
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function manifestError(message, cause) {
  return new NativeHostError(
    NATIVE_ERROR_CODES.ARCHIVE_UNAVAILABLE,
    message,
    cause ? { cause } : undefined,
  );
}

function assertRecord(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw manifestError(message);
}

function assertExactFields(value, fields, message) {
  if (Object.keys(value).length !== fields.size
    || Object.keys(value).some((field) => !fields.has(field))) {
    throw manifestError(message);
  }
}

function assertTimestamp(value, message) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw manifestError(message);
}

function assertRequestId(value, message) {
  if (typeof value !== 'string' || !REQUEST_ID_PATTERN.test(value)) throw manifestError(message);
}

function assertOutputFilename(value) {
  if (typeof value !== 'string'
    || value !== path.basename(value)
    || value.startsWith('.')
    || !value.toLowerCase().endsWith('.md')) {
    throw manifestError('Browser manifest output filename is invalid.');
  }
}

function validateSession(sessionKey, entry) {
  assertRecord(entry, 'Browser manifest session entry is invalid.');
  assertExactFields(entry, SESSION_FIELDS, 'Browser manifest session fields are invalid.');
  const identity = validateBrowserIdentityShape(entry);
  if (identity.sessionKey !== sessionKey) throw manifestError('Browser manifest session identity is invalid.');
  assertOutputFilename(entry.outputFilename);
  if (entry.formatVersion !== BROWSER_CAPTURE_FORMAT_VERSION) {
    throw manifestError('Browser manifest format version is invalid.');
  }
  assertTimestamp(entry.lastSuccessfulExportAt, 'Browser manifest processing time is invalid.');
  if (!Number.isFinite(entry.lastMarkdownSizeBytes) || entry.lastMarkdownSizeBytes < 0) {
    throw manifestError('Browser manifest Markdown size is invalid.');
  }
  assertRequestId(entry.lastRequestId, 'Browser manifest request identity is invalid.');
}

function validateRun(entry) {
  assertRecord(entry, 'Browser manifest run entry is invalid.');
  assertExactFields(entry, RUN_FIELDS, 'Browser manifest run fields are invalid.');
  assertRequestId(entry.requestId, 'Browser manifest run identity is invalid.');
  assertTimestamp(entry.processedAt, 'Browser manifest run time is invalid.');
  validateBrowserIdentityShape({
    provider: entry.provider,
    conversationId: entry.conversationId,
    identityFormat: entry.identityFormat,
  });
  if (!DISPOSITIONS.has(entry.disposition)) throw manifestError('Browser manifest disposition is invalid.');
  if (!Number.isFinite(entry.bytesWritten) || entry.bytesWritten < 0) {
    throw manifestError('Browser manifest bytes written is invalid.');
  }
}

export function createEmptyBrowserManifest(now = new Date().toISOString()) {
  assertTimestamp(now, 'Browser manifest timestamp is invalid.');
  const timestamp = new Date(now).toISOString();
  return {
    schemaVersion: BROWSER_MANIFEST_SCHEMA_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    sessions: {},
    runs: [],
  };
}

export function validateBrowserManifest(manifest) {
  assertRecord(manifest, 'Browser manifest is invalid.');
  assertExactFields(manifest, MANIFEST_FIELDS, 'Browser manifest fields are invalid.');
  if (manifest.schemaVersion !== BROWSER_MANIFEST_SCHEMA_VERSION) {
    throw manifestError('Browser manifest version is unsupported.');
  }
  assertTimestamp(manifest.createdAt, 'Browser manifest creation time is invalid.');
  assertTimestamp(manifest.updatedAt, 'Browser manifest update time is invalid.');
  assertRecord(manifest.sessions, 'Browser manifest sessions are invalid.');
  Object.entries(manifest.sessions).forEach(([sessionKey, entry]) => validateSession(sessionKey, entry));
  if (!Array.isArray(manifest.runs)) throw manifestError('Browser manifest runs are invalid.');
  manifest.runs.forEach(validateRun);
  return manifest;
}

async function resolveAppDataDirectory(appDataDirectory) {
  if (typeof appDataDirectory !== 'string' || !path.isAbsolute(appDataDirectory)) {
    throw manifestError('Capture application data is unavailable.');
  }
  try {
    await mkdir(appDataDirectory, { recursive: true, mode: 0o700 });
    const directoryStat = await lstat(appDataDirectory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw manifestError('Capture application data is unavailable.');
    }
    return await realpath(appDataDirectory);
  } catch (error) {
    if (error instanceof NativeHostError) throw error;
    throw manifestError('Capture application data is unavailable.', error);
  }
}

async function removeTemporaryFile(temporaryPath) {
  try {
    await unlink(temporaryPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export async function loadBrowserManifest({ appDataDirectory, now }) {
  const canonicalAppData = await resolveAppDataDirectory(appDataDirectory);
  const manifestPath = path.join(canonicalAppData, BROWSER_MANIFEST_FILENAME);
  try {
    const manifestStat = await lstat(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
      throw manifestError('Browser manifest must be a regular file.');
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    validateBrowserManifest(manifest);
    return Object.freeze({ manifestPath, manifest });
  } catch (error) {
    if (error instanceof NativeHostError) throw error;
    if (error?.code === 'ENOENT') {
      return Object.freeze({ manifestPath, manifest: createEmptyBrowserManifest(now) });
    }
    throw manifestError('Browser manifest is unreadable or invalid.', error);
  }
}

export async function saveBrowserManifest(manifestPath, manifest) {
  validateBrowserManifest(manifest);
  if (typeof manifestPath !== 'string'
    || !path.isAbsolute(manifestPath)
    || path.basename(manifestPath) !== BROWSER_MANIFEST_FILENAME) {
    throw manifestError('Browser manifest path is invalid.');
  }
  const canonicalParent = await realpath(path.dirname(manifestPath));
  const canonicalManifestPath = path.join(canonicalParent, BROWSER_MANIFEST_FILENAME);
  try {
    const existingStat = await lstat(canonicalManifestPath);
    if (!existingStat.isFile() || existingStat.isSymbolicLink()) {
      throw manifestError('Browser manifest must be a regular file.');
    }
  } catch (error) {
    if (error instanceof NativeHostError) throw error;
    if (error?.code !== 'ENOENT') throw manifestError('Browser manifest could not be inspected.', error);
  }

  const temporaryPath = path.join(canonicalParent, `.capture-browser-${randomUUID()}.tmp`);
  let shouldCleanup = true;
  try {
    const fileHandle = await open(temporaryPath, 'wx', 0o600);
    try {
      await fileHandle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }
    const writtenManifest = JSON.parse(await readFile(temporaryPath, 'utf8'));
    validateBrowserManifest(writtenManifest);
    await rename(temporaryPath, canonicalManifestPath);
    shouldCleanup = false;
    return canonicalManifestPath;
  } catch (error) {
    if (error instanceof NativeHostError) throw error;
    throw manifestError('Browser manifest could not be saved safely.', error);
  } finally {
    if (shouldCleanup) await removeTemporaryFile(temporaryPath);
  }
}

export function cloneBrowserManifest(manifest) {
  validateBrowserManifest(manifest);
  return structuredClone(manifest);
}
