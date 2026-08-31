// Day 8. Two answers, and both of them are honoured by systems, not by promises.
//
// THEY SAY YES — convertTrial()
//   partners.status  'invited' → 'active'
//   partners.agreement_signed_at stamped from the signed agreement. Until that
//     column is set AND status is 'active', 042_partners.sql's trigger refuses
//     every payout. Both halves are set here, together, and only here.
//   every trial affiliate_referrals row is VOIDED with reason
//     'converted_to_partner'. Never deleted. The leads do not move — they were
//     already on clients.partner_id from day 0 — but they stop being an
//     affiliate's 20% and become a partner's 50%, and the old row has to say
//     why it stopped.
//   the $297 is recorded as a CASH REBATE owed on their first payout. Not a
//     discount on the financed $10,000: keeping the financed number at a clean
//     $10,000 across every credit band is deliberate.
//
// THEY SAY NO — declineTrial()
//   partners.status → 'paused'. The affiliates row stays ACTIVE.
//   the referrals are left exactly where they are. Nothing to unwind: they
//     already point at the buyer's own affiliate account, which is the whole
//     reason it was created on day 0.
//   the AF1 affiliate welcome is queued.
//   the branded page is archived and the dashboard freezes, readable, for 30 days.
//
//   Say it to them exactly like this: "You keep every lead. We work the ones
//   that book. You get paid 20% on the deposits. Nothing you built this week
//   disappears."
//
// ═══════════════════════════════════════════════════════════════════════════
// THE PART THAT IS NOT TRUE YET, AND IS NOT PAPERED OVER HERE
//
// Nothing in production writes partner money or affiliate money.
// src/affiliates/economics.mjs exports convert() and no payment event calls it;
// partner_revenue has no production writer at all. So the day-8 affiliate
// fallback can be recorded correctly — the leads are owned, the referrals are
// real — and STILL NOBODY GETS PAID until W1's accrual writer ships.
//
// This module therefore returns `payable: false` with a named reason on both
// paths, and the reason travels in the response rather than being logged and
// forgotten. Do not advertise the affiliate fallback as a paid outcome until
// that returns true.

import { db as defaultDb } from "../db.mjs";
import { voidReferral } from "../affiliates/economics.mjs";
import { queueAffiliateTemplate } from "../affiliates/drip.mjs";
import { listTrialReferrals, CONVERSION_VOID_REASON } from "./attribution.mjs";
import { revokeTrialFunnel } from "./provision.mjs";
import { getTrialByPartner, setTrialStatus, recordTrialEvent } from "./store.mjs";
import { TRIAL_STATUS, PARTNER_ENTRY_PRICE_CENTS } from "./constants.mjs";
import { stampPartnerAgreement } from "../contracts/partner-license.mjs";

/** Why nobody is paid yet, whichever way day 8 goes. Carried in the response so
    a screen cannot render "you will be paid" over a rail that does not exist. */
export const ACCRUAL_BLOCKED_REASON = "no_production_accrual_writer";

/**
 * convertTrial(db, { orgId, partnerId, agreementSignedAt, approvedByStaffId })
 *
 * REFUSES WITHOUT A SIGNED AGREEMENT. agreementSignedAt is not defaulted to
 * now() and there is no "sign it later" branch: stamping that column is what
 * unlocks every future payout, so it is stamped from a signature that exists or
 * it is not stamped at all.
 */
