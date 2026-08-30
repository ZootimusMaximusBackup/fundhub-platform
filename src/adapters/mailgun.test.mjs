import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  verifyMailgunSignature,
  classifyBankEmail,
  _classifyFull,
  normalizeMailgunEvent,
  mapToCanonical,
  handleMailgunWebhook,
  clientIdFromRecipient,
  resolveClientFromRecipient,
  replyClientIdFrom,
  resolveClientFromSender
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

/* ── A REJECTION READ AS AN APPROVAL ───────────────────────────────────────
   Live bug, fixed 2026-08-29. The matcher was `lower.includes(keyword)`, and
   the string "not approved" contains the string "approved". APPROVED is the
   first rule in the list and the first match won, so a denial letter came out
   of the classifier as APPROVED — which is not a label sitting in a log. It is
   read by src/workflows/f-11-bank-email-event-router.mjs, and on APPROVED that
   workflow moves the client's funding card into the "approved" stage and sets
   their next action to "Prepare Next Funding Round". A client who had just been
   turned down was recorded as funded, and the DENIED follow-up that should have
   adjusted their plan (F-09) never ran.

   Every phrasing below is one banks actually send. The five DENIED cases and
   the reduced-amount case all returned APPROVED before the fix. */

const DENIALS = [
  "Unfortunately, you were not approved for the requested credit limit.",
  "We are unable to approve your application at this time.",
  "Your application has been declined.",
  "Adverse action notice: your request was not approved.",
  "After careful review, we have not approved your application."
];

for (const body of DENIALS) {
  test(`classifier: DENIED — ${body}`, () => {
    assert.equal(classifyBankEmail("Your application", body), "DENIED");
    // Both entry points, because they used to hold two copies of this logic.
    assert.equal(_classifyFull({ subject: "Your application", from: "lender@bank.com", body }).event_type, "DENIED");
  });
}

const APPROVALS = [
  "Congratulations! You've been approved for a $5,000 credit limit.",
  "Your application is approved. Your credit limit is $12,500.",
  "Approved — welcome aboard."
];

for (const body of APPROVALS) {
  test(`classifier: APPROVED — ${body}`, () => {
    assert.equal(classifyBankEmail("Your application", body), "APPROVED");
    assert.equal(_classifyFull({ subject: "Your application", from: "lender@bank.com", body }).event_type, "APPROVED");
  });
}

/* AN APPROVAL FOR LESS THAN WAS ASKED FOR IS A COUNTEROFFER, DELIBERATELY.
   Both labels move the card to the same stage, so the stage is not what is at
   stake — the task title is. APPROVED files "APPROVAL: log amount + update
   round", which tells staff the round is done. COUNTEROFFER files "COUNTER:
   review + log offer + next step", which tells them a person has to look at the
   shortfall and decide what happens next. The second one is the work that
   actually needs doing, and calling it an approval is how a client ends up
   $3,000 short with nobody chasing the difference. */
test("classifier: COUNTEROFFER — an approval cut down to a smaller amount", () => {
  const body = "We approved you for a reduced amount of $2,000.";
  assert.equal(classifyBankEmail("Your application", body), "COUNTEROFFER");
  assert.equal(_classifyFull({ subject: "Your application", from: "lender@bank.com", body }).event_type, "COUNTEROFFER");
});

test("classifier: COUNTEROFFER — reduced approval with no counteroffer word in it", () => {
  assert.equal(
    classifyBankEmail("Decision", "You are approved for a lower credit limit than you requested."),
    "COUNTEROFFER"
  );
});

/* "reduced" ON ITS OWN IS NOT A COUNTEROFFER. It has to be a reduced AMOUNT —
   a bank cutting your interest rate is good news, not a lesser offer. */
test("classifier: APPROVED — a reduced rate is still an approval", () => {
  assert.equal(
    classifyBankEmail("Decision", "Congratulations, you are approved. Your APR has been reduced."),
    "APPROVED"
  );
});

// --- word boundaries: keywords must not be read out of the middle of words ---
test("classifier: a refund is not an approval ('refunded' contained 'funded')", () => {
  assert.notEqual(classifyBankEmail("Account notice", "Your annual fee has been refunded."), "APPROVED");
});

