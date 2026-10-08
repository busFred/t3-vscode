import test from "node:test";
import assert from "node:assert/strict";
import { ScheduledTaskUpsertInput } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { FakeTransport, harness, provider, server } from "./testing/fakeTransport.js";
import { scheduledTaskFixture } from "./testing/scheduledTaskFixture.js";
import { newTaskModel, taskEditVersion, type TaskOrigin } from "../shared/scheduledTasks.js";

function fixture() {
  const client = new FakeTransport();
  client.config = { providers: [{ ...provider, models: [{ ...provider.models[0]!, slug: "gpt-6-luna", name: "GPT-6 Luna", capabilities: { optionDescriptors: [{ id: "reasoningEffort", type: "select", label: "Effort", options: [{ id: "low", label: "Low" }, { id: "high", label: "High" }] }] } }, ...provider.models] }] };
  const task = scheduledTaskFixture({ modelSelection: { instanceId: provider.instanceId, model: provider.models[0]!.slug, options: [{ id: "custom-existing-option", value: true }] },
    workspaceStrategy: { type: "worktree", baseRef: "training", startFromOrigin: false }, futureSetting: { preserve: true } });
  client.scheduledTasks = [task];
  let origins: ReadonlyArray<TaskOrigin> = [];
  const options = { taskOrigins: () => origins, saveTaskOrigin: async (origin: TaskOrigin) => { origins = [...origins, origin]; } };
  const edit = () => ({ ...task, existing: true, editVersion: taskEditVersion(task) });
  return { client, task, options, edit };
}
test("Task edits preserve modes, attribution, options and newer fields without changing chat or running", async (t) => {
  const { client, task, options, edit } = fixture(); const { host } = await harness(options, client); t.after(() => host.dispose());
  const before = host.snapshot();
  await host.saveScheduledTask({ ...edit(), title: "Monitor training", runtimeMode: "auto", creationSource: "web" });
  const saved = client.scheduledTasks[0]!;
  assert.equal(saved.title, "Monitor training");
  for (const key of ["runtimeMode", "interactionMode", "createdBy", "creationSource", "modelSelection", "workspaceStrategy", "futureSetting"] as const) assert.deepEqual(saved[key], task[key]);
  assert.equal((client.taskSaves[0] as Record<string, unknown>).requireExisting, true);
  assert.deepEqual(host.snapshot().threads, before.threads); assert.deepEqual(host.snapshot().draft, before.draft);
  assert.equal(client.commands.length, 0); assert.equal(client.taskRuns.length, 0);
  const replacement = newTaskModel(client.config.providers)!;
  await host.saveScheduledTask({ ...edit(), editVersion: taskEditVersion(saved), modelSelection: replacement });
  assert.deepEqual(client.scheduledTasks[0]!.modelSelection, replacement);
});
test("Project tasks can be independent; origin stays separate when results move", async (t) => {
  const { client, task, options, edit } = fixture(); const { host } = await harness(options, client); t.after(() => host.dispose());
  assert.equal(host.snapshot().scheduledTasks?.tasks[0]?.originThreadId, null, "Result binding is not proof of origin");
  await options.saveTaskOrigin({ environmentId: server.descriptor.environmentId, projectId: task.projectId, taskId: task.id, threadId: task.threadId });
  await host.saveScheduledTask({ ...edit(), threadId: null });
  assert.equal(host.snapshot().scheduledTasks?.tasks[0]?.originThreadId, task.threadId);
  await host.saveScheduledTask({ ...task, existing: false, id: "independent", threadId: null, modelSelection: newTaskModel(client.config.providers), originThreadId: null });
  const independent = host.snapshot().scheduledTasks?.tasks.find((task) => task.id === "independent");
  assert.equal(independent?.originThreadId, null); assert.equal(independent?.originKnown, true);
  assert.equal(client.taskRuns.length, 0);
});
test("Deleted, foreign, stale and invalid model tasks reject; scheduler progress does not cause false conflicts", async (t) => {
  const { client, task, options, edit } = fixture(); const { host } = await harness(options, client); t.after(() => host.dispose());
  await assert.rejects(host.saveScheduledTask({ ...edit(), projectId: "foreign" }), /Project/);
  await assert.rejects(host.saveScheduledTask({ ...edit(), modelSelection: { instanceId: provider.instanceId, model: "premium-missing" } }), /available model/);
  await assert.rejects(host.saveScheduledTask({ ...edit(), modelSelection: { ...newTaskModel(client.config.providers)!, options: [{ id: "reasoningEffort", value: "invented" }] } }), /advertised/);
  client.scheduledTasks = [{ ...task, runCount: 5, lastRunStatus: "running", updatedAt: "2026-10-08T00:00:00.000Z" as typeof task.updatedAt }];
  await host.saveScheduledTask(edit());
  client.scheduledTasks = [{ ...task, title: "Externally changed" }];
  await assert.rejects(host.saveScheduledTask(edit()), /changed elsewhere/);
  client.scheduledTasks = []; await assert.rejects(host.saveScheduledTask(edit()), /no longer exists/);
});
test("Unsupported schedules stay visible and use partial enable updates; unknown fields survive the wire schema", async (t) => {
  const { client, options, edit } = fixture();
  const webhook = scheduledTaskFixture({ schedule: { type: "webhook" }, futureSetting: { test: true } });
  client.scheduledTasks = [webhook]; const { host } = await harness(options, client); t.after(() => host.dispose());
  assert.equal(host.snapshot().scheduledTasks?.tasks.length, 1);
  await assert.rejects(host.saveScheduledTask({ ...edit(), editVersion: taskEditVersion(webhook) }), /newer schedule/);
  await host.setScheduledTaskEnabled(webhook.id, webhook.projectId, false);
  assert.deepEqual(client.scheduledTasks[0]!.schedule, { type: "webhook" }); assert.equal(client.taskSaves.length, 0);
  const input = Schema.decodeUnknownSync(ScheduledTaskUpsertInput)({ ...edit(), schedule: { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 3], futureZone: "keep" } });
  assert.deepEqual(Schema.encodeSync(ScheduledTaskUpsertInput)(input).schedule, { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 3], futureZone: "keep" });
  assert.deepEqual(input.futureSetting, { preserve: true });
});
test("New task model defaults never fall back to expensive or unavailable models", () => {
  const { client } = fixture(); assert.deepEqual(newTaskModel(client.config.providers)?.options, [{ id: "reasoningEffort", value: "low" }]);
  assert.equal(newTaskModel([provider]), null);
  assert.equal(newTaskModel(client.config.providers.map((provider) => ({ ...provider, enabled: false }))), null);
});

