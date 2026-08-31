// Decline Autopsy — the signed, expiring report link.
//
// Spec §8.6: "The report link is signed and expiring. Not guessable, not
// permanent." Same shape as src/messaging/unsubscribe.mjs, deliberately: one
// signing pattern in this repo, one place to get it wrong.
//
// FAIL CLOSED. No secret, no links — never an unsigned fallback, because an
// unsigned link on a page holding somebody else's consumer records is the whole
// hazard this file exists to close.

import { createHmac, timingSafeEqual } from "node:crypto";

/* Domain separation. A signature minted for an unsubscribe link must not open a
   report, even if the two ever share a secret. */
const SCHEME = "autopsy-report-v1";

/** 30 days. Long enough that a buyer can come back to it, short enough that a
 *  link in an old inbox stops working. */
export const REPORT_TTL_SECONDS = 30 * 24 * 60 * 60;

export const REPORT_PATH = "/funnel/decline-autopsy/report.html";

/**
 * The signing secret. AUTOPSY_REPORT_SECRET first, DOCUMENT_URL_SECRET as the
 * fallback — the same arrangement src/messaging/unsubscribe.mjs and
 * src/contracts/signed-link.mjs use, and for the same reason: one fewer thing an
 * operator must set for the feature to work, and SCHEME above keeps the
 * signature spaces apart.
 */
export function autopsySecret(env = process.env) {
  const secret = env.AUTOPSY_REPORT_SECRET || env.DOCUMENT_URL_SECRET;
  if (!secret || String(secret).length < 32) {
    throw new Error(
      "AUTOPSY_REPORT_SECRET is missing or too short (need >= 32 chars) — refusing to sign " +
      "a report link. Generate one with: openssl rand -hex 32"
    );
  }
  return secret;
}

/* Fixed field order. "|" cannot appear in a uuid, in the ref format below, or in
   a decimal timestamp, so no two distinct payloads share an HMAC input. */
const canonical = ({ orgId, ref, expiresAt }) => [SCHEME, orgId, ref, expiresAt].join("|");

export function reportSignature({ orgId, ref, expiresAt, secret }) {
  return createHmac("sha256", secret).update(canonical({ orgId, ref, expiresAt })).digest("hex");
}

/**
 * signReportUrl — the link the buyer gets after his upload is scored.
 * Returns { url, path, expiresAt, expiresAtIso, sig }.
 */
export function signReportUrl({
  orgId,
  ref,
  ttlSeconds = REPORT_TTL_SECONDS,
  secret = undefined,
  baseUrl = null,
  env = process.env,
  now = Date.now
} = {}) {
  if (!orgId || !ref) throw new Error("signReportUrl requires orgId and ref");
  const ttl = Number(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error("ttlSeconds must be a positive number");

  const key = secret ?? autopsySecret(env);
  const expiresAt = Math.floor(now() / 1000) + Math.floor(ttl);
  const sig = reportSignature({ orgId, ref, expiresAt, secret: key });

  const params = new URLSearchParams();
  params.set("org", String(orgId));
  params.set("ref", String(ref));
  params.set("exp", String(expiresAt));
  params.set("sig", sig);

  const path = `${REPORT_PATH}?${params.toString()}`;
  return {
    url: baseUrl ? `${String(baseUrl).replace(/\/+$/, "")}${path}` : path,
    path,
    sig,
    expiresAt,
    expiresAtIso: new Date(expiresAt * 1000).toISOString()
  };
}

/**
 * verifyReportToken — the payload, or null. NEVER THROWS: a malformed link is an
 * invalid link, not a 500.
 *
 * Signature is checked BEFORE expiry so the failure reason cannot be used to
 * probe which half of a forged link was wrong.
 */
export function verifyReportToken({
  orgId, ref, exp, sig, secret = undefined, env = process.env, now = Date.now
} = {}) {
  if (!orgId || !ref || !exp || !sig) return null;
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt)) return null;

  let key;
  try { key = secret ?? autopsySecret(env); } catch { return null; }

  const expected = reportSignature({ orgId, ref, expiresAt, secret: key });
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(sig), "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (Math.floor(now() / 1000) > expiresAt) return null;

  return { orgId: String(orgId), ref: String(ref), expiresAt };
}

/** Verify straight from a query object or a URL string. */
export function verifyReportRequest(source, { secret = undefined, env = process.env, now = Date.now } = {}) {
  let q = source;
  if (typeof source === "string") {
    try {
      q = Object.fromEntries(new URL(source, "http://internal.invalid").searchParams);
    } catch {
      return null;
    }
  }
  if (!q || typeof q !== "object") return null;
  return verifyReportToken({
    orgId: q.org ?? q.orgId,
    ref: q.ref,
    exp: q.exp,
    sig: q.sig,
    secret, env, now
  });
}

export default { signReportUrl, verifyReportToken, verifyReportRequest, autopsySecret, REPORT_TTL_SECONDS };
