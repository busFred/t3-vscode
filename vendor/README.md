# Vendored T3 Code packages

Source copied (src only) from the T3 Code repo:

- **Upstream:** `/home/hungtien/Documents/playground/t3code`
- **Git sha:** `61c3794c32b0eeebfac09add43e403618c65d2d7` (2026-11-02, upstream version 0.1.6)
- **Previous pin:** `7812230572f2d7e042d8d14ada2381fc71377560` (2026-10-05, 0.0.45)

## What is here

| Package | Upstream path | Vendored path | Contents |
| --- | --- | --- | --- |
| `@t3tools/contracts` | `packages/contracts` | `vendor/contracts` | whole `src/` |
| `@t3tools/shared` | `packages/shared` | `vendor/shared` | whole `src/` except `managedPolicyFile.ts` |
| `@t3tools/client-runtime` | `packages/client-runtime` | `vendor/client-runtime` | whole `src/` |
| `@t3tools/provider-*` (9 packages) | `packages/provider-*` | `vendor/provider-*` | client halves only |
| `@t3tools/source-control-*` (8 packages) | `packages/source-control-*` | `vendor/source-control-*` | `shared/` halves and the registry only |

Since 0.1.x, `client-runtime` imports provider and source-control packages.
Only the client-side modules it reaches are vendored: the files reachable from
`@t3tools/provider-*/client`, `@t3tools/provider-core/modelShortName`,
`@t3tools/source-control-definitions/registry` and
`@t3tools/source-control-core/shared/{definition,threadPullRequests}`.
`scripts/vendor-closure.mjs` computes that file set; its only external
dependency is Effect. Their package.json files are trimmed to `name`, `version`,
`type`, the reached `exports` and the dependencies those files import.

## What was excluded

- All `*.test.ts` and `*.bench.ts` files, and `packages/shared/src/testing/`.
- `shared/src/managedPolicyFile.ts` and its export: it needs the native `ffi-rs`
  module and is only used by the server.
- Server halves of the provider and source-control packages (SDKs, keyrings,
  drivers).
- All `devDependencies` from the copied package.jsons (test-only tooling).

## Why

Single pinned copy of the T3 wire protocol (`contracts`) plus the shared/client
runtime, vendored so the extension builds against a frozen schema instead of a
moving upstream. See `docs/t3-vscode-architecture.md` for the decision record.
The extension refuses servers older than 0.1.5 (`src/shared/serverVersion.ts`):
0.1.5 removed `server.getSettings`, `scheduledTasks.list` and
`orchestration.subscribeArchivedShell`.

## Rendering adapter provenance

The extension adapters inspected the T3 Code Web UI for `html_render` attachment metadata, responsive heights and theme notifications, and the upstream UI for markdown, KaTeX, media and subagent navigation behavior. These adapters live in `src/shared/` and `src/webview/`; they do not replace the vendored protocol packages or embed the entire original Web UI.

## License

MIT, Copyright (c) 2026 T3 Tools Inc. The full license text is in
[`LICENSE.t3code`](./LICENSE.t3code) and **must ship with any distribution** of
this extension (third-party notices).

[LICENSE.remark-math](LICENSE.remark-math) retains the license from the [rehype-katex 7.0.1 release](https://github.com/remarkjs/remark-math/blob/rehype-katex%407.0.1/license); the same license is present in the [remark-math 6.0.0 release](https://github.com/remarkjs/remark-math/blob/6.0.0/license), and both npm packages omit a standalone license file. The notice generator includes it in the bundled dependency notices.

## Runtime dependencies (for the root package.json)

The vendored manifests declare their runtime dependencies and keep
`workspace:*` references to each other. The workspace override pins one Effect
version; the root also declares Effect because the host adapter imports it.

- `effect` **4.1.2** (upstream catalog) — exactly one copy; duplicates break
  schema decoding. Effect 4.1 moved `effect/unstable/http` and
  `effect/unstable/socket` to `effect/http` and `effect/socket`.
- The remaining versions come from the upstream `pnpm-workspace.yaml` catalog;
  see each vendored package.json.

## Syncing from upstream

Against a fresh upstream checkout:

```sh
UPSTREAM=/path/to/t3code        # at the desired sha
DEST=vendor
for p in contracts shared client-runtime; do
  rsync -a --delete --exclude='*.test.ts' --exclude='*.bench.ts' --exclude='__snapshots__/' \
    --exclude='/testing/' --exclude='node_modules/' "$UPSTREAM/packages/$p/src/" "$DEST/$p/src/"
  cp "$UPSTREAM/packages/$p/package.json" "$DEST/$p/package.json"
done
cp "$UPSTREAM/LICENSE" "$DEST/LICENSE.t3code"
# Client halves of provider/source-control packages (prints the reachable files with LIST=1):
LIST=1 node scripts/vendor-closure.mjs "$UPSTREAM/packages" \
  @t3tools/provider-core/client @t3tools/provider-core/modelShortName \
  @t3tools/provider-{acp-registry,cursor,fx,grok,kiro,muse,opencode,pi}/client \
  @t3tools/source-control-definitions/registry \
  @t3tools/source-control-core/shared/definition @t3tools/source-control-core/shared/threadPullRequests
```

Add any new `@t3tools/*` entry the client-runtime starts importing to the
closure command. Then re-apply by hand (not scripted):

1. Delete `devDependencies` and `scripts` from each copied package.json.
2. Replace every `catalog:` version with the concrete version from the upstream
   `pnpm-workspace.yaml` `catalog:` section (keep `workspace:*` refs as-is), and
   set the same Effect version in the root package.json and the workspace
   override.
3. In `shared`: delete `src/managedPolicyFile.ts`, its export and the `ffi-rs`
   dependency; drop `./testing/*` exports.
4. In `client-runtime`: add the extension adapter subpath exports if upstream
   lacks them: `./rpc/session`, `./rpc/http`, `./connection/model`,
   `./state/thread-history-merge`, `./state/server-config-projection`.
5. Preserve the Windows launcher correction in `shared/src/shell.ts`: escape
   command-path metacharacters without adding argument-style quotes, keeping
   argument escaping separate as in [cross-spawn](https://github.com/moxystudio/node-cross-spawn/blob/master/lib/util/escape.js).
   `src/host/pairing.test.ts` covers it.
6. Preserve the scheduled-task adapter in `contracts/src/scheduledTask.ts`:
   `ScheduledTask` keeps unknown fields and an opaque `schedule`, and the upsert
   input, fixed-time and interval schedules keep unknown fields. Newer schedules
   stay visible and unedited fields survive a save.
   `src/host/scheduledTasks.test.ts` covers it.

No other local edits remain. Upstream now covers what earlier pins patched:
secret requests, worktree settings, and unknown turn items. T3 skips unknown
item and event types; `src/host/unknownTurnItem.test.ts` pins that behavior.

Afterwards run `pnpm install`, `npx tsc --noEmit`, `pnpm test` and
`pnpm run build`, and check that no `three` import reaches the extension bundle.

## Known caveats

- `client-runtime` still declares `three`, `jszip` and `@pierre/diffs`; only
  device, zip and diff modules use them, and the extension does not import those.
