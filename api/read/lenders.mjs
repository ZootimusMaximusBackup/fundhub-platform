// GET /api/read/lenders — list / filter the lender database.
//
// Empty until CSV import. Never invents lender rows.
// ROLE_SETS.LENDERS — owner, admin and the funding advisor only. Chris's call,
// 2026-08-17: the lender book is not for the rest of the floor.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { listLenders, exportLendersCsv } from "../../src/lenders/store.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { LENDER_TABLES } from "../../src/lenders/tables.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.LENDERS)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const q = req.query || {};
  const format = String(q.format || "").toLowerCase();

  try {
    if (format === "csv") {
      const csv = await exportLendersCsv(database, {
        orgId: staff.org_id,
        lender_table: q.lender_table || null,
        bureau: q.bureau || null,
        priority_tier: q.priority_tier || null,
        active: q.active == null || q.active === "" ? null : q.active,
        state: q.state || null,
        q: q.q || null,
        limit: 500
      });
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader("content-disposition", 'attachment; filename="lenders.csv"');
      return res.status(200).send(csv);
    }

    const lenders = await listLenders(database, {
      orgId: staff.org_id,
      lender_table: q.lender_table || null,
      bureau: q.bureau || null,
      priority_tier: q.priority_tier || null,
      active: q.active == null || q.active === "" ? null : q.active,
      state: q.state || null,
      q: q.q || null,
      limit: q.limit == null || q.limit === "" ? 500 : q.limit,
      offset: q.offset
    });

    return res.status(200).json({
      ok: true,
      lenders,
      meta: {
        count: lenders.length,
        lender_tables: LENDER_TABLES,
        empty: lenders.length === 0
      }
    });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
