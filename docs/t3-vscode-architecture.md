# T3 VSCode — Architecture

Product name: **T3 VSCode**. Bring T3 Code functionality into VS Code with native theme colors and workspace session management. The feature matrix is reference material, not an approved scope checklist. The approved Sessions sidebar and compact chat designs supersede the original Kimi reskin requirement.

## 1. Goals & constraints

- Chat with T3-backed agents (Codex, Claude, Cursor, Grok, OpenCode, Antigravity, **Kimi via ACP registry**) from inside VS Code.
- Two surfaces, same app: a sidebar session manager and chat editor tabs arranged with native editor groups/windows.
- Use T3 Code’s UI, components and visual conventions as the baseline. Adapt navigation and layout to VS Code’s sidebar and editor tab; assess further visual changes after the migration.
- Linux first. Prerequisite: `t3 service install` done and running.
- Scope projects and threads to the opened VS Code folders, matching canonical project workspace roots. Include those projects' worktree and archived threads; an empty window can browse all projects. This supersedes the original unfiltered requirement.
- Agents run on the T3 server (this machine, via service) — the extension is a thin client.

## 2. Repository layout

```
t3-vscode/
├── package.json                  # extension manifest, contributes: views, commands, keybindings
├── src/
│   ├── extension.ts              # activation, command registration
│   ├── host/
│   │   ├── serverDiscovery.ts    # find running t3 service (runtime state + probe)
│   │   ├── pairing.ts            # shell out to `t3 pair`, complete token exchange
│   │   ├── sessionStore.ts       # credential in VS Code SecretStorage, shared across windows
│   │   ├── t3Client.ts           # connection lifecycle over vendored client-runtime
│   │   ├── hostState.ts          # projections, subscriptions, history and user actions
│   │   ├── bridge.ts             # postMessage RPC between webviews and host
│   │   └── workspaceContext.ts   # opened folders (navigation scope, cwd default, file resolution)
│   ├── shared/bridge.ts          # typed host snapshots and allowed UI intents
│   └── webview/                  # React app (chat UI; native toolbar in extension.ts)
│       ├── App.tsx
│       ├── bridge-client.ts      # host bridge client
│       ├── components/           # ported T3 components (see §6)
│       └── styles/tokens.css     # native VS Code theme colors and webview layout
├── vendor/
│   ├── contracts/                # copied from t3-code (license permitting)
│   ├── client-runtime/           # copied; only needed subpaths
│   └── shared/                   # transitive dep of the two above
├── target-installer/             # gitignored compiled VSIX packages
└── docs/
```

Tech: TypeScript ESM, Vite for the webview bundle, `effect` (comes with vendored code). No React in host code.

## 3. Server discovery & lifecycle

1. On activation, resolve T3 home: `t3-vscode.t3Home` setting → `T3CODE_HOME` env → `~/.t3`.
2. Read `<home>/userdata/server-runtime.json` (or `<home>/dev/server-runtime.json` for implicit dev homes); if present, verify pid alive and probe `/.well-known/t3/environment` to confirm it's a T3 server and capture the environment descriptor.
3. If no live server: surface a setup view — "run `t3 service install`" — do **not** auto-spawn (prerequisite model, per decision).
4. Handle port drift: always resolve origin from runtime state, never a hardcoded port.

## 4. Auth

- Pairing exchange: `t3 pair --label "VS Code" --base-dir <home>` (shell out to installed `t3` CLI), parse the printed token, then use T3's headless exchange to obtain a durable session. Always pass the discovered home; never fall back to a command targeting the default home.
  - Resolved in §8: use the vendored headless bearer exchange, followed by a WebSocket ticket. The local browser’s cookie flow is reference behavior rather than an extension dependency.
- Store the session credential in VS Code `SecretStorage` (global, shared across windows).
- If a call returns auth failure → re-pair once, then show setup view.
- Scope note: standard client scopes are sufficient (orchestration read/operate, terminal, review, relay read). No admin scopes.

## 5. Webview surfaces & state

- One React app, sidebar and editor host containers:
  - `WebviewViewProvider` (sidebar, activity bar icon)
  - `WebviewPanel` ("Open Chat in Editor Tab" command)
