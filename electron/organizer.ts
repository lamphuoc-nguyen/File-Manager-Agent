import { createReadStream, existsSync } from 'fs';
import { readdir, stat, rmdir } from 'fs/promises';
import { createHash } from 'crypto';
import { join, extname, basename, resolve, parse } from 'path';
import { homedir } from 'os';
import * as fsOps from './fs-ops.js';
import type { OrganizeStrategy, PlanItem, CategoryStat, DirectoryAnalysis, ApplyResult } from './organizer-types.js';

export type { OrganizeStrategy, PlanItem, CategoryStat, DirectoryAnalysis, ApplyResult };

// ===== Categories =====
const CATEGORIES: Record<string, string[]> = {
  Images: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff', 'heic', 'raw', 'psd', 'ai'],
  Videos: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', '3gp'],
  Audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'],
  Documents: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'tex', 'epub', 'pages'],
  Spreadsheets: ['xls', 'xlsx', 'ods', 'csv', 'tsv', 'numbers'],
  Presentations: ['ppt', 'pptx', 'odp', 'key'],
  Archives: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'iso'],
  Installers: ['exe', 'msi', 'msix', 'appx', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'appimage'],
  Code: ['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb', 'php', 'html', 'css', 'scss', 'json', 'xml', 'yaml', 'yml', 'sql', 'sh', 'ps1', 'bat', 'ipynb'],
  Fonts: ['ttf', 'otf', 'woff', 'woff2'],
  Design: ['fig', 'sketch', 'xd', 'drawio', 'blend', 'obj', 'fbx', 'stl'],
};
const EXT_TO_CATEGORY = new Map(Object.entries(CATEGORIES).flatMap(([cat, exts]) => exts.map(e => [e, cat] as const)));

// System files and files still being written are never touched.
const SYSTEM_FILES = new Set(['desktop.ini', 'thumbs.db', 'iconcache.db']);
const SYSTEM_EXTS = new Set(['sys', 'dll', 'blf', 'regtrans-ms', 'cnpf', 'lnk']);
const IN_PROGRESS_EXTS = new Set(['crdownload', 'part', 'partial', 'download', 'tmp', 'temp', 'lock']);
// A folder containing any of these is a code project; moving its files breaks builds and imports.
const PROJECT_MARKERS = ['.git', 'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt', 'pom.xml', 'build.gradle', 'CMakeLists.txt', 'Makefile'];

const extOf = (name: string) => extname(name).slice(1).toLowerCase();

function skipReason(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.startsWith('.')) return 'Hidden config file';
  if (SYSTEM_FILES.has(lower) || lower.startsWith('ntuser.') || SYSTEM_EXTS.has(extOf(lower))) return 'System file';
  if (lower.startsWith('~$')) return 'Office lock file';
  if (IN_PROGRESS_EXTS.has(extOf(lower)) || /\.tmp\./.test(lower)) return 'Temporary or still downloading';
  return null;
}

/** Explains why organizing `root` is risky, or returns undefined if it looks like a normal user folder. */
function riskWarning(root: string, entryNames: string[]): string | undefined {
  const r = resolve(root).toLowerCase().replace(/[\\/]+$/, '');
  const home = resolve(homedir()).toLowerCase();
  if (r === parse(r).root.toLowerCase().replace(/[\\/]+$/, '')) return 'This is a drive root. Moving files here can break Windows or installed apps.';
  if (r === home) return 'This is your user profile folder. It holds settings for Windows and your apps; organize Downloads, Desktop or Documents instead.';
  const systemDirs = [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData, process.env.APPDATA, process.env.LOCALAPPDATA]
    .filter(Boolean).map(d => resolve(d!).toLowerCase());
  if (systemDirs.some(d => r === d || r.startsWith(d + '\\'))) return 'This is a system or application folder. Moving files here can break installed apps.';
  const marker = PROJECT_MARKERS.find(m => entryNames.includes(m));
  if (marker) return `This looks like a code project (found ${marker}). Moving files can break builds and imports.`;
  return undefined;
}
export const categoryOf = (name: string) => EXT_TO_CATEGORY.get(extOf(name)) ?? 'Other';

