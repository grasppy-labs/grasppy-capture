// Purpose: Verifies the browser filename migration renames, stays idempotent, and never overwrites a colliding capture.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { BROWSER_MANIFEST_FILENAME, saveBrowserManifest } from '../src/browser-manifest.js';
import { migrateBrowserFilenames } from '../src/migrate-browser-filenames.js';
import { createConfiguredTestArchive } from './helpers.js';

const NOW = '2026-08-12T09:00:00.000Z';

// Two Claude conversations that share their first 8 hex characters. Distinct
// conversations, so distinct manifest entries — but the 8-character id slot
// cannot tell them apart, which is the collision this migration must survive.
const SHARED_PREFIX_8_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const SHARED_PREFIX_8_B = 'aaaaaaaa-2222-4222-8222-222222222222';
// Three conversations sharing the first 12 hex characters. Two id lengths are
// available, so the third has nothing left to escalate to.
const SHARED_PREFIX_12 = Object.freeze([
  'bbbbbbbb-1111-4111-8111-111111111111',
  'bbbbbbbb-1111-4222-8222-222222222222',
  'bbbbbbbb-1111-4333-8333-333333333333',
]);

function legacyBasename(conversationId, label) {
  return `browser--claude--${label}--${conversationId}.md`;
}

function browserSession(conversationId, outputFilename, requestIdSuffix) {
  return {
    provider: 'claude',
    conversationId,
    identityFormat: 'uuid',
    outputFilename,
    formatVersion: 1,
    lastSuccessfulExportAt: '2026-08-05T10:00:00.000Z',
    lastMarkdownSizeBytes: 128,
    lastRequestId: `00000000-0000-4000-8000-00000000000${requestIdSuffix}`,
  };
}

// Writes a browser manifest plus one Markdown file per session, each carrying
// its own conversation id so a clobbered file is detectable by content.
async function seedLegacyArchive(environment, sessions) {
  const manifest = {
    schemaVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    sessions: {},
    runs: [],
  };
  for (const session of sessions) {
    manifest.sessions[`claude:${session.conversationId}`] = session;
    await writeFile(
      path.join(environment.archivePath, session.outputFilename),
      `**Session ID:** ${session.conversationId}\n`,
      'utf8',
    );
  }
  await saveBrowserManifest(
    path.join(environment.appDataDirectory, BROWSER_MANIFEST_FILENAME),
    manifest,
  );
}

async function sessionIdInFile(archivePath, basename) {
  return (await readFile(path.join(archivePath, basename), 'utf8')).trim().replace('**Session ID:** ', '');
}

test('browser migration renames legacy captures and is a no-op on the second pass', async (testContext) => {
  const environment = await createConfiguredTestArchive();
  testContext.after(environment.cleanup);
  await seedLegacyArchive(environment, [
    browserSession(SHARED_PREFIX_8_A, legacyBasename(SHARED_PREFIX_8_A, 'Invented-planning'), 1),
  ]);

  const first = await migrateBrowserFilenames({
    appDataDirectory: environment.appDataDirectory,
    archivePath: environment.archivePath,
    now: NOW,
  });

  assert.equal(first.renamed, 1);
  assert.deepEqual(first.failures, []);
  const renamedTo = first.manifest.sessions[`claude:${SHARED_PREFIX_8_A}`].outputFilename;
  assert.equal(renamedTo, 'claude--aaaaaaaa--Invented-planning.md');
  assert.equal(await sessionIdInFile(environment.archivePath, renamedTo), SHARED_PREFIX_8_A);

  const second = await migrateBrowserFilenames({
    appDataDirectory: environment.appDataDirectory,
    archivePath: environment.archivePath,
    now: NOW,
  });
  assert.equal(second.renamed, 0);
  assert.deepEqual(second.failures, []);
});

// The defect this guards: rename() replaces an existing target without
// complaint, so two captures resolving to one basename silently cost the user
// a conversation. The CLI migration lengthens the id instead; so must this one.
test('browser migration lengthens the id rather than overwriting a colliding capture', async (testContext) => {
  const environment = await createConfiguredTestArchive();
  testContext.after(environment.cleanup);
  await seedLegacyArchive(environment, [
    browserSession(SHARED_PREFIX_8_A, legacyBasename(SHARED_PREFIX_8_A, 'Shared-title'), 1),
    browserSession(SHARED_PREFIX_8_B, legacyBasename(SHARED_PREFIX_8_B, 'Shared-title'), 2),
  ]);

  const result = await migrateBrowserFilenames({
    appDataDirectory: environment.appDataDirectory,
    archivePath: environment.archivePath,
    now: NOW,
  });

  assert.equal(result.renamed, 2);
  assert.deepEqual(result.failures, []);
  const nameA = result.manifest.sessions[`claude:${SHARED_PREFIX_8_A}`].outputFilename;
  const nameB = result.manifest.sessions[`claude:${SHARED_PREFIX_8_B}`].outputFilename;
  assert.notEqual(nameA, nameB);
  // Both conversations survive, each still pointing at its own Markdown.
  assert.equal(await sessionIdInFile(environment.archivePath, nameA), SHARED_PREFIX_8_A);
  assert.equal(await sessionIdInFile(environment.archivePath, nameB), SHARED_PREFIX_8_B);
});

test('browser migration keeps the legacy name when no collision-free name exists', async (testContext) => {
  const environment = await createConfiguredTestArchive();
  testContext.after(environment.cleanup);
  await seedLegacyArchive(
    environment,
    SHARED_PREFIX_12.map((conversationId, index) => browserSession(
      conversationId,
      legacyBasename(conversationId, 'Shared-title'),
      index + 1,
    )),
  );

  const result = await migrateBrowserFilenames({
    appDataDirectory: environment.appDataDirectory,
    archivePath: environment.archivePath,
    now: NOW,
  });

  // Two id lengths, three claimants: the last one out has nowhere to go.
  assert.equal(result.renamed, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].reason, 'no collision-free filename');

  const failedId = result.failures[0].sessionKey.replace('claude:', '');
  assert.equal(
    result.manifest.sessions[result.failures[0].sessionKey].outputFilename,
    legacyBasename(failedId, 'Shared-title'),
  );

  // The invariant that matters: every conversation still resolves to its own
  // Markdown. Keeping a legacy name is a deferral; losing a file is not.
  const filenames = new Set();
  for (const conversationId of SHARED_PREFIX_12) {
    const { outputFilename } = result.manifest.sessions[`claude:${conversationId}`];
    assert.equal(await sessionIdInFile(environment.archivePath, outputFilename), conversationId);
    filenames.add(outputFilename);
  }
  assert.equal(filenames.size, SHARED_PREFIX_12.length);
});
