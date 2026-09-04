// Delivery status callbacks — the CRM cutover Ticket 2.
//
// Lives under src/http/ and NOT under api/, because npm test globs only
// "src/**/*.test.mjs" and "scripts/**/*.test.mjs". A test file placed beside a
// handler never runs, and the suite stays green while proving nothing —
// CLAUDE.md §12 names this as a trap that has already cost time here.
//
// Everything below drives src/http/router.mjs's handleWebhook rather than the
// adapters directly. That is deliberate: the adapters could be perfect and the
// endpoints still unreachable, which is the OTHER §12 trap. Going through the
// router proves the provider ids `twilio-status` and `mailgun-events` actually
// resolve to these handlers.
//
// Two halves:
//
//   ALWAYS RUN — the signature contract. An unsigned or wrongly-signed callback
//   is rejected, and rejected BEFORE the database is touched. The `db` handed to
//   these throws on any query, so "no query was issued" is proved rather than
//   assumed.
//
//   DATABASE_URL ONLY — what the callbacks actually do to rows. Which row moved,
//   which rows did not, and whether a spam complaint produced an opt-out. These
//   are claims only a real schema can settle.

import { test, before, after } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { db, close } from "../db.mjs";
import { handleWebhook } from "./router.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

const MAILGUN_KEY = "mailgun_test_signing_key_not_a_real_secret";
const TWILIO_TOKEN = "twilio_test_auth_token_not_a_real_secret";
const URL_UNDER_TEST = "https://fundhub.test/api/webhooks/twilio-status";

const ORG_SLUG = "webhooks-status-pg-test-co";

/* ------------------------------------------------------------- signing ---- */

// Mailgun: hex HMAC-SHA256 over timestamp + token.
function mailgunSignature(timestamp, token, key = MAILGUN_KEY) {
  return crypto.createHmac("sha256", key).update(String(timestamp) + String(token)).digest("hex");
}

function mailgunBody(eventData, { sign = true, key = MAILGUN_KEY } = {}) {
  const timestamp = "1754006400";
  const token = "0123456789abcdef0123456789abcdef01234567";
  const body = { "event-data": eventData };
  if (sign) {
    body.signature = { timestamp, token, signature: mailgunSignature(timestamp, token, key) };
  }
  return JSON.stringify(body);
}

// Twilio: base64 HMAC-SHA1 over the full URL + sorted param key+value pairs.
function twilioSignature(url, params, token = TWILIO_TOKEN) {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + (params[k] ?? ""), url);
  return crypto.createHmac("sha1", token).update(data, "utf8").digest("base64");
}

function twilioCall(params, { sign = true, token = TWILIO_TOKEN } = {}) {
  const rawBody = new URLSearchParams(params).toString();
  const headers = sign ? { "x-twilio-signature": twilioSignature(URL_UNDER_TEST, params, token) } : {};
  return { rawBody, headers };
}

/* -------------------------------------------------------------- no DB ----- */

/* Answers nothing and refuses to be asked. Any query at all fails the test that
   used it, which is how "rejected before the database is touched" becomes an
   assertion instead of a claim in a comment. */
const forbiddenDb = () => ({
  query: () => { throw new Error("the database was queried on a request that should have been rejected"); }
});

const ENV = { MAILGUN_SIGNING_KEY: MAILGUN_KEY, TWILIO_AUTH_TOKEN: TWILIO_TOKEN };

test("mailgun-events: with a signing key set, an UNSIGNED request is REJECTED", async () => {
  /* THE BEHAVIOUR CHANGE THIS TICKET ASSERTS.
     The adapter used to wrap verification in `if (signingKey)`, so an unsigned
     payload from anyone at all was accepted and acted on. Nothing in the suite
     proved the fix, which meant nothing would notice it being undone. This is
     that proof: not "it did not crash" — a 401, an explicit bad_signature, and
     no database access whatsoever. */
  const body = JSON.stringify({
    "event-data": { event: "delivered", recipient: "nobody@example.com" }
  });
  const out = await handleWebhook({
    db: forbiddenDb(), provider: "mailgun-events", rawBody: body, headers: {}, env: ENV
  });

  assert.equal(out.status, 401, "an unsigned delivery event must be rejected, not accepted");
  assert.equal(out.body.ok, false);
  assert.equal(out.body.reason, "bad_signature");
  assert.equal(out.body.updated, 0, "nothing may be updated on a rejected request");
});

