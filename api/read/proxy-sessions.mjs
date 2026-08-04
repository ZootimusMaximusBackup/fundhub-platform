// GET /api/read/proxy-sessions — list Oxylabs Apply audit rows.
// Roles: owner, funding_advisor. Org-scoped. Session-authed.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { listProxySessions, getProxySession } from "../../src/proxy/sessions.mjs";

// Local Set so journeys/extract.mjs can resolve the gate (imported consts are opaque to it).
const PROXY_ROLES = new Set(["owner", "funding_advisor"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await (deps.requireAuth || requireAuth)(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, PROXY_ROLES)) return;

  if (!isUuid(staff.org_id)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const q = req.query || {};
  if (q.id) {
    if (!isUuid(q.id)) {
      return res.status(400).json({ ok: false, error: "id must be a uuid" });
    }
    try {
      const row = await getProxySession(database, { orgId: staff.org_id, id: q.id });
      if (!row) return res.status(404).json({ ok: false, error: "not_found" });
      // Never return proxy password; username is already an audit field.
      const { proxy_username: _pu, verification, ...safe } = row;
      return res.status(200).json({
        ok: true,
        session: {
          ...safe,
          has_proxy_username: Boolean(_pu),
          verification
        }
      });
    } catch (err) {
      if (dbDown(res, err)) return;
      throw err;
    }
  }

  if (q.client_id && !isUuid(q.client_id)) {
    return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
  }

  try {
    const result = await listProxySessions(database, {
      orgId: staff.org_id,
      clientId: q.client_id || null,
      staffId: staff.role === "owner" ? (q.staff_id || null) : staff.id,
      status: q.status || null,
      limit: q.limit,
      offset: q.offset
    });
    return res.status(200).json({
      ok: true,
      count: result.items.length,
      limit: result.limit,
      offset: result.offset,
      hasMore: result.hasMore,
      items: result.items
    });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
