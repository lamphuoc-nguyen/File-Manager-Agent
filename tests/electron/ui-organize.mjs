import { TMP } from './_env.mjs';
import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { startMock } from './mock-llm.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const userData = mkdtempSync(TMP + 'uian-ud-');
writeFileSync(join(userData, 'ai-settings.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:8765/v1', model: 'meta/llama-3.3-70b-instruct', models: ['meta/llama-3.3-70b-instruct', 'other/model'] }));
const { server, log } = await startMock();
const child = spawn(process.argv[2], [join(import.meta.dirname, 'isolated-entry.mjs'), '--remote-debugging-port=9335'], { env: { ...process.env, FM_USERDATA: userData, NVIDIA_API_KEY: 'nvapi-test-123' }, stdio: 'ignore' });
let target;
for (let i = 0; i < 40 && !target; i++) { try { target = (await (await fetch('http://127.0.0.1:9335/json')).json()).find(t => t.type === 'page' && !t.url.startsWith('devtools')); } catch {} if (!target) await sleep(500); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = {};
ws.onmessage = m => { const d = JSON.parse(m.data); pending[d.id]?.(d); };
const ev = expr => new Promise(r => { const i = ++id; pending[i] = d => r(d.result?.result?.value ?? d.result?.exceptionDetails?.exception?.description ?? d); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })); });
const pick = (sel, v) => ev(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s, ${JSON.stringify(v)}); s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
const clickText = t => ev(`[...document.querySelectorAll('.modal-wide button, .toolbar button')].find(b=>b.innerText.trim().endsWith(${JSON.stringify(t)})).click()`);
const ok = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n);
const organizeRequests = () => log.filter(r => r.messages[0].content.includes('You organize a messy folder')).length;
try {
  await sleep(3000);
  await clickText('Organize'); await sleep(1500);
  ok('Organize opens the window', await ev(`!!document.querySelector('.modal-wide')`));
  ok('...without analyzing (0 AI requests, no plan)', organizeRequests() === 0 && !(await ev(`!!document.querySelector('.organizer-plan, .organizer-stats')`)));
  console.log('  prompt:', await ev(`document.querySelector('.modal-wide .organizer-empty')?.innerText.replace(/\s+/g,' ')`));
  await pick('.organizer-controls select.form-input', 'type'); await sleep(800);
  await pick('.organizer-controls select.form-input', 'smart'); await sleep(800);
  await ev(`document.querySelector('.organizer-option input').click()`); await sleep(500);
  await ev(`document.querySelector('.organizer-option input').click()`); await sleep(500);
  ok('changing strategy / Read contents does not analyze', organizeRequests() === 0 && !(await ev(`!!document.querySelector('.organizer-stats')`)));
  await clickText('Analyze'); await sleep(4000);
  ok('Analyze runs it (1 request, plan shown)', organizeRequests() >= 1 && await ev(`!!document.querySelector('.organizer-stats')`));
  const n = organizeRequests();
  await pick('.organizer-controls select.form-input', 'date'); await sleep(800);
  ok('changing strategy after: no new request', organizeRequests() === n);
  ok('stale warning shown and Apply disabled', await ev(`!![...document.querySelectorAll('.organizer-warning')].find(e=>e.innerText.includes('Options changed'))`) && await ev(`document.querySelector('.modal-wide .modal-footer .btn:last-child').disabled`));
  await clickText('Re-analyze'); await sleep(2500);
  ok('Re-analyze by date clears the warning', !(await ev(`!![...document.querySelectorAll('.organizer-warning')].find(e=>e.innerText.includes('Options changed'))`)));
} catch (e) { console.log('ERROR', e.message); }
finally { ws.close(); child.kill(); server.close(); await sleep(1500); rmSync(userData, { recursive: true, force: true }); }
process.exit(0);
