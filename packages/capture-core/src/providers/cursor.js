// Purpose: Discovers and normalizes verified Cursor agent-transcript JSONL layouts read-only.

import os from 'node:os';
import path from 'node:path';

import { createNormalizedSession } from '../contracts/normalized-session.js';
import {
  PROVIDERS,
  createSessionKey,
  getShortSessionId,
  normalizeFullSessionId,
} from '../contracts/identity.js';
import { CaptureError, ERROR_CODES } from '../errors.js';
import { scanJsonlFile } from './jsonl.js';
import {
  UUID_PATTERN,
  deriveTitleFromEvents,
  inspectDirectory,
  inspectRegularFile,
  normalizeMessageEvents,
  sortSessionsByActivity,
} from './shared.js';

function inspectCursorRecord(record, state) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    state.observations.add('Ignored a non-object Cursor JSONL record.');
    return;
  }
  if (record.role === 'user' || record.role === 'assistant') {
    state.recognizedRecords += 1;
    state.roleCounts[record.role] += 1;
    return;
  }
  if (typeof record.type === 'string') {
    state.recognizedRecords += 1;
    state.lifecycleTypes.add(record.type);
    return;
  }
  state.observations.add('Observed an unknown Cursor record shape.');
}

async function inspectCursorTranscript({ filePath, fullSessionId, projectKey }) {
  const fileStat = await inspectRegularFile(filePath);
  if (!fileStat) return null;

  const state = {
    observations: new Set(),
    recognizedRecords: 0,
    roleCounts: { user: 0, assistant: 0 },
    lifecycleTypes: new Set(),
  };
  const scan = await scanJsonlFile(filePath, {
    onRecord: async (record) => {
      inspectCursorRecord(record, state);
      return true;
    },
  });
  scan.observations.forEach((observation) => state.observations.add(observation));

  const warnings = [];
  if (scan.malformedRecords > 0) warnings.push('Malformed non-final JSONL records were ignored.');
  if (scan.trailingFragment) warnings.push('The Cursor transcript ended with an incomplete trailing record.');
  if (state.recognizedRecords === 0) warnings.push('No recognized Cursor records were found.');
  if (state.roleCounts.user > 0 && state.roleCounts.assistant === 0) {
    warnings.push('The locally available Cursor transcript has user messages but no assistant messages.');
  }

  return {
    provider: PROVIDERS.CURSOR,
    fullSessionId,
    shortSessionId: getShortSessionId(fullSessionId),
    sessionKey: createSessionKey(PROVIDERS.CURSOR, fullSessionId),
    sourcePath: filePath,
    providerProjectKey: projectKey,
    workspacePath: null,
    storageState: 'active',
    sourceStat: {
      mtimeMs: fileStat.mtimeMs,
      sizeBytes: fileStat.size,
      birthtimeMs: fileStat.birthtimeMs,
    },
    sourceFormat: 'Cursor agent transcript JSONL',
    sourceSchemaVersion: 'observed-jsonl-v1',
    title: {
      value: projectKey || `Cursor session ${getShortSessionId(fullSessionId)}`,
      source: projectKey ? 'Cursor physical project slug' : 'session identity fallback',
    },
    activity: {
      timestamp: fileStat.mtime.toISOString(),
      source: 'filesystem mtime fallback',
      confidence: 'low',
    },
    completeness: { isComplete: warnings.length === 0, warnings },
    observations: [...state.observations],
    metadata: {
      metadataStatus: 'not-requested',
      roleCounts: state.roleCounts,
      lifecycleTypes: [...state.lifecycleTypes],
    },
  };
}

export function getCursorDefaultRoots({ homeDirectory = os.homedir(), cursorProjectsRoot } = {}) {
  return Object.freeze({
    projectsRoot: cursorProjectsRoot ?? path.join(homeDirectory, '.cursor', 'projects'),
  });
}

