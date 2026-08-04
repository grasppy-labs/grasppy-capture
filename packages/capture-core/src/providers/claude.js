// Purpose: Discovers and normalizes locally available Claude Code main-session transcripts read-only.

import { readFile } from 'node:fs/promises';
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
} from './shared.js';

const CLAUDE_FILENAME_PATTERN = new RegExp(`^(${UUID_PATTERN.source.slice(1, -1)})\\.jsonl$`, 'i');
const CLAUDE_ACTIVITY_TYPES = new Set(['user', 'assistant', 'system']);
const CLAUDE_KNOWN_TYPES = new Set([
  'user',
  'assistant',
  'system',
  'attachment',
  'custom-title',
  'last-prompt',
  'queue-operation',
  'mode',
]);

function safeTitle(value) {
  if (typeof value !== 'string') return null;
  const normalizedTitle = value.replace(/\s+/g, ' ').trim();
  if (normalizedTitle === '') return null;
  return normalizedTitle.length > 96 ? `${normalizedTitle.slice(0, 93)}...` : normalizedTitle;
}

async function loadProjectIndex(projectPath) {
  const observations = [];
  try {
    const parsedIndex = JSON.parse(await readFile(path.join(projectPath, 'sessions-index.json'), 'utf8'));
    const entries = Array.isArray(parsedIndex.entries) ? parsedIndex.entries : [];
    return {
      entriesById: new Map(
        entries
          .filter((entry) => typeof entry?.sessionId === 'string')
          .map((entry) => [entry.sessionId.toLowerCase(), entry]),
      ),
      originalPath: typeof parsedIndex.originalPath === 'string' ? parsedIndex.originalPath : null,
      observations,
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') observations.push('Claude sessions index was unreadable or invalid.');
    return { entriesById: new Map(), originalPath: null, observations };
  }
}

async function countSubagents(projectPath, fullSessionId) {
  const subagentsPath = path.join(projectPath, fullSessionId, 'subagents');
  const directory = await inspectDirectory(subagentsPath);
  if (directory.status !== 'ready') return 0;
  return directory.entries.filter(
    (entry) => entry.isFile() && !entry.isSymbolicLink() && /^agent-.+\.jsonl$/i.test(entry.name),
  ).length;
}

function resolveClaudeActivity({ lastConversationAt, indexEntry, fileStat }) {
  if (lastConversationAt) {
    return { timestamp: lastConversationAt, source: 'Claude conversation record', confidence: 'high' };
  }
  const indexTimestamp = toIsoTimestamp(indexEntry?.modified);
  if (indexTimestamp) {
    return { timestamp: indexTimestamp, source: 'Claude sessions index', confidence: 'medium' };
  }
  return {
    timestamp: fileStat.mtime.toISOString(),
    source: 'filesystem mtime fallback',
    confidence: 'low',
  };
}

async function inspectClaudeTranscript({ filePath, fullSessionId, projectKey, projectPath, index }) {
  const fileStat = await inspectRegularFile(filePath);
  if (!fileStat) return null;

  const observations = new Set(index.observations);
  const internalIds = new Set();
  let workspacePath = null;
  let runtimeVersion = null;
  let customTitle = null;
  let lastConversationAt = null;
  let conversationRecords = 0;

  const scan = await scanJsonlFile(filePath, {
    onRecord: async (record) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        observations.add('Ignored a non-object Claude JSONL record.');
        return true;
      }
      if (typeof record.sessionId === 'string' && UUID_PATTERN.test(record.sessionId)) {
        internalIds.add(record.sessionId.toLowerCase());
      }
      if (!workspacePath && typeof record.cwd === 'string' && record.cwd.trim() !== '') {
        workspacePath = record.cwd;
      }
      if (!runtimeVersion && typeof record.version === 'string') runtimeVersion = record.version;

      if (record.type === 'custom-title') {
        customTitle = safeTitle(record.customTitle ?? record.title ?? record.value) ?? customTitle;
      }
      if (CLAUDE_ACTIVITY_TYPES.has(record.type)) {
        conversationRecords += 1;
        lastConversationAt = newestTimestamp(lastConversationAt, record.timestamp);
      } else if (typeof record.type === 'string' && !CLAUDE_KNOWN_TYPES.has(record.type)) {
        observations.add(`Observed unknown Claude record type: ${record.type}.`);
      }
      return true;
    },
  });

  scan.observations.forEach((observation) => observations.add(observation));
  if (internalIds.size > 0 && (internalIds.size !== 1 || !internalIds.has(fullSessionId))) {
    return {
      rejected: true,
      observation: `Rejected Claude candidate ${getShortSessionId(fullSessionId)} because internal identity disagreed.`,
    };
  }
  if (internalIds.size === 0) observations.add('Claude internal session identity was not observed.');

  const indexEntry = index.entriesById.get(fullSessionId);
  const indexedTitle = safeTitle(indexEntry?.firstPrompt);
  const title = customTitle
    ? { value: customTitle, source: 'Claude custom title' }
    : indexedTitle
      ? { value: indexedTitle, source: 'Claude sessions index' }
      : { value: `Claude Code session ${getShortSessionId(fullSessionId)}`, source: 'session identity fallback' };
  const warnings = [];
  if (scan.malformedRecords > 0) warnings.push('Malformed non-final JSONL records were ignored.');
  if (scan.trailingFragment) warnings.push('The active transcript ended with an incomplete trailing record.');
  if (conversationRecords === 0) warnings.push('No recognized Claude conversation records were found.');

  return {
    provider: PROVIDERS.CLAUDE_CODE,
    fullSessionId,
    shortSessionId: getShortSessionId(fullSessionId),
    sessionKey: createSessionKey(PROVIDERS.CLAUDE_CODE, fullSessionId),
    sourcePath: filePath,
    providerProjectKey: projectKey,
    workspacePath: workspacePath ?? indexEntry?.projectPath ?? index.originalPath ?? null,
    storageState: 'active',
    sourceStat: {
      mtimeMs: fileStat.mtimeMs,
      sizeBytes: fileStat.size,
      birthtimeMs: fileStat.birthtimeMs,
    },
    sourceFormat: 'Claude Code JSONL',
    sourceSchemaVersion: runtimeVersion,
    title,
    activity: resolveClaudeActivity({ lastConversationAt, indexEntry, fileStat }),
    completeness: { isComplete: warnings.length === 0, warnings },
    observations: [...observations],
    metadata: {
      indexStatus: indexEntry ? 'matched' : 'missing-session',
      runtimeVersion,
      subagentCount: await countSubagents(projectPath, fullSessionId),
    },
  };
}

