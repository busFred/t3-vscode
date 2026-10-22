# T3 VSCode feature history

This document tracks features by release, including how later versions changed them. Versions refer to T3 VSCode, not the separate T3 Code server. Historical entries were checked against Git and the v0.0.1–v0.0.7 release documentation; v0.0.9, v0.1.10 and v0.1.11 were local previews, and v0.1.12 is the first Marketplace alpha prerelease; v0.1.13 is published on the release channel, with same-version revisions including double-click renaming, session search, tab History, new-chat actions, Markdown composer tools, durable draft recovery, occurrence search filters, dense transcript spacing with visible assistant messages and connection onboarding that opens Sessions automatically. The Windows pairing fix was published as prerelease v0.1.14 and promoted to release v0.1.15 after the owner confirmed the preview works.

The published v0.1.16 includes selected-text image descriptions, local model management, compact session activity, scheduled tasks and queued-message editing. The v0.1.17 prerelease adds agent-only response diffs. Its published Git baseline is `b71e129` (manifest v0.1.16). The owner explicitly authorized publication of v0.1.17 to the Marketplace prerelease channel. v0.1.18 is published to the Marketplace release channel from `251cfec`, with the transcript resize-padding, streaming row-overlap and automatic usage-refresh changes. v0.1.19 was published to the Marketplace prerelease channel with the owner's explicit authorization, and keeps that background usage refresh from delaying sent messages. v0.1.20 reworks how file references and assistant quotes are written into and rendered from a message. It was authorized for and published to the prerelease channel, though the upload returned an outage page and was recorded as failed until a later readback showed the Marketplace had ingested it; its changes ship again in v0.1.21. The owner explicitly authorized v0.1.21 for the Marketplace prerelease channel. v0.2.0 is authorized for Marketplace prerelease publication, with its version unchanged from the reviewed candidate. v0.1.23 was published to the Marketplace stable channel on 2026-10-18; the immediate listing readback still showed v0.1.22, so public indexing is pending. v0.2.1 is a version-only republish of v0.2.0's worktree work (no runtime changes), authorized for and published to the Marketplace prerelease channel; its listing readback also lagged the upload. See the release verification entries below for earlier installers and publication history. v0.2.2 is the prerelease that follows v0.2.1 with chat copy fixes, the context window meter, subagent-aware working status, pending-request card improvements, merge-back tracking, and revert/restore.

## Overview

