// Purpose: Builds the local React renderer while importing the owner-approved mock-up stylesheet unchanged.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const DESKTOP_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIRECTORY = path.resolve(DESKTOP_DIRECTORY, '../..');
const LOCKED_MOCKUP_PATH = path.join(
  WORKSPACE_DIRECTORY,
  'design',
  'grasppy-capture-mockup.html',
);
const LOCKED_STYLES_ID = 'virtual:grasppy-capture-locked-design.css';
const RESOLVED_LOCKED_STYLES_ID = `\0${LOCKED_STYLES_ID}`;

function loadLockedStyles() {
  const mockup = readFileSync(LOCKED_MOCKUP_PATH, 'utf8');
  const match = /<style>([\s\S]*?)<\/style>/.exec(mockup);
  if (!match) throw new Error('The approved mock-up stylesheet is unavailable.');
  return match[1];
}

function lockedDesignPlugin() {
  return {
    name: 'grasppy-capture-locked-design',
    resolveId(source) {
      return source === LOCKED_STYLES_ID ? RESOLVED_LOCKED_STYLES_ID : null;
    },
    load(id) {
      return id === RESOLVED_LOCKED_STYLES_ID ? loadLockedStyles() : null;
    },
  };
}

export default defineConfig({
  root: path.join(DESKTOP_DIRECTORY, 'renderer'),
  base: './',
  plugins: [lockedDesignPlugin()],
  build: {
    outDir: path.join(DESKTOP_DIRECTORY, 'dist', 'renderer'),
    emptyOutDir: true,
  },
});
