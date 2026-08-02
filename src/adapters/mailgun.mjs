// Mailgun inbound-email adapter — Master Rebuild Spec Phase 1.
//
// Receives bank-forwarded emails from Mailgun, classifies them, and emits
// `mail.response` onto the canonical event bus. No Airtable/GHL side-effects
// here — handlers registered on `mail.response` perform those reactions.
//
// Classification is a direct port of inquiry-removal-ai/src/lib/email-classifier.js
// (7 event types: APPROVED / COUNTEROFFER / DENIED / MISSING_DOCS /
// ACTION_REQUIRED / APP_RECEIVED / NOISE). No external deps — pure Node built-ins.
//
// Mailgun signature scheme (real):
//   HMAC-SHA256( key = signingKey, data = timestamp + token ) hex === signature
// Fields arrive in body.signature.{timestamp,token,signature} or flat on body.

import crypto from "node:crypto";
import { emit } from "../events/bus.mjs";
import { recordOptOut } from "../lib/opt-out.mjs";
import { createTask } from "../lib/create-task.mjs";

// ---------------------------------------------------------------------------
// 1. Signature verification (fail-closed)
// ---------------------------------------------------------------------------
export function verifyMailgunSignature(timestamp, token, signature, signingKey) {
  if (!signingKey) return false;
  const ts = String(timestamp || "").trim();
  const tk = String(token || "").trim();
  const sig = String(signature || "").trim();
  if (!ts || !tk || !sig) return false;
  const expected = crypto
    .createHmac("sha256", signingKey)
    .update(ts + tk)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 2. Keyword classifier — ported from email-classifier.js verbatim
// ---------------------------------------------------------------------------
const NOISE_FROM_PATTERNS = ["noreply", "no-reply", "newsletter", "marketing", "unsubscribe", "donotreply"];
const NOISE_SUBJECT_PATTERNS = ["unsubscribe", "newsletter", "promotional", "update your preferences"];

const CLASSIFICATION_RULES = [
  {
    event_type: "APPROVED",
    keywords: ["approved", "congratulations", "approval", "funded", "you've been approved", "credit limit"],
    dollarAmountBoost: true
  },
  {
    event_type: "COUNTEROFFER",
    keywords: ["counteroffer", "counter offer", "revised offer", "lower amount", "reduced"]
  },
  {
    event_type: "DENIED",
    keywords: ["denied", "declined", "unfortunately", "not approved", "unable to approve", "adverse action"]
  },
  {
    event_type: "MISSING_DOCS",
    keywords: [
      "missing document",
      "documents needed",
      "additional documentation",
      "please provide",
      "upload",
      "verify your",
      "identity verification"
    ]
  },
  {
    event_type: "ACTION_REQUIRED",
    keywords: [
      "action required",
      "action needed",
      "please sign",
      "review and sign",
      "accept your offer",
      "log in to",
      "confirm your"
    ]
  },
  {
    event_type: "APP_RECEIVED",
    keywords: [
      "application received",
      "we received your application",
      "thank you for applying",
      "application submitted",
      "application confirmation"
    ]
  }
];

const DOLLAR_PATTERN = /\$[\d,]+(?:\.\d{2})?/;

function findKeyword(text, keywords) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

function isNoise(from, subject) {
  if (from) {
    const lf = from.toLowerCase();
    for (const p of NOISE_FROM_PATTERNS) if (lf.includes(p)) return p;
  }
  if (subject) {
    const ls = subject.toLowerCase();
    for (const p of NOISE_SUBJECT_PATTERNS) if (ls.includes(p)) return p;
  }
  return null;
}

// classifyBankEmail — pure, returns the classification string (event_type).
export function classifyBankEmail(subject, body) {
  const noiseMatch = isNoise(null, subject); // from not available to this pure fn
  if (noiseMatch) return "NOISE";

  const text = body || "";
  const matches = [];

  for (const rule of CLASSIFICATION_RULES) {
    const subjectMatch = findKeyword(subject, rule.keywords);
    const bodyMatch = findKeyword(text, rule.keywords);
    if (subjectMatch || bodyMatch) {
      matches.push({ event_type: rule.event_type });
    }
  }

  return matches.length === 0 ? "NOISE" : matches[0].event_type;
}

// Full classifier (takes from as well, mirrors classifyEmail exactly).
function classifyFull({ subject, from, body }) {
  const noiseMatch = isNoise(from, subject);
  if (noiseMatch) return { event_type: "NOISE", confidence: "high", matched_rule: `noise_filter:${noiseMatch}` };

  const text = body || "";
  const matches = [];

  for (const rule of CLASSIFICATION_RULES) {
    const subjectMatch = findKeyword(subject, rule.keywords);
    const bodyMatch = findKeyword(text, rule.keywords);
    if (subjectMatch || bodyMatch) {
      const source = subjectMatch ? "subject" : "body";
      const keyword = subjectMatch || bodyMatch;
      let hasDollarAmount = false;
      if (rule.dollarAmountBoost) {
        hasDollarAmount = DOLLAR_PATTERN.test(subject || "") || DOLLAR_PATTERN.test(text);
      }
      matches.push({ event_type: rule.event_type, source, keyword, hasDollarAmount });
    }
  }

  if (matches.length === 0) return { event_type: "NOISE", confidence: "low", matched_rule: "no_keyword_match" };

  const best = matches[0];
  const confidence = matches.length === 1 ? "high" : "medium";
  const dollarNote = best.hasDollarAmount ? "+dollar_amount" : "";
  return { event_type: best.event_type, confidence, matched_rule: `${best.source}:${best.keyword}${dollarNote}` };
}

// ---------------------------------------------------------------------------
// 3. Normalize raw Mailgun body into a flat event
// ---------------------------------------------------------------------------
export function normalizeMailgunEvent(body) {
  const b = body || {};

  // Signature fields arrive nested or flat
  const sig = b.signature || {};
  const timestamp = sig.timestamp || b.timestamp || "";
  const token = sig.token || b.token || "";
  const signature = sig.signature || b.signature_value || "";

  // Email fields — Mailgun sends both capitalized and lowercase variants
  const subject = b.subject || b.Subject || "";
  const from = b.sender || b.from || b.From || "";
  const bodyPlain = b["body-plain"] || b.body_plain || "";
  const strippedText = b["stripped-text"] || b.stripped_text || "";
  const text = strippedText || bodyPlain;

  // Message-Id for idempotency (best-effort)
  const messageId =
    b["Message-Id"] ||
    b["message-id"] ||
    b.messageId ||
    b.message_id ||
    null;

  // The recipient is what identifies WHICH client this bank email belongs to: F-10
  // provisions a per-client forwarding address `monitor+<clientId>@fundhub.ai`
  // (f-10-client-funding-inbox-provisioner.mjs:50). Without it, mail.response carries
  // nothing that resolves a contact and every downstream workflow (F-06, F-09, F-11)
  // exits `no_client` — they were dead on the real event.
  const recipient =
    b.recipient || b.to || b.To ||
    (b["event-data"] && b["event-data"].recipient) ||
    null;

  return { timestamp, token, signature, subject, from, text, messageId, recipient };
}

// ---------------------------------------------------------------------------
// 4. Map a normalized Mailgun event to canonical events
// ---------------------------------------------------------------------------
export function mapToCanonical(evt) {
  // An inbound bank email always maps to mail.response
  return [{ name: "mail.response" }];
}

// Resolve the client from the forwarding recipient. Prefers the deterministic
// `monitor+<clientId>@` plus-address F-10 mints, then falls back to a lookup on the
// stored funding_email_forwarding_address for any address minted another way.
export function clientIdFromRecipient(recipient) {
  const m = /\+([0-9a-zA-Z-]+)@/.exec(String(recipient || ""));
  return m ? m[1] : null;
}

/* resolveClientFromSender — the client who WROTE this email, if it was a client.
   Matched on the From address against `clients.email`, case-insensitively and
   trimmed, the same lookup src/handlers/comms.mjs findClient() does.

   THIS IS A DIFFERENT QUESTION FROM resolveClientFromRecipient BELOW, AND
   CONFLATING THEM WOULD PUT A BANK'S WORDS IN A CLIENT'S MOUTH.

   The inbound mail this adapter was built for is a bank statement forwarded to
   `monitor+<clientId>@fundhub.ai`. There the client is the RECIPIENT — the mail
   is addressed to their monitoring inbox — and the sender is a bank. That is
   what `mail.response` is, and it is why onMailResponse writes a `bank_inbox`
   row and not a message.

   A client replying to an email we sent them is the opposite shape: they are
   the SENDER, and the recipient is one of our own addresses. That is a person
   talking to us, which is the only thing that belongs on their conversation
   thread. The distinction is an observable fact about the payload, not a guess:
   the From address either matches a client record or it does not.

   ORG COMES FROM THE MATCHED CLIENT, not from a default. `clients.email` has no
   unique index in this schema, so two orgs could hold the same address; LIMIT 1
   would then pick one arbitrarily and file a person's email under a company
   that is not theirs. So the org is read off the row that matched, and the
   event is emitted into it — the same shape resolveClientFromRecipient's
   sibling lookup returns. */
export async function resolveClientFromSender(db, from) {
  const email = String(from || "").trim().toLowerCase();
  if (!email) return null;
  // A From header is frequently `Name <addr@host>`; match the address inside
  // angle brackets when there is one, and the whole string when there is not.
  const bracketed = /<([^>]+)>/.exec(email);
  const address = (bracketed ? bracketed[1] : email).trim();
  if (!address) return null;
  const r = await db.query(
    `SELECT id, org_id FROM clients WHERE lower(email) = $1 LIMIT 1`,
    [address]
  );
  const c = r.rows[0];
  return c ? { clientId: c.id, orgId: c.org_id } : null;
}

export async function resolveClientFromRecipient(db, recipient) {
  if (!recipient) return null;
  const fromPlus = clientIdFromRecipient(recipient);
  if (fromPlus) return fromPlus;
  const r = await db.query(
    `SELECT id FROM clients WHERE custom_fields->>'funding_email_forwarding_address' = $1 LIMIT 1`,
    [String(recipient).trim().toLowerCase()]
  );
  return r.rows[0]?.id || null;
}

// ---------------------------------------------------------------------------
// 5. Outbound delivery events — GHL cutover Ticket 2
//
// The return path: what Mailgun tells us about a message WE sent. A different
// payload shape from the inbound bank email above, and it must never be
// classified as one.
//
//   { "signature": { timestamp, token, signature },
//     "event-data": { event, recipient, severity,
//                     message: { headers: { "message-id": "..." } },
//                     "delivery-status": { message, code, description } } }
// ---------------------------------------------------------------------------

/** True when this payload is a delivery event rather than a forwarded email. */
export function isDeliveryEvent(body) {
  const d = body && body["event-data"];
  return !!(d && typeof d === "object" && typeof d.event === "string" && d.event);
}

/* Mailgun's event names → our `messages.status`.

   `complained` is the one that matters most and it is NOT a delivery failure —
   the mail arrived, was read, and the recipient pressed "this is spam". It is
   recorded on the message so an operator can see which send drew it, and it
   writes an opt-out, which is the part that has legal weight.

   `opened` and `clicked` are absent deliberately. They are engagement tracking,
   not delivery state, and letting an open overwrite `delivered` would lose the
   only record that the message actually landed. */
export const DELIVERY_STATUS_MAP = {
  delivered: "delivered",
  complained: "complained",
  rejected: "rejected",
  failed: null // resolved by severity below — permanent vs temporary
};

/* Who picks up a spam complaint, and under what source name. `admin` matches
   GATE_TASK_ROLE in src/messaging/gate.mjs: reviewing message copy is the same
   operational job whether the gate caught the wording or a recipient did. */
export const COMPLAINT_TASK_ROLE = "admin";
export const COMPLAINT_SOURCE = "mailgun-complaint";

export const IGNORED_DELIVERY_EVENTS = new Set([
  "accepted", "opened", "clicked", "unsubscribed", "stored", "delivered_ip"
]);

/* Mailgun writes the id with angle brackets on the send response and without
   them in the event payload. Whichever form the dispatcher stored, the two must
   still match, so both sides are stripped before comparison. */
export function normalizeMessageId(id) {
  const s = String(id || "").trim();
  return s.replace(/^<+/, "").replace(/>+$/, "");
}

export function normalizeDeliveryEvent(body) {
  const b = body || {};
  const sig = b.signature || {};
  const d = b["event-data"] || {};
  const headers = (d.message && d.message.headers) || {};
  const ds = d["delivery-status"] || {};

  const errorParts = [];
  if (ds.code) errorParts.push(`mailgun_${ds.code}`);
  if (ds.message || ds.description) errorParts.push(String(ds.message || ds.description));
  if (d.reason && errorParts.length === 0) errorParts.push(String(d.reason));

  return {
    timestamp: sig.timestamp || b.timestamp || "",
    token: sig.token || b.token || "",
    signature: sig.signature || b.signature_value || "",
    event: String(d.event || "").trim().toLowerCase(),
    severity: String(d.severity || "").trim().toLowerCase(),
    recipient: d.recipient || null,
    providerMessageId: normalizeMessageId(headers["message-id"] || d.id || ""),
    // Operator-facing only. Truncated, and it never carries the message body.
    errorText: errorParts.length ? errorParts.join(": ").slice(0, 300) : null
  };
}

/**
 * handleMailgunDeliveryEvent({ db, body, signingKey })
 *   → { ok, status, updated, event?, optedOut?, reason? }
 *
 * Fail-closed on the signature, exactly like the inbound path. `updated` is the
 * number of message rows moved; `optedOut` says whether a complaint produced an
 * opt-out row, because "we recorded the complaint" and "we will stop emailing
 * them" are two different claims and only the second one is the obligation.
 */
export async function handleMailgunDeliveryEvent({ db, body, signingKey }) {
  const evt = normalizeDeliveryEvent(body);

  /* FAIL CLOSED, UNCONDITIONALLY — no `if (signingKey)` guard, ever.

     That guard is the exact shape of the bug this ticket was written to kill on
     the inbound path: with the key unset, verification was skipped entirely and
     any stranger could POST a forged payload. On THIS path a forged payload
     opts a client out of email, or marks a live message dead. Passing no key
     must therefore reject everything, which is what verifyMailgunSignature
     already does — the bug was never calling it. */
  if (!verifyMailgunSignature(evt.timestamp, evt.token, evt.signature, signingKey)) {
    return { ok: false, status: 401, reason: "bad_signature", updated: 0 };
  }

  if (IGNORED_DELIVERY_EVENTS.has(evt.event)) {
    return { ok: true, status: 200, reason: "not_delivery_state", updated: 0, event: evt.event };
  }

  let mapped = DELIVERY_STATUS_MAP[evt.event];
  if (evt.event === "failed") {
    // Mailgun splits hard bounces from transient ones by severity, and the two
    // mean different things to a dispatcher: one must never be retried, the
    // other should be. An absent severity is treated as temporary — the safe
    // direction, because wrongly marking an address permanently dead loses a
    // client's mail silently.
    mapped = evt.severity === "permanent" ? "bounced" : "failed";
  }
  if (!mapped) {
    return { ok: true, status: 200, reason: "unknown_event", updated: 0, event: evt.event };
  }

  // Matched on THEIR id, both sides stripped of angle brackets. Guarded to
  // outbound email so a colliding id cannot move a row on another channel.
  const found = await db.query(
    `SELECT id, org_id, client_id, template_key
       FROM messages
      WHERE btrim(provider_message_id, '<>') = $1
        AND direction = 'outbound'
        AND channel = 'email'`,
    [evt.providerMessageId]
  );
  const row = found.rows[0] || null;

  /* THE OPT-OUT COMES FIRST, and it is the reason this endpoint exists.

     A spam complaint is a withdrawal of consent. It is written before the status
     update so that a failure updating the message row cannot cost us the
     opt-out — the wrong order here means we keep emailing somebody who reported
     us, which is the failure with legal consequences rather than operational
     ones. Written through src/lib/opt-out.mjs, the only sanctioned writer, so
     the send-path guard reads it without a second implementation to diverge. */
  let optedOut = false;
  let taskRaised = false;
  if (evt.event === "complained") {
    const target = row && row.client_id
      ? { clientId: row.client_id, orgId: row.org_id }
      : await resolveClientByEmail(db, evt.recipient);
    if (target) {
      await recordOptOut(db, target.clientId, target.orgId, "email", "provider_complaint");
      optedOut = true;
      taskRaised = await raiseComplaintTask(db, target, row, evt);
    }
  }

  if (!row) {
    /* No message row. Acknowledged so Mailgun stops retrying, but named — an
       unmatched receipt usually means the dispatcher never stored
       provider_message_id, and a bare 200 would hide that indefinitely.
       A complaint may still have opted the recipient out via the email
       fallback above, so that outcome is reported separately from this one. */
    return { ok: true, status: 200, reason: "unmatched", updated: 0, event: evt.event, optedOut, taskRaised };
  }

  const upd = await db.query(
    `UPDATE messages
        SET status = $2,
            last_error = COALESCE($3, last_error),
            updated_at = now()
      WHERE id = $1`,
    [row.id, mapped, evt.errorText]
  );

  return { ok: true, status: 200, updated: upd.rowCount ?? 0, event: evt.event, optedOut, taskRaised };
}

/* A complaint is a signal about a TEMPLATE, not only about one recipient.

   Opting the person out and telling nobody treats it as a single lost contact.
   It is usually the copy: if a template draws complaints, the next hundred sends
   of it will draw more, and nobody finds that out from an opt_outs row. So the
   complaint raises work for a person, the same way the compliance gate raises
   work when a message uses restricted wording.

   Built through createTask, which is the only sanctioned writer to the tasks
   table (src/lib/create-task.mjs) — src/workflows/task-routing.test.mjs fails
   the build on a raw insert into it anywhere under src/, because a task with no
   owning role is work that reaches nobody. That test greps the file text, so
   this comment says it in words rather than showing the statement.

   THE DEDUPE KEY IS `body`. 006_tasks_idempotency.sql keys on
   (client_id, source_workflow, body), so it must be identical when Mailgun
   retries the same complaint and different for a genuinely new one. The
   provider's message id is exactly that. When the receipt matched no message
   row, the recipient address stands in — one task per complaining address
   rather than one per retry.

   NO MESSAGE COPY IN THE TASK. Same reasoning as the gate: a task list is an
   index over work, not a second outbox holding client-facing text. The template
   key is named instead, because that is the thing to go and read. */
async function raiseComplaintTask(db, target, row, evt) {
  const res = await createTask(db, {
    orgId: target.orgId,
    clientId: target.clientId,
    title: "Spam complaint — review the template that sent this",
    sourceWorkflow: COMPLAINT_SOURCE,
    assigneeRole: COMPLAINT_TASK_ROLE,
    body: `mailgun-complaint:${evt.providerMessageId || evt.recipient || "unattributed"}`,
    detail: [
      row?.template_key
        ? `Template: ${row.template_key}`
        : "Template unknown — the complaint matched no message row.",
      "The recipient has been opted out of email automatically."
    ]
  });
  return !!res?.created;
}

/* Last resort for a complaint we cannot tie to a message row. A complaint that
   names a recipient we know is still a withdrawal of consent; dropping it
   because the message id did not match would be the system forgetting on a
   technicality. Returns null when the address is unknown — there is no client to
   opt out, and inventing one is worse than recording nothing. */
async function resolveClientByEmail(db, recipient) {
  const email = String(recipient || "").trim().toLowerCase();
  if (!email) return null;
  const r = await db.query(
    `SELECT id, org_id FROM clients WHERE lower(email) = $1 LIMIT 1`,
    [email]
  );
  const c = r.rows[0];
  return c ? { clientId: c.id, orgId: c.org_id } : null;
}

// ---------------------------------------------------------------------------
// Adapter entrypoint
// handleMailgunWebhook({ db, body, signingKey })
//   → { ok, status, emitted: [{name, id, deduped}], reason? }
// ---------------------------------------------------------------------------
export async function handleMailgunWebhook({ db, body, signingKey }) {
  /* OUTBOUND EVENT ROUTING — GHL cutover Ticket 2.

     Mailgun posts two completely different payloads and this adapter used to
     assume every one of them was a forwarded bank email. A delivery receipt has
     no subject and no body, so classifyFull() scored it NOISE and emitted it
     onto the bus as a real `mail.response`. Delivery receipts, bounces and spam
     complaints were therefore arriving as inbound bank mail — and the spam
     complaints, which are the ones that legally have to stop future sending,
     were the quietest of the three because NOISE is the classification nothing
     reacts to.

     Routed before verification because the delivery path verifies with the same
     key and the same function; splitting first keeps one signature check per
     path rather than one shared check and two shapes. */
  if (isDeliveryEvent(body)) {
    return handleMailgunDeliveryEvent({ db, body, signingKey });
  }

  const evt = normalizeMailgunEvent(body);

  /* FAIL CLOSED, unconditionally — matching every other adapter.

     This used to be wrapped in `if (signingKey)`, so an absent MAILGUN_SIGNING_KEY
     skipped verification altogether and ANY caller could POST a forged payload
     and have it emitted onto the canonical event bus as a real mail.response.
     .env.example ships the key blank and APPLY-NOTES never mentions it, so that
     was the shipped configuration, not a hypothetical.

     verifyMailgunSignature already returns false for a missing key; the bug was
     never calling it. commas/twilio/calcom/bland/clickfunnels all fail closed —
     mailgun was the sole exception, and the file's own header comment claimed
     otherwise. */
  if (!verifyMailgunSignature(evt.timestamp, evt.token, evt.signature, signingKey)) {
    return { ok: false, status: 401, reason: "bad_signature", emitted: [] };
  }

  const { event_type: classification } = classifyFull({
    subject: evt.subject,
    from: evt.from,
    body: evt.text
  });

  const canonical = mapToCanonical(evt);
  const emitted = [];
  const clientId = await resolveClientFromRecipient(db, evt.recipient);

  for (const c of canonical) {
    const payload = {
      classification,
      from: evt.from,
      to: evt.recipient,
      subject: evt.subject,
      clientId,
      source: "mailgun"
    };
    const idKey = evt.messageId ? `mailgun:${evt.messageId}:${c.name}` : undefined;
    const res = await emit(db, c.name, payload, { idempotencyKey: idKey, clientId: clientId || undefined });
    emitted.push({ name: c.name, id: res.id, deduped: res.deduped });
  }

  /* ── A CLIENT REPLYING TO US — the inbound half of the staff reply inbox ──
     Emitted IN ADDITION TO mail.response above, never instead of it, and only
     when the From address matches a client record. See resolveClientFromSender
     for why that condition is the whole of the distinction between "a bank sent
     a statement about this person" and "this person wrote to us".

     WHY message.inbound RATHER THAN A NEW EVENT NAME. src/handlers/comms.mjs
     onMessageInbound already writes the `messages` row, threads it onto the
     client's conversation for that channel, and dedupes on (org, provider_ref).
     It reads the channel off the payload rather than assuming SMS, so an email
     runs the same code path an inbound text does — one handler, one threading
     rule, one dedupe. A second event name would be a second copy of that, and
     the two would drift.

     The TCPA STOP/START branch inside that handler is guarded on
     `channel === "sms"` and so does not fire here, which is correct: "STOP" in
     an email subject line is not a TCPA opt-out keyword, and treating it as one
     would silence a channel the consumer never asked us to stop using.

     `sid` carries the Message-Id because that is the field onMessageInbound
     writes to provider_ref — so a Mailgun redelivery of the same email lands on
     the (org_id, provider_ref) unique index and does not become a second
     message in the thread. An email with no Message-Id gets no dedupe key,
     which the bus already handles the same way for mail.response.

     THE BODY IS CARRIED, and only here. `mail.response` deliberately does not
     carry one — onMailResponse stores `subject` as its own body_preview because
     a forwarded bank statement's text is account detail nobody asked us to
     keep. This payload is a person's own words written to us, which is exactly
     what a conversation thread is, and a thread with the messages missing is
     not a thread. */
  const sender = await resolveClientFromSender(db, evt.from);
  if (sender) {
    const inboundKey = evt.messageId ? `mailgun:${evt.messageId}:message.inbound` : undefined;
    const res = await emit(db, "message.inbound", {
      from: evt.from,
      to: evt.recipient,
      body: evt.text,
      subject: evt.subject,
      sid: evt.messageId,
      channel: "email",
      source: "mailgun"
    }, { idempotencyKey: inboundKey, orgId: sender.orgId, clientId: sender.clientId });
    emitted.push({ name: "message.inbound", id: res.id, deduped: res.deduped });
  }

  return { ok: true, status: 200, emitted };
}
