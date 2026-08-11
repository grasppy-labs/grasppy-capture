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
  NATIVE_HOST_NAME,
  WINDOWS_BROWSER_HIVES,
  assertAllowedCaller,
  registerMacNativeHost,
  registerNativeHost,
  registerWindowsNativeHost,
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

// ── Windows registration ─────────────────────────────────────────────────────
// These run on any OS. registerWindowsNativeHost takes an injectable
// writeRegistryValue, so the Windows path is exercised for real on a Mac —
// which matters because its one dangerous failure (an extension ID missing
// from allowed_origins) reports "not installed" and nothing more.

test('windows registration writes one manifest and points every browser hive at it', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'grasppy-capture-win-registration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executablePath = path.join(root, 'invented-native-host');
  const appDataDirectory = path.join(root, 'app-data');
  await writeFile(executablePath, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await chmod(executablePath, 0o700);

  const written = [];
  const result = await registerWindowsNativeHost({
    extensionIds: [INVENTED_EXTENSION_ID, INVENTED_EXTENSION_ID],
    hostExecutablePath: executablePath,
    appDataDirectory,
    writeRegistryValue: async (keyPath, manifestPath) => { written.push({ keyPath, manifestPath }); },
    now: '2026-08-11T08:00:00.000Z',
  });

  // Duplicates collapse, exactly as on macOS.
  assert.deepEqual(result.allowedOrigins, [INVENTED_ORIGIN]);

  // Chrome AND Edge, both pointed at the same single manifest file.
  assert.equal(written.length, WINDOWS_BROWSER_HIVES.length);
  assert.deepEqual(written.map((w) => w.keyPath), WINDOWS_BROWSER_HIVES.map((h) => `${h}\\${NATIVE_HOST_NAME}`));
  for (const w of written) assert.equal(w.manifestPath, result.manifestPath);

  // The manifest lives beside the app data, NOT in a browser directory —
  // that is the whole difference from macOS.
  assert.equal(path.basename(result.manifestPath), NATIVE_HOST_MANIFEST_FILENAME);
  const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
  assert.equal(manifest.name, NATIVE_HOST_NAME);
  assert.equal(manifest.type, 'stdio');
  assert.deepEqual(manifest.allowed_origins, [INVENTED_ORIGIN]);
  assert.equal(manifest.path, await realpath(executablePath));

  // The private runtime config is written the same way on both platforms.
  const config = JSON.parse(await readFile(path.join(appDataDirectory, NATIVE_HOST_CONFIG_FILENAME), 'utf8'));
  assert.deepEqual(config.allowedOrigins, [INVENTED_ORIGIN]);
});

test('windows registration refuses an extension id that is not exactly 32 chars', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'grasppy-capture-win-registration-bad-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executablePath = path.join(root, 'invented-native-host');
  await writeFile(executablePath, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await chmod(executablePath, 0o700);

  await assert.rejects(
    registerWindowsNativeHost({
      extensionIds: ['too-short'],
      hostExecutablePath: executablePath,
      appDataDirectory: path.join(root, 'app-data'),
      writeRegistryValue: async () => {},
    }),
    (error) => error.code === NATIVE_ERROR_CODES.INVALID_REQUEST,
  );
});

test('registerNativeHost dispatches on platform', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'grasppy-capture-dispatch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executablePath = path.join(root, 'invented-native-host');
  await writeFile(executablePath, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await chmod(executablePath, 0o700);

  const written = [];
  const win = await registerNativeHost({
    platform: 'win32',
    extensionIds: [INVENTED_EXTENSION_ID],
    hostExecutablePath: executablePath,
    appDataDirectory: path.join(root, 'win-data'),
    writeRegistryValue: async (keyPath) => { written.push(keyPath); },
  });
  assert.equal(written.length, WINDOWS_BROWSER_HIVES.length);
  assert.ok(win.hives);

  const mac = await registerNativeHost({
    platform: 'darwin',
    extensionIds: [INVENTED_EXTENSION_ID],
    hostExecutablePath: executablePath,
    appDataDirectory: path.join(root, 'mac-data'),
    chromeUserDataDirectory: path.join(root, 'chrome'),
  });
  // macOS returns no hives — the file's location IS the registration.
  assert.equal(mac.hives, undefined);
});
