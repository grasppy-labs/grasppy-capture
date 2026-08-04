// Purpose: Defines the clean-room interface required from every local provider adapter.

import { CaptureError, ERROR_CODES } from '../errors.js';
import { normalizeProvider } from './identity.js';

export const PROVIDER_ADAPTER_METHODS = Object.freeze([
  'getDefaultRoots',
  'discoverSessions',
  'normalizeSession',
]);

export function assertProviderAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) {
    throw new CaptureError(
      ERROR_CODES.INVALID_PROVIDER_ADAPTER,
      'Provider adapter is invalid.',
    );
  }

  const provider = normalizeProvider(adapter.provider);
  for (const methodName of PROVIDER_ADAPTER_METHODS) {
    if (typeof adapter[methodName] !== 'function') {
      throw new CaptureError(
        ERROR_CODES.INVALID_PROVIDER_ADAPTER,
        `Provider adapter is missing ${methodName}.`,
      );
    }
  }

  return Object.freeze({ provider, adapter });
}
