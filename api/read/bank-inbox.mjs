// GET /api/read/bank-inbox?client_id=<uuid> — bank messages for one client.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, ROLE_SETS, isUuid, page, pageParams } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { requireSessionOrg } from "../../src/http/session-org.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { safeError } from "../../src/http/health.mjs";

export function listBankInbox(query, { orgId, clientId, limit, offset }) {
  return query(
    `SELECT id, client_id, classification, subject, body_preview,
            created_at AS received_at
       FROM bank_inbox
      WHERE org_id = $1::uuid
        AND client_id = $2::uuid
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4`,
    [orgId, clientId, limit + 1, offset]
  );
}

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;
  const orgId = requireSessionOrg(res, staff);
  if (!orgId) return;

  const clientId = String(req.query?.client_id || "").trim();
  if (!isUuid(clientId)) {
    return res.status(400).json({
      ok: false,
      error: "client_id_required",
      message: "Open Bank Inbox from a client file."
    });
  }
  if (!await requireClientInOrg(res, db, staff, clientId)) return;

  const paging = pageParams(req.query || {});
  try {
    const result = await listBankInbox(db.query, {
      orgId, clientId, limit: paging.limit, offset: paging.offset
    });
    return res.status(200).json({ ok: true, ...page(result.rows, paging) });
  } catch (err) {
    if (dbDown(err)) {
      return res.status(503).json({ ok: false, error: "database_unavailable", db: "down" });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
