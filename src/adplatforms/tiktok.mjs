// TikTok Marketing API adapter (Business Center partner access).
//
// ⚠️ CONFIRM BEFORE THIS RUNS LIVE. Endpoint shapes follow the documented
// Marketing API but are unproven against a real Business Center.
//
// CREDIT REPAIR CANNOT REACH THIS FILE. TikTok prohibits credit repair and debt
// relief advertising outright. That is blocked in three places — a CHECK
// constraint in 046 so the campaign row cannot exist, an unconditional branch in
// src/compliance/screen.mjs before any rule row is read, and the assertion below.
// The third is redundant by design: if it ever fires, one of the other two has
// been bypassed and that is worth an exception rather than a silent success.
//
// There is no override flag. Do not add one.
//
// TIKTOK SIGNALS FAILURE WITH HTTP 200 AND A NON-ZERO BODY CODE, which _api.mjs
// checks for. A status-only check would read a policy rejection as a success and
// mark the campaign live.

import { callPlatform } from "./_api.mjs";
import { decryptToken } from "./tokens.mjs";

export const PLATFORM = "tiktok";
const BASE = "https://business-api.tiktok.com/open_api";
const API_VERSION = process.env.TIKTOK_API_VERSION || "v1.3";

function tokenFor(connection) {
  const t = decryptToken(connection.encrypted_access_token, { partnerId: connection.partner_id });
  if (!t) throw new Error("connection has no access token");
  return t;
}

/* The last line of the credit-repair block. See the header. */
function assertNotCreditRepair(obj) {
  if (obj?.offer_type === "credit_repair") {
    throw new Error(
      "TikTok prohibits credit repair advertising outright — this should have been " +
      "blocked at the database (campaigns_tiktok_credit_repair_ck) and by the " +
      "compliance engine. Reaching the adapter means one of those was bypassed."
    );
  }
}

// TikTok authenticates with a header rather than a bearer token, so these calls
// pass the token through ctx and send an empty Authorization.
const withHeader = (connection, ctx) => ({
  ...ctx,
  fetch: async (url, init) => {
    const doFetch = ctx.fetch || globalThis.fetch;
    return doFetch(url, {
      ...init,
      headers: { ...init.headers, "Access-Token": tokenFor(connection), authorization: undefined }
    });
  }
});

export async function createCampaign(connection, campaign, ctx = {}) {
  assertNotCreditRepair(campaign);
  return callPlatform({
    url: `${BASE}/${API_VERSION}/campaign/create/`,
    token: tokenFor(connection),
    body: {
      advertiser_id: connection.external_ad_account_id,
      campaign_name: campaign.name,
      objective_type: campaign.objective || "LEAD_GENERATION",
      budget_mode: "BUDGET_MODE_DAY",
      budget: centsToUnits(campaign.budget_cents),
      operation_status: "DISABLE"        // never created live
    },
    ctx: withHeader(connection, ctx)
  });
}

export async function createAdSet(connection, adSet, ctx = {}) {
  assertNotCreditRepair(adSet);
  return callPlatform({
    url: `${BASE}/${API_VERSION}/adgroup/create/`,
    token: tokenFor(connection),
    body: {
      advertiser_id: connection.external_ad_account_id,
      campaign_id: adSet.external_campaign_id,
      adgroup_name: adSet.name,
      placement_type: "PLACEMENT_TYPE_AUTOMATIC",
      billing_event: adSet.billing_event || "CPC",
      optimization_goal: adSet.optimization_goal || "CONVERT",
      budget_mode: "BUDGET_MODE_DAY",
      budget: centsToUnits(adSet.budget_cents),
      operation_status: "DISABLE",
      ...(adSet.targeting || {})
    },
    ctx: withHeader(connection, ctx)
  });
}

export async function createAd(connection, ad, ctx = {}) {
  assertNotCreditRepair(ad);
  return callPlatform({
    url: `${BASE}/${API_VERSION}/ad/create/`,
    token: tokenFor(connection),
    body: {
      advertiser_id: connection.external_ad_account_id,
      adgroup_id: ad.external_ad_set_id,
      creatives: [{
        ad_name: ad.name,
        video_id: ad.external_creative_id,
        ad_text: ad.text || "",
        // TikTok's AI-generated content declaration.
        ...(ad.ai_disclosure ? { is_aigc: true } : {})
      }]
    },
    ctx: withHeader(connection, ctx)
  });
}

export async function updateBudget(connection, { externalId, budgetCents }, ctx = {}) {
  return callPlatform({
    url: `${BASE}/${API_VERSION}/campaign/update/`,
    token: tokenFor(connection),
    body: {
      advertiser_id: connection.external_ad_account_id,
      campaign_id: externalId,
      budget: centsToUnits(budgetCents)
    },
    ctx: withHeader(connection, ctx)
  });
}

const setStatus = (connection, externalId, status, ctx) => callPlatform({
  url: `${BASE}/${API_VERSION}/campaign/status/update/`,
  token: tokenFor(connection),
  body: {
    advertiser_id: connection.external_ad_account_id,
    campaign_ids: [externalId],
    operation_status: status
  },
  ctx: withHeader(connection, ctx)
});

export const pause  = (connection, { externalId }, ctx = {}) => setStatus(connection, externalId, "DISABLE", ctx);
export const resume = (connection, { externalId }, ctx = {}) => setStatus(connection, externalId, "ENABLE", ctx);

export async function fetchInsights(connection, { externalId, since, until }, ctx = {}) {
  const res = await callPlatform({
    url: `${BASE}/${API_VERSION}/report/integrated/get/`,
    token: tokenFor(connection),
    method: "GET",
    body: undefined,
    ctx: withHeader(connection, {
      ...ctx,
      query: { advertiser_id: connection.external_ad_account_id, ad_ids: [externalId], since, until }
    })
  });
  return (res?.data?.list || []).map(normalizeInsight);
}

export function normalizeInsight(row) {
  const m = row.metrics || {};
  const conversions = int(m.conversion);
  const spendCents = unitsToCents(m.spend);
  return {
    external_id: row.dimensions?.ad_id,
    date: row.dimensions?.stat_time_day?.slice(0, 10),
    spend_cents: spendCents,
    impressions: int(m.impressions),
    reach: int(m.reach),
    frequency: num(m.frequency),
    clicks: int(m.clicks),
    ctr: num(m.ctr),
    conversions,
    cpa_cents: conversions > 0 ? Math.round(spendCents / conversions) : null,
    roas: num(m.complete_payment_roas)
  };
}

// TikTok budgets and spend are in whole currency units, not cents. Converting at
// each call site is how a 100x budget error happens.
const centsToUnits = (cents) => Number(cents || 0) / 100;
const unitsToCents = (units) => Math.round(Number(units || 0) * 100);
const int = (v) => Math.trunc(Number(v || 0));
const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

export default {
  PLATFORM, createCampaign, createAdSet, createAd, updateBudget, pause, resume, fetchInsights
};
