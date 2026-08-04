// Purpose: Creates the standardized archive and enforces canonical write containment and stable filenames.

import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { normalizeFullSessionId, normalizeProvider } from '../contracts/identity.js';
import { CaptureError, ERROR_CODES } from '../errors.js';

export const ARCHIVE_DIRECTORY_NAME = 'GRASPPY Capture Archive';

function archivePathError(message) {
  return new CaptureError(ERROR_CODES.ARCHIVE_UNAVAILABLE, message);
}

function assertAbsolutePath(candidatePath, message) {
  if (typeof candidatePath !== 'string' || !path.isAbsolute(candidatePath)) {
    throw archivePathError(message);
  }
}

function isDirectChild(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath !== ''
    && !relativePath.startsWith(`..${path.sep}`)
    && relativePath !== '..'
    && !path.isAbsolute(relativePath)
    && !relativePath.includes(path.sep);
}

async function assertDirectoryIsNotSymlink(directoryPath, message) {
  const directoryStat = await lstat(directoryPath);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw archivePathError(message);
  }
}

export async function setupArchiveDirectory(parentDirectory) {
  assertAbsolutePath(parentDirectory, 'Choose a valid parent directory for the local archive.');
  try {
    await assertDirectoryIsNotSymlink(parentDirectory, 'The selected archive parent must be a real directory.');
    const canonicalParent = await realpath(parentDirectory);
    const requestedArchive = path.join(canonicalParent, ARCHIVE_DIRECTORY_NAME);

    try {
      await mkdir(requestedArchive, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }

    await assertDirectoryIsNotSymlink(requestedArchive, 'The archive directory must not be a symbolic link.');
    const canonicalArchive = await realpath(requestedArchive);
    if (!isDirectChild(canonicalParent, canonicalArchive)
      || path.basename(canonicalArchive) !== ARCHIVE_DIRECTORY_NAME) {
      throw archivePathError('The archive directory resolved outside the selected parent.');
    }
    return canonicalArchive;
  } catch (error) {
    if (error instanceof CaptureError) throw error;
    throw archivePathError('The local archive directory could not be created or opened.');
  }
}

export async function resolveArchiveDirectory(archiveDirectory) {
  assertAbsolutePath(archiveDirectory, 'The archive directory is invalid.');
  try {
    await assertDirectoryIsNotSymlink(archiveDirectory, 'The archive directory must not be a symbolic link.');
    return await realpath(archiveDirectory);
  } catch (error) {
    if (error instanceof CaptureError) throw error;
    throw archivePathError('The local archive directory is unavailable.');
  }
}

export async function resolveContainedArchiveFile(archiveDirectory, candidatePath) {
  assertAbsolutePath(candidatePath, 'The archive output path is invalid.');
  const canonicalArchive = await resolveArchiveDirectory(archiveDirectory);
  const candidateName = path.basename(candidatePath);
  if (!candidateName.toLowerCase().endsWith('.md') || candidateName.startsWith('.')) {
    throw archivePathError('The archive output filename is invalid.');
  }

  const candidateParent = await realpath(path.dirname(candidatePath));
  const canonicalCandidate = path.join(candidateParent, candidateName);
  if (candidateParent !== canonicalArchive || !isDirectChild(canonicalArchive, canonicalCandidate)) {
    throw archivePathError('The archive output path resolved outside the archive directory.');
  }

  try {
    const candidateStat = await lstat(canonicalCandidate);
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) {
      throw archivePathError('The archive output must be a regular Markdown file.');
    }
    const resolvedCandidate = await realpath(canonicalCandidate);
    if (!isDirectChild(canonicalArchive, resolvedCandidate)) {
      throw archivePathError('The archive output resolved outside the archive directory.');
    }
    return resolvedCandidate;
  } catch (error) {
    if (error instanceof CaptureError) throw error;
    if (error?.code === 'ENOENT') return canonicalCandidate;
    throw archivePathError('The archive output path could not be inspected safely.');
  }
}

export function sanitizeFilenameLabel(value) {
  const normalizedValue = String(value ?? '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[. -]+|[. -]+$/g, '')
    .slice(0, 72)
    .replace(/[. -]+$/g, '');
  if (normalizedValue === '' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(normalizedValue)) {
    return 'conversation';
  }
  return normalizedValue;
}

export function createStableArchiveFilename({ provider, title, providerProjectKey, fullSessionId }) {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedSessionId = normalizeFullSessionId(fullSessionId);
  const readableLabel = sanitizeFilenameLabel(title ?? providerProjectKey ?? 'conversation');
  return `${normalizedProvider}--${readableLabel}--${normalizedSessionId}.md`;
}
