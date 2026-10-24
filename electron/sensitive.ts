import { basename } from 'path';

// Guards everything that could send file contents or names to the AI model.
// Sensitive files are never read, never sent and never moved by the organizer.

/** Folders whose contents are credentials (anywhere in the path). */
const SENSITIVE_DIRS = new Set(['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.password-store', '.gcloud', 'keychains']);

const SENSITIVE_EXTS = new Set([
  'pem', 'key', 'p12', 'pfx', 'jks', 'keystore', 'kdbx', 'kdb', 'ppk', 'gpg', 'pgp', 'age', 'ovpn', 'tfstate', 'tfvars', 'agekey',
]);

const SENSITIVE_NAMES: RegExp[] = [
  /^\.?env(\..+)?$/,                       // .env, .env.local, env.production
  /\.env$/,                                // prod.env
  /^id_(rsa|dsa|ecdsa|ed25519)$/,          // SSH private keys (the .pub halves are public)
  /^(\.npmrc|\.pypirc|\.netrc|_netrc|\.pgpass|\.htpasswd|\.git-credentials|wallet\.dat)$/,
  /credential/, /secret/, /passw(or)?d/, /\bpwd\b/,
  /api[-_ ]?keys?\b/, /access[-_ ]?token/, /auth[-_ ]?token/, /private[-_ ]?key/, /service[-_]?account.*\.json$/,
  /(^|[-_ .])key\.txt$/,                   // backup-age-key.txt, key.txt
  /m[aậ]t[-_ ]?kh[aẩ]u/,                   // mật khẩu / mat_khau / matkhau (Vietnamese: password)
];

/** Returns why a path is sensitive, or null. Checks the file name and every folder in the path. */
export function sensitivePathReason(path: string): string | null {
  const parts = path.split(/[\\/]+/).filter(Boolean).map(p => p.toLowerCase().normalize('NFC'));
  const name = basename(path).toLowerCase().normalize('NFC');
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (SENSITIVE_EXTS.has(ext)) return 'Key or certificate file';
  if (SENSITIVE_NAMES.some(re => re.test(name))) return 'Name suggests keys or passwords';
  // Anything inside a folder like .ssh, "credentials" or "mật khẩu" is protected too.
  const dirs = parts.slice(0, -1);
  if (dirs.some(p => SENSITIVE_DIRS.has(p) || SENSITIVE_NAMES.some(re => re.test(p)))) return 'Inside a folder for keys or passwords';
  return null;
}

/** Patterns for secrets that may appear inside otherwise ordinary files. */
const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----/, 'private key'],
  [/AGE-SECRET-KEY-1[0-9A-Z]{20,}/, 'age secret key'],
  [/\bnvapi-[A-Za-z0-9_-]{20,}/, 'NVIDIA API key'],
  [/\bsk-(ant-|proj-)?[A-Za-z0-9_-]{20,}/, 'API secret key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/, 'GitHub token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'access token (JWT)'],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]{3,}@/i, 'connection string with password'],
  [/(password|passwd|pwd|passphrase|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|m[aậ]t\s*kh[aẩ]u)["']?\s*[:=]\s*["']?[^\s"',;]{4,}/i, 'password or key assignment'],
];

/** Returns what kind of secret the text appears to contain, or null. */
export function findSecret(text: string): string | null {
  const t = text.normalize('NFC');
  for (const [re, label] of SECRET_PATTERNS) if (re.test(t)) return label;
  return null;
}

/** Replaces every secret-looking match with a placeholder. */
export function redactSecrets(text: string): string {
  let out = text.normalize('NFC');
  for (const [re, label] of SECRET_PATTERNS) out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), `[redacted ${label}]`);
  return out;
}

export const BLOCKED_MESSAGE = 'Blocked for your security: this file may contain keys or passwords, so it is never read or sent to the AI.';
