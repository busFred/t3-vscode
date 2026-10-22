# Changelog

## 0.2.2 — Prerelease

- Copy as Markdown no longer backslash-escapes ordinary punctuation or inflates blank lines; Ctrl/Cmd+C copies the transcript selection in editor-tab chats.
- Context window meter: a ring and percent left of "List assist" show the active thread's live provider usage with warning/error bands and a token tooltip.
- Sessions list shows "Waiting on subagents" with a running timer while a delegated child thread is still working after the parent's own run settled.
- "Agent needs your input" card follows the prompt font size, grows its custom answer box vertically (Enter submits, Shift+Enter newline) and collapses to one line per request.
- Choosing Claude's Ultrathink effort no longer discards the composer's undo history.
- Changed-files box shows the checkout's branch and a "Merged from subagent" group (source → destination) for files applied from a subagent worktree.
- "Edit from here" rewinds the conversation only; "Restore files to this point" previews agent/your/untracked changes with per-file "Keep mine", dry-run conflict verdicts, and never invokes the server's unguarded file restore.
- Documentation audit: stale investigation notes archived, README/SUPPORT/CHANGELOG corrected, documentation map added.
- Fresh-context regression review found two blocking issues (glob-named kept files deleted by `git clean -e`; sibling `<div>`s joined in Copy as Markdown); both fixed with tests before packaging. A second fresh-context review covered those fixes.

## 0.2.1 — Prerelease

- Version-only republish of 0.2.0's worktree work; no runtime changes. Fresh-context regression review approved the version-only candidate with no findings before packaging.
- Published to the Marketplace prerelease channel; the public listing readback had not picked it up at publish time, so indexing is pending (upload acceptance itself is confirmed).

## 0.2.0 — Prerelease

- Add a Worktrees sidebar beside Sessions and Tasks: create a checkout from a selected base, reuse an existing checkout/branch, or import a GitHub pull request through the T3 service; run up to four explicit model allocations in separate checkouts and compare their files or open individual chats/native diffs.
- Add the Worktree control to the message box, immediately after permissions, to pick root, a new checkout, an existing checkout/branch or a pull request for a new conversation.
- Review committed and local changes per checkout, apply selected files to another checkout after conflict checks, and run service-backed commit/push/PR actions; removal protects dirty/active/main checkouts and a missing checkout can be restored.
- Read and save worktree settings (project actions, setup wait/background behavior, base/origin defaults, branch prefix, submodules, worktree directory, cleanup policy) through native T3 settings; support per-worktree Conda environments with an automatic 24-hour-grace cleanup for extension-owned environments.
- Recognize Git common-directory identity so a linked-worktree window shows the whole project's conversations, worktrees and scheduled tasks; new chats may choose the open checkout, existing conversations keep their own.
- Minute-based shared refresh settings for usage and worktrees, including fractional intervals, replacing the old seconds-based usage-only interval.
- Published to the Marketplace prerelease channel with the owner's explicit authorization; prior implementation verification covered 377 deterministic tests, TypeScript, full build, three browser suites and isolated Linux VS Code checks, with a fresh-context regression review of the channel-only metadata delta before packaging.

## 0.1.23 — Release

- Quote selected user or assistant message text through the recoverable right-click menu. Quote opens the optional-comment editor; remove the floating Quote button and redundant Quote with comment action. Preserve user authorship in saved and sent quotes.

- Initialize Archive counts automatically from summaries in the background. Keep the shelf collapsed, show loading only during a request and support retry without blocking chat.

- Add date/time dropdowns with seven date examples and two time examples. Apply preferences live to message timestamps and date/time tooltips. Sessions older than 14 days show their full last-activity date and time on the existing second line.
- Single-click Sessions and Tasks entries to preview them in native VS Code tabs; double-click to keep them open. Reuse existing tabs, keep edited previews open, preserve drafts and restore the current History selection.
- Ctrl/Cmd+click an inline image reference to edit its caption with Preview, Save and Cancel. Preserve the attachment and native undo.
- Fit the selected-text context menu to its content and use the editor foreground for menu and composer text, retaining theme placeholder and selection colors.

