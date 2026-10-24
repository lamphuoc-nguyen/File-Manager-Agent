import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AiSettings, AiSettingsUpdate } from './ai-types.js';

// NVIDIA's API (build.nvidia.com) is OpenAI-compatible, so any OpenAI-style endpoint works here too.
export const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
// Starting quick-switch list; IDs on build.nvidia.com change and get retired over time,
// so users edit this in AI settings (List checks it against the account).
export const DEFAULT_MODELS = [
  'google/gemma-4-31b-it',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'deepseek-ai/deepseek-v4.1-flash',
];
export const DEFAULT_MODEL = DEFAULT_MODELS[0];

interface StoredSettings {
  baseUrl: string;
  model: string;
  models?: string[];
  /** API key encrypted with safeStorage (DPAPI on Windows), base64. */
  apiKeyEnc?: string;
}

const settingsPath = () => join(app.getPath('userData'), 'ai-settings.json');

function load(): StoredSettings {
  try {
    if (existsSync(settingsPath())) return { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, ...JSON.parse(readFileSync(settingsPath(), 'utf-8')) };
  } catch { }
  return { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL };
}

function save(s: StoredSettings) {
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
}

/** The key never leaves the main process; falls back to the NVIDIA_API_KEY env var. */
export function getApiKey(): string | undefined {
  const s = load();
  if (s.apiKeyEnc) {
    try { return safeStorage.decryptString(Buffer.from(s.apiKeyEnc, 'base64')); } catch { }
  }
  return process.env.NVIDIA_API_KEY || undefined;
}

export function getSettings(): AiSettings {
  const s = load();
  const key = getApiKey();
  const models = s.models ?? DEFAULT_MODELS;
  return {
    baseUrl: s.baseUrl,
    model: s.model,
    models: models.includes(s.model) ? models : [s.model, ...models],
    hasKey: !!key,
    keyHint: key ? `${key.slice(0, 6)}…${key.slice(-4)}` : undefined,
    keySource: s.apiKeyEnc ? 'saved' : key ? 'env' : undefined,
  };
}

/** Validates the API base URL; catches the common mistake of pasting the NVIDIA website address. */
function normalizeBaseUrl(input: string): string {
  const value = input.trim().replace(/\/+$/, '');
  if (!value) return DEFAULT_BASE_URL;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`"${value}" is not a valid URL. For NVIDIA use ${DEFAULT_BASE_URL}`); }
  if (!/^https?:$/.test(url.protocol)) throw new Error(`The base URL must start with https://. For NVIDIA use ${DEFAULT_BASE_URL}`);
  if (/(^|\.)build\.nvidia\.com$/.test(url.hostname) || url.hostname === 'nvidia.com' || url.hostname === 'www.nvidia.com') {
    throw new Error(`${url.hostname} is NVIDIA's website, not the API. Use ${DEFAULT_BASE_URL} (click "Reset").`);
  }
  return value;
}

export function updateSettings(update: AiSettingsUpdate): AiSettings {
  const s = load();
  if (update.baseUrl !== undefined) s.baseUrl = normalizeBaseUrl(update.baseUrl);
  if (update.model !== undefined) s.model = update.model.trim() || DEFAULT_MODEL;
  if (update.models !== undefined) s.models = [...new Set(update.models.map(m => m.trim()).filter(Boolean))];
  if (update.apiKey !== undefined) {
    const key = update.apiKey.trim();
    if (!key) delete s.apiKeyEnc;
    else {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this system');
      s.apiKeyEnc = safeStorage.encryptString(key).toString('base64');
    }
  }
  save(s);
  return getSettings();
}
