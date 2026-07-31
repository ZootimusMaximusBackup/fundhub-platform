// Real-Postgres integration test for the conversation writer and for the
// threading now done by src/handlers/comms.mjs.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// What this proves that the unit tests cannot: migration 057's unique index
// actually exists and actually collapses a client's channel onto one row; a
// GREATEST over a NULL really does keep the known side; and the messages ->
// conversations link that has been dangling since 001_init.sql is now filled in
// by the live handler path rather than only in theory.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { upsertConversation, listConversations, linkMessage } from "./store.mjs";
import { onMessageInbound, onCallCompleted } from "../handlers/comms.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "conversations_pg_test@example.com";
const EMAIL2 = "conversations_pg_test_b@example.com";
const PHONE = "+15550000917";
const EMAILS = [EMAIL, EMAIL2];

let orgId = null;
let clientId = null;
let otherClientId = null;

async function wipe() {
  // messages.client_id is a plain FK (no cascade), so messages go first.
  await db.query(`DELETE FROM messages WHERE provider_ref LIKE 'CVPG_%'`);
  await db.query(`DELETE FROM messages WHERE client_id IN (SELECT id FROM clients WHERE email = ANY($1))`, [EMAILS]);
  await db.query(`DELETE FROM conversations WHERE client_id IN (SELECT id FROM clients WHERE email = ANY($1))`, [EMAILS]);
  await db.query(`DELETE FROM opt_outs WHERE client_id IN (SELECT id FROM clients WHERE email = ANY($1))`, [EMAILS]);
  await db.query(`DELETE FROM clients WHERE email = ANY($1)`, [EMAILS]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, phone, first_name, last_name) VALUES ($1,$2,$3,'Convo','Tester') RETURNING id`,
    [orgId, EMAIL, PHONE]
  )).rows[0].id;
  otherClientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Convo','Other') RETURNING id`,
    [orgId, EMAIL2]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

// --- the index migration 057 adds -------------------------------------------

test("a client gets one conversation per channel no matter how many messages arrive", { skip: !HAS_DB }, async () => {
  await upsertConversation(db, { orgId, clientId, channel: "sms", lastPulseAt: "2026-07-30T10:00:00Z" });
  await upsertConversation(db, { orgId, clientId, channel: "sms", lastPulseAt: "2026-07-30T11:00:00Z" });
  await upsertConversation(db, { orgId, clientId, channel: "sms", lastPulseAt: "2026-07-30T12:00:00Z" });

  const rows = (await db.query(`SELECT * FROM conversations WHERE client_id=$1 AND channel='sms'`, [clientId])).rows;
  assert.equal(rows.length, 1, "the upsert must land on one thread, not three");
  assert.equal(new Date(rows[0].last_pulse_at).toISOString(), "2026-07-30T12:00:00.000Z");
});

test("a different channel for the same client is a separate thread", { skip: !HAS_DB }, async () => {
  await upsertConversation(db, { orgId, clientId, channel: "voice", lastPulseAt: "2026-07-30T09:00:00Z" });
  const rows = (await db.query(`SELECT channel FROM conversations WHERE client_id=$1 ORDER BY channel`, [clientId])).rows;
  assert.deepEqual(rows.map((r) => r.channel), ["sms", "voice"]);
});

test("the database itself refuses a second row for one (client, channel) pair", { skip: !HAS_DB }, async () => {
  await db.query(`INSERT INTO conversations (org_id, client_id, channel) VALUES ($1,$2,'probe_dup')`, [orgId, clientId]);
  await assert.rejects(
    () => db.query(`INSERT INTO conversations (org_id, client_id, channel) VALUES ($1,$2,'probe_dup')`, [orgId, clientId]),
    /duplicate key value/,
    "uq_conversations_client_channel from migration 057 must be present"
  );
});

// --- the rule about not inventing -------------------------------------------

test("sentiment stays NULL through every write the store makes", { skip: !HAS_DB }, async () => {
  await upsertConversation(db, { orgId, clientId, channel: "sms", summary: "client asked about timing", lastPulseAt: "2026-07-30T13:00:00Z" });
  const rows = (await db.query(`SELECT sentiment FROM conversations WHERE client_id=$1`, [clientId])).rows;
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.sentiment === null), "nothing here computes Hot/Warm/Cold, so nothing here writes it");
});

test("a later write with no summary does not erase the summary already stored", { skip: !HAS_DB }, async () => {
  await upsertConversation(db, { orgId, clientId, channel: "summary_probe", summary: "asked about timing" });
  const row = await upsertConversation(db, { orgId, clientId, channel: "summary_probe" });
  assert.equal(row.summary, "asked about timing", "absence is not a correction");
});

test("an older pulse arriving late does not rewind the thread's clock", { skip: !HAS_DB }, async () => {
  await upsertConversation(db, { orgId, clientId, channel: "pulse_probe", lastPulseAt: "2026-07-30T18:00:00Z" });
  const row = await upsertConversation(db, { orgId, clientId, channel: "pulse_probe", lastPulseAt: "2026-07-30T08:00:00Z" });
  assert.equal(new Date(row.last_pulse_at).toISOString(), "2026-07-30T18:00:00.000Z");
});

test("a pulse-less write does not blank a pulse time already known", { skip: !HAS_DB }, async () => {
  const row = await upsertConversation(db, { orgId, clientId, channel: "pulse_probe" });
  assert.equal(new Date(row.last_pulse_at).toISOString(), "2026-07-30T18:00:00.000Z", "GREATEST ignores the NULL side");
});

// --- reader ------------------------------------------------------------------

