# Changelog

## 0.1.17 — Local installer, unpublished

- Show one changes box per response only when the agent made file changes; hide empty, loading and unavailable diff placeholders.
- Remove all manual-edit lists and counts from chat while continuing to exclude pre-response edits from agent diffs.
- Compare the final response checkpoint against its saved start snapshot so the single box includes the response's complete file changes.
- Bump from published 0.1.16 at the owner's request.
- Pass 200 deterministic tests, TypeScript checking, full builds and browser regressions, including delayed completion and a single combined changes box. Obtain final independent regression approval before packaging.

## 0.1.16 — Local response diff fix, unpublished

- Exclude saved manual edits made between responses from new response diffs, including edits within the same file; list pre-existing edits separately.
- Retain immutable native diffs across reloads. Mark attribution unavailable for responses without a pre-message snapshot, including older, queued, steered and externally started responses.
- Pass 198 deterministic tests, TypeScript, full builds and browser regression checks; obtain independent final regression approval before local packaging.

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
