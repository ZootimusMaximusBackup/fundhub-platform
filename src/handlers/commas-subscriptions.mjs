// Subscriptions Commas bills — believing what they tell us, and nothing more.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): payment rails and fee timing.
// This handler writes down money that has already moved and records when a
// recurring arrangement starts, misses, or ends. IT CHARGES NOTHING. There is
// no processor call in this file and no path from it to one.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS, IN ONE PARAGRAPH.
//
// A checkout session of type "subscription" hands Commas the card, the
// calendar, the retries and the dunning (createCheckoutSession in
// src/payments/commas-api.mjs). They charge every `frequency_days` and tell us
// afterwards. mapToCanonical() in src/adapters/commas.mjs turns those webhooks
// into five names; this file is the only consumer of them. Before it existed,
// a $47/month Winner's Board buyer paid once, renewed silently forever inside
// Commas, and this system knew nothing about any of it after month one.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE LOCAL ROW IS A MIRROR. IT IS NEVER AN INSTRUCTION TO CHARGE.
//
// Every `subscriptions` row this handler opens carries
// `provider = 'commas_subscription'` (PROCESSOR_BILLED_PROVIDER). Four
// independent locks then refuse to bill it — the sweeper's read, the pure
// billability rule, the ledger claim, and the instrument check — so the buyer
// cannot be charged by Commas on their cadence AND by us on ours. See the
// header block in src/subscriptions/billing.mjs.
//
// The one write path for money here is recordProcessorCharge(), which inserts
// an already-`succeeded` ledger row anchored on the processor's own payment
// id. It calls nobody.
//
// ═══════════════════════════════════════════════════════════════════════════
// HOW A WEBHOOK FINDS THE ARRANGEMENT IT BELONGS TO, AND THE GAP IN IT.
//
// There is no Commas subscription id on the event. normalizeCommasEvent() does
// not extract one — it has no field for it — so `subscriptions.provider_ref`,
// which is exactly the column for a processor's own id, is left NULL rather
// than filled with the per-delivery event id, which changes on every webhook
// and would be worse than nothing. STATED AS A GAP: the day the adapter reads
// a subscription id off a real payload, it belongs on provider_ref and becomes
// the join.
//
// Until then the join is OWNER + TIER, both of which are ours and both of
// which are stable:
//
//   a partner add-on  → the payment_links row the ask was minted as carries
//                       partner_id, and its product is the tier.
//   a funnel purchase → a stranger buying the board on a public page has NO
//                       payment_links row (277's CHECK: a link belongs to a
//                       client or a partner, and they are neither at the time
//                       of the ask). What they do have is the
//                       `funnel.checkout_started` event
//                       api/public/funnel-checkout.mjs writes BEFORE minting,
//                       keyed by the `ref` that round-trips through the Commas
//                       session metadata. That event carries the product code,
//                       the amount and the cadence. The owner is the client the
//                       adapter resolved from the payer's email.
//
// NOTHING IS INVENTED WHEN THAT FAILS. An event that resolves to no owner or
// no product returns { ok: false, reason } and writes nothing. An absence is
// the finding (CLAUDE.md §2).

import { on } from "../events/registry.mjs";
import {
  startSubscription, getSubscriptionAt, cancelSubscription, SubscriptionConflictError
} from "../subscriptions/store.mjs";
import {
  recordProcessorCharge, markProcessorPastDue
} from "../subscriptions/billing-store.mjs";
import {
  COMMAS_FREQUENCY_DAYS, PROCESSOR_BILLED_PROVIDER, addDays, isProcessorBilled
} from "../subscriptions/billing.mjs";

/** The event name api/public/funnel-checkout.mjs records an ask under. */
export const FUNNEL_ASK_EVENT = "funnel.checkout_started";

/* ─── finding the arrangement ────────────────────────────────────────────── */

/**
 * partnerAskFor — the payment_links row this subscription was minted as, when
 * there is one. A partner add-on has one; a public funnel purchase does not.
 *
 * SCOPED TO THE EVENT'S ORG. A webhook that arrived on one org must never
 * resolve a link belonging to another — the same call resolveInboxClientId()
 * in src/adapters/commas.mjs makes about attributing across orgs.
 */