- Same-version rebuild validation: 270 deterministic tests, TypeScript/build, both browser suites, isolated native VS Code preview/restoration checks and final independent regression review passed.
- Published the verified `target-installer/t3-vscode-0.1.23.vsix` to the stable Marketplace channel on 2026-10-18. SHA-256: `6faaa1b5d1acda97075d96ec024a7a64041c26ebe2669bf1a3aded18fc41755a`. Upload succeeded; the immediate public listing readback still showed 0.1.22, so Marketplace indexing remains pending.

## 0.1.22 — Release

- Use the standard icon-only Scheduled tasks header button, retaining its count in the tooltip. Match the Settled, Archive and settings row heights to the Sessions/Tasks tab strip at every interface font size.

- Keep subagents beneath their parent instead of counting them in Active, Settled or Archive. Remove duplicate “Parent session” entries; each ordinary conversation belongs to its own state’s section, including during search.

- Match Sessions search height and spacing to Tasks and keep the field and buttons stationary when entering or clearing text.

- Rebuild verification: 260 deterministic tests, TypeScript, full builds, both browser suites and focused Markdown-copy fixtures pass. Independent final regression review against `39759da` approves packaging after fixes to Markdown serialization and stale selection recovery.
- Show recorded local dates and times beside message footer actions: assistant Copy/Fork then time on the left, user time then Copy on the right.
- Add a floating sort menu beside the Sessions + button for last-activity date or title, ascending or descending; remember the choice while preserving pinned sessions and the existing tree and shelves.
- Recover the last valid selected passage by right-clicking its source again after dismissal, even when the native selection has cleared. Copy as plain text and Copy as Markdown join the quote options; no permanent quote button is added.
- Highlight all rendered search matches inside messages and code, with a stronger active match, while preserving the existing search layout and refreshing highlights through scrolling and streaming.

- Right-click selected response text for Copy as plain text, Copy as Markdown, Quote and Quote with comment; Shift+F10 and the Menu key open the same menu. A stray click used to dismiss the floating button with no way back to the quote short of reselecting the text. Quote inserts the quote straight away and never prompts, from the menu and from the floating button alike; the comment is added afterwards from the chip or the draft token, so it can no longer be lost to a dismissed dialog. Right-clicking an equation still shows the equation menu, and a selection that cannot be quoted still shows the platform's own menu, which is why Copy leads.
- Rename the floating Cite button to Quote, so the button and the menu item share one name.
- Open a reference in the message box with Ctrl+click (Cmd on macOS) rather than a plain click, and hold Ctrl to see the caret turn into a pointer. A plain click now only moves the caret, so a path can be retyped by hand — a file the suggestion list will never offer, such as one that is gitignored. This applies to file references, image references and quote tokens alike.
- Pass 259 deterministic tests, TypeScript checking, full builds and both headless browser suites. Fresh-context regression review of the Ctrl+click change verified every gesture in a real browser — plain, Ctrl, Cmd, middle, right, drag-select and double-click across all three reference kinds — and confirmed the new assertions fail against the previous behaviour. Its one blocking finding was documentation: the user guide still told readers to click an inline reference, which this release made inert. Also fixed from its notes: the accessible description named Ctrl on macOS, and the pointer cursor appeared on a disabled message box.
- Known behaviour change: a plain click inside an `@path` token leaves the caret in the token, so the suggestion menu opens for that partial path. That is useful when retyping a path, but it is new — the click used to navigate away instead.

## 0.1.21 — Alpha prerelease

