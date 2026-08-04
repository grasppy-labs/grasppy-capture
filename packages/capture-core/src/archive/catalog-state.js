// Purpose: Reconciles provider candidates with persisted sync truth and remembered exclusions without writing archive files.

import { lstat, readFile } from 'node:fs/promises';

import { createSessionKey, normalizeFullSessionId, normalizeProvider } from '../contracts/identity.js';
import { validateOperationalManifest } from '../contracts/manifest-schema.js';
import { CaptureError, ERROR_CODES } from '../errors.js';
import { cloneOperationalManifest, saveOperationalManifest } from './manifest-store.js';
import { resolveContainedArchiveFile } from './paths.js';
import { validateStoredCaptureMarkdown } from './validate-markdown.js';

function invalidCatalog(message) {
  return new CaptureError(ERROR_CODES.INVALID_INPUT, message);
}

function assertSourceStat(candidate) {
  if (!candidate?.sourceStat
    || !Number.isFinite(candidate.sourceStat.mtimeMs)
    || candidate.sourceStat.mtimeMs < 0
    || !Number.isFinite(candidate.sourceStat.sizeBytes)
    || candidate.sourceStat.sizeBytes < 0) {
    throw invalidCatalog('A catalog candidate has invalid source bookkeeping.');
  }
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw invalidCatalog('A catalog candidate is invalid.');
  }
  const provider = normalizeProvider(candidate.provider);
  const fullSessionId = normalizeFullSessionId(candidate.fullSessionId);
  const sessionKey = createSessionKey(provider, fullSessionId);
  if (candidate.sessionKey !== sessionKey
    || typeof candidate.sourcePath !== 'string'
    || candidate.sourcePath.trim() === '') {
    throw invalidCatalog('A catalog candidate identity or source path is invalid.');
  }
  assertSourceStat(candidate);
  return { provider, fullSessionId, sessionKey, candidate };
}

function providerStatusMap(providerResults) {
  if (!Array.isArray(providerResults)) throw invalidCatalog('Provider catalog results are invalid.');
  return new Map(providerResults.map((result) => [normalizeProvider(result.provider), result.status]));
}

export function flattenProviderCandidates(providerResults) {
  if (!Array.isArray(providerResults)) throw invalidCatalog('Provider catalog results are invalid.');
  const candidates = [];
  const observedKeys = new Set();
  for (const result of providerResults) {
    normalizeProvider(result.provider);
    if (!Array.isArray(result.sessions)) throw invalidCatalog('Provider catalog sessions are invalid.');
    for (const session of result.sessions) {
      const normalized = normalizeCandidate(session);
      if (observedKeys.has(normalized.sessionKey)) {
        throw invalidCatalog('Provider catalog contains a duplicate canonical session identity.');
      }
      observedKeys.add(normalized.sessionKey);
      candidates.push(normalized.candidate);
    }
  }
  return candidates;
}

export function applyCatalogToManifest(manifest, providerResults) {
  validateOperationalManifest(manifest);
  const nextManifest = cloneOperationalManifest(manifest);
  for (const candidate of flattenProviderCandidates(providerResults)) {
    const current = nextManifest.sessions[candidate.sessionKey];
    nextManifest.sessions[candidate.sessionKey] = current
      ? { ...current, sourcePath: candidate.sourcePath }
      : {
        provider: candidate.provider,
        fullSessionId: candidate.fullSessionId,
        sourcePath: candidate.sourcePath,
        sourceMtimeMs: 0,
        sourceSizeBytes: 0,
        outputPath: null,
        formatVersion: null,
        lastSuccessfulExportAt: null,
        lastMarkdownSizeBytes: null,
        excluded: false,
      };
  }
  validateOperationalManifest(nextManifest);
  return nextManifest;
}

export function setSessionExclusion(manifest, sessionKey, excluded) {
  validateOperationalManifest(manifest);
  if (typeof excluded !== 'boolean' || !manifest.sessions[sessionKey]) {
    throw invalidCatalog('The exclusion preference or session identity is invalid.');
  }
  const nextManifest = cloneOperationalManifest(manifest);
  nextManifest.sessions[sessionKey].excluded = excluded;
  validateOperationalManifest(nextManifest);
  return nextManifest;
}

export async function persistReviewCatalog({
  manifestPath,
  manifest,
  providerResults,
  now = new Date().toISOString(),
  manifestWriter = saveOperationalManifest,
}) {
  const reviewCatalog = await buildReviewCatalog(manifest, providerResults);
  reviewCatalog.manifest.updatedAt = new Date(now).toISOString();
  validateOperationalManifest(reviewCatalog.manifest);
  await manifestWriter(manifestPath, reviewCatalog.manifest);
  return reviewCatalog;
}

