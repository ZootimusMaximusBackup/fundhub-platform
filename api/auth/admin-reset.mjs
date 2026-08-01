// POST /api/auth/admin-reset — an owner or admin resets someone else's
// password from the Staff screen.
//
// Requires an owner/admin session for the WHOLE route, unconditionally — kept
// in its own file rather than a branch inside api/auth/reset.mjs so this gate
// is the one, statically traceable fact about this file
// (scripts/journeys/extract.mjs reads requireRole(...)(req, res) literally;
// a conditional gate inside one handler is exactly the shape it cannot trace,
// and CLAUDE.md §4 says an untraceable gate must be reported, never guessed).
//
// { email } → { ok, token, expiresAt, resetPath }
//
// The caller is authenticated and authorized, so the token comes back in the
// response — this mirrors src/auth/invite.mjs:inviteStaff() exactly ("hand it
// to the client and drop it"). Nothing in this repo sends outbound mail
// (CLAUDE.md §12), so the admin is the delivery mechanism: copy the link,
// send it to the person by whatever channel is already in use.

import { db } from "../../src/db.mjs";
import { requireRole } from "../../src/http/middleware/requireRole.mjs";
import { requestPasswordReset } from "../../src/auth/invite.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireRole("owner", "admin")(req, res);
  if (!staff) return; // requireRole already wrote the 401/403

  const email = String((req.body || {}).email || "").trim();
  if (!email) return res.status(400).json({ ok: false, error: "email_required" });

  const result = await requestPasswordReset(db, { email, orgId: staff.org_id });
  if (!result.token) {
    return res.status(404).json({ ok: false, error: "staff_not_found_or_suspended" });
  }
  return res.status(200).json({
    ok: true,
    token: result.token,
    expiresAt: result.expiresAt,
    resetPath: "/reset-password.html?token=" + encodeURIComponent(result.token)
  });
}
