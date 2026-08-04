// Purpose: Validates canonical provider and full-session identities without using short IDs as keys.

import { CaptureError, ERROR_CODES } from '../errors.js';

export const PROVIDERS = Object.freeze({
  CLAUDE_CODE: 'claude-code',
  CODEX: 'codex',
  CURSOR: 'cursor',
});

export const PROVIDER_DISPLAY_NAMES = Object.freeze({
  [PROVIDERS.CLAUDE_CODE]: 'Claude Code',
  [PROVIDERS.CODEX]: 'Codex',
  [PROVIDERS.CURSOR]: 'Cursor',
});

const PROVIDER_VALUES = new Set(Object.values(PROVIDERS));
const FULL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeProvider(provider) {
  if (typeof provider !== 'string') {
    throw new CaptureError(ERROR_CODES.INVALID_PROVIDER, 'Provider identity is invalid.');
  }

  const normalizedProvider = provider.trim().toLowerCase();
  if (!PROVIDER_VALUES.has(normalizedProvider)) {
    throw new CaptureError(ERROR_CODES.INVALID_PROVIDER, 'Provider identity is not supported.');
  }
  return normalizedProvider;
}

export function normalizeFullSessionId(fullSessionId) {
  if (typeof fullSessionId !== 'string' || !FULL_UUID_PATTERN.test(fullSessionId.trim())) {
    throw new CaptureError(
      ERROR_CODES.INVALID_SESSION_ID,
      'A complete provider session identity is required.',
    );
  }
  return fullSessionId.trim().toLowerCase();
}

export function createSessionKey(provider, fullSessionId) {
  return `${normalizeProvider(provider)}:${normalizeFullSessionId(fullSessionId)}`;
}

export function getShortSessionId(fullSessionId) {
  return normalizeFullSessionId(fullSessionId).slice(0, 8);
}
