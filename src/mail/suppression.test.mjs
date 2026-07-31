// Unit tests for the suppression gate's pure half and its fail-closed contract.
//
// WHAT IS DELIBERATELY NOT TESTED HERE. There is no fake database returning
// fake `clients` rows. A hand-built stub modelling the schema you wish you had
// cannot fail when the real schema moves (AUDIT-FINDINGS), and "this record is
// clear to mail" is the single claim in this repo that must never be proved
// against a fiction. Every positive path is proved in suppression.pg.test.mjs
// against real tables.
//
// What IS proved here is the half a database cannot help with: the vocabulary,
// the pure identity reader, and — the important one — that every failure mode
// comes back SUPPRESSED. The `db` objects below are failure injectors and
// tripwires, not models of anything: one throws whatever it is asked, the other
// fails the test if it is asked at all.

import { test } from "node:test";
import assert from "node:assert";
import {
  SUPPRESSION_REASONS,
  SUPPRESSION_REASON_VALUES,
  DROP_BLOCK_REASONS,
  NotDroppableError,
  isSuppressionReason,
  recordIdentity,
  checkSuppression,
  applySuppression,
  assertDroppable
} from "./suppression.mjs";

const ORG = "0f8a1c1e-1111-4b2c-8d3e-000000000001";
const RECORD = "0f8a1c1e-2222-4b2c-8d3e-000000000002";

/** Fails the test if the database is touched. */
const forbiddenDb = {
  query: async () => {
    throw new Error("this path must reach a decision without a query");
  }
};

/** A database that is down. `08006` is what pg reports for a dropped connection. */
const brokenDb = {
  query: async () => {
    throw Object.assign(new Error("connection terminated unexpectedly"), { code: "08006" });
  }
};

/* ------------------------------------------------------------------ vocabulary */

test("SUPPRESSION_REASONS: the vocabulary is closed, frozen and snake_case, because it constrains a free-text column", () => {
  assert.ok(Object.isFrozen(SUPPRESSION_REASONS));
  assert.deepEqual(SUPPRESSION_REASON_VALUES.slice().sort(), [
    "check_failed", "existing_client", "opt_out", "prior_responder", "unidentifiable"
  ]);
  for (const v of SUPPRESSION_REASON_VALUES) assert.match(v, /^[a-z][a-z_]*[a-z]$/);
});

test("isSuppressionReason: free text a human typed into the column is not mistaken for the vocabulary", () => {
  assert.ok(isSuppressionReason("existing_client"));
  assert.ok(!isSuppressionReason("Existing Client"));
  assert.ok(!isSuppressionReason("returned mail"));
  assert.ok(!isSuppressionReason(null));
  assert.ok(!isSuppressionReason(undefined));
});

test("DROP_BLOCK_REASONS: the gate's own refusals are separate from the reasons written to the column", () => {
  for (const reason of Object.values(DROP_BLOCK_REASONS)) {
    assert.ok(!SUPPRESSION_REASON_VALUES.includes(reason),
      `${reason} is a gate refusal and must never be persisted as a suppression reason`);
  }
});

test("NotDroppableError: carries a stable snake_case reason and a 409, and leaks no record data", () => {
  const err = new NotDroppableError(SUPPRESSION_REASONS.OPT_OUT);
  assert.ok(err instanceof Error);
  assert.equal(err.name, "NotDroppableError");
  assert.equal(err.reason, "opt_out");
  assert.equal(err.status, 409);
});

/* -------------------------------------------------------------- identity reader */

test("recordIdentity: an email is found whatever the vendor called the column", () => {
  const a = recordIdentity({ fields: { "E-MAIL ADDRESS": "Person@Example.COM" } });
  assert.deepEqual(a.emails, ["person@example.com"], "matched case-folded, the way idx_clients_email is built");
  assert.ok(a.usable);

  const b = recordIdentity({ fields: { contact_email_1: "other@example.org" } });
  assert.deepEqual(b.emails, ["other@example.org"]);
});

test("recordIdentity: a phone yields both its ten- and eleven-digit forms, because the CRM stores neither consistently", () => {
  const id = recordIdentity({ fields: { PHONE: "(555) 123-4567" } });
  assert.deepEqual(id.phones.slice().sort(), ["15551234567", "5551234567"]);
  assert.deepEqual(recordIdentity({ fields: { Cell: "+1 555 123 4567" } }).phones.slice().sort(),
    ["15551234567", "5551234567"], "an eleven-digit number resolves to the same pair");
});

test("recordIdentity: an address that happens to contain ten digits is not read as a phone number", () => {
  const id = recordIdentity({ fields: { ADDRESS: "123 Main Street Apt 4567890" } });
  assert.deepEqual(id.phones, [], "letters in the value disqualify it — otherwise an address makes a record look identifiable");
  assert.ok(!id.usable);
});

test("recordIdentity: a zip code is never read as a phone number", () => {
  assert.deepEqual(recordIdentity({ fields: { ZIP: "90210" } }).phones, []);
  assert.deepEqual(recordIdentity({ fields: { ZIP: "902101234" } }).phones, [], "zip+4 is nine digits, not a phone");
});

test("recordIdentity: a value that is not a contactable address is not counted as an email", () => {
  assert.ok(!recordIdentity({ fields: { EMAIL: "n/a@none" } }).usable, "no dot in the domain");
  assert.ok(!recordIdentity({ fields: { EMAIL: "unknown" } }).usable);
  assert.ok(!recordIdentity({ fields: { EMAIL: "" } }).usable);
});

