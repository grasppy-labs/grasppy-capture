// Purpose: Verifies that base64 media inside tool results is kept out of the archive while every other byte is unchanged.

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';

import {
  MIN_BINARY_RUN,
  discoverClaudeSessions,
  discoverCodexSessions,
  normalizeClaudeSession,
  normalizeCodexSession,
  omittedPayload,
  renderCaptureMarkdown,
  sweepBinaryPayloads,
  validateCaptureMarkdown,
} from '../src/index.js';
import { createTemporaryHome, writeJsonl } from './helpers.js';

const CLAUDE_ID = '44444444-4444-4444-8444-444444444444';
const CODEX_ID = '55555555-5555-4555-8555-555555555555';
const NOW = '2026-11-08T00:00:00.000Z';
// About 1 MB of base64, the size of a typical screenshot a tool returns.
const PNG_BASE64 = Buffer.alloc(768 * 1024, 7).toString('base64');
const LONG_BASE64_RUN = /[A-Za-z0-9+/]{1000,}/;
const PNG_DIGEST = createHash('sha256').update(PNG_BASE64).digest('hex').slice(0, 12);
const OMITTED = `[omitted: ${768 * 1024} bytes, sha256:${PNG_DIGEST}]`;

async function renderClaude(testContext, toolResultContent) {
  const temporaryHome = await createTemporaryHome(testContext);
  const configRoot = path.join(temporaryHome, 'claude');
  await writeJsonl(path.join(configRoot, 'projects', 'invented', `${CLAUDE_ID}.jsonl`), [
    { type: 'user', sessionId: CLAUDE_ID, timestamp: '2026-11-08T00:00:00.000Z', message: { content: 'Look at the screenshot.' } },
    {
      type: 'assistant', sessionId: CLAUDE_ID, timestamp: '2026-11-08T00:00:01.000Z',
      message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/invented/shot.png' } }] },
    },
    {
      type: 'user', sessionId: CLAUDE_ID, timestamp: '2026-11-08T00:00:02.000Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: toolResultContent }] },
    },
    {
      type: 'assistant', sessionId: CLAUDE_ID, timestamp: '2026-11-08T00:00:03.000Z',
      message: { content: [{ type: 'text', text: 'The header is cut off.' }] },
    },
  ]);
  const catalog = await discoverClaudeSessions({ homeDirectory: temporaryHome, environment: { CLAUDE_CONFIG_DIR: configRoot } });
  const session = await normalizeClaudeSession(catalog.sessions[0]);
  return renderCaptureMarkdown(session, { exportedAt: NOW });
}

// The conversation with every tool block removed, using the exact-removal fence.
function conversationText(markdown) {
  return markdown.replace(/### Tool activity — [^\n]*\n\n(`{3,})grasppy-tool\n[\s\S]*?\n\1(?=\n|$)/g, '');
}

test('a Claude tool-result image keeps its text, type and media type but not its base64', async (testContext) => {
  const rendered = await renderClaude(testContext, [
    { type: 'text', text: 'Read 1 image.' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_BASE64 } },
  ]);

  assert.doesNotMatch(rendered.markdown, LONG_BASE64_RUN);
  assert.ok(rendered.markdown.includes('"text":"Read 1 image."'), 'the text block is unchanged');
  assert.ok(rendered.markdown.includes('"media_type":"image/png"'));
  assert.ok(rendered.markdown.includes(`"data":"${OMITTED}"`));
  assert.ok(rendered.markdown.includes('"file_path":"/invented/shot.png"'), 'the tool call still names the source');
  assert.equal(validateCaptureMarkdown(rendered.markdown, rendered.envelope).messageCount, 2);
});

test('a Codex input_image data URL keeps its prefix but not its base64', async (testContext) => {
  const temporaryHome = await createTemporaryHome(testContext);
  const codexRoot = path.join(temporaryHome, '.codex');
  await writeJsonl(path.join(codexRoot, 'sessions', '2026', '11', '08', `rollout-2026-11-08T00-00-00-${CODEX_ID}.jsonl`), [
    { timestamp: '2026-11-08T00:00:00.000Z', type: 'session_meta', payload: { id: CODEX_ID, cwd: temporaryHome } },
    { timestamp: '2026-11-08T00:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Take a screenshot.' }] } },
    { timestamp: '2026-11-08T00:00:02.000Z', type: 'response_item', payload: { type: 'function_call', name: 'screenshot', arguments: '{}' } },
    {
      timestamp: '2026-11-08T00:00:03.000Z', type: 'response_item',
      payload: {
        type: 'function_call_output',
        output: [
          { type: 'input_text', text: 'Wall time: 0.1 seconds' },
          { type: 'input_image', image_url: `data:image/jpeg;base64,${PNG_BASE64}` },
        ],
      },
    },
    { timestamp: '2026-11-08T00:00:04.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Captured.' }] } },
  ]);
  const catalog = await discoverCodexSessions({ homeDirectory: temporaryHome, codexRoot });
  const rendered = renderCaptureMarkdown(await normalizeCodexSession(catalog.sessions[0]), { exportedAt: NOW });

  assert.doesNotMatch(rendered.markdown, LONG_BASE64_RUN);
  assert.ok(rendered.markdown.includes(`"image_url":"data:image/jpeg;base64,${OMITTED}"`));
  assert.ok(rendered.markdown.includes('"text":"Wall time: 0.1 seconds"'));
  assert.equal(validateCaptureMarkdown(rendered.markdown, rendered.envelope).messageCount, 2);
});

