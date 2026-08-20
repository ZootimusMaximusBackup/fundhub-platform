// POST /api/client-notes — save staff-only notes on one client file.
import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireRole, ROLE_SETS, isUuid } from "../src/http/read-api.mjs";
import { requireClientInOrg } from "../src/http/client-scope.mjs";
import { requireSessionOrg } from "../src/http/session-org.mjs";
import { dbDown } from "../src/http/db-down.mjs";
import { safeError } from "../src/http/health.mjs";

const MAX_NOTES = 20_000;

export function saveClientNotes(query, { orgId, clientId, notes }) {
  return query(
    `UPDATE clients
        SET custom_fields = CASE
              WHEN COALESCE(custom_fields, '{}'::jsonb) ? 'notes'
                THEN jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{notes}', to_jsonb($3::text), true)
              ELSE jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{staff_notes}', to_jsonb($3::text), true)
            END,
            updated_at = now()
      WHERE id = $1::uuid
        AND org_id = $2::uuid
    RETURNING id, COALESCE(custom_fields->>'notes', custom_fields->>'staff_notes') AS staff_notes, updated_at`,
    [clientId, orgId, notes]
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;
  const orgId = requireSessionOrg(res, staff);
  if (!orgId) return;

  const clientId = String(req.body?.client_id || "").trim();
  if (!isUuid(clientId)) {
    return res.status(400).json({
      ok: false,
      error: "client_id_required",
      message: "Open a client file before saving notes."
    });
  }
  if (!await requireClientInOrg(res, db, staff, clientId)) return;

  const notes = typeof req.body?.notes === "string" ? req.body.notes : "";
  if (notes.length > MAX_NOTES) {
    return res.status(400).json({
      ok: false,
      error: "notes_too_long",
      message: "Notes must be 20,000 characters or less."
    });
  }

  try {
    const result = await saveClientNotes(db.query, { orgId, clientId, notes });
    if (!result.rows[0]) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    return res.status(200).json({ ok: true, client: result.rows[0] });
  } catch (err) {
    if (dbDown(err)) {
      return res.status(503).json({ ok: false, error: "database_unavailable", db: "down" });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
