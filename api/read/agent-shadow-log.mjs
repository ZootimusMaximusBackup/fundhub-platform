// GET /api/read/agent-shadow-log?code=<AGENT_CODE>[&limit=]
//
// AE-08 on the agent editor. Newest shadow / would-be runs for one agent
// (or the whole org when code is omitted).

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, redact } from "../../src/http/read-api.mjs";
import { listShadow, toEditorRows } from "../../src/agents/shadow-log.mjs";

export async function run(req, res, { db, requireAuth }) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id || null;
  if (!orgId) {
    return res.status(200).json({ ok: true, rows: [], log: [] });
  }

  const q = req.query || {};
  const limit = Math.min(Math.max(parseInt(q.limit || "50", 10) || 50, 1), 200);
  const code = q.code ? String(q.code).trim().toUpperCase() : null;

  // Session org only — listShadow binds org_id = $1 and refuses without it.
  const rows = await listShadow(db, { orgId: staff.org_id, agentCode: code, limit });
  return res.status(200).json({
    ok: true,
    rows: redact(rows),
    log: toEditorRows(rows)
  });
}

export default (req, res) => run(req, res, { db, requireAuth });
