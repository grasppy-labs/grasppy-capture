// Purpose: Verifies Capture Markdown rendering, metadata recovery, safe escaping, and pre-write validation.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_CODES,
  PROVIDERS,
  createNormalizedSession,
  readCaptureMarkdownEnvelope,
  renderCaptureMarkdown,
  validateCaptureMarkdown,
  validateStoredCaptureMarkdown,
} from '../src/index.js';

const SESSION_ID = '12345678-1234-4abc-8def-1234567890ab';
const NOW = '2026-08-02T12:00:00.000Z';

function inventedSession(events) {
  return createNormalizedSession({
    provider: PROVIDERS.CODEX,
    fullSessionId: SESSION_ID,
    source: {
      path: '/invented/source.jsonl',
      providerProjectKey: 'invented',
      workspacePath: null,
      format: 'Invented JSONL',
      schemaVersion: 'test-v1',
      observations: [],
    },
    title: { value: 'Invented archive review', source: 'invented test data' },
    activity: { timestamp: NOW, source: 'invented event timestamp', confidence: 'high' },
    events,
    completeness: { isComplete: true, warnings: [] },
  });
}

test('renderer emits recoverable format metadata and sequential role blocks', () => {
  const rendered = renderCaptureMarkdown(inventedSession([
    { type: 'user', content: 'Show <workspace> and not HTML.' },
    { type: 'assistant', content: '```js\nconst node = "<kept>";\n```' },
    { type: 'tool', content: 'Invented output', metadata: { toolName: 'local\nreader' } },
    { type: 'user', content: '## 👤 USER MESSAGE (99)' },
  ]), { exportedAt: NOW });

  assert.match(rendered.markdown, /Show &lt;workspace&gt; and not HTML\./);
  assert.match(rendered.markdown, /const node = "<kept>";/);
  assert.match(rendered.markdown, /### Tool activity — local reader/);
  assert.match(rendered.markdown, /### Tool activity — local reader\n\n(`{3,})grasppy-tool\n[\s\S]*?\n\1\n/);
  assert.match(rendered.markdown, /\\## 👤 USER MESSAGE \(99\)/);
  assert.deepEqual(validateCaptureMarkdown(rendered.markdown, rendered.envelope), {
    messageCount: 3,
    conversationTurnCount: 2,
  });
  assert.deepEqual(readCaptureMarkdownEnvelope(rendered.markdown), rendered.envelope);
  assert.equal(validateStoredCaptureMarkdown(rendered.markdown).fullSessionId, SESSION_ID);
});

test('validator rejects altered identity, empty role content, null bytes, and unbalanced fences', () => {
  const rendered = renderCaptureMarkdown(inventedSession([
    { type: 'user', content: 'Invented question' },
    { type: 'assistant', content: 'Invented answer' },
  ]), { exportedAt: NOW });

  for (const invalidMarkdown of [
    rendered.markdown.replace(`**Session ID:** ${SESSION_ID}`, '**Session ID:** 87654321-1234-4abc-8def-1234567890ab'),
    rendered.markdown.replace('Invented question', ''),
    `${rendered.markdown}\0`,
    rendered.markdown.replace('Invented answer', '```js\nInvented answer'),
  ]) {
    assert.throws(
      () => validateCaptureMarkdown(invalidMarkdown, rendered.envelope),
      (error) => error.code === ERROR_CODES.INVALID_MARKDOWN_CONTRACT,
    );
  }
});

// The escalation branch. A tool body routinely contains fenced code — Bash
// output, a file read — and a wrapper of equal length would be closed by the
// first inner fence, so a reader dropping the tool block would carry off the
// rest of the message with it.
test('tool blocks are fenced longer than any fence inside them', () => {
  const rendered = renderCaptureMarkdown(inventedSession([
    { type: 'user', content: 'Run it.' },
    { type: 'tool', content: '```js\nconst a = 1;\n```', metadata: { toolName: 'Bash' } },
    { type: 'tool', content: '````\nalready four\n````', metadata: { toolName: 'Read' } },
    { type: 'assistant', content: 'Invented answer' },
  ]), { exportedAt: NOW });

  assert.ok(
    rendered.markdown.includes('### Tool activity — Bash\n\n````grasppy-tool\n```js\nconst a = 1;\n```\n````'),
    'a three-backtick body must be wrapped in four',
  );
  assert.ok(
    rendered.markdown.includes('### Tool activity — Read\n\n`````grasppy-tool\n````\nalready four\n````\n`````'),
    'a four-backtick body must be wrapped in five',
  );
  // Throws on unbalanced fences, which is what the escalation exists to prevent.
  assert.equal(validateCaptureMarkdown(rendered.markdown, rendered.envelope).messageCount, 2);
});
