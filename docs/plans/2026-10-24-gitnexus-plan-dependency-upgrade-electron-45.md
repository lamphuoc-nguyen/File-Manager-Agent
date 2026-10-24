# GitNexus Engineering Plan

> Task: Analyze and upgrade the file-manager app's dependencies (Electron 28 → 45 and the rest of the toolchain) without regressions.
> Evidence verified at commit f92d3f344af26c685a68a61264ae97d752242455; GitNexus index refreshed this session (`gitnexus analyze --index-only --pdg`, CLI 1.6.12, runner identity current).
> Evidence provenance schema 2; global dirty digest 0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd; cited-path manifest 15 sorted entries; exact generated plan path excluded.
> Publication: written directly to docs/plans/ on the user's explicit authorization (2026-10-24); the skill's safe writer refuses on win32 (no /proc/self/fd or O_DIRECTORY/O_NOFOLLOW).
> Decision (user, 2026-10-24): target Electron 45.0.0.
> Additional evidence: a full trial upgrade of a `git archive HEAD` copy, built and run outside the repo (see §4). Every target version was installed, typechecked, built, run against the existing test suites on Electron 45, packaged, and launched.

## 1. Objective

Upgrade every runtime and build dependency to its current major version, so the app runs on a supported Electron line. Today it runs Electron 28.3.3, which ships Chromium 120 and Node 18.18 and is out of support. Keep all behaviour identical, including:

- the saved encrypted API key keeps working
- secret protection stays as strong
- every existing test scenario still passes

Remove dependencies that nothing uses. Leave no Electron deprecation warnings that would turn into breakage in Electron 46.

## 2. Current Behaviour

- **Runtime.** `electron@28.3.3` runs an ESM main process (`package.json` `"type":"module"`, `main: dist-electron/main.js`) and a sandboxed CommonJS preload, `electron/preload.cts`, compiled to `dist-electron/preload.cjs` [verified].
- **Build.** `tsc -p tsconfig.electron.json` builds the main process and `tsc -p tsconfig.preload.json` builds the preload. The preload config uses `module: CommonJS`, `moduleResolution: Node10` (tsconfig.preload.json:7-8). Vite builds the renderer [verified].
- **API key storage.** `electron/settings.ts` stores the key with the synchronous safeStorage API [verified]:
  - `getApiKey()` calls `safeStorage.decryptString` (settings.ts:40-46).
  - `updateSettings()` calls `safeStorage.isEncryptionAvailable()` and then `safeStorage.encryptString()` (settings.ts:86-87).
- **Settings reads.** `getSettings()` derives `hasKey`/`keyHint` from `getApiKey()` (settings.ts:48-60). It is called synchronously at llm.ts:29, 66, 145, 147 and main.ts:81, 87 [verified].
- **PDF extraction.** `electron/extract.ts` extracts PDF text with `unpdf@0.12.1`, using `getDocumentProxy(..., { isEvalSupported: false })` and `pdf.destroy()` (extract.ts:125, 135) [verified].
- **Agent config schema.** Zod 3 schemas use one-argument `z.record(z.unknown())` (agent-config.ts:34, 46) [verified]. They exist twice:
  - `electron/lib/agent-manager/...` is used.
  - `src/lib/agent-manager/...` is imported by nothing (grep of `lib/agent-manager` outside both dirs matches only electron/fs-ops.ts and electron/main.ts, which import the electron copy) [verified].
- **Renderer.** React 18 with `createRoot` (src/main.tsx). `useRef<number>()` without an initial value (src/App.tsx:102). Side-effect `import './index.css'` (src/main.tsx:4) [verified].

## 3. Relevant Architecture

- **Main process (ESM).** Modules: `main.ts` (IPC registration, `app.whenReady` at main.ts:52-56), `settings.ts`, `llm.ts`, `organizer.ts`, `extract.ts`, `sensitive.ts`, `fs-ops.ts`. All renderer↔main traffic goes through 32 `ipcMain.handle` / `ipcRenderer.invoke` pairs [verified: source grep].
- **Preload.** Sandboxed and CommonJS. It only does `require('electron')`, and `contextBridge.exposeInMainWorld('api', …)` is its single exposure [verified].
- **Electron APIs in use** [verified: source grep]: `app.{whenReady,on,getPath,getAppPath,isPackaged,quit}`, `BrowserWindow`, `dialog.{showOpenDialog,showSaveDialog}`, `shell.{trashItem,openPath,showItemInFolder}`, `safeStorage.*`. The renderer never calls `api.dialog`.
- **Dependency surface by package** [verified: source grep]:
  - zod: about 70 schema calls
  - yaml: 1 call (`parseYaml`)
  - unpdf: dynamic import in `extractPdf`
  - lucide-react: about 30 named icons across App.tsx, Organizer.tsx, AiSettings.tsx
  - react-dom: `createRoot`
  - vite: `vite.config.ts` and `scripts/dev.mjs` (`createServer`)