- Render fenced code with a line-number gutter, optional soft wrap and a copy button. A wrapped line keeps its single number and the next line starts below the whole wrapped block, as a text editor does; wrap is per block, defaults on, and survives scrolling the block out of view. The header names the language in full — Python, TypeScript, LaTeX — or says Plain text for an unnamed fence.
- Collapse a sent message's attached file references into one row each, showing the path and a summary and expanding to the snapshot, so the words you typed are no longer buried in payload rendered at the same weight.
- Show every attached item as one uniform chip in a single wrapping row: images, files, quotes and file references share a height instead of an image being a preview card four times the size of a quote pill. Hovering or focusing an image chip enlarges it.
- Label a quote with its number and your comment, falling back to the quoted text in quotation marks when there is no comment; the chip slants and dims that fallback, so your words read upright and the assistant's lean. Numbers are derived from the draft and match the badges the sent message renders.
- Stop a web link in a response opening the browser before the host's prompt is answered. The link carried both a real href and a handler that called openExternal, so the page loaded whether or not you confirmed, and Cancel did nothing.
- Reclaim the wasted space in the side panel. The section-label band that repeated the selected tab is gone and its `+` sits beside the search field, which with the tighter header saves 56px above the first conversation. Rows give the title its own wrapping line and move status, age and icons below it, separated by a hairline at padding that follows the interface font size: a conversation row drops from about 50px to 35px and a scheduled task from up to 122px to 34px, while titles read about 40px wider.
- Halve the Account & Usage panel to about 186px: the reset time joins the value line with the bar beneath it, an unreported window is one line, and Status meters becomes an icon beside Refresh.
- Show the working badge in the sidebar for a subagent whose run is driven by its parent. Its own status lags that run, so the row read as idle while the transcript card showed it running.
- Make the list separator visible in light themes, where it was derived from a token that matches the sidebar background, and give the selected row an outline under high contrast, where the platform paints the selection background the same colour as the list.
- Add **T3 VSCode: Refresh Usage Meters** to the command palette, which refreshes the meter figures on demand instead of waiting for the interval. Configure Status Meters still only chooses which account the status bar shows.
- Keep native undo and redo working across programmatic edits to the message box. Pasting an image, inserting a quote, editing a quote's comment, picking a suggestion and adding an editor reference each replaced the whole box, which destroyed its history; every one is now replayed as a single edit the browser can undo.
- Preview a message in the navigation rail, and expand a quote when a search result inside it is opened, as the transcript renders them rather than as the stored text.
- Raise the usage refresh interval default from 300 to 600 seconds.
- Carries everything listed under 0.1.20, which was packaged but never reached the Marketplace.
- Pass 256 deterministic tests, TypeScript checking, full builds and both headless browser suites. Fresh-context regression review found four blocking defects, all fixed: a collapsed reference row's Open button was keyboard-inoperable, because the row's own key handler cancelled the nested button's activation; a long reference path could not shrink, pushing that button and the chevron outside the clipped card at sidebar widths; `scripts/verify-editor-chat.mjs` still queried a class this release deleted, so one assertion could never run; and the documentation carried a stale default, a retired limitation still advertised as present, a misfiled entry and an unreachable heading. The review also found that the sidebar and the subagent card still disagreed on two run statuses, which is the same defect this release set out to close, so they now share one predicate.
- Known limitations: undoing a pasted reference leaves its attachment in the draft, because the undo stack belongs to the message box rather than to the draft; removing a chip still clears that history, since focus is on the remove button; and `scripts/verify-response-layout.ts` fails roughly four runs in fifteen on a transcript-scroll race, measured identically on an unmodified build.

## 0.1.20 — Alpha prerelease

Published to the prerelease channel on October 11, 2026, though not in the way it appeared at the time: the upload returned an Azure DevOps outage page and a readback minutes later showed no 0.1.20, so it was recorded as never published and the work moved to 0.1.21. The Marketplace in fact ingested it, listing it at 23:52:34Z, 28 minutes after the apparent failure. Everything below therefore shipped in 0.1.20 and ships again in 0.1.21.

