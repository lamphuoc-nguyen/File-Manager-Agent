import { z } from 'zod';

/**
 * Supported AI model providers
 */
export const ModelProviderSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'mistral',
  'cohere',
  'local',
  'custom'
]);

/**
 * Model configuration for an agent
 */
export const ModelConfigSchema = z.object({
  provider: ModelProviderSchema,
  model: z.string(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
});

/**
 * Tool configuration for an agent
 */
export const ToolConfigSchema = z.object({
  name: z.string(),
  description: z.string(),
  type: z.enum(['function', 'builtin', 'custom']),
  parameters: z.record(z.unknown()).optional(),
  handler: z.string().optional(),
  enabled: z.boolean().default(true),
});

/**
 * Skill configuration for an agent
 */
export const SkillConfigSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  enabled: z.boolean().default(true),
  config: z.record(z.unknown()).optional(),
});

/**
 * Memory configuration for an agent
 */
export const MemoryConfigSchema = z.object({
  type: z.enum(['none', 'short-term', 'long-term', 'vector', 'hybrid']),
  maxMessages: z.number().positive().default(50),
  maxTokens: z.number().positive().optional(),
});

/**
 * Agent persona configuration
 */
export const PersonaConfigSchema = z.object({
  name: z.string(),
  role: z.string(),
  description: z.string(),
  instructions: z.string(),
  tone: z.enum(['professional', 'casual', 'technical', 'friendly', 'authoritative']).optional(),
  language: z.string().default('en'),
});

/**
 * Agent configuration schema
 */
export const AgentConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).default([]),
  category: z.enum(['general', 'coding', 'analysis', 'creative', 'research', 'workflow', 'filesystem', 'custom']).default('general'),
  persona: PersonaConfigSchema,
  model: ModelConfigSchema,
  tools: z.array(ToolConfigSchema).default([]),
  skills: z.array(SkillConfigSchema).default([]),
  memory: MemoryConfigSchema.default({ type: 'short-term', maxMessages: 50 }),
  timeout: z.number().positive().default(300000),
  maxTurns: z.number().positive().default(50),
  envVars: z.array(z.string()).default([]),
  requiredSecrets: z.array(z.string()).default([]),
});

/**
 * Agent directory configuration
 */
export const AgentDirectoryConfigSchema = z.object({
  version: z.string().default('1.0.0'),
  agentsDir: z.string().default('./agents'),
  registryFile: z.string().default('registry.json'),
  autoDiscover: z.boolean().default(true),
  validateOnLoad: z.boolean().default(true),
});

/**
 * Registry entry for an agent
 */
export const AgentRegistryEntrySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  category: z.string(),
  tags: z.array(z.string()),
  configPath: z.string(),
  enabled: z.boolean().default(true),
  registeredAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/**
 * Full registry schema
 */
export const AgentRegistrySchema = z.object({
  version: z.string(),
  agents: z.array(AgentRegistryEntrySchema),
  lastUpdated: z.string().datetime(),
});

// Type exports
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type ToolConfig = z.infer<typeof ToolConfigSchema>;
export type SkillConfig = z.infer<typeof SkillConfigSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type PersonaConfig = z.infer<typeof PersonaConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type AgentDirectoryConfig = z.infer<typeof AgentDirectoryConfigSchema>;
export type AgentRegistryEntry = z.infer<typeof AgentRegistryEntrySchema>;
export type AgentRegistry = z.infer<typeof AgentRegistrySchema>;

// Validation helpers
export function validateAgentConfig(config: unknown): AgentConfig {
  return AgentConfigSchema.parse(config);
}

export function safeValidateAgentConfig(config: unknown) {
  return AgentConfigSchema.safeParse(config);
}