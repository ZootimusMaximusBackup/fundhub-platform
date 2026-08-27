// Outbound threading — a message the SYSTEM sends lands in a thread, so the
// person it was sent to appears on the Messaging screen.
//
// THE BUG THIS PINS. api/read/inbox.mjs — the staff Messaging list — reads
// `conversations`. Threading lived as a private function inside
// src/handlers/comms.mjs, so the two inbound webhooks threaded their rows and
// nothing else did. Every workflow send wrote conversation_id NULL. A client
// whose only messages were automatic — the welcome email, the welcome text —
// therefore had no row on that screen at all: staff searched their name and got
// "Nothing matches what you typed" while the company had already texted them
// twice. Measured on production 2026-08-27: 600 of 844 message rows carried no
// thread, across 51 clients, 15 of whom were invisible.
//
// FOUR CLAIMS:
//
//   1. A workflow send creates the client's thread and points the message at it.
//   2. The person then comes back from api/read/inbox.mjs — the actual screen's
//      query, not a stand-in for it. This is the claim the board row was about.
//   3. The backfill migration puts the messages that were ALREADY sent onto
//      threads. Without it the fix only helps people messaged from today on.
//   4. A message with no client stays unthreaded. conversations.client_id is
//      NOT NULL and an unresolved message belongs to nobody — that is the
//      honest state, not a gap to paper over.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { db, close } from "../db.mjs";
import { sendTemplated } from "./messaging.mjs";
import { run as inboxRun } from "../../api/read/inbox.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "outbound_thread_pg_test@example.com";
const TPL = "OUTBOUND-THREAD-PG-TEST";
const BACKFILL = new URL("../../db/migrations/266_backfill_message_threads.sql", import.meta.url);

let orgId = null;
let clientId = null;

async function wipe() {
  await db.query(`DELETE FROM messages WHERE client_id IN (SELECT id FROM clients WHERE email LIKE $1)`, [`%${EMAIL}`]);
  await db.query(`DELETE FROM messages WHERE provider_ref LIKE 'workflow:${TPL}:%'`);
  await db.query(`DELETE FROM conversations WHERE client_id IN (SELECT id FROM clients WHERE email LIKE $1)`, [`%${EMAIL}`]);
  // sendTemplated emits message.queued, and events.client_id points here.
  await db.query(`DELETE FROM events WHERE client_id IN (SELECT id FROM clients WHERE email LIKE $1)`, [`%${EMAIL}`]);
  await db.query(`DELETE FROM clients WHERE email LIKE $1`, [`%${EMAIL}`]);
  await db.query(`DELETE FROM message_templates WHERE template_key = $1`, [TPL]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, phone)
     VALUES ($1,$2,'Outbound','Threadtest','+15550000888') RETURNING id`,
    [orgId, `mine_${EMAIL}`])).rows[0].id;
  await db.query(
    `INSERT INTO message_templates (org_id, template_key, channel, body, compliance_passed)
     VALUES ($1,$2,'sms','Welcome aboard.',true)`,
    [orgId, TPL]);
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

/* The screen's own query, driven the way src/http/inbox-read.pg.test.mjs drives
   it: a session-shaped principal and nothing else, because the org filter IS
   the scope of this endpoint. */
async function inboxNames() {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  await inboxRun({ method: "GET", query: { limit: "200" }, headers: {} }, r, {
    db,
    requireAuth: async () => ({ id: null, role: "owner", org_id: orgId, status: "active" })
  });
  assert.equal(r.code, 200);
  return (r.body.items || []).map((i) => `${i.first_name || ""} ${i.last_name || ""}`.trim());
}

test("a workflow send puts the client on a thread", { skip: !HAS_DB && "no DATABASE_URL" }, async () => {
  const res = await sendTemplated(db, {
    orgId, clientId, channel: "sms", templateKey: TPL, eventId: "thread-pg-1"
  });
  assert.equal(res.sent, true);

  const { rows } = await db.query(
    `SELECT m.id, m.conversation_id, c.channel, c.last_pulse_at, m.created_at
       FROM messages m LEFT JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = $1::uuid`, [res.messageId]);
  assert.ok(rows[0].conversation_id, "the message was written with no thread");
  assert.equal(rows[0].channel, "sms");
  assert.equal(
    new Date(rows[0].last_pulse_at).getTime(), new Date(rows[0].created_at).getTime(),
    "the thread's clock must be the message's own time, not now()");
});

test("and the Messaging screen can then find them by name", { skip: !HAS_DB && "no DATABASE_URL" }, async () => {
  // The board row, verbatim: messages exist, the card does not show.
  assert.ok((await inboxNames()).includes("Outbound Threadtest"),
    "the client is missing from the inbox the Messaging screen reads");
});

test("the backfill puts messages sent BEFORE the fix onto threads too", { skip: !HAS_DB && "no DATABASE_URL" }, async () => {
  // Exactly the state production was left in: a delivered message, no thread.
  const older = (await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, template_key,
                           rendered_body, provider, provider_ref, status, compliance_check_passed)
     VALUES ($1,$2,'outbound','email',$3,'You are in.','internal',$4,'delivered',true)
     RETURNING id`,
    [orgId, clientId, TPL, `workflow:${TPL}:pre-fix`])).rows[0].id;

  const before = await db.query(
    `SELECT count(*)::int AS n FROM conversations WHERE client_id = $1::uuid AND channel = 'email'`,
    [clientId]);
  assert.equal(before.rows[0].n, 0, "sanity: this client has no email thread yet");

  await db.query(readFileSync(BACKFILL, "utf8"));

  const { rows } = await db.query(
    `SELECT m.conversation_id, c.channel FROM messages m
       LEFT JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = $1::uuid`, [older]);
  assert.ok(rows[0].conversation_id, "an already-sent message was left off every thread");
  assert.equal(rows[0].channel, "email", "it must land on the thread for its own channel");

  const none = await db.query(`SELECT count(*)::int AS n FROM messages WHERE conversation_id IS NULL AND client_id = $1::uuid`, [clientId]);
  assert.equal(none.rows[0].n, 0, "the backfill left one of this client's messages loose");
});

test("a message with no client stays unthreaded, and that is correct", { skip: !HAS_DB && "no DATABASE_URL" }, async () => {
  const stranger = (await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body, provider, provider_ref, status)
     VALUES ($1,NULL,'inbound','sms','who is this','twilio',$2,'delivered') RETURNING id`,
    [orgId, `workflow:${TPL}:stranger`])).rows[0].id;

  await db.query(readFileSync(BACKFILL, "utf8"));

  const { rows } = await db.query(`SELECT conversation_id FROM messages WHERE id = $1::uuid`, [stranger]);
  assert.equal(rows[0].conversation_id, null,
    "a message from nobody must not be filed on somebody's thread");
});
