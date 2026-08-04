// Purpose: Wraps validated browser exports in Capture metadata and revalidates stored browser Markdown.

import { NativeHostError, NATIVE_ERROR_CODES } from './errors.js';
import { validateBrowserProviderIdentity } from './provider-identity.js';
import { validateBrowserExportMarkdown } from './validate-browser-markdown.js';

export const BROWSER_CAPTURE_FORMAT_VERSION = 1;
export const BROWSER_SOURCE_FORMAT = 'grasppy-extension-markdown-v1';
const ORIGINAL_EXPORT_MARKER = '<!-- GRASPPY Capture Browser Export -->';

function invalidMarkdown(message) {
  throw new NativeHostError(NATIVE_ERROR_CODES.MARKDOWN_INVALID, message);
}

function metadataValue(markdown, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\*\\*${escapedLabel}:\\*\\* (.+)$`, 'm').exec(markdown);
  return match?.[1] ?? null;
}

function safeMetadataText(value) {
  return String(value ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
}

function parseIntegerMetadata(markdown, label) {
  const value = metadataValue(markdown, label);
  if (!/^\d+$/.test(value ?? '')) invalidMarkdown(`Capture ${label} metadata is invalid.`);
  return Number(value);
}

function browserExportBody(markdown) {
  const markerIndex = markdown.indexOf(ORIGINAL_EXPORT_MARKER);
  if (markerIndex < 0) invalidMarkdown('Capture browser-export metadata is incomplete.');
  const body = markdown.slice(markerIndex + ORIGINAL_EXPORT_MARKER.length).trim();
  if (body === '') invalidMarkdown('Capture browser-export content is empty.');
  return body;
}

export function renderBrowserCaptureMarkdown(request, { processedAt }) {
  const sourceUpdatedAt = request.sourceUpdatedAt ?? processedAt;
  const sourceUpdatedSource = request.sourceUpdatedAt ? 'browser-provider' : 'browser-export-time';
  const envelope = Object.freeze({
    captureFormat: BROWSER_CAPTURE_FORMAT_VERSION,
    provider: request.provider,
    conversationId: request.conversationId,
    identityFormat: request.identityFormat,
    title: safeMetadataText(request.title),
    sourceUrl: request.sourceUrl,
    sourceUpdatedAt,
    sourceUpdatedSource,
    exportedAt: processedAt,
    sourceFormat: BROWSER_SOURCE_FORMAT,
    messageCount: request.messageCount,
    conversationTurnCount: request.conversationTurnCount,
  });
  const markdown = [
    `# Markdown Export - ${safeMetadataText(request.displayName)}`,
    '',
    `**GRASPPY Capture Format:** ${envelope.captureFormat}`,
    `**Provider:** ${envelope.provider}`,
    `**URL:** ${envelope.sourceUrl}`,
    `**Exported:** ${envelope.exportedAt}`,
    `**Messages:** ${envelope.messageCount}`,
    `**Session ID:** ${envelope.conversationId}`,
    `**Short ID:** ${envelope.conversationId.slice(0, 8)}`,
    `**Identity Format:** ${envelope.identityFormat}`,
    `**Title:** ${envelope.title}`,
    `**Source Updated:** ${envelope.sourceUpdatedAt} (${envelope.sourceUpdatedSource})`,
    `**Source Format:** ${envelope.sourceFormat}`,
    `**Conversation Turns:** ${envelope.conversationTurnCount}`,
    '',
    '---',
    '',
    ORIGINAL_EXPORT_MARKER,
    '',
    request.markdown.trim(),
    '',
  ].join('\n');
  validateBrowserCaptureMarkdown(markdown, envelope);
  return Object.freeze({ markdown, envelope });
}

export function readBrowserCaptureEnvelope(markdown) {
  if (typeof markdown !== 'string' || markdown.trim() === '' || markdown.includes('\0')) {
    invalidMarkdown('Stored browser Markdown is invalid.');
  }
  const sourceUpdated = metadataValue(markdown, 'Source Updated');
  const sourceUpdatedMatch = /^(.*) \((browser-provider|browser-export-time)\)$/.exec(sourceUpdated ?? '');
  if (!sourceUpdatedMatch) invalidMarkdown('Capture source-update metadata is invalid.');

  const envelope = {
    captureFormat: parseIntegerMetadata(markdown, 'GRASPPY Capture Format'),
    provider: metadataValue(markdown, 'Provider'),
    conversationId: metadataValue(markdown, 'Session ID'),
    identityFormat: metadataValue(markdown, 'Identity Format'),
    title: metadataValue(markdown, 'Title'),
    sourceUrl: metadataValue(markdown, 'URL'),
    sourceUpdatedAt: sourceUpdatedMatch[1],
    sourceUpdatedSource: sourceUpdatedMatch[2],
    exportedAt: metadataValue(markdown, 'Exported'),
    sourceFormat: metadataValue(markdown, 'Source Format'),
    messageCount: parseIntegerMetadata(markdown, 'Messages'),
    conversationTurnCount: parseIntegerMetadata(markdown, 'Conversation Turns'),
  };
  return Object.freeze(envelope);
}

export function validateBrowserCaptureMarkdown(markdown, expectedEnvelope = null) {
  const envelope = readBrowserCaptureEnvelope(markdown);
  if (envelope.captureFormat !== BROWSER_CAPTURE_FORMAT_VERSION
    || envelope.sourceFormat !== BROWSER_SOURCE_FORMAT
    || envelope.title === null
    || envelope.title.trim() === ''
    || !Number.isFinite(Date.parse(envelope.sourceUpdatedAt))
    || !Number.isFinite(Date.parse(envelope.exportedAt))) {
    invalidMarkdown('Capture browser metadata is invalid.');
  }
  const identity = validateBrowserProviderIdentity({
    provider: envelope.provider,
    conversationId: envelope.conversationId,
    identityFormat: envelope.identityFormat,
    sourceUrl: envelope.sourceUrl,
  });
  const evidence = validateBrowserExportMarkdown(browserExportBody(markdown));
  if (evidence.messageCount !== envelope.messageCount
    || evidence.conversationTurnCount !== envelope.conversationTurnCount
    || metadataValue(markdown, 'Short ID') !== envelope.conversationId.slice(0, 8)) {
    invalidMarkdown('Capture browser counts or short identity are invalid.');
  }
  if (expectedEnvelope
    && (identity.provider !== expectedEnvelope.provider
      || identity.conversationId !== expectedEnvelope.conversationId
      || identity.identityFormat !== expectedEnvelope.identityFormat)) {
    invalidMarkdown('Stored browser Markdown identity does not match operational state.');
  }
  return envelope;
}
