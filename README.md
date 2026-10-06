# T3 VSCode

A VS Code client for a separately running [T3 Code](https://github.com/pingdotgg/t3code) server. T3 VSCode adds a workspace session manager, editor-tab chat and optional sidebar chat. Colors follow your VS Code theme; the extension host owns connection, authentication and shared conversation state.

## Run locally

Linux is the first verified platform. Install T3 Code separately using its [installation guide](https://github.com/pingdotgg/t3code/blob/main/docs/user/install.md), then start its server. On Linux or macOS, `t3 service install` installs and starts the background service; see the [service instructions](https://github.com/pingdotgg/t3code/blob/main/docs/user/background-service.md). To run manually, keep `t3 serve` running in a terminal. T3 VSCode discovers and pairs with the local server. Remote T3 servers are not supported yet.

When no local server is found, the extension shows installation links, service and manual commands, Retry connection and native Settings. Leave **T3 VSCode: T3 Home** empty for the default T3 home, or set it to your server’s data directory. Settings live in **Preferences → Settings → Extensions → T3 VSCode**.

The sidebar opens **Sessions** first. **Account & Usage** starts collapsed, and **Settled** and **Archive** have separate lists. Select a session to open it in an editor tab, or choose **Chat** to chat in the sidebar. **Open Chat in Editor Tab** opens the sidebar’s current session and copies its unsent text and references; subsequent navigation and drafts remain independent. Use the globe icon to open that session in your default browser. Working sessions show a small static icon and elapsed minutes; sessions needing a question or approval response show an Input or Approval badge and a VS Code notification with **Open session**.

The status bar shows a small provider icon and **Month | Week | Session** remaining percentages, for example `— | 91 | 100 %`. Missing windows show `—`. Click a meter for the account’s limits and reset times. Use **T3 VSCode: Configure Status Meters**, the status-bar **⋯**, or the usage panel’s **Status meters…** button to follow the focused chat and/or pin individual accounts. Accounts sharing credentials are deduplicated; separate subscriptions keep separate meters.

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
4. In that new window, open **T3 VSCode** in the activity bar. Only conversations for the opened repository appear. Before sending the first message, choose a model, its supported effort level and permission mode below the input. In a multi-root workspace, choose an opened folder; in an empty window, the project picker also offers **No project** when supported. Open the current sidebar session with **Open Chat in Editor Tab**, select different conversations, and check that each tab and the sidebar keep their own selection and drafts. Open **Sessions** (or **History** in an editor chat), then right-click a thread to rename, pin, archive, restore or delete it. Deletion asks for confirmation in VS Code.

After editing the extension or UI, stop debugging and press F5 again to rebuild. Breakpoints in the host TypeScript use the generated source maps. **T3 VSCode: checks** runs typechecking and regression tests; **T3 VSCode: verify UI** checks the built UI with browser fixtures; **T3 VSCode: verify isolated host** sends a real provider turn to the development server.

The launch configuration passes `--profile=Default` and points `--user-data-dir`, `--extensions-dir` and `--shared-data-dir` into `.t3/vscode-profile`. The first launch copies the Default profile's settings, keybindings, snippets and installed extensions; later launches keep changes made in that development copy. The real profile and installation stay outside the development instance. **Always isolate all three directories:** a fresh user-data directory sharing the real extension directory can cause VS Code to clean up extensions referenced only by the real profiles. Newer VS Code versions also use shared application storage; `--shared-data-dir` isolates it. The automated `verify-edh.mjs` check uses fresh temporary storage for all three directories and copies Default settings and keybindings.

`launch.json` sets `T3CODE_HOME` to `/tmp/t3-vscode-dev-${workspaceFolderBasename}`, and workspace settings leave `t3-vscode.t3Home` empty so that environment value takes effect. The server's data must be outside a Git checkout: T3 disables its Scratch folder (the web UI's **No project** conversations) inside a checkout. Start the server task before F5; the extension discovers the existing server. The previous `.t3/vscode-dev` data is preserved but no longer used by this launch configuration.

If the development window says **T3 server unavailable**, run **T3 VSCode: start isolated server** in the original repository window, keep its terminal open, then choose **Retry connection**. A running background service under `~/.t3` does not satisfy this isolated development configuration. Pairing happens after the development server is available.

The repository's gitignored `.t3` directory holds the isolated VS Code profile and any previous development-server data. The current debug server uses `/tmp` instead. Normal extension use discovers the shared T3 home (`~/.t3` by default); it does not create `.t3` in each project.

Open the **T3 VSCode** activity bar view. **T3 VSCode: Open Chat in Editor Tab** opens the same app in an editor. With a folder open, only projects whose workspace root matches that folder and their threads appear, including archived conversations and that project's worktrees. Multi-root workspaces include each opened folder. An empty VS Code window can browse all server projects and use **No project** when the server supports it. New threads use an opened folder, or the selected project when there is no workspace.

The sidebar uses VS Code's native **T3 VSCode** title and toolbar: **Usage**, **History** (clock icon), **New Thread**, **Open Chat in Editor Tab**, and **Open Web UI**. History returns the sidebar to Sessions; in an editor chat, it opens a full management page and starts closed. Search matches conversation titles and message text within the opened workspace. Settled and archived conversations have separate collapsible lists; right-click a thread to settle/reopen, rename, pin, archive/restore or delete it. The editor tab has a compact project / conversation header with Usage → History → New thread actions.

Opening an editor tab copies the originating sidebar session and its unsent text and references. **New Thread** opens a fresh conversation. Selecting or creating a thread in one view leaves the other tabs and sidebar on their conversations. Draft project, model and permission choices also belong to that view. Tab titles stay **T3 VSCode**; the chat breadcrumb shows the conversation's title. Opening the same thread deliberately in two views shares its live messages and server settings; closing a tab keeps conversations running in other views.

Use **Fork** below a completed assistant response to continue from that point in a new conversation. The fork opens in that view and preserves the source conversation; the button is available when T3 supports native forking or its portable history fallback. File links in chat open a native VS Code editor, including links to a line or range such as `src/main.ts#L24-L25`.

Open **Settings → Extensions → T3 VSCode** to change the three font sizes. The settings button inside History and **T3 VSCode: Font Settings** command open that native settings page. **Interface** scales chat text and navigation (12–20 px, default 16); **Prompt** changes message input (12–20 px, default 14); **Code** changes code blocks, diffs and tool output (10–18 px, default 13). Changes apply immediately to every view and preserve conversations and drafts. Use the native User/Workspace tabs to choose where values are saved, and each setting's **Reset Setting** action to restore its default.

Select text in a file and press **Alt+K**, or choose **Reference Editor Selection** from its context menu, to add the exact range to the last focused T3 chat. References include selected text from the editor, including unsaved changes. If no chat is open, the shortcut opens the sidebar. Select text in an assistant response and choose **Cite** to attach that quote with an optional comment to the composer. Click its reference chip to edit the comment, or remove it with its × button. Quotes keep their T3 source link and readable text when sent; saved source links can reopen and highlight the response. References and drafts stay with their own conversation and view.

The model picker browses configured provider instances and Favorites. Search finds models across every provider using T3's fuzzy matching, and stars save favorites across extension sessions. Arrow keys navigate results; Enter chooses a model and Escape closes the picker. The middle composer control selects the model's advertised effort levels; models without that capability omit it. The visible Code/Plan toggle has been removed.

Type `/` for the current provider's commands and skills, or `@` to find files in the conversation's workspace. Arrow keys navigate suggestions; Enter or Tab inserts one. `/model` opens model search, and `/usage-limits` opens the same provider limits view as **Usage**.

While an agent is responding, **Enter** or the send button queues a follow-up after its turn. **Ctrl+Enter** (Cmd+Enter on macOS) steers the running turn when supported; otherwise the message queues. When the agent is idle, Enter sends normally. **Shift+Enter** inserts a new line. Queued messages and the current turn's task plan appear above the input. You can edit or cancel queued messages, reorder them by dragging or using the handle's arrow keys, and promote one to Steer. Stopping generation pauses the queue; **Resume queue** continues it.

Expand a turn's changed-file summary to browse folders and additions/deletions. Clicking a file opens VS Code's read-only diff editor for that turn's saved before/after snapshots. Earlier turn diffs remain unchanged by later edits or commits. This uses checkpoint files in the local T3 workspace; binary files cannot be expanded as text.

For development, start a separate server with an explicit home and point `t3-vscode.t3Home` at that directory. Never verify against the live `~/.t3` service:

```sh
t3 serve --base-dir /tmp/t3-vscode-dev --host 127.0.0.1 --port 47777 --no-browser
pnpm exec tsx scripts/verify-host.ts --base-dir /tmp/t3-vscode-dev
node scripts/verify-edh.mjs --base-dir /tmp/t3-vscode-dev
# Also exercise saved-turn diffs and real Queue/Steer/task progress:
node scripts/verify-edh.mjs --base-dir /tmp/t3-vscode-dev --deep
# Verify a question on an unopened session and its native notification:
node scripts/verify-edh.mjs --base-dir /tmp/t3-vscode-dev --requests-only
# Verify Usage preserves the chat target for native Alt+K references:
node scripts/verify-edh.mjs --base-dir /tmp/t3-vscode-dev --references-only
# After stopping that test server, verify setup and Retry/Settings:
node scripts/verify-edh.mjs --base-dir /tmp/t3-vscode-dev --setup-only
```

`verify-host.ts` creates a project/thread, runs one provider turn, and verifies rename, pin, archive/restore and reconnect. `verify-edh.mjs` launches its own temporary VS Code profile, sends a real message, verifies independent conversations, edits native font settings and exercises Alt+K, citations and model controls. Its `--deep` check edits a temporary test file across two turns, opens both saved diffs and queues/promotes a follow-up during an active task plan. Both require an explicit isolated home and reject `~/.t3`. The `--requests-only` check creates a temporary question session, confirms its badge and VS Code notification before opening it, answers the question and verifies provider resumption. The `--setup-only` check runs with that test server stopped and verifies installation guidance, Retry and native Settings. An authenticated provider CLI must be available to the isolated server. When starting it from a T3-owned terminal, remove all inherited `T3*`, `VITE_HTTP_URL`, `VITE_WS_URL` and `ELECTRON_RUN_AS_NODE` variables from the child environment.

For deterministic browser checks without a server, run `node scripts/verify-ui.mjs` after building. It verifies rich rows, models, effort, permissions, approvals/questions, light/dark layouts and 1,000-item virtualization. It uses `/usr/bin/chromium` by default (`CHROMIUM_PATH` overrides it). The VS Code check uses `/usr/share/code/code` (`VSCODE_BIN` overrides it). Screenshots go to `/tmp/t3-vscode-ui`; neither check changes your normal VS Code profile.

`node --import tsx scripts/verify-views.ts` checks the built UI in headless editor and sidebar pages sharing the actual host and bridge with a deterministic transport. It covers workspace filtering, independent selections and drafts, references, quote/comment submission, provider-instance search, favorites, effort, new threads, reconnect, closing a view, and native font preferences including reset, reload and external edits. Screenshots go to `/tmp/t3-vscode-views-ui`. It does not launch VS Code. `scripts/verify-draft.ts --base-dir <fresh-isolated-home>` additionally verifies draft settings, workspace scope and independent subscriptions against a real isolated server without running a provider turn.

After `verify-edh.mjs`, run `node --import tsx scripts/verify-native-web.ts --base-dir <fresh-isolated-home>` to reproduce the original T3 web UI feasibility check. It presets the workspace project filter in isolated browser storage, verifies independent windows/drafts, and records that original file links open T3's internal file panel. This experiment does not replace the extension UI. A plain iframe trial in VS Code could not establish its authenticated session; embedding the full UI needs an authentication adapter and a cooperative bridge for native editor links and references.

## Package and install locally

With Node.js 22 or later, run from this repository:

```sh
pnpm install --frozen-lockfile
pnpm run package
```

This rebuilds both bundles and produces `target-installer/t3-vscode-0.0.7.vsix`. All packaged VSIX installers go into `target-installer/`, which is excluded from Git. The archive includes compiled code, the icon and license notices; development profiles, server data, source maps and `node_modules` are excluded.

In the VS Code window/profile where you want to use it, open **Extensions → ⋯ → Install from VSIX…**, choose that file, then reload the window if prompted. The CLI alternative installs into the named profile:

```sh
code --profile Default --install-extension ./target-installer/t3-vscode-0.0.7.vsix
```

The installed extension normally discovers your already-running T3 service under `~/.t3`. Leave **T3 VSCode: T3 Home** empty to use that default; an explicit setting or `T3CODE_HOME` overrides it. Packaging does not install the extension or start a server.

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
| `src/webview/components/SidebarView.tsx`, `AccountUsage.tsx`, `ServerSetup.tsx` | Sessions/Chat sidebar, collapsed account limits and missing-server setup |
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
| `scripts/verify-host.ts`, `verify-edh.mjs`, `verify-ui.mjs` | Real-server, real-VS-Code and deterministic browser verification |
| `scripts/verify-views.ts`, `src/host/testing/` | Three built webviews sharing the real bridge/host with test transports, without launching VS Code |
| `scripts/verify-native-web.ts` | Isolated original T3 web UI experiment: project scope, independent windows/drafts and file-panel behavior |
| `src/host/*.test.ts`, `src/shared/*.test.ts` | Host behavior and bridge boundary regression tests |

See [the architecture](docs/t3-vscode-architecture.md) for the host/webview boundary and milestones. The [feature comparison](docs/kilo-kimi-t3-feature-matrix.md) remains reference material.

## Current scope

The core chat migration supports projects/threads, server-advertised models (including ACP instances), effort and permissions, file references, native editor links, assistant citations with comments, native font settings, message streaming, rich turn items, approvals, questions, Stop, progressive history, context-menu thread management, response forks and local VSIX packaging. Account limits, per-account status meters, session status notifications, native theme colors and missing-server setup are included. Attachment upload, terminal/preview panels and checkpoint restore are later work. Images currently have an Open action rather than an authenticated inline asset pipeline. Specialized tool previews and cross-window movement still need a fidelity pass. ACP model selection is covered by fixtures; the isolated live-server checks used Codex.

T3-derived source is MIT-licensed; retain [the upstream notice](vendor/LICENSE.t3code) in distributions.
