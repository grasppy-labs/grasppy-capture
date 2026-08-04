// Purpose: Creates disposable invented provider trees for tests without repository transcript fixtures.

import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function createTemporaryHome(testContext) {
  const temporaryHome = await mkdtemp(path.join(os.tmpdir(), 'grasppy-capture-test-'));
  testContext.after(async () => {
    await rm(temporaryHome, { recursive: true, force: true });
  });
  return temporaryHome;
}

export async function writeJsonl(filePath, records, { trailingFragment = null } = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const body = records.map((record) => JSON.stringify(record)).join('\n');
  const suffix = trailingFragment === null ? '\n' : `\n${trailingFragment}`;
  await writeFile(filePath, `${body}${suffix}`, 'utf8');
  return filePath;
}

export async function setFileTime(filePath, isoTimestamp) {
  const timestamp = new Date(isoTimestamp);
  await utimes(filePath, timestamp, timestamp);
}
