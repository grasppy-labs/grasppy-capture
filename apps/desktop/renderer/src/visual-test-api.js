// Purpose: Supplies static invented desktop responses only to the unbundled visual-verification page.

const SESSION_KEYS = [
  'codex:00000000-0000-4000-8000-000000000001',
  'claude-code:00000000-0000-4000-8000-000000000002',
  'cursor:00000000-0000-4000-8000-000000000003',
  'codex:00000000-0000-4000-8000-000000000004',
  'claude-code:00000000-0000-4000-8000-000000000005',
  'cursor:00000000-0000-4000-8000-000000000006',
];
const NOW = '2026-07-31T23:42:00.000Z';
const visualState = new URLSearchParams(window.location.search).get('state');
const setupMode = visualState === 'setup';
const warningMode = visualState === 'warning';
const syncingMode = visualState === 'syncing';
const listeners = new Set();
let configured = !setupMode;
let selected = false;
let items = [
  { sessionKey: SESSION_KEYS[0], provider: 'codex', providerName: 'Codex', title: 'Portfolio notes', activityAt: '2026-07-31T23:30:00.000Z', syncState: 'pending', status: 'new', excluded: false, sizeBytes: null, processedAt: null, canOpen: false },
  { sessionKey: SESSION_KEYS[1], provider: 'claude-code', providerName: 'Claude Code', title: 'API prototype', activityAt: '2026-07-30T18:00:00.000Z', syncState: 'pending', status: 'changed', excluded: false, sizeBytes: 1_677_721, processedAt: '2026-07-28T16:16:00.000Z', canOpen: false },
  { sessionKey: SESSION_KEYS[2], provider: 'cursor', providerName: 'Cursor', title: 'Garden planner', activityAt: '2026-07-25T15:00:00.000Z', syncState: 'pending', status: 'incomplete', excluded: false, sizeBytes: null, processedAt: null, canOpen: false },
  { sessionKey: SESSION_KEYS[3], provider: 'codex', providerName: 'Codex', title: 'CLI ideas', activityAt: '2026-07-21T18:05:00.000Z', syncState: 'synced', status: 'synced', excluded: false, sizeBytes: 1_153_433, processedAt: '2026-07-21T18:05:00.000Z', canOpen: true },
  { sessionKey: SESSION_KEYS[4], provider: 'claude-code', providerName: 'Claude Code', title: 'Reading list organizer', activityAt: '2026-07-28T16:16:00.000Z', syncState: 'synced', status: 'synced', excluded: false, sizeBytes: 655_360, processedAt: '2026-07-28T16:16:00.000Z', canOpen: true },
  { sessionKey: SESSION_KEYS[5], provider: 'cursor', providerName: 'Cursor', title: 'Kitchen inventory', activityAt: '2026-07-10T18:34:00.000Z', syncState: 'synced', status: 'synced', excluded: false, sizeBytes: 804_864, processedAt: '2026-07-10T18:34:00.000Z', canOpen: true },
];
// Mirror the main process, which derives the short id from the full session id.
items = items.map((item) => ({ ...item, shortSessionId: item.sessionKey.split(':')[1].slice(0, 8) }));
if (warningMode) {
  items = items.map((item) => item.sessionKey === SESSION_KEYS[2]
    ? { ...item, status: 'permission-needed' }
    : item);
}

function success(data) {
  return Promise.resolve({ success: true, data });
}

function catalog() {
  const pending = items.filter((item) => item.syncState === 'pending').length;
  const synced = items.filter((item) => item.syncState === 'synced').length;
  return {
    providers: [
      { provider: 'claude-code', name: 'Claude Code', status: 'ready', count: 62, observations: [] },
      { provider: 'codex', name: 'Codex', status: 'ready', count: 58, observations: [] },
      {
        provider: 'cursor',
        name: 'Cursor',
        status: warningMode ? 'permission-needed' : 'unsupported-schema',
        count: 28,
        observations: [warningMode ? 'Permission is needed before this source can be read.' : 'Some titles use safe fallbacks.'],
      },
    ],
    counts: { pending, synced, all: items.length },
    items,
  };
}

