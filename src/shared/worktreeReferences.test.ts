import assert from "node:assert/strict";
import test from "node:test";
import { fileReferenceOccurrences, formatComposerMessage, insertFileReference, type FileReference } from "./composerContext.js";
import { relabelWorktreeReferences } from "./worktreeReferences.js";

const reference: FileReference = { type: "file", uri: "file:///project/src/train.py", path: "src/train.py", label: "src/train.py", range: { start: { line: 2, column: 3 }, end: { line: 4, column: 1 } }, text: "unsaved snapshot" };

test("changing to a new or different checkout prepends the actual source directory and preserves payloads", () => {
  const inserted = insertFileReference("Explain ", [], reference, { start: 8, end: 8 });
  const external = relabelWorktreeReferences(inserted.text, inserted.contexts, null)!;
  assert.equal(external.text, "Explain @/project/src/train.py:2-3 ");
  const context = external.contexts[0] as FileReference;
  assert.deepEqual({ uri: context.uri, path: context.path, range: context.range, text: context.text }, { uri: reference.uri, path: reference.path, range: reference.range, text: reference.text });
  assert.equal(external.map(inserted.cursor), external.text.length);
  assert.ok(formatComposerMessage(external.text, external.contexts).includes("[@/project/src/train.py:2-3](file:///project/src/train.py#L2-L3)"));
  assert.equal(relabelWorktreeReferences(external.text, external.contexts, "/worktrees/attempt"), null);
  const local = relabelWorktreeReferences(external.text, external.contexts, "/project")!;
  assert.equal(local.text, inserted.text);
  assert.equal((local.contexts[0] as FileReference).label, reference.label);
});

test("directory boundaries keep similarly named checkouts external, and spaces remain quoted", () => {
  const other = { ...reference, uri: "file:///project-other/notes%20here.md", label: "notes here.md", path: "notes here.md" };
  const inserted = insertFileReference("", [], other, { start: 0, end: 0 });
  const external = relabelWorktreeReferences(inserted.text, inserted.contexts, "/project")!;
  assert.equal(external.text, '@"/project-other/notes here.md:2-3" ');
  assert.equal(fileReferenceOccurrences(external.text, external.contexts).length, 1);
});

test("relabeling preserves deleted tokens, surrounding text, attachments and distinct partial selections", () => {
  const first = insertFileReference("Before ", [], reference, { start: 7, end: 7 });
  const second = insertFileReference(first.text, first.contexts, { ...reference, range: { start: { line: 2, column: 5 }, end: { line: 4, column: 1 } }, text: "another selection" }, { start: first.cursor, end: first.cursor });
  const image = "[plot](t3-context://v1/image/plot)";
  const external = relabelWorktreeReferences(`${second.text}${image}`, second.contexts, "/worktree")!;
  assert.equal(fileReferenceOccurrences(external.text, external.contexts).length, 2);
  assert.ok(external.text.includes("@/project/src/train.py:2:3-4:1"));
  assert.ok(external.text.includes("@/project/src/train.py:2:5-4:1"));
  assert.ok(external.text.endsWith(image));
  assert.equal(relabelWorktreeReferences("User removed the token", first.contexts, null)?.text, "User removed the token");
});

test("Windows URI paths resolve same-checkout paths without losing case or source identity", () => {
  const item = { ...reference, uri: "file:///C:/Project/src/train.py", path: "C:\\Project\\src\\train.py", label: "C:/Project/src/train.py" };
  const inserted = insertFileReference("", [], item, { start: 0, end: 0 });
  const local = relabelWorktreeReferences(inserted.text, inserted.contexts, "c:\\project")!;
  assert.equal((local.contexts[0] as FileReference).label, "src/train.py");
  assert.equal((local.contexts[0] as FileReference).uri, item.uri);
});
