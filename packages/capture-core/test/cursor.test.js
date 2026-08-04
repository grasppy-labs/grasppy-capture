// Purpose: Verifies clean-room Cursor discovery, exact identity layout, and completeness warnings.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { discoverCursorSessions, normalizeCursorSession } from '../src/index.js';
import { createTemporaryHome, writeJsonl } from './helpers.js';

const CURSOR_ID = '44444444-4444-4444-8444-444444444444';
const MISMATCH_ID = '55555555-5555-4555-8555-555555555555';

test('Cursor discovery accepts only matching agent-transcript directory and filename identities', async (testContext) => {
  const temporaryHome = await createTemporaryHome(testContext);
  const projectsRoot = path.join(temporaryHome, '.cursor', 'projects');
  const transcriptPath = path.join(
    projectsRoot,
    'invented-project',
    'agent-transcripts',
    CURSOR_ID,
    `${CURSOR_ID}.jsonl`,
  );
  await writeJsonl(transcriptPath, [
    { role: 'user', message: { content: [{ type: 'text', text: 'Capture this Cursor session.' }] } },
    {
      role: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Captured locally.' },
          { type: 'tool_use', name: 'local_tool', input: { approved: true } },
        ],
      },
    },
    { type: 'turn_ended', status: 'completed' },
  ]);
  await writeJsonl(path.join(
    projectsRoot,
    'invented-project',
    'agent-transcripts',
    MISMATCH_ID,
    `${CURSOR_ID}.jsonl`,
  ), [{ role: 'user', message: { content: 'Mismatched file.' } }]);

  const catalog = await discoverCursorSessions({ homeDirectory: temporaryHome, cursorProjectsRoot: projectsRoot });

  assert.equal(catalog.status, 'ready');
  assert.equal(catalog.sessions.length, 1);
  assert.equal(catalog.sessions[0].fullSessionId, CURSOR_ID);
  assert.equal(catalog.observations.length, 1);
  assert.equal(catalog.sessions[0].activity.confidence, 'low');

  const normalized = await normalizeCursorSession(catalog.sessions[0]);
  assert.equal(normalized.events.filter((event) => event.type === 'user').length, 1);
  assert.equal(normalized.events.filter((event) => event.type === 'assistant').length, 1);
  assert.equal(normalized.events.filter((event) => event.type === 'tool').length, 1);
  assert.equal(normalized.events.filter((event) => event.type === 'lifecycle').length, 1);
  assert.equal(normalized.title.value, 'Capture this Cursor session.');
});

test('Cursor user-only local truth remains available with an incomplete warning', async (testContext) => {
  const temporaryHome = await createTemporaryHome(testContext);
  const projectsRoot = path.join(temporaryHome, '.cursor', 'projects');
  const transcriptPath = path.join(
    projectsRoot,
    'remote-group',
    'agent-transcripts',
    CURSOR_ID,
    `${CURSOR_ID}.jsonl`,
  );
  await writeJsonl(transcriptPath, [
    { role: 'user', message: { content: [{ type: 'text', text: 'Local user-only record.' }] } },
  ]);

  const catalog = await discoverCursorSessions({ homeDirectory: temporaryHome, cursorProjectsRoot: projectsRoot });

  assert.equal(catalog.sessions.length, 1);
  assert.equal(catalog.sessions[0].completeness.isComplete, false);
  assert.match(catalog.sessions[0].completeness.warnings[0], /no assistant messages/i);
});
