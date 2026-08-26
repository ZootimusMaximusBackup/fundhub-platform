import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(HERE, "../../public/app/ramp-quizzes.js"), "utf8");

function load() {
  const sandbox = { console };
  const ctx = createContext(sandbox);
  runInContext(SRC, ctx);
  return {
    quizzes: ctx.FH_RAMP_QUIZZES,
    score: ctx.scoreRampQuiz,
    forRole: ctx.quizzesForRole
  };
}

test("class quizzes cover all four seats and every day-5 must miss zero", () => {
  const { quizzes } = load();
  const seats = new Set(quizzes.map((q) => q.seat));
  assert.deepEqual([...seats].sort(), ["closer", "funding_advisor", "inquiry", "repair"]);
  const day5 = quizzes.filter((q) => q.day === 5);
  assert.equal(day5.length, 4);
  assert.ok(day5.every((q) => q.mustMissZero === true));
});

test("closer day 5 passes only when every answer is right", () => {
  const { quizzes, score } = load();
  const quiz = quizzes.find((q) => q.id === "closer-d5");
  const good = score(quiz, [
    "We are not the bank. Lenders decide. We help them apply.",
    "Soft look at the real file after they pay.",
    "700+ cash funding. 500+ courses. Others cash downsell.",
    "The start counts toward the 10%.",
    "Never promise score up, a sure fund, or a set bank dollar."
  ]);
  assert.equal(good.passed, true);
  assert.equal(good.correct, 5);

  const miss = score(quiz, [
    "We will get you funded.",
    "Soft look",
    "700 and 500 and courses and cash downsell",
    "start counts toward 10%",
    "score fund dollar"
  ]);
  assert.equal(miss.passed, false);
});

test("yes/no items accept a plain no and do not invent a percent bar", () => {
  const { quizzes, score } = load();
  const quiz = quizzes.find((q) => q.id === "closer-d2");
  const out = score(quiz, [
    "No. It counts toward the 10%.",
    "No",
    "UnderwriteIQ pack and Funding Mastery",
    "They paid the start. They are a client. You hand off."
  ]);
  assert.equal(out.mustMissZero, false);
  assert.equal(out.passed, null);
  assert.equal(out.correct, 4);
});

test("a closer only sees closer quizzes", () => {
  const { forRole } = load();
  const list = forRole("closer");
  assert.ok(list.length >= 5);
  assert.ok(list.every((q) => q.seat === "closer"));
});
