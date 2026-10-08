# `@` file suggestions — investigation only

Status: read-only delegated investigation, completed on 2026-10-08 against extension v0.1.16. No suggestion, Tab or Enter behavior has been changed. The connected server's live search response was not inspected.

## Current extension behavior

| Step | Behavior | Source |
| --- | --- | --- |
| Trigger | Find the token immediately left of the cursor, stopping at whitespace; an `@` token becomes a path query. | [composerTrigger.ts](../vendor/shared/src/composerTrigger.ts#L95) |
| Timing | Debounce requests by 150 ms, hide old-query results and ignore stale responses. Bare `@` also requests suggestions. | [Composer.tsx](../src/webview/components/Composer.tsx#L104), [useBridgeQuery.ts](../src/webview/useBridgeQuery.ts#L6) |
| Workspace | Search the active thread's worktree/project checkout, or the new draft's selected workspace/project. | [hostState.ts](../src/host/hostState.ts#L869) |
| Request | Call `projects.searchEntries` with the query, workspace and `limit: 50`; omit the kind filter, so files and directories are requested together. | [t3Client.ts](../src/host/t3Client.ts#L159) |
| Ordering | Display every returned entry in server order, with no immediate-child or folder-first rule. The host drops `truncated` and `ignored` metadata. | [hostState.ts](../src/host/hostState.ts#L925) |
| Display | Show basename plus parent path; use a folder icon for directories. | [ComposerSuggestions.tsx](../src/webview/components/ComposerSuggestions.tsx#L8) |
| Highlight | Start at the first entry; arrow keys wrap and pointer movement highlights a row. Changing the query resets the highlight. | [Composer.tsx](../src/webview/components/Composer.tsx#L111) |
| Confirmation | Unmodified Tab, Enter and click all insert a completed `[basename](encoded/path) ` link, dismiss suggestions and restore textarea focus. | [Composer.tsx](../src/webview/components/Composer.tsx#L114) |

The query is limited to 256 characters. While the suggestion menu is open, Tab and Enter are swallowed even if no results are ready; Shift+Enter and Ctrl/Cmd+Enter keep their newline and send/steer routes. The trigger replacement ends at the cursor, leaving text farther right in the same token intact.

## Why the immediate folder can be missing

`@experiments/playground/` performs a workspace-wide path search rather than listing that directory's children. Descendant files and directories compete for the same first 50 results; `fashion-grey` has no guaranteed place in that page. The extension does not explicitly exclude directories.

Read-only inspection of the [vendored upstream pin](../vendor/README.md) at `7812230572f2d7e042d8d14ada2381fc71377560` establishes that its server:

- Normalizes the query and uses a workspace-scoped native search index.
- Calls `FileFinder.mixedSearch` for an unrestricted path query, asks for 51 candidates and returns at most 50 in native order.
- Normalizes returned separators and removes trailing slashes; it does not synthesize directory ancestors for search. Ancestor reconstruction belongs to the separate recursive list operation.
- Has tests for fuzzy matching, exact-basename priority, truncation, untracked file inclusion and exclusion of ignored paths, `.git`, `node_modules` and `.convex`. Empty-directory inclusion is demonstrated for immediate filesystem listing, not for native search.

Relevant upstream sources are `apps/server/src/workspace/WorkspaceEntries.ts:235`, `WorkspaceSearchIndex.ts:143,195,437` and `WorkspaceEntries.test.ts:99,223,262,363`, inspected without edits in `/home/hungtien/Documents/playground/myt3code`.

Ranking/limit, native indexing/ignore state or differences in the connected server remain possible explanations for the particular missing folder. A live RPC response and the example tree would be needed to identify its exact cause; the upstream pin does not establish the connected server's implementation.

## Proposed extension-only changes — not implemented

1. For path suggestions, **Tab** replaces the active trigger with `@<highlighted path>`, appends `/` for a directory, adds no trailing space and leaves suggestions active. **Enter/click** retain Markdown-link confirmation. Other command and skill suggestions retain their existing Tab behavior.
2. For literal directory browsing, use the existing [`projects.listEntries` contract](../vendor/contracts/src/project.ts#L283) with `directoryPath`, then filter/rank immediate children before limiting results. Keep global fuzzy search for ordinary queries. Filtering the existing top 50 results cannot recover missing children.
3. Decide how ignored entries should appear: immediate listing includes ignored and empty children and annotates ignored entries where Git classification is available. It enforces the workspace boundary and excludes `.git`; no T3 Code application change is required.

## Edge cases for later implementation

- Support paths with spaces; the current whitespace-based trigger would otherwise stop after Tab inserts such a path.
- Preserve path case/special characters, strip the browsing slash before final link serialization and handle middle-token replacement deliberately.
- Handle Enter immediately after Tab during the loading gap, repeated Tab on an unchanged file, empty/error results, Escape, IME and native undo.
- Verify keyboard/pointer highlight agreement, Enter confirmation without sending, subsequent Enter send/queue, Ctrl/Cmd+Enter steer, unchanged slash/skill suggestions and independent drafts/worktree scope.
- Use a deterministic example tree with immediate folders, ignored and empty directories and more than 50 descendant matches. Any live integration must isolate T3 and VS Code storage.

The investigator made no edits, built no installers and invoked no providers. This document records findings and a proposal only.
