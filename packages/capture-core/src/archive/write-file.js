// Purpose: Atomically replaces a contained archive Markdown file only after complete validation.

import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import { CaptureError, ERROR_CODES } from '../errors.js';
import { resolveArchiveDirectory, resolveContainedArchiveFile } from './paths.js';
import { validateCaptureMarkdown } from './validate-markdown.js';

async function removeTemporaryFile(temporaryPath) {
  try {
    await unlink(temporaryPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function targetExists(targetPath) {
  try {
    const targetStat = await lstat(targetPath);
    return targetStat.isFile() && !targetStat.isSymbolicLink();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function writeValidatedArchiveFile({ archivePath, destinationPath, markdown, envelope }) {
  validateCaptureMarkdown(markdown, envelope);
  const canonicalArchive = await resolveArchiveDirectory(archivePath);
  const canonicalDestination = await resolveContainedArchiveFile(canonicalArchive, destinationPath);
  const disposition = await targetExists(canonicalDestination) ? 'replaced' : 'created';
  const temporaryPath = path.join(canonicalArchive, `.capture-write-${randomUUID()}.tmp`);
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
    validateCaptureMarkdown(writtenMarkdown, envelope);
    await rename(temporaryPath, canonicalDestination);
    shouldCleanup = false;
    const outputStat = await lstat(canonicalDestination);
    return Object.freeze({
      disposition,
      outputPath: canonicalDestination,
      sizeBytes: outputStat.size,
    });
  } catch (error) {
    if (error instanceof CaptureError) throw error;
    throw new CaptureError(
      ERROR_CODES.ARCHIVE_WRITE_FAILED,
      'The archive file could not be replaced safely.',
      { cause: error },
    );
  } finally {
    if (shouldCleanup) await removeTemporaryFile(temporaryPath);
  }
}
