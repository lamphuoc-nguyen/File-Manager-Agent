import type { Api } from '../electron/preload.cjs';

declare global {
  interface Window {
    api: Api;
  }
}

export {};
