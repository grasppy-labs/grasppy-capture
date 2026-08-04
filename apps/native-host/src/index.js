// Purpose: Exposes the stable Capture native-host protocol, registration, and one-request runtime surface.

export { saveBrowserArchiveRequest, writeBrowserArchiveFile } from './archive-browser-markdown.js';
export {
  BROWSER_MANIFEST_FILENAME,
  BROWSER_MANIFEST_SCHEMA_VERSION,
  createEmptyBrowserManifest,
  loadBrowserManifest,
  saveBrowserManifest,
  validateBrowserManifest,
} from './browser-manifest.js';
export { NativeHostError, NATIVE_ERROR_CODES } from './errors.js';
export { encodeNativeMessage, readNativeMessage, writeNativeMessage } from './framing.js';
export { runNativeMessagingHost } from './host.js';
export {
  BROWSER_PROVIDERS,
  validateBrowserIdentityShape,
  validateBrowserProviderIdentity,
} from './provider-identity.js';
export {
  MAX_NATIVE_REQUEST_BYTES,
  MAX_NATIVE_RESPONSE_BYTES,
  NATIVE_ACTION,
  NATIVE_PROTOCOL,
  createErrorResponse,
  createSuccessResponse,
  trustedRequestId,
  validateNativeSaveRequest,
} from './protocol.js';
export {
  NATIVE_HOST_CONFIG_FILENAME,
  NATIVE_HOST_MANIFEST_FILENAME,
  NATIVE_HOST_NAME,
  assertAllowedCaller,
  buildNativeHostManifest,
  callerOriginFromArguments,
  extensionOrigin,
  loadNativeHostConfig,
  registerMacNativeHost,
} from './registration.js';
export {
  BROWSER_CAPTURE_FORMAT_VERSION,
  BROWSER_SOURCE_FORMAT,
  readBrowserCaptureEnvelope,
  renderBrowserCaptureMarkdown,
  validateBrowserCaptureMarkdown,
} from './render-browser-markdown.js';
export { validateBrowserExportMarkdown } from './validate-browser-markdown.js';
