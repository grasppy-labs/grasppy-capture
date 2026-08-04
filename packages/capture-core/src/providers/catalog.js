// Purpose: Catalogs all approved local providers while isolating safe per-provider failures.

import { normalizeProvider } from '../contracts/identity.js';
import { CaptureError, ERROR_CODES } from '../errors.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { cursorAdapter } from './cursor.js';

export const PROVIDER_ADAPTERS = Object.freeze([
  claudeAdapter,
  codexAdapter,
  cursorAdapter,
]);

export function getProviderAdapter(provider) {
  const normalizedProvider = normalizeProvider(provider);
  return PROVIDER_ADAPTERS.find((adapter) => adapter.provider === normalizedProvider) ?? null;
}

function providerFailureResult(adapter, error, options) {
  if (!(error instanceof CaptureError)) throw error;
  const status = error.code === ERROR_CODES.PROVIDER_PERMISSION_DENIED
    ? 'permission-needed'
    : error.code === ERROR_CODES.PROVIDER_UNAVAILABLE
      ? 'not-found'
      : 'unsupported-schema';
  return {
    provider: adapter.provider,
    status,
    roots: adapter.getDefaultRoots(options),
    sessions: [],
    observations: [error.message],
  };
}

export async function catalogProviders(options = {}) {
  return Promise.all(PROVIDER_ADAPTERS.map(async (adapter) => {
    try {
      return await adapter.discoverSessions(options);
    } catch (error) {
      return providerFailureResult(adapter, error, options);
    }
  }));
}
