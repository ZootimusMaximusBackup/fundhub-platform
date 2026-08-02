// THE ACCEPTANCE TEST. One flow, in order, exactly as the ticket words it:
//
//   a simulated inbound SMS creates/threads a conversation,
//   it appears in the inbox,
//   a staff reply goes out through dispatch,
//   and the thread shows both messages.
//
// WHY THIS EXISTS ON TOP OF THE OTHER FIVE FILES. Each of those proves one
// piece against its own fixture. None of them proves the pieces MEET: that the
// conversation the inbound handler creates is the one the inbox lists, that the
// id the inbox returns is the one the thread read accepts, and that a reply
// posted against that id lands in the same thread the client's message is in.
// Every one of those is a join between two modules written separately, and a
// green test per module is exactly the shape of green that hid the routing
// failures in AUDIT-FINDINGS.
//
// It goes through the real HTTP handlers with a real session token, not through
// the service functions, because the ids travel over the wire as query strings
// and a JSON body — which is where an id that is right in the database can
// still be wrong on the screen.
//
// The org's SMS routing points at the `memory` provider for the duration, and
// is put back in after(). See the note in compose.pg.test.mjs.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { onMessageInbound } from "../handlers/comms.mjs";
import inboxHandler from "../../api/read/inbox.mjs";
import threadHandler from "../../api/read/messages.mjs";
import { recorded, reset as resetMemory } from "./providers/memory.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "reply_inbox_acceptance@example.com";
const PHONE = "+15550001234";
const SID = "acceptance-inbound-sms-1";

let orgId = null;
let staffId = null;
let clientId = null;
let token = null;
let sessionId = null;
let savedRouting = [];

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => r;
  return r;
};

const get = async (handler, query) => {
  const r = res();
  await handler({ method: "GET", query, headers: { authorization: "Bearer " + token } }, r);
  return r;
};

async function wipe() {
  await db.query(`DELETE FROM staff_events WHERE detail->>'client_id' IN (SELECT id::text FROM clients WHERE email = $1)`, [EMAIL]);
  await db.query(`DELETE FROM messages WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
  await db.query(`DELETE FROM messages WHERE provider_ref = $1`, [SID]);
  await db.query(`DELETE FROM conversations WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
  await db.query(`DELETE FROM tasks WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
  await db.query(`DELETE FROM opt_outs WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email = $1`, [EMAIL]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  const s = (await db.query(
    `SELECT id, org_id FROM staff WHERE org_id = $1 AND status = 'active'
      ORDER BY created_at LIMIT 1`, [orgId])).rows[0];
  assert.ok(orgId && s, "an org and an active staff member must exist — run the seed");
  staffId = s.id;

  const { createSession } = await import("../auth/session.mjs");
  const session = await createSession(db, { staffId, orgId: s.org_id });
  token = session.token;
  sessionId = session.sessionId;

  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, phone)
     VALUES ($1,$2,'Acceptance','Client',$3) RETURNING id`, [orgId, EMAIL, PHONE])).rows[0].id;

  savedRouting = (await db.query(
    `SELECT channel, provider, enabled FROM message_channel_routing WHERE org_id = $1`, [orgId])).rows;
  await db.query(
    `UPDATE message_channel_routing SET provider = 'memory' WHERE org_id = $1 AND channel = 'sms'`, [orgId]);
  resetMemory();
});

after(async () => {
  if (!HAS_DB) return;
  for (const row of savedRouting) {
    await db.query(
      `UPDATE message_channel_routing SET provider = $2, enabled = $3 WHERE org_id = $1 AND channel = $4`,
      [orgId, row.provider, row.enabled, row.channel]);
  }
  await wipe();
  if (sessionId) await db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
  await close();
});

/* The four steps share state, so they are one ordered flow rather than four
   independent tests. Node's runner executes them in file order. */

let convoId = null;

