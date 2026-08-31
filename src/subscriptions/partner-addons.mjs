// Buying a white-label add-on — the whole path, end to end.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): payment rails and fee timing.
// This module asks a partner for money and decides when the next ask falls due.
// It does not charge anything itself: the first payment is a link a human
// clicks, and every later one belongs to the recurring rail
// (src/subscriptions/billing-store.mjs), which this file calls and never edits.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THE PATH, IN FOUR STEPS
//
//   1. buyAddOn()            a partner picks an add-on → a Commas checkout link
//   2. they pay              Commas → webhook → payment.received
//   3. activateFromLink()    the link is 'paid' → a subscriptions row for THAT
//                            PARTNER, on the right cycle, scheduled so the
//                            sweeper can see it
//   4. cancelAddOn()         they stop. The row closes and stays readable.
//
// Step 1 goes through src/payment-links/index.mjs — the same createPaymentLink
// every client sale uses, extended by 277 to accept a partner. There is exactly
// ONE mint path and ONE settle path in this repository and this module does not
// add a second: a partner add-on is recorded in `payment_links` like any other
// ask, reaches 'paid' through src/handlers/payment-links.mjs by link_ref, and
// is invisible to the client money chain because its client_id is NULL (see
// 277's header, which walks every reader of that table).
//
//
// ═══════════════════════════════════════════════════════════════════════════
// TWO OF THE THREE ADD-ONS ARE MONTHLY. THE THIRD IS NOT, AND IT MATTERS.
//
// W6's menu, owner-set 2026-08-31 and mirrored in src/config/offers.mjs:
//
//   creative-intelligence   $297/month        → a subscription
//   dfy-marketing           $2,497/month      → a subscription
//   lead-flow               $99 PER BOOKED CALL → NOT a subscription
//
// Lead Flow has no cycle. There is no month it renews on, no anniversary and no
// next_charge_at that would mean anything, so a subscriptions row for it would
// be a recurring arrangement asserting a cadence nobody agreed to — and 276's
// sweeper would then bill $99 a month forever regardless of how many calls were
// delivered. So buying Lead Flow mints a ONE-TIME payment link for
// `$99 x units` and stops. The payment_links row IS the record of what was
// bought, which is the same thing every other one-time sale in this system
// relies on.
//
// HOW A BOOKED CALL IS COUNTED — SAID PLAINLY BECAUSE IT IS A GAP, NOT A
// FEATURE. It is counted by the person creating the ask, who passes `units`.
// Nothing in this repository counts booked calls for a partner: `bookings`
// (225_bookings.sql) is client-scoped and carries no partner_id, and no code
// path attributes a booking to the partner a lead was handed to. Automatic
// counting therefore CANNOT be built from what exists today without inventing
// that link, and CLAUDE.md §2 is explicit that the absence is the finding.
// What is shipped: a staff-declared unit count, stored as the link's amount and
// its description, auditable against the delivered calls by a human.
// What is NOT shipped: any automatic count. Naming it here so nobody reads
// `units` as a number the system worked out.

import { PARTNER_ADD_ONS } from "../config/offers.mjs";
import { createPaymentLink, listPaymentLinksForPartner } from "../payment-links/index.mjs";
import {
  startSubscription, getSubscriptionAt, listSubscriptions, cancelSubscription,
  SubscriptionConflictError
} from "./store.mjs";
import { scheduleBilling } from "./billing-store.mjs";
import { advancePeriod } from "./billing.mjs";
import { formatPrice } from "./index.mjs";

/** Every add-on, keyed by the products.code that also becomes the
 *  subscription's `tier` (271: "tier carries the add-on's products.code"). */
export const ADD_ON_BY_CODE = Object.freeze(
  Object.fromEntries(Object.values(PARTNER_ADD_ONS).map((a) => [a.productCode, a]))
);

/** The add-on codes, for a caller that needs the set — a WHERE ... = ANY(),
 *  a screen's menu, a test. Sorted so the order is not an accident. */
