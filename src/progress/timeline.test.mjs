// R4 AND R5 MAY NEVER APPEAR AS FILED.
//
// What makes a CFPB or state attorney general complaint a FILING is the client's
// own hand-signed declaration under penalty of perjury, and no table, column,
// endpoint or workflow in this repository ever hears that it happened
// (src/metro2/letters/catalog.mjs:57-65).
//
// THE FIRST VERSION OF THE GUARD WAS A DENYLIST AND IT LEAKED. It rewrote a line
// only if the line matched a regulator word AND a submission verb, and the verb
// list omitted "sent", "mailed", "delivered" and "posted". "mailed" is this
// repository's own live decision vocabulary, so "cfpb complaint mailed" went to
// the screen untouched. The tests below are written against the ALLOWLIST that
// replaced it, and the two that matter most are:
//
//   - a decision string nobody has written yet renders as the neutral line
//   - a filing phrase added to the allowlist itself is dropped at load
//
// Both are properties of the design, not of a list of bad words, which is why
// they can be tested with strings invented here.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  approvedWords, progressLine, claimsFiled, TIMELINE_WORDS, KNOWN_DECISIONS, allowlistFrom,
  NEUTRAL_WORDS
} from "./timeline.mjs";
import { timelineLine } from "../repair/lens.mjs";

/* Decision strings a future writer could plausibly store. None of these exist
   in the repository today; that is the point. The old denylist printed the
   last four of them verbatim. */
const NOT_WRITTEN_YET = [
  "cfpb_complaint_filed",
  "cfpb.complaint.submitted",
  "state_ag_complaint_filed",
  "attorney_general_complaint_lodged",
  "r4_cfpb_filing_confirmed",
  "complaint_sent_to_cfpb",
  "consumer_financial_protection_bureau_complaint_submitted",
  // The four the denylist missed. These are the regression.
  "cfpb_complaint_sent",
  "cfpb_complaint_mailed",
  "state_ag_complaint_mailed",
  "cfpb_complaint_delivered",
  "state_ag_complaint_posted"
];

describe("the progress timeline is an allowlist, so an unknown decision cannot leak", () => {
  for (const decision of NOT_WRITTEN_YET) {
    test(`"${decision}" renders as the neutral line, not as itself`, () => {
      const words = approvedWords(decision);
      assert.equal(words, NEUTRAL_WORDS,
        `an unknown decision must be neutral, got: ${words}`);
      const line = progressLine({ action: decision, ts: "2026-03-03T00:00:00Z" });
      assert.equal(claimsFiled(line), false, `still claims a filing: ${line}`);
      // The stored machine name must not appear on the screen in any form.
      const bare = decision.replace(/[._]/g, " ");
      assert.ok(!line.includes(bare), `the stored name reached the screen: ${line}`);
    });
  }

  test("the denylist's own blind spot is now covered end to end", () => {
    // This exact string went to a client's screen unchanged before the rewrite.
    const line = progressLine({ action: "cfpb_complaint_mailed", ts: "2026-03-03T00:00:00Z" });
    assert.ok(!/cfpb/i.test(line), `the regulator name reached the screen: ${line}`);
    assert.equal(claimsFiled(line), false);
  });

  test("the date timelineLine puts on the front survives", () => {
    const line = progressLine({ action: "repair.letters.sent", ts: "2026-03-03T12:00:00Z" });
    assert.ok(/·/.test(line), `expected the date prefix: ${line}`);
    assert.ok(/Mar/.test(line), `expected the month: ${line}`);
    assert.ok(line.endsWith("letters mailed"), `expected the approved words: ${line}`);
  });

  test("a near miss is not a match — no prefix or fuzzy matching", () => {
    assert.equal(approvedWords("repair.letters.sent.v2"), NEUTRAL_WORDS);
    assert.equal(approvedWords("repair.letters"), NEUTRAL_WORDS);
    assert.equal(approvedWords("xrepair.letters.sent"), NEUTRAL_WORDS);
  });

  test("case and whitespace do not change the answer", () => {
    assert.equal(approvedWords("  REPAIR.Letters.Sent  "), "letters mailed");
  });

  test("null, undefined and empty are the neutral line, not a crash", () => {
    assert.equal(approvedWords(null), NEUTRAL_WORDS);
    assert.equal(approvedWords(undefined), NEUTRAL_WORDS);
    assert.equal(approvedWords(""), NEUTRAL_WORDS);
    assert.equal(claimsFiled(null), false);
  });
});

