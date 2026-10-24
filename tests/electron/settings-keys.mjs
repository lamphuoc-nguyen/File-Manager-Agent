// API key storage on the async safeStorage API (Electron 45+; the sync API is removed in 46).
import { DIST, TMP } from './_env.mjs';
import { app, safeStorage } from 'electron';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const userData = mkdtempSync(TMP + 'keys-ud-');
app.setPath('userData', userData);
delete process.env.NVIDIA_API_KEY; // the env fallback would mask a missing saved key
const settings = await import(DIST + 'settings.js');
const ok = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n);
const file = () => join(userData, 'ai-settings.json');
const raw = () => readFileSync(file(), 'utf8');
const fails = async fn => { try { await fn(); return null; } catch (e) { return e; } };

app.whenReady().then(async () => {
  try {
    // A blob saved by the old synchronous API (what Electron 28 wrote) must still decrypt.
    process.noDeprecation = true; // the deprecated call is intentional here, nowhere else
    const legacy = safeStorage.encryptString('nvapi-legacy-blob-check-0001').toString('base64');
    process.noDeprecation = false;
    writeFileSync(file(), JSON.stringify({ baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'm1', apiKeyEnc: legacy }));
    await settings.initApiKey();
    ok('legacy sync-API blob decrypts via initApiKey', settings.getApiKey() === 'nvapi-legacy-blob-check-0001');

    await settings.updateSettings({ apiKey: 'nvapi-new-key-0002' });
    ok('updateSettings({apiKey}) is visible to getApiKey immediately', settings.getApiKey() === 'nvapi-new-key-0002');
    ok('saved file holds no plaintext key', !raw().includes('nvapi-new-key-0002') && !!JSON.parse(raw()).apiKeyEnc);
    await settings.initApiKey();
    ok('saved key survives a restart (re-init)', settings.getApiKey() === 'nvapi-new-key-0002');

    // Two updates in flight at once (key save + model switch) must both land.
    await Promise.all([settings.updateSettings({ apiKey: 'nvapi-concurrent-0003' }), settings.updateSettings({ model: 'm2' })]);
    const s = JSON.parse(raw());
    await settings.initApiKey();
    ok('concurrent updates: both the key and the model persist', s.model === 'm2' && settings.getApiKey() === 'nvapi-concurrent-0003');

    const before = raw();
    const err = await fails(() => settings.updateSettings({ apiKey: 'nvapi-should-not-save-0004', baseUrl: 'https://build.nvidia.com' }));
    ok('invalid base URL rejects and writes nothing', !!err && /website/.test(err.message) && raw() === before && settings.getApiKey() === 'nvapi-concurrent-0003');

    const real = safeStorage.isAsyncEncryptionAvailable;
    safeStorage.isAsyncEncryptionAvailable = async () => false;
    const before2 = raw();
    const err2 = await fails(() => settings.updateSettings({ apiKey: 'nvapi-no-storage-0005' }));
    safeStorage.isAsyncEncryptionAvailable = real;
    ok('unavailable secure storage rejects and writes nothing', !!err2 && /Secure storage/.test(err2.message) && raw() === before2);

    await settings.updateSettings({ apiKey: '' });
    ok('removing the key clears it', !settings.getSettings().hasKey && !JSON.parse(raw()).apiKeyEnc);
  } catch (e) { console.log('ERROR', e.stack); }
  app.quit();
});
