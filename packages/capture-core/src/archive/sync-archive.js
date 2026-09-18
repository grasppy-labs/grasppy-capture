// Purpose: Runs an explicit fixed-set archive synchronization with source race checks and isolated failures.

import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import path from 'node:path';

import { CAPTURE_FORMAT_VERSION } from '../contracts/markdown-contract.js';
import { RUN_RESULT_FIELDS, validateOperationalManifest } from '../contracts/manifest-schema.js';
import { CaptureError, ERROR_CODES } from '../errors.js';
import { getProviderAdapter } from '../providers/catalog.js';
import { buildReviewCatalog, createFixedRunSet } from './catalog-state.js';
import { cloneOperationalManifest, saveOperationalManifest } from './manifest-store.js';
import { createStableArchiveFilename } from './paths.js';
import { renderCaptureMarkdown } from './render-markdown.js';
import { writeValidatedArchiveFile } from './write-file.js';

function emptyResults() {
  return Object.fromEntries(RUN_RESULT_FIELDS.map((fieldName) => [fieldName, 0]));
}

function safeFailure(error) {
  if (error instanceof CaptureError) {
    return Object.freeze({ code: error.code, message: error.message });
  }
  return Object.freeze({
    code: ERROR_CODES.SOURCE_READ_FAILED,
    message: 'The local conversation could not be processed safely.',
  });
}

function sameSourceState(left, right) {
  return left.isFile() && !left.isSymbolicLink()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs;
}

async function inspectFixedSource(candidate) {
  try {
    const sourceStat = await lstat(candidate.sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()
      || sourceStat.size !== candidate.sourceStat.sizeBytes
      || sourceStat.mtimeMs !== candidate.sourceStat.mtimeMs) {
      throw new CaptureError(
        ERROR_CODES.SOURCE_READ_FAILED,
        'The local conversation changed after review; refresh before syncing it.',
      );
    }
    return sourceStat;
  } catch (error) {
    if (error instanceof CaptureError) throw error;
    throw new CaptureError(
      error?.code === 'EACCES' || error?.code === 'EPERM'
        ? ERROR_CODES.PROVIDER_PERMISSION_DENIED
        : ERROR_CODES.SOURCE_READ_FAILED,
      'The local conversation source is unavailable or unreadable.',
      { cause: error },
    );
  }
}

function chooseDestination(manifest, entry, normalizedSession) {
  if (entry.outputPath) return entry.outputPath;
  const base = {
    provider: normalizedSession.provider,
    title: normalizedSession.title.value,
    providerProjectKey: normalizedSession.source.providerProjectKey,
    fullSessionId: normalizedSession.fullSessionId,
  };
  // Collision escalation: if another session already owns this provider--id--
  // prefix (possible for Codex UUIDv7 ids created within ~a minute), lengthen
  // the id segment. Runs once per session — the chosen path is pinned after.
  const takenBasenames = new Set(
    Object.values(manifest.sessions ?? {})
      .filter((s) => s.fullSessionId !== normalizedSession.fullSessionId && typeof s.outputPath === 'string')
      .map((s) => path.basename(s.outputPath).toLowerCase()),
  );
  let filename = createStableArchiveFilename({ ...base, idLength: 36 });
  for (const idLength of [8, 12, 36]) {
    const candidate = createStableArchiveFilename({ ...base, idLength });
    const prefix = candidate.toLowerCase().split('--').slice(0, 2).join('--') + '--';
    if (![...takenBasenames].some((b) => b.startsWith(prefix))) { filename = candidate; break; }
  }
  return path.join(manifest.archivePath, filename);
}

function runStatus(results) {
  if (results.failed === 0) return 'success';
  const successfulEvidence = results.created + results.replaced + results.unchanged;
  return successfulEvidence > 0 ? 'partial-failure' : 'failed';
}