test("recordIdentity: a name-and-address record has no usable identity at all, which is the whole prescreen problem", () => {
  const id = recordIdentity({
    fields: { FIRST: "Jane", LAST: "Doe", ADDRESS: "12 Elm St", CITY: "Austin", STATE: "TX", ZIP: "78701" }
  });
  assert.deepEqual(id.emails, []);
  assert.deepEqual(id.phones, []);
  assert.equal(id.usable, false);
});

test("recordIdentity: a bare vendor record with no fields wrapper is read directly", () => {
  assert.deepEqual(recordIdentity({ Email: "bare@example.com" }).emails, ["bare@example.com"]);
  assert.equal(recordIdentity(null).usable, false);
  assert.equal(recordIdentity("string").usable, false);
  assert.equal(recordIdentity([1, 2]).usable, false);
});

test("recordIdentity: reading a record does not mutate it", () => {
  const record = { fields: { EMAIL: "keep@example.com" } };
  const snapshot = JSON.stringify(record);
  recordIdentity(record);
  assert.equal(JSON.stringify(record), snapshot);
});

/* ------------------------------------------------------------------ fail closed */

test("checkSuppression: a missing db is suppressed rather than thrown, so no caller can catch its way past the gate", async () => {
  assert.deepEqual(await checkSuppression(null, { orgId: ORG, record: { fields: {} } }),
    { suppressed: true, reason: "check_failed" });
  assert.deepEqual(await checkSuppression({}, { orgId: ORG, record: { fields: {} } }),
    { suppressed: true, reason: "check_failed" });
});

test("checkSuppression: a missing orgId is suppressed, because an unscoped match is not a match", async () => {
  const v = await checkSuppression(forbiddenDb, { record: { fields: { EMAIL: "a@b.com" } } });
  assert.deepEqual(v, { suppressed: true, reason: "check_failed" });
});

test("checkSuppression: a record that is not a record is suppressed", async () => {
  for (const record of [null, undefined, "abc", 7, []]) {
    const v = await checkSuppression(forbiddenDb, { orgId: ORG, record });
    assert.equal(v.suppressed, true, `${JSON.stringify(record)} must not read as clear to mail`);
    assert.equal(v.reason, "check_failed");
  }
  assert.deepEqual(await checkSuppression(forbiddenDb), { suppressed: true, reason: "check_failed" });
});

test("checkSuppression: a database error is reported as check_failed and never propagates as an exception", async () => {
  const v = await checkSuppression(brokenDb, { orgId: ORG, record: { fields: { EMAIL: "real@example.com" } } });
  assert.deepEqual(v, { suppressed: true, reason: "check_failed" },
    "a database that is down must read as 'we do not know', which is spelled the same as 'no'");
});

test("checkSuppression: a record with no usable identity is unidentifiable without a query being attempted", async () => {
  const v = await checkSuppression(forbiddenDb, {
    orgId: ORG,
    record: { fields: { NAME: "Jane Doe", ADDRESS: "12 Elm St" } }
  });
  assert.deepEqual(v, { suppressed: true, reason: "unidentifiable" });
});

test("checkSuppression: a record that already responded is a prior responder without a query being attempted", async () => {
  const v = await checkSuppression(forbiddenDb, {
    orgId: ORG,
    record: { fields: { EMAIL: "responder@example.com" }, responded_at: new Date() }
  });
  assert.deepEqual(v, { suppressed: true, reason: "prior_responder" });
});

test("checkSuppression: an existing suppression stands, and out-of-vocabulary text somebody stored is returned verbatim", async () => {
  const v = await checkSuppression(forbiddenDb, {
    orgId: ORG,
    record: { fields: { EMAIL: "a@b.com" }, suppressed: true, suppression_reason: "returned mail 2025-11" }
  });
  assert.deepEqual(v, { suppressed: true, reason: "returned mail 2025-11" });

  const noReason = await checkSuppression(forbiddenDb, {
    orgId: ORG,
    record: { fields: { EMAIL: "a@b.com" }, suppressed: true, suppression_reason: null }
  });
  assert.deepEqual(noReason, { suppressed: true, reason: "suppressed" });
});

test("assertDroppable: a missing or broken database refuses the drop instead of raising the database's own error", async () => {
  await assert.rejects(
    () => assertDroppable(null, { recordId: RECORD }),
    (err) => err instanceof NotDroppableError && err.reason === "check_failed"
  );
  await assert.rejects(
    () => assertDroppable(brokenDb, { recordId: RECORD }),
    (err) => err instanceof NotDroppableError && err.reason === "check_failed"
  );
});

test("assertDroppable: a record id that is not a uuid is unknown_record, and a bug is never permission to mail", async () => {
  for (const recordId of [undefined, null, "", "not-a-uuid", 42, RECORD.slice(0, -1)]) {
    await assert.rejects(
      () => assertDroppable(forbiddenDb, { recordId }),
      (err) => err instanceof NotDroppableError && err.reason === "unknown_record"
    );
  }
  await assert.rejects(() => assertDroppable(forbiddenDb), NotDroppableError);
});

/* ---------------------------------------------------------------- apply guards */

test("applySuppression: a call with no campaign is refused rather than scanning every record in the org", async () => {
  await assert.rejects(() => applySuppression(brokenDb, { orgId: ORG }), TypeError);
  await assert.rejects(() => applySuppression(brokenDb, { orgId: ORG, campaignId: "  " }), TypeError);
  await assert.rejects(() => applySuppression(brokenDb, { campaignId: "c" }), TypeError);
  await assert.rejects(() => applySuppression(null, { orgId: ORG, campaignId: "c" }), TypeError);
});
