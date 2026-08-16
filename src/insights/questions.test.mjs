import { test } from "node:test";
import assert from "node:assert/strict";
import { MID_QUESTIONS, POST_QUESTIONS, formatQuestionList } from "./questions.mjs";

test("post bank has the funded-day feeling and almost-stopped questions", () => {
  const ids = POST_QUESTIONS.map((q) => q.id);
  assert.ok(ids.includes("almost_stopped"));
  assert.ok(ids.includes("felt_funded"));
  assert.ok(ids.includes("tell_someone"));
});

test("mid bank is for during the process, not after funded", () => {
  const ids = MID_QUESTIONS.map((q) => q.id);
  assert.ok(ids.includes("hardest_now"));
  assert.equal(ids.includes("felt_funded"), false);
});

test("formatQuestionList numbers the prompts", () => {
  const text = formatQuestionList("post");
  assert.match(text, /^1\. /);
  assert.match(text, /What almost stopped you/);
});

test("mid bank is asked on a check-in, not a Meet", () => {
  const text = formatQuestionList("mid");
  assert.match(text, /hardest part/);
  assert.doesNotMatch(text, /Google Meet/);
});
