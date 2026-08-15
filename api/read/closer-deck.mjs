// GET /api/read/closer-deck?client_id= | ?contact=
// Live closer-deck payload. Closer desk only. Never invents engine numbers.

import { db } from "../../src/db.mjs";
import { requireAuth as defaultRequireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { buildCloserDeck } from "../../src/sales/closer-deck.mjs";

export const CLOSER_DECK_ROLES = new Set(["closer", "sales_manager", "owner", "admin"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const requireAuth = deps.requireAuth ?? defaultRequireAuth;

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, CLOSER_DECK_ROLES)) return;

  if (!isUuid(staff.org_id)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const id = req.query?.client_id || req.query?.contact;
  if (!isUuid(id)) {
    return res.status(400).json({
      ok: false,
      error: "client_id is required and must be a uuid"
    });
  }

  try {
    const data = await buildCloserDeck(database, {
      orgId: staff.org_id,
      clientId: String(id).trim()
    });
    if (!data) {
      return res.status(404).json({ ok: false, error: "client_not_found" });
    }
    return res.status(200).json({ ok: true, ...data });
  } catch (e) {
    if (dbDown(res, e)) return;
    throw e;
  }
}
