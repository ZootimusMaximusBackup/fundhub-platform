// POST /api/hiring/decide — the one place a person moves a candidate.
//
//   POST { application_id, action: "advance", to_stage: "screening", reason? }
//   POST { application_id, action: "reject",  reason: "…" }
//
// WHY THIS FILE EXISTS. The six api/hiring/* endpoints are readHandler
// wrappers, and readHandler answers 405 to everything that is not a GET
// (src/http/read-api.mjs). src/hiring/pipeline.mjs has had finished advance()
// and reject() logic the whole time with no HTTP caller at all, so the hiring
// screen was read-only by construction: an owner could look at a candidate and
// could not hire or reject one.
//
// WHO DECIDED IS NOT A REQUEST PARAMETER. decided_by comes off the session
// principal and never off the body, the same rule api/shifts.mjs applies to
// staff_id: a body field that chose the decider would let anyone file a
// rejection under a colleague's name, and hiring_decisions is the row an
// adverse-impact review reads. A body carrying it is REFUSED, not ignored —
// a 200 would confirm a belief that is wrong.
//
// reject() also requires a written reason, in the module and again in the
// database trigger. This endpoint does not soften that.
//
// NOTHING IS SENT FROM HERE. reject() queues a candidate-feedback task for a
// person; no email or SMS leaves the building on this path.
import { db } from "../../src/db.mjs";
import { requireRole } from "../../src/http/middleware/requireRole.mjs";
import { withTransaction } from "../../src/db/with-transaction.mjs";
import { advance, reject, STAGES } from "../../src/hiring/pipeline.mjs";

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

// Fields the session owns. Present in a body ⇒ 400.
const SESSION_OWNED = ["decided_by", "decided_by_staff_id", "org_id"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  /* Written out rather than spread from ROLE_SETS.HIRING so the journey
     generator can read the gate straight off this file. The two must match —
     src/hiring/hiring-endpoints.pg.test.mjs fails if they drift. */
  const staff = await requireRole("owner", "admin")(req, res, { db });
  if (!staff) return;                    // requireRole already wrote 401 or 403

  const body = req.body || {};
  for (const field of SESSION_OWNED) {
    if (hasOwn(body, field)) {
      return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
    }
  }

  const applicationId = String(body.application_id || "").trim();
  if (!applicationId) {
    return res.status(400).json({ ok: false, error: "application_id_required" });
  }
  const action = String(body.action || "").trim();
  const reason = body.reason == null ? null : String(body.reason).trim();

  try {
    if (action === "advance") {
      const toStage = String(body.to_stage || "").trim();
      if (!STAGES.includes(toStage)) {
        return res.status(400).json({
          ok: false, error: "unknown_stage", stages: STAGES
        });
      }
      const out = await withTransaction(db, (tx) => advance(tx, {
        orgId: staff.org_id,
        applicationId,
        toStageKey: toStage,
        decidedByStaffId: staff.id,
        reason: reason || null
      }));
      return res.status(200).json({ ok: true, ...out });
    }

    if (action === "reject") {
      if (!reason) {
        return res.status(400).json({ ok: false, error: "reason_required" });
      }
      const out = await withTransaction(db, (tx) => reject(tx, {
        orgId: staff.org_id,
        applicationId,
        decidedByStaffId: staff.id,
        reason
      }));
      return res.status(200).json({ ok: true, ...out });
    }

    return res.status(400).json({ ok: false, error: "invalid_action" });
  } catch (e) {
    if (e && e.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, error: "application_not_found" });
    }
    // advance() throws a plain Error for "application is hired, not open" and
    // for a stage key it will not move to. Those are the caller's mistake.
    const msg = String((e && e.message) || "hiring decision failed");
    if (/^advance:|^reject:/.test(msg)) {
      return res.status(409).json({ ok: false, error: msg });
    }
    console.error("hiring/decide failed", msg);
    return res.status(500).json({ ok: false, error: "hiring_decision_failed" });
  }
}
