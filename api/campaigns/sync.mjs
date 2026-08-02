// POST /api/campaigns/sync — pull Meta campaigns / ad sets / ads / insights
// into local tables for one partner connection.
//
// Credentials: connection row's encrypted token (ad_platform_connections).
// App-level env (optional, for future token refresh):
//   META_APP_ID, META_APP_SECRET, META_API_VERSION
// Leave unset until a Meta app is configured — sync then returns
// credential_missing rather than inventing a token.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { decryptToken } from "../../src/adplatforms/tokens.mjs";
import { callPlatform } from "../../src/adplatforms/_api.mjs";
import { normalizeInsight } from "../../src/adplatforms/meta.mjs";
import { safeError } from "../../src/http/health.mjs";

const API_VERSION = () => process.env.META_API_VERSION || "v21.0";
const BASE = "https://graph.facebook.com";

function acct(connection) {
  const id = String(connection.external_ad_account_id || "");
  return id.startsWith("act_") ? id : `act_${id}`;
}

async function metaGet(connection, path, fields, ctx) {
  const token = decryptToken(connection.encrypted_access_token, {
    partnerId: connection.partner_id
  });
  if (!token) {
    const e = new Error("connection has no access token");
    e.code = "NO_TOKEN";
    throw e;
  }
  const qs = new URLSearchParams({ fields, limit: "100" });
  return callPlatform({
    url: `${BASE}/${API_VERSION()}/${path}?${qs}`,
    token,
    method: "GET",
    ctx
  });
}

async function upsertCampaign(tx, { orgId, partnerId, connectionId, row }) {
  const externalId = String(row.id);
  const budget = row.daily_budget != null
    ? Math.round(Number(row.daily_budget))
    : null;
  const existing = await tx.query(
    `SELECT id FROM campaigns WHERE connection_id = $1 AND external_id = $2`,
    [connectionId, externalId]
  );
  if (existing.rows[0]) {
    const u = await tx.query(
      `UPDATE campaigns SET
         name = $2, status = $3, objective = $4,
         budget_cents = COALESCE($5, budget_cents),
         special_ad_category = COALESCE($6, special_ad_category),
         synced_at = now(), updated_at = now(), last_error = NULL
       WHERE id = $1 RETURNING *`,
      [existing.rows[0].id, row.name, row.status || null, row.objective || null, budget,
       Array.isArray(row.special_ad_categories) && row.special_ad_categories[0]
         ? row.special_ad_categories[0]
         : null]
    );
    return u.rows[0];
  }
  const sac = Array.isArray(row.special_ad_categories) && row.special_ad_categories[0]
    ? row.special_ad_categories[0]
    : "CREDIT";
  const ins = await tx.query(
    `INSERT INTO campaigns (
       org_id, partner_id, connection_id, platform, external_id,
       name, status, objective, offer_type, special_ad_category, budget_cents,
       approval_state, synced_at
     ) VALUES (
       $1,$2,$3,'meta',$4,$5,$6,$7,'funding',$8,COALESCE($9,0),'draft',now()
     ) RETURNING *`,
    [orgId, partnerId, connectionId, externalId, row.name,
     row.status || null, row.objective || null, sac, budget]
  );
  return ins.rows[0];
}