/** Groups files by meaning (an AI model). Returns lowercased file name -> target folder; unlisted files stay put. */
export type SmartGrouper = (
  files: { name: string; size: number; modified: string }[],
  existingFolders: string[],
) => Promise<Map<string, { folder: string; reason: string }>>;

/** Makes a model-suggested folder name safe to use as a single path segment. */
function sanitizeFolderName(name: string): string | null {
  const clean = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 60);
  return clean && clean !== '.' && clean !== '..' ? clean : null;
}

function folderFor(name: string, modified: Date, strategy: Exclude<OrganizeStrategy, 'smart'>): string {
  switch (strategy) {
    case 'date': return `${modified.getFullYear()}-${String(modified.getMonth() + 1).padStart(2, '0')}`;
    case 'extension': return extOf(name).toUpperCase() || 'No extension';
    default: return categoryOf(name);
  }
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', d => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

/** Picks `name`, or `name (2)`, `name (3)`... so nothing planned or on disk gets overwritten. */
function uniqueDestination(dir: string, name: string, taken: Set<string>): string {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i++) {
    const candidate = join(dir, i === 1 ? name : `${stem} (${i})${ext}`);
    const key = candidate.toLowerCase();
    if (!taken.has(key) && !existsSync(candidate)) {
      taken.add(key);
      return candidate;
    }
  }
}

// ===== Analysis =====
/**
 * Analyzes the top level of `root` and proposes a plan. Nothing is changed on disk.
 * Existing folders are never moved; files go into folders named by the strategy.
 */
