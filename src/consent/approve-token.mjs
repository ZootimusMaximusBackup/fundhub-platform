// Signed soft-pull approval links emailed from the Present cockpit.
//
// Same shape as document signed URLs (src/documents/signed-url.mjs): the URL is
// the credential. No session required. Client opens the link on the Google Meet
// call, grants soft-pull consent, and enters identity for the CRS pull.
//
// Secret: DOCUMENT_URL_SECRET (already required for emailed document links).
// Scheme prefix is different so a document sig cannot open a soft-pull form.

import { createHmac, timingSafeEqual } from "node:crypto";
import { secretFromEnv } from "../documents/signed-url.mjs";

export const APPROVE_TTL_SECONDS = 60 * 60 * 6; // 6 hours — long enough for a live call + follow-up
export const APPROVE_MAX_TTL_SECONDS = 60 * 60 * 24; // 24h hard cap
const SCHEME = "softpull-v1";

const canonical = ({ orgId, clientId, expiresAt }) =>
  [SCHEME, orgId, clientId, expiresAt].join("|");

export function signature({ orgId, clientId, expiresAt, secret }) {
  return createHmac("sha256", secret)
    .update(canonical({ orgId, clientId, expiresAt }))
    .digest("hex");
}

/**
 * signSoftPullApproveUrl — mint the client-facing approval link.
 * Returns { url, path, expiresAt, expiresAtIso }.
 */
export function signSoftPullApproveUrl({
  orgId,
  clientId,
  ttlSeconds = APPROVE_TTL_SECONDS,
  secret = undefined,
  baseUrl = null,
  now = Date.now
} = {}) {
  if (!orgId || !clientId) throw new Error("signSoftPullApproveUrl requires orgId and clientId");
  const ttl = Number(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error("ttlSeconds must be a positive number");
  if (ttl > APPROVE_MAX_TTL_SECONDS) {
    throw new Error(`ttlSeconds ${ttl} exceeds the ${APPROVE_MAX_TTL_SECONDS}s maximum`);
  }

  const key = secret ?? secretFromEnv();
  const expiresAt = Math.floor(now() / 1000) + Math.floor(ttl);
  const sig = signature({ orgId, clientId, expiresAt, secret: key });

  const params = new URLSearchParams();
  params.set("org", orgId);
  params.set("client", clientId);
  params.set("exp", String(expiresAt));
  params.set("sig", sig);

  const path = `/app/soft-pull-approve.html?${params.toString()}`;
  const url = baseUrl ? `${String(baseUrl).replace(/\/$/, "")}${path}` : path;
  return {
    url,
    path,
    expiresAt,
    expiresAtIso: new Date(expiresAt * 1000).toISOString()
  };
}

/**
 * verifySoftPullApproveToken — true payload or null. Fail closed on anything
 * off: bad/missing fields, expired, tampered. Timing-safe compare on the sig.
 */
export function verifySoftPullApproveToken({
  orgId,
  clientId,
  exp,
  sig,
  secret = undefined,
  now = Date.now
} = {}) {
  if (!orgId || !clientId || !exp || !sig) return null;
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt)) return null;
  if (expiresAt * 1000 < now()) return null;

  let key;
  try {
    key = secret ?? secretFromEnv();
  } catch {
    return null;
  }

  const expected = signature({ orgId, clientId, expiresAt, secret: key });
  const a = Buffer.from(String(sig), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return { orgId: String(orgId), clientId: String(clientId), expiresAt };
}
