// POST /api/auth/magic-link-verify  { token }
// → 200 { ok, token, expiresAt, principal, account, next }  + Set-Cookie
// → 400/401 { ok: false, error }
//
// Exchanges an emailed link for an account session. This is the endpoint that
// actually signs a client in.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY POST, AND WHY THE EMAILED LINK DOES NOT POINT HERE.
//
// A magic link works once. Anything that opens it spends it. Mailbox providers
// and corporate mail gateways routinely follow every URL in a message to check
// it — so an emailed link pointing straight at a GET on this endpoint gets
// consumed by a scanner before the human sees the mail, and the client, doing
// nothing wrong, clicks a dead link and is told sign-in failed.
//
// So the emailed URL points at /portal-login.html?t=…, a static page. A scanner
// fetching that page consumes nothing: it is HTML. The browser that renders it
// runs the script, POSTs the token here, and strips it from the address bar.
// Requiring POST is what makes the difference real rather than conventional —
// a GET on this path is refused whatever it carries.
//
// It also keeps the credential out of the API access log. bearerToken() already
// refuses to read a session token from a query string for that reason
// (requireAuth.mjs); a sign-in token is no less of a credential.
//
// BOTH TRANSPORTS, LIKE THE PASSWORD LOGIN. api/auth/login.mjs answers with the
// token in the body AND sets the fundhub_session cookie, because the app reads
// the body into localStorage while a plain reload has only the cookie. This
// endpoint matches it exactly rather than inventing a third arrangement.
// ─────────────────────────────────────────────────────────────────────────────

import { db, dbTarget } from "../../src/db.mjs";
import { verifyMagicLink } from "../../src/auth/magic-link.mjs";
import { safeError } from "../../src/http/health.mjs";

/* Where a verified client lands. The portal screen, which public/app/shell.js
   already gates on the 'client' principal that /api/auth/session now reports. */
export const PORTAL_PATH = "/app/client-portal.html";

function clientIp(req) {
  const xf = req.headers?.["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const { token } = req.body || {};
  const ip = clientIp(req);
  const userAgent = req.headers?.["user-agent"] || null;

  let out;
  try {
    out = await verifyMagicLink(db, token, { ip, userAgent });
  } catch (err) {
    console.error(
      `auth/magic-link-verify: verification failed — ${safeError(err)}` +
      (err && err.code ? ` (code ${err.code})` : "") +
      ` — connected to ${dbTarget()}`
    );
    throw err;
  }

  if (!out.ok) {
    /* ONE REFUSAL FOR FOUR CAUSES. Forged, expired, already used, and account
       suspended all arrive here as invalid_link, decided in the service layer.
       The message names expiry and re-use because those are the two a real
       client actually hits and the fix for both is the same button — it does
       not say WHICH, so it tells a holder of a token nothing about it. */
    return res.status(out.status || 401).json({
      ok: false,
      error: out.error,
      ...(out.error === "invalid_link"
        ? { message: "That sign-in link did not work. It may have expired or already been used — ask for a new one." }
        : {})
    });
  }

  const maxAge = Math.max(60, Math.floor((new Date(out.expiresAt).getTime() - Date.now()) / 1000));
  res.setHeader(
    "Set-Cookie",
    `fundhub_session=${encodeURIComponent(out.token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
  );

  return res.status(200).json({
    ok: true,
    token: out.token,
    expiresAt: out.expiresAt,
    principal: out.principal.kind,
    account: out.principal,
    next: PORTAL_PATH
  });
}
