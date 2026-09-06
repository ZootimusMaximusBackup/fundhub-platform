// /api/push/* against a REAL Postgres.
//
// WHY A REAL DATABASE. Three of the four claims this feature makes are claims
// about stored rows, and a fake cannot fail the way a wrong column name fails:
//
//   · the endpoint and both keys are CIPHERTEXT in the table, not text
//   · one client can never register against, read, or retire another client's
//     device — and the reason is that there is no client_id parameter, which is
//     only true if the handler really reads the session
//   · a push service answering 410 retires the row, in the same pass, so a dead
//     phone is not retried forever
//
// IT LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test glob is
// "src/**" and "scripts/**"; a test under api/ is never collected and passes
// forever by never running (CLAUDE.md §12).
//
// Run live:
//   DATABASE_URL=postgres://... node db/migrate.mjs
//   DATABASE_URL=postgres://... node --test src/http/push-endpoints.pg.test.mjs

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createAccountSession } from "../auth/account-session.mjs";
import { createSession } from "../auth/session.mjs";
import { b64u, generateVapidKeys } from "../push/crypto.mjs";
import { listLiveSubscriptions, encryptField, endpointHash } from "../push/store.mjs";
import { sendToClient } from "../push/send.mjs";
import subscribeHandler from "../../api/push/subscribe.mjs";
import unsubscribeHandler from "../../api/push/unsubscribe.mjs";
import keyHandler from "../../api/push/key.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const CLIENT_EMAIL_LIKE = "push.pg.test.%@example.com";
const ACCT_EMAIL_LIKE = "push_pg_test_%@example.com";
const STAFF_EMAIL = "push_pg_test_staff@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

/** A subscription with real curve points, so a refusal can never be a crypto
    accident. The endpoint carries a random tail so two clients never collide. */
function browserSubscription(tag) {
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  return {
    endpoint: `https://updates.push.services.mozilla.com/wpush/v2/pg-test-${tag}-${crypto.randomBytes(6).toString("hex")}`,
    keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(crypto.randomBytes(16)) }
  };
}

