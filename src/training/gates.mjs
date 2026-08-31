// @ts-check
// The four gates — the part of the curriculum that is a control rather than a course.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): G2 is a compliance certification and
// this module decides whether a partner has it. The label is a marker, not a
// request to revisit an owner decision.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THE GATES ARE THE POINT
//
// docs/specs/W7-curriculum.md: "FOUR HARD GATES, IN ORDER. NO GATE, NO SELLING."
// Two of them are compliance certifications, split into two modules on purpose,
// because FundHub's machine screener reads ad copy and nothing else — it cannot
// see where a partner is registered, how they take money, or how they dial a
// phone. A partner saying the wrong thing creates liability for FundHub, and W7
// cites the enforcement record at length. The gate record is the only control
// that reaches any of it.
//
// So the headline of this file is one function:
//
//     hasPassedGate(db, { orgId, partnerId, gate })  →  boolean
//
// That is the question the rest of the system can now ask. NOTHING CALLS IT YET.
// This unit does not own src/compliance/screen.mjs, src/brand/, or the campaign
// launch-readiness checks, and half-wiring a gate into one of them would be worse
// than leaving it unwired: a control that fires on one path and not another reads
// as protection and is not. Wiring it is named as a gap in the unit report rather
// than done here.
//
// ═══════════════════════════════════════════════════════════════════════════
// HOW STANDING IS COMPUTED
//
// 284 stores one row per DECISION, append-only and immutable. The standing on a
// gate is therefore the NEWEST row for that (partner, gate) — DISTINCT ON, not a
// boolean column somebody has to remember to clear. A revocation is a newer row
// with outcome 'revoked', so it wins by the same rule that made the pass win, and
// no code path exists that can quietly un-say a certification.
//
// A GATE WITH NO ROWS IS NOT PASSED, AND IT IS ALSO NOT FAILED. `outcome` comes
// back null for it. "Never assessed" and "assessed and failed" are different
// facts about a partner and a screen that merged them would be lying to somebody.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT RECORDING A PASS REFUSES, AND WHERE EACH REFUSAL COMES FROM
//
//   not_entitled       — not an active partner with a signed agreement
//                        (src/training/entitlement.mjs)
//   unknown_gate /
//   unknown_outcome    — the four codes and three outcomes are a closed set
//   out_of_order       — W7: "FOUR HARD GATES, IN ORDER." G3 cannot pass while
//                        G2 is unpassed. Recording them out of order would let a
//                        partner reach a live buyer call with no compliance
//                        certification, which is the exact thing the ladder exists
//                        to stop.
//   modules_incomplete — W7: "Attendance is a gate, not a suggestion. A partner
//                        who misses a live session sits it again in the next
//                        cohort before their gate clears." So every module W7
//                        teaches in that gate's week must be complete first.
//   not_passed         — a revocation of a gate that is not currently passed. It
//                        would be a record of taking away something never given.
//
// A FAIL IS NEVER REFUSED for order or attendance. Refusing to record a failure
// would leave the honest outcome — somebody sat it and did not clear — with
// nowhere to go, and the dated record of the attempt is exactly what W7 wants
// kept.

import {
  GATES, GATE_CODES, GATE_OUTCOMES, isGateCode, modulesForGate, previousGate
} from "./curriculum.mjs";
import { assertTrainingAccess, TrainingAccessError } from "./entitlement.mjs";

/** Thrown for a decision this module refuses. The caller turns it into a 400/409. */
export class GateError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = "GateError";
    this.code = code;
  }
}

/* The newest decision per gate for one partner. DISTINCT ON with a matching
   ORDER BY is the shape Postgres optimises against ptg_partner_gate_idx; a
   correlated MAX(decided_at) subquery would also have to break ties, and two
   decisions recorded in the same millisecond would then return both. `id DESC`
   is the tie-break, so the answer is always exactly one row per gate. */
const SQL_LATEST_DECISIONS = `
  SELECT DISTINCT ON (g.gate_code)
         g.gate_code, g.outcome, g.decided_at, g.decided_by_staff_id, g.notes
    FROM partner_training_gates g
   WHERE g.org_id = $1 AND g.partner_id = $2
   ORDER BY g.gate_code, g.decided_at DESC, g.id DESC`;

/**
 * gateStandingsFor — all four gates with the partner's standing on each, in order.
 *
 * The catalogue half comes from `training_gates` so the titles and the "what this
 * blocks" sentence stay in one place (284 seeds them from W7). If the catalogue
 * has not been seeded for this company the constants in curriculum.mjs fill in,
 * because a screen with no gate names at all is less honest than one with names
 * and no rows.
 *
 * @param {{query: Function}} db
 * @param {{orgId: string, partnerId: string}} args
 */
export async function gateStandingsFor(db, { orgId, partnerId } = /** @type {any} */ ({})) {
  if (!orgId) throw new Error("gateStandingsFor: orgId is required — refusing an unscoped read");
  if (!partnerId) throw new Error("gateStandingsFor: partnerId is required");

  const catalogue = (await db.query(
    `SELECT code, position, title, week_due, blocks
       FROM training_gates
      WHERE org_id = $1
      ORDER BY position`,
    [orgId]
  )).rows;

  const decisions = new Map(
    (await db.query(SQL_LATEST_DECISIONS, [orgId, partnerId])).rows.map((r) => [r.gate_code, r])
  );

  const byCode = new Map(catalogue.map((row) => [row.code, row]));

  return GATES.map((gate) => {
    const row = byCode.get(gate.code) || null;
    const decision = decisions.get(gate.code) || null;
    return {
      code: gate.code,
      position: row ? row.position : gate.position,
      title: row ? row.title : gate.title,
      week_due: row ? row.week_due : gate.weekDue,
      // Null rather than an invented sentence: the "what this blocks" wording is
      // W7's and lives in the seed, not in this file.
      blocks: row ? row.blocks : null,
      // null = never assessed. Not the same as failed.
      outcome: decision ? decision.outcome : null,
      decided_at: decision ? decision.decided_at : null,
      decided_by_staff_id: decision ? decision.decided_by_staff_id : null,
      notes: decision ? decision.notes : null,
      passed: !!decision && decision.outcome === "passed"
    };
  });
}