export const ADD_ON_CODES = Object.freeze(Object.keys(ADD_ON_BY_CODE).sort());

/**
 * resolveAddOn — a key ("LEAD_FLOW"), a product code ("lead-flow") or a tier
 * read back off a row → the add-on, or null.
 *
 * BOTH SPELLINGS BECAUSE BOTH ARRIVE. A screen posts the code it rendered from
 * the catalogue; a stored subscription hands back `tier`, which is the code.
 * Matching is case- and whitespace-insensitive for the same reason 271 keys its
 * constraint on lower(btrim(tier)): 'Lead Flow' and 'lead-flow  ' must not
 * resolve to two different things.
 */
export function resolveAddOn(which) {
  if (!which) return null;
  const raw = String(which).trim();
  if (!raw) return null;
  if (PARTNER_ADD_ONS[raw.toUpperCase()]) return PARTNER_ADD_ONS[raw.toUpperCase()];
  const code = raw.toLowerCase();
  return ADD_ON_BY_CODE[code] || null;
}

/** isMonthly — does this add-on renew? The one question that decides whether a
 *  purchase creates a subscription at all. */
export function isMonthly(addOn) {
  return !!addOn && addOn.billing === "monthly";
}

/**
 * addOnAmountCents — what this purchase asks for, in integer cents.
 *
 * Monthly: the price, once. `units` is refused rather than multiplied — "three
 * months of Creative Intelligence up front" is a prepayment with a fee-timing
 * question attached (when does the next charge fall due?), and answering it by
 * silently tripling the amount decides that question in a multiplication.
 *
 * Per unit: price x units. units must be a positive integer; 0 is refused
 * because a $0 ask is not a purchase, and a fraction is refused because half a
 * booked call is not a thing that was delivered.
 */
export function addOnAmountCents(addOn, units = null) {
  if (!addOn) throw new TypeError("addOnAmountCents: unknown add-on");
  const price = Number(addOn.priceCents);
  if (!Number.isInteger(price) || price <= 0) {
    throw new TypeError(`addOnAmountCents: ${addOn.productCode} has no usable price`);
  }
  if (isMonthly(addOn)) {
    if (units != null && Number(units) !== 1) {
      throw new TypeError(
        `addOnAmountCents: ${addOn.name} is billed monthly — it is bought once, not in units. `
        + "Buying several months up front is a fee-timing decision nobody has made."
      );
    }
    return price;
  }
  const n = Number(units);
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(
      `addOnAmountCents: ${addOn.name} is $${formatPrice(price)} per ${addOn.unitLabel} — `
      + `say how many were delivered (units), got ${JSON.stringify(units)}`
    );
  }
  const total = price * n;
  if (!Number.isSafeInteger(total)) {
    throw new RangeError("addOnAmountCents: that many units overflows a safe integer");
  }
  return total;
}

/** purchaseDescription — what the partner sees on the ask and what a human
 *  reads on the row six months later. Composed from the catalogue, never a
 *  second copy of a price. */
export function purchaseDescription(addOn, units = null) {
  if (isMonthly(addOn)) return `${addOn.name} — $${formatPrice(addOn.priceCents)}/month`;
  const n = Number(units);
  return `${addOn.name} — ${n} ${addOn.unitLabel}${n === 1 ? "" : "s"} `
    + `at $${formatPrice(addOn.priceCents)} each`;
}

/**
 * buyAddOn — the ask. Mints a Commas checkout link addressed to the partner and
 * records it. Returns { addOn, link, amountCents, units, monthly }.
 *
 * NOTHING IS ACTIVATED HERE. A link is a request, not a payment: the
 * subscription appears when the money does (activateFromLink, below), which is
 * the same order every client sale in this system follows. Creating the
 * arrangement at ask time would put a partner on a plan they never paid for and
 * — once 276's sweeper has an instrument to charge — bill them for it.
 *
 * ALREADY-RUNNING IS REFUSED BEFORE ANY MONEY IS ASKED FOR. 271's
 * subscriptions_partner_no_overlap would catch a duplicate at activation, but
 * that is after the partner has paid, and telling somebody their money bought
 * nothing is the worst possible place to find out. A cancelled add-on is not
 * "already running" and may be bought again.
 */