describe("the allowlist itself cannot carry a filing claim", () => {
  test("no phrase on the list asserts anything about a regulator complaint", () => {
    for (const [name, words] of TIMELINE_WORDS) {
      assert.equal(claimsFiled(words), false,
        `"${name}" would print a filing claim: ${words}`);
    }
  });

  test("the neutral line itself is clean", () => {
    assert.equal(claimsFiled(NEUTRAL_WORDS), false);
  });

  test("no phrase on the list names a regulator at all", () => {
    for (const [name, words] of TIMELINE_WORDS) {
      assert.ok(!/cfpb|attorney general|state ag/i.test(words),
        `"${name}" names a regulator: ${words} — the escalation states are the ` +
        "only place R4 and R5 are described");
    }
  });

  test("no phrase on the list says credit repair", () => {
    for (const [name, words] of TIMELINE_WORDS) {
      assert.ok(!/credit repair/i.test(words), `"${name}" says credit repair: ${words}`);
    }
  });

  /* THE SCRUB, PROVEN RATHER THAN ASSERTED. The three tests above show today's
     list is clean. This one shows that a list which is NOT clean still cannot
     ship a filing claim, which is the property that has to survive the next
     person to edit the file. */
  test("a filing phrase added to the list is dropped, not published", () => {
    const poisoned = allowlistFrom([
      ["repair.letters.sent", "letters mailed"],
      ["repair.round.escalated", "cfpb complaint filed on your behalf"],
      ["repair.stalled", "state ag complaint mailed"]
    ]);
    assert.equal(poisoned.get("repair.letters.sent"), "letters mailed",
      "a clean phrase must survive the scrub");
    assert.equal(poisoned.has("repair.round.escalated"), false,
      "a filing phrase must be dropped from the map");
    assert.equal(poisoned.has("repair.stalled"), false,
      "a 'mailed' phrase naming a regulator must be dropped too");
    assert.equal(poisoned.size, 1);
  });

  test("the scrub survives an empty or missing list", () => {
    assert.equal(allowlistFrom([]).size, 0);
    assert.equal(allowlistFrom(undefined).size, 0);
  });

  test("every allowlisted decision has non-empty words", () => {
    for (const [name, words] of TIMELINE_WORDS) {
      assert.ok(typeof words === "string" && words.trim().length > 0,
        `"${name}" has no words`);
    }
  });
});

describe("the allowlist covers the decision names this repository actually writes", () => {
  /* Every decision string reaching repair_decision_log today:
       REPAIR_EVENTS            src/repair/register.mjs:6-23, logged as
                                `decision: name` at src/repair/handlers.mjs:161,:188
       parse.*                  src/metro2/inbound/confirm.mjs:53,:81,:104
       send_claim_cleared       src/repair/send.mjs:744
     If this list and TIMELINE_WORDS drift apart, a real event starts rendering
     as "progress update" and nobody notices — so the drift is the test. */
  const WRITTEN_TODAY = [
    "repair.enrolled", "repair.docs.needed", "repair.docs.complete",
    "repair.analysis.complete", "repair.analysis.empty", "repair.letters.ready",
    "repair.letters.sent", "repair.letters.delivered", "repair.response.received",
    "repair.response.parsed", "repair.parse.low_confidence", "repair.response.retake",
    "repair.round.complete", "repair.round.escalated", "repair.program.complete",
    "repair.stalled", "repair.cancelled",
    "parse.held_low_confidence", "parse.held_escalation_needs_human", "parse.confirmed",
    "repair.letter.send_claim_cleared"
  ];

  for (const decision of WRITTEN_TODAY) {
    test(`"${decision}" has words of its own`, () => {
      assert.notEqual(approvedWords(decision), NEUTRAL_WORDS,
        "a decision this repository really writes must not read as a generic update");
    });
  }

  test("the allowlist has no entry for a decision nobody writes", () => {
    const written = new Set(WRITTEN_TODAY);
    for (const name of KNOWN_DECISIONS) {
      assert.ok(written.has(name),
        `"${name}" is on the allowlist but nothing writes it — remove it or ` +
        "add the writer to WRITTEN_TODAY above");
    }
  });
});

describe("claimsFiled is the audit oracle, and it is wider than the old guard", () => {
  const MUST_TRIP = [
    "cfpb complaint filed",
    "cfpb complaint mailed",
    "cfpb complaint sent",
    "state ag complaint delivered",
    "attorney general complaint posted",
    "regulator complaint transmitted"
  ];
  for (const s of MUST_TRIP) {
    test(`"${s}" trips the oracle`, () => assert.equal(claimsFiled(s), true));
  }

  test("a filing verb with no regulator does not trip it", () => {
    assert.equal(claimsFiled("Mar 3 · letters mailed"), false);
    assert.equal(claimsFiled("Mar 3 · dispute filed with the bureau"), false);
  });

  test("a regulator with no verb does not trip it", () => {
    assert.equal(claimsFiled("Mar 3 · cfpb complaint prepared"), false);
  });
});

describe("progressLine reuses timelineLine and never hands it a stored name", () => {
  test("the rendered line equals timelineLine of the APPROVED words", () => {
    const ts = "2026-03-03T12:00:00Z";
    assert.equal(
      progressLine({ action: "repair.docs.needed", ts }),
      timelineLine({ action: "documents requested from you", ts })
    );
  });

  test("a row with no timestamp still renders", () => {
    assert.equal(progressLine({ action: "repair.stalled" }), "on hold");
  });
});
