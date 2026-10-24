// Agent discovery, validation (zod schemas) and registry persistence.
import { DIST, ROOT, TMP } from './_env.mjs';
import { app } from 'electron';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const { createAgentRegistryManager } = await import(DIST + 'lib/agent-manager/src/index.js');
const ok = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n);
const CUSTOM_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

app.whenReady().then(() => {
  try {
    const dir = mkdtempSync(TMP + 'registry-');
    const agentsDir = join(dir, 'agents');
    cpSync(join(ROOT, 'agents'), agentsDir, { recursive: true });
    // An agent using the record-typed fields (tool parameters, skill config) the samples don't use.
    const base = JSON.parse(readFileSync(join(ROOT, 'agents', 'general', 'general-assistant-v1.0.0.json'), 'utf8'));
    const custom = {
      ...base,
      id: CUSTOM_ID,
      name: 'Custom Params Agent',
      tools: [{ name: 'lookup', description: 'Look something up', type: 'function', parameters: { type: 'object', properties: { q: { type: 'string' } } }, enabled: true }],
      skills: [{ name: 'summarize', version: '1.0.0', enabled: true, config: { depth: 2, style: 'brief' } }],
    };
    mkdirSync(join(agentsDir, 'custom'));
    writeFileSync(join(agentsDir, 'custom', 'custom-params-v1.0.0.json'), JSON.stringify(custom));
    writeFileSync(join(agentsDir, 'custom', 'broken-v1.0.0.json'), JSON.stringify({ ...base, id: 'not-a-uuid', name: undefined }));

    const registryFile = join(dir, 'registry.json');
    const reg = createAgentRegistryManager(agentsDir, { agentsDir, registryFile });
    const names = reg.registerAllDiscovered().map(a => a.name).sort();
    ok(`registers the 4 sample agents + custom (${names.join(', ')})`,
      ['Code Reviewer', 'Custom Params Agent', 'Data Analyst', 'Deployment Pipeline', 'General Assistant'].every(n => names.includes(n)) && names.length === 5);
    ok('invalid agent config is skipped', !names.includes(undefined) && names.length === 5);

    const loaded = reg.loadAgent(CUSTOM_ID);
    ok('tool parameters (record field) round-trip', JSON.stringify(loaded.tools[0].parameters) === JSON.stringify(custom.tools[0].parameters));
    ok('skill config (record field) round-trip', loaded.skills[0].config.depth === 2 && loaded.skills[0].config.style === 'brief');

    const reopened = createAgentRegistryManager(agentsDir, { agentsDir, registryFile });
    ok('registry persists and re-validates on reload', reopened.listAgents().length === 5 && !!reopened.loadAgent(CUSTOM_ID));
  } catch (e) { console.log('ERROR', e.stack); }
  app.quit();
});
