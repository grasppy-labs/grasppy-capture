// Purpose: Keeps binary payloads (base64 media) out of every archive while leaving all other text byte-identical.

import { createHash } from 'node:crypto';

// The shortest unbroken base64 or base64url run treated as a payload. Prose, hashes,
// JWT segments and minified code break long before this; encoded media does not.
export const MIN_BINARY_RUN = 1000;

// data:<mime>[;param=value]*;base64,<payload>, at any size. The prefix is kept so
// the media type stays as evidence; only the payload is replaced.
const DATA_URL_PATTERN = /(data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+=[^;,\s"'\\]*)*;base64,)([A-Za-z0-9+/_-]+={0,2})/gi;
const BINARY_RUN_PATTERN = new RegExp(`[A-Za-z0-9+/_-]{${MIN_BINARY_RUN},}={0,2}`, 'g');

/** Placeholder for one payload: its decoded size and a short hash, so it stays traceable to the source. */
export function omittedPayload(base64) {
  const text = String(base64);
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 12);
  const bytes = Math.floor((text.replace(/=+$/, '').length * 3) / 4);
  return `[omitted: ${bytes} bytes, sha256:${digest}]`;
}

/**
 * Replaces every base64 data URL payload and every unbroken base64/base64url run of
 * MIN_BINARY_RUN or more characters with omittedPayload(). Idempotent: a placeholder
 * never matches either pattern, so sweeping swept text changes nothing.
 */
export function sweepBinaryPayloads(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(DATA_URL_PATTERN, (match, prefix, payload) => `${prefix}${omittedPayload(payload)}`)
    .replace(BINARY_RUN_PATTERN, (run) => omittedPayload(run));
}
