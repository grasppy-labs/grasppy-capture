// Purpose: Streams untrusted JSONL records while distinguishing malformed lines from a trailing fragment.

import { createReadStream } from 'node:fs';

import { CaptureError, ERROR_CODES } from '../errors.js';

class JsonlVisitorError extends Error {
  constructor(cause) {
    super('JSONL visitor failed.', { cause });
    this.name = 'JsonlVisitorError';
  }
}

function createSourceReadError(error) {
  if (error?.code === 'EACCES' || error?.code === 'EPERM') {
    return new CaptureError(
      ERROR_CODES.PROVIDER_PERMISSION_DENIED,
      'Permission is required to read this provider source.',
      { cause: error },
    );
  }
  if (error?.code === 'ENOENT') {
    return new CaptureError(
      ERROR_CODES.PROVIDER_UNAVAILABLE,
      'The provider source is no longer available.',
      { cause: error },
    );
  }
  return new CaptureError(
    ERROR_CODES.SOURCE_READ_FAILED,
    'The provider source could not be read.',
    { cause: error },
  );
}

async function visitLine(rawLine, context, onRecord, result) {
  const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
  if (line.trim() === '') return true;

  let record;
  try {
    record = JSON.parse(line);
  } catch (error) {
    if (context.isTrailing) {
      result.trailingFragment = true;
      result.observations.push(`Ignored incomplete trailing JSONL fragment at line ${context.lineNumber}.`);
      return true;
    }

    result.malformedRecords += 1;
    result.observations.push(`Ignored malformed JSONL record at line ${context.lineNumber}.`);
    return true;
  }

  result.validRecords += 1;
  try {
    return (await onRecord(record, context)) !== false;
  } catch (error) {
    throw new JsonlVisitorError(error);
  }
}

export async function scanJsonlFile(filePath, { onRecord = async () => true } = {}) {
  const result = {
    validRecords: 0,
    malformedRecords: 0,
    trailingFragment: false,
    observations: [],
  };
  let buffer = '';
  let lineNumber = 0;

  try {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    for await (const chunk of stream) {
      buffer += chunk;
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        lineNumber += 1;
        const shouldContinue = await visitLine(
          buffer.slice(0, newlineIndex),
          { lineNumber, isTrailing: false },
          onRecord,
          result,
        );
        buffer = buffer.slice(newlineIndex + 1);
        if (!shouldContinue) {
          stream.destroy();
          return result;
        }
        newlineIndex = buffer.indexOf('\n');
      }
    }

    if (buffer !== '') {
      lineNumber += 1;
      await visitLine(buffer, { lineNumber, isTrailing: true }, onRecord, result);
    }
    return result;
  } catch (error) {
    if (error instanceof CaptureError) throw error;
    if (error instanceof JsonlVisitorError) throw error.cause;
    throw createSourceReadError(error);
  }
}