test("Task efforts reject new prompt-injected choices while preserving already saved options", async (t) => {
  const { client, options } = fixture();
  const selection = { instanceId: provider.instanceId, model: "claude-task", options: [{ id: "effort", value: "high" }] };
  client.config = { providers: [{ ...provider, models: [{ slug: "claude-task", name: "Claude task", isCustom: false, capabilities: {
    optionDescriptors: [{ id: "effort", type: "select", label: "Effort", promptInjectedValues: ["ultrathink"], options: [{ id: "high", label: "High", isDefault: true }, { id: "ultrathink", label: "Ultrathink" }] }],
  } }] }] };
  const task = scheduledTaskFixture({ modelSelection: selection }); client.scheduledTasks = [task];
  const { host } = await harness(options, client); t.after(() => host.dispose());
  await assert.rejects(host.saveScheduledTask({ ...task, existing: true, editVersion: taskEditVersion(task),
    modelSelection: { ...selection, options: [{ id: "effort", value: "ultrathink" }] } }), /controlled by prompt text/);
  assert.equal(client.taskSaves.length, 0);
  const legacy = { ...task, prompt: "ultrathink\nRead the training log.", modelSelection: { ...selection, options: [{ id: "effort", value: "ultrathink" }] } };
  client.scheduledTasks = [legacy];
  await host.saveScheduledTask({ ...legacy, existing: true, editVersion: taskEditVersion(legacy), title: "Rename only" });
  assert.deepEqual(client.scheduledTasks[0]!.modelSelection, legacy.modelSelection);
  assert.equal(client.scheduledTasks[0]!.prompt, legacy.prompt);
});
