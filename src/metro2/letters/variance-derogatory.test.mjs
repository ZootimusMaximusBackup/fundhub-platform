import { test } from "node:test";
import assert from "node:assert";
import {
  proseForVariance,
  structuralFingerprint,
  similarityScore,
  assertBatchVariance,
  DEFAULT_THRESHOLD
} from "./variance.mjs";
import { generateLetter } from "./generate.mjs";
import { openingFor, closingFor } from "./prompts.mjs";

/* ═══════════════════════════════════════════════════════════════════════════
   DEROGATORY CLAIM BLOCKS WERE BEING COMPARED AS IF THEY WERE THE LETTER'S PROSE.

   Context: on 2026-09-03 the owner rule landed — "any derogatory item deserves a
   letter, but only for clients on the repair path." A follow-up run reported that
   a repair client with a collection and a charge-off was getting ONE bureau letter
   instead of three, refused by the variance gate.

   WHAT WAS ACTUALLY WRONG, measured here rather than inherited.

   proseForVariance() strips the itemised claim blocks before fingerprinting,
   because the same violation legitimately appears in all three bureau letters and
   comparing them would refuse every honest set. It stripped blocks headed
   `Violation M2-###`. A derogatory claim renders through the same writer
   (generate.mjs) as `Violation DEROG-COLLECTION`, which that pattern did not
   match — so three bureaus' worth of identical claim prose was left in and
   dominated the fingerprint. Measured: 0.975 similar, against Metro 2's 0.587 on
   the same client and the same two accounts.

   WHAT WAS NOT WRONG, and this is the part worth not forgetting. A three-bureau
   METRO 2 batch does not clear assertBatchVariance's 0.35 default either — 0.587.
   So "three bureau letters do not pass the default threshold" was never a
   derogatory defect, and a test asserting they should pass would have been
   asserting something untrue of the whole generator. The product does not run at
   0.35: src/metro2/diy/package.mjs passes 0.45, and src/repair/analyze.mjs never
   compares across bureaus at all — it compares each letter against prior letters
   to THAT bureau, which is the comparison that matters, because it is one bureau
   receiving two near-identical letters that reads as a template farm.

   So this file pins PARITY, not a pass: a derogatory batch must be no more alike
   than the Metro 2 batch it stands in for. It also pins that the gate still bites
   on genuinely identical letters, and that the stripper does not eat the letter.

   A second, older fragility surfaced while measuring and is fixed in generate.mjs:
   the six-line opening and closing pools were drawn with correlated seeds, so two
   bureaus congruent mod 6 collided on both lines at once. That was a coin flip on
   every three-bureau batch, Metro 2 included. The bureaus are now spread across
   the pool deliberately. No new copy — the same six approved lines, differently
   drawn.

   COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7) — dispute logic. Marker only. */

const CLAIM = (ruleId, creditor) => ({
  ruleId,
  field: null,
  bureau: "TU",
  account: { creditor, last4: "4021" },
  reason:
    `${creditor} is reported as a collection account with a balance of $1,240 still reported. ` +
    `The report labels the account "Collection". I dispute this item as inaccurate. ` +
    `Reinvestigate it and obtain from the furnisher the documents that prove the debt is mine, ` +
    `that the amount is correct, and that this company holds it. If any part of that cannot be ` +
    `verified, the item must be deleted rather than left on the file.`
});

async function letterFor(bureau) {
  const out = await generateLetter({
    bureau,
    round: 1,
    client: { first_name: "Sim", last_name: "Three", address_line1: "1 Test St" },
    violations: [
      { ...CLAIM("DEROG-COLLECTION", "MIDLAND CREDIT MANAGEMENT"), bureau },
      { ...CLAIM("DEROG-CHARGEOFF", "CAPITAL ONE"), bureau }
    ]
  });
  return typeof out === "string" ? out : out?.text || out?.body || "";
}

async function metro2LetterFor(bureau) {
  const out = await generateLetter({
    bureau,
    round: 1,
    client: { first_name: "Sim", last_name: "Three", address_line1: "1 Test St" },
    identity: { fullName: "Sim Three", addressLine1: "1 Test St" },
    violations: [
      { ruleId: "M2-011", field: "Balance", bureau, account: { creditor: "MIDLAND CREDIT MANAGEMENT", last4: "4021" },
        reason: "MIDLAND CREDIT MANAGEMENT: the balance contradicts the reported status." },
      { ruleId: "M2-005", field: "DateOfLastActivity", bureau, account: { creditor: "CAPITAL ONE", last4: "7788" },
        reason: "CAPITAL ONE: the date of account information is stale." }
    ]
  });
  return typeof out === "string" ? out : out?.text || out?.body || "";
}

test("a DEROG- claim block is stripped for variance, exactly as an M2- block is", () => {
  const derog = "Violation DEROG-COLLECTION — Collection account\nMIDLAND is reported as a collection.";
  const metro = "Violation M2-011 — Status-balance contradiction\nThe balance contradicts the status.";
  assert.doesNotMatch(proseForVariance(derog), /MIDLAND/,
    "the derogatory claim text is still being compared as if it were the letter's own prose");
  assert.doesNotMatch(proseForVariance(metro), /contradicts/,
    "the M2 stripper regressed");
});

