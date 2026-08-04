// Purpose: Validates untrusted extension Markdown before Capture metadata or archive writes are allowed.

import { NativeHostError, NATIVE_ERROR_CODES } from './errors.js';

const ROLE_MARKER_PATTERN = /^## (👤 USER MESSAGE|🤖 AI RESPONSE) \((\d+)\)$/gm;

function invalidMarkdown(message) {
  throw new NativeHostError(NATIVE_ERROR_CODES.MARKDOWN_INVALID, message);
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

export function validateBrowserExportMarkdown(markdown) {
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    invalidMarkdown('The browser Markdown is empty.');
  }
  if (markdown.includes('\0')) invalidMarkdown('The browser Markdown contains a null byte.');
  if (/^\*\*GRASPPY Capture Format:\*\*/m.test(markdown)) {
    invalidMarkdown('The browser Markdown must not supply Capture metadata.');
  }
  if (!hasBalancedFences(markdown)) invalidMarkdown('The browser Markdown has unbalanced fenced code.');

  const roleMarkers = [...markdown.matchAll(ROLE_MARKER_PATTERN)];
  if (roleMarkers.length === 0) invalidMarkdown('The browser Markdown contains no conversation messages.');
  roleMarkers.forEach((marker, index) => {
    if (Number(marker[2]) !== index + 1) {
      invalidMarkdown('The browser Markdown message numbering is invalid.');
    }
    const contentStart = marker.index + marker[0].length;
    const contentEnd = roleMarkers[index + 1]?.index ?? markdown.length;
    const messageBody = markdown.slice(contentStart, contentEnd)
      .replace(/^---\s*$/gm, '')
      .trim();
    if (messageBody === '') invalidMarkdown('The browser Markdown contains an empty message.');
  });

  const conversationTurnCount = roleMarkers
    .filter((marker) => marker[1] === '👤 USER MESSAGE')
    .length;
  if (conversationTurnCount === 0) invalidMarkdown('The browser Markdown contains no user message.');
  return Object.freeze({
    messageCount: roleMarkers.length,
    conversationTurnCount,
  });
}
