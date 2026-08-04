// Purpose: Validates browser-provider identities against provider-specific HTTPS URL rules.

import { NativeHostError, NATIVE_ERROR_CODES } from './errors.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALPHANUMERIC_HYPHEN_PATTERN = /^[a-z0-9-]+$/i;
const ALPHANUMERIC_PATTERN = /^[a-z0-9]+$/i;
const OPAQUE_PATH_PATTERN = /^[a-z0-9_-]+$/i;

function pathSegments(sourceUrl) {
  return sourceUrl.pathname.split('/').filter(Boolean);
}

function segmentAfter(segments, marker) {
  const markerIndex = segments.indexOf(marker);
  return markerIndex >= 0 ? segments[markerIndex + 1] ?? null : null;
}

function deepSeekId(sourceUrl) {
  const segments = pathSegments(sourceUrl);
  const chatIndex = segments.indexOf('chat');
  if (chatIndex < 0) return null;
  return segments[chatIndex + 1] === 's'
    ? segments[chatIndex + 2] ?? null
    : segments[chatIndex + 1] ?? null;
}

function replitId(sourceUrl) {
  const segments = pathSegments(sourceUrl);
  if (segments[0]?.startsWith('@')) return segments[1] ?? null;
  if (segments[0] === 't' && segments[2] === 'repls') return segments[3] ?? null;
  return null;
}

function typingMindId(sourceUrl) {
  if (!sourceUrl.hash.startsWith('#')) return null;
  return new URLSearchParams(sourceUrl.hash.slice(1)).get('chat');
}

const PROVIDER_RULES = Object.freeze({
  claude: { displayName: 'Claude', format: 'uuid', hosts: ['claude.ai'], pattern: UUID_PATTERN, min: 36, extract: (url) => segmentAfter(pathSegments(url), 'chat') },
  chatgpt: { displayName: 'ChatGPT', format: 'uuid', hosts: ['chatgpt.com'], pattern: UUID_PATTERN, min: 36, extract: (url) => segmentAfter(pathSegments(url), 'c') },
  grok: { displayName: 'Grok', format: 'uuid', hosts: ['grok.com', 'grok.x.ai'], pattern: ALPHANUMERIC_HYPHEN_PATTERN, min: 8, extract: (url) => segmentAfter(pathSegments(url), 'c') },
  perplexity: { displayName: 'Perplexity', format: 'slug', hosts: ['perplexity.ai', 'www.perplexity.ai'], pattern: ALPHANUMERIC_HYPHEN_PATTERN, min: 1, extract: (url) => {
    const segments = pathSegments(url);
    return ['search', 'c'].includes(segments[0]) ? segments[1] ?? null : null;
  } },
  typingmind: { displayName: 'TypingMind', format: 'opaque', hosts: ['typingmind.com', 'www.typingmind.com'], pattern: OPAQUE_PATH_PATTERN, min: 1, extract: typingMindId },
  lovable: { displayName: 'Lovable', format: 'uuid', hosts: ['lovable.dev'], pattern: UUID_PATTERN, min: 36, extract: (url) => segmentAfter(pathSegments(url), 'projects') },
  deepseek: { displayName: 'DeepSeek', format: 'opaque', hosts: ['chat.deepseek.com'], pattern: ALPHANUMERIC_HYPHEN_PATTERN, min: 6, extract: deepSeekId },
  gemini: { displayName: 'Gemini', format: 'opaque', hosts: ['gemini.google.com'], pattern: ALPHANUMERIC_PATTERN, min: 8, extract: (url) => segmentAfter(pathSegments(url), 'app') },
  replit: { displayName: 'Replit', format: 'slug', hosts: ['replit.com'], pattern: OPAQUE_PATH_PATTERN, min: 2, extract: replitId },
  copilot: { displayName: 'GitHub Copilot', format: 'uuid', hosts: ['github.com'], pattern: UUID_PATTERN, min: 36, extract: (url) => {
    const segments = pathSegments(url);
    return segments[0] === 'copilot' && segments[1] === 'c' ? segments[2] ?? null : null;
  } },
  mistral: { displayName: 'Mistral', format: 'uuid', hosts: ['chat.mistral.ai'], pattern: UUID_PATTERN, min: 36, extract: (url) => segmentAfter(pathSegments(url), 'chat') },
  bolt: { displayName: 'Bolt', format: 'slug', hosts: ['bolt.new'], pattern: OPAQUE_PATH_PATTERN, min: 4, extract: (url) => {
    const segments = pathSegments(url);
    return segments[0] === '~' ? segments[1] ?? null : null;
  } },
});