- Write a file chosen from the `@` menu as the same plain `@path` token the editor's Ctrl/Cmd+K uses, with a removable chip. It previously inserted a bare Markdown link that had no reference behind it, so clicking it in the message box did nothing.
- Keep the `@` visible in the sent message. File references now send as `[@path:12-40](uri#L12-L40)` rather than dropping the prefix. A path chosen from the menu is labelled with its workspace-relative path, as editor selections already were, so files that share a name stay apart.
- Open a referenced file from its draft token, its chip or the sent message. Directories now reveal in the Explorer instead of failing to open as a document.
- Send quoted assistant text verbatim. The previous escaping turned `(text)` into `\(text\)`, which the Markdown math normalizer then rendered as KaTeX, so quotes containing parentheses appeared as run-together italics or red errors; `[text]` became display math and broke the quote block apart.
- Replace the repeated `Assistant quote` links and the duplicated quote block below them with one numbered card per quote, collapsed to two lines, with an expand control and a source link. The message still carries a readable quote block for providers and other clients, which never expand `t3-citation:` links; the transcript hides it.
- Label quote tokens and chips with a preview of the quoted text instead of the word `Assistant quote`, and shorten quote reference ids so the draft stays readable.
- Collapse the runs of blank lines a quote carries when it spans blocks. A quote of a paragraph followed by a list arrived with four blank lines in it: the collapsed card now reads as one flowing paragraph, so neither visible line is spent on a blank, and the expanded card keeps one blank line per break along with any code indentation. Done when the card renders, which also fixes quotes saved earlier; changing the capture instead stopped this client resolving whole-message quotes that the T3 app keeps producing, so the capture is left as the faithful port it is.
- Search a quoted message as the transcript renders it, so results, previews and match order agree with what is on screen; open a result inside a quote and the quote expands to show it.
- Copy a message as it reads, with quotes in readable form rather than their citation URLs.
- Keep a quote expanded once opened, including while the transcript unmounts and remounts its row.
- Draw thematic breaks (`---`), which previously rendered as an unstyled browser default.
- Restore the composer caret in the same update that inserts a reference instead of a frame later, so typing immediately after pasting an image no longer lands back at the insertion point. Long-standing; `scripts/verify-ui.mjs` reproduced it at v0.1.19 and now pins the caret position in both directions.
- Pass 228 deterministic tests, TypeScript checking, full builds and the headless webview regression suite. Four rounds of fresh-context regression review found four blocking defects, all introduced by this change set: a whole-file `@` token claimed a longer path that extended it at a `.` boundary, so picking `@.env` then `@.env.local` sent two links to `.env`; the quote-stripping pattern exceeded the regular-expression size limit for a quote of a few thousand short lines, which would have thrown during transcript render; the line-based replacement for it then failed to hide the readable block whenever a comment contained a newline, which Shift+Enter in the comment box produces; and a change to how quotes are captured stopped 17 of 37 real message shapes resolving a whole-message quote saved by an earlier version or by the T3 app, which was withdrawn in favour of collapsing the blank lines at render. Known limitations: a quote chip no longer marks that a comment is attached except in its tooltip; search still indexes Markdown source, so a match inside link or emphasis syntax can preview text that is not on screen; and two pre-existing timing flakes in `scripts/verify-response-layout.ts` and the queued-message reorder check fail roughly one run in five, at this version and at v0.1.19 alike.

## 0.1.19 — Alpha prerelease

- Stop the periodic usage refresh from delaying sent messages. A refresh that falls due while a message is being sent or a response is running now waits for the session to go idle instead of competing with it, and is forced through only once the meters are five intervals stale.
- Refresh just the provider behind a single displayed meter instead of every configured provider; keep sweeping every provider when several meters are shown, so pinned accounts still advance.
- Pause automatic refreshes while no meter is displayed, and run the waiting refresh as soon as one appears instead of an interval later. Account & Usage then updates only when you refresh it.
- Spread each refresh with up to 20% random jitter, and raise the `t3-vscode.usage.refreshIntervalSeconds` default from 60 to 300 seconds. An interval you have already set is unchanged.
- Pass 222 deterministic tests, TypeScript checking and full builds. Fresh-context regression review found nothing blocking across three rounds. The first round's two behaviour findings (a swallowed connect refresh and starved pinned meters) are resolved above, and its optional suggestions are applied: a reconnect or a reappearing meter during a hung refresh is no longer swallowed by that refresh completing, and the archived-session and disabled-instance cases are now covered by tests. The third round reviewed that final state against `7e19b2d` and approved it; its remaining notes are non-blocking. Published to the Marketplace prerelease channel.

