// Purpose: Verifies exact-caller host responses and normal browser-abandonment behavior over framed streams.

import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';

import {
  NATIVE_ERROR_CODES,
  encodeNativeMessage,
  registerMacNativeHost,
  runNativeMessagingHost,
} from '../src/index.js';
import {
  INVENTED_EXTENSION_ID,
  INVENTED_ORIGIN,
  inventedRequest,
} from './helpers.js';

function captureOutput() {
  const chunks = [];
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }),
    response() {
      const frame = Buffer.concat(chunks);
      assert.equal(frame.readUInt32LE(0), frame.length - 4);
      return JSON.parse(frame.subarray(4).toString('utf8'));
    },
  };
}

async function createRegisteredHost(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'grasppy-capture-host-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executablePath = path.join(root, 'invented-native-host');
  const appDataDirectory = path.join(root, 'app-data');
  await writeFile(executablePath, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await chmod(executablePath, 0o700);
  await registerMacNativeHost({
    extensionIds: [INVENTED_EXTENSION_ID],
    hostExecutablePath: executablePath,
    appDataDirectory,
    chromeUserDataDirectory: path.join(root, 'chrome'),
    platform: 'darwin',
  });
  return appDataDirectory;
}

test('the allowed caller receives the final created/replaced/unchanged response schema', async (t) => {
  const appDataDirectory = await createRegisteredHost(t);
  const output = captureOutput();
  const result = await runNativeMessagingHost({
    appDataDirectory,
    argumentsList: [INVENTED_ORIGIN],
    input: Readable.from([encodeNativeMessage(inventedRequest())]),
    output: output.stream,
    archiveSaver: async () => ({
      disposition: 'created',
      bytesWritten: 2_048,
      processedAt: '2026-08-03T08:00:00.000Z',
    }),
  });
  assert.deepEqual(result, { success: true, abandoned: false });
  assert.equal(output.response().result.disposition, 'created');
});

test('an unregistered exact origin receives CALLER_NOT_ALLOWED without archive work', async (t) => {
  const appDataDirectory = await createRegisteredHost(t);
  const output = captureOutput();
  let archiveCalled = false;
  const result = await runNativeMessagingHost({
    appDataDirectory,
    argumentsList: [`chrome-extension://${'b'.repeat(32)}/`],
    input: Readable.from([encodeNativeMessage(inventedRequest())]),
    output: output.stream,
    archiveSaver: async () => { archiveCalled = true; },
  });
  assert.equal(result.code, NATIVE_ERROR_CODES.CALLER_NOT_ALLOWED);
  assert.equal(output.response().error.code, NATIVE_ERROR_CODES.CALLER_NOT_ALLOWED);
  assert.equal(archiveCalled, false);
});

test('an abandoned request or response exits normally without a processing error', async (t) => {
  const appDataDirectory = await createRegisteredHost(t);
  const unusedOutput = captureOutput();
  const requestAbandoned = await runNativeMessagingHost({
    appDataDirectory,
    argumentsList: [INVENTED_ORIGIN],
    input: Readable.from([]),
    output: unusedOutput.stream,
  });
  assert.deepEqual(requestAbandoned, { success: false, abandoned: true });

  const droppedOutput = {
    write(_frame, callback) {
      const error = new Error('browser closed');
      error.code = 'EPIPE';
      callback(error);
    },
  };
  const responseAbandoned = await runNativeMessagingHost({
    appDataDirectory,
    argumentsList: [INVENTED_ORIGIN],
    input: Readable.from([encodeNativeMessage(inventedRequest())]),
    output: droppedOutput,
    archiveSaver: async () => ({
      disposition: 'created',
      bytesWritten: 2_048,
      processedAt: '2026-08-03T08:00:00.000Z',
    }),
  });
  assert.deepEqual(responseAbandoned, { success: true, abandoned: true });
});