export async function persistSessionExclusion({
  manifestPath,
  manifest,
  sessionKey,
  excluded,
  now = new Date().toISOString(),
  manifestWriter = saveOperationalManifest,
}) {
  const nextManifest = setSessionExclusion(manifest, sessionKey, excluded);
  nextManifest.updatedAt = new Date(now).toISOString();
  validateOperationalManifest(nextManifest);
  await manifestWriter(manifestPath, nextManifest);
  return nextManifest;
}

async function hasValidCurrentOutput(manifest, entry) {
  if (!entry.outputPath || entry.lastSuccessfulExportAt === null) return false;
  try {
    const outputPath = await resolveContainedArchiveFile(manifest.archivePath, entry.outputPath);
    const outputStat = await lstat(outputPath);
    const markdown = await readFile(outputPath, 'utf8');
    validateStoredCaptureMarkdown(markdown, entry);
    return entry.lastMarkdownSizeBytes === outputStat.size;
  } catch {
    return false;
  }
}

function unavailableStatus(providerStatus) {
  if (providerStatus === 'permission-needed') return 'permission-needed';
  return 'unavailable';
}

function sortCatalogItems(items) {
  return items.sort((left, right) => {
    const leftTime = Date.parse(left.activityAt ?? '') || 0;
    const rightTime = Date.parse(right.activityAt ?? '') || 0;
    return rightTime - leftTime || left.sessionKey.localeCompare(right.sessionKey);
  });
}

export async function buildReviewCatalog(manifest, providerResults) {
  validateOperationalManifest(manifest);
  const reconciledManifest = applyCatalogToManifest(manifest, providerResults);
  const statuses = providerStatusMap(providerResults);
  const candidates = flattenProviderCandidates(providerResults);
  const candidatesByKey = new Map(candidates.map((candidate) => [candidate.sessionKey, candidate]));
  const items = [];

  for (const [sessionKey, entry] of Object.entries(reconciledManifest.sessions)) {
    const candidate = candidatesByKey.get(sessionKey);
    if (!candidate) {
      items.push(Object.freeze({
        sessionKey,
        provider: entry.provider,
        fullSessionId: entry.fullSessionId,
        title: null,
        activityAt: null,
        syncState: 'pending',
        status: unavailableStatus(statuses.get(entry.provider)),
        excluded: entry.excluded,
        sizeBytes: entry.lastMarkdownSizeBytes,
        processedAt: entry.lastSuccessfulExportAt,
        candidate: null,
      }));
      continue;
    }

    const sourceMatches = entry.lastSuccessfulExportAt !== null
      && entry.sourceMtimeMs === candidate.sourceStat.mtimeMs
      && entry.sourceSizeBytes === candidate.sourceStat.sizeBytes;
    const outputIsCurrent = sourceMatches && await hasValidCurrentOutput(reconciledManifest, entry);
    const incomplete = candidate.completeness?.isComplete === false;
    const syncState = outputIsCurrent && !incomplete ? 'synced' : 'pending';
    const status = incomplete
      ? 'incomplete'
      : outputIsCurrent
        ? 'synced'
        : entry.lastSuccessfulExportAt === null
          ? 'new'
          : sourceMatches
            ? 'archive-missing'
            : 'changed';

    items.push(Object.freeze({
      sessionKey,
      provider: entry.provider,
      fullSessionId: entry.fullSessionId,
      title: candidate.title?.value ?? null,
      activityAt: candidate.activity?.timestamp ?? null,
      syncState,
      status,
      excluded: entry.excluded,
      sizeBytes: entry.lastMarkdownSizeBytes,
      processedAt: entry.lastSuccessfulExportAt,
      candidate,
    }));
  }

  sortCatalogItems(items);
  const pending = items.filter((item) => item.syncState === 'pending').length;
  const synced = items.filter((item) => item.syncState === 'synced').length;
  return Object.freeze({
    manifest: reconciledManifest,
    items: Object.freeze(items),
    counts: Object.freeze({ pending, synced, all: items.length }),
  });
}

export function createFixedRunSet(reviewCatalog) {
  if (!reviewCatalog || !Array.isArray(reviewCatalog.items)) {
    throw invalidCatalog('The review catalog is invalid.');
  }
  return Object.freeze(reviewCatalog.items
    .filter((item) => item.syncState === 'pending' && !item.excluded && item.candidate)
    .map((item) => Object.freeze({
      sessionKey: item.sessionKey,
      provider: item.provider,
      fullSessionId: item.fullSessionId,
      candidate: structuredClone(item.candidate),
    })));
}
