// Purpose: One-time, idempotent migration of archive filenames from the legacy
// {provider}--{label}--{full-uuid}.md form to {provider}--{short-id}--{label}.md
// (owner decision 2026-08-05: the id belongs at a fixed slot after the provider).
// Renames files in place and updates each session's pinned outputPath — content,
// exclusions, and every Grasppy link survive because identity is the full session
// UUID inside each file, never the filename. A manifest with no legacy names is
// a fast no-op, so this can safely run on every app start.

import { rename } from 'node:fs/promises';
import path from 'node:path';

import { createStableArchiveFilename, sanitizeFilenameLabel } from './paths.js';
import { saveOperationalManifest } from './manifest-store.js';

const LEGACY_BASENAME = /^(claude-code|codex|cursor)--(.+)--([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.md$/i;

export async function migrateArchiveFilenames({ manifestPath, manifest, manifestWriter = saveOperationalManifest }) {
  const sessions = manifest?.sessions ?? {};
  const legacyKeys = Object.keys(sessions).filter((key) => {
    const entry = sessions[key];
    return typeof entry?.outputPath === 'string' && LEGACY_BASENAME.test(path.basename(entry.outputPath));
  });
  if (legacyKeys.length === 0) {
    return { renamed: 0, unchanged: Object.keys(sessions).length, failures: [] };
  }

  // Plain deep clone — callers hand us an already-validated manifest, and the
  // default manifestWriter (saveOperationalManifest) re-validates on write.
  const next = structuredClone(manifest);
  const taken = new Set(
    Object.values(next.sessions)
      .filter((entry) => typeof entry.outputPath === 'string')
      .map((entry) => path.basename(entry.outputPath).toLowerCase()),
  );
  const failures = [];
  let renamed = 0;

  for (const sessionKey of legacyKeys.sort()) {
    const entry = next.sessions[sessionKey];
    const oldPath = entry.outputPath;
    const oldBasename = path.basename(oldPath);
    const label = sanitizeFilenameLabel(oldBasename.match(LEGACY_BASENAME)[2]);

    let newBasename = null;
    for (const idLength of [8, 12, 36]) {
      const candidate = createStableArchiveFilename({
        provider: entry.provider,
        title: label,
        fullSessionId: entry.fullSessionId,
        idLength,
      });
      const prefix = candidate.toLowerCase().split('--').slice(0, 2).join('--') + '--';
      const clash = [...taken].some((b) => b !== oldBasename.toLowerCase() && b.startsWith(prefix));
      if (!clash) { newBasename = candidate; break; }
    }
    if (!newBasename) {
      failures.push({ sessionKey, reason: 'no collision-free filename' });
      continue;
    }

    const newPath = path.join(path.dirname(oldPath), newBasename);
    try {
      await rename(oldPath, newPath);
    } catch (error) {
      // Missing file: leave the entry legacy-named — the next successful sync
      // or migration pass retries. Never guess at content.
      failures.push({ sessionKey, reason: error?.code || 'rename failed' });
      continue;
    }
    taken.delete(oldBasename.toLowerCase());
    taken.add(newBasename.toLowerCase());
    entry.outputPath = newPath;
    renamed += 1;
  }

  await manifestWriter(manifestPath, next);
  return { renamed, unchanged: Object.keys(next.sessions).length - renamed, failures, manifest: next };
}
