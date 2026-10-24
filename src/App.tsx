import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Folder, File, ChevronRight, ChevronDown, Home, HardDrive, RefreshCw, ArrowUp,
  Plus, Trash2, Edit, Copy, Scissors, ClipboardPaste, Bot, MessageSquare,
  Send, Loader2, X, LayoutGrid, List, FolderOpen, Sparkles, Settings
} from 'lucide-react';
import { joinPath, parentPath, isRoot, normalize, crumbs, validateName, uniqueCopyName, baseName } from './lib/paths';
import { formatSize, formatDate, errorText } from './lib/format';
import { Organizer } from './components/Organizer';
import { AiSettings } from './components/AiSettings';
import { ModelPicker } from './components/ModelPicker';
import type { ApplyResult, DirectoryAnalysis, OrganizeStrategy, PlanItem } from '../electron/organizer-types';
import type { AiSettings as AiSettingsState } from '../electron/ai-types';

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: string;
  created: string;
}

interface AgentEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  category: string;
  tags: string[];
  enabled: boolean;
  configPath: string;
}

interface AgentConfig {
  id: string;
  name: string;
  version: string;
  persona: { name: string; role: string; instructions: string };
  model: { provider: string; model: string };
  tools: Array<{ name: string; description: string; parameters: any }>;
}

interface ChatMessage {
  role: 'user' | 'agent' | 'tool';
  content: string;
  toolName?: string;
  toolArgs?: any;
  toolResult?: any;
}

interface DialogState {
  title: string;
  message?: React.ReactNode;
  /** When set, the dialog shows a text field prefilled with this value. */
  input?: string;
  confirmLabel: string;
  danger?: boolean;
  validate?: (value: string) => string | null;
  onConfirm: (value: string) => void | Promise<void>;
}

type Clipboard = { mode: 'copy' | 'cut'; items: FileItem[] } | null;

const sortItems = (items: FileItem[]) =>
  [...items].sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.isDirectory ? -1 : 1));