// Catalog entry for a transcript whose stats exactly match its last successful
// archive: identity comes from the filename, title and activity from the project
// index, and the content is not read. A custom in-file title is only observed by
// a full parse, so a reused entry may show the indexed first-prompt title until
// the file next changes — the archived Markdown itself always has the real title.
function buildReusedClaudeCandidate({ filePath, fullSessionId, projectKey, index, fileStat }) {
  const indexEntry = index.entriesById.get(fullSessionId);
  const indexedTitle = safeTitle(indexEntry?.firstPrompt);
  return {
    provider: PROVIDERS.CLAUDE_CODE,
    fullSessionId,
    shortSessionId: getShortSessionId(fullSessionId),
    sessionKey: createSessionKey(PROVIDERS.CLAUDE_CODE, fullSessionId),
    sourcePath: filePath,
    providerProjectKey: projectKey,
    workspacePath: indexEntry?.projectPath ?? index.originalPath ?? null,
    storageState: 'active',
    sourceStat: {
      mtimeMs: fileStat.mtimeMs,
      sizeBytes: fileStat.size,
      birthtimeMs: fileStat.birthtimeMs,
    },
    sourceFormat: 'Claude Code JSONL',
    sourceSchemaVersion: null,
    title: indexedTitle
      ? { value: indexedTitle, source: 'Claude sessions index' }
      : { value: `Claude Code session ${getShortSessionId(fullSessionId)}`, source: 'session identity fallback' },
    activity: resolveClaudeActivity({ lastConversationAt: null, indexEntry, fileStat }),
    completeness: { isComplete: true, warnings: [] },
    observations: ['Reused verified sync state; the source is unchanged since its last successful archive.'],
    metadata: { indexStatus: indexEntry ? 'matched' : 'missing-session', reusedCatalogState: true },
  };
}

export function getClaudeDefaultRoots({
  homeDirectory = os.homedir(),
  environment = process.env,
  claudeConfigRoot,
} = {}) {
  const configuredRoot = claudeConfigRoot
    ?? (environment.CLAUDE_CONFIG_DIR?.trim() || path.join(homeDirectory, '.claude'));
  return Object.freeze({ configRoot: configuredRoot, projectsRoot: path.join(configuredRoot, 'projects') });
}

