// Real-Postgres test for the dispatcher's SQL.
// SKIPS unless DATABASE_URL is set.
//
// WHY THIS FILE HAS TO EXIST. Every other dispatcher test drives a fake `db`
// that pattern-matches on the SQL string, which proves the control flow and
// proves nothing at all about whether the SQL parses. claimDue()'s statement is
// the most intricate query in this feature — an UPDATE ... FROM (SELECT ...
// FOR UPDATE SKIP LOCKED) — and it is the one thing standing between two
// dispatchers and a double send. A typo in it would pass the whole unit suite
// and fail the first time it ran against a real database.
//
// So this asserts the three things only Postgres can answer:
//   1. the claim statement is valid SQL against the real schema
//   2. it actually claims — status flips to 'sending' and attempts increments
//   3. two concurrent dispatchers cannot claim the same row
//
// Requires: npm run migrate (specifically db/migrations/110_messages_outbound.sql).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { claimDue, MAX_ATTEMPTS } from "./dispatch.mjs";

const RUN = !!process.env.DATABASE_URL;

let orgId = null;
let clientId = null;

const TAG = "dispatch-pg-test";

before(async () => {
  if (!RUN) return;
  const org = await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`);
  orgId = org.rows[0].id;
  const c = await db.query(
    `INSERT INTO clients (org_id, first_name, email, ghl_contact_id)
     VALUES ($1, 'Dispatch', 'dispatch-pg-test@example.com', 'ghlDispatchTest')
     RETURNING id`,
    [orgId]
  );
  clientId = c.rows[0].id;
});

after(async () => {
  if (!RUN) return;
  // Clean up only this test's rows. A blanket DELETE would take other tests'
  // data with it, and the suite runs these files in one database.
  await db.query(`DELETE FROM messages WHERE template_key = $1`, [TAG]);
  if (clientId) await db.query(`DELETE FROM clients WHERE id = $1`, [clientId]);
  await close();
});

/** Queue one outbound message and return its id. */
async function queue({ scheduledAt = null, attempts = 0, status = "queued", channel = "email" } = {}) {
  const r = await db.query(
    `INSERT INTO messages
       (org_id, client_id, direction, channel, template_key, rendered_body,
        provider, provider_ref, status, compliance_check_passed, scheduled_at, attempts)
     VALUES ($1,$2,'outbound',$3,$4,'body','internal',$5,$6,true,$7,$8)
     RETURNING id`,
    [orgId, clientId, channel, TAG, `${TAG}:${Math.random()}`, status, scheduledAt, attempts]
  );
  return r.rows[0].id;
}

const statusOf = async (id) =>
  (await db.query(`SELECT status, attempts FROM messages WHERE id = $1`, [id])).rows[0];

test("the claim statement is valid SQL against the real schema", { skip: !RUN }, async () => {
  // The assertion is that this does not throw. A syntax error, a column that
  // does not exist, or a type mismatch all surface here and nowhere else.
  const rows = await claimDue(db, { orgId, limit: 1 });
  assert.ok(Array.isArray(rows));
});

test("claims a due message and marks it sending", { skip: !RUN }, async () => {
  const id = await queue();
  const rows = await claimDue(db, { orgId, limit: 50 });
  assert.ok(rows.some((r) => r.id === id), "the queued message should have been claimed");

  const after_ = await statusOf(id);
  assert.equal(after_.status, "sending");
  assert.equal(after_.attempts, 1, "claiming consumes an attempt");
});

// ── regression: claimDue's `now` bound straight to $3::timestamptz ─────────
//
// src/journeys/runner/index.mjs's drain() calls dispatchDue() → claimDue()
// with `{ now: () => clock.now() }`, and the runner's virtual clock
// (fake-step.mjs) returns a plain epoch-ms NUMBER. Binding that number
// straight to claimDue's $3::timestamptz parameter sent Postgres the literal
// text "1767399600000" and it rejected every one — "date/time field value
// out of range" — on the first live run against production (see
// docs/JOURNEY-RUNNER-RESULTS.md). dispatch.test.mjs's fake db cannot catch
// this: it pattern-matches the SQL string and never asks a real Postgres to
// cast anything. Only this file can.

test("claimDue accepts a clock function returning epoch milliseconds — the journey runner's virtual clock shape",
  { skip: !RUN }, async () => {
    const id = await queue();
    const rows = await claimDue(db, { orgId, limit: 50, now: () => Date.now() });
    assert.ok(rows.some((r) => r.id === id), "a due message should still be claimed under a virtual clock");
  });

test("a virtual epoch-ms clock set before a message's schedule leaves it queued",
  { skip: !RUN }, async () => {
    const scheduledAt = new Date(Date.now() + 3600_000);
    const id = await queue({ scheduledAt });
    const rows = await claimDue(db, { orgId, limit: 50, now: () => scheduledAt.getTime() - 60_000 });
    assert.ok(!rows.some((r) => r.id === id), "a message scheduled after the virtual clock's time must wait");
    assert.equal((await statusOf(id)).status, "queued");
  });

test("a virtual epoch-ms clock at or after a message's schedule claims it",
  { skip: !RUN }, async () => {
    const scheduledAt = new Date(Date.now() - 1000);
    const id = await queue({ scheduledAt });
    const rows = await claimDue(db, { orgId, limit: 50, now: () => scheduledAt.getTime() + 5000 });
    assert.ok(rows.some((r) => r.id === id), "a message due under the virtual clock should be claimed");
  });

test("claimDue also accepts now as a bare epoch-ms number or a Date, not only a function",
  { skip: !RUN }, async () => {
    const id1 = await queue();
    const rowsNumber = await claimDue(db, { orgId, limit: 50, now: Date.now() });
    assert.ok(rowsNumber.some((r) => r.id === id1), "a bare epoch-ms number must work like a resolved clock");

    const id2 = await queue();
    const rowsDate = await claimDue(db, { orgId, limit: 50, now: new Date() });
    assert.ok(rowsDate.some((r) => r.id === id2), "a bare Date must work like a resolved clock");
  });

test("a NULL scheduled_at means due immediately", { skip: !RUN }, async () => {
  const id = await queue({ scheduledAt: null });
  const rows = await claimDue(db, { orgId, limit: 50 });
  assert.ok(rows.some((r) => r.id === id));
});

test("a message scheduled in the future is not claimed", { skip: !RUN }, async () => {
  const id = await queue({ scheduledAt: new Date(Date.now() + 3600_000) });
  const rows = await claimDue(db, { orgId, limit: 50 });
  assert.ok(!rows.some((r) => r.id === id), "a future message must wait");
  assert.equal((await statusOf(id)).status, "queued");
});

test("a message past the attempt cap is never claimed again", { skip: !RUN }, async () => {
  const id = await queue({ attempts: MAX_ATTEMPTS });
  const rows = await claimDue(db, { orgId, limit: 50 });
  assert.ok(!rows.some((r) => r.id === id), "a message out of attempts must stop");
});

test("an inbound message is never claimed", { skip: !RUN }, async () => {
  const r = await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, template_key,
                           rendered_body, status, compliance_check_passed)
     VALUES ($1,$2,'inbound','sms',$3,'inbound body','queued',true) RETURNING id`,
    [orgId, clientId, TAG]
  );
  const rows = await claimDue(db, { orgId, limit: 50 });
  assert.ok(!rows.some((x) => x.id === r.rows[0].id), "inbound is not ours to send");
});

