// R4 AND R5 MAY NEVER APPEAR AS FILED.
//
// Nothing in this repository records whether a CFPB or state attorney general
// complaint was actually submitted — src/metro2/letters/catalog.mjs:57-65 says
// so in as many words. The client fills in the date, hand-signs the perjury
// declaration and files the thing personally, and no table, column, endpoint or
// workflow ever hears about it.
//
// The timeline is rendered from repair_decision_log by timelineLine(), which
// de-underscores whatever machine name somebody stored. So the words on a
// client's screen are chosen by whoever wrote a decision string, possibly years
// from now, possibly without reading any of this. THAT is why the guard runs on
// the rendered line rather than on a list of known decisions, and why this file
// tests decision strings nobody has written yet.

import { test, describe } from "node:test";
import assert from "node:assert";
import { deFileClaim, claimsFiled, PREPARED_LINE } from "./timeline.mjs";
import { timelineLine } from "../repair/lens.mjs";

/* Decision strings a future writer could plausibly store. None of these exist
   in the repository today; that is the point. */
const WOULD_CLAIM_FILING = [
  "cfpb_complaint_filed",
  "cfpb.complaint.submitted",
  "state_ag_complaint_filed",
  "attorney_general_complaint_lodged",
  "r4_cfpb_filing_confirmed",
  "complaint_sent_to_cfpb",
  "consumer_financial_protection_bureau_complaint_submitted"
];

/* Lines that are TRUE and must survive untouched. A letter really was produced
   and really was handed to the client. */
const HONEST = [
  "cfpb_complaint_prepared",
  "state_ag_complaint_generated",
  "r4_escalation_pack_ready",
  "letters_mailed",
  "round_2_response_received"
];

describe("the progress timeline never says a regulator complaint was filed", () => {
  for (const decision of WOULD_CLAIM_FILING) {
    test(`"${decision}" is rewritten, not printed`, () => {
      const rendered = timelineLine({ action: decision, ts: "2026-03-03T00:00:00Z" });
      assert.ok(claimsFiled(rendered),
        "the oracle must agree this raw line makes the forbidden claim");
      const safe = deFileClaim(rendered);
      assert.equal(claimsFiled(safe), false,
        `still claims a filing: ${safe}`);
      assert.ok(safe.includes(PREPARED_LINE),
        `expected the prepared-not-filed wording, got: ${safe}`);
    });
  }

  test("the date timelineLine put on the front survives the rewrite", () => {
    const rendered = timelineLine({ action: "cfpb_complaint_filed", ts: "2026-03-03T12:00:00Z" });
    const safe = deFileClaim(rendered);
    assert.ok(/·/.test(safe), `expected the date prefix to survive: ${safe}`);
    assert.ok(/Mar/.test(safe), `expected the month to survive: ${safe}`);
  });

  for (const decision of HONEST) {
    test(`"${decision}" is left exactly as rendered`, () => {
      const rendered = timelineLine({ action: decision, ts: "2026-03-03T00:00:00Z" });
      assert.equal(deFileClaim(rendered), rendered);
    });
  }

  test("a line with a filing verb but no regulator is left alone", () => {
    // "letters filed with the bureau" is not a regulator complaint claim.
    const line = "Mar 3 · dispute filed with the bureau";
    assert.equal(claimsFiled(line), false);
    assert.equal(deFileClaim(line), line);
  });

  test("null and undefined survive as an empty string, not as a crash", () => {
    assert.equal(deFileClaim(null), "");
    assert.equal(deFileClaim(undefined), "");
    assert.equal(claimsFiled(null), false);
  });
});
