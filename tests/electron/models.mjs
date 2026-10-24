// Main-process tests for model switching, JSON retry and token-limit errors.
import { DIST, TMP } from './_env.mjs';
import { app } from 'electron';
import http from 'http';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

const userData = mkdtempSync(TMP + 'mdtest-ud-');
app.setPath('userData', userData);
const D = DIST + '';
const settings = await import(D + 'settings.js');
const llm = await import(D + 'llm.js');
const org = await import(D + 'organizer.js');
const ok = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n);

const seen = [];
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const json = JSON.parse(body);
  seen.push(json);
  const send = (content, finish = 'stop') => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: finish }] })); };
  const names = (json.messages[1].content.match(/^\[file\] ([^\t]+)/gm) ?? []).map(l => l.slice(7));
  const good = JSON.stringify({ groups: [{ folder: 'Hóa đơn', reason: 'hóa đơn', items: names.filter(n => /hoa_don|hóa đơn/i.test(n)) }] });
  const isRetry = json.messages.length > 2;
  if (json.model === 'flaky/model') return send(isRetry ? good : 'Sure! Here is {"groups": [ {"folder": "Hóa đơn", ');
  if (json.model === 'thinker/model') return send('<think>' + 'hmm '.repeat(50), 'length');
  return send(good);
});
await new Promise(r => server.listen(8766, '127.0.0.1', r));

app.whenReady().then(async () => {
  const d = mkdtempSync(TMP + 'mdtest-fx-');
  try {
    for (const f of ['hoa_don_thang_9.pdf', 'hóa đơn điện.pdf', 'bao_cao_quy3.docx']) writeFileSync(join(d, f), f);
    await settings.updateSettings({ apiKey: 'nvapi-test-123', baseUrl: 'http://127.0.0.1:8766/v1' });

    const s = settings.getSettings();
    ok(`default quick list: ${s.models.join(', ')}`, s.models.includes('google/gemma-4-31b-it') && s.models.includes(s.model));
    await settings.updateSettings({ models: ['a/one', 'b/two', 'a/one', '  '] });
    ok('quick list deduped and trimmed, active model kept in list', JSON.stringify(settings.getSettings().models) === JSON.stringify([s.model, 'a/one', 'b/two']));

    for (const model of ['google/gemma-4-31b-it', 'nvidia/nemotron-3.5-lightning-30b-a3b']) {
      await settings.updateSettings({ model });
      const a = await org.analyzeDirectory(d, 'smart', llm.smartGrouper);
      ok(`switch to ${model}: request used it`, seen.at(-1).model === model);
      ok('  Vietnamese folder name with diacritics kept', a.plan.filter(p => p.destination?.includes('Hóa đơn')).length === 2);
    }
    ok('prompt asks for folder names in the files\' language', seen.at(-1).messages[0].content.includes('Write ALL folder names in Vietnamese'));

    await settings.updateSettings({ model: 'flaky/model' });
    const before = seen.length;
    const a = await org.analyzeDirectory(d, 'smart', llm.smartGrouper);
    ok('broken JSON -> one retry -> success', seen.length - before === 2 && a.plan.filter(p => p.kind === 'move').length === 2);

    await settings.updateSettings({ model: 'thinker/model' });
    try { await org.analyzeDirectory(d, 'smart', llm.smartGrouper); ok('token limit error', false); }
    catch (e) { ok(`token limit -> "${e.message.slice(0, 80)}…"`, /ran out of output tokens/.test(e.message)); }
  } catch (e) { console.log('ERROR', e.stack); }
  server.close();
  rmSync(d, { recursive: true, force: true });
  // userData stays locked until Electron exits; tests/electron/run.mjs removes it afterwards.
  app.quit();
});
