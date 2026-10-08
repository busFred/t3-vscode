# Scheduled task configuration — proposed layout

Status: interactive design mockup only, awaiting feedback. The extension does not implement task configuration yet. Keep manifest version **0.1.16** and wait until implementation and regression review are complete before building the next VSIX; never publish it.

Open [the interactive mockup](task-configuration.html) in a browser. All tasks, catalogs and effort levels are sample data; Save, Enable and Run now affect memory only. No training process, provider or T3 server is accessed.

## Layout and behavior

- Add a compact **Tasks** button with a session task count to the editor chat header. Open a right panel; at narrow widths, the panel occupies the chat area and closing it restores the conversation and draft.
- List tasks attached to this session, with an **All workspace tasks** scope. Each row shows the name, schedule, saved model/effort, edit pencil, Run now and enable switch.
- Edit name, prompt, provider/model, advertised effort, schedule and result destination in the panel. Keep machine/project context visible; collapse checkout settings under **Workspace**.
- Use the familiar provider/model picker for **Task model**, with search and provider groups. The sample uses GPT-6 Luna with Low effort while the main session uses Astra with Max; editing the task does not invoke the chat's model selector.
- Save changes to this task's future scheduled runs. Save does not run the task; **Run now** is a separate deliberate action. Cancel discards changes, while closing/reopening the panel retains the unsaved task and chat drafts.
- Load existing tasks with their saved selections. Preserve provider-specific options when the same model remains selected; reconcile advertised options when it changes. A hidden or unavailable saved model must stay visible as the saved value and require an explicit replacement when needed, with no silent fallback to a premium model.
- For new monitoring tasks, prefer advertised GPT-6 Luna with Low effort when available; otherwise require an explicit model choice. Do not silently inherit the active conversation's premium model.
- Support interval and fixed-time schedules exposed by the current integration. Preserve existing task bindings, workspace strategies, runtime/interaction modes and attribution; do not create a new scheduling engine or modify T3 Code.

## Existing API and implementation plan

The vendored [scheduled-task contract](../../vendor/contracts/src/scheduledTask.ts) already includes a persisted `modelSelection` and provider options. Its [RPC definitions](../../vendor/contracts/src/rpc.ts) expose `scheduledTasks.list`, `subscribe`, `upsert`, `setEnabled` and `runNow`; no upstream application change is required for these controls.

1. Add typed task list/subscription and mutation methods to the extension host, scoped to the connected server and opened workspace. Map task identities to the originating project/session; keep subscriptions and form state independent across editor tabs.
2. Refactor the model picker to support a controlled selection callback for task drafts, reusing provider catalogs, local visibility/order/favorites and advertised effort descriptors. Task selection must not call `setModel` or alter conversation drafts.
3. Edit a copy of the complete saved task, preserving fields the form does not expose. Save through `scheduledTasks.upsert` with `requireExisting: true` for edits; use `setEnabled` for a switch so it cannot overwrite prompt/model edits. Keep failed saves editable and reject deleted or stale targets safely.
4. Preserve interval/fixed schedule details and task result bindings; validate the one-minute interval minimum and required workspace fields. Do not offer webhook creation until the existing connected-server integration supports it.
5. Verify model/effort persistence and scheduled dispatch, including a bound task queued behind an active run, missing provider/model, external updates, failed writes and reconnects. Check main-chat model/draft preservation, keyboard access and narrow/theme layouts with deterministic fixtures and an explicitly isolated T3 home.
6. Implement the approved session-activity and model-drag layouts alongside task configuration in separate feature commits, keeping their Markdown history current. Obtain fresh-context regression signoff for the complete final changes before packaging under `target-installer/`, without version changes, installation into the normal profile or publication.

## Validation

- Previewed at 728 px in light theme and 360 px in dark theme, with no console errors or horizontal overflow; the initial form keeps Enabled and the fixed Save/Cancel footer visible.
- Passed isolated browser checks at 728, 360 and 280 px for provider/model search, keyboard selection, effort changes, models without effort controls, Save/Cancel and preserved main-session model/drafts.
- Checked panel close/reopen draft retention, interval and fixed-time schedules, weekday keyboard/pointer controls, invalid inputs, workspace fields, result scopes, enabled state and preview-only Run now.
- Confirmed new-task samples start on Luna with Low effort and that task prompts use the same text size as the sample composer.
- All checks use sample data in a disposable browser profile with no network, provider or T3 calls; this validates the proposed interactions, not a runtime implementation.
