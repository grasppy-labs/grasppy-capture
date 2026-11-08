// Purpose: Provides safe known-root traversal and provider-neutral message extraction helpers.

import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

import { omittedPayload } from '../archive/omit-binary.js';
import { CaptureError, ERROR_CODES } from '../errors.js';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapDirectoryError(error) {
  if (error?.code === 'ENOENT') return { status: 'not-found', entries: [] };
  if (error?.code === 'EACCES' || error?.code === 'EPERM') {
    return { status: 'permission-needed', entries: [] };
  }
  throw new CaptureError(
    ERROR_CODES.SOURCE_READ_FAILED,
    'A known provider directory could not be inspected.',
    { cause: error },
  );
}

export async function inspectDirectory(directoryPath) {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return { status: 'ready', entries };
  } catch (error) {
    return mapDirectoryError(error);
  }
}

export async function inspectRegularFile(filePath) {
  try {
    const fileStat = await lstat(filePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) return null;
    return fileStat;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error?.code === 'EACCES' || error?.code === 'EPERM') {
      throw new CaptureError(
        ERROR_CODES.PROVIDER_PERMISSION_DENIED,
        'Permission is required to inspect this provider source.',
        { cause: error },
      );
    }
    throw new CaptureError(
      ERROR_CODES.SOURCE_READ_FAILED,
      'A provider source could not be inspected.',
      { cause: error },
    );
  }
}

// Incremental catalog gate. When the caller supplies the sync bookkeeping for
// already-archived sessions (path → identity + size + mtime), an unchanged file
// can be cataloged from its stat alone — no content read. Returns the live stat
// only when identity AND stats match exactly; any doubt falls back to a full
// inspection, so a changed or unfamiliar file is always parsed.
export async function matchKnownSource(knownSources, filePath, provider, fullSessionId) {
  if (!(knownSources instanceof Map)) return null;
  const known = knownSources.get(filePath);
  if (!known
    || known.provider !== provider
    || known.fullSessionId !== fullSessionId
    || !Number.isFinite(known.mtimeMs)
    || known.mtimeMs <= 0
    || !Number.isFinite(known.sizeBytes)
    || known.sizeBytes <= 0) {
    return null;
  }
  const fileStat = await inspectRegularFile(filePath);
  if (!fileStat || fileStat.mtimeMs !== known.mtimeMs || fileStat.size !== known.sizeBytes) {
    return null;
  }
  return fileStat;
}

export async function walkRegularFiles(rootPath, predicate, { maxDepth = 6 } = {}) {
  const files = [];

  async function visit(directoryPath, depth) {
    if (depth > maxDepth) return;
    const directory = await inspectDirectory(directoryPath);
    if (directory.status !== 'ready') return;

    for (const entry of directory.entries) {
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath, depth + 1);
      } else if (entry.isFile() && predicate(entry.name, entryPath)) {
        files.push(entryPath);
      }
    }
  }

  await visit(rootPath, 0);
  return files;
}

export function toIsoTimestamp(value) {
  if (value === null || value === undefined) return null;
  const parsedTimestamp = Date.parse(value);
  return Number.isFinite(parsedTimestamp) ? new Date(parsedTimestamp).toISOString() : null;
}

export function newestTimestamp(currentTimestamp, candidateTimestamp) {
  const normalizedCandidate = toIsoTimestamp(candidateTimestamp);
  if (!normalizedCandidate) return currentTimestamp;
  if (!currentTimestamp) return normalizedCandidate;
  return Date.parse(normalizedCandidate) > Date.parse(currentTimestamp)
    ? normalizedCandidate
    : currentTimestamp;
}

function stringifyStructuredValue(value) {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '[Unserializable structured value]';
  }
}

// A tool result can carry media as base64: a screenshot from a browser tool, or an
// image file the agent read. The bytes stay in the provider's own log; the archive
// keeps the block, its media type, size and a short hash, so the evidence remains
// traceable to the source without copying the payload into every export.
// renderCaptureMarkdown sweeps every event afterwards as a backstop for any other shape.
const DATA_URL_PATTERN = /^data:([^;,]+);base64,/;

function omitBinaryPayloads(value) {
  if (!Array.isArray(value)) return value;
  return value.map((block) => {
    const source = block?.source;
    // Claude: { type: 'image', source: { type: 'base64', media_type, data } }
    if (source?.type === 'base64' && typeof source.data === 'string') {
      return { ...block, source: { ...source, data: omittedPayload(source.data) } };
    }
    // Codex: { type: 'input_image', image_url: 'data:image/png;base64,...' }
    const dataUrl = typeof block?.image_url === 'string' ? DATA_URL_PATTERN.exec(block.image_url) : null;
    if (dataUrl) {
      const base64 = block.image_url.slice(dataUrl[0].length);
      return { ...block, image_url: `data:${dataUrl[1]};base64,${omittedPayload(base64)}` };
    }
    return block;
  });
}

function normalizeContentItem(role, item, timestamp, observations) {
  if (typeof item === 'string') {
    return [{ type: role, content: item, timestamp }];
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    observations.add('Ignored an unsupported message content item.');
    return [];
  }

  const itemType = item.type ?? 'unknown';
  if (itemType === 'text' || itemType === 'input_text' || itemType === 'output_text') {
    return [{ type: role, content: String(item.text ?? ''), timestamp }];
  }
  if (itemType === 'tool_use' || itemType === 'function_call') {
    const toolName = String(item.name ?? 'tool');
    return [{
      type: 'tool',
      content: stringifyStructuredValue(item.input ?? item.arguments),
      timestamp,
      metadata: { role, toolName, kind: itemType },
    }];
  }
  if (itemType === 'tool_result' || itemType === 'function_call_output') {
    return [{
      type: 'tool',
      content: stringifyStructuredValue(omitBinaryPayloads(item.content ?? item.output)),
      timestamp,
      metadata: { role, kind: itemType },
    }];
  }
  if (itemType === 'image' || itemType === 'input_image') {
    return [{
      type: 'image',
      content: '[Image content]',
      timestamp,
      metadata: { role, mediaType: item.media_type ?? item.mimeType ?? null },
    }];
  }

  observations.add(`Ignored unknown message content type: ${String(itemType)}.`);
  return [];
}

export function normalizeMessageEvents(role, message, timestamp, observations = new Set()) {
  const content = message?.content ?? message;
  if (typeof content === 'string') {
    return [{ type: role, content, timestamp }];
  }
  if (!Array.isArray(content)) {
    observations.add('Ignored a message with unsupported content structure.');
    return [];
  }
  return content.flatMap((item) => normalizeContentItem(role, item, timestamp, observations));
}

export function deriveTitleFromEvents(events, fallbackTitle) {
  const firstUserText = events.find((event) => event.type === 'user' && event.content.trim() !== '');
  if (!firstUserText) return { value: fallbackTitle, source: 'session identity fallback' };

  const singleLineTitle = firstUserText.content.replace(/\s+/g, ' ').trim();
  return {
    value: singleLineTitle.length > 96 ? `${singleLineTitle.slice(0, 93)}...` : singleLineTitle,
    source: 'first meaningful user text',
  };
}

export function sortSessionsByActivity(sessions) {
  return sessions.sort((left, right) => {
    const leftTime = left.activity.timestamp ? Date.parse(left.activity.timestamp) : 0;
    const rightTime = right.activity.timestamp ? Date.parse(right.activity.timestamp) : 0;
    return rightTime - leftTime;
  });
}
