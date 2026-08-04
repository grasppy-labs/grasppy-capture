// Purpose: Renders normalized local conversations into the approved GRASPPY-compatible Markdown format.

import { PROVIDER_DISPLAY_NAMES } from '../contracts/identity.js';
import { createMarkdownEnvelope } from '../contracts/markdown-contract.js';
import { CaptureError, ERROR_CODES } from '../errors.js';

const ROLE_LABELS = Object.freeze({
  user: '👤 USER MESSAGE',
  assistant: '🤖 AI RESPONSE',
});

function escapeArchiveText(value) {
  // Null bytes survive from provider logs but the archive validator rejects any
  // document containing one, which would fail the whole conversation.
  const lines = String(value ?? '').replace(/\0/g, '').split('\n');
  let fence = null;
  const rendered = lines.map((line) => {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = { character: marker[0], length: marker.length };
      else if (marker[0] === fence.character && marker.length >= fence.length) fence = null;
      return line;
    }
    if (fence) return line;

    const escapedMarker = /^## (?:👤 USER MESSAGE|🤖 AI RESPONSE) \(\d+\)\s*$/.test(line)
      ? `\\${line}`
      : line;
    return escapedMarker.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  });

  // A message can end mid-fence — an interrupted code block, or prose that just
  // mentions ``` once. Left open, the fence swallows the block separator and
  // every later message, and validateCaptureMarkdown rejects the document. Close
  // it so each block stays self-contained.
  if (fence) rendered.push(fence.character.repeat(fence.length));
  return rendered.join('\n');
}

function safeMetadataText(value) {
  return escapeArchiveText(value).replace(/\s+/g, ' ').trim();
}

function groupEvents(events) {
  const blocks = [];
  let currentBlock = null;
  let pendingEvents = [];

  for (const event of events) {
    if (event.type === 'user' || event.type === 'assistant') {
      if (!currentBlock || currentBlock.role !== event.type) {
        currentBlock = { role: event.type, events: [] };
        if (pendingEvents.length > 0) {
          currentBlock.events.push(...pendingEvents);
          pendingEvents = [];
        }
        blocks.push(currentBlock);
      }
      currentBlock.events.push(event);
    } else if (currentBlock) {
      currentBlock.events.push(event);
    } else {
      pendingEvents.push(event);
    }
  }

  if (pendingEvents.length > 0) blocks.push({ role: null, events: pendingEvents });
  return blocks;
}

function renderSupportingEvent(event) {
  const content = escapeArchiveText(event.content);
  if (event.type === 'tool') {
    const toolName = escapeArchiveText(event.metadata?.toolName ?? 'tool')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'tool';
    return `### Tool activity — ${toolName}\n\n${content || '_No textual output._'}`;
  }
  if (event.type === 'image') return `### Image\n\n${content || '[Image content]'}`;
  if (event.type === 'compaction') return `### Compaction event\n\n${content}`;
  return `> Lifecycle event: ${content}`;
}

function renderBlock(block, messageNumber) {
  const body = block.events.map((event) => {
    if (event.type === 'user' || event.type === 'assistant') return escapeArchiveText(event.content);
    return renderSupportingEvent(event);
  }).filter((content) => content !== '').join('\n\n');

  if (!block.role) return `### Local session events\n\n${body || '_No textual event details._'}`;
  if (body === '') {
    throw new CaptureError(
      ERROR_CODES.INVALID_MARKDOWN_CONTRACT,
      'A rendered conversation message must contain content.',
    );
  }
  return `## ${ROLE_LABELS[block.role]} (${messageNumber})\n\n${body}`;
}

export function renderCaptureMarkdown(session, { exportedAt }) {
  if (!session || typeof session !== 'object' || !Array.isArray(session.events)) {
    throw new CaptureError(ERROR_CODES.INVALID_MARKDOWN_CONTRACT, 'Normalized session is invalid.');
  }
  const blocks = groupEvents(session.events);
  const roleBlocks = blocks.filter((block) => block.role);
  if (roleBlocks.length === 0) {
    throw new CaptureError(
      ERROR_CODES.INVALID_MARKDOWN_CONTRACT,
      'A conversation must contain at least one user or assistant message.',
    );
  }

  const messageCount = roleBlocks.length;
  const conversationTurnCount = roleBlocks.filter((block) => block.role === 'user').length;
  const sourceUpdatedAt = session.activity.timestamp ?? exportedAt;
  const envelope = createMarkdownEnvelope({
    provider: session.provider,
    fullSessionId: session.fullSessionId,
    sourceUpdatedAt,
    sourceUpdatedSource: safeMetadataText(session.activity.source),
    exportedAt,
    messageCount,
    conversationTurnCount,
    sourceFormat: safeMetadataText(session.source.format),
  });
  const displayProvider = PROVIDER_DISPLAY_NAMES[session.provider] ?? session.provider;
  const warningSection = session.completeness.warnings.length > 0
    ? `\n\n## Completeness warnings\n\n${session.completeness.warnings.map((warning) => `- ${escapeArchiveText(warning)}`).join('\n')}`
    : '';
  let nextMessageNumber = 0;
  const renderedBlocks = blocks.map((block) => {
    if (block.role) nextMessageNumber += 1;
    return renderBlock(block, nextMessageNumber);
  }).join('\n\n---\n\n');

  const markdown = [
    `# Markdown Export - ${displayProvider}`,
    '',
    `**GRASPPY Capture Format:** ${envelope.captureFormat}`,
    `**Provider:** ${envelope.provider}`,
    `**URL:** local-provider://${envelope.provider}/${envelope.fullSessionId}`,
    `**Exported:** ${envelope.exportedAt}`,
    `**Messages:** ${envelope.messageCount}`,
    `**Session ID:** ${envelope.fullSessionId}`,
    `**Short ID:** ${envelope.fullSessionId.slice(0, 8)}`,
    `**Source Updated:** ${envelope.sourceUpdatedAt} (${envelope.sourceUpdatedSource})`,
    `**Source Format:** ${envelope.sourceFormat}`,
    `**Conversation Turns:** ${envelope.conversationTurnCount}`,
    '',
    '---',
    '',
    renderedBlocks,
  ].join('\n') + warningSection + '\n';

  return Object.freeze({ markdown, envelope, messageCount, conversationTurnCount });
}
