import test from "node:test";
import assert from "node:assert/strict";
import { ProviderDriverKind, type ServerConfig } from "@t3tools/contracts";
import { FakeTransport, harness, provider } from "./testing/fakeTransport.js";
import { scheduledTaskFixture } from "./testing/scheduledTaskFixture.js";
import { taskEditVersion } from "../shared/scheduledTasks.js";

const policy = (limits: NonNullable<NonNullable<ServerConfig["managedPolicy"]>["limits"]>) => ({ organization: "Example", lockedSettings: [], limits });

test("managed runtime ceiling is shown, clamps drafts, and rejects prohibited changes", async (t) => {
  const client = new FakeTransport();
  client.config = { ...client.config, managedPolicy: policy({ maxRuntimeMode: "approval-required" }) };
  const { host } = await harness({}, client); t.after(() => host.dispose());
  assert.equal(host.snapshot().managedPolicy?.organization, "Example");
  assert.equal(host.snapshot().draft.runtimeMode, "approval-required");
  await assert.rejects(host.setModes(undefined, { runtimeMode: "full-access" }), /Example limits threads to Supervised/);
  await assert.rejects(host.setModes(host.snapshot().threads[0]!.id, { runtimeMode: "full-access" }), /Example limits threads to Supervised/);
});

test("managed driver restrictions prevent selecting disallowed models", async (t) => {
  const client = new FakeTransport();
  const allowed = ProviderDriverKind.make(provider.driver === "codex" ? "claude" : "codex");
  client.config = { ...client.config, managedPolicy: policy({ providers: { allowedDrivers: [allowed] } }) } as typeof client.config;
  const { host } = await harness({}, client); t.after(() => host.dispose());
  await assert.rejects(host.setModel(undefined, { instanceId: provider.instanceId, model: provider.models[0]!.slug }), /Example's policy does not allow/);
  assert.equal(host.snapshot().draft.modelSelection, null);
});

test("webhook policy blocks enabling or saving enabled hooks while allowing disabling", async (t) => {
  const client = new FakeTransport();
  client.config = { ...client.config, managedPolicy: policy({ webhookTasks: false }) };
  const task = scheduledTaskFixture({ schedule: { type: "webhook", filters: [] }, enabled: false, modelSelection: { instanceId: provider.instanceId, model: provider.models[0]!.slug } });
  client.scheduledTasks = [task];
  const { host } = await harness({}, client); t.after(() => host.dispose());
  await assert.rejects(host.setScheduledTaskEnabled(task.id, task.projectId, true), /Example's policy does not allow webhook tasks/);
  await assert.rejects(host.saveScheduledTask({ ...task, enabled: true, existing: true, editVersion: taskEditVersion(task) }), /Example's policy does not allow webhook tasks/);
  await host.setScheduledTaskEnabled(task.id, task.projectId, false);
  assert.equal(client.taskSaves.length, 0);
});
