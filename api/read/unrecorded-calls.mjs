// GET /api/read/unrecorded-calls — held sales calls with no tape.
// Closers see their own. FINANCE sees the floor.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import {
  ROLE_SETS, requireRole, isUuid, allowsRole, pageParams, page
} from "../../src/http/read-api.mjs";
import { listUnrecordedCalls } from "../../src/sales/unrecorded.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const authenticate = deps.requireAuth ?? requireAuth;

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await authenticate(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const { limit, offset } = pageParams(req.query || {});
  const finance = allowsRole(ROLE_SETS.FINANCE, staff.role);
  let staffId = null;
  if (!finance) {
    staffId = staff.id;
  } else if (isUuid(req.query?.staff_id)) {
    staffId = String(req.query.staff_id).trim();
  }

  try {
    const rows = await listUnrecordedCalls(database, {
      orgId: staff.org_id,
      staffId,
      now: deps.now instanceof Date ? deps.now : new Date(),
      limit: limit + offset + 1
    });
    const sliced = rows.slice(offset);
    const envelope = page(sliced, { limit, offset });
    return res.status(200).json({
      ok: true,
      flag: "unrecorded",
      ...envelope
    });
  } catch (e) {
    if (dbDown(res, e)) return;
    throw e;
  }
}
