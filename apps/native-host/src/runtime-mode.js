// Purpose: Selects desktop, registration, or one-request native-host startup from explicit arguments.

const NATIVE_HOST_ARGUMENT = '--native-messaging-host';
const REGISTRATION_PREFIX = '--register-native-host=';

export function parseRuntimeMode(argumentsList) {
  if (!Array.isArray(argumentsList)) return Object.freeze({ mode: 'desktop', extensionIds: [] });
  if (argumentsList.includes(NATIVE_HOST_ARGUMENT)) {
    return Object.freeze({ mode: 'native-host', extensionIds: [] });
  }
  const extensionIds = argumentsList
    .filter((argument) => typeof argument === 'string' && argument.startsWith(REGISTRATION_PREFIX))
    .map((argument) => argument.slice(REGISTRATION_PREFIX.length));
  return Object.freeze({
    mode: extensionIds.length > 0 ? 'register-native-host' : 'desktop',
    extensionIds: Object.freeze(extensionIds),
  });
}
