// Purpose: Defines safe stable errors for the versioned Capture native-messaging boundary.

export const NATIVE_ERROR_CODES = Object.freeze({
  MALFORMED_MESSAGE: 'MALFORMED_MESSAGE',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_PROTOCOL: 'UNSUPPORTED_PROTOCOL',
  UNSUPPORTED_ACTION: 'UNSUPPORTED_ACTION',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_REQUEST_ID: 'INVALID_REQUEST_ID',
  INVALID_PROVIDER: 'INVALID_PROVIDER',
  IDENTITY_UNAVAILABLE: 'IDENTITY_UNAVAILABLE',
  IDENTITY_INVALID: 'IDENTITY_INVALID',
  SOURCE_URL_INVALID: 'SOURCE_URL_INVALID',
  FILENAME_HINT_INVALID: 'FILENAME_HINT_INVALID',
  MARKDOWN_INVALID: 'MARKDOWN_INVALID',
  CALLER_NOT_ALLOWED: 'CALLER_NOT_ALLOWED',
  HOST_NOT_REGISTERED: 'HOST_NOT_REGISTERED',
  HOST_BUSY: 'HOST_BUSY',
  REQUEST_ID_CONFLICT: 'REQUEST_ID_CONFLICT',
  CAPTURE_UNCONFIGURED: 'CAPTURE_UNCONFIGURED',
  ARCHIVE_UNAVAILABLE: 'ARCHIVE_UNAVAILABLE',
  ARCHIVE_WRITE_FAILED: 'ARCHIVE_WRITE_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  CONNECTION_ABANDONED: 'CONNECTION_ABANDONED',
});

const KNOWN_CODES = new Set(Object.values(NATIVE_ERROR_CODES));

export class NativeHostError extends Error {
  constructor(code, message, { cause, abandoned = false } = {}) {
    if (!KNOWN_CODES.has(code)) throw new TypeError('Unknown native-host error code.');
    if (typeof message !== 'string' || message.trim() === '') {
      throw new TypeError('Native-host errors require a safe non-empty message.');
    }
    super(message, cause ? { cause } : undefined);
    this.name = 'NativeHostError';
    this.code = code;
    this.abandoned = abandoned;
  }
}

export function toNativeHostError(error) {
  if (error instanceof NativeHostError) return error;
  return new NativeHostError(
    NATIVE_ERROR_CODES.INTERNAL_ERROR,
    'GRASPPY Capture could not process the native request safely.',
    { cause: error },
  );
}