/**
 * hasPassedGate — THE question this whole unit exists to make askable.
 *
 * True only when the newest decision on that gate is 'passed'. A revoked gate is
 * false. A gate never assessed is false. An unknown gate code throws rather than
 * answering false, because a typo that reads as "not passed" would look like a
 * working control while gating nothing.
 *
 * @param {{query: Function}} db
 * @param {{orgId: string, partnerId: string, gate: string}} args
 * @returns {Promise<boolean>}
 */
export async function hasPassedGate(db, { orgId, partnerId, gate } = /** @type {any} */ ({})) {
  if (!orgId) throw new Error("hasPassedGate: orgId is required — refusing an unscoped read");
  if (!partnerId) throw new Error("hasPassedGate: partnerId is required");
  if (!isGateCode(gate)) {
    throw new GateError("unknown_gate");
  }
  const code = String(gate).trim().toUpperCase();
  const { rows } = await db.query(
    `SELECT outcome
       FROM partner_training_gates
      WHERE org_id = $1 AND partner_id = $2 AND gate_code = $3
      ORDER BY decided_at DESC, id DESC
      LIMIT 1`,
    [orgId, partnerId, code]
  );
  return !!rows[0] && rows[0].outcome === "passed";
}

/**
 * sellingRelease — the two questions the gates were built to answer, named.
 *
 * W7 puts G1, G2 and G3 in front of selling under FundHub's fulfilment (brand
 * issued, public assets live, live buyer calls). G4 is the release from
 * SUPERVISION — "the partner is not released to sell unsupervised until three
 * clients have paid" — so it is a fourth question, not a stricter version of the
 * first.
 *
 * @param {{query: Function}} db
 * @param {{orgId: string, partnerId: string}} args
 */
export async function sellingRelease(db, { orgId, partnerId } = /** @type {any} */ ({})) {
  const standings = await gateStandingsFor(db, { orgId, partnerId });
  /* String(), so this is a Set of strings rather than a Set of the four literal
     codes — otherwise every `.has()` below only accepts one of those four
     literals and the checks stop compiling the moment a code arrives as data. */
  const passed = new Set(standings.filter((g) => g.passed).map((g) => String(g.code)));
  const missing = GATE_CODES.filter((code) => !passed.has(code));
  return {
    // Supervised selling: the first three gates.
    may_sell_supervised: ["G1", "G2", "G3"].every((code) => passed.has(code)),
    // Unsupervised: all four.
    may_sell_unsupervised: GATE_CODES.every((code) => passed.has(code)),
    gates_outstanding: missing
  };
}

/**
 * recordGateDecision — a named person's dated signature on one gate.
 *
 * Staff-written only. There is no partner path to this function and there must
 * not be one: a partner who could record their own compliance certification is a
 * partner with no compliance certification.
 *
 * @param {{query: Function}} db
 * @param {{orgId: string, partnerId: string, gate: string, outcome: string,
 *          staffId?: string|null, notes?: string|null}} args
 */
export async function recordGateDecision(db, {
  orgId, partnerId, gate, outcome, staffId = null, notes = null
} = /** @type {any} */ ({})) {
  if (!orgId) throw new Error("recordGateDecision: orgId is required");
  if (!partnerId) throw new Error("recordGateDecision: partnerId is required");
  if (!isGateCode(gate)) throw new GateError("unknown_gate");

  const code = String(gate).trim().toUpperCase();
  const verdict = String(outcome || "").trim().toLowerCase();
  if (!GATE_OUTCOMES.includes(verdict)) throw new GateError("unknown_outcome");

  // Entitlement first, so a paused partner cannot be quietly certified. Throws
  // TrainingAccessError, which the handler maps to a 403.
  await assertTrainingAccess(db, { orgId, partnerId });

  if (verdict === "passed") {
    const prev = previousGate(code);
    if (prev && !(await hasPassedGate(db, { orgId, partnerId, gate: prev }))) {
      throw new GateError("out_of_order");
    }
    const required = modulesForGate(code).map((m) => m.code);
    if (required.length) {
      const { rows } = await db.query(
        `SELECT m.code
           FROM training_modules m
           LEFT JOIN partner_training_progress p
                  ON p.module_id = m.id
                 AND p.org_id = $1
                 AND p.partner_id = $2
                 AND p.status = 'complete'
          WHERE m.org_id = $1
            AND m.code = ANY($3::text[])
            AND p.id IS NULL`,
        [orgId, partnerId, required]
      );
      if (rows.length) throw new GateError("modules_incomplete");
    }
  }

  if (verdict === "revoked" && !(await hasPassedGate(db, { orgId, partnerId, gate: code }))) {
    throw new GateError("not_passed");
  }

  const { rows } = await db.query(
    `INSERT INTO partner_training_gates
       (org_id, partner_id, gate_code, outcome, decided_by_staff_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [orgId, partnerId, code, verdict, staffId || null, notes || null]
  );
  return rows[0];
}

export { TrainingAccessError };
