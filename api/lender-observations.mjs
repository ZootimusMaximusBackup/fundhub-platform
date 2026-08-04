// POST /api/lender-observations — log a bureau observation or resolve a review.

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../src/http/read-api.mjs";
import { logObservation, reviewObservation } from "../src/lenders/store.mjs";
import { OBSERVATION_REVIEW_STATUSES } from "../src/lenders/tables.mjs";
import { dbDown } from "../src/http/db-down.mjs";

const ACTIONS = new Set(["log", "review"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const body = req.body || {};
  const action = String(body.action || "log").trim().toLowerCase();
  if (!ACTIONS.has(action)) {
    return res.status(400).json({ ok: false, error: "unknown_action" });
  }

  try {
    if (action === "review") {
      if (!isUuid(body.id)) {
        return res.status(400).json({ ok: false, error: "id_required" });
      }
      const status = String(body.review_status || "").trim();
      if (!OBSERVATION_REVIEW_STATUSES.includes(status)) {
        return res.status(400).json({
          ok: false,
          error: "invalid_review_status",
          message: `review_status must be one of: ${OBSERVATION_REVIEW_STATUSES.join(", ")}`
        });
      }
      const observation = await reviewObservation(database, {
        orgId,
        id: body.id,
        review_status: status,
        notes: body.notes,
        staff
      });
      if (!observation) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      return res.status(200).json({ ok: true, observation });
    }

    if (!body.observed_bureau) {
      return res.status(400).json({
        ok: false,
        error: "observed_bureau_required",
        message: "Say which bureau actually pulled."
      });
    }

    const observation = await logObservation(database, {
      orgId,
      staff,
      input: {
        application_id: isUuid(body.application_id) ? body.application_id : null,
        client_id: isUuid(body.client_id) ? body.client_id : null,
        funding_round_id: isUuid(body.funding_round_id) ? body.funding_round_id : null,
        lender_name: body.lender_name || null,
        lender_table: body.lender_table || null,
        lender_row_id: isUuid(body.lender_row_id) ? body.lender_row_id : null,
        expected_bureaus_raw: body.expected_bureaus_raw,
        observed_bureau: body.observed_bureau,
        observation_source: body.observation_source,
        notes: body.notes || null
      }
    });
    return res.status(200).json({ ok: true, observation });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