test("two dispatchers cannot claim the same message", { skip: !RUN }, async () => {
  // The double-send guard, exercised for real: no id may appear in both result
  // sets.
  //
  // BE PRECISE ABOUT WHAT THIS PROVES. The exclusion comes from the claim being
  // a single atomic UPDATE ... RETURNING — the row's status flips in the same
  // statement that selects it, so the loser of the race re-evaluates and finds
  // nothing. SKIP LOCKED is what stops the loser BLOCKING while it waits; it is
  // a throughput property, not the correctness one, and removing it would still
  // pass this test. That is why dispatch.test.mjs asserts SKIP LOCKED is
  // present in the statement separately.
  await Promise.all([queue(), queue(), queue(), queue()]);

  const [a, b] = await Promise.all([
    claimDue(db, { orgId, limit: 50 }),
    claimDue(db, { orgId, limit: 50 })
  ]);

  const idsA = new Set(a.map((r) => r.id));
  const overlap = b.filter((r) => idsA.has(r.id));
  assert.deepEqual(overlap, [], "the same message was claimed by two dispatchers");
});

test("the routing table answers the dispatcher's lookup", { skip: !RUN }, async () => {
  // Migration 110 seeds these two rows per org, and 164_resend_twilio_routing.sql
  // repointed BOTH: email mailgun -> resend, sms ghl_relay -> twilio. This test
  // still named the pre-164 pair, so it failed while describing a routing table
  // the product stopped using. If the seed or the column names drift, the
  // dispatcher holds every message and this is where that shows up.
  const { rows } = await db.query(
    `SELECT channel, provider, enabled FROM message_channel_routing
      WHERE org_id = $1 ORDER BY channel`,
    [orgId]
  );
  assert.deepEqual(rows, [
    { channel: "email", provider: "resend", enabled: true },
    { channel: "sms", provider: "twilio", enabled: true }
  ]);
});

test("the columns 110 added are writable with the values the dispatcher uses",
  { skip: !RUN }, async () => {
    const id = await queue();
    await db.query(
      `UPDATE messages
          SET status = 'sent', provider = $2, provider_message_id = $3,
              last_error = NULL, last_attempt_at = now(), blocked_reason = $4,
              blocked_at = now(), scheduled_at = now()
        WHERE id = $1`,
      [id, "mailgun", "<provider-id@example.com>", "opted_out"]
    );
    const { rows } = await db.query(
      `SELECT provider, provider_message_id, blocked_reason, attempts
         FROM messages WHERE id = $1`,
      [id]
    );
    assert.equal(rows[0].provider_message_id, "<provider-id@example.com>");
    assert.equal(rows[0].blocked_reason, "opted_out");
  });
