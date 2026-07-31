// Real-Postgres tests for the suppression gate.
// SKIPS unless DATABASE_URL is set.
//
// This is where the compliance claims get checked against a database instead of
// against a stub that agrees with them. In particular:
//
//   * that a client whose phone the CRM stores as "(555) 010-7788" is matched by
//     a mail record carrying "5550107788" — the digits comparison and its index
//     from 066, which is the false negative that matters most;
//   * that the opt-out read really is the one src/handlers/comms.mjs writes on a
//     TCPA STOP, including that a START un-suppresses;
//   * that a real database error is treated as SUPPRESSED. That test injects an
//     error obtained FROM POSTGRES ITSELF rather than a fabricated one, so it is
//     the genuine error shape the gate will meet in production.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { recordOptOut, recordOptIn } from "../lib/opt-out.mjs";
import {
  SUPPRESSION_REASONS,
  NotDroppableError,
  isSuppressionReason,
  checkSuppression,
  applySuppression,
  assertDroppable
} from "./suppression.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

const EMAIL = "mail_suppression_pg_test@example.com";
const STRANGER = "mail_suppression_pg_test_stranger@example.com";
const RESPONDER = "mail_suppression_pg_test_responder@example.com";
const CRM_PHONE = "(555) 010-7788";        // how the CRM happens to hold it
const FILE_PHONE = "5550107788";           // how a mail file holds it (ingest strips non-digits)

const APPROVED = "suppression_pg_test_approved";
const HOLD = "suppression_pg_test_hold";
const ORPHAN = "suppression_pg_test_orphan";   // a campaign_id with no mail_campaigns row

let orgId = null;
let clientId = null;
const rec = {};   // name -> mail_universe id

async function wipe() {
  await db.query(`DELETE FROM mail_universe WHERE campaign_id = ANY($1::text[])`, [[APPROVED, HOLD, ORPHAN]]);
  await db.query(`DELETE FROM mail_campaigns WHERE campaign_key = ANY($1::text[])`, [[APPROVED, HOLD]]);
  // opt_outs.client_id has no ON DELETE, so the opt-out has to go before the client.
  await db.query(`DELETE FROM opt_outs WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email = $1`, [EMAIL]);
}

async function addRecord(name, campaign, fields, { respondedAt = null, suppressed = false, reason = null } = {}) {
  const r = await db.query(
    `INSERT INTO mail_universe (org_id, campaign_id, fields, responded_at, suppressed, suppression_reason)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6) RETURNING id`,
    [orgId, campaign, JSON.stringify(fields), respondedAt, suppressed, reason]
  );
  rec[name] = r.rows[0].id;
  return r.rows[0].id;
}