test('tool results without base64 render exactly as before', async (testContext) => {
  const cases = [
    'plain string output',
    [{ type: 'text', text: 'line one\nline two' }],
    [{ type: 'image', source: { type: 'url', url: 'https://example.invalid/shot.png' } }],
    [{ type: 'input_image', image_url: 'https://example.invalid/shot.png' }],
  ];
  for (const content of cases) {
    const rendered = await renderClaude(testContext, content);
    const expected = typeof content === 'string' ? content : JSON.stringify(content);
    assert.ok(rendered.markdown.includes(`grasppy-tool\n${expected}\n`), `unchanged: ${expected.slice(0, 40)}`);
  }
});

test('omitting media leaves the conversation, message and turn counts identical', async (testContext) => {
  const withImage = await renderClaude(testContext, [
    { type: 'text', text: 'Read 1 image.' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_BASE64 } },
  ]);
  const withoutImage = await renderClaude(testContext, [{ type: 'text', text: 'Read 1 image.' }]);

  assert.equal(conversationText(withImage.markdown), conversationText(withoutImage.markdown));
  assert.ok(conversationText(withImage.markdown).includes('The header is cut off.'));
  assert.equal(withImage.messageCount, withoutImage.messageCount);
  assert.equal(withImage.conversationTurnCount, withoutImage.conversationTurnCount);
  assert.ok(withImage.markdown.length < 2048 + withoutImage.markdown.length, 'the placeholder is small');
});

// ── Backstop: renderCaptureMarkdown sweeps every event, whatever shape carried the payload ──

const BASE64_RUN = /[A-Za-z0-9+/_-]{1000,}/;
const DATA_URL_PAYLOAD = /;base64,[A-Za-z0-9+/_-]/i;
const RANDOM_IMAGE = randomBytes(3000).toString('base64'); // 4,000 characters, as varied as real image data
const RANDOM_IMAGE_URLSAFE = randomBytes(3000).toString('base64url');
const TINY_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
// Content that looks a little like base64 and must come through byte-identical.
const ORDINARY = {
  text: 'The archive keeps every turn, and nothing else changes.',
  hash: createHash('sha256').update('invented').digest('hex'),
  jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  minified: '!function(e,t){"use strict";var n={};function r(o){if(n[o])return n[o].exports;var i=n[o]={i:o,l:!1,exports:{}};return e[o].call(i.exports,i,i.exports,r),i.l=!0,i.exports}r.m=e,r.c=n}([function(e,t,n){e.exports=n(1)}]);'.repeat(40),
  justUnder: 'A'.repeat(999),
};
// Shared with the daemon's copy of the sweep (scripts/chat-sync-daemon/binary-sweep.test.cjs in GRASPPY).
const PARITY_P1 = Buffer.from(Array.from({ length: 1500 }, (_, i) => (i * 7919) % 256)).toString('base64');
const PARITY_P2 = Buffer.from(Array.from({ length: 900 }, (_, i) => (i * 104729) % 256)).toString('base64url');
const PARITY_INPUT = `before data:image/png;base64,${PARITY_P1} middle ${PARITY_P2} after`;
const PARITY_OUTPUT = 'before data:image/png;base64,[omitted: 1500 bytes, sha256:d85597762cbb] middle [omitted: 900 bytes, sha256:970a3e7265b1] after';

function assertNoPayloads(markdown) {
  assert.doesNotMatch(markdown, BASE64_RUN, 'no base64 run of 1,000+ characters');
  assert.doesNotMatch(markdown, DATA_URL_PAYLOAD, 'no ;base64, payload');
}

test('the sweep replaces payloads, keeps look-alikes byte-identical, and is idempotent', () => {
  assert.equal(sweepBinaryPayloads(PARITY_INPUT), PARITY_OUTPUT);
  assert.equal(sweepBinaryPayloads(PARITY_OUTPUT), PARITY_OUTPUT);
  for (const [name, value] of Object.entries(ORDINARY)) assert.equal(sweepBinaryPayloads(value), value, name);
  assert.equal(sweepBinaryPayloads(`${'A'.repeat(1000)}`), omittedPayload('A'.repeat(1000)), 'the 1,000-character boundary');
  assert.equal(sweepBinaryPayloads(TINY_GIF), `data:image/gif;base64,${omittedPayload(TINY_GIF.split(',')[1])}`, 'data URLs at any size');
  assert.equal(sweepBinaryPayloads(`(${RANDOM_IMAGE_URLSAFE})`), `(${omittedPayload(RANDOM_IMAGE_URLSAFE)})`, 'base64url');
  assert.equal(MIN_BINARY_RUN, 1000);
});

