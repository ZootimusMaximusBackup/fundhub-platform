/* POST /api/webhooks/resend — end to end, through the real door.
 *
 * T5-16. The adapter has its own unit tests; this file exists to prove the
 * WIRING, which is the part that has shipped broken twice in this repo. It goes
 * through handleWebhook() exactly as api/webhooks/[provider].mjs does, and
 * asserts on the row in the database rather than on a return value — a handler
 * that answers 200 and moves nothing is the failure being guarded against.
 *
 * Until this branch existed, Resend was the live outbound email provider with
 * no webhook door at all, so `sent` was the last thing that ever happened to an
 * email: a bounce, a spam complaint and a confirmed delivery were
 * indistinguishable from inside the system.
 */
import { test, before, after } from "node:test";
import assert from "node:assert";
import { createHmac } from "node:crypto";
import { db, close } from "../db.mjs";
import { handleWebhook } from "./router.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ORG_SLUG = "t5-resend-webhook-test";
const SECRET = "whsec_" + Buffer.from("resend-endpoint-key-0123456789ab").toString("base64");
const ENV = { RESEND_WEBHOOK_SECRET: SECRET };
const RESEND_ID = "re_endtoend_0123456789";

let org = null;
let client = null;
let message = null;

before(async () => {
  if (!HAS_DB) return;
  await purge();
  org = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,'T5 Resend Webhook Test Co') RETURNING id`, [ORG_SLUG])).rows[0].id;
  client = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email)
     VALUES ($1,'Resend','Subject','resend.subject@example.com') RETURNING id`, [org])).rows[0].id;
  message = (await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body, provider,
                           provider_ref, provider_message_id, status)
     VALUES ($1,$2,'outbound','email','hello','resend',$3,$4,'sent') RETURNING id`,
    [org, client, `workflow:test:${RESEND_ID}`, RESEND_ID])).rows[0].id;
});

after(async () => { await purge(); await close(); });

async function purge() {
  if (!HAS_DB) return;
  const r = await db.query(`SELECT id FROM orgs WHERE slug = $1`, [ORG_SLUG]);
  const id = r.rows[0]?.id;
  if (!id) return;
  await db.query(`DELETE FROM opt_outs WHERE org_id = $1`, [id]);
  await db.query(`DELETE FROM messages WHERE org_id = $1`, [id]);
  await db.query(`DELETE FROM clients WHERE org_id = $1`, [id]);
  await db.query(`DELETE FROM orgs WHERE id = $1`, [id]);
}

/* Svix signs `<id>.<timestamp>.<rawBody>` byte for byte, which is why the raw
   string is what gets posted rather than a re-serialised object. */
function post(type, { secret = SECRET, at = Math.floor(Date.now() / 1000), id = "msg_e2e" } = {}) {
  const rawBody = JSON.stringify({
    type, data: { email_id: RESEND_ID, to: ["resend.subject@example.com"] }
  });
  const key = Buffer.from(String(secret).slice("whsec_".length), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${at}.${rawBody}`).digest("base64");
  return handleWebhook({
    db, provider: "resend", rawBody,
    headers: { "svix-id": id, "svix-timestamp": String(at), "svix-signature": `v1,${sig}` },
    env: ENV
  });
}

const statusOf = async () =>
  (await db.query(`SELECT status FROM messages WHERE id = $1`, [message])).rows[0].status;

test("the resend provider is routed at all — this is the failure that ships", { skip: !HAS_DB }, async () => {
  /* A handler with no branch answers 404 "unknown provider", and the receipts
     then pile up unseen at Resend's end. That has happened twice in this repo
     with other handlers, which is why it is asserted first and on its own. */
  const out = await post("email.delivered");
  assert.notEqual(out.status, 404, "POST /api/webhooks/resend is not routed");
});

