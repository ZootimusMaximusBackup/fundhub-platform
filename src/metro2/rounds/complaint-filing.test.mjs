// COMPLIANCE REVIEW REQUIRED — dispute logic.
//
// Fundhub mails the Round 4 CFPB complaint and the Round 5 state attorney
// general complaint, so Round 6 is allowed to say they were filed.
//
// THE RULE THESE TESTS EXIST FOR:
//
//   A CLAIM MUST BE BACKED BY A ROW, NOT BY AN EXPECTATION.
//
// Both directions are pinned. The one that matters is the second: with no
// recorded mailing, Round 6 must say NOTHING about complaints. A letter that
// tells a bureau a federal complaint was filed when none was is the defect this
// whole branch exists to stop.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  COMPLAINT_TARGET,
  COMPLAINT_ROUND_TARGET,
  FILED_STATUSES,
  complaintDestination,
  complaintTargetForRound,
  formatComplaintFilings,
  hasFiled,
  isComplaintTarget,
  loadComplaintFilings,
  recordComplaintFiling
} from "./complaint-filing.mjs";
import { buildLetterText } from "../letters/generate.mjs";
import {
  AG_MAIL_BY_STATE,
  AG_MAIL_UNRESOLVED,
  CFPB_FILING,
  CFPB_MAIL_ADDRESS,
  agPostalAddress
} from "../letters/ag-statutes.mjs";

const VIOLATIONS = [{
  ruleId: "M2-005",
  severity: "strong",
  field: "13",
  reason: "Date of account information is stale",
  creditor: "EXAMPLE BANK NA",
  account_last4: "1234"
}];

/* WAS `fullName: "Test Client"`. The shared name predicate
   (../letters/consumer-name.cjs) refuses that, and it is right to: it is a
   seeded stand-in, and no letter may go to a credit bureau addressed to one.
   A fixture that cannot be mailed cannot exercise a letter, so the fixture is
   now a person's name. */
const IDENTITY = {
  fullName: "Simone Repair-Vega",
  addressLine1: "1 Main St",
  city: "Denton",
  state: "TX",
  zip: "76205"
};

const r6 = (priorFilings) => buildLetterText({
  violations: VIOLATIONS, identity: IDENTITY, bureau: "EX", round: "R6", priorFilings
});

/** Any sentence that would tell a bureau a complaint has already been filed. */
const CLAIMS_FILED = /complaint .{0,40}(was|were|has been|have been) (mailed|filed|sent)|COMPLAINTS ALREADY FILED/i;

/* `sink.sql` / `sink.params` are the LAST statement, which is what most of these
   tests want. `sink.sqls` / `sink.paramSets` keep all of them: since the
   provider receipt became required, recordComplaintFiling always follows its
   INSERT with the UPDATE that writes the receipt, so a last-statement-only sink
   could no longer see the insert at all. */
function fakeDb(rows, sink = {}) {
  sink.sqls = [];
  sink.paramSets = [];
  return {
    async query(sql, params) {
      sink.sql = sql;
      sink.params = params;
      sink.sqls.push(sql);
      sink.paramSets.push(params);
      return { rows };
    }
  };
}

const filed = (target, extra = {}) => ({
  target,
  round: target === COMPLAINT_TARGET.CFPB ? "R4" : "R5",
  status: "sent",
  bureau: "EX",
  created_at: "2026-08-20T10:00:00.000Z",
  ...extra
});

