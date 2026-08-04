// Purpose: Creates and validates the provider-neutral local conversation model.

import { CaptureError, ERROR_CODES } from '../errors.js';
import {
  createSessionKey,
  getShortSessionId,
  normalizeFullSessionId,
  normalizeProvider,
} from './identity.js';

export const NORMALIZED_SESSION_SCHEMA_VERSION = 1;
export const EVENT_TYPES = Object.freeze([
  'user',
  'assistant',
  'tool',
  'image',
  'lifecycle',
  'compaction',
]);
export const ACTIVITY_CONFIDENCE = Object.freeze(['high', 'medium', 'low']);

const EVENT_TYPE_SET = new Set(EVENT_TYPES);
const ACTIVITY_CONFIDENCE_SET = new Set(ACTIVITY_CONFIDENCE);

function requireString(value, fieldName, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    throw new CaptureError(
      ERROR_CODES.INVALID_NORMALIZED_SESSION,
      `Normalized session field ${fieldName} is invalid.`,
    );
  }
  return value;
}

function normalizeOptionalString(value, fieldName) {
  if (value === null || value === undefined) return null;
  return requireString(value, fieldName);
}

function normalizeTimestamp(value, fieldName) {
  if (value === null || value === undefined) return null;
  const parsedTimestamp = Date.parse(value);
  if (!Number.isFinite(parsedTimestamp)) {
    throw new CaptureError(
      ERROR_CODES.INVALID_NORMALIZED_SESSION,
      `Normalized session field ${fieldName} is invalid.`,
    );
  }
  return new Date(parsedTimestamp).toISOString();
}

function normalizeStringList(value, fieldName) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new CaptureError(
      ERROR_CODES.INVALID_NORMALIZED_SESSION,
      `Normalized session field ${fieldName} is invalid.`,
    );
  }
  return [...value];
}

function normalizeEvents(events) {
  if (!Array.isArray(events)) {
    throw new CaptureError(
      ERROR_CODES.INVALID_NORMALIZED_SESSION,
      'Normalized session events must be an ordered array.',
    );
  }

  return events.map((event, index) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new CaptureError(
        ERROR_CODES.INVALID_NORMALIZED_SESSION,
        'A normalized session event is invalid.',
      );
    }
    if (!EVENT_TYPE_SET.has(event.type)) {
      throw new CaptureError(
        ERROR_CODES.INVALID_NORMALIZED_SESSION,
        'A normalized session event type is unsupported.',
      );
    }

    return Object.freeze({
      sequence: index + 1,
      type: event.type,
      content: requireString(event.content, `events[${index}].content`, { allowEmpty: true }),
      timestamp: normalizeTimestamp(event.timestamp, `events[${index}].timestamp`),
      metadata: event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
        ? Object.freeze({ ...event.metadata })
        : null,
    });
  });
}

export function createNormalizedSession(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CaptureError(
      ERROR_CODES.INVALID_NORMALIZED_SESSION,
      'Normalized session input is invalid.',
    );
  }

  const provider = normalizeProvider(input.provider);
  const fullSessionId = normalizeFullSessionId(input.fullSessionId);
  const confidence = input.activity?.confidence ?? 'low';
  if (!ACTIVITY_CONFIDENCE_SET.has(confidence)) {
    throw new CaptureError(
      ERROR_CODES.INVALID_NORMALIZED_SESSION,
      'Normalized session activity confidence is invalid.',
    );
  }

  const normalizedSession = {
    schemaVersion: NORMALIZED_SESSION_SCHEMA_VERSION,
    sessionKey: createSessionKey(provider, fullSessionId),
    provider,
    fullSessionId,
    shortSessionId: getShortSessionId(fullSessionId),
    source: Object.freeze({
      path: requireString(input.source?.path, 'source.path'),
      providerProjectKey: normalizeOptionalString(
        input.source?.providerProjectKey,
        'source.providerProjectKey',
      ),
      workspacePath: normalizeOptionalString(input.source?.workspacePath, 'source.workspacePath'),
      format: requireString(input.source?.format, 'source.format'),
      schemaVersion: normalizeOptionalString(input.source?.schemaVersion, 'source.schemaVersion'),
      observations: normalizeStringList(input.source?.observations ?? [], 'source.observations'),
    }),
    title: Object.freeze({
      value: requireString(input.title?.value, 'title.value'),
      source: requireString(input.title?.source, 'title.source'),
    }),
    activity: Object.freeze({
      timestamp: normalizeTimestamp(input.activity?.timestamp, 'activity.timestamp'),
      source: requireString(input.activity?.source, 'activity.source'),
      confidence,
    }),
    events: Object.freeze(normalizeEvents(input.events ?? [])),
    completeness: Object.freeze({
      isComplete: input.completeness?.isComplete !== false,
      warnings: Object.freeze(
        normalizeStringList(input.completeness?.warnings ?? [], 'completeness.warnings'),
      ),
    }),
  };

  return Object.freeze(normalizedSession);
}
