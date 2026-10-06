# T3 Code for VS Code

A thin VS Code client for a separately running T3 Code server. The same T3 chat UI runs in the sidebar and an editor tab; connection, authentication and conversation state belong to the extension host.

## Run locally

Linux is the first supported platform. Install T3 separately and run `t3 service install` before using the extension. The extension discovers the service and pairs with it; it never starts a server.

```sh
pnpm install
pnpm run build
pnpm run typecheck
pnpm run test
code --extensionDevelopmentPath="$PWD"
```

Open the **T3 Code** activity bar view. **T3: Open Chat in Editor Tab** opens the same app in an editor. All projects are visible regardless of the current VS Code workspace. New threads default to the open workspace, or to the selected project when there is no workspace.

For development, start a separate server with an explicit home and point `t3-vscode.t3Home` at that directory. Never verify against the live `~/.t3` service:

```sh
t3 serve --base-dir /tmp/t3-vscode-dev --host 127.0.0.1 --port 47777 --no-browser
pnpm exec tsx scripts/verify-host.ts --base-dir /tmp/t3-vscode-dev
```

`verify-host.ts` creates a project/thread, runs one provider turn, and verifies thread actions and reconnect. An authenticated provider CLI must be available to the isolated server. When starting it from a T3-owned terminal, remove inherited `T3_SERVICE_LAUNCHER_CONTEXT` and `T3_BOOT_SERVICE_UNIT` variables from the child environment so it does not try to use the live service launcher.

## Where things live

| Path | Purpose |
| --- | --- |
| `src/extension.ts` | VS Code activation, commands, sidebar and editor containers, webview CSP |
| `src/host/serverDiscovery.ts` | Runtime-file discovery, PID check and environment probe |
| `src/host/pairing.ts`, `sessionStore.ts` | CLI pairing, headless bearer exchange and SecretStorage |
| `src/host/t3Client.ts` | Vendored Effect RPC transport and authenticated history requests |
| `src/host/hostState.ts` | Connection lifecycle, authoritative projections, subscriptions and user actions |
| `src/host/bridge.ts` | Validated webview intents and native clipboard/file/link actions |
| `src/shared/bridge.ts` | Snapshot DTOs and the allowed postMessage methods |
| `src/webview/components/` | Project navigation, composer, requests and virtualized timeline |
| `src/webview/components/t3/` | Portable components copied from T3, retaining upstream presentation |
| `src/webview/styles/tokens.css` | T3 palettes, Tailwind tokens and VS Code surface layout |
| `vendor/` | Pinned T3 contracts and client runtime; provenance and license |
| `scripts/verify-host.ts` | Integration check against an explicitly selected isolated server |
| `src/host/*.test.ts`, `src/shared/*.test.ts` | Host behavior and bridge boundary regression tests |

See [the architecture](docs/t3-vscode-architecture.md) for the host/webview boundary and milestones. The [feature comparison](docs/kilo-kimi-t3-feature-matrix.md) remains reference material.

## Current scope

The core chat migration supports projects/threads, server-advertised models (including ACP instances), modes, message streaming, rich turn items, approvals, questions, Stop and progressive history. Attachment upload, terminal/preview panels, usage dashboards, checkpoint restore and VSIX distribution are later work. Images currently have an Open action rather than an authenticated inline asset pipeline.

T3-derived source is MIT-licensed; retain [the upstream notice](vendor/LICENSE.t3code) in distributions.
