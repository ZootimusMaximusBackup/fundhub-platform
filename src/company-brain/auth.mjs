// Service-account JWT → Google access token (Drive readonly).
// Uses node:crypto only — no googleapis package.

import crypto from "node:crypto";
import { DRIVE_READONLY_SCOPE, GOOGLE_TOKEN_URL } from "./config.mjs";

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Build a signed RS256 JWT for the service account.
 * `sub` is the Workspace user to impersonate (domain-wide delegation).
 */
export function buildServiceAccountJwt({
  clientEmail,
  privateKey,
  delegateEmail,
  scope = DRIVE_READONLY_SCOPE,
  nowSec = Math.floor(Date.now() / 1000),
  lifetimeSec = 3600
} = {}) {
  if (!clientEmail || !privateKey) {
    throw new Error("buildServiceAccountJwt requires clientEmail and privateKey");
  }
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimBody = {
    iss: clientEmail,
    scope,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + lifetimeSec
  };
  // `sub` is domain-wide delegation. Omit it and the robot acts as itself
  // (files must be shared with the service-account email).
  if (delegateEmail) claimBody.sub = delegateEmail;
  const claim = b64url(JSON.stringify(claimBody));
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const sig = b64url(signer.sign(privateKey));
  return `${unsigned}.${sig}`;
}

/**
 * Exchange a JWT for an access token.
 * `fetchImpl` is injectable for tests.
 */
export async function fetchAccessToken({
  clientEmail,
  privateKey,
  delegateEmail,
  fetchImpl = globalThis.fetch,
  nowSec
} = {}) {
  const assertion = buildServiceAccountJwt({
    clientEmail, privateKey, delegateEmail, nowSec
  });
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`token exchange returned non-json (${res.status})`);
  }
  if (!res.ok || !json.access_token) {
    const err = json.error || json.error_description || text.slice(0, 200);
    throw new Error(`token exchange failed (${res.status}): ${err}`);
  }
  return {
    accessToken: json.access_token,
    expiresIn: Number(json.expires_in) || 3600,
    tokenType: json.token_type || "Bearer"
  };
}

/**
 * Refresh a personal OAuth token (desktop app flow).
 * Used when Drive is accessed as a Gmail user, not a service account.
 */
export async function fetchOAuthAccessToken({
  refreshToken,
  clientId,
  clientSecret,
  tokenUri = GOOGLE_TOKEN_URL,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("fetchOAuthAccessToken requires refreshToken, clientId, and clientSecret");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret
  });
  const res = await fetchImpl(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`oauth token refresh returned non-json (${res.status})`);
  }
  if (!res.ok || !json.access_token) {
    const err = json.error || json.error_description || text.slice(0, 200);
    throw new Error(`oauth token refresh failed (${res.status}): ${err}`);
  }
  return {
    accessToken: json.access_token,
    expiresIn: Number(json.expires_in) || 3600,
    tokenType: json.token_type || "Bearer"
  };
}
