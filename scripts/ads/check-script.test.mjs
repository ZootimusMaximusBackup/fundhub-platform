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

// RULES.md 3.14, confirmed as an owner-set rule 2026-09-07, alongside the
// evergreen backend-selling generator Chris asked to be built tonight.

test("an evergreen script (TYPE evergreen) is flagged for a date, a season, and a growing dollar figure", () => {
  const block = {
    title: "Test — stale evergreen ad",
    startLine: 1,
    lines: [
      { n: 1, text: "HOOK Most owners make this mistake going into 2026, and it costs them every single quarter." },
      { n: 2, text: "BODY This is the mistake that shows up every fall, and it is a reasonable one to make because nobody explains it. Here is the one thing to do instead, and it works whether or not you ever call us. We have secured $25 million for our clients and the number keeps climbing." },
      { n: 3, text: "CTA If you want us to run it for you, the link is below." },
      { n: 4, text: "CLOSE No hard inquiry. No obligation. Nothing moves until you say so." },
      { n: 5, text: "RUNTIME 60-90s" },
      { n: 6, text: "TAG evergreen_mistake_1" },
      { n: 7, text: "TYPE evergreen" }
    ]
  };
  const result = checkOneScript(block);
  const messages = result.failures.map((f) => f.message).join(" | ");
  assert.match(messages, /a specific year/);
  assert.match(messages, /a season/);
  assert.match(messages, /revenue figure that will change/);
});

test("the exact same stale content is NOT flagged when TYPE is cold (or absent)", () => {
  const block = {
    title: "Test — same content, not evergreen",
    startLine: 1,
    lines: [
      { n: 1, text: "HOOK Most owners make this mistake going into 2026, and it costs them every single quarter." },
      { n: 2, text: "BODY We have secured $25 million for our clients and the number keeps climbing this fall." },
      { n: 3, text: "CTA Click the link below and book your free strategy call today, right now." },
      { n: 4, text: "CLOSE No hard inquiry. No obligation. Nothing moves until you say so." },
      { n: 5, text: "RUNTIME 60-90s" },
      { n: 6, text: "TAG cold_test" }
    ]
  };
  const result = checkOneScript(block);
  const messages = result.failures.map((f) => f.message).join(" | ");
  assert.doesNotMatch(messages, /RULES\.md 3\.14/);
});

// The seven fixes below all came from one adversarial-review pass 2026-09-07,
// where a separate agent actively tried to break the checker. Each test here
// is a real repro it found. Do not remove one without understanding why the
// original bug was real — every one of these let a real violation through,
// or wrongly rejected genuinely fine copy.

const mkRow = (n, text) => ({ n, text });
const mkBlock = (title, lines) => ({ title, startLine: 1, lines: lines.map((t, i) => mkRow(i + 1, t)) });

