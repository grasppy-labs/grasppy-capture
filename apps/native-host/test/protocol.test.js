// Purpose: Verifies exact request fields, provider-specific identities, and path-free response contracts.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NATIVE_ERROR_CODES,
  createErrorResponse,
  createSuccessResponse,
  validateNativeSaveRequest,
} from '../src/index.js';
import { inventedRequest } from './helpers.js';

const UUID = '00000000-0000-4000-8000-000000000002';
const PROVIDER_CASES = [
  ['claude', 'uuid', UUID, `https://claude.ai/chat/${UUID}`],
  ['chatgpt', 'uuid', UUID, `https://chatgpt.com/c/${UUID}`],
  ['grok', 'uuid', 'grok-chat-1234', 'https://grok.com/c/grok-chat-1234'],
  ['perplexity', 'slug', 'invented-search-1', 'https://perplexity.ai/search/invented-search-1'],
  ['typingmind', 'opaque', 'invented_chat_1', 'https://typingmind.com/#chat=invented_chat_1'],
  ['lovable', 'uuid', UUID, `https://lovable.dev/projects/${UUID}`],
  ['deepseek', 'opaque', 'invented-chat-1', 'https://chat.deepseek.com/a/chat/s/invented-chat-1'],
  ['gemini', 'opaque', 'Invented123', 'https://gemini.google.com/u/0/app/Invented123'],
  ['replit', 'slug', 'invented_project', 'https://replit.com/@invented/invented_project'],
  ['copilot', 'uuid', UUID, `https://github.com/copilot/c/${UUID}`],
  ['mistral', 'uuid', UUID, `https://chat.mistral.ai/chat/${UUID}`],
  ['bolt', 'slug', 'invented_project', 'https://bolt.new/~/invented_project'],
];

test('all twelve approved provider shapes validate without a UUID-only browser rule', () => {
  for (const [provider, identityFormat, conversationId, sourceUrl] of PROVIDER_CASES) {
    const request = validateNativeSaveRequest(inventedRequest({
      provider,
      identityFormat,
      conversationId,
      sourceUrl,
    }));
    assert.equal(request.provider, provider);
    assert.equal(request.conversationId, conversationId);
  }
});

test('missing identities fail with IDENTITY_UNAVAILABLE and Voila stays unsupported', () => {
  assert.throws(
    () => validateNativeSaveRequest(inventedRequest({ conversationId: null })),
    (error) => error.code === NATIVE_ERROR_CODES.IDENTITY_UNAVAILABLE,
  );
  assert.throws(
    () => validateNativeSaveRequest(inventedRequest({ provider: 'voila' })),
    (error) => error.code === NATIVE_ERROR_CODES.INVALID_PROVIDER,
  );
});

test('identity, URL, filename, Markdown, and exact-field failures are rejected', () => {
  assert.throws(
    () => validateNativeSaveRequest(inventedRequest({ sourceUrl: `https://chatgpt.com/c/${UUID}` })),
    (error) => error.code === NATIVE_ERROR_CODES.SOURCE_URL_INVALID,
  );
  assert.throws(
    () => validateNativeSaveRequest(inventedRequest({ filenameHint: '../archive.md' })),
    (error) => error.code === NATIVE_ERROR_CODES.FILENAME_HINT_INVALID,
  );
  assert.throws(
    () => validateNativeSaveRequest(inventedRequest({ markdown: '**GRASPPY Capture Format:** 1' })),
    (error) => error.code === NATIVE_ERROR_CODES.MARKDOWN_INVALID,
  );
  assert.throws(
    () => validateNativeSaveRequest({ ...inventedRequest(), normalizedContentFingerprint: 'forbidden' }),
    (error) => error.code === NATIVE_ERROR_CODES.INVALID_REQUEST,
  );
});

test('responses expose disposition and identity but never archive paths or content', () => {
  const request = validateNativeSaveRequest(inventedRequest());
  const success = createSuccessResponse(request, {
    disposition: 'created',
    bytesWritten: 2_048,
    processedAt: '2026-08-03T08:00:00.000Z',
  });
  assert.deepEqual(success.result, {
    disposition: 'created',
    provider: 'claude',
    conversationId: UUID,
    bytesWritten: 2_048,
    processedAt: '2026-08-03T08:00:00.000Z',
  });
  const serialized = JSON.stringify(success);
  assert.equal(serialized.includes('archivePath'), false);
  assert.equal(serialized.includes('markdown'), false);
  const failure = createErrorResponse(
    Object.assign(new Error('unsafe'), {
      code: NATIVE_ERROR_CODES.ARCHIVE_UNAVAILABLE,
    }),
    request.requestId,
  );
  assert.equal(failure.error.code, NATIVE_ERROR_CODES.INTERNAL_ERROR);
  assert.equal(JSON.stringify(failure).includes('unsafe'), false);
});