- **Unused dependencies:** `vite-plugin-electron` and `vite-plugin-electron-renderer` are declared but imported nowhere [verified].
- **Tests.** No test suite exists in the repo. The project's behaviour checks (66 scenarios) live outside it as Electron scripts. Step 1 brings them in.

## 4. GitNexus Findings

- **Index state.** The index was absent, then created this session. `gitnexus://repo/file-manager/context` reports commit f92d3f3, 40 files, 3,033 symbols, 84 processes, runner identity `current` [graph].
- **Clusters.** `gitnexus://repo/file-manager/clusters` lists 6 modules: Electron (60 symbols), Components (33), Registry (31), plus 3 small ones. The safeStorage change sits entirely in the Electron module [graph].
- **`impact getApiKey` (upstream, maxDepth 3).** Risk CRITICAL, `epistemic: exact`. d=1 dependents: `request` (llm.ts) and `getSettings` (settings.ts). d=2: `complete`, `completeJson`, `listModels`, `updateSettings`, main.ts. d=3: `chat`, `smartGrouper`, `testConnection`. Six processes affected, including "SmartGrouper → SettingsPath", "Chat → SettingsPath" and "TestConnection → SettingsPath" [graph; d=1 source-verified].
- **`impact updateSettings` (upstream).** d=1: `electron/main.ts`. `epistemic: lower-bound` with `receiverTyping: 3`. Source shows the 3 unresolved sites are renderer `window.api.ai.updateSettings` IPC calls (AiSettings.tsx:28, 68; ModelPicker.tsx:20), which already `await` [verified].
- **Process `ListModels → SettingsPath`** and the others confirm that every AI flow reads the key through `request → getApiKey` [graph].

**Trial upgrade (source/execution evidence, the strongest class here).**

The trial was a `git archive` of HEAD, extracted to a scratch directory with every package at its latest version:

| Package | Trial version |
|---|---|
| electron | 45.0.0 |
| electron-builder | 26.18.0 |
| vite | 8.3.5 |
| @vitejs/plugin-react | 6.1.2 |
| typescript | 7.0.2 |
| react / react-dom | 19.3.1 |
| @types/react, @types/react-dom | 19.3.0 |
| @types/node | 24.19.2 |
| lucide-react | 1.61.0 |
| zod | 4.6.7 |
| yaml | 2.9.1 |
| unpdf | 1.9.1 |

Results:

- **TypeScript 7 config errors:** `TS5102 Option 'baseUrl' has been removed`, `TS5090 Non-relative paths are not allowed` (tsconfig.json:19-25), and `TS5108 Option 'moduleResolution=node10' has been removed` (tsconfig.preload.json:8). No code imports the `@/` or `@electron/` aliases [verified].
- **Code errors after the config fix:**
  - extract.ts:125 `'isEvalSupported' does not exist in type 'DocumentInitParameters'`
  - extract.ts:135 `Property 'destroy' does not exist on type 'PDFDocumentProxy'`
  - agent-config.ts:34 and :46 `Expected 2-3 arguments` (both copies)
  - App.tsx:102 `Expected 1 arguments`
  - main.tsx:4 `TS2882 Cannot find module or type declarations for side-effect import of './index.css'`
- **No changes needed:** `vite build` with Vite 8 and all 30 lucide-react 1.61 icons, with no code changes [verified].
- **Bundled pdf.js** inside unpdf 1.9.1 contains zero occurrences of `isEvalSupported`, so the eval path is gone. `PDFDocumentProxy` exposes `loadingTask` (`get loadingTask(): PDFDocumentLoadingTask`) and `destroy()` lives on the loading task [verified: node_modules types].
- **After the candidate fixes in §6,** on Electron 45 the existing suites pass: organizer 12/12, content 17/17, models 9/9, security 16/16 (canary: no secret in any request), errors 12/12, UI Organize flow 7/7. Electron logged deprecation warnings for `safeStorage.isEncryptionAvailable`, `encryptString` and `decryptString` [verified: execution].
- **Key compatibility:** data encrypted by Electron 28 `encryptString` was decrypted by Electron 45 `decryptStringAsync` (`shouldReEncrypt=false`) [verified: execution].
- **Packaging:** `electron-builder --dir` (26.18.0, Electron 45) packaged successfully. The packaged app launched with the bridge loaded, 3 drives listed and 4 agents loaded from extraResources. `app.asar` grew from 27 MB to 42 MB [verified: execution].

**Registry evidence:**

