// The lock-screen gate, and the send path it sits in.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7) — credit-repair messaging.
//
// THE CLAIM UNDER TEST: with the detail flag off — which is everywhere, today —
// a notification carrying a dollar amount, a lender's name, a bureau's name or
// a credit-repair word CANNOT REACH THE SEND PATH. Not "is stripped". Refused,
// with the reason named.
//
// It is tested at BOTH levels, because a gate is only worth what its weakest
// caller is: once directly against buildPushPayload(), and once through
// src/messaging/providers/web-push.mjs's send() with a fake network, asserting
// that fake network was never called.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildPushPayload, assertLockScreenSafe, GENERIC_BODIES, PushPayloadRefused } from "./payload.mjs";
import { send as webPushSend } from "../messaging/providers/web-push.mjs";
import { generateVapidKeys, b64u } from "./crypto.mjs";

/* A real subscription's shape, with keys that are real curve points so the
   refusal cannot be mistaken for a crypto failure. */
function realSubscription() {
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  return { p256dh: b64u(ua.getPublicKey()), auth: b64u(crypto.randomBytes(16)) };
}

const VAPID = generateVapidKeys();
const ENV = {
  VAPID_PUBLIC_KEY: VAPID.publicKey,
  VAPID_PRIVATE_KEY: VAPID.privateKey,
  VAPID_SUBJECT: "mailto:support@fundhub.ai",
  // The fence must be explicitly down or nothing transmits, and then a test
  // that asserts "the network was never called" would pass for the wrong reason.
  MESSAGING_DRY_RUN: "0"
};

/* Every string that must never appear on a locked phone. Each one is a real
   sentence somebody would plausibly write. */
const FORBIDDEN = [
  "Your $4,200 payment is due Friday.",
  "You owe 4200 dollars on Friday.",
  "1,250.00 is due tomorrow.",
  "Your Amex statement closes in 2 days.",
  "Chase reported a new balance.",
  "Capital One is due soon.",
  "Your Experian score changed.",
  "TransUnion updated your file.",
  "Your FICO score is now 642.",
  "Your score moved to 712.",
  "Your dispute letters were mailed.",
  "A new collection appeared on your report.",
  "Your credit repair round is complete.",
  "A charge-off was removed.",
  "Your credit report was updated."
];

describe("buildPushPayload — the lock screen is public", () => {
  test("the default body for every kind is generic and passes its own gate", () => {
    for (const kind of Object.keys(GENERIC_BODIES)) {
      const payload = JSON.parse(buildPushPayload({ kind }));
      assert.equal(payload.body, GENERIC_BODIES[kind]);
      assert.equal(payload.title, "FundHub");
      assert.doesNotThrow(() => assertLockScreenSafe(payload.body));
    }
  });

  test("the default payment body is the one the owner asked for", () => {
    assert.equal(JSON.parse(buildPushPayload({ kind: "payment_due" })).body,
      "A payment is due soon. Open FundHub.");
  });

  for (const body of FORBIDDEN) {
    test(`refused with the flag off: ${JSON.stringify(body)}`, () => {
      assert.throws(
        () => buildPushPayload({ kind: "payment_due", body }),
        (err) => err instanceof PushPayloadRefused && /refused: it contains/.test(err.message),
        "this reached the payload"
      );
    });
  }

  test("a banned word in the TITLE is refused too — a title is on the lock screen as well", () => {
    assert.throws(() => buildPushPayload({ kind: "update", title: "Amex alert" }), PushPayloadRefused);
  });

  test("nothing is ever silently stripped — the text is refused whole", () => {
    // A sanitiser would produce "Your  payment is due" and tell nobody. Prove
    // the function has no partial-success path by proving it throws.
    let built = null;
    try { built = buildPushPayload({ kind: "payment_due", body: "Your $4,200 payment is due." }); } catch (e) { /* expected */ }
    assert.equal(built, null);
  });

  test("with allowDetail true the same text is allowed — the flag is real, and it is off by default", () => {
    const payload = JSON.parse(buildPushPayload(
      { kind: "payment_due", body: "Your $4,200 Amex payment is due Friday." },
      { allowDetail: true }
    ));
    assert.match(payload.body, /\$4,200/);
    // And the default really is off: the same call without the option throws.
    assert.throws(() => buildPushPayload({ kind: "payment_due", body: "Your $4,200 Amex payment is due Friday." }));
  });

  test("an unknown kind is refused rather than defaulted", () => {
    assert.throws(() => buildPushPayload({ kind: "collections_call" }), /unknown push kind/);
  });

  test("an off-site tap target is refused", () => {
    assert.throws(() => buildPushPayload({ kind: "update", url: "https://evil.example" }), /same-origin path/);
    assert.throws(() => buildPushPayload({ kind: "update", url: "//evil.example" }), /same-origin path/);
    assert.doesNotThrow(() => buildPushPayload({ kind: "update", url: "/app/client-portal.html?tab=docs" }));
  });

  test("an over-long body is refused rather than cut mid-word on a phone", () => {
    assert.throws(() => buildPushPayload({ kind: "update", body: "a".repeat(200) }), /the cap is/);
  });
});