export async function convertTrial(db, {
  orgId, partnerId, agreementSignedAt = null, approvedByStaffId = null,
  entryPriceCents = PARTNER_ENTRY_PRICE_CENTS, now = new Date()
} = {}) {
  const database = db || defaultDb;
  if (!orgId) throw new TypeError("convertTrial: orgId is required");
  if (!partnerId) throw new TypeError("convertTrial: partnerId is required");
  if (!agreementSignedAt) {
    return { ok: false, status: 409, error: "agreement_not_signed" };
  }

  const trial = await getTrialByPartner(database, { orgId, partnerId });
  if (!trial) return { ok: false, status: 404, error: "no_trial" };
  if (trial.status === TRIAL_STATUS.CONVERTED) {
    return { ok: true, status: 200, already: true, live_trial_id: trial.id, partner_id: partnerId };
  }
  if (trial.status === TRIAL_STATUS.DECLINED) {
    return { ok: false, status: 409, error: "trial_already_declined" };
  }

  /* THE SIGNATURE IS PROVED, NOT ASSERTED.
     This used to write agreement_signed_at straight from the timestamp in the
     request body — COALESCE(agreement_signed_at, $3). The caller was required
     to send one, but nothing checked a signed licence existed behind it, so
     any caller who could reach this endpoint could make a partner payable
     without a signature anywhere in the system. 042_partners.sql's trigger
     holds every payout on that one column; a route that can set it from a
     typed-in value is the whole gate.

     stampPartnerAgreement() finds the real signed PARTNER-LICENSE, takes the
     date OFF THE DOCUMENT rather than off the request or the clock, is
     write-once and race-safe, and throws when no licence is signed. The body's
     agreementSignedAt is now only a caller's assertion that they believe it is
     signed — the check above still rejects its absence early, but it never
     reaches the column. */
  let stamped;
  try {
    stamped = await stampPartnerAgreement(database, { orgId, partnerId });
  } catch (err) {
    const code = err && err.code;
    if (code === "partner_not_found") return { ok: false, status: 404, error: "partner_not_found" };
    if (code === "partner_license_not_signed" || code === "partner_license_template_missing") {
      return { ok: false, status: 409, error: code, message: err.message };
    }
    throw err;
  }

  const partnerUpdate = await database.query(
    `UPDATE partners
        SET status = 'active', updated_at = now()
      WHERE org_id = $1 AND id = $2
      RETURNING id, status, agreement_signed_at, revenue_share_pct`,
    [orgId, partnerId]
  );
  const partner = partnerUpdate.rows[0];
  if (!partner) return { ok: false, status: 404, error: "partner_not_found" };
  void stamped;

  /* UNWIND THE AFFILIATE CLAIM. These leads are the partner's now and pay 50%,
     front and back. Leaving the 20% referrals attributed would double-count
     them the moment an accrual writer exists. voidReferral refuses a row that
     is already 'paid', and that refusal is correct: money that went out does
     not come back (W0 — no clawbacks). */
  const referrals = await listTrialReferrals(database, { orgId, affiliateId: trial.affiliate_id });
  const voided = [];
  const notVoided = [];
  for (const ref of referrals) {
    const out = await voidReferral(database, { referralId: ref.id, reason: CONVERSION_VOID_REASON });
    if (out) voided.push(out.id);
    else notVoided.push(ref.id);
  }

  await setTrialStatus(database, {
    orgId, id: trial.id, status: TRIAL_STATUS.CONVERTED, at: now
  });

  await recordTrialEvent(database, {
    orgId,
    liveTrialId: trial.id,
    kind: "converted",
    actorStaffId: approvedByStaffId,
    detail: {
      agreement_signed_at: agreementSignedAt instanceof Date
        ? agreementSignedAt.toISOString() : String(agreementSignedAt),
      entry_price_cents: entryPriceCents,
      // Integer cents, owed as CASH on the first payout — not a discount.
      trial_rebate_cents: trial.price_cents,
      referrals_voided: voided.length,
      referrals_not_voided: notVoided.length,
      revenue_share_pct: partner.revenue_share_pct
    }
  });

  return {
    ok: true,
    status: 200,
    live_trial_id: trial.id,
    partner_id: partnerId,
    partner_status: partner.status,
    agreement_signed_at: partner.agreement_signed_at,
    referrals_voided: voided.length,
    // Already-paid referrals are reported, never silently swallowed.
    referrals_not_voided: notVoided,
    trial_rebate_cents: trial.price_cents,
    entry_price_cents: entryPriceCents,
    // The rebate and the revenue share are RECORDED. Neither is paid by this
    // call, and nothing downstream pays them yet.
    payable: false,
    payable_blocked_reason: ACCRUAL_BLOCKED_REASON
  };
}

