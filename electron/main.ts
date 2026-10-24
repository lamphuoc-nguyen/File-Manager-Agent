import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync } from 'fs';
import { createAgentRegistryManager, FILESYSTEM_TOOLS, type AgentConfig, type ToolResult } from './lib/agent-manager/src/index.js';
import * as fsOps from './fs-ops.js';
import { analyzeDirectory, applyPlan, undoApply, type OrganizeStrategy, type PlanItem, type ApplyResult, type AnalyzeOptions } from './organizer.js';
import { getSettings, updateSettings } from './settings.js';
import { chat, listModels, smartGrouper, testConnection } from './llm.js';
import type { AiChatMessage, AiSettingsUpdate } from './ai-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Packaged: agents ship as extraResources. Dev: they live at the project root.
const agentsDir = app.isPackaged ? join(process.resourcesPath, 'agents') : join(__dirname, '..', 'agents');
const registryManager = createAgentRegistryManager(agentsDir, {
  agentsDir,
  registryFile: join(app.getPath('userData'), 'registry.json'),
});

let mainWindow: BrowserWindow | null = null;

// ===== Window =====
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    webPreferences: {
      // Sandboxed preloads must be CommonJS, hence the .cjs build (see tsconfig.preload.json).
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'default',
    show: false,
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  registryManager.registerAllDiscovered();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ===== Filesystem IPC Handlers =====
ipcMain.handle('fs:getDrives', async () => fsOps.getDrives());
ipcMain.handle('fs:getHome', async () => fsOps.getHome());
ipcMain.handle('fs:list', async (_, path: string) => fsOps.list(path));
ipcMain.handle('fs:read', async (_, path: string, encoding?: 'utf-8' | 'base64') => fsOps.read(path, encoding));
ipcMain.handle('fs:write', async (_, path: string, content: string, encoding?: 'utf-8' | 'base64') => fsOps.write(path, content, encoding));
ipcMain.handle('fs:delete', async (_, path: string) => fsOps.remove(path));
ipcMain.handle('fs:move', async (_, source: string, dest: string, overwrite?: boolean) => fsOps.move(source, dest, overwrite));
ipcMain.handle('fs:copy', async (_, source: string, dest: string, recursive?: boolean, overwrite?: boolean) => fsOps.copy(source, dest, recursive, overwrite));
ipcMain.handle('fs:mkdir', async (_, path: string) => fsOps.mkdir(path));
ipcMain.handle('fs:stat', async (_, path: string) => fsOps.stat(path));
ipcMain.handle('fs:search', async (_, root: string, pattern: string, maxResults?: number) => fsOps.search(root, pattern, maxResults));
ipcMain.handle('fs:grep', async (_, root: string, pattern: string, filePattern?: string, maxResults?: number) => fsOps.grep(root, pattern, filePattern, maxResults));
ipcMain.handle('fs:open', async (_, path: string) => fsOps.open(path));
ipcMain.handle('fs:showInFolder', async (_, path: string) => fsOps.showInFolder(path));

// ===== Organizer IPC Handlers =====
ipcMain.handle('organize:analyze', async (_, path: string, strategy?: OrganizeStrategy, options?: AnalyzeOptions) => {
  const started = Date.now();
  const analysis = await analyzeDirectory(path, strategy, smartGrouper, options);
  // Recorded so plans from different models can be compared side by side.
  return strategy === 'smart' ? { ...analysis, model: getSettings().model, durationMs: Date.now() - started } : analysis;
});
ipcMain.handle('organize:apply', async (_, items: PlanItem[]) => applyPlan(items));
ipcMain.handle('organize:undo', async (_, result: ApplyResult) => undoApply(result));

// ===== AI IPC Handlers =====
ipcMain.handle('ai:getSettings', async () => getSettings());
ipcMain.handle('ai:updateSettings', async (_, update: AiSettingsUpdate) => updateSettings(update));
ipcMain.handle('ai:test', async () => testConnection());
ipcMain.handle('ai:listModels', async () => listModels());
ipcMain.handle('ai:chat', async (_, history: AiChatMessage[], context: { currentPath: string; persona?: string }) => chat(history, context));

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] });
  return result.filePaths[0] || null;
});

ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'] });
  return result.filePaths[0] || null;
});

ipcMain.handle('dialog:saveFile', async (_, defaultPath: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, { defaultPath });
  return result.filePath || null;
});

// ===== Agent IPC Handlers =====
ipcMain.handle('agent:list', async () => registryManager.listAgents({ enabledOnly: true }));

ipcMain.handle('agent:get', async (_, id: string) => registryManager.getAgent(id));

ipcMain.handle('agent:load', async (_, id: string) => registryManager.loadAgent(id));

ipcMain.handle('agent:tools', async () => FILESYSTEM_TOOLS);

async function runTool(toolName: string, args: Record<string, any>): Promise<any> {
  switch (toolName) {
    case 'fs_list': return fsOps.list(args.path, args.showHidden ?? true);
    case 'fs_read': return fsOps.read(args.path, args.encoding);
    case 'fs_write': return fsOps.write(args.path, args.content, args.encoding);
    case 'fs_delete': return fsOps.remove(args.path);
    case 'fs_move': return fsOps.move(args.source, args.destination, args.overwrite);
    case 'fs_copy': return fsOps.copy(args.source, args.destination, args.recursive ?? true, args.overwrite);
    case 'fs_mkdir': return fsOps.mkdir(args.path);
    case 'fs_stat': return fsOps.stat(args.path);
    case 'fs_search': return fsOps.search(args.root, args.pattern, args.maxResults);
    case 'fs_grep': return fsOps.grep(args.root, args.pattern, args.filePattern, args.maxResults);
    case 'fs_analyze': return analyzeDirectory(args.path, args.strategy, smartGrouper, { readContents: !!args.readContents });
    case 'fs_organize': return applyPlan(args.items);
    default: throw new Error(`Tool ${toolName} is not implemented`);
  }
}

ipcMain.handle('agent:execute', async (_, agentId: string, toolName: string, args: Record<string, any>): Promise<ToolResult> => {
  if (!registryManager.getAgent(agentId)) return { success: false, error: 'Agent not found' };
  if (!FILESYSTEM_TOOLS.some(t => t.name === toolName)) return { success: false, error: `Tool ${toolName} not found` };
  try {
    return { success: true, data: await runTool(toolName, args) };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('agent:registerAll', async () => registryManager.registerAllDiscovered());

ipcMain.handle('agent:create', async (_, config: AgentConfig) => {
  const agentPath = join(agentsDir, config.category ?? 'general', `${config.name.toLowerCase().replace(/\s+/g, '-')}-v${config.version}.json`);
  mkdirSync(dirname(agentPath), { recursive: true });
  writeFileSync(agentPath, JSON.stringify(config, null, 2));
  return registryManager.registerAgent(agentPath);
});
