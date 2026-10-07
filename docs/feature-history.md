# T3 VSCode feature history

This document tracks features by release, including how later versions changed them. Versions refer to T3 VSCode, not the separate T3 Code server. Historical entries were checked against Git and the v0.0.1–v0.0.7 release documentation; v0.0.9, v0.1.10 and v0.1.11 were local previews, and v0.1.12 is the first Marketplace alpha prerelease.

## Overview

| Feature name | Description | Introduced in | Last changed in |
| --- | --- | --- | --- |
| [Sessions sidebar](#sessions-sidebar) | Session manager with chat in editor tabs. | v0.0.7 | v0.0.9 |
| [Workspace scope](#workspace-scope) | Shows conversations belonging to opened workspace folders. | v0.0.2 | v0.0.8 |
| [Independent chat views](#independent-chat-views) | Editor tabs keep independent conversations and drafts. | v0.0.2 | v0.0.9 |
| [Conversation management](#conversation-management) | Rename, pin, archive, restore and delete conversations. | v0.0.1 | v0.0.6 |
| [Settled and Archive](#settled-and-archive) | Separate collapsible lists for settled and archived conversations. | v0.0.6 | v0.0.7 |
| [Conversation search](#conversation-search) | Searches native thread titles and message snippets. | v0.0.1 | v0.0.6 |
| [Conversation status and notifications](#conversation-status-and-notifications) | Shows static Working/Input badges and notifies when input is needed. | v0.0.1 | v0.0.9 |
| [Message navigation rail](#message-navigation-rail) | Previews and jumps between exchanges in the current conversation. | v0.0.8 | v0.0.8 |
| [Subagent conversations](#subagent-conversations) | Opens child conversations with status previews and a route back to the parent. | v0.0.1 | v0.0.8 |
| [Untouched chat cleanup](#untouched-chat-cleanup) | Removes newly created empty chats when their last chat surface closes. | v0.0.8 | v0.0.8 |
| [Compact composer](#compact-composer) | Compact prompt controls below the single-column transcript. | v0.0.1 | v0.1.10 |
| [Slash commands and file suggestions](#slash-commands-and-file-suggestions) | Offers provider commands, skills and workspace files while typing. | v0.0.6 | v0.0.6 |
| [Queue and steer](#queue-and-steer) | Enter queues follow-ups; Ctrl/Cmd+Enter steers supported active runs. | v0.0.6 | v0.0.8 |
| [Queue controls and task progress](#queue-controls-and-task-progress) | Edits, removes, reorders and promotes queued messages; shows current tasks. | v0.0.6 | v0.0.7 |
| [Attachment presentation](#attachment-presentation) | Draft and sent previews with image references in message text. | v0.0.1 | v0.0.9 |
| [Clipboard paste and file picker](#clipboard-paste-and-file-picker) | Attaches clipboard images and files selected from the local machine. | v0.0.8 | v0.0.9 |
| [Streaming and progressive history](#streaming-and-progressive-history) | Streams replies through a virtualized timeline and loads older history. | v0.0.1 | v0.1.10 |
| [Markdown and media](#markdown-and-media) | Renders formatted text, code, tables, images, video and audio. | v0.0.1 | v0.0.8 |
| [Collapsed activity](#collapsed-activity) | Keeps reasoning and command sequences inside closed summaries. | v0.0.1 | v0.0.9 |
| [Interactive HTML graphics](#interactive-html-graphics) | Displays T3's inline HTML visualizations and mockups. | v0.0.8 | v0.0.8 |
| [Mermaid diagrams](#mermaid-diagrams) | Renders diagrams with native theme colors and an expanded preview. | v0.0.8 | v0.0.8 |
| [Two-column reading](#two-column-reading) | Removed in v0.1.10 after performance feedback. | v0.0.9 | v0.1.10 |
| [Math rendering and copying](#math-rendering-and-copying) | Renders KaTeX with scrolling, floating previews and copy actions. | v0.0.8 | v0.0.9 |
| [Models and provider instances](#models-and-provider-instances) | Uses server-advertised providers and models, including ACP instances. | v0.0.1 | v0.0.7 |
| [Model search and favorites](#model-search-and-favorites) | Searches model/provider names and saves favorite models. | v0.0.4 | v0.0.7 |
| [Effort and permission controls](#effort-and-permission-controls) | Uses each model's advertised options and supported runtime modes. | v0.0.1 | v0.0.7 |
| [Account usage](#account-usage) | Collapsed sidebar limits, reset times, notices and refresh. | v0.0.6 | v0.0.9 |
| [Status bar meters](#status-bar-meters) | Shows provider/account usage with configurable account selection. | v0.0.7 | v0.0.9 |
| [Native file links](#native-file-links) | Opens chat-linked files and ranges in VS Code's editor. | v0.0.1 | v0.0.5 |
| [Editor references](#editor-references) | Inserts selected file ranges at the last-used chat's prompt cursor with Ctrl/Cmd+K or Alt+K. | v0.0.4 | v0.1.12 |
| [Assistant citations](#assistant-citations) | Inserts assistant quotes at the prompt cursor with comments and source links. | v0.0.4 | v0.1.11 |
| [Response forks](#response-forks) | Forks supported completed responses into a separate conversation. | v0.0.5 | v0.0.6 |
| [Saved turn diffs](#saved-turn-diffs) | Opens the preceding turn's saved changes in native diff editors. | v0.0.6 | v0.0.9 |
| [Conversation tab titles](#conversation-tab-titles) | Names editor tabs after their active conversations. | v0.0.2 | v0.0.8 |
| [Open Web UI](#open-web-ui) | Opens the current conversation in the system default browser. | v0.0.7 | v0.1.10 |
| [Local connection and pairing](#local-connection-and-pairing) | Discovers a running local T3 server and stores credentials in SecretStorage. | v0.0.1 | v0.0.8 |
| [Missing-server setup](#missing-server-setup) | Offers installation, service/manual startup links and Retry connection. | v0.0.1 | v0.0.7 |
| [Settings organization](#settings-organization) | Groups native settings into Appearance, Reading, Usage and Connection. | v0.0.9 | v0.1.10 |
| [Native themes and fonts](#native-themes-and-fonts) | Follows VS Code theme colors and exposes native font-size settings. | v0.0.1 | v0.0.9 |
| [T3 VSCode branding](#t3-vscode-branding) | Extension identity, listing metadata and screenshots of the native UI. | v0.0.7 | v0.1.12 |
| [Isolated development and packaging](#isolated-development-and-packaging) | Tests in disposable profiles and produces prerelease VSIX installers. | v0.0.1 | v0.1.12 |
| [Release versioning](#release-versioning) | Uses one three-number version everywhere with Alpha as a stage description. | v0.1.10 | v0.1.11 |
| [Feature tracking and regression review](#feature-tracking-and-regression-review) | Maintains this history and requires an independent review before packaging. | v0.0.8 | v0.0.8 |

## Sessions and navigation

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

#### v0.0.9

- Reveal an existing session tab from the input notification instead of creating a duplicate.

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

#### v0.0.9

- Dock the composer below the latest right column and allow it to expand across both columns without replacing its input or losing the draft.

#### v0.1.10

- Return the composer below the single-column transcript and remove the column expansion control.

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

#### v0.0.9

- Open floating image previews from the thumbnail itself or its inline message reference.
- Display message-owned image references in place while retaining the attached-image thumbnail strip.

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

### Collapsed activity

#### v0.0.1

- Keep individual reasoning/tool details behind disclosures.

#### v0.0.8

- Collapse consecutive reasoning and commands into one closed activity summary.
- Keep messages, requests, checkpoints, subagent rows and rendered graphics outside command summaries.

#### v0.0.9

- Prevent long command output from shrinking its command-input block below one readable line.

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

#### v0.0.9

- Remove the separate Usage editor and its header shortcut and consolidate additional quota windows, notices and provider links in the sidebar.
- Remove the Remaining label from the Account & Usage summary.
- Open the selected account’s expanded sidebar section from its status meter or the Account & Usage command.

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

### Missing-server setup

#### v0.0.1

- Report a missing local server and clarify explicitly started isolated development servers.

#### v0.0.7

- Add installation/service/manual-start links, copyable commands, Retry connection and native Settings.
- State that remote servers are not supported yet.

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

### Release versioning

#### v0.1.10

- Track major.minor.stage.build in release.json, with 0/1/2/3 denoting alpha/beta/RC/stable.
- Encode stage × 10000 + build in the Marketplace patch component and validate the manifest before packaging.
- Prepare label 0.1.0.10 as Marketplace v0.1.10 while preserving historical version entries.

#### v0.1.11

- Replace the label/encoding scheme with one package.json version used by the README, changelog, installer and Marketplace.
- Use Alpha as a stage description and keep the prerelease channel separate from the three-number version.

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

## Maintenance

Update the overview's introduction/latest-change versions and the affected feature's version section in the same change. Add an entry only for an actual feature change; documentation-only edits do not change the feature's introduction version. Record removed behavior explicitly and keep historical sections intact. Keep each bullet to one sentence where possible, and at most two sentences.

The packaging workflow is recorded in [AGENTS.md](../AGENTS.md). User instructions remain in [README.md](../README.md); source setup and checks are in [Development and testing](development.md), and host/webview boundaries are in [the architecture](t3-vscode-architecture.md).
