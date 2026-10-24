import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Folder, Loader2, RefreshCw, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import type { ApplyResult, DirectoryAnalysis, OrganizeStrategy, PlanItem } from '../../electron/organizer-types';
import { baseName, parentPath } from '../lib/paths';
import { formatSize } from '../lib/format';

const STRATEGIES: { value: OrganizeStrategy; label: string }[] = [
  { value: 'smart', label: 'Smart (AI): by project / topic' },
  { value: 'type', label: 'By type (Images, Documents…)' },
  { value: 'date', label: 'By month modified' },
  { value: 'extension', label: 'By extension' },
];

const TRASH_GROUP = 'Recycle Bin';

interface Props {
  analysis: DirectoryAnalysis | null;
  analyzing: boolean;
  /** Folder this window organizes. */
  root: string;
  /** Selected strategy; nothing runs until the user clicks Analyze. */
  strategy: OrganizeStrategy;
  onStrategyChange: (strategy: OrganizeStrategy) => void;
  aiEnabled: boolean;
  aiModel?: string;
  /** Rendered next to the strategy selector for the smart strategy. */
  modelPicker?: React.ReactNode;
  readContents: boolean;
  onReadContentsChange: (value: boolean) => void;
  lastResult: ApplyResult | null;
  onAnalyze: () => void;
  onApply: (items: PlanItem[]) => Promise<void>;
  onUndo: () => Promise<void>;
  onClose: () => void;
}