test("classifier: 'unapproved' is not an approval", () => {
  assert.notEqual(
    classifyBankEmail("Account notice", "Your application remains unapproved at this time."),
    "APPROVED"
  );
});

// --- negation must not swallow genuine approvals -----------------------------
/* The negation test looks for an approval word directly after a negative, with
   at most one filler word between them. A wider gap starts reading ordinary
   sentences as denials, and these two are the ones that would break first. */
test("classifier: APPROVED — 'does not affect your approved limit' is still an approval", () => {
  assert.equal(
    classifyBankEmail("Your application", "You are approved. This does not affect your approved limit."),
    "APPROVED"
  );
});

test("classifier: APPROVED — a 'do not reply' footer does not turn an approval into a denial", () => {
  assert.equal(
    classifyBankEmail("Your application", "Do not reply to this email. You have been approved for $10,000."),
    "APPROVED"
  );
});

// --- more denial phrasings ---------------------------------------------------
test("classifier: DENIED — 'cannot approve'", () => {
  assert.equal(classifyBankEmail("Decision", "We cannot approve your request at this time."), "DENIED");
});

test("classifier: DENIED — 'will not be approved'", () => {
  assert.equal(classifyBankEmail("Decision", "Your application will not be approved."), "DENIED");
});

test("classifier: DENIED — 'could not fund'", () => {
  assert.equal(classifyBankEmail("Decision", "We regret to inform you we could not fund this request."), "DENIED");
});

/* Forwarded plain-text bank mail hard-wraps. A denial whose "not approved" fell
   across a line break was invisible to a literal single-space match. */
test("classifier: DENIED — 'not approved' split across a line break", () => {
  assert.equal(classifyBankEmail("Decision", "We are sorry, you were not\napproved for this product."), "DENIED");
});

// --- outcome still beats process --------------------------------------------
/* An email that states a decision IS that decision, even when it also asks for
   something. These passed before the fix by rule order and must keep passing:
   the fix must not have turned the rule list into a length contest. */
test("classifier: APPROVED — an approval that also asks for an upload", () => {
  assert.equal(
    classifyBankEmail("Your application", "Congratulations! Approved. Please upload your ID to activate the card."),
    "APPROVED"
  );
});

test("classifier: APPROVED — an approval that also says 'verify your identity'", () => {
  assert.equal(
    classifyBankEmail("Your application", "You are approved. Verify your identity to finish setup."),
    "APPROVED"
  );
});

test("classifier: DENIED — a denial that also offers an upload to appeal", () => {
  assert.equal(
    classifyBankEmail(
      "Your application",
      "Unfortunately your application was declined. You may upload additional documentation to appeal."
    ),
    "DENIED"
  );
});

test("classifier: DENIED — an adverse action notice headed 'Action Required'", () => {
  assert.equal(
    classifyBankEmail("Your application", "Adverse Action Notice - Action Required: review the enclosed notice."),
    "DENIED"
  );
});

/* THE WHOLE PATH, NOT JUST THE PURE FUNCTION. classification is what
   handleMailgunWebhook puts on the mail.response payload, and that payload is
   what moves the card. Before the fix this emitted APPROVED. */
