// Purpose: Registers one exact-origin macOS Chrome native host and validates runtime caller configuration.

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { NativeHostError, NATIVE_ERROR_CODES } from './errors.js';

export const NATIVE_HOST_NAME = 'com.grasppy.capture';
export const NATIVE_HOST_CONFIG_FILENAME = 'capture-native-host-config.json';
export const NATIVE_HOST_MANIFEST_FILENAME = `${NATIVE_HOST_NAME}.json`;

const CONFIG_FIELDS = new Set(['schemaVersion', 'hostName', 'allowedOrigins', 'registeredAt']);
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}\/$/;

function registrationError(code, message, cause) {
  return new NativeHostError(code, message, cause ? { cause } : undefined);
}

export function extensionOrigin(extensionId) {
  if (typeof extensionId !== 'string' || !EXTENSION_ID_PATTERN.test(extensionId)) {
    throw registrationError(
      NATIVE_ERROR_CODES.INVALID_REQUEST,
      'A fixed 32-character Chrome extension identity is required.',
    );
  }
  return `chrome-extension://${extensionId}/`;
}

function normalizeOrigins(extensionIds) {
  if (!Array.isArray(extensionIds) || extensionIds.length === 0) {
    throw registrationError(
      NATIVE_ERROR_CODES.INVALID_REQUEST,
      'At least one fixed Chrome extension identity is required.',
    );
  }
  const origins = [...new Set(extensionIds.map(extensionOrigin))].sort();
  if (origins.some((origin) => origin.includes('*'))) {
    throw registrationError(NATIVE_ERROR_CODES.INVALID_REQUEST, 'Wildcard extension origins are prohibited.');
  }
  return Object.freeze(origins);
}

async function resolveRealDirectory(directoryPath, message) {
  if (typeof directoryPath !== 'string' || !path.isAbsolute(directoryPath)) {
    throw registrationError(NATIVE_ERROR_CODES.ARCHIVE_UNAVAILABLE, message);
  }
  try {
    await mkdir(directoryPath, { recursive: true, mode: 0o700 });
    const directoryStat = await lstat(directoryPath);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw registrationError(NATIVE_ERROR_CODES.ARCHIVE_UNAVAILABLE, message);
    }
    return await realpath(directoryPath);
  } catch (error) {
    if (error instanceof NativeHostError) throw error;
    throw registrationError(NATIVE_ERROR_CODES.ARCHIVE_UNAVAILABLE, message, error);
  }
}

async function validateHostExecutable(hostExecutablePath) {
  if (typeof hostExecutablePath !== 'string' || !path.isAbsolute(hostExecutablePath)) {
    throw registrationError(NATIVE_ERROR_CODES.INVALID_REQUEST, 'The packaged native helper is invalid.');
  }
  try {
    const executableStat = await lstat(hostExecutablePath);
    if (!executableStat.isFile()
      || executableStat.isSymbolicLink()
      || (executableStat.mode & 0o111) === 0) {
      throw registrationError(NATIVE_ERROR_CODES.INVALID_REQUEST, 'The packaged native helper is invalid.');
    }
    return await realpath(hostExecutablePath);
  } catch (error) {
    if (error instanceof NativeHostError) throw error;
    throw registrationError(NATIVE_ERROR_CODES.INVALID_REQUEST, 'The packaged native helper is invalid.', error);
  }
}

