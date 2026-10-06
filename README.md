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
4. In that new window, open **T3 Code** in the activity bar. Before sending the first message, choose a model, Code/Plan and permission mode in the composer. The project picker offers **No project**, existing T3 projects, or a folder. Use **Projects and Threads** to browse, and **Open Chat in Editor Tab** to check that both surfaces follow the same selected conversation. Try **Thread Actions** in the sidebar overflow menu to rename, pin, archive and restore a thread.

After editing the extension or UI, stop debugging and press F5 again to rebuild. Breakpoints in the host TypeScript use the generated source maps. **T3: checks** runs typechecking and regression tests; **T3: verify UI** checks the built UI with browser fixtures; **T3: verify isolated host** sends a real provider turn to the development server.

The launch configuration passes `--profile=Default` and points both `--user-data-dir` and `--extensions-dir` into `.t3/vscode-profile`. The first launch copies the Default profile's settings, keybindings, snippets and installed extensions; later launches keep changes made in that development copy. The real profile and installation stay outside the development instance. **Always isolate both directories:** a fresh user-data directory sharing the real extension directory can cause VS Code to clean up extensions referenced only by the real profiles. The automated `verify-edh.mjs` check also uses separate temporary user-data and extension directories.

`launch.json` sets `T3CODE_HOME` to `/tmp/t3-vscode-dev-${workspaceFolderBasename}`, and workspace settings leave `t3-vscode.t3Home` empty so that environment value takes effect. The server's data must be outside a Git checkout: T3 disables its Scratch folder (the web UI's **No project** conversations) inside a checkout. Start the server task before F5; the extension discovers the existing server. The previous `.t3/vscode-dev` data is preserved but no longer used by this launch configuration.

If the development window says **T3 server unavailable**, run **T3: start isolated server** in the original repository window, keep its terminal open, then choose **Retry connection**. A running background service under `~/.t3` does not satisfy this isolated development configuration. Pairing happens after the development server is available.

The repository's gitignored `.t3` directory holds the development server and isolated VS Code profile. Normal extension use discovers the shared T3 home (`~/.t3` by default); it does not create `.t3` in each project.

Open the **T3 Code** activity bar view. **T3: Open Chat in Editor Tab** opens the same app in an editor. All projects are visible regardless of the current VS Code workspace. New threads default to the open workspace, or to the selected project when there is no workspace.

The sidebar uses VS Code's native title toolbar: **Projects and Threads**, **New Thread**, and **Open Chat in Editor Tab**. Its overflow menu contains **Thread Actions** (rename, pin, archive/restore) and pairing. There is no duplicate header inside the sidebar. The editor tab retains the T3 app header.

For development, start a separate server with an explicit home and point `t3-vscode.t3Home` at that directory. Never verify against the live `~/.t3` service:

```sh
t3 serve --base-dir /tmp/t3-vscode-dev --host 127.0.0.1 --port 47777 --no-browser
pnpm exec tsx scripts/verify-host.ts --base-dir /tmp/t3-vscode-dev
node scripts/verify-edh.mjs --base-dir /tmp/t3-vscode-dev
```

`verify-host.ts` creates a project/thread, runs one provider turn, and verifies rename, pin, archive/restore and reconnect. `verify-edh.mjs` launches its own temporary VS Code profile, sends a real message, and checks synchronization between the sidebar and editor tab. Both require an explicit isolated home and reject `~/.t3`. An authenticated provider CLI must be available to the isolated server. When starting it from a T3-owned terminal, remove inherited `T3_SERVICE_LAUNCHER_CONTEXT` and `T3_BOOT_SERVICE_UNIT` variables from the child environment so it does not try to use the live service launcher.

For deterministic browser checks without a server, run `node scripts/verify-ui.mjs` after building. It verifies rich rows, models, modes, approvals/questions, light/dark layouts and 1,000-item virtualization. It uses `/usr/bin/chromium` by default (`CHROMIUM_PATH` overrides it). The VS Code check uses `/usr/share/code/code` (`VSCODE_BIN` overrides it). Screenshots go to `/tmp/t3-vscode-ui`; neither check changes your normal VS Code profile.

## Where things live

| Path | Purpose |
| --- | --- |
| `.vscode/launch.json`, `tasks.json`, `settings.json` | Default-profile F5 launch, build/check tasks and an explicitly started isolated development server |
| `scripts/prepare-vscode-profile.mjs` | Copies Default settings and extensions into isolated F5 storage without changing the normal installation |
| `src/extension.ts` | VS Code activation, commands, sidebar and editor containers, webview CSP |
| `src/host/serverDiscovery.ts` | Runtime-file discovery, PID check and environment probe |
| `src/host/pairing.ts`, `sessionStore.ts` | CLI pairing, headless bearer exchange and SecretStorage |
| `src/host/t3Client.ts` | Vendored Effect RPC transport and authenticated history requests |
| `src/host/hostState.ts` | Connection lifecycle, authoritative projections, subscriptions and user actions |
| `src/host/bridge.ts` | Validated webview intents and native clipboard/file/link actions |
| `src/shared/bridge.ts` | Snapshot DTOs and the allowed postMessage methods |
| `src/webview/components/ChatView.tsx`, `ThreadList.tsx` | Responsive chat shell and all-project navigation |
| `src/webview/components/Composer.tsx` | Message drafts, model catalog, permission modes and Stop |
| `src/webview/components/TranscriptView.tsx`, `ChatMarkdown.tsx` | Virtualized typed turn items, markdown and native file/link intents |
| `src/webview/components/PendingRequests.tsx` | Provider approval choices and question forms |
| `src/webview/components/t3/` | Portable components copied from T3, retaining upstream presentation |
| `src/webview/styles/tokens.css` | T3 palettes, Tailwind tokens and VS Code surface layout |
| `vendor/` | Pinned T3 contracts and client runtime; provenance and license |
| `scripts/verify-host.ts`, `verify-edh.mjs`, `verify-ui.mjs` | Real-server, real-VS-Code and deterministic browser verification |
| `src/host/*.test.ts`, `src/shared/*.test.ts` | Host behavior and bridge boundary regression tests |

See [the architecture](docs/t3-vscode-architecture.md) for the host/webview boundary and milestones. The [feature comparison](docs/kilo-kimi-t3-feature-matrix.md) remains reference material.

## Current scope

The core chat migration supports projects/threads, server-advertised models (including ACP instances), modes, message streaming, rich turn items, approvals, questions, Stop and progressive history. Attachment upload, terminal/preview panels, usage dashboards, checkpoint restore and VSIX distribution are later work. Images currently have an Open action rather than an authenticated inline asset pipeline. Specialized tool previews and cross-window behavior still need a fidelity pass. ACP model selection is covered by fixtures; the isolated live-server checks used Codex.

T3-derived source is MIT-licensed; retain [the upstream notice](vendor/LICENSE.t3code) in distributions.
