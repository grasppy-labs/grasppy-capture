// Purpose: Exposes a frozen intent-level desktop API without revealing Electron or Node primitives.

const { contextBridge, ipcRenderer } = require('electron');

const PROGRESS_CHANNEL = 'capture:progress';

function invoke(channel, payload) {
  return payload === undefined ? ipcRenderer.invoke(channel) : ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld('captureDesktop', Object.freeze({
  getArchiveStatus: () => invoke('capture:get-status'),
  selectArchiveDirectory: () => invoke('capture:select-archive'),
  completeSetup: () => invoke('capture:complete-setup'),
  catalogProviders: () => invoke('capture:catalog'),
  syncArchive: () => invoke('capture:sync'),
  setSessionExclusion: (sessionKey, excluded) => invoke(
    'capture:set-exclusion',
    { sessionKey, excluded },
  ),
  checkForUpdates: () => invoke('capture:check-for-updates'),
  openUserGuide: () => invoke('capture:open-guide'),
  openArchiveDirectory: () => invoke('capture:open-archive'),
  openArchivedSession: (sessionKey) => invoke('capture:open-session', { sessionKey }),
  subscribeToProgress: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Progress subscription requires a callback.');
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on(PROGRESS_CHANNEL, listener);
    return () => ipcRenderer.removeListener(PROGRESS_CHANNEL, listener);
  },
}));
