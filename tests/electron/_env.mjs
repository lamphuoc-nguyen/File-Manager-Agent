// Shared paths for the Electron test suites. Everything resolves relative to the repo.
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..');
/** file:// URL prefix of the compiled main-process modules (run `npm run build:electron` first). */
export const DIST = pathToFileURL(join(ROOT, 'dist-electron')).href + '/';
/**
 * Prefix for mkdtempSync. Fixtures live inside the repo (git-ignored) rather than the OS temp
 * folder, because the organizer deliberately refuses to plan moves under AppData.
 */
export const TMP = join(ROOT, 'tests', '.tmp') + '/';
mkdirSync(TMP, { recursive: true });
