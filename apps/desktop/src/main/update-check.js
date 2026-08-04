// Purpose: Performs a user-initiated release check against the public GitHub releases API.
// There is no background polling, no automatic download, and nothing about the local
// archive is transmitted — the request carries a version string and nothing else.

import { get } from 'node:https';

const GITHUB_OWNER = 'grasppy-labs';
const GITHUB_REPO = 'grasppy-capture';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

export function isUpdateCheckConfigured() {
  return !GITHUB_OWNER.startsWith('REPLACE_ME') && !GITHUB_REPO.startsWith('REPLACE_ME');
}

// Built from constants, never from the API response, so a compromised or
// unexpected payload can never redirect the user's browser somewhere else.
export function releasesPageUrl() {
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
}

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(value ?? '').trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Returns 1 when left is newer, -1 when right is newer, 0 when equal.
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const request = get(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'GRASPPY-Capture',
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`GitHub responded with status ${response.statusCode}.`));
          return;
        }
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          if (body.length > MAX_RESPONSE_BYTES) {
            request.destroy();
            reject(new Error('The release response was unexpectedly large.'));
          }
        });
        response.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('The release response could not be read.'));
          }
        });
      },
    );
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('The update check timed out.'));
    });
    request.on('error', () => reject(new Error('The update check could not reach GitHub.')));
  });
}

export async function checkForUpdate(currentVersion) {
  if (!isUpdateCheckConfigured()) {
    return Object.freeze({ status: 'not-configured', currentVersion });
  }
  let release;
  try {
    release = await fetchLatestRelease();
  } catch (error) {
    return Object.freeze({ status: 'unavailable', currentVersion, reason: error.message });
  }
  const latestVersion = String(release?.tag_name ?? '').trim();
  if (parseVersion(latestVersion) === null) {
    return Object.freeze({ status: 'unavailable', currentVersion, reason: 'No readable release version was published.' });
  }
  return Object.freeze({
    status: compareVersions(latestVersion, currentVersion) > 0 ? 'update-available' : 'up-to-date',
    currentVersion,
    latestVersion,
  });
}
