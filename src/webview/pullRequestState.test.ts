import test from "node:test";
import assert from "node:assert/strict";
import { PullRequestStateController, type PullRequestRequester } from "./pullRequestState.js";
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const prompt = { userCode: "CODE", verificationUri: "https://github.com/login/device", expiresAt: 123 };
const error = { error: "Sign in required", signInRequired: true };
const model = (request: (operation: string) => Promise<unknown>) => new PullRequestStateController(request as PullRequestRequester, () => {});
test("Summary failure retains authentication state; retry clears error and preserves other data", async () => {
  let fail = true;
  const c = model(async () => fail ? error : { data: { title: "Fixed" } });
  await c.load("summary"); assert.equal(c.state.needsSignIn, true); assert.equal(c.state.errors.summary, error.error);
  fail = false; await c.load("summary"); assert.equal(c.state.errors.summary, undefined); assert.equal(c.state.data.summary?.title, "Fixed"); assert.equal(c.state.loading.summary, false); assert.equal(c.state.needsSignIn, false);
});
test("Out-of-order summaries cannot replace a newer response", async () => {
  const old = deferred<unknown>(); let count = 0;
  const c = model(async () => ++count === 1 ? old.promise : { data: { title: "new" } });
  const first = c.load("summary"); await c.load("summary"); old.resolve({ data: { title: "old" } }); await first;
  assert.equal(c.state.data.summary?.title, "new");
});
test("Sign-in exposes device prompt, waits and refreshes after success", async () => {
  const wait = deferred<unknown>(); const calls: string[] = [];
  const c = model(async op => { calls.push(op); return op === "signInStart" ? { data: prompt } : op === "signInWait" ? wait.promise : { data: null }; });
  const pending = c.signIn(); await Promise.resolve();
  assert.equal(c.state.signIn, "waiting"); assert.deepEqual(c.state.prompt, prompt);
  wait.resolve({ data: { account: "me" } }); await pending;
  assert.equal(c.state.signIn, "idle"); assert.equal(c.state.prompt, undefined); assert.equal(c.state.needsSignIn, false);
  assert.ok(calls.includes("summary") && calls.includes("appAccess") && calls.includes("reviewGuide"));
});
test("Cancel ignores late sign-in success and does not refresh", async () => {
  const wait = deferred<unknown>(); const calls: string[] = [];
  const c = model(async op => { calls.push(op); return op === "signInStart" ? { data: prompt } : op === "signInWait" ? wait.promise : { data: undefined }; });
  const pending = c.signIn(); await Promise.resolve(); await c.cancelSignIn(); wait.resolve({ data: { account: "late" } }); await pending;
  assert.equal(c.state.signIn, "idle"); assert.equal(c.state.prompt, undefined); assert.equal(calls.includes("summary"), false); assert.ok(calls.includes("signInCancel"));
});
test("Cancel while starting waits for start before cancelling the server flow", async () => {
  const start = deferred<unknown>(); const calls: string[] = [];
  const c = model(async op => { calls.push(op); return op === "signInStart" ? start.promise : { data: undefined }; });
  const pending = c.signIn(); const cancel = c.cancelSignIn(); assert.deepEqual(calls, ["signInStart"]);
  start.resolve({ data: prompt }); await Promise.all([pending, cancel]);
  assert.deepEqual(calls, ["signInStart", "signInCancel"]); assert.equal(c.state.signIn, "idle");
});
test("Denied or expired sign-in displays error and can be retried", async () => {
  const c = model(async op => op === "signInStart" ? { data: prompt } : { error: "Code expired", signInRequired: false });
  await c.signIn(); assert.equal(c.state.signIn, "failed"); assert.equal(c.state.errors.signInWait, "Code expired"); assert.equal(c.state.prompt, undefined);
});
test("Review guide generation retains Running and Failed states and markdown content", async () => {
  const c = model(async op => ({ data: op === "generateReviewGuide" ? { guide: null, run: { _tag: "Running", headSha: "head" }, currentHeadSha: "head" } : { guide: { stops: [{ summary: "**Read** this" }] }, run: { _tag: "Failed", detail: "Could not rewrite" }, currentHeadSha: "head" } }));
  await c.load("generateReviewGuide"); assert.equal(c.state.data.reviewGuide?.run?._tag, "Running");
  await c.load("reviewGuide"); assert.equal(c.state.data.reviewGuide?.run?._tag, "Failed"); assert.equal(c.state.data.reviewGuide?.guide?.stops[0]?.summary, "**Read** this");
});
test("Disposed panel ignores pending data and cancels active sign-in", async () => {
  const wait = deferred<unknown>(); const calls: string[] = [];
  const c = model(async op => { calls.push(op); return op === "signInStart" ? { data: prompt } : op === "signInWait" ? wait.promise : { data: undefined }; });
  const pending = c.signIn(); await Promise.resolve(); c.dispose(); wait.resolve({ data: { account: "late" } }); await pending;
  assert.ok(calls.includes("signInCancel")); assert.equal(calls.includes("summary"), false);
});