/**
 * declineTrial(db, { orgId, partnerId })
 *
 * The buyer keeps every lead. Nothing about their ownership changes, which is
 * why there is no back-stamping step here and no window in which a lead could
 * be lost.
 */
export async function declineTrial(db, {
  orgId, partnerId, approvedByStaffId = null, now = new Date(), reason = null
} = {}) {
  const database = db || defaultDb;
  if (!orgId) throw new TypeError("declineTrial: orgId is required");
  if (!partnerId) throw new TypeError("declineTrial: partnerId is required");

  const trial = await getTrialByPartner(database, { orgId, partnerId });
  if (!trial) return { ok: false, status: 404, error: "no_trial" };
  if (trial.status === TRIAL_STATUS.CONVERTED) {
    return { ok: false, status: 409, error: "trial_already_converted" };
  }
  if (trial.status === TRIAL_STATUS.DECLINED) {
    return { ok: true, status: 200, already: true, live_trial_id: trial.id, partner_id: partnerId };
  }

  /* PAUSED, not deleted and not left active. 042's payout gate already refuses
     an unsigned partner, so pausing is about access, not about money. */
  await database.query(
    `UPDATE partners SET status = 'paused', updated_at = now()
      WHERE org_id = $1 AND id = $2`,
    [orgId, partnerId]
  );

  /* Clause 6 of LIVE-TRIAL-TERMS, enforced by a system rather than by a lawyer:
     the page comes down. Archived, so the record of what ran under that brand
     survives. */
  const revoked = await revokeTrialFunnel(database, { orgId, partnerId });

  /* The affiliate row stays ACTIVE and keeps every referral. This is the whole
     day-8 promise and it needs no code to keep — which is the point. */
  let drip = { queued: false, reason: "no_affiliate" };
  if (trial.affiliate_id) {
    const aff = (await database.query(
      `SELECT id, name, tracking_id FROM affiliates WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [trial.affiliate_id, orgId]
    )).rows[0];
    if (aff) {
      try {
        drip = await queueAffiliateTemplate(database, {
          orgId,
          email: trial.contact_email,
          name: aff.name,
          trackingId: aff.tracking_id,
          eventId: aff.id
        });
      } catch {
        // The decline still stands. A welcome email that failed to queue is a
        // sweeper's problem, not a reason to leave a partner row 'invited'.
        drip = { queued: false, reason: "queue_failed" };
      }
    }
  }

  await setTrialStatus(database, {
    orgId, id: trial.id, status: TRIAL_STATUS.DECLINED, at: now, notes: reason || undefined
  });

  await recordTrialEvent(database, {
    orgId,
    liveTrialId: trial.id,
    kind: "declined",
    actorStaffId: approvedByStaffId,
    detail: {
      pages_archived: revoked.revoked,
      affiliate_welcome_queued: !!drip.queued,
      affiliate_welcome_reason: drip.queued ? null : (drip.reason || null),
      leads_kept_by: trial.affiliate_id,
      reason: reason || null
    }
  });

  return {
    ok: true,
    status: 200,
    live_trial_id: trial.id,
    partner_id: partnerId,
    partner_status: "paused",
    affiliate_id: trial.affiliate_id,
    pages_archived: revoked.revoked,
    affiliate_welcome_queued: !!drip.queued,
    dashboard_readable_until: trial.frozen_until,
    // Say the honest thing on the way out.
    message:
      "You keep every lead. We work the ones that book. You get paid 20% on the deposits. " +
      "Nothing you built this week disappears.",
    payable: false,
    payable_blocked_reason: ACCRUAL_BLOCKED_REASON
  };
}

export default { convertTrial, declineTrial, ACCRUAL_BLOCKED_REASON };
