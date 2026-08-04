// Purpose: Verifies the packaged renderer and Electron window retain the approved least-privilege security settings.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIRECTORY = path.resolve(TEST_DIRECTORY, '..');

test('BrowserWindow explicitly isolates and sandboxes the renderer without remote loading', async () => {
  const mainSource = await readFile(path.join(DESKTOP_DIRECTORY, 'src/main/main.js'), 'utf8');
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.match(mainSource, /sandbox:\s*true/);
  assert.match(mainSource, /webSecurity:\s*true/);
  assert.match(mainSource, /allowRunningInsecureContent:\s*false/);
  assert.match(mainSource, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.equal(mainSource.includes('.loadURL('), false);
  assert.match(mainSource, /loadFile\(RENDERER_PATH\)\.catch/);
  assert.equal(mainSource.includes("console.error('GRASPPY Capture failed to start.', error)"), false);
});

test('renderer CSP blocks network connections, frames, objects, and non-local scripts', async () => {
  const html = await readFile(path.join(DESKTOP_DIRECTORY, 'renderer/index.html'), 'utf8');
  assert.match(html, /default-src 'self'/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /frame-src 'none'/);
  assert.equal(/https?:\/\//.test(html), false);
});

test('preload exposes intent methods rather than Electron primitives or generic IPC', async () => {
  const preload = await readFile(path.join(DESKTOP_DIRECTORY, 'src/preload/preload.cjs'), 'utf8');
  assert.match(preload, /contextBridge\.exposeInMainWorld\('captureDesktop'/);
  assert.equal(preload.includes("exposeInMainWorld('ipcRenderer'"), false);
  assert.equal(preload.includes('sendSync'), false);
  assert.equal(preload.includes('webFrame'), false);
  assert.equal(preload.includes('shell'), false);
});
