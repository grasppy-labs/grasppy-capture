// Purpose: Verifies clean-room Claude Code discovery, identity validation, and normalization.

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { discoverClaudeSessions, normalizeClaudeSession } from '../src/index.js';
import { createTemporaryHome, writeJsonl } from './helpers.js';

const CLAUDE_ID = '11111111-1111-4111-8111-111111111111';
const REJECTED_ID = '22222222-2222-4222-8222-222222222222';

test('Claude discovery enumerates main transcripts without relying on the index', async (testContext) => {
  const temporaryHome = await createTemporaryHome(testContext);
  const configRoot = path.join(temporaryHome, 'custom-claude');
  const projectPath = path.join(configRoot, 'projects', 'invented-project');
  const sessionPath = path.join(projectPath, `${CLAUDE_ID}.jsonl`);
  await writeJsonl(sessionPath, [
    {
      type: 'user',
      sessionId: CLAUDE_ID,
      cwd: path.join(temporaryHome, 'Invented Project'),
      version: 'test-version',
      timestamp: '2026-01-01T10:00:00.000Z',
      message: { content: 'Design a local archive.' },
    },
    {
      type: 'assistant',
      sessionId: CLAUDE_ID,
      timestamp: '2026-01-01T10:01:00.000Z',
      message: { content: [{ type: 'text', text: 'The archive is local.' }] },
    },
    { type: 'custom-title', sessionId: CLAUDE_ID, customTitle: 'Local archive design' },
  ], { trailingFragment: '{"active":' });
  await writeJsonl(path.join(projectPath, `${REJECTED_ID}.jsonl`), [
    { type: 'user', sessionId: CLAUDE_ID, message: { content: 'Wrong identity.' } },
  ]);
  const subagentsPath = path.join(projectPath, CLAUDE_ID, 'subagents');
  await mkdir(subagentsPath, { recursive: true });
  await writeFile(path.join(subagentsPath, 'agent-invented.jsonl'), '{}\n', 'utf8');

  const catalog = await discoverClaudeSessions({
    homeDirectory: temporaryHome,
    environment: { CLAUDE_CONFIG_DIR: configRoot },
  });

  assert.equal(catalog.status, 'ready');
  assert.equal(catalog.sessions.length, 1);
  assert.equal(catalog.sessions[0].fullSessionId, CLAUDE_ID);
  assert.equal(catalog.sessions[0].metadata.subagentCount, 1);
  assert.equal(catalog.sessions[0].title.value, 'Local archive design');
  assert.equal(catalog.sessions[0].activity.confidence, 'high');
  assert.equal(catalog.sessions[0].completeness.isComplete, false);
  assert.equal(catalog.observations.length, 1);

  const normalized = await normalizeClaudeSession(catalog.sessions[0]);
  assert.equal(normalized.events.filter((event) => event.type === 'user').length, 1);
  assert.equal(normalized.events.filter((event) => event.type === 'assistant').length, 1);
  assert.equal(normalized.source.workspacePath, path.join(temporaryHome, 'Invented Project'));
});
