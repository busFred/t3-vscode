# T3 VSCode feature history

This document tracks features by release, including how later versions changed them. Versions refer to T3 VSCode, not the separate T3 Code server. Historical entries were checked against Git and the v0.0.1–v0.0.7 release documentation; v0.0.8 records the current iteration.

## Overview

| Feature name | Description | Introduced in | Last changed in |
| --- | --- | --- | --- |
| [Sessions sidebar](#sessions-sidebar) | Dedicated session manager with optional sidebar chat. | v0.0.7 | v0.0.8 |
| [Workspace scope](#workspace-scope) | Shows conversations belonging to opened folders and their worktrees. | v0.0.2 | v0.0.8 |
| [Independent chat views](#independent-chat-views) | Sidebar and editor tabs keep independent conversations and drafts. | v0.0.2 | v0.0.8 |
| [Conversation management](#conversation-management) | Rename, pin, archive, restore and delete conversations. | v0.0.1 | v0.0.6 |
| [Settled and Archive](#settled-and-archive) | Separate collapsible lists for settled and archived conversations. | v0.0.6 | v0.0.7 |
| [Conversation search](#conversation-search) | Searches native thread titles and message snippets. | v0.0.1 | v0.0.6 |
| [Conversation status and notifications](#conversation-status-and-notifications) | Shows static Working/Input badges and notifies when input is needed. | v0.0.1 | v0.0.7 |
| [Message navigation rail](#message-navigation-rail) | Previews and jumps between exchanges in the current conversation. | v0.0.8 | v0.0.8 |
| [Subagent conversations](#subagent-conversations) | Opens child conversations with status previews and a route back to the parent. | v0.0.1 | v0.0.8 |
| [Untouched chat cleanup](#untouched-chat-cleanup) | Removes newly created empty chats when their last chat surface closes. | v0.0.8 | v0.0.8 |
| [Compact composer](#compact-composer) | Compact message box with plain model, effort and permission selectors below it. | v0.0.1 | v0.0.8 |
| [Slash commands and file suggestions](#slash-commands-and-file-suggestions) | Offers provider commands, skills and workspace files while typing. | v0.0.6 | v0.0.6 |
| [Queue and steer](#queue-and-steer) | Enter queues follow-ups; Ctrl/Cmd+Enter steers supported active runs. | v0.0.6 | v0.0.8 |
| [Queue controls and task progress](#queue-controls-and-task-progress) | Edits, removes, reorders and promotes queued messages; shows current tasks. | v0.0.6 | v0.0.7 |
| [Attachment presentation](#attachment-presentation) | Shows image previews in drafts and sent messages. | v0.0.1 | v0.0.8 |
| [Clipboard paste and file picker](#clipboard-paste-and-file-picker) | Attaches clipboard images and files selected from the local machine. | v0.0.8 | v0.0.8 |
| [Streaming and progressive history](#streaming-and-progressive-history) | Streams replies through a virtualized timeline and loads older history. | v0.0.1 | v0.0.8 |
| [Markdown and media](#markdown-and-media) | Renders formatted text, code, tables, images, video and audio. | v0.0.1 | v0.0.8 |
| [Collapsed activity](#collapsed-activity) | Keeps reasoning and command sequences inside closed summaries. | v0.0.1 | v0.0.8 |
| [Interactive HTML graphics](#interactive-html-graphics) | Displays T3's inline HTML visualizations and mockups. | v0.0.8 | v0.0.8 |
| [Mermaid diagrams](#mermaid-diagrams) | Renders diagrams with native theme colors and an expanded preview. | v0.0.8 | v0.0.8 |
| [Math rendering and copying](#math-rendering-and-copying) | Renders KaTeX equations and copies LaTeX or MathML. | v0.0.8 | v0.0.8 |
| [Models and provider instances](#models-and-provider-instances) | Uses server-advertised providers and models, including ACP instances. | v0.0.1 | v0.0.7 |
| [Model search and favorites](#model-search-and-favorites) | Searches model/provider names and saves favorite models. | v0.0.4 | v0.0.7 |
| [Effort and permission controls](#effort-and-permission-controls) | Uses each model's advertised options and supported runtime modes. | v0.0.1 | v0.0.7 |
| [Account usage](#account-usage) | Displays quota windows, remaining percentages, reset times and a refresh action. | v0.0.6 | v0.0.8 |
| [Status bar meters](#status-bar-meters) | Shows provider/account usage with configurable account selection. | v0.0.7 | v0.0.8 |
| [Native file links](#native-file-links) | Opens chat-linked files and ranges in VS Code's editor. | v0.0.1 | v0.0.5 |
| [Editor references](#editor-references) | Adds editor selections to the focused chat with Alt+K. | v0.0.4 | v0.0.8 |
| [Assistant citations](#assistant-citations) | Quotes assistant text with optional comments and links to its source. | v0.0.4 | v0.0.8 |
| [Response forks](#response-forks) | Forks supported completed responses into a separate conversation. | v0.0.5 | v0.0.6 |
| [Saved turn diffs](#saved-turn-diffs) | Opens the preceding turn's saved changes in native diff editors. | v0.0.6 | v0.0.6 |
| [Conversation tab titles](#conversation-tab-titles) | Names editor tabs after their active conversations. | v0.0.2 | v0.0.8 |
| [Open Web UI](#open-web-ui) | Opens the current conversation in the system default browser. | v0.0.7 | v0.0.7 |
| [Local connection and pairing](#local-connection-and-pairing) | Discovers a running local T3 server and stores credentials in SecretStorage. | v0.0.1 | v0.0.8 |
| [Missing-server setup](#missing-server-setup) | Offers installation, service/manual startup links and Retry connection. | v0.0.1 | v0.0.7 |
| [Native themes and fonts](#native-themes-and-fonts) | Follows VS Code theme colors and exposes native font-size settings. | v0.0.1 | v0.0.8 |
| [T3 VSCode branding](#t3-vscode-branding) | Distinguishes the extension's name and icons from T3 Code. | v0.0.7 | v0.0.7 |
| [Isolated development and packaging](#isolated-development-and-packaging) | Tests in disposable profiles and produces local VSIX installers. | v0.0.1 | v0.0.8 |
| [Feature tracking and regression review](#feature-tracking-and-regression-review) | Maintains this history and requires an independent review before packaging. | v0.0.8 | v0.0.8 |

## Sessions and navigation

### Sessions sidebar

#### v0.0.7

- Make Sessions the default sidebar page and retain a separate Chat mode for smaller screens.
- Start Account & Usage collapsed so conversations get the sidebar space.

#### v0.0.8

- Preserve the active editor chat and draft while its History page is open.
- Show sessions directly below search and remove the redundant project heading and project-level New Thread button.

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

### Conversation management

#### v0.0.1

- Support rename, pin, archive, restore and deletion through the host's typed commands.
- Keep archived conversations discoverable and restorable.

#### v0.0.5

- Add mouse and keyboard context menus with native rename prompts and deletion confirmation.

#### v0.0.6

- Add settle/unsettle actions and compact native conversation controls.

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

### Conversation status and notifications

#### v0.0.1

- Show the selected conversation's running state and pending requests.

#### v0.0.7

- Add static Working and Input/Approval badges for unopened workspace sessions.
- Deduplicate native notifications by pending request and open the affected conversation from the notification.

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

### Slash commands and file suggestions

#### v0.0.6

- Show provider commands and skills for `/`, and workspace file/thread suggestions for `@`.
- Support keyboard selection and provider-specific model/usage command actions.

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

### Attachment presentation

#### v0.0.1

- Display attachment names from persisted user messages.

#### v0.0.8

- Replace image-name placeholders with authenticated thumbnails in sent messages.
- Show removable draft thumbnails with upload status and expanded image previews.

### Clipboard paste and file picker

#### v0.0.8

- Attach pasted clipboard images, dropped files and files chosen through VS Code's local file picker.
- Upload bytes through T3's signed upload API and retain per-chat ownership through handoff and closure.
- Prevent attachment cleanup from racing an outgoing message dispatch.

## Message rendering

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

### Markdown and media

#### v0.0.1

- Render Markdown, code, tables, tool output and file changes with T3-derived components.

#### v0.0.5

- Route chat file links into native VS Code editors.

#### v0.0.8

- Add sanitized raw Markdown HTML and inline images, video and audio.
- Bind local media URLs to their persisted source item through the host's asset API.

### Collapsed activity

#### v0.0.1

- Keep individual reasoning/tool details behind disclosures.

#### v0.0.8

- Collapse consecutive reasoning and commands into one closed activity summary.
- Keep messages, requests, checkpoints, subagent rows and rendered graphics outside command summaries.

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

## Providers and usage

### Models and provider instances

#### v0.0.1

- Read installed providers and model catalogs from the T3 server, including ACP instances.
- Allow model selection before the first message.

#### v0.0.4

- Apply capability-driven model options and provider-instance search.

#### v0.0.7

- Show compact provider marks and retain account identity across provider instances.

### Model search and favorites

#### v0.0.4

- Add fuzzy model/provider search, favorite models and keyboard selection.

#### v0.0.7

- Retain favorites while moving appearance controls into native Settings.

### Effort and permission controls

#### v0.0.1

- Expose provider/runtime mode choices before sending the first message.

#### v0.0.4

- Use advertised effort defaults and handle Claude's prompt-based Ultrathink option.

#### v0.0.5

- Place plain effort and permission selectors below the composer.

#### v0.0.7

- Remove the redundant delivery dropdown and preserve supported options in narrow layouts.

### Account usage

#### v0.0.6

- Show T3-reported provider usage windows and reset times.

#### v0.0.7

- Start Account & Usage collapsed and add a dedicated usage editor tab.
- Keep separate subscriptions separate and deduplicate accounts sharing credentials.

#### v0.0.8

- Add Refresh and the selected account's reported update time inside Account & Usage without opening it by default.
- Keep the dedicated Usage tab's refresh action and update time.

### Status bar meters

#### v0.0.7

- Show small provider marks with month/week/session remaining percentages.
- Allow following the focused conversation or pinning specific accounts.

#### v0.0.8

- Label windows as `M   — | W  83 | S   —%` and preserve `—` for unreported limits.

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

### Assistant citations

#### v0.0.4

- Quote selected assistant text, attach optional comments and restore saved source responses.

#### v0.0.8

- Retain source lookup and rendered text selection through grouped activity and rich Markdown.

### Response forks

#### v0.0.5

- Fork supported completed responses in the originating view using the server's capability checks.

#### v0.0.6

- Use an icon-only Fork action alongside response copying.

### Saved turn diffs

#### v0.0.6

- Group changed files by folder and compare adjacent saved turn checkpoints.
- Open immutable before/after blobs in native diff editors, independent of HEAD and later working-file edits.

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

### Missing-server setup

#### v0.0.1

- Report a missing local server and clarify explicitly started isolated development servers.

#### v0.0.7

- Add installation/service/manual-start links, copyable commands, Retry connection and native Settings.
- State that remote servers are not supported yet.

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

### T3 VSCode branding

#### v0.0.7

- Rename the extension, commands, documentation and setup instructions to T3 VSCode.
- Use supplied ribbon icons for the activity bar and editor tabs.

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

## Maintenance

Update the overview's introduction/latest-change versions and the affected feature's version section in the same change. Add an entry only for an actual feature change; documentation-only edits do not change the feature's introduction version. Record removed behavior explicitly and keep historical sections intact. Keep each bullet to one sentence where possible, and at most two sentences.

The packaging workflow is recorded in [AGENTS.md](../AGENTS.md). Current setup and commands remain in [README.md](../README.md); the host/webview boundaries are in [the architecture](t3-vscode-architecture.md).
