// Purpose: Verifies clean-room Codex discovery, storage reconciliation, and normalized event selection.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { discoverCodexSessions, normalizeCodexSession } from '../src/index.js';
import { createTemporaryHome, setFileTime, writeJsonl } from './helpers.js';

const CODEX_ID = '33333333-3333-4333-8333-333333333333';

function codexRecords(workspacePath) {
  return [
    {
      timestamp: '2026-02-01T10:00:00.000Z',
      type: 'session_meta',
      payload: { id: CODEX_ID, cwd: workspacePath, cli_version: 'test-version' },
    },
    {
      timestamp: '2026-02-01T10:01:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'Duplicate event representation.' },
    },
    {
      timestamp: '2026-02-01T10:01:00.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Archive Codex.' }] },
    },
    {
      timestamp: '2026-02-01T10:02:00.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Archived.' }] },
    },
    {
      timestamp: '2026-02-01T10:02:30.000Z',
      type: 'response_item',
      payload: { type: 'function_call', name: 'local_tool', arguments: '{}' },
    },
    { timestamp: '2026-02-01T10:03:00.000Z', type: 'compacted', payload: {} },
  ];
}

test('Codex discovery reconciles active and archived paths by full identity', async (testContext) => {
  const temporaryHome = await createTemporaryHome(testContext);
  const codexRoot = path.join(temporaryHome, '.codex');
  const workspacePath = path.join(temporaryHome, 'Invented Workspace');
  const filename = `rollout-2026-02-01T10-00-00-${CODEX_ID}.jsonl`;
  const activePath = path.join(codexRoot, 'sessions', '2026', '02', '01', filename);
  const archivedPath = path.join(codexRoot, 'archived_sessions', filename);
  await writeJsonl(activePath, codexRecords(workspacePath));
  await writeJsonl(archivedPath, codexRecords(workspacePath));
  await setFileTime(archivedPath, '2026-02-01T10:05:00.000Z');
  await setFileTime(activePath, '2026-02-01T10:10:00.000Z');
  await writeJsonl(path.join(codexRoot, 'session_index.jsonl'), [
    { id: CODEX_ID, thread_name: 'Invented Codex archive', updated_at: '2026-02-01T10:03:00.000Z' },
  ]);

  const catalog = await discoverCodexSessions({ homeDirectory: temporaryHome, codexRoot });

  assert.equal(catalog.status, 'ready');
  assert.equal(catalog.sessions.length, 1);
  assert.equal(catalog.sessions[0].storageState, 'active');
  assert.equal(catalog.sessions[0].title.value, 'Invented Codex archive');
  assert.equal(catalog.observations.length, 1);

  const normalized = await normalizeCodexSession(catalog.sessions[0]);
  assert.equal(normalized.events.filter((event) => event.type === 'user').length, 1);
  assert.equal(normalized.events.filter((event) => event.type === 'assistant').length, 1);
  assert.equal(normalized.events.filter((event) => event.type === 'tool').length, 1);
  assert.equal(normalized.events.filter((event) => event.type === 'compaction').length, 1);
  assert.equal(normalized.events.some((event) => event.content.includes('Duplicate event')), false);
});
