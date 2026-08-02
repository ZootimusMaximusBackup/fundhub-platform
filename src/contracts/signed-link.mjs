// src/contracts/signed-link.mjs — the link a client opens to sign.
//
// COPIED FROM src/documents/signed-url.mjs, deliberately and almost line for
// line. The brief said "client link uses the signed-URL pattern from
// api/documents/[id].mjs", and that pattern is right for the same reason it was
// right there: a person signing a contract is NOT signed in and never will be,
// so the HMAC and its expiry ARE the credential.
//
//   /contract.html?id=<contractId>&exp=<unix>&sig=<hex>
//
// The consequences, all deliberate and all inherited from that file:
//
//   - FAIL CLOSED with no secret. No secret, no links, and the endpoint answers
//     503 not_configured rather than opening.
//   - Constant-time signature comparison.
//   - A bad signature, an expired link and an unknown id are ALL the same 404
//     with the same body. Distinguishing them turns the endpoint into an oracle
//     for which contract ids exist.
//
// WHAT IS DIFFERENT, AND WHY:
//
//   SCHEME "c1", NOT "v1". Domain separation. The scheme is the first field of
//   the signed string, so a document link can never verify as a contract link
//   even when both are signed with the same secret — which they are by default,
//   see secretFromEnv below.
//
//   NO versionId FIELD. A document link is version-pinned so an emailed link
//   keeps resolving to the bytes that were current when it was sent. A contract
//   has exactly one body for its whole life (117_contracts.sql freezes it at
//   send), so there is no second thing to pin to.
//
//   TTL IS 30 DAYS, NOT 15 MINUTES. A document link is minted and clicked. A
//   contract link sits in an inbox over a weekend, a holiday, and the three days
//   somebody spends thinking about it. A 15-minute contract link would be
//   useless and staff would work around it by re-sending, which is worse.

import { createHmac, timingSafeEqual } from "node:crypto";

export const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;  // 30 days
export const MAX_TTL_SECONDS = 60 * 60 * 24 * 90;      // 90 days
const SCHEME = "c1";

/**
 * The signing secret. Fail closed: no secret, no links.
 *
 * CONTRACT_URL_SECRET first, DOCUMENT_URL_SECRET as a fallback. That fallback is
 * a decision, recorded in docs/CONTRACTS-SPEC.md §6: it is one fewer thing an
 * operator has to set for this feature to work at all, and it leaks nothing
 * because the SCHEME above domain-separates the two signature spaces. Setting a
 * dedicated CONTRACT_URL_SECRET is still the recommended production posture.
 */
export function secretFromEnv(env = process.env) {
  const secret = env.CONTRACT_URL_SECRET || env.DOCUMENT_URL_SECRET;
  if (!secret || String(secret).length < 32) {
    throw new Error(
      "CONTRACT_URL_SECRET is missing or too short (need >= 32 chars) — refusing to " +
      "sign contract links. Generate one with: openssl rand -hex 32");
  }
  return secret;
}

// Canonical string. Field order is fixed and "|" cannot appear in a uuid or in a
// decimal timestamp, so no two distinct payloads produce the same HMAC input.
const canonical = ({ contractId, expiresAt }) => [SCHEME, contractId, expiresAt].join("|");

export function signature({ contractId, expiresAt, secret }) {
  return createHmac("sha256", secret)
    .update(canonical({ contractId, expiresAt }))
    .digest("hex");
}

/**
 * signContractUrl — mint a link.
 *
 * `now` is injectable so tests pin the clock without sleeping.
 * Returns { url, path, expiresAt, expiresAtIso }.
 *
 * basePath is /contract.html — the page lives at the SITE ROOT, not under
 * public/app/. Everything under public/app/ loads shell.js, which demands a
 * session and bounces anybody without one; a client signing a contract has none
 * and must never be given one.
 */
export function signContractUrl({
  contractId,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  secret = undefined,
  basePath = "/contract.html",
  baseUrl = null,
  now = Date.now
} = {}) {
  if (!contractId) throw new Error("signContractUrl requires contractId");

  const ttl = Number(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error("ttlSeconds must be a positive number");
  if (ttl > MAX_TTL_SECONDS) {
    throw new Error(`ttlSeconds ${ttl} exceeds the ${MAX_TTL_SECONDS}s maximum`);
  }

  const key = secret ?? secretFromEnv();
  const expiresAt = Math.floor(now() / 1000) + Math.floor(ttl);
  const sig = signature({ contractId, expiresAt, secret: key });

  const params = new URLSearchParams();
  params.set("id", String(contractId));
  params.set("exp", String(expiresAt));
  params.set("sig", sig);

  const path = `${basePath}?${params}`;
  return {
    url: baseUrl ? `${String(baseUrl).replace(/\/$/, "")}${path}` : path,
    path,
    expiresAt,
    expiresAtIso: new Date(expiresAt * 1000).toISOString()
  };
}

/**
 * verifyContractUrl — what the endpoint calls before it looks anything up.
 *
 * Returns { valid, reason, contractId, expiresAt }. Never throws on bad input: a
 * malformed link is an invalid link, not a 500. Signature is checked BEFORE
 * expiry so the failure reason cannot be used to probe which part of a forged
 * link was wrong.
 */
export function verifyContractUrl({
  contractId, expiresAt, sig, secret = undefined, now = Date.now
} = {}) {
  const fail = (reason) => ({ valid: false, reason, contractId: null, expiresAt: null });

  if (!contractId || !sig || expiresAt === undefined || expiresAt === null) {
    return fail("malformed");
  }
  const exp = Number(expiresAt);
  if (!Number.isFinite(exp)) return fail("malformed");

  let key;
  try { key = secret ?? secretFromEnv(); } catch { return fail("no_secret"); }

  const expected = signature({ contractId, expiresAt: exp, secret: key });
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(sig), "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return fail("bad_signature");

  if (Math.floor(now() / 1000) > exp) return fail("expired");

  return { valid: true, reason: null, contractId, expiresAt: exp };
}

/** Parse + verify straight from a request URL (query-string form). */
export function verifyContractRequest(urlLike, { secret = undefined, now = Date.now } = {}) {
  let parsed;
  try {
    parsed = new URL(String(urlLike), "http://internal.invalid");
  } catch {
    return { valid: false, reason: "malformed", contractId: null, expiresAt: null };
  }
  return verifyContractUrl({
    contractId: parsed.searchParams.get("id"),
    expiresAt: parsed.searchParams.get("exp"),
    sig: parsed.searchParams.get("sig"),
    secret,
    now
  });
}
