// /api/repair/exceptions — owner/admin queue for stalled repair cards + low-confidence parses.
// Extends the inquiry-remover pattern: queue list, confirm action. No specialist role.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { SUPER_ROLES } from "../../src/http/middleware/requireRole.mjs";
import { isUuid } from "../../src/http/read-api.mjs";

const ALLOWED = new Set(["owner", "admin", ...SUPER_ROLES]);

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["staff"], { db });
  if (!principal) return;
  const orgId = principal.orgId;
  const role = principal.role || principal.staffRole;
  if (!orgId || !isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "no_org_on_session" });
  }
  if (!ALLOWED.has(role) && !SUPER_ROLES.has?.(role) && !["owner", "admin"].includes(role)) {
    // SUPER_ROLES may be a Set or array depending on export — fall back
    const superList = SUPER_ROLES instanceof Set ? SUPER_ROLES : new Set(SUPER_ROLES || []);
    if (!superList.has(role) && role !== "owner" && role !== "admin") {
      return res.status(403).json({ ok: false, error: "role_forbidden" });
    }
  }

  if (req.method === "GET") {
    let stalled = [];
    let lowConfidenceParses = [];
    try {
      const s = await db.query(
        `SELECT c.id AS card_id, c.client_id, cl.email, ps.key AS stage_key, c.updated_at
           FROM cards c
           JOIN pipeline_stages ps ON ps.id = c.stage_id
           JOIN pipelines p ON p.id = c.pipeline_id AND p.key = 'optimization'
           LEFT JOIN clients cl ON cl.id = c.client_id
          WHERE c.org_id = $1 AND ps.key = 'stalled'
          ORDER BY c.updated_at DESC LIMIT 100`,
        [orgId]
      );
      stalled = s.rows;
    } catch { /* tables may not be migrated yet in some envs */ }
    try {
      const p = await db.query(
        `SELECT id, case_id, client_id, confidence, confirmed, created_at
           FROM dispute_responses
          WHERE org_id = $1 AND COALESCE(confirmed, false) = false
            AND confidence IS NOT NULL AND confidence < 0.85
          ORDER BY created_at DESC LIMIT 100`,
        [orgId]
      );
      lowConfidenceParses = p.rows;
    } catch { /* */ }
    return res.status(200).json({ ok: true, stalled, lowConfidenceParses });
  }

  if (req.method === "POST") {
    let body = {};
    try { body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}"); }
    catch { return res.status(400).json({ ok: false, error: "invalid_json" }); }
    if (body.action === "confirm_parse" && body.responseId) {
      try {
        await db.query(
          `UPDATE dispute_responses
              SET confirmed = true, confirmed_at = now(), confirmed_by = $2
            WHERE id = $1 AND org_id = $3`,
          [body.responseId, principal.staffId || null, orgId]
        );
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e.message || e) });
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: "unsupported_action" });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, error: "method_not_allowed" });
}
