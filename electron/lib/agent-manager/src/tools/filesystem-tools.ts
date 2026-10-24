import { ToolConfig } from '../schemas/agent-config.js';

/**
 * Filesystem tool definitions for agents
 * These tools are executed by the Electron main process via IPC
 */
export const FILESYSTEM_TOOLS: ToolConfig[] = [
  {
    name: 'fs_list',
    description: 'List files and directories in a given path',
    type: 'function',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list' },
        showHidden: { type: 'boolean', default: false, description: 'Include hidden files' },
      },
      required: ['path'],
    },
    enabled: true,
  },
  {
    name: 'fs_read',
    description: 'Read the contents of a file',
    type: 'function',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
        encoding: { type: 'string', enum: ['utf-8', 'base64'], default: 'utf-8' },
      },
      required: ['path'],
    },
    enabled: true,
  },
  {
    name: 'fs_write',
    description: 'Write content to a file (creates or overwrites)',
    type: 'function',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write' },
        content: { type: 'string', description: 'Content to write' },
        encoding: { type: 'string', enum: ['utf-8', 'base64'], default: 'utf-8' },
        createDirs: { type: 'boolean', default: true, description: 'Create parent directories if needed' },
      },
      required: ['path', 'content'],
    },
    enabled: true,
  },
  {
    name: 'fs_delete',
    description: 'Delete a file or directory',
    type: 'function',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to delete' },
        recursive: { type: 'boolean', default: false, description: 'Delete directories recursively' },
      },
      required: ['path'],
    },
    enabled: true,
  },
  {
    name: 'fs_move',
    description: 'Move or rename a file or directory',
    type: 'function',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source path' },
        destination: { type: 'string', description: 'Destination path' },
        overwrite: { type: 'boolean', default: false, description: 'Overwrite if destination exists' },
      },
      required: ['source', 'destination'],
    },
    enabled: true,
  },
  {
    name: 'fs_copy',
    description: 'Copy a file or directory',
    type: 'function',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source path' },
        destination: { type: 'string', description: 'Destination path' },
        recursive: { type: 'boolean', default: true, description: 'Copy directories recursively' },
        overwrite: { type: 'boolean', default: false, description: 'Overwrite if destination exists' },
      },
      required: ['source', 'destination'],
    },
    enabled: true,
  },
  {
    name: 'fs_mkdir',
    description: 'Create a directory (with parents)',
    type: 'function',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to create' },
      },
      required: ['path'],
    },
    enabled: true,
  },
  {
    name: 'fs_stat',
    description: 'Get file/directory metadata (size, modified, permissions, etc.)',
    type: 'function',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to stat' },
      },
      required: ['path'],
    },
    enabled: true,
  },
  {
    name: 'fs_search',
    description: 'Search for files matching a pattern',
    type: 'function',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Root directory to search' },
        pattern: { type: 'string', description: 'Glob pattern (e.g., **/*.ts)' },
        maxResults: { type: 'number', default: 100 },
      },
      required: ['root', 'pattern'],
    },
    enabled: true,
  },
  {
    name: 'fs_grep',
    description: 'Search for text content in files',
    type: 'function',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Root directory to search' },
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        filePattern: { type: 'string', description: 'File glob pattern (e.g., *.ts)' },
        maxResults: { type: 'number', default: 50 },
      },
      required: ['root', 'pattern'],
    },
    enabled: true,
  },
  {
    name: 'fs_analyze',
    description: 'Analyze a directory and propose an organization plan (file categories, duplicates, empty folders). Does not change anything.',
    type: 'function',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to analyze (top level only)' },
        strategy: { type: 'string', enum: ['type', 'date', 'extension', 'smart'], default: 'type', description: 'Group files by type (Images, Documents...), by month modified, by extension, or by meaning using the AI model (smart)' },
      },
      required: ['path'],
    },
    enabled: true,
  },
  {
    name: 'fs_organize',
    description: 'Apply plan items returned by fs_analyze (moves files, sends duplicates/empty folders to the Recycle Bin). Requires user confirmation.',
    type: 'function',
    parameters: {
      type: 'object',
      properties: {
        items: { type: 'array', description: 'Plan items from fs_analyze to apply' },
      },
      required: ['items'],
    },
    enabled: true,
  },
  {
    name: 'fs_watch',
    description: 'Watch a directory for changes (returns event stream)',
    type: 'function',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to watch' },
        recursive: { type: 'boolean', default: true },
      },
      required: ['path'],
    },
    enabled: true,
  },
];

/**
 * Tool result types
 */
export interface ToolResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: string;
  created: string;
  permissions?: string;
}

export interface SearchResult {
  path: string;
  matches: { line: number; column: number; text: string }[];
}