describe("where a complaint is mailed", () => {
  test("the CFPB has a real postal address, and it is the one already on file", () => {
    const dest = complaintDestination(COMPLAINT_TARGET.CFPB);
    assert.equal(dest.ok, true);
    assert.equal(dest.to.address_line1, "P.O. Box 27170");
    assert.equal(dest.to.address_city, "Washington");
    assert.equal(dest.to.address_state, "DC");
    assert.equal(dest.to.address_zip, "20038");
  });

  test("THE STRUCTURED CFPB ADDRESS IS NOT A SECOND ADDRESS", () => {
    // If these two ever drift, one of them is wrong and a sworn complaint gets
    // mailed to the wrong place.
    for (const part of [
      CFPB_MAIL_ADDRESS.company_name,
      CFPB_MAIL_ADDRESS.address_line1,
      CFPB_MAIL_ADDRESS.address_city,
      CFPB_MAIL_ADDRESS.address_state,
      CFPB_MAIL_ADDRESS.address_zip
    ]) {
      assert.ok(CFPB_FILING.mail.includes(part),
        `${part} is not in the CFPB address the complaint itself prints: ${CFPB_FILING.mail}`);
    }
  });

  // REPLACED, NOT WEAKENED. This test used to read "NO STATE ATTORNEY GENERAL CAN
  // BE MAILED — no address was invented" and pinned agPostalAddress returning null
  // for every state, because the repository held no state AG addresses at all.
  // 38 confirmed addresses have since been added (src/metro2/letters/ag-statutes.mjs,
  // each with its source URL). The rule that test protected is unchanged and is
  // now pinned harder, in both directions, by the two tests below: a state with a
  // confirmed address mails to THAT address and nothing else, and a state without
  // one is still refused with nothing substituted for it.

  test("A STATE WITH NO CONFIRMED ADDRESS IS STILL REFUSED — nothing is substituted", () => {
    // The 12 states whose complaint mailing address could not be confirmed, plus
    // codes that are not states at all. Four of the 12 (NV, NY, OK, OR) do publish
    // a general office address; mailing a sworn complaint there is the failure
    // this refusal exists to prevent, so they are refused like the rest.
    const cannotMail = [...Object.keys(AG_MAIL_UNRESOLVED), "DC", "PR", "GU", "ZZ"];
    assert.equal(cannotMail.length, 16, "the unresolved list changed without this test being read");
    for (const state of cannotMail) {
      assert.equal(agPostalAddress(state), null, `${state} gained an unreviewed address`);
      const dest = complaintDestination(COMPLAINT_TARGET.STATE_AG, { state });
      assert.equal(dest.ok, false, `${state} was mailable without an address on file`);
      assert.equal(dest.reason, "ag_postal_address_unknown");
      assert.equal(dest.to, undefined, `${state} was handed a destination anyway`);
    }
  });

  test("a confirmed state mails to the address on file, and to nothing else", () => {
    for (const state of Object.keys(AG_MAIL_BY_STATE)) {
      const dest = complaintDestination(COMPLAINT_TARGET.STATE_AG, { state });
      assert.equal(dest.ok, true, `${state} has a confirmed address but was refused`);
      assert.deepEqual(dest.to, agPostalAddress(state),
        `${state} was mailed somewhere other than its address on file`);
      assert.equal(dest.to.address_state, state, `${state} was mailed to another state`);
      assert.equal(dest.office, dest.to.company_name,
        `${state} names one office and mails to another`);
    }
  });

  test("a client with no state on file is refused, not guessed at", () => {
    const dest = complaintDestination(COMPLAINT_TARGET.STATE_AG, {});
    assert.equal(dest.ok, false);
    assert.equal(dest.reason, "client_state_unknown");
  });

  test("a bureau or furnisher is not a complaint target", () => {
    for (const t of ["bureau", "furnisher", "", "  ", null, undefined, 0, {}, "complaint"]) {
      assert.equal(isComplaintTarget(t), false,
        `${JSON.stringify(t)} was read as a complaint target`);
    }
    for (const t of ["cfpb", "state_ag", "CFPB", " state_ag "]) {
      assert.equal(isComplaintTarget(t), true, `${JSON.stringify(t)} was not recognised`);
    }
  });

  test("R4 mails the CFPB, R5 the state AG, and no other round mails a complaint", () => {
    assert.equal(complaintTargetForRound("R4"), COMPLAINT_TARGET.CFPB);
    assert.equal(complaintTargetForRound("R5"), COMPLAINT_TARGET.STATE_AG);
    for (const r of ["R1", "R2", "R3", "R6", "FURNISHER", "", null, "R9"]) {
      assert.equal(complaintTargetForRound(r), null, `${r} tried to mail a complaint`);
    }
    assert.deepEqual(Object.keys(COMPLAINT_ROUND_TARGET), ["R4", "R5"]);
  });
});