export async function discoverClaudeSessions(options = {}) {
  const roots = getClaudeDefaultRoots(options);
  const projectsDirectory = await inspectDirectory(roots.projectsRoot);
  if (projectsDirectory.status !== 'ready') {
    return { provider: PROVIDERS.CLAUDE_CODE, status: projectsDirectory.status, roots, sessions: [], observations: [] };
  }

  const sessions = [];
  const observations = [];
  for (const projectEntry of projectsDirectory.entries) {
    if (!projectEntry.isDirectory() || projectEntry.isSymbolicLink()) continue;
    const projectPath = path.join(roots.projectsRoot, projectEntry.name);
    const projectDirectory = await inspectDirectory(projectPath);
    if (projectDirectory.status !== 'ready') continue;
    const index = await loadProjectIndex(projectPath);

    for (const entry of projectDirectory.entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const match = CLAUDE_FILENAME_PATTERN.exec(entry.name);
      if (!match) continue;
      const fullSessionId = normalizeFullSessionId(match[1]);
      const filePath = path.join(projectPath, entry.name);
      const reusedStat = await matchKnownSource(
        options.knownSources,
        filePath,
        PROVIDERS.CLAUDE_CODE,
        fullSessionId,
      );
      const candidate = reusedStat
        ? buildReusedClaudeCandidate({
          filePath,
          fullSessionId,
          projectKey: projectEntry.name,
          index,
          fileStat: reusedStat,
        })
        : await inspectClaudeTranscript({
          filePath,
          fullSessionId,
          projectKey: projectEntry.name,
          projectPath,
          index,
        });
      if (candidate?.rejected) observations.push(candidate.observation);
      else if (candidate) sessions.push(candidate);
    }
  }

  return {
    provider: PROVIDERS.CLAUDE_CODE,
    status: 'ready',
    roots,
    sessions: sortSessionsByActivity(sessions),
    observations,
  };
}

export async function normalizeClaudeSession(candidate) {
  if (candidate?.provider !== PROVIDERS.CLAUDE_CODE) {
    throw new CaptureError(ERROR_CODES.INVALID_INPUT, 'Claude normalization candidate is invalid.');
  }

  const events = [];
  const observations = new Set(candidate.observations ?? []);
  const internalIds = new Set();
  let customTitle = null;
  const scan = await scanJsonlFile(candidate.sourcePath, {
    onRecord: async (record) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) return true;
      if (typeof record.sessionId === 'string' && UUID_PATTERN.test(record.sessionId)) {
        internalIds.add(record.sessionId.toLowerCase());
      }
      if (record.isCompactSummary === true) {
        events.push(...normalizeMessageEvents(
          'compaction',
          record.message,
          toIsoTimestamp(record.timestamp),
          observations,
        ));
      } else if (record.type === 'user' || record.type === 'assistant') {
        events.push(...normalizeMessageEvents(record.type, record.message, toIsoTimestamp(record.timestamp), observations));
      } else if (record.type === 'system') {
        events.push(...normalizeMessageEvents('lifecycle', record.message, toIsoTimestamp(record.timestamp), observations));
      } else if (record.type === 'custom-title') {
        customTitle = safeTitle(record.customTitle ?? record.title ?? record.value) ?? customTitle;
      } else if (record.type === 'attachment' && record.attachment?.type === 'image') {
        events.push({ type: 'image', content: '[Claude attachment]', timestamp: toIsoTimestamp(record.timestamp) });
      } else if (typeof record.type === 'string' && !CLAUDE_KNOWN_TYPES.has(record.type)) {
        observations.add(`Observed unknown Claude record type: ${record.type}.`);
      }
      return true;
    },
  });

  if (internalIds.size > 0 && (internalIds.size !== 1 || !internalIds.has(candidate.fullSessionId))) {
    throw new CaptureError(ERROR_CODES.UNSUPPORTED_SCHEMA, 'Claude session identity changed during normalization.');
  }
  scan.observations.forEach((observation) => observations.add(observation));
  const derivedTitle = deriveTitleFromEvents(events, candidate.title.value);
  const title = customTitle
    ? { value: customTitle, source: 'Claude custom title' }
    : candidate.title.source === 'session identity fallback'
      ? derivedTitle
      : candidate.title;
  const warnings = [...candidate.completeness.warnings];
  if (events.length === 0 && !warnings.includes('No recognized Claude conversation records were found.')) {
    warnings.push('No recognized Claude conversation records were found.');
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

export const claudeAdapter = Object.freeze({
  provider: PROVIDERS.CLAUDE_CODE,
  getDefaultRoots: getClaudeDefaultRoots,
  discoverSessions: discoverClaudeSessions,
  normalizeSession: normalizeClaudeSession,
});
