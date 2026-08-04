// Purpose: Starts the hardened local Electron window and owns all approved filesystem and provider operations.

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  registerMacNativeHost,
  runNativeMessagingHost,
} from '../../../native-host/src/index.js';
import { parseRuntimeMode } from '../../../native-host/src/runtime-mode.js';
import { toPublicError } from '../../../../packages/capture-core/src/index.js';
import { createCaptureAppService } from './app-service.js';
import { checkForUpdate, releasesPageUrl } from './update-check.js';
import {
  validateExclusionRequest,
  validateNoArguments,
  validateSessionRequest,
} from './ipc-validation.js';

const MAIN_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_PATH = path.resolve(MAIN_DIRECTORY, '../../dist/renderer/index.html');
const PRELOAD_PATH = path.resolve(MAIN_DIRECTORY, '../preload/preload.cjs');
const RENDERER_URL = pathToFileURL(RENDERER_PATH).href;
const PROGRESS_CHANNEL = 'capture:progress';
const RUNTIME_MODE = parseRuntimeMode(process.argv);
const SAFE_OPERATION_MESSAGES = new Set([
  'Choose an archive parent folder first.',
  'The archive folder could not be opened.',
  'The archived Markdown file could not be opened.',
  'Untrusted desktop request sender.',
]);
let mainWindow = null;
let pendingSetupParent = null;

function publicFailure(error) {
  const failure = toPublicError(error);
  if (failure.code === 'INVALID_INPUT' && !error?.code) {
    return Object.freeze({
      success: false,
      code: 'DESKTOP_OPERATION_FAILED',
      error: typeof error?.message === 'string' && SAFE_OPERATION_MESSAGES.has(error.message)
        ? error.message
        : 'The desktop operation could not be completed safely.',
    });
  }
  return failure;
}

function assertTrustedSender(event) {
  const isMainFrame = event.senderFrame === mainWindow?.webContents.mainFrame;
  if (!isMainFrame || event.senderFrame?.url !== RENDERER_URL) {
    throw new Error('Untrusted desktop request sender.');
  }
}

function registerHandler(channel, validate, operation) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      assertTrustedSender(event);
      const input = validate(args);
      return Object.freeze({ success: true, data: await operation(input) });
    } catch (error) {
      return publicFailure(error);
    }
  });
}

function sendProgress(phase, message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(PROGRESS_CHANNEL, Object.freeze({ phase, message }));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 1020,
    minWidth: 760,
    minHeight: 600,
    show: false,
    title: 'GRASPPY Capture',
    backgroundColor: '#f1f5f9',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== RENDERER_URL) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  void mainWindow.loadFile(RENDERER_PATH).catch(() => {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      operation: 'renderer-load',
      message: 'The local renderer could not be loaded.',
    }));
    app.quit();
  });
}

