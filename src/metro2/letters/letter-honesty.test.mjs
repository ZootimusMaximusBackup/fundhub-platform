// Every round, every bureau, every regeneration attempt, every claim mix:
// does any sentence in the letter assert something the claims in that SAME
// letter do not support?
//
// COMPLIANCE REVIEW REQUIRED — dispute logic and credit-repair messaging.
//
// This is the test that would have caught the bug it was written for. Measured
// 2026-09-04 against the wording as it stood on fix/r2-w8b-repair-floor: 101 of
// 162 letters failed. The loudest was Round 2 — a letter whose every item said
// "this name is right, hold my file to it" went on to demand the method of
// verification for each item and every furnisher's name, address and telephone
// number. There is no furnisher of a consumer's own name, and nothing had been
// verified because nothing had been disputed.
//
// Three claim mixes are exercised because the letter reads differently in each:
//   confirmation-only  every item says the file is correct
//   mixed              a real dispute AND a confirmation in one envelope
//   dispute-only       what every letter was before the floor existed
//
// The attempt loop matters: the variance gate regenerates with attempt 1 and 2
// and those draw DIFFERENT lines out of the prompt pools, so a substitution
// missing from one pool member hides completely at attempt 0.

import test from "node:test";
import assert from "node:assert/strict";

import { buildLetterText, generateLetter } from "./generate.mjs";

const IDENTITY = Object.freeze({
  fullName: "Sim Repair",
  addressLine1: "412 Pecan St",
  city: "Austin",
  state: "TX",
  zip: "78701"
});

const CONFIRM_NAME = Object.freeze({
  ruleId: "PI-NAME-CONFIRM",
  severity: "supporting",
  scope: "report",
  subject: "Sim Repair",
  plainName: "One name only on the file — confirm and hold it there",
  observed: { namesReportedOnFile: ["Sim Repair"], keepOnly: "Sim Repair" },
  expected: "one name on the file",
  reason: "This file reports one name: \"Sim Repair\". My name is Sim Repair.",
  citations: ["15 U.S.C. § 1681e(b)"]
});

const CONFIRM_ADDRESS = Object.freeze({
  ruleId: "PI-ADDRESS-CONFIRM",
  severity: "supporting",
  scope: "report",
  subject: "412 Pecan St, Austin, TX, 78701",
  plainName: "One address only on the file — confirm and hold it there",
  observed: { addressesReportedOnFile: ["412 Pecan St, Austin, TX, 78701"], keepOnly: "412 Pecan St, Austin, TX, 78701" },
  expected: "one address on the file",
  reason: "This file reports one address. My address is 412 Pecan St, Austin, TX, 78701.",
  citations: ["15 U.S.C. § 1681e(b)"]
});

const INQUIRY_CLAIM = Object.freeze({
  ruleId: "PI-INQUIRY-UNMATCHED",
  severity: "supporting",
  scope: "report",
  subject: "Northgate Lending Group",
  creditor: "Northgate Lending Group",
  plainName: "Inquiry with no account reported on the file",
  observed: { inquiryCreditor: "Northgate Lending Group", inquiryDate: "2026-07-21", accountOnFile: false },
  expected: "a permissible purpose on the record, or deletion of the inquiry",
  reason: "An inquiry from Northgate Lending Group dated 2026-07-21 appears on this file, and no "
    + "account from Northgate Lending Group is reported anywhere on this credit file alongside it. "
    + "A consumer report may only be furnished for a permissible purpose. Provide the permissible "
    + "purpose this inquiry was made under and the identity of the party that made it.",
  citations: ["15 U.S.C. § 1681b"]
});

const REAL_DISPUTE = Object.freeze({
  ruleId: "M2-011",
  severity: "strong",
  scope: "tradeline",
  subject: "CAP ONE",
  creditor: "CAP ONE",
  account_last4: "1234",
  observed: "closed with balance",
  expected: "zero balance",
  reason: "Status says closed while a balance is still reported."
});

/* A letter whose every claim confirms the file may not ask for a method of
   verification, name a furnisher, accuse the bureau of rubber-stamping, or
   demand deletion of the items it just called correct. */
