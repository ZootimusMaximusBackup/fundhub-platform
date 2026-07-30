// Shared-secret gate for the dashboard endpoints. The dashboard exposes client
// PII (names/emails/phones/messages), so the endpoints must not be open.
// A single DASHBOARD_SECRET protects them: the browser opens
// /dashboard.html?key=<secret> and the page sends it as the x-dashboard-key
// header (or ?key=). Fail-CLOSED in production when the secret isn't configured.

import crypto from "node:crypto";

export function checkDashboardAuth(req, env = process.env) {
  const secret = env.DASHBOARD_SECRET;
  if (!secret) {
    /* FAIL CLOSED. This used to return `env.NODE_ENV !== "production"`, which
       reads as "open in dev only" but is not what it does on the deploy target:
       netlify.toml sets neither DASHBOARD_SECRET nor NODE_ENV, so NODE_ENV is
       undefined in the deployed function and the gate returned true. An
       anonymous GET /api/dashboard/clients answered 200 with the full client
       book, and POST /api/dashboard/seed wrote rows. It was masked only by
       DATABASE_URL being unset — i.e. it would have gone live at the moment
       someone provisioned the database.

       "Absent config" must never mean "no gate". The endpoints still accept a
       real staff session (see attachStaff in each handler), so local
       development works without a secret; what no longer works is reaching
       client PII with no credential at all. */
    return false;
  }
  const provided = req?.headers?.["x-dashboard-key"] || req?.query?.key || "";
  if (!provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(secret));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* requireDashboardAccess — the one gate all four /api/dashboard/* routes use.

   It existed as a line copied into each handler:

     const staff = await attachStaff(req, { db });
     if (!staff && !checkDashboardAuth(req)) return res.status(401)...

   which had two problems. Four copies drift, and — because attachStaff returns
   null both for "no session" and for "could not reach the database" — a total
   outage answered 401 unauthorized, telling every signed-in user their
   credentials had gone bad and prompting the frontend to sign them out.

   Returns the staff member (or `true` for a shared-secret caller) on success,
   or writes the refusal and returns null. Call it as:

     const who = await requireDashboardAccess(req, res, { db });
     if (!who) return;
*/
export async function requireDashboardAccess(req, res, { db } = {}) {
  const { attachStaff } = await import("./middleware/requireAuth.mjs");
  const staff = await attachStaff(req, { db });
  if (staff) return staff;

  // Ours, not theirs — and data.js reads db:"down" as an outage banner rather
  // than as a signed-out state.
  if (req.authUnavailable) {
    res.status(503).json({ ok: false, error: "auth_unavailable", db: "down" });
    return null;
  }
  if (checkDashboardAuth(req)) return true;

  res.status(401).json({ ok: false, error: "unauthorized" });
  return null;
}
