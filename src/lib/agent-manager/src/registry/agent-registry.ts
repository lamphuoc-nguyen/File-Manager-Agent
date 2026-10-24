import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  AgentConfig,
  AgentConfigSchema,
  AgentRegistry,
  AgentRegistryEntry,
  AgentRegistrySchema,
  AgentDirectoryConfig,
  validateAgentConfig,
  safeValidateAgentConfig,
} from '../schemas/agent-config.js';
import { generateUUID } from '../utils/id.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_CONFIG: AgentDirectoryConfig = {
  version: '1.0.0',
  agentsDir: './agents',
  registryFile: 'registry.json',
  autoDiscover: true,
  validateOnLoad: true,
};

export class ElectronAgentRegistryManager {
  private config: AgentDirectoryConfig;
  private registry: AgentRegistry;
  private appRoot: string;
  private agentsDir: string;
  private registryPath: string;

  constructor(appRoot: string, config?: Partial<AgentDirectoryConfig>) {
    this.appRoot = resolve(appRoot);
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.agentsDir = resolve(this.appRoot, this.config.agentsDir);
    this.registryPath = resolve(this.appRoot, this.config.registryFile);
    this.registry = this.loadRegistry();
  }

  private loadRegistry(): AgentRegistry {
    if (existsSync(this.registryPath)) {
      try {
        const content = readFileSync(this.registryPath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = safeValidateAgentConfig(parsed);
        if (result.success) {
          return parsed as AgentRegistry;
        }
      } catch { }
    }
    return { version: '1.0.0', agents: [], lastUpdated: new Date().toISOString() };
  }

  private saveRegistry(): void {
    this.registry.lastUpdated = new Date().toISOString();
    const dir = dirname(this.registryPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2));
  }

  discoverAgents(): string[] {
    const configFiles: string[] = [];
    if (!existsSync(this.agentsDir)) return configFiles;
    const scan = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) scan(full);
        else if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
          configFiles.push(full);
        }
      }
    };
    scan(this.agentsDir);
    return configFiles;
  }

  loadAgentConfig(filePath: string): AgentConfig {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = filePath.endsWith('.yaml') || filePath.endsWith('.yml')
      ? require('yaml').parse(content)
      : JSON.parse(content);
    return validateAgentConfig(parsed);
  }

  registerAgent(configPath: string): AgentRegistryEntry {
    const absolute = resolve(this.appRoot, configPath);
    const config = this.loadAgentConfig(absolute);
    const existing = this.registry.agents.findIndex(a => a.id === config.id);
    const relative = join(this.config.agentsDir, configPath.replace(this.agentsDir + '/', ''));
    const entry: AgentRegistryEntry = {
      id: config.id,
      name: config.name,
      version: config.version,
      description: config.description,
      category: config.category ?? 'general',
      tags: config.tags,
      configPath: relative,
      enabled: true,
      registeredAt: existing >= 0 ? this.registry.agents[existing].registeredAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (existing >= 0) this.registry.agents[existing] = entry;
    else this.registry.agents.push(entry);
    this.saveRegistry();
    return entry;
  }

  registerAllDiscovered(): AgentRegistryEntry[] {
    const files = this.discoverAgents();
    return files.map(f => { try { return this.registerAgent(f); } catch { return null; } }).filter(Boolean) as AgentRegistryEntry[];
  }

  unregisterAgent(id: string): boolean {
    const i = this.registry.agents.findIndex(a => a.id === id);
    if (i >= 0) { this.registry.agents.splice(i, 1); this.saveRegistry(); return true; }
    return false;
  }

  getAgent(id: string): AgentRegistryEntry | undefined {
    return this.registry.agents.find(a => a.id === id);
  }

  getAgentByName(name: string): AgentRegistryEntry | undefined {
    return this.registry.agents.find(a => a.name === name);
  }

  listAgents(opts?: { enabledOnly?: boolean; category?: string; tag?: string }): AgentRegistryEntry[] {
    let a = this.registry.agents;
    if (opts?.enabledOnly) a = a.filter(x => x.enabled);
    if (opts?.category) a = a.filter(x => x.category === opts.category);
    if (opts?.tag) a = a.filter(x => x.tags.includes(opts.tag!));
    return a;
  }

  loadAgent(id: string): AgentConfig | null {
    const e = this.getAgent(id);
    if (!e) return null;
    return this.loadAgentConfig(resolve(this.appRoot, e.configPath));
  }

  setEnabled(id: string, v: boolean): boolean {
    const e = this.getAgent(id);
    if (!e) return false;
    e.enabled = v; e.updatedAt = new Date().toISOString(); this.saveRegistry(); return true;
  }

  getRegistry(): AgentRegistry { return { ...this.registry }; }
  getConfig(): AgentDirectoryConfig { return { ...this.config }; }
}

export function createAgentRegistryManager(appRoot: string, config?: Partial<AgentDirectoryConfig>) {
  return new ElectronAgentRegistryManager(appRoot, config);
}