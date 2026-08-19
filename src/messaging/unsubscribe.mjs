// One-click unsubscribe links for outbound email.
//
// SAME SHAPE AS EVERY OTHER CONSUMER-FACING LINK IN THIS REPO, deliberately:
// src/documents/signed-url.mjs was copied to src/consent/approve-token.mjs and
// again to src/contracts/signed-link.mjs, and this is the fourth. The person
// clicking is not signed in and never will be, so the HMAC and its expiry ARE
// the credential.
//
//   /unsubscribe.html?org=<uuid>&client=<uuid>&channel=email&exp=<unix>&sig=<hex>
//
// WHY THIS EXISTS AT ALL (T5-14, T5-15). Measured against production on
// 2026-08-18: 173 email templates contain the word "Unsubscribe" and ZERO of
// them contain any URL whatsoever, and /unsubscribe and /api/unsubscribe both
// answered 404. Every marketing email told the reader they could unsubscribe
// and not one of them gave them a way to do it.
//
// INHERITED FROM THE PATTERN, ALL DELIBERATE:
//
//   - FAIL CLOSED with no secret. No secret, no links.
//   - Constant-time signature comparison.
//   - A bad signature, an expired link and a tampered id are ALL the same
//     answer. Distinguishing them turns the endpoint into an oracle for which
//     client ids exist.
//
// WHAT IS DIFFERENT, AND WHY:
//
//   SCHEME "unsub-v1". Domain separation. The scheme is the first field of the
//   signed string, so a document link, a soft-pull consent link and a contract
//   link can never verify as an unsubscribe link even when the same secret
//   signs them all — and, far more importantly, an unsubscribe link can never
//   be replayed as a consent link. Those two mean opposite things.
//
//   THE CHANNEL IS SIGNED. It is a field in the canonical string rather than a
//   constant, so a link minted for email cannot be edited in the address bar
//   into one that silences the client's texts as well. Today only email mints
//   these; the field is what stops the URL being widened by hand.
//
//   TTL IS A YEAR, NOT THIRTY DAYS. CAN-SPAM sets the floor at 30 days after
//   the message was sent. A contract link is 30 days because somebody either
//   signs it or they do not; an unsubscribe link sits in an archived mailbox
//   and has to still work the day they finally get annoyed enough to press it.
//   A dead unsubscribe link is the defect this file exists to fix, so the
//   expiry is set well past the obligation rather than at it.

import { createHmac, timingSafeEqual } from "node:crypto";

export const UNSUBSCRIBE_TTL_SECONDS = 60 * 60 * 24 * 365;      // 1 year
export const UNSUBSCRIBE_MAX_TTL_SECONDS = 60 * 60 * 24 * 400;  // hard cap
export const UNSUBSCRIBE_PATH = "/unsubscribe.html";
const SCHEME = "unsub-v1";

/* The source string written to opt_outs.source when somebody uses the link.
   Distinct from 'provider_unsubscribe' (the mail provider told us) and from
   'inbound_keyword' (they replied STOP), because an operator reading that
   column needs to know which of the three actually happened. */
export const UNSUBSCRIBE_LINK_SOURCE = "unsubscribe_link";

/**
 * The signing secret. Fail closed: no secret, no links.
 *
 * UNSUBSCRIBE_TOKEN_SECRET first, DOCUMENT_URL_SECRET as a fallback — the same
 * arrangement src/contracts/signed-link.mjs uses for CONTRACT_URL_SECRET, and
 * for the same reason: it is one fewer thing an operator has to set for the
 * feature to work at all, and it leaks nothing because SCHEME above
 * domain-separates the signature spaces. A dedicated UNSUBSCRIBE_TOKEN_SECRET
 * is the recommended posture and is what production is set to use.
 */
export function unsubscribeSecret(env = process.env) {
  const secret = env.UNSUBSCRIBE_TOKEN_SECRET || env.DOCUMENT_URL_SECRET;
  if (!secret || String(secret).length < 32) {
    throw new Error(
      "UNSUBSCRIBE_TOKEN_SECRET is missing or too short (need >= 32 chars) — refusing " +
      "to sign unsubscribe links. Generate one with: openssl rand -hex 32");
  }
  return secret;
}

/* Canonical string. Field order is fixed and "|" cannot appear in a uuid, in a
   channel name or in a decimal timestamp, so no two distinct payloads can
   produce the same input to the HMAC. */
const canonical = ({ orgId, clientId, channel, expiresAt }) =>
  [SCHEME, orgId, clientId, channel, expiresAt].join("|");

export function signature({ orgId, clientId, channel, expiresAt, secret }) {
  return createHmac("sha256", secret)
    .update(canonical({ orgId, clientId, channel, expiresAt }))
    .digest("hex");
}