test("listConversations puts the most recently active thread first and the never-pulsed one last", { skip: !HAS_DB }, async () => {
  await upsertConversation(db, { orgId, clientId: otherClientId, channel: "email", lastPulseAt: "2026-07-01T10:00:00Z" });
  await upsertConversation(db, { orgId, clientId: otherClientId, channel: "sms", lastPulseAt: "2026-07-20T10:00:00Z" });
  await upsertConversation(db, { orgId, clientId: otherClientId, channel: "voice" }); // never pulsed

  const rows = await listConversations(db, { clientId: otherClientId });
  assert.deepEqual(rows.map((r) => r.channel), ["sms", "email", "voice"]);
});

// --- the link that used to dangle --------------------------------------------

test("linkMessage fills in the messages.conversation_id that comms.mjs used to leave NULL", { skip: !HAS_DB }, async () => {
  const msg = (await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body, provider, provider_ref, status)
     VALUES ($1,$2,'inbound','sms','hello','twilio','CVPG_link1','received') RETURNING id`,
    [orgId, clientId]
  )).rows[0];
  const convo = await upsertConversation(db, { orgId, clientId, channel: "sms" });

  assert.deepEqual(await linkMessage(db, { messageId: msg.id, conversationId: convo.id }), { linked: true });
  const stored = (await db.query(`SELECT conversation_id FROM messages WHERE id=$1`, [msg.id])).rows[0];
  assert.equal(stored.conversation_id, convo.id);
});

test("linkMessage refuses to attach a message to another client's thread", { skip: !HAS_DB }, async () => {
  const msg = (await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, provider_ref, status)
     VALUES ($1,$2,'inbound','sms','CVPG_link2','received') RETURNING id`,
    [orgId, clientId]
  )).rows[0];
  const foreign = await upsertConversation(db, { orgId, clientId: otherClientId, channel: "sms" });

  assert.deepEqual(await linkMessage(db, { messageId: msg.id, conversationId: foreign.id }), { linked: false });
  const stored = (await db.query(`SELECT conversation_id FROM messages WHERE id=$1`, [msg.id])).rows[0];
  assert.equal(stored.conversation_id, null, "one client's SMS must never appear in another's history");
});

// --- the handler path ---------------------------------------------------------

const ev = (payload, extra = {}) => ({ id: "cvpg-evt", orgId, payload, ...extra });

test("an inbound SMS threads itself: the messages row points at the client's sms conversation", { skip: !HAS_DB }, async () => {
  await onMessageInbound(ev({ from: PHONE, body: "sounds good", sid: "CVPG_sms1", channel: "sms", source: "twilio" }), db);

  const msg = (await db.query(`SELECT * FROM messages WHERE provider_ref='CVPG_sms1'`)).rows[0];
  assert.ok(msg, "the message row is still written");
  assert.equal(msg.client_id, clientId, "matched to the client by phone");
  assert.ok(msg.conversation_id, "conversation_id is no longer left NULL");

  const convo = (await db.query(`SELECT * FROM conversations WHERE id=$1`, [msg.conversation_id])).rows[0];
  assert.equal(convo.channel, "sms", "the thread's channel is the messages row's channel, not a new vocabulary");
  assert.equal(convo.client_id, clientId);
  assert.equal(convo.sentiment, null);
  assert.equal(
    new Date(convo.last_pulse_at).toISOString(),
    new Date(msg.created_at).toISOString(),
    "the pulse is the message's own recorded time, not a clock read in the handler"
  );
});

test("redelivering the same inbound SMS keeps one message, one thread, and the original pulse time", { skip: !HAS_DB }, async () => {
  const before = (await db.query(`SELECT * FROM messages WHERE provider_ref='CVPG_sms1'`)).rows[0];
  await onMessageInbound(ev({ from: PHONE, body: "sounds good", sid: "CVPG_sms1", channel: "sms", source: "twilio" }), db);

  const msgs = (await db.query(`SELECT * FROM messages WHERE provider_ref='CVPG_sms1'`)).rows;
  assert.equal(msgs.length, 1, "no duplicate message");
  const convos = (await db.query(`SELECT * FROM conversations WHERE client_id=$1 AND channel='sms'`, [clientId])).rows;
  assert.equal(convos.length, 1, "no duplicate thread");
  assert.equal(msgs[0].conversation_id, before.conversation_id, "still linked to the same thread");
  assert.equal(
    new Date(convos[0].last_pulse_at).toISOString(),
    new Date(before.created_at).toISOString(),
    "a redelivery does not drag the pulse forward — it is the same message"
  );
});

test("a completed call threads onto the voice channel it already writes to messages", { skip: !HAS_DB }, async () => {
  await onCallCompleted(ev({ callId: "CVPG_call1", status: "completed", disposition: "transferred", source: "bland" }, { clientId }), db);

  const msg = (await db.query(`SELECT * FROM messages WHERE provider_ref='CVPG_call1'`)).rows[0];
  assert.equal(msg.channel, "voice");
  assert.ok(msg.conversation_id);
  const convo = (await db.query(`SELECT * FROM conversations WHERE id=$1`, [msg.conversation_id])).rows[0];
  assert.equal(convo.channel, "voice");
  assert.equal(convo.summary, null, "no payload here carries a summary, so none is invented");
});

test("an inbound SMS from an unrecognised number is stored but threads to nothing", { skip: !HAS_DB }, async () => {
  await onMessageInbound(ev({ from: "+19999999998", body: "who is this", sid: "CVPG_sms2", channel: "sms", source: "twilio" }), db);

  const msg = (await db.query(`SELECT * FROM messages WHERE provider_ref='CVPG_sms2'`)).rows[0];
  assert.ok(msg, "the message is still recorded — it may be the start of something");
  assert.equal(msg.client_id, null, "these handlers must not mint a client from an inbound message");
  assert.equal(msg.conversation_id, null, "conversations.client_id is NOT NULL, so there is no thread to join yet");
});
