// POST /api/repair/enroll — closer/specialist enrolls a client in trial or full.
// Body: { client_id, program: 'trial'|'full', price_total, amount_paid }
//
// COMPLIANCE REVIEW REQUIRED — stores repair program money and fires repair.enrolled.
//
// Role gate: requireAuth then SEPARATE requireRole (CLAUDE.md §12).

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid } from "../../src/http/read-api.mjs";
import { enrollRepairProgram, RepairEnrollError } from "../../src/repair/enroll.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

const ENROLL_ROLES = new Set(["owner", "admin", "closer", "inquiry_specialist"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const auth = deps.requireAuth ?? requireAuth;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ENROLL_ROLES)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  let body = {};
  try {
    body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
  } catch {
    return res.status(400).json({ ok: false, error: "invalid_json" });
  }

  const clientId = body.client_id || body.clientId;
  if (!isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "client_id_required" });
  }

  const program = body.program;
  if (program !== "trial" && program !== "full") {
    return res.status(400).json({ ok: false, error: "invalid_program", allowed: ["trial", "full"] });
  }

  try {
    const owned = await database.query(
      `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    );
    if (!owned.rows.length) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const result = await enrollRepairProgram(database, {
      orgId,
      clientId,
      program,
      priceTotal: body.price_total ?? body.priceTotal,
      amountPaid: body.amount_paid ?? body.amountPaid ?? 0,
      staffId: staff.id
    });

    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof RepairEnrollError) {
      return res.status(err.status || 400).json({
        ok: false,
        error: err.code || "repair_enroll",
        message: err.message
      });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
