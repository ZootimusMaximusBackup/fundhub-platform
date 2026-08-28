// COMPLIANCE REVIEW REQUIRED — dispute logic.
//
// Two things are being pinned here and they pull in opposite directions:
//
//   1. A round CAN advance. Before this wire existed the pack could only ever
//      write Round 1, so the Round 3 rung the escalation complaints sit above
//      was unreachable.
//   2. A round can advance ONLY on a bureau answer a human confirmed. Never on
//      a default, never on a near-miss account match, never on silence.
//
// Test 2 is the one that matters. If it ever goes green by accident, a client
// gets a Round 2 letter for an account no bureau has answered on.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  PRIOR_OUTCOME,
  priorOutcomeForRound,
  loadPriorOutcomes,
  stampPriorOutcomes
} from "./prior-outcome.mjs";
import { buildLetterPackForClient } from "./letter-pack.mjs";

/** A derogatory account the Metro 2 checker reliably finds defects on. */
const SIGNET = Object.freeze({
  source: "experian",
  creditorName: "SIGNET BANK/VIRGINIA",
  accountIdentifier: "1200119007344443",
  status: "closed",
  isDerogatory: true,
  currentBalance: 4798,
  reportedDate: "2021-09-03",
  closedDate: "2021-10-28",
  currentRatingType: "ChargeOff",
  comments: []
});

const SIGNET_LAST4 = "4443";

const CLIENT = Object.freeze({
  first_name: "Fixture",
  last_name: "Client",
  custom_fields: { address: "100 Test Ave", city: "Denton", state: "TX", zip: "76205" },
  outcome_tier: "REPAIR_ONLY"
});

function bureausWithSignet() {
  return {
    experian: { tradelines: [{ ...SIGNET, priorOutcome: null }] },
    transunion: { tradelines: [] },
    equifax: { tradelines: [] }
  };
}

/** The three reads buildLetterPackForClient makes. Nothing is written. */
function fakeDb(disputeRows = [], sink = {}) {
  return {
    async query(sql, params) {
      if (/FROM clients/i.test(sql)) return { rows: [CLIENT] };
      if (/FROM crs_results/i.test(sql)) return { rows: [{ result: { ok: true } }] };
      if (/FROM dispute_items/i.test(sql)) {
        sink.sql = sql;
        sink.params = params;
        return { rows: disputeRows };
      }
      return { rows: [] };
    }
  };
}

const engineWithSignet = () => ({
  outcome: "REPAIR_ONLY",
  normalized: { tradelines: [{ ...SIGNET }] }
});

const names = (pack) => pack.files.map((f) => f.filename);

describe("priorOutcomeForRound — which of the pack's three letters a round earns", () => {
  test("R1 and FURNISHER earn nothing, so Round 1 behaviour is untouched", () => {
    assert.equal(priorOutcomeForRound("R1"), null);
    assert.equal(priorOutcomeForRound("FURNISHER"), null);
  });

  test("R2 earns the method-of-verification letter, R3 the final notice", () => {
    assert.equal(priorOutcomeForRound("R2"), PRIOR_OUTCOME.ROUND_2);
    assert.equal(priorOutcomeForRound("R3"), PRIOR_OUTCOME.ROUND_3);
  });

  test("R4–R6 reuse the R2/R3 shapes, per promptPoolRound — no second rule", () => {
    assert.equal(priorOutcomeForRound("R4"), PRIOR_OUTCOME.ROUND_2);
    assert.equal(priorOutcomeForRound("R5"), PRIOR_OUTCOME.ROUND_3);
    assert.equal(priorOutcomeForRound("R6"), PRIOR_OUTCOME.ROUND_2);
  });

  test("nothing recognisable earns nothing — never a default", () => {
    for (const junk of [null, undefined, "", "  ", "R9", "round two", 2, {}]) {
      assert.equal(priorOutcomeForRound(junk), null, `${JSON.stringify(junk)} advanced a round`);
    }
  });
});

