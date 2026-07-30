import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  verifyMailgunSignature,
  classifyBankEmail,
  normalizeMailgunEvent,
  mapToCanonical,
  handleMailgunWebhook,
  clientIdFromRecipient,
  resolveClientFromRecipient
} from "./mailgun.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { on, clearHandlers } from "../events/registry.mjs";

// Fake db — same shape as commas.test.mjs
function fakeDb({ dedup = false, store = [] } = {}) {
  let n = 0;
  return {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        if (dedup) return { rows: [] };
        const row = { id: `evt-${++n}` };
        store.push({ ...row, name: params[1], clientId: params[4], payload: params[5] });
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
}

const SIGNING_KEY = "mailgun-test-signing-key";

// Build a valid Mailgun signature triple
function sign(timestamp, token) {
  const signature = crypto
    .createHmac("sha256", SIGNING_KEY)
    .update(timestamp + token)
    .digest("hex");
  return { timestamp, token, signature };
}

function makeBody(overrides = {}) {
  const ts = String(Date.now());
  const tok = crypto.randomBytes(22).toString("hex");
  const sig = sign(ts, tok);
  return {
    signature: sig,
    subject: overrides.subject || "Test email",
    sender: overrides.from || "lender@bank.com",
    "body-plain": overrides.body || "Hello there",
    "Message-Id": overrides.messageId || `<${Date.now()}@mg.fundhub.ai>`,
    ...overrides._extra
  };
}

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------
test("verifyMailgunSignature: accepts a valid signature", () => {
  const { timestamp, token, signature } = sign("1700000000", "tok123abc");
  assert.equal(verifyMailgunSignature("1700000000", "tok123abc", signature, SIGNING_KEY), true);
});

test("verifyMailgunSignature: rejects tampered signature", () => {
  const { timestamp, token, signature } = sign("1700000000", "tok123abc");
  const bad = signature.slice(0, -2) + "ff";
  assert.equal(verifyMailgunSignature(timestamp, token, bad, SIGNING_KEY), false);
});

test("verifyMailgunSignature: rejects when signingKey is null (fail-closed)", () => {
  const { timestamp, token, signature } = sign("1700000000", "tok456");
  assert.equal(verifyMailgunSignature(timestamp, token, signature, null), false);
});

test("verifyMailgunSignature: rejects blank timestamp / token", () => {
  assert.equal(verifyMailgunSignature("", "tok", "sig", SIGNING_KEY), false);
  assert.equal(verifyMailgunSignature("1700000000", "", "sig", SIGNING_KEY), false);
});

// ---------------------------------------------------------------------------
// Classifier — ≥3 realistic bank-email samples per spec
// ---------------------------------------------------------------------------
test("classifyBankEmail: APPROVED — subject 'Congratulations, you are approved!'", () => {
  assert.equal(classifyBankEmail("Congratulations, you are approved!", ""), "APPROVED");
});

test("classifyBankEmail: APPROVED — body contains credit limit with dollar amount", () => {
  assert.equal(
    classifyBankEmail("Your Application Update", "Your credit limit is $25,000. Congratulations!"),
    "APPROVED"
  );
});

test("classifyBankEmail: DENIED — subject 'We were unable to approve your application'", () => {
  assert.equal(classifyBankEmail("We were unable to approve your application", ""), "DENIED");
});

test("classifyBankEmail: DENIED — body contains adverse action", () => {
  assert.equal(
    classifyBankEmail("Important notice", "This is an adverse action notice regarding your recent application."),
    "DENIED"
  );
});

test("classifyBankEmail: MISSING_DOCS — subject 'Additional documentation required'", () => {
  assert.equal(classifyBankEmail("Additional documentation required to proceed", ""), "MISSING_DOCS");
});

test("classifyBankEmail: MISSING_DOCS — body 'Please provide the following'", () => {
  assert.equal(
    classifyBankEmail("Action needed on your file", "Please provide the following documents within 5 days."),
    "MISSING_DOCS"
  );
});

test("classifyBankEmail: COUNTEROFFER — 'revised offer' in body", () => {
  assert.equal(
    classifyBankEmail("Update on your application", "We have a revised offer available for your review."),
    "COUNTEROFFER"
  );
});

test("classifyBankEmail: ACTION_REQUIRED — 'Please sign your documents'", () => {
  assert.equal(classifyBankEmail("Please sign your documents to proceed", ""), "ACTION_REQUIRED");
});

test("classifyBankEmail: APP_RECEIVED — 'Thank you for applying'", () => {
  assert.equal(classifyBankEmail("Thank you for applying", "We received your application and will be in touch."), "APP_RECEIVED");
});

test("classifyBankEmail: NOISE — no matching keywords", () => {
  assert.equal(classifyBankEmail("Weekly digest", "Here is your weekly newsletter summary."), "NOISE");
});

test("classifyBankEmail: NOISE — unsubscribe in subject", () => {
  assert.equal(classifyBankEmail("Manage your unsubscribe preferences", "Click here to opt out."), "NOISE");
});

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------
test("normalizeMailgunEvent: reads nested signature block + email fields", () => {
  const ts = "1700001000";
  const tok = "abc123";
  const { signature } = sign(ts, tok);
  const body = {
    signature: { timestamp: ts, token: tok, signature },
    Subject: "You are approved!",
    From: "chase@bank.com",
    "body-plain": "Congratulations, your credit line is approved.",
    "Message-Id": "<abc@mg.fundhub.ai>"
  };
  const evt = normalizeMailgunEvent(body);
  assert.equal(evt.timestamp, ts);
  assert.equal(evt.token, tok);
  assert.equal(evt.signature, signature);
  assert.equal(evt.subject, "You are approved!");
  assert.equal(evt.from, "chase@bank.com");
  assert.equal(evt.messageId, "<abc@mg.fundhub.ai>");
  assert.ok(evt.text.includes("Congratulations"));
});

test("normalizeMailgunEvent: prefers stripped-text over body-plain", () => {
  const evt = normalizeMailgunEvent({
    "body-plain": "full text",
    "stripped-text": "stripped"
  });
  assert.equal(evt.text, "stripped");
});

// ---------------------------------------------------------------------------
// mapToCanonical
// ---------------------------------------------------------------------------
test("mapToCanonical: always returns mail.response", () => {
  const result = mapToCanonical({});
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "mail.response");
});

