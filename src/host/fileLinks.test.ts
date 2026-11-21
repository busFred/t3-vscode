import test from "node:test";
import assert from "node:assert/strict";
import { resolveChatFileLink } from "./fileLinks.js";
import { join } from "node:path";

test("Chat file links resolve workspace files and precise single-line or range locations", () => {
  assert.deepEqual(resolveChatFileLink("src/main.ts:24:6", "/tmp/workspace"), { path: "/tmp/workspace/src/main.ts", line: 24, column: 6 });
  assert.deepEqual(resolveChatFileLink("file:///tmp/space%20file.md#L24-L25", null), { path: "/tmp/space file.md", line: 24, column: 1, endLine: 25 });
  assert.deepEqual(resolveChatFileLink("<src/main.ts#L24C6-L26C8>", "/tmp/workspace"), { path: "/tmp/workspace/src/main.ts", line: 24, column: 6, endLine: 26, endColumn: 8 });
  assert.deepEqual(resolveChatFileLink("/tmp/file.md#L8C3", null), { path: "/tmp/file.md", line: 8, column: 3 });
});
test("File URLs decode once and missing workspaces or unsupported schemes cannot become editor paths", () => {
  assert.deepEqual(resolveChatFileLink("file:///tmp/literal%2520name.md#L2", null), { path: "/tmp/literal%20name.md", line: 2 });
  assert.throws(() => resolveChatFileLink("src/main.ts", null), /no workspace/);
  for (const href of ["command:delete", "https://example.com", "javascript:alert(1)", "#L2"]) assert.throws(() => resolveChatFileLink(href, "/tmp/workspace"), /Unsupported/);
  for (const href of ["file.md#L0-L2", "file.md#L8-L2", "file.md#L2C8-L2C2"]) assert.throws(() => resolveChatFileLink(href, "/tmp/workspace"), /Invalid file range/);
});
test("~/ and ~\\ links open from the home folder, not the thread folder", () => {
  assert.deepEqual(resolveChatFileLink("~/notes/a.md:3", "/tmp/workspace", "/home/me"), { path: "/home/me/notes/a.md", line: 3 });
  assert.deepEqual(resolveChatFileLink("~\\notes\\a.md", "/tmp/workspace", "/home/me").path, join("/home/me", "notes\\a.md"));
  assert.equal(resolveChatFileLink("~/a.md", null, "/home/me").path, "/home/me/a.md");
  assert.equal(resolveChatFileLink("~other/a.md", "/tmp/workspace", "/home/me").path, "/tmp/workspace/~other/a.md");
});

test("~/ links on a remote machine's thread are not expanded against this machine's home", () => {
  assert.equal(resolveChatFileLink("~/a.md", "/srv/work", null).path, "/srv/work/~/a.md");
  assert.throws(() => resolveChatFileLink("~/a.md", null, null));
});
