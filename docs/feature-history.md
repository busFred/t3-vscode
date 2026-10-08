# T3 VSCode feature history

This document tracks features by release, including how later versions changed them. Versions refer to T3 VSCode, not the separate T3 Code server. Historical entries were checked against Git and the v0.0.1–v0.0.7 release documentation; v0.0.9, v0.1.10 and v0.1.11 were local previews, and v0.1.12 is the first Marketplace alpha prerelease; v0.1.13 is published on the release channel, with same-version revisions including double-click renaming, session search, tab History, new-chat actions, Markdown composer tools, durable draft recovery, occurrence search filters, dense transcript spacing with visible assistant messages and connection onboarding that opens Sessions automatically. The Windows pairing fix was published as prerelease v0.1.14 and promoted to release v0.1.15 after the owner confirmed the preview works.

The v0.1.16 revision includes selected-text image descriptions, local model management with drag ordering, compact session activity, scheduled-task navigation/configuration and readable queued-message editing; it removes manual T3 Web import. The Git release baseline is `f6af7cb` (manifest v0.1.15). Keep the manifest at v0.1.16; the owner has specifically authorized its stable-channel publication, without granting standing authorization for other versions or channels. See the release verification entries below for the earlier installer and same-version rebuilds.

## Overview

| Feature name | Description | Introduced in | Last changed in |
| --- | --- | --- | --- |
| [Sessions sidebar](#sessions-sidebar) | Session manager with compact last-active times and chat in editor tabs. | v0.0.7 | v0.1.16 |
| [Scheduled task management](#scheduled-task-management) | Compact project/session task lists, a multi-project selector and an independent model/effort editor in the sidebar. | v0.1.16 | v0.1.16 |
| [Workspace scope](#workspace-scope) | Shows conversations belonging to opened workspace folders. | v0.0.2 | v0.0.8 |
| [Independent chat views](#independent-chat-views) | Independent tab drafts with local recovery for text, references and attachments. | v0.0.2 | v0.1.13 |
| [Conversation management](#conversation-management) | Rename, pin, archive, restore and delete conversations. | v0.0.1 | v0.1.13 |
| [Settled and Archive](#settled-and-archive) | Separate collapsible lists for settled and archived conversations. | v0.0.6 | v0.0.7 |
| [Conversation search](#conversation-search) | Searches native thread titles and message snippets. | v0.0.1 | v0.0.6 |
| [Find in session](#find-in-session) | Full-history occurrence search, persistent filters and collapsible Above/Side results. | v0.1.13 | v0.1.13 |
| [Conversation status and notifications](#conversation-status-and-notifications) | Immediate accepted-send status, pinned Working header and input notifications. | v0.0.1 | v0.1.13 |
| [Message navigation rail](#message-navigation-rail) | Previews and jumps between exchanges in the current conversation. | v0.0.8 | v0.0.8 |
| [Subagent conversations](#subagent-conversations) | Opens child conversations with status previews and a route back to the parent. | v0.0.1 | v0.0.8 |
| [Untouched chat cleanup](#untouched-chat-cleanup) | Removes untouched new chats and rejected first-send threads. | v0.0.8 | v0.1.13 |
| [Compact composer](#compact-composer) | Permanent toolbar and compact controls inside the message box. | v0.0.1 | v0.1.13 |
| [Slash commands and file suggestions](#slash-commands-and-file-suggestions) | Offers provider commands, skills and workspace files while typing. | v0.0.6 | v0.0.6 |
| [Queue and steer](#queue-and-steer) | Enter queues follow-ups; Ctrl/Cmd+Enter steers supported active runs. | v0.0.6 | v0.0.8 |
| [Queue controls and task progress](#queue-controls-and-task-progress) | Edits queued text at the prompt font size; reorders follow-ups and shows current tasks. | v0.0.6 | v0.1.16 |
| [Attachment presentation](#attachment-presentation) | Draft and sent previews with local recovery after closure. | v0.0.1 | v0.1.13 |
| [Clipboard paste and file picker](#clipboard-paste-and-file-picker) | Image paste uses selected words as its description; local uploads survive tab closure. | v0.0.8 | v0.1.16 |
| [Streaming and progressive history](#streaming-and-progressive-history) | Streams replies through a virtualized timeline and loads older history. | v0.0.1 | v0.1.10 |
| [Markdown and media](#markdown-and-media) | Formatted text, code, underline, tables, images, video and audio. | v0.0.1 | v0.1.13 |
| [Collapsed activity](#collapsed-activity) | Timed thought/tool groups separated by visible assistant messages and steers. | v0.0.1 | v0.1.13 |
| [Interactive HTML graphics](#interactive-html-graphics) | Displays T3's inline HTML visualizations and mockups. | v0.0.8 | v0.0.8 |
| [Mermaid diagrams](#mermaid-diagrams) | Renders diagrams with native theme colors and an expanded preview. | v0.0.8 | v0.0.8 |
| [Two-column reading](#two-column-reading) | Removed in v0.1.10 after performance feedback. | v0.0.9 | v0.1.10 |
| [Math rendering and copying](#math-rendering-and-copying) | Renders KaTeX with scrolling, floating previews and copy actions. | v0.0.8 | v0.0.9 |
| [Models and provider instances](#models-and-provider-instances) | Server catalogs with per-instance visibility and drag ordering saved in VS Code. | v0.0.1 | v0.1.16 |
| [Model search and favorites](#model-search-and-favorites) | Searches visible models and saves favorites independently in VS Code. | v0.0.4 | v0.1.16 |
| [Effort and permission controls](#effort-and-permission-controls) | Advertised model options and runtime modes inside the composer. | v0.0.1 | v0.1.13 |
| [Account usage](#account-usage) | Collapsed sidebar limits, refresh time and Status meters action. | v0.0.6 | v0.1.13 |
| [Status bar meters](#status-bar-meters) | Shows provider/account usage with configurable account selection. | v0.0.7 | v0.0.9 |
| [Native file links](#native-file-links) | Opens chat-linked files and ranges in VS Code's editor. | v0.0.1 | v0.0.5 |
| [Editor references](#editor-references) | Inserts selected file ranges at the last-used chat's prompt cursor with Ctrl/Cmd+K or Alt+K. | v0.0.4 | v0.1.12 |
| [Assistant citations](#assistant-citations) | Inserts assistant quotes at the prompt cursor with comments and source links. | v0.0.4 | v0.1.11 |
| [Response forks](#response-forks) | One supported fork at the end of each settled assistant run. | v0.0.5 | v0.1.13 |
| [Saved turn diffs](#saved-turn-diffs) | Opens the preceding turn's saved changes in native diff editors. | v0.0.6 | v0.0.9 |
| [Conversation tab titles](#conversation-tab-titles) | Names editor tabs after their active conversations. | v0.0.2 | v0.0.8 |
| [Open Web UI](#open-web-ui) | Opens the current conversation in the system default browser. | v0.0.7 | v0.1.10 |
| [Local connection and pairing](#local-connection-and-pairing) | Discovers and pairs with a local server, supports Windows CLI launchers and reports the failed connection stage. | v0.0.1 | v0.1.15 |
| [Missing-server setup](#missing-server-setup) | Guides first connection, distinguishes failures and opens Sessions directly; background service is optional. | v0.0.1 | v0.1.13 |
| [Settings organization](#settings-organization) | Groups native settings into Appearance, Reading, Usage and Connection. | v0.0.9 | v0.1.10 |
| [Native themes and fonts](#native-themes-and-fonts) | Theme foregrounds and equal chat/search typography. | v0.0.1 | v0.1.13 |
| [T3 VSCode branding](#t3-vscode-branding) | Extension identity, listing metadata and screenshots of the native UI. | v0.0.7 | v0.1.12 |
| [Isolated development and packaging](#isolated-development-and-packaging) | Tests in disposable profiles and produces channel-specific VSIX installers. | v0.0.1 | v0.1.15 |
| [Release versioning](#release-versioning) | Keeps the owner-selected version and publishes only a specifically authorized version/channel. | v0.1.10 | v0.1.16 |
| [Feature tracking and regression review](#feature-tracking-and-regression-review) | Maintains this history and requires an independent review before packaging. | v0.0.8 | v0.0.8 |
| [Tab History](#tab-history) | Searchable conversation switching within each editor tab. | v0.1.13 | v0.1.13 |
| [New chat editor actions](#new-chat-editor-actions) | Fresh chat tabs from the Command Palette, header and sidebar. | v0.1.13 | v0.1.13 |
| [Markdown composer tools](#markdown-composer-tools) | Literal formatting, selection wrapping, automatic numbering, indentation and undo. | v0.1.13 | v0.1.13 |
| [Dense transcript spacing](#dense-transcript-spacing) | Compact gaps, one author per run and unobtrusive message actions. | v0.1.13 | v0.1.13 |

## Sessions and navigation

### Tab History

#### v0.1.13

- Add a default-closed, searchable History picker to each editor tab with workspace sessions, status badges and nested subagents.
- Switch only the originating tab while retaining its conversation drafts and keeping Settled and Archive separate.
- Support keyboard navigation, Escape and outside-click dismissal in narrow editor groups.

### New chat editor actions

#### v0.1.13

- Make **Open New Chat in Editor Tab**, the chat-header plus and the sidebar New button create separate conversations and tabs.
- Create Command Palette chats in the active editor group and header-triggered chats in their originating group.
- Preserve existing tabs, drafts, attachment ownership and current-conversation links while removing untouched new chats when closed.


### Sessions sidebar

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

### Scheduled task management

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

### Workspace scope

#### v0.0.2

- Match projects to opened folders using canonical paths, including their worktree and archived conversations.
- Allow an empty VS Code window to browse projects and start a supported projectless conversation.

#### v0.0.7

- Scope session badges and input notifications to the current workspace.

#### v0.0.8

- Resolve inline media relative to the source conversation's worktree, matching native file links.

### Independent chat views

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

### Conversation search

#### v0.0.1

- Filter the available conversation list by title.

#### v0.0.6

- Use T3's native conversation index so message text matches include snippets.
- Give search a visible bordered input and retain workspace scope.

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

### Message navigation rail

#### v0.0.8

- Add prompt/response previews, wheel and keyboard navigation, instant jumps and a Latest action.
- Default to the left rail and offer Left, Right and Off in native Settings.
- Preserve drafts, history pagination and reading position while replies stream.

### Subagent conversations

#### v0.0.1

- Render typed subagent items and offer a link to their child conversation.

#### v0.0.8

- Show a compact status hover card with the provider/model, elapsed time and available progress details.
- Open the child conversation from its row and provide a Subagent of link back to the parent.
- Nest subagent sessions under their parent with collapsed branches and expand search ancestors to expose matching children.
- Retain separate Active, Settled and Archive trees with parent context for children in a different section.
- Keep provider-native child conversations read-only while app-owned children accept follow-up messages.


### Untouched chat cleanup

#### v0.0.8

- Delete only newly created empty conversations when their last chat surface closes.
- Preserve chats after typing, adding an attachment/reference, sending, managing the thread or opening it in another chat surface.
- Recheck durable server content and metadata before deletion, preserving external renames/pins and preexisting empty conversations.

#### v0.1.13

- Keep a rejected first send in its original unsaved composer and remove only its newly created, untouched empty thread.

## Composer and attachments

### Compact composer

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

### Markdown composer tools

#### v0.1.13

- Add a permanent, separated toolbar for emphasis (including underline), code/quotes, links/attachments, lists and indentation.
- Continue ordered, bulleted and task lists with Shift+Enter, and use Tab or Shift+Tab to indent or outdent editing contexts.
- Keep Enter send/queue, Ctrl/Cmd+Enter steer, IME input, autocomplete, image paste and native undo behavior intact.
- Keep links and backticks editable as text and preserve the List assist preference within each editor view.
- Wrap selected text with quotes, brackets, backticks and dollar signs; keep colon and semicolon as ordinary punctuation.
- Repair ordered-list numbering after structural edits, retaining list starts and nested sequences while excluding paste, fenced code and display math.
- Make immediate Undo reverse numbering repair while keeping the new line and cursor, without immediately reapplying the repair.

### Slash commands and file suggestions

#### v0.0.6

- Show provider commands and skills for `/`, and workspace file/thread suggestions for `@`.
- Support keyboard selection and provider-specific model/usage command actions.

The [read-only file-reference investigation](file-reference-investigation.md) explains current directory-search limits and the proposed Tab/Enter split; those proposals are not implemented.

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

## Message rendering

### Dense transcript spacing

#### v0.1.13

- Reduce message gaps to 8px, author gaps to 4px and paragraph gaps to 6px without changing font sizes or line height.
- Place user Copy beside its bubble, assistant Copy beside each visible message, and supported Fork at the settled run’s end.
- Display an assistant author once per run, keeping every assistant message visible between compact activity groups.
- Retain internal code, math, image and interactive-visual spacing.


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

### Status bar meters

#### v0.0.7

- Show small provider marks with month/week/session remaining percentages.
- Allow following the focused conversation or pinning specific accounts.

#### v0.0.8

- Label windows as `M   — | W  83 | S   —%` and preserve `—` for unreported limits.

#### v0.0.9

- Open sidebar Account & Usage for the clicked meter’s account.
- Show only reported month/week/session percentages, name a single reported window in full and explain missing data on hover.
- Remove the status-bar ellipsis and point to Configure Status Meters in the Command Palette.

## VS Code integration

### Native file links

#### v0.0.1

- Provide file-open actions from chat.

#### v0.0.5

- Resolve relative paths, file URLs and line/column ranges in native editors.

### Editor references

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

### Assistant citations

#### v0.0.4

- Quote selected assistant text, attach optional comments and restore saved source responses.

#### v0.0.8

- Retain source lookup and rendered text selection through grouped activity and rich Markdown.

#### v0.1.11

- Insert quotes at the saved prompt cursor or replace selected prompt text without splitting existing quote or attachment references.
- Preserve source links and comments at their inline positions when sending, queueing or steering.
- Open comments from an inline reference or quote chip, and omit deleted references from the sent quote context.
- Retain quote identities across draft handoff and keep independent editor drafts separate.

### Response forks

#### v0.0.5

- Fork supported completed responses in the originating view using the server's capability checks.

#### v0.0.6

- Use an icon-only Fork action alongside response copying.

#### v0.1.13

- Offer one capability-gated fork after a settled run’s final content; interim assistant messages retain Copy without separate fork points.
- Keep Copy/Fork actions out of the pinned Working status header.

### Saved turn diffs

#### v0.0.6

- Group changed files by folder and compare adjacent saved turn checkpoints.
- Open immutable before/after blobs in native diff editors, independent of HEAD and later working-file edits.

#### v0.0.9

- Compare immutable checkpoint Git refs directly instead of looking up a numbered turn pair on the server.
- Follow the saved parent checkpoint through cancelled turns, including ready baselines without a completed run.

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

## Maintenance

Update the overview's introduction/latest-change versions and the affected feature's version section in the same change. Add an entry only for an actual feature change; documentation-only edits do not change the feature's introduction version. Record removed behavior explicitly and keep historical sections intact. Keep each bullet to one sentence where possible, and at most two sentences.

The packaging workflow is recorded in [AGENTS.md](../AGENTS.md). User instructions remain in [README.md](../README.md); source setup and checks are in [Development and testing](development.md), and host/webview boundaries are in [the architecture](t3-vscode-architecture.md).