export async function buyAddOn(db, {
  orgId, partnerId, addOn: which, units = null,
  createdByStaffId = null, createdByRole = null,
  checkoutBaseUrl = null, env = process.env, fetchImpl = undefined, now = new Date()
} = {}) {
  if (!orgId) throw new TypeError("buyAddOn: orgId is required");
  if (!partnerId) throw new TypeError("buyAddOn: partnerId is required");

  const addOn = resolveAddOn(which);
  if (!addOn) {
    throw new TypeError(
      `buyAddOn: "${which}" is not one of the add-ons — ${ADD_ON_CODES.join(", ")}`
    );
  }

  const amountCents = addOnAmountCents(addOn, units);

  if (isMonthly(addOn)) {
    const live = await getSubscriptionAt(db, {
      orgId, partnerId, tier: addOn.productCode, at: now
    });
    if (live && live.cancelled_at == null) {
      throw new SubscriptionConflictError(
        `buyAddOn: this partner already has ${addOn.name} running — cancel it before buying it `
        + "again. Their other add-ons are not affected."
      );
    }
  }

  const link = await createPaymentLink(db, {
    orgId,
    partnerId,
    /* 'custom' is the only purpose in 119's CHECK that fits a partner add-on:
       deposit / diagnostic / repair are all client product buckets that
       src/handlers/purchase-routing.mjs reads to decide which client board
       somebody lands on. Widening that CHECK to add a partner purpose would
       hand every one of those readers a value they have never seen. */
    purpose: "custom",
    description: purchaseDescription(addOn, units),
    amountCents,
    currency: "USD",
    createdByStaffId,
    createdByRole,
    productCode: addOn.productCode,
    commasProductTitle: addOn.commasProductTitle,
    checkoutBaseUrl,
    env,
    fetchImpl
  });

  return {
    addOn,
    link,
    amountCents,
    units: isMonthly(addOn) ? null : Number(units),
    monthly: isMonthly(addOn)
  };
}

/** loadPartnerLink — one partner add-on ask, by id or by link_ref, scoped to
 *  the org. Returns null for a link that is not a partner add-on, so a caller
 *  cannot activate a subscription off a client's payment. */
async function loadPartnerLink(db, { orgId, linkId = null, linkRef = null, commasSessionId = null }) {
  if (!linkId && !linkRef && !commasSessionId) return null;
  const res = await db.query(
    `SELECT pl.*, p.code AS product_code
       FROM payment_links pl
       LEFT JOIN products p ON p.id = pl.product_id
      WHERE ($2::uuid IS NULL OR pl.org_id = $2)
        AND pl.partner_id IS NOT NULL
        AND (($1::uuid IS NOT NULL AND pl.id = $1)
          OR ($3::text IS NOT NULL AND pl.link_ref = $3)
          OR ($4::text IS NOT NULL AND pl.commas_session_id = $4))
      ORDER BY pl.created_at DESC
      LIMIT 1`,
    [linkId, orgId ?? null, linkRef, commasSessionId == null ? null : String(commasSessionId)]
  );
  return res.rows[0] ?? null;
}

