// Purpose: Creates invented native requests and isolated configured archives for native-host tests.

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  initializeOperationalManifest,
  setupArchiveDirectory,
} from '../../../packages/capture-core/src/index.js';

export const INVENTED_EXTENSION_ID = 'a'.repeat(32);
export const INVENTED_ORIGIN = `chrome-extension://${INVENTED_EXTENSION_ID}/`;
export const INVENTED_CONVERSATION_ID = '00000000-0000-4000-8000-000000000002';

export function inventedMarkdown(content = 'Invented answer.') {
  return [
    '# Invented browser export',
    '',
    '**Exported:** August 3, 2026',
    '**Source:** https://claude.ai/chat/00000000-0000-4000-8000-000000000002',
    '**Messages:** 2',
    '',
    '---',
    '',
    '## 👤 USER MESSAGE (1)',
    '',
    'Invented question.',
    '',
    '---',
    '',
    '## 🤖 AI RESPONSE (2)',
    '',
    content,
    '',
    '---',
    '',
  ].join('\n');
}

export function inventedRequest(overrides = {}) {
  return {
    protocol: 'grasppy.capture.native.v1',
    action: 'save_markdown',
    requestId: '00000000-0000-4000-8000-000000000001',
    provider: 'claude',
    conversationId: INVENTED_CONVERSATION_ID,
    identityFormat: 'uuid',
    title: 'Invented planning conversation',
    sourceUrl: `https://claude.ai/chat/${INVENTED_CONVERSATION_ID}`,
    sourceUpdatedAt: null,
    filenameHint: 'invented-export.md',
    markdown: inventedMarkdown(),
    ...overrides,
  };
}

export async function createConfiguredTestArchive() {
  const root = await mkdtemp(path.join(tmpdir(), 'grasppy-capture-native-test-'));
  const parentDirectory = path.join(root, 'chosen-parent');
  const appDataDirectory = path.join(root, 'application-data');
  await mkdir(parentDirectory, { recursive: true });
  const archivePath = await setupArchiveDirectory(parentDirectory);
  await initializeOperationalManifest({
    appDataDirectory,
    archivePath,
    now: '2026-08-03T08:00:00.000Z',
  });
  return Object.freeze({
    root,
    appDataDirectory,
    archivePath,
    cleanup: () => rm(root, { recursive: true, force: true }),
  });
}
