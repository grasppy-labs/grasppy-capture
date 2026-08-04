// Purpose: Defines safe structured errors shared by Capture core consumers.

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_PROVIDER: 'INVALID_PROVIDER',
  INVALID_SESSION_ID: 'INVALID_SESSION_ID',
  INVALID_NORMALIZED_SESSION: 'INVALID_NORMALIZED_SESSION',
  INVALID_PROVIDER_ADAPTER: 'INVALID_PROVIDER_ADAPTER',
  INVALID_MARKDOWN_CONTRACT: 'INVALID_MARKDOWN_CONTRACT',
  INVALID_MANIFEST: 'INVALID_MANIFEST',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_PERMISSION_DENIED: 'PROVIDER_PERMISSION_DENIED',
  UNSUPPORTED_SCHEMA: 'UNSUPPORTED_SCHEMA',
  SOURCE_INCOMPLETE: 'SOURCE_INCOMPLETE',
  SOURCE_READ_FAILED: 'SOURCE_READ_FAILED',
  ARCHIVE_UNAVAILABLE: 'ARCHIVE_UNAVAILABLE',
  ARCHIVE_WRITE_FAILED: 'ARCHIVE_WRITE_FAILED',
});

const KNOWN_ERROR_CODES = new Set(Object.values(ERROR_CODES));

export class CaptureError extends Error {
  constructor(code, message, options = {}) {
    if (!KNOWN_ERROR_CODES.has(code)) {
      throw new TypeError(`Unknown Capture error code: ${String(code)}`);
    }
    if (typeof message !== 'string' || message.trim() === '') {
      throw new TypeError('Capture errors require a non-empty safe message.');
    }

    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'CaptureError';
    this.code = code;
    this.context = options.context ?? null;
  }
}

export function toPublicError(error) {
  if (error instanceof CaptureError) {
    return Object.freeze({
      success: false,
      error: error.message,
      code: error.code,
    });
  }

  return Object.freeze({
    success: false,
    error: 'Something went wrong while processing the local archive.',
    code: ERROR_CODES.INVALID_INPUT,
  });
}
