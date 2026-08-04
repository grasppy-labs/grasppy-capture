// Purpose: Reads and writes bounded Chrome Native Messaging frames without buffering untrusted overflow.

import { TextDecoder } from 'node:util';

import { NativeHostError, NATIVE_ERROR_CODES } from './errors.js';
import { MAX_NATIVE_REQUEST_BYTES, MAX_NATIVE_RESPONSE_BYTES } from './protocol.js';

function framingError(code, message, options) {
  return new NativeHostError(code, message, options);
}

function abandonedConnection(cause) {
  return framingError(
    NATIVE_ERROR_CODES.CONNECTION_ABANDONED,
    'The browser connection ended before native messaging completed.',
    { cause, abandoned: true },
  );
}

function parseJsonBody(body) {
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(body);
    return JSON.parse(json);
  } catch (error) {
    throw framingError(
      NATIVE_ERROR_CODES.MALFORMED_MESSAGE,
      'The native message is not valid UTF-8 JSON.',
      { cause: error },
    );
  }
}

export async function readNativeMessage(input, { maxBytes = MAX_NATIVE_REQUEST_BYTES } = {}) {
  const header = Buffer.alloc(4);
  let headerOffset = 0;
  let body = null;
  let bodyOffset = 0;

  try {
    for await (const value of input) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      let chunkOffset = 0;
      if (headerOffset < header.length) {
        const headerBytes = Math.min(header.length - headerOffset, chunk.length);
        chunk.copy(header, headerOffset, 0, headerBytes);
        headerOffset += headerBytes;
        chunkOffset += headerBytes;
        if (headerOffset === header.length) {
          const length = header.readUInt32LE(0);
          if (length === 0) {
            throw framingError(NATIVE_ERROR_CODES.MALFORMED_MESSAGE, 'The native message is empty.');
          }
          if (length > maxBytes) {
            throw framingError(
              NATIVE_ERROR_CODES.PAYLOAD_TOO_LARGE,
              'The native request exceeds the 16 MiB safety limit.',
            );
          }
          body = Buffer.alloc(length);
        }
      }

      if (body && chunkOffset < chunk.length) {
        const bodyBytes = Math.min(body.length - bodyOffset, chunk.length - chunkOffset);
        chunk.copy(body, bodyOffset, chunkOffset, chunkOffset + bodyBytes);
        bodyOffset += bodyBytes;
        chunkOffset += bodyBytes;
      }
      if (body && bodyOffset === body.length) {
        if (chunkOffset !== chunk.length) {
          throw framingError(
            NATIVE_ERROR_CODES.MALFORMED_MESSAGE,
            'The native connection supplied more than one request.',
          );
        }
        return parseJsonBody(body);
      }
    }
  } catch (error) {
    if (error instanceof NativeHostError) throw error;
    throw abandonedConnection(error);
  }
  throw abandonedConnection();
}

export function encodeNativeMessage(message, { maxBytes = MAX_NATIVE_RESPONSE_BYTES } = {}) {
  let body;
  try {
    body = Buffer.from(JSON.stringify(message), 'utf8');
  } catch (error) {
    throw framingError(
      NATIVE_ERROR_CODES.INTERNAL_ERROR,
      'The native response could not be encoded safely.',
      { cause: error },
    );
  }
  if (body.length === 0 || body.length >= maxBytes) {
    throw framingError(
      NATIVE_ERROR_CODES.INTERNAL_ERROR,
      'The native response exceeds its safe size limit.',
    );
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export async function writeNativeMessage(output, message) {
  const frame = encodeNativeMessage(message);
  try {
    await new Promise((resolve, reject) => {
      output.write(frame, (error) => error ? reject(error) : resolve());
    });
    return true;
  } catch (error) {
    if (error?.code === 'EPIPE' || error?.code === 'ECONNRESET') return false;
    throw framingError(
      NATIVE_ERROR_CODES.INTERNAL_ERROR,
      'The native response could not be delivered safely.',
      { cause: error },
    );
  }
}
