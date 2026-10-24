// Checks that every way a connection can fail produces a clear, actionable message.
import { DIST, TMP } from './_env.mjs';
import { app } from 'electron';
import http from 'http';
import { mkdtempSync, rmSync } from 'fs';

const userData = mkdtempSync(TMP + 'errtest-ud-');
app.setPath('userData', userData);
const D = DIST + '';
const settings = await import(D + 'settings.js');
const llm = await import(D + 'llm.js');
const ok = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n);
const expectError = async (name, fn, re) => {
  try { await fn(); ok(`${name} (no error)`, false); }
  catch (e) { ok(`${name} -> ${e.message.slice(0, 120)}`, re.test(e.message)); }
};

const server = http.createServer(async (req, res) => {
  for await (const _ of req);
  if (req.url.startsWith('/html')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!DOCTYPE html><html>NVIDIA</html>'); }
  if (req.url.startsWith('/gone')) { res.writeHead(410); return res.end('{"detail":"end of life"}'); }
  if (req.url.startsWith('/slow')) return; // never answers
  res.writeHead(500); res.end();
});
await new Promise(r => server.listen(8768, '127.0.0.1', r));

app.whenReady().then(async () => {
  try {
    ok(`default model is ${settings.getSettings().model} (llama retired)`, settings.getSettings().model === 'google/gemma-4-31b-it' && !settings.getSettings().models.some(m => m.includes('llama-3.3')));
    await expectError('no key', () => llm.testConnection(), /No API key set/);
    await expectError('website URL rejected on save', async () => settings.updateSettings({ baseUrl: 'https://build.nvidia.com' }), /NVIDIA's website, not the API/);
    await expectError('website URL with path rejected', async () => settings.updateSettings({ baseUrl: 'https://build.nvidia.com/models' }), /website/);
    await expectError('not a URL rejected', async () => settings.updateSettings({ baseUrl: 'integrate api' }), /not a valid URL/);
    ok('bad URL did not overwrite the saved one', settings.getSettings().baseUrl === 'https://integrate.api.nvidia.com/v1');

    // Real NVIDIA endpoint with an obviously fake key: must say the key is rejected.
    settings.updateSettings({ apiKey: 'nvapi-this-is-not-a-real-key-000000000000' });
    await expectError('real NVIDIA + fake key', () => llm.testConnection(), /API key rejected/);

    settings.updateSettings({ baseUrl: 'http://127.0.0.1:8768/html' });
    await expectError('web page response', () => llm.testConnection(), /returned a web page/);
    settings.updateSettings({ baseUrl: 'http://127.0.0.1:8768/gone' });
    await expectError('retired model (410)', () => llm.testConnection(), /retired by NVIDIA/);
    settings.updateSettings({ baseUrl: 'http://127.0.0.1:1' });
    await expectError('unreachable server', () => llm.testConnection(), /Cannot reach/);
    settings.updateSettings({ baseUrl: 'http://127.0.0.1:8768/slow' });
    const t = Date.now();
    await expectError('timeout', () => llm.testConnection(), /No answer from .* within 60s/);
    ok(`test timeout is ~60s (${Math.round((Date.now() - t) / 1000)}s)`, Date.now() - t < 70_000);
  } catch (e) { console.log('ERROR', e.stack); }
  server.close();
  // userData stays locked until Electron exits; tests/electron/run.mjs removes it afterwards.
  app.quit();
});
