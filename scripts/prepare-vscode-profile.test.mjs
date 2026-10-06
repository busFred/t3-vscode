import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareDefaultProfile } from "./prepare-vscode-profile.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "t3-vscode-profile-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "repo");
  const sourceUserData = join(root, "normal-user-data");
  const sourceExtensions = join(root, "normal-extensions");
  await mkdir(workspace);
  await mkdir(join(sourceUserData, "User"), { recursive: true });
  await mkdir(join(sourceExtensions, "fixture.theme-1.0.0"), { recursive: true });
  const settings = '{\n // Default settings\n "editor.fontSize": 15\n}\n';
  await writeFile(join(sourceUserData, "User", "settings.json"), settings);
  await writeFile(join(sourceExtensions, "fixture.theme-1.0.0", "package.json"), '{"name":"theme","version":"1.0.0"}');
  const entries = [{ identifier: { id: "fixture.theme" }, version: "1.0.0", relativeLocation: "fixture.theme-1.0.0", location: { scheme: "file", path: join(sourceExtensions, "fixture.theme-1.0.0") } }];
  await writeFile(join(sourceExtensions, "extensions.json"), JSON.stringify(entries));
  return { workspace, sourceUserData, sourceExtensions, settings, entries };
}

test("Development profile copies Default without sharing files or changing its extension list", async (t) => {
  const f = await fixture(t);
  const prepared = await prepareDefaultProfile(f);
  const settingsPath = join(prepared.userData, "User", "settings.json");
  assert.equal(await readFile(settingsPath, "utf8"), f.settings);
  const copied = JSON.parse(await readFile(join(prepared.extensions, "extensions.json"), "utf8"));
  assert.equal(copied[0].location.path, join(prepared.extensions, "fixture.theme-1.0.0"));
  await writeFile(settingsPath, "{}");
  await writeFile(join(prepared.extensions, "fixture.theme-1.0.0", "package.json"), "{}");
  assert.equal(await readFile(join(f.sourceUserData, "User", "settings.json"), "utf8"), f.settings);
  assert.deepEqual(JSON.parse(await readFile(join(f.sourceExtensions, "extensions.json"), "utf8")), f.entries);
  assert.notEqual(await readFile(join(f.sourceExtensions, "fixture.theme-1.0.0", "package.json"), "utf8"), "{}");
  assert.deepEqual(await prepareDefaultProfile(f), prepared);
  assert.equal(await readFile(settingsPath, "utf8"), "{}");
});

test("A linked development state directory cannot redirect setup into the normal installation", async (t) => {
  const f = await fixture(t);
  await symlink(f.sourceUserData, join(f.workspace, ".t3"));
  await assert.rejects(prepareDefaultProfile(f), /linked development directory/);
  assert.equal(await readFile(join(f.sourceUserData, "User", "settings.json"), "utf8"), f.settings);
});
