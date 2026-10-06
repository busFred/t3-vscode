# Kilo Code × Kimi Code × T3 Code — Feature Matrix (decision draft)

Context: merged VS Code extension, T3 Code as backend (server via `t3 service`, Linux first),
Original comparison considered Kimi Code visual style. Current direction is to migrate T3 Code UI and functionality into VS Code. KEEP is unfilled reference material, not scope.

Legend: ✅ full · 🟡 partial/limited · ❌ none · ⚠️ kilo v7 documented as remaining work
Kilo = current mainline rewrite (packages/kilo-vscode + opencode CLI), not the legacy Roo fork.

| # | Feature | Kilo | Kimi | T3 | Note under T3-backend design | KEEP? |
|---|---------|------|------|----|------------------------------|-------|
| **Providers & auth** |
| 1 | Kimi subscription login (device OAuth) | ❌ | ✅ | 🟡 via ACP registry (nightly) | Already works per user; no adapter needed | |
| 2 | Providers via API key | ✅ ~500 models.dev | ✅ Anthropic/OpenAI/Gemini/Vertex | ❌ by design (BYOS via provider CLIs) | Core premise of the project — harness keeps its tuned toolchain | |
| 3 | Bring-your-own-subscription (provider CLI logins) | ❌ | ❌ (Kimi sub only) | ✅ core | | |
| 4 | Anonymous/free tier | ✅ kilo-auto/free | ❌ | ❌ | | |
| 5 | Custom OpenAI-compatible providers | ✅ | ✅ | 🟡 custom model per provider instance | | |
| 6 | Per-model options (effort/reasoning variants) | ✅ variant picker | ✅ thinking effort | ✅ per-provider catalogs | | |
| 7 | Mid-task model switching | ✅ | ✅ vision-aware picker | 🟡 per provider turn | | |
| 8 | Subagent model pool | ✅ | 🟡 CLI only | ❌ | Provider harness handles subagents | |
| 9 | Per-provider usage/quota visibility | ✅ Profile cards | ✅ `/usage` + quota widget | ✅ usage page + limits widget | Port T3's, reskin | |
| 10 | Provider CLI install/update mgmt | ❌ | ❌ | ✅ | T3 desktop/server concern; probably not in ext | |
| 11 | Usage-limit (5h/weekly) recovery UI | ❌ | 🟡 | ✅ banner + worker | | |
| **Agent modes & autonomy** |
| 12 | Code mode | ✅ | ✅ default | ✅ | | |
| 13 | Plan mode (plan-file guard) | ✅ | ✅ + exit alternatives | ✅ proposed plans / runtime policy | | |
| 14 | Ask (read-only) mode | ✅ | 🟡 | ❌ | | |
| 15 | Debug mode (dedicated prompt) | ✅ | ❌ | ❌ | Could map to a custom instruction/preset | |
| 16 | Explore mode | ✅ | ✅ explore subagent | ❌ | Harness-side | |
| 17 | Orchestrator mode | ✅ | 🟡 swarm/tower CLI | ✅ delegate_task | | |
| 18 | Custom user-defined modes/agents | ✅ CRUD UI | ✅ `.kimi-code/agents` | ❌ | | |
| 19 | YOLO / auto-approve | ✅ global + per-tool rules | ✅ yolo + auto/AFK | ✅ per-provider permission modes | Per-tool rules are moot; provider modes survive | |
| 20 | Goal mode | ✅ `/goal` | ✅ `/goal` CLI | 🟡 scheduled tasks | | |
| 21 | Mid-turn steering | 🟡 | ✅ + queue | ✅ queued messages | | |
| 22 | Max-cost alert | ✅ | ❌ | 🟡 usage widgets | | |
| **Agent tools (mostly harness-side under T3 — decide whether any UI is needed)** |
| 23 | File read/write/edit/patch | ✅ | ✅ | ✅ harness | No ext UI beyond rendering | |
| 24 | Bash with permission patterns | ✅ PTY | ✅ fg/bg two-phase kill | ✅ server PTY | | |
| 25 | Glob/grep | ✅ | ✅ | ✅ workspace index | | |
| 26 | Web fetch/search tools | ✅ | ✅ | 🟡 harness | | |
| 27 | Subagent spawning (sync+bg parallel) | ✅ | ✅ AgentSwarm ≤128 | ✅ T3-owned cross-provider | | |
| 28 | Todo tracking | ✅ header strip | ✅ | 🟡 todo_list item | Render todo_list item | |
| 29 | Question/ask-user tool | ✅ docked | ✅ structured 1–4 | ✅ user_input_request | | |
| 30 | Browser automation | ✅ Playwright ⚠️ | ❌ (MCP rec) | ✅ preview automation | | |
| 31 | Image generation | ✅ | ❌ | ❌ | | |
| 32 | Semantic codebase search | ✅ LanceDB/Qdrant | ❌ | 🟡 workspace index | | |
| 33 | LSP diagnostics tool | ✅ exp | ❌ | ❌ | | |
| 34 | Notebook tools | ✅ exp | ❌ | ❌ | | |
| 35 | Chart rendering | ✅ | ❌ | ❌ | | |
| 36 | Video/multimodal input | 🟡 images | ✅ images+video 20MB | 🟡 attachments | | |
| 37 | Skills invocation | ✅ | ✅ ≤3 nesting | ✅ | | |
| **Checkpoints, diff, history, restore** |
| 38 | Per-turn snapshots | ✅ git refs | 🟡 baseline | ✅ hidden git refs | T3's is server-side & cross-client: prefer | |
| 39 | Per-message revert/redo | ✅ banner | ✅ `/undo` CLI | ✅ rollback service | | |
| 40 | Session fork | ✅ | ✅ at turn index | ✅ ThreadForkService | | |
| 41 | Native VS Code diff view | ✅ | ✅ `vscode.diff` | 🟡 in-app diff panel | Nice ext differentiator; fetch contents via RPC | |
| 42 | Inline diff in chat/approvals | ✅ | ✅ | ✅ file_change items | | |
| 43 | Checkpoint retention/cleanup | ✅ 30d | 🟡 | 🟡 | | |
| 44 | Cross-session history search | ✅ | 🟡 | ✅ thread search | | |
| 45 | Session preview/replay | ✅ | ✅ replay | ✅ event log | | |
| 46 | Session export/rename | ✅ | ✅ `/export` | ✅ auto-title | | |
| 47 | Diff annotations/comments | ❌ | ❌ | ✅ review service | | |
| **Context management** |
| 48 | Auto-compaction | ✅ | ✅ | 🟡 harness | | |
| 49 | Manual /compact | ✅ | ✅ hints | ❌ client-side | | |
| 50 | Persistent project memory | ✅ kilo-memory | 🟡 AGENTS.md | 🟡 handoffs | | |
| 51 | Codebase indexing/embeddings | ✅ consent flow | ❌ | 🟡 search index | | |
| 52 | @-file mentions | ✅ multi-root | ✅ fuzzy | ✅ composer mentions | | |
| 53 | Editor context (selection/file) | ✅ | ✅ policy-driven | 🟡 context chips | | |
| 54 | Terminal/git-changes context | ✅ | ❌ | 🟡 | | |
| 55 | Instruction files (AGENTS.md etc.) | ✅ | ✅ hot reload | ✅ harness reads | | |
| 56 | `/init` AGENTS.md generation | ⚠️ | ✅ | ❌ | | |
| 57 | Claude Code compat/import | ✅ | n/a | ✅ session import | | |
| 58 | Prompt enhancer | ✅ | ❌ | ❌ | | |
| 59 | Context window meter | 🟡 | ✅ thresholds | ✅ composer meter | | |
| **Multi-agent / orchestration** |
| 60 | Orchestrator parallel delegation | ✅ | 🟡 | ✅ delegate_task | | |
| 61 | Subagent inspector UI | ✅ | 🟡 | ✅ projection | | |
| 62 | Swarm board | ✅ | 🟡 | ❌ | | |
| 63 | Worktree-per-session | ✅ AI-named | ❌ | ✅ + merge-back | | |
| 64 | Open PR from worktree | ✅ | ❌ | ✅ link/watch PRs | | |
| **Scheduling & background** |
| 65 | Cron tools | ✅ ≤10 | ✅ ≤50 | ✅ + MCP tools | | |
| 66 | Scheduled wakeups | ✅ | 🟡 | ✅ | | |
| 67 | Background processes | ✅ | ✅ WaitFor | ✅ | | |
| 68 | Keep-awake (caffeination) | ✅ | ❌ | 🟡 | | |
| 69 | Schedule management UI | ❌ | 🟡 | ✅ settings page | | |
| **Permissions & security** |
| 70 | Per-tool allow/ask/deny | ✅ pattern-level | 🟡 rules | ✅ provider modes | Moot — approvals live in harness | |
| 71 | Path-scoped permissions | ✅ | ❌ | ❌ | | |
| 72 | OS-level sandbox (bwrap/seatbelt) | ✅ | ❌ | 🟡 provider sandboxes | | |
| 73 | Scoped auth tokens | ❌ | ❌ | ✅ | Ext consumes via pair | |
| 74 | Audit/activity log | ❌ | ❌ | ✅ | | |
| **Terminal** |
| 75 | Agent-run commands | ✅ | ✅ | ✅ server PTY | | |
| 76 | Embedded terminal panel | ✅ xterm | ❌ | ✅ ghostty-vt | Optional; T3 web has it | |
| 77 | NL → shell command | ✅ | ❌ | ❌ | | |
| 78 | Terminal context-menu actions | ✅ | ❌ | ❌ | | |
| **UI surface** |
| 79 | Sidebar chat + open-in-tab | ✅ | ✅ | 🟡 web app | Ext provides this | |
| 80 | Multi-session dashboard | ✅ Agent Manager | ❌ | ✅ thread sidebar | | |
| 81 | Command palette / keybindings | ✅ | ✅ | ✅ | VS Code's own + T3 server-stored | |
| 82 | Task timeline graph | ✅ | ❌ | ✅ minimap | | |
| 83 | Token throughput/cost badges | ✅ | ✅ pill | 🟡 | | |
| 84 | Mermaid / math rendering | ✅ | ✅ KaTeX | 🟡 | | |
| 85 | Theme/appearance editor | 🟡 | ✅ VS Code-native | ✅ incl. VS Code import | Kimi style = port CSS tokens | |
| 86 | Welcome/onboarding | ✅ wizard | ✅ mascot | ✅ wizard | | |
| 87 | i18n (21 locales) | ✅ | ❌ EN/ZH | 🟡 | | |
| 88 | Voice input | ✅ STT | ❌ | ✅ iPhone only | | |
| **Git / PR / VCS** |
| 89 | Commit message generation | ✅ | ❌ | ✅ presets | | |
| 90 | `/review` of changes | ✅ | ❌ | 🟡 diff review | | |
| 91 | PR list/detail/review UI | 🟡 open only | ❌ | ✅ 5 providers | Probably out of ext scope v1 | |
| 92 | Stacked PRs | ❌ | ❌ | ✅ | | |
| 93 | Thread↔PR linking | ✅ tool | ❌ | ✅ | | |
| 94 | Worktree setup scripts | ✅ | ❌ | ✅ | | |
| **MCP** |
| 95 | MCP client (stdio+HTTP, OAuth) | ✅ marketplace | ✅ masked secrets | 🟡 bridges | Harness-side under T3 | |
| 96 | T3 exposes ~68 tools to agents | ❌ | ❌ | ✅ | Free with backend | |
| **Remote / multi-device** |
| 97 | Remote relay / tailnet pairing | ✅ | 🟡 | ✅ LAN/Tailscale/tunnel | | |
| 98 | Hosted web client | 🟡 | ❌ | ✅ | | |
| 99 | Mobile app + push | ❌ | ❌ | ✅ | | |
| 100 | Multi-environment mgmt / load balancing | ❌ | ❌ | ✅ | | |
| 101 | Device simulator panel | ❌ | ❌ | ✅ | Out of ext scope | |
| **Diagnostics / misc** |
| 102 | Cost tracking + price overrides | ✅ | 🟡 tokens | ✅ + CLIProxyAPI | | |
| 103 | Process diagnostics / host resources | ❌ | ❌ | ✅ + Rust sampler | | |
| 104 | OS notifications + sounds | ✅ | ❌ | 🟡 push | | |
| 105 | Screenshot → attach | ❌ | 🟡 paste | ✅ SnapShot natives | | |
| 106 | Server self-update | ❌ | ❌ | ✅ | Prereq: `t3 service install` | |
| 107 | Settings sync / scoped settings | ⚠️ | ❌ | ✅ | | |

