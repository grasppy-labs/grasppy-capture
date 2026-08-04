// Purpose: Verifies that desktop IPC accepts only exact intent payloads and canonical local session keys.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateExclusionRequest,
  validateNoArguments,
  validateSessionRequest,
} from '../src/main/ipc-validation.js';

const SESSION_KEY = 'codex:00000000-0000-4000-8000-000000000001';

test('no-argument operations reject hidden renderer input', () => {
  assert.equal(validateNoArguments([]), undefined);
  assert.throws(() => validateNoArguments(['/arbitrary/path']), /does not accept input/);
});

test('session operations reject paths, short ids, unknown providers, and extra fields', () => {
  assert.equal(validateSessionRequest({ sessionKey: SESSION_KEY }), SESSION_KEY);
  for (const input of [
    { sessionKey: '/arbitrary/path' },
    { sessionKey: 'codex:00000000' },
    { sessionKey: 'browser:00000000-0000-4000-8000-000000000001' },
    { sessionKey: SESSION_KEY, outputPath: '/arbitrary/path' },
  ]) {
    assert.throws(() => validateSessionRequest(input));
  }
});

test('exclusion operations require one canonical key and one boolean', () => {
  assert.deepEqual(validateExclusionRequest({ sessionKey: SESSION_KEY, excluded: true }), {
    sessionKey: SESSION_KEY,
    excluded: true,
  });
  assert.throws(() => validateExclusionRequest({ sessionKey: SESSION_KEY, excluded: 'yes' }));
  assert.throws(() => validateExclusionRequest({ sessionKey: SESSION_KEY, excluded: false, path: '/x' }));
});
