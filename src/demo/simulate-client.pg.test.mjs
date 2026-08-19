// Demo client teardown — the regression test for the bug that left a demo
// client half-erased and permanently undeletable.
//
// WHAT WENT WRONG (live, 2026-08-18). Pressing delete on a demo client
// returned a server error, and afterwards the client was still there along
// with its emails, documents and contract. The old teardown deleted from a
// hand-written list of eleven tables, silenced the error on ten of them, and
// left the twelfth — the client itself — to fail out loud. Sixty-seven
// foreign keys point at `clients`; sixteen of them refuse a delete, and the
// list named only three. So the client's own data was destroyed and the
// client survived.
//
// WHAT THIS TEST PINS. A demo client that has been USED — one that has picked
// up rows in tables the old list never mentioned — must tear down completely
// and leave nothing behind anywhere. A fresh, untouched demo client always
// deleted fine, which is exactly why this went unnoticed; so this test
// deliberately dirties the client first.
//
// It also pins the two things that must NOT happen: a real (non-demo) client
// must never be removed by this path, and a failure must name the table that
// actually refused rather than blaming `clients`.

import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  loadSimulatedClient,
  teardownSimulated,
  clientChildTables,
  DEMO_EMAIL_PREFIX,
  DEMO_EMAIL_DOMAIN
} from "./simulate-client.mjs";

const hasDb = !!process.env.DATABASE_URL;
const SLUG = "t16-teardown-suite";

let orgId = null;

// Idempotent, and run both before and after — the pg suite shares one database
// and a previous crashed run must not fail the next one.
async function purge() {
  const { rows } = await db.query(`SELECT id FROM orgs WHERE slug = $1`, [SLUG]);
  if (!rows.length) return;
  const oid = rows[0].id;
  const kids = await db.query(`
    SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'client_id'`);
  const ids = await db.query(`SELECT id FROM clients WHERE org_id = $1`, [oid]);
  for (const c of ids.rows) {
    for (const k of kids.rows) {
      await db.query(`DELETE FROM "${k.table_name}" WHERE client_id = $1`, [c.id]).catch(() => null);
    }
  }
  await db.query(`DELETE FROM clients WHERE org_id = $1`, [oid]).catch(() => null);
  await db.query(`DELETE FROM staff WHERE org_id = $1`, [oid]).catch(() => null);
  await db.query(`DELETE FROM orgs WHERE id = $1`, [oid]).catch(() => null);
}

// Rows in tables whose foreign key REFUSES a client delete. `events` is the
// real-world culprit: the five rows found on the stuck live client were
// message.queued, contract.sent and contract.signed, none of which the old
// teardown knew about.
async function dirtyTheClient(clientId) {
  await db.query(
    `INSERT INTO events (org_id, name, client_id, payload)
     VALUES ($1,'message.queued',$2,'{}'::jsonb), ($1,'contract.signed',$2,'{}'::jsonb)`,
    [orgId, clientId]);
  await db.query(
    `INSERT INTO opt_outs (org_id, client_id, channel) VALUES ($1,$2,'sms')`,
    [orgId, clientId]);
  await db.query(
    `INSERT INTO outbound_calls (org_id, client_id, call_id, kind)
     VALUES ($1,$2,'t16-call-1','outbound')`,
    [orgId, clientId]);
  await db.query(
    `INSERT INTO payment_links (org_id, client_id, purpose, amount_cents, link_ref, checkout_url)
     VALUES ($1,$2,'deposit',5000,'t16-ref-1','https://example.invalid/t16')`,
    [orgId, clientId]);

  // PAPERWORK. This is the case the first version of the fix got wrong, and it
  // is the case live caught:
  //
  //   demo teardown failed for client cb6f5839-…: documents ad69a9a0-…:
  //   documents are never deleted — register a superseding version instead
  //
  // `documents` carries an archive-only guard trigger. Migrations 150/151/152
  // rewrote it to allow a demo wipe, and the way it allows one is by looking UP
  // at the parent — `EXISTS (SELECT 1 FROM clients WHERE id = OLD.client_id AND
  // is_demo)`. That only answers yes while the client row still exists. Delete
  // the client in the same statement as its documents and the trigger can find
  // the client already gone, conclude this is not a demo wipe, and refuse.
  //
  // The demo seeder creates no documents, so nothing here exercised that path
  // and the whole suite went green on a broken fix. It does now.
  await db.query(
    `INSERT INTO documents (org_id, client_id, document_key, kind, title, storage_key, mime_type)
     VALUES ($1,$2,'t16-teardown-doc-a','contract','Doc A','k/t16a','application/pdf'),
            ($1,$2,'t16-teardown-doc-b','contract','Doc B','k/t16b','application/pdf')`,
    [orgId, clientId]);
}

// Every public table that can hold a row for this client, counted generically
// so a table added later is covered without editing this test.
async function rowsLeftAnywhere(clientId) {
  const kids = await db.query(`
    SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'client_id'
     ORDER BY table_name`);
  const left = {};
  for (const k of kids.rows) {
    const r = await db.query(
      `SELECT count(*)::int n FROM "${k.table_name}" WHERE client_id = $1`, [clientId]
    ).catch(() => null);
    if (r && r.rows[0].n > 0) left[k.table_name] = r.rows[0].n;
  }
  const c = await db.query(`SELECT count(*)::int n FROM clients WHERE id = $1`, [clientId]);
  if (c.rows[0].n > 0) left.clients = c.rows[0].n;
  return left;
}

