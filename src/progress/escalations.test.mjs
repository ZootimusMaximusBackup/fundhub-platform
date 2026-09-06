// Rounds 4 and 5 in three states, and the one state that may never be inferred.
//
// OWNER-SET 2026-09-05: prepared / sent / filed. "sent" comes off the letter row.
// "filed" comes only from the client saying so. The tests that matter are the
// ones proving a MAILED complaint still reads as sent — because that is the
// exact confusion the whole feature exists to prevent.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  escalationStates, clientReportedFiling, ESCALATION_ROUNDS, ESCALATION_STATES
} from "./escalations.mjs";

const R4 = { round: "R4", target: "cfpb" };
const R5 = { round: "R5", target: "state_ag" };

const MAR1 = "2026-03-01T00:00:00.000Z";
const MAR3 = "2026-03-03T00:00:00.000Z";
const APR1 = "2026-04-01T00:00:00.000Z";

describe("the three states", () => {
  test("the rungs and the states are exactly the ones the owner set", () => {
    assert.deepEqual([...ESCALATION_ROUNDS], ["R4", "R5"]);
    assert.deepEqual([...ESCALATION_STATES], ["prepared", "sent", "filed"]);
  });

  test("a generated letter is prepared, and carries no sent date", () => {
    const out = escalationStates([{ ...R4, status: "generated", created_at: MAR1, mailed_at: null }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].round, 4);
    assert.equal(out[0].target, "cfpb");
    assert.equal(out[0].state, "prepared");
    assert.equal(out[0].preparedAt, MAR1);
    assert.equal(out[0].sentAt, null);
    assert.equal(out[0].filed, false);
    assert.equal(out[0].filedAt, null);
  });

  test("a mailed letter is SENT and is not filed", () => {
    const out = escalationStates([{ ...R4, status: "sent", created_at: MAR1, mailed_at: MAR3 }]);
    assert.equal(out[0].state, "sent");
    assert.equal(out[0].sentAt, MAR3);
    assert.equal(out[0].filed, false);
    assert.equal(out[0].filedAt, null);
    assert.equal(out[0].filedReportedBy, null);
  });

  test("a DELIVERED letter is still only sent — delivery is not filing", () => {
    const out = escalationStates([{ ...R5, status: "delivered", created_at: MAR1, mailed_at: MAR3 }]);
    assert.equal(out[0].state, "sent");
    assert.equal(out[0].filed, false);
  });

  test("status 'sent' with no mailed_at is sent with an UNKNOWN date, not a fake one", () => {
    // recordComplaintFiling() writes exactly this shape, so it is the common case.
    const out = escalationStates([{ ...R4, status: "sent", created_at: MAR1, mailed_at: null }]);
    assert.equal(out[0].state, "sent");
    assert.equal(out[0].sentAt, null, "created_at must never stand in for a mailing date");
    assert.equal(out[0].preparedAt, MAR1);
  });

  test("only a client report makes it filed, and the payload says who said so", () => {
    const cf = {
      escalation_filings: {
        R4: { filedAt: APR1, reportedBy: "client", caseNumber: "260401-1234567" }
      }
    };
    const out = escalationStates(
      [{ ...R4, status: "sent", created_at: MAR1, mailed_at: MAR3 }], cf
    );
    assert.equal(out[0].state, "filed");
    assert.equal(out[0].filed, true);
    assert.equal(out[0].filedAt, APR1);
    assert.equal(out[0].filedReportedBy, "client");
    assert.equal(out[0].caseNumber, "260401-1234567");
    // The earlier facts survive underneath the newer one.
    assert.equal(out[0].sentAt, MAR3);
    assert.equal(out[0].preparedAt, MAR1);
  });

  test("a client can report a filing on a complaint we only prepared", () => {
    const cf = { escalation_filings: { R5: { filedAt: APR1 } } };
    const out = escalationStates([{ ...R5, status: "generated", created_at: MAR1 }], cf);
    assert.equal(out[0].state, "filed");
    assert.equal(out[0].sentAt, null);
    assert.equal(out[0].filedReportedBy, "client", "defaults to the only party that can ping");
    assert.equal(out[0].caseNumber, null, "no case number is null, never an empty string");
  });
});

