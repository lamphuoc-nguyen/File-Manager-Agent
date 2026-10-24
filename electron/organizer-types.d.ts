// Shared between main, preload and renderer. Declaration-only so it is never emitted.

export type OrganizeStrategy = 'type' | 'date' | 'extension' | 'smart';

export interface PlanItem {
  id: string;
  kind: 'move' | 'trash';
  source: string;
  destination?: string;
  reason: string;
  /** Whether the item is ticked by default in the review UI. */
  recommended: boolean;
  /** The item is a whole folder (only proposed by the smart strategy). */
  isFolder?: boolean;
}

export interface AnalyzeOptions {
  /** Smart strategy only: send short text excerpts of documents to the AI model. */
  readContents?: boolean;
}

export interface CategoryStat {
  category: string;
  count: number;
  size: number;
}

export interface DirectoryAnalysis {
  root: string;
  strategy: OrganizeStrategy;
  /** Set when organizing this folder is risky; every plan item is then unticked by default. */
  warning?: string;
  totalFiles: number;
  totalFolders: number;
  totalSize: number;
  categories: CategoryStat[];
  duplicateGroups: { size: number; paths: string[] }[];
  emptyFolders: string[];
  skipped: { path: string; reason: string }[];
  /** Number of files whose contents were read and sent to the AI model. */
  contentsRead: number;
  /** Smart strategy: the model that produced the plan, and how long analysis took. */
  model?: string;
  durationMs?: number;
  plan: PlanItem[];
}

export interface ApplyResult {
  applied: (PlanItem & { ok: boolean; error?: string })[];
  createdDirs: string[];
}
