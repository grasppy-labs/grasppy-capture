// Purpose: Coordinates approved Capture core operations while returning only renderer-safe local bookkeeping.

import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  OPERATIONAL_MANIFEST_FILENAME,
  buildDashboardState,
  buildReviewCatalog,
  catalogProviders,
  getShortSessionId,
  initializeOperationalManifest,
  migrateArchiveFilenames,
  persistReviewCatalog,
  persistSessionExclusion,
  resolveContainedArchiveFile,
  runManualArchiveSync,
  setupArchiveDirectory,
  validateOperationalManifest,
  validateStoredCaptureMarkdown,
} from '../../../../packages/capture-core/src/index.js';
import { migrateBrowserFilenames } from '../../../native-host/src/migrate-browser-filenames.js';

// CLI providers first, then the browser providers the extension can save from.
// A provider missing here falls back to its raw slug in the UI, so this list
// must grow whenever the extension learns a new platform.
const PROVIDER_NAMES = Object.freeze({
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  grok: 'Grok',
  perplexity: 'Perplexity',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  typingmind: 'TypingMind',
  copilot: 'GitHub Copilot',
  replit: 'Replit',
  bolt: 'Bolt',
  lovable: 'Lovable',
});

function safeProviderResults(providerResults) {
  return providerResults.map((result) => Object.freeze({
    provider: result.provider,
    name: PROVIDER_NAMES[result.provider] ?? result.provider,
    status: result.status,
    count: result.sessions.length,
    observations: Object.freeze([...result.observations]),
  }));
}

function safeCatalog(reviewCatalog, providerResults) {
  return Object.freeze({
    providers: Object.freeze(safeProviderResults(providerResults)),
    counts: reviewCatalog.counts,
    items: Object.freeze(reviewCatalog.items.map((item) => Object.freeze({
      sessionKey: item.sessionKey,
      provider: item.provider,
      providerName: PROVIDER_NAMES[item.provider] ?? item.provider,
      // Same 8-character stem the archive filenames use, so a row in the table
      // can be matched to its file on disk (and quoted in a bug report).
      shortSessionId: getShortSessionId(item.fullSessionId),
      title: item.title,
      activityAt: item.activityAt,
      syncState: item.syncState,
      status: item.status,
      excluded: item.excluded,
      sizeBytes: item.sizeBytes,
      processedAt: item.processedAt,
      canOpen: item.syncState === 'synced',
    }))),
  });
}

// Sessions that already synced successfully can be re-cataloged from file stats
// alone — providers skip reading any source whose size and mtime still match
// this bookkeeping, which turns the scan from minutes of parsing into a stat
// walk. Entries that never synced carry no verified state and are always parsed.
function knownSourcesFromManifest(manifest) {
  const knownSources = new Map();
  for (const entry of Object.values(manifest.sessions ?? {})) {
    if (!entry.lastSuccessfulExportAt || typeof entry.sourcePath !== 'string') continue;
    knownSources.set(entry.sourcePath, {
      provider: entry.provider,
      fullSessionId: entry.fullSessionId,
      mtimeMs: entry.sourceMtimeMs,
      sizeBytes: entry.sourceSizeBytes,
    });
  }
  return knownSources;
}

// The manifest does not store conversation titles, so recover a readable one
// from the archive filename: <provider>--<label>--<fullSessionId>.md
function titleFromOutputPath(outputPath, fallback) {
  if (typeof outputPath !== 'string' || outputPath === '') return fallback;
  const segments = path.basename(outputPath, '.md').split('--');
  if (segments.length < 3) return fallback;
  const label = segments.slice(1, -1).join('--').replace(/-/g, ' ').trim();
  return label === '' ? fallback : label;
}

// A catalog rebuilt from local bookkeeping alone, with no provider scan. It lets
// the window show what is already archived the moment it opens instead of an
// empty table for the length of a full rescan; the scan then replaces it.
function manifestCatalog(manifest) {
  const items = Object.entries(manifest.sessions ?? {}).map(([sessionKey, entry]) => {
    const exported = Boolean(entry.lastSuccessfulExportAt);
    const providerName = PROVIDER_NAMES[entry.provider] ?? entry.provider;
    return Object.freeze({
      sessionKey,
      provider: entry.provider,
      providerName,
      shortSessionId: getShortSessionId(entry.fullSessionId),
      title: titleFromOutputPath(entry.outputPath, `${providerName} conversation`),
      activityAt: Number.isFinite(entry.sourceMtimeMs) && entry.sourceMtimeMs > 0
        ? new Date(entry.sourceMtimeMs).toISOString()
        : null,
      syncState: exported ? 'synced' : 'pending',
      status: exported ? 'synced' : 'new',
      excluded: Boolean(entry.excluded),
      sizeBytes: exported ? entry.lastMarkdownSizeBytes ?? null : null,
      processedAt: entry.lastSuccessfulExportAt ?? null,
      canOpen: exported,
    });
  });
  const synced = items.filter((item) => item.syncState === 'synced').length;
  return Object.freeze({
    // Provider cards assert live folder health, which only a scan can establish.
    providers: Object.freeze([]),
    counts: Object.freeze({ all: items.length, synced, pending: items.length - synced }),
    items: Object.freeze(items),
  });
}

function ensureRegularManifest(manifestStat) {
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error('The Capture operational state is unavailable.');
  }
}

