import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOptimizeRoadmap, SAMPLE_STORED_FILE } from "./roadmap.mjs";

test("buildOptimizeRoadmap runs the existing brain on the stored sample file", () => {
  const out = buildOptimizeRoadmap();
  assert.equal(out.ok, true);
  assert.equal(out.source, "sample");
  assert.equal(out.bookUrl, "https://apply.fundhub.ai/funding-book-call");
  assert.equal(out.rounds.length, 6);
  assert.equal(out.rounds[0].step, "R1");
  assert.equal(out.rounds[0].status, "current");
  assert.ok(out.rounds[0].attacks.length > 0, "metro2 findings must land on R1");
  assert.ok(out.accounts.some((a) => a.name === "EXAMPLE BANK NA"));
});

test("buildOptimizeRoadmap uses a passed file instead of inventing one", () => {
  const out = buildOptimizeRoadmap({ crsResult: SAMPLE_STORED_FILE });
  assert.equal(out.source, "file");
  assert.equal(out.rounds[0].attacks.length > 0, true);
});

test("buildOptimizeRoadmap does not invent a second planner or a new product title", () => {
  const out = buildOptimizeRoadmap();
  const blob = JSON.stringify(out);
  assert.doesNotMatch(blob, /credit repair/i);
  assert.doesNotMatch(blob, /Consulting Services/);
});