test("a delivered receipt moves the message from sent to delivered", { skip: !HAS_DB }, async () => {
  // Reset explicitly: the routing test above already posted a real receipt, so
  // the row is not where `before` left it. Depending on test order for a
  // precondition is how a suite starts passing for the wrong reason.
  await db.query(`UPDATE messages SET status = 'sent' WHERE id = $1`, [message]);
  assert.equal(await statusOf(), "sent", "starts where the dispatcher left it");
  const out = await post("email.delivered");
  assert.equal(out.status, 200);
  assert.equal(await statusOf(), "delivered",
    "the whole point: accepted by the provider is not the same claim as arrived");
});

test("an unsigned receipt is refused and changes nothing", { skip: !HAS_DB }, async () => {
  const before = await statusOf();
  const out = await handleWebhook({
    db, provider: "resend",
    rawBody: JSON.stringify({ type: "email.bounced", data: { email_id: RESEND_ID } }),
    headers: {}, env: ENV
  });
  assert.equal(out.status, 401);
  assert.equal(await statusOf(), before, "a forged receipt must not mark a live message dead");
});

test("with no signing secret configured, everything is refused", { skip: !HAS_DB }, async () => {
  /* RESEND_WEBHOOK_SECRET is the named blocker. An endpoint that answered 200
     without it would look configured while proving nothing. */
  const out = await handleWebhook({
    db, provider: "resend",
    rawBody: JSON.stringify({ type: "email.delivered", data: { email_id: RESEND_ID } }),
    headers: {}, env: {}
  });
  assert.equal(out.status, 503);
  assert.equal(out.body.reason, "not_configured");
});

test("malformed JSON is a 400, not a crash", { skip: !HAS_DB }, async () => {
  const out = await handleWebhook({
    db, provider: "resend", rawBody: "{not json", headers: {}, env: ENV
  });
  assert.equal(out.status, 400);
  assert.equal(out.body.error, "invalid_json");
});

test("a spam complaint opts the client out of email and says so on the message",
  { skip: !HAS_DB }, async () => {
    const out = await post("email.complained");
    assert.equal(out.status, 200);
    assert.equal(out.body.optedOut, true);

    const rows = (await db.query(
      `SELECT channel, source, opted_in_at FROM opt_outs WHERE org_id = $1 AND client_id = $2`,
      [org, client])).rows;
    assert.equal(rows.length, 1, "exactly one opt-out, for exactly the client who complained");
    assert.equal(rows[0].channel, "email");
    assert.equal(rows[0].opted_in_at, null, "it has to be live to mean anything");
    assert.equal(rows[0].source, "provider_complaint_resend",
      "recorded apart from a Mailgun complaint and from the unsubscribe link");
    assert.equal(await statusOf(), "complained");
  });

test("an open does not erase the record that the mail arrived", { skip: !HAS_DB }, async () => {
  await db.query(`UPDATE messages SET status = 'delivered' WHERE id = $1`, [message]);
  const out = await post("email.opened");
  assert.equal(out.status, 200);
  assert.equal(await statusOf(), "delivered", "engagement tracking is not a delivery state");
});

test("a receipt for a message we do not have is acknowledged, not retried forever",
  { skip: !HAS_DB }, async () => {
    const rawBody = JSON.stringify({
      type: "email.delivered", data: { email_id: "re_no_such_message", to: ["nobody@example.com"] }
    });
    const at = Math.floor(Date.now() / 1000);
    const key = Buffer.from(SECRET.slice("whsec_".length), "base64");
    const sig = createHmac("sha256", key).update(`msg_x.${at}.${rawBody}`).digest("base64");
    const out = await handleWebhook({
      db, provider: "resend", rawBody,
      headers: { "svix-id": "msg_x", "svix-timestamp": String(at), "svix-signature": `v1,${sig}` },
      env: ENV
    });
    assert.equal(out.status, 200, "a 500 here makes Resend retry the same event indefinitely");
    assert.equal(out.body.reason, "unmatched");
  });
