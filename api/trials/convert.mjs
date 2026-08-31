// POST /api/trials/convert — day 8. Yes, or no.
//
// STAFF ONLY, gated with requireRole AFTER requireAuth. This call flips a
// partner to 'active' and stamps agreement_signed_at, and those two together
// are the whole of 042_partners.sql's payout gate. Nobody but an owner or an
// admin gets to open it.
//
// { "decision": "convert" }  needs agreement_signed_at from a real signature.
//                            Voids the trial's affiliate referrals with reason
//                            'converted_to_partner' — never deletes them.
// { "decision": "decline" }  pauses the partner, keeps the affiliate row and
//                            every lead, queues the affiliate welcome, archives
//                            the branded page, freezes the dashboard.
//
// NO SIGNATURE, NO CONVERSION. agreement_signed_at is not defaulted to now().
// A conversion that stamps it from nothing would open the payout gate on a
// partner who never signed anything.
//
// NOBODY IS PAID BY THIS CALL, either way, and the response says so in
// `payable` and `payable_blocked_reason`. Nothing in production writes partner
// or affiliate money yet. Do not render "you will be paid" over that.
//
// COMPLIANCE REVIEW REQUIRED — fee timing and payout gating.

import { db } from "../../src/db.mjs";
import { requireRole } from "../../src/http/middleware/requireRole.mjs";
import { convertTrial, declineTrial } from "../../src/trials/conversion.mjs";
import { safeError } from "../../src/http/health.mjs";

function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); } catch { return null; }
  }
  if (typeof req.rawBody === "string") {
    try { return JSON.parse(req.rawBody || "{}"); } catch { return null; }
  }
  return null;
}

function parseMoment(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireRole("owner", "admin")(req, res, { db: database });
  if (!staff) return;

  const body = readBody(req);
  if (body === null) return res.status(400).json({ ok: false, error: "invalid_json" });

  const partnerId = String(body.partner_id || "").trim();
  if (!partnerId) return res.status(400).json({ ok: false, error: "partner_id_required" });

  const decision = String(body.decision || "").trim().toLowerCase();
  if (decision !== "convert" && decision !== "decline") {
    return res.status(400).json({
      ok: false,
      error: "decision_required",
      message: 'decision must be "convert" or "decline"'
    });
  }

  try {
    if (decision === "decline") {
      const out = await declineTrial(database, {
        orgId: staff.org_id,
        partnerId,
        approvedByStaffId: staff.id,
        reason: body.reason ? String(body.reason).slice(0, 500) : null
      });
      return res.status(out.ok ? (out.status || 200) : (out.status || 400)).json(out);
    }

    const signedAt = parseMoment(body.agreement_signed_at);
    if (!signedAt) {
      return res.status(400).json({
        ok: false,
        error: "agreement_signed_at_required",
        message: "A conversion stamps the payout gate open. It needs the moment the agreement was actually signed."
      });
    }

    const out = await convertTrial(database, {
      orgId: staff.org_id,
      partnerId,
      agreementSignedAt: signedAt,
      approvedByStaffId: staff.id
    });
    return res.status(out.ok ? (out.status || 200) : (out.status || 400)).json(out);
  } catch (err) {
    if (err && typeof err.code === "string" && err.code.startsWith("22")) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
