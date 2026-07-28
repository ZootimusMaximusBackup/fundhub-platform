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
// Adapter entrypoint
// handleMailgunWebhook({ db, body, signingKey })
//   → { ok, status, emitted: [{name, id, deduped}], reason? }
// ---------------------------------------------------------------------------
export async function handleMailgunWebhook({ db, body, signingKey }) {
  const evt = normalizeMailgunEvent(body);

  // Verify — fail-closed only when signingKey is set
  if (signingKey) {
    if (!verifyMailgunSignature(evt.timestamp, evt.token, evt.signature, signingKey)) {
      return { ok: false, status: 401, reason: "bad_signature", emitted: [] };
    }
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

  return { ok: true, status: 200, emitted };
}
