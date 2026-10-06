# VS Code × T3 Code Extension — Architecture Draft v0.2

Working name: **t3-vscode** (placeholder). Migrate T3 Code functionality and UI into VS Code. The feature matrix is reference material, not an approved scope checklist. The October 6 direction supersedes the original Kimi reskin requirement.

## 1. Goals & constraints

- Chat with T3-backed agents (Codex, Claude, Cursor, Grok, OpenCode, Antigravity, **Kimi via ACP registry**) from inside VS Code.
- Two surfaces, same app: sidebar chat view **and** pop-out editor tab (movable across VS Code windows). Hard requirement.
- Use T3 Code’s UI, components and visual conventions as the baseline. Adapt navigation and layout to VS Code’s sidebar and editor tab; assess further visual changes after the migration.
- Linux first. Prerequisite: `t3 service install` done and running.
- Show all threads/projects (no per-workspace filtering).
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
│   │   ├── bridge.ts             # postMessage RPC between webviews and host
│   │   └── workspaceContext.ts   # opened folder (cwd default, file resolution only)
│   └── webview/                  # React app (the entire UI)
│       ├── App.tsx
│       ├── bridge-client.ts      # host bridge client
│       ├── components/           # ported T3 components (see §6)
│       └── styles/tokens.css     # T3 palette and webview layout
├── vendor/
│   ├── contracts/                # copied from t3-code (license permitting)
│   ├── client-runtime/           # copied; only needed subpaths
│   └── shared/                   # transitive dep of the two above
└── docs/
```

Tech: TypeScript ESM, Vite for the webview bundle, `effect` (comes with vendored code). No React in host code.

## 3. Server discovery & lifecycle

1. On activation, resolve T3 home: `T3CODE_HOME` env → `~/.t3` (same precedence as `t3 pair`).
2. Read `<home>/userdata/server-runtime.json` (or `<home>/dev/server-runtime.json` for implicit dev homes); if present, verify pid alive and probe `/.well-known/t3/environment` to confirm it's a T3 server and capture the environment descriptor.
3. If no live server: surface a setup view — "run `t3 service install`" — do **not** auto-spawn (prerequisite model, per decision).
4. Handle port drift: always resolve origin from runtime state, never a hardcoded port.

## 4. Auth

- Pairing exchange: `t3 pair --label "vscode"` (shell out to installed `t3` CLI), parse the printed token, then perform the same exchange the web client does at `/pair` to obtain a durable session.
  - Resolved in §8: use the vendored headless bearer exchange, followed by a WebSocket ticket. The local browser’s cookie flow is reference behavior rather than an extension dependency.
- Store the session credential in VS Code `SecretStorage` (global, shared across windows).
- If a call returns auth failure → re-pair once, then show setup view.
- Scope note: standard client scopes are sufficient (orchestration read/operate, terminal, review, relay read). No admin scopes.

## 5. Webview surfaces & state

- One React app, two host containers:
  - `WebviewViewProvider` (sidebar, activity bar icon)
  - `WebviewPanel` ("Open Chat in Editor Tab" command)
- Webviews are **thin**: all T3 connection and state lives in the extension host (`t3Client` + vendored client-runtime stores). Webviews render host state and send intents over a typed postMessage bridge (mirrors Kimi's `bridge.ts` pattern, which is a proven template for this exact split).
- Multiple webviews open simultaneously must stay in sync through the single host-side store.

## 6. Rendering: T3 UI in a VS Code webview

- Port T3 web chat components for the turn-item taxonomy (`contracts/src/orchestrationV2.ts:1293-1495`): `user_message`, `assistant_message`, `reasoning`, `proposed_plan`, `todo_list`, `user_input_request`, `file_change`, `command_execution`, `file_search`, `web_search`, `approval_request`, `checkpoint`, `run_interrupt_*`, `system_notice`, `error`, `compaction`, `handoff`, `fork`, `thread_created`, `subagent`, `dynamic_tool`, `notification`.
- Reuse `client-runtime` `work-log/presentation` + `turn-item-presentation` for labels/summaries instead of re-deriving them.
- Reuse T3’s work-log rows, typography, chat layout and light/dark palette. Preserve portable components and adapt web-only router, clipboard, file-open and state dependencies at the bridge boundary. VS Code theme classes choose light/dark appearance.
- Long threads: virtualized list from day one (T3's perf ethos; high-refresh users notice dropped frames).

## 7. Migration priorities

Migrate the core chat workflow first. The unfilled KEEP column does not define scope:
- Thread sidebar (list, search, pin/snooze/archive as approved)
- Composer (T3 tiptap port or Kimi textarea — decide in matrix)
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
3. **Item-fidelity pass** — pending (M1). Skim T3 web components for the 21 item types; size the port (which are trivial vs which pull heavy deps like tiptap/diff workers).
4. **Subscription load** — ✅ RESOLVED at the contract level (M0 implementation follows it). `subscribeThread` replays: no `afterSequence` → a snapshot frame (bounded window + `historyCursor`/`hasMoreHistory` when `acceptBoundedSnapshot: true`; the extension sets it), then live events; `afterSequence` → bounded persisted-event replay with `synchronized` marker when `requestCompletionMarker: true`. Older pages: `GET /api/orchestration/threads/:threadId/history?cursor=…`. M0 caps buffered turn items per thread (1000) and renders text only.

## 9. Milestones

- **M0 — spike:** ✅ DONE (verified end-to-end). Discovery (`server-runtime.json` + pid + `/.well-known/t3/environment`) → `t3 pair` → headless `/oauth/token` exchange → WS ticket → Effect-RPC session (vendored client-runtime) → `subscribeShell` (all projects/threads, no filtering) → `projects.ensureScratch` → `thread.create` → `message.dispatch` → `subscribeThread` (bounded snapshot replay + live `turn-item.updated`) → assistant reply rendered as plain text.
  - Proof: `scripts/spike.ts` (`pnpm run spike -- --base-dir /tmp/t3-vscode-m0`) passes against an isolated server (`t3 serve --base-dir /tmp/t3-vscode-m0 --port 47777`, never the live `~/.t3`): final `assistant_message` "SPIKE-OK" from a real provider turn.
  - Extension Dev Host verified: sidebar + editor tab host the same webview; auto-pairing on activation; thread history renders on select; view/title actions use codicon buttons (`$(link-external)`, `$(plug)`); narrow sidebar collapses the thread list into a ☰ overlay via CSS container query.
  - Known M0 limits (by design): plain-text rendering only (component port is M1); no composer extras; whole-state bridge pushes (targeted deltas later); packaging (vsce dep bundling) not done.
  - Vendoring notes: `vendor/` holds contracts+client-runtime+shared (tests stripped, `devDependencies` stripped, `catalog:` inlined); two subpath exports added (`./rpc/session`, `./rpc/http`) — see `vendor/README.md`. Host bundles are ESM (`dist/extension.mjs`, tsdown) with runtime `node_modules` resolution; webview is a single IIFE (`dist/webview.js`, vite + css-injected-by-js).
- **M1:** sidebar chat with T3 components for the core item types (messages, reasoning, tool calls, approvals, diffs).
- **M2:** editor-tab surface + multi-webview sync.
- **M3:** continue T3 feature migration (checkpoints UI, usage widgets, composer extras…), prioritizing after review of the core chat experience.
- Verification: manual against a dev server first; later the `test-t3-app` skill flow (isolated home, never the live `~/.t3`).