async function partnerAskFor(db, { orgId, linkId, linkRef, sessionId }) {
  if (!orgId) return null;
  if (!linkId && !linkRef && !sessionId) return null;
  const res = await db.query(
    `SELECT pl.id, pl.org_id, pl.partner_id, pl.client_id, pl.amount_cents,
            pl.currency, p.code AS product_code
       FROM payment_links pl
       LEFT JOIN products p ON p.id = pl.product_id
      WHERE pl.org_id = $1
        AND (($2::uuid IS NOT NULL AND pl.id = $2::uuid)
          OR ($3::text IS NOT NULL AND pl.link_ref = $3::text)
          OR ($4::text IS NOT NULL AND pl.commas_session_id = $4::text))
      ORDER BY pl.created_at DESC
      LIMIT 1`,
    [orgId, linkId || null, linkRef || null, sessionId == null ? null : String(sessionId)]
  );
  return res.rows[0] ?? null;
}

/**
 * funnelAskFor — the `funnel.checkout_started` event the public till wrote
 * before it minted anything, found by our own ref.
 *
 * THE ASK IS THE RECORD for a stranger's purchase, which is what
 * api/public/funnel-checkout.mjs says out loud: there is no table their
 * purchase can land in, so the append-only event log is where it lives. Read
 * back here rather than re-derived, because a price or a cadence looked up
 * today is not necessarily the one they agreed to.
 */