## 0.1.18 — Release

- Fix chat rows occasionally drawing over each other while a reply streams, such as a new question or response header covering the end of an earlier response with images.
- Clear leftover blank space below the last response after resizing a session.
- Refresh provider usage meters automatically once the extension connects and on an interval; add `t3-vscode.usage.refreshIntervalSeconds` (default 60, minimum 15; `0` disables periodic refresh).
- Pass 204 deterministic tests and TypeScript checking. Fresh-context regression review found no blocking regressions; published to the Marketplace release channel from `251cfec`.

## 0.1.17 — Alpha prerelease

- Show one changes box per response only when the agent made file changes; hide empty, loading and unavailable diff placeholders.
- Remove all manual-edit lists and counts from chat while continuing to exclude pre-response edits from agent diffs.
- Compare the final response checkpoint against its saved start snapshot so the single box includes the response's complete file changes.
- Pass 200 deterministic tests, TypeScript checking, full builds and browser regressions, including delayed completion and a single combined changes box. Fresh-context regression review against `b71e129` found no blocking regressions.

## 0.1.16 — Local response diff fix, unpublished

- Exclude saved manual edits made between responses from new response diffs, including edits within the same file; list pre-existing edits separately.
- Retain immutable native diffs across reloads. Mark attribution unavailable for responses without a pre-message snapshot, including older, queued, steered and externally started responses.
- Pass 198 deterministic tests, TypeScript, full builds and browser regression checks; obtain independent final regression approval before local packaging.

## 0.1.16 — Local resize fix, unpublished

- Fix persistent blank space below the last chat response after resizing a session by clearing temporary scroll-adjustment padding reliably.

## 0.1.16 — Alpha, release channel

- Add separate Sessions and Tasks managers with their own new-item buttons, independent project tasks and session groups for subagents and scheduled tasks.
- Remove the repeated project name above Tasks in a single-project workspace; retain project selection when multiple projects are available.
- Edit task prompts, models, ordinary advertised effort, schedules and result destinations on a sidebar page; preserve chat drafts and keep task saving separate from running.
- Show compact session activity ages and support model ordering with drag handles or Alt+Up/Down.
- Remove the T3 Web import button, Command Palette command and JSON import path; keep existing saved favorites, visibility and ordering.
- Match queued-message editing to the main composer's prompt font size and line spacing while retaining compact previews and the current draft.
- Preserve task drafts across reconnect and native sidebar navigation, and reject newly selected prompt-driven effort values that cannot be applied as saved task options.
- Pass 193 deterministic tests, TypeScript checking, full builds, browser suites and isolated native/task checks, including one GPT-6 Luna Low scheduled run; obtain independent regression signoff before packaging.
- Publish the reviewed v0.1.16 VSIX to the stable release channel by owner request, with manifest `preview: false` and no version bump; public Marketplace metadata now lists it with the uploaded package checksum.

## 0.1.16 — Initial local installer, unpublished

- Use selected composer text as a pasted image's description, preserving the filename when no text is selected and retaining attachment ownership and inline positions.
- Add model visibility and ordering controls, accurate visible-model counts and an explicit import of T3 Web's device-local favorites and model preferences.
- Pass 183 deterministic tests and both browser regression suites; resolve independent review findings for custom provider IDs and failed native preference writes before local packaging.

## 0.1.15 — Alpha, release channel

- Make the Windows `t3.cmd` and `.bat` pairing fix available on the release channel, using the same runtime as the working 0.1.14 preview.

## 0.1.14 — Alpha prerelease