describe("reading the record — only a mailing counts", () => {
  test("the filter lives in SQL, and this wire never writes", async () => {
    const sink = {};
    await loadComplaintFilings(fakeDb([], sink), { clientId: "cl-1" });
    assert.match(sink.sql, /FROM dispute_letters/i);
    assert.deepEqual(sink.params[1], ["cfpb", "state_ag"]);
    assert.deepEqual(sink.params[2], ["sent", "delivered"]);
    assert.equal(/INSERT|UPDATE|DELETE/i.test(sink.sql), false, "this wire must never write");
  });

  test("A GENERATED COMPLAINT IS NOT A FILED ONE", () => {
    // The whole distinction. Writing the PDF is not mailing it.
    for (const status of ["generated", "ready", "variance_failed", "failed", "", null]) {
      assert.equal(hasFiled([filed(COMPLAINT_TARGET.CFPB, { status })], COMPLAINT_TARGET.CFPB), false,
        `status '${status}' was counted as filed`);
      assert.deepEqual(formatComplaintFilings([filed(COMPLAINT_TARGET.CFPB, { status })]), []);
    }
    assert.deepEqual([...FILED_STATUSES], ["sent", "delivered"]);
  });

  test("a mailed complaint is on record", () => {
    assert.equal(hasFiled([filed(COMPLAINT_TARGET.CFPB)], COMPLAINT_TARGET.CFPB), true);
    assert.equal(hasFiled([filed(COMPLAINT_TARGET.CFPB)], COMPLAINT_TARGET.STATE_AG), false);
    assert.equal(hasFiled([filed(COMPLAINT_TARGET.CFPB, { status: "delivered" })], COMPLAINT_TARGET.CFPB), true);
  });

  test("nothing on file is never a filing", () => {
    for (const junk of [[], null, undefined, "cfpb", {}, [null], [{}], [{ target: "bureau", status: "sent" }]]) {
      assert.equal(hasFiled(junk, COMPLAINT_TARGET.CFPB), false,
        `${JSON.stringify(junk)} was read as a filing`);
    }
  });

  test("A DATABASE FAILURE REPORTS NO FILINGS, IT DOES NOT INVENT ONE", async () => {
    const broken = { async query() { throw new Error("connection lost"); } };
    const out = await loadComplaintFilings(broken, { clientId: "cl-1" });
    assert.deepEqual(out.filings, []);
    assert.ok(out.skip);
    assert.equal(hasFiled(out.filings, COMPLAINT_TARGET.CFPB), false);
  });

  test("a row whose round and target disagree is discarded, not trusted", async () => {
    // A CFPB row stamped R5, or an AG row stamped R4, is a corrupt record. It
    // must not license a sentence in a letter.
    const out = await loadComplaintFilings(
      fakeDb([
        { target: "cfpb", round: "R5", status: "sent", created_at: "2026-08-20" },
        { target: "state_ag", round: "R4", status: "sent", created_at: "2026-08-20" }
      ]),
      { clientId: "cl-1" }
    );
    assert.deepEqual(out.filings, []);
  });
});

