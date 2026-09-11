// The application cannot delete a legal-escalation record. THIS FILE IS THE
// ONLY REASON THAT SENTENCE MAY BE WRITTEN ANYWHERE ELSE.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Client-facing messaging on a
// consumer-finance file. Nothing here sends anything.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE DEFECT THIS PINS: A PERMANENCE PROMISE THAT WAS FALSE IN FIVE PLACES
//
// Round two shipped `GRANT SELECT, INSERT ON public.client_escalations TO
// fundhub_app` in db/migrations/368 and then wrote, in five places including
// the CHANGELOG line and the journey page — the only two things Chris reads —
// that the application could not delete an escalation.
//
// It could. db/migrations/104_app_role.sql:226 runs
//
//   ALTER DEFAULT PRIVILEGES IN SCHEMA public
//     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fundhub_app;
//
// so every table created after it arrives already fully writable. A GRANT of a
// subset adds nothing and takes nothing away. Measured on a migrated scratch
// database on 2026-09-06, before the fix:
//
//   has_table_privilege('fundhub_app','public.client_escalations','DELETE') = t
//
// 368 now carries an explicit REVOKE — the shape the sister lane proved in
// migrations 361 and 363 — and this file is what stops the claim drifting back
// into fiction.
//
// THREE ASSERTIONS, AND THE THIRD ONE IS THE ONE ROUND THREE MISSED.
//
//   1. THE CATALOG. has_table_privilege() answers for the fundhub_app role
//      without needing to log in as it, so this half runs everywhere the suite
//      runs. It is the assertion that will actually catch a regression.
//   2. THE LIVE REFUSAL. A DELETE attempted on a genuinely unprivileged
//      connection must RAISE, not report zero rows. A silent "DELETE 0" is not
//      a refusal — it is the same answer a working DELETE gives on an empty
//      table, which is exactly how the first version of this claim survived
//      review. Needs APP_DATABASE_URL; skipped, out loud, when it is absent.
//   3. THE CASCADE. Round three revoked UPDATE and DELETE and both halves above
//      passed — while 368 still declared the client_id foreign key ON DELETE
//      CASCADE. A cascade runs with the REFERENCED table's owner privileges,
//      not the deleting role's, and fundhub_app holds DELETE on clients. So the
//      application could still destroy the record, by deleting the client, and
//      the promise was written with no exception in two more places.
//      db/migrations/370 makes that foreign key ON DELETE RESTRICT and the
//      third test below proves the refusal as fundhub_app.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { rlsPool, rlsIsReal } from "../testing/rls-pool.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ORG_SLUG = "escalation-permanence-pg-test";
const EMAIL_TAG = "@escalation-permanence-pg-test.example.com";

/* The privileges the application is allowed to hold on this table, and the ones
   it must not. UPDATE is in the forbidden list because the promise made
   everywhere else is "written once, never updated" — a row the application can
   rewrite is not written once. */
const MUST_HOLD = ["SELECT", "INSERT"];
const MUST_NOT_HOLD = ["UPDATE", "DELETE", "TRUNCATE"];

let orgId = null;

async function wipe() {
  if (!orgId) return;
  await db.query(`DELETE FROM client_escalations WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM clients WHERE org_id = $1`, [orgId]);
}

before(async () => {
  if (!HAS_DB) return;
  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,'Escalation Permanence Pg Test')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [ORG_SLUG]
  )).rows[0].id;
  await wipe();
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await db.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
  await close();
});

let seq = 0;
async function makeClient() {
  seq += 1;
  return (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email, phone)
     VALUES ($1,'Perm','Test',$2,$3) RETURNING id`,
    [orgId, `perm${seq}${EMAIL_TAG}`, `+1555777${String(1000 + seq).slice(-4)}`]
  )).rows[0].id;
}

/* Whether the role exists at all. 104 creates it, but a database built without
   that migration would make every assertion below vacuous, so say so instead. */
async function appRoleExists() {
  return (await db.query(
    `SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app'`
  )).rows.length > 0;
}

test("fundhub_app may read and insert an escalation, and may NOT change or remove one",
  { skip: !HAS_DB }, async () => {
    assert.ok(await appRoleExists(),
      "fundhub_app does not exist on this database — db/migrations/104 has not run, " +
      "so nothing below would be meaningful");

    for (const priv of MUST_HOLD) {
      const { rows } = await db.query(
        `SELECT has_table_privilege('fundhub_app','public.client_escalations',$1) AS ok`,
        [priv]
      );
      assert.equal(rows[0].ok, true,
        `the application must be able to ${priv} an escalation — the detector writes it`);
    }

    for (const priv of MUST_NOT_HOLD) {
      const { rows } = await db.query(
        `SELECT has_table_privilege('fundhub_app','public.client_escalations',$1) AS ok`,
        [priv]
      );
      assert.equal(rows[0].ok, false,
        `fundhub_app still holds ${priv} on client_escalations. ` +
        `104_app_role.sql grants it by default to every table made after it, so an ` +
        `explicit REVOKE in db/migrations/368 is the only thing that takes it away. ` +
        `Until this passes, the sentence "the application cannot delete a legal-escalation ` +
        `record" is FALSE and must not appear in the CHANGELOG, the journey page or a report.`);
    }
  });

