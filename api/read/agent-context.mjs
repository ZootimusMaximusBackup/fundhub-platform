// GET /api/read/agent-context?client_id=<uuid>[&conversation_id=][&channel=]
//
// Read-only view of exactly what the agent runtime injects into a prompt.
// Staff use this on the client control panel "Agent context" card.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, redact } from "../../src/http/read-api.mjs";
import { fetchContext } from "../../src/agents/context.mjs";

export async function run(req, res, { db, requireAuth }) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const q = req.query || {};
  if (!isUuid(q.client_id)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }
  if (q.conversation_id && !isUuid(q.conversation_id)) {
    return res.status(400).json({ ok: false, error: "conversation_id must be a uuid" });
  }

  const orgId = staff.org_id || null;
  if (!orgId) {
    return res.status(200).json({ ok: true, context: null });
  }

  // Tenancy: the client must belong to the caller's org.
  const owned = await db.query(
    `SELECT id FROM clients WHERE id = $1 AND org_id = $2`,
    [q.client_id, orgId]
  );
  if (!owned.rows[0]) {
    return res.status(404).json({ ok: false, error: "client not found" });
  }

  const context = await fetchContext(db, {
    orgId,
    clientId: q.client_id,
    conversationId: q.conversation_id || null,
    channel: q.channel || null
  });

  return res.status(200).json({ ok: true, context: redact(context) });
}

export default (req, res) => run(req, res, { db, requireAuth });
