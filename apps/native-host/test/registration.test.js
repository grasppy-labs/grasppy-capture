// Purpose: Verifies exact-origin macOS registration, executable checks, and runtime caller enforcement.

import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  NATIVE_ERROR_CODES,
  NATIVE_HOST_CONFIG_FILENAME,
  NATIVE_HOST_MANIFEST_FILENAME,
  assertAllowedCaller,
  registerMacNativeHost,
} from '../src/index.js';
import { INVENTED_EXTENSION_ID, INVENTED_ORIGIN } from './helpers.js';

test('registration writes one exact-origin manifest and a matching private runtime config', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'grasppy-capture-registration-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executablePath = path.join(root, 'invented-native-host');
  const appDataDirectory = path.join(root, 'app-data');
  const chromeUserDataDirectory = path.join(root, 'chrome');
  await writeFile(executablePath, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await chmod(executablePath, 0o700);

  const result = await registerMacNativeHost({
    extensionIds: [INVENTED_EXTENSION_ID, INVENTED_EXTENSION_ID],
    hostExecutablePath: executablePath,
    appDataDirectory,
    chromeUserDataDirectory,
    platform: 'darwin',
    now: '2026-08-03T08:00:00.000Z',
  });
  assert.deepEqual(result.allowedOrigins, [INVENTED_ORIGIN]);

  const nativeManifest = JSON.parse(await readFile(
    path.join(chromeUserDataDirectory, 'NativeMessagingHosts', NATIVE_HOST_MANIFEST_FILENAME),
    'utf8',
  ));
  assert.deepEqual(nativeManifest.allowed_origins, [INVENTED_ORIGIN]);
  assert.equal(nativeManifest.path, await realpath(executablePath));
  assert.equal(JSON.stringify(nativeManifest).includes('*'), false);

  const runtimeConfig = JSON.parse(await readFile(
    path.join(appDataDirectory, NATIVE_HOST_CONFIG_FILENAME),
    'utf8',
  ));
  assert.deepEqual(runtimeConfig.allowedOrigins, [INVENTED_ORIGIN]);
  assert.equal(JSON.stringify(runtimeConfig).includes('archive'), false);
  assert.equal(
    await assertAllowedCaller({ appDataDirectory, argumentsList: [INVENTED_ORIGIN] }),
    INVENTED_ORIGIN,
  );
  await assert.rejects(
    assertAllowedCaller({
      appDataDirectory,
      argumentsList: [`chrome-extension://${'b'.repeat(32)}/`],
    }),
    (error) => error.code === NATIVE_ERROR_CODES.CALLER_NOT_ALLOWED,
  );
});

test('registration rejects missing, wildcard, malformed, and non-executable identities or helpers', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'grasppy-capture-registration-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executablePath = path.join(root, 'not-executable');
  await writeFile(executablePath, 'invented');

  await assert.rejects(
    registerMacNativeHost({
      extensionIds: [],
      hostExecutablePath: executablePath,
      appDataDirectory: path.join(root, 'app-data'),
      chromeUserDataDirectory: path.join(root, 'chrome'),
      platform: 'darwin',
    }),
    (error) => error.code === NATIVE_ERROR_CODES.INVALID_REQUEST,
  );
  await assert.rejects(
    registerMacNativeHost({
      extensionIds: ['*'],
      hostExecutablePath: executablePath,
      appDataDirectory: path.join(root, 'app-data'),
      chromeUserDataDirectory: path.join(root, 'chrome'),
      platform: 'darwin',
    }),
    (error) => error.code === NATIVE_ERROR_CODES.INVALID_REQUEST,
  );
  await assert.rejects(
    registerMacNativeHost({
      extensionIds: [INVENTED_EXTENSION_ID],
      hostExecutablePath: executablePath,
      appDataDirectory: path.join(root, 'app-data'),
      chromeUserDataDirectory: path.join(root, 'chrome'),
      platform: 'darwin',
    }),
    (error) => error.code === NATIVE_ERROR_CODES.INVALID_REQUEST,
  );
});