describe("demo client teardown", { skip: !hasDb ? "no DATABASE_URL" : false }, () => {
  before(async () => {
    await purge();
    const r = await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'T16 Teardown Suite') RETURNING id`, [SLUG]);
    orgId = r.rows[0].id;
  });

  after(async () => { await purge(); await close(); });

  test("the list of blocking tables is read from the database, not typed out", async () => {
    const children = await clientChildTables(db);
    const names = children.map((c) => c.table);
    // events is the table that actually stranded the live client.
    assert.ok(names.includes("events"),
      "events points at clients and refuses a delete — it must be in the list");
    // crs_results cascades on its own; re-deleting it is wasted work.
    assert.ok(!names.includes("crs_results"),
      "crs_results already cascades — it should not be in the list");
    for (const c of children) {
      assert.match(c.table, /^[A-Za-z_][A-Za-z0-9_]*$/);
      assert.match(c.column, /^[A-Za-z_][A-Za-z0-9_]*$/);
    }
  });

  test("a demo client that has been USED tears down completely", async () => {
    const sim = await loadSimulatedClient(db, { orgId });
    const clientId = sim.client.id;

    await dirtyTheClient(clientId);
    const before = await rowsLeftAnywhere(clientId);
    assert.ok(before.events >= 2, "setup failed: the client should be carrying event rows");

    const result = await teardownSimulated(db, { orgId, clientId });
    assert.equal(result.count, 1, "teardown should report removing exactly this client");

    const after = await rowsLeftAnywhere(clientId);
    assert.deepEqual(after, {},
      "teardown said it succeeded but rows are still there — this is the exact bug: " +
      JSON.stringify(after));
  });

  test("paperwork guarded by an archive trigger does not block the wipe", async () => {
    const sim = await loadSimulatedClient(db, { orgId });
    const clientId = sim.client.id;
    await db.query(
      `INSERT INTO documents (org_id, client_id, document_key, kind, title, storage_key, mime_type)
       VALUES ($1,$2,'t16-guarded-doc','contract','Guarded','k/g','application/pdf')`,
      [orgId, clientId]);

    // Must not throw. If it does, the client is deleted in the same statement as
    // its documents again and the guard trigger cannot see it is a demo client.
    await teardownSimulated(db, { orgId, clientId });
    assert.deepEqual(await rowsLeftAnywhere(clientId), {});
  });

  test("a real client's paperwork is never touched", async () => {
    const r = await db.query(
      `INSERT INTO clients (org_id, first_name, email, is_demo)
       VALUES ($1,'Real','t16-real-doc@example.invalid', false) RETURNING id`, [orgId]);
    const realId = r.rows[0].id;
    await db.query(
      `INSERT INTO documents (org_id, client_id, document_key, kind, title, storage_key, mime_type)
       VALUES ($1,$2,'t16-real-guarded-doc','contract','Real','k/r','application/pdf')`,
      [orgId, realId]);

    await teardownSimulated(db, { orgId, clientId: realId });
    await teardownSimulated(db, { orgId });

    const left = await rowsLeftAnywhere(realId);
    assert.equal(left.clients, 1, "the real client must survive");
    assert.equal(left.documents, 1, "and so must their paperwork");
  });

  test("a real client is never removed by this path", async () => {
    const r = await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, is_demo)
       VALUES ($1,'Real','Person','t16-real@example.invalid', false) RETURNING id`, [orgId]);
    const realId = r.rows[0].id;

    const byId = await teardownSimulated(db, { orgId, clientId: realId });
    assert.equal(byId.count, 0, "a client not flagged demo must not be touched");

    await teardownSimulated(db, { orgId });          // the wipe-the-whole-org path
    const still = await db.query(`SELECT count(*)::int n FROM clients WHERE id = $1`, [realId]);
    assert.equal(still.rows[0].n, 1, "the real client must survive an org-wide demo wipe");
  });

  test("only clients matching the demo markers are swept by the org-wide path", async () => {
    const sim = await loadSimulatedClient(db, { orgId });
    assert.ok(sim.email.startsWith(DEMO_EMAIL_PREFIX) && sim.email.endsWith(DEMO_EMAIL_DOMAIN),
      "the seeder should still produce the demo email shape the sweep matches on");
    const swept = await teardownSimulated(db, { orgId });
    assert.ok(swept.count >= 1);
    assert.equal(swept.truncated, false);
  });

  test("a caller that knows only the client id still works", async () => {
    // src/verification/journeys/funding.mjs calls it this way. It used to throw
    // TypeError into a swallowing catch, so that cleanup never ran once.
    const sim = await loadSimulatedClient(db, { orgId });
    const result = await teardownSimulated(db, { clientId: sim.client.id });
    assert.equal(result.count, 1);
    assert.deepEqual(await rowsLeftAnywhere(sim.client.id), {});
  });
});
