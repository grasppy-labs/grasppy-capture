// Purpose: Verifies bounded chunked native-message framing and normal abandoned-connection handling.

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  MAX_NATIVE_REQUEST_BYTES,
  NATIVE_ERROR_CODES,
  encodeNativeMessage,
  readNativeMessage,
  writeNativeMessage,
} from '../src/index.js';

function requestFrame(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

test('chunked native frames decode one UTF-8 JSON request', async () => {
  const frame = requestFrame({ invented: true });
  const decoded = await readNativeMessage(Readable.from([
    frame.subarray(0, 2),
    frame.subarray(2, 7),
    frame.subarray(7),
  ]));
  assert.deepEqual(decoded, { invented: true });
});

test('oversized declarations fail before their body is allocated or read', async () => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(MAX_NATIVE_REQUEST_BYTES + 1, 0);
  await assert.rejects(
    readNativeMessage(Readable.from([header])),
    (error) => error.code === NATIVE_ERROR_CODES.PAYLOAD_TOO_LARGE,
  );
});

test('empty streams are normal abandoned browser connections', async () => {
  await assert.rejects(
    readNativeMessage(Readable.from([])),
    (error) => error.code === NATIVE_ERROR_CODES.CONNECTION_ABANDONED && error.abandoned,
  );
});

test('responses are framed below the host-to-extension ceiling', () => {
  const frame = encodeNativeMessage({ success: true });
  assert.equal(frame.readUInt32LE(0), frame.length - 4);
  assert.deepEqual(JSON.parse(frame.subarray(4).toString('utf8')), { success: true });
});

test('a dropped response pipe returns false instead of becoming a logged processing failure', async () => {
  const output = {
    write(_frame, callback) {
      const error = new Error('abandoned');
      error.code = 'EPIPE';
      callback(error);
    },
  };
  assert.equal(await writeNativeMessage(output, { success: true }), false);
});
