// Purpose: Derives the archive filename for a browser capture, in the one shape GRASPPY's scanner reads.
//
// GRASPPY's archive scanner is left-anchored on a known provider and takes the
// id from a FIXED second slot:
//
//   {provider}--{8-hex | 12-hex | full-uuid}--{label}.md
//
// The original browser shape was `browser--{provider}--{label}--{id}.md`. The
// literal `browser` token is not a provider, so that name matched neither of
// the scanner's two patterns and every browser save was skipped silently — no
// row, no error, nothing in Auto Capture, while the extension reported success
// and the file sat on disk. The 2026-08-05 filename migration moved the CLI
// path to the new convention and left this one behind.
//
// Identity NEVER comes from the filename. GRASPPY reads `**Session ID:**` from
// the header inside the file, so the id slot only has to be the right SHAPE.
// That is what makes a hash acceptable for providers whose ids are not hex.
//
// Copyright © 2025-2026 Gennady Batrakov. All Rights Reserved.

import { createHash } from 'node:crypto';

import { sanitizeFilenameLabel } from '../../../packages/capture-core/src/index.js';

// Matches the CLI path's label handling (createStableArchiveFilename): dash runs
// are collapsed, so a label can never contain '--' and the three slots stay
// unambiguous by construction.
const LABEL_MAX = 56;

// A basename already on the new convention. Used by the migration to decide
// what still needs renaming, so it must stay in step with GRASPPY's own
// FILENAME_NEW_RE (scripts/chat-sync-daemon/capture-archive.js).
export const BROWSER_FILENAME_RE =
  /^[a-z0-9-]+--([0-9a-f]{8}(?:[0-9a-f]{4})?|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})--.+\.md$/i;

// Id-segment lengths BROWSER_FILENAME_RE accepts, shortest first. Only these
// two are usable everywhere: the dashed-UUID form the regex also allows has no
// equivalent for the digest branch, so slug and opaque providers could never
// produce it. 8 is the default; 12 exists so a collision can be escalated out
// of instead of one capture overwriting another.
export const BROWSER_ID_LENGTHS = Object.freeze([8, 12]);

/**
 * The id segment: 8 hex characters by default, matching the CLI path so every
 * file in the archive reads the same way.
 *
 * Both branches are deterministic, which is the property that matters — the
 * same conversation must always produce the same filename, or a re-export
 * writes a second file instead of replacing the first.
 *
 * - Hex ids (chatgpt, claude, lovable, copilot, mistral, and any provider whose
 *   id is a UUID) lend their first 8 hex characters, exactly like
 *   archiveFilenameId() does for CLI sessions.
 * - Slug and opaque ids (replit's project name, perplexity's slug, gemini's and
 *   typingmind's opaque strings, bolt) have no hex to borrow, so they get the
 *   first 8 hex characters of a salted digest instead.
 *
 * `idLength` widens that segment for the migration's collision escalation. An
 * id with fewer hex characters than requested simply yields what it has, which
 * escalates to the same name and is correctly treated as an unresolved clash.
 */
export function browserFilenameId(provider, conversationId, idLength = 8) {
  const raw = String(conversationId ?? '');
  const hexOnly = raw.replace(/-/g, '');
  if (/^[0-9a-f]{8,}$/i.test(hexOnly)) return hexOnly.slice(0, idLength).toLowerCase();
  return createHash('sha256').update(`${provider}:${raw}`).digest('hex').slice(0, idLength);
}

/** The label segment: ASCII, no separators, no '--', never empty. */
export function browserFilenameLabel(title) {
  return sanitizeFilenameLabel(title)
    .replace(/[^a-z0-9._-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, LABEL_MAX) || 'conversation';
}

/** `{provider}--{8-hex}--{label}.md` — the only shape this host writes. */
export function browserArchiveFilename({ provider, conversationId, title, idLength = 8 }) {
  return `${provider}--${browserFilenameId(provider, conversationId, idLength)}--${browserFilenameLabel(title)}.md`;
}
