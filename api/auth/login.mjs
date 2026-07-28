// POST /api/auth/login  { email, password }
// → 200 { ok, token, expiresAt, staff }  + Set-Cookie fundhub_session
// → 400/401/403/429 { ok:false, error }
//
// Thin mount over src/auth/login.mjs — all rate limiting, decoy hashing, and
// session minting live there. This file only speaks HTTP.

import { db } from "../../src/db.mjs";
import { login } from "../../src/auth/login.mjs";

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
  const out = await login(db, {
    email,
    password,
    ip: clientIp(req),
    userAgent: req.headers?.["user-agent"] || null
  });

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
  return res.status(200).json({ ok: true, token: out.token, expiresAt: out.expiresAt, staff: out.staff });
}