/**
 * signUnsubscribeUrl — mint the link that goes in the footer.
 *
 * `now` is injectable so tests pin the clock without sleeping.
 * Returns { url, path, expiresAt, expiresAtIso }.
 *
 * The page lives at the SITE ROOT, not under public/app/. Everything under
 * public/app/ loads shell.js, which demands a session and bounces anybody
 * without one — and a person unsubscribing has no session and must never be
 * made to create one to get out of a mailing list.
 */
export function signUnsubscribeUrl({
  orgId,
  clientId,
  channel = "email",
  ttlSeconds = UNSUBSCRIBE_TTL_SECONDS,
  secret = undefined,
  baseUrl = null,
  env = process.env,
  now = Date.now
} = {}) {
  if (!orgId || !clientId) throw new Error("signUnsubscribeUrl requires orgId and clientId");
  if (!channel) throw new Error("signUnsubscribeUrl requires a channel");

  const ttl = Number(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error("ttlSeconds must be a positive number");
  if (ttl > UNSUBSCRIBE_MAX_TTL_SECONDS) {
    throw new Error(`ttlSeconds ${ttl} exceeds the ${UNSUBSCRIBE_MAX_TTL_SECONDS}s maximum`);
  }

  const key = secret ?? unsubscribeSecret(env);
  const expiresAt = Math.floor(now() / 1000) + Math.floor(ttl);
  const sig = signature({ orgId, clientId, channel, expiresAt, secret: key });

  const params = new URLSearchParams();
  params.set("org", String(orgId));
  params.set("client", String(clientId));
  params.set("channel", String(channel));
  params.set("exp", String(expiresAt));
  params.set("sig", sig);

  const path = `${UNSUBSCRIBE_PATH}?${params.toString()}`;
  return {
    url: baseUrl ? `${String(baseUrl).replace(/\/+$/, "")}${path}` : path,
    path,
    expiresAt,
    expiresAtIso: new Date(expiresAt * 1000).toISOString()
  };
}

/**
 * verifyUnsubscribeToken — the payload, or null. Never throws: a malformed
 * link is an invalid link, not a 500.
 */
export function verifyUnsubscribeToken({
  orgId, clientId, channel, exp, sig, secret = undefined, env = process.env, now = Date.now
} = {}) {
  if (!orgId || !clientId || !channel || !exp || !sig) return null;
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt)) return null;

  let key;
  try { key = secret ?? unsubscribeSecret(env); } catch { return null; }

  /* Signature BEFORE expiry, so the failure reason cannot be used to probe
     which half of a forged link was wrong. */
  const expected = signature({ orgId, clientId, channel, expiresAt, secret: key });
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(sig), "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (Math.floor(now() / 1000) > expiresAt) return null;

  return {
    orgId: String(orgId),
    clientId: String(clientId),
    channel: String(channel),
    expiresAt
  };
}

/** Parse + verify straight from a request URL or a query object. */
export function verifyUnsubscribeRequest(source, { secret = undefined, env = process.env, now = Date.now } = {}) {
  let q = source;
  if (typeof source === "string") {
    try {
      q = Object.fromEntries(new URL(source, "http://internal.invalid").searchParams);
    } catch {
      return null;
    }
  }
  if (!q || typeof q !== "object") return null;
  return verifyUnsubscribeToken({
    orgId: q.org, clientId: q.client, channel: q.channel, exp: q.exp, sig: q.sig, secret, env, now
  });
}

/* ── The footer ───────────────────────────────────────────────────────────
   Built here rather than in a provider. The provider contract
   (src/messaging/providers/mailgun.mjs:12-15) is that a provider "never
   mutates the message. No truncation, no appended footer", and three tests
   hold it to that. So the visible line is appended upstream, at dispatch, and
   the provider still sends exactly what it is handed.

   TWO SHAPES, because the Resend provider decides between html and text by
   sniffing the body (src/messaging/providers/resend.mjs:134). A raw <a href>
   appended to a body that sniffs as plain text would be shown to the reader as
   literal angle brackets — a visibly broken link, which is worse than the
   missing one it replaced. */
const HTML_SNIFF = /<!DOCTYPE\s+html|<html[\s>]|<table[\s>]/i;

export function unsubscribeFooter(url, { html = false } = {}) {
  const safe = String(url || "");
  if (!safe) return "";
  return html
    ? `\n<p style="margin:24px 0 0;font:400 12px/1.6 Arial,Helvetica,sans-serif;color:#6b7280">` +
      `Don't want these emails? <a href="${escapeHtml(safe)}" style="color:#6b7280">Unsubscribe</a>.</p>\n`
    : `\n\n---\nDon't want these emails? Unsubscribe: ${safe}`;
}

/** Append the footer to a body in whichever shape that body already is. */
export function withUnsubscribeFooter(body, url) {
  const text = String(body ?? "");
  if (!url) return text;
  if (text.includes(String(url))) return text; // already carries its own link
  return text + unsubscribeFooter(url, { html: HTML_SNIFF.test(text) });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
