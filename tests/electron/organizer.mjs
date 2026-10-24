import { DIST, TMP } from './_env.mjs';
import { app } from 'electron';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
const org = await import(DIST + 'organizer.js');
const ok = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n);
app.whenReady().then(async () => {
  try {
    const d = mkdtempSync(TMP + 'orgtest-');
    for (const f of ['photo.JPG', 'scan.png', 'report.pdf', 'notes.txt', 'budget.xlsx', 'setup.exe', 'song.mp3', 'backup.zip', 'mystery.xyz', 'noext'])
      writeFileSync(join(d, f), 'content of ' + f);
    writeFileSync(join(d, 'report (copy).pdf'), 'content of report.pdf'); // duplicate content
    writeFileSync(join(d, 'desktop.ini'), 'x');
    writeFileSync(join(d, 'big.iso.crdownload'), 'x');
    writeFileSync(join(d, '~$draft.docx'), 'x');
    mkdirSync(join(d, 'Images')); writeFileSync(join(d, 'Images', 'photo.JPG'), 'older photo'); // name conflict
    mkdirSync(join(d, 'Old stuff'));
    const before = readdirSync(d).sort();

    const a = await org.analyzeDirectory(d, 'type');
    console.log('categories:', a.categories.map(c => `${c.category}=${c.count}`).join(' '));
    console.log('plan:'); a.plan.forEach(p => console.log(`  ${p.kind} ${p.source.split(/[\/]/).pop()} -> ${p.destination ? p.destination.slice(d.length + 1) : 'RecycleBin'} [${p.reason}] ${p.recommended ? '' : '(unticked)'}`));
    ok('skipped system/temp/lock files', a.skipped.length === 3);
    ok('found duplicate', a.duplicateGroups.length === 1);
    ok('found empty folder', a.emptyFolders.length === 1);
    ok('conflict renamed to photo (2).JPG', a.plan.some(p => p.destination?.endsWith('photo (2).JPG')));
    ok('folders never moved', !a.plan.some(p => p.kind === 'move' && p.source.endsWith('Images')));
    const listingBefore = readdirSync(d).sort().join();
    ok('analysis changed nothing on disk', listingBefore === before.join());

    const recommended = a.plan.filter(p => p.recommended);
    const res = await org.applyPlan(recommended);
    ok(`apply: ${res.applied.filter(r => r.ok).length}/${res.applied.length} ok`, res.applied.every(r => r.ok));
    console.log('after apply:', readdirSync(d).sort().join(', '));
    ok('duplicate left alone (unticked)', existsSync(join(d, 'report (copy).pdf')));
    ok('existing Images/photo.JPG kept', existsSync(join(d, 'Images', 'photo.JPG')) && existsSync(join(d, 'Images', 'photo (2).JPG')));

    const date = await org.analyzeDirectory(d, 'date');
    ok('date strategy groups by YYYY-MM', date.plan.filter(p => p.kind === 'move').every(p => /^\d{4}-\d{2}$/.test(p.destination.slice(d.length + 1).split(/[\\/]/)[0])));

    const undone = await org.undoApply(res);
    ok(`undo: ${undone.applied.filter(r => r.ok).length} moved back`, undone.applied.every(r => r.ok));
    const after = readdirSync(d).sort();
    ok('undo restores original layout exactly', after.join() === before.join());
    if (after.join() !== before.join()) console.log(' before:', before.join(', '), '\n after: ', after.join(', '));
    rmSync(d, { recursive: true, force: true });
  } catch (e) { console.log('ERROR', e.stack); }
  app.quit();
});