| Feature name | Description | Introduced in | Last changed in |
| --- | --- | --- | --- |
| [Sessions sidebar](#sessions-sidebar) | Session manager with compact last-active times and chat in editor tabs. | v0.0.7 | v0.1.23 |
| [Scheduled task management](#scheduled-task-management) | Compact project/session task lists, a multi-project selector and independent model/effort editor tabs. | v0.1.16 | v0.1.23 |
| [Workspace scope](#workspace-scope) | Project-wide sessions and tasks across main and linked checkout windows. | v0.0.2 | v0.2.0 |
| [Independent chat views](#independent-chat-views) | Independent tab drafts with local recovery for text, references and attachments. | v0.0.2 | v0.2.2 |
| [Conversation management](#conversation-management) | Rename, pin, archive, restore and delete conversations. | v0.0.1 | v0.1.13 |
| [Settled and Archive](#settled-and-archive) | Separate collapsible lists for settled and archived conversations. | v0.0.6 | v0.1.23 |
| [Conversation search](#conversation-search) | Searches native thread titles and message snippets. | v0.0.1 | v0.1.22 |
| [Find in session](#find-in-session) | Full-history occurrence search, persistent filters and collapsible Above/Side results. | v0.1.13 | v0.1.22 |
| [Conversation status and notifications](#conversation-status-and-notifications) | Immediate accepted-send status, pinned Working header and input notifications. | v0.0.1 | v0.2.2 |
| [Message navigation rail](#message-navigation-rail) | Previews and jumps between exchanges in the current conversation. | v0.0.8 | v0.0.8 |
| [Subagent conversations](#subagent-conversations) | Nested child conversations in Sessions and Worktrees with a route back to the parent. | v0.0.1 | v0.2.2 |
| [Untouched chat cleanup](#untouched-chat-cleanup) | Removes untouched root/worktree chats while retaining drafts and setup attempts for retry. | v0.0.8 | v0.2.0 |
| [Compact composer](#compact-composer) | Permanent toolbar and checkout choice beside permissions inside the message box. | v0.0.1 | v0.2.0 |
| [Context window meter](#context-window-meter) | Ring + percent in the composer toolbar showing live provider usage against the model's context window. | v0.2.2 | v0.2.2 |
| [Slash commands and file suggestions](#slash-commands-and-file-suggestions) | Offers provider commands, skills and files with explicit source checkout paths. | v0.0.6 | v0.2.0 |
| [Queue and steer](#queue-and-steer) | Enter queues follow-ups; Ctrl/Cmd+Enter steers supported active runs. | v0.0.6 | v0.0.8 |
| [Queue controls and task progress](#queue-controls-and-task-progress) | Edits queued text at the prompt font size; reorders follow-ups and shows current tasks. | v0.0.6 | v0.1.16 |
| [Attachment presentation](#attachment-presentation) | Draft and sent previews with local recovery after closure. | v0.0.1 | v0.1.23 |
| [Clipboard paste and file picker](#clipboard-paste-and-file-picker) | Image paste uses selected words as its description; local uploads survive tab closure. | v0.0.8 | v0.1.20 |
| [Streaming and progressive history](#streaming-and-progressive-history) | Streams replies, loads older history and keeps rows separate as rich content settles. | v0.0.1 | v0.1.18 |
| [Markdown and media](#markdown-and-media) | Formatted text, code, underline, tables, images, video and audio. | v0.0.1 | v0.1.21 |
| [Collapsed activity](#collapsed-activity) | Timed thought/tool groups separated by visible assistant messages and steers. | v0.0.1 | v0.1.13 |
| [Interactive HTML graphics](#interactive-html-graphics) | Displays T3's inline HTML visualizations and mockups. | v0.0.8 | v0.0.8 |
| [Mermaid diagrams](#mermaid-diagrams) | Renders diagrams with native theme colors and an expanded preview. | v0.0.8 | v0.0.8 |
| [Two-column reading](#two-column-reading) | Removed in v0.1.10 after performance feedback. | v0.0.9 | v0.1.10 |
| [Math rendering and copying](#math-rendering-and-copying) | Renders KaTeX with scrolling, floating previews and copy actions. | v0.0.8 | v0.0.9 |
| [Models and provider instances](#models-and-provider-instances) | Server catalogs with per-instance visibility and drag ordering saved in VS Code. | v0.0.1 | v0.1.16 |
| [Model search and favorites](#model-search-and-favorites) | Searches visible models and saves favorites independently in VS Code. | v0.0.4 | v0.1.16 |
| [Effort and permission controls](#effort-and-permission-controls) | Advertised model options and runtime modes inside the composer. | v0.0.1 | v0.2.2 |
| [Account usage](#account-usage) | Collapsed sidebar limits, refresh time and Status meters action. | v0.0.6 | v0.2.3 |
| [Status bar meters](#status-bar-meters) | Shows provider/account usage with configurable account selection and automatic refresh. | v0.0.7 | v0.2.3 |
| [Shared refresh settings](#shared-refresh-settings) | Minute-based default and usage/worktree overrides, including fractional intervals. | v0.2.0 | v0.2.0 |
| [Native file links](#native-file-links) | Opens chat-linked files and ranges in VS Code's editor. | v0.0.1 | v0.1.21 |
| [Editor references](#editor-references) | Inserts file ranges with checkout-aware labels and preserved source URIs. | v0.0.4 | v0.2.0 |
| [Assistant citations](#assistant-citations) | Inserts user and assistant message quotes at the prompt cursor with comments and source links. | v0.0.4 | v0.2.2 |
| [Response forks](#response-forks) | One supported fork at the end of each settled assistant run. | v0.0.5 | v0.1.22 |
| [Saved turn diffs](#saved-turn-diffs) | Shows agent-only response files, counts, the current checkpoint checkout branch and files merged in from a subagent checkout. | v0.0.6 | v0.2.2 |
| [Revert and restore](#revert-and-restore) | "Edit from here" rewinds the conversation only; "Restore files to this point" is a separate, guarded extension-owned Git restore that keeps your edits where it can. | v0.2.2 | v0.2.2 |
| [Conversation tab titles](#conversation-tab-titles) | Names editor tabs after their active conversations. | v0.0.2 | v0.0.8 |
| [Open Web UI](#open-web-ui) | Opens the current conversation in the system default browser. | v0.0.7 | v0.1.10 |
| [Local connection and pairing](#local-connection-and-pairing) | Discovers and pairs with a local server, supports Windows CLI launchers and reports the failed connection stage. | v0.0.1 | v0.1.15 |
| [Missing-server setup](#missing-server-setup) | Guides first connection, distinguishes failures and opens Sessions directly; background service is optional. | v0.0.1 | v0.1.13 |
| [Settings organization](#settings-organization) | Groups native settings into Appearance, Reading, Usage, Refresh and Connection. | v0.0.9 | v0.2.0 |
| [Native themes and fonts](#native-themes-and-fonts) | Theme foregrounds and equal chat/search typography. | v0.0.1 | v0.1.13 |
| [T3 VSCode branding](#t3-vscode-branding) | Extension identity, scannable README listing and a separate user guide for reference detail. | v0.0.7 | v0.1.19 |
| [Isolated development and packaging](#isolated-development-and-packaging) | Tests in disposable profiles and produces channel-specific VSIX installers. | v0.0.1 | v0.1.15 |
| [Release versioning](#release-versioning) | Keeps the owner-selected version and publishes only a specifically authorized version/channel. | v0.1.10 | v0.1.17 |
| [Feature tracking and regression review](#feature-tracking-and-regression-review) | Maintains this history and requires an independent review before packaging. | v0.0.8 | v0.0.8 |
| [Tab History](#tab-history) | Searchable conversation switching within each editor tab. | v0.1.13 | v0.1.22 |
| [New chat editor actions](#new-chat-editor-actions) | Fresh chat tabs from the Command Palette, header and sidebar. | v0.1.13 | v0.2.0 |
| [Markdown composer tools](#markdown-composer-tools) | Literal formatting, selection wrapping, automatic numbering, indentation and undo. | v0.1.13 | v0.1.21 |
| [Message timestamps](#message-timestamps) | Recorded local date/time beside each message’s footer actions. | v0.1.22 | v0.1.23 |
| [Dense transcript spacing](#dense-transcript-spacing) | Compact gaps, one author per run and unobtrusive message actions. | v0.1.13 | v0.1.22 |
| [Worktree management](#worktree-management) | Checkout creation, import, parallel runs, review, selected-file apply and retained conversations. | v0.2.0 | v0.2.0 |
| [Worktree environments and settings](#worktree-environments-and-settings) | Service-backed native settings and extension-owned Python environments per checkout. | v0.2.0 | v0.2.0 |

## Sessions and navigation

### Tab History

#### v0.1.13

- Add a default-closed, searchable History picker to each editor tab with workspace sessions, status badges and nested subagents.
- Switch only the originating tab while retaining its conversation drafts and keeping Settled and Archive separate.
- Support keyboard navigation, Escape and outside-click dismissal in narrow editor groups.

#### v0.1.22

- Classify each ordinary conversation once by its own state; keep all matching subagents beneath it without duplicate parent context rows.

### New chat editor actions

#### v0.2.0

- A new chat inherits the selected checkout without inheriting the source conversation’s binding guard. Opening another worktree window retains all project sessions and tasks.

#### v0.1.13

- Make **Open New Chat in Editor Tab**, the chat-header plus and the sidebar New button create separate conversations and tabs.
- Create Command Palette chats in the active editor group and header-triggered chats in their originating group.
- Preserve existing tabs, drafts, attachment ownership and current-conversation links while removing untouched new chats when closed.

### Sessions sidebar

#### v0.1.23 — same-version rebuild

Keep minute/hour/day ages through exactly 14 days. Beyond 14 days, show the full last-activity date and time on the existing second line using the selected Date Format and Time Format. The same instant remains available in the tooltip.

#### v0.1.23 — same-version rebuild

Single-clicking an entry opens a native VS Code preview tab. Another preview replaces it; double-click keeps it open. Existing tabs are reused, and editing keeps the preview open. Sidebar selection follows the opened session.

#### v0.0.7

- Make Sessions the default sidebar page and retain a separate Chat mode for smaller screens.
- Start Account & Usage collapsed so conversations get the sidebar space.

#### v0.0.8

- Preserve the active editor chat and draft while its History page is open.
- Show sessions directly below search and remove the redundant project heading and project-level New Thread button.

#### v0.0.9

- Make the sidebar a session manager and remove its Chat/Sessions switch and embedded chat.
- Remove redundant History, New, Open in Editor and Usage title actions while keeping the browser shortcut and one New control above search.

#### v0.1.13

- Route the sidebar New button through the dedicated new-editor action without replacing the sidebar selection.

#### v0.1.13 — onboarding revision

- Show Sessions immediately after connection, with provider setup guidance above the list when no models are available, while retaining access to existing conversations.

#### v0.1.16 — session activity

- Show last-active time beside the provider on the existing metadata line, including nested, settled and archived sessions. Branch names and snippets yield space before the time.
- Use message/run timestamps, excluding visits and metadata changes; empty sessions use creation and unknown historical activity stays blank. Refresh every minute and on visibility changes.
- Show minutes, hours and days through 7 days, then a local date (with year when needed); expose exact local time to hover and assistive technology. Boundary and timestamp-source tests cover metadata changes, unknown/future dates and older years.

#### v0.1.21

- Reclaim 56px above the first conversation: drop the section-label band that repeated the selected tab, move its `+` beside the search field, and take the padding off the Account & Usage header and the tab bar. The `+` acts on the open tab, and only that tab's button is in the accessibility tree.
- Give each row two lines — a title that wraps to two and owns the full width, then run status, branch or match, age and icons — with the expand chevron spanning both so it never shortens the title. Titles read about 40px wider.
- Separate rows with a hairline instead of whitespace, at padding relative to the interface font size, and run the selection as a full-width band. Rows drop from about 50px to 35px. The separator is derived from the foreground because `--border` matches the sidebar background in several light themes, and joins the other explicit boundaries under high contrast, where the selection also gains an outline because the platform paints its background the same colour as the list.

#### v0.1.22

- Add a sort button beside the existing New button; its floating menu orders sessions by last activity or title in either direction without shifting the list.
- Remember the order in the view across reloads while retaining pinned precedence, shelf membership and subagent ancestry; sessions without activity use their recorded update time.
- Match the Settled, Archive and settings rows to the Sessions/Tasks tab strip height, including interface font scaling.
- Match the Sessions search row’s height and top/side spacing to Tasks, and reserve the clear control’s space so typing and clearing do not resize the field or move its buttons.

### Scheduled task management

#### v0.1.23 — same-version rebuild

Task entries open independent editor tabs with the same preview/keep behavior. Editing keeps the tab open; drafts survive sidebar navigation and webview reload. Save or Cancel closes the task editor, while Task manager returns to the sidebar. Restored task tabs wait for task data before validation.

#### v0.1.16 — local source revision

- Add Sessions/Tasks sidebar tabs, independent Subagents/Scheduled tasks groups in expanded sessions and a current-session-only Scheduled drawer in chat. Each manager owns its New button; project tasks require no parent thread.
- Open a shared secondary sidebar editor from every task entry point. Preserve the main chat's model, selection and draft; return to the prior front page after Save, retain edits on Back and discard on Cancel.
- Edit task prompt, model, advertised effort, interval/fixed schedule, result destination and enabled state. Default new tasks only to advertised GPT-6 Luna Low; otherwise require an explicit model. Saving does not run the task.
- Keep task origin separate from its mutable result destination using extension-owned server/project/task associations. Older tasks without trustworthy origin remain in the project list; support explicit origin IDs from newer servers.
- Validate project/workspace scope and fresh configuration, reject deleted/stale tasks, preserve modes/attribution/provider options and newer server fields, and use partial enable updates. Display unsupported newer schedules without overwriting them.
- Pass deterministic host tests and real create/edit/list/subscription/model/low-effort persistence checks against an isolated T3 home. Combined UI/review validation is recorded under Release verification before packaging.

#### v0.1.16 — task navigation recovery

- Keep the sidebar mounted during a same-environment reconnect so unsaved task forms, Back-retained drafts, list queries, scroll and expansion state survive connection recovery.
- Route the existing Sessions command to the Sessions front page and Account & Usage to the visible front page, keeping any task draft for reopening.
- Cover reconnect and both native navigation events in the deterministic multi-view task fixture. Independent regression review identified these cases before packaging.

#### v0.1.16 — scheduled effort validation

- Offer only effort choices that can be stored as model settings for scheduled tasks; prompt-driven choices such as Claude Ultrathink remain available through the task prompt.
- Reject newly introduced prompt-driven option values at the host boundary and remove them when switching task models, while retaining preexisting saved options and prompt text on unrelated edits.
- Cover the Claude descriptor case with a dedicated host regression and task-editor browser assertion after independent review identified the mismatch.

#### v0.1.16 — compact task manager heading

- Remove the repeated project-name row above Tasks when the workspace exposes one project, so the heading, count and New task action begin the list directly.
- Retain the project selector when multiple projects are available, without changing task scope, session ownership or independent creation.
- Verify the single-project layout in the existing scheduled-task browser fixture; record final review and local installer verification below before packaging.

#### v0.1.21

- Match the conversation rows: two lines, hairline separators and the same relative padding, dropping a task row from up to 122px to about 34px.
- Drop the origin column from the project list, where it read "Independent task" for almost every row, and fold it into the schedule tooltip.

#### v0.1.22

- Use the same icon-only Scheduled tasks button as adjacent chat-header actions; preserve its accessible name, drawer toggle and session task count in the tooltip.

### Workspace scope

#### v0.2.0

- Recognize Git common-directory identity so a linked-worktree window shows the entire project’s conversations, worktrees and scheduled tasks. New chats may choose the open checkout; existing conversations retain their own checkout.

#### v0.0.2

- Match projects to opened folders using canonical paths, including their worktree and archived conversations.
- Allow an empty VS Code window to browse projects and start a supported projectless conversation.

#### v0.0.7

- Scope session badges and input notifications to the current workspace.

#### v0.0.8

- Resolve inline media relative to the source conversation's worktree, matching native file links.

### Independent chat views

#### v0.1.23 — same-version rebuild

Session resources retain the current History selection for restoration. Opening the previous session from the sidebar creates/reuses the correct editor, while conversation drafts remain independent.

#### v0.0.2

- Give each sidebar/editor view its own selection and draft over one shared connection.
- Keep subscriptions alive until their last view closes and preserve selections across reconnects.

#### v0.0.5

- Keep response forks and thread actions in their originating view.

#### v0.0.7

- Copy the current sidebar conversation, unsent text and references when opening an editor tab.

#### v0.0.8

- Include uploaded attachments in draft handoff and wait for pending uploads before copying them.

#### v0.0.9

- Reuse the existing editor tab when selecting an already open conversation.
- Keep the last focused editor as the reference and account-meter target when the session manager gains focus.

#### v0.1.13

- Persist text, cursor position, references and attachment bytes in extension-owned local storage across tab closure and restart; web UI drafts remain separate.
- Preserve concurrent drafts with per-view records and file leases, retain uploads through closure, and clear only the accepted sending draft.
- Keep failed first sends and offline edits recoverable, with retryable restoration after reconnect.
- Keep tab-local History selection independent from sidebar links and notifications that reveal an existing editor.

#### v0.2.2 — editor-tab copy fix

- Fix Ctrl/Cmd+C copying nothing when the conversation is opened as an editor tab instead of the sidebar. No listener, keybinding or CSS in this extension explained the difference; VS Code's own editor-tab webview panels do not forward the native copy keystroke to the OS clipboard the way the sidebar view does. Added an explicit capture-phase handler in `AssistantSelectionMenu` that, on Ctrl/Cmd+C with a non-collapsed selection inside the transcript and no input/textarea/editable field focused, copies `selection.toString()` through the existing `copyText` bridge action and prevents the default. Runs on both surfaces; harmless where native copy already works.

### Conversation management

#### v0.0.1

- Support rename, pin, archive, restore and deletion through the host's typed commands.
- Keep archived conversations discoverable and restorable.

#### v0.0.5

- Add mouse and keyboard context menus with native rename prompts and deletion confirmation.

#### v0.0.6

- Add settle/unsettle actions and compact native conversation controls.

#### v0.1.13

- Double-click the conversation title in the chat header to open the native Rename dialog; saved changes also update the session list and editor tab.

### Settled and Archive

#### v0.0.6

- Provide separate collapsible Settled and Archive sections.

#### v0.0.7

- Keep both sections in the dedicated Sessions sidebar and load archived history separately.

#### v0.1.22

- Count and classify only ordinary conversations by their own state. Subagent state never adds a parent to another shelf, so a settled row’s menu genuinely offers **Un-settle thread**.

#### v0.1.23

- Fetch archive summaries in the background after connection without expanding the section or loading archived message histories. Show a spinner only during the request; archive errors keep chat usable and offer retry. Ignore results from obsolete connections.

### Conversation search

#### v0.0.1

- Filter the available conversation list by title.

#### v0.0.6

- Use T3's native conversation index so message text matches include snippets.
- Give search a visible bordered input and retain workspace scope.

#### v0.1.22

- Keep child-only matches under their ancestors in the ordinary parent’s own shelf, without duplicate contextual parent rows.

### Find in session

#### v0.1.13

- Open search with the header icon or Ctrl/Cmd+F and navigate every occurrence with Enter, F3 or arrow buttons.
- Show one row per occurrence at chat font size and line height, removing grouped-hit navigation and standalone truncation ellipses.
- Keep query, clear, case, whole-word, count, navigation, filters, placement and close controls in one compact row.
- Keep Filters open while adjusting message/activity sources, figures/code/equations/files, context lines, order or refresh; content selections combine with OR and intersect sources.
- Scan older history and lazy command details with progress, cancellation and explicit incomplete-result errors; no image OCR or embedded-page content search.
- Reveal and highlight matches without replacing the draft or another tab’s selection, including source snippets for Markdown and LaTeX.
- Update streamed matches and retain up to 20,000 navigable occurrences with bounded context previews and pagination.
- Collapse to a floating search bar plus results disclosure without reserved pane height; the disclosure restores the last placement.
- Use the layout icon to switch Above/Side or expand directly to Side from collapse, with automatic Above fallback below 640px.
- Preserve pointer/keyboard resizing and workspace-local layout, context, order and height, without sharing queries between tabs.

#### v0.1.20

- Search a quoted message as the transcript renders it: the readable quote block is excluded and each citation reads as its quote and comment, so results, previews and occurrence order match what is on screen instead of the stored wire text.
- Expand a quote automatically when a result inside it is opened, so the match is visible rather than hidden behind the collapsed card.
- Copy a message as it reads, with quotes in readable form instead of their citation URLs.

#### v0.1.22

- Highlight all rendered matches while search is open, including message prose and code, with a stronger current occurrence; maintain highlights as virtualized rows mount and streamed text changes.
- Clear highlights when the query is cleared or search closes, honor source/content/case/word filters, and retain the existing Above/Side search panel, source-only fallback and draft state.

### Conversation status and notifications

#### v0.0.1

- Show the selected conversation's running state and pending requests.

#### v0.0.7

- Add static Working and Input/Approval badges for unopened workspace sessions.
- Deduplicate native notifications by pending request and open the affected conversation from the notification.

#### v0.0.9

- Reveal an existing session tab from the input notification instead of creating a duplicate.

#### v0.1.13

- Show Assistant · Working and the existing Stop button immediately after dispatch is accepted, before streamed output arrives.
- Keep one assistant header per run and pin only its status below the title while scrolling the active response; remove Working on terminal status.

#### v0.2.2

- Size the "Agent needs your input" card from the prompt font setting: question and option labels use the prompt size, while the heading, option descriptions and approval card body run one pixel smaller (13px by default) instead of the former 10–12px.
- Replace the single-line custom answer field with a textarea that grows with the answer up to 220px, then scrolls. Enter submits the answers as before, Shift+Enter inserts a newline, and Enter is ignored during IME composition. The card's 42vh scroll limit still applies to very long answers.
- Collapse the "Agent needs your input" card, approval card included, from its heading row to free space above the composer. The collapsed row shows the question header with its option count, or the approval's first command line, Enter or Space on the heading toggles it, and Escape inside the card collapses it. Each request remembers its own state, a new request always starts expanded, and re-expanding focuses the first answer control.

### Message navigation rail

#### v0.0.8

- Add prompt/response previews, wheel and keyboard navigation, instant jumps and a Latest action.
- Default to the left rail and offer Left, Right and Off in native Settings.
- Preserve drafts, history pagination and reading position while replies stream.

### Subagent conversations

#### v0.2.0 — local follow-up

- Worktrees uses the existing Sessions hierarchy: ordinary parent conversations contain collapsed Subagents groups, nested children retain their parent even across checkouts, and search expands matching ancestors. Tooltips retain the child's actual working directory. Checkout counts exclude subagents; orphaned subagents never become ordinary top-level rows.

#### v0.0.1

- Render typed subagent items and offer a link to their child conversation.

#### v0.0.8

- Show a compact status hover card with the provider/model, elapsed time and available progress details.
- Open the child conversation from its row and provide a Subagent of link back to the parent.
- Nest subagent sessions under their parent with collapsed branches and expand search ancestors to expose matching children.
- Retain separate Active, Settled and Archive trees with parent context for children in a different section.
- Keep provider-native child conversations read-only while app-owned children accept follow-up messages.


#### v0.1.21

- Show the working badge for a subagent whose run is driven by its parent. Its own status lags that run, so the sidebar read it as idle while the transcript card showed it running; both now share one predicate.

#### v0.1.22

- Keep active, settled and archived subagents nested beneath their ordinary parent only. Load archived descendants when expanding a session; exclude orphaned or malformed subagent lineage from main lists and counts while retaining ordinary forks as independent conversations.

#### v0.2.2

- Fix the sidebar Working badge disappearing from a parent thread while a delegated subagent (T3 `delegate_task` child thread) was still running: the server only reports each thread's own run status, so a parent whose run already completed, or whose steer run had just finished, read as idle even though the subagent it spawned kept going. The sidebar, the Worktrees list and anything else reading `threadIsWorking` now fold in any visible, non-archived, non-settled descendant subagent's working state and its earliest start time, so the badge and elapsed timer keep tracking the parent for as long as any descendant is busy. A parent that is only waiting on a descendant now reads "Waiting on subagents" instead of "Working", with the same icon and timer.

### Untouched chat cleanup

#### v0.2.0

- Retain empty conversations already bound to a worktree so failed setup can be retried. If creating parallel conversations fails before setup starts, remove only the newly created, still-untouched siblings and preserve the source draft.

#### v0.2.0 — local follow-up

- Clean up untouched worktree new-chat tabs just like root chats. New chats bind their directory immediately and publish a branch only when preparation starts, so deleting an unused chat does not qualify its checkout for T3's worktree-on-delete cleanup. Preserve typing, references, external metadata/content, other open surfaces and failed preparation attempts.

#### v0.0.8

- Delete only newly created empty conversations when their last chat surface closes.
- Preserve chats after typing, adding an attachment/reference, sending, managing the thread or opening it in another chat surface.
- Recheck durable server content and metadata before deletion, preserving external renames/pins and preexisting empty conversations.

#### v0.1.13

- Keep a rejected first send in its original unsaved composer and remove only its newly created, untouched empty thread.

## Composer and attachments

### Compact composer

#### v0.2.0

- Add the Worktree control immediately after permissions inside the message box. Select root, a new checkout, an existing checkout/branch or a pull request; use existing theme tokens, controls and typography.

#### v0.1.23 — same-version rebuild

Typed composer text uses the editor foreground for stronger contrast, while placeholder text retains its theme placeholder color.

#### v0.0.1

- Add message input and model/mode controls to sidebar and editor chat.

#### v0.0.4

- Add effort controls, permission choices and editor/assistant reference chips.

#### v0.0.5

- Use the approved compact input with plain selectors below it.

#### v0.0.6

- Keep Stop, Send and supported options accessible at narrow widths.

#### v0.0.8

- Add a paperclip button and compact removable attachment previews.

#### v0.0.9

- Dock the composer below the latest right column and allow it to expand across both columns without replacing its input or losing the draft.

#### v0.1.10

- Return the composer below the single-column transcript and remove the column expansion control.

#### v0.1.13

- Keep grouped formatting tools permanently above the input, with model/effort/mode selectors inside its bottom left.
- Keep Send fixed at the bottom right, place the existing Stop immediately left, and put keyboard hints beside those buttons.
- Wrap tool groups at narrow widths with the selected-state List assist toggle at the far right of the last toolbar row.

#### v0.1.21

- Keep native undo and redo working across programmatic edits. Pasting an image, inserting a quote, editing a quote's comment, picking a suggestion and adding an editor reference all replaced the whole message box, which destroyed its history; each is now replayed as a single edit the browser can undo.

#### v0.1.22

- Require Ctrl/Cmd+click to open a reference in the message box, and show a pointer cursor while that modifier is held. A plain click only places the caret, so a path can be edited by hand to reach a file the suggestion list cannot offer, such as a gitignored one. Previously any click jumped away, and v0.1.20 extended that to paths chosen from the `@` menu, which made it harder rather than easier.

### Markdown composer tools

#### v0.1.13

- Add a permanent, separated toolbar for emphasis (including underline), code/quotes, links/attachments, lists and indentation.
- Continue ordered, bulleted and task lists with Shift+Enter, and use Tab or Shift+Tab to indent or outdent editing contexts.
- Keep Enter send/queue, Ctrl/Cmd+Enter steer, IME input, autocomplete, image paste and native undo behavior intact.
- Keep links and backticks editable as text and preserve the List assist preference within each editor view.
- Wrap selected text with quotes, brackets, backticks and dollar signs; keep colon and semicolon as ordinary punctuation.
- Repair ordered-list numbering after structural edits, retaining list starts and nested sequences while excluding paste, fenced code and display math.
- Make immediate Undo reverse numbering repair while keeping the new line and cursor, without immediately reapplying the repair.

#### v0.1.21

- Restore undo and redo after an insertion. See [Compact composer](#compact-composer) for the mechanism.

### Context window meter

#### v0.2.2

- Add a small ring + percent to the composer's formatting toolbar, immediately left of "List assist". It reads the active thread's latest provider turn with a known context ceiling (`OrchestrationV2ProviderTurnTokenUsage`, extension docs/mockups/context-meter-options.md) and is hidden entirely until that usage is known, so a new thread or a provider that never reports it reserves no space. The ring and percent follow the existing warning/error theme colors at 55%/85% usage; the title tooltip gives exact tokens, percent and cached tokens.
- An independent regression-review agent checked the implementation and found one bug: rounding to the nearest thousand could itself reach `1000k` (e.g. 999,999 tokens) instead of rolling into the millions format; fixed by checking the rounded thousands value before choosing the `k`/`M` branch, with added test coverage around the 999.5k–999.999k boundary. No other issues were found in the band thresholds, percent rounding/clamping, tie-break ordering, prop wiring from `hostState.ts` through to `ContextMeter.tsx`, or the CSS layout/coloring.

### Slash commands and file suggestions

#### v0.2.0

- Search the selected project’s available checkouts. Same-checkout references stay relative; other checkouts use the absolute source path and an unambiguous file URI.

#### v0.0.6

- Show provider commands and skills for `/`, and workspace file/thread suggestions for `@`.
- Support keyboard selection and provider-specific model/usage command actions.

#### v0.1.20

- Insert a chosen `@` path as the same plain `@path` token the editor uses, with a removable chip, instead of a Markdown link with no reference behind it.
- Open the chosen file from its draft token, its chip or the sent message. Directories reveal in the Explorer; see [Native file links](#native-file-links).

#### v0.1.22

- Open a draft token with Ctrl/Cmd+click rather than a plain click, so a chosen path can be retyped by hand to reach a file the suggestions cannot offer. The chip and the sent message are unchanged. See [Compact composer](#compact-composer).
- Label the token with the workspace-relative path, so files that share a name stay distinguishable.

The archived [read-only file-reference investigation](archive/file-reference-investigation.md) explains directory-search limits as they stood in v0.1.16 and a proposed Tab/Enter split; those proposals are not implemented, and the cited line numbers may have drifted since.

### Queue and steer

#### v0.0.6

- Send active-run follow-ups through T3's queue/steer commands.

#### v0.0.7

- Make Enter queue and Ctrl/Cmd+Enter steer, retaining Shift+Enter for a new line.
- Fall back to queueing when the provider cannot steer.

#### v0.0.8

- Preserve uploaded attachments through both queue and steer dispatches, including image-only messages.

### Queue controls and task progress

#### v0.0.6

- Group queued follow-ups with edit, cancel, reorder and promote-to-steer controls.
- Show progress from the active run's own task plan.

#### v0.0.7

- Keep the compact queue/task layout above the composer and remove finished-run task banners.

#### v0.1.16 — source revision, installer pending

- Match the inline queued-message editor to the main composer's configurable prompt font size and line spacing, while keeping queued previews compact.
- Retain the current composer draft and queued attachments through the existing inline Save/Cancel workflow.

### Attachment presentation

#### v0.1.23 — same-version rebuild

Ctrl/Cmd+click (or Alt+Enter) on an inline image reference opens an image-caption editor with Preview, Save and Cancel. Saving changes only that reference label, preserves attachment identity and uses the composer’s native undo history; thumbnail previews remain available.

#### v0.0.1

- Display attachment names from persisted user messages.

#### v0.0.8

- Replace image-name placeholders with authenticated thumbnails in sent messages.
- Show removable draft thumbnails with upload status and expanded image previews.

#### v0.0.9

- Open floating image previews from the thumbnail itself or its inline message reference.
- Display message-owned image references in place while retaining the attached-image thumbnail strip.

#### v0.1.13

- Restore local thumbnail previews and file bytes after closing or restarting, reuploading saved bytes when needed without mixing concurrent drafts.

#### v0.1.21

- Show everything attached to a draft as one uniform chip in a single wrapping row — images, files, quotes and file references — instead of an image preview card four times the height of a quote pill. Hovering or keyboard-focusing an image chip enlarges it; clicking still opens the full preview.
- Collapse each attached file reference of a sent message into one row showing its path and a summary, expanding to the snapshot. The payload previously rendered at the same weight as the prose, so a message with two references looked several times longer than what was typed. A block is hidden only when the real send formatter reproduces it byte for byte, so nothing the user wrote can be swallowed.

### Clipboard paste and file picker

#### v0.0.8

- Attach pasted clipboard images, dropped files and files chosen through VS Code's local file picker.
- Upload bytes through T3's signed upload API and retain per-chat ownership through handoff and closure.
- Prevent attachment cleanup from racing an outgoing message dispatch.

#### v0.0.9

- Insert stable image/file references at the cursor for paste, drop and file-picker attachments.
- Send structured attachment context so the provider receives the image position within the paragraph.
- Remove an attachment’s references when removing its draft thumbnail.
- Keep existing references intact when a new attachment is inserted from a caret or selection inside a reference.

#### v0.1.13

- Retain host-owned uploads after tab closure and merge their completion only into still-present draft slots.

#### v0.1.16 — local preview

- Use selected prose as the first pasted image's description, normalizing it to a valid inline label while retaining filenames for an empty selection and later images.
- Preserve whole existing references, cursor placement, upload ownership and the description delivered to the provider; file picking and drag/drop retain their existing behavior.

#### v0.1.20

- Restore the caret in the same update that inserts a reference, rather than a frame later. Typing or moving the cursor in that frame was previously undone, so text typed immediately after a paste landed back at the insertion point. Pasted images, `@` menu picks and the attachment picker share one path.

## Message rendering

### Dense transcript spacing

#### v0.1.13

- Reduce message gaps to 8px, author gaps to 4px and paragraph gaps to 6px without changing font sizes or line height.
- Place user Copy beside its bubble, assistant Copy beside each visible message, and supported Fork at the settled run’s end.
- Display an assistant author once per run, keeping every assistant message visible between compact activity groups.
- Retain internal code, math, image and interactive-visual spacing.

#### v0.1.22

- Move each message’s Copy into its footer, align assistant actions left and user actions right, and keep the supported Fork at the settled run’s end.

### Message timestamps

#### v0.1.23 — same-version rebuild

Native Date Format and Time Format settings use dropdowns only: seven short-date examples and two time examples (4:03:22 PM / 16:03:22). Defaults are yyyy-MM-dd and 24-hour; legacy explicit automatic settings remain readable. Changes apply live to message timestamps and date/time tooltips, including search results.

#### v0.1.22

- Show the recorded start date/time in local time beside each user/assistant message’s footer actions, with seconds and a full timezone tooltip; streaming completion does not change the timestamp.
- Place assistant icons before the timestamp and user Copy after it; show “Time unavailable” when historical data has no valid time rather than inventing one.

#### v0.1.23

- Add Automatic / 12-hour / 24-hour time format in native settings, applied live across message times, tooltips, search results, task next-run dates and usage updates. Automatic retains the webview locale default; 24-hour midnight is 00.

### Streaming and progressive history

#### v0.0.1

- Render typed turn items in a virtualized timeline with streamed replies and progressive history loading.

#### v0.0.2

- Share one subscription for views of the same conversation while keeping their selections independent.

#### v0.0.4

- Restore citation source responses from earlier history.

#### v0.0.8

- Keep message-rail jumps and grouped activity compatible with virtualization and source citations.
- Resume following replies when the user manually scrolls back to the bottom.

#### v0.0.9

- Retain virtualized single-column history and keep completed reading pages fixed while the live right column grows.

#### v0.1.10

- Use the virtualized transcript at every editor size and remove the column reflow observers and positioning work.

#### v0.1.18 — local resize fix

- Clear temporary scroll-adjustment padding after width changes by comparing the browser-serialized CSS value, preventing persistent blank space below the last response.
- Pin the fix as a local LegendList 3.3.5 patch for both React module formats; preserve virtualization, history reading, expanded work and Latest navigation.

#### v0.1.18 — streaming row overlap fix

- Keep transcript rows from drawing over each other while replies stream; earlier responses with images, media or diagrams no longer overlap the next change card, question or response header.
- Keep Markdown element renderers stable so host updates no longer remount media into a loading placeholder that the virtualized list measured as the row's height; the local LegendList patch is unchanged.

### Markdown and media

#### v0.0.1

- Render Markdown, code, tables, tool output and file changes with T3-derived components.

#### v0.0.5

- Route chat file links into native VS Code editors.

#### v0.0.8

- Add sanitized raw Markdown HTML and inline images, video and audio.
- Bind local media URLs to their persisted source item through the host's asset API.

#### v0.1.13

- Render the composer’s explicit `<u>...</u>` source as sanitized underline markup.

#### v0.1.18

- Keep Markdown element renderers stable across host updates so images, video and diagrams no longer remount into loading placeholders; rendered output is unchanged.

#### v0.1.20

- Draw thematic breaks (`---`), which previously rendered as an unstyled browser default.

#### v0.1.21

- Render fenced code with a line-number gutter, an optional soft wrap and a copy button. One grid row per logical line keeps a wrapped line's single number and starts the next line below the whole wrapped block, with nothing measured; the gutter is generated content, so copying or quoting code never picks up the numbers.
- Keep each block's wrap choice while the virtualized transcript unmounts and remounts its row, and name the language in full, or Plain text for an unnamed fence.

### Collapsed activity

#### v0.0.1

- Keep individual reasoning/tool details behind disclosures.

#### v0.0.8

- Collapse consecutive reasoning and commands into one closed activity summary.
- Keep messages, requests, checkpoints, subagent rows and rendered graphics outside command summaries.

#### v0.0.9

- Prevent long command output from shrinking its command-input block below one readable line.

#### v0.1.13

- Fold only typed reasoning/tool activity into timed groups separated by assistant messages, user steers, requests and visuals.
- Keep all assistant prose visible, including partial answers and progress updates; never infer thought status from wording.
- Update late command completion in its original group and expose individual tool status/details when expanded.
- Expand matched activity groups and command details when navigating session-search results.

### Interactive HTML graphics

#### v0.0.8

- Decode T3's `html_render` attachment metadata, including responsive display heights.
- Render interactive pages in a sandboxed frame with native theme updates and reload/open actions.
- Reject visualization-frame messages at the extension bridge boundary.

### Mermaid diagrams

#### v0.0.8

- Render Mermaid fences with native theme colors and an expanded diagram preview.
- Load the diagram engine only when needed and defer unfinished streaming diagrams.

### Math rendering and copying

#### v0.0.8

- Render inline/display LaTeX, matrices and aligned equations with bundled KaTeX fonts.
- Support dollar and escaped-parenthesis/bracket delimiters while preserving code examples.
- Offer Copy LaTeX, Copy LaTeX with delimiters and Copy MathML on right-click.

#### v0.0.9

- Keep equations with their surrounding text and allow wide display equations to scroll horizontally in either layout.
- Open a floating equation preview by click or keyboard while retaining the LaTeX and MathML context menu.
- Preserve inline or display delimiters when copying LaTeX from the floating preview.

### Two-column reading

#### v0.0.9

- Flow completed conversation blocks down the left column, then the right column, before the next pair of columns.
- Fill the left reading area without reserving a blank band for the right-column composer.
- Use the editor’s dimensions and font scale to choose Auto mode, with a native 1–10 sensitivity dropdown and global Off setting.
- Retain a one-column override and composer expansion independently for each editor tab.
- Keep oversized equations and other blocks in place with scrolling instead of moving them away from their explanation.

#### v0.1.10

- Remove the two-column engine, automatic switching, per-tab override and related settings after reports of lag.
- Retain equation scrolling, previews and copying in the single-column transcript.

## Worktrees

### Worktree management

#### v0.2.0

- Built on `main` revision `e07321ee2be7912a547880cda5cc4bb77405eab6` (verified manifest **0.1.23**), on `feat/worktrees-from-main`; no code from the abandoned worktree branch is used.
- Add a Worktrees sidebar beside Sessions and Tasks without changing existing styles. Show each checkout once with its conversations and short branch label; open its folder in another VS Code window or start another conversation there.
- Create from a selected base, use an existing checkout/branch, or import a GitHub pull request through the T3 service. One to four explicit model allocations use separate checkouts; compare their files and open individual chats or native diffs.
- Bind the conversation before setup, retain a failed/cancelled preparation for retry, and wait for required setup before the first message. Store stable attempt identities to reconcile a lost creation response; retain the checkout and prompt on failure.
- Continue an idle root conversation in a new checkout with history preserved and optional copying of uncommitted files. Existing worktree conversations cannot be silently retargeted; provider-controlled subagents remain read-only.
- Review committed and local changes, apply selected files to an explicit checkout after conflict checks, and run service-backed commit/push/PR actions. Removal protects dirty/active/main checkouts and retains branch/history; a missing checkout can be restored.

#### v0.2.0 — local follow-up

- Collapse duplicate T3 project records under canonical Git common-directory groups and deduplicate checkouts. Null worktree paths resolve to their owning project root, including linked project roots. Repository-subfolder projects and symlink aliases keep their actual working directory and map to the containing physical checkout. Git submodules remain distinct; there is no recursive discovery.
- Replace the footer caption with a persistent Groups visibility picker scoped to the service/workspace. Label Main checkout, distinguish detached folders/commits, and mark the current window's checkout independently of active agents. Preserve service settings/action owners and preparation groups when repositories are combined.
- Nest subagent conversations using the Sessions hierarchy and ordinary-conversation counts. Replace the flashing loading row with the existing refresh icon's spinner; retain rows while loading. Scan periodically at the shared minute interval and promptly for checkout changes, rather than every conversation/config update.
- Allow conversations in the actual main checkout of a linked-root service project without running worktree setup there. Protect shared checkouts from removal, apply and environment cleanup when an agent from any visible service project is using them.

### Worktree environments and settings

#### v0.2.0

- Read and save all native counterparts through T3 settings: project actions, setup wait/background behavior, base/origin defaults, branch prefix, submodules, machine worktree directory and supported cleanup policies. Preserve unrelated service overrides and action metadata. Unsupported server fields are disabled rather than silently saved locally.
- Import project actions from `t3.json` explicitly. Local environment-file copying and Python profiles stay extension-owned and are shared by this extension’s windows for the same service/project.
- Support a directory or stable per-worktree Conda name, environment-file creation or cloning, custom setup and editable packages. Conversations sharing a checkout reuse its identity. Verify interpreter and editable source locations; block required setup on failure.
- Project actions and the environment terminal use an explicit Conda command helper. Agent messages include that helper; arbitrary provider shell commands are not automatically activated. Root environments are never claimed, cloned source environments are never removed, and cleanup requires ownership proof.
- T3 Web has no UI for the extension’s Python profile. Web-created checkouts can be prepared from the extension. An extension-only automatic environment cleanup setting defaults on: opening/refreshing Worktrees starts a persisted 24-hour grace period after confirmed checkout removal, then removes only owned environments on a later check. Git/parent identity, ownership, active work and shared leases are rechecked; moved, inaccessible and still-registered checkouts stay protected. Missing environments only update records. Session/branch history is retained, and older records without removal identity remain untouched. Restored checkouts reuse retained named environments or rebuild cleaned ones and rerun setup/editable verification, including when Git assigns a different administration directory.

## Providers and usage

### Models and provider instances

#### v0.0.1

- Read installed providers and model catalogs from the T3 server, including ACP instances.
- Allow model selection before the first message.

#### v0.0.4

- Apply capability-driven model options and provider-instance search.

#### v0.0.7

- Show compact provider marks and retain account identity across provider instances.

#### v0.1.16 — local preview

- Add per-instance show/hide and reorder controls to the picker, with counts based on visible models and explicitly enabled legacy models in their saved order.
- Import T3 Web's browser-local visibility and ordering explicitly, retaining server-advertised custom models, existing selections and independent drafts.
- Keep valid custom provider IDs such as `constructor` independent of inherited JavaScript object properties when looking up or editing preferences.

#### v0.1.16 — source revision, installer pending

- Remove the manual T3 Web import button, Command Palette entry, bridge action and JSON parser. Model controls store preferences only within the extension, without changing T3 Code.
- Keep existing saved visibility and ordering, server-advertised custom models and independent conversation drafts. Update the model drag mockup to match the simplified footer.

#### v0.1.16 — drag ordering

- Replace Manage models arrows with grip-only pointer/touch dragging and Alt+Up/Down. Keep hidden/legacy models reorderable without changing selection, favorites or visibility.
- Show a drag preview/insertion line, scroll near list edges and cancel on Escape, pointer cancellation, closure or catalog/filter changes. Disable ordering for partial search/Favorites lists.
- Validate the complete provider order before saving, reject stale/cross-provider destinations, retain confirmed preferences on failures and broadcast successful changes across views.
- Pass typechecking, deterministic persistence tests and the complete isolated multi-view browser suite, including mouse, touch, keyboard focus, cancellation and search guards.

### Model search and favorites

#### v0.0.4

- Add fuzzy model/provider search, favorite models and keyboard selection.

#### v0.0.7

- Retain favorites while moving appearance controls into native Settings.

#### v0.1.16 — local preview

- Apply saved visibility and ordering to provider lists, search and Favorites without altering the server catalog or current conversation.
- Import browser favorites by provider-instance identity and persist all model preferences together, preserving earlier extension favorites during migration.
- Retain the last confirmed preference snapshot during native storage writes and restore the optimistic VS Code cache on failure, including failed recovery writes.

#### v0.1.16 — source revision, installer pending

- Retain existing favorites and preference storage after removing browser import, including per-instance identity, broadcasts to other chat views and recovery after failed writes.
- Replace browser-copy instructions with the extension's local model controls. Validation is recorded below before the removal commit.

### Effort and permission controls

#### v0.2.2

- Fix Ctrl+Z losing the composer's history after choosing Claude's Ultrathink effort: the prefix was written while the effort select had focus, so the textarea was reassigned instead of edited natively. Both prefix writes now take focus first, like quote insertion does. An undo audit confirmed paste, quote, caption, reference and formatting writes still preserve history.

#### v0.0.1

- Expose provider/runtime mode choices before sending the first message.

#### v0.0.4

- Use advertised effort defaults and handle Claude's prompt-based Ultrathink option.

#### v0.0.5

- Place plain effort and permission selectors below the composer.

#### v0.0.7

- Remove the redundant delivery dropdown and preserve supported options in narrow layouts.

#### v0.1.13

- Place model, effort and permission selectors together at the bottom left inside the composer, retaining narrow overflow access.

### Account usage

#### v0.0.6

- Show T3-reported provider usage windows and reset times.

#### v0.0.7

- Start Account & Usage collapsed and add a dedicated usage editor tab.
- Keep separate subscriptions separate and deduplicate accounts sharing credentials.

#### v0.0.8

- Add Refresh and the selected account's reported update time inside Account & Usage without opening it by default.
- Keep the dedicated Usage tab's refresh action and update time.

#### v0.0.9

- Remove the separate Usage editor and its header shortcut and consolidate additional quota windows, notices and provider links in the sidebar.
- Remove the Remaining label from the Account & Usage summary.
- Open the selected account’s expanded sidebar section from its status meter or the Account & Usage command.

#### v0.1.13

- Label the existing configuration action **Status meters** without an ellipsis, preserving refresh and last-update information.

#### v0.1.21

- Halve the panel to about 186px: each meter is two lines, with the reset time as a dim suffix on the value and the bar beneath, and a window the account does not report is one line rather than two.
- Move Status meters out of its own row into an icon beside Refresh, with a deliberately different shape because it opens another view rather than acting in place.

#### v0.2.3

- List usage windows shortest to longest: session, week, model-specific weeks (e.g. Weekly Fable), month, then anything else. Previously the order was month, week, session with model-specific quotas appended after. Only reported windows are listed (so Codex shows just Week; an account reporting only model-specific weeks treats the first as its Week); when none are reported, the Session/Week/Month rows remain as “not reported” placeholders.
- Status bar meter text and tooltip follow the same order (`S · W · M`); when a general Week is reported, model-specific quotas appear only in the tooltip and sidebar.

### Status bar meters

#### v0.2.3

- Order compact meters and tooltips by Session, Week, then Month, with model-specific weekly quotas between Week and Month in the tooltip.

#### v0.0.7

- Show small provider marks with month/week/session remaining percentages.
- Allow following the focused conversation or pinning specific accounts.

#### v0.0.8

- Label windows as `M   — | W  83 | S   —%` and preserve `—` for unreported limits.

#### v0.0.9

- Open sidebar Account & Usage for the clicked meter’s account.
- Show only reported month/week/session percentages, name a single reported window in full and explain missing data on hover.
- Remove the status-bar ellipsis and point to Configure Status Meters in the Command Palette.

#### v0.1.18

- Refresh provider usage automatically once the extension connects, so meters no longer show `Usage unavailable` until a manual refresh, and again on reconnect.
- Add `t3-vscode.usage.refreshIntervalSeconds` (default 60, minimum 15; `0` disables periodic refresh) under Usage settings. Changes restart the timer immediately and the timer is disposed with the extension.

#### v0.1.19

- Keep a background refresh from delaying a message: defer any refresh that falls due while a view is sending or a live session is running, release it as soon as the host goes idle, and force one through once the meters are five intervals stale — five to six in practice, because the next tick carries jitter. Continuous work therefore never defers a refresh indefinitely. Busy never defers the first refresh after connecting, because empty meters are worth more than the wait, and a refresh already under way cannot be called back.
- Raise the `t3-vscode.usage.refreshIntervalSeconds` default from 60 to 300 seconds; an interval already set in settings is unchanged. The default was 60 when the setting was introduced in v0.1.18.
- Spread each delay with up to 20% random jitter so a fixed cadence cannot keep landing on the same keystrokes. The effective wait is therefore one to 1.2 intervals.
- Refresh only the provider instance behind a single displayed meter, preferring an installed and enabled instance of that account; sweep every instance whenever several meters are shown, because a targeted refresh advances only the instance it names. Explicit refreshes — the Account & Usage button and the provider setup check — always rediscover every instance.
- Pause automatic refreshes while no meter is displayed and hold the due refresh rather than consuming it, so the connect refresh still runs the moment a meter appears. Account & Usage, which lists every account, then updates only on its own refresh action.
- Scope the busy signal to unarchived threads, so a stale `activeRunId` on an archived session cannot defer refreshes indefinitely.
- Treat a reconnect, or a meter reappearing, as a request a completing refresh cannot satisfy, so a hung refresh never swallows the next one. An ordinary interval tick that arrives mid-refresh is still satisfied by it and never runs back to back.
- Verified against `7e19b2d` by three rounds of fresh-context regression review, which found nothing blocking; the third round reviewed the final state, including the reconnect and reappearing-meter handling, and its remaining notes are non-blocking. 222 deterministic tests, TypeScript checking and full builds pass.


#### v0.1.21

- Raise the `t3-vscode.usage.refreshIntervalSeconds` default from 300 to 600 seconds; jitter makes the real gap 600 to 720.
- Add **T3 VSCode: Refresh Usage Meters** to the command palette, which refreshes the figures now rather than waiting for the interval. It is distinct from Configure Status Meters, which only chooses which account the status bar shows.

#### v0.2.0 — local follow-up

- Inherit the shared minute-based refresh interval unless usage has an override. Preserve explicit legacy seconds settings, connection/manual refresh, displayed-account targeting, jitter and busy/staleness gates. Disabling periodic refresh drops a deferred periodic request, and large intervals cannot overflow into rapid timers.

### Shared refresh settings

#### v0.2.0 — local follow-up

- Add a 10-minute default plus nullable usage and worktree overrides under native Refresh settings. All new settings use minutes, accept fractions and apply immediately; zero disables periodic refresh. Sessions/tasks continue streaming updates, while display clocks, retries and debounces keep their existing purpose.

## VS Code integration

### Native file links

#### v0.0.1

- Provide file-open actions from chat.

#### v0.0.5

- Resolve relative paths, file URLs and line/column ranges in native editors.

#### v0.1.20

- Reveal a linked directory in the Explorer instead of failing to open it as a document. A link that names a line keeps its previous path and pays for no extra lookup.

#### v0.1.21

- Leave a web link to the webview host, which prompts before opening. The link carried both a real href and a handler calling `openExternal`, so the browser opened immediately whether or not the prompt was answered, and Cancel did nothing.

### Editor references

#### v0.2.0

- Relabel reference chips and recognized tokens when a draft’s checkout changes, keeping source URI, captured text, range and composer selection. Native file links resolve against the originating chat view.

#### v0.0.4

- Add precise editor selections with Alt+K or the editor context menu, including unsaved text.

#### v0.0.7

- Keep references targeted at the focused chat when a Usage tab is open.

#### v0.0.8

- Mark a new conversation as used as soon as a native editor reference is added.

#### v0.0.9

- Open an editor chat when no chat is available and preserve the last focused editor target while browsing sidebar usage.

#### v0.1.12

- Add Ctrl+K for selected editor text, Cmd+K on macOS, and retain Alt+K and the context-menu action.
- Insert readable file/range references at the saved prompt cursor or replace selected prompt text in the last-used open chat.
- Preserve exact unsaved source snapshots through sending, queueing, steering and draft handoff, and omit snapshots whose inline references were removed.
- Refresh repeated selections, distinguish different selections with the same line label and restore prompt focus after opening a chat.

#### v0.1.20

- Keep the `@` visible in the sent message: references now send as `[@path:12-40](uri#L12-L40)` instead of dropping the prefix.
- Accept whole-file references with no range or snapshot, so `@` menu picks and editor selections share one format.

### Assistant citations

#### v0.1.23 — same-version rebuild

The selected-text context menu fits its labels instead of reserving a 190px minimum. Enabled text uses the editor foreground; native menu selection, border and background colors remain themed.

#### v0.0.4

- Quote selected assistant text, attach optional comments and restore saved source responses.

#### v0.0.8

- Retain source lookup and rendered text selection through grouped activity and rich Markdown.

#### v0.1.11

- Insert quotes at the saved prompt cursor or replace selected prompt text without splitting existing quote or attachment references.
- Preserve source links and comments at their inline positions when sending, queueing or steering.
- Open comments from an inline reference or quote chip, and omit deleted references from the sent quote context.
- Retain quote identities across draft handoff and keep independent editor drafts separate.

#### v0.1.20

- Send the quoted text verbatim instead of backslash-escaping its punctuation. The old escaping turned `(text)` into `\(text\)`, which the Markdown math normalizer then rendered as KaTeX, so quotes appeared as run-together italics or red errors.
- Show each quote as a numbered card with the text collapsed to two lines, an expand control and a source link, replacing the repeated `Assistant quote` links and the duplicated quote block below them.
- Hide the readable quote block the message still carries for providers and other clients, which never expand `t3-citation:` links.
- Label draft tokens and chips with a preview of the quoted text, and shorten quote reference ids so the draft stays readable. The chip no longer marks an attached comment except in its tooltip.
- Collapse the runs of blank lines a quote carries when it spans blocks, and drop the leading filler a quote of a table, blockquote or loose list begins with. The collapsed card reads as one flowing paragraph so neither visible line is blank; the expanded card keeps one blank line per break and any code indentation. Done when the card renders rather than when the quote is captured: the capture is a faithful port of T3 Code's reader, and changing it stopped this client resolving whole-message quotes that the T3 app keeps producing.
- Keep a quote expanded once opened, including while the virtualized transcript unmounts and remounts its row.

#### v0.1.21

- Expand a quote automatically when a session-search result inside it is opened, and preview a message in the navigation rail as the transcript renders it rather than as the stored text.

#### v0.1.22

- Offer Copy as plain text, Copy as Markdown, Quote and Quote with comment in the response selection menu; another right-click on the same source recovers the last valid selection after an outside click clears it. Shift+F10 / the Menu key work within the transcript; unrelated or invalid selections retain their native menu, and equations retain the math menu.
- Insert a quote immediately from the menu's Quote, without the comment editor; the comment is still added later from the chip or the draft token. Quote with comment opens the editor; the floating Quote button inserts immediately.
- Rename the floating button from Cite to Quote, so the two entry points share one name.
- Preserve selected formatting, links, nested lists, tables and code when copying Markdown; retain only session-scoped citation data and revalidate the source on recovery, with no permanent quote button.

#### v0.1.23

- Remove the floating Quote button and redundant Quote with comment action. Right-click selected assistant or user text for Copy as plain text, Copy as Markdown and Quote; Quote opens the optional-comment editor, with insertion only on Save. Keep dismissal recovery and keyboard access.
- Preserve user authorship in draft storage, sent readable blocks and source links; source navigation can highlight either author’s message. Existing assistant links remain compatible.

#### v0.2.2 — Copy as Markdown escaping and spacing fix

- Fix Copy as Markdown over-escaping ordinary punctuation (`branch is deleted\. You're back on \`main\`\.`) and producing several blank lines between a short bullet list's items. The text-node escaper backslash-escaped `.`, `-`, `+`, `=`, `!`, `#` and similar characters unconditionally; it now escapes only characters that always change markdown meaning (`` \ ` * _ ~ [ ] < > ``, plus `|` inside table cells), and escapes `#`, `-`, `+` and `N.` only when they begin a markdown line, where they would otherwise read as a heading, bullet or ordered-list marker. A plain mid-sentence period, hyphen or number is left untouched.
- A rendered `<p>` always appended a trailing blank line and a following block (list, heading, blockquote) always prepended one of its own, so the two compounded; `<div>` wrappers (message body, citation-source) did the same for no markdown reason since a div carries no meaning of its own. `div` is now transparent, a `<p>` inside a `<li>` no longer adds a trailing blank, and the assembled markdown is passed through a final `collapseBlankLines` pass that flattens any remaining run of 3+ newlines to a single blank line.
- Extracted the escaping and blank-line-collapsing logic as pure, independently testable helpers (`escapeMarkdownText`, `collapseBlankLines`) in `src/shared/selectionMarkdown.ts`, since `src/webview` has no unit test glob; `selectionMarkdown.ts` keeps the DOM traversal and imports them. Added unit tests for both helpers; the "Copy as plain text" action builds its text from DOM traversal directly (not from the rendered markdown string) and was already free of this inflation.

### Response forks

#### v0.0.5

- Fork supported completed responses in the originating view using the server's capability checks.

#### v0.0.6

- Use an icon-only Fork action alongside response copying.

#### v0.1.13

- Offer one capability-gated fork after a settled run’s final content; interim assistant messages retain Copy without separate fork points.
- Keep Copy/Fork actions out of the pinned Working status header.

#### v0.1.22

- Align the existing final Copy/Fork footer left and place the response timestamp after its icons; eligibility and fork behavior are unchanged.

### Saved turn diffs

#### v0.2.2

- Show the checkpoint scope checkout's current branch beside the changed-file summary, with a tooltip explaining that Git does not record the branch at turn time.
- Show a "Merged from subagent" group in the changed-files box for files applied from another checkout via "Apply files", with a source→destination branch chip and per-file counts read from the merge patch (`git apply --numstat`, not hand-parsed). The box now also renders when a turn has merges but no checkpoint-diff files of its own. Merges are persisted per destination thread under the extension's global storage (`worktrees/merges/<hashed threadId>/records.json` plus one `.patch` file per merge) and attached to the latest turn whose checkpoint precedes the merge's timestamp. Opening a merged file shows the recorded patch read-only (no "before" snapshot is kept, so this is a fallback rather than a full diff). Limitation: merges applied before this build was installed are not recorded and so never appear.


#### v0.0.6

- Group changed files by folder and compare adjacent saved turn checkpoints.
- Open immutable before/after blobs in native diff editors, independent of HEAD and later working-file edits.

#### v0.0.9

- Compare immutable checkpoint Git refs directly instead of looking up a numbered turn pair on the server.
- Follow the saved parent checkpoint through cancelled turns, including ready baselines without a completed run.

#### v0.1.16 — Local fix, unpublished

- Save an immutable Git tree before an idle message is sent from the extension; compare the completed response against that tree, excluding manual edits made between messages even within the same file.
- List intervening manual/external edits separately from response files and line counts; show an empty response diff when only pre-existing edits were present.
- Preserve the user's index, branch and working files; retain per-message snapshots through reloads without changing the manifest version.
- Show an attribution-unavailable message with retry when no reliable start snapshot exists (including older, queued, steered or externally started responses), instead of presenting checkpoint totals as agent edits. Edits made while a response is running cannot be distinguished by these snapshots.
- Pass all 198 deterministic tests, TypeScript checking, complete production builds and the full browser fixture, including separated manual edits, empty response diffs, missing baselines and retry. Fresh-context independent regression review against `b71e129` approves the final changes with no blocking findings before local packaging. No live provider or normal VS Code/T3 state was used.

#### v0.1.17 — Marketplace prerelease

- Hide the changes box when the response has no agent changes; do not show manual-edit lists/counts, loading boxes or attribution-unavailable placeholders. Retry transient/readiness failures silently with a bounded retry.
- Render only the final checkpoint per source thread/run, keeping separate conversation rounds independent; its baseline-to-end diff covers the complete response in one expandable file list.
- Stop requesting the intervening manual-edit patch. Continue excluding pre-response edits, preserving immutable native diffs and the user's Git index.
- Use manifest version 0.1.17 with `preview: true` for the owner-authorized prerelease channel; preserve the Git-verified stable v0.1.16 baseline (`b71e129`, manifest change `9e85bbc`).
- Pass 200 deterministic tests, TypeScript checking, full production builds, all 49 feature-history links and the complete browser suite. Cover no manual/empty/loading box, one multi-file box for duplicate checkpoints, and run-only completion without changing checkpoint metadata; preserve navigation, forks and Queue/Steer behavior.
- Fresh-context independent regression review against `b71e129` found no blocking regressions; see [the prerelease publication record](publishing.md#0117-prerelease-channel-publication).

### Revert and restore

#### v0.2.2

- Review and validation: an independent regression-review agent (fresh context, compared with v0.2.1 at 0ec8b69) found two blocking issues, both fixed before packaging: `git clean -e` treats kept untracked paths as gitignore globs, so a kept file such as `weird[1].txt` was still deleted (patterns are now anchored and escaped, with a real-git test); and Copy as Markdown ran sibling `<div>` wrappers together (they separate again, relying on blank-line collapsing). Table cells no longer escape line-start markers. Typecheck, 442 tests and the full build passed afterwards. Packaged as `target-installer/t3-vscode-0.2.2.vsix`.
- Add "Edit from here" on a user message: a compact inline confirm, then a conversation-only rewind. Dispatches T3's `checkpoint.rollback` with `restoreFiles: false`, so the server never touches the working tree; the original message text returns to the composer draft. Requires `providerCanRollbackConversation` and no active run. A dimmed "N messages rewound · Restore files to this point" row stays in the transcript until a later turn completes or it is dismissed; a reported `rollbackFailure` shows inline.
- Add "Restore files to this point" on the same message, and on the rewind row above, independent of rewinding. Shows a grouped preview panel: every file touched since the checkpoint tagged `agent` and/or `you` (human/external edits, computed from `git diff` against the checkpoint and the latest agent checkpoint, plus untracked files), with a `git apply --check` dry-run verdict ("keeps cleanly" / "conflicts") for each file with your edits, a per-file "Keep mine" checkbox (checked by default) and an "Open diff" link. Restoring snapshots kept files, runs `git restore --source <checkpoint> --worktree --staged -- .` and `git clean -fd` with the kept untracked paths excluded, then re-applies each kept file's patch with `git apply --3way`. A patch that cannot 3-way merge leaves the checkpoint's version in place and writes the pre-restore bytes to `<path>.yours` instead of silently discarding them; the result row's "Compare" link opens that against the restored file. New host module `checkpointRestore.ts` does the attribution/dry-run/execute work with an injected Git runner.
- Known simplification: no Git stash is created for kept/conflicting files (building one from the isolated-index technique in `turnBaseline.ts` was judged not worth the added risk for a first pass); the pre-restore bytes under the extension's global storage and the `.yours` files are the only recovery path. Draft restore from "Edit from here" carries the message text only, not attachments or inline references.

### Conversation tab titles

#### v0.0.2

- Name chat editor tabs after the selected conversation.

#### v0.0.7

- Replace conversation titles with a static T3 VSCode tab title during the branding update.

#### v0.0.8

- Restore editor tab titles from the selected conversation and update them when it is renamed.
- Retain a distinct title for Usage tabs and a New conversation title for drafts.

### Open Web UI

#### v0.0.7

- Add globe actions that open the current local T3 conversation in the default browser.

#### v0.1.10

- Open loopback T3 browser URLs through localhost while preserving the port, selected conversation and non-loopback hosts.

## Setup and settings

### Local connection and pairing

#### v0.0.1

- Discover the local runtime, verify its process/environment, pair through the CLI and store credentials in SecretStorage.
- Reconnect through the vendored typed RPC transport.

#### v0.0.2

- Retain independent selections and shared subscriptions through reconnects.

#### v0.0.8

- Keep asset/upload credentials in the host and permit only scoped attachment/media intents.
- Accept VS Code's parent-frame message forwarding while rejecting child visualization frames.

#### v0.1.13 — onboarding revision

- Publish structured discovery and pairing diagnostics to every view and clear them after recovery without changing credential reuse or per-view selection.

#### v0.1.13 — Windows pairing revision

- Resolve Windows CLI launchers using PATH/PATHEXT and execute escaped `.cmd`/`.bat` commands through the shell, fixing `spawn t3 ENOENT` when T3 is installed as a command wrapper.
- Preserve direct execution for native executables, Linux and macOS, along with the pairing timeout, selected home, token exchange and failure classifications.
- Escape Windows command paths separately from forwarded arguments in the vendored launcher helper and record the adjustment for future vendor updates.

#### v0.1.14

- Deliver the Windows pairing revision through the Marketplace prerelease channel under a distinct version, retaining v0.1.13 on the release channel.

#### v0.1.15

- Promote the same Windows pairing runtime to the release channel after the owner confirms the v0.1.14 preview works.

### Missing-server setup

#### v0.0.1

- Report a missing local server and clarify explicitly started isolated development servers.

#### v0.0.7

- Add installation/service/manual-start links, copyable commands, Retry connection and native Settings.
- State that remote servers are not supported yet.

#### v0.1.13 — onboarding revision

- Lead with installing the CLI, opening T3 and configuring a provider; describe the background service as optional and allow service-first setup.
- Replace the invalid `t3 service start` hint with supported startup, status and restart instructions based on the actual connection failure.
- Distinguish missing/stopped servers, failed probes, protocol mismatch, a missing CLI and pairing/transport errors using host-supplied diagnostics.
- Keep copyable commands scoped to the configured home with shell quoting, preserve isolated development hints and omit normal-service instructions for custom homes.
- Open Sessions directly when ready and show provider guidance above existing sessions without a success page; retain editor conversations and drafts across reconnects.

### Settings organization

#### v0.2.0 — local follow-up

- Add the Refresh category with default, usage and worktree intervals in minutes. Hide the deprecated usage-seconds setting from the Settings UI while retaining explicitly saved values.

#### v0.0.9

- Group native settings into Appearance, Reading, Usage and Connection with stable ordering.
- Preserve existing setting keys so configured font sizes, navigation, usage accounts and server paths still apply.

#### v0.1.10

- Remove the two-column mode and sensitivity settings while keeping the Reading category for message navigation.

### Native themes and fonts

#### v0.0.1

- Use VS Code theme tokens for the chat surface.

#### v0.0.3

- Add persistent interface, prompt and code font-size controls.

#### v0.0.4

- Register font controls in native VS Code Settings.

#### v0.0.7

- Apply editor/sidebar/input colors and native fonts throughout Sessions, Chat and Usage.

#### v0.0.8

- Use the editor foreground for readable message text and the main foreground for activity labels.
- Theme inline graphics, Mermaid, math and equation menus without adding animation.

#### v0.0.9

- Keep the native settings shortcut in the session manager after removing the editor History page.

#### v0.1.13

- Match search-result text to chat font size and line height, and give entered prompt text the theme’s input foreground at full opacity.

### T3 VSCode branding

#### v0.0.7

- Rename the extension, commands, documentation and setup instructions to T3 VSCode.
- Use supplied ribbon icons for the activity bar and editor tabs.

#### v0.1.10

- Prepare alpha listing metadata, repository/support links, keywords and root license/changelog/support files.

#### v0.1.11

- Add README screenshots of the actual extension showing equations, diagrams, interactive graphics and quote comments.

#### v0.1.12

- Set the permanent Marketplace identity to `hungtienhuang.t3-vscode` using the owner-confirmed publisher.

#### v0.1.19

- Rewrite the README listing as a scannable landing page: what the extension is, the screenshot gallery, a short feature table, a three-step quick start and a compact **Scope and limitations** section, following this repository's own response-style rules.
- Move the exhaustive reference material (settings enumeration, connection diagnostics, usage meters, sessions and drafts, composer and editing, references and attachments, rendering, find in session, scheduled tasks and local VSIX installation) into the new user-facing [user guide](user-guide.md) without duplicating it in the README.
- Keep the T3 Code install/service links, the Marketplace channel banner and the Linux, local-server and remote-server caveats. Restate the specialized tool preview and interactive checkpoint restore limits as [the architecture document](t3-vscode-architecture.md) records them, and keep cross-window chat movement as unverified.
- Document the automatic usage refresh in the user guide, including the jittered interval, the deferral while a session is busy, the pause while no meter is displayed, and the single-instance target when exactly one meter is shown.
- Add four README screenshots — an agent-only response diff in VS Code's diff editor, **Find in session**, the model catalog with effort and permission controls, and the scheduled task editor — captured from the real extension in an isolated profile.
- Extend `scripts/prepare-readme-fixture.ts` with a Git-backed demo workspace and a synthetic saved turn (baseline tree, two ready checkpoints and one completed run) and `scripts/capture-readme.mjs` with the matching capture steps; no capture calls a provider.

### Isolated development and packaging

#### v0.0.1

- Add isolated Default-profile development tasks and bundle runtime dependencies and license notices into a local VSIX.

#### v0.0.3

- Put generated installers in the Git-ignored `target-installer/` directory.

#### v0.0.4

- Add native VS Code workflow checks using isolated user-data, extension and shared-data directories.

#### v0.0.8

- Include the lazy Mermaid bundle, KaTeX stylesheet, local fonts and bundled dependency notices in the VSIX.
- Add schema-validated rendering fixtures that require an isolated server to be stopped before seeding.
- Verify native graphics, actual clipboard paste, file picking, attachment delivery and untouched-chat cleanup.
- Select GPT-6 Luna with low effort for live provider tests and require an explicit model override instead of a premium fallback.

#### v0.1.10

- Mark packaged installers as Marketplace prereleases and include the project license, changelog and support information.
- Require a root license instead of bypassing the packager’s license check.

#### v0.1.11

- Capture README images in a disposable native VS Code profile using schema-validated synthetic history without provider turns.
- Include the screenshot assets in the installer and remove the separate release-label metadata and encoder.

#### v0.1.12

- Move source setup, F5 debugging, automated verification and packaging instructions into [Development and testing](development.md).
- Verify native Ctrl+K routing, saved prompt selections and unsaved source snapshots in disposable VS Code storage without provider turns.

#### v0.1.13

- Add deterministic host and browser checks for full-session search without provider calls.
- Prepare the reviewed 0.1.13 installer for the release channel with `preview: false` and no prerelease property.

#### v0.1.14

- Package the Windows pairing fix as `target-installer/t3-vscode-0.1.14.vsix` with `preview: true` and the prerelease property.

#### v0.1.15

- Package the verified preview runtime as `target-installer/t3-vscode-0.1.15.vsix` with `preview: false` and no prerelease property.

### Release versioning

#### v0.1.10

- Track major.minor.stage.build in release.json, with 0/1/2/3 denoting alpha/beta/RC/stable.
- Encode stage × 10000 + build in the Marketplace patch component and validate the manifest before packaging.
- Prepare label 0.1.0.10 as Marketplace v0.1.10 while preserving historical version entries.

#### v0.1.11

- Replace the label/encoding scheme with one package.json version used by the README, changelog, installer and Marketplace.
- Use Alpha as a stage description and keep the prerelease channel separate from the three-number version.

#### v0.1.13

- Keep version 0.1.13 for its first Marketplace release-channel publication; retain 0.1.12 as the preceding prerelease.
- Separate feature changes and onboarding into Git commits, with publication metadata in a final release commit.

#### v0.1.14

- Use the owner's authorized v0.1.14 for the Windows pairing prerelease because Marketplace requires different versions across release and prerelease channels.

#### v0.1.15

- Advance to v0.1.15 for the owner-authorized release-channel promotion, preserving the published v0.1.14 preview.

#### v0.1.16 — local packaging policy

- Keep the manifest version unchanged until the owner explicitly requests a version change; publish only the specific version/channel the owner authorizes.
- Complete task configuration, independent regression review and relevant verification before packaging; keep application changes inside the extension repository.

### Feature tracking and regression review

#### v0.0.8

- Add the linked overview table and concise per-feature version histories in this document.
- Require a separate agent with fresh context to review regressions before each VSIX is packaged.

## Release verification

### v0.0.8

- Pass 108 unit tests, TypeScript checks and JavaScript syntax checks.
- Pass deterministic browser and shared-host checks for navigation, themes, graphics, attachment drafts, subagents, usage refresh and existing conversation controls.
- Pass isolated real VS Code checks for equations/copying, the actual HTML mockup, image paste, native file picking, provider delivery, thumbnails and empty-chat cleanup.
- Pass native references/citations, conversation handoff, saved checkpoint diffs, Queue/Steer, task progress, font settings and account-usage controls.
- Reject six linked writable fixture paths without changing an external sentinel.
- Obtain a fresh-context regression audit against `3c34c58` with no blocking production regressions after resolving its findings.
- Verify the subsequent inexpensive-model test defaults without further model calls; the completed native runs used Codex before that preference changed.

### v0.0.9

- Pass 113 unit tests, TypeScript checks, bundle builds and JavaScript syntax checks.
- Pass deterministic browser and shared-host checks for reading pages, stable streaming, media resizing, navigation, independent drafts and Queue/Steer.
- Pass isolated native VS Code checks for the sessions-only sidebar, account refresh, reported-window meters, grouped settings and live font changes.
- Pass native editor references, exact saved checkpoint diffs, real provider replies, queued-message promotion and task progress.
- Pass native two-column graphics, equation copying/previews, full-height command details, image paste/picking, attachment delivery and empty-chat cleanup.
- Pass native input notifications that reveal an existing conversation tab without duplication and resume the provider after answering.
- Use GPT-6 Luna with low effort for live provider checks in an isolated T3 home and disposable VS Code profiles.
- Obtain a fresh-context regression audit against `72d60c8` with no blocking production regressions after resolving its findings.

### v0.1.10

- Pass 117 unit tests, TypeScript checks, bundle builds and JavaScript syntax checks.
- Pass deterministic browser and shared-host checks for virtualized single-column reading, streaming, wide equations, navigation, independent drafts and existing conversation controls.
- Verify native equations/copying, Mermaid, interactive HTML, command heights, image clipboard paste, file picking, provider delivery and sent thumbnails in an isolated VS Code profile.
- Pass focused native untouched-chat deletion and typed-then-cleared preservation checks after fixing the test’s Close-button selector.
- Verify localhost browser links, preserved remote hostnames, stage/build version guards, all 43 feature anchors and seven existing setting defaults.
- Use GPT-6 Luna with low effort for live provider checks and isolate T3 state, VS Code storage and the test display.
- Obtain final packaging signoff from a fresh-context regression reviewer against v0.0.8 and the preceding v0.0.9 local preview, with no blocking findings.
- Inspect the generated alpha VSIX’s prerelease marker, seven settings, bundled licenses and 20 math fonts, with no development state or source maps included.

### v0.1.11

- Pass 117 unit tests, TypeScript checks, bundle builds and JavaScript syntax checks.
- Pass deterministic UI and shared-host browser checks for quote cursor placement, selection replacement, comments, source links, independent drafts and existing Queue/Steer behavior.
- Capture three native VS Code screenshots and verify saved-cursor quote insertion, collapsed commands, light/dark themes, KaTeX, Mermaid and HTML without provider turns.
- Verify all 43 linked feature anchors and one v0.1.11 version with prerelease metadata.
- Obtain final fresh-context regression signoff against the v0.1.10 source snapshot and Git baseline `72d60c8`, with no blocking findings.
- Inspect the v0.1.11 prerelease VSIX for exact compiled bundles, three screenshot assets, seven settings, licenses and 20 math fonts.

### v0.1.12

- Pass 121 unit tests, TypeScript checks, bundle builds and JavaScript syntax checks.
- Pass deterministic UI and shared-host browser checks for inline file references, source payloads, independent drafts, quotes, attachments and Queue/Steer.
- Verify Ctrl+K in an isolated native VS Code window, including saved-cursor insertion, selection replacement, unsaved source text, cold startup and last-used chat routing.
- Retain Alt+K and verify that sidebar usage and a second chat preserve the original draft and reference target.
- Verify all 43 feature anchors and the moved documentation's local links without provider turns.
- Obtain final fresh-context regression signoff against `310a34f`, including distinct partial selections on the same source lines, with no blocking findings.
- Inspect the prerelease VSIX's identity, exact bundles, shortcuts, settings, screenshots, math fonts and licenses, then install it successfully into disposable VS Code storage.
- Publish v0.1.12 as [`hungtienhuang.t3-vscode`](https://marketplace.visualstudio.com/items?itemName=hungtienhuang.t3-vscode) on October 7, 2026, with the owner's permission and public repository links.
- Confirm the public prerelease metadata; Marketplace installation remains pending validation as of 04:22 UTC, while the local VSIX installation passed.

### v0.1.13

- The initial v0.1.13 release commits contain double-click conversation renaming and full-session search; later same-version revisions are recorded below, with worktree development kept separately and unversioned.
- Pass 127 unit tests, TypeScript checks and both extension/webview builds against the separated release source.
- Pass both deterministic browser suites, including keyboard search, older activity matches, math source, double-click renaming and preservation of independent drafts.
- Recheck existing graphics, attachments, subagents, queue/steer, references, themes and transcript navigation using the feature overview as the regression checklist.
- Verify all 44 linked feature rows and their introduction/latest-change version entries without provider calls.
- Obtain fresh-context regression signoff against `8b66b1b` with no blocking findings or worktree implementation in the release.

#### Search panel revision — same v0.1.13

- Keep the manifest and dependency versions unchanged while improving search readability and adding the approved panel controls.
- Pass 135 unit tests, TypeScript checks and the extension, webview, Mermaid and math builds.
- Pass both deterministic browser suites, including Above/Side geometry, context lines, ordering, pagination, pointer/keyboard resizing and split-match highlights.
- Verify light/dark themes, narrow fallback, workspace preference persistence, unchanged search jobs and preserved composer DOM nodes and drafts.
- Verify all 44 linked feature entries and obtain fresh-context regression signoff against `76be0b3` with no blocking findings.
- Use disposable browser profiles and fixture data without provider calls, publication or installation into the normal VS Code profile.

#### Editor controls and dense spacing revision — same v0.1.13

- Keep version 0.1.13 and preserve the pre-existing search-panel changes while adding tab History, new-chat actions and Markdown tools.
- Pass 143 unit tests, TypeScript checks and the extension, webview, Mermaid and math builds.
- Pass deterministic browser regression checks for native undo, keyboard editing, independent drafts, queue/steer, search, graphics, references, attachments, themes and virtualization.
- Verify Command Palette and header actions in separate native editor groups, local History selection, title changes and empty-chat cleanup in disposable VS Code/T3 storage.
- Verify all 48 linked feature entries and retain normal VS Code profiles and T3 data without sending provider messages.
- Obtain final fresh-context regression signoff against `76be0b3` and the saved working-tree baseline, with no blocking findings.
- Inspect the local preview VSIX's v0.1.13 prerelease identity, exact bundles, unchanged settings, three screenshots and 20 math fonts without installing or publishing it.
- Correct the stale canonical installer by copying the identical reviewed preview to `target-installer/t3-vscode-0.1.13.vsix` and preserving the superseded build under `archive/`.
- Verify that a forced same-version reinstall in disposable VS Code storage replaces both runtime bundles with the reviewed build without touching normal profiles or T3 state.

#### Composer, recovery and response refinement — same v0.1.13

- Keep version 0.1.13 and preserve the existing rename, History, new-chat and search work from `76be0b3` plus the saved pre-iteration working-tree baseline.
- Pass 157 unit tests, TypeScript checks and the extension/webview, Mermaid and math builds.
- Pass both deterministic browser suites for composer undo/numbering/wrapping, IME, references, attachments, queue/steer, occurrence filters, collapsed/Side search, matched fonts, graphics and 1,000-item virtualization.
- Verify early answers remain visible around steers, typed activity folds independently, late completions keep their original group, accepted sends show Working/Stop before output, Send stays fixed and pinned status carries no message actions.
- Verify native Command Palette/header routing in two editor groups, History, double-click renaming, untouched-chat cleanup and text/image recovery after close/reopen using disposable VS Code storage and the explicitly isolated T3 home.
- Cover process-restart recovery, failed first sends, concurrent draft leases, uploads after closure, removal during recovery and offline edits through host tests.
- Use the 48 linked feature-history entries as the regression checklist and verify their version headings against the unchanged Git release identity.
- Obtain fresh-context GPT-6 Luna regression review against `76be0b3` and the saved working-tree baseline; resolve draft/reconnect/first-send findings and receive final review with no blocking findings.
- Use deterministic fixtures for provider turns; native verification selects advertised GPT-6 Luna with low effort but sends no provider messages, and does not modify normal T3 state or VS Code profiles.
- Verify the canonical `target-installer/t3-vscode-0.1.13.vsix` against the exact built bundles, prerelease identity, 20 math fonts and three screenshots; write its SHA-256 sidecar and archive the superseded same-version previews without installing or publishing.

#### Onboarding revision — same v0.1.13

- Verify the current version from Git (`76be0b3`) and preserve the pre-existing working-tree changes using a saved baseline.
- Pass 163 deterministic unit tests, TypeScript checks and the extension/webview, Mermaid and math builds.
- Pass both browser regression suites, including failure-specific guidance, scoped copy commands, automatic Sessions, provider guidance, light/dark layouts and preserved chat drafts across reconnects.
- Confirm all 48 overview links resolve and review the connection changes against the saved baseline without changing pairing credentials, server lifecycle or editor selection behavior.
- Obtain final fresh-context regression review against `76be0b3` and the saved pre-onboarding working tree, with no blocking or actionable findings and approval for same-version packaging.
- Attempt native setup verification with isolated user, extension, shared and T3 storage; the environment has no display server and Electron’s headless mode could not expose the extension view.
- Keep version 0.1.13 for the requested local installer and retain normal VS Code profiles and T3 state without installation or publication.
- Verify the rebuilt canonical `target-installer/t3-vscode-0.1.13.vsix` contains the exact compiled bundles, unchanged manifest, prerelease marker, notices, 20 math fonts and three screenshots; retain its SHA-256 sidecar and archive the preceding same-version build.

#### Release-channel preparation — same v0.1.13

- Record eight separate feature commits, including the other session’s onboarding work, and a separate combined-regression commit without changing the reviewed runtime.
- Pass TypeScript checks for each intermediate commit, all 163 deterministic unit tests, the extension/webview/Mermaid/math builds and both complete browser suites.
- Recheck draft recovery, composer editing, queue/steer, search layouts and filters, response grouping, onboarding, graphics and virtualization using isolated fixture state without provider calls.
- Obtain final fresh-context GPT-6 Luna regression review against `76be0b3`, with no actionable blockers and explicit packaging signoff.
- Preserve prior isolated native coverage; the onboarding revision’s native display limitation remains recorded above.
- Verify publisher authentication and prepare release-only publication without changing the version or the existing prerelease.

#### Release-channel publication — v0.1.13

- Publish the reviewed package from `eaed9fe` to the Marketplace release channel on October 8, 2026 at 02:52 UTC, without uploading a prerelease.
- Confirm release-only publisher metadata and the exact VSIX SHA-256 `1145eecba0f40d00debc42023867e41584d81ea8dbc899dafa58dbd6f7007b35`, while preserving the existing 0.1.12 prerelease metadata and checksum.
- Verify local VSIX installation using isolated user, extension, shared and T3 storage; Marketplace validation and public discovery are still pending after upload.

#### Windows pairing revision — same v0.1.13

- Keep version 0.1.13 and the release-channel manifest from Git `74aed3f`, with the fix limited to CLI launching and its regression coverage.
- Pass 171 unit tests, TypeScript checks and the extension/webview, Mermaid and math builds.
- Cover Windows PATH/PATHEXT lookup, `.cmd`/`.bat` handling, escaped command paths, literal native arguments, CLI failures and timeouts with deterministic fixtures.
- Exercise a real synthetic CLI process and bearer-exchange fixture on Linux; the same test creates a real `.cmd` wrapper when run on Windows, but native Windows execution is unavailable in this environment.
- Pass both complete browser regression suites and a real isolated Linux T3 pairing, bearer exchange, WebSocket connection and session snapshot without provider turns.
- Obtain final fresh-context regression review against `74aed3f`, including the command-path escaping correction and all 48 feature requirements, with no blocking or actionable findings and approval for local packaging.
- Verify the rebuilt canonical v0.1.13 VSIX has the exact reviewed host bundle, byte-identical webview/Mermaid bundles, unchanged release manifest, 20 math fonts and three screenshots; archive the prior installer and retain the new SHA-256 sidecar without installation or publication.

### v0.1.14 — Windows pairing prerelease

- Publish the Windows pairing revision from the local v0.1.13 installer as the owner's explicitly authorized v0.1.14 preview, using release commit `74aed3f` as the regression baseline.
- Pass all 171 tests, TypeScript checking and the full extension/webview build again for v0.1.14, with no skipped tests or provider calls.
- Confirm the rebuilt host, webview and Mermaid bundles match the previously tested Windows revision byte for byte, retaining both complete browser suites and real isolated Linux CLI pairing, bearer exchange, WebSocket and session-snapshot evidence.
- Independently pass 28 focused pairing, connection-setup, discovery and view tests in fresh-context regression review; inspect all 48 linked feature requirements, credential handling and channel metadata with no blocking findings.
- Verify publisher access and the existing release-channel v0.1.13 package against its recorded SHA-256 before publication; native Windows execution remains unverified.
- Obtain the reviewer's final approval before packaging and verify the 41-file universal prerelease VSIX, its exact runtime/assets, 20 math fonts and three screenshots, followed by successful installation in disposable VS Code/T3 storage.
- Confirm the uploaded prerelease package matches SHA-256 `6bb5df730f752f82619a9ad13d1fae63753f56584618d23c6bc46914b4628b04`, and stable v0.1.13 retains its properties, update time and package checksum.
- Record Marketplace acceptance on October 8, 2026, with public validation still pending at 04:17 UTC and local VSIX installation verified; see [the publication record](publishing.md#0114-preview-channel-publication).

### v0.1.15 — Windows pairing release

- Promote the owner-confirmed v0.1.14 preview to the release channel with version and channel metadata changes only; retain `74aed3f` as the Git comparison revision and the reviewed v0.1.14 source/package hashes as the promotion baseline.
- Record the owner's successful preview test without claiming that automated native Windows tests ran in this Linux environment.
- Pass all 171 tests, TypeScript checking and the complete build again; verify the rebuilt host, webview and Mermaid bundles are byte-identical to the published v0.1.14 preview.
- Retain the earlier browser and real isolated Linux pairing verification for the identical runtime, including CLI pairing, bearer exchange, WebSocket connection and session snapshots without provider turns.
- Independently pass 56 focused pairing, setup, discovery, view and host-state tests in fresh-context regression review; inspect all 48 feature requirements and release metadata with no blocking or actionable findings.
- Obtain final review approval before packaging; verify the 41-file universal VSIX has `preview: false`, no prerelease property, exact reviewed assets, 20 math fonts and three screenshots, then install successfully in disposable VS Code/T3 storage.
- Confirm the uploaded release package matches SHA-256 `b2a4f9ef7b0058161f91b29ed8e5ccb288a2cc08fa7af3fec45caacc58b0ed72`, with existing v0.1.14 preview and v0.1.13 release properties, update times and package checksums unchanged.
- Record Marketplace acceptance on October 8, 2026 with public validation pending at 08:34 UTC; see [the publication record](publishing.md#0115-release-channel-publication).

### v0.1.16 — local installer, unpublished

- Verify the preceding manifest version v0.1.15 from Git baseline `f6af7cb`, then prepare v0.1.16 with the existing release-channel metadata for local use only.
- Commit selected-text image descriptions and model-preference import/management separately, with individual follow-up fixes for valid custom provider IDs and failed native preference writes.
- Pass all 183 deterministic tests without skips, TypeScript checking, extension/webview/Mermaid/math builds, JavaScript syntax checks and all 48 linked feature requirements.
- Pass both complete browser suites against the final runtime, including selected-image descriptions, import, hidden-model search, saved ordering, cross-chat updates, independent drafts, references, Queue/Steer, search, graphics and narrow/theme layouts.
- Independently exercise the installed VS Code Memento implementation with rejecting storage fixtures, retaining confirmed preferences through pending/failed writes, failed cache recovery and later successful saves.
- Obtain final fresh-context regression signoff for runtime `48cb69f` against `f6af7cb`, resolving both P2 findings with no remaining actionable findings before packaging.
- Use disposable deterministic fixtures and isolated T3 storage without provider calls, publication or installation into normal VS Code profiles.
- Inspect the 41-file `target-installer/t3-vscode-0.1.16.vsix` for its release identity, exact compiled assets, unchanged native settings, 20 math fonts, three screenshots and licenses, then write its SHA-256 sidecar.
- Record installer SHA-256 `acf5781622d970a8f071cd2a195615e06b2829b3908adcb121ec576d148bae86`; leave it unpublished and uninstalled.

### v0.1.16 — T3 Web import removal, installer pending

- Remove all manual import entry points and parsing code while retaining the existing preference storage format, local controls, provider-instance isolation and failed-write recovery.
- Pass all 182 deterministic tests, TypeScript checking, the complete extension/webview build and the full multi-view browser suite, including the missing-import control, local model changes and cross-tab broadcasts.
- Use fixture transports, temporary browser profiles and an explicitly isolated T3 home with no provider calls or T3 Code application changes.
- Keep manifest v0.1.16 unchanged and defer the next VSIX until task configuration is implemented and receives its required regression review; the previous installer is not rebuilt or published.

### v0.1.16 — queued-message editor font, installer pending

- Pass TypeScript checking, the webview/Mermaid/math build and the complete multi-view browser suite after matching queued editing to the configurable prompt font.
- Verify equal editor font size and line height at a custom 18 px prompt setting, unchanged compact preview text and preservation of the current composer draft.
- Use disposable browser profiles and an explicitly isolated T3 home with fixture transports; leave the installer pending task configuration implementation.

### v0.1.16 — task management rebuild verification

- Keep the manifest at v0.1.16; commit session activity (`f7d9789`), model drag ordering (`3837930`), task management (`978b807`) and task navigation recovery (`dc9ac0e`) separately with their feature documentation.
- Pass all 193 deterministic tests, TypeScript checking, complete extension/webview/Mermaid/math builds and all 49 linked feature-history anchors.
- Pass both complete browser regression suites, including pointer/touch/keyboard model ordering, task project/session scope, independent creation, 280 px editing, Save/Back/Cancel, failure retention, same-environment reconnect, native navigation events and preserved conversation model/draft.
- Pass real isolated T3 task list/subscription/create/edit checks, including disabled saves, persisted model/Low effort and one completed GPT-6 Luna Low scheduled dispatch with server attribution and saved run model selection.
- Pass real VS Code checks in disposable user-data, extension and shared-data directories, including task creation/editing from chat, independent disabled tasks, Sessions/Account & Usage commands, retained task drafts and unchanged text/image chat drafts; stop the disposable T3 server afterward.
- Resolve the independent review's three P2 findings: task drafts lost during reconnect, hidden Sessions/Usage navigation, and prompt-driven effort choices incorrectly saved as model options (`193d371`); rerun the full unit suite and task UI fixture after the final effort fix.
- Obtain final fresh-context regression signoff for runtime `193d371` against `f6af7cb`, with all three findings resolved and no remaining blockers; the reviewer independently passes the final six task tests, focused browser suite and diff checks before local packaging.
- Build the 41-file `target-installer/t3-vscode-0.1.16.vsix` (2,632,898 bytes) and verify its unchanged release manifest, exact reviewed runtime/assets, current README/changelog, licenses, 20 math fonts and three screenshots.
- Record SHA-256 `57dab245b00b29992b092c56b34a8294c63b3553b76cee8dd2e9935600970730` in the installer sidecar; leave the rebuilt installer unpublished and uninstalled.

### v0.1.16 — compact task manager rebuild verification

- Commit the redundant single-project heading removal separately as `3b171ef`, with its feature history, README, changelog and design notes updated; retain the multi-project selector and manifest v0.1.16.
- Pass TypeScript checking, the complete extension/webview/Mermaid/math build, all 49 overview links and the isolated task browser fixture, including task scope, independent creation, editor navigation/recovery, draft preservation and 280 px layout.
- Obtain fresh-context independent regression approval for runtime `3b171ef` against `0a256a3`, with no blocking findings; the reviewer checks the complete diff, fixture log, feature links, manifest and diff cleanliness before local packaging.
- Use deterministic fixtures and an explicitly isolated T3 home without provider calls or normal VS Code/T3 state changes; keep the rebuilt installer local, unpublished and uninstalled.
- Verify the 41-file v0.1.16 VSIX (2,632,978 bytes) against the reviewed bundles, unchanged host/Mermaid/math assets and manifest, current README/changelog, licenses, 20 math fonts and three screenshots.
- Record SHA-256 `b5951a6737e5b7da80f6db3d068d00eb73641cd987a7014a2e784b5ec856e672` in the installer sidecar without publication or installation.

### v0.1.16 — stable Marketplace upload

- On October 8, 2026, publish the exact reviewed `target-installer/t3-vscode-0.1.16.vsix` by explicit owner request to the stable release channel; keep version 0.1.16, omit the prerelease flag and use package SHA-256 `b5951a6737e5b7da80f6db3d068d00eb73641cd987a7014a2e784b5ec856e672`.
- Confirm `vsce` reports publication completed and the VSIX has `preview: false`; no version bump or tag was made.
- Read back Marketplace metadata after upload; at 22:55 UTC it still listed stable 0.1.15 and prerelease 0.1.14, so public validation/listing refresh for 0.1.16 remains pending and Marketplace installation is not yet verified.
- Recheck at 23:02 UTC; public Marketplace metadata now lists 0.1.16 as stable (`preview: false`) with the exact uploaded SHA-256 above, followed by stable 0.1.15 and prerelease 0.1.14.
- The uploaded VSIX's bundled changelog still says “unpublished,” reflecting its pre-authorization packaging state; the repository changelog is corrected, but replacing this immutable uploaded version would require a new version.
- Keep this exact-version/channel approval scoped to v0.1.16; future uploads still require explicit owner authorization.

### v0.1.16 — local transcript resize fix verification

- Reproduce persistent fractional bottom padding on baseline `b71e129`; add deterministic browser checks for repeated width changes, continuous divider dragging, expanded work, history reading and Latest navigation.
- Pass all 193 deterministic tests, TypeScript checking, the complete extension/webview/Mermaid/math build and the full isolated browser suite, including search/citations, streaming, independent drafts and scheduled tasks; no live provider or normal T3/VS Code state is used.
- Obtain fresh-context independent regression approval against `b71e129` after final source/test changes and successful validation, with no blocking findings; correct the focused test runner's overly broad success summary during review.
- Keep manifest v0.1.16 unchanged; this rebuild is local and does not authorize another Marketplace upload or installation.
- Build and verify the 41-file local VSIX against the reviewed bundles and changelog; record SHA-256 `3d45e2ba1010b002a88166f638a7dc0b0044015b827da68c4acef052e18239e7` in its sidecar and retain the previous installer in `target-installer/archive/`.

## Maintenance

Update the overview's introduction/latest-change versions and the affected feature's version section in the same change. Add an entry only for an actual feature change; documentation-only edits do not change the feature's introduction version. Record removed behavior explicitly and keep historical sections intact. Keep each bullet to one sentence where possible, and at most two sentences.

The packaging workflow is recorded in [AGENTS.md](../AGENTS.md). User instructions remain in [README.md](../README.md); source setup and checks are in [Development and testing](development.md), and host/webview boundaries are in [the architecture](t3-vscode-architecture.md).

### v0.1.17 — Marketplace prerelease publication

- Publish the clean source from `1666397`, compared with stable baseline `b71e129`, to the Marketplace prerelease channel on October 9, 2026, by explicit owner authorization.
- Obtain final fresh-context regression approval with no blocking findings; confirm the release candidate excludes the later resize changes.
- Pass 200 deterministic tests, TypeScript checking, full builds and the browser suite. Package and inspect the 41-file VSIX with `preview: true` and the Marketplace prerelease property.
- Record VSIX SHA-256 `4bcca3233309c4e6d395e044f61270c49fde2ef8a1f0fa0739fc2d3b83fef06f`. `vsce` reported successful publication. At 01:13 UTC on October 10, Marketplace metadata still listed stable 0.1.16 and preview 0.1.14; public listing refresh and validation remain pending.

### v0.1.18 — streaming row overlap fix verification

- Reproduce a persistent 382 px row overlap on `3c6116e` with a deterministic streaming fixture, both with and without the local LegendList patch; the resize-padding fix `5f0b1ba` did not cause it, and the remounting Markdown renderers date from rich chat rendering (`72d60c8`).
- Add `verify-streaming-layout.ts`, which fails on the baseline and passes after the fix in five consecutive focused runs; only a one-frame transient remains when a new image first loads.
- Pass all 200 deterministic tests, TypeScript checking, the full extension/webview/Mermaid/math build, `verify-views.ts` (13 PASS checks) and `verify-ui.mjs` (3 PASS checks) without a live provider or normal T3/VS Code state.
- Intermittent failures in the composer paste-caret check and the resize-while-reading-history check also reproduce on the unmodified baseline; neither involves the changed renderer.
- Obtain fresh-context independent regression approval against `3c6116e` with no blocking findings; the reviewer independently passes 200 tests, TypeScript checking and the full build, sees the streaming check pass 3/3 on HEAD and fail 3/3 on the baseline, and confirms the two intermittent failures also occur on the baseline.
- Apply the reviewer's non-blocking notes: label the resize fix as v0.1.18 and record the internal Markdown renderer change under Markdown and media.
- Build the 41-file `target-installer/t3-vscode-0.1.18.vsix` (2,635,047 bytes) with `preview: true` and the prerelease property; verify its manifest version, publisher, exact host/webview/Mermaid/math bundles, notices, 20 math fonts and three screenshots.
- Record SHA-256 `72d8c71fc7eba97893f13bd921ddd6ae014f87c4d9a658e07c1d8e9345d59156` in its sidecar; the installer is local, unpublished and uninstalled.

### v0.1.18 — release-channel publication

- Publish the reviewed 0.1.18 VSIX (`251cfec`) to the Marketplace release channel on October 10, 2026, with `preview: false` and no prerelease property; the manifest version stayed 0.1.18.
- Pass TypeScript checking and all 204 deterministic tests before packaging; SHA-256 `6745637546405b2f84330a080df0428ae907529c4d311c8252cc551938078de5`.
- Post-publish Marketplace readback showed 0.1.17 prerelease as the latest public entry, so 0.1.18 listing propagation and validation remain pending; Marketplace installation is not claimed verified.

### v0.1.18 — automatic usage refresh verification

- Add automatic usage-meter refresh (`f48d263`) on top of the reviewed 0.1.18 candidate `5600ec6`; the manifest stays v0.1.18 and nothing is published or installed.
- Obtain fresh-context independent regression approval comparing `f48d263` with `5600ec6`, with no blocking findings.
- Pass TypeScript checking and all 204 deterministic tests.
- Build the 41-file `target-installer/t3-vscode-0.1.18-usage-refresh.vsix` (2,635,894 bytes) under a distinguishable name so the reviewed `t3-vscode-0.1.18.vsix` is not overwritten.
- Record SHA-256 `50b8b73c9c67f9cb6eabd30b6d9c55075c18f5ed46d4313c34bdd97312194316` in its sidecar; the installer is local, unreleased and uninstalled.

### v0.1.22 — message footers, session sorting, quote recovery and inline search

- Rebuild at the owner-requested v0.1.22, already present in comparison revision `39759da87156b15a3c432e394bd699845db74c2c`; replace the canonical installer under `target-installer/` without publishing or installing into a normal profile.
- Pass TypeScript checking, 260 deterministic tests, the full extension/webview/Mermaid/math build, both complete browser suites (`verify-views.ts`, `verify-ui.mjs`) and the focused real-DOM Markdown-copy fixture; no live provider or normal T3/VS Code profile is used.
- Obtain final fresh-context independent regression approval against `39759da` with no remaining blockers; resolve the review’s nested-list/literal/table Markdown-copy findings and invalid-selection/keyboard-scope recovery findings before approval.
- The reviewer independently verifies focused shared tests, Markdown-copy fixtures, all/current search highlights in prose and code, streaming repaint, virtual-row removal and cleanup, and inspects the passing full-suite logs.
- Replace and inspect the 45-file canonical `target-installer/t3-vscode-0.1.22.vsix` (3,247,871 bytes), verifying v0.1.22, existing prerelease metadata, exact reviewed host/webview/Mermaid/notices bundles and the changelog after VSCE link normalization; preserve the previous installer under `target-installer/archive/`.
- Record SHA-256 `81915f06a8b4837688e50a65ce0af6e7d1c83c8ef04af0a637cf2529d9e19743` in the installer sidecar; this build is local, unpublished and uninstalled.

### v0.1.22 — stable sidebar search geometry

- Remove the dedicated Sessions container’s extra top padding and reserve an absolute clear-button slot, matching Tasks search-row height/spacing and keeping the field, editable area and action buttons stationary while typing or clearing.
- Pass TypeScript checking, 260 deterministic tests, the webview/Mermaid/math build and the full `verify-views.ts` suite, including exact geometry comparisons at 360px sidebar width and interface font size 20; existing multi-project task selectors keep their separate row.
- Obtain fresh-context independent regression approval against `32cef59` with no blocking findings; preserve compact History, sorting, native theme/font behavior and the existing v0.1.22 manifest.
- Replace the canonical v0.1.22 installer after review, retaining the previous artifact in `target-installer/archive/`; no publication or normal-profile installation is authorized.

### v0.1.22 — ordinary conversations own their shelves

- Classify each ordinary conversation once by its own state; retain subagents only beneath its tree, including search matches and archived descendants. Remove misleading Parent session duplicates and exclude children from shelf counts.
- Pass 262 deterministic tests, TypeScript checking, full builds and both documented isolated browser suites. Cover own-state Un-settle menus, child-only search and lazy archived-child discovery in compact History.
- Obtain fresh-context independent final regression approval against `21fff34` after covering archived-only compact expansion; no blocking findings remain. Keep the owner-selected v0.1.22 manifest.

### v0.1.22 — compact scheduled action and matching sidebar bands

- Use the standard Scheduled tasks header icon with the task count in its tooltip; give Settled, Archive and settings the same height as the Sessions/Tasks tab strip.
- Pass TypeScript, webview builds and both complete isolated browser suites, including 12/16/20px band equality, header icon dimensions, scoped drawer behavior and narrow layouts. Earlier subagent validation passed all 262 deterministic tests and full builds.
- Obtain fresh-context independent final approval against `fd1163a` with no blocking findings; the earlier subagent fix was independently approved against `21fff34`.
- Rebuild the owner-requested v0.1.22 canonical VSIX after approval, retaining the previous installer in `target-installer/archive/`. Preserve existing prerelease metadata; no publishing or normal-profile installation.

### v0.1.22 — stable Marketplace release

- By explicit owner authorization, prepare and publish v0.1.22 to the stable Marketplace release channel; keep the version unchanged, set `preview: false` and omit the prerelease property.
- Preserve the previously reviewed implementation and installer before preparing the stable package; only the channel metadata and release notes change.
- Fresh-context review of the exact metadata delta against `43a2d5d` approved with no blocking findings; final package review also approved the 45-file VSIX and verified runtime assets are byte-identical to the archived preview package.
- Pass package verification: embedded version `0.1.22`, publisher `hungtienhuang`, `preview: false`, no prerelease property and stable `Public` gallery flag. VSIX SHA-256 is `a69e70b331308c8197a3d3e2323ef1fa343d002b7b8f0e5e5c2ec887e06ee54e`; archived the prior prerelease artifact at `target-installer/archive/t3-vscode-0.1.22-prerelease.vsix`.
- Publish successfully on October 17 with `pnpm exec vsce publish --packagePath target-installer/t3-vscode-0.1.22.vsix` after retrying outside the restricted network sandbox. The CLI confirms `Published hungtienhuang.t3-vscode v0.1.22`. The immediate public gallery query does not yet list 0.1.22, so Marketplace validation/propagation is still pending; the uploaded package is stable.

### v0.1.23 — time preferences, selection quoting and archive startup

- Increment the owner-selected patch version from 0.1.22 (comparison revision `2d34881`) to 0.1.23; keep stable package metadata and build under `target-installer/` without publishing or normal-profile installation.
- Pass 269 deterministic tests, TypeScript checking, full host/webview builds and both complete documented isolated browser suites. Verify live time preferences, user and assistant quote menus, Markdown/plain copying, dismissal recovery, optional-comment cancel/save, draft undo and source navigation, plus archive failure/retry and stale-request guards.
- Obtain fresh-context independent final regression approval against `2d34881`; no blocking findings. Address review cleanup to numeric result formatting and restore bounded citation parsing before final verification and packaging.

### v0.1.23 — preview tabs, caption editing and date/time rebuild

- Kept manifest version **0.1.23** and stable metadata as requested; replace the canonical `target-installer/t3-vscode-0.1.23.vsix`, retaining the superseded installer under `target-installer/archive/`. This rebuild is not published or installed into the normal profile.
- Native preview/persistent session and task tabs, image caption editing, content-sized selection menus, stronger composer text, date/time example dropdowns and the strictly-over-14-day absolute session activity display are recorded under their feature sections above.
- Verification passed: **270 deterministic tests**, TypeScript, full build, complete `verify-ui.mjs` and `verify-views.ts` browser suites. Caption Preview/Save/undo and equation context menus both pass; task-tab edits survive sidebar navigation and webview reload, and Cancel leaves the saved task unchanged.
- `verify-preview-tabs.mjs` passed in real Linux VS Code using fresh user-data, extensions and shared-data directories with deterministic host fixtures and an explicitly isolated T3 home. Covered native preview replacement, promotion, existing-tab reuse, History switching/restoration and task tabs opened before initial task data. No provider calls or normal profile mutations.
- Fresh independent regression review against **57d360b** approved final code after resolving stale History resource identity, sidebar selection, restored-task loading, caption Preview/keyboard handling, image/equation stacking and timezone tooltip regressions. The final browser verification passed after review; Windows/macOS native execution was not performed.

### v0.1.23 — stable Marketplace upload

- The owner explicitly authorized public/release-channel publication and requested a low-cost delegate. GPT-6 Luna Low published the exact reviewed installer from `1330052` using `vsce publish --packagePath target-installer/t3-vscode-0.1.23.vsix`; the CLI reported successful publication.
- Published artifact SHA-256: `6faaa1b5d1acda97075d96ec024a7a64041c26ebe2669bf1a3aded18fc41755a`. No rebuild, version change or normal-profile installation was performed.
- Immediate and follow-up public Marketplace queries still returned v0.1.22 as the latest stable version. Upload is accepted; public availability/indexing remains pending. Listing: https://marketplace.visualstudio.com/items?itemName=hungtienhuang.t3-vscode.

### v0.2.0 — worktrees from main (Marketplace prerelease)

- Owner explicitly authorized version **0.2.0** for the Marketplace prerelease channel. Keep version **0.2.0** unchanged, set `preview: true`, and use a separate prerelease installer. Preserve the existing stable local installer and do not install into the normal VS Code profile.
- Fresh-context independent regression review against `main` **e07321ee** approved the final code with no remaining blockers. Fixes cover setup/retry concurrency, removal leases and service switching, persisted handoff retries, parallel draft/attachment retention and creation-failure cleanup, native async defaults, narrow layouts and provider-controlled subagent restrictions. A second fresh-context review approved the final automatic-cleanup and restoration changes after independently checking ownership, trust/activity rechecks, moved-checkout protection and Git administration-directory reuse. Existing visual styles are preserved.
- Verification passed: **377 deterministic tests**, TypeScript checking, full production builds, complete `verify-ui.mjs` and `verify-views.ts` browser suites, and the focused `verify-worktrees.mjs` browser suite. The focused UI checks include page-open/refresh cleanup triggers and the extension-only toggle. The final reviewer independently passed 38 environment/Git tests, both restoration integration cases and TypeScript; the full suite and host build passed again after the final restoration fix.
- `verify-preview-tabs.mjs` passed in real Linux VS Code with disposable user-data, extensions, shared-data and explicitly isolated T3 home directories. Existing preview/persistent session and task tabs, History identity, tab reuse and new-chat defaults remain covered. Tests use deterministic service/Conda fixtures; no live provider calls or normal-profile installation. Windows/macOS native execution and a real Conda installation were not tested.
- The owner approved automatic orphan-environment cleanup with a 24-hour grace period and an extension-only disable setting. Coverage includes grace persistence across windows, orphan records without sessions, cleanup opt-out, missing environments, leases, setting sync and restoration before/after cleanup. Separately launched external Python processes cannot all be detected; the setting can be disabled when those environments must be retained.
- Packaged `target-installer/t3-vscode-0.2.0.vsix` locally and verified its version, stable metadata, ZIP integrity and all 25 bundled distribution files against the final build. SHA-256: `b4df021acc38e20ec6ac5b0778a27babb0d462765f23f1373cae38bc01f78110`. This stable-metadata artifact is preserved. The prerelease package `target-installer/t3-vscode-0.2.0-prerelease.vsix` passed ZIP/metadata validation and its 31 bundled runtime/resource/vendor files match the stable artifact byte-for-byte. Its SHA-256 is `107e71aba85f7b10e4ca890af30a3f026d08bae92413bd8f5d3480d569bb865b`. A fresh-context reviewer approved the channel-only delta; all 590 source snapshot files remained unchanged. The authorized Marketplace prerelease upload reported success, but the October 18 public listing still showed stable 0.1.23 and prerelease 0.1.21, so propagation is pending. See the publication record for details.

### v0.2.0 — local worktree follow-up (not published)

- Preserve the published 0.2.0 artifacts and manifest version. Build the follow-up as `target-installer/t3-vscode-0.2.0-worktree-fixes.vsix`; no new publication or installation is authorized.
- Fresh-context independent regression review compared these changes with the source snapshot of the published 0.2.0 candidate. Fixed its findings for cross-checkout subagent ancestry, repository-subfolder sessions and canonical symlink grouping/header/current-window safety. Final code review approved local packaging with no remaining blockers; the reviewer independently passed 18 real-Git host, 8 grouping, 6 refresh-setting and 21 usage-scheduler tests.
- Validation passed: 402 deterministic tests, TypeScript, the full production build, broad UI and shared-host browser suites, and isolated Linux VS Code session/task preview, promotion, tab reuse and untouched root/worktree chat closure checks. After the final review fixes, host/webview builds, TypeScript, 8 grouping tests and the complete focused Worktrees browser suite passed; the canonical-window guard also passed independent host verification. Fixtures made no live provider calls and did not use the normal T3 home or VS Code profile.
- Packaged the separate 45-file local prerelease VSIX (3,304,643 bytes), verified ZIP/manifest/refresh-setting metadata and all 31 bundled runtime/resource/vendor files against the final build. SHA-256: `fcabfb90aee6ce2b0028ca8ec6d8343517f25b4ab0f447ac013191d0d53283cb`. Both original 0.2.0 artifacts retain their previous hashes. This follow-up was neither published nor installed.

### v0.2.1 — worktree fixes prerelease

- The owner requested version **0.2.1** and explicitly authorized the Marketplace prerelease channel. Carry forward the reviewed local follow-up: repository grouping and visibility, parent/subagent organization, untouched-chat cleanup and shared minute-based refresh preferences. Existing visual styles and service-backed settings behavior remain unchanged.
- Source baseline is `cfb695d`, following separate service/environment (`7eff6ad`) and sidebar/composer (`ee4c75f`) commits. This release changes version metadata and release records only. Prior validation is 402 deterministic tests, TypeScript, production builds, broad/focused browser suites and isolated Linux VS Code tab checks, with final reviewer fixes independently reverified.
- A fresh-context independent reviewer approved the version-only delta with no findings: only manifest version and release notes differ from `cfb695d`; runtime source, settings, publisher and `preview: true` are unchanged. The reviewed 0.2.0 follow-up artifact still matches its recorded SHA-256. Version and review notes were committed separately as `029b82c` before delegated packaging.
- A low-cost delegate built `target-installer/t3-vscode-0.2.1.vsix`, verified ZIP/prerelease metadata and all 31 runtime/resource/vendor assets against the reviewed 0.2.0 follow-up, then published that exact package to Marketplace prerelease. `vsce` reported successful publication. SHA-256: `dc28bf7be0d81e052d59c62577492c978a49710bca0843dce785e6eacc733672`. The October 18 public readback at approximately 23:18 UTC still listed 0.2.0 and omitted 0.2.1, so upload acceptance is confirmed while indexing remains pending. All 0.2.0 artifacts are preserved; nothing was installed into the normal VS Code profile.

### v0.2.2 — chat copy, context meter, revert and restore prerelease

- The owner explicitly authorized publishing the current tree as the next version on the Marketplace prerelease channel; the next available version is **0.2.2**. Source baseline is the single commit that follows `0ec8b69` (v0.2.1); every feature in this version is recorded under its own v0.2.2 entry above.
- Validation: TypeScript, 442 deterministic tests and the full production build passed. A fresh-context regression review compared the tree with v0.2.1 and found two blocking defects, both fixed with tests (a glob-named kept untracked file was deleted by `git clean -e`; Copy as Markdown joined sibling `<div>`s); a second fresh-context review covered those fixes before packaging.
- Packaged `target-installer/t3-vscode-0.2.2.vsix` (SHA-256 `7c411431e37630aa3db8f71d08eea64b3a2a0e5dd4dec546e696e436af5cdc68`) from `8b02ae4` and published it to the Marketplace prerelease channel on October 22, 2026 (05:34 UTC); vsce reported success. Details in docs/publishing.md.

### v0.2.3 — stable release

- Owner authorized version 0.2.3 on the stable release channel; set `preview: false`. Comparison revision `8cf4892` records the prior 0.2.2 prerelease publication.
- Fresh-context GPT-6.1 Sol regression review found no blocking code regressions; clarified documentation of the specialized-only Week fallback. The reviewer inspected the final changes and validation record and approved stable packaging with no blockers.
- TypeScript checking, all 443 deterministic tests and the full production build passed. Tests required an unrestricted local IPC socket; no live provider or normal VS Code/T3 profile was used.

- Built and verified the stable VSIX; Marketplace accepted publication on October 22, 2026. Immediate listing still showed 0.2.2, so public propagation remains pending. See [publication details](publishing.md#023-release-channel-publication).