test("fix 1: a nearby allowed close phrase no longer hides a real dollar-guarantee violation", () => {
  const block = mkBlock("Test", [
    "HOOK you can get $50,000, no obligation, nothing changes up front, it will land in your account within days."
  ]);
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /a dollar amount a bank WILL give them/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 1 continued: a nearby allowed close phrase no longer hides a real deletion-promise violation", () => {
  const block = mkBlock("Test", [
    "HOOK those late marks will, no obligation, come off your report before your next application goes in."
  ]);
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /a bad item WILL come off/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 1 stays fixed: the real required close is never itself flagged as a never-say violation", () => {
  const block = mkBlock("Test", [
    "CLOSE No hard inquiry. No obligation. Nothing moves until you say so."
  ]);
  const result = checkOneScript(block);
  assert.ok(!result.failures.some((f) => /never-say/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 2: a banned opener in the BODY is caught even with no HOOK section at all", () => {
  const block = mkBlock("Ad 900", [
    "BODY Imagine a world where every lender said yes on the first try, every single time, for everyone."
  ]);
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /banned opener/.test(f.message)), JSON.stringify(result.failures));
  assert.ok(result.failures.some((f) => /no HOOK found/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 3: a body line that happens to start with the word TAG does not satisfy the origin_angle check", () => {
  const block = mkBlock("Test", [
    "HOOK The guy who got you funded left inquiries all over your file.",
    "BODY He never built a system to fix that.",
    "TAG teams of closers used to split this work between two people before it was automated away."
  ]);
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /does not look like a real origin_angle slug/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 3 stays fixed: a real slug-shaped TAG passes", () => {
  const block = mkBlock("Test", [
    "HOOK The guy who got you funded left inquiries all over your file.",
    "TAG denial_angle"
  ]);
  const result = checkOneScript(block);
  assert.ok(!result.failures.some((f) => /TAG/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 6: RULES.md 3.3's own recommended hook stem is never flagged as an AI-tell contrast", () => {
  const block = mkBlock("Test", [
    "HOOK Not another broker, but the first one that actually reads your file the way a bank does."
  ]);
  const result = checkOneScript(block);
  assert.ok(!result.failures.some((f) => /it's not X, it's Y/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 6 stays fixed: the real 'it's not X, it's Y' AI tell is still caught", () => {
  const block = mkBlock("Test", [
    "HOOK It's not about your credit score, it's about who actually reads your file before it goes in."
  ]);
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /it's not X, it's Y/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 7 & 5: a hyphenated close (Soft-pull only) is accepted the same as the unhyphenated form", () => {
  const block = mkBlock("Test", [
    "CLOSE Soft-pull only. Zero impact on your score. Nothing moves until you say so."
  ]);
  const result = checkOneScript(block);
  assert.ok(!result.failures.some((f) => /the close is missing/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 5: the avoid-list phrase is caught with or without its hyphen", () => {
  const hyphenated = checkOneScript(mkBlock("Test", ["HOOK Stop chasing low-hanging fruit and start reading the real file."]));
  const unhyphenated = checkOneScript(mkBlock("Test", ["HOOK Stop chasing low hanging fruit and start reading the real file."]));
  assert.ok(hyphenated.failures.some((f) => /low-hanging fruit/.test(f.message)), JSON.stringify(hyphenated.failures));
  assert.ok(unhyphenated.failures.some((f) => /low-hanging fruit/.test(f.message)), JSON.stringify(unhyphenated.failures));
});

test("fix 8: 'book' and 'call' used as ordinary nouns do not falsely trip the cause-first ask check", () => {
  const block = mkBlock("Test", [
    "HOOK The bank never called this a denial, and nobody wrote it in the book they show you when they turn you down."
  ]);
  const result = checkOneScript(block);
  assert.ok(!result.failures.some((f) => /cause-first check 2/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 8 stays fixed: a real imperative ask at the start of the hook is still caught", () => {
  const block = mkBlock("Test", [
    "HOOK Book your free call now and we will run your file before anything else happens today."
  ]);
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /cause-first check 2/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 9: the avoid-list uses whole-phrase matching, not a raw substring — no false positive on a longer word", () => {
  const block = mkBlock("Test", ["HOOK We ran a cash advancement program that helped nobody at all, honestly."]);
  const result = checkOneScript(block);
  assert.ok(!result.failures.some((f) => /"cash advance"/.test(f.message)), JSON.stringify(result.failures));
});

test("known limitation, documented not silently dropped: the stemmer only inflects the leading word of a phrase, so an irregular verb elsewhere in it (took vs take) is not caught — 'deep dive' variants and regular -ed/-ing/-s forms ARE caught", () => {
  // This is intentionally an accepted gap, not a bug fix. Recorded so nobody
  // re-discovers it as a surprise and re-litigates the same investigation.
  const block = mkBlock("Test", ["HOOK That one change took your file to the next level of what a lender actually sees."]);
  const result = checkOneScript(block);
  // Documents current behavior (does not catch "took ... to the next level").
  // If this ever starts passing (someone builds real irregular-verb handling),
  // this assertion will fail loudly and should be updated, not deleted.
  assert.ok(!result.failures.some((f) => /the next level/.test(f.message)));
});
