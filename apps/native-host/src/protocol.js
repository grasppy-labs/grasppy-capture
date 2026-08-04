// Purpose: Enforces the exact versioned save request and path-free native response schemas.

import { NativeHostError, NATIVE_ERROR_CODES, toNativeHostError } from './errors.js';
import { validateBrowserProviderIdentity } from './provider-identity.js';
import { validateBrowserExportMarkdown } from './validate-browser-markdown.js';

export const NATIVE_PROTOCOL = 'grasppy.capture.native.v1';
export const NATIVE_ACTION = 'save_markdown';
export const MAX_NATIVE_REQUEST_BYTES = 16 * 1024 * 1024;
export const MAX_NATIVE_RESPONSE_BYTES = 1024 * 1024;

const REQUEST_FIELDS = new Set([
  'protocol',
  'action',
  'requestId',
  'provider',
  'conversationId',
  'identityFormat',
  'title',
  'sourceUrl',
  'sourceUpdatedAt',
  'filenameHint',
  'markdown',
]);
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestError(code, message) {
  throw new NativeHostError(code, message);
}

function validateTitle(title) {
  if (typeof title !== 'string'
    || title.trim() === ''
    || [...title].length > 200
    || /[\u0000-\u001f\u007f]/.test(title)) {
    requestError(NATIVE_ERROR_CODES.INVALID_REQUEST, 'The browser conversation title is invalid.');
  }
  return title.trim();
}

function validateSourceUpdatedAt(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    requestError(NATIVE_ERROR_CODES.INVALID_REQUEST, 'The browser source timestamp is invalid.');
  }
  return new Date(value).toISOString();
}

function validateFilenameHint(value) {
  if (value === null) return null;
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > 180
    || value === '.'
    || value === '..'
    || value.includes('/')
    || value.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(value)
    || !value.toLowerCase().endsWith('.md')) {
    requestError(NATIVE_ERROR_CODES.FILENAME_HINT_INVALID, 'The browser filename hint is invalid.');
  }
  return value;
}

export function trustedRequestId(value) {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value) ? value.toLowerCase() : null;
}

export function validateNativeSaveRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    requestError(NATIVE_ERROR_CODES.INVALID_REQUEST, 'The native request is invalid.');
  }
  const keys = Object.keys(request);
  if (keys.length !== REQUEST_FIELDS.size || keys.some((field) => !REQUEST_FIELDS.has(field))) {
    requestError(NATIVE_ERROR_CODES.INVALID_REQUEST, 'The native request fields are invalid.');
  }
  if (request.protocol !== NATIVE_PROTOCOL) {
    requestError(NATIVE_ERROR_CODES.UNSUPPORTED_PROTOCOL, 'The native protocol version is unsupported.');
  }
  if (request.action !== NATIVE_ACTION) {
    requestError(NATIVE_ERROR_CODES.UNSUPPORTED_ACTION, 'The native action is unsupported.');
  }
  const requestId = trustedRequestId(request.requestId);
  if (!requestId) requestError(NATIVE_ERROR_CODES.INVALID_REQUEST_ID, 'The native request identity is invalid.');

  const identity = validateBrowserProviderIdentity(request);
  const markdownEvidence = validateBrowserExportMarkdown(request.markdown);
  return Object.freeze({
    protocol: NATIVE_PROTOCOL,
    action: NATIVE_ACTION,
    requestId,
    ...identity,
    title: validateTitle(request.title),
    sourceUpdatedAt: validateSourceUpdatedAt(request.sourceUpdatedAt),
    filenameHint: validateFilenameHint(request.filenameHint),
    markdown: request.markdown,
    ...markdownEvidence,
  });
}

export function createSuccessResponse(request, result) {
  return Object.freeze({
    protocol: NATIVE_PROTOCOL,
    requestId: request.requestId,
    success: true,
    result: Object.freeze({
      disposition: result.disposition,
      provider: request.provider,
      conversationId: request.conversationId,
      bytesWritten: result.bytesWritten,
      processedAt: result.processedAt,
    }),
  });
}

export function createErrorResponse(error, requestId = null) {
  const nativeError = toNativeHostError(error);
  return Object.freeze({
    protocol: NATIVE_PROTOCOL,
    requestId: trustedRequestId(requestId),
    success: false,
    error: Object.freeze({ code: nativeError.code, message: nativeError.message }),
  });
}
