import assert from "node:assert/strict";
import test from "node:test";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { buildComposerClipboard, parseComposerClipboardHtml, planComposerPaste } from "./composerClipboard.js";
import { insertAttachmentReferences, type DraftAttachment } from "./composerAttachments.js";
import type { AssistantQuoteContext, FileReference } from "./composerContext.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a53sAAAAASUVORK5CYII=";
const image = (contextId: string, name = "shot.png", extra: Partial<DraftAttachment> = {}): DraftAttachment => ({ key: `key-${contextId}`, contextId, name, mimeType: "image/png", sizeBytes: 70, previewUrl: PNG, ...extra });
const quote: AssistantQuoteContext = { type: "assistant", contextId: "quote_a", citation: { version: 1, environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread"), messageId: MessageId.make("message"), start: 0, end: 5, text: "Hello", prefix: "", suffix: "" } as AssistantQuoteContext["citation"] };
const file: FileReference = { type: "file", uri: "file:///w/a.ts", path: "a.ts", label: "a.ts", inlineText: "@a.ts" };
const counter = () => { let n = 0; return () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`; };
const ref = (id: string, label = "shot.png") => `![${label}](t3-context://v1/image/${id})`;
const NONCE = "session-nonce";
const copy = (text: string, attachments: DraftAttachment[] = [], contexts: Array<AssistantQuoteContext | FileReference> = [], selection = { start: 0, end: text.length }) => buildComposerClipboard({ text, contexts, attachments }, selection, NONCE);
const encode = (value: unknown) => btoa(JSON.stringify(value));

test("Copy carries the image as readable text, an embedded <img> and a payload that parses back", () => {
  const text = `Look ${ref("image_a")}\nand more`;
  const clip = copy(text, [image("image_a")])!;
  assert.equal(clip.plain, "Look shot.png\nand more");
  assert.ok(clip.html.includes(`<img data-t3-context-id="image_a" src="${PNG}" alt="shot.png">`) && clip.html.includes("<br>") && !clip.html.includes("t3-context://"));
  assert.equal(clip.image, undefined);
  const payload = parseComposerClipboardHtml(`<html><body><!--StartFragment-->${clip.html}<!--EndFragment--></body></html>`)!;
  assert.equal(payload.text, text);
  assert.deepEqual(payload.attachments.map((file) => [file.contextId, file.name, file.previewUrl]), [["image_a", "shot.png", PNG]]);
});
test("A selection that is one image also offers it as a file; text around it does not", () => {
  const clip = copy(` ${ref("image_a", "a < b")} `, [image("image_a", "a.png")])!;
  assert.deepEqual(clip.image, { dataUrl: PNG, name: "a.png" });
  assert.ok(clip.html.includes('alt="a &lt; b"'));
  assert.equal(copy(`x ${ref("image_a")}`, [image("image_a")])!.image, undefined);
});
test("Plain selections are left to the browser, and a half-selected reference is widened to the whole token", () => {
  assert.equal(copy("just words", [image("image_a")]), undefined);
  assert.equal(copy(`${ref("image_a")}`, [image("image_a")], [], { start: 3, end: 3 }), undefined);
  const text = `ab ${ref("image_a")} cd`;
  assert.deepEqual(copy(text, [image("image_a")], [], { start: 1, end: text.indexOf("(t3-") + 4 })!.range, { start: 1, end: text.indexOf(" cd") });
});
test("An unbacked reference still copies as its label, never as a t3-context URL", () => {
  const clip = copy(`${ref("image_gone", "lost.png")} / [doc.pdf](t3-context://v1/file/file_1)`, [image("image_a")])!;
  assert.equal(clip.plain, "lost.png / doc.pdf");
  assert.ok(!clip.html.includes("<img") && !clip.html.includes("t3-context://"));
  assert.equal(clip.image, undefined);
});
test("Quotes and @ file references travel in the payload with only what the selection holds", () => {
  const other = { ...quote, contextId: "quote_b" };
  const clip = copy(`See [❝1 Hello](t3-context://v1/assistant-quote/quote_a) and @a.ts`, [], [quote, other, file])!;
  const payload = parseComposerClipboardHtml(clip.html, NONCE)!;
  assert.deepEqual(payload.contexts.map((context) => context.type === "assistant" ? context.contextId : context.inlineText), ["quote_a", "@a.ts"]);
  assert.equal(clip.plain, "See ❝1 Hello and @a.ts");
});
test("Hostile or malformed clipboard HTML is ignored or rejected", () => {
  assert.equal(parseComposerClipboardHtml("<b>plain html</b>"), undefined);
  assert.equal(parseComposerClipboardHtml('<span data-t3-composer="bm90IGpzb24="></span>'), undefined);
  assert.equal(parseComposerClipboardHtml(`<span data-t3-composer="${encode({ v: 1, nonce: NONCE, text: "x", contexts: [{ type: "file" }], attachments: [] })}"></span>`, NONCE), undefined);
  assert.equal(parseComposerClipboardHtml(`<span data-t3-composer="${encode({ v: 1, text: "x", contexts: [], attachments: [{ key: "k", contextId: "image_a", name: "a.png", mimeType: "image/png", sizeBytes: 5 }] })}"><img data-t3-context-id="image_a" src="data:image/svg+xml;base64,AAAA"></span>`), undefined);
});

test("Pasting into another draft recreates the image with a fresh id and keeps the text around it in order", () => {
  const clip = copy(`one ${ref("image_a", "described")} two ${ref("image_a", "again")}`, [image("image_a")])!;
  const payload = parseComposerClipboardHtml(clip.html)!;
  const draft = { text: "Before  after", contexts: [], attachments: [] };
  const plan = planComposerPaste(payload, draft, { start: 7, end: 7 }, counter());
  const references = collectComposerContextReferences(plan.text);
  assert.equal(plan.text.replace(/!\[[^\]]*]\([^)]*\)/g, "#"), "Before one # two # after");
  assert.deepEqual(references.map((reference) => reference.label), ["described", "again"]);
  assert.equal(references[0]!.contextId, references[1]!.contextId); assert.notEqual(references[0]!.contextId, "image_a");
  assert.deepEqual(plan.attachments.map((file) => [file.contextId, file.pending, file.previewUrl, file.name]), [[references[0]!.contextId, true, PNG, "shot.png"]]);
  assert.deepEqual(plan.uploads.map((upload) => [upload.key, upload.input.type, upload.input.sizeBytes]), [[plan.attachments[0]!.key, "image", 67]]);
  assert.equal(plan.cursor, plan.text.indexOf(" after"));
});
test("The pasted reference is the one typing an attachment would produce", () => {
  const payload = parseComposerClipboardHtml(copy(ref("image_a"), [image("image_a")])!.html)!;
  const plan = planComposerPaste(payload, { text: "", contexts: [], attachments: [] }, { start: 0, end: 0 }, counter());
  const typed = insertAttachmentReferences("", [plan.attachments[0]!], { start: 0, end: 0 });
  assert.equal(plan.text, typed.text); assert.equal(plan.cursor, typed.cursor);
});
test("Copy then paste in the same draft mints a second attachment; cut then paste takes the first back", () => {
  const original = image("image_a", "shot.png", { attachment: { id: "att", type: "image", name: "shot.png", mimeType: "image/png", sizeBytes: 70 } });
  const text = `${ref("image_a")} tail`;
  const clip = copy(text, [original], [], { start: 0, end: ref("image_a").length })!;
  const payload = parseComposerClipboardHtml(clip.html)!;
  const copied = planComposerPaste(payload, { text, contexts: [], attachments: [original] }, { start: text.length, end: text.length }, counter());
  assert.equal(copied.uploads.length, 1); assert.equal(new Set(collectComposerContextReferences(copied.text).map((reference) => reference.contextId)).size, 2);
  const cut = planComposerPaste(payload, { text: " tail", contexts: [], attachments: [original] }, { start: 5, end: 5 }, counter());
  assert.equal(cut.uploads.length, 0); assert.equal(cut.attachments.length, 0);
  assert.equal(cut.text, ` tail${ref("image_a")}`);
});
test("Quotes keep their id in a new draft, get a fresh one when it is in use, and file tokens never hijack another file", () => {
  const payload = parseComposerClipboardHtml(copy("[❝1 Hello](t3-context://v1/assistant-quote/quote_a) @a.ts", [], [quote, file])!.html, NONCE)!;
  const empty = planComposerPaste(payload, { text: "", contexts: [], attachments: [] }, { start: 0, end: 0 }, counter());
  assert.deepEqual(empty.contexts.map((context) => context.type === "assistant" ? context.contextId : context.inlineText), ["quote_a", "@a.ts"]);
  assert.equal(empty.text, payload.text);
  const both = planComposerPaste(payload, { text: empty.text, contexts: empty.contexts, attachments: [] }, { start: empty.text.length, end: empty.text.length }, counter());
  const ids = collectComposerContextReferences(both.text).map((reference) => reference.contextId);
  assert.equal(new Set(ids).size, 2);
  assert.deepEqual(both.contexts.filter((context) => context.type === "assistant").map((context) => context.contextId), ids);
  assert.equal(both.contexts.filter((context) => context.type === "file").length, 1);
  const elsewhere = planComposerPaste(payload, { text: "", contexts: [{ ...file, uri: "file:///w/other/a.ts" }], attachments: [] }, { start: 0, end: 0 }, counter());
  assert.deepEqual(elsewhere.contexts.filter((context) => context.type === "file").map((context) => context.inlineText), ["@a.ts", undefined]);
});
test("What cannot be attached degrades to its label: attach off, a non-image, a payload image that is not one", () => {
  const payload = parseComposerClipboardHtml(copy(`${ref("image_a", "pic")} [doc.pdf](t3-context://v1/file/file_1)`, [image("image_a")])!.html)!;
  const plan = planComposerPaste(payload, { text: "", contexts: [], attachments: [] }, { start: 0, end: 0 }, counter(), false);
  assert.equal(plan.text, "pic doc.pdf"); assert.equal(plan.uploads.length, 0);
  const tiny = { ...payload, attachments: [{ ...payload.attachments[0]!, previewUrl: "data:image/png;base64,AAAA" }] };
  assert.equal(planComposerPaste(tiny, { text: "", contexts: [], attachments: [] }, { start: 0, end: 0 }, counter()).uploads.length, 1);
});
test("Pasting replaces the selected text and never splits a reference in the destination", () => {
  const payload = parseComposerClipboardHtml(copy(ref("image_a", "new"), [image("image_a")])!.html)!;
  const text = `keep ${ref("image_b", "old")} end`;
  const inside = text.indexOf("old");
  const plan = planComposerPaste(payload, { text, contexts: [], attachments: [] }, { start: inside, end: inside }, counter());
  assert.deepEqual(collectComposerContextReferences(plan.text).map((reference) => reference.label), ["old", "new"]);
});

test("A payload without this session's nonce pastes only visible text and images, never hidden file or quote contexts", () => {
  const text = "[❝1 Hello](t3-context://v1/assistant-quote/quote_a) @a.ts";
  const unsigned = buildComposerClipboard({ text, contexts: [quote, file], attachments: [] }, { start: 0, end: text.length })!.html;
  const otherSession = buildComposerClipboard({ text, contexts: [quote, file], attachments: [] }, { start: 0, end: text.length }, "other-session")!.html;
  for (const [html, nonce] of [[unsigned, NONCE], [otherSession, NONCE], [copy(text, [], [quote, file])!.html, undefined]] as const) {
    const payload = parseComposerClipboardHtml(html, nonce)!;
    assert.deepEqual(payload.contexts, []);
    const pasted = planComposerPaste(payload, { text: "", contexts: [], attachments: [] }, { start: 0, end: 0 }, counter());
    assert.deepEqual(pasted.contexts, []);
    assert.equal(pasted.text, "❝1 Hello @a.ts");
  }
  assert.equal(parseComposerClipboardHtml(`<span data-t3-composer="${encode({ v: 1, text: "x".repeat(200_001), contexts: [], attachments: [] })}"></span>`), undefined);
});