- **Node bundled per Electron** (releases.electronjs.org): Electron 28.3.3 = Node 18.18.2; 43/44/45 = Node 24.22.0.
- **Engines:** `unpdf@1.9.1` needs `node >=22`; `vite@8` and `@vitejs/plugin-react@6` need `^20.19.0 || >=22.12.0`. The system has Node 22.19.0 [verified].
- **Electron breaking changes** (electron/docs/breaking-changes.md, fetched this session) that touch APIs this app uses:
  - 45: sync safeStorage deprecated, and **46 removes it**.
  - 45: the sandboxed preload `require` only loads `electron` and `Buffer` is gone. The preload uses neither shim [verified].
  - 43: dialogs default to Downloads. No renderer caller.
  - 42: the binary downloads on first run instead of at `postinstall`. `node_modules/electron/index.js` `getElectronPath()` downloads on demand [verified].
  - 29: `ipcRenderer` over contextBridge. Not done here.
  - 32: `File.path` removed. Not used.

## 5. Statement-Level PDG Findings

- **`updateSettings`** (`pdg_query controls electron/settings.ts`). Validation and the encryption guard both control `save(s)`:
  - `normalizeBaseUrl` (settings.ts:78) can throw before `save(s)` (settings.ts:90).
  - The guard `!safeStorage.isEncryptionAvailable()` (settings.ts:86, T arm → throw) sits before `encryptString` (settings.ts:87) and `save(s)` (settings.ts:90).
  - Invariant: an invalid URL or unavailable encryption writes nothing [graph + verified].
- **Ordering constraint introduced by going async.** `s` is loaded at settings.ts:77 and saved at settings.ts:90. Putting an `await` between them would let two concurrent IPC updates interleave and lose one write. An example is ModelPicker switching models while AiSettings saves the key [inferred from the PDG slice + IPC concurrency]. So: encrypt first (await), then load → mutate → save synchronously.
- **`getApiKey`** (`pdg_query flows getApiKey`). `s` (settings.ts:41) flows to the guard `s.apiKeyEnc` (settings.ts:42) and to `decryptString(Buffer.from(s.apiKeyEnc,'base64'))` (settings.ts:43). The `catch`/else path falls back to `process.env.NVIDIA_API_KEY` (settings.ts:45). That fallback order must be kept [graph + verified].

## 6. Proposed Changes

1. **`package.json`.** Pin exact versions. dependencies: `react@19.3.1`, `react-dom@19.3.1`, `lucide-react@1.61.0`, `zod@4.6.7`, `yaml@2.9.1`, `unpdf@1.9.1`. devDependencies: `electron@45.0.0`, `electron-builder@26.18.0`, `vite@8.3.5`, `@vitejs/plugin-react@6.1.2`, `typescript@7.0.2`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`, `@types/node@24.19.2`. Remove `vite-plugin-electron` and `vite-plugin-electron-renderer` (unused). Regenerate `package-lock.json` through npm only.
2. **`tsconfig.json`.** Delete `baseUrl` and `paths`; the aliases are unused (TS 7 `TS5102`/`TS5090`).
3. **`tsconfig.preload.json`.** Set `module: NodeNext`, `moduleResolution: NodeNext`, replacing CommonJS/Node10, which TS 7 removed (`TS5108`). The `.cts` input still emits CommonJS `preload.cjs` [verified: the trial build emitted `"use strict"; … require("electron")`].
4. **`src/env.d.ts`.** Add `/// <reference types="vite/client" />` so the `./index.css` side-effect import type-checks (TS2882).
5. **`src/App.tsx`, `App`.** `useRef<number>()` becomes `useRef<number | undefined>(undefined)` (App.tsx:102, React 19 types).
6. **`electron/lib/agent-manager/src/schemas/agent-config.ts`.** `z.record(z.unknown())` becomes `z.record(z.string(), z.unknown())` (lines 34, 46).
7. **Delete `src/lib/agent-manager/`.** It is an unused duplicate. Otherwise it must get the same zod fix to pass typecheck (decision D1).
8. **`electron/extract.ts`, `extractPdf`.** Drop the `isEvalSupported` option (the pdf.js eval path no longer exists; update the comment accordingly). Replace `pdf.destroy()` with `pdf.loadingTask.destroy()`.
9. **`electron/settings.ts`, safeStorage async migration** (decision D2):
   - Add a module-level key cache and `export async function initApiKey(): Promise<void>`. It reads `apiKeyEnc` and runs `await safeStorage.decryptStringAsync(...)`; if `shouldReEncrypt` is true, it re-encrypts with `encryptStringAsync` and saves. On failure it leaves the cache empty, so the env fallback still applies.
   - `getApiKey()` stays synchronous: it returns the cache, else `process.env.NVIDIA_API_KEY`.
   - `updateSettings` becomes `async`. Do the async work first: if `update.apiKey` is non-empty, check `await safeStorage.isAsyncEncryptionAvailable()` (throw if unavailable), then `const blob = await safeStorage.encryptStringAsync(key)`. Then synchronously: `load()`, apply all fields (the `normalizeBaseUrl` validation stays before save), set or delete `apiKeyEnc`, `save(s)`, and update the cache. Return `getSettings()`.
   - No synchronous `safeStorage` calls remain.
