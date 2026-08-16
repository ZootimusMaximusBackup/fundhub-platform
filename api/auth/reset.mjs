// POST /api/auth/reset — the public half of staff password reset. Open, like
// /api/auth/login: no session required, because a locked-out person by
// definition has no session. See api/auth/admin-reset.mjs for the other half,
// which does require one (owner/admin) and is kept in its own file so this
// route's gate — none — stays a single, statically traceable fact rather than
// a branch a journey generator has to guess at.
//
//   { action: "request", email }
//     ALWAYS replies { ok:true } — never confirms whether the address exists
//     (src/auth/invite.mjs:requestPasswordReset already works this way). A
//     token IS created in the database when the address is real, but it is not
//     returned here: nothing in this repo sends outbound mail (src/mail/ is
//     deliberately inert — CLAUDE.md §12), so handing an anonymous caller a
//     live reset token would BE the entire security model of "forgot
//     password" with no delivery step in between. This is the honest version
//     of that gap, not a bypass of it — the working path today is
//     api/auth/admin-reset.mjs, which an owner or admin uses from the Staff
//     screen to hand someone a real link.
//
//   { action: "confirm", token, password }
//     The token IS the credential. Sets the new password and revokes every
//     existing session for that staff member.
//
// Thin mount over src/auth/invite.mjs — all the real logic lives there.

import { db } from "../../src/db.mjs";
import { requestPasswordReset, setPasswordWithToken } from "../../src/auth/invite.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const body = req.body || {};
  const action = String(body.action || "").trim().toLowerCase();

  if (action === "request") {
    await requestPasswordReset(db, { email: body.email });
    return res.status(200).json({
      ok: true,
      message: "If that email has a staff account, a reset request was created. " +
        "This system does not send email — ask an owner or admin to reset it for " +
        "you from the Staff screen."
    });
  }

  if (action === "confirm") {
    // Invite links and reset links share this page. Kind is on the token row.
    const result = await setPasswordWithToken(db, { token: body.token, password: body.password });
    if (!result.ok) {
      return res.status(result.status || 400).json({ ok: false, error: result.error, detail: result.detail });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