/**
 * activateFromLink — a paid add-on link → the arrangement it bought.
 *
 * Returns { activated, reason, subscription, link, addOn }. `activated: false`
 * is a normal answer with a named reason, never a silent nothing:
 *
 *   not_a_partner_add_on  the link is not one of ours, or names no add-on
 *   not_paid              the money has not landed. Nothing is created on the
 *                         strength of an ask.
 *   per_unit_charge       Lead Flow. A one-time charge has no cycle — the
 *                         payment_links row is the whole record. See the header.
 *   already_active        this add-on is already running for this partner. The
 *                         webhook is replayed constantly; a second row would be
 *                         a second monthly bill.
 *
 * THE CYCLE IT SETS, AND WHY THAT IS THE ONLY HONEST ONE. The partner has just
 * paid for the first month, so that month is bought: the period is
 * [paid_at, paid_at + 1 month) and `next_charge_at` is the END of it. 276's
 * header calls this charging in advance and makes the two the same instant on
 * purpose. Setting next_charge_at to the payment date instead would have the
 * sweeper ask for the same month again the moment it wakes.
 *
 * advancePeriod() does the month arithmetic rather than a `+ 1 month` written
 * here, because a 31st-of-the-month purchase has to clamp to the last day of
 * February and not skid into March. scheduleBilling() is the rail's own writer
 * and is CALLED, not reimplemented — it re-checks billability and refuses to
 * rewrite an interval somebody already agreed to.
 */
export async function activateFromLink(db, {
  orgId = null, linkId = null, linkRef = null, commasSessionId = null, link = null
} = {}) {
  const row = link || await loadPartnerLink(db, { orgId, linkId, linkRef, commasSessionId });
  if (!row || !row.partner_id) {
    return { activated: false, reason: "not_a_partner_add_on", subscription: null, link: null, addOn: null };
  }

  const addOn = resolveAddOn(row.product_code);
  if (!addOn) {
    return { activated: false, reason: "not_a_partner_add_on", subscription: null, link: row, addOn: null };
  }
  if (row.status !== "paid") {
    return { activated: false, reason: "not_paid", subscription: null, link: row, addOn };
  }
  if (!isMonthly(addOn)) {
    return { activated: false, reason: "per_unit_charge", subscription: null, link: row, addOn };
  }

  const paidAt = row.paid_at ? new Date(row.paid_at) : new Date();
  const tier = addOn.productCode;
  const linkOrgId = row.org_id;

  const live = await getSubscriptionAt(db, { orgId: linkOrgId, partnerId: row.partner_id, tier, at: paidAt });
  if (live && live.cancelled_at == null) {
    return { activated: false, reason: "already_active", subscription: live, link: row, addOn };
  }

  /* THE PRICE COMES OFF THE LINK, NOT THE CATALOGUE. What the partner actually
     paid is the fact; the menu price is what it was when the ask was made. If
     the owner moves a price between the ask and the payment, billing the new
     one would charge somebody a number they never saw. bigint arrives from
     node-postgres as a STRING, so it is Number()'d exactly once, here. */
  const priceCents = Number(row.amount_cents);
  const periodEnd = advancePeriod(paidAt, "monthly");

  let subscription;
  try {
    subscription = await startSubscription(db, {
      orgId: linkOrgId,
      partnerId: row.partner_id,
      tier,
      priceCents,
      currency: row.currency || "USD",
      at: paidAt,
      periodStart: paidAt,
      periodEnd,
      notes: `Bought via payment link ${row.link_ref}`
    });
  } catch (err) {
    /* A CONCURRENT REPLAY, NOT A FAULT. Two deliveries of the same webhook can
       both pass the getSubscriptionAt check above and race into the INSERT;
       271's exclusion constraint is what actually adjudicates, and the loser
       must report the winner's row rather than an error — the partner has one
       arrangement either way. */
    if (err instanceof SubscriptionConflictError) {
      const existing = await getSubscriptionAt(db, {
        orgId: linkOrgId, partnerId: row.partner_id, tier, at: paidAt
      });
      return { activated: false, reason: "already_active", subscription: existing, link: row, addOn };
    }
    throw err;
  }

  const scheduled = await scheduleBilling(db, {
    orgId: linkOrgId,
    subscriptionId: subscription.id,
    interval: "monthly",
    firstChargeAt: periodEnd
  });

  return {
    activated: true,
    reason: null,
    subscription: scheduled || subscription,
    link: row,
    addOn
  };
}

