// Inbound threading — a client contacts us and it lands in a thread.
//
// This is the wiring the staff reply inbox needs to have anything in it. Before
// it, an inbound SMS wrote a `messages` row and an inbound email wrote nothing
// at all, so the inbox would have rendered an empty list forever.
//
// FOUR CLAIMS, and the third is the one that was actually missing:
//
//   1. An inbound SMS from a known number creates the client's sms thread and
//      points the message at it.
//   2. A SECOND inbound SMS joins that same thread rather than minting another.
//      One thread per (client, channel) is the whole design of migration 057,
//      and "it worked for the first message" is not evidence of it.
//   3. An inbound EMAIL from a client's own address does the same on the email
//      thread. This had no path at all: Mailgun's inbound route is the bank
//      inbox, whose sender is a bank, and a bank statement is not the client
//      talking to us. See resolveClientFromSender in src/adapters/mailgun.mjs.
//   4. A message from a stranger stays unthreaded, and is NOT used to invent a
//      client. That is the honest outcome, not a gap — an unrecognised number
//      could be anybody, including spam.
//
// Driven through the handler with real event objects rather than through the
// adapters, so the signature machinery is not in the path; src/adapters/*.test
// already covers verification. The two adapter-level facts that matter for
// threading — that Mailgun emits message.inbound for a client sender and does
// not for a bank — are asserted at the bottom against a stubbed database.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { onMessageInbound } from "./comms.mjs";
import { handleMailgunWebhook } from "../adapters/mailgun.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "inbound_thread_pg_test@example.com";
const PHONE = "+15550000777";

let orgId = null;
let clientId = null;