export async function runManualArchiveSync({
  manifestPath,
  manifest,
  providerResults,
  now = () => new Date().toISOString(),
  adapterResolver = getProviderAdapter,
  archiveWriter = writeValidatedArchiveFile,
  manifestWriter = saveOperationalManifest,
  // Checkpointing (2026-09-18): persist the manifest after every N successful
  // exports so an interrupted run (process killed, app quit mid-sync) keeps
  // the bookkeeping for files it already wrote instead of re-parsing and
  // rewriting all of them next time. 0 = off (the app's original behavior:
  // one save at the end). The run record itself is still appended only once,
  // at completion.
  checkpointEvery = 0,
} = {}) {
  validateOperationalManifest(manifest);
  if (typeof manifestPath !== 'string' || !path.isAbsolute(manifestPath)) {
    throw new CaptureError(ERROR_CODES.INVALID_MANIFEST, 'The operational manifest path is invalid.');
  }
  if (!Number.isInteger(checkpointEvery) || checkpointEvery < 0) {
    throw new CaptureError(ERROR_CODES.INVALID_INPUT, 'checkpointEvery must be a non-negative integer.');
  }

  const startedAt = new Date(now()).toISOString();
  const reviewCatalog = await buildReviewCatalog(manifest, providerResults);
  const fixedRunSet = createFixedRunSet(reviewCatalog);
  const nextManifest = cloneOperationalManifest(reviewCatalog.manifest);
  const results = emptyResults();
  const failures = [];

  for (const item of reviewCatalog.items) {
    if (!item.candidate) results.unavailable += 1;
    else if (item.syncState === 'synced') results.unchanged += 1;
    else if (item.excluded) results.excluded += 1;
  }

  let bytesWritten = 0;
  let exportsSinceCheckpoint = 0;
  let checkpointsFailed = 0;
  let lastCheckpointError = null;
  for (const runItem of fixedRunSet) {
    const entry = nextManifest.sessions[runItem.sessionKey];
    try {
      const adapter = adapterResolver(runItem.provider);
      if (!adapter) {
        throw new CaptureError(
          ERROR_CODES.INVALID_PROVIDER_ADAPTER,
          'No approved provider adapter is available for this conversation.',
        );
      }
      const sourceBefore = await inspectFixedSource(runItem.candidate);
      const normalizedSession = await adapter.normalizeSession(runItem.candidate);
      if (normalizedSession.provider !== runItem.provider
        || normalizedSession.fullSessionId !== runItem.fullSessionId
        || normalizedSession.source.path !== runItem.candidate.sourcePath) {
        throw new CaptureError(
          ERROR_CODES.INVALID_NORMALIZED_SESSION,
          'The normalized conversation identity or source changed unexpectedly.',
        );
      }
      const sourceAfter = await lstat(runItem.candidate.sourcePath);
      if (!sameSourceState(sourceBefore, sourceAfter)) {
        throw new CaptureError(
          ERROR_CODES.SOURCE_READ_FAILED,
          'The local conversation changed while it was being processed; its previous archive was preserved.',
        );
      }

      const exportedAt = new Date(now()).toISOString();
      const rendered = renderCaptureMarkdown(normalizedSession, { exportedAt });
      const destinationPath = chooseDestination(nextManifest, entry, normalizedSession);
      const written = await archiveWriter({
        archivePath: nextManifest.archivePath,
        destinationPath,
        markdown: rendered.markdown,
        envelope: rendered.envelope,
      });
      if (!['created', 'replaced'].includes(written?.disposition)
        || !Number.isFinite(written.sizeBytes)
        || written.sizeBytes < 0
        || typeof written.outputPath !== 'string') {
        throw new CaptureError(
          ERROR_CODES.ARCHIVE_WRITE_FAILED,
          'The archive writer returned invalid bookkeeping.',
        );
      }

      results[written.disposition] += 1;
      bytesWritten += written.sizeBytes;
      nextManifest.sessions[runItem.sessionKey] = {
        ...entry,
        sourcePath: runItem.candidate.sourcePath,
        sourceMtimeMs: sourceAfter.mtimeMs,
        sourceSizeBytes: sourceAfter.size,
        outputPath: written.outputPath,
        formatVersion: CAPTURE_FORMAT_VERSION,
        lastSuccessfulExportAt: exportedAt,
        lastMarkdownSizeBytes: written.sizeBytes,
      };
      exportsSinceCheckpoint += 1;
      if (checkpointEvery > 0 && exportsSinceCheckpoint >= checkpointEvery) {
        exportsSinceCheckpoint = 0;
        try {
          nextManifest.updatedAt = new Date(now()).toISOString();
          validateOperationalManifest(nextManifest);
          await manifestWriter(manifestPath, nextManifest);
        } catch (checkpointError) {
          // A failed checkpoint is not a failed export: the archive file is on
          // disk and the final save still runs. Count it so the caller can see
          // that mid-run durability was not achieved.
          checkpointsFailed += 1;
          lastCheckpointError = safeFailure(checkpointError);
        }
      }
    } catch (error) {
      results.failed += 1;
      failures.push(Object.freeze({
        sessionKey: runItem.sessionKey,
        provider: runItem.provider,
        ...safeFailure(error),
      }));
    }
  }

  const completedAt = new Date(now()).toISOString();
  const currentCandidateCount = reviewCatalog.items.filter((item) => item.candidate).length;
  const providers = [...new Set(providerResults.map((result) => result.provider))].sort();
  const run = {
    runId: randomUUID(),
    startedAt,
    completedAt,
    status: runStatus(results),
    providers,
    filesChecked: currentCandidateCount,
    bytesWritten,
    results,
  };
  nextManifest.updatedAt = completedAt;
  nextManifest.runs.push(run);
  validateOperationalManifest(nextManifest);
  await manifestWriter(manifestPath, nextManifest);

  return Object.freeze({
    manifest: nextManifest,
    run: Object.freeze(structuredClone(run)),
    failures: Object.freeze(failures),
    fixedRunSessionKeys: Object.freeze(fixedRunSet.map((item) => item.sessionKey)),
    checkpoints: Object.freeze({ every: checkpointEvery, failed: checkpointsFailed, lastError: lastCheckpointError }),
  });
}
