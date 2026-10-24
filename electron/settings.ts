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
  thinking?: boolean;
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

// safeStorage is async-only from Electron 46, so the key is decrypted once (initApiKey) and kept
// here; getApiKey/getSettings stay synchronous for their callers.
let cachedKey: string | undefined;

/** Decrypts the saved key into memory. Call once at startup, before any IPC can use the key. */
export async function initApiKey(): Promise<void> {
  cachedKey = undefined;
  const s = load();
  if (!s.apiKeyEnc) return;
  try {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(s.apiKeyEnc, 'base64'));
    cachedKey = result;
    if (shouldReEncrypt) {
      const apiKeyEnc = (await safeStorage.encryptStringAsync(result)).toString('base64');
      save({ ...load(), apiKeyEnc });
    }
  } catch { } // undecryptable (e.g. another Windows user): fall back to the env var
}

/** The key never leaves the main process; falls back to the NVIDIA_API_KEY env var. */
export function getApiKey(): string | undefined {
  return cachedKey || process.env.NVIDIA_API_KEY || undefined;
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
    thinking: s.thinking ?? false,
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

export async function updateSettings(update: AiSettingsUpdate): Promise<AiSettings> {
  // Validate and encrypt first. Nothing may be awaited between load() and save(), or two
  // updates in flight (e.g. a model switch while a key is saved) would overwrite each other.
  const baseUrl = update.baseUrl !== undefined ? normalizeBaseUrl(update.baseUrl) : undefined;
  const key = update.apiKey?.trim();
  let apiKeyEnc: string | undefined;
  if (key) {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('Secure storage is not available on this system');
    apiKeyEnc = (await safeStorage.encryptStringAsync(key)).toString('base64');
  }

  const s = load();
  if (baseUrl !== undefined) s.baseUrl = baseUrl;
  if (update.model !== undefined) s.model = update.model.trim() || DEFAULT_MODEL;
  if (update.thinking !== undefined) s.thinking = update.thinking;
  if (update.models !== undefined) s.models = [...new Set(update.models.map(m => m.trim()).filter(Boolean))];
  if (key !== undefined) {
    if (apiKeyEnc) s.apiKeyEnc = apiKeyEnc;
    else delete s.apiKeyEnc;
  }
  save(s);
  if (key !== undefined) cachedKey = key || undefined;
  return getSettings();
}
