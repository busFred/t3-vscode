# Vendored T3 Code packages

Source copied (src only) from the T3 Code repo:

- **Upstream:** `/home/hungtien/Documents/playground/myt3code`
- **Git sha:** `7812230572f2d7e042d8d14ada2381fc71377560` (2026-10-05, upstream version 0.0.45)

## What is here

| Package | Upstream path | Vendored path |
| --- | --- | --- |
| `@t3tools/contracts` | `packages/contracts` | `vendor/contracts` |
| `@t3tools/shared` | `packages/shared` | `vendor/shared` |
| `@t3tools/client-runtime` | `packages/client-runtime` | `vendor/client-runtime` |

Each copy contains the package's `src/` tree (structure preserved) and its
`package.json`, nothing else.

## What was excluded

- All `*.test.ts` files (36 in contracts, 77 in shared, 121 in client-runtime).
- `packages/shared/src/testing/` entirely (testkit: `longTempDir.ts`,
  `symlinks.ts`, `TraceRetention.fixture.mjs`). No non-test source imports it.
- All `devDependencies` from the copied package.jsons (test-only tooling).
- No `__snapshots__` directories existed upstream, so none were copied.

## Why

Single pinned copy of the T3 wire protocol (`contracts`) plus the shared/client
runtime, vendored so the extension builds against a frozen schema instead of a
moving upstream. See `docs/t3-vscode-architecture.md` for the decision record.

## License

MIT, Copyright (c) 2026 T3 Tools Inc. The full license text is in
[`LICENSE.t3code`](./LICENSE.t3code) and **must ship with any distribution** of
this extension (third-party notices).

## Runtime dependencies (for the root package.json)

Declare these once in the root `package.json`; the vendored package.jsons keep
`workspace:*` refs to each other and rely on the root for externals:

- `effect` **4.0.0-rc.115** — exactly one copy; duplicates break schema decoding
- `@noble/curves` 1.9.1
- `@noble/hashes` 1.8.0
- `jose` 6.2.2
- `yaml` ^2.9.0
- `mdast-util-directive` ^3.1.0
- `micromark-extension-directive` ^4.0.0
- `micromark-util-character` ^2.1.1
- `remark-parse` ^11.0.0
- `unified` ^11.0.5
- `three` 0.180.0

Type-checking additionally needs `micromark-util-types` ^2.0.2 (type-only
import in `client-runtime/src/codexMarkdownDirectives.ts`; it was a devDependency
upstream) and `@types/node` (several `shared` files import `node:*` builtins).
Both belong in the root devDependencies.

## Syncing from upstream

Against a fresh upstream checkout:

```sh
UPSTREAM=/path/to/myt3code        # at the desired sha
DEST=vendor

rsync -a --exclude='*.test.ts' --exclude='__snapshots__/' \
  "$UPSTREAM/packages/contracts/src/"        "$DEST/contracts/src/"
rsync -a --exclude='*.test.ts' --exclude='__snapshots__/' --exclude='/testing/' \
  "$UPSTREAM/packages/shared/src/"           "$DEST/shared/src/"
rsync -a --exclude='*.test.ts' --exclude='__snapshots__/' \
  "$UPSTREAM/packages/client-runtime/src/"   "$DEST/client-runtime/src/"

cp "$UPSTREAM/packages/contracts/package.json"      "$DEST/contracts/package.json"
cp "$UPSTREAM/packages/shared/package.json"         "$DEST/shared/package.json"
cp "$UPSTREAM/packages/client-runtime/package.json" "$DEST/client-runtime/package.json"
cp "$UPSTREAM/LICENSE"                              "$DEST/LICENSE.t3code"
```

Then re-apply the package.json edits by hand (they are **not** scripted):

1. Delete the `devDependencies` field from each copied package.json.
2. Replace every `catalog:` / `catalog:default` version with the concrete
   version from the upstream `pnpm-workspace.yaml` `catalog:` section
   (keep `workspace:*` refs as-is).

3. Add the extension adapter subpath exports: `./rpc/session`, `./rpc/http`,
   `./connection/model`, `./state/thread-history-merge`, and
   `./state/server-config-projection`. Each points at the existing source file.
   The `./rpc/session` entry points at `./src/rpc/session.ts`
   (upstream's `./rpc` barrel exports only `protocol.ts` and the `RpcSession`
   type; the extension needs `RpcSessionFactory` for connection lifecycle).

Update the provenance block at the top of this file, and re-run the
verification greps: no `three` imports outside `client-runtime/src/device/`,
no imports of `./testing` / `@t3tools/shared/testing` outside test files.

## Known caveats

- `vendor/shared/package.json` still exports `./testing/longTempDir` and
  `./testing/symlinks`; those entries are left intact from upstream but point
  at files that are excluded here. Nothing in the vendored tree imports them.
- `vendor/client-runtime/src/remotePerformance.bench.ts` is kept verbatim (it
  is not a `*.test.ts`). It imports `vite-plus/test`, which is not vendored;
  exclude or delete it on the next sync if it interferes with typechecking.