test("mailgun-events: with NO signing key configured, an unsigned request is STILL rejected", async () => {
  /* THIS is the assertion that catches the fail-open shape, and the test above
     is not — with a key set, even the buggy `if (signingKey)` version verifies.
     The bug only opens when the key is UNSET, which was the shipped
     configuration: .env.example carries it blank and DEPLOY.md lists it as
     "add later". So the forged-payload window was the default state, and a test
     that always sets the key would never have seen it.

     Found by deliberately reintroducing `if (signingKey)` and watching every
     other test in this file stay green. */
  const body = JSON.stringify({
    "event-data": { event: "complained", recipient: "victim@example.com" }
  });
  const out = await handleWebhook({
    db: forbiddenDb(), provider: "mailgun-events", rawBody: body, headers: {},
    env: { MAILGUN_SIGNING_KEY: undefined }
  });

  assert.equal(out.status, 401, "no key configured must mean reject everything, never accept everything");
  assert.equal(out.body.reason, "bad_signature");
  assert.notEqual(out.body.optedOut, true);
});

test("mailgun inbound: with NO signing key configured, an unsigned bank email is STILL rejected", async () => {
  // Same guard on the inbound path, which is where the original bug lived.
  const out = await handleWebhook({
    db: forbiddenDb(), provider: "mailgun", headers: {}, env: { MAILGUN_SIGNING_KEY: undefined },
    rawBody: JSON.stringify({ subject: "Approved", "body-plain": "congratulations" })
  });
  assert.equal(out.status, 401);
  assert.equal(out.body.reason, "bad_signature");
});

test("mailgun-events: a signature made with the WRONG key is rejected", async () => {
  const body = mailgunBody({ event: "delivered", recipient: "nobody@example.com" },
    { key: "a_different_key_entirely" });
  const out = await handleWebhook({
    db: forbiddenDb(), provider: "mailgun-events", rawBody: body, headers: {}, env: ENV
  });
  assert.equal(out.status, 401);
  assert.equal(out.body.reason, "bad_signature");
});

test("mailgun-events: a complaint arriving UNSIGNED is rejected and writes no opt-out", async () => {
  // The compliance-critical path is also the most attractive one to forge: an
  // unsigned complaint could otherwise opt a client out of email on a stranger's
  // say-so. forbiddenDb() proves recordOptOut never ran.
  const body = JSON.stringify({ "event-data": { event: "complained", recipient: "victim@example.com" } });
  const out = await handleWebhook({
    db: forbiddenDb(), provider: "mailgun-events", rawBody: body, headers: {}, env: ENV
  });
  assert.equal(out.status, 401);
  assert.notEqual(out.body.optedOut, true);
});

test("mailgun inbound: an unsigned bank email is still rejected", async () => {
  // The inbound path fails closed too. Asserted here so the two directions
  // cannot drift apart unnoticed.
  const out = await handleWebhook({
    db: forbiddenDb(), provider: "mailgun", env: ENV, headers: {},
    rawBody: JSON.stringify({ subject: "Approved", "body-plain": "congratulations" })
  });
  assert.equal(out.status, 401);
  assert.equal(out.body.reason, "bad_signature");
});

test("twilio-status: an UNSIGNED status callback is rejected before any query", async () => {
  const { rawBody, headers } = twilioCall(
    { MessageSid: "SMunsigned", MessageStatus: "delivered" }, { sign: false });
  const out = await handleWebhook({
    db: forbiddenDb(), provider: "twilio-status", rawBody, headers, url: URL_UNDER_TEST, env: ENV
  });
  assert.equal(out.status, 401);
  assert.equal(out.body.reason, "bad_signature");
  assert.equal(out.body.updated, 0);
});

test("twilio-status: a signature over a DIFFERENT body is rejected", async () => {
  // Twilio signs the parameters, so a replayed signature with the status swapped
  // must fail. Otherwise anyone who saw one callback could mark any message dead.
  const honest = twilioCall({ MessageSid: "SMreplay", MessageStatus: "sent" });
  const tampered = new URLSearchParams({ MessageSid: "SMreplay", MessageStatus: "failed" }).toString();
  const out = await handleWebhook({
    db: forbiddenDb(), provider: "twilio-status", rawBody: tampered,
    headers: honest.headers, url: URL_UNDER_TEST, env: ENV
  });
  assert.equal(out.status, 401);
});

