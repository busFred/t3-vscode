import assert from "node:assert/strict";
import test from "node:test";
import { runningSubagentsAtRunTail, runStatusLabel, waitingOnSubagentsLabel } from "./waitingOnSubagents.js";

type Row = Parameters<typeof runningSubagentsAtRunTail>[0][number];
const row = (type: string, runId: string, status = "completed"): Row => ({ item: { type, runId, status } } as never);
const agent = (status: string, runId = "run-1") => row("subagent", runId, status);

test("Labels follow T3's wording", () => {
  assert.equal(waitingOnSubagentsLabel(1), "Waiting on a subagent");
  assert.equal(waitingOnSubagentsLabel(3), "Waiting on 3 subagents");
});

test("Live subagents at the run's tail replace Working", () => {
  assert.equal(runStatusLabel([row("user_message", "run-1"), row("reasoning", "run-1"), agent("running")], "run-1"), "Waiting on a subagent");
  assert.equal(runStatusLabel([agent("running"), agent("waiting"), agent("pending")], "run-1"), "Waiting on 3 subagents");
});

test("Only still-live subagents are counted, and a finished one beside them is skipped", () => {
  assert.equal(runningSubagentsAtRunTail([agent("running"), agent("completed"), agent("failed")], "run-1"), 1);
  assert.equal(runStatusLabel([agent("completed"), agent("cancelled")], "run-1"), "Working", "nothing live: the parent is still working");
});

test("Parent work after the subagents means it is not waiting", () => {
  for (const type of ["reasoning", "command_execution", "assistant_message", "user_message"]) {
    assert.equal(runStatusLabel([agent("running"), row(type, "run-1")], "run-1"), "Working", type);
  }
  assert.equal(runStatusLabel([agent("running"), row("command_execution", "run-1"), agent("running")], "run-1"), "Waiting on a subagent", "only the tail after the last parent step counts");
});

test("Another run's subagents, or no run, never count", () => {
  assert.equal(runningSubagentsAtRunTail([agent("running", "run-0")], "run-1"), 0);
  assert.equal(runningSubagentsAtRunTail([agent("running", "run-1"), agent("running", "run-0")], "run-1"), 0, "an other-run row at the tail stops the scan");
  assert.equal(runningSubagentsAtRunTail([agent("running")], null), 0);
  assert.equal(runningSubagentsAtRunTail([], "run-1"), 0);
});
