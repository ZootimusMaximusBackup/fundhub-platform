// Shared-secret gate for the dashboard endpoints. The dashboard exposes client
// PII (names/emails/phones/messages), so the endpoints must not be open.
// A single DASHBOARD_SECRET protects them: the browser opens
// /dashboard.html?key=<secret> and the page sends it as the x-dashboard-key
// header (or ?key=). Fail-CLOSED in production when the secret isn't configured.

import crypto from "node:crypto";

export function checkDashboardAuth(req, env = process.env) {
  const secret = env.DASHBOARD_SECRET;
  if (!secret) {
    // No secret set: allow only in non-production (local dev/testing); deny in prod.
    return env.NODE_ENV !== "production";
  }
  const provided = req?.headers?.["x-dashboard-key"] || req?.query?.key || "";
  if (!provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(secret));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