export const BROWSER_PROVIDERS = Object.freeze(Object.keys(PROVIDER_RULES));

function identityError(code, message) {
  throw new NativeHostError(code, message);
}

function parseSourceUrl(sourceUrl) {
  if (typeof sourceUrl !== 'string' || sourceUrl.length > 2_048) {
    identityError(NATIVE_ERROR_CODES.SOURCE_URL_INVALID, 'The browser conversation URL is invalid.');
  }
  try {
    const parsedUrl = new URL(sourceUrl);
    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || parsedUrl.port) {
      identityError(NATIVE_ERROR_CODES.SOURCE_URL_INVALID, 'The browser conversation URL is invalid.');
    }
    return parsedUrl;
  } catch (error) {
    if (error instanceof NativeHostError) throw error;
    identityError(NATIVE_ERROR_CODES.SOURCE_URL_INVALID, 'The browser conversation URL is invalid.');
  }
}

export function validateBrowserIdentityShape({ provider, conversationId, identityFormat }) {
  if (typeof provider !== 'string' || !Object.hasOwn(PROVIDER_RULES, provider)) {
    identityError(NATIVE_ERROR_CODES.INVALID_PROVIDER, 'The browser provider is not supported.');
  }
  if (conversationId === null || conversationId === undefined || conversationId === '') {
    identityError(NATIVE_ERROR_CODES.IDENTITY_UNAVAILABLE, 'A stable browser conversation identity is unavailable.');
  }

  const rule = PROVIDER_RULES[provider];
  if (identityFormat !== rule.format
    || typeof conversationId !== 'string'
    || conversationId.length < rule.min
    || conversationId.length > 128
    || !rule.pattern.test(conversationId)) {
    identityError(NATIVE_ERROR_CODES.IDENTITY_INVALID, 'The browser conversation identity is invalid.');
  }
  return Object.freeze({
    provider,
    displayName: rule.displayName,
    conversationId,
    identityFormat,
    sessionKey: `${provider}:${conversationId}`,
  });
}

export function validateBrowserProviderIdentity({
  provider,
  conversationId,
  identityFormat,
  sourceUrl,
}) {
  const identity = validateBrowserIdentityShape({ provider, conversationId, identityFormat });
  const rule = PROVIDER_RULES[identity.provider];

  const parsedUrl = parseSourceUrl(sourceUrl);
  if (!rule.hosts.includes(parsedUrl.hostname.toLowerCase())) {
    identityError(NATIVE_ERROR_CODES.SOURCE_URL_INVALID, 'The browser conversation URL does not match its provider.');
  }
  const urlIdentity = rule.extract(parsedUrl);
  if (urlIdentity !== conversationId) {
    identityError(NATIVE_ERROR_CODES.IDENTITY_INVALID, 'The browser conversation identity does not match its URL.');
  }

  const canonicalSourceUrl = provider === 'typingmind'
    ? `${parsedUrl.origin}${parsedUrl.pathname}#chat=${conversationId}`
    : `${parsedUrl.origin}${parsedUrl.pathname}`;
  return Object.freeze({
    provider,
    displayName: identity.displayName,
    conversationId,
    identityFormat,
    sourceUrl: canonicalSourceUrl,
    sessionKey: identity.sessionKey,
  });
}
