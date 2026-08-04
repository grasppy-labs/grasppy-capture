// Purpose: Verifies packaged startup selects native and registration modes only through explicit flags.

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRuntimeMode } from '../src/runtime-mode.js';

test('runtime mode defaults to the desktop application', () => {
  assert.deepEqual(parseRuntimeMode(['electron', '.']), { mode: 'desktop', extensionIds: [] });
});

test('native messaging and fixed-id registration require explicit flags', () => {
  assert.deepEqual(
    parseRuntimeMode(['capture', '--native-messaging-host', 'chrome-extension://invented/']),
    { mode: 'native-host', extensionIds: [] },
  );
  assert.deepEqual(
    parseRuntimeMode(['capture', `--register-native-host=${'a'.repeat(32)}`]),
    { mode: 'register-native-host', extensionIds: ['a'.repeat(32)] },
  );
});
