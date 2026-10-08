# Scheduled tasks — sidebar navigation and configuration

Status: interactive design mockup only, awaiting feedback. The extension does not implement task configuration yet. Keep manifest version **0.1.16** and wait until implementation and regression review are complete before building the next VSIX; never publish it.

Open [the interactive mockup](task-configuration.html) in a browser. All tasks, catalogs and effort levels are sample data; Save, Enable and Run now affect memory only. No training process, provider or T3 server is accessed. This revision replaces the previous chat-panel scope switch with separate session and project navigation.

## Layout and behavior

| Entry point | Scope | Editing and return |
| --- | --- | --- |
| Chat's **Scheduled** button | Tasks originating from this session only. | Open the shared sidebar editor; return to the sidebar list that was active. |
| Sidebar **Sessions** tab | Expand a session into separate **Subagents** and **Scheduled tasks** groups, each independently collapsible. | Click a scheduled task to edit; Save returns to Sessions with the tree state intact. |
| Sidebar **Tasks** tab | All scheduled tasks belonging to this project, across sessions, including project tasks without a known session. | Click a task to edit; Save returns to the project Tasks list. |

- Keep project-wide tasks in the sidebar Tasks tab. The chat drawer has no global scope switch and never includes another session's or project's tasks.
- Show counts on the navigation tabs and both session groups. Keep task titles prominent and use compact schedule/model metadata; include the originating session on project task rows with truncation and a full-name tooltip.
- Open task configuration as a secondary page in the existing sidebar. It replaces the list while the main chat stays open; the top Back link identifies **Sessions** or **Project tasks**, and the fixed footer contains Cancel/Save.
- Edit name, prompt, provider/model, advertised effort, schedule and result destination. Keep machine/project and originating-session context visible; collapse checkout settings under **Workspace**.
- Reuse the provider/model picker with search and provider groups. Task prompts use the sample composer's text size; model editing does not invoke the chat's model selector.
- Save updates future scheduled runs and returns to the previous sidebar front page, preserving its active tab, search, scroll position and expanded groups. It does not run the task; **Run now** is a separate action.
- Cancel discards task edits and returns to the list. Back retains the task draft for reopening and returns to the list; neither action changes the current chat draft or selected session.
- Load existing tasks with their saved selections. Preserve provider-specific options when the same model remains selected; reconcile advertised options when it changes. A hidden or unavailable saved model must stay visible as the saved value and require an explicit replacement when needed, with no silent fallback to a premium model.
- For new monitoring tasks, prefer advertised GPT-6 Luna with Low effort when available; otherwise require an explicit model choice. Do not silently inherit the active conversation's premium model.
- Support interval and fixed-time schedules exposed by the current integration. Preserve existing task bindings, workspace strategies, runtime/interaction modes and attribution; do not create a new scheduling engine or modify T3 Code.

At compact widths, the chat task list is a drawer; wide layouts can show it as a right column. Below 600 px, the mockup displays one pane at a time and its external demo controls switch between sidebar and chat previews. Those controls are walkthrough aids, not proposed product controls.

## Originating session and result destination

Session membership follows the task's **origin**, independently of **Post results to**. The sample Morning training report belongs to the training session even though it creates a new result session each run. Editing that destination preserves membership in the original session's group and chat drawer.

The pinned scheduled-task contract has `threadId` for result binding and `createdBy`/`creationSource` attribution, but no separate originating-session ID. The mockup uses explicit sample ownership; implementation must resolve trustworthy provenance from available server records or extension-owned associations scoped to server/project/task. It must not silently treat result binding as proof of origin. Existing tasks whose origin cannot be resolved remain in the project Tasks list as unlinked project tasks.

## Existing API and implementation plan

The vendored [scheduled-task contract](../../vendor/contracts/src/scheduledTask.ts) already includes a persisted `modelSelection` and provider options. Its [RPC definitions](../../vendor/contracts/src/rpc.ts) expose `scheduledTasks.list`, `subscribe`, `upsert`, `setEnabled` and `runNow`; no upstream application change is required for these controls.

1. Add typed task list/subscription and mutation methods to the extension host, scoped to the connected server/project/workspace, plus reliable origin associations distinct from result bindings. Keep unknown origins out of session-specific lists.
2. Extend sidebar navigation with Sessions/Tasks tabs and a shared task-editor page. Wrap the existing session tree in independently controlled Subagents/Scheduled tasks groups, preserving nested subagent hierarchy, settlement/archive behavior and conversation selection. Carry the return tab, query, scroll and focus through editing.
3. Reuse model catalogs, local visibility/order/favorites and advertised effort descriptors through a controlled task-draft callback. Task selection must not call `setModel` or change conversation drafts; different-session task editing must not navigate the chat.
4. Edit a copy of the complete saved task and save with `requireExisting: true`; use `setEnabled` for switches. Preserve hidden fields and attribution, retain failed saves, reject deleted/stale targets safely and return to the front page only after a successful save.
5. Preserve interval/fixed details and validate required fields. Do not offer webhook creation until the connected-server integration supports it. Check origin retention after changing result destination, missing providers/models, external updates and reconnects with deterministic fixtures.
6. Verify actual model/effort persistence and queued scheduled dispatch using explicitly isolated T3 storage. Implement the approved session-activity/model-drag layouts separately, keep feature history current and obtain fresh-context regression signoff before local packaging under `target-installer/`; keep v0.1.16, never publish or install into the normal profile.

## Validation

- Previewed session groups, project task rows and the sidebar editor at 728 px in light theme, plus the editor at 360 px in dark theme, without console errors or horizontal overflow.
- Passed isolated interaction checks at 728, 360 and 280 px for independent group collapse, keyboard tab navigation, project search, Save/Cancel/Back, retained task drafts, Reset and restored return-tab/search/scroll state.
- Verified project filtering with a foreign-project fixture, session ownership independent of new-session result destinations, unlinked project tasks and new session/project task creation.
- Checked provider/model search and keyboard selection, effort editing, explicit Run now and enable controls, interval validation, cheap new-task defaults and preservation of the active chat's model and draft when editing another session's task.
- Kept the fixed editor footer visible and matched prompt/composer text sizes; all fixtures stayed in memory in a disposable browser profile with zero network/provider/T3 calls.

The earlier model/schedule mockup checks remain recorded in Git at `6f50203`; these design checks do not establish a runtime implementation. The feature overview remains unchanged because this revision edits only the mockup and its notes.