async function funnelAskFor(db, { orgId, ref }) {
  if (!orgId || !ref) return null;
  const res = await db.query(
    `SELECT payload FROM events
      WHERE org_id = $1 AND name = $2 AND payload->>'ref' = $3
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId, FUNNEL_ASK_EVENT, String(ref)]
  );
  const payload = res.rows[0]?.payload ?? null;
  if (!payload) return null;
  return typeof payload === "string" ? JSON.parse(payload) : payload;
}

const positiveInt = (n) => (Number.isInteger(n) && n > 0 ? n : null);

/**
 * resolveArrangement — which subscription is this webhook about?
 *
 * Returns { ok, reason, orgId, clientId, partnerId, tier, priceCents,
 * currency, frequencyDays }. `ok: false` with a named reason is a normal
 * answer; every one of them means "write nothing".
 */
export async function resolveArrangement(event, db) {
  const p = event?.payload || {};
  const orgId = event?.orgId || null;
  if (!orgId) return { ok: false, reason: "no_org" };

  const ask = await partnerAskFor(db, {
    orgId,
    linkId: p.paymentLinkId || null,
    linkRef: p.ref || null,
    sessionId: p.itemId || p.productId || p.commasSessionId || null
  });

  if (ask) {
    const tier = String(ask.product_code || "").trim().toLowerCase();
    if (!tier) return { ok: false, reason: "ask_names_no_product" };
    if (!ask.partner_id && !ask.client_id) return { ok: false, reason: "ask_names_no_owner" };
    return {
      ok: true,
      reason: null,
      orgId,
      /* 271: exactly one owner. The link already decided which, and a link that
         somehow carried both would be refused by startSubscription rather than
         guessed at here. */
      partnerId: ask.partner_id || null,
      clientId: ask.partner_id ? null : (ask.client_id || null),
      tier,
      /* bigint arrives from node-postgres as a STRING. Number()'d exactly once,
         here, the same call activateFromLink() makes. */
      priceCents: positiveInt(Number(ask.amount_cents)),
      currency: ask.currency || "USD",
      frequencyDays: COMMAS_FREQUENCY_DAYS,
      source: "payment_link"
    };
  }

  const funnel = await funnelAskFor(db, { orgId, ref: p.ref || null });
  if (funnel) {
    const tier = String(funnel.product_code || "").trim().toLowerCase();
    if (!tier) return { ok: false, reason: "ask_names_no_product" };
    /* THE PAYER, AS THE ADAPTER RESOLVED THEM. A stranger buying on a public
       page has no partners row, so the only owner a subscription can name is
       the clients row resolveInboxClientId() found or created from their
       email. Null means the payment could not be attributed to anybody, and an
       unattributed arrangement is not one we may open. */
    if (!event.clientId) return { ok: false, reason: "no_owner" };
    return {
      ok: true,
      reason: null,
      orgId,
      partnerId: null,
      clientId: event.clientId,
      tier,
      priceCents: positiveInt(Number(funnel.amount_cents)),
      currency: funnel.currency || "USD",
      frequencyDays: positiveInt(Number(funnel.frequency_days)) ?? COMMAS_FREQUENCY_DAYS,
      source: "funnel_ask"
    };
  }

  return { ok: false, reason: "unresolved_subscription" };
}

/** The live mirror row for this arrangement, or null. */
function liveRow(db, a, at = null) {
  return getSubscriptionAt(db, {
    orgId: a.orgId, clientId: a.clientId, partnerId: a.partnerId, tier: a.tier, at
  });
}

/* ─── the four things that can happen ────────────────────────────────────── */

/**
 * subscription.started — Commas opened the arrangement. Open our mirror.
 *
 * THE FIRST PERIOD IS THE ONE THEY JUST BOUGHT. `subscription.created` fires
 * when the customer has paid to start, so the window is
 * [now, now + frequency_days) and the money for it is the one-off
 * payment.received that Commas sends alongside — recorded by the money chain
 * like every other payment, not a second time here.
 *
 * NO next_charge_at AND NO billing_interval ARE SET, and that is the point.
 * Those two columns are what put a row on OUR sweeper; a mirror has neither,
 * so it is off that rail by construction as well as by provider.
 */
export async function onSubscriptionStarted(event, db) {
  const a = await resolveArrangement(event, db);
  if (!a.ok) return { opened: false, reason: a.reason };
  if (a.priceCents == null) return { opened: false, reason: "price_unknown" };

  const startedAt = new Date();
  const existing = await liveRow(db, a, startedAt);
  if (existing && existing.cancelled_at == null) {
    /* The bus redelivers and the dead-letter queue retries. A second open would
       be a second arrangement for one subscription. */
    return { opened: false, reason: "already_open", subscriptionId: existing.id };
  }

  try {
    const sub = await startSubscription(db, {
      orgId: a.orgId,
      clientId: a.clientId,
      partnerId: a.partnerId,
      tier: a.tier,
      priceCents: a.priceCents,
      currency: a.currency,
      provider: PROCESSOR_BILLED_PROVIDER,
      at: startedAt,
      periodStart: startedAt,
      periodEnd: addDays(startedAt, a.frequencyDays),
      notes: `Billed by Commas every ${a.frequencyDays} days (${a.source})`
    });
    return { opened: true, reason: null, subscriptionId: sub.id, tier: a.tier };
  } catch (err) {
    /* Two deliveries of one webhook can both pass the check above and race into
       the INSERT; 075's and 271's exclusion constraints adjudicate, and the
       loser reports the winner's row rather than an error. The customer has one
       arrangement either way. */
    if (err instanceof SubscriptionConflictError) {
      const now = await liveRow(db, a, startedAt);
      return { opened: false, reason: "already_open", subscriptionId: now?.id ?? null };
    }
    throw err;
  }
}

/**
 * subscription.renewed — Commas took the next period's money. Write it down.
 *
 * THE PERIOD IS THE ONE AFTER THE ONE ON THE ROW, never a window computed from
 * a clock. Commas charges in advance on its cadence, so the money that just
 * arrived buys [current_period_end, +frequency_days). Anchoring on the row is
 * also what makes a replay safe alongside the provider-reference guard inside
 * recordProcessorCharge().
 *
 * THE AMOUNT IS WHAT COMMAS ACTUALLY TOOK, not the menu price: if the price
 * moved between periods, the fact is the charge. The row's own price_cents is
 * the fallback for a payload that carries no amount, and a renewal with
 * neither is refused rather than recorded at a guessed figure. NULL means
 * unknown and must survive.
 */
export async function onSubscriptionRenewed(event, db) {
  const p = event?.payload || {};
  const a = await resolveArrangement(event, db);
  if (!a.ok) return { recorded: false, reason: a.reason };

  const sub = await liveRow(db, a);
  if (!sub) return { recorded: false, reason: "no_subscription" };

  /* A RENEWAL MUST NOT TOUCH A ROW THIS SYSTEM BILLS. If the mirror is missing
     and the owner happens to hold one of our own subscriptions on the same
     tier, recording a processor charge against it would put a payment we did
     not take onto our own ledger and advance somebody else's cycle. */
  if (!isProcessorBilled(sub)) return { recorded: false, reason: "not_processor_billed" };

  const periodStart = sub.current_period_end ?? sub.effective_from ?? null;
  if (!periodStart) return { recorded: false, reason: "no_period_anchor" };

  /* The payload's `amount` is in MAJOR units — normalizeCommasEvent divides
     minor units by 100 on the way in — so it comes back to integer cents here
     and nowhere else. */
  const fromPayload = p.amount == null || p.amount === "" || Number.isNaN(Number(p.amount))
    ? null
    : Math.round(Number(p.amount) * 100);
  const amountCents = positiveInt(fromPayload) ?? positiveInt(Number(sub.price_cents));
  if (amountCents == null) return { recorded: false, reason: "no_amount" };

  const out = await recordProcessorCharge(db, {
    orgId: a.orgId,
    subscriptionId: sub.id,
    periodStart,
    periodEnd: addDays(periodStart, a.frequencyDays),
    amountCents,
    currency: sub.currency || a.currency,
    provider: PROCESSOR_BILLED_PROVIDER,
    /* The processor's own id for the payment. This is the anchor a replay
       collides on, so it is taken from the payment id first and the envelope
       id only as a fallback. */
    providerRef: p.paymentId || p.providerRef || null
  });

  return {
    recorded: out.recorded,
    reason: out.reason,
    subscriptionId: sub.id,
    chargeId: out.charge?.id ?? null,
    advanced: out.advanced
  };
}

/**
 * subscription.past_due — the card failed on their side. Show it.
 *
 * NOTHING IS RETRIED HERE and nothing is scheduled. Commas owns the dunning;
 * when the customer fixes the card, `subscription.recovered` arrives as a
 * renewal and puts the row back to active. Our only job is that the state is
 * visible on the day it happens instead of a month later.
 */
export async function onSubscriptionPastDue(event, db) {
  const a = await resolveArrangement(event, db);
  if (!a.ok) return { flagged: false, reason: a.reason };

  const sub = await liveRow(db, a);
  if (!sub) return { flagged: false, reason: "no_subscription" };
  if (!isProcessorBilled(sub)) return { flagged: false, reason: "not_processor_billed" };

  const row = await markProcessorPastDue(db, { orgId: a.orgId, subscriptionId: sub.id });
  return {
    flagged: !!row,
    /* Already past_due, or already cancelled. Neither is a failure and neither
       is something to write again. */
    reason: row ? null : "no_change",
    subscriptionId: sub.id
  };
}

/**
 * subscription.canceled and subscription.completed — the arrangement ended.
 *
 * BOTH CLOSE THE ROW, AND THE SCHEMA CANNOT TELL THEM APART. 075's status
 * CHECK allows active / past_due / cancelled and nothing else, and
 * `subscriptions_cancelled_coherent` requires cancelled_at whenever the status
 * is cancelled — so a "completed" subscription (one that ran out its
 * `auto_expire_after_x_periods`) is stored as cancelled. SAID PLAINLY RATHER
 * THAN PAPERED OVER: the distinction is returned to the caller and recorded on
 * the event, but it is not on the row, and putting it there is a migration
 * nobody has asked for.
 *
 * cancelSubscription() is CALLED, not reimplemented: it keeps the first
 * cancellation date on a replay, closes the row so a future subscription can
 * be opened, and is idempotent.
 */
export async function onSubscriptionEnded(event, db) {
  const a = await resolveArrangement(event, db);
  if (!a.ok) return { closed: false, reason: a.reason };

  const sub = await liveRow(db, a);
  if (!sub) return { closed: false, reason: "no_subscription" };
  if (!isProcessorBilled(sub)) return { closed: false, reason: "not_processor_billed" };

  const row = await cancelSubscription(db, {
    orgId: a.orgId,
    clientId: a.clientId,
    partnerId: a.partnerId,
    tier: a.tier
  });
  return {
    closed: !!row,
    reason: row ? null : "no_subscription",
    ending: event?.name === "subscription.completed" ? "completed" : "canceled",
    subscriptionId: row?.id ?? sub.id
  };
}

/**
 * REGISTRATION ORDER IS NOT LOAD-BEARING FOR THIS FILE. None of these five
 * names is emitted by anything else, and nothing else listens to them, so
 * there is no handler this one has to run after. It is registered next to the
 * other Commas handlers because that is where somebody will look for it.
 */
export function register() {
  on("subscription.started", onSubscriptionStarted);
  on("subscription.renewed", onSubscriptionRenewed);
  on("subscription.past_due", onSubscriptionPastDue);
  on("subscription.canceled", onSubscriptionEnded);
  on("subscription.completed", onSubscriptionEnded);
}

export default { register, resolveArrangement };
