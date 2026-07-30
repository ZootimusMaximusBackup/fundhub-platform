// POST /api/auth/login  { email, password }
// → 200 { ok, token, expiresAt, staff }  + Set-Cookie fundhub_session
// → 400/401/403/429 { ok:false, error }
//
// Thin mount over src/auth/login.mjs — all rate limiting, decoy hashing, and
// session minting live there. This file only speaks HTTP.

import { db } from "../../src/db.mjs";
import { login } from "../../src/auth/login.mjs";
import { loginAccount } from "../../src/auth/account-session.mjs";

function clientIp(req) {
  const xf = req.headers?.["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const { email, password } = req.body || {};
  const ip = clientIp(req);
  const userAgent = req.headers?.["user-agent"] || null;

  const out = await login(db, { email, password, ip, userAgent });

  // Not a staff member? Try the accounts table. Client, affiliate and partner
  // principals sign in through the SAME endpoint so the frontend has one form,
  // and the response carries `principal` so it knows where to route.
  //
  // Order matters only for speed, not for correctness: the two token spaces are
  // separate tables. A 429 is NOT retried against accounts — a rate limit that
  // can be sidestepped by having the second lookup answer is not a rate limit.
  if (!out.ok && out.status !== 429) {
    const acct = await loginAccount(db, { email, password, ip, userAgent });
    if (acct.ok) {
      return res.status(200).json({
        ok: true,
        token: acct.token,
        expiresAt: acct.expiresAt,
        principal: acct.principal.kind,
        account: acct.principal
      });
    }
  }

  if (!out.ok) {
    if (out.status === 429 && out.retryAfterMinutes) {
      res.setHeader("Retry-After", String(out.retryAfterMinutes * 60));
    }
    return res.status(out.status || 401).json({ ok: false, error: out.error });
  }

  const maxAge = Math.max(60, Math.floor((new Date(out.expiresAt).getTime() - Date.now()) / 1000));
  res.setHeader(
    "Set-Cookie",
    `fundhub_session=${encodeURIComponent(out.token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
  );
  return res.status(200).json({
    ok: true, token: out.token, expiresAt: out.expiresAt,
    principal: "staff", staff: out.staff
  });
}