- Publish the Windows pairing fix from the local 0.1.13 revision to the preview channel; the release channel remains on 0.1.13.
- Resolve Windows `t3.cmd` and `.bat` launchers through the command shell with escaped paths and arguments, while retaining direct execution for native executables, Linux and macOS.
- Cover CLI resolution, paths with spaces, pairing failures and the bearer exchange with regression tests; native Windows execution still needs verification.

## 0.1.13 — Local Windows pairing revision

- Fix automatic pairing with Windows `t3.cmd` and `.bat` launchers by resolving the CLI and escaping the shell command; retain direct execution for native executables, Linux and macOS.
- Keep version 0.1.13 for the local installer; this revision does not update the Marketplace package.

## 0.1.13 — Alpha, release channel

- Guide first connection through T3’s web/provider setup, keep the background service optional and enter Sessions automatically after connecting.
- Show accurate discovery/pairing diagnostics and copy startup commands for the configured T3 directory, preserving isolated development setup.
- Rename conversations by double-clicking the title; browse tab-local History and create fresh editor chats from the header, sidebar or Command Palette.
- Keep a permanent grouped Markdown toolbar, high-contrast input, model/effort/mode controls inside the composer, and a stationary Send button beside the existing Stop style.
- Add selection wrapping, automatic list numbering with undo, list continuation and indentation while preserving literal Markdown, paste, IME, autocomplete and send/queue/steer shortcuts.
- Recover text, references, cursor position and attachments after closing tabs or restarting; concurrent tab drafts and web UI drafts stay separate.
- Search complete history with one row per occurrence, matching chat fonts, persistent source/content filters and compact controls.
- Collapse search to a floating bar without blank pane space; switch Above/Side, expand directly to Side, and stack automatically in narrow editors.
- Show Working as soon as dispatch succeeds, keep all assistant prose visible, and fold only thought/tool groups separated by messages and steers.
- Use one assistant header per run, a status-only pinned Working header, dense message gaps and one capability-gated fork at the end of a settled run.
- Keep the account refresh/update time and shorten its settings link to **Status meters**.
- Release version 0.1.13 on the Marketplace release channel; no new prerelease is published.

## 0.1.12 — Alpha prerelease

- Insert editor selections at the last-used chat's prompt cursor with Ctrl+K (Cmd+K on macOS), retaining Alt+K.
- Show readable file/range references inside the prompt and preserve exact unsaved source text when sending.
- Exclude removed file references from the sent context and keep each chat's draft independent.
- Move development setup and VS Code testing instructions into a separate guide.
- Set the Marketplace publisher to `hungtienhuang` for the first public prerelease.

## 0.1.11 — Alpha preview

- Insert assistant quotes at the prompt cursor and preserve inline source links when sending, queueing or steering.
- Keep comments editable and remove quote references without sending unused quote data.
- Use one version from package.json throughout documentation, installers and Marketplace metadata.
- Add screenshots captured from the extension with prepared demo conversations.

## 0.1.10 — Alpha preview

- Remove the two-column reader, its layout controls and its settings to keep chat virtualized at every editor size.
- Retain wide-equation scrolling, floating previews and LaTeX/MathML copying.
- Use localhost for local browser links so an existing paired browser session can be reused.
- Prepare numeric status versioning, prerelease packaging, listing metadata, licensing and support documentation.

## 0.0.9 — Local preview

- Move chat into independent editor tabs and consolidate account usage in the sessions sidebar.
- Reveal existing conversation tabs from session links and input notifications.
- Fix saved-turn diff ranges and improve expanded command readability.
- Add image references at the cursor and preserve attachment ownership when inserting another image.
- Show only reported usage windows and group native settings by purpose.
- Introduce the two-column reader experiment, removed in 0.1.10 after performance feedback.

## 0.0.8 — Local preview

- Add interactive HTML, Mermaid, KaTeX and authenticated media rendering.
- Add image clipboard paste, local file picking and sent-image thumbnails.
- Add nested subagents, live status cards and parent conversation navigation.
- Add the versioned feature inventory and fresh-context regression review requirement.

Earlier changes are recorded in [the feature history](docs/feature-history.md).