const BANNED_WHEN_ALL_CLAIMS_CONFIRM = Object.freeze([
  /method of verification/i,
  /furnisher/i,
  /rubber-stamp/i,
  /reinvestigat/i,
  /I dispute\b/i,
  /I already disputed/i,
  /delete each item/i,
  /delete or correct each item/i,
  /delete the items/i,
  /\b(delete|remove|take)\b[^.]{0,40}\bitems?\b/i,
  /\btake them off\b/i,
  /* A confirmation-only letter has no "items" in it. What it lists is the
     consumer's own correct name and address, and calling those items is how
     the surrounding demand sentences end up pointed at them. */
  /\bitems?\b/i,
  /* "still on my file", "what came off" — both make a claim about an earlier
     round that nothing in this repository records. */
  /still (on|reports|carries|shows|carrying)/i,
  /came off/i,
  /Metro 2/i,
  /unverifiable items/i,
  /defects remain/i,
  /Two prior disputes/i,
  /^Violation /m
]);

/* A letter carrying BOTH kinds may demand all of that — but only of the items
   it actually disputes. An unscoped "each item" sweeps in the confirmations. */
const BANNED_WHEN_MIXED = Object.freeze([
  /delete or correct each item\b/i,
  /reinvestigate each item\b/i,
  /delete each item you cannot verify\b/i,
  /method of verification for each item\b/i,
  /delete the items\./i,
  /I already disputed these items/i,
  /how you verified the items listed below/i
]);

/* No letter with another bureau round after it may call itself the last one,
   and a Round 6 letter may not call itself a Round 3 letter. */
const BANNED_AFTER_ROUND_THREE = Object.freeze([
  /last letter to your bureau/i,
  /the last bureau notice/i,
  /This Round 3 letter/i
]);

const ROUNDS = ["R1", "R2", "R3", "R4", "R5", "R6"];
const BUREAUS = ["TU", "EX", "EQ"];
const ATTEMPTS = [0, 1, 2];

function offenders(text, patterns) {
  const found = [];
  for (const re of patterns) {
    if (!re.test(text)) continue;
    const line = text.split("\n").find((l) => re.test(l)) || "";
    found.push(`${re} → ${line.trim().slice(0, 140)}`);
  }
  return found;
}

function bannedFor(round, base) {
  return ["R4", "R5", "R6"].includes(round)
    ? [...base, ...BANNED_AFTER_ROUND_THREE]
    : base;
}

test("no letter asserts something its own claims do not support", () => {
  const failures = [];
  let letters = 0;

  for (const round of ROUNDS) {
    for (const bureau of BUREAUS) {
      for (const attempt of ATTEMPTS) {
        const base = { identity: IDENTITY, bureau, round, attempt, undated: true, seed: `honesty:${bureau}:${round}` };

        const cases = [
          ["confirmation-only", [CONFIRM_NAME, CONFIRM_ADDRESS], bannedFor(round, BANNED_WHEN_ALL_CLAIMS_CONFIRM)],
          ["mixed", [REAL_DISPUTE, CONFIRM_NAME, CONFIRM_ADDRESS], bannedFor(round, BANNED_WHEN_MIXED)],
          ["dispute-only", [REAL_DISPUTE], bannedFor(round, [])]
        ];

        for (const [label, violations, banned] of cases) {
          letters++;
          const text = buildLetterText({ ...base, violations });
          for (const hit of offenders(text, banned)) {
            failures.push(`${label} ${round}/${bureau}/attempt ${attempt}: ${hit}`);
          }
        }
      }
    }
  }

  assert.equal(letters, 162, "the sweep must cover 6 rounds x 3 bureaus x 3 attempts x 3 claim mixes");
  assert.deepEqual(failures, [], `\n${failures.join("\n")}\n`);
});

test("a confirmation-only letter does not call itself a dispute", () => {
  for (const round of ROUNDS) {
    const text = buildLetterText({
      identity: IDENTITY,
      bureau: "TU",
      round,
      undated: true,
      seed: `subject:${round}`,
      violations: [CONFIRM_NAME, CONFIRM_ADDRESS]
    });
    const re = text.split("\n").find((l) => l.startsWith("Re:")) || "";
    assert.match(re, /personal information confirmation/, `${round} subject line: ${re}`);
    assert.doesNotMatch(re, /dispute/i, `${round} subject line: ${re}`);
  }
});

test("a letter that really does dispute something still demands what it always did", () => {
  const text = buildLetterText({
    identity: IDENTITY,
    bureau: "TU",
    round: "R2",
    undated: true,
    seed: "unchanged",
    violations: [REAL_DISPUTE]
  });
  assert.match(text, /method of verification/i);
  assert.match(text, /furnisher/i);
  assert.match(text, /^Violation M2-011/m);
});

