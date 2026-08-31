// POST /api/training-progress — FundHub records what a partner has done.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): this endpoint records the two
// compliance certifications that stand between a partner and selling under
// FundHub's brand. The label is a marker, not a request to revisit an owner
// decision.
//
//   POST { partner_id, action: "module", module: "m7", status: "complete", notes? }
//   POST { partner_id, action: "gate",   gate: "G2",   outcome: "passed",  notes? }
//
// STAFF ONLY, AND THAT IS THE WHOLE POINT. docs/specs/W7-curriculum.md puts a
// written exam that must miss zero on G2, a FundHub closer's score on G3, and roll
// call on every live session. A partner who could mark their own compliance module
// complete, or record their own gate as passed, would be a partner with no
// compliance control at all — the certification would certify nothing. There is no
// partner write path to training anywhere: not here, not in src/training/, and not
// on public/app/partner-training.html, which is read-only by construction.
//
// WHO EXACTLY: {owner, admin}. Narrower than ROLE_SETS.STAFF and identical to
// api/partner-addons.mjs, which is the other endpoint where FundHub acts ON a
// partner rather than on a client. WRITTEN OUT LONGHAND because
// scripts/journeys/extract.mjs resolves a bare identifier or a `new Set([...])` of
// quoted strings and nothing else — a gate it cannot read is published on the
// journey pages as "any signed in employee", which would be a false claim on a
// page a non-coder reads.
//
// A KNOWN GAP, RECORDED RATHER THAN QUIETLY WIDENED: W7's G3 is scored by a
// FundHub CLOSER, and a closer cannot reach this endpoint. Either an owner records
// the closer's verdict, or the role set widens — that is a decision with a
// sentence attached, not a convenience, so it is named in the unit report instead
// of being made here.
//
// THE ORG COMES FROM THE SESSION. A body field that chose the org would file one
// company's certification against another company's partner, and an org-scoped
// write with an unchecked partner_id still writes a row about somebody this
// company has no relationship with — so the partner is looked up inside the org
// before anything is written, by src/training/entitlement.mjs.
//
// NOTHING HERE MOVES MONEY, and no path from this endpoint reaches partner_revenue,
// a payout, a share percentage or an offer.

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid } from "../src/http/read-api.mjs";
import { recordModuleProgress, trainingViewFor, ProgressError } from "../src/training/progress.mjs";
import { recordGateDecision, GateError } from "../src/training/gates.mjs";
import { TrainingAccessError, accessMessage } from "../src/training/entitlement.mjs";
import { dbDown } from "../src/http/db-down.mjs";

/* Longhand on purpose — see the header. */
const TRAINING_WRITE_ROLES = new Set(["owner", "admin"]);

/* Fields the session owns. Present in a body ⇒ 400, never merged and never
   silently dropped — api/shifts.mjs explains why refusing beats ignoring. */
const SESSION_OWNED = ["org_id", "orgId", "staff_id", "staffId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

const trimOrNull = (v, max = 2000) => {
  if (v == null) return null;
  const s = String(v).trim().slice(0, max);
  return s || null;
};

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;

  if (req.method !== "POST") {
    /* The Allow header is not decoration here: scripts/journeys/extract.mjs
       reads it to work out which methods a handler answers, and a route with no
       method is published on the journey pages a non-coder reads as a dash. */
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  /* A SECOND CALL, DELIBERATELY. requireAuth forwards opts to authenticate(),
     which reads only { db, env } — a `roles` key passed to it does nothing at all
     and has already shipped one hole (CLAUDE.md §12). The gate is this line. */
  if (!requireRole(res, staff, TRAINING_WRITE_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) {
    // FAIL CLOSED — a session with no company cannot be scoped to one.
    return res.status(403).json({ ok: false, error: "org_required" });
  }

  const body = req.body || {};
  const intruder = SESSION_OWNED.find((k) => hasOwn(body, k));
  if (intruder) {
    return res.status(400).json({
      ok: false, error: "session_owned_field",
      message: `${intruder} comes from the signed-in session and must not be sent in the body`
    });
  }

  if (!isUuid(body.partner_id)) {
    return res.status(400).json({ ok: false, error: "partner_id must be a uuid" });
  }
  const partnerId = String(body.partner_id).trim();
  const action = String(body.action || "").trim().toLowerCase();
  const notes = trimOrNull(body.notes);

  try {
    let recorded = null;

    if (action === "module") {
      recorded = await recordModuleProgress(database, {
        orgId,
        partnerId,
        moduleCode: body.module,
        status: body.status,
        staffId: staff.id || null,
        notes
      });
    } else if (action === "gate") {
      recorded = await recordGateDecision(database, {
        orgId,
        partnerId,
        gate: body.gate,
        outcome: body.outcome,
        staffId: staff.id || null,
        notes
      });
    } else {
      return res.status(400).json({
        ok: false, error: "unknown_action",
        message: 'action must be "module" or "gate"'
      });
    }

    // The whole record back, so the screen that recorded it does not have to
    // guess what the write did to the gates — recording a module can be what
    // finally lets one pass.
    const view = await trainingViewFor(database, { orgId, partnerId });
    return res.status(200).json({ ok: true, recorded, ...view });
  } catch (err) {
    if (err instanceof TrainingAccessError) {
      return res.status(403).json({
        ok: false, error: "not_entitled", reason: err.code, message: accessMessage(err.code)
      });
    }
    if (err instanceof GateError || err instanceof ProgressError) {
      // A refusal this module states by name is the CALLER's error, not an
      // outage. 409 for the two that mean "the record is not in a state where
      // this makes sense", 400 for a value that was never valid.
      const conflict = new Set(["out_of_order", "modules_incomplete", "not_passed", "module_not_seeded"]);
      const status = conflict.has(err.code) ? 409 : 400;
      return res.status(status).json({ ok: false, error: err.code, message: REFUSALS[err.code] || err.code });
    }
    if (dbDown(res, err)) return;
    return res.status(500).json({ ok: false, error: "write_failed" });
  }
}

/* Plain-language for every refusal src/training/ can raise. A screen prints
   these; nothing branches on them. Kept here so a new refusal code cannot ship
   without somebody writing the sentence a person reads. */
const REFUSALS = Object.freeze({
  unknown_module: "That is not one of the thirteen modules.",
  unknown_status: 'A module is recorded as "attended" or "complete".',
  module_not_seeded: "This company has no curriculum seeded, so there is no module to record against.",
  unknown_gate: "That is not one of the four gates.",
  unknown_outcome: 'A gate decision is "passed", "failed" or "revoked".',
  out_of_order: "The gates are passed in order. The one before this has not been passed.",
  modules_incomplete: "Every module taught in this gate's week has to be complete first.",
  not_passed: "This gate is not currently passed, so there is nothing to revoke."
});
