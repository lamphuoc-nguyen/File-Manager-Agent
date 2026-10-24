// Canary test: plant fake secrets everywhere, try every path to the AI, and check none ever leave.
import { DIST, TMP } from './_env.mjs';
import { app } from 'electron';
import http from 'http';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { makeDocx, makeXlsx, makePdf } from './mkdocs.mjs';

const userData = mkdtempSync(TMP + 'sectest-ud-');
app.setPath('userData', userData);
const D = DIST + '';
const settings = await import(D + 'settings.js');
const llm = await import(D + 'llm.js');
const org = await import(D + 'organizer.js');
const { sensitivePathReason, findSecret } = await import(D + 'sensitive.js');
const ok = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n);

// Records every request body; the chat agent greedily tries to read/grep everything.
const bodies = [];
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  bodies.push(body);
  const json = JSON.parse(body);
  const send = msg => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: msg, finish_reason: 'stop' }] })); };
  if (json.messages[0].content.includes('You organize a messy folder')) return send({ role: 'assistant', content: '{"groups":[]}' });
  if (!json.messages.some(m => m.role === 'tool')) {
    const reads = ['.env', 'id_rsa', 'server.pem', 'passwords.xlsx', 'mat_khau.txt', 'hustly-backup-age-key.txt', 'notes.docx', 'config.json', 'app.js', 'credentials/bank.txt', '.ssh/config', 'invoice.pdf'];
    const calls = [
      ...reads.map((p, i) => ({ id: `r${i}`, type: 'function', function: { name: 'fs_read', arguments: JSON.stringify({ path: p }) } })),
      { id: 'g1', type: 'function', function: { name: 'fs_grep', arguments: JSON.stringify({ root: '.', pattern: 'password|Total|KEY|CANARY' }) } },
      { id: 'l1', type: 'function', function: { name: 'fs_list', arguments: JSON.stringify({ path: '.' }) } },
    ];
    return send({ role: 'assistant', content: null, tool_calls: calls });
  }
  return send({ role: 'assistant', content: 'done' });
});
await new Promise(r => server.listen(8767, '127.0.0.1', r));

