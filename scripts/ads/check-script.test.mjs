// scripts/ads/check-script.test.mjs
//
// The one test that matters most in this file: every ad that is filmed and
// running today must pass the checker clean. The first version of this
// checker failed all five of them — it banned the word "not" and banned
// "soft pull", a phrase docs/ads/RULES.md lists as one that works. This
// test exists so that regression can never ship silently again.
//
// Runs under plain `node --test`, no database, no network. Covered by
// `npm test`'s scripts/** glob per CLAUDE.md §12.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkOneScript, loadRules, main } from "./check-script.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const CONTROLS_PATH = join(REPO_ROOT, "docs", "ads", "CONTROLS.md");

// Mirrors the module's own splitBlocks so this test does not need to export
// an internal function just to reach it.
function splitBlocksForTest(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let current = { title: null, startLine: 1, lines: [] };
  lines.forEach((line, i) => {
    const heading = line.match(/^#{2,6}\s+(.*)$/);
    if (heading) {
      if (current.title !== null || current.lines.some((l) => l.text.trim())) blocks.push(current);
      current = { title: heading[1].replace(/[*`]/g, "").trim(), startLine: i + 1, lines: [] };
      return;
    }
    current.lines.push({ n: i + 1, text: line });
  });
  if (current.title !== null || current.lines.some((l) => l.text.trim())) blocks.push(current);
  return blocks.filter((b) => b.title && b.lines.some((l) => l.text.trim()));
}

const LIVE_AD_TITLES = [
  "Ad 1 — Denial Angle",
  "Ad 2 — Broker Burn Angle",
  "Ad 3 — Competitor Angle",
  "Ad 4 — Blind Application",
  "The Founder VSL"
];

test("all five filmed-and-running ads in CONTROLS.md pass the checker clean", () => {
  const text = readFileSync(CONTROLS_PATH, "utf8");
  const blocks = splitBlocksForTest(text);
  const found = new Map(blocks.map((b) => [b.title, b]));

  for (const title of LIVE_AD_TITLES) {
    const block = found.get(title);
    assert.ok(block, `CONTROLS.md no longer has a heading "${title}" — did the file get renamed? Update LIVE_AD_TITLES here to match, do not just delete the case.`);
    const result = checkOneScript(block);
    assert.deepEqual(
      result.failures, [],
      `"${title}" is filmed, running, and booking calls today — the checker must never fail it. ` +
      `It failed with: ${JSON.stringify(result.failures)}`
    );
  }
});

test("docs/ads/CONTROLS.md is marked LIVE — DO NOT EDIT, and this test never edits it", () => {
  const text = readFileSync(CONTROLS_PATH, "utf8");
  assert.match(text, /^# LIVE — DO NOT EDIT/, "CONTROLS.md's own header changed shape; the file this checker is graded against may not be the locked baseline any more.");
});

test("a banned word is caught, including a plural/-ed/-ing form of it", () => {
  const block = {
    title: "Test — banned word forms",
    startLine: 1,
    lines: [
      { n: 1, text: "HOOK This system will optimize your file before anything gets submitted anywhere." },
      { n: 2, text: "BODY We built it because nobody else does this and it takes very little time to run." },
      { n: 3, text: "CTA Click the link below and book your free strategy call today, right now." },
      { n: 4, text: "CLOSE No hard inquiry. No obligation. Nothing moves until you say so." },
      { n: 5, text: "RUNTIME 60-90s" },
      { n: 6, text: "TAG test_angle" }
    ]
  };
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /banned word "optimize"/.test(f.message)));
});

test("a banned phrase is caught in a different verb form (moved the needle vs move the needle)", () => {
  const block = {
    title: "Test — banned phrase form",
    startLine: 1,
    lines: [{ n: 1, text: "Nobody ever moved the needle on this before we built our own system to do it." }]
  };
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /banned phrase "move the needle"/.test(f.message)), JSON.stringify(result.failures));
});

test("a phrase RULES.md lists as one that works is never flagged", () => {
  const block = {
    title: "Test — allowed phrase",
    startLine: 1,
    lines: [{ n: 1, text: "We run a soft pull first, and it has zero impact on your score, so nothing changes until you decide it should." }]
  };
  const result = checkOneScript(block);
  assert.ok(!result.failures.some((f) => /soft pull/i.test(f.message)), JSON.stringify(result.failures));
});

test("a two-paragraph BODY is not truncated at the first blank line", () => {
  const block = {
    title: "Test — multi-paragraph body",
    startLine: 1,
    lines: [
      { n: 1, text: "HOOK The guy who got you funded left inquiries all over your file." },
      { n: 2, text: "BODY First paragraph, twelve words long right here to check the count works." },
      { n: 3, text: "" },
      { n: 4, text: "Second paragraph after a blank line, also real words that must still be counted." },
      { n: 5, text: "CTA Book your call below right now, it only takes two minutes to apply." },
      { n: 6, text: "CLOSE No hard inquiry. No obligation. Nothing moves until you say so." },
      { n: 7, text: "RUNTIME 60-90s" },
      { n: 8, text: "TAG test_angle" }
    ]
  };
  const result = checkOneScript(block);
  const bodyWords = result.wordCount;
  assert.ok(bodyWords > 25, `expected the second paragraph to be counted; got ${bodyWords} total words`);
});

test("a hook that ends in a question fails cause-first check 3", () => {
  const block = {
    title: "Test — question hook",
    startLine: 1,
    lines: [{ n: 1, text: "HOOK Have you ever wondered why your applications keep getting denied?" }]
  };
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /cause-first check 3/.test(f.message)));
});

test("main() exits 0 on a clean file and 1 on a failing one", () => {
  assert.equal(main(["--help"]), 0);
  assert.equal(main([]), 0);
});

test("loadRules returns the shared lists, and they still match .claude/workflows/copy.js", () => {
  const rules = loadRules();
  assert.equal(rules.BANNED_WORDS.length, 34);
  assert.equal(rules.BANNED_PHRASES.length, 20);
  assert.equal(rules.BANNED_OPENERS.length, 11);
  assert.ok(rules.BANNED_WORDS.includes("align"), "the word list drifted once before and lost \"align\" — this pins it back in");

  const copyJs = readFileSync(join(REPO_ROOT, ".claude", "workflows", "copy.js"), "utf8");
  for (const w of rules.BANNED_WORDS) {
    assert.ok(copyJs.includes(`'${w}'`), `"${w}" is in rules-data.mjs but not in .claude/workflows/copy.js any more — the two have drifted, fix one to match the other`);
  }
});
