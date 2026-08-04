// Purpose: Defines the versioned metadata and role-marker contract for Capture Markdown.

import { CaptureError, ERROR_CODES } from '../errors.js';
import { createSessionKey, normalizeFullSessionId, normalizeProvider } from './identity.js';

export const CAPTURE_FORMAT_VERSION = 1;
export const MARKDOWN_ROLE_MARKERS = Object.freeze({
  user: '## 👤 USER MESSAGE',
  assistant: '## 🤖 AI RESPONSE',
});

function assertNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new CaptureError(
      ERROR_CODES.INVALID_MARKDOWN_CONTRACT,
      `Markdown metadata field ${fieldName} is invalid.`,
    );
  }
  return value;
}

function normalizeTimestamp(value, fieldName) {
  const parsedTimestamp = Date.parse(value);
  if (!Number.isFinite(parsedTimestamp)) {
    throw new CaptureError(
      ERROR_CODES.INVALID_MARKDOWN_CONTRACT,
      `Markdown metadata field ${fieldName} is invalid.`,
    );
  }
  return new Date(parsedTimestamp).toISOString();
}

export function createMarkdownEnvelope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CaptureError(
      ERROR_CODES.INVALID_MARKDOWN_CONTRACT,
      'Markdown metadata is invalid.',
    );
  }

  const provider = normalizeProvider(input.provider);
  const fullSessionId = normalizeFullSessionId(input.fullSessionId);
  const envelope = {
    captureFormat: CAPTURE_FORMAT_VERSION,
    provider,
    fullSessionId,
    sessionKey: createSessionKey(provider, fullSessionId),
    sourceUpdatedAt: normalizeTimestamp(input.sourceUpdatedAt, 'sourceUpdatedAt'),
    sourceUpdatedSource: String(input.sourceUpdatedSource ?? '').trim(),
    exportedAt: normalizeTimestamp(input.exportedAt, 'exportedAt'),
    messageCount: assertNonNegativeInteger(input.messageCount, 'messageCount'),
    conversationTurnCount: assertNonNegativeInteger(
      input.conversationTurnCount,
      'conversationTurnCount',
    ),
    sourceFormat: String(input.sourceFormat ?? '').trim(),
  };

  if (envelope.sourceUpdatedSource === '' || envelope.sourceFormat === '') {
    throw new CaptureError(
      ERROR_CODES.INVALID_MARKDOWN_CONTRACT,
      'Markdown source metadata is incomplete.',
    );
  }

  return Object.freeze(envelope);
}