10. **`electron/main.ts`.** In `app.whenReady().then(...)` (main.ts:52), `await initApiKey()` before `registerAllDiscovered()` and `createWindow()`. The `ai:updateSettings` handler (main.ts:88) already returns the promise; no change beyond the type.
11. **Tests, new `tests/electron/`.** Port the out-of-repo suites (see §8), add `"test:electron"` to package.json scripts, and add `tests/**` to tsconfig excludes.

## 7. Implementation Sequence

Each step ends green on `npm run typecheck && npm run build:electron && npx vite build && npm run test:electron`. Commit per step.

1. **Bring the safety net in.** Add `tests/electron/` with the six suites (organizer, content, models, security, errors, ui-organize), their helpers (`mkdocs.mjs`, `mock-llm.mjs`, `isolated-entry.mjs`), and `npm run test:electron`. The suites must import `../../dist-electron/*.js` relative to the repo. They must clean up temp `userData` folders **after** the Electron process exits (Electron 45 keeps them locked in-process). Run on the current Electron 28: 66/66 + 7/7 must pass before any upgrade.
2. **Prune.** Remove `vite-plugin-electron` and `vite-plugin-electron-renderer`. Delete `src/lib/agent-manager/` (D1).
3. **TypeScript 7.** Bump `typescript` and apply §6 items 2–4.
4. **Electron 45 + electron-builder 26 + @types/node 24.** Bump them; there are no code changes. Expect safeStorage deprecation warnings in test output; that's acceptable at this step. Run `npm run build:dir` and a packaged smoke launch.
5. **safeStorage async migration** (§6 items 9–10). Afterwards the test output must contain no `safeStorage … is deprecated` lines. Update the suites that import `settings.js` directly to `await initApiKey()` after `app.whenReady()`.
6. **Vite 8 + @vitejs/plugin-react 6.** Bump them; no code changes expected. Also run `npm run electron:dev` once (it uses `vite.createServer`).
7. **React 19 + types + lucide-react 1.61** (§6 item 5).
8. **zod 4 + yaml 2.9** (§6 item 6). The registry tests must still register the 4 sample agents.
9. **unpdf 1.9.1** (§6 item 8). Requires Node ≥22, so it must come after step 4. Confirm `@napi-rs/canvas` (an optional peer) is not required at runtime: the content suite reads PDFs.
10. **Release check.** `npm run build:dir`, launch `release/win-unpacked/File Manager.exe`, and record the `app.asar` size. With the user's consent, confirm the user's existing saved key decrypts on the new build (the suites never print the key).

## 8. Test Strategy

**Existing behaviour checks** (to port into `tests/electron/`; all verified passing on HEAD and on the trial):

- **organizer:** analyze, apply and undo; duplicate detection; name collisions; skip rules. 12 checks.
- **content:** PDF, Word, Excel and PowerPoint extraction; smart grouping with the mock LLM; folder moves; chat reads a PDF. 17 checks.
- **models:** quick list, model switch, Vietnamese naming, JSON retry, token-limit error. 9 checks.
- **security:** a canary in every sensitive file class; no canary in any request; the pasted-key guard. 16 checks.
- **errors:** website URL rejected, fake key against real NVIDIA → "API key rejected", 410, timeout, unreachable server. 12 checks.
- **ui-organize:** Organize opens without analyzing; the stale-plan guard. 7 checks.

**New scenarios for step 5:**

