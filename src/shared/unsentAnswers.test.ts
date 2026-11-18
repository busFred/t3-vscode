import assert from "node:assert/strict";
import test from "node:test";
import { carryDisplacedCustomAnswerIntoPrompt, carryUnsentAnswersIntoPrompt } from "./unsentAnswers.js";

test("An answer is appended after a blank line", () => {
  assert.equal(carryDisplacedCustomAnswerIntoPrompt("Already typing", "Use the staging database"), "Already typing\n\nUse the staging database");
  assert.equal(carryDisplacedCustomAnswerIntoPrompt("Already typing  \n", "  Use staging  "), "Already typing\n\nUse staging", "trailing space is replaced by the separator");
});

test("An empty draft becomes the answer, and an empty answer changes nothing", () => {
  assert.equal(carryDisplacedCustomAnswerIntoPrompt("", "Use staging"), "Use staging");
  assert.equal(carryDisplacedCustomAnswerIntoPrompt(" \n", "Use staging"), "Use staging");
  assert.equal(carryDisplacedCustomAnswerIntoPrompt("Draft", ""), "Draft");
  assert.equal(carryDisplacedCustomAnswerIntoPrompt("Draft", "   "), "Draft");
  assert.equal(carryDisplacedCustomAnswerIntoPrompt("Draft", undefined), "Draft");
});

test("Several unsent answers keep their order and skip the empty ones", () => {
  assert.equal(carryUnsentAnswersIntoPrompt("Draft", ["first", undefined, "", "second"]), "Draft\n\nfirst\n\nsecond");
  assert.equal(carryUnsentAnswersIntoPrompt("", ["first", "second"]), "first\n\nsecond");
  assert.equal(carryUnsentAnswersIntoPrompt("Draft", []), "Draft");
});
