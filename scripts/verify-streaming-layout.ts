/** Streaming rows, late media and late change cards must never draw over each other in the virtualized transcript. */
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { MessageId, RunId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import type { HostState } from "../src/host/hostState.js";
import type { FakeTransport } from "../src/host/testing/fakeTransport.js";
import { turnFixture, turnPatch } from "../src/host/testing/turnFixture.js";

// A fixed intrinsic size stands in for a rendered page or screenshot in a response.
const pageImage = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#ddd"/><text x="20" y="40" font-size="24">Figure</text></svg>`;

// Browser-side code is passed as strings: tsx's name helpers do not exist in the page.
const rowOverlaps = `(() => {
  const viewport = document.querySelector(".transcript-list"); if (!viewport) return [];
  const rows = [...viewport.querySelectorAll("[data-message-key]")].map((element) => ({ key: element.dataset.messageKey, rect: element.getBoundingClientRect() }))
    .filter((row) => row.rect.height > 0 && row.rect.top > -100000).sort((a, b) => a.rect.top - b.rect.top);
  const found = [];
  for (let index = 1; index < rows.length; index++) {
    const overlap = rows[index - 1].rect.bottom - rows[index].rect.top;
    if (overlap > 1) found.push(rows[index - 1].key + " over " + rows[index].key + " by " + Math.round(overlap) + "px");
  }
  return found;
})()`;
/** Records, per animation frame, any rendered rows drawn over one another. */
async function monitorOverlaps(page: Page) {
  await page.evaluate(`(() => {
    window.__overlapStop?.(); window.__overlaps = []; window.__overlapFrames = 0; let stopped = false;
    const check = () => { if (stopped) return; const frame = ++window.__overlapFrames; for (const pair of ${rowOverlaps}) window.__overlaps.push({ frame, pair }); requestAnimationFrame(check); };
    requestAnimationFrame(check); window.__overlapStop = () => { stopped = true; };
  })()`);
}
/** Longest run of consecutive frames in which the same two rows overlapped. */
async function longestOverlap(page: Page) {
  const { frames, overlaps } = await page.evaluate(`({ frames: window.__overlapFrames, overlaps: window.__overlaps })`) as { frames: number; overlaps: Array<{ frame: number; pair: string }> };
  const runs = new Map<string, { last: number; length: number; longest: number; sample: string }>();
  for (const { frame, pair } of overlaps) {
    const rows = pair.replace(/ by .*/, ""), run = runs.get(rows);
    const length = run && run.last === frame - 1 ? run.length + 1 : 1;
    runs.set(rows, { last: frame, length, longest: Math.max(length, run?.longest ?? 0), sample: pair });
  }
  const worst = [...runs.values()].sort((a, b) => b.longest - a.longest)[0];
  return { frames, longest: worst?.longest ?? 0, sample: worst?.sample ?? "" };
}
/** Rows rendered right now that overlap, after the list has had ten frames to settle. */
async function settledOverlaps(page: Page) {
  await page.evaluate(`new Promise((resolve) => { let frames = 0; const next = () => (++frames < 10 ? requestAnimationFrame(next) : resolve(null)); requestAnimationFrame(next); })`);
  return page.evaluate(rowOverlaps) as Promise<string[]>;
}

export async function verifyStreamingLayout(page: Page, host: HostState, client: FakeTransport, evidence: string) {
  const id = await host.newThread(undefined, "tab-two");
  await page.waitForFunction((id) => document.querySelector(".chat-main")?.getAttribute("data-thread-id") === id, id);
  const imageDelay = 400;
  await page.route("http://slow-media.invalid/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, imageDelay));
    await route.fulfill({ status: 200, contentType: "image/svg+xml", body: pageImage });
  });
  // Workspace media resolves through the host asset bridge, like screenshots and rendered pages.
  const originalAsset = client.createAssetUrl.bind(client);
  client.createAssetUrl = async (resource) => ({ ...(await originalAsset(resource)), url: "http://slow-media.invalid/page9.svg" });
  // The change card measures late, after its saved diff summary arrives.
  const originalDiff = client.getSavedTurnDiff, originalBaseline = client.findTurnBaseline;
  client.findTurnBaseline = async () => "refs/t3/test/baseline";
  client.getSavedTurnDiff = async () => { await new Promise((resolve) => setTimeout(resolve, 300)); return turnPatch; };
  const fixture = turnFixture(id, 2);
  const [first, second] = fixture.runs as [typeof fixture.runs[number], typeof fixture.runs[number]];
  const changes = fixture.turnItems[0]!;
  const time = DateTime.makeUnsafe(Date.now() - 60_000);
  const make = (key: string, runId: string, type: string, extra: Record<string, unknown>) => ({ ...changes, id: TurnItemId.make(key), runId: RunId.make(runId), status: "completed", createdBy: "user", creationSource: "web", startedAt: time, completedAt: time, updatedAt: time, type, ...extra } as unknown as OrchestrationV2TurnItem);
  const message = (key: string, runId: string, text: string, messageId: string) => make(key, runId, "user_message", { text, messageId: MessageId.make(messageId), attachments: [], context: { version: 1, records: [] }, inputIntent: "turn_start" });
  const answer = (key: string, runId: string, text: string, streaming = false) => make(key, runId, "assistant_message", { text, messageId: MessageId.make(key), streaming });
  const bullets = (label: string, count: number) => Array.from({ length: count }, (_, index) => `- **${label} ${index + 1}:** the figure after it moves down one number, since three figures became one.`).join("\n");
  let items: OrchestrationV2TurnItem[] = [
    message("stream-q1", first.id, "Summarize the experiment section.", first.userMessageId),
    answer("stream-a1", first.id, `${bullets("Summary", 12)}\n\nThat covers the section.`),
    message("stream-q2", second.id, "Merge the figures and update the references.", second.userMessageId),
    make("stream-think2", second.id, "reasoning", { text: "Checking the figure labels", streaming: false }),
    make("stream-cmd2", second.id, "command_execution", { input: "grep -n Fig main.tex" }),
    answer("stream-a2", second.id, `I merged the three figures.\n\n![Page 9](/tmp/t3-vscode/figures/page9.svg)\n\n${bullets("Reference", 8)}\n\nAs before, the dataset diagram is still a small wrapfigure further down page 9.`),
    { ...changes, runId: second.id },
  ];
  let runs = fixture.runs;
  let sequence = 300;
  const publish = () => client.threadHandlers.get(id)!({ kind: "snapshot", snapshotSequence: sequence++, projection: {
    ...fixture, runs, turnItems: items, visibleTurnItems: items.map((item, position) => ({ sourceThreadId: fixture.thread.id, sourceItemId: item.id, position, visibility: "local", item })),
  } });
  await monitorOverlaps(page);
  publish();
  await page.locator(".assistant-message").filter({ hasText: "As before, the dataset diagram" }).waitFor();
  await page.locator(".chat-image img").waitFor();
  await page.locator(".turn-changes").waitFor();
  assert.deepEqual(await settledOverlaps(page), [], "Late media and change cards push later rows down");
  // A follow-up starts a new run and streams while the response above still holds rich media.
  // Every host update re-renders that response; its media must not remount into a loading placeholder.
  const active = { ...second, id: RunId.make(`stream-run-${id}`), ordinal: 3, status: "running" as const, userMessageId: MessageId.make("stream-q3-message"), completedAt: null, checkpointId: null };
  runs = [...fixture.runs, active];
  items = [...items, message("stream-q3", active.id, "Delegate a subagent to make it camera ready; switch the package option and update the authors.", "stream-q3-message")];
  publish();
  items = [...items, make("stream-think3", active.id, "reasoning", { text: "Planning the camera-ready changes", streaming: true, status: "running", completedAt: null })];
  publish();
  let text = "";
  for (let step = 0; step < 30; step++) {
    text += step % 3 === 0 ? `\n\n- **Step ${step}:** it checks the package for the exact option names, then switches the submission mode.` : ` More detail for step ${step} keeps this line growing.`;
    items = [...items.filter((item) => item.id !== "stream-a3"), answer("stream-a3", active.id, `I've started an agent on the camera-ready setup.${text}`, true)];
    publish();
    await page.waitForTimeout(40);
    if (step % 10 === 9) assert.deepEqual(await settledOverlaps(page), [], `Rows stay separate while streaming (step ${step})`);
  }
  await page.locator(".assistant-message").filter({ hasText: "More detail for step 29" }).waitFor();
  assert.deepEqual(await settledOverlaps(page), [], "Rows stay separate after streaming");
  // A newly loaded image may be one frame late; anything longer is a stale row position.
  const during = await longestOverlap(page);
  assert.ok(during.frames > 60, "The overlap monitor observed the stream");
  assert.ok(during.longest <= 2, `Rows overlapped for ${during.longest} consecutive frames: ${during.sample}`);
  // The response with media, its change card and the new question must also be separate in view.
  await page.locator('.timeline-row:has(.chat-image)').evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.locator(".turn-changes").evaluate((element) => element.scrollIntoView({ block: "center" }));
  assert.deepEqual(await settledOverlaps(page), [], "Rows stay separate around the media response");
  await page.screenshot({ path: `${evidence}/streaming-media-rows.png` });
  await page.evaluate(`window.__overlapStop?.()`);
  items = items.map((item) => item.runId === active.id ? { ...item, status: "completed", completedAt: DateTime.makeUnsafe(Date.now()), ...("streaming" in item ? { streaming: false } : {}) } as OrchestrationV2TurnItem : item);
  runs = [...fixture.runs, { ...active, status: "completed", completedAt: DateTime.makeUnsafe(Date.now()) }];
  publish();
  await page.getByRole("button", { name: "Stop generation", exact: true }).waitFor({ state: "hidden" });
  client.createAssetUrl = originalAsset; client.getSavedTurnDiff = originalDiff; client.findTurnBaseline = originalBaseline;
  await page.unroute("http://slow-media.invalid/**");
  console.log(`PASS: streaming a new run below a response with late media and a change card keeps every rendered row separate (${during.frames} frames monitored; longest transient overlap ${during.longest} frame${during.longest === 1 ? "" : "s"}).`);
}
