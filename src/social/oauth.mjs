// Social channel OAuth helpers — Meta (FB/IG page tokens) + LinkedIn org posts.
// Credentials stay unset until the owner provisions apps (see docs/STILL-MISSING.md).

import crypto from "node:crypto";
import { encryptToken } from "../adplatforms/tokens.mjs";

const META_GRAPH = "https://graph.facebook.com/v21.0";
const LI_AUTH = "https://www.linkedin.com/oauth/v2/authorization";
const LI_TOKEN = "https://www.linkedin.com/oauth/v2/accessToken";

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

// No default secret. An unset key must stop the flow, never sign state with a
// guessable fallback string — same fail-closed rule as tokens.mjs's keyFor().
function stateSecret(env = process.env) {
  return env.AD_TOKEN_ENC_KEY || env.SESSION_SECRET || null;
}

export function signState(payload, env = process.env) {
  const secret = stateSecret(env);
  if (!secret) return null;
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state, env = process.env) {
  const secret = stateSecret(env);
  if (!secret) return null;
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) return null;
  const expect = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (parsed.exp && Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function metaAuthUrl({ appId, redirectUri, state, scopes } = {}) {
  if (!appId) return { ok: false, reason: "not_configured", missing: ["META_APP_ID"] };
  const scope = (scopes || [
    "pages_show_list", "pages_manage_posts", "pages_read_engagement",
    "instagram_basic", "instagram_content_publish"
  ]).join(",");
  const dialog = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  dialog.searchParams.set("client_id", appId);
  dialog.searchParams.set("redirect_uri", redirectUri);
  dialog.searchParams.set("state", state);
  dialog.searchParams.set("scope", scope);
  dialog.searchParams.set("response_type", "code");
  return { ok: true, url: dialog.toString() };
}

export function linkedinAuthUrl({ clientId, redirectUri, state, scopes } = {}) {
  if (!clientId) return { ok: false, reason: "not_configured", missing: ["LINKEDIN_CLIENT_ID"] };
  const scope = (scopes || ["openid", "profile", "email", "w_member_social"]).join(" ");
  const u = new URL(LI_AUTH);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", scope);
  return { ok: true, url: u.toString() };
}

export async function exchangeMetaCode({ code, redirectUri, env = process.env, fetchImpl } = {}) {
  const appId = env.META_APP_ID;
  const secret = env.META_APP_SECRET;
  if (!appId || !secret) {
    return { ok: false, reason: "not_configured", missing: ["META_APP_ID", "META_APP_SECRET"].filter((k) => !env[k]) };
  }
  const doFetch = fetchImpl || fetch;
  const tokenUrl = new URL(`${META_GRAPH}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", secret);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);
  const tokRes = await doFetch(tokenUrl.toString());
  const tok = await tokRes.json().catch(() => ({}));
  if (!tok.access_token) return { ok: false, reason: "token_exchange_failed", detail: tok };

  const pagesRes = await doFetch(
    `${META_GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(tok.access_token)}`
  );
  const pages = await pagesRes.json().catch(() => ({}));
  return {
    ok: true,
    userToken: tok.access_token,
    expiresIn: tok.expires_in || null,
    pages: pages.data || []
  };
}

export async function exchangeLinkedInCode({ code, redirectUri, env = process.env, fetchImpl } = {}) {
  const clientId = env.LINKEDIN_CLIENT_ID;
  const clientSecret = env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      reason: "not_configured",
      missing: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"].filter((k) => !env[k])
    };
  }
  const doFetch = fetchImpl || fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret
  });
  const res = await doFetch(LI_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const json = await res.json().catch(() => ({}));
  if (!json.access_token) return { ok: false, reason: "token_exchange_failed", detail: json };
  return {
    ok: true,
    accessToken: json.access_token,
    expiresIn: json.expires_in || null,
    refreshToken: json.refresh_token || null
  };
}

export function encryptChannelToken(plaintext, { partnerId, env } = {}) {
  return encryptToken(plaintext, { partnerId, env });
}

export default {
  signState, verifyState, metaAuthUrl, linkedinAuthUrl,
  exchangeMetaCode, exchangeLinkedInCode, encryptChannelToken
};