// ---------------------------------------------------------------------------
// mail.response payload
// ---------------------------------------------------------------------------
test("handleMailgunWebhook: emits mail.response with correct payload shape", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  const db = fakeDb({ store });
  const body = makeBody({ subject: "You've been approved!", from: "wells@bank.com", body: "Congratulations!" });
  const res = await handleMailgunWebhook({ db, body, signingKey: SIGNING_KEY });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.emitted.length, 1);
  assert.equal(res.emitted[0].name, "mail.response");
  const payload = store[0].payload;
  assert.equal(payload.classification, "APPROVED");
  assert.equal(payload.source, "mailgun");
  assert.equal(payload.from, "wells@bank.com");
  assert.equal(payload.subject, "You've been approved!");
});

// ---------------------------------------------------------------------------
// Signature gate in full adapter
// ---------------------------------------------------------------------------
test("handleMailgunWebhook: bad signature => 401, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const body = makeBody();
  // corrupt the signature
  body.signature.signature = "000000";
  const res = await handleMailgunWebhook({ db: fakeDb(), body, signingKey: SIGNING_KEY });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(res.emitted.length, 0);
});

/* This asserted the opposite — that an absent signing key SKIPS verification and
   emits normally. That is a hole, not a feature: MAILGUN_SIGNING_KEY ships blank
   in .env.example, so in the deployed configuration anyone could POST a forged
   payload and have it emitted onto the canonical bus as a real mail.response.
   Every other adapter fails closed. */