- Webviews are **thin**: all T3 connection and state lives in the extension host (`t3Client` + vendored client-runtime stores). Webviews render host state and send intents over a typed postMessage bridge (mirrors Kimi's `bridge.ts` pattern, which is a proven template for this exact split).
- One host-side connection owns the shared project list and thread projections. Each webview has its own selected thread, sending state and draft project/model/modes; changing navigation in one view never selects a conversation in another. Selecting an already open session reveals its panel; each editor otherwise owns its conversation and draft, and the session manager does not become a chat reference target. Native chat tab titles follow the selected conversation and live renames; Usage remains in the sidebar.
- Subscribe once per distinct thread selected by any open view. Views intentionally showing the same thread share its live projection. Release a thread subscription when its last view leaves; closed views and late callbacks cannot restore old selections. Reconnecting restores each view independently.
- The sidebar is a dedicated Sessions page with Account & Usage collapsed. Settled and Archive remain separate shelves, and one New control stays above search. Redundant native History/New/Open in Editor/Usage title shortcuts and the separate Usage editor are removed. Account & Usage preserves all quota windows, source notices, provider links, refresh and reported update times; clicking a status meter expands the selected account. Editor chats retain a compact breadcrumb, thread actions and browser shortcut; the globe opens the current session URL without carrying credentials.

## 6. Rendering: T3 UI in a VS Code webview

- Editor chat uses a single LegendList virtualized transcript at all widths; the two-column reflow engine and its settings were removed after v0.0.9. Equations retain horizontal scrolling, floating previews and their original citation DOM.
- Port T3 web chat components for the turn-item taxonomy (`contracts/src/orchestrationV2.ts:1293-1495`): `user_message`, `assistant_message`, `reasoning`, `proposed_plan`, `todo_list`, `user_input_request`, `file_change`, `command_execution`, `file_search`, `web_search`, `approval_request`, `checkpoint`, `run_interrupt_*`, `system_notice`, `error`, `compaction`, `handoff`, `fork`, `thread_created`, `subagent`, `dynamic_tool`, `notification`.
- Reuse `client-runtime` `work-log/presentation` + `turn-item-presentation` for labels/summaries instead of re-deriving them.
- Reuse T3’s work-log rows, typography and chat layout. Colors come from native VS Code theme CSS variables for editor, sidebar, input, selection, links, borders, progress and errors. Preserve portable components and adapt web-only router, clipboard, file-open and state dependencies at the bridge boundary. VS Code theme changes update these variables without resetting drafts.
- Font preferences use T3's interface/prompt/code defaults and bounds. Native VS Code Settings under Extensions → T3 VSCode group Appearance, Reading, Usage and Connection, retaining existing keys and saved values; Appearance owns font editing and persistence. The host reads configuration and broadcasts the resolved preferences to every surface; renderers scale interface typography through the root font size and use independent pixel values for the prompt and code. Appearance edits preserve each view's conversation and draft and work without a server connection.
- Long threads: virtualized list from day one (T3's perf ethos; high-refresh users notice dropped frames).
- The configurable message rail indexes user exchanges with stable keys and binary-search pointer mapping; virtualized jumps preserve drafts and keep the reading position during streaming. Returning to the bottom restores streaming follow. Reasoning starts closed and contiguous work entries share a collapsed summary without swallowing messages, checkpoints, subagents or HTML graphics.
- Markdown uses raw-HTML parsing followed by sanitization before trusted-disabled KaTeX rendering. Mermaid loads from a separate local bundle only when a diagram is visible and complete; strict parsing and SVG sanitization remove unsafe markup and authored links. Math CSS and WOFF2 fonts are packaged locally. Equation context actions copy the stored LaTeX annotation, delimiter-wrapped source or MathML through the native clipboard bridge.
- Asset intents name a selected thread and its persisted source item. The host verifies ownership, resolves relative media against the source thread's worktree, and mints short-lived same-origin asset URLs; host bearer credentials stay outside renderers. T3 `html_render` metadata drives responsive heights. HTML frames allow scripts/interactions but omit `allow-same-origin`; they receive theme variables and a validated external-link adapter rather than access to the extension bridge.
- VS Code's injected webview API aliases `window.parent` to the content window. Bridge replies therefore validate the real outer frame's webview origin and reject child iframe senders, including opaque-origin HTML graphics, rather than relying on parent-window identity.
- Uploads use the server's capability-advertised signed upload endpoint from the host. Renderer drafts hold validated attachment metadata, thumbnails and cursor-positioned canonical t3-context references; the host validates bindings and builds message context from owned uploads; trusted host ownership follows explicit editor handoff. Pending work settles before handoff; queue and steer carry the same attachments. Unsent uploads release after queued sends finish, and close-during-upload removes unowned files without deleting sent attachments.
- Session trees use visible lineage only, keep forks as ordinary conversations, handle missing/cyclic parents, and preserve separate Active/Settled/Archive membership with ancestor context. Branches start collapsed independently in each section; search retains and expands matching ancestors. Subagent cards receive current child status through context without invalidating every memoized message row. Provider-native children are read-only; app-owned children can receive messages.
- Only untouched conversations created by this host are cleanup candidates. Typing, references, attachments, sends and thread management remove candidacy. The last chat surface closes before cleanup, and a durable projection recheck protects external content/metadata; existing empty threads and disconnected cleanup remain preserved.

## 7. Migration priorities

Migrate the core chat workflow first. The unfilled KEEP column does not define scope:
- Thread navigation (workspace projects, list, search, pin, archive/restore, delete and response forks)
- Composer (server model catalog, modes, Stop, references, clipboard/file attachments and native picker)
- Checkpoints/diff view (server-side git refs; optional native `vscode.diff` per file)
- Approvals & questions rendering
- Usage/quota widgets
- v2 candidates: PR surfaces, terminal panel, scheduling UI

## 8. Open spikes (resolve before/while building)

1. **Pairing exchange internals** — ✅ RESOLVED (M0). The web `/pair` flow is cookie-based (`POST /api/auth/browser-session`, JSON `{credential}` → HttpOnly `t3_session*` cookie), which headless Node cannot use. The headless path the extension implements (same one mobile + hosted pairing use, via vendored client-runtime):
   1. `t3 pair --label "VS Code" --base-dir <home>` prints a single-use 12-char token (alphabet `23456789A-Z` sans `I/O`; parse the full run — a `[A-Z2-7]` class silently truncates tokens containing `8` or `9`).
   2. `POST /oauth/token` (form-encoded): `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token=<token>`, `subject_token_type=urn:t3:params:oauth:token-type:environment-bootstrap`, `requested_token_type=urn:ietf:params:oauth:token-type:access_token` → durable 30-day bearer.
   3. `POST /api/auth/websocket-ticket` with `Authorization: Bearer` → 5-min reusable ticket.
   4. `GET /ws?wsTicket=…&orchestrationProtocol=2` (the protocol param is mandatory — server 426s without it). Auth is on the HTTP upgrade only.
   Same-machine shortcut for dev: `t3 auth session issue --token-only` mints a durable admin bearer directly; not used by the extension (standard scopes only). Credential lives in VS Code SecretStorage; on auth failure → clear, re-pair once, else setup view.
2. **License check** — ✅ RESOLVED. MIT (Copyright (c) 2026 T3 Tools Inc.): use/copy/modify/merge/publish/distribute/sublicense/sell permitted; condition is retaining the copyright+permission notice → shipped as `vendor/LICENSE.t3code` (must go into any distributed extension's third-party notices). Packages are not npm-published (`private`, source-only exports) so source vendoring is the only route.
3. **Item-fidelity pass** — core renderers implemented. Portable work-log, approval, system-divider and wordmark components are copied from T3. The typed timeline covers the turn-item union, with markdown, reasoning, tool output, diffs, plans and request history. Interactive checkpoint restore and specialized tool previews remain later work; core rendering is not complete web-app parity.
4. **Subscription load** — bounded snapshots and progressive history implemented. Each distinct conversation selected by an open view has one subscription; switching or closing a view only releases conversations with no remaining views. No unselected projections remain cached. Older pages use the authenticated history endpoint and the vendored merge helper to preserve newer live items. Active shell updates and the on-demand archived shell have separate subscriptions. Bridge pushes are coalesced and carry each view's own snapshot; targeted bridge deltas remain an optimization for later profiling.
5. **Native web pop-out feasibility** — tested against an isolated server. The original UI supports a preset project filter and independent routes/drafts across browser windows. Its filter is `sidebarProjectScopeKey` in `t3code:ui-state:v1` local storage, derived with `deriveLogicalProjectKey`; a thread URL alone does not set workspace scope. A plain iframe in a disposable VS Code editor timed out establishing the authenticated session. The native renderer also opens file links through its own right-panel store rather than the extension bridge. Reusing it inside VS Code requires a cooperative adapter for authentication, workspace scope, editor links and references; the shipped editor surface retains the host-owned connection and typed bridge.
6. **Saved-turn file contents** — the server review API computes a merge base against HEAD and reads the new side from disk, even with `headRef`. The same-machine native editor adapter therefore reads Git blobs at the two trusted T3 checkpoint refs. The server owns the range, file list and checkpoint metadata; the adapter never compares against HEAD or writes the repository. A remote workspace would need a server API that returns both immutable file versions.

## 9. Milestones

- **M0 — spike:** ✅ DONE (verified end-to-end). Discovery (`server-runtime.json` + pid + `/.well-known/t3/environment`) → `t3 pair` → headless `/oauth/token` exchange → WS ticket → Effect-RPC session (vendored client-runtime) → `subscribeShell` (all projects/threads, no filtering) → `projects.ensureScratch` → `thread.create` → `message.dispatch` → `subscribeThread` (bounded snapshot replay + live `turn-item.updated`) → assistant reply rendered as plain text.
  - Proof: `scripts/spike.ts` (`pnpm run spike -- --base-dir /tmp/t3-vscode-m0`) passes against an isolated server (`t3 serve --base-dir /tmp/t3-vscode-m0 --port 47777`, never the live `~/.t3`): final `assistant_message` "SPIKE-OK" from a real provider turn.
  - Vendoring notes: `vendor/` holds contracts, client-runtime and shared, with narrow adapter exports documented in `vendor/README.md`. The MIT notice must ship in distributions. The host is a compiled ESM bundle (`dist/extension.mjs`, tsdown); only VS Code and Node built-ins remain external. The webview is a single IIFE (`dist/webview.js`, Vite + CSS injection).
- **M1 — core chat:** implemented. VS Code theme colors and portable T3 components, a virtualized rich timeline, server-advertised models (including ACP), capability-driven effort and permission controls, provider-instance model search/favorites, Alt+K file references, assistant citations with optional comments, native font settings, Stop, approvals/questions and progressive history. The compact composer has plain selectors below the input; Sessions offers right-click rename/pin/archive/restore/delete, with native rename and deletion confirmation. Completed assistant responses expose capability-gated forks; only the originating view opens the new conversation. File links open VS Code's editor at their native line or range. Verification uses behavior tests, deterministic browser fixtures and real VS Code against an isolated server. The sidebar manages Sessions with Account & Usage collapsed, searchable native message snippets and separate Settled and Archive shelves; conversations open or reveal independent editor tabs. Provider commands/skills and workspace file suggestions use the native indexes; Sidebar usage and native status meters retain each subscription’s identity; duplicate credentials collapse to one account. Month/week/session windows remain separate; status meters omit unreported windows while the sidebar and tooltips explain missing data. The Command Palette configures meters without a status-bar ellipsis. Queue/Steer and queued-message edits/reordering/promotion follow server capabilities, with task progress from the active run's own todo plan. Saved file diffs compare the recorded parent and completed checkpoint refs in the native editor, including a baseline retained after a cancelled turn. Clipboard/file upload drafts, image thumbnails, authenticated media, interactive HTML, Mermaid and KaTeX copying are implemented; specialized-tool fidelity remains deferred.
- **M2 — surfaces:** implemented. The session manager and editor tabs have independent selection over shared host projections; each editor owns its draft. Native sidebar controls avoid a duplicate toolbar; editor tabs have scoped project navigation and a chat header. Shell summaries supply Input/Approval badges and static Working indicators without subscribing to unopened thread projections. Pending request IDs are deduplicated per environment/thread for native VS Code notifications; only workspace-scoped, non-archived sessions qualify. Supplied ribbon assets brand the activity bar and tabs. Host/bridge regression tests and three built webviews exercise switching, streaming, new threads, reconnect and subscription cleanup without launching the user's VS Code installation.
- **M3:** continue T3 feature migration (checkpoint restore, terminal/preview surfaces and specialized tools), prioritizing after review of the core chat experience.
- Verification: `scripts/verify-host.ts` and `scripts/verify-draft.ts` require an explicit isolated server home; `scripts/verify-ui.mjs` exercises the built UI with fixtures; `scripts/verify-views.ts` checks three built webviews over the actual host/bridge with a deterministic transport. `scripts/verify-edh.mjs` launches a disposable Default profile against an isolated home, with separate user, extension and shared application storage. It exercises native settings, Alt+K, citations, model controls and independent conversations in real VS Code. Its `--deep` pass verifies immutable turn diffs and native queue promotion/task progress with real provider turns. The `--requests-only` pass verifies an unopened session’s native notification, its Open session action reusing an existing tab and question resumption; `--setup-only` verifies setup after the isolated server is stopped. No integration check uses the live `~/.t3` service. Local VSIX packaging is verified; cross-window movement still needs verification.

## Feature history and release review

[feature-history.md](feature-history.md) contains the linked feature overview and concise per-version histories. Update the table and the affected feature sections in the same change. [AGENTS.md](../AGENTS.md) requires a separate reviewer started with fresh context before any VSIX is packaged; fix blocking regressions, verify the final changes and record the result before building the installer. Native tests isolate user data, extension storage, shared storage and T3 state.
