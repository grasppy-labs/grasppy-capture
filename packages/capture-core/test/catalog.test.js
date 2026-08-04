// Purpose: Verifies the three approved adapters and isolated empty-home catalog behavior.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { PROVIDER_ADAPTERS, assertProviderAdapter, catalogProviders } from '../src/index.js';
import { createTemporaryHome } from './helpers.js';

test('the approved provider registry satisfies the shared adapter contract', () => {
  assert.equal(PROVIDER_ADAPTERS.length, 3);
  PROVIDER_ADAPTERS.forEach((adapter) => assertProviderAdapter(adapter));
});

test('an empty invented home reports each provider unavailable without broad scanning', async (testContext) => {
  const temporaryHome = await createTemporaryHome(testContext);
  const results = await catalogProviders({
    homeDirectory: temporaryHome,
    environment: {},
    claudeConfigRoot: path.join(temporaryHome, '.claude'),
    codexRoot: path.join(temporaryHome, '.codex'),
    cursorProjectsRoot: path.join(temporaryHome, '.cursor', 'projects'),
  });

  assert.equal(results.length, 3);
  assert.deepEqual(results.map((result) => result.status), ['not-found', 'not-found', 'not-found']);
  assert.equal(results.every((result) => result.sessions.length === 0), true);
});
