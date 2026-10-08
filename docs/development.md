# Development and testing

See the [README](../README.md) for installation and chat features. Run these commands from the repository root with Node.js 22 or later.

## Build and check

```sh
pnpm install
pnpm run build
pnpm run typecheck
pnpm run test
code --new-window --profile Default .
```

## Test from VS Code

1. Open this repository in VS Code and run `pnpm install` once.
2. Run **Terminal → Run Task → T3 VSCode: start isolated server**. Leave its terminal running. The server uses `/tmp/t3-vscode-dev-t3-vscode` for state and port `47777`; stop it with Ctrl+C in that terminal when finished.
3. Select **T3 VSCode: Run Extension (Isolated Server, Default Profile)** in **Run and Debug**, then press **F5**. The pre-launch task copies your **Default** profile into isolated development storage on first use, builds both bundles, and opens a new Extension Development Host window using that copy.
4. In that new window, open **T3 VSCode** in the activity bar. Select a session or use the single New control above search to open an editor chat. Before sending, choose a model, effort and permissions below the input. In multi-root workspaces choose an opened folder; an empty window also offers **No project** when supported. Open another conversation and check that each editor retains its own draft. Right-click a session to rename, pin, settle, archive, restore or delete it; deletion asks for native confirmation.

After editing the extension or UI, stop debugging and press F5 again to rebuild. Breakpoints in the host TypeScript use the generated source maps. **T3 VSCode: checks** runs typechecking and regression tests; **T3 VSCode: verify UI** checks the built UI with browser fixtures; **T3 VSCode: verify isolated host** sends a real provider turn to the development server.

The launch configuration passes `--profile=Default` and points `--user-data-dir`, `--extensions-dir` and `--shared-data-dir` into `.t3/vscode-profile`. The first launch copies the Default profile's settings, keybindings, snippets and installed extensions; later launches keep changes made in that development copy. The real profile and installation stay outside the development instance. **Always isolate all three directories:** a fresh user-data directory sharing the real extension directory can cause VS Code to clean up extensions referenced only by the real profiles. Use `--shared-data-dir` to isolate shared application storage too. The automated `verify-edh.mjs` check uses fresh temporary storage for all three directories and copies Default settings and keybindings.

`launch.json` sets `T3CODE_HOME` to `/tmp/t3-vscode-dev-${workspaceFolderBasename}`, and workspace settings leave `t3-vscode.t3Home` empty so that environment value takes effect. The server's data must be outside a Git checkout: T3 disables its Scratch folder (the web UI's **No project** conversations) inside a checkout. Start the server task before F5; the extension discovers the existing server. The previous `.t3/vscode-dev` data is preserved but no longer used by this launch configuration.

If the development window shows **Connect to T3 Code**, follow **Start your development server** and run **T3 VSCode: start isolated server** in the original repository window, keep its terminal open, then choose **Retry connection**. A running background service under `~/.t3` does not satisfy this isolated development configuration. Pairing happens after the development server is available, and the sidebar then opens Sessions directly.

The repository's gitignored `.t3` directory holds the isolated VS Code profile and any previous development-server data. The current debug server uses `/tmp` instead. Normal extension use discovers the shared T3 home (`~/.t3` by default); it does not create `.t3` in each project.

## Automated verification

`node --import tsx --test src/host/pairing.test.ts` checks CLI launching and pairing without a live T3 server or provider calls. It creates its own temporary home and synthetic CLI, including a real `.cmd` wrapper on Windows, and verifies paths with spaces, startup errors, token parsing and the credential exchange. Run it on Windows as well as Linux before claiming native Windows verification; the simulated Windows cases alone do not exercise `cmd.exe`.

For development, start a separate server with an explicit home and point `t3-vscode.t3Home` at that directory. Never verify against the live `~/.t3` service:

```sh
t3 serve --base-dir /tmp/t3-vscode-dev --host 127.0.0.1 --port 47777 --no-browser
pnpm exec tsx scripts/verify-host.ts --base-dir /tmp/t3-vscode-dev
node scripts/verify-edh.mjs --base-dir /tmp/t3-vscode-dev
# Also exercise saved-turn diffs and real Queue/Steer/task progress:
node scripts/verify-edh.mjs --base-dir /tmp/t3-vscode-dev --deep
# Verify a question on an unopened session and its native notification:
node scripts/verify-edh.mjs --base-dir /tmp/t3-vscode-dev --requests-only
# Verify sidebar Account & Usage preserves the editor chat target for native Ctrl+K / Alt+K references:
node scripts/verify-edh.mjs --base-dir /tmp/t3-vscode-dev --references-only
# After stopping that test server, verify setup and Retry/Settings:
node scripts/verify-edh.mjs --base-dir /tmp/t3-vscode-dev --setup-only
```