describe("loadPriorOutcomes — the gate lives in SQL", () => {
  test("only an escalated item with a recorded verified answer is read", async () => {
    const sink = {};
    await loadPriorOutcomes(fakeDb([], sink), { clientId: "cl-1" });
    assert.deepEqual(sink.params, ["cl-1", "escalated", "verified"]);
    assert.match(sink.sql, /di\.status\s*=\s*\$2/);
    assert.match(sink.sql, /di\.outcome\s*=\s*\$3/);
    // Read-only. This wire must never write a round, only read one.
    assert.doesNotMatch(sink.sql, /INSERT|UPDATE|DELETE/i);
  });

  test("no database and no client read nothing and say why", async () => {
    assert.deepEqual(await loadPriorOutcomes(null, { clientId: "cl-1" }), { outcomes: [], skip: "no_db" });
    assert.deepEqual(await loadPriorOutcomes(fakeDb()), { outcomes: [], skip: "no_client" });
  });

  test("a database failure is reported, not thrown — letters must survive it", async () => {
    const broken = { async query() { throw new Error("connection reset"); } };
    const out = await loadPriorOutcomes(broken, { clientId: "cl-1" });
    assert.deepEqual(out.outcomes, []);
    assert.match(out.skip, /connection reset/);
  });
});

describe("stampPriorOutcomes — the account has to be the same account", () => {
  test("same bureau and same last four advances that account", () => {
    const bureaus = bureausWithSignet();
    const out = stampPriorOutcomes(bureaus, [
      { bureau: "EX", creditor: "SIGNET BANK/VIRGINIA", account_last4: SIGNET_LAST4, round: "R2" }
    ]);
    assert.equal(out.stamped, 1);
    assert.equal(bureaus.experian.tradelines[0].priorOutcome, PRIOR_OUTCOME.ROUND_2);
  });

  test("an answer from another bureau never advances this bureau's copy", () => {
    const bureaus = bureausWithSignet();
    const out = stampPriorOutcomes(bureaus, [
      { bureau: "TU", creditor: "SIGNET BANK/VIRGINIA", account_last4: SIGNET_LAST4, round: "R2" }
    ]);
    assert.equal(out.stamped, 0);
    assert.equal(out.unmatched, 1);
    assert.equal(bureaus.experian.tradelines[0].priorOutcome, null);
  });

  test("a different account number never advances", () => {
    const bureaus = bureausWithSignet();
    const out = stampPriorOutcomes(bureaus, [
      { bureau: "EX", creditor: "SIGNET BANK/VIRGINIA", account_last4: "9999", round: "R2" }
    ]);
    assert.equal(out.stamped, 0);
    assert.equal(bureaus.experian.tradelines[0].priorOutcome, null);
  });

  test("an item still at R1 advances nothing", () => {
    const bureaus = bureausWithSignet();
    const out = stampPriorOutcomes(bureaus, [
      { bureau: "EX", creditor: "SIGNET BANK/VIRGINIA", account_last4: SIGNET_LAST4, round: "R1" }
    ]);
    assert.equal(out.stamped, 0);
    assert.equal(bureaus.experian.tradelines[0].priorOutcome, null);
  });

  test("no recorded answers at all advances nothing", () => {
    const bureaus = bureausWithSignet();
    assert.deepEqual(stampPriorOutcomes(bureaus, []), { stamped: 0, unmatched: 0 });
    assert.equal(bureaus.experian.tradelines[0].priorOutcome, null);
  });

  test("a creditor name with no account number is only enough when it is unambiguous", () => {
    const two = {
      experian: {
        tradelines: [
          { ...SIGNET, accountIdentifier: "1111222233334443", priorOutcome: null },
          { ...SIGNET, accountIdentifier: "5555666677778888", priorOutcome: null }
        ]
      }
    };
    const out = stampPriorOutcomes(two, [
      { bureau: "EX", creditor: "SIGNET BANK/VIRGINIA", account_last4: null, round: "R2" }
    ]);
    assert.equal(out.stamped, 0, "two cards from one bank must not both escalate on one answer");
    assert.equal(two.experian.tradelines[0].priorOutcome, null);
    assert.equal(two.experian.tradelines[1].priorOutcome, null);

    const one = bureausWithSignet();
    const solo = stampPriorOutcomes(one, [
      { bureau: "EX", creditor: "signet bank/virginia", account_last4: null, round: "R2" }
    ]);
    assert.equal(solo.stamped, 1);
    assert.equal(one.experian.tradelines[0].priorOutcome, PRIOR_OUTCOME.ROUND_2);
  });

  test("two recorded answers keep the further round, never step back down", () => {
    const bureaus = bureausWithSignet();
    stampPriorOutcomes(bureaus, [
      { bureau: "EX", creditor: "SIGNET", account_last4: SIGNET_LAST4, round: "R3" },
      { bureau: "EX", creditor: "SIGNET", account_last4: SIGNET_LAST4, round: "R2" }
    ]);
    assert.equal(bureaus.experian.tradelines[0].priorOutcome, PRIOR_OUTCOME.ROUND_3);
  });
});