describe("nothing is inferred, and nothing is invented", () => {
  test("a client who never reached R4 gets an EMPTY LIST, not two placeholders", () => {
    assert.deepEqual(escalationStates([], null), []);
    assert.deepEqual(escalationStates([
      { round: "R2", target: "bureau", status: "sent", created_at: MAR1 }
    ]), []);
  });

  test("a report with no date is not a filing", () => {
    const cf = { escalation_filings: { R4: { reportedBy: "client", caseNumber: "x" } } };
    assert.equal(clientReportedFiling(cf, "R4"), null);
    const out = escalationStates([{ ...R4, status: "sent", created_at: MAR1 }], cf);
    assert.equal(out[0].state, "sent", "a caseNumber alone must not promote the state");
    assert.equal(out[0].filed, false);
  });

  test("no report at all is null — unknown, not 'they did not file'", () => {
    assert.equal(clientReportedFiling(null, "R4"), null);
    assert.equal(clientReportedFiling({}, "R4"), null);
    assert.equal(clientReportedFiling({ escalation_filings: {} }, "R4"), null);
    assert.equal(clientReportedFiling({ escalation_filings: "nope" }, "R4"), null);
    assert.equal(clientReportedFiling({ escalation_filings: { R4: 7 } }, "R4"), null);
  });

  test("an R5 report does not make R4 filed", () => {
    const cf = { escalation_filings: { R5: { filedAt: APR1 } } };
    const out = escalationStates([
      { ...R4, status: "sent", created_at: MAR1, mailed_at: MAR3 },
      { ...R5, status: "generated", created_at: MAR3 }
    ], cf);
    assert.equal(out.length, 2);
    assert.equal(out[0].round, 4);
    assert.equal(out[0].state, "sent");
    assert.equal(out[1].round, 5);
    assert.equal(out[1].state, "filed");
  });

  test("a row whose round and target disagree is dropped as corrupt", () => {
    // R4 is the CFPB rung; a row claiming R4 and state_ag is not a record of
    // anything, and trusting it would put a complaint on the wrong panel.
    assert.deepEqual(escalationStates([
      { round: "R4", target: "state_ag", status: "sent", created_at: MAR1 }
    ]), []);
  });

  test("rounds come back in ladder order however the rows arrive", () => {
    const out = escalationStates([
      { ...R5, status: "generated", created_at: MAR3 },
      { ...R4, status: "generated", created_at: MAR1 }
    ]);
    assert.deepEqual(out.map((e) => e.round), [4, 5]);
  });

  test("with several letters for one rung, prepared is the EARLIEST", () => {
    const out = escalationStates([
      { ...R4, status: "generated", created_at: MAR3 },
      { ...R4, status: "sent", created_at: MAR1, mailed_at: MAR3 }
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].preparedAt, MAR1);
    assert.equal(out[0].sentAt, MAR3);
  });

  test("junk rows and junk dates do not crash and do not produce a date", () => {
    const out = escalationStates([
      { ...R4, status: "sent", created_at: "not a date", mailed_at: "also not" }
    ]);
    assert.equal(out[0].state, "sent");
    assert.equal(out[0].preparedAt, null);
    assert.equal(out[0].sentAt, null);
  });

  test("a non-array is an empty list, not a throw", () => {
    assert.deepEqual(escalationStates(null), []);
    assert.deepEqual(escalationStates(undefined), []);
    assert.deepEqual(escalationStates("rows"), []);
  });
});

describe("no field in an escalation entry is a sentence a client reads", () => {
  test("every value is an enum, a number, a date, a boolean or null", () => {
    const cf = { escalation_filings: { R4: { filedAt: APR1, caseNumber: "260401-1" } } };
    const [e] = escalationStates([{ ...R4, status: "sent", created_at: MAR1, mailed_at: MAR3 }], cf);
    assert.equal(typeof e.round, "number");
    assert.ok(["cfpb", "state_ag"].includes(e.target));
    assert.ok(ESCALATION_STATES.includes(e.state));
    assert.equal(typeof e.filed, "boolean");
    for (const k of ["preparedAt", "sentAt", "filedAt"]) {
      assert.ok(e[k] === null || !Number.isNaN(Date.parse(e[k])), `${k} is not a date or null`);
    }
    /* Nothing here spells out a claim in English for the screen to echo. Only
       the VALUES are checked — `filedAt` and `sentAt` are field names, and the
       front end chooses the words for them. `state` is excluded because its
       value IS the enum under test above. */
    const values = Object.entries(e)
      .filter(([k]) => k !== "state")
      .map(([, v]) => String(v))
      .join(" | ");
    assert.ok(!/\b(filed|mailed|sent|submitted|lodged)\b/i.test(values),
      `a value reads as a sentence: ${values}`);
  });
});
