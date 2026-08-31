// Lead ownership during a Live Trial. THIS IS THE PART THAT MUST NOT BE WRONG.
//
// The promise on day 8 is: you keep every lead this week produced, whatever you
// decide. That promise is only true if ownership was stamped on day 0, and the
// reason is one line in src/affiliates/economics.mjs:
//
//     ON CONFLICT (client_id, tier) DO NOTHING
//
// First writer wins, permanently. If FundHub waited until day 8 to create the
// affiliate account and then tried to back-stamp seven days of leads, every
// lead another path had already claimed would come back
// { attributed: false, reason: "owned_by_other" } — silently, and there is no
// undo. So the affiliate row is created during day-0 provisioning and every
// trial funnel link carries their tracking id from the first click.
//
// ZERO NEW ATTRIBUTION CODE. The stamping itself is
// src/workflows/af-02-referral-ownership-capture.mjs, which already fires on
// entry.captured, diagnostic.paid and analysis.completed and reads `a1` and
// `a2` straight off the event payload. This module's whole job is to make sure
// `a1` is on the link and `source` says live_trial, so trial-sourced ownership
// is separable in reporting later.
//
// WHAT THIS MODULE DOES NOT DO: pay anybody. Commission accrues through
// convert() under the live rate schedule, and nothing in production calls
// convert() from a payment event yet (W4 F1). The leads are correctly owned
// either way; the money is a separate, named gap.

import { TRIAL_ATTRIBUTION_PARAM, TRIAL_LEAD_SOURCE, VOID_REASON_CONVERTED } from "./constants.mjs";

/**
 * tagLink(url, trackingId) → the same url carrying ?a1=<tracking id>.
 *
 * Preserves any query string already there and never writes a second a1. A
 * blank tracking id returns the url untouched rather than writing `a1=` — an
 * empty tracking parameter is worse than none, because it looks attributed.
 */
export function tagLink(url, trackingId) {
  const raw = String(url || "").trim();
  const id = String(trackingId || "").trim();
  if (!raw) return raw;
  if (!id) return raw;

  // Split the fragment off first: a1 belongs in the query, and appending after
  // a #hash produces a parameter no server ever sees.
  const hashAt = raw.indexOf("#");
  const hash = hashAt === -1 ? "" : raw.slice(hashAt);
  const head = hashAt === -1 ? raw : raw.slice(0, hashAt);

  const qAt = head.indexOf("?");
  if (qAt !== -1) {
    const params = new URLSearchParams(head.slice(qAt + 1));
    params.set(TRIAL_ATTRIBUTION_PARAM, id);
    return `${head.slice(0, qAt)}?${params.toString()}${hash}`;
  }
  return `${head}?${TRIAL_ATTRIBUTION_PARAM}=${encodeURIComponent(id)}${hash}`;
}

/**
 * tagPageBody(body, trackingId) → body with every cta href tagged.
 *
 * Runs over the section list a partner page publishes. Locked legal sections
 * carry no links and are left exactly as they are.
 */
export function tagPageBody(body, trackingId) {
  const base = body && typeof body === "object" ? body : { sections: [] };
  const sections = Array.isArray(base.sections) ? base.sections : [];
  return {
    ...base,
    sections: sections.map((s) => {
      if (!s || typeof s !== "object" || typeof s.href !== "string" || !s.href) return s;
      return { ...s, href: tagLink(s.href, trackingId) };
    })
  };
}

/**
 * trialAttributionArgs({ orgId, affiliateId, clientId, trackingId }) → the exact
 * argument object for attribute() in src/affiliates/economics.mjs.
 *
 * tier is "direct": the trial buyer is the first touch on their own lead. The
 * source string is what makes trial leads separable from every other affiliate
 * referral six months from now.
 */
export function trialAttributionArgs({
  orgId, affiliateId, clientId, trackingId = null, liveTrialId = null, sourceEvent = null
} = {}) {
  if (!orgId || !affiliateId || !clientId) {
    throw new TypeError("trialAttributionArgs: orgId, affiliateId and clientId are required");
  }
  return {
    orgId,
    affiliateId,
    clientId,
    tier: "direct",
    trackingIdUsed: trackingId,
    source: TRIAL_LEAD_SOURCE,
    sourceEvent,
    detail: liveTrialId ? { live_trial_id: liveTrialId } : {}
  };
}

/**
 * listTrialReferrals(db, { orgId, affiliateId }) → the referral rows the trial
 * produced, excluding any already paid or already voided.
 *
 * This is the set the day-8 conversion unwinds. A PAID referral is deliberately
 * out of scope: money that has gone out does not come back (W0 — no clawbacks),
 * and voidReferral refuses a paid row anyway.
 */
export async function listTrialReferrals(db, { orgId, affiliateId } = {}) {
  if (!orgId) throw new TypeError("listTrialReferrals: orgId is required");
  if (!affiliateId) return [];
  const { rows } = await db.query(
    `SELECT id, client_id, tier, status, source, attributed_at
       FROM affiliate_referrals
      WHERE org_id = $1
        AND affiliate_id = $2
        AND source = $3
        AND status NOT IN ('void', 'paid')
      ORDER BY attributed_at ASC`,
    [orgId, affiliateId, TRIAL_LEAD_SOURCE]
  );
  return rows || [];
}

/** The reason string stamped on every referral unwound at conversion. Never a
    delete: voidReferral writes status='void' with a reason and the row stays. */
export const CONVERSION_VOID_REASON = VOID_REASON_CONVERTED;

export default {
  tagLink,
  tagPageBody,
  trialAttributionArgs,
  listTrialReferrals,
  CONVERSION_VOID_REASON
};
