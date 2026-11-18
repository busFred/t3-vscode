import assert from "node:assert/strict";
import test from "node:test";
import { unansweredUserInputIds } from "./unansweredRequests.js";

const request = (id: string, kind: string, status: string) => ({ id, kind, status }) as never;
const projection = (...runtimeRequests: unknown[]) => ({ runtimeRequests }) as never;

test("Cancelled and expired questions are reported as unanswered", () => {
  assert.deepEqual(unansweredUserInputIds(projection(request("a", "user_input", "cancelled"), request("b", "user_input", "expired"))), { unansweredUserInputIds: ["a", "b"] });
});

test("Answered, pending and non-question requests are not", () => {
  assert.deepEqual(unansweredUserInputIds(projection(request("a", "user_input", "resolved"), request("b", "user_input", "pending"), request("c", "command", "cancelled"), request("d", "auth_refresh", "expired"))), {});
  assert.deepEqual(unansweredUserInputIds(projection()), {});
});

test("Only the 20 most recent unanswered questions are reported", () => {
  const ids = Array.from({ length: 25 }, (_, index) => `q${index}`);
  assert.deepEqual(unansweredUserInputIds(projection(...ids.map((id) => request(id, "user_input", "cancelled")))), { unansweredUserInputIds: ids.slice(5) });
});
