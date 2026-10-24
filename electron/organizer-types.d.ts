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
  plan: PlanItem[];
}

export interface ApplyResult {
  applied: (PlanItem & { ok: boolean; error?: string })[];
  createdDirs: string[];
}
