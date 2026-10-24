import { DIST, TMP } from './_env.mjs';
import { app } from 'electron';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, basename } from 'path';
import { startMock } from './mock-llm.mjs';
import { makeDocx, makeXlsx, makePptx, makePdf } from './mkdocs.mjs';

const userData = mkdtempSync(TMP + 'cttest-ud-');
app.setPath('userData', userData);
const D = DIST + '';
const settings = await import(D + 'settings.js');
const llm = await import(D + 'llm.js');
const org = await import(D + 'organizer.js');
const { extractText } = await import(D + 'extract.js');
const ok = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n);

app.whenReady().then(async () => {
  const { server, log } = await startMock();
  const d = mkdtempSync(TMP + 'cttest-fx-');
  try {
    // Uninformative names: only the contents say what these are.
    makePdf(join(d, 'scan_001.pdf'), 'INVOICE No. 2025-031  Total due 420 USD');
    makePdf(join(d, 'scan_002.pdf'), 'INVOICE No. 2025-032  Total due 99 USD');
    makeDocx(join(d, 'doc1.docx'), ['EMPLOYMENT AGREEMENT', 'This agreement is made between &amp; ACME Corp and the employee.']);
    makeXlsx(join(d, 'data.xlsx'), ['Household budget 2025', 'Rent', 'Groceries']);
    makePptx(join(d, 'slides.pptx'), ['Lecture 3', 'Neural networks and backpropagation']);
    writeFileSync(join(d, 'notes.txt'), 'Random thoughts, nothing in particular.');
    writeFileSync(join(d, 'weird.txt'), Buffer.from([0x50, 0x4b, 0x00, 0x01, 0x02]));
    writeFileSync(join(d, 'broken.docx'), 'not a zip at all');
    mkdirSync(join(d, 'Invoices')); writeFileSync(join(d, 'Invoices', 'old.pdf'), 'x');
    for (const p of ['webapp', 'cli-tool']) { mkdirSync(join(d, p, 'src'), { recursive: true }); writeFileSync(join(d, p, 'package.json'), '{}'); }
    mkdirSync(join(d, 'Zoom')); writeFileSync(join(d, 'Zoom', 'recording.mp4'), 'x');

    // --- Extraction ---
    const ex = async f => extractText(join(d, f), 200);
    ok(`pdf: ${await ex('scan_001.pdf')}`, /INVOICE No\. 2025-031/.test(await ex('scan_001.pdf')));
    ok(`docx: ${(await ex('doc1.docx'))?.replace(/\n/g, ' / ')}`, /EMPLOYMENT AGREEMENT[\s\S]*between & ACME/.test(await ex('doc1.docx')));
    ok(`xlsx: ${(await ex('data.xlsx'))?.replace(/\n/g, ' / ')}`, /Household budget 2025/.test(await ex('data.xlsx')));
    ok(`pptx: ${(await ex('slides.pptx'))?.replace(/\n/g, ' / ')}`, /Neural networks/.test(await ex('slides.pptx')));
    ok('binary .txt -> null', (await ex('weird.txt')) === null);
    ok('corrupt .docx -> null (no crash)', (await ex('broken.docx')) === null);

    settings.updateSettings({ apiKey: 'nvapi-test-123', baseUrl: 'http://127.0.0.1:8765/v1' });

    // --- Smart organize WITHOUT reading contents: names alone say nothing ---
    const blind = await org.analyzeDirectory(d, 'smart', llm.smartGrouper, { readContents: false });
    ok('without contents: no excerpts sent, documents not grouped', !log.at(-1).messages[1].content.includes('text: """') && blind.contentsRead === 0
      && !blind.plan.some(p => /scan_00|doc1|data\.xlsx|slides/.test(p.source) && p.kind === 'move'));

    // --- Smart organize WITH contents ---
    const a = await org.analyzeDirectory(d, 'smart', llm.smartGrouper, { readContents: true });
    const moves = a.plan.filter(p => p.kind === 'move').map(p => `${p.isFolder ? '[folder] ' : ''}${basename(p.source)} -> ${basename(join(p.destination, '..'))}${p.recommended ? '' : ' (unticked)'}`);
    console.log('  plan:\n   ' + moves.join('\n   '));
    ok(`contents read: ${a.contentsRead}`, a.contentsRead === 6);
    ok('scanned invoices grouped by content into existing Invoices', moves.filter(m => /^scan_00\d\.pdf -> Invoices$/.test(m)).length === 2);
    ok('contract / budget / lecture recognized', moves.includes('doc1.docx -> Contracts') && moves.includes('data.xlsx -> Budget') && moves.includes('slides.pptx -> Course - Machine Learning'));
    ok('project folders proposed as whole-folder moves, unticked', moves.includes('[folder] webapp -> Projects (unticked)') && moves.includes('[folder] cli-tool -> Projects (unticked)'));
    ok('target folder Invoices is not moved into Finance', !moves.some(m => m.startsWith('[folder] Invoices')));
    ok('app folder Zoom left alone', !moves.some(m => m.includes('Zoom')));
    ok('folder contents were shown to the model', log.at(-1).messages[1].content.includes('[folder] webapp\tcontains: package.json, src'));

    const res = await org.applyPlan(a.plan.filter(p => p.kind === 'move'));
    ok(`apply incl. folders: ${res.applied.filter(r => r.ok).length}/${res.applied.length}`, res.applied.every(r => r.ok));
    const undone = await org.undoApply(res);
    ok('undo incl. folders', undone.applied.every(r => r.ok));

    // --- Chat reads a PDF ---
    const reply = await llm.chat([{ role: 'user', content: 'what is scan_001?' }], { currentPath: d });
    ok(`chat read PDF: "${reply.content}"`, /INVOICE No\. 2025-031/.test(reply.content));
  } catch (e) { console.log('ERROR', e.stack); }
  server.close();
  rmSync(d, { recursive: true, force: true });
  // userData stays locked until Electron exits; tests/electron/run.mjs removes it afterwards.
  app.quit();
});