async function upsertAdSet(tx, { orgId, partnerId, connectionId, campaignId, row }) {
  const externalId = String(row.id);
  const existing = await tx.query(
    `SELECT id FROM ad_sets WHERE connection_id = $1 AND external_id = $2`,
    [connectionId, externalId]
  );
  const budget = row.daily_budget != null ? Math.round(Number(row.daily_budget)) : 0;
  if (existing.rows[0]) {
    const u = await tx.query(
      `UPDATE ad_sets SET name = $2, status = $3, budget_cents = COALESCE($4, budget_cents),
         synced_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
      [existing.rows[0].id, row.name, row.status || null, budget]
    );
    return u.rows[0];
  }
  const ins = await tx.query(
    `INSERT INTO ad_sets (
       org_id, partner_id, connection_id, campaign_id, external_id, name, status, budget_cents, synced_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()) RETURNING *`,
    [orgId, partnerId, connectionId, campaignId, externalId, row.name,
     row.status || null, budget]
  );
  return ins.rows[0];
}

async function upsertAd(tx, { orgId, partnerId, connectionId, campaignId, adSetId, row }) {
  const externalId = String(row.id);
  const existing = await tx.query(
    `SELECT id FROM ads WHERE connection_id = $1 AND external_id = $2`,
    [connectionId, externalId]
  );
  if (existing.rows[0]) {
    const u = await tx.query(
      `UPDATE ads SET name = $2, status = $3, updated_at = now() WHERE id = $1 RETURNING *`,
      [existing.rows[0].id, row.name, row.status || null]
    );
    return u.rows[0];
  }
  const ins = await tx.query(
    `INSERT INTO ads (
       org_id, partner_id, connection_id, campaign_id, ad_set_id, external_id, name, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [orgId, partnerId, connectionId, campaignId, adSetId, externalId, row.name, row.status || null]
  );
  return ins.rows[0];
}

async function storeInsights(tx, { orgId, partnerId, adId, insights }) {
  let n = 0;
  for (const raw of insights || []) {
    const row = normalizeInsight(raw);
    const day = raw.date_start || raw.date || null;
    if (!day || !adId) continue;
    await tx.query(
      `INSERT INTO ad_metrics_daily (
         org_id, partner_id, ad_id, date, spend_cents, impressions, clicks, ctr, roas
       ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9)
       ON CONFLICT (ad_id, date) DO UPDATE SET
         spend_cents = EXCLUDED.spend_cents,
         impressions = EXCLUDED.impressions,
         clicks = EXCLUDED.clicks,
         ctr = EXCLUDED.ctr,
         roas = EXCLUDED.roas,
         synced_at = now()`,
      [orgId, partnerId, adId, day, row.spend_cents ?? 0,
       row.impressions ?? 0, row.clicks ?? 0, row.ctr ?? null, row.roas ?? null]
    ).catch(() => null);
    n += 1;
  }
  return n;
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db: database });
  if (!principal) return;

  const body = req.body || {};
  const query = { ...(req.query || {}), partner_id: body.partner_id || (req.query || {}).partner_id };
  const partnerId = resolvePartnerId(principal, query);
  if (!partnerId) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }

  // App credentials are optional for user-token sync, but document the gap.
  const missingApp = !process.env.META_APP_ID || !process.env.META_APP_SECRET;

  try {
    const summary = await withPartnerScope({ kind: "partner", partnerId }, async (tx) => {
      const connId = body.connection_id || null;
      const conns = await tx.query(
        `SELECT * FROM ad_platform_connections
          WHERE partner_id = $1 AND platform = 'meta'
            AND connection_state = 'active'
            AND ($2::uuid IS NULL OR id = $2)`,
        [partnerId, connId]
      );
      if (!conns.rows.length) {
        const e = new Error("no active Meta connection for this partner");
        e.code = "NO_CONNECTION";
        throw e;
      }

      const stats = { connections: 0, campaigns: 0, ad_sets: 0, ads: 0, insights: 0, errors: [] };
      const orgId = conns.rows[0].org_id;

      for (const connection of conns.rows) {
        stats.connections += 1;
        try {
          const campRes = await metaGet(
            connection,
            `${acct(connection)}/campaigns`,
            "id,name,status,objective,daily_budget,special_ad_categories",
            deps
          );
          for (const crow of campRes?.data || []) {
            const camp = await upsertCampaign(tx, {
              orgId, partnerId, connectionId: connection.id, row: crow
            });
            stats.campaigns += 1;

            const sets = await metaGet(
              connection,
              `${crow.id}/adsets`,
              "id,name,status,daily_budget,campaign_id",
              deps
            );
            for (const srow of sets?.data || []) {
              const adSet = await upsertAdSet(tx, {
                orgId, partnerId, connectionId: connection.id,
                campaignId: camp.id, row: srow
              });
              stats.ad_sets += 1;

              const ads = await metaGet(
                connection,
                `${srow.id}/ads`,
                "id,name,status,adset_id",
                deps
              );
              for (const arow of ads?.data || []) {
                const ad = await upsertAd(tx, {
                  orgId, partnerId, connectionId: connection.id,
                  campaignId: camp.id, adSetId: adSet.id, row: arow
                });
                stats.ads += 1;

                try {
                  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
                  const until = new Date().toISOString().slice(0, 10);
                  const params = new URLSearchParams({
                    fields: "spend,impressions,clicks,ctr,actions,purchase_roas,date_start",
                    time_range: JSON.stringify({ since, until }),
                    time_increment: "1",
                    level: "ad"
                  });
                  const token = decryptToken(connection.encrypted_access_token, {
                    partnerId: connection.partner_id
                  });
                  const ins = await callPlatform({
                    url: `${BASE}/${API_VERSION()}/${arow.id}/insights?${params}`,
                    token,
                    method: "GET",
                    ctx: deps
                  });
                  stats.insights += await storeInsights(tx, {
                    orgId, partnerId, adId: ad.id, insights: ins?.data || []
                  });
                } catch (err) {
                  stats.errors.push({ ad: arow.id, error: String(err.message || err) });
                }
              }
            }
          }

          await tx.query(
            `UPDATE ad_platform_connections SET last_synced_at = now(), last_error = NULL
              WHERE id = $1`,
            [connection.id]
          ).catch(() => null);
        } catch (err) {
          stats.errors.push({ connection: connection.id, error: String(err.message || err) });
          await tx.query(
            `UPDATE ad_platform_connections SET last_error = $2 WHERE id = $1`,
            [connection.id, String(err.message || err).slice(0, 500)]
          ).catch(() => null);
        }
      }
      return stats;
    });

    return res.status(200).json({
      ok: true,
      platform: "meta",
      ...summary,
      meta_app_configured: !missingApp,
      note: missingApp
        ? "META_APP_ID / META_APP_SECRET unset — sync uses connection user tokens only; token refresh needs the app credentials (see docs/STILL-MISSING.md)."
        : null
    });
  } catch (err) {
    if (err.code === "NO_CONNECTION" || err.code === "NO_TOKEN") {
      return res.status(400).json({
        ok: false,
        error: err.code === "NO_TOKEN" ? "credential_missing" : "no_meta_connection",
        message: err.message,
        need: err.code === "NO_TOKEN"
          ? "Store a Meta Marketing API user token on ad_platform_connections (encrypted). Optionally set META_APP_ID + META_APP_SECRET for refresh."
          : "Connect a Meta ad account for this partner first."
      });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
