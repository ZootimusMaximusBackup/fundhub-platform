// § 5.5 dispute status — M2-028 … M2-030.
//
// The dispute timeline is not in the credit report, so the negative fixtures
// here mostly prove one thing: with no case history, none of these three rules
// fires. A furnisher cannot be faulted for omitting a dispute flag for a dispute
// nobody made, and that is exactly the claim a bare soft pull would otherwise
// invite the engine to invent.

import test from "node:test";
import assert from "node:assert/strict";

import {
  checkActiveDisputeNotFlagged,
  checkStaleDisputeFlag,
  checkWrongPostInvestigationCode
} from "./dispute-status.mjs";
import { cleanTradeline, cleanContext, blindContext, observed, absent, notVisible } from "./fixtures/tradelines.mjs";

function assertWellFormed(v, ruleId) {
  assert.equal(v.ruleId, ruleId);
  assert.equal(v.severity, "moderate");
  assert.ok(typeof v.reason === "string" && v.reason.length > 20);
  assert.ok(Array.isArray(v.citations) && v.citations.length > 0);
  assert.ok(typeof v.metro2Ref === "string" && v.metro2Ref.length > 0);
}

const openDispute = (overrides = {}) =>
  cleanContext({
    dispute: {
      active: observed(true),
      investigationCompleted: observed(false),
      consumerDisagreesWithOutcome: observed(false),
      ...overrides
    }
  });

const closedDispute = (overrides = {}) =>
  cleanContext({
    dispute: {
      active: observed(false),
      investigationCompleted: observed(true),
      consumerDisagreesWithOutcome: observed(false),
      ...overrides
    }
  });

// ── M2-028 — open dispute with no dispute code ─────────────────────────────

test("M2-028 fires when an open dispute is not flagged on the tradeline", () => {
  const [v] = checkActiveDisputeNotFlagged(cleanTradeline({ field_20_compliance_condition: absent() }), openDispute());
  assertWellFormed(v, "M2-028");
  assert.equal(v.field, "20");
  assert.match(v.reason, /may not keep reporting it without marking it as disputed/);
});

test("M2-028 fires when the code reported is not one that records a dispute", () => {
  const [v] = checkActiveDisputeNotFlagged(
    cleanTradeline({ field_20_compliance_condition: observed("XA") }),
    openDispute()
  );
  assertWellFormed(v, "M2-028");
  assert.equal(v.observed, "XA");
});

test("M2-028 does not fire when XB is reported", () => {
  assert.deepEqual(
    checkActiveDisputeNotFlagged(cleanTradeline({ field_20_compliance_condition: observed("XB") }), openDispute()),
    []
  );
});

test("M2-028 accepts the combination codes that contain XB or XF", () => {
  for (const code of ["XD", "XF", "XJ"]) {
    assert.deepEqual(
      checkActiveDisputeNotFlagged(cleanTradeline({ field_20_compliance_condition: observed(code) }), openDispute()),
      [],
      `${code} records a dispute in progress`
    );
  }
});

test("M2-028 does not fire once the investigation has closed", () => {
  assert.deepEqual(
    checkActiveDisputeNotFlagged(
      cleanTradeline({ field_20_compliance_condition: absent() }),
      openDispute({ investigationCompleted: observed(true) })
    ),
    []
  );
});

test("M2-028 does not fire with no dispute on record", () => {
  assert.deepEqual(checkActiveDisputeNotFlagged(cleanTradeline(), cleanContext()), []);
  assert.deepEqual(checkActiveDisputeNotFlagged(cleanTradeline(), blindContext()), []);
});

test("M2-028 does not fire when Field 20 is not visible", () => {
  assert.deepEqual(
    checkActiveDisputeNotFlagged(cleanTradeline({ field_20_compliance_condition: notVisible() }), openDispute()),
    []
  );
});

// ── M2-029 — stale in-progress flag ────────────────────────────────────────

test("M2-029 fires when XB is left on after the investigation closed", () => {
  const [v] = checkStaleDisputeFlag(cleanTradeline({ field_20_compliance_condition: observed("XB") }), closedDispute());
  assertWellFormed(v, "M2-029");
  assert.equal(v.observed, "XB");
  assert.match(v.reason, /requires it to be removed/);
});

test("M2-029 points at the disagreement codes when the consumer rejected the outcome", () => {
  const [v] = checkStaleDisputeFlag(
    cleanTradeline({ field_20_compliance_condition: observed("XB") }),
    closedDispute({ consumerDisagreesWithOutcome: observed(true) })
  );
  assert.deepEqual(v.expected, ["XC", "XE", "XG"]);
});

test("M2-029 does not fire on a completed-investigation code", () => {
  assert.deepEqual(
    checkStaleDisputeFlag(cleanTradeline({ field_20_compliance_condition: observed("XC") }), closedDispute()),
    []
  );
});

test("M2-029 does not fire while the investigation is still open", () => {
  assert.deepEqual(
    checkStaleDisputeFlag(cleanTradeline({ field_20_compliance_condition: observed("XB") }), openDispute()),
    []
  );
});

// ── M2-030 — XH where XC is correct ────────────────────────────────────────

test("M2-030 fires when XH is reported and the consumer still disagrees", () => {
  const [v] = checkWrongPostInvestigationCode(
    cleanTradeline({ field_20_compliance_condition: observed("XH") }),
    closedDispute({ consumerDisagreesWithOutcome: observed(true) })
  );
  assertWellFormed(v, "M2-030");
  assert.equal(v.expected, "XC");
  assert.match(v.reason, /makes the account read as resolved/);
});

test("M2-030 does not fire when XC already records the disagreement", () => {
  assert.deepEqual(
    checkWrongPostInvestigationCode(
      cleanTradeline({ field_20_compliance_condition: observed("XC") }),
      closedDispute({ consumerDisagreesWithOutcome: observed(true) })
    ),
    []
  );
});

test("M2-030 does not fire when the consumer accepted the outcome", () => {
  assert.deepEqual(
    checkWrongPostInvestigationCode(cleanTradeline({ field_20_compliance_condition: observed("XH") }), closedDispute()),
    []
  );
});

test("M2-030 does not fire on an in-progress code — that is M2-029's finding", () => {
  assert.deepEqual(
    checkWrongPostInvestigationCode(
      cleanTradeline({ field_20_compliance_condition: observed("XB") }),
      closedDispute({ consumerDisagreesWithOutcome: observed(true) })
    ),
    []
  );
});

test("M2-030 does not fire with no dispute history", () => {
  assert.deepEqual(
    checkWrongPostInvestigationCode(cleanTradeline({ field_20_compliance_condition: observed("XH") }), blindContext()),
    []
  );
});