describe("the send path refuses it too — the gate cannot be walked around", () => {
  const sub = realSubscription();

  test("a payload with a dollar amount never reaches the network", async () => {
    let called = 0;
    const fetchImpl = async () => { called += 1; return new Response("", { status: 201 }); };

    const result = await webPushSend({
      id: "row-1",
      to: "https://updates.push.services.mozilla.com/wpush/v2/abc",
      pushKeys: sub,
      notification: { kind: "payment_due", body: "Your $4,200 Amex payment is due Friday." }
    }, { env: ENV, fetchImpl });

    assert.equal(called, 0, "the push service was called with banned content");
    assert.equal(result.status, "rejected");
    assert.equal(result.retryable, false, "a refusal must not be retried forever");
    assert.match(result.error, /locked screen/);
  });

  test("a creditor name never reaches the network either", async () => {
    let called = 0;
    const fetchImpl = async () => { called += 1; return new Response("", { status: 201 }); };
    const result = await webPushSend({
      to: "https://fcm.googleapis.com/fcm/send/abc",
      pushKeys: sub,
      notification: { kind: "statement_close", body: "Your Capital One statement closes tomorrow." }
    }, { env: ENV, fetchImpl });
    assert.equal(called, 0);
    assert.equal(result.status, "rejected");
  });

  test("the generic version of the same notification DOES go out", async () => {
    // The negative tests above are only meaningful if the positive path works.
    let seen = null;
    const fetchImpl = async (url, init) => { seen = { url, init }; return new Response("", { status: 201 }); };

    const result = await webPushSend({
      id: "row-2",
      to: "https://updates.push.services.mozilla.com/wpush/v2/abc",
      pushKeys: sub,
      notification: { kind: "payment_due" }
    }, { env: ENV, fetchImpl });

    assert.equal(result.status, "sent", result.error || "");
    assert.ok(seen, "nothing was sent");
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.headers["Content-Encoding"], "aes128gcm");
    assert.match(seen.init.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    assert.ok(Buffer.isBuffer(seen.init.body), "the body should be the encrypted record");
    // The plaintext must not be recoverable from the wire body.
    assert.equal(seen.init.body.includes(Buffer.from("payment", "utf8")), false);
  });

  test("a dead subscription reports itself as gone rather than as a retryable failure", async () => {
    for (const status of [404, 410]) {
      const result = await webPushSend({
        to: "https://fcm.googleapis.com/fcm/send/dead",
        pushKeys: sub,
        notification: { kind: "update" }
      }, { env: ENV, fetchImpl: async () => new Response("", { status }) });
      assert.equal(result.gone, true, `HTTP ${status} was not treated as gone`);
      assert.equal(result.status, "rejected");
    }
  });

  test("a push service having a bad hour is retryable, not permanent", async () => {
    const result = await webPushSend({
      to: "https://fcm.googleapis.com/fcm/send/x",
      pushKeys: sub,
      notification: { kind: "update" }
    }, { env: ENV, fetchImpl: async () => new Response("", { status: 500 }) });
    assert.equal(result.status, "failed");
    assert.equal(result.retryable, true);
  });

  test("with no VAPID key nothing is sent, and it is retryable so it goes out once configured", async () => {
    let called = 0;
    const result = await webPushSend({
      to: "https://fcm.googleapis.com/fcm/send/x",
      pushKeys: sub,
      notification: { kind: "update" }
    }, { env: { MESSAGING_DRY_RUN: "0" }, fetchImpl: async () => { called += 1; return new Response(""); } });
    assert.equal(called, 0);
    assert.equal(result.status, "failed");
    assert.match(result.error, /not configured/);
  });

  test("the messaging fence holds it when MESSAGING_DRY_RUN is not explicitly off", async () => {
    let called = 0;
    const result = await webPushSend({
      to: "https://fcm.googleapis.com/fcm/send/x",
      pushKeys: sub,
      notification: { kind: "update" }
    }, {
      env: { ...ENV, MESSAGING_DRY_RUN: undefined },
      fetchImpl: async () => { called += 1; return new Response(""); }
    });
    assert.equal(called, 0, "the fence let a send through");
    assert.equal(result.status, "failed");
  });
});

describe("the provider's shape", () => {
  test("it wears the same contract every other provider does, and ships unrouted", async () => {
    const p = await import("../messaging/providers/web-push.mjs");
    assert.equal(typeof p.PROVIDER, "string");
    assert.ok(p.CHANNELS instanceof Set && p.CHANNELS.size > 0);
    assert.equal(typeof p.ADDRESS_FIELD, "string");
    assert.equal(typeof p.send, "function");
    assert.equal(p.ENABLED, false, "web push is not routed; ENABLED must say so");
    assert.equal(p.TRANSMITS, true);

    // And it really is absent from the registry, so nothing in the message queue
    // can reach it by accident.
    const registry = await import("../messaging/providers/index.mjs");
    assert.equal(registry.resolve("web_push"), null,
      "web_push is in the provider registry — the dispatcher could now route to it");
  });
});