function App() {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [drives, setDrives] = useState<string[]>([]);
  const [home, setHome] = useState<string>('');
  const [selected, setSelected] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [loading, setLoading] = useState(false);
  const [treeVersion, setTreeVersion] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: FileItem | null } | null>(null);
  const [showAgentPanel, setShowAgentPanel] = useState(true);
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [organizerOpen, setOrganizerOpen] = useState(false);
  /** Folder the Organize window is working on. */
  const [organizeRoot, setOrganizeRoot] = useState('');
  const [analysis, setAnalysis] = useState<DirectoryAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [lastOrganize, setLastOrganize] = useState<ApplyResult | null>(null);
  const [organizeStrategy, setOrganizeStrategy] = useState<OrganizeStrategy>('type');
  const [aiSettings, setAiSettings] = useState<AiSettingsState | null>(null);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [readContents, setReadContents] = useState<boolean>(() => {
    try { return localStorage.getItem('fm.readContents') !== 'false'; } catch { return true; }
  });
  const chatEndRef = useRef<HTMLDivElement>(null);
  const listRequest = useRef(0);
  const toastTimer = useRef<number>();

  const selectedItem = files.find(f => f.path === selected) ?? null;

  const showToastMsg = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  // ===== Filesystem Operations =====
  const loadFiles = useCallback(async (path: string) => {
    const request = ++listRequest.current;
    setLoading(true);
    try {
      const items = await window.api.fs.list(path);
      // Ignore responses for folders the user already navigated away from.
      if (request !== listRequest.current) return;
      setFiles(sortItems(items));
    } catch (e: any) {
      if (request === listRequest.current) showToastMsg(e.message, 'error');
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, [showToastMsg]);

  const refresh = useCallback(() => {
    loadFiles(currentPath);
    setTreeVersion(v => v + 1);
  }, [currentPath, loadFiles]);

  const loadDrives = async () => {
    try {
      const [d, h] = await Promise.all([window.api.fs.getDrives(), window.api.fs.getHome()]);
      setDrives(d);
      setHome(h);
      setCurrentPath(prev => prev || h || d[0] || '');
    } catch (e: any) {
      showToastMsg(e.message, 'error');
    }
  };

  useEffect(() => {
    loadDrives();
    loadAgents();
    window.api.ai.getSettings().then(setAiSettings).catch(console.error);
  }, []);

  useEffect(() => {
    if (!currentPath) return;
    setSelected(null);
    loadFiles(currentPath);
  }, [currentPath, loadFiles]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Close the context menu on any outside click, scroll, or Escape.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    document.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  const navigate = (path: string) => setCurrentPath(normalize(path));
  const goUp = () => navigate(parentPath(currentPath));
  const goHome = () => navigate(home || drives[0]);

  const openItem = async (item: FileItem) => {
    if (item.isDirectory) return navigate(item.path);
    try { await window.api.fs.open(item.path); }
    catch (e: any) { showToastMsg(e.message, 'error'); }
  };

  const handleDelete = (item: FileItem) => {
    setDialog({
      title: 'Move to Recycle Bin',
      message: <p>Move <strong>{item.name}</strong> to the Recycle Bin?</p>,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        await window.api.fs.delete(item.path);
        showToastMsg(`Moved ${item.name} to the Recycle Bin`, 'success');
        refresh();
      },
    });
  };

  const handleRename = (item: FileItem) => {
    setDialog({
      title: 'Rename',
      input: item.name,
      confirmLabel: 'Rename',
      validate: validateName,
      onConfirm: async (value) => {
        const newName = value.trim();
        if (newName === item.name) return;
        await window.api.fs.move(item.path, joinPath(parentPath(item.path), newName));
        showToastMsg('Renamed successfully', 'success');
        refresh();
      },
    });
  };

  const handleNewFolder = () => {
    const taken = new Set(files.map(f => f.name.toLowerCase()));
    let name = 'New folder';
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `New folder (${i})`;
    setDialog({
      title: 'New Folder',
      input: name,
      confirmLabel: 'Create',
      validate: validateName,
      onConfirm: async (value) => {
        await window.api.fs.mkdir(joinPath(currentPath, value.trim()));
        showToastMsg('Folder created', 'success');
        refresh();
      },
    });
  };

  const handleClipboard = (mode: 'copy' | 'cut', item: FileItem) => {
    setClipboard({ mode, items: [item] });
    showToastMsg(`${mode === 'copy' ? 'Copied' : 'Cut'} ${item.name}`, 'info');
  };

  const handlePaste = async () => {
    if (!clipboard || !currentPath) return;
    const taken = new Set(files.map(f => f.name.toLowerCase()));
    try {
      for (const item of clipboard.items) {
        if (clipboard.mode === 'cut') {
          if (normalize(parentPath(item.path)).toLowerCase() === normalize(currentPath).toLowerCase()) continue;
          await window.api.fs.move(item.path, joinPath(currentPath, item.name));
        } else {
          const name = uniqueCopyName(item.name, taken);
          taken.add(name.toLowerCase());
          await window.api.fs.copy(item.path, joinPath(currentPath, name), true);
        }
      }
      if (clipboard.mode === 'cut') setClipboard(null);
      showToastMsg('Pasted', 'success');
    } catch (e: any) {
      showToastMsg(e.message, 'error');
    }
    refresh();
  };

  const copyPath = (item: FileItem) => {
    navigator.clipboard.writeText(item.path);
    showToastMsg('Path copied', 'info');
  };

  const handleContextMenu = (e: React.MouseEvent, item: FileItem | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (item) setSelected(item.path);
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  };

  // Explorer-style keyboard shortcuts for the file view.
  const handleFileKeyDown = (e: React.KeyboardEvent) => {
    if (dialog) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) { e.preventDefault(); goUp(); }
    else if (e.key === 'F5') { e.preventDefault(); refresh(); }
    else if (ctrl && e.key.toLowerCase() === 'v') { e.preventDefault(); handlePaste(); }
    else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); handleNewFolder(); }
    else if (selectedItem) {
      if (e.key === 'Enter') { e.preventDefault(); openItem(selectedItem); }
      else if (e.key === 'Delete') { e.preventDefault(); handleDelete(selectedItem); }
      else if (e.key === 'F2') { e.preventDefault(); handleRename(selectedItem); }
      else if (ctrl && e.key.toLowerCase() === 'c') { e.preventDefault(); handleClipboard('copy', selectedItem); }
      else if (ctrl && e.key.toLowerCase() === 'x') { e.preventDefault(); handleClipboard('cut', selectedItem); }
    }
  };

  // ===== Organize =====
  const summarizeAnalysis = (a: DirectoryAnalysis) => {
    const moves = a.plan.filter(i => i.kind === 'move');
    const folders = new Set(moves.map(i => baseName(parentPath(i.destination!))));
    const dupes = a.duplicateGroups.reduce((n, g) => n + g.paths.length - 1, 0);
    const lines = [
      ...(a.warning ? [`⚠ ${a.warning} I've unticked everything.\n`] : []),
      `${baseName(a.root)}: ${a.totalFiles} files (${formatSize(a.totalSize)}), ${a.totalFolders} folders.`,
      ...a.categories.slice(0, 6).map(c => `• ${c.category}: ${c.count} (${formatSize(c.size)})`),
      moves.length ? `\nI'd move ${moves.length} files into ${folders.size} folders: ${[...folders].slice(0, 8).join(', ')}${folders.size > 8 ? '…' : ''}.` : '\nNo loose files to sort.',
    ];
    if (dupes) lines.push(`Found ${dupes} duplicate file${dupes > 1 ? 's' : ''} (same content).`);
    if (a.emptyFolders.length) lines.push(`Found ${a.emptyFolders.length} empty folder${a.emptyFolders.length > 1 ? 's' : ''}.`);
    if (a.plan.length) lines.push('Review the plan in the Organize window, untick anything you want to keep, then Apply.');
    return lines.join('\n');
  };

  const defaultStrategy = (): OrganizeStrategy => (aiSettings?.hasKey ? 'smart' : 'type');

  /** Opens the Organize window without analyzing: the user picks options first, then clicks Analyze. */
  const openOrganizer = () => {
    if (analysis && normalize(analysis.root).toLowerCase() !== normalize(currentPath).toLowerCase()) setAnalysis(null);
    if (!analysis || normalize(analysis.root).toLowerCase() !== normalize(currentPath).toLowerCase()) setOrganizeStrategy(defaultStrategy());
    setOrganizeRoot(currentPath);
    setOrganizerOpen(true);
  };

  const analyzeFolder = async (strategy: OrganizeStrategy = defaultStrategy(), path = currentPath, withContents = readContents) => {
    setOrganizerOpen(true);
    setOrganizeRoot(path);
    setOrganizeStrategy(strategy);
    setAnalyzing(true);
    try {
      const result = await window.api.organize.analyze(path, strategy, { readContents: withContents });
      setAnalysis(result);
      return result;
    } catch (e: any) {
      showToastMsg(errorText(e), 'error');
      return null;
    } finally {
      setAnalyzing(false);
    }
  };

  const changeReadContents = (value: boolean) => {
    setReadContents(value);
    try { localStorage.setItem('fm.readContents', String(value)); } catch { }
  };

  /** Refreshes the plan after a change; skipped for AI plans so we don't re-query the model. */
  const reanalyzeAfterChange = async () => {
    if (!analysis) return;
    if (analysis.strategy === 'smart') setAnalysis(null);
    else await analyzeFolder(analysis.strategy, analysis.root);
  };

  const applyOrganize = async (items: PlanItem[]) => {
    const result = await window.api.organize.apply(items);
    setLastOrganize(result);
    const ok = result.applied.filter(i => i.ok).length;
    showToastMsg(`Organized: ${ok} of ${result.applied.length} changes applied`, ok === result.applied.length ? 'success' : 'error');
    setChatMessages(prev => [...prev, { role: 'agent', content: `Done — applied ${ok} of ${result.applied.length} changes. Say "undo" to put the moved files back.` }]);
    refresh();
    await reanalyzeAfterChange();
  };

  const undoOrganize = async () => {
    if (!lastOrganize) return;
    const result = await window.api.organize.undo(lastOrganize);
    setLastOrganize(null);
    const ok = result.applied.filter(i => i.ok).length;
    const trashed = lastOrganize.applied.filter(i => i.ok && i.kind === 'trash').length;
    const msg = `Undo: moved ${ok} file${ok === 1 ? '' : 's'} back` + (trashed ? `. ${trashed} item(s) sent to the Recycle Bin must be restored from there.` : '.');
    showToastMsg(msg, 'success');
    setChatMessages(prev => [...prev, { role: 'agent', content: msg }]);
    refresh();
    if (organizerOpen) await reanalyzeAfterChange();
  };

  // ===== Agent Operations =====
  const loadAgents = async () => {
    try {
      const list = await window.api.agent.list();
      setAgents(list);
      if (list.length && !selectedAgent) {
        setSelectedAgent(list[0].id);
        loadAgentConfig(list[0].id);
      }
    } catch (e: any) { console.error(e); }
  };

  const loadAgentConfig = async (id: string) => {
    try {
      const config = await window.api.agent.load(id);
      setAgentConfig(config);
    } catch (e: any) { console.error(e); }
  };

  const addToolMessage = (content: string, toolName: string, toolArgs: any, toolResult: any) =>
    setChatMessages(prev => [...prev, { role: 'tool', content, toolName, toolArgs, toolResult }]);

  const sendChatMessage = async () => {
    if (!chatInput.trim() || !selectedAgent || agentLoading) return;
    const userMsg = chatInput;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setAgentLoading(true);

    try {
      if (!agentConfig) throw new Error('Agent config not loaded');

      // Actions that change files are matched by keyword and always confirmed in the UI.
      // With an AI model configured, everything else (questions, listing, searching) goes to the model,
      // which only has read-only tools; without one, simple keyword commands handle it.
      let response = '';
      const lower = userMsg.toLowerCase();
      const quoted = (re: RegExp) => userMsg.match(re)?.[1]?.trim();
      const aiOn = !!aiSettings?.hasKey;

      if (/^\s*undo\b/.test(lower)) {
        if (lastOrganize) { await undoOrganize(); return; }
        response = 'There is no organize action to undo.';
      } else if (/\b(organi[sz]e|tidy|clean\s*up|sort (out|this|these|my)|declutter)\b/.test(lower) || (!aiOn && /\banaly[sz]e\b/.test(lower))) {
        const strategy: OrganizeStrategy = /\b(date|month|year|when)\b/.test(lower) ? 'date'
          : /\bextension/.test(lower) ? 'extension'
          : /\b(by )?type\b/.test(lower) ? 'type'
          : defaultStrategy();
        // "by content" / "read the files" forces reading; otherwise use the saved preference.
        const withContents = /\b(contents?|read|inside)\b/.test(lower) || readContents;
        const args = { path: currentPath, strategy, readContents: strategy === 'smart' && withContents };
        setOrganizerOpen(true);
        setOrganizeRoot(currentPath);
        setOrganizeStrategy(strategy);
        setAnalyzing(true);
        const result = await window.api.agent.execute(selectedAgent, 'fs_analyze', args).finally(() => setAnalyzing(false));
        if (result.success) {
          setAnalysis(result.data);
          response = summarizeAnalysis(result.data);
        } else response = `Failed: ${result.error}`;
        addToolMessage(`Analyzed ${currentPath}`, 'fs_analyze', args, result.success ? `${result.data.plan.length} plan items` : result);
      } else if (!aiOn && /\b(grep|search content|search in files)\b/.test(lower)) {
        const pattern = quoted(/(?:grep|search content|search in files)\s+(?:for\s+)?["']?([^"'\n]+)["']?/i);
        if (pattern) {
          const args = { root: currentPath, pattern };
          const result = await window.api.agent.execute(selectedAgent, 'fs_grep', args);
          response = result.success
            ? `Found in ${result.data.length} files:\n` + result.data.slice(0, 10).map((r: any) => `${r.path}: ${r.matches.length} matches`).join('\n')
            : `Failed: ${result.error}`;
          addToolMessage(response, 'fs_grep', args, result);
        } else response = 'What text should I search for?';
      } else if (!aiOn && /\b(search|find)\b/.test(lower)) {
        const pattern = quoted(/(?:search|find)\s+(?:for\s+)?["']?([^"'\n]+)["']?/i) || '*';
        const args = { root: currentPath, pattern: pattern.includes('*') ? pattern : `*${pattern}*` };
        const result = await window.api.agent.execute(selectedAgent, 'fs_search', args);
        response = result.success
          ? `Found ${result.data.length} matches:\n` + result.data.slice(0, 20).join('\n')
          : `Failed: ${result.error}`;
        addToolMessage(response, 'fs_search', args, result);
      } else if (/\b(create|make|new)\s+(folder|directory)\b|\bmkdir\b/.test(lower)) {
        const folderName = quoted(/(?:folder|directory|mkdir)\s+(?:called|named)?\s*["']?([^"'\n]+)["']?/i) || 'NewFolder';
        const error = validateName(folderName);
        if (error) response = error;
        else {
          const args = { path: joinPath(currentPath, folderName) };
          const result = await window.api.agent.execute(selectedAgent, 'fs_mkdir', args);
          response = result.success ? `Created folder: ${folderName}` : `Failed: ${result.error}`;
          addToolMessage(response, 'fs_mkdir', args, result);
          refresh();
        }
      } else if (/\b(delete|remove)\b/.test(lower)) {
        const targetName = quoted(/(?:delete|remove)\s+(?:the\s+)?(?:file|folder)?\s*["']?([^"'\n]+)["']?/i);
        const target = targetName && files.find(f => f.name.toLowerCase() === targetName.toLowerCase());
        if (!targetName) response = 'Please specify what to delete';
        else if (!target) response = `No item named "${targetName}" in ${currentPath}`;
        else {
          // Never let the agent delete without the user confirming.
          response = `Waiting for you to confirm deleting ${target.name}…`;
          setDialog({
            title: 'Agent wants to delete',
            message: <p>The agent wants to move <strong>{target.name}</strong> to the Recycle Bin.</p>,
            confirmLabel: 'Delete',
            danger: true,
            onConfirm: async () => {
              const args = { path: target.path };
              const result = await window.api.agent.execute(selectedAgent, 'fs_delete', args);
              addToolMessage(result.success ? `Moved ${target.name} to the Recycle Bin` : `Failed: ${result.error}`, 'fs_delete', args, result);
              refresh();
            },
          });
        }
      } else if (!aiOn && /\b(list|show|what)\b/.test(lower)) {
        const args = { path: currentPath };
        const result = await window.api.agent.execute(selectedAgent, 'fs_list', args);
        if (result.success) {
          const items = sortItems(result.data);
          response = `Found ${items.length} items in ${currentPath}:\n` + items.map(f => `${f.isDirectory ? '📁' : '📄'} ${f.name}${f.isDirectory ? '' : ` (${formatSize(f.size)})`}`).join('\n');
        } else response = `Failed: ${result.error}`;
        addToolMessage(response, 'fs_list', args, result.success ? `${result.data.length} items` : result);
      } else if (aiOn) {
        const history = [...chatMessages, { role: 'user' as const, content: userMsg }]
          .filter(m => m.role !== 'tool')
          .slice(-20)
          .map(m => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, content: m.content }));
        const reply = await window.api.ai.chat(history, { currentPath, persona: agentConfig.persona?.instructions });
        for (const call of reply.toolCalls) {
          addToolMessage(call.ok ? `${call.name}: ${call.summary}` : `${call.name} failed: ${call.summary}`, call.name, call.args, call.summary);
        }
        response = reply.content;
      } else {
        response = `I can help you manage files in ${currentPath}. Add an NVIDIA API key (⚙ above) to ask questions in plain language. Without one, try:\n• "Organize this folder" (or "organize by date")\n• "List files" or "Show what's here"\n• "Create a folder called myfolder"\n• "Delete file.txt"\n• "Find *.ts"\n• "Grep for functionName" (search content)`;
      }

      setChatMessages(prev => [...prev, { role: 'agent', content: response }]);
    } catch (e: any) {
      setChatMessages(prev => [...prev, { role: 'agent', content: `Error: ${errorText(e)}` }]);
    } finally {
      setAgentLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
  };

  const pathCrumbs = crumbs(currentPath);

  return (
    <div className="app">
      <div className="toolbar">
        <div className="toolbar-group">
          <button className="btn" onClick={goHome} title="Home"><Home size={16} /></button>
          <button className="btn" onClick={goUp} title="Up (Backspace)" disabled={!currentPath || isRoot(currentPath)}><ArrowUp size={16} /></button>
          <button className="btn" onClick={refresh} title="Refresh (F5)" disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button className="btn" onClick={handleNewFolder} title="New Folder (Ctrl+Shift+N)" disabled={!currentPath}><Plus size={16} /></button>
          <button className="btn" onClick={handlePaste} title="Paste (Ctrl+V)" disabled={!clipboard}><ClipboardPaste size={16} /></button>
          <button className="btn" onClick={openOrganizer} title="Organize this folder (choose options, then Analyze)" disabled={!currentPath}><Sparkles size={16} /> Organize</button>
        </div>
        <div className="path-bar">
          {pathCrumbs.map((c, i) => (
            <React.Fragment key={c.path}>
              {i > 0 && <ChevronRight size={12} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />}
              <span className={`path-segment ${i === pathCrumbs.length - 1 ? 'current' : ''}`} onClick={() => navigate(c.path)}>
                {c.label}
              </span>
            </React.Fragment>
          ))}
        </div>
        <div className="toolbar-group">
          <button className={`btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')} title="Grid"><LayoutGrid size={16} /></button>
          <button className={`btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')} title="List"><List size={16} /></button>
        </div>
        <div className="toolbar-group">
          <button className="btn" onClick={() => setShowAgentPanel(!showAgentPanel)} title="Toggle Agent Panel">
            <Bot size={16} style={showAgentPanel ? undefined : { opacity: 0.4 }} />
          </button>
        </div>
      </div>

      <div className="main">
        {/* Sidebar */}
        <aside className="sidebar" onContextMenu={e => e.preventDefault()}>
          <div className="sidebar-header">
            <span>Drives & Folders</span>
            <button className="btn" onClick={() => { loadDrives(); setTreeVersion(v => v + 1); }} title="Refresh drives"><RefreshCw size={14} /></button>
          </div>
          <div className="tree">
            {home && (
              <div className={`tree-item ${normalize(currentPath) === normalize(home) ? 'selected' : ''}`} onClick={goHome}>
                <span className="tree-toggle" />
                <span className="tree-icon"><Home size={16} /></span>
                <span className="tree-name">Home</span>
              </div>
            )}
            {drives.map(drive => (
              <TreeNode key={`${drive}:${treeVersion}`} name={drive} path={drive} isRoot currentPath={currentPath} onNavigate={navigate} />
            ))}
          </div>
        </aside>

        {/* Content */}
        <main className="content">
          <div className="content-header">
            <h3 style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentPath || 'Select a drive'}</h3>
            <span style={{ color: 'var(--fg-muted)', fontSize: 12, flexShrink: 0 }}>{files.length} items</span>
          </div>
          <div
            className={`file-grid ${viewMode === 'list' ? 'list' : ''}`}
            tabIndex={0}
            onKeyDown={handleFileKeyDown}
            onClick={e => { if (e.target === e.currentTarget) setSelected(null); }}
            onContextMenu={e => handleContextMenu(e, null)}
          >
            {loading && files.length === 0 ? (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40, color: 'var(--fg-muted)' }}><Loader2 size={24} className="animate-spin" /> Loading...</div>
            ) : files.length === 0 ? (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40, color: 'var(--fg-muted)' }}><Folder size={48} style={{ opacity: 0.3, marginBottom: 8 }} /><p>This folder is empty</p></div>
            ) : (
              files.map(file => (
                <FileCard
                  key={file.path}
                  file={file}
                  viewMode={viewMode}
                  selected={file.path === selected}
                  cut={clipboard?.mode === 'cut' && clipboard.items.some(i => i.path === file.path)}
                  onSelect={() => setSelected(file.path)}
                  onOpen={openItem}
                  onContextMenu={handleContextMenu}
                  formatSize={formatSize}
                  formatDate={formatDate}
                />
              ))
            )}
          </div>
        </main>

        {/* Agent Panel */}
        {showAgentPanel && (
          <aside className="agent-panel">
            <div className="panel-header">
              <span className="panel-title"><Bot size={16} /> Agent Assistant</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {aiSettings?.hasKey ? (
                  <ModelPicker settings={aiSettings} onChange={setAiSettings} onManage={() => setShowAiSettings(true)} disabled={agentLoading} />
                ) : (
                  <span className="ai-badge" title="No AI model configured">AI off</span>
                )}
                <button className="btn" onClick={() => setShowAiSettings(true)} title="AI settings (API key, model)"><Settings size={14} /></button>
              </span>
            </div>
            <select className="agent-select" value={selectedAgent} onChange={e => { setSelectedAgent(e.target.value); loadAgentConfig(e.target.value); }}>
              {agents.length === 0 && <option value="">No agents found</option>}
              {agents.map(a => <option key={a.id} value={a.id}>{a.name} v{a.version}</option>)}
            </select>
            <div className="chat">
              {chatMessages.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--fg-muted)', padding: 20 }}>
                  <MessageSquare size={32} style={{ marginBottom: 8, opacity: 0.5 }} />
                  <p>Select an agent and start chatting</p>
                  <p style={{ fontSize: 11, marginTop: 4 }}>Try: "List files", "Create folder test", "Find *.ts"</p>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`msg ${msg.role}`}>
                  <div className="msg-avatar">{msg.role === 'user' ? 'U' : msg.role === 'tool' ? '⚙' : '🤖'}</div>
                  <div className="msg-content">
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }}>{msg.content}</pre>
                    {msg.toolName && (
                      <div className="msg-tool">
                        Tool: {msg.toolName}({JSON.stringify(msg.toolArgs)})
                        {msg.toolResult !== undefined && (
                          <> Result: {typeof msg.toolResult === 'object' ? JSON.stringify(msg.toolResult).slice(0, 200) : msg.toolResult}</>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="chat-input">
              <div className="chat-input-row">
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask the agent to manage files..."
                  disabled={agentLoading || !selectedAgent}
                />
                <button className="btn btn-primary" onClick={sendChatMessage} disabled={agentLoading || !chatInput.trim() || !selectedAgent}>
                  {agentLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </aside>
        )}

        {/* Context Menu */}
        {contextMenu && (
          <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={() => setContextMenu(null)}>
            {contextMenu.item ? (() => {
              const item = contextMenu.item;
              return (
                <>
                  <button className="context-item" onClick={() => openItem(item)}>{item.isDirectory ? <FolderOpen size={14} /> : <File size={14} />} Open</button>
                  <button className="context-item" onClick={() => window.api.fs.showInFolder(item.path)}><Folder size={14} /> Show in Explorer</button>
                  <div className="context-divider" />
                  <button className="context-item" onClick={() => handleClipboard('cut', item)}><Scissors size={14} /> Cut</button>
                  <button className="context-item" onClick={() => handleClipboard('copy', item)}><Copy size={14} /> Copy</button>
                  <button className="context-item" onClick={() => copyPath(item)}><Copy size={14} /> Copy Path</button>
                  <button className="context-item" onClick={() => handleRename(item)}><Edit size={14} /> Rename</button>
                  <div className="context-divider" />
                  <button className="context-item danger" onClick={() => handleDelete(item)}><Trash2 size={14} /> Delete</button>
                </>
              );
            })() : (
              <>
                <button className="context-item" onClick={handleNewFolder}><Plus size={14} /> New Folder</button>
                <button className="context-item" onClick={handlePaste} disabled={!clipboard}><ClipboardPaste size={14} /> Paste{clipboard ? ` (${baseName(clipboard.items[0].path)})` : ''}</button>
                <button className="context-item" onClick={refresh}><RefreshCw size={14} /> Refresh</button>
              </>
            )}
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 1001, padding: '12px 16px', background: 'var(--bg-elevated)', border: `1px solid ${toast.type === 'success' ? 'var(--success)' : toast.type === 'error' ? 'var(--danger)' : 'var(--accent)'}`, borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', animation: 'slideIn 0.2s' }}>
            {toast.message}
          </div>
        )}

        {organizerOpen && (
          <Organizer
            analysis={analysis}
            analyzing={analyzing}
            strategy={organizeStrategy}
            aiEnabled={!!aiSettings?.hasKey}
            aiModel={aiSettings?.model}
            modelPicker={aiSettings?.hasKey ? (
              <ModelPicker settings={aiSettings} onChange={setAiSettings} onManage={() => setShowAiSettings(true)} disabled={analyzing} />
            ) : null}
            readContents={readContents}
            onReadContentsChange={changeReadContents}
            lastResult={lastOrganize}
            root={organizeRoot}
            onStrategyChange={setOrganizeStrategy}
            onAnalyze={() => analyzeFolder(organizeStrategy, organizeRoot)}
            onApply={applyOrganize}
            onUndo={undoOrganize}
            onClose={() => setOrganizerOpen(false)}
          />
        )}

        {showAiSettings && aiSettings && (
          <AiSettings settings={aiSettings} onSaved={setAiSettings} onClose={() => setShowAiSettings(false)} />
        )}

        {dialog && <Dialog dialog={dialog} onClose={() => setDialog(null)} />}
      </div>
    </div>
  );
}

// ===== Dialog Component =====
// Replaces window.prompt()/confirm(), which Electron does not support.
function Dialog({ dialog, onClose }: { dialog: DialogState; onClose: () => void }) {
  const [value, setValue] = useState(dialog.input ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Select the name without its extension, like Explorer does.
    const dot = value.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : value.length);
  }, []);

  const submit = async () => {
    const validationError = dialog.validate?.(value) ?? null;
    if (validationError) return setError(validationError);
    setBusy(true);
    try {
      await dialog.onConfirm(value);
      onClose();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">{dialog.title}<button className="btn" onClick={onClose}><X size={16} /></button></div>
        <div className="modal-body">
          {dialog.message}
          {dialog.input !== undefined && (
            <input
              ref={inputRef}
              className="form-input"
              value={value}
              onChange={e => { setValue(e.target.value); setError(null); }}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            />
          )}
          {error && <p style={{ color: 'var(--danger)', marginTop: 8, fontSize: 12 }}>{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={submit}
            disabled={busy}
            autoFocus={dialog.input === undefined}
          >
            {busy && <Loader2 size={14} className="animate-spin" />} {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== TreeNode Component =====
function TreeNode({ name, path, isRoot: root, currentPath, onNavigate, depth = 0 }: {
  name: string; path: string; isRoot?: boolean; currentPath: string; onNavigate: (path: string) => void; depth?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const isCurrent = normalize(currentPath).toLowerCase() === normalize(path).toLowerCase();

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) {
      setLoading(true);
      try {
        const items = await window.api.fs.list(path);
        setChildren(sortItems(items.filter(f => f.isDirectory)));
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
  };

  const hasNoChildren = children !== null && children.length === 0;

  return (
    <>
      <div className={`tree-item ${isCurrent ? 'selected' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => onNavigate(path)}>
        <span className="tree-toggle" onClick={toggle} style={hasNoChildren ? { visibility: 'hidden' } : undefined}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="tree-icon">{root ? <HardDrive size={16} /> : <Folder size={16} />}</span>
        <span className="tree-name" title={path}>{name}</span>
      </div>
      {expanded && children?.map(child => (
        <TreeNode key={child.path} name={child.name} path={child.path} currentPath={currentPath} onNavigate={onNavigate} depth={depth + 1} />
      ))}
    </>
  );
}

// ===== FileCard Component =====
function FileCard({ file, viewMode, selected, cut, onSelect, onOpen, onContextMenu, formatSize, formatDate }: {
  file: FileItem; viewMode: 'grid' | 'list'; selected: boolean; cut: boolean;
  onSelect: () => void; onOpen: (file: FileItem) => void; onContextMenu: (e: React.MouseEvent, file: FileItem) => void;
  formatSize: (bytes: number) => string; formatDate: (iso: string) => string;
}) {
  const icon = file.isDirectory ? <Folder size={32} /> : <File size={32} />;
  return (
    <div
      className={`file-card ${viewMode} ${selected ? 'selected' : ''}`}
      style={cut ? { opacity: 0.5 } : undefined}
      onClick={onSelect}
      onDoubleClick={() => onOpen(file)}
      onContextMenu={e => onContextMenu(e, file)}
    >
      <span className="file-icon" style={{ color: file.isDirectory ? '#f9d449' : '#58a6ff' }}>{icon}</span>
      <span className="file-name" title={file.name}>{file.name}</span>
      {viewMode === 'list' && (
        <span className="file-meta">
          {file.isDirectory ? 'Folder' : formatSize(file.size)}
          <span>{formatDate(file.modified)}</span>
        </span>
      )}
    </div>
  );
}

export default App;