/**
 * cancelAddOn — the partner stops one add-on. The other two are untouched.
 *
 * A CANCELLED ADD-ON STAYS ANSWERABLE. Nothing is deleted: the row keeps its
 * price, its dates and its whole version chain, so "what were they paying in
 * March" still has an answer, and so does "when did they stop". listAddOns()
 * below returns it in `history` for exactly that reason.
 *
 * IT ALSO STOPS BILLING, and it stops it in the database rather than by asking
 * the sweeper to remember: billing.mjs notBillableReason() refuses a row with a
 * cancelled_at or an effective_to before it looks at next_charge_at at all. So
 * a cancelled add-on is skipped even though its old schedule is still written
 * on the row — which is deliberate, because that date is evidence of what the
 * arrangement was, and blanking it would erase it.
 */
export async function cancelAddOn(db, { orgId, partnerId, addOn: which, at = null, endsAt = null } = {}) {
  if (!orgId) throw new TypeError("cancelAddOn: orgId is required");
  if (!partnerId) throw new TypeError("cancelAddOn: partnerId is required");
  const addOn = resolveAddOn(which);
  if (!addOn) {
    throw new TypeError(`cancelAddOn: "${which}" is not one of the add-ons — ${ADD_ON_CODES.join(", ")}`);
  }
  const row = await cancelSubscription(db, {
    orgId, partnerId, tier: addOn.productCode, at, endsAt
  });
  return { addOn, subscription: row };
}

/**
 * listAddOns — everything a partner add-on screen needs, in one call.
 *
 *   catalog  the menu, with prices already formatted as strings (money.fromCents
 *            returns a string on purpose — 19.90 as a float is not 19.90) and a
 *            `status` per add-on so the screen never has to join two lists.
 *   current  the live rows, one per add-on at most.
 *   history  every version ever, cancelled ones included.
 *   orders   the asks, paid and unpaid. A Lead Flow purchase appears ONLY here,
 *            because it never becomes a subscription.
 */
export async function listAddOns(db, { orgId, partnerId, now = new Date() } = {}) {
  if (!orgId) throw new TypeError("listAddOns: orgId is required");
  if (!partnerId) throw new TypeError("listAddOns: partnerId is required");

  const history = await listSubscriptions(db, { orgId, partnerId });
  const orders = await listPaymentLinksForPartner(db, { orgId, partnerId });

  const at = new Date(now).getTime();
  const isLive = (r) => {
    if (r.cancelled_at != null) return false;
    if (new Date(r.effective_from).getTime() > at) return false;
    return r.effective_to == null || new Date(r.effective_to).getTime() > at;
  };
  const current = history.filter(isLive);
  const liveByCode = new Map(current.map((r) => [String(r.tier).trim().toLowerCase(), r]));

  const catalog = Object.values(PARTNER_ADD_ONS).map((a) => {
    const live = liveByCode.get(a.productCode) || null;
    return {
      key: a.key,
      code: a.productCode,
      name: a.name,
      summary: a.summary,
      billing: a.billing,
      unit_label: a.unitLabel,
      price_cents: a.priceCents,
      price_display: formatPrice(a.priceCents),
      /* THREE STATES, NOT TWO. "available" is not the same as "they cancelled
         it and could buy it again", and a screen that shows both as one loses
         the fact that they were a customer. */
      status: live ? "active" : (history.some((r) => String(r.tier).trim().toLowerCase() === a.productCode)
        ? "cancelled" : "available"),
      subscription_id: live ? live.id : null,
      next_charge_at: live ? live.next_charge_at : null
    };
  });

  return { catalog, current, history, orders };
}

export default { buyAddOn, activateFromLink, cancelAddOn, listAddOns, resolveAddOn, addOnAmountCents };
