// Purpose: Writes one validated browser export atomically and records content-free save history.

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import {
  OPERATIONAL_MANIFEST_FILENAME,
  initializeOperationalManifest,
  resolveContainedArchiveFile,
  sanitizeFilenameLabel,
  validateOperationalManifest,
} from '../../../packages/capture-core/src/index.js';
import {
  cloneBrowserManifest,
  loadBrowserManifest,
  saveBrowserManifest,
  validateBrowserManifest,
} from './browser-manifest.js';
import { NativeHostError, NATIVE_ERROR_CODES } from './errors.js';
import {
  BROWSER_CAPTURE_FORMAT_VERSION,
  renderBrowserCaptureMarkdown,
  validateBrowserCaptureMarkdown,
} from './render-browser-markdown.js';

const SAVE_LOCK_FILENAME = '.capture-browser-save.lock';
const STALE_LOCK_AGE_MS = 5 * 60 * 1_000;

function archiveError(code, message, cause) {
  return new NativeHostError(code, message, cause ? { cause } : undefined);
}

async function loadConfiguredArchive(appDataDirectory) {
  const manifestPath = path.join(appDataDirectory, OPERATIONAL_MANIFEST_FILENAME);
  try {
    const manifestStat = await lstat(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
      throw archiveError(
        NATIVE_ERROR_CODES.ARCHIVE_UNAVAILABLE,
        'The configured Capture archive is unavailable.',
      );
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    validateOperationalManifest(manifest);
    return await initializeOperationalManifest({
      appDataDirectory,
      archivePath: manifest.archivePath,
    });
  } catch (error) {
    if (error instanceof NativeHostError) throw error;
    if (error?.code === 'ENOENT') {
      throw archiveError(
        NATIVE_ERROR_CODES.CAPTURE_UNCONFIGURED,
        'Choose an archive folder in GRASPPY Capture before saving from the browser.',
      );
    }
    throw archiveError(
      NATIVE_ERROR_CODES.ARCHIVE_UNAVAILABLE,
      'The configured Capture archive is unavailable.',
      error,
    );
  }
}

async function resolveAppDataDirectory(appDataDirectory) {
  try {
    await mkdir(appDataDirectory, { recursive: true, mode: 0o700 });
    const directoryStat = await lstat(appDataDirectory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw archiveError(
        NATIVE_ERROR_CODES.ARCHIVE_UNAVAILABLE,
        'Capture application data is unavailable.',
      );
    }
    return await realpath(appDataDirectory);
  } catch (error) {
    if (error instanceof NativeHostError) throw error;
    throw archiveError(
      NATIVE_ERROR_CODES.ARCHIVE_UNAVAILABLE,
      'Capture application data is unavailable.',
      error,
    );
  }
}

async function removeTemporaryFile(temporaryPath) {
  try {
    await unlink(temporaryPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function moveStaleLock(lockPath) {
  try {
    const lockStat = await lstat(lockPath);
    if (!lockStat.isFile() || lockStat.isSymbolicLink()) return false;
    if (Date.now() - lockStat.mtimeMs <= STALE_LOCK_AGE_MS) return false;
    const stalePath = `${lockPath}.${randomUUID()}.stale`;
    await rename(lockPath, stalePath);
    await removeTemporaryFile(stalePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    return false;
  }
}

async function acquireSaveLock(appDataDirectory) {
  const lockPath = path.join(appDataDirectory, SAVE_LOCK_FILENAME);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fileHandle = await open(lockPath, 'wx', 0o600);
      await fileHandle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
      await fileHandle.sync();
      return Object.freeze({ fileHandle, lockPath });
    } catch (error) {
      if (error?.code !== 'EEXIST' || attempt > 0 || !await moveStaleLock(lockPath)) {
        throw archiveError(
          NATIVE_ERROR_CODES.HOST_BUSY,
          'Another browser save is already in progress.',
          error,
        );
      }
    }
  }
  throw archiveError(NATIVE_ERROR_CODES.HOST_BUSY, 'Another browser save is already in progress.');
}

async function releaseSaveLock(lock) {
  try {
    await lock.fileHandle.close();
  } finally {
    await removeTemporaryFile(lock.lockPath);
  }
}

function stableBrowserFilename(request) {
  const asciiTitle = sanitizeFilenameLabel(request.title)
    .replace(/[^a-z0-9._-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 56) || 'conversation';
  return `browser--${request.provider}--${asciiTitle}--${request.conversationId}.md`;
}

async function existingFileState(destinationPath, expectedIdentity) {
  try {
    const destinationStat = await lstat(destinationPath);
    if (!destinationStat.isFile() || destinationStat.isSymbolicLink()) {
      throw archiveError(
        NATIVE_ERROR_CODES.ARCHIVE_WRITE_FAILED,
        'The existing browser archive output is unsafe.',
      );
    }
    const markdown = await readFile(destinationPath, 'utf8');
    validateBrowserCaptureMarkdown(markdown, expectedIdentity);
    return Object.freeze({ exists: true, sizeBytes: destinationStat.size });
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ exists: false, sizeBytes: 0 });
    if (error instanceof NativeHostError) {
      throw archiveError(
        NATIVE_ERROR_CODES.ARCHIVE_WRITE_FAILED,
        'The existing browser archive output could not be replaced safely.',
        error,
      );
    }
    throw archiveError(
      NATIVE_ERROR_CODES.ARCHIVE_WRITE_FAILED,
      'The existing browser archive output could not be inspected safely.',
      error,
    );
  }
}

export async function writeBrowserArchiveFile({
  archivePath,
  destinationPath,
  markdown,
  envelope,
}) {
  validateBrowserCaptureMarkdown(markdown, envelope);
  const canonicalDestination = await resolveContainedArchiveFile(archivePath, destinationPath);
  const existing = await existingFileState(canonicalDestination, envelope);
  const temporaryPath = path.join(archivePath, `.capture-browser-write-${randomUUID()}.tmp`);
  let shouldCleanup = true;
  try {
    const fileHandle = await open(temporaryPath, 'wx', 0o600);
    try {
      await fileHandle.writeFile(markdown, 'utf8');
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }
    const writtenMarkdown = await readFile(temporaryPath, 'utf8');
    validateBrowserCaptureMarkdown(writtenMarkdown, envelope);
    const recheckedDestination = await resolveContainedArchiveFile(archivePath, canonicalDestination);
    if (recheckedDestination !== canonicalDestination) {
      throw archiveError(
        NATIVE_ERROR_CODES.ARCHIVE_WRITE_FAILED,
        'The browser archive destination changed unexpectedly.',
      );
    }
    await rename(temporaryPath, canonicalDestination);
    shouldCleanup = false;
    const outputStat = await lstat(canonicalDestination);
    return Object.freeze({
      disposition: existing.exists ? 'replaced' : 'created',
      outputFilename: path.basename(canonicalDestination),
      sizeBytes: outputStat.size,
    });
  } catch (error) {
    if (error instanceof NativeHostError) throw error;
    throw archiveError(
      NATIVE_ERROR_CODES.ARCHIVE_WRITE_FAILED,
      'The browser Markdown could not be written safely.',
      error,
    );
  } finally {
    if (shouldCleanup) await removeTemporaryFile(temporaryPath);
  }
}

function replayResult(manifest, request) {
  const matchingSession = manifest.sessions[request.sessionKey];
  if (matchingSession?.lastRequestId === request.requestId) {
    return Object.freeze({
      disposition: 'unchanged',
      bytesWritten: 0,
      processedAt: matchingSession.lastSuccessfulExportAt,
      outputFilename: matchingSession.outputFilename,
    });
  }
  const conflictingSession = Object.values(manifest.sessions)
    .find((entry) => entry.lastRequestId === request.requestId);
  if (conflictingSession) {
    throw archiveError(
      NATIVE_ERROR_CODES.REQUEST_ID_CONFLICT,
      'The native request identity was already used for another conversation.',
    );
  }
  return null;
}

async function saveUnderLock({ appDataDirectory, request, now, archiveWriter, manifestWriter }) {
  const configured = await loadConfiguredArchive(appDataDirectory);
  const processedAt = new Date(now()).toISOString();
  const loadedBrowserManifest = await loadBrowserManifest({ appDataDirectory, now: processedAt });
  const replay = replayResult(loadedBrowserManifest.manifest, request);
  if (replay) {
    const replayPath = path.join(configured.archivePath, replay.outputFilename);
    const canonicalReplayPath = await resolveContainedArchiveFile(configured.archivePath, replayPath);
    const replayState = await existingFileState(canonicalReplayPath, request);
    if (replayState.exists) return replay;
  }

  const nextManifest = cloneBrowserManifest(loadedBrowserManifest.manifest);
  const existingSession = nextManifest.sessions[request.sessionKey];
  const outputFilename = existingSession?.outputFilename ?? stableBrowserFilename(request);
  const rendered = renderBrowserCaptureMarkdown(request, { processedAt });
  const written = await archiveWriter({
    archivePath: configured.archivePath,
    destinationPath: path.join(configured.archivePath, outputFilename),
    markdown: rendered.markdown,
    envelope: rendered.envelope,
  });
  if (!['created', 'replaced'].includes(written?.disposition)
    || typeof written.outputFilename !== 'string'
    || !Number.isFinite(written.sizeBytes)
    || written.sizeBytes < 0) {
    throw archiveError(
      NATIVE_ERROR_CODES.ARCHIVE_WRITE_FAILED,
      'The browser archive writer returned invalid bookkeeping.',
    );
  }

  nextManifest.updatedAt = processedAt;
  nextManifest.sessions[request.sessionKey] = {
    provider: request.provider,
    conversationId: request.conversationId,
    identityFormat: request.identityFormat,
    outputFilename: written.outputFilename,
    formatVersion: BROWSER_CAPTURE_FORMAT_VERSION,
    lastSuccessfulExportAt: processedAt,
    lastMarkdownSizeBytes: written.sizeBytes,
    lastRequestId: request.requestId,
  };
  nextManifest.runs.push({
    requestId: request.requestId,
    processedAt,
    provider: request.provider,
    conversationId: request.conversationId,
    identityFormat: request.identityFormat,
    disposition: written.disposition,
    bytesWritten: written.sizeBytes,
  });
  validateBrowserManifest(nextManifest);
  await manifestWriter(loadedBrowserManifest.manifestPath, nextManifest);
  return Object.freeze({
    disposition: written.disposition,
    bytesWritten: written.sizeBytes,
    processedAt,
  });
}

export async function saveBrowserArchiveRequest({
  appDataDirectory,
  request,
  now = () => new Date().toISOString(),
  archiveWriter = writeBrowserArchiveFile,
  manifestWriter = saveBrowserManifest,
}) {
  if (typeof appDataDirectory !== 'string' || !path.isAbsolute(appDataDirectory)) {
    throw archiveError(
      NATIVE_ERROR_CODES.ARCHIVE_UNAVAILABLE,
      'Capture application data is unavailable.',
    );
  }
  const canonicalAppData = await resolveAppDataDirectory(appDataDirectory);
  const lock = await acquireSaveLock(canonicalAppData);
  try {
    return await saveUnderLock({
      appDataDirectory: canonicalAppData,
      request,
      now,
      archiveWriter,
      manifestWriter,
    });
  } finally {
    await releaseSaveLock(lock);
  }
}