const rowOf = async (id) =>
  (await db.query(`SELECT * FROM mail_universe WHERE id = $1`, [id])).rows[0];

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");

  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, phone, first_name, last_name)
     VALUES ($1, $2, $3, 'Mail', 'Suppression') RETURNING id`,
    [orgId, EMAIL, CRM_PHONE]
  )).rows[0].id;

  // Two campaigns. `approved` means a human signed off all three FCRA gate
  // conditions by hand; nothing in this repo sets it, and this fixture is not a
  // drop path — it exists so the gate's approved branch is reachable at all.
  await db.query(
    `INSERT INTO mail_campaigns (org_id, campaign_key, name, status)
     VALUES ($1, $2, 'Suppression PG test (approved)', 'approved'),
            ($1, $3, 'Suppression PG test (on hold)', 'compliance_hold')`,
    [orgId, APPROVED, HOLD]
  );

  await addRecord("byEmail", APPROVED, { "E-MAIL": EMAIL });
  await addRecord("byPhone", APPROVED, { PHONE: FILE_PHONE });
  await addRecord("clean", APPROVED, { "E-MAIL": STRANGER, NAME: "A Stranger" });
  await addRecord("responded", APPROVED, { "E-MAIL": RESPONDER }, { respondedAt: new Date() });
  await addRecord("reuse", APPROVED, { "EMAIL ADDRESS": RESPONDER, NAME: "Same person, next drop" });
  await addRecord("nameOnly", APPROVED, { FIRST: "Jane", LAST: "Doe", ADDRESS: "12 Elm St", ZIP: "78701" });
  await addRecord("manual", APPROVED, { "E-MAIL": "mail_suppression_pg_test_manual@example.com" },
    { suppressed: true, reason: "returned mail" });
  await addRecord("onHold", HOLD, { "E-MAIL": "mail_suppression_pg_test_hold@example.com" });
  await addRecord("orphan", ORPHAN, { "E-MAIL": "mail_suppression_pg_test_orphan@example.com" });
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

/* ------------------------------------------------------------------- the rules */

test("a mail record whose email matches a client is suppressed as an existing client", { skip: !HAS_DB }, async () => {
  const v = await checkSuppression(db, { orgId, record: await rowOf(rec.byEmail) });
  assert.deepEqual(v, { suppressed: true, reason: SUPPRESSION_REASONS.EXISTING_CLIENT });
});

test("a client is matched on phone digits even though the CRM stores the number formatted", { skip: !HAS_DB }, async () => {
  // This is the case an exact-text comparison against idx_clients_phone misses:
  // the CRM holds "(555) 010-7788" and the mail file holds "5550107788".
  const v = await checkSuppression(db, { orgId, record: await rowOf(rec.byPhone) });
  assert.deepEqual(v, { suppressed: true, reason: SUPPRESSION_REASONS.EXISTING_CLIENT });
});

test("a live TCPA opt-out is reported as the more specific reason, and a START keyword takes it back", { skip: !HAS_DB }, async () => {
  await recordOptOut(db, clientId, orgId, "sms", "inbound_keyword");
  let v = await checkSuppression(db, { orgId, record: await rowOf(rec.byEmail) });
  assert.equal(v.reason, SUPPRESSION_REASONS.OPT_OUT, "the opt-out is the truer reading of the same row");

  await recordOptIn(db, clientId, "sms");
  v = await checkSuppression(db, { orgId, record: await rowOf(rec.byEmail) });
  assert.equal(v.reason, SUPPRESSION_REASONS.EXISTING_CLIENT, "an opt-in un-suppresses the opt-out, not the client match");
  assert.equal(v.suppressed, true, "but an existing client is still not mailed");
});

test("a record that already responded is suppressed as a prior responder", { skip: !HAS_DB }, async () => {
  const v = await checkSuppression(db, { orgId, record: await rowOf(rec.responded) });
  assert.deepEqual(v, { suppressed: true, reason: SUPPRESSION_REASONS.PRIOR_RESPONDER });
});

test("the same person on a reused list is suppressed even though the two files name the column differently", { skip: !HAS_DB }, async () => {
  // "E-MAIL" on the first drop, "EMAIL ADDRESS" on the second. The match is by
  // value, because mail_universe.fields is keyed by the vendor's own headers.
  const v = await checkSuppression(db, { orgId, record: await rowOf(rec.reuse) });
  assert.deepEqual(v, { suppressed: true, reason: SUPPRESSION_REASONS.PRIOR_RESPONDER });
});

test("a name-and-address record with no email or phone is suppressed as unidentifiable rather than mailed", { skip: !HAS_DB }, async () => {
  const v = await checkSuppression(db, { orgId, record: await rowOf(rec.nameOnly) });
  assert.deepEqual(v, { suppressed: true, reason: SUPPRESSION_REASONS.UNIDENTIFIABLE });
});

test("a record nobody in the CRM matches and nobody has responded for comes back clear", { skip: !HAS_DB }, async () => {
  const v = await checkSuppression(db, { orgId, record: await rowOf(rec.clean) });
  assert.deepEqual(v, { suppressed: false, reason: null },
    "the gate has to be able to say yes, or every other test is passing for the wrong reason");
});

/* ----------------------------------------------------------- *** FAIL CLOSED *** */

test("a real database error is treated as suppressed, never as clear to mail", { skip: !HAS_DB }, async () => {
  // The error is obtained from Postgres itself so the gate is tested against the
  // genuine error shape (SQLSTATE 42P01), not a hand-rolled Error that happens
  // to have the properties this file expects.
  const pgError = await db
    .query(`SELECT 1 FROM a_table_that_does_not_exist_suppression_pg_test`)
    .then(() => null, (err) => err);
  assert.equal(pgError?.code, "42P01", "the injected failure must be a real Postgres error");

  const brokenDb = { query: async () => { throw pgError; } };

  // The record used here is the one that is genuinely CLEAR — so if the gate
  // leaked "clear" on error, this assertion is the only thing that would catch it.
  const clean = await rowOf(rec.clean);
  const v = await checkSuppression(brokenDb, { orgId, record: clean });
  assert.deepEqual(v, { suppressed: true, reason: SUPPRESSION_REASONS.CHECK_FAILED });

  await assert.rejects(
    () => assertDroppable(brokenDb, { recordId: rec.clean }),
    (err) => err instanceof NotDroppableError && err.reason === SUPPRESSION_REASONS.CHECK_FAILED,
    "a database that is down must refuse the drop, not raise something a caller might retry past"
  );
});

/* ----------------------------------------------------------------- assertDroppable */

test("assertDroppable refuses a record id that resolves to nothing", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => assertDroppable(db, { recordId: "0f8a1c1e-9999-4b2c-8d3e-999999999999" }),
    (err) => err instanceof NotDroppableError && err.reason === "unknown_record"
  );
});

test("assertDroppable refuses every record in a campaign that is still on compliance hold", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => assertDroppable(db, { recordId: rec.onHold }),
    (err) => err instanceof NotDroppableError && err.reason === "campaign_not_approved"
  );
});

test("assertDroppable refuses a record whose campaign_id has no campaign row behind it at all", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => assertDroppable(db, { recordId: rec.orphan }),
    (err) => err instanceof NotDroppableError && err.reason === "campaign_not_approved"
  );
});

test("assertDroppable refuses a suppressed record and reports the reason that was stored", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => assertDroppable(db, { recordId: rec.manual }),
    (err) => err instanceof NotDroppableError && err.reason === "returned mail"
  );
});

test("assertDroppable refuses a record that is clear in the table but suppressed on a live re-check", { skip: !HAS_DB }, async () => {
  // byEmail is stored suppressed = false at this point in the file. The stored
  // flag is only as fresh as the last pass, so the gate re-checks rather than
  // trusting it — this is that re-check.
  const stored = await rowOf(rec.byEmail);
  assert.equal(stored.suppressed, false, "precondition: the flag has not been written yet");

  await assert.rejects(
    () => assertDroppable(db, { recordId: rec.byEmail }),
    (err) => err instanceof NotDroppableError && err.reason === SUPPRESSION_REASONS.EXISTING_CLIENT
  );
});

test("assertDroppable returns quietly for a clear record in an approved campaign, and returns no consumer data", { skip: !HAS_DB }, async () => {
  const out = await assertDroppable(db, { recordId: rec.clean });
  assert.equal(out.recordId, rec.clean);
  assert.equal(out.orgId, orgId);
  assert.equal(out.campaignId, APPROVED);
  assert.deepEqual(Object.keys(out).sort(), ["campaignId", "orgId", "recordId", "recordSlug"],
    "nothing from `fields` may ride out of the gate into a log");
});

/* ---------------------------------------------------------------- applySuppression */

test("applySuppression writes a reason from the closed vocabulary for every record it suppresses", { skip: !HAS_DB }, async () => {
  const res = await applySuppression(db, { orgId, campaignId: APPROVED });

  // byEmail, byPhone, responded, reuse, nameOnly. `clean` stays clear and
  // `manual` was never read, because the pass only looks at suppressed = false.
  assert.equal(res.suppressed, 5, `expected five suppressions, got ${JSON.stringify(res.byReason)}`);
  for (const reason of Object.keys(res.byReason)) {
    assert.ok(isSuppressionReason(reason), `${reason} is not in the closed vocabulary`);
  }
  assert.equal(res.byReason[SUPPRESSION_REASONS.EXISTING_CLIENT], 2);
  assert.equal(res.byReason[SUPPRESSION_REASONS.PRIOR_RESPONDER], 2);
  assert.equal(res.byReason[SUPPRESSION_REASONS.UNIDENTIFIABLE], 1);

  const stored = await rowOf(rec.byEmail);
  assert.equal(stored.suppressed, true);
  assert.equal(stored.suppression_reason, SUPPRESSION_REASONS.EXISTING_CLIENT);
});

test("applySuppression is re-runnable: a second pass suppresses nothing and rewrites nothing", { skip: !HAS_DB }, async () => {
  const before = await db.query(
    `SELECT id, suppressed, suppression_reason FROM mail_universe WHERE campaign_id = $1 ORDER BY id`, [APPROVED]
  );

  const res = await applySuppression(db, { orgId, campaignId: APPROVED });
  assert.equal(res.suppressed, 0);
  assert.equal(res.scanned, 1, "only the record that is still clear is even read on the second pass");

  const after = await db.query(
    `SELECT id, suppressed, suppression_reason FROM mail_universe WHERE campaign_id = $1 ORDER BY id`, [APPROVED]
  );
  assert.deepEqual(after.rows, before.rows);
});

test("applySuppression never un-suppresses: a hand-entered reason it does not recognise survives the pass", { skip: !HAS_DB }, async () => {
  const row = await rowOf(rec.manual);
  assert.equal(row.suppressed, true);
  assert.equal(row.suppression_reason, "returned mail",
    "un-suppressing is the decision to mail somebody, and a batch job does not get to make it");
});

test("applySuppression leaves a record it has no reason to suppress alone, so the pass can say yes as well as no", { skip: !HAS_DB }, async () => {
  const row = await rowOf(rec.clean);
  assert.equal(row.suppressed, false);
  assert.equal(row.suppression_reason, null);
});

test("applySuppression is scoped to one campaign and does not reach into another", { skip: !HAS_DB }, async () => {
  const row = await rowOf(rec.onHold);
  assert.equal(row.suppressed, false, "the hold campaign was never named in the pass");
});
