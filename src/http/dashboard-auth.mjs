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
