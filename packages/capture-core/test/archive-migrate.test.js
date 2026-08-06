// Purpose: Verifies the one-time archive filename migration — legacy names renamed
// in place, outputPath repointed, collisions escalated, missing files deferred.

import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { migrateArchiveFilenames } from '../src/index.js';
import { createTemporaryHome } from './helpers.js';

const UUID_A = '0c21988e-2467-4b15-bd58-8232d7d2ecc8';
const UUID_B = '019fc320-1111-7abc-8def-1234567890ab';
const UUID_B_TWIN = '019fc320-2222-7abc-8def-1234567890ab'; // same 8-char prefix (UUIDv7 burst)

function manifestWith(archivePath, sessions) {
  return { archivePath, sessions };
}

function entry(provider, fullSessionId, basename, archivePath) {
  return {
    provider,
    fullSessionId,
    outputPath: path.join(archivePath, basename),
    lastSuccessfulExportAt: '2026-08-01T00:00:00.000Z',
    sourcePath: '/tmp/source',
  };
}

test('legacy filenames are renamed to provider--shortid--label with outputPath repointed', async (testContext) => {
  const home = await createTemporaryHome(testContext);
  const archivePath = path.join(home, 'archive');
  await mkdir(archivePath);
  const legacy = `claude-code--86_Grasppy-capture-folder-automation--${UUID_A}.md`;
  await writeFile(path.join(archivePath, legacy), 'body', 'utf8');

  const manifest = manifestWith(archivePath, {
    [`claude-code:${UUID_A}`]: entry('claude-code', UUID_A, legacy, archivePath),
  });

  const saved = [];
  const result = await migrateArchiveFilenames({
    manifestPath: path.join(home, 'capture-operational-manifest.json'),
    manifest,
    manifestWriter: async (p, m) => { saved.push(m); },
  });

  assert.equal(result.renamed, 1);
  assert.equal(result.failures.length, 0);
  const files = await readdir(archivePath);
  assert.deepEqual(files, ['claude-code--0c21988e--86_Grasppy-capture-folder-automation.md']);
  assert.equal(await readFile(path.join(archivePath, files[0]), 'utf8'), 'body');
  const migrated = saved[0].sessions[`claude-code:${UUID_A}`];
  assert.equal(path.basename(migrated.outputPath), files[0]);
});

test('short-id twins escalate to a longer id instead of colliding, and reruns are no-ops', async (testContext) => {
  const home = await createTemporaryHome(testContext);
  const archivePath = path.join(home, 'archive');
  await mkdir(archivePath);
  const legacyB = `codex--first--${UUID_B}.md`;
  const legacyTwin = `codex--second--${UUID_B_TWIN}.md`;
  await writeFile(path.join(archivePath, legacyB), 'b', 'utf8');
  await writeFile(path.join(archivePath, legacyTwin), 'twin', 'utf8');

  const manifest = manifestWith(archivePath, {
    [`codex:${UUID_B}`]: entry('codex', UUID_B, legacyB, archivePath),
    [`codex:${UUID_B_TWIN}`]: entry('codex', UUID_B_TWIN, legacyTwin, archivePath),
  });

  let saved = null;
  const result = await migrateArchiveFilenames({
    manifestPath: path.join(home, 'capture-operational-manifest.json'),
    manifest,
    manifestWriter: async (p, m) => { saved = m; },
  });

  assert.equal(result.renamed, 2);
  const files = (await readdir(archivePath)).sort();
  assert.equal(files.length, 2);
  assert.equal(files.filter((f) => /^codex--019fc320--/.test(f)).length, 1);
  assert.equal(files.filter((f) => /^codex--019fc320(1111|2222)--/.test(f)).length, 1);

  // Rerun on the migrated manifest: nothing legacy remains, so it's a no-op.
  const rerun = await migrateArchiveFilenames({
    manifestPath: path.join(home, 'capture-operational-manifest.json'),
    manifest: saved,
    manifestWriter: async () => { throw new Error('must not write on a no-op'); },
  });
  assert.equal(rerun.renamed, 0);
});

test('a missing legacy file is deferred, not guessed at', async (testContext) => {
  const home = await createTemporaryHome(testContext);
  const archivePath = path.join(home, 'archive');
  await mkdir(archivePath);
  const legacy = `cursor--ghost--${UUID_A}.md`; // never written to disk

  const manifest = manifestWith(archivePath, {
    [`cursor:${UUID_A}`]: entry('cursor', UUID_A, legacy, archivePath),
  });

  let saved = null;
  const result = await migrateArchiveFilenames({
    manifestPath: path.join(home, 'capture-operational-manifest.json'),
    manifest,
    manifestWriter: async (p, m) => { saved = m; },
  });

  assert.equal(result.renamed, 0);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].reason, 'ENOENT');
  assert.equal(path.basename(saved.sessions[`cursor:${UUID_A}`].outputPath), legacy);
});
