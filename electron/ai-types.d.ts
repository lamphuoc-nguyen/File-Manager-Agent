// Shared between main, preload and renderer. Declaration-only so it is never emitted.

export interface AiSettings {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  /** e.g. "nvapi-…a1b2", for display only; the full key never reaches the renderer. */
  keyHint?: string;
  keySource?: 'saved' | 'env';
}

export interface AiSettingsUpdate {
  baseUrl?: string;
  model?: string;
  /** Empty string removes the saved key. */
  apiKey?: string;
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiToolCall {
  name: string;
  args: Record<string, any>;
  ok: boolean;
  summary: string;
}

export interface AiChatReply {
  content: string;
  toolCalls: AiToolCall[];
}
