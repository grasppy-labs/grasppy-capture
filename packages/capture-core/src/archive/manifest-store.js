// Purpose: Loads and atomically persists the content-free operational manifest outside the archive.

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import {
  createEmptyOperationalManifest,
  validateOperationalManifest,
} from '../contracts/manifest-schema.js';
import { CaptureError, ERROR_CODES } from '../errors.js';
import { resolveArchiveDirectory } from './paths.js';

export const OPERATIONAL_MANIFEST_FILENAME = 'capture-operational-manifest.json';

function invalidManifest(message, cause) {
  return new CaptureError(ERROR_CODES.INVALID_MANIFEST, message, cause ? { cause } : undefined);
}

async function resolveAppDataDirectory(appDataDirectory) {
  if (typeof appDataDirectory !== 'string' || !path.isAbsolute(appDataDirectory)) {
    throw invalidManifest('The Capture application-data directory is invalid.');
  }
  try {
    await mkdir(appDataDirectory, { recursive: true, mode: 0o700 });
    const directoryStat = await lstat(appDataDirectory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw invalidManifest('The Capture application-data directory must be a real directory.');
    }
    return await realpath(appDataDirectory);
  } catch (error) {
    if (error instanceof CaptureError) throw error;
    throw invalidManifest('The Capture application-data directory is unavailable.', error);
  }
}

async function readManifestFile(manifestPath) {
  try {
    const manifestStat = await lstat(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
      throw invalidManifest('The operational manifest must be a regular file.');
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    validateOperationalManifest(manifest);
    return manifest;
  } catch (error) {
    if (error instanceof CaptureError) throw error;
    if (error?.code === 'ENOENT') return null;
    throw invalidManifest('The operational manifest is unreadable or invalid.', error);
  }
}

async function removeTemporaryFile(temporaryPath) {
  try {
    await unlink(temporaryPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export async function saveOperationalManifest(manifestPath, manifest) {
  validateOperationalManifest(manifest);
  if (typeof manifestPath !== 'string'
    || !path.isAbsolute(manifestPath)
    || path.basename(manifestPath) !== OPERATIONAL_MANIFEST_FILENAME) {
    throw invalidManifest('The operational manifest path is invalid.');
  }

  const canonicalParent = await realpath(path.dirname(manifestPath));
  const canonicalManifestPath = path.join(canonicalParent, OPERATIONAL_MANIFEST_FILENAME);
  try {
    const existingStat = await lstat(canonicalManifestPath);
    if (!existingStat.isFile() || existingStat.isSymbolicLink()) {
      throw invalidManifest('The operational manifest must be a regular file.');
    }
  } catch (error) {
    if (error instanceof CaptureError) throw error;
    if (error?.code !== 'ENOENT') throw invalidManifest('The operational manifest could not be inspected.', error);
  }

  const temporaryPath = path.join(canonicalParent, `.capture-manifest-${randomUUID()}.tmp`);
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
    validateOperationalManifest(writtenManifest);
    await rename(temporaryPath, canonicalManifestPath);
    shouldCleanup = false;
    return canonicalManifestPath;
  } catch (error) {
    if (error instanceof CaptureError) throw error;
    throw invalidManifest('The operational manifest could not be saved safely.', error);
  } finally {
    if (shouldCleanup) await removeTemporaryFile(temporaryPath);
  }
}

export async function initializeOperationalManifest({
  appDataDirectory,
  archivePath,
  now = new Date().toISOString(),
}) {
  const canonicalAppData = await resolveAppDataDirectory(appDataDirectory);
  const canonicalArchive = await resolveArchiveDirectory(archivePath);
  const manifestPath = path.join(canonicalAppData, OPERATIONAL_MANIFEST_FILENAME);
  let manifest = await readManifestFile(manifestPath);

  if (!manifest) {
    manifest = createEmptyOperationalManifest({ archivePath: canonicalArchive, now });
    await saveOperationalManifest(manifestPath, manifest);
  } else {
    const recordedArchive = await resolveArchiveDirectory(manifest.archivePath);
    if (recordedArchive !== canonicalArchive) {
      throw invalidManifest('The existing operational manifest belongs to a different archive.');
    }
  }

  return Object.freeze({
    appDataDirectory: canonicalAppData,
    archivePath: canonicalArchive,
    manifestPath,
    manifest,
  });
}

export function cloneOperationalManifest(manifest) {
  validateOperationalManifest(manifest);
  return structuredClone(manifest);
}
