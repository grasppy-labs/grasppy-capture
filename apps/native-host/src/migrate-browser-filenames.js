// Purpose: One-time, idempotent rename of browser captures onto the {provider}--{id}--{label} convention.
//
// The sibling of packages/capture-core/src/archive/migrate-filenames.js, which
// did this for CLI sessions on 2026-08-05 and left browser sessions on the old
// `browser--{provider}--{label}--{id}.md` shape. Those names are invisible to
// GRASPPY's scanner, so every affected file is sitting in the archive unread.
//
// Renaming is safe because identity lives in the `**Session ID:**` header
// inside each file, never in its name — exclusions, import history and every
// Grasppy link survive the rename untouched.
//
// A manifest with no old-style names is a fast no-op, so this can run on every
// app start. Failures are per-entry and never throw: a file that cannot be
// renamed keeps its old name and is retried on the next pass.
//
// Copyright © 2025-2026 Gennady Batrakov. All Rights Reserved.

import { rename, stat } from 'node:fs/promises';
import path from 'node:path';

import { BROWSER_FILENAME_RE, BROWSER_ID_LENGTHS, browserArchiveFilename } from './browser-filename.js';
import { loadBrowserManifest, saveBrowserManifest, cloneBrowserManifest } from './browser-manifest.js';

/** Title for the new name, recovered from the old basename's label slot. */
function labelFromLegacyBasename(basename, provider) {
  const withoutExtension = basename.replace(/\.md$/i, '');
  const prefix = `browser--${provider}--`;
  if (!withoutExtension.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const remainder = withoutExtension.slice(prefix.length);
  // The old shape put the id last: {label}--{id}. Split at the FINAL '--'
  // because a label never contains one (dash runs are collapsed at write time).
  const separator = remainder.lastIndexOf('--');
  return separator === -1 ? remainder : remainder.slice(0, separator);
}

export async function migrateBrowserFilenames({
  appDataDirectory,
  archivePath,
  now = new Date().toISOString(),
  manifestWriter = saveBrowserManifest,
}) {
  const loaded = await loadBrowserManifest({ appDataDirectory, now });
  const sessions = loaded.manifest?.sessions ?? {};
  const staleKeys = Object.keys(sessions).filter(
    (key) => typeof sessions[key]?.outputFilename === 'string'
      && !BROWSER_FILENAME_RE.test(sessions[key].outputFilename),
  );
  if (staleKeys.length === 0) {
    return { renamed: 0, unchanged: Object.keys(sessions).length, failures: [] };
  }

  const next = cloneBrowserManifest(loaded.manifest);
  // Every name already spoken for, migrated or not. rename() replaces an
  // existing target without complaint, so without this two captures resolving
  // to one basename would cost the user a conversation, silently and for good.
  const taken = new Set(
    Object.values(next.sessions)
      .filter((entry) => typeof entry.outputFilename === 'string')
      .map((entry) => entry.outputFilename.toLowerCase()),
  );
  const failures = [];
  let renamed = 0;

  for (const sessionKey of staleKeys.sort()) {
    const entry = next.sessions[sessionKey];
    const oldBasename = entry.outputFilename;
    const label = labelFromLegacyBasename(oldBasename, entry.provider);
    if (label === null) {
      failures.push({ sessionKey, reason: 'unrecognized legacy filename' });
      continue;
    }

    // Shortest id segment nothing else already owns. Matching the CLI
    // migration, the check is on the `{provider}--{id}--` prefix rather than
    // the whole name, so the id slot stays unambiguous whatever the label.
    let newBasename = null;
    for (const idLength of BROWSER_ID_LENGTHS) {
      const candidate = browserArchiveFilename({
        provider: entry.provider,
        conversationId: entry.conversationId,
        title: label,
        idLength,
      });
      const prefix = `${candidate.toLowerCase().split('--').slice(0, 2).join('--')}--`;
      const clash = [...taken].some((basename) => basename !== oldBasename.toLowerCase()
        && basename.startsWith(prefix));
      if (!clash) { newBasename = candidate; break; }
    }
    if (newBasename === null) {
      // Leave it legacy-named. An unreadable file is recoverable; an
      // overwritten one is not.
      failures.push({ sessionKey, reason: 'no collision-free filename' });
      continue;
    }

    const oldPath = path.join(archivePath, oldBasename);
    const newPath = path.join(archivePath, newBasename);

    try {
      await rename(oldPath, newPath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        // The old file is gone. If the new name is already in place the rename
        // simply happened earlier — repoint and move on. Otherwise leave the
        // entry alone rather than invent a pointer to a file that isn't there.
        try {
          await stat(newPath);
        } catch {
          failures.push({ sessionKey, reason: 'source and target both missing' });
          continue;
        }
      } else {
        failures.push({ sessionKey, reason: error?.code || 'rename failed' });
        continue;
      }
    }

    taken.delete(oldBasename.toLowerCase());
    taken.add(newBasename.toLowerCase());
    entry.outputFilename = newBasename;
    renamed += 1;
  }

  next.updatedAt = now;
  await manifestWriter(loaded.manifestPath, next);
  return {
    renamed,
    unchanged: Object.keys(next.sessions).length - renamed,
    failures,
    manifest: next,
  };
}
