// POST /api/campaigns/meta-agency — store a partner's Meta Business ID and
// request Fundhub agency access (Business-to-Business). Not Social OAuth.
//
// Body:
//   partner_id            — required for staff
//   meta_business_id      — client's Meta Business Portfolio id (digits)
//   ad_account_id         — optional act_… when known
//
// Always upserts ad_platform_connections (pending unless Graph already active).
// Tries Graph managed_businesses and, when ad_account_id is set, client_ad_accounts.
// Client must still Approve once in Meta — CRM cannot skip that.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { encryptToken } from "../../src/adplatforms/tokens.mjs";
import {
  normalizeMetaBusinessId,
  normalizeMetaAdAccountId,
  pendingAdAccountPlaceholder,
  requestManagedBusiness,
  requestClientAdAccountAccess
} from "../../src/adplatforms/meta.mjs";
import { safeError } from "../../src/http/health.mjs";

const WAITING =
  "Waiting on Meta approve — client admin must Accept in Business Settings → Requests. Fundhub cannot skip that click.";

function agencyToken(env = process.env) {
  return env.META_ACCESS_TOKEN || null;
}

function agencyBusinessId(env = process.env) {
  return normalizeMetaBusinessId(env.META_BUSINESS_ID);
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const env = deps.env || process.env;
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db: database });
  if (!principal) return;

  const body = req.body || {};
  const partnerId = resolvePartnerId(principal, {
    partner_id: body.partner_id || (req.query || {}).partner_id
  });
  if (!partnerId) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }

  const clientBiz = normalizeMetaBusinessId(body.meta_business_id || body.external_business_id);
  if (!clientBiz) {
    return res.status(400).json({
      ok: false,
      error: "meta_business_id_required",
      message: "Paste the partner's Meta Business Portfolio ID (digits only)."
    });
  }

  const adAccount = normalizeMetaAdAccountId(body.ad_account_id || body.external_ad_account_id);
  const externalAdAccountId = adAccount || pendingAdAccountPlaceholder(clientBiz);
  const agencyBiz = agencyBusinessId(env);
  const token = agencyToken(env);

  if (!agencyBiz) {
    return res.status(503).json({
      ok: false,
      error: "agency_business_missing",
      message: "META_BUSINESS_ID is not set on the server."
    });
  }
  if (!token) {
    return res.status(503).json({
      ok: false,
      error: "agency_token_missing",
      message: "META_ACCESS_TOKEN is not set on the server."
    });
  }

  const graph = {
    managed_businesses: null,
    client_ad_accounts: null
  };
  let platformError = null;

  try {
    await requestManagedBusiness(
      { agencyBusinessId: agencyBiz, clientBusinessId: clientBiz, accessToken: token },
      { fetch: deps.fetch }
    );
    graph.managed_businesses = { ok: true };
  } catch (err) {
    graph.managed_businesses = {
      ok: false,
      code: err.platformCode ?? null,
      message: err.platformMessage || err.message || "request failed"
    };
    platformError = graph.managed_businesses.message;
  }

  if (adAccount) {
    try {
      await requestClientAdAccountAccess(
        {
          agencyBusinessId: agencyBiz,
          adAccountId: adAccount,
          accessToken: token
        },
        { fetch: deps.fetch }
      );
      graph.client_ad_accounts = { ok: true };
    } catch (err) {
      graph.client_ad_accounts = {
        ok: false,
        code: err.platformCode ?? null,
        message: err.platformMessage || err.message || "request failed"
      };
      if (!platformError) platformError = graph.client_ad_accounts.message;
    }
  }

  const graphOk =
    graph.managed_businesses?.ok === true ||
    graph.client_ad_accounts?.ok === true;

  const lastError = graphOk
    ? WAITING
    : [platformError, WAITING].filter(Boolean).join(" · ");

  try {
    const row = await withPartnerScope({ kind: "partner", partnerId }, async (tx) => {
      const partner = (await tx.query(
        `SELECT id, org_id FROM partners WHERE id = $1`,
        [partnerId]
      )).rows[0];
      if (!partner) {
        const e = new Error("partner not found");
        e.code = "NOT_FOUND";
        throw e;
      }

      const enc = encryptToken(token, { partnerId, env });
      const scopes = JSON.stringify(["ads_management", "ads_read", "business_management"]);

      const upsert = await tx.query(
        `INSERT INTO ad_platform_connections (
           org_id, partner_id, platform,
           external_business_id, external_ad_account_id,
           encrypted_access_token, scopes, connection_state,
           platform_verification_state, last_error, updated_at
         ) VALUES (
           $1, $2, 'meta', $3, $4, $5, $6::jsonb, 'pending',
           'unverified', $7, now()
         )
         ON CONFLICT (partner_id, platform, external_ad_account_id)
         DO UPDATE SET
           external_business_id = EXCLUDED.external_business_id,
           encrypted_access_token = COALESCE(EXCLUDED.encrypted_access_token, ad_platform_connections.encrypted_access_token),
           scopes = EXCLUDED.scopes,
           connection_state = CASE
             WHEN ad_platform_connections.connection_state = 'active' THEN 'active'
             ELSE 'pending'
           END,
           last_error = EXCLUDED.last_error,
           updated_at = now()
         RETURNING id, partner_id, platform, external_business_id, external_ad_account_id,
                   connection_state, last_error,
                   (encrypted_access_token IS NOT NULL) AS has_access_token`,
        [partner.org_id, partnerId, clientBiz, externalAdAccountId, enc, scopes, lastError]
      );
      return upsert.rows[0];
    }, { pool: deps.pool });

    return res.status(200).json({
      ok: true,
      connection: {
        id: row.id,
        partner_id: row.partner_id,
        platform: row.platform,
        external_business_id: row.external_business_id,
        external_ad_account_id: row.external_ad_account_id,
        connection_state: row.connection_state,
        last_error: row.last_error,
        has_access_token: row.has_access_token
      },
      graph,
      meta_approve_required: true,
      message: graphOk
        ? "Agency request sent to Meta. Partner admin must Approve once in Business Settings → Requests."
        : "Saved in CRM as pending. Meta Graph could not complete the request from this app/token — partner still must Approve (or invite Fundhub Business " +
          agencyBiz +
          ") in Meta. See graph errors for capability gaps."
    });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, error: "partner_not_found" });
    }
    return res.status(500).json({ ok: false, error: "server_error", ...safeError(err) });
  }
}