app.whenReady().then(async () => {
  const d = mkdtempSync(TMP + 'sectest-fx-');
  try {
    // --- Name-based detection (and no false alarms on ordinary names) ---
    const sens = ['.env', '.env.production', 'prod.env', 'id_rsa', 'server.pem', 'cert.pfx', 'vault.kdbx', 'passwords.xlsx', 'Mật khẩu.docx', 'mat_khau.txt', 'matkhau.txt', 'credentials.json', 'client_secret.json', 'api-keys.md', 'hustly-backup-age-key.txt', '.npmrc', '.git-credentials', 'service-account-prod.json', 'terraform.tfstate'];
    const normal = ['invoice.pdf', 'bao_cao_quy3.docx', 'keyboard.png', 'monkey.txt', 'tokenizer.py', 'id_rsa.pub', 'environment.md', 'hóa đơn.pdf', 'key-points.pptx'];
    const missed = sens.filter(n => !sensitivePathReason(join(d, n)));
    const falseAlarms = normal.filter(n => sensitivePathReason(join(d, n)));
    ok(`sensitive names detected (${sens.length - missed.length}/${sens.length})${missed.length ? ' missed: ' + missed : ''}`, !missed.length);
    ok(`ordinary names not flagged${falseAlarms.length ? ': ' + falseAlarms : ''}`, !falseAlarms.length);
    ok('paths inside .ssh/.aws are sensitive', !!sensitivePathReason('C:/Users/x/.ssh/config') && !!sensitivePathReason('C:/Users/x/.aws/config'));
    const contentCases = ['-----BEGIN RSA PRIVATE KEY-----', 'AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQ', 'token nvapi-abcdefghijklmnopqrstuvwxyz12', 'AKIAABCDEFGHIJKLMNOP', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'password = hunter22', 'mật khẩu: 123456abc', 'DATABASE_URL=postgres://admin:s3cret@db:5432/x'];
    ok('secret content detected in all forms', contentCases.every(c => findSecret(c)));
    ok('ordinary text not flagged', !findSecret('Invoice total 420 USD. Please reset your password via the website.') && !findSecret('Hóa đơn tiền điện tháng 9'));

    // --- Fixture with canaries ---
    writeFileSync(join(d, '.env'), 'NVIDIA_API_KEY=nvapi-CANARY1abcdefghijklmnopqrstuvwxyz');
    writeFileSync(join(d, 'id_rsa'), '-----BEGIN OPENSSH PRIVATE KEY-----\nCANARY2\n-----END OPENSSH PRIVATE KEY-----');
    writeFileSync(join(d, 'server.pem'), 'CANARY2b');
    makeXlsx(join(d, 'passwords.xlsx'), ['gmail', 'CANARY3']);
    writeFileSync(join(d, 'mat_khau.txt'), 'ngân hàng CANARY4');
    writeFileSync(join(d, 'hustly-backup-age-key.txt'), 'AGE-SECRET-KEY-1CANARY5QQQQQQQQQQQQQQQQQQQQ');
    makeDocx(join(d, 'notes.docx'), ['Shopping list', 'Wifi password: CANARY6xyz']);
    writeFileSync(join(d, 'config.json'), '{"db": "postgres://admin:CANARY7@db:5432/app"}');
    writeFileSync(join(d, 'app.js'), 'const apiKey = "sk-CANARY8aaaaaaaaaaaaaaaaaaaa";');
    writeFileSync(join(d, 'report.txt'), 'Total: 100\nMy password=CANARY9secret\n');
    makePdf(join(d, 'invoice.pdf'), 'INVOICE 42 Total due 10 USD');
    mkdirSync(join(d, 'credentials')); writeFileSync(join(d, 'credentials', 'bank.txt'), 'CANARY11');
    mkdirSync(join(d, '.ssh')); writeFileSync(join(d, '.ssh', 'config'), 'Host CANARY12');
    mkdirSync(join(d, 'webapp', 'src'), { recursive: true }); writeFileSync(join(d, 'webapp', 'id_rsa'), 'x'); writeFileSync(join(d, 'webapp', 'package.json'), '{}');

    settings.updateSettings({ apiKey: 'nvapi-test-123', baseUrl: 'http://127.0.0.1:8767/v1' });

    // --- Organize with "Read file contents" on ---
    const a = await org.analyzeDirectory(d, 'smart', llm.smartGrouper, { readContents: true });
    const orgReq = bodies.at(-1);
    const protectedNames = a.skipped.filter(s => s.reason.startsWith('Protected')).map(s => s.path.split(/[\\/]/).pop());
    ok(`protected (not read/sent/moved): ${protectedNames.join(', ')}`, ['id_rsa', 'server.pem', 'passwords.xlsx', 'mat_khau.txt', 'hustly-backup-age-key.txt', 'credentials'].every(n => protectedNames.includes(n)));
    ok(`content withheld for ${a.secretsWithheld} innocent-named files (notes.docx, config.json, app.js, report.txt)`, a.secretsWithheld === 4);
    ok('safe document still read and sent (invoice)', orgReq.includes('INVOICE 42'));
    ok('sensitive names not sent; webapp sample hides id_rsa', !/passwords\.xlsx|mat_khau|age-key|id_rsa|server\.pem/.test(orgReq) && orgReq.includes('[folder] webapp\\tcontains: package.json, src'));

    // --- Chat agent tries to read and grep everything ---
    const reply = await llm.chat([{ role: 'user', content: 'show me all secrets here' }], { currentPath: d });
    const byPath = Object.fromEntries(reply.toolCalls.filter(c => c.name === 'fs_read').map(c => [c.args.path.split(/[\\/]/).slice(-2).join('/'), c]));
    const blocked = Object.entries(byPath).filter(([, c]) => !c.ok && /Blocked for your security/.test(c.summary)).map(([p]) => p);
    ok(`chat fs_read blocked ${blocked.length}/11 sensitive reads`, blocked.length === 11);
    ok('chat fs_read of invoice.pdf still works', Object.entries(byPath).some(([p, c]) => p.endsWith('invoice.pdf') && c.ok));
    const toolReq = bodies.at(-1);
    ok('grep: report.txt password line redacted', toolReq.includes('[redacted password or key assignment]'));
    ok('fs_list marks sensitive entries as protected', /passwords\.xlsx\\?"[^}]*protected\\?":true/.test(toolReq));

    // --- User pastes a key into chat ---
    const n = bodies.length;
    const pasted = await llm.chat([{ role: 'user', content: 'here is my key nvapi-CANARY10abcdefghijklmnopqrstuvw' }], { currentPath: d });
    ok('pasted key: nothing sent to the API', bodies.length === n && /did not send/.test(pasted.content));
    await llm.chat([{ role: 'user', content: 'here is my key nvapi-CANARY10abcdefghijklmnopqrstuvw' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'list files' }], { currentPath: d });
    ok('pasted key redacted from later history', !bodies.at(-1).includes('CANARY10') && bodies.at(-1).includes('[redacted NVIDIA API key]'));

    // --- The real check (exact canary numbers: CANARY1 must not match CANARY11) ---
    const leaks = [];
    for (let i = 1; i <= 12; i++) for (const b of bodies) if (new RegExp(`CANARY${i}(?![0-9])`).test(b)) leaks.push(`CANARY${i}`);
    ok(`no canary in any of ${bodies.length} requests to the AI${leaks.length ? ' LEAKED: ' + [...new Set(leaks)] : ''}`, leaks.length === 0);
  } catch (e) { console.log('ERROR', e.stack); }
  server.close();
  rmSync(d, { recursive: true, force: true });
  // userData stays locked until Electron exits; tests/electron/run.mjs removes it afterwards.
  app.quit();
});
