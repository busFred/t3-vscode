# T3 Code for VS Code

A thin VS Code client for a separately running T3 Code server. The same T3 chat UI runs in the sidebar and an editor tab; connection, authentication and conversation state belong to the extension host.

## Run locally

Linux is the first supported platform. Install T3 separately and run `t3 service install` before using the extension. The extension discovers the service and pairs with it; it never starts a server.

```sh
pnpm install
pnpm run build
pnpm run typecheck
pnpm run test
code --new-window --profile Default .
```

## Test from VS Code

1. Open this repository in VS Code and run `pnpm install` once.
2. Run **Terminal → Run Task → T3: start isolated server**. Leave its terminal running. The server uses `/tmp/t3-vscode-dev-t3-vscode` for state and port `47777`; stop it with Ctrl+C in that terminal when finished.
3. Select **T3: Run Extension (Isolated Server, Default Profile)** in **Run and Debug**, then press **F5**. The pre-launch task copies your **Default** profile into isolated development storage on first use, builds both bundles, and opens a new Extension Development Host window using that copy.
4. In that new window, open **T3 Code** in the activity bar. Only conversations for the opened repository appear. Before sending the first message, choose a model, its supported effort level and permission mode in the composer. In a multi-root workspace, choose an opened folder; in an empty window, the project picker also offers **No project** when supported. Open several editor tabs with **Open Chat in Editor Tab**, select different conversations, and check that each tab and the sidebar keep their own selection and drafts. Try **Thread Actions** in the sidebar overflow menu to rename, pin, archive and restore a thread.

After editing the extension or UI, stop debugging and press F5 again to rebuild. Breakpoints in the host TypeScript use the generated source maps. **T3: checks** runs typechecking and regression tests; **T3: verify UI** checks the built UI with browser fixtures; **T3: verify isolated host** sends a real provider turn to the development server.

The launch configuration passes `--profile=Default` and points `--user-data-dir`, `--extensions-dir` and `--shared-data-dir` into `.t3/vscode-profile`. The first launch copies the Default profile's settings, keybindings, snippets and installed extensions; later launches keep changes made in that development copy. The real profile and installation stay outside the development instance. **Always isolate both directories:** a fresh user-data directory sharing the real extension directory can cause VS Code to clean up extensions referenced only by the real profiles. Newer VS Code versions also use shared application storage; `--shared-data-dir` isolates it. The automated `verify-edh.mjs` check uses fresh temporary storage for all three directories and copies Default settings and keybindings.

`launch.json` sets `T3CODE_HOME` to `/tmp/t3-vscode-dev-${workspaceFolderBasename}`, and workspace settings leave `t3-vscode.t3Home` empty so that environment value takes effect. The server's data must be outside a Git checkout: T3 disables its Scratch folder (the web UI's **No project** conversations) inside a checkout. Start the server task before F5; the extension discovers the existing server. The previous `.t3/vscode-dev` data is preserved but no longer used by this launch configuration.

If the development window says **T3 server unavailable**, run **T3: start isolated server** in the original repository window, keep its terminal open, then choose **Retry connection**. A running background service under `~/.t3` does not satisfy this isolated development configuration. Pairing happens after the development server is available.

The repository's gitignored `.t3` directory holds the isolated VS Code profile and any previous development-server data. The current debug server uses `/tmp` instead. Normal extension use discovers the shared T3 home (`~/.t3` by default); it does not create `.t3` in each project.

Open the **T3 Code** activity bar view. **T3: Open Chat in Editor Tab** opens the same app in an editor. With a folder open, only projects whose workspace root matches that folder and their threads appear, including archived conversations and that project's worktrees. Multi-root workspaces include each opened folder. An empty VS Code window can browse all server projects and use **No project** when the server supports it. New threads use an opened folder, or the selected project when there is no workspace.

The sidebar uses VS Code's native title toolbar: **Projects and Threads**, **New Thread**, and **Open Chat in Editor Tab**. Its overflow menu contains **Thread Actions** (rename, pin, archive/restore) and pairing. There is no duplicate header inside the sidebar. The editor tab retains the T3 app header.

Each editor tab opens a blank conversation view. Selecting or creating a thread in one view leaves the other tabs and sidebar on their conversations. Draft project, model and mode choices also belong to that view. Tab titles follow their selected conversations. Opening the same thread deliberately in two views shares its live messages and server settings; closing a tab keeps conversations running in other views.

Open **Settings → Extensions → T3 Code** to change the three font sizes. The editor tab's settings button and **T3: Font Settings** command open that native settings page. **Interface** scales chat text and navigation (12–20 px, default 16); **Prompt** changes message input (12–20 px, default 14); **Code** changes code blocks, diffs and tool output (10–18 px, default 13). Changes apply immediately to every view and preserve conversations and drafts. Use the native User/Workspace tabs to choose where values are saved, and each setting's **Reset Setting** action to restore its default.

Select text in a file and press **Alt+K**, or choose **Reference Editor Selection** from its context menu, to add the exact range to the last focused T3 chat. References include selected text from the editor, including unsaved changes. If no chat is open, the shortcut opens the sidebar. Select text in an assistant response and choose **Cite** to attach that quote with an optional comment to the composer. Click its reference chip to edit the comment, or remove it with its × button. Quotes keep their T3 source link and readable text when sent; saved source links can reopen and highlight the response. References and drafts stay with their own conversation and view.

The model picker browses configured provider instances and Favorites. Search finds models across every provider using T3's fuzzy matching, and stars save favorites across extension sessions. Arrow keys navigate results; Enter chooses a model and Escape closes the picker. The middle composer control selects the model's advertised effort levels; models without that capability omit it. The visible Code/Plan toggle has been removed.