export function createCaptureAppService({
  appDataDirectory,
  catalogFunction = catalogProviders,
} = {}) {
  if (typeof appDataDirectory !== 'string' || !path.isAbsolute(appDataDirectory)) {
    throw new TypeError('Capture requires an absolute application-data directory.');
  }

  const manifestPath = path.join(appDataDirectory, OPERATIONAL_MANIFEST_FILENAME);
  let lastProviderResults = null;

  async function loadConfiguredArchive() {
    try {
      const manifestStat = await lstat(manifestPath);
      ensureRegularManifest(manifestStat);
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      validateOperationalManifest(manifest);
      // One-time filename migration to {provider}--{short-id}--{label}.md —
      // fast no-op once every entry is on the new convention. Non-fatal: a
      // failed rename leaves that entry legacy-named for the next pass.
      try {
        const migration = await migrateArchiveFilenames({ manifestPath, manifest });
        if (migration.renamed > 0) {
          console.log(`[capture] archive filename migration: ${migration.renamed} renamed, ${migration.failures.length} deferred`);
        }
      } catch (migrationError) {
        console.warn('[capture] archive filename migration failed (non-fatal):', migrationError?.message);
      }
      // Browser captures were missed by the 2026-08-05 migration and kept the
      // `browser--` prefix, which GRASPPY's scanner cannot read. Same contract:
      // idempotent, no-op once clean, non-fatal.
      try {
        const browserMigration = await migrateBrowserFilenames({
          appDataDirectory,
          archivePath: manifest.archivePath,
        });
        if (browserMigration.renamed > 0) {
          console.log(`[capture] browser filename migration: ${browserMigration.renamed} renamed, ${browserMigration.failures.length} deferred`);
        }
      } catch (migrationError) {
        console.warn('[capture] browser filename migration failed (non-fatal):', migrationError?.message);
      }
      return initializeOperationalManifest({
        appDataDirectory,
        archivePath: manifest.archivePath,
      });
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function requireConfiguredArchive() {
    const configured = await loadConfiguredArchive();
    if (!configured) throw new Error('Choose an archive folder before continuing.');
    return configured;
  }

  async function dashboardFor(manifest) {
    return buildDashboardState(manifest);
  }

  async function getStatus() {
    const configured = await loadConfiguredArchive();
    if (!configured) return Object.freeze({ configured: false });
    return Object.freeze({
      configured: true,
      archivePath: configured.archivePath,
      dashboard: await dashboardFor(configured.manifest),
      catalog: manifestCatalog(configured.manifest),
    });
  }

  async function setup(parentDirectory) {
    const archivePath = await setupArchiveDirectory(parentDirectory);
    const configured = await initializeOperationalManifest({ appDataDirectory, archivePath });
    lastProviderResults = null;
    return Object.freeze({
      configured: true,
      archivePath: configured.archivePath,
      dashboard: await dashboardFor(configured.manifest),
    });
  }

  async function refreshCatalog(providerOptions = {}) {
    const configured = await requireConfiguredArchive();
    const providerResults = await catalogFunction({
      ...providerOptions,
      knownSources: knownSourcesFromManifest(configured.manifest),
    });
    const reviewCatalog = await persistReviewCatalog({
      manifestPath: configured.manifestPath,
      manifest: configured.manifest,
      providerResults,
    });
    lastProviderResults = providerResults;
    return Object.freeze({
      catalog: safeCatalog(reviewCatalog, providerResults),
      dashboard: await dashboardFor(reviewCatalog.manifest),
    });
  }

  async function setExclusion(sessionKey, excluded) {
    const configured = await requireConfiguredArchive();
    const manifest = await persistSessionExclusion({
      manifestPath: configured.manifestPath,
      manifest: configured.manifest,
      sessionKey,
      excluded,
    });
    if (!lastProviderResults) return Object.freeze({ saved: true });
    const reviewCatalog = await buildReviewCatalog(manifest, lastProviderResults);
    return Object.freeze({
      saved: true,
      catalog: safeCatalog(reviewCatalog, lastProviderResults),
    });
  }

  async function syncArchive() {
    const configured = await requireConfiguredArchive();
    // ALWAYS re-catalog. A snapshot cannot contain a conversation that started
    // after it was taken, so reusing the one from window open made Sync Now
    // report "up to date" while newer conversations sat pending — for days.
    // Cataloging is the cheap half: sessions that already synced are matched by
    // size and mtime alone, and only pending entries are ever written.
    lastProviderResults = await catalogFunction({
      knownSources: knownSourcesFromManifest(configured.manifest),
    });
    const result = await runManualArchiveSync({
      manifestPath: configured.manifestPath,
      manifest: configured.manifest,
      providerResults: lastProviderResults,
    });
    const reviewCatalog = await buildReviewCatalog(result.manifest, lastProviderResults);
    return Object.freeze({
      run: result.run,
      failures: result.failures,
      catalog: safeCatalog(reviewCatalog, lastProviderResults),
      dashboard: await dashboardFor(result.manifest),
    });
  }

  async function getArchiveDirectoryPath() {
    return (await requireConfiguredArchive()).archivePath;
  }

  async function getArchivedSessionPath(sessionKey) {
    const configured = await requireConfiguredArchive();
    const entry = configured.manifest.sessions[sessionKey];
    if (!entry?.outputPath) throw new Error('No archived Markdown is available for this conversation.');
    const outputPath = await resolveContainedArchiveFile(configured.archivePath, entry.outputPath);
    const markdown = await readFile(outputPath, 'utf8');
    validateStoredCaptureMarkdown(markdown, entry);
    return outputPath;
  }

  return Object.freeze({
    getStatus,
    setup,
    refreshCatalog,
    setExclusion,
    syncArchive,
    getArchiveDirectoryPath,
    getArchivedSessionPath,
  });
}
