// Purpose: Derives content-free Dashboard totals from completed runs and currently validated archive Markdown.

import { lstat, readFile } from 'node:fs/promises';

import { PROVIDERS } from '../contracts/identity.js';
import { validateOperationalManifest } from '../contracts/manifest-schema.js';
import { resolveContainedArchiveFile } from './paths.js';
import { validateStoredCaptureMarkdown } from './validate-markdown.js';

async function inspectValidatedOutputs(manifest) {
  const providerTotals = new Map(Object.values(PROVIDERS).map((provider) => [provider, {
    provider,
    fileCount: 0,
    sizeBytes: 0,
  }]));
  let fileCount = 0;
  let sizeBytes = 0;
  let invalidFiles = 0;

  for (const entry of Object.values(manifest.sessions)) {
    if (!entry.outputPath) continue;
    try {
      const outputPath = await resolveContainedArchiveFile(manifest.archivePath, entry.outputPath);
      const outputStat = await lstat(outputPath);
      const markdown = await readFile(outputPath, 'utf8');
      validateStoredCaptureMarkdown(markdown, entry);
      fileCount += 1;
      sizeBytes += outputStat.size;
      const totals = providerTotals.get(entry.provider) ?? {
        provider: entry.provider,
        fileCount: 0,
        sizeBytes: 0,
      };
      totals.fileCount += 1;
      totals.sizeBytes += outputStat.size;
      providerTotals.set(entry.provider, totals);
    } catch {
      invalidFiles += 1;
    }
  }

  return {
    fileCount,
    sizeBytes,
    invalidFiles,
    providers: [...providerTotals.values()].sort((left, right) => left.provider.localeCompare(right.provider)),
  };
}

function buildCalendar(runs, calendarDateKey) {
  const days = new Map();
  for (const run of runs) {
    const date = calendarDateKey(run.completedAt);
    const current = days.get(date) ?? {
      date,
      completedRuns: 0,
      filesProcessed: 0,
      bytesWritten: 0,
      providers: new Set(),
    };
    current.completedRuns += 1;
    current.filesProcessed += run.results.created + run.results.replaced + run.results.unchanged;
    current.bytesWritten += run.bytesWritten;
    run.providers.forEach((provider) => current.providers.add(provider));
    days.set(date, current);
  }
  return [...days.values()]
    .map((day) => Object.freeze({
      date: day.date,
      completedRuns: day.completedRuns,
      filesProcessed: day.filesProcessed,
      bytesWritten: day.bytesWritten,
      providerCount: day.providers.size,
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

// Recovers the readable label from the stable archive filename
// (<provider>--<label>--<fullSessionId>.md) without opening the file.
function labelFromOutputPath(outputPath, fallback) {
  if (typeof outputPath !== 'string' || outputPath === '') return fallback;
  const segments = outputPath.split('/').pop().replace(/\.md$/, '').split('--');
  if (segments.length < 3) return fallback;
  const label = segments.slice(1, -1).join('--').replace(/-/g, ' ').trim();
  return label === '' ? fallback : label;
}

// Two per-conversation calendars, both content-free (short id + filename label):
//   synced   — the day each conversation was last archived (lastSuccessfulExportAt)
//   activity — the day each conversation was last worked on locally (sourceMtimeMs)
// Never-synced sessions carry no verified bookkeeping yet, so they appear in
// neither; they join both calendars on their first successful sync.
function buildSessionCalendars(manifest, calendarDateKey) {
  const buckets = { synced: new Map(), activity: new Map() };
  const add = (mode, date, entry) => {
    const day = buckets[mode].get(date) ?? { date, count: 0, entries: [] };
    day.count += 1;
    day.entries.push(entry);
    buckets[mode].set(date, day);
  };

  for (const session of Object.values(manifest.sessions)) {
    if (!session.lastSuccessfulExportAt) continue;
    const entry = Object.freeze({
      provider: session.provider,
      shortId: session.fullSessionId.slice(0, 8),
      label: labelFromOutputPath(session.outputPath, `${session.provider} conversation`),
    });
    add('synced', calendarDateKey(session.lastSuccessfulExportAt), entry);
    if (Number.isFinite(session.sourceMtimeMs) && session.sourceMtimeMs > 0) {
      add('activity', calendarDateKey(new Date(session.sourceMtimeMs).toISOString()), entry);
    }
  }

  const finalize = (days) => Object.freeze([...days.values()]
    .map((day) => Object.freeze({ date: day.date, count: day.count, entries: Object.freeze(day.entries) }))
    .sort((left, right) => left.date.localeCompare(right.date)));
  return Object.freeze({ synced: finalize(buckets.synced), activity: finalize(buckets.activity) });
}

export async function buildDashboardState(
  manifest,
  { calendarDateKey = (timestamp) => timestamp.slice(0, 10) } = {},
) {
  validateOperationalManifest(manifest);
  const currentArchive = await inspectValidatedOutputs(manifest);
  const lastRun = manifest.runs.at(-1) ?? null;
  const calendar = buildCalendar(manifest.runs, calendarDateKey);
  const sessionCalendars = buildSessionCalendars(manifest, calendarDateKey);

  return Object.freeze({
    lastSync: lastRun ? Object.freeze(structuredClone(lastRun)) : null,
    sessionCalendars,
    currentArchive: Object.freeze({
      fileCount: currentArchive.fileCount,
      sizeBytes: currentArchive.sizeBytes,
      invalidFiles: currentArchive.invalidFiles,
    }),
    providers: Object.freeze(currentArchive.providers.map((provider) => Object.freeze(provider))),
    calendar: Object.freeze(calendar),
    recentRuns: Object.freeze(
      manifest.runs.slice().reverse().map((run) => Object.freeze(structuredClone(run))),
    ),
  });
}