test("router: the two delivery-status providers are reachable and are not the inbound ones", async () => {
  /* The §12 route trap, at the layer that actually decides. An unknown provider
     is a 404 here; these two must not be. If somebody deletes the router branch,
     these ids fall through to that 404 and this test says so — whereas a test
     that called the adapter directly would still pass. */
  for (const provider of ["twilio-status", "mailgun-events"]) {
    const out = await handleWebhook({
      db: forbiddenDb(), provider, rawBody: "{}", headers: {}, url: URL_UNDER_TEST, env: ENV
    });
    assert.notEqual(out.status, 404, `provider "${provider}" is not routed — it would 404 in production`);
  }
  const unknown = await handleWebhook({
    db: forbiddenDb(), provider: "twilio-statuses", rawBody: "{}", headers: {}, env: ENV
  });
  assert.equal(unknown.status, 404, "a near-miss provider id must not resolve to a real handler");
});

/* ------------------------------------------------------- DATABASE_URL ----- */

let org, client, otherClient;
let smsTarget, smsBystander, emailTarget, emailBystander;

async function purge() {
  if (!HAS_DB) return;
  const r = await db.query(`SELECT id FROM orgs WHERE slug = $1`, [ORG_SLUG]);
  const id = r.rows[0]?.id;
  if (!id) return;
  await db.query(`DELETE FROM tasks WHERE org_id = $1`, [id]);
  await db.query(`DELETE FROM opt_outs WHERE org_id = $1`, [id]);
  await db.query(`DELETE FROM messages WHERE org_id = $1`, [id]);
  await db.query(`DELETE FROM clients WHERE org_id = $1`, [id]);
  await db.query(`DELETE FROM orgs WHERE id = $1`, [id]);
}

const insertMessage = async (channel, providerMessageId, clientId, templateKey = null) => (await db.query(
  `INSERT INTO messages (org_id, client_id, direction, channel, status, provider, provider_ref, provider_message_id, template_key)
   VALUES ($1,$2,'outbound',$3,'sent',$4,$5,$6,$7) RETURNING id`,
  [org, clientId, channel, channel === "sms" ? "ghl_relay" : "mailgun",
   `workflow:test:${providerMessageId}`, providerMessageId, templateKey]
)).rows[0].id;

const statusOf = async (id) => (await db.query(`SELECT status FROM messages WHERE id = $1`, [id])).rows[0].status;

