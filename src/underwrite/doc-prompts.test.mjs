import { createRequire } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const {
  CREDIT_ANALYSIS_PROMPT,
  ROADMAP_PROMPT,
  FUNDING_SNAPSHOT_PROMPT,
  LENDER_MATCH_PROMPT,
  DISPUTE_ROUND1_PROMPT,
  PERSONAL_INFO_PROMPT,
  INQUIRY_REMOVAL_PROMPT
} = require("../../vendor/underwriteiq-full/api/lite/crs/doc-prompts.js");

const REPORT_PROMPTS = {
  credit_analysis: CREDIT_ANALYSIS_PROMPT,
  roadmap: ROADMAP_PROMPT,
  funding_snapshot: FUNDING_SNAPSHOT_PROMPT,
  lender_match: LENDER_MATCH_PROMPT
};

const GOLD_ORDER = {
  credit_analysis: [
    "## 01 / PICTURE — Where this file stands",
    "## 02 / SCORES — Three bureaus, not one",
    "## 03 / UTILIZATION — What is eating the file",
    "## 04 / AU ACCOUNTS — Authorized users",
    "## 05 / NEGATIVES — What actually hurts",
    "## 06 / INQUIRIES — Cleanup only, zero funding impact",
    "## 07 / PERSONAL DATA — Names and addresses to clean",
    "## 08 / BOTTOM LINE — Current vs projected pre-approval"
  ],
  roadmap: [
    "## 01 / PROJECTION — Where the number goes",
    "## 02 / MONTH 1 — Launch",
    "## 03 / MONTHS 2-3 — Results",
    "## 04 / MONTH 4 — Final push",
    "## 05 / MONTH 5 — Business milestone",
    "## 06 / MONTH 6 — Re-pull and the new number",
    "## 07 / BEFORE / AFTER — Transformation"
  ],
  funding_snapshot: [
    "## 01 / NUMBERS — Current vs projected",
    "## 02 / BREAKDOWN — Personal, loans, business",
    "## 03 / COSTING YOU — What is holding the number down",
    "## 04 / DOES NOT AFFECT — Inquiries, AUs, score alone"
  ],
  lender_match: [
    "## 01 / AVAILABLE NOW — Lenders you can apply to today",
    "## 02 / AFTER OPTIMIZATION — What unlocks after the work",
    "## 03 / APPLICATION ORDER — The order protects your score"
  ]
};

/** Positive JSON instructions are a ship fail. Negative bans like "Never JSON" are required. */
function assertNoPositiveJsonInstruction(label, text) {
  assert.match(text, /Never JSON/i, `${label} must ban JSON`);
  assert.match(text, /markdown only/i, `${label} must demand markdown only`);

  const positivePatterns = [
    /\breturn\s+(as\s+)?JSON\b/i,
    /\boutput\s+as\s+JSON\b/i,
    /\brespond\s+with\s+(a\s+)?JSON\b/i,
    /\bJSON\s+object\b(?!.*\bnever\b)/i,
    /\bsections\s+array\b/i,
    /Output as JSON/i,
    /\{[^\n]*type:\s*['"]heading['"]/i
  ];
  for (const re of positivePatterns) {
    // "Never a JSON object" / "Never a sections array" are bans — strip never-lines first.
    const withoutNeverLines = text
      .split("\n")
      .filter((line) => !/\bnever\b/i.test(line))
      .join("\n");
    assert.equal(
      re.test(withoutNeverLines),
      false,
      `${label} still asks for JSON via ${re}`
    );
  }

  // ```json may appear only inside a Never / never ban line.
  const fenceHits = [...text.matchAll(/```json/gi)];
  for (const hit of fenceHits) {
    const lineStart = text.lastIndexOf("\n", hit.index) + 1;
    const lineEnd = text.indexOf("\n", hit.index);
    const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    assert.match(
      line,
      /\bnever\b/i,
      `${label} has \`\`\`json outside a Never ban: ${line.trim()}`
    );
  }
}

test("credit analysis prompt demands markdown only and never JSON", () => {
  assertNoPositiveJsonInstruction("CREDIT_ANALYSIS_PROMPT", CREDIT_ANALYSIS_PROMPT);
});

test("roadmap prompt demands markdown only and never JSON", () => {
  assertNoPositiveJsonInstruction("ROADMAP_PROMPT", ROADMAP_PROMPT);
});

test("funding snapshot prompt demands markdown only and never JSON", () => {
  assertNoPositiveJsonInstruction("FUNDING_SNAPSHOT_PROMPT", FUNDING_SNAPSHOT_PROMPT);
});

test("lender match prompt demands markdown only and never JSON", () => {
  assertNoPositiveJsonInstruction("LENDER_MATCH_PROMPT", LENDER_MATCH_PROMPT);
});

for (const [key, headings] of Object.entries(GOLD_ORDER)) {
  test(`${key} prompt keeps W3 gold section order`, () => {
    const text = REPORT_PROMPTS[key];
    let prev = -1;
    for (const h of headings) {
      const idx = text.indexOf(h);
      assert.ok(idx !== -1, `${key} missing heading: ${h}`);
      assert.ok(idx > prev, `${key} inverted order around: ${h}`);
      prev = idx;
    }
  });
}

test("funding report prompts do not ask for free dispute-letter copy as the pack", () => {
  const fundingDocs = [
    ["CREDIT_ANALYSIS_PROMPT", CREDIT_ANALYSIS_PROMPT],
    ["ROADMAP_PROMPT", ROADMAP_PROMPT],
    ["FUNDING_SNAPSHOT_PROMPT", FUNDING_SNAPSHOT_PROMPT],
    ["LENDER_MATCH_PROMPT", LENDER_MATCH_PROMPT]
  ];
  for (const [label, text] of fundingDocs) {
    assert.match(
      text,
      /do not write (free )?dispute|not a letter pack|separate deliverables/i,
      `${label} must refuse dispute-letter bodies as the report pack`
    );
    assert.equal(
      /\bmail-ready letter with\b/i.test(text),
      false,
      `${label} must not demand a mail-ready letter body`
    );
    assert.equal(
      /\bOutput a complete, mail-ready letter\b/i.test(text),
      false,
      `${label} must not use dispute-letter output shape`
    );
  }
});

test("dispute letter prompts stay letters and are not the funding report prompts", () => {
  assert.match(DISPUTE_ROUND1_PROMPT, /mail-ready letter/i);
  assert.notEqual(DISPUTE_ROUND1_PROMPT, CREDIT_ANALYSIS_PROMPT);
  assert.notEqual(PERSONAL_INFO_PROMPT, FUNDING_SNAPSHOT_PROMPT);
  assert.notEqual(INQUIRY_REMOVAL_PROMPT, LENDER_MATCH_PROMPT);
});

test("report prompts export four analysis systems", () => {
  assert.equal(typeof CREDIT_ANALYSIS_PROMPT, "string");
  assert.equal(typeof ROADMAP_PROMPT, "string");
  assert.equal(typeof FUNDING_SNAPSHOT_PROMPT, "string");
  assert.equal(typeof LENDER_MATCH_PROMPT, "string");
  assert.ok(CREDIT_ANALYSIS_PROMPT.length > 200);
  assert.ok(ROADMAP_PROMPT.length > 200);
  assert.ok(FUNDING_SNAPSHOT_PROMPT.length > 200);
  assert.ok(LENDER_MATCH_PROMPT.length > 200);
});
