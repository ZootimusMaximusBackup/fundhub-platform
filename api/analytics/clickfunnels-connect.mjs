// POST /api/analytics/clickfunnels-connect — save a ClickFunnels API key +
// subdomain, after proving they actually work.
//
// STAFF ONLY, ORG-WIDE. analytics_connections (302) has no partner concept —
// this is Chris's own ClickFunnels workspace, not a partner's — so there is no
// partner branch here, matching api/read/ad-books.mjs's shape exactly:
// requireAuth then requireRole(ROLE_SETS.STAFF).
//
// VALIDATES BEFORE SAVING. listFunnels() is called with the given credentials
// BEFORE anything touches the database. A failure there refuses the request
// with ClickFunnels' own error message and writes nothing — a broken key saved
// as "active" would fail every future sync silently against a row that looks
// connected.
//
// NEVER RETURNS THE CREDENTIAL. Not the plaintext, not the ciphertext. This
// table's one JSON blob column (encrypted_credentials) doesn't match the shape
// src/adplatforms/tokens.mjs's redactConnection() expects
// (encrypted_access_token/encrypted_refresh_token), so the response is built
// by hand from three named fields instead of spreading a row.
//
// RLS (302) is FORCE + staff-only on analytics_connections. A bare db.query
// leaves fundhub.actor unset, so fundhub_is_staff() reads false and the write
// is silently refused by the policy — see src/partners/rls.mjs's own comment
// on this exact failure mode. asStaff() stamps the transaction first.

import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { asStaff } from "../../src/partners/rls.mjs";
import { encryptToken } from "../../src/adplatforms/tokens.mjs";
import { listFunnels } from "../../src/analytics/clickfunnels.mjs";

// A ClickFunnels subdomain is a DNS label (the X in X.myclickfunnels.com) and
// this value is interpolated straight into a request hostname in
// src/analytics/clickfunnels.mjs's baseUrl() — validate the shape before it
// ever reaches a URL, the same discipline as every other value that becomes
// part of an outbound request.
const SUBDOMAIN_RE = /^[a-z0-9-]{1,63}$/i;

export default async function handler(req, res, deps = {}) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, deps);
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) return res.status(403).json({ ok: false, error: "forbidden" });

  const body = req.body || {};
  const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";
  const subdomain = typeof body.subdomain === "string" ? body.subdomain.trim().toLowerCase() : "";

  if (!apiKey) return res.status(400).json({ ok: false, error: "api_key_required" });
  if (!subdomain || !SUBDOMAIN_RE.test(subdomain)) {
    return res.status(400).json({
      ok: false,
      error: "subdomain_invalid",
      message: "subdomain must look like the X in X.myclickfunnels.com"
    });
  }

  const encrypted = encryptToken(JSON.stringify({ api_key: apiKey, subdomain }), { partnerId: orgId });

  // Prove it before saving anything. This probe connection is never written —
  // it exists only for this one call.
  try {
    await listFunnels({ encrypted_credentials: encrypted, org_id: orgId }, { fetch: deps.fetch });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: "clickfunnels_rejected",
      message: err.platformMessage || err.message || "ClickFunnels rejected these credentials"
    });
  }

  try {
    const row = await asStaff((tx) => tx.query(
      `INSERT INTO analytics_connections
         (org_id, platform, external_account_id, encrypted_credentials, connection_state, last_error)
       VALUES ($1, 'clickfunnels', $2, $3, 'active', NULL)
       ON CONFLICT (org_id, platform) DO UPDATE SET
         external_account_id  = EXCLUDED.external_account_id,
         encrypted_credentials = EXCLUDED.encrypted_credentials,
         connection_state      = 'active',
         last_error            = NULL,
         updated_at             = now()
       RETURNING id, external_account_id, connection_state`,
      [orgId, subdomain, encrypted]
    ).then((r) => r.rows[0]));

    return res.status(200).json({ ok: true, connection: row });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
