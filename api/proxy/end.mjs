// POST /api/proxy/end — clear an active Oxylabs Apply session (audit end).
// Roles: owner, funding_advisor. Org-scoped. Session-authed.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { endActiveProxySession, ProxySessionError } from "../../src/proxy/launch.mjs";

// Local Set so journeys/extract.mjs can resolve the gate (imported consts are opaque to it).
const PROXY_ROLES = new Set(["owner", "funding_advisor"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await (deps.requireAuth || requireAuth)(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, PROXY_ROLES)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const body = req.body || {};
  if (!isUuid(body.session_id)) {
    return res.status(400).json({ ok: false, error: "session_id is required and must be a uuid" });
  }

  try {
    // Owners may end any org session; advisors end their own.
    const staffScope = staff.role === "owner" ? null : staff.id;
    const session = await endActiveProxySession(database, {
      orgId,
      sessionId: body.session_id,
      staffId: staffScope
    });
    return res.status(200).json({
      ok: true,
      session: {
        id: session.id,
        status: session.status,
        ended_at: session.ended_at
      },
      notice: "Session ended. Clear the Chrome extension proxy (or manual browser proxy) before browsing normally."
    });
  } catch (err) {
    if (err instanceof ProxySessionError) {
      return res.status(err.status || 400).json({
        ok: false,
        error: err.code,
        message: err.message
      });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
