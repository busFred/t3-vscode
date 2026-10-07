# T3 VSCode

**Alpha preview — 0.1.11.** Distributed as a prerelease VSIX; use the Marketplace prerelease channel once the listing is published.

A VS Code client for a separately running [T3 Code](https://github.com/pingdotgg/t3code) server. T3 VSCode adds a workspace session manager and chat in editor tabs. Colors follow your VS Code theme; the extension host owns connection, authentication and shared conversation state.

## In the editor

Actual extension screenshots, captured in an isolated VS Code window with sample conversations.

**Sessions beside readable equations and tables.** Chat lives in editor tabs; Account & Usage stays collapsed until you need it.

![T3 VSCode with workspace sessions, rendered cross-entropy equations and a comparison table](docs/screenshots/math-and-sessions.png)

**Diagrams and interactive graphics in the conversation.** Mermaid and T3 HTML visuals render alongside the explanation.

![A Mermaid training pipeline and an interactive experiment comparison inside T3 VSCode](docs/screenshots/diagrams-and-graphics.png)

**Quote a specific passage and add a comment.** The reference goes at your prompt cursor, while commands stay inside a collapsed summary.

![Selecting assistant text and commenting on a quote in T3 VSCode's light theme](docs/screenshots/quotes-and-code.png)

## Run locally

Linux is the first verified platform. Install T3 Code separately using its [installation guide](https://github.com/pingdotgg/t3code/blob/main/docs/user/install.md), then start its server. On Linux or macOS, `t3 service install` installs and starts the background service; see the [service instructions](https://github.com/pingdotgg/t3code/blob/main/docs/user/background-service.md). To run manually, keep `t3 serve` running in a terminal. T3 VSCode discovers and pairs with the local server. Remote T3 servers are not supported yet.

When no local server is found, the extension shows installation links, service and manual commands, Retry connection and native Settings. Leave **T3 VSCode: T3 Home** empty for the default T3 home, or set it to your server’s data directory. Settings live in **Preferences → Settings → Extensions → T3 VSCode**, grouped under **Appearance**, **Reading**, **Usage** and **Connection**; existing setting keys and saved values are preserved.

The sidebar manages sessions. **Account & Usage** starts collapsed, and **Settled** and **Archive** have separate lists. Expand Account & Usage to refresh limits and see the selected account’s reported update time. Select a session to open its editor tab; if it is already open, the extension reveals that tab. Use VS Code’s editor groups, group locking and tab/window movement to arrange chat beside your code. The globe opens the current session in your default browser, using localhost for a loopback server so it can reuse your paired browser session. Working sessions show a static icon and elapsed minutes; Input/Approval badges and VS Code notifications highlight sessions needing a response.

The status bar shows a small provider icon followed by reported month/week/session percentages, such as `M 72% · W 77% · S 94%`. Unreported windows are omitted; a single window uses its full name, such as `Week 77%`, and no reported windows show `Usage unavailable`. Hover for all windows and reset times, or click to expand Account & Usage for that account. Use the Command Palette’s **T3 VSCode: Configure Status Meters** command or **Status meters…** in Account & Usage to follow the focused chat and/or pin individual accounts. Shared credentials are deduplicated; separate subscriptions keep separate meters.

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

If the development window says **T3 server unavailable**, run **T3 VSCode: start isolated server** in the original repository window, keep its terminal open, then choose **Retry connection**. A running background service under `~/.t3` does not satisfy this isolated development configuration. Pairing happens after the development server is available.

The repository's gitignored `.t3` directory holds the isolated VS Code profile and any previous development-server data. The current debug server uses `/tmp` instead. Normal extension use discovers the shared T3 home (`~/.t3` by default); it does not create `.t3` in each project.

Open the **T3 VSCode** activity bar view. **T3 VSCode: Open Chat in Editor Tab** opens the same app in an editor. With a folder open, only projects whose workspace root matches that folder and their threads appear, including archived conversations. Multi-root workspaces include each opened folder. An empty VS Code window can browse all server projects and use **No project** when the server supports it. New threads use an opened folder, or the selected project when there is no workspace.

The sidebar title keeps **Open Web UI** and its overflow actions. Use the single **New Thread** button above search to create an editor chat; right-click a session to rename, pin, settle, archive, restore or delete it. The editor has its conversation breadcrumb, browser shortcut and thread actions.

Each editor tab retains its conversation and draft. Session selection and input notifications reveal an already open conversation instead of duplicating its tab. Creating another conversation leaves existing editor drafts intact. Tab titles follow conversation names and live renames; closing a tab keeps conversations running in other views.

Sessions begin directly below search, with one New Thread button in the Sessions heading and no project-name row. Subagents appear beneath their parent session in a tree whose branches start collapsed. Expand a parent to inspect its children. Active, Settled and Archive retain separate trees; a parent shown only as context is labeled **Parent session**. Search expands the ancestors of matching children. Hover or focus a subagent transcript row for its provider, model, current status and elapsed time; click it to open the child, then use **Subagent of** to return. Provider-native child conversations are read-only; T3-owned delegated conversations accept follow-ups.

Closing a newly created chat without typing, adding a reference/attachment or sending a message removes that untouched empty conversation after its last chat surface closes. Typing and later clearing still preserves it, as does managing the thread or renaming/pinning it in the Web UI. Preexisting empty conversations stay available.

Use **Fork** below a completed assistant response to continue from that point in a new conversation. The fork opens in that view and preserves the source conversation; the button is available when T3 supports native forking or its portable history fallback. File links in chat open a native VS Code editor, including links to a line or range such as `src/main.ts#L24-L25`.

Open **Settings → Extensions → T3 VSCode → Appearance** to change the three font sizes. The settings button at the bottom of the session manager and **T3 VSCode: Font Settings** command open that native settings page. **Interface** scales chat text and navigation (12–20 px, default 16); **Prompt** changes message input (12–20 px, default 14); **Code** changes code blocks, diffs and tool output (10–18 px, default 13). Changes apply immediately to every view and preserve conversations and drafts. Use the native User/Workspace tabs to choose where values are saved, and each setting's **Reset Setting** action to restore its default.

Use the message rail to preview and jump through past prompts and responses with the pointer, mouse wheel or keyboard. **Latest** returns to the live end. **T3 VSCode: Message Navigation** in native Settings offers **Left**, **Right** and **Off**, with Left as the default. Jumps are instant and preserve the composer draft; returning to the bottom resumes following streamed replies.

Chat stays in one virtualized column at every editor size; the two-column experiment has been removed for performance. Wide equations scroll horizontally and open a floating preview by click or keyboard, with LaTeX and MathML copy actions on right-click.

Chat and command text use the theme's editor foreground for stronger contrast, while secondary labels retain the theme's secondary color. Thought process entries start collapsed; consecutive commands and tool activity appear inside a closed summary that you can expand for details.

Paste an image into the message box, drag files onto it, or use its paperclip to choose files from anywhere on the local machine. Image thumbnails appear in drafts and sent messages. Paste, drop and file selection insert a stable image/file reference at the cursor so the provider receives its position in the paragraph. Click an image thumbnail or its inline reference for a floating preview. Attachments can be sent without additional text and remain attached through Queue and Steer. T3's attachment limits apply, and a failed upload must be removed and attached again before sending.

Markdown images, video/audio, Mermaid diagrams and T3's `html_render` graphics render inside the transcript. HTML graphics keep their interactions and adapt to the native theme inside a sandbox. Inline math supports `$...$` or `\(...\)`; display math supports `$$...$$` or `\[...\]`, including matrices and aligned equations. Wide display equations scroll horizontally inside the message; click or keyboard-activate an equation for a floating preview. Right-click a rendered equation to copy **LaTeX**, **LaTeX with delimiters**, or **MathML**; MathML is useful for equation editors. Math fonts and the diagram renderer ship locally with the extension.

Select text in a file and press **Alt+K**, or choose **Reference Editor Selection** from its context menu, to add the exact range to the last focused T3 chat. References include selected text from the editor, including unsaved changes. If no chat is open, the shortcut opens an editor chat; browsing sidebar usage preserves the last focused editor target. Select text in an assistant response and choose **Cite** to insert its reference at the last cursor position in your prompt, replacing selected prompt text when present. Add an optional comment, then click the inline reference or its quote chip to edit it; **Alt+Enter** opens the reference at the cursor. Removing the quote chip also removes its inline references, and deleting an inline reference prevents that quote from being sent. Quotes keep their T3 source link and readable text when sent; saved source links can reopen and highlight the response. References and drafts stay with their own conversation and view.

The model picker browses configured provider instances and Favorites. Search finds models across every provider using T3's fuzzy matching, and stars save favorites across extension sessions. Arrow keys navigate results; Enter chooses a model and Escape closes the picker. The middle composer control selects the model's advertised effort levels; models without that capability omit it. The visible Code/Plan toggle has been removed.

Type `/` for the current provider's commands and skills, or `@` to find files in the conversation's workspace. Arrow keys navigate suggestions; Enter or Tab inserts one. `/model` opens model search, and `/usage-limits` expands **Account & Usage** in the session manager for that provider.

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
# Verify sidebar Account & Usage preserves the editor chat target for native Alt+K references:
node scripts/verify-edh.mjs --base-dir /tmp/t3-vscode-dev --references-only
# After stopping that test server, verify setup and Retry/Settings:
node scripts/verify-edh.mjs --base-dir /tmp/t3-vscode-dev --setup-only
```

`verify-host.ts` creates a project/thread, runs one provider turn, and verifies rename, pin, archive/restore and reconnect. `verify-edh.mjs` launches its own temporary VS Code profile, sends a real message, verifies independent conversations and grouped settings, edits native font settings and exercises Alt+K, citations and model controls. Its `--deep` check edits a temporary test file across two turns, opens both saved diffs and queues/promotes a follow-up during an active task plan. Both require an explicit isolated home and reject `~/.t3`. The `--requests-only` check creates a temporary question session, confirms its badge and VS Code notification before opening it, verifies that Open session reuses its existing tab, answers the question and verifies provider resumption. The `--setup-only` check runs with that test server stopped and verifies installation guidance, Retry and native Settings. An authenticated provider CLI must be available to the isolated server. When starting it from a T3-owned terminal, remove all inherited `T3*`, `VITE_HTTP_URL`, `VITE_WS_URL` and `ELECTRON_RUN_AS_NODE` variables from the child environment.

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

## Package and install locally

With Node.js 22 or later, run from this repository:

```sh
pnpm install --frozen-lockfile
pnpm run package
```

This rebuilds both bundles, marks the package as a prerelease, and produces `target-installer/t3-vscode-0.1.11.vsix`. All packaged VSIX installers go into `target-installer/`, which is excluded from Git. The archive includes compiled code, icons, the lazy Mermaid renderer, KaTeX CSS/fonts and license notices; development profiles, server data, source maps and `node_modules` are excluded.

In the VS Code window/profile where you want to use it, open **Extensions → ⋯ → Install from VSIX…**, choose that file, then reload the window if prompted. For an isolated preview installation, the CLI example uses separate user, extension and shared storage:

```sh
code --user-data-dir /tmp/t3-vscode-preview/user-data --extensions-dir /tmp/t3-vscode-preview/extensions --shared-data-dir /tmp/t3-vscode-preview/shared-data --install-extension ./target-installer/t3-vscode-0.1.11.vsix
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
| `src/webview/components/SidebarView.tsx`, `AccountUsage.tsx`, `ServerSetup.tsx` | Sessions sidebar, collapsed account limits and missing-server setup |
| `docs/feature-history.md`, `AGENTS.md` | Linked versioned feature inventory and independent regression-review requirement |
| `src/shared/sessionTree.ts`, `src/webview/components/SubagentCard.tsx` | Per-section nested sessions, live subagent hover cards and child navigation |
| `src/webview/components/MessageNavigator.tsx` | Configurable prompt/response rail and instant history jumps |
| `src/webview/components/ChatMedia.tsx`, `HtmlVisual.tsx`, `MermaidVisual.tsx` | Authenticated inline media, sandboxed HTML and lazy local diagrams |
| `src/webview/components/MathContextMenu.tsx`, `scripts/build-math.mjs` | Native copy formats for equations and bundled math CSS/fonts |
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

The [feature history](docs/feature-history.md) records introduction and change versions for every implemented feature. [AGENTS.md](AGENTS.md) requires a separate agent with fresh context to check regressions before each VSIX is packaged.

See [the architecture](docs/t3-vscode-architecture.md) for the host/webview boundary and milestones. The [feature comparison](docs/kilo-kimi-t3-feature-matrix.md) remains reference material.

## Current scope

The core chat migration supports projects/threads, server-advertised models (including ACP instances), effort and permissions, file references, native editor links, assistant citations with comments, native font settings, message streaming, rich turn items, approvals, questions, Stop, progressive history, context-menu thread management, response forks and local VSIX packaging. Account limits, per-account status meters, session status notifications, native theme colors and missing-server setup are included. Clipboard/file attachments, authenticated inline media, interactive HTML, Mermaid, KaTeX with copy actions, nested subagents and message navigation are included. Terminal/preview panels, checkpoint restore and cross-window movement remain later work; specialized tool previews still need a fidelity pass. ACP model selection is covered by fixtures; the isolated live-server checks used Codex.

T3 VSCode uses the [MIT license](LICENSE); T3-derived code retains [the upstream notice](vendor/LICENSE.t3code), and bundled dependencies retain their own notices.

See [the publishing guide](docs/publishing.md) for the version policy, publisher setup and alpha release procedure; [SUPPORT.md](SUPPORT.md) explains bug reports.
