# T3 VSCode user guide

Reference detail for the extension's behavior. See [README.md](../README.md) for the overview and quick start, [Development and testing](development.md) for building from source and [feature history](feature-history.md) for what changed in each version.

## Connect to a T3 server

Linux is the first verified platform. Install the T3 Code CLI using its [installation guide](https://github.com/pingdotgg/t3code/blob/main/docs/user/install.md), then run `t3` to start the server and open its web app. Open **Settings → Providers** in T3 to connect a provider. Alternatively, keep `t3 serve` running in a terminal and open the web address it prints. Return to T3 VSCode and choose **Retry connection**; the extension pairs automatically and the sidebar opens Sessions directly. If providers still need setup, guidance appears above Sessions while existing conversations remain available.

Running in the background is optional. On Linux or macOS, `t3 service install` installs and starts the service; see the [service instructions](https://github.com/pingdotgg/t3code/blob/main/docs/user/background-service.md). Stop a manually started foreground server before switching. You can also install the service first and configure providers in T3's web app afterward. Use `t3 service status` to diagnose an installed service and `t3 service restart` to restart it. Remote T3 servers are not supported yet.

### Connection diagnostics

Setup distinguishes a missing server, a stopped process, an unanswered probe, incompatible versions and pairing errors. **Connection details** shows the failed stage and diagnostic. Copyable startup commands target the configured data directory; isolated/custom homes keep their own startup guidance and do not suggest installing the normal background service.

## Settings

Settings live in **Preferences → Settings → Extensions → T3 VSCode**, grouped under **Appearance**, **Reading**, **Usage**, **Refresh** and **Connection**. Use the native User/Workspace tabs to choose where values are saved, and each setting's **Reset Setting** action to restore its default.

| Setting | Key | Default | Notes |
| --- | --- | --- | --- |
| Font Size: Interface | `t3-vscode.fontSizeInterface` | `16` | Chat text and navigation, 12–20 px. |
| Font Size: Prompt | `t3-vscode.fontSizePrompt` | `14` | Message and queued-message editors, 12–20 px. |
| Font Size: Code | `t3-vscode.fontSizeCode` | `13` | Code blocks, diffs and tool output, 10–18 px. |
| Message Navigation | `t3-vscode.messageNavigation` | `left` | Rail placement: `left`, `right` or `off`. |
| Usage: Follow Active Conversation | `t3-vscode.usage.followActiveConversation` | `true` | Status meters track the focused chat's provider. |
| Usage: Pinned Accounts | `t3-vscode.usage.pinnedAccounts` | `[]` | Accounts always shown in the status bar. |
| Refresh: Default Interval Minutes | `t3-vscode.refresh.defaultIntervalMinutes` | `10` | Shared periodic refresh interval for usage and worktrees. Fractional minutes are supported; `0` disables periodic refresh. |
| Refresh: Usage Interval Minutes | `t3-vscode.refresh.usageIntervalMinutes` | `null` | Inherit the default unless overridden. Usage adds up to 20% jitter. Explicit legacy seconds settings remain effective until overridden or reset. |
| Refresh: Worktree Interval Minutes | `t3-vscode.refresh.worktreeIntervalMinutes` | `null` | Inherit the default unless overridden. Manual refresh and checkout-changing actions still update immediately. |
| T3 Home | `t3-vscode.t3Home` | empty | Empty uses the default T3 home; set it to your server's data directory and reload VS Code. |

Font size changes apply immediately to every view and preserve conversations and drafts. The settings button at the bottom of the session manager and the **T3 VSCode: Font Settings** command open that native settings page. Existing setting keys and saved values are preserved across versions.

## Sessions sidebar

The sidebar has **Sessions**, **Worktrees** and **Tasks** tabs, each with its own **+** action. Sessions begin directly below search, with one **New Thread** button beside the search field and no project-name row. **Settled** and **Archive** have separate lists. Session activity appears beside the provider: minutes, hours and days through 7 days, then a local date; hover for the exact time.

Use the sort button beside **+** to order sessions by last activity or title, ascending or descending. The menu floats over the list; the view remembers your choice. Pins stay first and subagents stay with their parent.

Select a session to open its editor tab; if it is already open, the extension reveals that tab. Use VS Code's editor groups, group locking and tab/window movement to arrange chat beside your code. The globe opens the current session in your default browser, using localhost for a loopback server so it can reuse your paired browser session. Working sessions show a static icon and elapsed minutes; a session that is only waiting on delegated subagents or other background work shows a calmer, muted "Waiting" badge instead; Input/Approval badges and VS Code notifications highlight sessions needing a response.

The sidebar title keeps **Open Web UI** and its overflow actions. Right-click a session to rename, pin, settle, archive, restore or delete it. The editor has its conversation breadcrumb, browser shortcut and thread actions.

Subagents appear beneath their parent session in a tree whose branches start collapsed. Expand a parent to inspect its children; expand a session to see independently collapsible **Subagents** and **Scheduled tasks** groups. Active, Settled and Archive list and count ordinary conversations only, according to each conversation’s own state. Subagents of every state stay beneath their parent; archived summaries load automatically after connection. A parent is never duplicated into another section because of a child’s state. Search expands the ancestors of matching children. Hover or focus a subagent transcript row for its provider, model, current status and elapsed time; click it to open the child, then use **Subagent of** to return. Provider-native child conversations are read-only; T3-owned delegated conversations accept follow-ups.

## Workspace scope

With a folder open, canonical paths and Git repository identity determine which projects appear. Opening a linked worktree includes its entire project's conversations and tasks, including archived conversations. Multi-root workspaces include each opened folder. An empty VS Code window can browse all server projects and use **No project** when the server supports it. New threads default to the opened checkout, or the selected project when there is no workspace.

## Worktrees

Open **Worktrees** beside Sessions and Tasks, or use **Worktree** immediately after the permission mode inside the message box. New conversations can use Root, a new checkout, an existing branch/checkout, or a GitHub pull request. Choose the base branch and model allocations before sending; parallel runs each receive their own checkout.

Every window shows the entire project, including its sessions and tasks. Each conversation keeps its own checkout. File references from another checkout show the full source path; choosing a new checkout does not silently retarget an existing reference.

Linked checkouts share one collapsible repository group even when T3 has separate project records for them. **Main checkout** identifies the original Git checkout; other rows are checkouts, not a list of all branches. Detached checkouts include their folder and commit. Submodules have distinct Git identities and appear separately only when they are already visible T3 projects; the extension does not recursively discover them. If several T3 project records share a repository, the settings and action selectors retain their separate service settings.

Use **Groups** at the bottom right to show or hide repository groups. Visibility is saved for the current service/workspace; new groups start visible. Ordinary conversations appear under their checkout, with subagents nested beneath their parent in collapsed **Subagents** groups, including children using another checkout. Their tooltip identifies the child's actual working directory. Counts exclude subagents, and search expands matching descendants. Closing an untouched new chat removes only that conversation; typing or attempting setup preserves it.

Worktrees refreshes every 10 minutes by default, on page open, after checkout changes and with the search bar's refresh button. The refresh icon spins while existing rows stay in place. Ordinary conversation activity does not rescan Git. Override the interval in **Refresh** settings; Sessions and Tasks receive live service updates instead of periodic polling.

Open checkout details for setup status, logs, terminal, project actions, native diffs and selected-file transfers. Applying files asks for an explicit destination and stops on conflicts. **Continue in new worktree** moves an idle Root conversation with its history; copying uncommitted files is optional. Removing a checkout retains its branch and conversations, so it can be restored later.

### Worktree settings and Python

**Actions**, **Creation** and supported **Cleanup** settings save to the T3 service and appear in T3 Web. The worktree directory is a service-wide machine setting. Import `t3.json` actions before running them. A setup action with **Wait for setup** blocks the first message; background actions do not.

**Environment** is extension-managed. For a Python project, enable a profile, choose a directory or unique Conda name, select an environment file or an existing environment to clone, and supply a custom setup command such as `bash ./setup.sh`. Add `.` to editable packages for this checkout’s project. The stable identity belongs to the checkout, not the agent or conversation.

Preparation creates the environment, runs custom setup, installs editables and verifies interpreter/source paths. Failure keeps the prompt and checkout for retry. Use the displayed environment helper or the checkout’s terminal for Python commands; instructions are supplied to agents, but their arbitrary shell commands are not automatically activated. The base environment is never modified or deleted.

The Python profile syncs between this extension’s windows, not into T3 Web. Web-created worktrees need preparation in the extension to use it. Explicit extension removal cleans up only environments it owns.

**Environment cleanup · extension only** is enabled by default. Opening or refreshing Worktrees checks for owned environments left after a checkout was removed, including removal by T3 Web. A 24-hour grace period starts at the first confirmed removal; cleanup happens on a later open/refresh after that period, not on a background timer. Git identity, environment ownership and known activity are checked again before deletion. Moved, registered-but-missing or inaccessible checkouts are retained. Disabling this option retains environments and resets the grace period on the next check.

An already-missing environment only updates its record; it never causes checkout deletion. Sessions and branches remain available. Restoring a checkout reuses its retained named environment or rebuilds one that was cleaned up, then reruns setup and verification. Separately launched Python processes cannot all be detected; disable automatic environment cleanup if you need to keep one running independently. Older records without the required Git identity are retained until the checkout is prepared again.

## Account and usage meters

**Account & Usage** starts collapsed. Expand it to refresh limits and see the selected account's reported update time.

The status bar shows a small provider icon followed by reported month/week/session percentages, such as `M 72% · W 77% · S 94%`. Unreported windows are omitted; a single window uses its full name, such as `Week 77%`, and no reported windows show `Usage unavailable`. Hover for all windows and reset times, or click to expand Account & Usage for that account. Use the Command Palette's **T3 VSCode: Configure Status Meters** command or **Status meters** in Account & Usage to follow the focused chat and/or pin individual accounts. **T3 VSCode: Refresh Usage Meters** refreshes the figures immediately rather than waiting for the interval.

### Automatic refresh

Usage refreshes once when T3 VSCode connects and then inherits **Refresh: Default Interval Minutes**, initially 10. Set **Refresh: Usage Interval Minutes** for a separate cadence; fractional values work and `0` disables periodic refresh. Each usage wait adds up to 20% random jitter, so the default means ten to twelve minutes. Explicit values in the deprecated `t3-vscode.usage.refreshIntervalSeconds` setting remain effective until you set a new usage override or reset that legacy value. The legacy minimum of 15 seconds does not apply to the new minute settings.

A refresh makes T3 rescan provider transcripts and re-probe provider instances, which competes with sending a message on the same server:

- A refresh that falls due while a message is being sent or a response is running waits until the session goes idle, which makes a delay far less likely rather than impossible — a refresh already under way cannot be called back. One is forced through anyway once the meters are about five intervals stale, so the meters cannot freeze during a long run.
- While no status-bar meter is displayed, automatic refreshes pause entirely, and the waiting refresh runs as soon as a meter appears. Account & Usage then updates only when you refresh it with its own button.
- An automatic refresh is scoped to what is displayed. With exactly one meter shown it targets that account's provider instance, so the other accounts listed in Account & Usage do not advance on their own; with several meters shown it sweeps every instance. The Account & Usage **Refresh usage** button and the **Check providers** action in provider setup always sweep every instance.

Shared credentials are deduplicated; separate subscriptions keep separate meters.

## Editor chats and drafts

Open the **T3 VSCode** activity bar view. **T3 VSCode: Open New Chat in Editor Tab** creates a fresh conversation in the active editor group, even when another chat is already open. The chat-header **+** creates a new chat in that header's editor group.

Each chat header has a default-closed **History** picker for switching conversations within that tab, including when the sidebar is on another monitor. It keeps drafts with their conversations and provides search, status badges, collapsed subagents and separate Settled/Archive lists.

Each editor tab retains its conversation and draft. Text, cursor position, references and attachments recover after closing the tab or restarting VS Code; concurrent tabs keep separate drafts. These recovery records belong to the extension and remain separate from T3 web UI drafts. Session selection and input notifications reveal an already open conversation instead of duplicating its tab. Creating another conversation leaves existing editor drafts intact. Double-click the chat header title to rename a conversation. Tab titles follow conversation names and live renames; closing a tab keeps conversations running in other views.

Closing a newly created chat without typing, adding a reference/attachment or sending a message removes that untouched empty conversation after its last chat surface closes. Typing and later clearing still preserves it, as does managing the thread or renaming/pinning it in the Web UI. Preexisting empty conversations stay available.

Message footers show their recorded date and time in your local timezone. Assistant icons precede the timestamp on the left; your timestamp precedes Copy on the right. Hover the time for its full date and timezone.

Use **Fork** at the end of a settled assistant run to continue from that run in a new conversation. Interim answers keep their Copy action; they do not offer a separate fork point. The fork opens in that view and preserves the source conversation; the button is available when T3 supports native forking or its portable history fallback. File links in chat open a native VS Code editor, including links to a line or range such as `src/main.ts#L24-L25`.

## Composer and editing

The composer keeps Markdown as editable text with a permanent grouped toolbar. Links stay as `[text](url)` and backticks stay visible. **Shift+Enter** continues lists, **Tab/Shift+Tab** indent or outdent lists, code and multiline selections, and **List assist** enables automatic continuation and numbering repair. Inserting a line into an ordered list repairs the following numbers; Undo first reverses the repair while keeping the inserted line. Selected text can be wrapped by quotes, brackets, backticks or dollar signs; colon and semicolon remain ordinary punctuation. Paste, code fences, math, IME and autocomplete retain their usual behavior. A small ring and percent immediately left of **List assist** tracks the active thread's context window usage once the provider reports it; hover or focus it for exact token counts, and watch for it to turn to the warning or error color as usage climbs.

Model, effort and permission controls sit inside the composer, with shortcut hints beside Send. Stop appears immediately to its left while a run is working, leaving Send in place.

### Queue and steer

While an agent is responding, **Enter** or the send button queues a follow-up after its turn. **Ctrl+Enter** (Cmd+Enter on macOS) steers the running turn when supported; otherwise the message queues. When the agent is idle, Enter sends normally. **Shift+Enter** inserts a new line. Queued messages and the current turn's task plan appear above the input. You can edit or cancel queued messages, reorder them by dragging or using the handle's arrow keys, and promote one to Steer. The inline queued-message editor uses the same prompt font size and line spacing as the main message box; previews stay compact and your current draft stays in place. Stopping generation pauses the queue; **Resume queue** continues it.

### Slash commands and file suggestions

Type `/` for the current provider's commands and skills, or `@` to find files in the conversation's workspace. Arrow keys navigate suggestions; Enter or Tab inserts one. `/model` opens model search, and `/usage-limits` expands **Account & Usage** in the session manager for that provider.

## Models

The model picker browses configured provider instances and Favorites. Search finds visible models across every provider using T3's fuzzy matching, and stars save favorites across extension sessions. **Manage models** lets you show/hide models and reorder them by dragging the six-dot grip or pressing Alt+Up/Down on it; provider counts reflect the visible list. Saved visibility also applies to search and Favorites, and explicitly enabled legacy models retain their configured position. Arrow keys navigate results; Enter chooses a model and Escape closes the picker. The effort control next to the model selects its advertised levels; models without that capability omit it. The visible Code/Plan toggle has been removed.

Favorites, visibility and ordering are saved independently in VS Code. Configure them with the picker's stars and **Manage models** controls. Custom models continue to come from the selected T3 server's catalog. Existing saved preferences remain available after the manual T3 Web import feature was removed.

## References, citations and attachments

Select text in a file and press **Ctrl+K** (**Cmd+K** on macOS), or choose **Reference Editor Selection** from its context menu, to insert a compact reference such as `@README.md:43-46` at the last-used chat's prompt cursor. **Alt+K** remains available. The shortcut preserves existing prompt text and includes the exact selected text, including unsaved changes, when you send; removing the inline reference omits its snapshot. If no chat is open, the shortcut opens an editor chat; browsing sidebar usage preserves the last focused editor target.

Select text in an assistant or user message, right-click and choose **Quote**. The quote/comment box opens; save with or without a comment to insert the reference at the last prompt cursor position, replacing selected prompt text when present. Cancel leaves the draft unchanged. Then Ctrl/Cmd+click the inline reference, or plain-click its quote chip, to edit it; **Alt+Enter** opens the reference at the cursor. A plain click on an inline reference only moves the caret, so its text can be edited by hand. Removing the quote chip also removes its inline references, and deleting an inline reference prevents that quote from being sent. Quotes keep their T3 source link and readable text when sent; saved source links can reopen and highlight the source message. References and drafts stay with their own conversation and view.

Inline references in the message box — files, images and quotes alike — open with **Ctrl+click** (**Cmd+click** on macOS); hold that key and the caret becomes a pointer. A plain click only moves the caret, so a path can be retyped by hand to reach a file the `@` suggestion list will not offer, such as a gitignored one.

Paste an image into the message box, drag files onto it, or use its paperclip to choose files from anywhere on the local machine. Image thumbnails appear in drafts and sent messages. Paste, drop and file selection insert a stable image/file reference at the cursor so the provider receives its position in the paragraph. Select text before pasting an image to use those words as its description: `![selected words](…)`; pasting without a selection uses the filename. Descriptions are normalized to a single line without link brackets, and a batch uses the selection for its first image. Click an image thumbnail, or Ctrl/Cmd+click its inline reference, for a floating preview. Attachments can be sent without additional text and remain attached through Queue and Steer. T3's attachment limits apply, and a failed upload must be removed and attached again before sending.

## Reading the transcript

Conversation spacing stays compact without changing text size or line height. Assistant prose, including early answers and progress updates, remains visible; only typed thoughts and tools fold into timed groups. Each message or steer separates those groups. The active run has one Assistant header and a status-only Working header that pins while scrolling, then disappears when the run finishes.

Chat and command text use the theme's editor foreground for stronger contrast, while secondary labels retain the theme's secondary color. Thought process entries start collapsed; consecutive commands and tool activity appear inside a closed summary that you can expand for details.

Chat stays in one virtualized column at every editor size; the two-column experiment has been removed for performance.

Use the message rail to preview and jump through past prompts and responses with the pointer, mouse wheel or keyboard. **Latest** returns to the live end. **T3 VSCode: Message Navigation** in native Settings offers **Left**, **Right** and **Off**, with Left as the default. Jumps are instant and preserve the composer draft; returning to the bottom resumes following streamed replies.

### Markdown, media and math

Markdown images, video/audio, Mermaid diagrams and T3's `html_render` graphics render inside the transcript. HTML graphics keep their interactions and adapt to the native theme inside a sandbox. Inline math supports `$...$` or `\(...\)`; display math supports `$$...$$` or `\[...\]`, including matrices and aligned equations. Wide display equations scroll horizontally inside the message; click or keyboard-activate an equation for a floating preview. Right-click a rendered equation to copy **LaTeX**, **LaTeX with delimiters**, or **MathML**; MathML is useful for equation editors. Math fonts and the diagram renderer ship locally with the extension.

### Response diffs

A response with file changes shows one expandable changed-file summary with folders and additions/deletions. The summary also shows the current branch of the checkpoint checkout; Git does not record which branch was active when the response ran. Saved manual edits made before the response are excluded and are not listed. Responses with no agent changes, or without a reliable pre-message snapshot, show no changes box. Clicking a file opens VS Code's read-only diff editor for that turn's saved before/after snapshots. Earlier turn diffs remain unchanged by later edits or commits. This uses checkpoint files in the local T3 workspace; binary files cannot be expanded as text.

If you later use "Apply files" to merge a subagent's worktree changes into this checkout, a "Merged from subagent" group appears on the turn the merge landed on (with a source → destination branch chip and file counts), even if that turn made no agent changes of its own. Those merges are applied to the working tree, not committed; clicking a merged file shows the recorded merge patch read-only, since no "before" snapshot is kept for a merge. Merges applied before this feature was installed are not shown.

Right-click selected assistant or user message text for **Copy as plain text**, **Copy as Markdown** or **Quote**. Quote opens the optional-comment editor; there is no floating selection button. After clicking elsewhere, right-click the same source again to recover that passage. A new selection replaces the saved passage; switching sessions clears it. Equations keep their own context menu.

### Edit from here and restoring files

A user message with a ready checkpoint shows **Edit from here** and **Restore files to this point** below it. **Edit from here** is conversation-only: confirming rewinds the chat to just before that message and returns its text to the composer draft (not its attachments or inline references); nothing on disk changes. It needs a rollback-capable provider and no response currently running, and leaves a dimmed "N messages rewound" row at the end of the transcript until a later turn completes or you dismiss it — that row keeps its own **Restore files to this point** link.

**Restore files to this point** is separate and always available once a checkpoint exists, whether or not you rewound. It opens a panel listing every file touched since that checkpoint, tagged `agent`, `you` (your or another tool's edits, including new untracked files) or both, with a dry-run verdict — "keeps cleanly" or "conflicts" — for files with your edits, each with its own **Keep mine** checkbox (checked by default) and an **Open diff** link. **Restore and keep N files** restores to the checkpoint and re-applies your kept edits; **Restore everything** discards them; **Cancel** does nothing. A kept edit that cannot re-apply leaves the checkpoint's version in place and saves your version beside it as `<path>.yours`, reported in the result row with a **Compare** link — no Git stash is created. Restoring refuses to run while that conversation (or another one sharing the same checkout) has an active response.

## Find in session

Click **Find in session** or press **Ctrl/Cmd+F** inside a chat to search its complete recorded text. Matching words are also highlighted inside the messages and code while search is open, with a stronger highlight for the current occurrence. Each occurrence has its own result row with the same font size and line spacing as chat. Case, whole-word and navigation controls share the search row; Filters stays open while you adjust sources, figures/code/equations/files, context or order. Content filters combine as alternatives and intersect the selected sources. Search scans older history, reveals matching collapsed activity and keeps the draft intact. LaTeX source and attachment filenames are searchable; image pixels and the contents of embedded HTML pages are not. Very broad searches retain up to 20,000 navigable matches and show the total count.

The results disclosure collapses search to a floating bar with a **› N results** row, leaving no empty pane. The layout icon switches Above/Side and expands directly to Side from the collapsed bar. Narrow editors automatically stack results above chat and restore Side when wide enough. Results can be resized; layout, context, ordering and height are remembered per workspace.

## Scheduled tasks

**Tasks** lists the selected project's scheduled work, including independent tasks with no parent conversation. With one project, the list starts directly at **TASKS**; a project selector appears only when multiple projects are available. The chat header's **Scheduled** button lists only tasks with a known origin in that session. Existing tasks whose origin T3 does not record remain in the project list as **Origin unknown**; result destinations are not treated as proof of origin. Origin associations created by this extension are saved locally in VS Code, scoped to server/project/task.

Click a task to edit it on a secondary sidebar page. Choose its model, advertised effort, prompt, schedule, result destination and enabled state. Model changes apply only to the task. New tasks use advertised **GPT-6 Luna / Low** when available; otherwise choose a model explicitly. **Save task** updates future runs and returns to the list; **Run now** is separate. **Back** retains the task draft, and **Cancel** discards it. Unsupported newer schedules stay visible with enable/run controls, but require T3 Web for full editing.

## Install a local VSIX

For building from source, see [Development and testing](development.md#build-a-vsix).

In the VS Code window/profile where you want to use it, open **Extensions → ⋯ → Install from VSIX…**, choose that file, then reload the window if prompted. For an isolated preview installation, the CLI example uses separate user, extension and shared storage:

```sh
code --user-data-dir /tmp/t3-vscode-preview/user-data --extensions-dir /tmp/t3-vscode-preview/extensions --shared-data-dir /tmp/t3-vscode-preview/shared-data --install-extension ./target-installer/t3-vscode-<version>.vsix
```

The installed extension normally discovers your already-running T3 service under `~/.t3`. Leave **T3 VSCode: T3 Home** empty to use that default; an explicit setting or `T3CODE_HOME` overrides it. Packaging does not install the extension or start a server.

Time display follows **T3 VSCode: Time Format** in native VS Code settings: **Automatic** uses the webview locale default, while **12-hour** and **24-hour** override it across timestamps and tooltips. Automatic does not necessarily match a customized operating-system clock.