For development, start a separate server with an explicit home and point `t3-vscode.t3Home` at that directory. Never verify against the live `~/.t3` service:

```sh
t3 serve --base-dir /tmp/t3-vscode-dev --host 127.0.0.1 --port 47777 --no-browser
pnpm exec tsx scripts/verify-host.ts --base-dir /tmp/t3-vscode-dev
node scripts/verify-edh.mjs --base-dir /tmp/t3-vscode-dev
```

`verify-host.ts` creates a project/thread, runs one provider turn, and verifies rename, pin, archive/restore and reconnect. `verify-edh.mjs` launches its own temporary VS Code profile, sends a real message, verifies independent conversations, edits native font settings and exercises Alt+K, citations and model controls. Both require an explicit isolated home and reject `~/.t3`. An authenticated provider CLI must be available to the isolated server. When starting it from a T3-owned terminal, remove inherited `T3_SERVICE_LAUNCHER_CONTEXT` and `T3_BOOT_SERVICE_UNIT` variables from the child environment so it does not try to use the live service launcher.

For deterministic browser checks without a server, run `node scripts/verify-ui.mjs` after building. It verifies rich rows, models, effort, permissions, approvals/questions, light/dark layouts and 1,000-item virtualization. It uses `/usr/bin/chromium` by default (`CHROMIUM_PATH` overrides it). The VS Code check uses `/usr/share/code/code` (`VSCODE_BIN` overrides it). Screenshots go to `/tmp/t3-vscode-ui`; neither check changes your normal VS Code profile.

`node --import tsx scripts/verify-views.ts` checks the built UI in headless editor and sidebar pages sharing the actual host and bridge with a deterministic transport. It covers workspace filtering, independent selections and drafts, references, quote/comment submission, provider-instance search, favorites, effort, new threads, reconnect, closing a view, and native font preferences including reset, reload and external edits. Screenshots go to `/tmp/t3-vscode-views-ui`. It does not launch VS Code. `scripts/verify-draft.ts --base-dir <fresh-isolated-home>` additionally verifies draft settings, workspace scope and independent subscriptions against a real isolated server without running a provider turn.

## Package and install locally

With Node.js 22 or later, run from this repository:

```sh
pnpm install --frozen-lockfile
pnpm run package
```

This rebuilds both bundles and produces `target-installer/t3-vscode-0.0.4.vsix`. All packaged VSIX installers go into `target-installer/`, which is excluded from Git. The archive includes compiled code, the icon and license notices; development profiles, server data, source maps and `node_modules` are excluded.

In the VS Code window/profile where you want to use it, open **Extensions → ⋯ → Install from VSIX…**, choose that file, then reload the window if prompted. The CLI alternative installs into the named profile:

```sh
code --profile Default --install-extension ./target-installer/t3-vscode-0.0.4.vsix
```

The installed extension normally discovers your already-running T3 service under `~/.t3`. Leave **T3 Code: T3 Home** empty to use that default; an explicit setting or `T3CODE_HOME` overrides it. Packaging does not install the extension or start a server.

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
| `src/shared/bridge.ts` | Snapshot DTOs and the allowed postMessage methods |
| `src/shared/appearance.ts` | T3 font defaults and bounds for native VS Code settings |
| `src/host/editorReference.ts`, `src/shared/composerContext.ts` | Capture precise editor ranges and format file/assistant references for messages |
| `src/webview/components/ChatView.tsx`, `ThreadList.tsx` | Responsive chat shell and workspace-scoped navigation |
| `src/webview/components/Composer.tsx`, `src/webview/composerDrafts.ts` | Independent text/context drafts, model effort, permissions and Stop |
| `src/webview/components/ModelPicker.tsx`, `src/shared/modelOptions.ts` | Provider browsing, fuzzy search, favorites and capability-based model options |
| `src/webview/components/AssistantSelectionToolbar.tsx`, `CitationCommentEditor.tsx`, `AssistantCitationLink.tsx` | Quote selection, optional comments and saved citation/source previews |
| `src/webview/components/TranscriptView.tsx`, `ChatMarkdown.tsx` | Virtualized typed turn items, markdown and native file/link intents |
| `src/webview/components/PendingRequests.tsx` | Provider approval choices and question forms |
| `src/webview/components/t3/` | Portable components copied from T3, retaining upstream presentation |
| `src/webview/styles/tokens.css` | T3 palettes, Tailwind tokens and VS Code surface layout |
| `vendor/` | Pinned T3 contracts and client runtime; provenance and license |
| `scripts/verify-host.ts`, `verify-edh.mjs`, `verify-ui.mjs` | Real-server, real-VS-Code and deterministic browser verification |
| `scripts/verify-views.ts`, `src/host/testing/` | Three built webviews sharing the real bridge/host with test transports, without launching VS Code |
| `src/host/*.test.ts`, `src/shared/*.test.ts` | Host behavior and bridge boundary regression tests |

See [the architecture](docs/t3-vscode-architecture.md) for the host/webview boundary and milestones. The [feature comparison](docs/kilo-kimi-t3-feature-matrix.md) remains reference material.

## Current scope

The core chat migration supports projects/threads, server-advertised models (including ACP instances), effort and permissions, file references, assistant citations with comments, native font settings, message streaming, rich turn items, approvals, questions, Stop, progressive history and local VSIX packaging. Attachment upload, terminal/preview panels, usage dashboards and checkpoint restore are later work. Images currently have an Open action rather than an authenticated inline asset pipeline. Specialized tool previews and cross-window behavior still need a fidelity pass. ACP model selection is covered by fixtures; the isolated live-server checks used Codex.

T3-derived source is MIT-licensed; retain [the upstream notice](vendor/LICENSE.t3code) in distributions.
