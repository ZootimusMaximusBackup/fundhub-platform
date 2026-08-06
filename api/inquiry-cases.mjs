// POST /api/inquiry-cases — create / update / close inquiry removal cases.
// Closing a Completed case emits inquiry.removed on the canonical bus.

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../src/http/read-api.mjs";
import { createCase, updateCase, closeCase, CASE_STATUSES } from "../src/inquiry-ops/cases.mjs";
import { clearInquiry as clearBridgeInquiry } from "../src/inquiry-removal/cases.mjs";
import { sendCase, SendGateError } from "../src/inquiry-ops/send.mjs";
import { overrideBureauGate } from "../src/inquiry-ops/gate.mjs";
import { sendLetter } from "../src/messaging/providers/lob-letter.mjs";
import { loadMailServiceLevel } from "../src/inquiry-ops/call-scheduler.mjs";
import { emit } from "../src/events/bus.mjs";
import { dbDown } from "../src/http/db-down.mjs";

const ACTIONS = new Set([
  "create", "update", "close", "mark_cleared", "clear_inquiry", "send", "gate_override"
]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const emitFn = deps.emit ?? emit;

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
  const action = String(body.action || "update").trim().toLowerCase();
  if (!ACTIONS.has(action)) {
    return res.status(400).json({
      ok: false,
      error: "unknown_action",
      message: `Use one of: ${[...ACTIONS].join(", ")}`
    });
  }

  try {
    if (action === "clear_inquiry") {
      const inquiryId = body.inquiry_id || body.inquiryId;
      if (!inquiryId || !isUuid(inquiryId)) {
        return res.status(400).json({ ok: false, error: "inquiry_id_required" });
      }
      const result = await clearBridgeInquiry(database, {
        inquiryId,
        staffId: staff.id
      });
      if (result.caseCleared && result.caseRow) {
        await emitFn("inquiry.removed", {
          org_id: orgId,
          client_id: result.caseRow.client_id,
          case_id: result.caseRow.id,
          inquiry_id: result.inquiry.id,
          source: "staff_clear_inquiry"
        });
      }
      return res.status(200).json({ ok: true, inquiry: result.inquiry, case: result.caseRow, case_cleared: result.caseCleared });
    }

    if (action === "create") {
      if (!isUuid(body.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id required" });
      }
      // Client must belong to the session org. Without this, a staff member
      // could attach another company's client id to a case in their own org.
      const owned = await database.query(
        `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
        [body.client_id, orgId]
      );
      if (!owned.rows.length) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      const c = await createCase(database, {
        orgId,
        row: {
          ...body,
          requested_by: body.requested_by || staff.name || staff.email || staff.id
        }
      });
      return res.status(200).json({ ok: true, case: c });
    }

    if (!isUuid(body.id)) {
      return res.status(400).json({ ok: false, error: "id required" });
    }

    if (action === "update") {
      const c = await updateCase(database, { orgId, id: body.id, patch: body });
      if (!c) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json({ ok: true, case: c });
    }

    if (action === "gate_override") {
      try {
        const c = await overrideBureauGate(database, {
          orgId,
          caseId: body.id,
          staffId: staff.id,
          staffRole: staff.role
        });
        return res.status(200).json({ ok: true, case: c });
      } catch (err) {
        return res.status(err.status || 400).json({
          ok: false,
          error: err.code || "gate_override_failed",
          message: err.message
        });
      }
    }

    if (action === "send") {
      try {
        const wantMail = body.mail === true || body.channels?.mail === true;
        // Per-case override on the send row (e.g. downgrade to priority).
        // Otherwise ai_bureau_config.mail_service_level for that bureau.
        const mailServiceOverride =
          body.mail_service_level || body.mailServiceLevel || null;
        const mailSender = wantMail
          ? async ({ caseRow }) => {
              const html = caseRow.letter_draft_html || "<p>Dispute letter</p>";
              const serviceLevel = await loadMailServiceLevel(database, {
                orgId,
                bureau: caseRow.selected_bureaus_raw,
                override: mailServiceOverride
              });
              const sent = await sendLetter({
                description: `Inquiry case ${caseRow.case_id || caseRow.id}`,
                file: `<html>${html}</html>`,
                serviceLevel,
                to: body.mail_to || body.mailTo || {
                  name: body.recipient_name || "Bureau",
                  address_line1: body.address_line1 || "PO Box",
                  address_city: body.address_city || "Allen",
                  address_state: body.address_state || "TX",
                  address_zip: body.address_zip || "75013"
                }
              });
              if (!sent.ok) {
                return { providerId: null, outcome: `mail_failed:${sent.error || "unknown"}` };
              }
              return {
                providerId: sent.providerId,
                outcome: "sent",
                serviceLevel: sent.serviceLevel || serviceLevel
              };
            }
          : null;
        const result = await sendCase(database, {
          caseId: body.id,
          staffId: staff.id,
          orgId,
          mail: wantMail,
          portal: body.portal === true || body.channels?.portal === true,
          portalConfirmation: body.portal_confirmation || body.portalConfirmation || null,
          portalUploadedAt: body.portal_uploaded_at || body.portalUploadedAt || null,
          note: body.note || null,
          mailSender
        });
        return res.status(200).json({ ok: true, ...result });
      } catch (err) {
        if (err instanceof SendGateError) {
          return res.status(err.status || 400).json({
            ok: false,
            error: err.code || "send_gate",
            message: err.message
          });
        }
        throw err;
      }
    }

    // close | mark_cleared
    const status = action === "mark_cleared" ? "Completed" : (body.case_status || "Completed");
    if (!CASE_STATUSES.includes(status)) {
      return res.status(400).json({ ok: false, error: "invalid_case_status" });
    }
    const c = await closeCase(database, {
      orgId,
      id: body.id,
      case_status: status,
      notes: body.notes || null,
      staff
    });
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });

    let event = null;
    if (status === "Completed") {
      event = await emitFn(
        database,
        "inquiry.removed",
        {
          caseId: c.case_id,
          inquiryRemovalCaseId: c.id,
          selectedBureaus: c.selected_bureaus_raw,
          fundingRoundId: c.funding_round_id,
          source: "inquiry_removal_case"
        },
        {
          orgId,
          clientId: c.client_id,
          idempotencyKey: `inquiry.removed:case:${c.id}`
        }
      );
    }

    return res.status(200).json({ ok: true, case: c, event });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