test("handleMailgunWebhook: a rejection email emits DENIED, not APPROVED", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("mail.response", (e) => seen.push(e.payload.classification));
  const body = makeBody({
    subject: "Your application decision",
    body: "Unfortunately, you were not approved for the requested credit limit."
  });
  await handleMailgunWebhook({ db: fakeDb(), body, signingKey: SIGNING_KEY });
  assert.deepEqual(seen, ["DENIED"]);
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

test("receive wiring: signed inbound to monitor+id@mg.fundhub.ai emits mail.response", async () => {
  const store = [];
  const db = fakeDb({ store });
  const res = await handleMailgunWebhook({
    db,
    body: {
      signature: sign(String(Date.now()), crypto.randomBytes(22).toString("hex")),
      recipient: "monitor+aaaaaaaa-1111-4111-8111-111111111111@mg.fundhub.ai",
      sender: "lender@bank.com",
      subject: "Congratulations — approved",
      "body-plain": "Your application is approved.",
      "Message-Id": "<receive-mg@mg.fundhub.ai>"
    },
    signingKey: SIGNING_KEY
  });
  assert.equal(res.ok, true);
  const ev = store.find((e) => e.name === "mail.response");
  assert.ok(ev, "mail.response emitted from Mailgun receive domain");
  assert.equal(ev.payload.clientId, "aaaaaaaa-1111-4111-8111-111111111111");
  assert.equal(ev.payload.classification, "APPROVED");
  assert.equal(ev.payload.to, "monitor+aaaaaaaa-1111-4111-8111-111111111111@mg.fundhub.ai");
});

/* ── T5-04 / T5-05 · who a reply belongs to ───────────────────────────────
   Traced live 2026-08-19. The reply was deliberately NOT sent, because the
   auditor proved it would attach to a real person's credit file: the matcher
   took the From address and returned an arbitrary client with `LIMIT 1` and no
   ORDER BY, so which customer a reply landed on was whatever the database
   handed back first. */

test("a reply addressed to reply+<clientId>@ names exactly one client", () => {
  const id = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
  assert.equal(replyClientIdFrom(`reply+${id}@mg.fundhub.ai`), id);
  assert.equal(replyClientIdFrom(`Fundhub <reply+${id}@mg.fundhub.ai>`), id, "inside angle brackets");
  assert.equal(replyClientIdFrom(`REPLY+${id.toUpperCase()}@MG.FUNDHUB.AI`), id, "case does not matter");
});

test("a bank forwarding address is NOT read as a client reply", () => {
  /* `monitor+<id>@` is a bank statement ABOUT a client and `reply+<id>@` is the
     client's own words TO us. They produce completely different rows, and
     confusing them would put a bank's words in a person's mouth. */
  const id = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
  assert.equal(replyClientIdFrom(`monitor+${id}@fundhub.ai`), null);
  assert.equal(replyClientIdFrom("hello@fundhub.ai"), null);
  assert.equal(replyClientIdFrom("reply@mg.fundhub.ai"), null, "no tag, no client");
  assert.equal(replyClientIdFrom(""), null);
  assert.equal(replyClientIdFrom(null), null);
});

test("a tag that is not a client id shape is refused", () => {
  // The tag has to look like a uuid or it is not one of ours.
  assert.equal(replyClientIdFrom("reply+../../etc/passwd@mg.fundhub.ai"), null);
  assert.equal(replyClientIdFrom("reply+12345@mg.fundhub.ai"), null);
});

test("an address held by ONE client resolves to that client", async () => {
  const rows = [{ id: "cl-1", org_id: "org-1" }];
  const db = { query: async () => ({ rows }) };
  const out = await resolveClientFromSender(db, "Someone <person@example.com>");
  assert.equal(out.clientId, "cl-1");
  assert.equal(out.orgId, "org-1");
  assert.equal(out.ambiguous, false);
});

test("an address held by MORE THAN ONE client refuses to guess", async () => {
  /* THE FIX. Filing a person's words onto the wrong customer's credit file is
     worse than filing them nowhere: the wrong client's thread now holds
     somebody else's private message, and the right client looks like they
     never replied. */
  const db = { query: async () => ({ rows: [{ id: "cl-1", org_id: "org-1" }, { id: "cl-2", org_id: "org-2" }] }) };
  const out = await resolveClientFromSender(db, "shared@example.com");
  assert.equal(out.ambiguous, true, "two matches must not silently become one");
  assert.equal(out.clientId, null, "and must not pick either of them");
});

test("the sender lookup reads two rows so it can tell one match from many", async () => {
  let sql = "";
  const db = { query: async (q) => { sql = q; return { rows: [] }; } };
  await resolveClientFromSender(db, "nobody@example.com");
  assert.match(sql, /LIMIT 2/, "LIMIT 1 cannot distinguish 'the only one' from 'the first of several'");
  assert.ok(!/ORDER BY/i.test(sql),
    "ordering would make the wrong answer deterministic rather than correct");
});

test("an unknown address still resolves to nothing", async () => {
  const db = { query: async () => ({ rows: [] }) };
  assert.equal(await resolveClientFromSender(db, "stranger@example.com"), null);
});
