// Purpose: Validates the narrow renderer-to-main intent payloads before any desktop operation runs.

const SESSION_KEY_PATTERN = /^(claude-code|codex|cursor):[0-9a-f-]{36}$/;

function requireExactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('The desktop request is invalid.');
  }
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    throw new TypeError('The desktop request contains unsupported fields.');
  }
}

export function validateNoArguments(args) {
  if (!Array.isArray(args) || args.length !== 0) {
    throw new TypeError('This desktop operation does not accept input.');
  }
}

export function validateSessionRequest(value) {
  requireExactFields(value, ['sessionKey']);
  if (typeof value.sessionKey !== 'string' || !SESSION_KEY_PATTERN.test(value.sessionKey)) {
    throw new TypeError('The conversation identity is invalid.');
  }
  return value.sessionKey;
}

export function validateExclusionRequest(value) {
  requireExactFields(value, ['sessionKey', 'excluded']);
  const sessionKey = validateSessionRequest({ sessionKey: value.sessionKey });
  if (typeof value.excluded !== 'boolean') throw new TypeError('The exclusion choice is invalid.');
  return Object.freeze({ sessionKey, excluded: value.excluded });
}
