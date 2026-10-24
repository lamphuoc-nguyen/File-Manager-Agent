// Schemas
export * from './schemas/agent-config.js';

// Registry
export {
  ElectronAgentRegistryManager,
  createAgentRegistryManager,
} from './registry/agent-registry.js';

// Tools
export {
  FILESYSTEM_TOOLS,
  type ToolResult,
  type FileInfo,
  type SearchResult,
} from './tools/filesystem-tools.js';

// Utilities
export { generateUUID, isValidUUID } from './utils/id.js';

// Types
export type {
  ModelProvider,
  ModelConfig,
  ToolConfig,
  SkillConfig,
  MemoryConfig,
  PersonaConfig,
  AgentConfig,
  AgentDirectoryConfig,
  AgentRegistryEntry,
  AgentRegistry,
} from './schemas/agent-config.js';