describe("what Round 6 is allowed to say", () => {
  test("WITH A RECORD: Round 6 names the complaints that were actually mailed", () => {
    const text = r6([filed(COMPLAINT_TARGET.CFPB), filed(COMPLAINT_TARGET.STATE_AG)]);
    assert.match(text, /COMPLAINTS ALREADY FILED \(evidence\):/);
    assert.match(text, /On 2026-08-20 a complaint about this file was mailed to the Consumer Financial Protection Bureau\./);
    assert.match(text, /On 2026-08-20 a complaint about this file was mailed to my state attorney general\./);
  });

  test("WITH NO RECORD: ROUND 6 SAYS NOTHING ABOUT COMPLAINTS", () => {
    // THE ONE THAT KEEPS THE OWNER OUT OF TROUBLE.
    for (const nothing of [[], null, undefined]) {
      const text = r6(nothing);
      assert.equal(CLAIMS_FILED.test(text), false,
        "Round 6 claimed a complaint was filed with no record of one");
      assert.equal(text.includes("COMPLAINTS ALREADY FILED"), false);
    }
  });

  test("WITH ONLY THE CFPB ON RECORD: the state AG is never mentioned as filed", () => {
    // Today's real case — the CFPB is mailable, no state AG is.
    const text = r6([filed(COMPLAINT_TARGET.CFPB)]);
    assert.match(text, /mailed to the Consumer Financial Protection Bureau/);
    assert.equal(/mailed to my state attorney general/.test(text), false,
      "a state AG filing was claimed with no record of one");
  });

  test("A COMPLAINT THAT WAS WRITTEN BUT NOT MAILED EARNS NO SENTENCE", () => {
    const text = r6([
      filed(COMPLAINT_TARGET.CFPB, { status: "generated" }),
      filed(COMPLAINT_TARGET.STATE_AG, { status: "ready" })
    ]);
    assert.equal(CLAIMS_FILED.test(text), false,
      "an unmailed complaint was reported to the bureau as filed");
  });

  test("ROUNDS 1 TO 5 NEVER MENTION A FILING, EVEN WITH A FULL RECORD", () => {
    const record = [filed(COMPLAINT_TARGET.CFPB), filed(COMPLAINT_TARGET.STATE_AG)];
    for (const round of ["R1", "R2", "R3", "R4", "R5"]) {
      const text = buildLetterText({
        violations: VIOLATIONS, identity: IDENTITY, bureau: "EX", round, priorFilings: record
      });
      assert.equal(text.includes("COMPLAINTS ALREADY FILED"), false,
        `${round} referenced a complaint filing; only R6 may`);
    }
  });

  test("a record with no usable date states the filing without inventing a day", () => {
    const text = r6([filed(COMPLAINT_TARGET.CFPB, { created_at: null })]);
    assert.match(text, /A complaint about this file was mailed to the Consumer Financial Protection Bureau\./);
    assert.equal(/On \[|On undefined|On null/.test(text), false, "a placeholder date was printed");
  });

  test("two rows for the same target produce one sentence, not two", () => {
    const lines = formatComplaintFilings([filed(COMPLAINT_TARGET.CFPB), filed(COMPLAINT_TARGET.CFPB)]);
    assert.equal(lines.length, 1);
  });

  test("the R6 letter still carries its own bureau content", () => {
    const text = r6([filed(COMPLAINT_TARGET.CFPB)]);
    assert.match(text, /M2-005/);
    assert.match(text, /CITATIONS:/);
  });
});

describe("writing the record — only after the provider took it", () => {
  /* `providerId` is the mail provider's own identifier for the piece it took.
     It is REQUIRED, so it belongs in the fixture: without it there is no
     evidence a complaint was mailed, and Round 6 must stay silent rather than
     tell a credit bureau one was. ../../repair/send.mjs is the one caller and
     it passes the id it got back from the provider. */
  const good = {
    caseId: "case-1", orgId: "org-1", clientId: "cl-1", bureau: "EX",
    round: "R4", target: COMPLAINT_TARGET.CFPB, bodyText: "CFPB COMPLAINT ...",
    providerId: "ltr_prov_0001"
  };

  test("a mailed CFPB complaint is written as sent, on the existing table", async () => {
    const sink = {};
    const out = await recordComplaintFiling(fakeDb([{ id: "letter-1" }], sink), good);
    assert.equal(out.ok, true);
    const insertAt = sink.sqls.findIndex((q) => /INSERT INTO dispute_letters/i.test(q));
    assert.ok(insertAt >= 0, "no row was inserted");
    const inserted = sink.paramSets[insertAt];
    assert.ok(inserted.includes("sent"), "the row must say sent, not generated");
    assert.ok(inserted.includes("cfpb"));
    assert.ok(inserted.includes("R4"));
  });

  test("A ROUND AND TARGET THAT DISAGREE ARE NEVER WRITTEN", async () => {
    const sink = {};
    for (const bad of [
      { ...good, round: "R5" },
      { ...good, target: COMPLAINT_TARGET.STATE_AG },
      { ...good, round: "R6" },
      { ...good, round: "R1" }
    ]) {
      const out = await recordComplaintFiling(fakeDb([{ id: "x" }], sink), bad);
      assert.equal(out.ok, false, `${bad.round}/${bad.target} was written`);
      assert.equal(out.reason, "round_target_mismatch");
    }
  });

  test("a bureau letter is never recorded as a complaint filing", async () => {
    const out = await recordComplaintFiling(fakeDb([{ id: "x" }]), { ...good, target: "bureau" });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "not_a_complaint_target");
  });

  test("missing facts refuse the write rather than inventing them", async () => {
    for (const [field, reason] of [
      ["caseId", "no_case"], ["orgId", "no_client"], ["clientId", "no_client"],
      ["bodyText", "no_body_text"], ["providerId", "no_provider_receipt"]
    ]) {
      const out = await recordComplaintFiling(fakeDb([{ id: "x" }]), { ...good, [field]: null });
      assert.equal(out.ok, false, `a missing ${field} still wrote a filing row`);
      assert.equal(out.reason, reason);
    }
  });

  test("NO PROVIDER RECEIPT, NO FILING ROW — so Round 6 cannot say it was filed", async () => {
    /* This is the guard that stops the sentence "On <date> a complaint about
       this file was mailed to the Consumer Financial Protection Bureau" from
       being opened on our say-so. A caller must hold the provider's own
       identifier for the piece; intending to send is not sending. */
    const sink = {};
    for (const receipt of [null, undefined, "", "   "]) {
      const out = await recordComplaintFiling(fakeDb([{ id: "x" }], sink), {
        ...good, providerId: receipt
      });
      assert.equal(out.ok, false, `a filing row was written for ${JSON.stringify(receipt)}`);
      assert.equal(out.reason, "no_provider_receipt");
    }
    // And nothing reached Round 6's reader: no row means no sentence.
    assert.deepEqual(formatComplaintFilings([]), []);
  });

  test("the receipt is written onto the row, not just checked and dropped", async () => {
    const sink = {};
    const out = await recordComplaintFiling(fakeDb([{ id: "letter-1" }], sink), good);
    assert.equal(out.ok, true);
    const at = sink.sqls.findIndex((q) => /postgrid_letter_id/.test(q));
    assert.ok(at >= 0, "the receipt was checked and then never written down");
    assert.ok(sink.paramSets[at].includes("ltr_prov_0001"));
  });

  test("A WRITE FAILURE IS REPORTED, NOT SWALLOWED INTO A FALSE SUCCESS", async () => {
    const broken = { async query() { throw new Error("insert failed"); } };
    const out = await recordComplaintFiling(broken, good);
    assert.equal(out.ok, false);
    assert.match(out.reason, /insert failed/);
  });
});