/* THE ACTUAL FIX, MEASURED AS PARITY RATHER THAN AS A PASS.
 *
 * The first version of this test asserted that a three-bureau derogatory batch
 * clears assertBatchVariance at its default threshold. That assertion was WRONG,
 * and finding out why is the useful part: an equivalent three-bureau METRO 2
 * batch does not clear it either. Measured on this generator, same client, same
 * two accounts, R1 — Metro 2 scores 0.587 and derogatory scores 0.597 against a
 * 0.35 default. Neither passes.
 *
 * That is not a defect in either. proseForVariance strips every itemised claim,
 * so what is left to compare is the header, the opening, the lead and the
 * closing — a few hundred characters of which the lead and the header shape are
 * necessarily shared. Two honest letters to two bureaus about the same file ARE
 * mostly the same words. The default 0.35 is not what the product runs at:
 * src/metro2/diy/package.mjs passes 0.45, and src/repair/analyze.mjs does not
 * compare across bureaus at all — it hands generateLetter the prior letters for
 * THAT bureau, which is the comparison that matters, since it is one bureau
 * receiving two similar letters that reads as a template farm.
 *
 * So what this file pins is PARITY: a derogatory batch must be no more alike
 * than the Metro 2 batch it stands in for. Before the fix it was 0.975 against
 * Metro 2's 0.587, because the claim blocks were being compared as prose. Now
 * the two sit together. Anything that reopens that gap is the regression. */
test("a derogatory batch is no more alike than the Metro 2 batch it stands in for", async () => {
  const derog = await Promise.all(["TU", "EX", "EQ"].map(async (b) => ({
    bureau: b, text: await letterFor(b)
  })));
  const metro = await Promise.all(["TU", "EX", "EQ"].map(async (b) => ({
    bureau: b, text: await metro2LetterFor(b)
  })));
  for (const L of [...derog, ...metro]) {
    assert.ok(L.text && L.text.length > 200, `${L.bureau}: no letter was produced at all`);
  }
  const worst = (set) => {
    let hi = 0;
    for (let i = 0; i < set.length; i++) {
      for (let j = 0; j < i; j++) hi = Math.max(hi, similarityScore(set[i].text, set[j].text));
    }
    return hi;
  };
  const d = worst(derog);
  const m = worst(metro);
  assert.ok(
    d <= m + 0.05,
    `derogatory letters are ${d.toFixed(3)} alike against Metro 2's ${m.toFixed(3)}. ` +
    `The claim blocks are being compared as the letter's own prose again — that is what ` +
    `cut a repair client's three bureau letters down to one on 2026-09-03.`
  );
  assert.ok(d < 0.8,
    `three bureau letters are ${d.toFixed(3)} alike — that is template-farm territory ` +
    `whatever the threshold is set to.`);
});

/* Three bureaus must never draw the same opening and closing as each other. The
   pools hold six lines and closingFor moved in lockstep with openingFor, so two
   bureaus whose seeds were congruent mod 6 collided on both at once — a coin flip
   on every three-bureau batch. generate.mjs now spreads the bureaus across the
   pool deliberately. No new copy: the same six approved lines, differently drawn. */
test("the three bureaus draw different opening and closing lines", async () => {
  const texts = await Promise.all(["TU", "EX", "EQ"].map((b) => letterFor(b)));
  // Ask the pool which line each letter drew, rather than guessing at paragraphs.
  const drew = (pool, text) => pool.findIndex((line) => text.includes(line));
  const openings = [0, 1, 2, 3, 4, 5].map((i) => openingFor(i, 1));
  const closings = [0, 1, 2, 3, 4, 5].map((i) => closingFor(i, 1));
  const openIdx = texts.map((t) => drew(openings, t));
  const closeIdx = texts.map((t) => drew(closings, t));
  assert.ok(openIdx.every((i) => i >= 0), "a letter opened with a line that is not in the R1 pool");
  assert.equal(new Set(openIdx).size, 3,
    `two of the three bureaus opened with the same sentence (pool indexes ${openIdx.join(", ")}). ` +
    `That is the mod-6 collision generate.mjs spreads the bureaus to avoid.`);
  assert.ok(new Set(closeIdx).size >= 2,
    `all three bureaus closed with the same sentence (pool indexes ${closeIdx.join(", ")}).`);
});

/* THE GATE MUST STILL BITE. A stripper that swallows too much is how a
   safeguard goes quiet, and this one exists because bureaus bin template-farm
   mail. Two letters that are word-for-word identical outside their claim blocks
   are still refused. */
test("the gate still refuses two genuinely identical letters", () => {
  const a = "Dear Sir or Madam,\n\nI am writing about my credit file and I want it corrected.\n\nSincerely";
  const b = "Dear Sir or Madam,\n\nI am writing about my credit file and I want it corrected.\n\nSincerely";
  const gate = assertBatchVariance([{ bureau: "TU", text: a }, { bureau: "EX", text: b }]);
  assert.equal(gate.ok, false, "identical prose passed — the stripper is eating the whole letter");
  assert.ok(similarityScore(a, b) > DEFAULT_THRESHOLD);
});

test("stripping claim blocks does not empty a letter down to nothing", async () => {
  const text = await letterFor("TU");
  const left = proseForVariance(text).replace(/\s+/g, " ").trim();
  assert.ok(left.length > 120,
    `only ${left.length} characters survive the stripper, so two letters would compare as ` +
    `near-identical boilerplate no matter what the claims said.`);
  assert.ok(structuralFingerprint(text).size > 50, "the fingerprint collapsed to almost nothing");
});