test("a DELETE by the application RAISES — a silent 'DELETE 0' is not a refusal",
  { skip: !HAS_DB ? "no DATABASE_URL"
         : !rlsIsReal() ? "no APP_DATABASE_URL — cannot connect as the unprivileged role"
         : false },
  async () => {
    const clientId = await makeClient();
    await db.query(
      `INSERT INTO client_escalations (org_id, client_id, matched_pattern)
       VALUES ($1,$2,'\\blawyer\\b')`,
      [orgId, clientId]
    );

    const app = rlsPool();

    /* Prove the connection is genuinely unprivileged first. A superuser or a
       BYPASSRLS role would sail through the DELETE and this test would report a
       leak that is really a misconfigured harness. */
    const who = (await app.query(
      `SELECT current_user AS who, rolsuper, rolbypassrls
         FROM pg_roles WHERE rolname = current_user`
    )).rows[0];
    assert.equal(who.rolsuper, false, `${who.who} is a superuser; this proves nothing`);
    assert.equal(who.rolbypassrls, false, `${who.who} bypasses row-level security`);

    await assert.rejects(
      () => app.query(`DELETE FROM client_escalations WHERE client_id = $1`, [clientId]),
      (err) => {
        /* 42501 is insufficient_privilege. Asserting the CODE and not the
           message text, because the message is localised. */
        assert.equal(err.code, "42501",
          `expected permission denied (42501), got ${err.code}: ${err.message}`);
        return true;
      },
      "DELETE must be refused out loud, not report zero rows"
    );

    await assert.rejects(
      () => app.query(`UPDATE client_escalations SET matched_pattern = 'x' WHERE client_id = $1`, [clientId]),
      (err) => { assert.equal(err.code, "42501"); return true; },
      "and the row may not be rewritten either — it is written once"
    );

    const still = (await db.query(
      `SELECT count(*)::int AS n FROM client_escalations WHERE client_id = $1`, [clientId]
    )).rows[0].n;
    assert.equal(still, 1, "the escalation is still there");

    /* And the writes the detector actually needs still work as that role. */
    const other = await makeClient();
    await app.query(
      `INSERT INTO client_escalations (org_id, client_id) VALUES ($1,$2)`,
      [orgId, other]
    );
    assert.equal(
      (await db.query(`SELECT count(*)::int AS n FROM client_escalations WHERE client_id = $1`, [other])).rows[0].n,
      1,
      "the application must still be able to RECORD an escalation");
  });

test("the application cannot reach the escalation by deleting the CLIENT either",
  { skip: !HAS_DB ? "no DATABASE_URL"
         : !rlsIsReal() ? "no APP_DATABASE_URL — cannot connect as the unprivileged role"
         : false },
  async () => {
    /* ROUND FOUR. THE REVOKE ABOVE WAS REAL AND IT WAS NOT ENOUGH.
       368 declared client_id ... REFERENCES clients(id) ON DELETE CASCADE, and
       a cascade runs with the privileges of the referenced table's owner rather
       than the deleting role's. fundhub_app holds DELETE on clients. So the
       application COULD destroy an escalation record — by deleting the client —
       while two of the five places that state the promise said, with no
       exception, "the application really cannot delete one".

       db/migrations/370 makes the foreign key ON DELETE RESTRICT. The delete is
       now refused, out loud, error 23503. */
    const clientId = await makeClient();
    await db.query(
      `INSERT INTO client_escalations (org_id, client_id, matched_pattern)
       VALUES ($1,$2,'\\blawyer\\b')`,
      [orgId, clientId]
    );

    const { rows: fk } = await db.query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conrelid = 'public.client_escalations'::regclass
          AND contype = 'f'
          AND confrelid = 'public.clients'::regclass`
    );
    assert.deepEqual(fk.map((r) => r.confdeltype), ["r"],
      "the client_id foreign key must be ON DELETE RESTRICT ('r'); 'c' is CASCADE " +
      "and means the application can still destroy the record by deleting the client");

    const app = rlsPool();
    await assert.rejects(
      () => app.query(`DELETE FROM clients WHERE id = $1`, [clientId]),
      (err) => {
        /* 23503 is foreign_key_violation. */
        assert.equal(err.code, "23503",
          `expected a foreign-key refusal (23503), got ${err.code}: ${err.message}`);
        return true;
      },
      "deleting a client who has an escalation must be refused, not cascade"
    );

    assert.equal(
      (await db.query(`SELECT count(*)::int AS n FROM client_escalations WHERE client_id = $1`, [clientId])).rows[0].n,
      1,
      "the escalation survived the attempt");

    /* A client with NO escalation is unaffected — nothing about ordinary client
       deletion changed. */
    const ordinary = await makeClient();
    await app.query(`DELETE FROM clients WHERE id = $1`, [ordinary]);
    assert.equal(
      (await db.query(`SELECT count(*)::int AS n FROM clients WHERE id = $1`, [ordinary])).rows[0].n,
      0,
      "a client with no escalation on file still deletes normally");
  });

test("there is no read watermark table left behind",
  { skip: !HAS_DB }, async () => {
    /* client_escalation_scans was removed from db/migrations/368 in round three:
       the mark advanced over rows the detector had not examined, and the next
       pass read past the boundary with a strict '>'. Dead schema is worse than
       none, and a table nothing reads is an invitation to start reading it. */
    const { rows } = await db.query(
      `SELECT to_regclass('public.client_escalation_scans') AS t`
    );
    assert.equal(rows[0].t, null,
      "client_escalation_scans exists. Nothing reads or writes it, and the design " +
      "note in db/migrations/368 says why there is deliberately no watermark.");
  });