describe("the send path records a mailing, and refuses what it cannot address", () => {
  test("the human send gate routes complaints — no second delivery path was built", () => {
    const src = readFileSync(new URL("../../repair/send.mjs", import.meta.url), "utf8");
    assert.match(src, /isComplaintTarget/,
      "the existing send gate must route complaints, not a new route");
    assert.match(src, /routing\.refusal/,
      "a complaint that cannot be addressed must be refused before it is sent");
    assert.equal(/fetch\(/.test(src), false,
      "src/repair/ may not transmit — only src/messaging/providers/ may");
  });

  test("the recording table is the one that already exists", () => {
    const src = readFileSync(new URL("./complaint-filing.mjs", import.meta.url), "utf8");
    assert.match(src, /FROM dispute_letters/,
      "the record lives in dispute_letters — no new table");
    assert.equal(/CREATE TABLE/i.test(src), false, "no new table may be defined here");
  });

  test("the migration widens the existing check rather than editing an applied one", () => {
    const sql = readFileSync(
      new URL("../../../db/migrations/270_dispute_letter_complaint_targets.sql", import.meta.url),
      "utf8"
    );
    assert.match(sql, /dispute_letters_target_check/);
    assert.match(sql, /'bureau'.*'furnisher'.*'cfpb'.*'state_ag'/s,
      "the widened check must keep both existing targets valid");
    assert.equal(/DROP TABLE|DELETE FROM|TRUNCATE/i.test(sql), false,
      "this migration must not destroy data");
  });
});