async function startDesktopApplication() {
  await app.whenReady();
  const service = createCaptureAppService({ appDataDirectory: app.getPath('userData') });

  registerHandler('capture:get-status', validateNoArguments, () => service.getStatus());
  registerHandler('capture:select-archive', validateNoArguments, async () => {
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose where GRASPPY Capture Archive will be created',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (selection.canceled || selection.filePaths.length !== 1) {
      pendingSetupParent = null;
      return Object.freeze({ selected: false });
    }
    pendingSetupParent = selection.filePaths[0];
    return Object.freeze({ selected: true, displayPath: pendingSetupParent });
  });
  registerHandler('capture:complete-setup', validateNoArguments, async () => {
    if (!pendingSetupParent) throw new Error('Choose an archive parent folder first.');
    const status = await service.setup(pendingSetupParent);
    pendingSetupParent = null;
    return status;
  });
  registerHandler('capture:catalog', validateNoArguments, async () => {
    sendProgress('cataloging', 'Checking known local provider folders…');
    const result = await service.refreshCatalog();
    sendProgress('ready', 'Local provider catalog is ready.');
    return result;
  });
  registerHandler('capture:sync', validateNoArguments, async () => {
    sendProgress('syncing', 'Updating the local Markdown archive…');
    const result = await service.syncArchive();
    sendProgress(
      result.run.status === 'success' ? 'success' : 'warning',
      result.run.status === 'success' ? 'Sync complete.' : 'Sync completed with warnings.',
    );
    return result;
  });
  registerHandler(
    'capture:set-exclusion',
    ([value]) => validateExclusionRequest(value),
    ({ sessionKey, excluded }) => service.setExclusion(sessionKey, excluded),
  );
  // Opens the hosted user guide in the default browser. The URL is a constant —
  // never derived from renderer input — so this stays a fixed, auditable jump.
  registerHandler('capture:open-guide', validateNoArguments, async () => {
    await shell.openExternal('https://grasppy.com/capture/guide');
    return Object.freeze({ opened: true });
  });
  // Runs only when the user picks "Check for Updates…". The result is shown in a
  // native dialog so the download stays an explicit choice; the app never installs
  // anything itself, and the browser is only ever sent to the constant release URL.
  registerHandler('capture:check-for-updates', validateNoArguments, async () => {
    const result = await checkForUpdate(app.getVersion());
    if (result.status === 'update-available') {
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['Download…', 'Not Now'],
        defaultId: 0,
        cancelId: 1,
        message: `Version ${result.latestVersion} is available.`,
        detail: `You are running ${result.currentVersion}. The download opens in your browser — open the file and drag GRASPPY Capture to Applications to update.`,
      });
      if (choice.response === 0) await shell.openExternal(releasesPageUrl());
      return Object.freeze({ ...result, opened: choice.response === 0 });
    }
    await dialog.showMessageBox(mainWindow, {
      type: result.status === 'up-to-date' ? 'info' : 'warning',
      buttons: ['OK'],
      message: result.status === 'up-to-date'
        ? `GRASPPY Capture ${result.currentVersion} is up to date.`
        : 'Update check unavailable',
      detail: result.status === 'up-to-date'
        ? 'You are running the newest published version.'
        : result.status === 'not-configured'
          ? 'This build has no release channel configured yet.'
          : `${result.reason} Your archive is unaffected.`,
    });
    return result;
  });
  registerHandler('capture:open-archive', validateNoArguments, async () => {
    const errorMessage = await shell.openPath(await service.getArchiveDirectoryPath());
    if (errorMessage) throw new Error('The archive folder could not be opened.');
    return Object.freeze({ opened: true });
  });
  registerHandler(
    'capture:open-session',
    ([value]) => validateSessionRequest(value),
    async (sessionKey) => {
      const errorMessage = await shell.openPath(await service.getArchivedSessionPath(sessionKey));
      if (errorMessage) throw new Error('The archived Markdown file could not be opened.');
      return Object.freeze({ opened: true });
    },
  );

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

async function startNativeHost() {
  await app.whenReady();
  app.dock?.hide();
  await runNativeMessagingHost({
    appDataDirectory: app.getPath('userData'),
    argumentsList: process.argv,
    input: process.stdin,
    output: process.stdout,
  });
  app.exit(0);
}

async function registerNativeHost() {
  await app.whenReady();
  app.dock?.hide();
  if (!app.isPackaged) throw new Error('Native-host registration requires the packaged application.');
  const result = await registerMacNativeHost({
    extensionIds: RUNTIME_MODE.extensionIds,
    hostExecutablePath: path.join(
      process.resourcesPath,
      'native-host',
      'grasppy-capture-native-host',
    ),
    appDataDirectory: app.getPath('userData'),
  });
  process.stdout.write(`${JSON.stringify({
    success: true,
    hostName: result.hostName,
    allowedOrigins: result.allowedOrigins,
  })}\n`);
  app.exit(0);
}

async function startRuntime() {
  if (RUNTIME_MODE.mode === 'native-host') return startNativeHost();
  if (RUNTIME_MODE.mode === 'register-native-host') return registerNativeHost();
  return startDesktopApplication();
}

void startRuntime().catch(() => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    operation: RUNTIME_MODE.mode,
    message: 'GRASPPY Capture could not start safely.',
  }));
  app.exit(1);
});
