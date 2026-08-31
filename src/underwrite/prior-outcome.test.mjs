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
  stampPriorOutcomes,
  reachedEscalation,
  highestEscalationRound
} from "./prior-outcome.mjs";
import { buildLetterPackForClient } from "./letter-pack.mjs";
import { applyItemOutcome } from "../metro2/rounds/state.mjs";

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

  test("R4–R6 take the strongest bureau letter that exists, per promptPoolRound", () => {
    // The vendor letter writer knows three rounds. An item past Round 3 gets its
    // final-notice letter — the strongest of the three — and the escalation
    // itself is carried by the CFPB and state AG complaints, which are separate
    // documents. This used to be ROUND_2 for R4 and R6, which handed a client on
    // round six the Round 2 method-of-verification letter again.
    assert.equal(priorOutcomeForRound("R4"), PRIOR_OUTCOME.ROUND_3);
    assert.equal(priorOutcomeForRound("R5"), PRIOR_OUTCOME.ROUND_3);
    assert.equal(priorOutcomeForRound("R6"), PRIOR_OUTCOME.ROUND_3);
  });

  test("NO ROUND PAST R2 EVER DROPS BACK TO THE ROUND 2 LETTER", () => {
    for (const round of ["R3", "R4", "R5", "R6"]) {
      assert.notEqual(priorOutcomeForRound(round), PRIOR_OUTCOME.ROUND_2,
        `${round} would hand the client the Round 2 letter again`);
    }
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

// ═══════════════════════════════════════════════════════════════════════════════
// REACHING THE ESCALATION ROUNDS
//
// COMPLIANCE REVIEW REQUIRED — dispute logic.
//
// This is the gate the CFPB and state attorney general complaints hang on. Both
// are signed by the client under penalty of perjury. A client must NEVER reach
// R4 by default, by guess, or by empty data — only by a real recorded,
// human-confirmed bureau answer.
// ═══════════════════════════════════════════════════════════════════════════════

describe("reachedEscalation — R4 is earned, never assumed", () => {
  const at = (round) => [{ bureau: "EX", creditor: "A BANK", account_last4: "1234", round }];

  test("NOTHING ON FILE IS NOT ESCALATION — this is the default and it must refuse", () => {
    for (const empty of [[], undefined, null, "", 0, false, {}, "R4"]) {
      assert.equal(reachedEscalation(empty), false,
        `${JSON.stringify(empty)} was read as escalation`);
    }
  });

  test("still working the bureau rounds is not escalation", () => {
    for (const round of ["R1", "R2", "R3", "FURNISHER"]) {
      assert.equal(reachedEscalation(at(round)), false, `${round} was read as escalation`);
    }
  });

  test("a recorded answer at R4, R5 or R6 is escalation", () => {
    for (const round of ["R4", "R5", "R6", "r4"]) {
      assert.equal(reachedEscalation(at(round)), true, `${round} was not read as escalation`);
    }
  });

  test("A MALFORMED ROUND IS NEVER GUESSED UP TO R4", () => {
    const junk = [null, undefined, "", "   ", "R", "R0", "R7", "R9", "R44", 4, "4",
      "round 4", "escalated", true, {}, [], "R4X", " R 4 "];
    for (const round of junk) {
      assert.equal(reachedEscalation([{ round }]), false,
        `${JSON.stringify(round)} was guessed into an escalation round`);
    }
  });

  test("a row with no round at all refuses", () => {
    assert.equal(reachedEscalation([{}]), false);
    assert.equal(reachedEscalation([null]), false);
    assert.equal(reachedEscalation([undefined]), false);
    assert.equal(reachedEscalation([{ bureau: "EX", creditor: "A BANK" }]), false);
  });

  test("one escalated account among many early ones is enough", () => {
    assert.equal(reachedEscalation([...at("R1"), ...at("R2"), ...at("R5")]), true);
    assert.equal(reachedEscalation([...at("R1"), ...at("R2"), ...at("R3")]), false);
  });

  test("highestEscalationRound reports the furthest rung, and null below R4", () => {
    assert.equal(highestEscalationRound([...at("R4"), ...at("R6"), ...at("R5")]), "R6");
    assert.equal(highestEscalationRound(at("R4")), "R4");
    assert.equal(highestEscalationRound([...at("R1"), ...at("R3")]), null);
    assert.equal(highestEscalationRound([]), null);
    assert.equal(highestEscalationRound(null), null);
  });
});

describe("the human gate and the complaint gate agree", () => {
  // COMPLIANCE REVIEW REQUIRED — dispute logic.
  //
  // An R3 answer that no person confirmed is held by
  // ../metro2/rounds/state.mjs applyItemOutcome. It must also fail to release
  // the sworn complaints — the two gates have to line up, or a held item still
  // hands the client a CFPB complaint.
  const asRow = (item) => ({
    bureau: "EX",
    creditor: item.creditor,
    account_last4: item.account_last4,
    round: item.round,
    status: item.status,
    outcome: item.outcome
  });
  const r3Item = { creditor: "A BANK", account_last4: "1234", round: "R3", status: "sent" };

  test("A MACHINE-HELD R3 ANSWER RELEASES NOTHING", () => {
    const held = applyItemOutcome(r3Item, "verified");
    assert.equal(held.round, "R3");
    assert.equal(held.status, "verified");
    // loadPriorOutcomes only returns status 'escalated'. This row would not even
    // come back — and if it somehow did, the round is still R3.
    assert.equal(reachedEscalation([asRow(held)]), false,
      "an unconfirmed R3 answer released the sworn complaints");
    assert.equal(highestEscalationRound([asRow(held)]), null);
  });

  test("the same answer, confirmed by a person, does release them", () => {
    const advanced = applyItemOutcome(r3Item, "verified", { humanConfirmed: true });
    assert.equal(advanced.round, "R4");
    assert.equal(advanced.status, "escalated");
    assert.equal(reachedEscalation([asRow(advanced)]), true);
    assert.equal(highestEscalationRound([asRow(advanced)]), "R4");
  });

  test("R1 and R2 answers still advance with no person, and still release nothing", () => {
    for (const round of ["R1", "R2"]) {
      const auto = applyItemOutcome({ ...r3Item, round }, "verified");
      assert.equal(auto.status, "escalated", `${round} stopped advancing on its own`);
      assert.equal(reachedEscalation([asRow(auto)]), false,
        `${round} released a complaint it has not earned`);
    }
  });
});

describe("the escalation gate cannot be reached without the round machine", () => {
  test("the gate reads only confirmed answers, so it cannot be tricked", async () => {
    // The gate reads rows from loadPriorOutcomes and nothing else. That query
    // filters on status = 'escalated' AND outcome = 'verified', which only
    // ../metro2/rounds/state.mjs applyItemOutcome can set, and only from a
    // recorded bureau answer a human confirmed. Pinned here so the gate and the
    // query can never drift apart.
    const sink = {};
    await loadPriorOutcomes(fakeDb([], sink), { clientId: "cl-1" });
    assert.deepEqual(sink.params, ["cl-1", "escalated", "verified"]);
    assert.match(sink.sql, /di\.round/, "the gate needs the round, so the query must select it");
    assert.equal(/INSERT|UPDATE|DELETE/i.test(sink.sql), false, "this wire must never write");
  });

  test("A DATABASE FAILURE WITHHOLDS THE COMPLAINTS, IT DOES NOT RELEASE THEM", async () => {
    const broken = { async query() { throw new Error("connection lost"); } };
    const out = await loadPriorOutcomes(broken, { clientId: "cl-1" });
    assert.deepEqual(out.outcomes, []);
    assert.ok(out.skip, "the failure must be reported");
    assert.equal(reachedEscalation(out.outcomes), false,
      "a hiccup reading the database must never be read as 'this client escalated'");
  });
});
