// Purpose: Discovers, reconciles, and normalizes local Codex active and archived rollout transcripts.

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
  matchKnownSource,
  newestTimestamp,
  normalizeMessageEvents,
  sortSessionsByActivity,
  toIsoTimestamp,
  walkRegularFiles,
} from './shared.js';

const CODEX_FILENAME_PATTERN = new RegExp(
  `^rollout-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-(${UUID_PATTERN.source.slice(1, -1)})\\.jsonl$`,
  'i',
);
const CODEX_KNOWN_TYPES = new Set([
  'session_meta',
  'event_msg',
  'response_item',
  'world_state',
  'turn_context',
  'compacted',
]);

function safeTitle(value) {
  if (typeof value !== 'string') return null;
  const normalizedTitle = value.replace(/\s+/g, ' ').trim();
  if (normalizedTitle === '') return null;
  return normalizedTitle.length > 96 ? `${normalizedTitle.slice(0, 93)}...` : normalizedTitle;
}

function getCodexMetaId(record) {
  if (record?.type !== 'session_meta' || !record.payload) return null;
  const identity = record.payload.session_id ?? record.payload.id;
  return typeof identity === 'string' && UUID_PATTERN.test(identity) ? identity.toLowerCase() : null;
}

function isResponseMessage(record) {
  return record?.type === 'response_item'
    && record.payload?.type === 'message'
    && (record.payload.role === 'user' || record.payload.role === 'assistant');
}

function getEventMessageRole(record) {
  if (record?.type !== 'event_msg') return null;
  if (record.payload?.type === 'user_message') return 'user';
  if (record.payload?.type === 'agent_message') return 'assistant';
  return null;
}

async function loadCodexIndex(indexPath) {
  const entriesById = new Map();
  const observations = [];
  const fileStat = await inspectRegularFile(indexPath);
  if (!fileStat) return { entriesById, observations };

  const scan = await scanJsonlFile(indexPath, {
    onRecord: async (record) => {
      if (typeof record?.id === 'string' && UUID_PATTERN.test(record.id)) {
        entriesById.set(record.id.toLowerCase(), record);
      }
      return true;
    },
  });
  observations.push(...scan.observations);
  return { entriesById, observations };
}

function resolveCodexActivity({ lastConversationAt, indexEntry, fileStat }) {
  if (lastConversationAt) {
    return { timestamp: lastConversationAt, source: 'Codex conversation record', confidence: 'high' };
  }
  const indexedTimestamp = toIsoTimestamp(indexEntry?.updated_at);
  if (indexedTimestamp) {
    return { timestamp: indexedTimestamp, source: 'Codex session index', confidence: 'medium' };
  }
  return {
    timestamp: fileStat.mtime.toISOString(),
    source: 'filesystem mtime fallback',
    confidence: 'low',
  };
}

async function inspectCodexTranscript({ filePath, fullSessionId, storageState, index }) {
  const fileStat = await inspectRegularFile(filePath);
  if (!fileStat) return null;

  const observations = new Set(index.observations);
  const internalIds = new Set();
  let workspacePath = null;
  let runtimeVersion = null;
  let originator = null;
  let source = null;
  let modelProvider = null;
  let lastConversationAt = null;
  let conversationRecords = 0;

  const scan = await scanJsonlFile(filePath, {
    onRecord: async (record) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        observations.add('Ignored a non-object Codex JSONL record.');
        return true;
      }

      const metadataId = getCodexMetaId(record);
      if (metadataId) internalIds.add(metadataId);
      if (record.type === 'session_meta' && record.payload) {
        workspacePath ??= typeof record.payload.cwd === 'string' ? record.payload.cwd : null;
        runtimeVersion ??= typeof record.payload.cli_version === 'string' ? record.payload.cli_version : null;
        originator ??= typeof record.payload.originator === 'string' ? record.payload.originator : null;
        source ??= typeof record.payload.source === 'string' ? record.payload.source : null;
        modelProvider ??= typeof record.payload.model_provider === 'string'
          ? record.payload.model_provider
          : null;
      }

      if (isResponseMessage(record) || getEventMessageRole(record)) {
        conversationRecords += 1;
        lastConversationAt = newestTimestamp(
          lastConversationAt,
          record.timestamp ?? record.payload?.timestamp,
        );
      } else if (typeof record.type === 'string' && !CODEX_KNOWN_TYPES.has(record.type)) {
        observations.add(`Observed unknown Codex record type: ${record.type}.`);
      }
      return true;
    },
  });

  scan.observations.forEach((observation) => observations.add(observation));
  if (internalIds.size !== 1 || !internalIds.has(fullSessionId)) {
    return {
      rejected: true,
      observation: `Rejected Codex candidate ${getShortSessionId(fullSessionId)} because session_meta identity was missing or inconsistent.`,
    };
  }

  const indexEntry = index.entriesById.get(fullSessionId);
  const indexedTitle = safeTitle(indexEntry?.thread_name);
  const warnings = [];
  if (scan.malformedRecords > 0) warnings.push('Malformed non-final JSONL records were ignored.');
  if (scan.trailingFragment) warnings.push('The active rollout ended with an incomplete trailing record.');
  if (conversationRecords === 0) warnings.push('No recognized Codex conversation records were found.');

  return {
    provider: PROVIDERS.CODEX,
    fullSessionId,
    shortSessionId: getShortSessionId(fullSessionId),
    sessionKey: createSessionKey(PROVIDERS.CODEX, fullSessionId),
    sourcePath: filePath,
    providerProjectKey: workspacePath ? path.basename(workspacePath) : null,
    workspacePath,
    storageState,
    sourceStat: {
      mtimeMs: fileStat.mtimeMs,
      sizeBytes: fileStat.size,
      birthtimeMs: fileStat.birthtimeMs,
    },
    sourceFormat: 'Codex rollout JSONL',
    sourceSchemaVersion: runtimeVersion,
    title: indexedTitle
      ? { value: indexedTitle, source: 'Codex session index' }
      : { value: `Codex session ${getShortSessionId(fullSessionId)}`, source: 'session identity fallback' },
    activity: resolveCodexActivity({ lastConversationAt, indexEntry, fileStat }),
    completeness: { isComplete: warnings.length === 0, warnings },
    observations: [...observations],
    metadata: { indexStatus: indexEntry ? 'matched' : 'missing-session', originator, source, modelProvider },
  };
}