`verify-host.ts` creates a project/thread, runs one provider turn, and verifies rename, pin, archive/restore and reconnect. `verify-edh.mjs` launches its own temporary VS Code profile, sends a real message, verifies independent conversations and grouped settings, edits native font settings and exercises Ctrl+K / Alt+K, citations and model controls. Its `--deep` check edits a temporary test file across two turns, opens both saved diffs and queues/promotes a follow-up during an active task plan. Both require an explicit isolated home and reject `~/.t3`. The `--requests-only` check creates a temporary question session, confirms its badge and VS Code notification before opening it, verifies that Open session reuses its existing tab, answers the question and verifies provider resumption. The `--setup-only` check runs with that test server stopped and verifies installation guidance, Retry and native Settings. An authenticated provider CLI must be available to the isolated server. When starting it from a T3-owned terminal, remove all inherited `T3*`, `VITE_HTTP_URL`, `VITE_WS_URL` and `ELECTRON_RUN_AS_NODE` variables from the child environment.

Live provider tests explicitly select **GPT-6 Luna** with low effort when available; they do not inherit a premium model or silently fall back to one. Set `T3_VSCODE_TEST_MODEL` to another inexpensive advertised model when needed. The deterministic unit/browser fixtures make no model calls. Review current [model pricing](https://developers.openai.com/api/docs/models/gpt-6-luna) when choosing a different default.

To prepare the native rich-rendering check, use a disposable server home containing a configured provider:

```sh
pnpm exec tsx scripts/prepare-rich-fixture.ts --base-dir /tmp/t3-vscode-dev
# Stop only that isolated server, then seed its prepared empty fixture:
pnpm exec tsx scripts/prepare-rich-fixture.ts --base-dir /tmp/t3-vscode-dev --seed
# Restart the same isolated server, then verify rendering and attachments:
node scripts/verify-edh.mjs --base-dir /tmp/t3-vscode-dev --visuals-only
```

The fixture contains validated synthetic history, collapsed activity, an image, the repository's interactive navigation mockup, Mermaid and ML equations. The native check verifies rail/settings/draft preservation, equation copying, real OS clipboard image paste, `showOpenDialog` file selection outside the workspace, upload/provider delivery and empty-tab cleanup. It uses a temporary native simple-dialog setting to automate the file-picker API, restores clipboard contents and never seeds a running server or the normal T3 home.

Use `--cleanup-only` in place of `--visuals-only` to verify untouched-chat deletion and typed-then-cleared preservation without seeding history or calling a provider.

To regenerate the README gallery, use `scripts/prepare-readme-fixture.ts --base-dir <fresh-home-in-tmp>` against an isolated server, stop it, repeat with `--seed`, and restart it. Then run `node scripts/verify-edh.mjs --base-dir <same-home> --screenshots-only`. This uses a clean disposable VS Code profile and synthetic conversations without sending provider messages; it writes the three images under `docs/screenshots/`.

For deterministic browser checks without a server, run `node scripts/verify-ui.mjs` after building. It verifies message navigation, native-frame bridge forwarding, subagent trees and live hover cards, attachments, interactive graphics, math/copying, models, requests, themes and 1,000-item virtualization. It uses `/usr/bin/chromium` by default (`CHROMIUM_PATH` overrides it). The VS Code check uses `/usr/share/code/code` (`VSCODE_BIN` overrides it). Screenshots go to `/tmp/t3-vscode-ui`; neither check changes your normal VS Code profile.

`node --import tsx scripts/verify-views.ts` checks the built UI in headless editor and sidebar pages sharing the actual host and bridge with a deterministic transport. It covers workspace filtering, independent selections and drafts, references, quote/comment submission, provider-instance search, favorites, effort, new threads, reconnect, closing a view, and native font preferences including reset, reload and external edits. Screenshots go to `/tmp/t3-vscode-views-ui`. It does not launch VS Code. `scripts/verify-draft.ts --base-dir <fresh-isolated-home>` additionally verifies draft settings, workspace scope and independent subscriptions against a real isolated server without running a provider turn.

After `verify-edh.mjs`, run `node --import tsx scripts/verify-native-web.ts --base-dir <fresh-isolated-home>` to reproduce the original T3 web UI feasibility check. It presets the workspace project filter in isolated browser storage, verifies independent windows/drafts, and records that original file links open T3's internal file panel. This experiment does not replace the extension UI. A plain iframe trial in VS Code could not establish its authenticated session; embedding the full UI needs an authentication adapter and a cooperative bridge for native editor links and references.

## Build a VSIX

With Node.js 22 or later, run from this repository:

```sh
pnpm install --frozen-lockfile
pnpm run package
```

This rebuilds both bundles, uses the channel metadata in `package.json`, and produces `target-installer/t3-vscode-0.1.15.vsix` without the prerelease flag. All packaged VSIX installers go into `target-installer/`, which is excluded from Git. The archive includes compiled code, icons, the lazy Mermaid renderer, KaTeX CSS/fonts and license notices; development profiles, server data, source maps and `node_modules` are excluded.

For a revision that keeps the same version, update that canonical installer path too; keep superseded artifacts under `target-installer/archive/` with descriptive names. A preview in a subdirectory must not leave the documented installer pointing at an older build. Compare bundled files or SHA-256 hashes when diagnosing a same-version install, then reinstall the corrected VSIX in the intended profile and run **Developer: Reload Window**; CLI reinstalls can use `--force` with the same isolated storage arguments.

## Where things live

| Path | Purpose |
| --- | --- |
| `.vscode/launch.json`, `tasks.json`, `settings.json` | Default-profile F5 launch, build/check tasks and an explicitly started isolated development server |
| `scripts/prepare-vscode-profile.mjs` | Copies Default settings and extensions into isolated F5 storage without changing the normal installation |
| `.vscodeignore`, `scripts/generate-notices.mjs` | Limits the VSIX to bundled runtime files and retains third-party license notices |
| `scripts/package-vsix.mjs`, `target-installer/` | Builds local VSIX installers into one output directory without installing them |
| `src/extension.ts` | VS Code activation, commands, sidebar and editor containers, webview CSP |
| `src/host/serverDiscovery.ts` | Runtime-file discovery, PID check and environment probe |
| `src/host/pairing.ts`, `sessionStore.ts` | CLI pairing, headless bearer exchange and SecretStorage |
| `src/host/t3Client.ts` | Vendored Effect RPC transport and authenticated history requests |
| `src/host/hostState.ts` | Shared connection and projections, workspace scope, per-view navigation and drafts, subscription ownership |
| `src/host/bridge.ts` | Validated intents and state replies tied to each webview; native clipboard/file/link actions |
| `src/host/fileLinks.ts` | Resolve chat file URLs and line ranges for VS Code's native editor |
| `src/shared/bridge.ts` | Snapshot DTOs and the allowed postMessage methods |
| `src/host/usageStatusBar.ts`, `src/shared/usage.ts` | Native per-account status meters and quota identities |
| `src/host/inputNotifications.ts` | Deduplicated notifications for pending workspace requests, including unopened sessions |
| `src/webview/components/SidebarView.tsx`, `AccountUsage.tsx`, `ServerSetup.tsx` | Sessions sidebar, collapsed account limits and missing-server setup |
| `docs/feature-history.md`, `AGENTS.md` | Linked versioned feature inventory and independent regression-review requirement |
| `src/shared/sessionTree.ts`, `src/webview/components/SubagentCard.tsx` | Per-section nested sessions, live subagent hover cards and child navigation |
| `src/webview/components/MessageNavigator.tsx` | Configurable prompt/response rail and instant history jumps |
| `src/webview/components/ChatMedia.tsx`, `HtmlVisual.tsx`, `MermaidVisual.tsx` | Authenticated inline media, sandboxed HTML and lazy local diagrams |
| `src/webview/components/MathContextMenu.tsx`, `scripts/build-math.mjs` | Native copy formats for equations and bundled math CSS/fonts |
| `src/host/composerDraftStore.ts` | Atomic extension-owned draft records, local attachment backups and cross-window leases |
| `src/webview/composerAttachments.ts`, `src/shared/composerAttachments.ts` | Clipboard/file upload drafts, cursor-positioned references and ownership validation |
| `src/shared/appearance.ts` | T3 font defaults and bounds for native VS Code settings |
| `src/host/editorReference.ts`, `src/shared/composerContext.ts` | Capture precise editor ranges and format file/assistant references for messages |
| `src/webview/components/ChatView.tsx`, `ThreadList.tsx` | Responsive chat shell and workspace-scoped navigation |
| `src/webview/components/ThreadActionsMenu.tsx` | Shared mouse/keyboard thread management menu for history rows and editor headers |
| `src/webview/components/Composer.tsx`, `src/webview/composerDrafts.ts` | Independent text/context drafts, model effort, permissions and Stop |
| `src/webview/components/ModelPicker.tsx`, `src/shared/modelOptions.ts` | Provider browsing, fuzzy search, favorites and capability-based model options |
| `src/webview/components/AssistantSelectionToolbar.tsx`, `CitationCommentEditor.tsx`, `AssistantCitationLink.tsx` | Quote selection, optional comments and saved citation/source previews |
| `src/webview/components/TranscriptView.tsx`, `ChatMarkdown.tsx` | Virtualized typed turn items, markdown and native file/link intents |
| `src/webview/components/PendingRequests.tsx` | Provider approval choices and question forms |
| `src/webview/components/t3/` | Portable components copied from T3, retaining upstream presentation |
| `src/webview/styles/tokens.css` | VS Code theme colors, Tailwind tokens and VS Code surface layout |
| `vendor/` | Pinned T3 contracts and client runtime; provenance and license |
| `scripts/prepare-rich-fixture.ts`, `verify-rich-chat.mjs` | Validated isolated rendering fixtures and native math, media, clipboard/picker and cleanup checks |
| `scripts/verify-host.ts`, `verify-edh.mjs`, `verify-ui.mjs` | Real-server, real-VS-Code and deterministic browser verification |
| `scripts/verify-views.ts`, `src/host/testing/` | Three built webviews sharing the real bridge/host with test transports, without launching VS Code |
| `scripts/verify-native-web.ts` | Isolated original T3 web UI experiment: project scope, independent windows/drafts and file-panel behavior |
| `src/host/*.test.ts`, `src/shared/*.test.ts` | Host behavior and bridge boundary regression tests |

The [feature history](feature-history.md) records introduction and change versions for every implemented feature. [AGENTS.md](../AGENTS.md) requires a separate agent with fresh context to check regressions before each VSIX is packaged.

See [the architecture](t3-vscode-architecture.md) for the host/webview boundary and milestones. The [feature comparison](kilo-kimi-t3-feature-matrix.md) remains reference material.


## Editor controls verification

`verify-views.ts` also runs `verify-composer-editing.ts` for tab-local History, independent drafts, raw Markdown formatting, native undo/redo, list continuation, automatic numbering with undo, selection wrapping, indentation, IME handling, focus traversal and dense spacing at desktop and narrow widths.

For native editor groups and Command Palette routing, run `node scripts/verify-edh.mjs --base-dir <fresh-isolated-home> --editor-controls-only` against an explicitly isolated server with an available provider. This uses disposable VS Code user data, extensions and shared data; it checks new tabs in two editor groups, local History selection, title changes empty-chat cleanup, and close/reopen recovery of typed text and a pasted image without sending provider messages.

## Session-search verification

Use the [feature-history overview](feature-history.md#overview) as the regression checklist before packaging. `scripts/verify-views.ts` covers full-history search, case/word/content filters, older command reveal, math source, independent tabs and draft preservation against deterministic fixtures. Unit tests cover source occurrences, incremental updates, cancellation and incomplete history; these checks do not call a provider.

The same suite calls `verify-session-find.ts` to check flat occurrences, matching chat fonts, persistent filters, floating collapse, Side-from-collapse, context lines, ordering, pagination, pointer/keyboard resizing, saved preferences and narrow/theme layouts. It verifies that display changes retain the search job and composer DOM node; all host data and browser profiles are disposable fixtures.

`verify-response-layout.ts` runs from the same fixture suite and checks accepted-send status before output, visible early answers, independent activity groups around steers, late command completion, status-only sticky headers and settled-run forks. Host tests cover restart recovery, offline edits, rejected first sends, upload completion after close, concurrent draft leases and slot-removal races.

## Scheduled tasks verification

`verify-views.ts` includes `verify-scheduled-tasks.ts` for session/project scope, independent creation, the secondary sidebar editor, model isolation, Save/Back/Cancel, failure retention and narrow layouts. Use `--tasks-only` for that focused fixture. It does not call a provider.

`pnpm exec tsx scripts/verify-scheduled-live.ts --base-dir <isolated-home>` checks real list/subscription/create/edit and saved model options; it creates only disabled tasks. Add `--run-turn` to verify one actual scheduled dispatch and its completed reply using advertised GPT-6 Luna Low (or the explicit `T3_VSCODE_TEST_MODEL` alternative). The script rejects normal T3 homes and missing low-effort catalogs. Stop the disposable server after verification.
