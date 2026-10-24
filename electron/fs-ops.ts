import { shell } from 'electron';
import { join, dirname, basename, resolve, sep } from 'path';
import { homedir } from 'os';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, lstatSync,
  renameSync, copyFileSync, cpSync, rmSync, type Dirent,
} from 'fs';
import type { FileInfo, SearchResult } from './lib/agent-manager/src/index.js';

const isWin = process.platform === 'win32';
const MAX_GREP_FILE_SIZE = 5 * 1024 * 1024;

// ===== Helpers =====
function samePath(a: string, b: string): boolean {
  const ra = resolve(a), rb = resolve(b);
  return isWin ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

function isInside(child: string, parent: string): boolean {
  const c = resolve(child), p = resolve(parent).replace(/[\\/]+$/, '') + sep;
  return isWin ? c.toLowerCase().startsWith(p.toLowerCase()) : c.startsWith(p);
}

/** Converts a simple glob (*, ?) to a regex matched against a file name. */
function globToRegex(pattern: string): RegExp {
  const name = pattern.replace(/^(\*\*[\\/])+/, '');
  const body = name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`, isWin ? 'i' : '');
}

/** Lists a directory, skipping symlinked dirs and anything we can't read (e.g. System Volume Information). */
function safeReaddir(dir: string): Dirent[] {
  try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

export function toFileInfo(path: string, dirent?: Dirent): FileInfo {
  try {
    const stat = statSync(path);
    return {
      name: basename(path) || path,
      path,
      isDirectory: stat.isDirectory(),
      size: stat.size,
      modified: stat.mtime.toISOString(),
      created: stat.birthtime.toISOString(),
    };
  } catch {
    // Locked or protected entries (pagefile.sys, DumpStack.log.tmp, broken links) can't be stat'ed.
    return { name: basename(path), path, isDirectory: dirent?.isDirectory() ?? false, size: 0, modified: '', created: '' };
  }
}

// ===== Operations =====
export function getDrives(): string[] {
  if (!isWin) return ['/'];
  const drives: string[] = [];
  for (let c = 65; c <= 90; c++) {
    const root = `${String.fromCharCode(c)}:\\`;
    if (existsSync(root)) drives.push(root);
  }
  return drives.length ? drives : ['C:\\'];
}

export function getHome(): string {
  return homedir();
}

export function list(path: string, showHidden = true): FileInfo[] {
  if (!existsSync(path)) throw new Error(`Path not found: ${path}`);
  if (!statSync(path).isDirectory()) throw new Error(`Not a directory: ${path}`);
  return readdirSync(path, { withFileTypes: true })
    .filter(d => showHidden || !d.name.startsWith('.'))
    .map(d => toFileInfo(join(path, d.name), d));
}

export function read(path: string, encoding: 'utf-8' | 'base64' = 'utf-8'): string {
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  return readFileSync(path, encoding);
}

export function write(path: string, content: string, encoding: 'utf-8' | 'base64' = 'utf-8') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, encoding);
  return { success: true };
}

/** Moves the item to the Recycle Bin / Trash so deletes are recoverable. */
export async function remove(path: string) {
  if (!existsSync(path)) throw new Error(`Not found: ${path}`);
  await shell.trashItem(path);
  return { success: true };
}

export function move(source: string, dest: string, overwrite = false) {
  if (!existsSync(source)) throw new Error(`Source not found: ${source}`);
  if (source === dest) return { success: true };
  // A case-only rename on Windows (a.txt -> A.txt) "exists" but is the same file.
  const caseOnlyRename = samePath(source, dest);
  if (!caseOnlyRename && existsSync(dest)) {
    if (!overwrite) throw new Error(`Destination exists: ${basename(dest)}`);
    rmSync(dest, { recursive: true, force: true });
  }
  if (statSync(source).isDirectory() && isInside(dest, source)) throw new Error('Cannot move a folder into itself');
  mkdirSync(dirname(dest), { recursive: true });
  try {
    renameSync(source, dest);
  } catch (e: any) {
    // rename can't cross drives/devices; fall back to copy + delete.
    if (e.code !== 'EXDEV') throw e;
    cpSync(source, dest, { recursive: true, errorOnExist: true, force: false });
    rmSync(source, { recursive: true, force: true });
  }
  return { success: true };
}

export function copy(source: string, dest: string, recursive = true, overwrite = false) {
  if (!existsSync(source)) throw new Error(`Source not found: ${source}`);
  if (samePath(source, dest)) throw new Error('Source and destination are the same');
  if (existsSync(dest) && !overwrite) throw new Error(`Destination exists: ${basename(dest)}`);
  mkdirSync(dirname(dest), { recursive: true });
  if (statSync(source).isDirectory()) {
    if (!recursive) throw new Error('Copying a folder requires recursive=true');
    if (isInside(dest, source)) throw new Error('Cannot copy a folder into itself');
    cpSync(source, dest, { recursive: true, force: overwrite, errorOnExist: !overwrite });
  } else {
    copyFileSync(source, dest);
  }
  return { success: true };
}

export function mkdir(path: string) {
  if (existsSync(path)) throw new Error(`Already exists: ${basename(path)}`);
  mkdirSync(path, { recursive: true });
  return { success: true };
}

export function stat(path: string): FileInfo {
  if (!existsSync(path)) throw new Error(`Not found: ${path}`);
  return toFileInfo(path);
}

/** Recursively walks `root`, calling `visit` per entry; stops once `visit` returns true. */
function walk(root: string, visit: (full: string, entry: Dirent) => boolean) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of safeReaddir(dir)) {
      const full = join(dir, entry.name);
      if (visit(full, entry)) return;
      if (entry.isDirectory() && !lstatSafe(full)?.isSymbolicLink()) stack.push(full);
    }
  }
}

function lstatSafe(path: string) {
  try { return lstatSync(path); } catch { return null; }
}

export function search(root: string, pattern: string, maxResults = 100): string[] {
  if (!existsSync(root)) throw new Error(`Path not found: ${root}`);
  const regex = globToRegex(pattern);
  const results: string[] = [];
  walk(root, (full, entry) => {
    if (regex.test(entry.name)) results.push(full);
    return results.length >= maxResults;
  });
  return results;
}

export function grep(root: string, pattern: string, filePattern = '*', maxResults = 50): SearchResult[] {
  if (!existsSync(root)) throw new Error(`Path not found: ${root}`);
  const regex = new RegExp(pattern, isWin ? 'i' : '');
  const fileRegex = globToRegex(filePattern || '*');
  const results: SearchResult[] = [];
  walk(root, (full, entry) => {
    if (!entry.isFile() || !fileRegex.test(entry.name)) return false;
    try {
      if (statSync(full).size > MAX_GREP_FILE_SIZE) return false;
      const content = readFileSync(full, 'utf-8');
      if (content.includes('\0')) return false; // binary
      const matches = content.split(/\r?\n/)
        .map((text, i) => ({ line: i + 1, column: text.search(regex), text }))
        .filter(m => m.column >= 0);
      if (matches.length) results.push({ path: full, matches });
    } catch {
      // Ignore read errors
    }
    return results.length >= maxResults;
  });
  return results;
}

export async function open(path: string) {
  const error = await shell.openPath(path);
  if (error) throw new Error(error);
  return { success: true };
}

export function showInFolder(path: string) {
  shell.showItemInFolder(path);
  return { success: true };
}
