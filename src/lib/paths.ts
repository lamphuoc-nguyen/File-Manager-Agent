// Path helpers for the renderer (no Node `path` here). Handle both `C:\dir` and `/dir` styles.

export const sepOf = (p: string) => (p.includes('\\') || /^[A-Za-z]:$/.test(p) ? '\\' : '/');

export const isRoot = (p: string) => p === '/' || /^[A-Za-z]:[\\/]?$/.test(p);

/** Strips trailing separators but keeps roots like `C:\` and `/` intact. */
export function normalize(p: string): string {
  if (/^[A-Za-z]:[\\/]*$/.test(p)) return p.slice(0, 2) + '\\';
  if (/^\/+$/.test(p)) return '/';
  return p.replace(/[\\/]+$/, '');
}

export function joinPath(dir: string, name: string): string {
  const d = normalize(dir);
  return (isRoot(d) ? d : d + sepOf(d)) + name;
}

export function parentPath(p: string): string {
  const n = normalize(p);
  if (isRoot(n)) return n;
  const i = Math.max(n.lastIndexOf('\\'), n.lastIndexOf('/'));
  return normalize(i <= 0 ? '/' : n.slice(0, i + 1));
}

export const baseName = (p: string) => normalize(p).split(/[\\/]/).filter(Boolean).pop() ?? p;

/** Breadcrumb segments with the full path each one navigates to. */
export function crumbs(p: string): { label: string; path: string }[] {
  const n = normalize(p);
  if (!n) return [];
  const out: { label: string; path: string }[] = [];
  let acc = n.startsWith('/') ? '/' : '';
  if (acc) out.push({ label: '/', path: '/' });
  for (const part of n.split(/[\\/]/).filter(Boolean)) {
    acc = acc ? joinPath(acc, part) : normalize(part);
    out.push({ label: part, path: acc });
  }
  return out;
}

const INVALID_NAME = /[\\/:*?"<>|]/;

export function validateName(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Name cannot be empty';
  if (INVALID_NAME.test(n)) return 'Name cannot contain \\ / : * ? " < > |';
  if (n === '.' || n === '..') return 'Invalid name';
  return null;
}

/** "file.txt" -> "file - Copy.txt", "file - Copy (2).txt", ... avoiding names in `taken`. */
export function uniqueCopyName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let i = 1; ; i++) {
    const candidate = `${stem} - Copy${i > 1 ? ` (${i})` : ''}${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
