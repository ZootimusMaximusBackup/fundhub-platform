// @ts-check
// Where one partner is up to in the curriculum, and what is next.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): the modules this tracks include two
// certified compliance modules, and completing them is what lets a gate pass. The
// label is a marker, not a request to revisit an owner decision.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE SHAPE
//
// `training_modules` is FundHub's published curriculum (284, seeded from
// docs/specs/W7-curriculum.md). `partner_training_progress` is one row per module
// a partner has actually done something about. This module joins the two and adds
// nothing else — there is no lesson body, no player, no quiz and no certificate
// anywhere in src/training/, deliberately. W7 designs a live cohort with roll
// called; the thing worth storing is who turned up.
//
// NO ROW MEANS NOT STARTED. The join is a LEFT JOIN and a missing progress row
// comes back as status null, which the screen prints as "Not started". Writing a
// 'not_started' row for every partner × every module at enrolment would be a
// second list to keep in step with the first.
//
// PROGRESS IS RECORDED BY FUNDHUB, NEVER SELF-DECLARED. Every write here takes a
// staff id. W7 puts a written exam that must miss zero on G2, a FundHub closer's
// score on G3, and roll call on every live session. A partner who could tick
// their own compliance module would be a partner with no compliance module. There
// is no partner-facing write path in this file, in api/training-progress.mjs, or
// on the screen.
//
// THE ORG IS ALWAYS BOUND. Every query here takes orgId as $1 and every caller
// reads it off the session. A curriculum is per company (284 seeds the default
// org only) and a partner id from another company must resolve to nothing.

import {
  MODULES, PROGRESS_STATUSES, isModuleCode, GATE_CODES
} from "./curriculum.mjs";
import { assertTrainingAccess } from "./entitlement.mjs";
import { gateStandingsFor, sellingRelease } from "./gates.mjs";

/** Thrown for a write this module refuses. The caller turns it into a 400. */
export class ProgressError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = "ProgressError";
    this.code = code;
  }
}

/* One row per module in the catalogue, with this partner's progress attached.
   ORDER BY position, not by code: the delivery order and the module number are
   two different lists and the screen wants the first (curriculum.mjs explains
   why). */
const SQL_MODULES_WITH_PROGRESS = `
  SELECT m.id, m.code, m.position, m.title, m.week_no, m.gate_code, m.certified,
         p.status, p.attended_at, p.completed_at, p.recorded_by_staff_id, p.notes
    FROM training_modules m
    LEFT JOIN partner_training_progress p
           ON p.module_id = m.id
          AND p.org_id = m.org_id
          AND p.partner_id = $2
   WHERE m.org_id = $1
   ORDER BY m.position`;

/**
 * moduleRowsFor — the curriculum with one partner's progress on it.
 * @param {{query: Function}} db
 * @param {{orgId: string, partnerId: string}} args
 */
export async function moduleRowsFor(db, { orgId, partnerId } = /** @type {any} */ ({})) {
  if (!orgId) throw new Error("moduleRowsFor: orgId is required — refusing an unscoped read");
  if (!partnerId) throw new Error("moduleRowsFor: partnerId is required");
  const { rows } = await db.query(SQL_MODULES_WITH_PROGRESS, [orgId, partnerId]);
  return rows.map((r) => ({
    code: r.code,
    position: r.position,
    title: r.title,
    // NULL survives: W7 does not schedule m12, and a week of 0 or 1 would be an
    // invented fact (CLAUDE.md §12).
    week_no: r.week_no,
    gate_code: r.gate_code,
    certified: r.certified,
    // null = not started. Not the same as attended-and-not-complete.
    status: r.status || null,
    attended_at: r.attended_at || null,
    completed_at: r.completed_at || null,
    recorded_by_staff_id: r.recorded_by_staff_id || null,
    notes: r.notes || null
  }));
}

/**
 * recordModuleProgress — FundHub records that a partner attended or completed one
 * module. Idempotent on (partner, module): a second call updates the one row
 * rather than growing a pile, which is what 284's unique index is for.
 *
 * `attended` never overwrites `complete`. Roll being called twice must not undo a
 * completion that has already let a gate pass — that would silently un-certify a
 * partner, which is the failure this whole unit exists to prevent.
 *
 * @param {{query: Function}} db
 * @param {{orgId: string, partnerId: string, moduleCode: string, status: string,
 *          staffId?: string|null, notes?: string|null}} args
 */
