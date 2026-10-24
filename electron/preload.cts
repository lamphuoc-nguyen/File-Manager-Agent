import { contextBridge, ipcRenderer } from 'electron';
import type { OrganizeStrategy, DirectoryAnalysis, PlanItem, ApplyResult } from './organizer-types.js';

const api = {
  // Filesystem
  fs: {
    getDrives: (): Promise<string[]> => ipcRenderer.invoke('fs:getDrives'),
    getHome: (): Promise<string> => ipcRenderer.invoke('fs:getHome'),
    list: (path: string): Promise<any[]> => ipcRenderer.invoke('fs:list', path),
    read: (path: string, encoding?: 'utf-8' | 'base64'): Promise<string> => ipcRenderer.invoke('fs:read', path, encoding),
    write: (path: string, content: string, encoding?: 'utf-8' | 'base64'): Promise<{ success: boolean }> => ipcRenderer.invoke('fs:write', path, content, encoding),
    /** Moves to the Recycle Bin / Trash. */
    delete: (path: string): Promise<{ success: boolean }> => ipcRenderer.invoke('fs:delete', path),
    move: (source: string, dest: string, overwrite?: boolean): Promise<{ success: boolean }> => ipcRenderer.invoke('fs:move', source, dest, overwrite),
    copy: (source: string, dest: string, recursive?: boolean, overwrite?: boolean): Promise<{ success: boolean }> => ipcRenderer.invoke('fs:copy', source, dest, recursive, overwrite),
    mkdir: (path: string): Promise<{ success: boolean }> => ipcRenderer.invoke('fs:mkdir', path),
    stat: (path: string): Promise<any> => ipcRenderer.invoke('fs:stat', path),
    search: (root: string, pattern: string, maxResults?: number): Promise<string[]> => ipcRenderer.invoke('fs:search', root, pattern, maxResults),
    grep: (root: string, pattern: string, filePattern?: string, maxResults?: number): Promise<any[]> => ipcRenderer.invoke('fs:grep', root, pattern, filePattern, maxResults),
    open: (path: string): Promise<{ success: boolean }> => ipcRenderer.invoke('fs:open', path),
    showInFolder: (path: string): Promise<{ success: boolean }> => ipcRenderer.invoke('fs:showInFolder', path),
  },

  // Directory analysis & organization
  organize: {
    analyze: (path: string, strategy?: OrganizeStrategy): Promise<DirectoryAnalysis> => ipcRenderer.invoke('organize:analyze', path, strategy),
    apply: (items: PlanItem[]): Promise<ApplyResult> => ipcRenderer.invoke('organize:apply', items),
    undo: (result: ApplyResult): Promise<ApplyResult> => ipcRenderer.invoke('organize:undo', result),
  },

  // Dialogs
  dialog: {
    openDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),
    openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
    saveFile: (defaultPath: string): Promise<string | null> => ipcRenderer.invoke('dialog:saveFile', defaultPath),
  },

  // Agents
  agent: {
    list: (): Promise<any[]> => ipcRenderer.invoke('agent:list'),
    get: (id: string): Promise<any> => ipcRenderer.invoke('agent:get', id),
    load: (id: string): Promise<any> => ipcRenderer.invoke('agent:load', id),
    tools: (): Promise<any[]> => ipcRenderer.invoke('agent:tools'),
    execute: (agentId: string, toolName: string, args: Record<string, any>): Promise<any> => ipcRenderer.invoke('agent:execute', agentId, toolName, args),
    registerAll: (): Promise<any[]> => ipcRenderer.invoke('agent:registerAll'),
    create: (config: any): Promise<any> => ipcRenderer.invoke('agent:create', config),
  },
};

export type Api = typeof api;

contextBridge.exposeInMainWorld('api', api);
