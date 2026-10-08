import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { ProviderInstanceId, ProviderDriverKind } from "@t3tools/contracts";
import type { HostState } from "../src/host/hostState.js";
import type { FakeTransport } from "../src/host/testing/fakeTransport.js";
import { scheduledTaskFixture } from "../src/host/testing/scheduledTaskFixture.js";
import type { TaskOrigin } from "../src/shared/scheduledTasks.js";

export async function verifyScheduledTasks(sidebar: Page, chat: Page, other: Page, host: HostState, client: FakeTransport, origins: TaskOrigin[], evidence: string) {
  await host.selectThread("second", "tab-two"); await host.selectThread("third", "tab-three");
  await chat.getByRole("textbox", { name: "Message", exact: true }).fill("Keep my chat draft");
  const modelBefore = host.snapshot("tab-two").threads.find((thread) => thread.id === "second")!.modelSelection;
  const projectId = host.snapshot().projects[0]!.id;
  const cheap = { ...client.config.providers[0]!, instanceId: ProviderInstanceId.make("codex-budget"), driver: ProviderDriverKind.make("codex"), displayName: "Codex budget", models: [{ slug: "gpt-6-luna", name: "GPT-6 Luna", isCustom: false, capabilities: { optionDescriptors: [{ id: "reasoningEffort", type: "select" as const, label: "Effort", options: [{ id: "low", label: "Low" }, { id: "high", label: "High" }] }] } }] };
  client.config = { ...client.config, providers: [...client.config.providers, cheap] };
  const modelSelection = { instanceId: cheap.instanceId, model: "gpt-6-luna", options: [{ id: "reasoningEffort", value: "high" }] };
  client.scheduledTasks = [
    scheduledTaskFixture({ id: "session-monitor", projectId, title: "Monitor this session", threadId: "second", modelSelection }),
    scheduledTaskFixture({ id: "other-monitor", projectId, title: "Other session task", threadId: null, modelSelection }),
    scheduledTaskFixture({ id: "unlinked-monitor", projectId, title: "Unlinked project task", threadId: "second", modelSelection }),
    scheduledTaskFixture({ id: "outside-monitor", projectId: "outside", title: "Foreign project task", threadId: null, modelSelection }),
  ];
  for (const [taskId, threadId] of [["session-monitor", "second"], ["other-monitor", "third"]]) origins.push({ environmentId: host.snapshot().environment!.environmentId, projectId, taskId: taskId!, threadId: threadId! });
  await host.refreshScheduledTasks(); host.refreshAppearance();
  await chat.getByRole("button", { name: "Scheduled tasks", exact: true }).click();
  const drawer = chat.getByRole("region", { name: "Current session scheduled tasks" });
  await drawer.getByRole("button", { name: "Edit task Monitor this session" }).waitFor();
  assert.equal(await drawer.locator(".scheduled-task-row").count(), 1, "Current session never shows other or unlinked tasks");
  await sidebar.getByRole("tab", { name: /^Tasks/ }).click();
  const list = sidebar.getByRole("region", { name: "Project scheduled tasks" });
  assert.equal(await list.locator(".scheduled-task-row").count(), 3, "Only this project's tasks");
  await sidebar.getByRole("textbox", { name: "Search tasks", exact: true }).fill("Other session");
  await sidebar.getByRole("button", { name: "Edit task Other session task" }).click();
  await sidebar.getByRole("textbox", { name: "Task name", exact: true }).fill("Unsaved task draft");
  await sidebar.getByRole("button", { name: "Project tasks", exact: true }).click();
  assert.equal(await sidebar.getByRole("textbox", { name: "Search tasks", exact: true }).inputValue(), "Other session");
  await sidebar.getByRole("button", { name: "Edit task Other session task" }).click();
  assert.equal(await sidebar.getByRole("textbox", { name: "Task name", exact: true }).inputValue(), "Unsaved task draft");
  await sidebar.getByRole("button", { name: "Cancel", exact: true }).click();
  await sidebar.getByRole("button", { name: "Edit task Other session task" }).click();
  assert.equal(await sidebar.getByRole("textbox", { name: "Task name", exact: true }).inputValue(), "Other session task");
  await sidebar.getByRole("button", { name: "Choose task model", exact: true }).click();
  await sidebar.getByRole("textbox", { name: "Search models", exact: true }).fill("Luna");
  await sidebar.getByRole("button", { name: "GPT-6 Luna", exact: true }).click();
  assert.equal(await sidebar.getByRole("combobox", { name: "Task effort" }).inputValue(), "high");
  await sidebar.getByRole("combobox", { name: "Task effort" }).selectOption("low");
  await sidebar.setViewportSize({ width: 280, height: 700 });
  assert.equal(await sidebar.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const saveBox = await sidebar.getByRole("button", { name: "Save task", exact: true }).boundingBox();
  assert.ok(saveBox && saveBox.y + saveBox.height <= 700, "Editor footer remains visible");
  await sidebar.screenshot({ path: `${evidence}/task-editor-280.png` });
  const save = client.upsertScheduledTask; client.upsertScheduledTask = async () => { throw new Error("Task save fixture failure"); };
  await sidebar.getByRole("button", { name: "Save task", exact: true }).click();
  await sidebar.getByText("Save failed. Your edits are kept; check the error above and retry.").waitFor();
  assert.equal(await sidebar.getByRole("combobox", { name: "Task effort" }).inputValue(), "low");
  client.upsertScheduledTask = save;
  await sidebar.getByRole("button", { name: "Save task", exact: true }).click();
  await sidebar.getByRole("textbox", { name: "Search tasks", exact: true }).waitFor();
  assert.equal(await sidebar.getByRole("textbox", { name: "Search tasks", exact: true }).inputValue(), "Other session");
  assert.equal(client.taskRuns.length, 0, "Saving does not run a task");
  assert.equal(client.scheduledTasks.find((task) => task.id === "other-monitor")?.modelSelection.options?.[0]?.value, "low");
  assert.deepEqual(host.snapshot("tab-two").threads.find((thread) => thread.id === "second")!.modelSelection, modelBefore);
  assert.equal(host.snapshot("tab-two").activeThreadId, "second"); assert.equal(host.snapshot("tab-three").activeThreadId, "third");
  assert.equal(await chat.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Keep my chat draft");
  await sidebar.getByRole("button", { name: "New task", exact: true }).click();
  await sidebar.getByRole("textbox", { name: "Task name", exact: true }).fill("Independent check");
  await sidebar.getByRole("textbox", { name: "Task prompt", exact: true }).fill("Read the log; report progress.");
  assert.equal(await sidebar.getByRole("combobox", { name: "Task result destination" }).inputValue(), "");
  assert.equal(await sidebar.getByRole("combobox", { name: "Task effort" }).inputValue(), "low");
  await sidebar.getByRole("button", { name: "Save task", exact: true }).click();
  await sidebar.getByRole("textbox", { name: "Search tasks", exact: true }).waitFor();
  const independent = client.scheduledTasks.find((task) => task.title === "Independent check")!;
  assert.equal(independent.threadId, null); assert.equal(host.snapshot().scheduledTasks?.tasks.find((task) => task.id === independent.id)?.originThreadId, null);
  await drawer.getByRole("button", { name: "Edit task Monitor this session" }).click();
  await sidebar.getByRole("combobox", { name: "Task result destination" }).selectOption("");
  await sidebar.getByRole("button", { name: "Save task", exact: true }).click();
  await drawer.getByRole("button", { name: "Edit task Monitor this session" }).waitFor();
  assert.equal(host.snapshot().scheduledTasks?.tasks.find((task) => task.id === "session-monitor")?.originThreadId, "second");
  await sidebar.getByRole("tab", { name: "Sessions", exact: true }).click();
  await sidebar.getByRole("textbox", { name: "Search threads", exact: true }).fill("");
  const secondRow = sidebar.locator('button.thread[data-thread-id="second"]'); const node = secondRow.locator("xpath=../..");
  const expand = node.locator(":scope > .session-tree-row > .session-tree-toggle");
  if (await expand.getAttribute("aria-expanded") !== "true") await expand.click();
  await node.getByRole("button", { name: "Edit task Monitor this session" }).waitFor();
  assert.equal(await node.locator("details.session-task-group").count(), 2);
  await sidebar.screenshot({ path: `${evidence}/session-task-groups-280.png` });
  assert.equal(await sidebar.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  console.log("PASS: scoped session/project tasks, independent creation, sidebar Save/Cancel/Back, failed saves, model/effort isolation, preserved drafts, origin retention and 280px layout.");
}
