# T3 VSCode

A VS Code client for a separately running [T3 Code](https://github.com/pingdotgg/t3code) server: workspace sessions and agent chat in editor tabs, beside your code instead of in a browser. Colors follow your VS Code theme.

0.2.4 is on the [Marketplace](https://marketplace.visualstudio.com/items?itemName=hungtienhuang.t3-vscode) release channel.

## In the editor

Captured from the extension in an isolated VS Code window with synthetic conversations.

![T3 VSCode with workspace sessions, rendered cross-entropy equations and a comparison table](docs/screenshots/math-and-sessions.png)

*Sessions beside the conversation. Equations, tables and code render in the editor tab.*

![A response's changed-file summary in chat beside VS Code's side-by-side diff editor showing the agent's edit to trainer/metrics.py](docs/screenshots/response-diff.png)

*A response's agent-only changes, opened in VS Code's read-only diff editor.*

![Find in session showing five highlighted matches for "gradient" above the conversation](docs/screenshots/find-in-session.png)

*Find in session searches the whole recorded conversation.*

![The model picker listing Codex and Claude models with a starred favorite, above the effort and permission controls](docs/screenshots/models-and-effort.png)

*Any model the server advertises, with its effort and permission mode.*

![A Mermaid training pipeline and an interactive experiment comparison inside T3 VSCode](docs/screenshots/diagrams-and-graphics.png)

*Mermaid diagrams and T3 HTML graphics render in the transcript.*

![The sidebar task editor with a name, prompt, model, reasoning effort and a daily schedule](docs/screenshots/scheduled-tasks.png)

*Scheduled tasks get their own model, effort and schedule.*

![Selecting assistant text and commenting on a quote in T3 VSCode's light theme](docs/screenshots/quotes-and-code.png)

*Quote a passage and comment on it; the reference lands at your prompt cursor.*

## What you get

| | |
| --- | --- |
| Sessions | Workspace-scoped projects, threads and subagents; rename, pin, settle, archive. |
| Editor tabs | One conversation per tab, each with a durable draft and its own History picker. |
| Rich transcripts | Markdown, code, tables, images, media, Mermaid, T3 HTML graphics, KaTeX math. |
| Code-aware prompts | Ctrl/Cmd+K inserts a file reference; **Cite** quotes a reply; `@` files, `/` commands. |
| Agent control | Server models, effort and permission modes, Stop, queue and steer, approvals. |
| Review | Agent-only response diffs in VS Code's diff editor; full-history **Find in session**. |
| Usage and tasks | Status-bar account meters; a Tasks tab for T3 scheduled work. |

## Get started

T3 Code and its providers are separate applications you install and run yourself.

1. Install the T3 Code CLI — [installation guide](https://github.com/pingdotgg/t3code/blob/main/docs/user/install.md).
2. Run `t3`, then connect a provider under **Settings → Providers**.
3. In VS Code, open the **T3 VSCode** view and choose **Retry connection**.

Pairing is automatic. Running T3 as a [background service](https://github.com/pingdotgg/t3code/blob/main/docs/user/background-service.md) is optional; if connection fails, **Connection details** names the failed stage.

## Scope and limitations

- Alpha. Linux is the first verified platform.
- Local servers only; remote T3 servers are not supported yet.
- Specialized tool previews and interactive checkpoint restore remain later work; rendering is not full web-app parity.
- No embedded terminal, and moving a chat between windows is unverified.

## More

- [User guide](docs/user-guide.md) — setup, every setting, how each feature behaves.
- [Feature history](docs/feature-history.md), [changelog](CHANGELOG.md) — what changed, by version.
- [Development and testing](docs/development.md) — build, debug, verify.
- [Publishing](docs/publishing.md) — version policy and release procedure.
- [Support](SUPPORT.md) — reporting bugs.

### Documentation map

The user guide is authoritative for current feature behavior; the feature history is authoritative for when each behavior shipped and for in-progress/unreleased work; the architecture doc is authoritative for the host/webview design and milestones. `docs/mockups/*` are design explorations made before or during implementation, not records of current behavior — each mockup file says whether and how it was implemented.

[MIT licensed](LICENSE). T3-derived code keeps [its upstream notice](vendor/LICENSE.t3code); bundled dependencies keep their own.