const run = {
  runId: 'invented-run', startedAt: NOW, completedAt: NOW, status: warningMode ? 'partial' : 'success', providers: ['claude-code', 'codex', 'cursor'], filesChecked: 18, bytesWritten: 9_856_614,
  results: { created: 5, replaced: 7, unchanged: warningMode ? 5 : 6, unavailable: 0, excluded: 0, skipped: 0, failed: warningMode ? 1 : 0 },
};
const dashboard = {
  lastSync: run,
  currentArchive: { fileCount: 148, sizeBytes: 88_709_529, invalidFiles: 0 },
  providers: [
    { provider: 'claude-code', fileCount: 62, sizeBytes: 37_958_451 },
    { provider: 'codex', fileCount: 58, sizeBytes: 34_393_293 },
    { provider: 'cursor', fileCount: 28, sizeBytes: 16_357_785 },
  ],
  calendar: [
    { date: '2026-07-10', completedRuns: 1, filesProcessed: 12, bytesWritten: 3_774_873, providerCount: 3 },
    { date: '2026-07-21', completedRuns: 1, filesProcessed: 22, bytesWritten: 12_687_769, providerCount: 3 },
    { date: '2026-07-28', completedRuns: 1, filesProcessed: 14, bytesWritten: 5_033_165, providerCount: 3 },
    { date: '2026-07-31', completedRuns: 1, filesProcessed: 18, bytesWritten: 9_856_614, providerCount: 3 },
  ],
  sessionCalendars: {
    synced: [
      { date: '2026-07-21', count: 2, entries: [{ provider: 'codex', shortId: '0198aa01', label: 'CLI ideas' }, { provider: 'cursor', shortId: '0198aa02', label: 'Kitchen inventory' }] },
      { date: '2026-07-28', count: 1, entries: [{ provider: 'claude-code', shortId: '0198aa03', label: 'Reading list organizer' }] },
    ],
    activity: [
      { date: '2026-07-25', count: 1, entries: [{ provider: 'cursor', shortId: '0198aa04', label: 'Garden planner' }] },
      { date: '2026-07-30', count: 3, entries: [{ provider: 'claude-code', shortId: '0198aa05', label: 'API prototype' }, { provider: 'codex', shortId: '0198aa01', label: 'CLI ideas' }, { provider: 'cursor', shortId: '0198aa02', label: 'Kitchen inventory' }] },
    ],
  },
  recentRuns: [run],
};

window.captureDesktop = Object.freeze({
  getArchiveStatus: () => success(configured ? { configured: true, archivePath: 'Documents › GRASPPY Capture Archive', dashboard } : { configured: false }),
  selectArchiveDirectory: () => { selected = true; return success({ selected: true, displayPath: 'Documents' }); },
  completeSetup: () => { configured = selected; return success({ configured, archivePath: 'Documents › GRASPPY Capture Archive', dashboard }); },
  checkForUpdates: () => success({ status: 'up-to-date', currentVersion: '0.1.0' }),
  openUserGuide: () => success({ opened: true }),
  catalogProviders: () => success({ catalog: catalog(), dashboard }),
  syncArchive: async () => {
    if (syncingMode) {
      listeners.forEach((callback) => callback({ phase: 'syncing', message: 'Creating local Markdown copies…' }));
      await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    }
    return success({
      run,
      failures: warningMode ? [{ code: 'PERMISSION_NEEDED' }] : [],
      catalog: catalog(),
      dashboard,
    });
  },
  setSessionExclusion: (sessionKey, excluded) => {
    items = items.map((item) => item.sessionKey === sessionKey ? { ...item, excluded } : item);
    return success({ saved: true, catalog: catalog() });
  },
  openArchiveDirectory: () => success({ opened: true }),
  openArchivedSession: () => success({ opened: true }),
  subscribeToProgress: (callback) => { listeners.add(callback); return () => listeners.delete(callback); },
});