- **Legacy blob:** with a temp `userData` holding a blob made by `encryptString` on Electron 28 → `initApiKey()` on 45 → `getApiKey()` returns the original string (reproduces the trial's cross-version check).
- **Key update, then read:** `updateSettings({apiKey})` → `getApiKey()` returns the new key immediately and the file holds a non-plaintext `apiKeyEnc`.
- **Concurrent updates:** `Promise.all([updateSettings({apiKey:'nvapi-…'}), updateSettings({model:'m2'})])` → both the key and the model are persisted (lost-update guard from §5).
- **Invalid URL:** `updateSettings({apiKey, baseUrl:'https://build.nvidia.com'})` throws and the file is unchanged.
- **Unavailable encryption** (`isAsyncEncryptionAvailable` false, simulated by stubbing): throws, nothing written.
- **Key removal:** `updateSettings({apiKey:''})` → `hasKey` false (unless the env var is set).

**Verification commands** (all exist in package.json except `test:electron`, which step 1 adds): `npm run typecheck`, `npm run build:electron`, `npx vite build`, `npm run test:electron`, `npm run build:dir`, `npm run electron:dev`. The `lint` script calls `eslint`, which is not installed. Do not use it as a gate (§12).

**Isolation rule for tests:** call `app.setPath('userData', <temp>)` before any import that reads settings. Overriding `APPDATA` does **not** isolate Electron's `userData` on Windows. This was observed when a packaged smoke test read the real settings folder [verified].

## 9. Risk and Impact Analysis

- **Direct (d=1) dependents of `getApiKey`:**
  - `request` (llm.ts:29-30) keeps its synchronous call. That's safe only if `initApiKey()` has completed before any IPC handler runs, which `await` in `whenReady` before `createWindow()` guarantees.
  - `getSettings` (settings.ts:48-60) is unchanged and stays synchronous, so its six synchronous callers are untouched.
- **Direct (d=1) dependent of `updateSettings`:** `electron/main.ts:88`, already in an `async` handler. The three renderer IPC callers already await.
- **Lost-update race** in async `updateSettings` (§5). Mitigated by the encrypt-first ordering, and tested by the concurrent-update scenario.
- **Electron 46** will remove the sync safeStorage APIs. Step 5 removes all uses, so a later bump to 46 is not blocked.
- **Electron 45.0.0 is three days old** (2026-10-21). The user chose it (D3). It is the version the trial validated end to end. Fallback only if a blocker appears: `electron@44.9.3` (same Node 24.22), which would need its own test run.
- **Sandboxed preload (Electron 45):** compatible. It only requires `electron` [verified].
- **First-run download (Electron 42+):** `npm install` no longer fetches the binary; the first `electron` run does. That affects offline machines and CI caching.
- **unpdf 1.x** pulls a newer pdf.js. PDF security posture: eval is removed upstream (`isEvalSupported` gone) [verified]. The optional peer `@napi-rs/canvas` (native) ended up as an empty directory in the trial and text extraction worked without it [verified]; keep it out of `dependencies`.
- **Package size:** `app.asar` went from 27 to 42 MB [verified]. Not functional, but noted for release.
- **TypeScript 7** is a native rewrite. Type behaviour matched for this codebase in the trial. Editor or tooling plugins expecting the TS 5 API may lag [inferred].
- **Observability:** Electron prints deprecation warnings to stderr. Use them as a gate in step 5 (zero `deprecated` lines).

## 10. Files Expected to Change

| File | Symbols | Reason |
| ---- | ------- | ------ |
| package.json, package-lock.json | dependencies, devDependencies, scripts | version bumps, prune, `test:electron` |
| tsconfig.json | compilerOptions | remove `baseUrl`/`paths` (TS 7); exclude `tests/**` |
| tsconfig.preload.json | compilerOptions | NodeNext (TS 7 removed node10) |
| src/env.d.ts | — | `vite/client` reference for CSS import |
| src/App.tsx | `App` (`toastTimer`) | React 19 `useRef` signature |
| electron/lib/agent-manager/src/schemas/agent-config.ts | `z.record` schema fields at lines 34 (`parameters`) and 46 (`config`) | zod 4 two-argument `z.record` |
| src/lib/agent-manager/** | (deleted) | unused duplicate (D1) |
| electron/extract.ts | `extractPdf` | unpdf 1.x API |
| electron/settings.ts | `getApiKey`, `updateSettings`, new `initApiKey` | safeStorage async (Electron 45/46) |
| electron/main.ts | `app.whenReady` callback | `await initApiKey()` before window/IPC use |
| tests/electron/** (new) | suites + helpers | regression net for the upgrade |

## 11. Reusable Implementation Context

```yaml
implementation_context:
  task_summary: >-
    Upgrade file-manager dependencies to current majors (Electron 45, electron-builder 26, Vite 8,
    plugin-react 6, TypeScript 7, React 19, lucide-react 1.61, zod 4, unpdf 1.9) with zero behaviour
    change; migrate sync safeStorage to the async API; prune unused deps and the dead agent-manager copy.
  acceptance_criteria:
    - All suites pass on the upgraded stack (organizer 12, content 17, models 9, security 16, errors 12, ui-organize 7)
    - No 'safeStorage … is deprecated' (or other Electron deprecation) lines in test output
    - A key encrypted by Electron 28 decrypts after the upgrade (cross-version test)
    - npm run build:dir succeeds and the packaged app launches with window.api, drives and 4 agents
    - npm run typecheck clean under TypeScript 7
  evidence_provenance: {"schema_version":2,"head_commit":"f92d3f344af26c685a68a61264ae97d752242455","generated_plan_path":"docs/plans/2026-10-24-gitnexus-plan-dependency-upgrade-electron-45.md","global_dirty_digest":{"algorithm":"sha256","canonicalization":"gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records","value":"0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd"},"cited_path_manifest":[{"path":"electron/extract.ts","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:10e7f5410b163764088d8ea37f72fb4768a1eafc8de749b12ff94dde84573794","index_digest":"sha256:10e7f5410b163764088d8ea37f72fb4768a1eafc8de749b12ff94dde84573794","worktree_digest":"sha256:10e7f5410b163764088d8ea37f72fb4768a1eafc8de749b12ff94dde84573794","untracked_digest":"absent"},{"path":"electron/lib/agent-manager/src/schemas/agent-config.ts","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:647de39e7b715f53468e3c8644086fa85b3acbb2ed4ddee9ef6e20a41f4b6d1b","index_digest":"sha256:647de39e7b715f53468e3c8644086fa85b3acbb2ed4ddee9ef6e20a41f4b6d1b","worktree_digest":"sha256:647de39e7b715f53468e3c8644086fa85b3acbb2ed4ddee9ef6e20a41f4b6d1b","untracked_digest":"absent"},{"path":"electron/llm.ts","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:bc2d831809922c160ea84ac2306a8cfab4538e1d8fc64a75ccd118cbc8bad015","index_digest":"sha256:bc2d831809922c160ea84ac2306a8cfab4538e1d8fc64a75ccd118cbc8bad015","worktree_digest":"sha256:bc2d831809922c160ea84ac2306a8cfab4538e1d8fc64a75ccd118cbc8bad015","untracked_digest":"absent"},{"path":"electron/main.ts","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:ca06a39ced79150dd9e6d798b0b8e3cd8146b55ce00d55a6f961c1d33ab4b7db","index_digest":"sha256:ca06a39ced79150dd9e6d798b0b8e3cd8146b55ce00d55a6f961c1d33ab4b7db","worktree_digest":"sha256:8b6d6dbf794da52369dcd8981d8f3567d771a68a662ff96356b0564f31c1dcfd","untracked_digest":"absent"},{"path":"electron/preload.cts","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:d48432b0b838a38c4f8156c8b13a3df6c270d48282993e9c56f6e93f4bb68600","index_digest":"sha256:d48432b0b838a38c4f8156c8b13a3df6c270d48282993e9c56f6e93f4bb68600","worktree_digest":"sha256:57c7826cf2973fa314ad81fd01143c6ca527d41e116bc6be94c7c944c5a03f01","untracked_digest":"absent"},{"path":"electron/settings.ts","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:98d55fbeabc31c3f402342cb163c456f7b663112d20f30dd75aff6b75038c760","index_digest":"sha256:98d55fbeabc31c3f402342cb163c456f7b663112d20f30dd75aff6b75038c760","worktree_digest":"sha256:4333bef1059ddab5e683f7477cf1143dec99ed8189cd7f379594ee2638da6b93","untracked_digest":"absent"},{"path":"package.json","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:7220cb4b29b714d06a3ec245857b55f00625ae35bb59ce31458cdad7f78e9e55","index_digest":"sha256:7220cb4b29b714d06a3ec245857b55f00625ae35bb59ce31458cdad7f78e9e55","worktree_digest":"sha256:7220cb4b29b714d06a3ec245857b55f00625ae35bb59ce31458cdad7f78e9e55","untracked_digest":"absent"},{"path":"scripts/dev.mjs","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:d9cff655ec292c76cd3b84c7f776c095d7953c496912052b5af87d53cebe1c20","index_digest":"sha256:d9cff655ec292c76cd3b84c7f776c095d7953c496912052b5af87d53cebe1c20","worktree_digest":"sha256:d9cff655ec292c76cd3b84c7f776c095d7953c496912052b5af87d53cebe1c20","untracked_digest":"absent"},{"path":"src/App.tsx","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:5b987e2684d80ae7b1f28059c92d8bf8847ce7150a0b18792ebf4da8a479d07e","index_digest":"sha256:5b987e2684d80ae7b1f28059c92d8bf8847ce7150a0b18792ebf4da8a479d07e","worktree_digest":"sha256:252f57731dac781886ce115efa7011e6636f89f71221ffe0cd2ebd373dec01cb","untracked_digest":"absent"},{"path":"src/env.d.ts","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:6b1bd5c40e348c2d32a8bfdb74a381d958f4ce6bed9e7794c330923c224ab353","index_digest":"sha256:6b1bd5c40e348c2d32a8bfdb74a381d958f4ce6bed9e7794c330923c224ab353","worktree_digest":"sha256:6b1bd5c40e348c2d32a8bfdb74a381d958f4ce6bed9e7794c330923c224ab353","untracked_digest":"absent"},{"path":"src/lib/agent-manager/src/schemas/agent-config.ts","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:647de39e7b715f53468e3c8644086fa85b3acbb2ed4ddee9ef6e20a41f4b6d1b","index_digest":"sha256:647de39e7b715f53468e3c8644086fa85b3acbb2ed4ddee9ef6e20a41f4b6d1b","worktree_digest":"sha256:647de39e7b715f53468e3c8644086fa85b3acbb2ed4ddee9ef6e20a41f4b6d1b","untracked_digest":"absent"},{"path":"src/main.tsx","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:b84a28324c296793f4031c34e8390a54cc0d2766fade0902e2716e4471198251","index_digest":"sha256:b84a28324c296793f4031c34e8390a54cc0d2766fade0902e2716e4471198251","worktree_digest":"sha256:b84a28324c296793f4031c34e8390a54cc0d2766fade0902e2716e4471198251","untracked_digest":"absent"},{"path":"tsconfig.electron.json","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:eebe603cfafaee9e16d6bf570ddd9a51a84f792767c156054428dc7599f795ed","index_digest":"sha256:eebe603cfafaee9e16d6bf570ddd9a51a84f792767c156054428dc7599f795ed","worktree_digest":"sha256:eebe603cfafaee9e16d6bf570ddd9a51a84f792767c156054428dc7599f795ed","untracked_digest":"absent"},{"path":"tsconfig.json","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:1522ae89b4e7c7aeab1b70cdd2e6512dd1aad2c5f9f2b2d893e045f8471be848","index_digest":"sha256:1522ae89b4e7c7aeab1b70cdd2e6512dd1aad2c5f9f2b2d893e045f8471be848","worktree_digest":"sha256:1522ae89b4e7c7aeab1b70cdd2e6512dd1aad2c5f9f2b2d893e045f8471be848","untracked_digest":"absent"},{"path":"tsconfig.preload.json","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:da6b2334250cf9385f947fd2cd45c09ca063404ef686e8673959030b51900e5c","index_digest":"sha256:da6b2334250cf9385f947fd2cd45c09ca063404ef686e8673959030b51900e5c","worktree_digest":"sha256:da6b2334250cf9385f947fd2cd45c09ca063404ef686e8673959030b51900e5c","untracked_digest":"absent"}]}
  primary_symbols:
    - { symbol: getApiKey, file: electron/settings.ts, lines: '40-46', role: 'sync key read; becomes cache-backed' }
    - { symbol: updateSettings, file: electron/settings.ts, lines: '76-92', role: 'becomes async; encrypt-first then load/mutate/save' }
    - { symbol: extractPdf, file: electron/extract.ts, lines: '122-137', role: 'unpdf 1.x API change' }
  related_symbols:
    - { symbol: getSettings, relationship: 'CALLS getApiKey (d=1)', relevance: 'must stay sync; 6 sync callers' }
    - { symbol: request, relationship: 'CALLS getApiKey (d=1), electron/llm.ts:29-30', relevance: 'needs cache initialised before IPC' }
    - { symbol: 'app.whenReady callback', relationship: 'electron/main.ts:52-56', relevance: 'await initApiKey() here' }
  execution_path:
    - 'app.whenReady → (new) await initApiKey() → registerAllDiscovered() → createWindow()'
    - 'renderer window.api.ai.* → ipcMain.handle → llm.request → getApiKey (sync, cache) → fetch NVIDIA'
    - 'renderer AiSettings/ModelPicker → ai:updateSettings → updateSettings (async)'
  pdg_constraints:
    - description: 'Validation and encryption guard precede the write'
      affected_statements: ['electron/settings.ts:78', 'electron/settings.ts:86', 'electron/settings.ts:87', 'electron/settings.ts:90']
      implementation_consequence: 'Keep normalizeBaseUrl and the availability check before save(); nothing written on failure.'
    - description: 'load (77) and save (90) must not straddle an await'
      affected_statements: ['electron/settings.ts:77', 'electron/settings.ts:90']
      implementation_consequence: 'Await isAsyncEncryptionAvailable/encryptStringAsync first; then load→mutate→save synchronously.'
    - description: 'Key read falls back to NVIDIA_API_KEY when no blob or decrypt fails'
      affected_statements: ['electron/settings.ts:42', 'electron/settings.ts:43', 'electron/settings.ts:45']
      implementation_consequence: 'Cache miss or failed initApiKey must still fall back to the env var.'
  architectural_patterns:
    - { pattern: 'Main-process-only secrets; renderer gets hasKey/keyHint only', example_location: electron/settings.ts getSettings, usage_guidance: 'Never return the key over IPC.' }
    - { pattern: 'Sandboxed CJS preload compiled from .cts', example_location: electron/preload.cts, usage_guidance: 'Only require("electron"); no Node shims (Electron 45).' }
    - { pattern: 'Exact version pins in package.json', example_location: 'package.json unpdf: 0.12.1', usage_guidance: 'Pin exact versions for the upgrade.' }
  files_to_modify:
    - { file: package.json, symbols: [dependencies, devDependencies, scripts], intended_change: 'bump/pin, remove vite-plugin-electron*, add test:electron' }
    - { file: tsconfig.json, symbols: [compilerOptions], intended_change: 'remove baseUrl/paths; exclude tests/**' }
    - { file: tsconfig.preload.json, symbols: [compilerOptions], intended_change: 'module/moduleResolution NodeNext' }
    - { file: src/env.d.ts, symbols: [], intended_change: 'add vite/client reference' }
    - { file: src/App.tsx, symbols: [App], intended_change: 'useRef<number | undefined>(undefined) at line 102' }
    - { file: electron/lib/agent-manager/src/schemas/agent-config.ts, symbols: ['z.record fields lines 34, 46'], intended_change: 'z.record(z.string(), z.unknown())' }
    - { file: src/lib/agent-manager, symbols: [], intended_change: 'delete (unused duplicate)' }
    - { file: electron/extract.ts, symbols: [extractPdf], intended_change: 'drop isEvalSupported; pdf.loadingTask.destroy()' }
    - { file: electron/settings.ts, symbols: [getApiKey, updateSettings, initApiKey], intended_change: 'async safeStorage with sync cache' }
    - { file: electron/main.ts, symbols: ['app.whenReady callback'], intended_change: 'await initApiKey() before registerAllDiscovered/createWindow' }
  tests:
    - file: tests/electron/settings-keys.mjs
      scenarios:
        - 'E28 encryptString blob in temp userData → initApiKey() on E45 → getApiKey() equals original'
        - 'updateSettings({apiKey}) → getApiKey() returns it; file has no plaintext'
        - 'Promise.all(updateSettings({apiKey}), updateSettings({model})) → both persisted'
        - 'updateSettings({apiKey, baseUrl: build.nvidia.com}) → throws; file unchanged'
        - 'isAsyncEncryptionAvailable() false (stub) → throws; nothing written'
        - 'updateSettings({apiKey: ""}) → hasKey false'
    - file: 'tests/electron/{organizer,content,models,security,errors,ui-organize}.mjs'
      scenarios: ['ported unchanged in behaviour; import dist-electron relative to repo; clean userData after process exit']
  verification_commands:
    - npm run typecheck
    - npm run build:electron
    - npx vite build
    - npm run test:electron
    - npm run build:dir
    - npm run electron:dev
  risks:
    - 'Lost update if load/save straddle an await in updateSettings'
    - 'IPC before initApiKey completes would see no key — await it before createWindow'
    - 'Electron 45.0.0 is days old (user chose it, D3); fallback 44.9.3 only on a blocker, with its own test run'
    - 'First run downloads the Electron binary (Electron 42+): offline/CI impact'
    - 'app.asar grew 27 MB → 42 MB'
  assumptions:
    - 'The six out-of-repo suites are the behaviour baseline — check: they pass on HEAD (Electron 28) before step 2'
    - 'Removing the @/ and @electron/ tsconfig aliases breaks nothing — check: searching src/ and electron/ for imports starting with @/ or @electron/ finds none'
  open_questions:
    - 'May step 10 confirm the user real saved key on the new build (reads real settings; never prints the key)?'
    - 'Move bundled renderer libs (react, react-dom, lucide-react) to devDependencies to shrink app.asar?'
    - 'Install eslint or drop the broken lint script?'
  avoid:
    - 'Do not repeat full repository discovery'
    - 'Do not replace established patterns without evidence'
    - 'Do not leave any synchronous safeStorage call (removed in Electron 46)'
    - 'Do not put an await between load() and save() in updateSettings'
    - 'Do not make getSettings/getApiKey async (6 sync callers)'
    - 'Do not add Node shims (Buffer, events, url) to the preload'
    - 'Do not isolate test userData via APPDATA; use app.setPath before imports'
    - 'Do not print or log the decrypted API key in tests or code'
    - 'Do not upgrade unpdf before Electron (needs Node >= 22)'
```

## 12. Assumptions and Open Questions

**Assumptions:**

- [assumed] The six scratchpad suites cover the behaviour that matters. They were written alongside the features, but they are not a formal spec.
- [assumed] TS 7 editor and tooling integration is acceptable to the user. Only the CLI `tsc` 7.0.2 was exercised.

**Open questions for the user:**

1. Resolved: Electron **45.0.0**, chosen by the user on 2026-10-24 (D3).
2. Should step 10 include confirming the user's real saved key on the new build? That reads the real settings folder; the key is never printed.

**Deferred follow-ups** (not part of this task):

- Move Vite-bundled renderer packages (react, react-dom, lucide-react) to devDependencies to shrink `app.asar`. The trial showed 42 MB.
- The `lint` script references `eslint`, which is not installed. Either add ESLint or remove the script.
- The `vite.config.ts` `@`/`@electron` aliases are unused. Remove them for consistency with the tsconfig.
- The `dialog:*` IPC handlers have no renderer caller. Electron 43's Downloads default makes them behave differently if they are ever wired up.
- Search and grep still run synchronously on the main thread (pre-existing; unrelated to the upgrade).

## 13. Definition of Done

- `package.json` pins exact versions for every package listed in §6.1. `vite-plugin-electron*` and `src/lib/agent-manager/` are gone.
- `npm run typecheck`, `npm run build:electron` and `npx vite build` exit 0 on TypeScript 7.
- `npm run test:electron` passes every suite: organizer 12, content 17, models 9, security 16 with no canary leaked, errors 12, ui-organize 7, plus the six new settings-keys scenarios. The output has no Electron `deprecated` lines.
- `electron/settings.ts` contains no calls to `encryptString(`, `decryptString(` or `isEncryptionAvailable(` (grep check).
- `npm run build:dir` succeeds. The packaged app launches and shows `window.api`, the drive list and 4 agents.
- A blob encrypted under Electron 28 decrypts on the upgraded build (test), and the user's existing saved key still works (manual confirmation with consent).