before(async () => {
  if (!HAS_DB) return;
  await purge();
  org = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,'Webhooks Status Test Co') RETURNING id`, [ORG_SLUG])).rows[0].id;
  client = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email)
     VALUES ($1,'Status','Subject','status.subject@example.com') RETURNING id`, [org])).rows[0].id;
  otherClient = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email)
     VALUES ($1,'Status','Bystander','status.bystander@example.com') RETURNING id`, [org])).rows[0].id;

  smsTarget = await insertMessage("sms", "SM00000000000000000000000000000001", client);
  smsBystander = await insertMessage("sms", "SM00000000000000000000000000000002", otherClient);
  emailTarget = await insertMessage("email", "20260801.1.aaaa@mg.fundhub.test", client, "n-03-hot-nurture-1");
  emailBystander = await insertMessage("email", "20260801.2.bbbb@mg.fundhub.test", otherClient);
});

after(async () => { await purge(); await close(); });

test("twilio-status: a delivered callback moves exactly that one row", { skip: !HAS_DB }, async () => {
  /* THE ACCEPTANCE BAR. Not "the row is delivered" — that passes even if the
     UPDATE had no WHERE clause at all and moved every message in the table.
     The bystander rows are asserted unchanged for exactly that reason. */
  const before = { bystander: await statusOf(smsBystander), email: await statusOf(emailTarget) };

  const { rawBody, headers } = twilioCall({
    MessageSid: "SM00000000000000000000000000000001", MessageStatus: "delivered"
  });
  const out = await handleWebhook({
    db, provider: "twilio-status", rawBody, headers, url: URL_UNDER_TEST, env: ENV
  });

  assert.equal(out.status, 200);
  assert.equal(out.body.updated, 1, "exactly one row must move — no more and no fewer");
  assert.equal(await statusOf(smsTarget), "delivered");
  assert.equal(await statusOf(smsBystander), before.bystander, "another client's SMS must not move");
  assert.equal(await statusOf(emailTarget), before.email, "an email row must not move on an SMS callback");
});

test("twilio-status: a failed callback records the carrier error on that row only", { skip: !HAS_DB }, async () => {
  const { rawBody, headers } = twilioCall({
    MessageSid: "SM00000000000000000000000000000002",
    MessageStatus: "undelivered", ErrorCode: "30003"
  });
  const out = await handleWebhook({
    db, provider: "twilio-status", rawBody, headers, url: URL_UNDER_TEST, env: ENV
  });

  assert.equal(out.body.updated, 1);
  const row = (await db.query(
    `SELECT status, last_error FROM messages WHERE id = $1`, [smsBystander])).rows[0];
  assert.equal(row.status, "failed");
  assert.match(row.last_error, /30003/, "the operator needs the carrier's reason, not just a status");
});

test("twilio-status: an in-flight callback moves nothing", { skip: !HAS_DB }, async () => {
  // A late `sending` must never overwrite the `delivered` that already landed.
  const { rawBody, headers } = twilioCall({
    MessageSid: "SM00000000000000000000000000000001", MessageStatus: "sending"
  });
  const out = await handleWebhook({
    db, provider: "twilio-status", rawBody, headers, url: URL_UNDER_TEST, env: ENV
  });
  assert.equal(out.body.updated, 0);
  assert.equal(await statusOf(smsTarget), "delivered", "the delivered state must survive a late in-flight callback");
});

test("twilio-status: a receipt for an unknown message is acknowledged but reported unmatched",
  { skip: !HAS_DB }, async () => {
    const { rawBody, headers } = twilioCall({ MessageSid: "SMneverseenbefore", MessageStatus: "delivered" });
    const out = await handleWebhook({
      db, provider: "twilio-status", rawBody, headers, url: URL_UNDER_TEST, env: ENV
    });
    assert.equal(out.status, 200, "Twilio must not be left retrying forever");
    assert.equal(out.body.reason, "unmatched", "but it must not be reported as a success either");
  });

test("mailgun-events: a complained event writes an opt-out for that client on the email channel",
  { skip: !HAS_DB }, async () => {
    /* THE COMPLIANCE ACCEPTANCE BAR. A spam complaint is a withdrawal of
       consent, so the test asserts the opt-out row itself — the channel, the
       client, and that it is LIVE (opted_in_at IS NULL). A test that only
       checked the message status would pass while the obligation was dropped. */
    const rawBody = mailgunBody({
      event: "complained",
      recipient: "status.subject@example.com",
      message: { headers: { "message-id": "<20260801.1.aaaa@mg.fundhub.test>" } }
    });
    const out = await handleWebhook({ db, provider: "mailgun-events", rawBody, headers: {}, env: ENV });

    assert.equal(out.status, 200);
    assert.equal(out.body.optedOut, true);

    const rows = (await db.query(
      `SELECT client_id, channel, opted_in_at, source FROM opt_outs WHERE org_id = $1`, [org])).rows;
    assert.equal(rows.length, 1, "exactly one opt-out, for exactly the client who complained");
    assert.equal(rows[0].client_id, client);
    assert.equal(rows[0].channel, "email");
    assert.equal(rows[0].opted_in_at, null, "the opt-out must be live, not already reversed");

    assert.equal(await statusOf(emailTarget), "complained");
    assert.notEqual(await statusOf(emailBystander), "complained", "no other client is opted out by this");
  });

test("mailgun-events: a complaint raises a task naming the template that drew it",
  { skip: !HAS_DB }, async () => {
    /* A complaint is a signal about the COPY, not only about one recipient.
       Opting the person out and telling nobody treats it as a lost contact,
       when the same template is about to be sent to the next hundred people.
       The task is the part a human ever sees. */
    const rows = (await db.query(
      `SELECT title, assignee_role, source_workflow, body FROM tasks WHERE org_id = $1`, [org])).rows;

    assert.equal(rows.length, 1, "one complaint, one task");
    assert.match(rows[0].title, /spam complaint/i);
    assert.equal(rows[0].assignee_role, "admin", "a task with no owning role reaches nobody");
    assert.equal(rows[0].source_workflow, "mailgun-complaint");
    assert.match(rows[0].body, /20260801\.1\.aaaa@mg\.fundhub\.test/,
      "the dedupe key is the provider message id, so a retry cannot double-file");
  });

test("mailgun-events: Mailgun retrying the same complaint files one task, not two",
  { skip: !HAS_DB }, async () => {
    // Providers retry until they get a 200. A second identical complaint must
    // not produce a second task, or one bad template becomes an inbox flood.
    const rawBody = mailgunBody({
      event: "complained",
      recipient: "status.subject@example.com",
      message: { headers: { "message-id": "<20260801.1.aaaa@mg.fundhub.test>" } }
    });
    await handleWebhook({ db, provider: "mailgun-events", rawBody, headers: {}, env: ENV });

    const n = (await db.query(`SELECT count(*)::int AS c FROM tasks WHERE org_id = $1`, [org])).rows[0].c;
    assert.equal(n, 1, "a retried complaint must dedupe to the one task");

    const outs = (await db.query(`SELECT count(*)::int AS c FROM opt_outs WHERE org_id = $1`, [org])).rows[0].c;
    assert.equal(outs, 1, "and must not stack opt-out rows either");
  });

test("mailgun-events: the angle brackets on a message id do not stop it matching",
  { skip: !HAS_DB }, async () => {
    // Mailgun returns the id wrapped in <> on send and bare in the event payload.
    // Whichever form got stored, the receipt still has to find the row.
    const rawBody = mailgunBody({
      event: "delivered",
      recipient: "status.bystander@example.com",
      message: { headers: { "message-id": "20260801.2.bbbb@mg.fundhub.test" } }
    });
    const out = await handleWebhook({ db, provider: "mailgun-events", rawBody, headers: {}, env: ENV });
    assert.equal(out.body.updated, 1);
    assert.equal(await statusOf(emailBystander), "delivered");
  });

test("mailgun-events: a permanent failure is bounced, a temporary one is only failed",
  { skip: !HAS_DB }, async () => {
    /* The two must not collapse into one status. A hard bounce means never send
       to this address again; a temporary one means try later. Treating a
       temporary failure as permanent silently loses a client's mail. */
    const hard = await insertMessage("email", "20260801.3.cccc@mg.fundhub.test", client);
    const soft = await insertMessage("email", "20260801.4.dddd@mg.fundhub.test", client);

    await handleWebhook({
      db, provider: "mailgun-events", headers: {}, env: ENV,
      rawBody: mailgunBody({
        event: "failed", severity: "permanent", recipient: "status.subject@example.com",
        message: { headers: { "message-id": "20260801.3.cccc@mg.fundhub.test" } },
        "delivery-status": { code: 550, message: "No such mailbox" }
      })
    });
    await handleWebhook({
      db, provider: "mailgun-events", headers: {}, env: ENV,
      rawBody: mailgunBody({
        event: "failed", severity: "temporary", recipient: "status.subject@example.com",
        message: { headers: { "message-id": "20260801.4.dddd@mg.fundhub.test" } },
        "delivery-status": { code: 421, message: "Try again later" }
      })
    });

    assert.equal(await statusOf(hard), "bounced");
    assert.equal(await statusOf(soft), "failed");
  });

test("mailgun-events: an opened event changes no delivery state", { skip: !HAS_DB }, async () => {
  // Engagement tracking must not overwrite the record that the mail arrived.
  const rawBody = mailgunBody({
    event: "opened",
    recipient: "status.bystander@example.com",
    message: { headers: { "message-id": "20260801.2.bbbb@mg.fundhub.test" } }
  });
  const out = await handleWebhook({ db, provider: "mailgun-events", rawBody, headers: {}, env: ENV });
  assert.equal(out.body.updated, 0);
  assert.equal(await statusOf(emailBystander), "delivered", "an open must not erase the delivered state");
});

test("mailgun inbound: a delivery event sent to the INBOUND url is routed, not classified as a bank email",
  { skip: !HAS_DB }, async () => {
    /* The routing fix in the adapter. Mailgun can be configured to post delivery
       events at the inbound address, and this adapter used to score them as
       NOISE and emit them onto the bus as a real `mail.response`. Spam
       complaints were the quietest casualty of that, because NOISE is the
       classification nothing reacts to. */
    const msg = await insertMessage("email", "20260801.5.eeee@mg.fundhub.test", client);
    const rawBody = mailgunBody({
      event: "delivered",
      recipient: "status.subject@example.com",
      message: { headers: { "message-id": "20260801.5.eeee@mg.fundhub.test" } }
    });
    const out = await handleWebhook({ db, provider: "mailgun", rawBody, headers: {}, env: ENV });

    assert.equal(out.status, 200);
    assert.equal(await statusOf(msg), "delivered", "the inbound url must hand a delivery event to the delivery path");
    assert.ok(!out.body.emitted?.length, "a delivery receipt is not a bank email and must emit no mail.response");
  });

/* ── T5-02 · the provider's own unsubscribe signal ─────────────────────────
   Until 2026-08-18 "unsubscribed" sat in IGNORED_DELIVERY_EVENTS, so the
   system's behaviour was backwards: a spam complaint — the angrier, weaker
   signal — stopped the mail, and a deliberate press of the unsubscribe button
   was thrown away. These run LAST on purpose. Earlier tests in this file
   assert org-wide counts of opt_outs and tasks, and an opt-out written before
   them would make those assertions lie. */

test("mailgun-events: an UNSUBSCRIBED event opts the client out of email",
  { skip: !HAS_DB }, async () => {
    const rawBody = mailgunBody({
      event: "unsubscribed",
      recipient: "status.bystander@example.com",
      message: { headers: { "message-id": "20260801.2.bbbb@mg.fundhub.test" } }
    });
    const out = await handleWebhook({ db, provider: "mailgun-events", rawBody, headers: {}, env: ENV });

    assert.equal(out.status, 200);
    assert.equal(out.body.optedOut, true, "the whole point of the event");
    assert.equal(out.body.reason, "unsubscribed");

    const rows = (await db.query(
      `SELECT channel, opted_in_at, source FROM opt_outs WHERE org_id = $1 AND client_id = $2`,
      [org, otherClient])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].channel, "email");
    assert.equal(rows[0].opted_in_at, null, "the opt-out must be live");
    assert.equal(rows[0].source, "provider_unsubscribe",
      "filed apart from a spam complaint — an operator has to be able to tell them apart");
  });

test("mailgun-events: an unsubscribe does NOT overwrite the delivered state",
  { skip: !HAS_DB }, async () => {
    /* An unsubscribe is not a delivery state. The mail arrived — that is how
       they saw the link. Writing it onto messages.status would destroy the only
       record that it landed, which is the same reason `opened` is ignored. */
    assert.equal(await statusOf(emailBystander), "delivered");
  });

test("mailgun-events: an unsubscribe raises no review task",
  { skip: !HAS_DB }, async () => {
    /* A spam complaint is a signal about the COPY and a person must read it.
       An unsubscribe is the ordinary, wanted outcome of the link we are obliged
       to put in the mail. One task per unsubscribe would bury the complaints. */
    const n = (await db.query(
      `SELECT count(*)::int AS c FROM tasks WHERE org_id = $1`, [org])).rows[0].c;
    assert.equal(n, 1, "still only the one complaint task from earlier in this file");
  });

test("mailgun-events: an unsubscribe for an address we do not know is acknowledged, not acted on",
  { skip: !HAS_DB }, async () => {
    const rawBody = mailgunBody({
      event: "unsubscribed",
      recipient: "nobody-here@example.com",
      message: { headers: { "message-id": "no-such-message@mg.fundhub.test" } }
    });
    const out = await handleWebhook({ db, provider: "mailgun-events", rawBody, headers: {}, env: ENV });
    assert.equal(out.status, 200, "Mailgun must not be left retrying forever");
    assert.equal(out.body.reason, "unmatched");
    assert.equal(out.body.optedOut, false, "there is no client to opt out and inventing one is worse");
  });

test("mailgun-events: an UNSIGNED unsubscribe is rejected before it touches the database", async () => {
  // Same bar as the complaint path. A forged unsubscribe would silence a
  // client's mail, so it must be refused on the signature, not on trust.
  const body = mailgunBody(
    { event: "unsubscribed", recipient: "status.subject@example.com" },
    { sign: false }
  );
  const out = await handleWebhook({
    db: forbiddenDb(), provider: "mailgun-events", rawBody: body, headers: {}, env: ENV
  });
  assert.equal(out.status, 401);
  assert.equal(out.body.reason, "bad_signature");
});
