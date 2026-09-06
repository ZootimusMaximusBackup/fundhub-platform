// COMPLIANCE REVIEW REQUIRED — dispute logic.
//
// Postgres-backed proof for the re-stage half of the stuck-claim fix.
//
// WHAT WAS BROKEN. src/repair/analyze.mjs asked "is there already a letter for
// this round?" with the status list ('generated','ready','queued','sent'). A
// letter holding a send claim sits on 'sending', which was not in that list, so
// a re-stage did not report the round as already staged — it wrote a SECOND
// dispute_letters row for the same case, bureau, round and target. That row was
// then refused at send time by uq_dispute_letters_one_send_claim
// (db/migrations/333), so re-staging was not a way out of a stuck claim; it just
// produced another dead letter. 'delivered' was missing for the same reason.
//
// WHAT IT DOES NOW. Both states are in the list, so a re-stage sees the letter
// that already holds the claim and hands it back with already_generated. The way
// out of a stuck claim is clearStuckSendClaim() in src/repair/send.mjs, proved in
// src/repair/send-double-mail.pg.test.mjs — not a second row.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs (CLAUDE.md §12).

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { analyzeAndGenerate } from "./analyze.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const CLIENT_EMAIL_LIKE = "restage.pg.test.%@example.com";
const STAFF_EMAIL_LIKE = "restage_pg_test_%@example.com";

describe("repair re-stage — a claimed letter is seen, not duplicated", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, staffId, caseId;

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      for (const t of ["messages", "events", "cards", "tasks", "client_consents"]) {
        await db.query(`DELETE FROM ${t} WHERE client_id = ANY($1)`, [ids]).catch(() => {});
      }
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  }

  const letterCount = async () => Number((await db.query(
    `SELECT COUNT(*)::int AS n FROM dispute_letters WHERE client_id = $1::uuid`, [client]
  )).rows[0].n);

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
    staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Restage Pgtest Closer','closer',$2,'active') RETURNING id`,
      [org, "restage_pg_test_closer@example.com"]
    )).rows[0].id;
    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Restage','Subject',$2) RETURNING id`,
      [org, "restage.pg.test.subject@example.com"]
    )).rows[0].id;
    // Staff dispute authorization is enough to reach the "already staged?" read.
    await db.query(
      `INSERT INTO client_consents (
         org_id, client_id, kind, consent_version, consent_text,
         capture_method, granted_name, granted_by_kind, granted_by_staff_id
       ) VALUES (
         $1::uuid, $2::uuid, 'dispute_authorization', 'dispute-auth-v1',
         'I authorize Fundhub to prepare dispute letters for my review.',
         'typed', 'Restage Subject', 'staff', $3::uuid
       )`,
      [org, client, staffId]
    );
    caseId = (await db.query(
      `INSERT INTO dispute_cases (org_id, client_id, bureau, round)
       VALUES ($1,$2,'EX','R1') RETURNING id`,
      [org, client]
    )).rows[0].id;
  });

  after(async () => {
    await purge();
    await close();
  });

  test("a letter stuck on 'sending' is reported as already staged, not written twice", async () => {
    const letter = (await db.query(
      `INSERT INTO dispute_letters
         (case_id, org_id, client_id, bureau, round, status, body_text, target, send_claimed_at)
       VALUES ($1,$2,$3,'EX','R1','sending','Dear sir or madam,','bureau', now())
       RETURNING id`,
      [caseId, org, client]
    )).rows[0];
    const before = await letterCount();

    const r = await analyzeAndGenerate(db, { orgId: org, clientId: client, round: "R1", staffId });

    assert.equal(r.ok, true);
    assert.equal(r.already_generated, true, "the claimed letter is seen");
    assert.deepEqual(r.letters.map((l) => l.letterId), [letter.id]);
    assert.equal(r.skipped[0].reason, "already_generated");
    assert.equal(await letterCount(), before, "and no second row was written for it");
  });

  test("a delivered letter is reported as already staged too", async () => {
    // Its own case, so it does not collide with the 'sending' row above on the
    // (org, case, bureau, round, target) key.
    const caseTwo = (await db.query(
      `INSERT INTO dispute_cases (org_id, client_id, bureau, round)
       VALUES ($1,$2,'TU','R2') RETURNING id`,
      [org, client]
    )).rows[0].id;
    const letter = (await db.query(
      `INSERT INTO dispute_letters
         (case_id, org_id, client_id, bureau, round, status, body_text, target,
          send_claimed_at, mailed_at, postgrid_letter_id)
       VALUES ($1,$2,$3,'TU','R2','delivered','Dear sir or madam,','bureau',
               now(), now(), 'ltr_delivered')
       RETURNING id`,
      [caseTwo, org, client]
    )).rows[0];
    const before = await letterCount();

    const r = await analyzeAndGenerate(db, { orgId: org, clientId: client, round: "R2", staffId });

    assert.equal(r.ok, true);
    assert.equal(r.already_generated, true);
    assert.deepEqual(r.letters.map((l) => l.letterId), [letter.id]);
    assert.equal(await letterCount(), before, "no replacement row for a letter that arrived");
  });
});