export async function discoverCursorSessions(options = {}) {
  const roots = getCursorDefaultRoots(options);
  const projectsDirectory = await inspectDirectory(roots.projectsRoot);
  if (projectsDirectory.status !== 'ready') {
    return { provider: PROVIDERS.CURSOR, status: projectsDirectory.status, roots, sessions: [], observations: [] };
  }

  const sessions = [];
  const observations = [];
  for (const projectEntry of projectsDirectory.entries) {
    if (!projectEntry.isDirectory() || projectEntry.isSymbolicLink()) continue;
    const transcriptsPath = path.join(roots.projectsRoot, projectEntry.name, 'agent-transcripts');
    const transcriptsDirectory = await inspectDirectory(transcriptsPath);
    if (transcriptsDirectory.status !== 'ready') continue;

    for (const sessionEntry of transcriptsDirectory.entries) {
      if (!sessionEntry.isDirectory() || sessionEntry.isSymbolicLink() || !UUID_PATTERN.test(sessionEntry.name)) {
        continue;
      }
      const fullSessionId = normalizeFullSessionId(sessionEntry.name);
      const filePath = path.join(transcriptsPath, sessionEntry.name, `${fullSessionId}.jsonl`);
      const candidate = await inspectCursorTranscript({
        filePath,
        fullSessionId,
        projectKey: projectEntry.name,
      });
      if (candidate) sessions.push(candidate);
      else observations.push(`Ignored Cursor identity mismatch or missing file for ${getShortSessionId(fullSessionId)}.`);
    }
  }

  return {
    provider: PROVIDERS.CURSOR,
    status: 'ready',
    roots,
    sessions: sortSessionsByActivity(sessions),
    observations,
  };
}

function createCursorLifecycleEvent(record) {
  const status = typeof record.status === 'string' ? `: ${record.status}` : '';
  return {
    type: 'lifecycle',
    content: `${record.type}${status}`,
    timestamp: null,
    metadata: { hasError: Boolean(record.error) },
  };
}

export async function normalizeCursorSession(candidate) {
  if (candidate?.provider !== PROVIDERS.CURSOR) {
    throw new CaptureError(ERROR_CODES.INVALID_INPUT, 'Cursor normalization candidate is invalid.');
  }

  const events = [];
  const observations = new Set(candidate.observations ?? []);
  let userMessages = 0;
  let assistantMessages = 0;
  const scan = await scanJsonlFile(candidate.sourcePath, {
    onRecord: async (record) => {
      if (record?.role === 'user' || record?.role === 'assistant') {
        if (record.role === 'user') userMessages += 1;
        else assistantMessages += 1;
        events.push(...normalizeMessageEvents(record.role, record.message, null, observations));
      } else if (typeof record?.type === 'string') {
        events.push(createCursorLifecycleEvent(record));
      } else {
        observations.add('Observed an unknown Cursor record shape.');
      }
      return true;
    },
  });
  scan.observations.forEach((observation) => observations.add(observation));

  const candidateFallback = candidate.title.source === 'Cursor physical project slug'
    ? candidate.title.value
    : `Cursor session ${candidate.shortSessionId}`;
  const derivedTitle = deriveTitleFromEvents(events, candidateFallback);
  const title = derivedTitle.source === 'first meaningful user text'
    ? derivedTitle
    : candidate.title;
  const warnings = [...candidate.completeness.warnings];
  if (userMessages > 0 && assistantMessages === 0
    && !warnings.includes('The locally available Cursor transcript has user messages but no assistant messages.')) {
    warnings.push('The locally available Cursor transcript has user messages but no assistant messages.');
  }
  if (events.length === 0 && !warnings.includes('No recognized Cursor records were found.')) {
    warnings.push('No recognized Cursor records were found.');
  }

  return createNormalizedSession({
    provider: candidate.provider,
    fullSessionId: candidate.fullSessionId,
    source: {
      path: candidate.sourcePath,
      providerProjectKey: candidate.providerProjectKey,
      workspacePath: candidate.workspacePath,
      format: candidate.sourceFormat,
      schemaVersion: candidate.sourceSchemaVersion,
      observations: [...observations],
    },
    title,
    activity: candidate.activity,
    events,
    completeness: { isComplete: warnings.length === 0, warnings },
  });
}

export const cursorAdapter = Object.freeze({
  provider: PROVIDERS.CURSOR,
  getDefaultRoots: getCursorDefaultRoots,
  discoverSessions: discoverCursorSessions,
  normalizeSession: normalizeCursorSession,
});
