// POST /api/auth/staff-update — owner/admin edits a staff profile.
//
// { staff_id, name, email, phone?, start_date? } → { ok, staff }
//
// Role and login status stay on staff-role and suspend. Owner name/email stay
// read-only; phone and the booked-call text switch may be saved on the owner.

import { db } from "../../src/db.mjs";
import { requireRole } from "../../src/http/middleware/requireRole.mjs";
import { updateStaffProfile } from "../../src/auth/invite.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireRole("owner", "admin")(req, res);
  if (!staff) return;

  const body = req.body || {};
  const staffId = String(body.staff_id || "").trim();
  if (!staffId) return res.status(400).json({ ok: false, error: "staff_id_required" });

  const result = await updateStaffProfile(db, {
    actor: staff,
    staffId,
    name: body.name,
    email: body.email,
    phone: body.phone,
    startDate: body.start_date,
    notifyBookedCallSms: typeof body.notify_booked_call_sms === "boolean"
      ? body.notify_booked_call_sms
      : undefined
  });
  if (!result.ok) {
    return res.status(result.status || 400).json({ ok: false, error: result.error });
  }
  return res.status(200).json({ ok: true, staff: result.staff });
}
