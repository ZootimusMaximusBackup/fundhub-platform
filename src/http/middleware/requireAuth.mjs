// requireAuth — verifies a session and attaches the staff member to the request.
//
// Framework-agnostic in the same spirit as src/http/router.mjs: the pieces that
// do the work take plain values and return plain results, and only the thin
// requireAuth() wrapper touches a res object. That keeps it testable without a
// fake HTTP layer and usable from any handler shape.
//
// Attaches req.staff = { id, role, org_id, email, name, status } and
// req.session = { id, expiresAt }.
//
// 401 is clean: { ok: false, error: "unauthorized" }. No detail about WHY —
// expired, revoked, suspended and never-existed are indistinguishable to the
// caller, because the difference is only useful to someone probing.

import { db as defaultDb } from "../../db.mjs";
import { verifySession } from "../../auth/session.mjs";

// bearerToken — pulls the session token out of a request. Authorization:
// Bearer is the primary form; the x-session-token header and a fundhub_session
// cookie are accepted so a browser dashboard does not have to hold the token in
// JavaScript. Query strings are deliberately NOT accepted: they land in access
// logs, and this token is a live credential.
export function bearerToken(req) {
  const h = req?.headers || {};
  // Node lowercases incoming header names, but a serverless adapter or a test
  // may hand over the raw casing, so match without assuming either.
  const get = (n) => {
    if (h[n] !== undefined) return h[n];
    const want = String(n).toLowerCase();
    for (const k of Object.keys(h)) if (k.toLowerCase() === want) return h[k];
    return undefined;
  };

  const auth = get("authorization");
  if (typeof auth === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }

  const direct = get("x-session-token");
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const cookie = get("cookie");
  if (typeof cookie === "string") {
    for (const part of cookie.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === "fundhub_session") {
        return decodeURIComponent(part.slice(eq + 1).trim());
      }
    }
  }
  return null;
}

// authenticate — request → { staff, session } or null. Never throws: a database
// that is down produces an unauthenticated request, not a 500, so the
// shared-secret fallback in the dashboard routes still has a chance to answer.
export async function authenticate(req, { db = defaultDb, env = process.env } = {}) {
  const token = bearerToken(req);
  if (!token) return null;
  try {
    return await verifySession(db, token, { env });
  } catch {
    return null;
  }
}

// attachStaff — authenticate and, on success, hang the result off the request.
// Returns the staff object or null. Use when a route wants auth to be optional.
export async function attachStaff(req, opts = {}) {
  const result = await authenticate(req, opts);
  if (!result) return null;
  req.staff = result.staff;
  req.session = result.session;
  return result.staff;
}

// requireAuth — the gate. Returns the staff object, or writes a 401 and returns
// null. Call it as:
//
//   const staff = await requireAuth(req, res);
//   if (!staff) return;
//
export async function requireAuth(req, res, opts = {}) {
  const staff = await attachStaff(req, opts);
  if (!staff) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return null;
  }
  return staff;
}

export default requireAuth;
