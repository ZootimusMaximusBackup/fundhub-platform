// POST /api/pipeline-cards — move a client card to a stage (and optionally a
// different pipeline).
//
//   { action: "move", client_id, pipeline_key, stage_key }
//
// This is the write half of the Pipeline board. Drag and MOVE used to rearrange
// DOM nodes and stash positions in sessionStorage — a reload put every card
// back. The helper that actually updates cards.stage_id already existed
// (src/workflows/cards.mjs moveCardToStage); this endpoint is the HTTP face.
//
// Shift-gated: the owner rule names "moving a pipeline stage" as a write that
// needs an open shift (see api/tasks.mjs and requireActiveShift.mjs).
//
// Org from the session. The client must belong to that org. Nothing transmits.

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireActiveShift } from "../src/http/middleware/requireActiveShift.mjs";
import { SUPER_ROLES } from "../src/http/middleware/requireRole.mjs";
import { requireRole, ROLE_SETS, isUuid } from "../src/http/read-api.mjs";
import { moveCardToStage } from "../src/workflows/cards.mjs";
import { dbDown } from "../src/http/db-down.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false, error: "method_not_allowed",
      message: "Moving a card is a save request, not a page load."
    });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  // requireAuth already attached req.staff. Owners are exempt — they do not
  // clock in (owner decision 2026-08-02, same as inquiries/messages).
  const shift = await requireActiveShift(req, res, { db, exempt: SUPER_ROLES });
  if (!shift) return;

  const orgId = (staff && staff.org_id) || null;
  if (!orgId) {
    return res.status(400).json({
      ok: false, error: "org_required",
      message: "Your sign-in is not attached to a company."
    });
  }

  const body = req.body || {};
  const action = String(body.action || "move").trim().toLowerCase();
  if (action !== "move") {
    return res.status(400).json({
      ok: false, error: "unknown_action",
      message: "Unknown action. Use move."
    });
  }

  if (!isUuid(body.client_id)) {
    return res.status(400).json({
      ok: false, error: "invalid_client_id",
      message: "client_id must be a client id."
    });
  }
  const pipelineKey = String(body.pipeline_key || "").trim();
  const stageKey = String(body.stage_key || "").trim();
  if (!pipelineKey || !stageKey) {
    return res.status(400).json({
      ok: false, error: "stage_required",
      message: "Send pipeline_key and stage_key for the destination column."
    });
  }

  try {
    const owned = await db.query(
      `SELECT id FROM clients WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
      [body.client_id, orgId]
    );
    if (!owned.rows[0]) {
      return res.status(404).json({
        ok: false, error: "not_found",
        message: "No client with that id in your company."
      });
    }

    const result = await moveCardToStage(db, {
      orgId,
      clientId: String(body.client_id).trim(),
      pipelineKey,
      stageKey
    });

    if (!result.moved) {
      return res.status(404).json({
        ok: false,
        error: result.reason || "stage_not_found",
        message: "That pipeline stage was not found."
      });
    }

    return res.status(200).json({
      ok: true,
      action: "move",
      client_id: String(body.client_id).trim(),
      pipeline_key: pipelineKey,
      stage_key: stageKey,
      created: !!result.created
    });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
