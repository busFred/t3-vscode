# Restore files to this point — options

Design mockup, not current behaviour. **The implemented design combines options 1 and 3** — a compact confirm as the entry point, expanding on demand into option 1's grouped preview panel, with one flat per-file list carrying an `agent` and/or `you` tag rather than separate sections — shown in [revert-combined.html](revert-combined.html). See [Revert and restore](../feature-history.md#revert-and-restore) in the feature history.

Mockup: [revert-options.html](revert-options.html) (open in a browser; Light/Dark toggle at top).

## Background

"Edit from here" (design B) only rewinds the transcript to a user message — no git
operation runs. A separate **"Restore files to this point"** action does the actual
workspace restore. T3 Code's server-side restore is:

```
git restore --source <checkpoint> --worktree --staged -- .
git clean -fd
```

with no dirty-tree check, so any edit made to the workspace after that checkpoint —
by the human, or by an external tool — is silently discarded. These three options all
surface that risk before the restore runs, instead of after.

## How human vs. agent attribution is computed

No new tracking is needed; it falls out of refs the extension already writes:

- `refs/t3/vscode/turn-start/<hash(threadId, messageId)>` — a tree snapshot taken at
  the start of each turn (`src/host/turnBaseline.ts:14` `captureTurnBaseline`).
- `refs/t3/orchestration-v2/checkpoints/...` — the server's per-turn checkpoint refs,
  resolved into adjacent base/head ranges by `src/host/turnDiff.ts:23`
  `turnCheckpointRange`, and turned into per-file diff stats by
  `src/host/turnDiff.ts:36` `turnDiffFiles`.

A file is attributed as **human** when the live working tree differs from the latest
*agent* checkpoint tree for that path — i.e. `git diff <latest-checkpoint-tree> --
<path>` is non-empty. A file is **agent-only** when it's covered by a turn's
checkpoint diff but the working tree matches that checkpoint exactly. An **untracked**
file is new since the last checkpoint and not in the agent's diff at all (what
`git clean -fd` would delete). All three options reuse this same three-way
classification; they differ only in how it's presented. Option 2 additionally needs a
*hunk*-level version of this diff (not just file-level stats), since it tags
individual hunks rather than whole files — that doesn't exist yet in `turnDiff.ts`.

## Options

| | Approach | Safety | Clicks | Cost | Fit |
|---|---|---|---|---|---|
| **1. Grouped preview panel** | TurnChanges-style rows split into "Your edits" (red, first), "Agent changes", "Untracked" sections; per-file Keep checkbox, default checked | Highest — every human file enumerated before anything runs | 2 | Low–medium, reuses `TurnChanges` rendering | Sidebar and editor tab |
| **2. Inline attribution diff** | Native-diff view per file; human hunks get a red gutter stripe + "You" badge; file list at left | Good at line level, weaker at file level (easy to skim) | 2–3 | Highest — needs new hunk-level diff plumbing | Editor tab only; cramped in sidebar |
| **3. Two-step confirm** | VS Code-notification-style confirm with counts + "Review my edits" link; expands into option 1's panel on demand | Depends on the user reading counts before the fast path | 1 (fast path) / 3 (reviewed) | Lowest to ship — thin wrapper + reuse of option 1's panel | Sidebar for the notification; editor-tab width once expanded |

All three share one scenario: checkpoint at turn 3; the agent changed `hostState.ts`
(+31−4), `bridge.ts` (+2), `ThreadList.tsx` (+4−2), `feature-history.md` (+10) since
then; the human hand-edited `hostState.ts` (different region, +4−2) and
`feature-history.md` (+1), plus untouched `README.md` (+3) and new `notes/todo.md`.

The rewind-only path ("Edit from here" alone) is the same across all three options:
the prompt returns to the composer and later messages collapse into a dimmed
`4 messages rewound · Restore files to this point` row, so the files restore stays
reachable but opt-in.

## Recommendation

**Option 1 (grouped preview panel)**, with **option 3's notification as its entry
point** rather than a bare button — i.e. clicking "Restore files to this point" always
shows the counts notification first, and "Review my edits" (or clicking when any file
is human-touched) opens option 1's full panel — because it gets the safety of
enumerating every at-risk file with a pre-checked "Keep" default, at the lowest
additional implementation cost (file-level diffs the extension already computes),
while option 2's hunk-level attribution is the only one that needs new diff plumbing
and doesn't scale down to the sidebar.