// Catalog entry for a rollout whose stats exactly match its last successful
// archive: identity comes from the filename, title and activity from the session
// index, and the content is not read. Parse-only fields (workspace, runtime
// version) stay null — they are recovered at normalize time if the file ever
// changes, and the sync run set never contains a reused unchanged candidate.
function buildReusedCodexCandidate({ filePath, fullSessionId, storageState, index, fileStat }) {
  const indexEntry = index.entriesById.get(fullSessionId);
  const indexedTitle = safeTitle(indexEntry?.thread_name);
  return {
    provider: PROVIDERS.CODEX,
    fullSessionId,
    shortSessionId: getShortSessionId(fullSessionId),
    sessionKey: createSessionKey(PROVIDERS.CODEX, fullSessionId),
    sourcePath: filePath,
    providerProjectKey: null,
    workspacePath: null,
    storageState,
    sourceStat: {
      mtimeMs: fileStat.mtimeMs,
      sizeBytes: fileStat.size,
      birthtimeMs: fileStat.birthtimeMs,
    },
    sourceFormat: 'Codex rollout JSONL',
    sourceSchemaVersion: null,
    title: indexedTitle
      ? { value: indexedTitle, source: 'Codex session index' }
      : { value: `Codex session ${getShortSessionId(fullSessionId)}`, source: 'session identity fallback' },
    activity: resolveCodexActivity({ lastConversationAt: null, indexEntry, fileStat }),
    completeness: { isComplete: true, warnings: [] },
    observations: ['Reused verified sync state; the source is unchanged since its last successful archive.'],
    metadata: { indexStatus: indexEntry ? 'matched' : 'missing-session', reusedCatalogState: true },
  };
}

export function getCodexDefaultRoots({ homeDirectory = os.homedir(), codexRoot } = {}) {
  const dataRoot = codexRoot ?? path.join(homeDirectory, '.codex');
  return Object.freeze({
    dataRoot,
    activeRoot: path.join(dataRoot, 'sessions'),
    archivedRoot: path.join(dataRoot, 'archived_sessions'),
    indexPath: path.join(dataRoot, 'session_index.jsonl'),
  });
}

export async function discoverCodexSessions(options = {}) {
  const roots = getCodexDefaultRoots(options);
  const [activeDirectory, archivedDirectory, index] = await Promise.all([
    inspectDirectory(roots.activeRoot),
    inspectDirectory(roots.archivedRoot),
    loadCodexIndex(roots.indexPath),
  ]);
  if (activeDirectory.status !== 'ready' && archivedDirectory.status !== 'ready') {
    const status = activeDirectory.status === 'permission-needed'
      || archivedDirectory.status === 'permission-needed'
      ? 'permission-needed'
      : 'not-found';
    return { provider: PROVIDERS.CODEX, status, roots, sessions: [], observations: [] };
  }

  const locations = [];
  if (activeDirectory.status === 'ready') {
    const files = await walkRegularFiles(
      roots.activeRoot,
      (name) => CODEX_FILENAME_PATTERN.test(name),
      { maxDepth: 4 },
    );
    locations.push(...files.map((filePath) => ({ filePath, storageState: 'active' })));
  }
  if (archivedDirectory.status === 'ready') {
    const files = await walkRegularFiles(
      roots.archivedRoot,
      (name) => CODEX_FILENAME_PATTERN.test(name),
      { maxDepth: 2 },
    );
    locations.push(...files.map((filePath) => ({ filePath, storageState: 'archived' })));
  }

  const candidatesById = new Map();
  const observations = [];
  for (const location of locations) {
    const match = CODEX_FILENAME_PATTERN.exec(path.basename(location.filePath));
    if (!match) continue;
    const fullSessionId = normalizeFullSessionId(match[1]);
    const reusedStat = await matchKnownSource(
      options.knownSources,
      location.filePath,
      PROVIDERS.CODEX,
      fullSessionId,
    );
    const candidate = reusedStat
      ? buildReusedCodexCandidate({ ...location, fullSessionId, index, fileStat: reusedStat })
      : await inspectCodexTranscript({ ...location, fullSessionId, index });
    if (candidate?.rejected) {
      observations.push(candidate.observation);
      continue;
    }
    if (!candidate) continue;

    const current = candidatesById.get(fullSessionId);
    if (!current || candidate.sourceStat.mtimeMs > current.sourceStat.mtimeMs) {
      if (current) observations.push(`Reconciled duplicate Codex storage for ${getShortSessionId(fullSessionId)}.`);
      candidatesById.set(fullSessionId, candidate);
    } else {
      observations.push(`Reconciled duplicate Codex storage for ${getShortSessionId(fullSessionId)}.`);
    }
  }

  return {
    provider: PROVIDERS.CODEX,
    status: 'ready',
    roots,
    sessions: sortSessionsByActivity([...candidatesById.values()]),
    observations,
  };
}