export async function recordModuleProgress(db, {
  orgId, partnerId, moduleCode, status, staffId = null, notes = null
} = /** @type {any} */ ({})) {
  if (!orgId) throw new Error("recordModuleProgress: orgId is required");
  if (!partnerId) throw new Error("recordModuleProgress: partnerId is required");

  const code = String(moduleCode || "").trim().toLowerCase();
  if (!isModuleCode(code)) throw new ProgressError("unknown_module");

  const state = String(status || "").trim().toLowerCase();
  if (!PROGRESS_STATUSES.includes(state)) throw new ProgressError("unknown_status");

  // Throws TrainingAccessError, which the handler maps to a 403.
  await assertTrainingAccess(db, { orgId, partnerId });

  const module = (await db.query(
    `SELECT id FROM training_modules WHERE org_id = $1 AND code = $2 LIMIT 1`,
    [orgId, code]
  )).rows[0];
  // The catalogue is seeded per company. A company with no curriculum is a real
  // state of this database and it is not the same as a typo'd module code.
  if (!module) throw new ProgressError("module_not_seeded");

  /* attended_at and completed_at are both stamped on a completion. W7's gate
     argument is that the RECORD is the control — "a dated record that the support
     happened" — so a completion with no attendance date would be a completion
     nobody can show a date for. GREATEST/COALESCE on the update keeps the
     EARLIEST attendance rather than restamping it every time somebody edits a
     note: when they turned up is a fact, not a timestamp of the last edit. */
  const { rows } = await db.query(
    `INSERT INTO partner_training_progress
       (org_id, partner_id, module_id, status, attended_at, completed_at,
        recorded_by_staff_id, notes)
     VALUES ($1, $2, $3, $4, now(), CASE WHEN $4 = 'complete' THEN now() ELSE NULL END, $5, $6)
     ON CONFLICT (org_id, partner_id, module_id) DO UPDATE
        SET status = CASE
                       WHEN partner_training_progress.status = 'complete' THEN 'complete'
                       ELSE EXCLUDED.status
                     END,
            attended_at = COALESCE(partner_training_progress.attended_at, EXCLUDED.attended_at),
            completed_at = CASE
                             WHEN partner_training_progress.status = 'complete'
                               THEN partner_training_progress.completed_at
                             WHEN EXCLUDED.status = 'complete' THEN EXCLUDED.completed_at
                             ELSE partner_training_progress.completed_at
                           END,
            recorded_by_staff_id = EXCLUDED.recorded_by_staff_id,
            notes = COALESCE(EXCLUDED.notes, partner_training_progress.notes)
     RETURNING *`,
    [orgId, partnerId, module.id, state, staffId || null, notes || null]
  );
  return rows[0];
}

/** The next module a partner has not completed, in delivery order, or null when
    every module is done. This is the "what is next" line on the screen. */
export function nextModule(moduleRows = []) {
  return moduleRows.find((m) => m.status !== "complete") || null;
}

/** The next gate not yet passed, in order, or null when all four are passed. */
export function nextGate(gateRows = []) {
  return gateRows.find((g) => !g.passed) || null;
}

/**
 * trainingViewFor — everything one screen needs, in one call.
 *
 * The entitlement verdict is NOT decided here: the caller decides whether to ask
 * at all (api/read/partner-training.mjs refuses a partner before this runs). This
 * function reports a record; it does not police access to one.
 *
 * @param {{query: Function}} db
 * @param {{orgId: string, partnerId: string}} args
 */
export async function trainingViewFor(db, { orgId, partnerId } = /** @type {any} */ ({})) {
  const [modules, gates, release] = await Promise.all([
    moduleRowsFor(db, { orgId, partnerId }),
    gateStandingsFor(db, { orgId, partnerId }),
    sellingRelease(db, { orgId, partnerId })
  ]);

  const complete = modules.filter((m) => m.status === "complete").length;

  return {
    partner_id: partnerId,
    modules,
    gates,
    modules_total: modules.length,
    modules_complete: complete,
    // Named, not computed in the browser: 13 as a denominator is a fact about the
    // seeded curriculum, and a screen that divided by its own hardcoded 13 would
    // be wrong the day a company seeds a different one.
    next_module: nextModule(modules),
    next_gate: nextGate(gates),
    may_sell_supervised: release.may_sell_supervised,
    may_sell_unsupervised: release.may_sell_unsupervised,
    gates_outstanding: release.gates_outstanding,
    /* A company with no seeded curriculum reads as zero modules rather than as a
       partner who has done nothing. The screen says which, because "you have not
       started" and "nobody has set this up" are different messages to send
       somebody who paid $10,000. */
    curriculum_seeded: modules.length > 0,
    gate_codes: GATE_CODES,
    /* The published module list this partner is being measured against, so a
       screen never has to fall back on its own copy. */
    catalogue_codes: MODULES.map((m) => m.code)
  };
}
