import React, { useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, Plus, X, XCircle } from 'lucide-react';
import type { AiSettings as Settings } from '../../electron/ai-types';

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

interface Props {
  settings: Settings;
  onSaved: (settings: Settings) => void;
  onClose: () => void;
}

export function AiSettings({ settings, onSaved, onClose }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(settings.model);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [models, setModels] = useState<string[]>([]);
  const [quickList, setQuickList] = useState<string[]>(settings.models);
  const [thinking, setThinking] = useState(settings.thinking);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'models' | null>(null);
  const available = new Set(models);

  // Save first so test/model listing use exactly what's on screen.
  const persist = async () => {
    const update: Parameters<typeof window.api.ai.updateSettings>[0] = { model, baseUrl, models: quickList, thinking };
    if (apiKey.trim()) update.apiKey = apiKey.trim();
    const saved = await window.api.ai.updateSettings(update);
    setApiKey('');
    onSaved(saved);
    return saved;
  };

  const run = async (kind: 'save' | 'test' | 'models', fn: () => Promise<void>) => {
    setBusy(kind);
    setStatus(null);
    try { await fn(); }
    catch (e: any) { setStatus({ ok: false, text: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }); }
    finally { setBusy(null); }
  };

  const save = () => run('save', async () => { await persist(); onClose(); });

  const test = () => run('test', async () => {
    const saved = await persist();
    if (!saved.hasKey) throw new Error('Enter an API key first');
    const reply = await window.api.ai.test();
    setStatus({ ok: true, text: `Connected to ${saved.model}. Model replied: "${reply.slice(0, 60)}"` });
  });

  const loadModels = () => run('models', async () => {
    await persist();
    const list = await window.api.ai.listModels();
    setModels(list);
    const missing = quickList.filter(m => !list.includes(m));
    setStatus({
      ok: missing.length === 0,
      text: `${list.length} models available on your account.` + (missing.length ? ` Not found: ${missing.join(', ')}. Remove them or check the exact ID.` : ''),
    });
  });

  const addToQuickList = () => {
    const m = model.trim();
    if (m && !quickList.includes(m)) setQuickList([...quickList, m]);
  };

  const removeKey = () => run('save', async () => {
    onSaved(await window.api.ai.updateSettings({ apiKey: '' }));
    setStatus({ ok: true, text: 'Saved key removed' });
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><KeyRound size={16} /> AI settings</span>
          <button className="btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">NVIDIA API key</label>
            <input
              className="form-input"
              type="password"
              autoFocus
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={settings.hasKey ? `Saved: ${settings.keyHint} (leave empty to keep)` : 'nvapi-...'}
            />
            <p className="organizer-muted" style={{ marginTop: 4 }}>
              Get one at build.nvidia.com. Stored encrypted with Windows data protection; it never leaves this PC except to call the API.
              {settings.keySource === 'env' && ' Currently using the NVIDIA_API_KEY environment variable.'}
            </p>
          </div>
          <div className="form-group">
            <label className="form-label">Active model</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="form-input" list="ai-models" value={model} onChange={e => setModel(e.target.value)} placeholder="e.g. google/gemma-4-31b-it" />
              <button className="btn" onClick={addToQuickList} disabled={!model.trim() || quickList.includes(model.trim())} title="Add to the quick-switch list">
                <Plus size={14} />
              </button>
              <button className="btn" onClick={loadModels} disabled={!!busy} title="Load the models your account can use, and check the quick list against it">
                {busy === 'models' ? <Loader2 size={14} className="animate-spin" /> : 'List'}
              </button>
            </div>
            <datalist id="ai-models">
              {(models.length ? models : quickList).map(m => <option key={m} value={m} />)}
            </datalist>
          </div>
          <div className="form-group">
            <label className="form-label">Quick-switch list (shown in the model dropdowns)</label>
            <div className="model-chips">
              {quickList.map(m => (
                <span
                  key={m}
                  className={`model-chip ${m === model ? 'active' : ''} ${models.length && !available.has(m) ? 'missing' : ''}`}
                  title={models.length && !available.has(m) ? 'Not available on your account' : 'Click to make active'}
                >
                  <button className="model-chip-name" onClick={() => setModel(m)}>{m}</button>
                  <button className="model-chip-remove" onClick={() => setQuickList(quickList.filter(x => x !== m))} title="Remove from list"><X size={12} /></button>
                </span>
              ))}
              {quickList.length === 0 && <span className="organizer-muted">Empty. Type a model ID above and press +.</span>}
            </div>
          </div>
          <div className="form-group">
            <label className="organizer-option" style={{ marginBottom: 0 }}>
              <input type="checkbox" checked={thinking} onChange={e => setThinking(e.target.checked)} />
              <span>
                <strong>Let the model think before answering</strong>
                <span className="organizer-muted"> — off by default. Reasoning models (Nemotron, DeepSeek…) use about 7× more tokens and time
                  when thinking, and big folders can run out of tokens. Sorting files rarely needs it.</span>
              </span>
            </label>
          </div>
          <div className="form-group">
            <label className="form-label">API base URL</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="form-input" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder={NVIDIA_BASE_URL} />
              <button className="btn" onClick={() => setBaseUrl(NVIDIA_BASE_URL)} disabled={baseUrl === NVIDIA_BASE_URL} title={`Reset to ${NVIDIA_BASE_URL}`}>Reset</button>
            </div>
            <p className="organizer-muted" style={{ marginTop: 4 }}>Any OpenAI-compatible endpoint works (NVIDIA NIM, OpenAI, a local server).</p>
          </div>
          {status && (
            <div className="ai-status" style={{ color: status.ok ? 'var(--success)' : 'var(--danger)' }}>
              {status.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} <span>{status.text}</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          {settings.keySource === 'saved' && (
            <button className="btn btn-danger" onClick={removeKey} disabled={!!busy} style={{ marginRight: 'auto' }}>Remove key</button>
          )}
          <button className="btn" onClick={test} disabled={!!busy}>
            {busy === 'test' && <Loader2 size={14} className="animate-spin" />} Test connection
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!!busy}>Save</button>
        </div>
      </div>
    </div>
  );
}