function codexLifecycleEvent(record) {
  const eventType = record.payload?.type ?? record.type;
  let content = String(eventType);
  if (record.type === 'compacted') {
    const compactedContent = record.payload?.summary ?? record.payload?.message ?? record.payload?.text;
    if (typeof compactedContent === 'string' && compactedContent.trim() !== '') {
      content = compactedContent;
    }
  }
  return {
    type: record.type === 'compacted' ? 'compaction' : 'lifecycle',
    content,
    timestamp: toIsoTimestamp(record.timestamp ?? record.payload?.timestamp),
  };
}

export async function normalizeCodexSession(candidate) {
  if (candidate?.provider !== PROVIDERS.CODEX) {
    throw new CaptureError(ERROR_CODES.INVALID_INPUT, 'Codex normalization candidate is invalid.');
  }

  const stagedEvents = [];
  const observations = new Set(candidate.observations ?? []);
  const internalIds = new Set();
  let recordIndex = 0;
  let responseMessageCount = 0;
  const scan = await scanJsonlFile(candidate.sourcePath, {
    onRecord: async (record) => {
      recordIndex += 1;
      const metadataId = getCodexMetaId(record);
      if (metadataId) internalIds.add(metadataId);
      if (isResponseMessage(record)) {
        responseMessageCount += 1;
        stagedEvents.push({
          recordIndex,
          source: 'response-message',
          events: normalizeMessageEvents(
            record.payload.role,
            { content: record.payload.content },
            toIsoTimestamp(record.timestamp ?? record.payload.timestamp),
            observations,
          ),
        });
      } else if (getEventMessageRole(record)) {
        stagedEvents.push({
          recordIndex,
          source: 'event-message',
          events: normalizeMessageEvents(
            getEventMessageRole(record),
            record.payload.message,
            toIsoTimestamp(record.timestamp ?? record.payload.timestamp),
            observations,
          ),
        });
      } else if (record?.type === 'response_item'
        && ['function_call', 'function_call_output', 'web_search_call'].includes(record.payload?.type)) {
        stagedEvents.push({
          recordIndex,
          source: 'tool',
          events: normalizeMessageEvents(
            'assistant',
            { content: [record.payload] },
            toIsoTimestamp(record.timestamp ?? record.payload.timestamp),
            observations,
          ),
        });
      } else if (record?.type === 'compacted' || record?.type === 'event_msg') {
        stagedEvents.push({ recordIndex, source: 'lifecycle', events: [codexLifecycleEvent(record)] });
      } else if (typeof record?.type === 'string' && !CODEX_KNOWN_TYPES.has(record.type)) {
        observations.add(`Observed unknown Codex record type: ${record.type}.`);
      }
      return true;
    },
  });

  if (internalIds.size !== 1 || !internalIds.has(candidate.fullSessionId)) {
    throw new CaptureError(ERROR_CODES.UNSUPPORTED_SCHEMA, 'Codex session identity changed during normalization.');
  }
  scan.observations.forEach((observation) => observations.add(observation));
  const events = stagedEvents
    .filter((item) => responseMessageCount === 0 || item.source !== 'event-message')
    .sort((left, right) => left.recordIndex - right.recordIndex)
    .flatMap((item) => item.events);
  const title = candidate.title.source === 'session identity fallback'
    ? deriveTitleFromEvents(events, candidate.title.value)
    : candidate.title;
  const warnings = [...candidate.completeness.warnings];
  if (events.every((event) => event.type !== 'user' && event.type !== 'assistant')) {
    warnings.push('No recognized Codex conversation messages were normalized.');
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

export const codexAdapter = Object.freeze({
  provider: PROVIDERS.CODEX,
  getDefaultRoots: getCodexDefaultRoots,
  discoverSessions: discoverCodexSessions,
  normalizeSession: normalizeCodexSession,
});
