/** Synthetic demo conversations for screenshots of the real extension; no provider turns. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as Schema from "effect/Schema";
import { OrchestrationV2TurnItemJson } from "@t3tools/contracts";
import { HostState } from "../src/host/hostState.js";
import { T3Client } from "../src/host/t3Client.js";
import { configureLiveTestModel } from "./liveTestModel.js";

const flag = process.argv.indexOf("--base-dir");
assert.ok(flag >= 0 && process.argv[flag + 1], "Pass --base-dir <disposable-T3-home-in-tmp>.");
const home = await realpath(resolve(process.argv[flag + 1]!));
const temporary = await realpath(tmpdir());
const live = await realpath(join(homedir(), ".t3")).catch(() => join(homedir(), ".t3"));
assert.ok(home.startsWith(`${temporary}/`) && home !== live && !home.startsWith(`${live}/`), "Use a disposable directory under the OS temporary directory.");
async function rejectLinks(path: string): Promise<void> {
  const stat = await lstat(path).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (!stat) return;
  assert.equal(stat.isSymbolicLink(), false, `Screenshot fixture cannot follow a link: ${path}`);
  if (stat.isDirectory()) for (const entry of await readdir(path)) await rejectLinks(join(path, entry));
}
for (const entry of ["userdata", "workspace", "readme-fixture.json"]) await rejectLinks(join(home, entry));
const metadataPath = join(home, "readme-fixture.json");
if (process.argv.includes("--seed")) {
  const runtime = await readFile(join(home, "userdata/server-runtime.json"), "utf8").then(JSON.parse).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  let running = false; if (runtime?.pid) { try { process.kill(runtime.pid, 0); running = true; } catch {} }
  assert.equal(running, false, "Stop the isolated server before seeding its prepared empty conversations.");
  const fixture = JSON.parse(await readFile(metadataPath, "utf8"));
  assert.equal(fixture.home, home);
  const items = (fixture.items as unknown[]).map(item => Schema.encodeSync(OrchestrationV2TurnItemJson)(Schema.decodeUnknownSync(OrchestrationV2TurnItemJson)(item)));
  const ids = new Set(Object.values(fixture.threads));
  assert.ok(items.every(item => ids.has(item.threadId)));
  const db = new DatabaseSync(join(home, "userdata/statev2.sqlite"));
  try {
    for (const threadId of ids) {
      const count = db.prepare("select count(*) as count from orchestration_v2_projection_turn_items where thread_id=?").get(threadId as string) as { count: number };
      assert.equal(count.count, 0, "Only seed newly prepared empty conversations.");
    }
    db.exec("BEGIN IMMEDIATE");
    const put = db.prepare("insert into orchestration_v2_projection_turn_items (turn_item_id,thread_id,run_id,node_id,provider_thread_id,provider_turn_id,parent_item_id,ordinal,type,status,updated_at,payload_json) values(?,?,?,?,?,?,?,?,?,?,?,?)");
    const position = db.prepare("insert into orchestration_v2_turn_item_positions (thread_id,turn_item_id,ordinal) values(?,?,?)");
    for (const item of items) {
      put.run(item.id, item.threadId, item.runId, item.nodeId, null, null, null, item.ordinal, item.type, item.status, item.updatedAt, JSON.stringify(item));
      position.run(item.threadId, item.id, item.ordinal);
    }
    db.exec("COMMIT");
    console.log(`Seeded ${items.length} demo items without calling a model; restart the isolated server.`);
  } finally { db.close(); }
} else {
  let credential: Parameters<ConstructorParameters<typeof HostState>[0]["credentials"]["save"]>[0] | null = null;
  const host = new HostState({ home, workspaceRoots: () => [join(home, "workspace")], credentials: { get: async () => credential, save: async value => { credential = value; }, clear: async () => { credential = null; } } }, new T3Client());
  try {
    await host.start(); assert.equal(host.snapshot().phase, "ready", "Start the isolated server first.");
    await configureLiveTestModel(host);
    const previous = await readFile(metadataPath, "utf8").then(JSON.parse).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (previous) {
      assert.equal(previous.home, home);
      for (const threadId of Object.values(previous.threads) as string[]) await host.threadAction(threadId, "archive");
    }
    const threads: Record<string, string> = {};
    const items: unknown[] = [];
    const now = new Date().toISOString();
    let currentThread = "", ordinal = 0;
    const thread = async (key: string, title: string) => {
      currentThread = await host.newThread(); threads[key] = currentThread; ordinal = 0;
      await host.threadAction(currentThread, "rename", title);
    };
    const add = (fields: Record<string, unknown>) => items.push({ id: `readme-${randomUUID()}`, threadId: currentThread, runId: null, nodeId: null, providerThreadId: null, providerTurnId: null, nativeItemRef: null, parentItemId: null, title: null, status: "completed", ordinal: ordinal++, startedAt: now, completedAt: now, updatedAt: now, ...fields });
    const user = (text: string) => add({ type: "user_message", messageId: randomUUID(), createdBy: "user", creationSource: "web", inputIntent: "turn_start", text, attachments: [] });
    const assistant = (text: string) => add({ type: "assistant_message", messageId: randomUUID(), streaming: false, text });
    await thread("math", "Understanding cross-entropy");
    user("Explain cross-entropy loss and show how its gradient reaches the logits.");
    assistant(String.raw`### From probabilities to gradients

For one example, cross-entropy compares the target distribution $y$ with the model's predicted probabilities $p$:

$$
\mathcal{L}(y,p)=-\sum_{k=1}^{K}y_k\log p_k
$$

With a one-hot target, only the correct class contributes. If its predicted probability is $0.8$, the loss is $-\log(0.8)\approx 0.223$.

### The useful simplification

Combining softmax with cross-entropy gives a compact gradient with respect to each logit $z_k$:

$$
\frac{\partial\mathcal{L}}{\partial z_k}=p_k-y_k
$$

| Class | Prediction | Target | Gradient |
| :--- | ---: | ---: | ---: |
| Cat | 0.80 | 1 | −0.20 |
| Dog | 0.15 | 0 | +0.15 |
| Bird | 0.05 | 0 | +0.05 |

Gradient descent raises the correct class's logit and lowers the others. Autodiff carries this signal through the earlier layers.`);
    await thread("visuals", "Sketch the training pipeline");
    user("Show the training pipeline, then compare our three experiment runs.");
    assistant("### A small, reproducible training loop\n\n```mermaid\nflowchart LR\n  A[Dataset] --> B[Encoder]\n  B --> C[Classifier]\n  C --> D[Loss]\n  D -. gradients .-> B\n```\n\nKeep the validation split fixed so the experiment scores stay comparable.");
    const htmlAttachmentId = `${currentThread}-${randomUUID()}-html`;
    add({ type: "dynamic_tool", toolName: "html_render", input: {}, output: { htmlRender: { attachmentId: htmlAttachmentId, title: "Experiment comparison", height: 290 } } });
    const plot = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:20px;font:14px system-ui;color:var(--foreground,#ddd);background:var(--background,#202020)}h2{font-size:17px;margin:0 0 6px}p{opacity:.75;margin:0 0 18px}.row{display:grid;grid-template-columns:95px 1fr 50px;align-items:center;gap:14px;margin:15px 0}.bar{height:16px;background:#458ed8;border-radius:3px}.row:nth-of-type(2) .bar{background:#4dab94}.row:nth-of-type(3) .bar{background:#a78bfa}button{font:inherit;background:transparent;color:inherit;border:1px solid #8888;border-radius:4px;padding:4px 10px;margin-top:8px}small{display:block;margin-top:14px;opacity:.65}
</style></head><body><h2>Validation accuracy</h2><p>Same dataset, split and training budget.</p><div class="row">Baseline<div class="bar" style="width:81%"></div><b>81.2%</b></div><div class="row">Augmented<div class="bar" style="width:87%"></div><b>87.4%</b></div><div class="row">Fine-tuned<div class="bar" style="width:91%"></div><b>91.1%</b></div><button onclick="document.querySelector('small').hidden=!document.querySelector('small').hidden">Experiment notes</button><small hidden>Synthetic demonstration data · 3 seeds per run</small></body></html>`;
    await mkdir(join(home, "userdata/attachments"), { recursive: true });
    await writeFile(join(home, "userdata/attachments", `${htmlAttachmentId}.html`), plot);
    await thread("review", "Review the training loop");
    user("Check the loss computation and suggest a minimal change for numerical stability.");
    for (const [input, output] of [["cat train.py", "# Read the current training step"], ["python -m pytest tests/test_loss.py -q", "3 passed in 0.42s"], ["git diff --check", ""]]) add({ type: "command_execution", input, output, exitCode: 0 });
    assistant("### Use logits directly\n\nPass the raw logits to `cross_entropy`; PyTorch combines log-softmax and negative log likelihood in a numerically stable operation.\n\n```python\nlogits = model(batch.inputs)\nloss = F.cross_entropy(logits, batch.targets)\nloss.backward()\noptimizer.step()\n```\n\nKeep the original logits for the loss calculation. Compute probabilities only when you need them for reporting or inference.\n\nSee [train.py](train.py) for the complete training step.");
    await writeFile(join(home, "workspace/train.py"), "import torch.nn.functional as F\n\n\ndef training_step(model, batch, optimizer):\n    optimizer.zero_grad(set_to_none=True)\n    logits = model(batch.inputs)\n    loss = F.cross_entropy(logits, batch.targets)\n    loss.backward()\n    optimizer.step()\n    return loss.detach()\n");
    for (const item of items) Schema.decodeUnknownSync(OrchestrationV2TurnItemJson)(item);
    await writeFile(metadataPath, JSON.stringify({ home, threads, items }));
    console.log("Prepared README conversations; stop the isolated server, run --seed, then restart it.");
  } finally { await host.dispose(); }
}