export async function analyzeDirectory(root: string, strategy: OrganizeStrategy = 'type', smartGrouper?: SmartGrouper): Promise<DirectoryAnalysis> {
  if (strategy === 'smart' && !smartGrouper) throw new Error('Smart organizing needs an AI model. Add an API key in AI settings.');
  const entries = await readdir(root, { withFileTypes: true });
  const files: { path: string; name: string; size: number; modified: Date; created: Date }[] = [];
  const skipped: DirectoryAnalysis['skipped'] = [];
  const emptyFolders: string[] = [];
  let totalFolders = 0;

  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      totalFolders++;
      if (entry.name.startsWith('.')) continue; // hidden folders like .git/.vscode are app-owned
      try { if ((await readdir(full)).length === 0) emptyFolders.push(full); } catch { }
      continue;
    }
    if (!entry.isFile()) continue;
    const reason = skipReason(entry.name);
    if (reason) { skipped.push({ path: full, reason }); continue; }
    try {
      const s = await stat(full);
      files.push({ path: full, name: entry.name, size: s.size, modified: s.mtime, created: s.birthtime });
    } catch {
      skipped.push({ path: full, reason: 'Locked or unreadable' });
    }
  }

  // Category breakdown (always by type, regardless of strategy, since it's the most readable summary).
  const byCategory = new Map<string, CategoryStat>();
  for (const f of files) {
    const cat = categoryOf(f.name);
    const s = byCategory.get(cat) ?? { category: cat, count: 0, size: 0 };
    s.count++; s.size += f.size;
    byCategory.set(cat, s);
  }

  // Duplicates: same size first (cheap), then same content hash.
  const bySize = new Map<number, typeof files>();
  for (const f of files) if (f.size > 0) bySize.set(f.size, [...(bySize.get(f.size) ?? []), f]);
  const duplicateGroups: DirectoryAnalysis['duplicateGroups'] = [];
  const duplicatesToTrash = new Set<string>();
  for (const [size, group] of bySize) {
    if (group.length < 2) continue;
    const byHash = new Map<string, typeof files>();
    for (const f of group) {
      try { const h = await hashFile(f.path); byHash.set(h, [...(byHash.get(h) ?? []), f]); } catch { }
    }
    for (const same of byHash.values()) {
      if (same.length < 2) continue;
      // Keep the oldest copy; the rest are proposed for the Recycle Bin.
      same.sort((a, b) => a.created.getTime() - b.created.getTime() || a.name.length - b.name.length);
      duplicateGroups.push({ size, paths: same.map(f => f.path) });
      same.slice(1).forEach(f => duplicatesToTrash.add(f.path));
    }
  }

  // Build the plan. In risky folders nothing is ticked, so the user has to opt in item by item.
  const warning = riskWarning(root, entries.map(e => e.name));
  const smart = strategy === 'smart'
    ? await smartGrouper!(
      files.filter(f => !duplicatesToTrash.has(f.path)).map(f => ({ name: f.name, size: f.size, modified: f.modified.toISOString() })),
      entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name),
    )
    : null;
  const plan: PlanItem[] = [];
  const taken = new Set<string>();
  let n = 0;
  for (const f of files) {
    if (duplicatesToTrash.has(f.path)) {
      const original = duplicateGroups.find(g => g.paths.includes(f.path))!.paths[0];
      plan.push({ id: `p${n++}`, kind: 'trash', source: f.path, reason: `Duplicate of ${basename(original)}`, recommended: false });
      continue;
    }
    let folder: string;
    let reason: string;
    if (smart) {
      const assigned = smart.get(f.name.toLowerCase());
      const name = assigned && sanitizeFolderName(assigned.folder);
      if (!name) continue; // the model wasn't sure; leave the file where it is
      folder = name;
      reason = assigned.reason || `Belongs in ${name}`;
    } else {
      folder = folderFor(f.name, f.modified, strategy as Exclude<OrganizeStrategy, 'smart'>);
      reason = strategy === 'date' ? `Modified ${folder}` : strategy === 'extension' ? `.${extOf(f.name)} file` : `${folder} file`;
    }
    plan.push({
      id: `p${n++}`,
      kind: 'move',
      source: f.path,
      destination: uniqueDestination(join(root, folder), f.name, taken),
      reason,
      recommended: !warning,
    });
  }
  for (const dir of emptyFolders) {
    plan.push({ id: `p${n++}`, kind: 'trash', source: dir, reason: 'Empty folder', recommended: false });
  }

  return {
    root,
    strategy,
    warning,
    totalFiles: files.length,
    totalFolders,
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    categories: [...byCategory.values()].sort((a, b) => b.size - a.size),
    duplicateGroups,
    emptyFolders,
    skipped,
    plan,
  };
}

// ===== Apply / Undo =====
/** Applies plan items one by one; a failure on one item doesn't stop the rest. */
export async function applyPlan(items: PlanItem[]): Promise<ApplyResult> {
  const applied: ApplyResult['applied'] = [];
  const createdDirs = new Set<string>();
  for (const item of items) {
    try {
      if (item.kind === 'move') {
        if (!item.destination) throw new Error('Missing destination');
        const destDir = join(item.destination, '..');
        if (!existsSync(destDir)) createdDirs.add(destDir);
        fsOps.move(item.source, item.destination);
      } else {
        await fsOps.remove(item.source);
      }
      applied.push({ ...item, ok: true });
    } catch (e: any) {
      applied.push({ ...item, ok: false, error: e.message });
    }
  }
  return { applied, createdDirs: [...createdDirs] };
}

/** Reverses the moves from `applyPlan` and removes folders it created if they're empty again. */
export async function undoApply(result: ApplyResult): Promise<ApplyResult> {
  const reversed = result.applied
    .filter(i => i.ok && i.kind === 'move')
    .reverse()
    .map(i => ({ ...i, source: i.destination!, destination: i.source }));
  const undone = await applyPlan(reversed);
  for (const dir of result.createdDirs) {
    try { await rmdir(dir); } catch { } // not empty (user added files) -> keep it
  }
  return undone;
}