describe("/api/push/* (real postgres)", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, staffToken;
  const A = {};      // one client
  const B = {};      // a different client, same org
  let savedEncKey, savedVapid;

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE])).rows.map((r) => r.id);
    if (ids.length) {
      await db.query(`DELETE FROM client_push_subscriptions WHERE client_id = ANY($1)`, [ids]);
      await db.query(
        `DELETE FROM account_sessions WHERE account_id IN (SELECT id FROM accounts WHERE client_id = ANY($1))`, [ids]);
      await db.query(`DELETE FROM accounts WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(
      `DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email = $1)`, [STAFF_EMAIL]);
    await db.query(`DELETE FROM staff WHERE email = $1`, [STAFF_EMAIL]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [ACCT_EMAIL_LIKE]);
  }

  async function makeClient(slot, name) {
    const id = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, custom_fields)
       VALUES ($1,$2,'Push',$3,'{}'::jsonb) RETURNING id`,
      [org, name, `push.pg.test.${name}@example.com`]
    )).rows[0].id;
    const accountId = (await db.query(
      `INSERT INTO accounts (org_id, kind, email, name, status, client_id, password_hash)
       VALUES ($1,'client',$2,$3,'active',$4,'scrypt$placeholder') RETURNING id`,
      [org, `push_pg_test_${name}@example.com`, name, id]
    )).rows[0].id;
    slot.id = id;
    slot.accountId = accountId;
    slot.token = (await createAccountSession(db, { accountId, orgId: org })).token;
  }

  before(async () => {
    if (!HAVE_DB) return;
    org = await resolveDefaultOrg(db);
    await purge();
    await makeClient(A, "aaa");
    await makeClient(B, "bbb");

    const staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Push Test Staff','owner',$2,'active') RETURNING id`,
      [org, STAFF_EMAIL]
    )).rows[0].id;
    staffToken = (await createSession(db, { staffId, orgId: org })).token;

    // The handlers read process.env directly, the same way every other endpoint
    // in this repository does. Saved and restored in after() so a run of the
    // whole suite in one process cannot inherit these.
    savedEncKey = process.env.PUSH_SUB_ENC_KEY;
    savedVapid = {
      pub: process.env.VAPID_PUBLIC_KEY,
      priv: process.env.VAPID_PRIVATE_KEY,
      sub: process.env.VAPID_SUBJECT
    };
    process.env.PUSH_SUB_ENC_KEY = crypto.randomBytes(32).toString("base64");
    const vapid = generateVapidKeys();
    process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
    process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
    process.env.VAPID_SUBJECT = "mailto:support@fundhub.ai";
  });

  after(async () => {
    if (!HAVE_DB) return;
    await purge();
    if (savedEncKey === undefined) delete process.env.PUSH_SUB_ENC_KEY;
    else process.env.PUSH_SUB_ENC_KEY = savedEncKey;
    for (const [k, v] of [["VAPID_PUBLIC_KEY", savedVapid.pub], ["VAPID_PRIVATE_KEY", savedVapid.priv], ["VAPID_SUBJECT", savedVapid.sub]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await close();
  });

  const call = async (handler, { method = "POST", body, query = {}, token } = {}) => {
    const r = res();
    await handler({ method, query, body, headers: token ? { authorization: "Bearer " + token } : {} }, r);
    return r;
  };

  const liveRows = async (clientId) => (await db.query(
    `SELECT * FROM client_push_subscriptions
      WHERE client_id = $1 AND expired_at IS NULL AND revoked_at IS NULL`, [clientId])).rows;

  /* ── registering ──────────────────────────────────────────────────────── */

  test("a client registers their phone and the row is ciphertext, not text", async () => {
    const sub = browserSubscription("a1");
    const r = await call(subscribeHandler, {
      token: A.token, body: { subscription: sub, device_label: "iphone" }
    });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    assert.equal(r.body.created, true);
    assert.equal(r.body.count, 1);

    const rows = await liveRows(A.id);
    assert.equal(rows.length, 1);
    const row = rows[0];

    // THE CLAIM: nothing readable is on disk. Search the whole row's text.
    const asText = JSON.stringify(row);
    assert.equal(asText.includes(sub.endpoint), false, "the endpoint is stored in the clear");
    assert.equal(asText.includes(sub.keys.p256dh), false, "the p256dh key is stored in the clear");
    assert.equal(asText.includes(sub.keys.auth), false, "the auth secret is stored in the clear");
    assert.match(row.encrypted_endpoint, /^v1:/);
    assert.equal(row.endpoint_hash, endpointHash(sub.endpoint));
    assert.equal(row.device_label, "iphone");
    // NULL means "never successfully sent to" and must survive as NULL.
    assert.equal(row.last_success_at, null);

    // And it decrypts back to exactly what the browser handed over.
    const live = await listLiveSubscriptions(db, { orgId: org, clientId: A.id });
    assert.equal(live.length, 1);
    assert.equal(live[0].endpoint, sub.endpoint);
    assert.equal(live[0].keys.p256dh, sub.keys.p256dh);
    assert.equal(live[0].keys.auth, sub.keys.auth);

    A.sub = sub;
  });

  test("the response carries no credential back to the browser", async () => {
    const r = await call(subscribeHandler, { method: "GET", token: A.token });
    assert.equal(r.code, 200);
    const asText = JSON.stringify(r.body);
    assert.equal(asText.includes(A.sub.endpoint), false);
    assert.equal(asText.includes(A.sub.keys.auth), false);
    assert.equal(asText.includes("endpoint"), false, "the read leaks an endpoint field");
    assert.equal(r.body.devices.length, 1);
    assert.equal(r.body.devices[0].last_success_at, null);
  });

  test("re-registering the same device updates it instead of making a second row", async () => {
    // A browser mints a fresh subscription whenever permission is re-granted.
    // Same endpoint, new keys, is the ordinary case and must not duplicate.
    const again = { endpoint: A.sub.endpoint, keys: browserSubscription("a1b").keys };
    const r = await call(subscribeHandler, { token: A.token, body: { subscription: again } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.created, false);
    assert.equal(r.body.count, 1);

    const live = await listLiveSubscriptions(db, { orgId: org, clientId: A.id });
    assert.equal(live.length, 1);
    assert.equal(live[0].keys.p256dh, again.keys.p256dh, "the new keys were not stored");
    A.sub = again;
  });

  test("a second device is a second row — a person has more than one screen", async () => {
    const laptop = browserSubscription("a2");
    const r = await call(subscribeHandler, { token: A.token, body: { subscription: laptop, device_label: "desktop" } });
    assert.equal(r.code, 201);
    assert.equal(r.body.count, 2);
    A.laptop = laptop;
  });

  test("a malformed subscription is refused and nothing is written", async () => {
    const before = (await liveRows(A.id)).length;
    for (const bad of [
      { endpoint: "http://not-https.example/x", keys: { p256dh: b64u(Buffer.alloc(65, 4)), auth: b64u(Buffer.alloc(16)) } },
      { endpoint: "https://push.example/x", keys: { p256dh: "short", auth: b64u(Buffer.alloc(16)) } },
      { endpoint: "https://push.example/x", keys: { p256dh: b64u(Buffer.alloc(65, 4)), auth: "tooshort" } },
      { keys: { p256dh: b64u(Buffer.alloc(65, 4)), auth: b64u(Buffer.alloc(16)) } }
    ]) {
      const r = await call(subscribeHandler, { token: A.token, body: { subscription: bad } });
      assert.equal(r.code, 400, JSON.stringify(r.body));
      assert.equal(r.body.error, "invalid_subscription");
    }
    assert.equal((await liveRows(A.id)).length, before);
  });

  /* ── one client can never touch another's ────────────────────────────── */

  test("client B sees only their own devices, never client A's", async () => {
    const r = await call(subscribeHandler, { method: "GET", token: B.token });
    assert.equal(r.code, 200);
    assert.equal(r.body.count, 0, "client B was shown somebody else's device");
  });

  test("a client_id supplied by the caller is ignored — the session decides", async () => {
    // The whole access rule is that there IS no client_id parameter. This proves
    // it by supplying one in every place a handler might read it.
    const sub = browserSubscription("b1");
    const r = await call(subscribeHandler, {
      token: B.token,
      query: { client_id: A.id },
      body: { subscription: sub, client_id: A.id, clientId: A.id, org_id: org }
    });
    assert.equal(r.code, 201, JSON.stringify(r.body));

    const rows = await db.query(
      `SELECT client_id FROM client_push_subscriptions WHERE endpoint_hash = $1`, [endpointHash(sub.endpoint)]);
    assert.equal(rows.rows.length, 1);
    assert.equal(String(rows.rows[0].client_id), String(B.id), "the row landed on the wrong client");
    assert.equal((await liveRows(A.id)).length, 2, "client A's devices changed");
    B.sub = sub;
  });

  test("client B cannot retire client A's device, even holding A's endpoint", async () => {
    const before = (await liveRows(A.id)).length;
    const r = await call(unsubscribeHandler, { token: B.token, body: { endpoint: A.sub.endpoint } });
    assert.equal(r.code, 200);
    assert.equal(r.body.retired, 0, "client B retired somebody else's device");
    assert.equal((await liveRows(A.id)).length, before, "client A lost a device");
  });

  test("client B cannot read client A's device list through any parameter", async () => {
    const r = await call(subscribeHandler, { method: "GET", token: B.token, query: { client_id: A.id } });
    assert.equal(r.code, 200);
    assert.equal(r.body.count, 1, "client B was shown client A's list");
  });

  test("a staff token is refused outright — registering a phone is not a support action", async () => {
    for (const [handler, opts] of [
      [subscribeHandler, { method: "GET", token: staffToken }],
      [subscribeHandler, { token: staffToken, body: { subscription: browserSubscription("s1") } }],
      [unsubscribeHandler, { token: staffToken, body: { all: true } }],
      [keyHandler, { method: "GET", token: staffToken }]
    ]) {
      const r = await call(handler, opts);
      assert.equal(r.code, 403, `a staff token got ${r.code} from a client-only route`);
    }
  });

  test("no session at all is 401 on every route", async () => {
    for (const [handler, opts] of [
      [subscribeHandler, { method: "GET" }],
      [subscribeHandler, { body: { subscription: browserSubscription("x") } }],
      [unsubscribeHandler, { body: { all: true } }],
      [keyHandler, { method: "GET" }]
    ]) {
      const r = await call(handler, opts);
      assert.equal(r.code, 401);
    }
  });

  /* ── the client turning it off ───────────────────────────────────────── */

  test("a client retires one device and keeps the other", async () => {
    const r = await call(unsubscribeHandler, { token: A.token, body: { endpoint: A.laptop.endpoint } });
    assert.equal(r.code, 200);
    assert.equal(r.body.retired, 1);
    assert.equal(r.body.count, 1);

    const rows = await db.query(
      `SELECT revoked_at, expired_at FROM client_push_subscriptions WHERE endpoint_hash = $1`,
      [endpointHash(A.laptop.endpoint)]);
    // Retired, not deleted, and NOT marked expired — the two are different facts.
    assert.ok(rows.rows[0].revoked_at, "revoked_at was not stamped");
    assert.equal(rows.rows[0].expired_at, null);
  });

  test("retiring the same device twice is a success, not an error", async () => {
    const r = await call(unsubscribeHandler, { token: A.token, body: { endpoint: A.laptop.endpoint } });
    assert.equal(r.code, 200);
    assert.equal(r.body.retired, 0);
  });

  test("a retired device frees the slot, so the same phone can come back", async () => {
    const r = await call(subscribeHandler, { token: A.token, body: { subscription: A.laptop } });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    assert.equal(r.body.count, 2);
    // and clean up so the send tests below have a known count
    await call(unsubscribeHandler, { token: A.token, body: { endpoint: A.laptop.endpoint } });
  });

  test("unsubscribe with neither an endpoint nor all:true does nothing", async () => {
    const before = (await liveRows(A.id)).length;
    const r = await call(unsubscribeHandler, { token: A.token, body: {} });
    assert.equal(r.code, 400);
    assert.equal((await liveRows(A.id)).length, before);
  });

  /* ── the key endpoint ────────────────────────────────────────────────── */

  test("the client is handed the public key and never the private one", async () => {
    const r = await call(keyHandler, { method: "GET", token: A.token });
    assert.equal(r.code, 200);
    assert.equal(r.body.configured, true);
    assert.equal(r.body.public_key, process.env.VAPID_PUBLIC_KEY);
    assert.equal(JSON.stringify(r.body).includes(process.env.VAPID_PRIVATE_KEY), false,
      "the private key reached the browser");
  });

  test("with no VAPID key configured the screen is told so rather than offered a dead button", async () => {
    const saved = process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    try {
      const r = await call(keyHandler, { method: "GET", token: A.token });
      assert.equal(r.code, 200);
      assert.equal(r.body.configured, false);
      assert.equal(r.body.public_key, null);
    } finally { process.env.VAPID_PRIVATE_KEY = saved; }
  });

  test("with no encryption key, registering is refused rather than stored in the clear", async () => {
    const saved = process.env.PUSH_SUB_ENC_KEY;
    delete process.env.PUSH_SUB_ENC_KEY;
    try {
      const r = await call(subscribeHandler, { token: A.token, body: { subscription: browserSubscription("noKey") } });
      assert.equal(r.code, 503);
      assert.equal(r.body.error, "push_storage_unconfigured");
    } finally { process.env.PUSH_SUB_ENC_KEY = saved; }
  });

  /* ── sending, and what happens to a dead endpoint ────────────────────── */

  test("a push service answering 410 retires the row in the same pass", async () => {
    const before = await liveRows(A.id);
    assert.equal(before.length, 1, "expected exactly one live device for this test");

    const out = await sendToClient(db, {
      orgId: org, clientId: A.id,
      notification: { kind: "payment_due" },
      env: { ...process.env, MESSAGING_DRY_RUN: "0" },
      fetchImpl: async () => new Response("", { status: 410 })
    });

    assert.equal(out.attempted, 1);
    assert.equal(out.expired, 1);
    assert.equal(out.sent, 0);
    assert.equal((await liveRows(A.id)).length, 0, "the dead endpoint is still live");

    const row = (await db.query(
      `SELECT expired_at, revoked_at FROM client_push_subscriptions WHERE endpoint_hash = $1`,
      [endpointHash(A.sub.endpoint)])).rows[0];
    assert.ok(row.expired_at, "expired_at was not stamped");
    assert.equal(row.revoked_at, null, "a dead phone is not the client asking us to stop");
  });

  test("a client with no device on file is an honest answer, not an error", async () => {
    const out = await sendToClient(db, {
      orgId: org, clientId: A.id,
      notification: { kind: "update" },
      env: { ...process.env, MESSAGING_DRY_RUN: "0" },
      fetchImpl: async () => { throw new Error("nothing should have been sent"); }
    });
    assert.equal(out.attempted, 0);
    assert.equal(out.reason, "no_subscription_on_file");
  });

  test("a successful send stamps last_success_at and clears the failure count", async () => {
    const out = await sendToClient(db, {
      orgId: org, clientId: B.id,
      notification: { kind: "check_in" },
      env: { ...process.env, MESSAGING_DRY_RUN: "0" },
      fetchImpl: async () => new Response("", { status: 201 })
    });
    assert.equal(out.sent, 1, JSON.stringify(out.results));
    const row = (await liveRows(B.id))[0];
    assert.ok(row.last_success_at, "last_success_at was not stamped");
    assert.equal(row.failure_count, 0);
  });

  test("a push service having a bad hour counts a failure and keeps the row", async () => {
    const out = await sendToClient(db, {
      orgId: org, clientId: B.id,
      notification: { kind: "update" },
      env: { ...process.env, MESSAGING_DRY_RUN: "0" },
      fetchImpl: async () => new Response("", { status: 503 })
    });
    assert.equal(out.failed, 1);
    const row = (await liveRows(B.id))[0];
    assert.equal(row.failure_count, 1);
    assert.ok(row.last_success_at, "a temporary failure must not erase the last success");
  });

  test("banned content is refused before the network, even from the send path", async () => {
    let called = 0;
    const out = await sendToClient(db, {
      orgId: org, clientId: B.id,
      notification: { kind: "payment_due", body: "Your $4,200 Amex payment is due Friday." },
      env: { ...process.env, MESSAGING_DRY_RUN: "0" },
      fetchImpl: async () => { called += 1; return new Response("", { status: 201 }); }
    });
    assert.equal(called, 0, "the push service was called with banned content");
    assert.equal(out.sent, 0);
    assert.equal(out.failed, 1);
    assert.match(out.results[0].error, /locked screen/);
  });

  /* ── the at-rest binding ─────────────────────────────────────────────── */

  test("a ciphertext copied into another client's row does not decrypt", async () => {
    // THE ONE THING THE DATABASE CANNOT CHECK FOR ITSELF. A bad backfill or a
    // mis-joined UPDATE would otherwise hand one client a working endpoint for
    // another person's phone, and every downstream check would pass.
    const victim = (await liveRows(B.id))[0];
    const stolen = victim.encrypted_endpoint;

    const foreignId = crypto.randomUUID();
    await db.query(
      `INSERT INTO client_push_subscriptions
         (id, org_id, client_id, endpoint_hash, encrypted_endpoint, encrypted_p256dh, encrypted_auth)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [foreignId, org, A.id, endpointHash("https://push.example/stolen"),
        stolen, victim.encrypted_p256dh, victim.encrypted_auth]
    );

    // listLiveSubscriptions skips a row it cannot decrypt rather than throwing,
    // so one bad row cannot cost a client their other phones.
    const live = await listLiveSubscriptions(db, { orgId: org, clientId: A.id });
    assert.equal(live.length, 0, "a stolen ciphertext decrypted under another row's id");

    await db.query(`DELETE FROM client_push_subscriptions WHERE id = $1`, [foreignId]);
  });

  test("a ciphertext encrypted under a different key is skipped, not fatal", async () => {
    const id = crypto.randomUUID();
    const otherKey = { PUSH_SUB_ENC_KEY: crypto.randomBytes(32).toString("base64") };
    await db.query(
      `INSERT INTO client_push_subscriptions
         (id, org_id, client_id, endpoint_hash, encrypted_endpoint, encrypted_p256dh, encrypted_auth)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, org, B.id, endpointHash("https://push.example/rotated"),
        encryptField("https://push.example/rotated", { rowId: id, env: otherKey }),
        encryptField("x", { rowId: id, env: otherKey }),
        encryptField("y", { rowId: id, env: otherKey })]
    );
    const live = await listLiveSubscriptions(db, { orgId: org, clientId: B.id });
    assert.equal(live.length, 1, "the readable device was lost because of an unreadable sibling");
    await db.query(`DELETE FROM client_push_subscriptions WHERE id = $1`, [id]);
  });
});
