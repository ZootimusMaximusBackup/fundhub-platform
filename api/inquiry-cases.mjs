// /api/inquiry-cases — Inquiry Remover case write path.
//
//   GET  ?case_id=<uuid>                         → { ok, case, inquiries }
//   POST { case_id, action: "clear_inquiry", inquiry_id }
//   POST { case_id, action: "mark_cleared" }     → clear all open + emit inquiry.removed
//   POST { case_id, action: "close", reason?, as_cleared? }
//
// Role: inquiry_specialist | admin | owner. POST requires an open shift
// (owners exempt), same rule as /api/inquiries.
import { db } from "../src/db.mjs";
import { requirePrincipal } from "../src/http/middleware/requirePrincipal.mjs";
import { requireActiveShift } from "../src/http/middleware/requireActiveShift.mjs";
import { SUPER_ROLES } from "../src/http/middleware/requireRole.mjs";
import { isUuid } from "../src/http/read-api.mjs";
import { emit } from "../src/events/bus.mjs";
import {
  clearInquiry,
  closeCase,
  holdDurationDisplay,
  InquiryCaseError
} from "../src/inquiry-removal/cases.mjs";

const WRITE_ROLES = new Set(["inquiry_specialist", "admin", "owner", ...SUPER_ROLES]);

async function loadCase(caseId, orgId) {
  const res = await db.query(
    `SELECT c.*,
            TRIM(COALESCE(cl.first_name,'') || ' ' || COALESCE(cl.last_name,'')) AS client_name
       FROM inquiry_removal_cases c
       LEFT JOIN clients cl ON cl.id = c.client_id
      WHERE c.id = $1 AND c.org_id = $2`,
    [caseId, orgId]
  );
  return res.rows[0] || null;
}

async function loadInquiries(caseId) {
  const res = await db.query(
    `SELECT id, case_id, bureau, inquiry, inquiry_name, status, call_state,
            is_open, call_attempts, outcome, cleared_at, confirmed_at,
            created_at, updated_at
       FROM inquiry_log WHERE case_id = $1
       ORDER BY is_open DESC, updated_at DESC`,
    [caseId]
  );
  return res.rows;
}

async function emitRemoved(caseRow, { staffId, inquiryId = null } = {}) {
  const res = await emit(db, "inquiry.removed", {
    source: "inquiry-remover-desk",
    caseId: caseRow.id,
    externalCaseId: caseRow.external_case_id,
    inquiryId,
    staffId
  }, {
    idempotencyKey: `inquiry-cases:${caseRow.id}:cleared:${caseRow.cleared_at || Date.now()}`,
    clientId: caseRow.client_id,
    orgId: caseRow.org_id
  });
  return { name: "inquiry.removed", id: res.id, deduped: res.deduped };
}

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["staff"], { db });
  if (!principal) return;

  const role = String(principal.role || "").toLowerCase();
  if (!WRITE_ROLES.has(role)) {
    return res.status(403).json({
      ok: false, error: "forbidden",
      required: ["inquiry_specialist", "admin", "owner"]
    });
  }

  const orgId = principal.orgId;
  if (!orgId) return res.status(403).json({ ok: false, error: "no_org" });

  try {
    if (req.method === "GET") {
      const caseId = (req.query || {}).case_id;
      if (!isUuid(caseId)) return res.status(400).json({ ok: false, error: "case_id must be a uuid" });
      const caseRow = await loadCase(caseId, orgId);
      if (!caseRow) return res.status(404).json({ ok: false, error: "case not found" });
      const inquiries = await loadInquiries(caseId);
      return res.status(200).json({
        ok: true,
        case: {
          ...caseRow,
          hold_duration_display:
            caseRow.master_call_state === "holding"
              ? holdDurationDisplay(caseRow.hold_started_at)
              : null
        },
        inquiries
      });
    }

    if (req.method === "POST") {
      const shift = await requireActiveShift(req, res, { db, principal, exempt: SUPER_ROLES });
      if (!shift) return;

      const body = req.body || {};
      const caseId = body.case_id;
      if (!isUuid(caseId)) return res.status(400).json({ ok: false, error: "case_id must be a uuid" });
      const existing = await loadCase(caseId, orgId);
      if (!existing) return res.status(404).json({ ok: false, error: "case not found" });

      const staffId = principal.staffId;
      const emitted = [];

      if (body.action === "clear_inquiry") {
        if (!isUuid(body.inquiry_id)) {
          return res.status(400).json({ ok: false, error: "inquiry_id must be a uuid" });
        }
        const { inquiry, caseRow, caseCleared } = await clearInquiry(db, {
          inquiryId: body.inquiry_id,
          staffId
        });
        if (inquiry.case_id !== caseId) {
          return res.status(400).json({ ok: false, error: "inquiry not on this case" });
        }
        if (caseCleared && caseRow) {
          emitted.push(await emitRemoved(caseRow, { staffId, inquiryId: inquiry.id }));
        }
        return res.status(200).json({
          ok: true, inquiry, case: caseRow, caseCleared, emitted
        });
      }

      if (body.action === "mark_cleared") {
        const { caseRow, caseCleared } = await closeCase(db, {
          caseId, asCleared: true, reason: body.reason || "marked_cleared_by_rep"
        });
        if (caseCleared) {
          emitted.push(await emitRemoved(caseRow, { staffId }));
        }
        return res.status(200).json({
          ok: true, case: caseRow, caseCleared, inquiries: await loadInquiries(caseId), emitted
        });
      }

      if (body.action === "close") {
        const { caseRow, caseCleared } = await closeCase(db, {
          caseId,
          reason: body.reason || null,
          asCleared: !!body.as_cleared,
          caseStatus: body.as_cleared ? "Cleared" : "Closed"
        });
        if (caseCleared) {
          emitted.push(await emitRemoved(caseRow, { staffId }));
        }
        return res.status(200).json({
          ok: true, case: caseRow, caseCleared, emitted
        });
      }

      return res.status(400).json({
        ok: false, error: "unknown_action",
        allowed: ["clear_inquiry", "mark_cleared", "close"]
      });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (err) {
    if (err instanceof InquiryCaseError) {
      return res.status(err.status).json({ ok: false, error: err.message });
    }
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
}