## Architecture decisions already made

1. Kimi support: via T3 ACP registry (nightly) — no custom adapter.
2. Auth: per-machine; extension shells out to `t3 pair` at activation, holds durable session; "folder scoping" is client-side filtering only (no per-project ACLs exist server-side).
3. Goal: preserve T3 features, reskin with Kimi Code visual identity.
4. Client stack: **vendor/copy** `@t3tools/contracts` + `client-runtime` (and their deps `shared`, `effect`) into the extension repo. Confirmed OK by user; license check still pending.
5. Server: `t3 service install` is a documented prerequisite; Linux first.
6. Rendering: port T3 web components per turn-item type (~21 types), reskinned; reuse client-runtime `work-log/presentation` for labels.
7. Workspace mapping: **no project filtering** — the extension shows all threads/projects on the environment, like the T3 web app. The opened folder is only used for resolving "open file at path" and as the default cwd for new threads. (Consequence: multi-root needs no policy at all.)
8. Surfaces: chat in sidebar AND pop-out editor tab (hard requirement); both host the same webview app over a shared host-side state store.

## Open questions remaining

- T3 license check before vendoring contracts/client-runtime.
- Kimi visual token port: exact CSS token mapping (zinc base + blue-500 accent + amber/emerald/red semantics, Inter, dense sizes).
- Whether to reuse T3's tiptap composer or Kimi's textarea composer.
- Checkpoints UI: adopt T3 server-side checkpoints exclusively; optional Kimi-style per-file Undo/Keep layer on top.
- Multi-root workspace policy (v1: primary folder only?).