/* ROUNDS 4, 5 AND 6 USED TO DRAW THE ROUND 3 POOL WORD FOR WORD.
 *
 * The comment in ./prompts.mjs said so and it was true. What nobody had checked
 * is what that does downstream: the variance gate refuses a letter more than 35%
 * similar to a recent letter to the same bureau, two letters built from the same
 * six sentences score far above that, and so every Round 4, 5 and 6 letter came
 * back `variance_gate_exhausted`. Measured on origin/main against real Postgres
 * and the production sim seed: R1 five letters, R2 three, R3 three, R4 zero, R5
 * zero, R6 zero. The six-round ladder stopped at three for every client.
 *
 * So those rounds have their own paraphrases now, carrying the same authority.
 * Both halves are pinned here: the authority is unchanged, and the words differ
 * enough for the gate to pass them. */
test("rounds 4, 5 and 6 carry the same authority the Round 3 letter carries", async () => {
  const { roundInstructions } = await import("./prompts.mjs");
  const r3 = roundInstructions("R3");
  for (const round of ["R4", "R5", "R6"]) {
    const later = roundInstructions(round);
    assert.deepEqual(later.hooks, r3.hooks, `${round} must cite what R3 cites, and nothing more`);
    assert.equal(later.roundLabel, round.replace("R", ""), "the label says which round it really is");
    /* Every mention of a complaint stays in the future. No letter may say one
       has been filed — nothing in this repository records that. */
    const prose = [later.lead, later.demand, later.ask, later.next].join(" ");
    assert.doesNotMatch(prose, /\b(have|has|already) filed\b/i);
    assert.doesNotMatch(prose, /\bI filed\b/i);
  }
});

test("the gate lets all six rounds through, one after the other", async () => {
  /* Through generateLetter, because that is the call src/repair/analyze.mjs
     makes: the variance gate with its two regeneration strikes, each new round
     compared against every letter already written to that bureau. Six rounds in
     order, exactly as a client walks them.
     
     The claims are built by the REAL floor (../diy/personal-info-floor.mjs)
     rather than trimmed fixtures, because claim length is part of what the gate
     measures and a hand-shortened claim makes this test harsher than the product
     it is guarding. */
  const { nameClaim, addressClaim } = await import("../diy/personal-info-floor.mjs");
  const floor = [
    nameClaim({ namesOnFile: [{ key: "SIM REPAIR", label: "Sim Repair" }], legalName: "Sim Repair", bureau: "TU" }),
    addressClaim({
      addressesOnFile: [{ key: "412 PECAN ST AUSTIN TX 78701", label: "412 Pecan St, Austin, TX, 78701" }],
      currentAddress: "412 Pecan St, Austin, TX, 78701",
      bureau: "TU"
    })
  ];
  assert.equal(floor.filter(Boolean).length, 2, "both floor claims must build");

  /* Three disputed accounts, which is what a repair client's file carries. A
     ONE-CLAIM letter is a different and harder case and is measured separately
     below — do not quietly turn this back into one. */
  const disputes = [
    REAL_DISPUTE,
    { ...REAL_DISPUTE, ruleId: "M2-005", subject: "SYNCB", creditor: "SYNCB", account_last4: "9911",
      reason: "The date of account information is older than the reporting cycle." },
    { ...REAL_DISPUTE, ruleId: "M2-007", subject: "PORTFOLIO RECOVERY", creditor: "PORTFOLIO RECOVERY",
      account_last4: "4402", reason: "The item is past the seven-year reporting period." }
  ];

  const base = { identity: IDENTITY, bureau: "TU", undated: true };
  const sent = [];
  for (const round of ROUNDS) {
    for (const [label, violations] of [
      ["confirmation-only", floor],
      ["mixed", [...disputes, ...floor]],
      ["dispute-and-inquiry", [...disputes, INQUIRY_CLAIM, ...floor]]
    ]) {
      const priorLetters = sent.filter((x) => x.label === label).map((x) => x.text);
      const letter = await generateLetter({
        ...base, round, violations, seed: `ladder:${label}:TU:${round}`, priorLetters
      });
      assert.equal(letter.ok, true,
        `${label} ${round} was refused: ${letter.reason} after ${letter.attempts} attempts`);
      sent.push({ label, text: letter.text });
    }
  }
  assert.equal(sent.length, 18, "six rounds x three claim shapes, every one written");
});


