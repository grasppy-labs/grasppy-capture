// Purpose: Exposes the stable public contracts for the clean-room Capture core package.

export { CaptureError, ERROR_CODES, toPublicError } from './errors.js';
export {
  PROVIDERS,
  PROVIDER_DISPLAY_NAMES,
  createSessionKey,
  getShortSessionId,
  normalizeFullSessionId,
  normalizeProvider,
} from './contracts/identity.js';
export {
  ACTIVITY_CONFIDENCE,
  EVENT_TYPES,
  NORMALIZED_SESSION_SCHEMA_VERSION,
  createNormalizedSession,
} from './contracts/normalized-session.js';
export {
  PROVIDER_ADAPTER_METHODS,
  assertProviderAdapter,
} from './contracts/provider-interface.js';
export {
  CAPTURE_FORMAT_VERSION,
  MARKDOWN_ROLE_MARKERS,
  createMarkdownEnvelope,
} from './contracts/markdown-contract.js';
export {
  OPERATIONAL_MANIFEST_SCHEMA_VERSION,
  RUN_RESULT_FIELDS,
  createEmptyOperationalManifest,
  validateOperationalManifest,
} from './contracts/manifest-schema.js';
export { scanJsonlFile } from './providers/jsonl.js';
export {
  getClaudeDefaultRoots,
  discoverClaudeSessions,
  normalizeClaudeSession,
  claudeAdapter,
} from './providers/claude.js';
export {
  getCodexDefaultRoots,
  discoverCodexSessions,
  normalizeCodexSession,
  codexAdapter,
} from './providers/codex.js';
export {
  getCursorDefaultRoots,
  discoverCursorSessions,
  normalizeCursorSession,
  cursorAdapter,
} from './providers/cursor.js';
export {
  PROVIDER_ADAPTERS,
  catalogProviders,
  getProviderAdapter,
} from './providers/catalog.js';
export {
  ARCHIVE_DIRECTORY_NAME,
  archiveFilenameId,
  createStableArchiveFilename,
  resolveArchiveDirectory,
  resolveContainedArchiveFile,
  sanitizeFilenameLabel,
  setupArchiveDirectory,
} from './archive/paths.js';
export { migrateArchiveFilenames } from './archive/migrate-filenames.js';
export { renderCaptureMarkdown } from './archive/render-markdown.js';
export {
  readCaptureMarkdownEnvelope,
  validateCaptureMarkdown,
  validateStoredCaptureMarkdown,
} from './archive/validate-markdown.js';
export {
  OPERATIONAL_MANIFEST_FILENAME,
  cloneOperationalManifest,
  initializeOperationalManifest,
  saveOperationalManifest,
} from './archive/manifest-store.js';
export { writeValidatedArchiveFile } from './archive/write-file.js';
export {
  applyCatalogToManifest,
  buildReviewCatalog,
  createFixedRunSet,
  flattenProviderCandidates,
  persistReviewCatalog,
  persistSessionExclusion,
  setSessionExclusion,
} from './archive/catalog-state.js';
export { runManualArchiveSync } from './archive/sync-archive.js';
export { buildDashboardState } from './archive/dashboard.js';
