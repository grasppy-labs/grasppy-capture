// Purpose: Processes one exact-origin native save request and treats browser disconnects as normal termination.

import { saveBrowserArchiveRequest } from './archive-browser-markdown.js';
import { NativeHostError, NATIVE_ERROR_CODES, toNativeHostError } from './errors.js';
import { readNativeMessage, writeNativeMessage } from './framing.js';
import {
  createErrorResponse,
  createSuccessResponse,
  trustedRequestId,
  validateNativeSaveRequest,
} from './protocol.js';
import { assertAllowedCaller } from './registration.js';

export async function runNativeMessagingHost({
  appDataDirectory,
  argumentsList,
  input,
  output,
  archiveSaver = saveBrowserArchiveRequest,
}) {
  let requestId = null;
  try {
    const rawRequest = await readNativeMessage(input);
    requestId = trustedRequestId(rawRequest?.requestId);
    await assertAllowedCaller({ appDataDirectory, argumentsList });
    const request = validateNativeSaveRequest(rawRequest);
    const result = await archiveSaver({ appDataDirectory, request });
    const delivered = await writeNativeMessage(output, createSuccessResponse(request, result));
    return Object.freeze({ success: true, abandoned: !delivered });
  } catch (error) {
    const nativeError = toNativeHostError(error);
    if (nativeError.abandoned || nativeError.code === NATIVE_ERROR_CODES.CONNECTION_ABANDONED) {
      return Object.freeze({ success: false, abandoned: true });
    }
    try {
      const delivered = await writeNativeMessage(output, createErrorResponse(nativeError, requestId));
      return Object.freeze({ success: false, abandoned: !delivered, code: nativeError.code });
    } catch (deliveryError) {
      if (deliveryError instanceof NativeHostError
        && deliveryError.code === NATIVE_ERROR_CODES.CONNECTION_ABANDONED) {
        return Object.freeze({ success: false, abandoned: true });
      }
      throw deliveryError;
    }
  }
}
