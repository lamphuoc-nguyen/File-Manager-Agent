// Runs every Electron test suite in its own process and summarises the results.
// Exit code 1 on any FAIL/ERROR line, a crashed suite, or (unless ALLOW_DEPRECATIONS=1)
// any Electron deprecation warning.
import { spawnSync } from 'child_process';
import { rmSync, readdirSync } from 'fs';
import { join } from 'path';
import electron from 'electron';
import { ROOT, TMP } from './_env.mjs';

const SUITES = [
  ['organizer.mjs', 'electron'],
  ['content.mjs', 'electron'],
  ['models.mjs', 'electron'],
  ['security.mjs', 'electron'],
  ['errors.mjs', 'electron'],
  ['settings-keys.mjs', 'electron'],
  ['ui-organize.mjs', 'node'], // drives a real app window over the DevTools protocol
];
const only = process.argv.slice(2);

/** Electron keeps userData folders locked until it exits, so clean up between suites. */
function cleanTmp() {
  for (const entry of readdirSync(TMP)) {
    try { rmSync(join(TMP, entry), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { }
  }
}

let failed = false;
let deprecations = 0;
for (const [file, runner] of SUITES) {
  if (only.length && !only.some(o => file.startsWith(o))) continue;
  const path = join(ROOT, 'tests', 'electron', file);
  const [cmd, args] = runner === 'electron' ? [electron, [path]] : [process.execPath, [path, electron]];
  const started = Date.now();
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: 300_000 });
  cleanTmp();
  const lines = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.split(/\r?\n/);
  const pass = lines.filter(l => l.startsWith('PASS')).length;
  const bad = lines.filter(l => /^(FAIL|ERROR)/.test(l));
  const deprecated = lines.filter(l => /deprecat/i.test(l));
  deprecations += deprecated.length;
  const ok = res.status === 0 && !res.error && bad.length === 0 && pass > 0;
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${file.padEnd(16)} ${pass} passed, ${bad.length} failed  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  for (const l of [...bad, ...deprecated].slice(0, 10)) console.log(`       ${l}`);
  if (res.error) console.log(`       ${res.error.message}`);
}

if (deprecations && process.env.ALLOW_DEPRECATIONS !== '1') {
  console.log(`FAIL ${deprecations} Electron deprecation warning(s) (set ALLOW_DEPRECATIONS=1 to tolerate)`);
  failed = true;
}
process.exit(failed ? 1 : 0);
