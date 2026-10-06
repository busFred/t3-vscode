/** Isolate the extension-side shell bug: connect like the extension does and
 * inspect what snapshotShell + the live shell subscription deliver. */
import { discoverServer } from "../src/host/serverDiscovery.js";
import { T3Client } from "../src/host/t3Client.js";
import { pairWithServer } from "../src/host/pairing.js";

const home = "/tmp/t3-vscode-m0";
const discovered = await discoverServer(home);
if (!discovered.ok) throw new Error(discovered.reason);
console.log("discovered:", discovered.server.origin);

const session = await pairWithServer({
  home,
  origin: discovered.server.origin,
  environmentId: discovered.server.descriptor.environmentId,
});
console.log("paired, scopes:", session.scopes.join(" "));

const client = new T3Client();
await client.connect(discovered.server, session.accessToken);
console.log("connected");

// Live shell subscription first (mirrors ensureShellSubscription).
let snapCount = 0;
await client.subscribeShell((item) => {
  const it = item as { kind?: string };
  if (it.kind === "snapshot") {
    snapCount += 1;
    console.log(`live shell snapshot #${snapCount}:`, JSON.stringify(item));
  }
  if (it.kind === "event") console.log("live shell event:", (item as { event?: { type?: string } }).event?.type);
});

const shell = await client.snapshotShell();
console.log("snapshotShell → projects:", shell.projects.length, "threads:", shell.threads.length);
for (const t of shell.threads) console.log("  thread:", t.id.slice(0, 8), t.title, t.status);

await new Promise((r) => setTimeout(r, 3000));
const shell2 = await client.snapshotShell();
console.log("snapshotShell(2) → threads:", shell2.threads.length);

// Subscribe to the latest-activity thread and dump the first frames.
const toMs = (v: any): number => {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") return Date.parse(v) || 0;
  if (v == null) return 0;
  if (typeof v.toJSON === "function") { const p = Date.parse(String(v.toJSON())); if (!Number.isNaN(p)) return p; }
  if (typeof v.toDate === "function") { const d = v.toDate(); if (d instanceof Date) return d.getTime(); }
  const m = /(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/.exec(String(v));
  return m?.[1] ? Date.parse(m[1]) || 0 : 0;
};
for (const t of shell2.threads) {
  const v = (t as any).updatedAt;
  console.log("thread:", t.id.slice(0, 8), "toMs=", toMs(v), "ctor=", v?.constructor?.name, "str=", String(v).slice(0, 24));
}
const latest = [...shell2.threads].sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt))[0];
if (!latest) throw new Error("The isolated dev server has no threads.");
console.log("subscribing thread:", latest.id, latest.title, latest.status);
let n = 0;
await client.subscribeThread(latest.id, (item) => {
  n += 1;
  const it = item as any;
  if (n <= 3) {
    if (it.kind === "snapshot") {
      const items = it.projection?.turnItems ?? [];
      console.log(`frame#${n} snapshot turnItems=${items.length}`);
      for (const t of items.slice(0, 4)) console.log("   item:", t.type, t.status, (t.text ?? "").slice(0, 40));
    } else {
      console.log(`frame#${n}`, it.kind, it.event?.type ?? "");
    }
  }
});
await new Promise((r) => setTimeout(r, 4000));
console.log("total frames:", n);

// Send a message on the latest thread and watch for turn items.
const { randomUUID } = await import("node:crypto");
const { ORCHESTRATION_V2_WS_METHODS } = await import("@t3tools/contracts");
const sendTarget = latest.id;
await client.subscribeThread(sendTarget, (item) => {
  const it = item as any;
  if (it.kind === "event" && it.event?.type === "turn-item.updated") {
    const p = it.event.payload;
    console.log("turn-item:", p.type, p.status, (p.text ?? "").slice(0, 50));
  }
});
await new Promise((r) => setTimeout(r, 500));
// dispatch via the private run helper — replicate through sendMessage.
try {
  await client.sendMessage(sendTarget, "Reply with exactly: T3CLIENT-OK");
  console.log("sendMessage dispatched");
} catch (e) {
  console.log("sendMessage FAILED:", String(e).slice(0, 200));
}
await new Promise((r) => setTimeout(r, 30000));
console.log("done waiting");
await client.disconnect();
process.exit(0);