async function removeTemporaryFile(temporaryPath) {
  try {
    await unlink(temporaryPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function writeAtomicJson(directoryPath, filename, value) {
  const outputPath = path.join(directoryPath, filename);
  try {
    const existingStat = await lstat(outputPath);
    if (!existingStat.isFile() || existingStat.isSymbolicLink()) {
      throw registrationError(NATIVE_ERROR_CODES.ARCHIVE_UNAVAILABLE, 'Native-host registration is unsafe.');
    }
  } catch (error) {
    if (error instanceof NativeHostError) throw error;
    if (error?.code !== 'ENOENT') {
      throw registrationError(NATIVE_ERROR_CODES.ARCHIVE_UNAVAILABLE, 'Native-host registration is unavailable.', error);
    }
  }
  const temporaryPath = path.join(directoryPath, `.capture-registration-${randomUUID()}.tmp`);
  let shouldCleanup = true;
  try {
    const fileHandle = await open(temporaryPath, 'wx', 0o600);
    try {
      await fileHandle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }
    JSON.parse(await readFile(temporaryPath, 'utf8'));
    await rename(temporaryPath, outputPath);
    shouldCleanup = false;
    return outputPath;
  } catch (error) {
    if (error instanceof NativeHostError) throw error;
    throw registrationError(NATIVE_ERROR_CODES.ARCHIVE_UNAVAILABLE, 'Native-host registration could not be saved safely.', error);
  } finally {
    if (shouldCleanup) await removeTemporaryFile(temporaryPath);
  }
}

export function buildNativeHostManifest({ hostExecutablePath, allowedOrigins }) {
  return Object.freeze({
    name: NATIVE_HOST_NAME,
    description: 'On-demand local Markdown delivery to GRASPPY Capture',
    path: hostExecutablePath,
    type: 'stdio',
    allowed_origins: Object.freeze([...allowedOrigins]),
  });
}

// Browsers that read Chromium-style native-messaging registrations on Windows.
// Each has its own registry hive; the manifest file itself is identical, so one
// file is written and every hive points at it.
export const WINDOWS_BROWSER_HIVES = Object.freeze([
  'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
  'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
]);

/**
 * Windows registration.
 *
 * macOS registers by PLACING a file in a well-known directory. Windows registers
 * by pointing a REGISTRY KEY at a file that may live anywhere — so the manifest
 * goes next to the app's own data and the hives reference it by absolute path.
 *
 * `writeRegistryValue` is injectable so this whole path can be exercised on a
 * non-Windows machine: the default shells out to reg.exe, tests pass a recorder.
 * That matters because the failure this code exists to prevent — an extension ID
 * missing from allowed_origins — reports "not installed" and nothing else.
 */
export async function registerWindowsNativeHost({
  extensionIds,
  hostExecutablePath,
  appDataDirectory,
  hives = WINDOWS_BROWSER_HIVES,
  writeRegistryValue = defaultWriteRegistryValue,
  now = new Date().toISOString(),
}) {
  const allowedOrigins = normalizeOrigins(extensionIds);
  const canonicalExecutable = await validateHostExecutable(hostExecutablePath);
  const canonicalAppData = await resolveRealDirectory(appDataDirectory, 'Capture application data is unavailable.');
  const registeredAt = new Date(now).toISOString();
  const runtimeConfig = {
    schemaVersion: 1,
    hostName: NATIVE_HOST_NAME,
    allowedOrigins: [...allowedOrigins],
    registeredAt,
  };
  const nativeManifest = buildNativeHostManifest({
    hostExecutablePath: canonicalExecutable,
    allowedOrigins,
  });
  await writeAtomicJson(canonicalAppData, NATIVE_HOST_CONFIG_FILENAME, runtimeConfig);
  const manifestPath = await writeAtomicJson(
    canonicalAppData,
    NATIVE_HOST_MANIFEST_FILENAME,
    nativeManifest,
  );
  const registeredHives = [];
  for (const hive of hives) {
    await writeRegistryValue(`${hive}\\${NATIVE_HOST_NAME}`, manifestPath);
    registeredHives.push(hive);
  }
  return Object.freeze({
    hostName: NATIVE_HOST_NAME,
    allowedOrigins,
    manifestPath,
    registeredAt,
    hives: Object.freeze(registeredHives),
  });
}

async function defaultWriteRegistryValue(keyPath, manifestPath) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  // Argument ARRAY, never a shell string: a Windows manifest path routinely
  // contains spaces (C:\Users\First Last\...) and must not be re-split.
  await promisify(execFile)('reg', ['add', keyPath, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f']);
}

/** Register for whichever platform we are on. The only entry point callers need. */
export async function registerNativeHost(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') return registerWindowsNativeHost(options);
  return registerMacNativeHost({ ...options, platform });
}

export async function registerMacNativeHost({
  extensionIds,
  hostExecutablePath,
  appDataDirectory,
  chromeUserDataDirectory = path.join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
  platform = process.platform,
  now = new Date().toISOString(),
}) {
  if (platform !== 'darwin') {
    throw registrationError(NATIVE_ERROR_CODES.INVALID_REQUEST, 'This native-host registration path is macOS-only.');
  }
  const allowedOrigins = normalizeOrigins(extensionIds);
  const canonicalExecutable = await validateHostExecutable(hostExecutablePath);
  const canonicalAppData = await resolveRealDirectory(appDataDirectory, 'Capture application data is unavailable.');
  const nativeHostDirectory = await resolveRealDirectory(
    path.join(chromeUserDataDirectory, 'NativeMessagingHosts'),
    'Chrome native-host registration is unavailable.',
  );
  const registeredAt = new Date(now).toISOString();
  const runtimeConfig = {
    schemaVersion: 1,
    hostName: NATIVE_HOST_NAME,
    allowedOrigins: [...allowedOrigins],
    registeredAt,
  };
  const nativeManifest = buildNativeHostManifest({
    hostExecutablePath: canonicalExecutable,
    allowedOrigins,
  });
  await writeAtomicJson(canonicalAppData, NATIVE_HOST_CONFIG_FILENAME, runtimeConfig);
  const manifestPath = await writeAtomicJson(
    nativeHostDirectory,
    NATIVE_HOST_MANIFEST_FILENAME,
    nativeManifest,
  );
  return Object.freeze({
    hostName: NATIVE_HOST_NAME,
    allowedOrigins,
    manifestPath,
    registeredAt,
  });
}

function validateRuntimeConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).length !== CONFIG_FIELDS.size
    || Object.keys(config).some((field) => !CONFIG_FIELDS.has(field))
    || config.schemaVersion !== 1
    || config.hostName !== NATIVE_HOST_NAME
    || !Array.isArray(config.allowedOrigins)
    || config.allowedOrigins.length === 0
    || config.allowedOrigins.some((origin) => typeof origin !== 'string' || !ORIGIN_PATTERN.test(origin))
    || new Set(config.allowedOrigins).size !== config.allowedOrigins.length
    || typeof config.registeredAt !== 'string'
    || !Number.isFinite(Date.parse(config.registeredAt))) {
    throw registrationError(NATIVE_ERROR_CODES.HOST_NOT_REGISTERED, 'The Capture native host is not registered safely.');
  }
  return config;
}

export async function loadNativeHostConfig(appDataDirectory) {
  if (typeof appDataDirectory !== 'string' || !path.isAbsolute(appDataDirectory)) {
    throw registrationError(NATIVE_ERROR_CODES.HOST_NOT_REGISTERED, 'The Capture native host is not registered safely.');
  }
  const configPath = path.join(appDataDirectory, NATIVE_HOST_CONFIG_FILENAME);
  try {
    const configStat = await lstat(configPath);
    if (!configStat.isFile() || configStat.isSymbolicLink()) {
      throw registrationError(NATIVE_ERROR_CODES.HOST_NOT_REGISTERED, 'The Capture native host is not registered safely.');
    }
    return Object.freeze(validateRuntimeConfig(JSON.parse(await readFile(configPath, 'utf8'))));
  } catch (error) {
    if (error instanceof NativeHostError) throw error;
    throw registrationError(NATIVE_ERROR_CODES.HOST_NOT_REGISTERED, 'The Capture native host is not registered safely.', error);
  }
}

export function callerOriginFromArguments(argumentsList) {
  if (!Array.isArray(argumentsList)) return null;
  return argumentsList.find((argument) => typeof argument === 'string' && ORIGIN_PATTERN.test(argument)) ?? null;
}

export async function assertAllowedCaller({ appDataDirectory, argumentsList }) {
  const callerOrigin = callerOriginFromArguments(argumentsList);
  if (!callerOrigin) {
    throw registrationError(NATIVE_ERROR_CODES.CALLER_NOT_ALLOWED, 'The native request caller is not allowed.');
  }
  const config = await loadNativeHostConfig(appDataDirectory);
  if (!config.allowedOrigins.includes(callerOrigin)) {
    throw registrationError(NATIVE_ERROR_CODES.CALLER_NOT_ALLOWED, 'The native request caller is not allowed.');
  }
  return callerOrigin;
}