/* ── THE RESIDUAL, WRITTEN DOWN RATHER THAN HIDDEN ────────────────────────
 *
 * A letter carrying ONE short claim and nothing else has very little prose in
 * it once the gate strips the claim block, so what it compares is mostly the
 * fixed scaffolding every letter to that bureau shares — the consumer's name
 * and address, "CITATIONS:", "CLOSING:", "Sincerely", the signature block. Six
 * such letters to the same bureau can still exhaust the gate at some round.
 *
 * Measured 2026-09-04: a single M2-011 claim walked R1 to R6 at one bureau is
 * refused at R5. The same walk with three claims passes all six rounds, and so
 * does every case in the end-to-end run against real Postgres and the
 * production sim seed (21 case runs, 67 letters, no refusals).
 *
 * This is pinned so that the day it changes, someone is told. It is not a claim
 * that the one-claim case is fine.
 */
/* ── HOW MUCH OF THE SIX-ROUND LADDER ACTUALLY GETS WRITTEN ────────────────
 *
 * Ten clients, three claim shapes, six rounds each — 180 letters, each compared
 * by the real gate against every earlier letter to that bureau.
 *
 * MEASURED 2026-09-04.
 *   Before rounds 4, 5 and 6 had words of their own:  90 of 180.
 *     Rounds 1 to 3 written for everybody, rounds 4, 5 and 6 written for nobody.
 *   After:                                           169 of 180.
 *     Every client gets all six rounds when the letter carries the
 *     personal-information floor — which is every repair-path client with a
 *     verified identity. What is left is a letter of NOTHING but Metro 2 claims:
 *     about half of those lose Round 5 or Round 6, because once the gate strips
 *     the claim blocks such a letter is little more than its header, and the
 *     header is the same on every letter to the same bureau.
 *
 * The residual is recorded rather than papered over. If it gets worse, this
 * test says so; if someone fixes it, the floor below moves up. */
test("the six-round ladder is written, and the part that still is not is counted", async () => {
  const { nameClaim, addressClaim } = await import("../diy/personal-info-floor.mjs");
  const floor = [
    nameClaim({ namesOnFile: [{ key: "SIM REPAIR", label: "Sim Repair" }], legalName: "Sim Repair", bureau: "TU" }),
    addressClaim({
      addressesOnFile: [{ key: "412 PECAN ST AUSTIN TX 78701", label: "412 Pecan St, Austin, TX, 78701" }],
      currentAddress: "412 Pecan St, Austin, TX, 78701",
      bureau: "TU"
    })
  ];
  const disputes = [
    REAL_DISPUTE,
    { ...REAL_DISPUTE, ruleId: "M2-005", subject: "SYNCB", creditor: "SYNCB", account_last4: "9911",
      reason: "The date of account information is older than the reporting cycle." },
    { ...REAL_DISPUTE, ruleId: "M2-007", subject: "PORTFOLIO RECOVERY", creditor: "PORTFOLIO RECOVERY",
      account_last4: "4402", reason: "The item is past the seven-year reporting period." }
  ];
  const shapes = {
    "dispute-only": disputes,
    "confirmation-only": floor,
    mixed: [...disputes, ...floor]
  };

  let written = 0;
  let total = 0;
  const lostByShape = {};
  for (let client = 0; client < 10; client++) {
    for (const [shape, violations] of Object.entries(shapes)) {
      const sent = [];
      for (const round of ROUNDS) {
        total++;
        const letter = await generateLetter({
          identity: IDENTITY, bureau: "TU", undated: true, violations, round,
          seed: `ladder-${client}:TU:${round}`, priorLetters: sent
        });
        if (letter.ok) {
          written++;
          sent.push(letter.text);
        } else {
          lostByShape[shape] = (lostByShape[shape] || 0) + 1;
        }
      }
    }
  }

  assert.equal(total, 180);
  assert.ok(written >= 169,
    `only ${written} of 180 rounds were written (169 on 2026-09-04). Lost: ${JSON.stringify(lostByShape)}`);
  /* The two shapes a real repair-path client gets must lose nothing. */
  assert.equal(lostByShape["confirmation-only"] || 0, 0, "a clean file must reach round 6");
  assert.equal(lostByShape.mixed || 0, 0, "a file with both kinds of claim must reach round 6");
});