export function Organizer({ analysis, analyzing, root, strategy, onStrategyChange, aiEnabled, aiModel, modelPicker, readContents, onReadContentsChange, lastResult, onAnalyze, onApply, onUndo, onClose }: Props) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Reset selection to the recommended items whenever a new analysis arrives.
  useEffect(() => {
    setChecked(new Set(analysis?.plan.filter(i => i.recommended).map(i => i.id)));
    setCollapsed(new Set());
  }, [analysis]);

  // Group moves by target folder; trash items go in their own group at the end.
  const groups = useMemo(() => {
    const map = new Map<string, PlanItem[]>();
    for (const item of analysis?.plan ?? []) {
      const key = item.kind === 'trash' ? TRASH_GROUP : baseName(parentPath(item.destination!));
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()].sort(([a], [b]) => (a === TRASH_GROUP ? 1 : b === TRASH_GROUP ? -1 : a.localeCompare(b)));
  }, [analysis]);

  const toggle = (ids: string[], on: boolean) => setChecked(prev => {
    const next = new Set(prev);
    ids.forEach(id => (on ? next.add(id) : next.delete(id)));
    return next;
  });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const selectedItems = analysis?.plan.filter(i => checked.has(i.id)) ?? [];
  const protectedCount = analysis?.skipped.filter(s => s.reason.startsWith('Protected')).length ?? 0;
  const trashCount = selectedItems.filter(i => i.kind === 'trash').length;
  const failed = lastResult?.applied.filter(i => !i.ok) ?? [];
  // The shown plan was made with different options; applying it would surprise the user.
  const stale = !!analysis && (analysis.strategy !== strategy || (strategy === 'smart' && analysis.model !== aiModel));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Sparkles size={16} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Organize {baseName(root)}</span>
          </span>
          <button className="btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body organizer">
          <div className="organizer-controls">
            <select className="form-input" value={strategy} onChange={e => onStrategyChange(e.target.value as OrganizeStrategy)} disabled={analyzing || busy}>
              {STRATEGIES.map(s => (
                <option key={s.value} value={s.value} disabled={s.value === 'smart' && !aiEnabled}>
                  {s.label}{s.value === 'smart' && !aiEnabled ? ' (add an API key in AI settings)' : ''}
                </option>
              ))}
            </select>
            {strategy === 'smart' && modelPicker}
            <button className="btn btn-primary" onClick={onAnalyze} disabled={analyzing || busy} title="Look at the folder and propose a plan. Nothing is moved.">
              {analyzing ? <Loader2 size={14} className="animate-spin" /> : analysis ? <RefreshCw size={14} /> : <Sparkles size={14} />}
              {analysis ? 'Re-analyze' : 'Analyze'}
            </button>
          </div>

          {strategy === 'smart' && (
            <label className="organizer-option">
              <input type="checkbox" checked={readContents} disabled={analyzing || busy} onChange={e => onReadContentsChange(e.target.checked)} />
              <span>
                <strong>Read file contents</strong>
                <span className="organizer-muted"> — understands PDFs, Word, Excel, PowerPoint and text files, not just names.
                  Sends the first ~1,200 characters of each document to {aiModel ?? 'the AI model'}.
                  Files with keys or passwords (.env, private keys, password files, or text that looks like a secret) are never read or sent.</span>
              </span>
            </label>
          )}

          {!analysis && !analyzing && (
            <div className="organizer-empty" style={{ flexDirection: 'column', gap: 4 }}>
              <span>Choose how to organize <strong>{baseName(root)}</strong>, then click <strong>Analyze</strong>.</span>
              <span className="organizer-muted">
                {strategy === 'smart'
                  ? `Analyze sends ${readContents ? 'file names and short document excerpts' : 'file names'} to ${aiModel ?? 'the AI model'}. `
                  : 'Runs on this computer only. '}
                Nothing is moved until you review the plan and click Apply.
              </span>
            </div>
          )}

          {stale && !analyzing && (
            <div className="organizer-warning">
              <AlertTriangle size={16} style={{ flexShrink: 0 }} />
              <span>Options changed since this plan was made. Click Re-analyze to update it before applying.</span>
            </div>
          )}

          {analyzing && (
            <div className="organizer-empty">
              <Loader2 size={20} className="animate-spin" />
              {strategy === 'smart' ? `${readContents ? 'Reading documents and asking' : 'Asking'} the AI model how to group these files… (can take a minute)` : 'Analyzing…'}
            </div>
          )}

          {analysis && !analyzing && (
            <>
              {analysis.warning && (
                <div className="organizer-warning">
                  <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                  <span>{analysis.warning} Nothing is ticked; tick only items you're sure about.</span>
                </div>
              )}
              <div className="organizer-stats">
                <Stat label="Files" value={analysis.totalFiles} />
                <Stat label="Folders" value={analysis.totalFolders} />
                <Stat label="Total size" value={formatSize(analysis.totalSize)} />
                <Stat label="Duplicates" value={analysis.duplicateGroups.reduce((n, g) => n + g.paths.length - 1, 0)} />
                <Stat label="Empty folders" value={analysis.emptyFolders.length} />
              </div>

              {analysis.categories.length > 0 && (
                <div className="organizer-categories">
                  {analysis.categories.map(c => (
                    <div key={c.category} className="organizer-cat">
                      <span className="organizer-cat-name">{c.category}</span>
                      <span className="organizer-cat-bar"><span style={{ width: `${Math.max(2, (c.size / (analysis.totalSize || 1)) * 100)}%` }} /></span>
                      <span className="organizer-cat-meta">{c.count} · {formatSize(c.size)}</span>
                    </div>
                  ))}
                </div>
              )}

              {analysis.plan.length === 0 ? (
                <div className="organizer-empty">Nothing to organize here — there are no loose files at the top level.</div>
              ) : (
                <div className="organizer-plan">
                  {groups.map(([group, items]) => {
                    const ids = items.map(i => i.id);
                    const onCount = ids.filter(id => checked.has(id)).length;
                    const isOpen = !collapsed.has(group);
                    return (
                      <div key={group} className="organizer-group">
                        <div className="organizer-group-header">
                          <button className="tree-toggle" onClick={() => setCollapsed(prev => { const n = new Set(prev); n.has(group) ? n.delete(group) : n.add(group); return n; })}>
                            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </button>
                          <input
                            type="checkbox"
                            checked={onCount === ids.length}
                            ref={el => { if (el) el.indeterminate = onCount > 0 && onCount < ids.length; }}
                            onChange={e => toggle(ids, e.target.checked)}
                          />
                          {group === TRASH_GROUP ? <Trash2 size={14} color="var(--danger)" /> : <Folder size={14} color="#f9d449" />}
                          <strong>{group}</strong>
                          <span className="organizer-muted">{onCount}/{ids.length}</span>
                        </div>
                        {isOpen && items.map(item => (
                          <label key={item.id} className="organizer-item">
                            <input type="checkbox" checked={checked.has(item.id)} onChange={e => toggle([item.id], e.target.checked)} />
                            {item.isFolder && <Folder size={12} color="#f9d449" style={{ flexShrink: 0 }} />}
                            <span className="organizer-item-name" title={item.source}>{baseName(item.source)}{item.isFolder && <span className="organizer-muted"> (whole folder)</span>}</span>
                            {item.destination && baseName(item.destination) !== baseName(item.source) && (
                              <span className="organizer-muted">→ {baseName(item.destination)}</span>
                            )}
                            <span className="organizer-muted organizer-reason">{item.reason}</span>
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="organizer-muted" style={{ marginTop: 8 }}>
                {analysis.model && `Plan by ${analysis.model} in ${((analysis.durationMs ?? 0) / 1000).toFixed(1)}s${analysis.model !== aiModel ? ' (switched model since; click ↻ to re-run)' : ''}. `}
                {protectedCount > 0 && `🔒 ${protectedCount} sensitive item${protectedCount > 1 ? 's' : ''} (keys, .env, passwords) protected: not read, not sent, not moved. `}
                {analysis.secretsWithheld > 0 && `🔒 Withheld the contents of ${analysis.secretsWithheld} file${analysis.secretsWithheld > 1 ? 's' : ''} that looked like they contain a key or password. `}
                {analysis.strategy === 'smart' && analysis.contentsRead > 0 && `Read the contents of ${analysis.contentsRead} document${analysis.contentsRead > 1 ? 's' : ''}. `}
                {analysis.skipped.length > protectedCount && `Skipped ${analysis.skipped.length - protectedCount} hidden, system or temporary file${analysis.skipped.length - protectedCount > 1 ? 's' : ''}. `}
                {analysis.strategy === 'smart'
                  ? 'Folder moves are never pre-ticked: apps sometimes keep their data in folders.'
                  : 'Existing folders are never moved.'}
              </p>
            </>
          )}

          {lastResult && (
            <div className="organizer-result">
              Applied {lastResult.applied.length - failed.length} of {lastResult.applied.length} changes.
              {failed.length > 0 && (
                <ul>{failed.slice(0, 5).map(f => <li key={f.id}>{baseName(f.source)}: {f.error}</li>)}</ul>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {lastResult && lastResult.applied.some(i => i.ok && i.kind === 'move') && (
            <button className="btn" onClick={() => run(onUndo)} disabled={busy} style={{ marginRight: 'auto' }}>
              <Undo2 size={14} /> Undo last organize
            </button>
          )}
          <button className="btn" onClick={onClose}>Close</button>
          <button
            className={`btn ${trashCount ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => run(() => onApply(selectedItems))}
            disabled={busy || analyzing || stale || selectedItems.length === 0}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Apply {selectedItems.length} change{selectedItems.length === 1 ? '' : 's'}
            {trashCount > 0 && ` (${trashCount} to Recycle Bin)`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="organizer-stat">
      <span className="organizer-stat-value">{value}</span>
      <span className="organizer-muted">{label}</span>
    </div>
  );
}
