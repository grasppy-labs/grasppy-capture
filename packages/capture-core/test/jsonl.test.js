// Purpose: Verifies streaming JSONL handling for valid, malformed, and active trailing records.

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { scanJsonlFile } from '../src/index.js';
import { createTemporaryHome, writeJsonl } from './helpers.js';

test('JSONL scanning distinguishes malformed records from a trailing fragment', async (testContext) => {
  const temporaryHome = await createTemporaryHome(testContext);
  const filePath = path.join(temporaryHome, 'stream.jsonl');
  await writeJsonl(filePath, [{ type: 'valid' }], { trailingFragment: '{"incomplete":' });
  const seenRecords = [];

  const scan = await scanJsonlFile(filePath, {
    onRecord: async (record) => {
      seenRecords.push(record);
      return true;
    },
  });

  assert.deepEqual(seenRecords, [{ type: 'valid' }]);
  assert.equal(scan.validRecords, 1);
  assert.equal(scan.malformedRecords, 0);
  assert.equal(scan.trailingFragment, true);
});

test('JSONL scanning reports a malformed newline-terminated record', async (testContext) => {
  const temporaryHome = await createTemporaryHome(testContext);
  const filePath = path.join(temporaryHome, 'malformed.jsonl');
  await writeFile(filePath, '{"type":"valid"}\n{not-json}\n', 'utf8');

  const scan = await scanJsonlFile(filePath);

  assert.equal(scan.validRecords, 1);
  assert.equal(scan.malformedRecords, 1);
});

test('JSONL scanning propagates visitor failures', async (testContext) => {
  const temporaryHome = await createTemporaryHome(testContext);
  const filePath = path.join(temporaryHome, 'visitor-error.jsonl');
  await writeJsonl(filePath, [{ type: 'valid' }]);

  await assert.rejects(
    scanJsonlFile(filePath, {
      onRecord: async () => {
        throw new Error('invented visitor failure');
      },
    }),
    /invented visitor failure/,
  );
});
