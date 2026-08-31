// POST /api/applications — set application status (writes application_decisions).

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../src/http/read-api.mjs";
import { setApplicationStatus, listApplicationDecisions, listClientDecisionPlays, listClientApplications, logBankDecision, setApprovalExclusion, ApplicationStatusError } from "../src/applications/status.mjs";
import { dbDown } from "../src/http/db-down.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      const limit = Number(q.limit) || 50;
      if (isUuid(q.application_id)) {
        const decisions = await listApplicationDecisions(database, {
          orgId,
          applicationId: q.application_id,
          limit
        });
        return res.status(200).json({ ok: true, decisions });
      }
      if (isUuid(q.client_id)) {
        const decisions = await listClientDecisionPlays(database, {
          orgId,
          clientId: q.client_id,
          limit
        });
        /* The application rows themselves, alongside the named plays.
           `decisions` is unchanged and still means what it always meant — this
           is an ADDED key, so nothing already reading this reply breaks.

           The screen needs it because an approved amount is optional now: it
           has to show back what was saved, let a missing amount be typed in
           later, and count the approvals still waiting on one. approved_amount
           arrives exactly as the column holds it, null and all. */
        const applications = await listClientApplications(database, {
          orgId,
          clientId: q.client_id
        });
        return res.status(200).json({ ok: true, decisions, applications });
      }
      return res.status(400).json({ ok: false, error: "application_id or client_id required" });
    }

    const body = req.body || {};
    const playName = body.play_name || body.playName || null;

    /* "This approval does not count" — the way out of the Funded block, on the
       endpoint that already records bank decisions. Checked BEFORE the status
       branch below, because it carries an application_id too but is not a
       status change: the bank's yes stays exactly as it is. */
    const action = String(body.action || "").trim();
    if (action === "exclude_approval" || action === "reinstate_approval") {
      if (!isUuid(body.application_id)) {
        return res.status(400).json({
          ok: false,
          error: "application_id required",
          message: "Send application_id for the approval you are marking."
        });
      }
      const application = await setApprovalExclusion(database, {
        orgId,
        applicationId: body.application_id,
        excluded: action === "exclude_approval",
        reason: body.reason ?? body.notes ?? null,
        staff
      });
      return res.status(200).json({ ok: true, application });
    }

    if (isUuid(body.application_id)) {
      const application = await setApplicationStatus(database, {
        orgId,
        applicationId: body.application_id,
        status: body.status,
        eventType: body.event_type || "status_change",
        staff,
        notes: body.notes || null,
        playName,
        patch: body.patch || null
      });
      return res.status(200).json({ ok: true, application });
    }
    if (isUuid(body.client_id) && isUuid(body.lender_id)) {
      const application = await logBankDecision(database, {
        orgId,
        clientId: body.client_id,
        lenderId: body.lender_id,
        status: body.status,
        playName,
        staff,
        notes: body.notes || null,
        // How much the bank approved, in dollars. Absent stays absent —
        // logBankDecision never writes a 0 for an amount nobody gave.
        approvedAmount: body.approved_amount ?? body.approvedAmount ?? null
      });
      return res.status(200).json({ ok: true, application });
    }
    return res.status(400).json({ ok: false, error: "application_id required" });
  } catch (err) {
    if (err instanceof ApplicationStatusError) {
      return res.status(err.status || 400).json({ ok: false, error: err.code, message: err.message });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