test("handleMailgunWebhook: no signingKey => REFUSE, emit nothing", async () => {
  _resetOrgCache(); clearHandlers();
  const body = makeBody({ subject: "Application received" });
  const res = await handleMailgunWebhook({ db: fakeDb(), body, signingKey: null });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.deepEqual(res.emitted, [], "a forged webhook reached the event bus");
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------
test("handleMailgunWebhook: re-delivered webhook is idempotent (deduped)", async () => {
  _resetOrgCache(); clearHandlers();
  let fired = 0;
  on("mail.response", () => (fired += 1));
  const body = makeBody({ messageId: "<unique-msg-id@mg.fundhub.ai>" });
  const db = fakeDb({ dedup: true }); // simulate event already in DB
  const res = await handleMailgunWebhook({ db, body, signingKey: SIGNING_KEY });
  assert.ok(res.emitted.every((e) => e.deduped === true), "all events deduped");
  assert.equal(fired, 0, "handler must not fire on a deduped replay");
});

// ---------------------------------------------------------------------------
// Handler dispatch
// ---------------------------------------------------------------------------
test("handleMailgunWebhook: dispatches registered mail.response handler", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("mail.response", (e) => seen.push(e.payload.classification));
  const body = makeBody({ subject: "Unfortunately we could not approve your request" });
  await handleMailgunWebhook({ db: fakeDb(), body, signingKey: SIGNING_KEY });
  assert.deepEqual(seen, ["DENIED"]);
});

test("handleMailgunWebhook: APPROVED email dispatches with APPROVED classification", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("mail.response", (e) => seen.push(e.payload.classification));
  const body = makeBody({ subject: "Congratulations — your line of credit is approved!" });
  await handleMailgunWebhook({ db: fakeDb(), body, signingKey: SIGNING_KEY });
  assert.deepEqual(seen, ["APPROVED"]);
});

// --- contact resolution (unblocks F-06 / F-09 / F-11) -----------------------
// REGRESSION: mail.response used to carry nothing that identified a contact, so every
// downstream workflow exited `no_client` and the whole bank-email lane was dead on the
// real event. F-10 mints `monitor+<clientId>@fundhub.ai` per client — that plus-address
// is the identifier.

test("clientIdFromRecipient: extracts the client id from F-10's plus-address", () => {
  assert.equal(clientIdFromRecipient("monitor+cl-123@fundhub.ai"), "cl-123");
  assert.equal(clientIdFromRecipient("monitor+abc-DEF-9@fundhub.ai"), "abc-DEF-9");
  assert.equal(clientIdFromRecipient("plain@fundhub.ai"), null);
  assert.equal(clientIdFromRecipient(null), null);
});

test("resolveClientFromRecipient: falls back to the stored forwarding address", async () => {
  const db = { async query(sql, params) {
    assert.match(sql, /funding_email_forwarding_address/);
    return { rows: params[0] === "bank@fundhub.ai" ? [{ id: "cl-9" }] : [] };
  } };
  assert.equal(await resolveClientFromRecipient(db, "bank@fundhub.ai"), "cl-9");
  assert.equal(await resolveClientFromRecipient(db, "nobody@fundhub.ai"), null);
  assert.equal(await resolveClientFromRecipient(db, null), null);
});

test("REGRESSION: mail.response now carries a clientId the downstream workflows can use", async () => {
  const store = [];
  const db = fakeDb({ store });
  const res = await handleMailgunWebhook({
    db,
    // Signed, because the adapter now fails closed. This test is about clientId
    // resolution; it was only passing unsigned because verification used to be
    // skipped when no key was configured.
    body: {
      signature: sign(String(Date.now()), crypto.randomBytes(22).toString("hex")),
      recipient: "monitor+cl-777@fundhub.ai",
      sender: "notifications@bank.com",
      subject: "Additional documents required",
      "body-plain": "Please upload your bank statements.",
      "Message-Id": "<resolve-1@bank.com>"
    },
    signingKey: SIGNING_KEY
  });
  assert.equal(res.ok, true);
  const ev = store.find((e) => e.name === "mail.response");
  assert.ok(ev, "mail.response emitted");
  assert.equal(ev.payload.clientId, "cl-777", "payload carries the resolved contact");
  assert.equal(ev.clientId, "cl-777", "event row is linked to the client");
  assert.equal(ev.payload.to, "monitor+cl-777@fundhub.ai");
});