async function wipe() {
  await db.query(`DELETE FROM messages WHERE client_id IN (SELECT id FROM clients WHERE email LIKE $1)`, [`%${EMAIL}`]);
  await db.query(`DELETE FROM messages WHERE org_id IS NOT NULL AND provider_ref LIKE 'thread-test-%'`);
  await db.query(`DELETE FROM conversations WHERE client_id IN (SELECT id FROM clients WHERE email LIKE $1)`, [`%${EMAIL}`]);
  await db.query(`DELETE FROM opt_outs WHERE client_id IN (SELECT id FROM clients WHERE email LIKE $1)`, [`%${EMAIL}`]);
  await db.query(`DELETE FROM clients WHERE email LIKE $1`, [`%${EMAIL}`]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, phone)
     VALUES ($1,$2,'Inbound','Sender',$3) RETURNING id`,
    [orgId, `mine_${EMAIL}`, PHONE])).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

/* An event as the bus hands it to a handler. clientId is deliberately NOT set
   on the SMS cases: resolving the client from the phone number is part of what
   is being tested. */
const event = (payload, extra = {}) => ({
  id: `evt-${payload.sid}`, name: "message.inbound", version: 1,
  orgId, clientId: null, payload, ...extra
});

const threads = () => db.query(
  `SELECT id, channel, last_pulse_at FROM conversations WHERE client_id = $1 ORDER BY channel`, [clientId]);

const messagesOn = (convoId) => db.query(
  `SELECT id, direction, channel, rendered_body, subject, conversation_id
     FROM messages WHERE conversation_id = $1 ORDER BY created_at`, [convoId]);

test("inbound sms: a text from a known number creates the thread and joins the message to it",
  { skip: !HAS_DB }, async () => {
  await onMessageInbound(event({
    from: PHONE, to: "+15551110000", body: "hi, are you there?",
    sid: "thread-test-sms-1", channel: "sms", source: "twilio"
  }), db);

  const t = await threads();
  assert.equal(t.rows.length, 1, "an inbound text did not create a thread");
  assert.equal(t.rows[0].channel, "sms");
  assert.ok(t.rows[0].last_pulse_at, "the thread has no activity time");

  const m = await messagesOn(t.rows[0].id);
  assert.equal(m.rows.length, 1);
  assert.equal(m.rows[0].direction, "inbound");
  assert.equal(m.rows[0].rendered_body, "hi, are you there?");
  assert.equal(m.rows[0].subject, null, "an SMS has no subject and must not be given an empty one");
});

test("inbound sms: a second text joins the SAME thread, it does not mint another",
  { skip: !HAS_DB }, async () => {
  const before_ = (await threads()).rows.find((r) => r.channel === "sms");

  await onMessageInbound(event({
    from: PHONE, to: "+15551110000", body: "still waiting",
    sid: "thread-test-sms-2", channel: "sms", source: "twilio"
  }), db);

  const after_ = (await threads()).rows.filter((r) => r.channel === "sms");
  assert.equal(after_.length, 1, "a second text created a second sms thread — migration 057's whole point");
  assert.equal(after_[0].id, before_.id);

  const m = await messagesOn(after_[0].id);
  assert.equal(m.rows.length, 2, "the second message is not on the thread");
  assert.deepEqual(m.rows.map((x) => x.rendered_body), ["hi, are you there?", "still waiting"]);
});

test("inbound sms: a redelivery of the same message does not become a second message",
  { skip: !HAS_DB }, async () => {
  const sms = (await threads()).rows.find((r) => r.channel === "sms");
  const before_ = (await messagesOn(sms.id)).rows.length;

  await onMessageInbound(event({
    from: PHONE, to: "+15551110000", body: "still waiting",
    sid: "thread-test-sms-2", channel: "sms", source: "twilio"
  }), db);

  assert.equal((await messagesOn(sms.id)).rows.length, before_,
    "a redelivered webhook duplicated the client's message in the thread");
});

test("inbound email: a client's own reply lands on their email thread, subject and all",
  { skip: !HAS_DB }, async () => {
  await onMessageInbound(event({
    from: `mine_${EMAIL}`, to: "hello@fundhub.ai", body: "attached are the statements",
    subject: "Re: your file", sid: "thread-test-email-1", channel: "email", source: "mailgun"
  }, { clientId }), db);

  const email = (await threads()).rows.filter((r) => r.channel === "email");
  assert.equal(email.length, 1, "an inbound email did not create the client's email thread");

  const m = await messagesOn(email[0].id);
  assert.equal(m.rows.length, 1);
  assert.equal(m.rows[0].channel, "email");
  assert.equal(m.rows[0].direction, "inbound");
  assert.equal(m.rows[0].subject, "Re: your file",
    "an email's subject is often the only thing above the fold and it was dropped");

  // The sms thread is untouched — one thread per client per CHANNEL.
  const sms = (await threads()).rows.filter((r) => r.channel === "sms");
  assert.equal(sms.length, 1);
});

test("inbound email: a second email joins the same email thread", { skip: !HAS_DB }, async () => {
  await onMessageInbound(event({
    from: `mine_${EMAIL}`, to: "hello@fundhub.ai", body: "one more thing",
    subject: "Re: your file", sid: "thread-test-email-2", channel: "email", source: "mailgun"
  }, { clientId }), db);

  const email = (await threads()).rows.filter((r) => r.channel === "email");
  assert.equal(email.length, 1);
  assert.equal((await messagesOn(email[0].id)).rows.length, 2);
});

test("inbound: a message from a stranger is recorded but threads to nobody, and mints no client",
  { skip: !HAS_DB }, async () => {
  const clientsBefore = (await db.query(`SELECT count(*)::int AS n FROM clients WHERE org_id = $1`, [orgId])).rows[0].n;

  await onMessageInbound(event({
    from: "+15559998888", to: "+15551110000", body: "wrong number",
    sid: "thread-test-stranger", channel: "sms", source: "twilio"
  }), db);

  const row = (await db.query(
    `SELECT client_id, conversation_id FROM messages WHERE provider_ref = 'thread-test-stranger'`)).rows[0];
  assert.ok(row, "the message was lost — a message we cannot place is still a message we received");
  assert.equal(row.client_id, null);
  // conversations.client_id is NOT NULL, so there is no thread this could join.
  // Unthreaded is the honest state, not a bug.
  assert.equal(row.conversation_id, null);

  const clientsAfter = (await db.query(`SELECT count(*)::int AS n FROM clients WHERE org_id = $1`, [orgId])).rows[0].n;
  assert.equal(clientsAfter, clientsBefore, "an inbound message from an unknown number created a client — it could be spam");
});

test("inbound sms: STOP still records an opt-out, and the thread still gets the message",
  { skip: !HAS_DB }, async () => {
  await onMessageInbound(event({
    from: PHONE, to: "+15551110000", body: "STOP",
    sid: "thread-test-stop", channel: "sms", source: "twilio"
  }), db);

  const opt = await db.query(
    `SELECT 1 FROM opt_outs WHERE client_id = $1 AND channel = 'sms' AND opted_in_at IS NULL`, [clientId]);
  assert.equal(opt.rows.length, 1, "STOP did not record an opt-out");

  const sms = (await threads()).rows.find((r) => r.channel === "sms");
  const bodies = (await messagesOn(sms.id)).rows.map((x) => x.rendered_body);
  assert.ok(bodies.includes("STOP"), "the STOP itself is missing from the thread — it is what the client said");
});

/* ───────────────────── the adapter's half, no database ──────────────────── */

/* A stub that answers the two lookups handleMailgunWebhook makes and records
   what the bus was asked to emit. It models no table; it can only prove which
   event names were produced for which payload. */
function stubDb({ senderIsClient }) {
  const emitted = [];
  return {
    emitted,
    query: (sql, params) => {
      if (/INSERT INTO events/i.test(sql)) {
        emitted.push({ name: params[1], payload: params[5] });
        return Promise.resolve({ rows: [{ id: `evt-${emitted.length}` }] });
      }
      // The bus resolves the default org for any emit that names none —
      // mail.response does not, message.inbound does.
      if (/FROM orgs/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: "33333333-3333-4333-8333-333333333333" }] });
      }
      // resolveClientFromSender / resolveClientFromRecipient
      if (/FROM clients/i.test(sql)) {
        return Promise.resolve({
          rows: senderIsClient && /lower\(email\)/i.test(sql)
            ? [{ id: "11111111-1111-4111-8111-111111111111", org_id: "22222222-2222-4222-8222-222222222222" }]
            : []
        });
      }
      return Promise.resolve({ rows: [] });
    }
  };
}

/* Mailgun signs (timestamp + token) with the signing key. Building a real one
   keeps the adapter's fail-closed check in the path rather than around it. */
async function signedBody({ from, subject, text }) {
  const crypto = await import("node:crypto");
  const key = "mailgun-test-signing-key";
  const timestamp = "1700000000";
  const token = "t".repeat(50);
  const signature = crypto.createHmac("sha256", key).update(timestamp + token).digest("hex");
  return {
    key,
    body: {
      signature: { timestamp, token, signature },
      sender: from, subject, "body-plain": text,
      recipient: "monitor+11111111-1111-4111-8111-111111111111@fundhub.ai",
      "Message-Id": "<abc@mail.example.com>"
    }
  };
}

test("mailgun: an email from a client's own address emits message.inbound as well as mail.response", async () => {
  const { key, body } = await signedBody({
    from: "client@example.com", subject: "Re: my file", text: "here are the documents"
  });
  const fake = stubDb({ senderIsClient: true });
  const out = await handleMailgunWebhook({ db: fake, body, signingKey: key });

  assert.equal(out.ok, true);
  const names = out.emitted.map((e) => e.name);
  assert.ok(names.includes("message.inbound"), "a client's email produced no inbound message event");
  assert.ok(names.includes("mail.response"), "the existing bank-inbox path was replaced rather than added to");

  const inbound = fake.emitted.find((e) => e.name === "message.inbound");
  assert.equal(inbound.payload.channel, "email");
  assert.equal(inbound.payload.body, "here are the documents",
    "the client's own words were dropped — a thread with the messages missing is not a thread");
  assert.equal(inbound.payload.sid, "<abc@mail.example.com>",
    "no dedupe key: a Mailgun redelivery would become a second message in the thread");
});

test("mailgun: a bank's forwarded statement does NOT become a message in the client's thread", async () => {
  const { key, body } = await signedBody({
    from: "alerts@somebank.com", subject: "Your statement is ready", text: "your balance is $1,200"
  });
  const fake = stubDb({ senderIsClient: false });
  const out = await handleMailgunWebhook({ db: fake, body, signingKey: key });

  assert.equal(out.ok, true);
  const names = out.emitted.map((e) => e.name);
  assert.ok(names.includes("mail.response"), "the bank inbox path stopped working");
  assert.ok(!names.includes("message.inbound"),
    "a bank statement was threaded as though the client had written it");
});
