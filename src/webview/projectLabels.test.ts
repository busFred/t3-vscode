import test from "node:test";
import assert from "node:assert/strict";
import { projectOptionLabel } from "./projectLabels";

test("Project options name their machine when the name repeats or the project is remote", () => {
  const projects = [{ id: "a", title: "t3-vscode", workspaceRoot: "/a" }, { id: "b", title: "t3-vscode", workspaceRoot: "/b", environmentLabel: "GPU box" }, { id: "c", title: "notes", workspaceRoot: "/c" }];
  const state = { projects, environments: { local: { label: "Laptop", host: "localhost" }, indicator: "ok" as const, rows: [] }, environment: undefined } as never;
  assert.deepEqual(projects.map((project) => projectOptionLabel(state, project)), ["Laptop", "GPU box", "notes"]);
});


test("same-machine repeated names use paths to keep multi-root choices distinct", () => {
  const projects = [{ id: "a", title: "app", workspaceRoot: "/a" }, { id: "b", title: "app", workspaceRoot: "/b" }];
  assert.deepEqual(projects.map((project) => projectOptionLabel({ projects }, project)), ["app · /a", "app · /b"]);
});