describe("the whole wire — through buildLetterPackForClient, the app's own entry point", () => {
  test("REGRESSION: with no recorded answer the pack still writes Round 1 only", async () => {
    const pack = await buildLetterPackForClient(
      fakeDb([]),
      { clientId: "cl-1", pack: "repair" },
      { runEngine: engineWithSignet }
    );
    const files = names(pack);
    assert.ok(files.includes("ex_round1.pdf"), `no Round 1 letter: ${files.join(", ")}`);
    assert.ok(!files.includes("ex_round2.pdf"));
    assert.ok(!files.includes("ex_round3.pdf"));
    assert.equal(pack.roundsAdvanced, 0);
    assert.equal(pack.priorOutcomeSkip, null);
  });

  test("THE FIX: a confirmed verified answer at R2 produces the Round 2 letter", async () => {
    const pack = await buildLetterPackForClient(
      fakeDb([{ bureau: "EX", creditor: "SIGNET BANK/VIRGINIA", account_last4: SIGNET_LAST4, round: "R2" }]),
      { clientId: "cl-1", pack: "repair" },
      { runEngine: engineWithSignet }
    );
    const files = names(pack);
    assert.ok(files.includes("ex_round2.pdf"), `no Round 2 letter: ${files.join(", ")}`);
    // The account has moved on. It must not also be disputed as if it were new.
    assert.ok(!files.includes("ex_round1.pdf"), "Round 1 was written again for an answered account");
    assert.equal(pack.roundsAdvanced, 1);
  });

  test("THE FIX: a second verified answer reaches Round 3 — the rung the complaints sit above", async () => {
    const pack = await buildLetterPackForClient(
      fakeDb([{ bureau: "EX", creditor: "SIGNET BANK/VIRGINIA", account_last4: SIGNET_LAST4, round: "R3" }]),
      { clientId: "cl-1", pack: "repair" },
      { runEngine: engineWithSignet }
    );
    const files = names(pack);
    assert.ok(files.includes("ex_round3.pdf"), `no Round 3 letter: ${files.join(", ")}`);
    assert.ok(!files.includes("ex_round1.pdf"));
    assert.ok(!files.includes("ex_round2.pdf"));
    assert.equal(pack.roundsAdvanced, 1);
  });

  test("a recorded answer for an account this pull does not contain is counted, not applied", async () => {
    const pack = await buildLetterPackForClient(
      fakeDb([{ bureau: "EX", creditor: "SOME OTHER BANK", account_last4: "0000", round: "R2" }]),
      { clientId: "cl-1", pack: "repair" },
      { runEngine: engineWithSignet }
    );
    assert.equal(pack.roundsAdvanced, 0);
    assert.equal(pack.roundsUnmatched, 1);
    assert.ok(names(pack).includes("ex_round1.pdf"));
  });
});