test("1. a simulated inbound SMS creates the thread and joins the message to it",
  { skip: !HAS_DB }, async () => {
  // The event exactly as src/adapters/twilio.mjs emits it for an inbound text.
  await onMessageInbound({
    id: "acceptance-evt-1", name: "message.inbound", version: 1,
    orgId, clientId: null,
    payload: { from: PHONE, to: "+15551110000", body: "hi — can someone call me about my file?",
               sid: SID, channel: "sms", source: "twilio" }
  }, db);

  const c = await db.query(
    `SELECT id, channel, last_pulse_at FROM conversations WHERE client_id = $1`, [clientId]);
  assert.equal(c.rows.length, 1, "the inbound text created no thread");
  convoId = c.rows[0].id;
  assert.equal(c.rows[0].channel, "sms");

  const m = await db.query(
    `SELECT conversation_id, direction FROM messages WHERE provider_ref = $1`, [SID]);
  assert.equal(m.rows[0].conversation_id, convoId, "the message is not on the thread");
  assert.equal(m.rows[0].direction, "inbound");
});

test("2. it appears in the inbox, marked as waiting on us", { skip: !HAS_DB }, async () => {
  const r = await get(inboxHandler, { limit: "200" });
  assert.equal(r.code, 200);
  const row = (r.body.items || []).find((x) => x.id === convoId);
  assert.ok(row, "the new thread is not in the inbox a staff member would open");
  assert.equal(row.needs_reply, true, "a thread the client just wrote on is not marked as needing a reply");
  assert.equal(row.last_body, "hi — can someone call me about my file?");
  assert.equal(row.client_id, clientId);
  assert.equal(row.first_name, "Acceptance", "the inbox row cannot say who it is with");
});

test("3. a staff reply goes out through dispatch", { skip: !HAS_DB }, async () => {
  resetMemory();
  /* Posted through the service the endpoint calls, with the org and staff id
     the session would supply. The endpoint itself adds the staff principal and
     the shift gate; both are covered in their own files, and driving them here
     would mean opening a shift as a side effect of an acceptance test. */
  const { composeAndSend } = await import("./compose.mjs");
  const out = await composeAndSend(db, {
    orgId, staffId, conversationId: convoId,
    body: "calling you in ten minutes",
    idempotencyKey: "acceptance-reply-1"
  }, { now: () => new Date("2026-03-10T18:00:00Z") });

  assert.equal(out.outcome, "sent", `the reply did not go out: ${JSON.stringify(out)}`);
  assert.equal(out.conversationId, convoId);

  // It really went through the dispatcher to a provider, addressed to the
  // number the client texted from.
  const delivered = recorded();
  assert.equal(delivered.length, 1, "the reply never reached a provider");
  assert.equal(delivered[0].to, PHONE);
  assert.equal(delivered[0].body, "calling you in ten minutes");

  // And it is attributed to the person who wrote it.
  assert.equal(out.message.sender_staff_id, staffId);
});

test("4. the thread shows both messages, in reading order, with both authors",
  { skip: !HAS_DB }, async () => {
  const r = await get(threadHandler, { conversation_id: convoId, limit: "200" });
  assert.equal(r.code, 200);
  const items = r.body.items || [];
  assert.equal(items.length, 2, `the thread shows ${items.length} messages, not both sides of it`);

  // The endpoint answers newest-first; the screen reverses it. Read it the same
  // way the screen does.
  const ordered = items.slice().reverse();
  assert.equal(ordered[0].direction, "inbound");
  assert.equal(ordered[0].rendered_body, "hi — can someone call me about my file?");
  assert.equal(ordered[0].sender_name, null, "an inbound message was attributed to a staff member");

  assert.equal(ordered[1].direction, "outbound");
  assert.equal(ordered[1].rendered_body, "calling you in ten minutes");
  assert.equal(ordered[1].status, "sent");
  assert.ok(ordered[1].sender_name, "the thread cannot say who replied");
});

test("5. the inbox no longer shows the thread as waiting — we answered it",
  { skip: !HAS_DB }, async () => {
  const r = await get(inboxHandler, { limit: "200" });
  const row = (r.body.items || []).find((x) => x.id === convoId);
  assert.equal(row.needs_reply, false);
  assert.equal(row.last_direction, "outbound");
});
