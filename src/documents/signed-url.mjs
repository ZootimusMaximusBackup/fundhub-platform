// src/documents/signed-url.mjs — short-lived signed URLs for delivery.
//
// THE RULE: a raw storage key never leaves this module boundary. Under Vercel
// Blob the storage key IS a public, permanent, unguessable URL — handing one to
// a client, an email template, or a portal payload is handing out a permanent
// bearer credential to that document, revocable only by deleting the object
// (which the registry forbids). So callers get a signed URL instead:
//
//   /api/documents/<documentId>?v=<versionId>&exp=<unix>&sig=<hmac>
//
// The signature covers the document id, the version id, and the expiry. It is
// resolved by an HTTP route that verifies the signature, looks the version up,
// reads the object through the store, and streams the bytes back. The route
// lives under api/ (owned by another session) — see src/documents/README.md for
// the ~20-line handler it needs. This module owns the signing and verification.
//
// Version-pinned on purpose: a link emailed on Tuesday keeps resolving to the
// bytes that were current on Tuesday, even after a regeneration. That is the
// point of the version history — a client can always re-access what they were
// actually sent, not a silently-newer replacement.

import { createHmac, timingSafeEqual } from "node:crypto";

export const DEFAULT_TTL_SECONDS = 900;          // 15 minutes
export const MAX_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — an emailed link with a weekend in it
const SCHEME = "v1";

/** The signing secret. Fail closed: no secret, no links. */
export function secretFromEnv(env = process.env) {
  const secret = env.DOCUMENT_URL_SECRET;
  if (!secret || String(secret).length < 32) {
    throw new Error(
      "DOCUMENT_URL_SECRET is missing or too short (need >= 32 chars) — refusing to " +
      "sign document URLs. Generate one with: openssl rand -hex 32");
  }
  return secret;
}

// Canonical string. Field order is fixed and the separator cannot appear in a
// uuid, so no two distinct payloads can produce the same input to the HMAC.
const canonical = ({ documentId, versionId, expiresAt }) =>
  [SCHEME, documentId, versionId ?? "", expiresAt].join("|");

export function signature({ documentId, versionId, expiresAt, secret }) {
  return createHmac("sha256", secret)
    .update(canonical({ documentId, versionId, expiresAt }))
    .digest("hex");
}

/**
 * signDocumentUrl — mint a link.
 *
 * `now` is injectable so tests can pin the clock without sleeping.
 * Returns { url, path, expiresAt, expiresAtIso } — never a storage key.
 */
export function signDocumentUrl({
  documentId,
  versionId = null,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  secret = undefined,
  basePath = "/api/documents",
  baseUrl = null,
  now = Date.now
} = {}) {
  if (!documentId) throw new Error("signDocumentUrl requires documentId");

  const ttl = Number(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error("ttlSeconds must be a positive number");
  if (ttl > MAX_TTL_SECONDS) {
    throw new Error(`ttlSeconds ${ttl} exceeds the ${MAX_TTL_SECONDS}s maximum`);
  }

  const key = secret ?? secretFromEnv();
  const expiresAt = Math.floor(now() / 1000) + Math.floor(ttl);
  const sig = signature({ documentId, versionId, expiresAt, secret: key });

  const params = new URLSearchParams();
  if (versionId) params.set("v", versionId);
  params.set("exp", String(expiresAt));
  params.set("sig", sig);

  const path = `${basePath.replace(/\/$/, "")}/${encodeURIComponent(documentId)}?${params}`;
  return {
    url: baseUrl ? `${String(baseUrl).replace(/\/$/, "")}${path}` : path,
    path,
    expiresAt,
    expiresAtIso: new Date(expiresAt * 1000).toISOString()
  };
}

/**
 * verifyDocumentUrl — what the HTTP route calls before resolving anything.
 *
 * Returns { valid, reason, documentId, versionId, expiresAt }. Never throws on
 * bad input: a malformed link is an invalid link, not a 500. Signature is
 * checked before expiry so the failure reason cannot be used to probe which
 * part of a forged link was wrong.
 */
export function verifyDocumentUrl({
  documentId,
  versionId = null,
  expiresAt,
  sig,
  secret = undefined,
  now = Date.now
} = {}) {
  const fail = (reason) => ({ valid: false, reason, documentId: null, versionId: null, expiresAt: null });

  if (!documentId || !sig || expiresAt === undefined || expiresAt === null) {
    return fail("malformed");
  }
  const exp = Number(expiresAt);
  if (!Number.isFinite(exp)) return fail("malformed");

  let key;
  try {
    key = secret ?? secretFromEnv();
  } catch {
    return fail("no_secret");
  }

  const expected = signature({ documentId, versionId: versionId || null, expiresAt: exp, secret: key });
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(sig), "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return fail("bad_signature");

  if (Math.floor(now() / 1000) > exp) return fail("expired");

  return { valid: true, reason: null, documentId, versionId: versionId || null, expiresAt: exp };
}

/** Parse + verify straight from a request URL (query-string form). */
export function verifyDocumentRequest(urlLike, { secret = undefined, now = Date.now } = {}) {
  let parsed;
  try {
    parsed = new URL(String(urlLike), "http://internal.invalid");
  } catch {
    return { valid: false, reason: "malformed", documentId: null, versionId: null, expiresAt: null };
  }
  const documentId = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
  return verifyDocumentUrl({
    documentId,
    versionId: parsed.searchParams.get("v"),
    expiresAt: parsed.searchParams.get("exp"),
    sig: parsed.searchParams.get("sig"),
    secret,
    now
  });
}