test('a Claude session with base64 in every position archives no payload and keeps all other text', async (testContext) => {
  const temporaryHome = await createTemporaryHome(testContext);
  const configRoot = path.join(temporaryHome, 'claude');
  const nested = { a: { b: { c: [{ d: { e: RANDOM_IMAGE } }] } } };
  await writeJsonl(path.join(configRoot, 'projects', 'invented', `${CLAUDE_ID}.jsonl`), [
    // user text: a data URL and a bare run
    { type: 'user', sessionId: CLAUDE_ID, timestamp: '2026-11-08T00:00:00.000Z', message: { content: `${ORDINARY.text} data:image/png;base64,${RANDOM_IMAGE} and ${RANDOM_IMAGE}` } },
    // assistant text: a base64url run and a tiny data URL, beside every look-alike
    {
      type: 'assistant', sessionId: CLAUDE_ID, timestamp: '2026-11-08T00:00:01.000Z',
      message: { content: [{ type: 'text', text: `${RANDOM_IMAGE_URLSAFE} ${TINY_GIF} ${ORDINARY.hash} ${ORDINARY.jwt} ${ORDINARY.justUnder}\n${ORDINARY.minified}` }] },
    },
    // tool_use input, including a deeply nested object
    {
      type: 'assistant', sessionId: CLAUDE_ID, timestamp: '2026-11-08T00:00:02.000Z',
      message: { content: [{ type: 'tool_use', id: 'toolu_2', name: 'Write', input: { file_path: '/invented/icon.b64', content: RANDOM_IMAGE, nested } }] },
    },
    // tool_result: a text block carrying base64 and an image block
    {
      type: 'user', sessionId: CLAUDE_ID, timestamp: '2026-11-08T00:00:03.000Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: [
        { type: 'text', text: `base64 output:\n${RANDOM_IMAGE}` },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: RANDOM_IMAGE } },
      ] }] },
    },
    { type: 'assistant', sessionId: CLAUDE_ID, timestamp: '2026-11-08T00:00:04.000Z', message: { content: [{ type: 'text', text: 'Done.' }] } },
  ]);
  const catalog = await discoverClaudeSessions({ homeDirectory: temporaryHome, environment: { CLAUDE_CONFIG_DIR: configRoot } });
  const rendered = renderCaptureMarkdown(await normalizeClaudeSession(catalog.sessions[0]), { exportedAt: NOW });

  assertNoPayloads(rendered.markdown);
  for (const [name, value] of Object.entries(ORDINARY)) assert.ok(rendered.markdown.includes(value), `${name} is byte-identical`);
  assert.ok(rendered.markdown.includes('data:image/png;base64,[omitted: 3000 bytes, sha256:'), 'the user data URL keeps its media type');
  assert.ok(rendered.markdown.includes('"e":"[omitted: 3000 bytes, sha256:'), 'the nested value is replaced in place');
  assert.ok((rendered.markdown.match(/\[omitted: \d+ bytes, sha256:[0-9a-f]{12}\]/g) || []).length >= 8);
  assert.equal(sweepBinaryPayloads(rendered.markdown), rendered.markdown);
  assert.deepEqual(validateCaptureMarkdown(rendered.markdown, rendered.envelope), { messageCount: 2, conversationTurnCount: 1 });
});

test('a Codex session with an input_image data URL and base64 in text archives no payload', async (testContext) => {
  const temporaryHome = await createTemporaryHome(testContext);
  const codexRoot = path.join(temporaryHome, '.codex');
  await writeJsonl(path.join(codexRoot, 'sessions', '2026', '11', '08', `rollout-2026-11-08T00-00-00-${CODEX_ID}.jsonl`), [
    { timestamp: '2026-11-08T00:00:00.000Z', type: 'session_meta', payload: { id: CODEX_ID, cwd: temporaryHome } },
    { timestamp: '2026-11-08T00:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `See ${TINY_GIF} and ${ORDINARY.jwt}` }] } },
    { timestamp: '2026-11-08T00:00:02.000Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ cmd: `echo ${RANDOM_IMAGE}` }) } },
    {
      timestamp: '2026-11-08T00:00:03.000Z', type: 'response_item',
      payload: { type: 'function_call_output', output: [
        { type: 'input_text', text: RANDOM_IMAGE_URLSAFE },
        { type: 'input_image', image_url: `data:image/webp;base64,${RANDOM_IMAGE}` },
      ] },
    },
    { timestamp: '2026-11-08T00:00:04.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Captured ${ORDINARY.hash}.` }] } },
  ]);
  const catalog = await discoverCodexSessions({ homeDirectory: temporaryHome, codexRoot });
  const rendered = renderCaptureMarkdown(await normalizeCodexSession(catalog.sessions[0]), { exportedAt: NOW });

  assertNoPayloads(rendered.markdown);
  assert.ok(rendered.markdown.includes(ORDINARY.jwt));
  assert.ok(rendered.markdown.includes(ORDINARY.hash));
  assert.ok(rendered.markdown.includes('"image_url":"data:image/webp;base64,[omitted: 3000 bytes, sha256:'));
  assert.equal(validateCaptureMarkdown(rendered.markdown, rendered.envelope).messageCount, 2);
});
