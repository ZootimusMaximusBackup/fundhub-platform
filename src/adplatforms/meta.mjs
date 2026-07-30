// Meta Marketing API adapter.
//
// ⚠️ CONFIRM BEFORE THIS RUNS LIVE. The endpoint shapes below follow the
// documented Marketing API, but have not been exercised against a real ad
// account — same status as the adapters in src/adapters/ carrying this marker.
// Confirm against one real call per operation before a partner's budget flows
// through it.
//
// THE SPECIAL AD CATEGORY IS READ FROM CONFIG AND IS MANDATORY. It is not a
// parameter this module accepts, because a caller able to pass it is a caller
// able to pass the wrong one. It comes from ad_platform_category_map via the
// campaign row, which the trigger in 046 populates and refuses to leave null.
//
// ⚠️ THE CONFIGURED VALUE IS UNSET AND FLAGGED. The spec named
// 'FINANCIAL_PRODUCTS_AND_SERVICES', which is not a Meta enum member, and for
// funding/credit_cards offers the applicable category is likely CREDIT. Rather
// than guess, ad_platform_category_map ships empty and every Meta write here
// fails closed until a human populates it. See 046's header.
//
// CAMPAIGN BUDGET OPTIMIZATION IS ON BY DEFAULT, per the spec: the budget lives
// on the campaign and Meta distributes it across ad sets.

import { callPlatform } from "./_api.mjs";
import { decryptToken } from "./tokens.mjs";
import { buildTargeting } from "../compliance/targeting.mjs";

export const PLATFORM = "meta";
const API_VERSION = process.env.META_API_VERSION || "v21.0";
const BASE = "https://graph.facebook.com";

/* Every call takes the connection row and derives its own token, so no caller
   ever holds a decrypted token longer than one request. */
function tokenFor(connection) {
  const t = decryptToken(connection.encrypted_access_token, { partnerId: connection.partner_id });
  if (!t) throw new Error("connection has no access token");
  return t;
}

const acct = (connection) => {
  const id = String(connection.external_ad_account_id || "");
  return id.startsWith("act_") ? id : `act_${id}`;
};

export async function createCampaign(connection, campaign, ctx = {}) {
  if (!campaign.special_ad_category) {
    // Belt to the database's braces. Reaching here with a null category means the
    // trigger was bypassed, and shipping without one is the compliance failure the
    // whole chain exists to prevent.
    throw new Error(
      "refusing to create a Meta campaign with no special_ad_category — " +
      "populate ad_platform_category_map (046)"
    );
  }

  return callPlatform({
    url: `${BASE}/${API_VERSION}/${acct(connection)}/campaigns`,
    token: tokenFor(connection),
    body: {
      name: campaign.name,
      objective: campaign.objective || "OUTCOME_LEADS",
      status: "PAUSED",                       // never created live; launch is a separate, gated step
      special_ad_categories: [campaign.special_ad_category],
      // Campaign budget optimization on by default (spec UNIT 5).
      daily_budget: String(campaign.budget_cents),
      bid_strategy: campaign.bid_strategy || "LOWEST_COST_WITHOUT_CAP"
    },
    ctx
  });
}

export async function createAdSet(connection, adSet, ctx = {}) {
  // buildTargeting throws with every reason at once rather than silently
  // correcting a payload — see src/compliance/targeting.mjs.
  const targeting = buildTargeting(adSet.targeting || {}, { platform: PLATFORM });

  return callPlatform({
    url: `${BASE}/${API_VERSION}/${acct(connection)}/adsets`,
    token: tokenFor(connection),
    body: {
      name: adSet.name,
      campaign_id: adSet.external_campaign_id,
      status: "PAUSED",
      targeting,
      billing_event: adSet.billing_event || "IMPRESSIONS",
      optimization_goal: adSet.optimization_goal || "OFFSITE_CONVERSIONS",
      // Omitted when the campaign carries the budget (CBO), which is the default.
      ...(adSet.budget_cents ? { daily_budget: String(adSet.budget_cents) } : {})
    },
    ctx
  });
}

export async function createAd(connection, ad, ctx = {}) {
  return callPlatform({
    url: `${BASE}/${API_VERSION}/${acct(connection)}/ads`,
    token: tokenFor(connection),
    body: {
      name: ad.name,
      adset_id: ad.external_ad_set_id,
      status: "PAUSED",
      creative: { creative_id: ad.external_creative_id },
      // The AI-content disclosure, attached at publish time. Recorded on the ad
      // row as well, so "we disclosed" is auditable per ad rather than asserted.
      ...(ad.ai_disclosure ? { ad_labels: [{ name: ad.ai_disclosure }] } : {})
    },
    ctx
  });
}

export async function updateBudget(connection, { externalId, budgetCents }, ctx = {}) {
  return callPlatform({
    url: `${BASE}/${API_VERSION}/${externalId}`,
    token: tokenFor(connection),
    body: { daily_budget: String(budgetCents) },
    ctx
  });
}

export const pause  = (connection, { externalId }, ctx = {}) =>
  callPlatform({ url: `${BASE}/${API_VERSION}/${externalId}`, token: tokenFor(connection),
                 body: { status: "PAUSED" }, ctx });

export const resume = (connection, { externalId }, ctx = {}) =>
  callPlatform({ url: `${BASE}/${API_VERSION}/${externalId}`, token: tokenFor(connection),
                 body: { status: "ACTIVE" }, ctx });

/* fetchInsights — the metrics sync, and what the kill switch reads for ACTUAL
   spend. Deliberately goes to the platform every time rather than to
   ad_metrics_daily: the whole value of the independent check is that it does not
   share a failure mode with our mirror. */
export async function fetchInsights(connection, { externalId, since, until }, ctx = {}) {
  const params = new URLSearchParams({
    fields: "spend,impressions,reach,frequency,clicks,ctr,actions,cost_per_action_type,purchase_roas",
    time_range: JSON.stringify({ since, until }),
    level: "ad"
  });
  const res = await callPlatform({
    url: `${BASE}/${API_VERSION}/${externalId}/insights?${params}`,
    token: tokenFor(connection),
    method: "GET",
    ctx
  });
  return (res?.data || []).map(normalizeInsight);
}

/* normalizeInsight — Meta returns money as decimal STRINGS in the account
   currency. Everything downstream is integer cents, so the conversion happens
   once, here. Doing it at each call site is how a rounding bug gets into the
   ceiling maths. */
export function normalizeInsight(row) {
  const conversions = sumActions(row.actions);
  return {
    external_id: row.ad_id || row.id,
    date: row.date_start,
    spend_cents: toCents(row.spend),
    impressions: int(row.impressions),
    reach: int(row.reach),
    frequency: num(row.frequency),
    clicks: int(row.clicks),
    ctr: num(row.ctr),
    conversions,
    cpa_cents: conversions > 0 ? Math.round(toCents(row.spend) / conversions) : null,
    roas: num(row.purchase_roas?.[0]?.value)
  };
}

const sumActions = (actions) => (Array.isArray(actions) ? actions : [])
  .filter((a) => /purchase|lead|complete_registration/i.test(a.action_type || ""))
  .reduce((n, a) => n + int(a.value), 0);

const toCents = (v) => Math.round(Number(v || 0) * 100);
const int = (v) => Math.trunc(Number(v || 0));
const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

export default {
  PLATFORM, createCampaign, createAdSet, createAd, updateBudget, pause, resume, fetchInsights
};
