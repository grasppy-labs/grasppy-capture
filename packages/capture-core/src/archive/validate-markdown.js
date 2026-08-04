// Purpose: Validates rendered Capture Markdown identity, counts, markers, content, and fenced-code balance.

import {
  CAPTURE_FORMAT_VERSION,
  createMarkdownEnvelope,
} from '../contracts/markdown-contract.js';
import { CaptureError, ERROR_CODES } from '../errors.js';

const ROLE_MARKER_PATTERN = /^## (👤 USER MESSAGE|🤖 AI RESPONSE) \((\d+)\)$/;

// Role markers are structure, and fenced lines are content — a conversation that
// QUOTES a Capture export inside a code block must not have those quoted lines
// counted as real message boundaries. Walks lines with the same fence tracking
// as hasBalancedFences and collects only markers outside any open fence, in the
// same match shape ([0] line, [1] role, [2] number, index) matchAll produced.
function collectRoleMarkers(markdown) {
  const markers = [];
  let fence = null;
  let offset = 0;
  for (const line of markdown.split('\n')) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = { character: marker[0], length: marker.length };
      else if (marker[0] === fence.character && marker.length >= fence.length) fence = null;
    } else if (!fence) {
      const match = ROLE_MARKER_PATTERN.exec(line);
      if (match) markers.push({ 0: match[0], 1: match[1], 2: match[2], index: offset });
    }
    offset += line.length + 1;
  }
  return markers;
}

function invalidMarkdown(message) {
  throw new CaptureError(ERROR_CODES.INVALID_MARKDOWN_CONTRACT, message);
}

function metadataValue(markdown, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\*\\*${escapedLabel}:\\*\\* (.+)$`, 'm').exec(markdown);
  return match?.[1] ?? null;
}

function parseDeclaredInteger(value, label) {
  if (!/^\d+$/.test(value ?? '')) invalidMarkdown(`Markdown ${label} metadata is invalid.`);
  return Number(value);
}

export function readCaptureMarkdownEnvelope(markdown) {
  if (typeof markdown !== 'string' || markdown.trim() === '') invalidMarkdown('Rendered Markdown is empty.');
  const sourceUpdated = metadataValue(markdown, 'Source Updated');
  const sourceMatch = /^(.*) \((.*)\)$/.exec(sourceUpdated ?? '');
  if (!sourceMatch) invalidMarkdown('Markdown source update metadata is invalid.');

  return createMarkdownEnvelope({
    provider: metadataValue(markdown, 'Provider'),
    fullSessionId: metadataValue(markdown, 'Session ID'),
    sourceUpdatedAt: sourceMatch[1],
    sourceUpdatedSource: sourceMatch[2],
    exportedAt: metadataValue(markdown, 'Exported'),
    messageCount: parseDeclaredInteger(metadataValue(markdown, 'Messages'), 'message count'),
    conversationTurnCount: parseDeclaredInteger(
      metadataValue(markdown, 'Conversation Turns'),
      'conversation turn count',
    ),
    sourceFormat: metadataValue(markdown, 'Source Format'),
  });
}

function hasBalancedFences(markdown) {
  let fence = null;
  for (const line of markdown.split('\n')) {
    const match = /^\s*(`{3,}|~{3,})/.exec(line);
    if (!match) continue;
    const marker = match[1];
    if (!fence) fence = { character: marker[0], length: marker.length };
    else if (marker[0] === fence.character && marker.length >= fence.length) fence = null;
  }
  return fence === null;
}

function validateDeclaredMetadata(markdown, envelope) {
  const expectedMetadata = new Map([
    ['URL', `local-provider://${envelope.provider}/${envelope.fullSessionId}`],
    ['Exported', envelope.exportedAt],
    ['Short ID', envelope.fullSessionId.slice(0, 8)],
    ['Source Format', envelope.sourceFormat],
  ]);
  for (const [label, expectedValue] of expectedMetadata) {
    if (metadataValue(markdown, label) !== expectedValue) {
      invalidMarkdown(`Markdown ${label.toLowerCase()} metadata is invalid.`);
    }
  }

  const expectedSourceUpdated = `${envelope.sourceUpdatedAt} (${envelope.sourceUpdatedSource})`;
  if (metadataValue(markdown, 'Source Updated') !== expectedSourceUpdated) {
    invalidMarkdown('Markdown source update metadata is invalid.');
  }
}

export function validateCaptureMarkdown(markdown, envelope) {
  if (typeof markdown !== 'string' || markdown.trim() === '') invalidMarkdown('Rendered Markdown is empty.');
  if (markdown.includes('\0')) invalidMarkdown('Rendered Markdown contains a null byte.');
  if (!envelope || typeof envelope !== 'object') invalidMarkdown('Markdown envelope is missing.');
  if (metadataValue(markdown, 'GRASPPY Capture Format') !== String(CAPTURE_FORMAT_VERSION)) {
    invalidMarkdown('Markdown format metadata is invalid.');
  }
  if (metadataValue(markdown, 'Provider') !== envelope.provider
    || metadataValue(markdown, 'Session ID') !== envelope.fullSessionId) {
    invalidMarkdown('Markdown identity metadata is invalid.');
  }
  validateDeclaredMetadata(markdown, envelope);

  const roleMarkers = collectRoleMarkers(markdown);
  if (roleMarkers.length !== envelope.messageCount) invalidMarkdown('Markdown message count is invalid.');
  roleMarkers.forEach((marker, index) => {
    if (Number(marker[2]) !== index + 1) invalidMarkdown('Markdown message numbering is invalid.');
    const contentStart = marker.index + marker[0].length;
    const contentEnd = roleMarkers[index + 1]?.index ?? markdown.length;
    const messageBody = markdown.slice(contentStart, contentEnd)
      .split('\n## Completeness warnings')[0]
      .replace(/^\s+|\s+$/g, '')
      .replace(/^---\s*$/gm, '')
      .trim();
    if (messageBody === '') invalidMarkdown('Markdown message content is empty.');
  });
  const userTurns = roleMarkers.filter((marker) => marker[1] === '👤 USER MESSAGE').length;
  if (userTurns !== envelope.conversationTurnCount) invalidMarkdown('Markdown turn count is invalid.');
  if (metadataValue(markdown, 'Messages') !== String(roleMarkers.length)
    || metadataValue(markdown, 'Conversation Turns') !== String(userTurns)) {
    invalidMarkdown('Markdown declared counts are invalid.');
  }
  if (!hasBalancedFences(markdown)) invalidMarkdown('Markdown fenced code is unbalanced.');
  return Object.freeze({ messageCount: roleMarkers.length, conversationTurnCount: userTurns });
}

export function validateStoredCaptureMarkdown(markdown, expectedIdentity = null) {
  const envelope = readCaptureMarkdownEnvelope(markdown);
  validateCaptureMarkdown(markdown, envelope);
  if (expectedIdentity
    && (envelope.provider !== expectedIdentity.provider
      || envelope.fullSessionId !== expectedIdentity.fullSessionId)) {
    invalidMarkdown('Stored Markdown identity does not match operational state.');
  }
  return envelope;
}
