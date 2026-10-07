/** Two-stage native rendering fixture; only modifies an explicitly isolated T3 home. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as Schema from "effect/Schema";
import { OrchestrationV2TurnItemJson } from "@t3tools/contracts";
import { HostState } from "../src/host/hostState.js";
import { T3Client } from "../src/host/t3Client.js";
import { configureLiveTestModel } from "./liveTestModel.js";

const flag = process.argv.indexOf("--base-dir");
assert.ok(flag >= 0 && process.argv[flag + 1], "Pass --base-dir <isolated-T3-home>.");
const home = await realpath(resolve(process.argv[flag + 1]!));
const live = await realpath(join(homedir(), ".t3")).catch(() => join(homedir(), ".t3"));
assert.ok(home !== live && !home.startsWith(`${live}/`), "Never seed the user's normal T3 home.");
// A disposable base directory must not link its runtime, assets or workspace
// back into normal storage; validate existing writable paths before pairing.
async function rejectLinks(path: string): Promise<void> {
  const stat = await lstat(path).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
  if (!stat) return;
  assert.equal(stat.isSymbolicLink(), false, `Fixture paths must not contain symbolic links: ${path}`);
  if (stat.isDirectory()) for (const entry of await readdir(path)) await rejectLinks(join(path, entry));
}
for (const path of ["userdata", "workspace", "rich-chat-fixture.json", "rich-chat-items.json", "clipboard-fixture.png"]) await rejectLinks(join(home, path));
const metadataPath = join(home, "rich-chat-fixture.json");

if (process.argv.includes("--seed")) {
  const runtime = await readFile(join(home, "userdata/server-runtime.json"), "utf8").then(JSON.parse).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
  let running = false; if (runtime?.pid) { try { process.kill(runtime.pid, 0); running = true; } catch {} }
  assert.equal(running, false, "Stop this isolated T3 server before seeding; restart it afterward.");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  assert.equal(metadata.home, home);
  const items: unknown[] = JSON.parse(await readFile(join(home, "rich-chat-items.json"), "utf8"));
  const decoded = items.map((item) => Schema.encodeSync(OrchestrationV2TurnItemJson)(Schema.decodeUnknownSync(OrchestrationV2TurnItemJson)(item)));
  assert.ok(decoded.every((item) => item.threadId === metadata.threadId));
  const db = new DatabaseSync(join(home, "userdata/statev2.sqlite"));
  try {
    const messages = db.prepare("select count(*) as count from orchestration_v2_projection_messages where thread_id=?").get(metadata.threadId) as { count: number };
    assert.equal(messages.count, 0, "The fixture thread already contains messages; prepare a new fixture instead.");
    const thread = db.prepare("select title from orchestration_v2_projection_threads where thread_id=?").get(metadata.threadId) as { title: string } | undefined;
    assert.equal(thread?.title, "Rendering verification");
    db.exec("BEGIN IMMEDIATE");
    const put = db.prepare("insert or replace into orchestration_v2_projection_turn_items (turn_item_id,thread_id,run_id,node_id,provider_thread_id,provider_turn_id,parent_item_id,ordinal,type,status,updated_at,payload_json) values(?,?,?,?,?,?,?,?,?,?,?,?)");
    const position = db.prepare("insert or replace into orchestration_v2_turn_item_positions (thread_id,turn_item_id,ordinal) values(?,?,?)");
    for (const item of decoded) {
      put.run(item.id, item.threadId, item.runId, item.nodeId, item.providerThreadId ?? null, item.providerTurnId ?? null, item.parentItemId ?? null, item.ordinal, item.type, item.status, item.updatedAt, JSON.stringify(item));
      position.run(item.threadId, item.id, item.ordinal);
    }
    db.exec("COMMIT"); console.log(`Seeded ${decoded.length} validated items; restart the isolated server before --visuals-only.`);
  } finally { db.close(); }
} else {
  let credential: Parameters<ConstructorParameters<typeof HostState>[0]["credentials"]["save"]>[0] | null = null;
  const host = new HostState({ home, workspaceRoots: () => [join(home, "workspace")], credentials: { get: async () => credential, save: async (value) => { credential = value; }, clear: async () => { credential = null; } } }, new T3Client());
  try {
    await host.start(); assert.equal(host.snapshot().phase, "ready", "Start an isolated server with a configured provider first.");
    await configureLiveTestModel(host);
    const threadId = await host.newThread(); await host.threadAction(threadId, "rename", "Rendering verification");
    const htmlAttachmentId = `${threadId}-${randomUUID()}-html`;
    const imageAttachmentId = `${threadId}-${randomUUID()}`;
    const now = new Date().toISOString();
    const items: unknown[] = [];
    const add = (fields: Record<string, unknown>) => { const ordinal = items.length; items.push({ id: `rich-fixture-${randomUUID()}`, threadId, runId: null, nodeId: null, providerThreadId: null, providerTurnId: null, nativeItemRef: null, parentItemId: null, title: null, status: "completed", ordinal, startedAt: now, completedAt: now, updatedAt: now, ...fields }); };
    const message = (text: string, attachments: unknown[] = []) => add({ type: "user_message", messageId: randomUUID(), createdBy: "user", creationSource: "web", inputIntent: "turn_start", text, attachments });
    for (let index = 0; index < 25; index++) { message(`Verification prompt ${index}`); add({ type: "assistant_message", messageId: randomUUID(), text: `Verification response ${index}`, streaming: false }); }
    const png = await readFile(new URL("../resources/t3-extension.png", import.meta.url));
    message("Show this screenshot, the actual mockup, diagrams and ML equations.", [{ type: "image", id: imageAttachmentId, name: "screenshot.png", mimeType: "image/png", sizeBytes: png.length }]);
    for (let index = 0; index < 12; index++) add({ type: "command_execution", input: index === 0 ? "printf 'command height verification with a long single line'" : `echo verification-${index}`, output: index === 0 ? Array.from({ length: 80 }, (_, line) => `Output line ${line}`).join("\n") : `verification-${index}`, exitCode: 0 });
    add({ type: "reasoning", text: "Collapsed reasoning verification", streaming: false });
    add({ type: "dynamic_tool", toolName: "html_render", input: {}, output: { htmlRender: { attachmentId: htmlAttachmentId, title: "Actual T3 navigation mockup", height: 1650, heights: [[360, 1422], [728, 728]] } } });
    add({ type: "assistant_message", messageId: randomUUID(), streaming: false, text: "Inline math: $p(y\\mid x)=\\operatorname{softmax}(Wx+b)$.\n\n$$\\mathcal{L}=-\\frac1N\\sum_{i=1}^N\\log p(y_i\\mid x_i)$$\n\n\\[\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}\\]\n\n```mermaid\nflowchart LR\nInput --> Encoder --> Prediction\n```\n\n![Local diagram](visual-image.svg)" });
    items.forEach((item) => Schema.decodeUnknownSync(OrchestrationV2TurnItemJson)(item));
    const attachments = join(home, "userdata/attachments"); await mkdir(attachments, { recursive: true });
    await writeFile(join(attachments, `${imageAttachmentId}.png`), png);
    await writeFile(join(home, "clipboard-fixture.png"), png);
    await writeFile(join(attachments, `${htmlAttachmentId}.html`), await readFile(new URL("../docs/mockups/timeline-minimap.html", import.meta.url)));
    await writeFile(join(home, "workspace/visual-image.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect width="240" height="80" fill="#165ba8"/><text x="20" y="48" fill="white">Inline diagram</text></svg>');
    await writeFile(join(home, "rich-chat-items.json"), JSON.stringify(items));
    await writeFile(metadataPath, JSON.stringify({ home, threadId, htmlAttachmentId, imageAttachmentId, itemCount: items.length }));
    console.log("Prepared isolated fixture. Stop that server, run this command with --seed, then restart it and run --visuals-only.");
  } finally { await host.dispose(); }
}
