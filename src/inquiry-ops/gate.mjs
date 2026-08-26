// Per-bureau lender gate helpers — load cases, owner override, round attach.

import { sensitiveBureaus, parseBureaus } from "../lenders/match.mjs";
import { moveCardToStage } from "../workflows/cards.mjs";
import { createTask } from "../lib/create-task.mjs";

const BUREAUS = ["EX", "EQ", "TU"];
const ACTIVE = ["Queued", "Scheduled", "In Progress", "Escalated", "Blocked"];

export async function loadActiveCasesForClient(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT *
       FROM inquiry_removal_cases
      WHERE org_id = $1::uuid
        AND client_id = $2::uuid
        AND case_status::text = ANY($3::text[])
      ORDER BY requested_at DESC`,
    [orgId, clientId, ACTIVE]
  );
  return r.rows;
}

/**
 * Per-bureau gate status for round start / UI.
 * @returns {{ EX: object, EQ: object, TU: object, allBlocked: boolean, hot: string[] }}
 */
export function gateStatusFromCases(cases = [], inquiryLog = []) {
  const hot = sensitiveBureaus(inquiryLog, { cases });
  const byBureau = {};
  for (const b of BUREAUS) {
    const caseRow = (cases || []).find(
      (c) => parseBureaus(c.selected_bureaus_raw || c.bureau).includes(b)
    );
    const overridden = !!(caseRow?.gate_override_by && caseRow?.gate_override_at);
    const blocked = hot.has(b);
    byBureau[b] = {
      bureau: b,
      blocked,
      overridden,
      caseId: caseRow?.id || null,
      caseStatus: caseRow?.case_status || null
    };
  }
  const allBlocked = BUREAUS.every((b) => byBureau[b].blocked);
  return { ...byBureau, allBlocked, hot: [...hot] };
}

/** Owner-only override — never silent. */
export async function overrideBureauGate(db, {
  orgId,
  caseId,
  staffId,
  staffRole
} = {}) {
  if (!orgId || !caseId || !staffId) {
    const err = new Error("orgId, caseId, staffId required");
    err.status = 400;
    throw err;
  }
  if (String(staffRole || "").toLowerCase() !== "owner") {
    const err = new Error("owner role required for gate override");
    err.status = 403;
    err.code = "owner_required";
    throw err;
  }
  const r = await db.query(
    `UPDATE inquiry_removal_cases
        SET gate_override_by = $3::uuid,
            gate_override_at = now(),
            updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid
      RETURNING *`,
    [caseId, orgId, staffId]
  );
  if (!r.rows[0]) {
    const err = new Error("case not found");
    err.status = 404;
    throw err;
  }
  return r.rows[0];
}

/**
 * Attach gate status to a funding round (custom field / jsonb) and raise a
 * closer task when every bureau is blocked. Does NOT refuse round start.
 */
export async function attachGateToRound(db, {
  orgId,
  clientId,
  fundingRoundId,
  inquiryLog = []
} = {}) {
  const cases = await loadActiveCasesForClient(db, { orgId, clientId });
  const status = gateStatusFromCases(cases, inquiryLog);

  if (fundingRoundId) {
    await db.query(
      `UPDATE funding_rounds
          SET conditions = COALESCE(conditions, '[]'::jsonb)
            || jsonb_build_array(jsonb_build_object(
                 'type', 'inquiry_bureau_gate',
                 'at', now(),
                 'hot', $2::jsonb,
                 'all_blocked', $3::boolean
               )),
              updated_at = now()
        WHERE id = $1::uuid AND org_id = $4::uuid`,
      [fundingRoundId, JSON.stringify(status.hot), status.allBlocked, orgId]
    );
  }

  let task = null;
  if (status.allBlocked) {
    const created = await createTask(db, {
      orgId,
      clientId,
      title: "All bureaus gated — inquiry removal blocking lender match",
      body: "Every bureau has an active inquiry-removal case. Round may still start; decide whether to override or wait.",
      sourceWorkflow: "inquiry-gate-all-blocked",
      assigneeRole: "inquiry_specialist",
      // One open gate task per client — title-key, not event-key.
      dedupeOn: "title"
    });
    if (created?.created && created.id) {
      task = { id: created.id };
    } else if (created?.id) {
      task = { id: created.id };
    }
  }

  // Park on Resume Funding only after a real inquiry case is done.
  // No case → do not invent an Inquiry Removal card (Combo enroll hole 11).
  if (!status.hot.length && cases.length === 0) {
    const ever = await db.query(
      `SELECT 1
         FROM inquiry_removal_cases
        WHERE org_id = $1::uuid AND client_id = $2::uuid
        LIMIT 1`,
      [orgId, clientId]
    );
    if (ever.rows[0]) {
      await moveCardToStage(db, {
        orgId,
        clientId,
        pipelineKey: "inquiry_removal",
        stageKey: "resume_funding"
      });
    }
  }

  return { status, task };
}
