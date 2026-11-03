import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeSourceStamp, nativeUndoGateFailure, recordNativeUndoPass } from "./nativeUndoGate.mjs";

test("Packaging is refused until native undo passes on this exact source, and again after any source change", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "undo-gate-")); t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  await mkdir(join(root, "src")); await writeFile(join(root, "src", "a.ts"), "one"); await writeFile(join(root, "package.json"), "{}");
  await writeFile(join(root, ".gitignore"), "target-installer/\n");
  assert.match(await nativeUndoGateFailure(root), /No real VS Code native-undo verification/);
  await recordNativeUndoPass(root);
  assert.equal(await nativeUndoGateFailure(root), null);
  const before = await computeSourceStamp(root);
  await writeFile(join(root, "src", "a.ts"), "two");
  assert.notEqual(await computeSourceStamp(root), before);
  assert.match(await nativeUndoGateFailure(root), /source changed after the last native-undo verification/);
  await writeFile(join(root, "src", "a.ts"), "one"); await writeFile(join(root, "src", "new.ts"), "untracked counts too");
  assert.match(await nativeUndoGateFailure(root), /source changed/);
});
