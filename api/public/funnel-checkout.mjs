// GET/POST /api/public/funnel-checkout — the self-serve till for the partner
// funnel pages at /partner/, /partner/autopsy/, /partner/board/, /partner/trial/
// and /partner/menu/.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7) — fee timing and payment rails.
// This endpoint asks a stranger for money on a public page. It states no
// earnings figure of any kind, because FundHub has zero measured paid closes;
// see NO EARNINGS CLAIMS below.
//
// ───────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS. The five funnel pages sold four things and took money for
// none of them: every CTA was an <a href="/affiliates/?track=X"> into the
// partner APPLICATION form. That is correct for exactly one of the four — the
// $10,000 entry is invite-only and sold on a review call — and wrong for the
// other three, which are self-serve impulse buys. Sending a $27 buyer to a
// partner application is the bug this handler fixes.
//
// NO AUTH. A stranger off an ad, the same class as api/public/optimize.mjs,
// api/public/survey-submit.mjs and api/public/decline-autopsy.mjs.
//
// NO OUTBOUND SMS OR EMAIL FROM THIS HANDLER. Outbound transmission is
// permitted in src/messaging/providers/* and nowhere else.
//
// ───────────────────────────────────────────────────────────────────────────
// GET  — the catalogue the pages render. Every price on every partner page is
//        read from here at load time. NOTHING IS TYPED INTO THE HTML: a price
//        in markup is a second copy of a number that drifts the first time one
//        of them changes, which is the whole reason src/config/offers.mjs
//        opens with "Do not hardcode them in HTML/JS".
//
// POST — { item, email, first_name, last_name, track, a1, a2 } → a real Commas
//        checkout URL for one of the three self-serve items. `partner` is
//        REFUSED here with 409 and the apply URL: the entry fee is not a
//        self-serve purchase and this endpoint will not pretend it is.
//
// ───────────────────────────────────────────────────────────────────────────
// ONE PAYMENT PATH, NOT TWO.
//
//   autopsy — delegated wholesale to runAutopsyCheckout() in
//             api/public/decline-autopsy.mjs. That path already writes the
//             decline_autopsy_uploads row the upload page needs and already
//             enforces PAY FIRST, UPLOAD SECOND. Re-minting it here would be a
//             second door onto the same product with a different record.
//
//   trial   — mint through createCheckoutSession(), which is the SAME function
//   board     src/payment-links/index.mjs calls when the checkout API key is
//             set, with buildCommasCheckoutUrl() as the same fallback it uses
//             when only COMMAS_CHECKOUT_BASE_URL is configured.
//
// WHY NOT createPaymentLink() DIRECTLY FOR THOSE TWO. It refuses a link that
// names nobody — `if (!clientId && !partnerId) throw` — and 277's CHECK
// enforces the same rule in the database: a payment_links row belongs to a
// client or to a partner, never to neither. A stranger on a sales page is
// neither. They have no clients row (they are not a client of a funding
// program) and no partners row (creating one from an anonymous form is exactly
// the hole that closed the old white-label apply endpoint). So the two
// primitives underneath createPaymentLink are called directly, in the same
// order and with the same fallback, and the ask is recorded as an event
// instead of as a payment_links row.
//
// ───────────────────────────────────────────────────────────────────────────
// NO EARNINGS CLAIMS. Nothing this endpoint returns states, implies or models
// income, a close rate, a typical result or another buyer's result. The only
// numbers it emits are prices — what a buyer PAYS, never what they might make.
//
// ATTRIBUTION SURVIVES CHECKOUT. `track` (which funnel page sent them) and
// a1/a2 (the affiliate referral params — see
// src/workflows/af-02-referral-ownership-capture.mjs, which reads a1 and a2
// straight off an event payload) are carried onto the recorded event AND onto
// the Commas session metadata, so a purchase that starts on
// /partner/board/?track=board&a1=DKOWAL can still be attributed after the
// payer leaves the page.

import { db } from "../../src/db.mjs";
import crypto from "node:crypto";
import { resolveDefaultOrg } from "../../src/auth/org.mjs";
import { safeError } from "../../src/http/health.mjs";
import {
  getOffer,
  getPartnerAddOn,
  formatCents,
  commasProductTitleFor
} from "../../src/config/offers.mjs";
import { checkoutConfig, createCheckoutSession } from "../../src/payments/commas-api.mjs";
import { buildCommasCheckoutUrl } from "../../src/adapters/commas.mjs";
import { emit } from "../../src/events/bus.mjs";
import {
  LIVE_TRIAL_PRICE_CENTS,
  LIVE_TRIAL_PRODUCT_CODE,
  PARTNER_ENTRY_PRICE_CENTS,
  PARTNER_ENTRY_PRODUCT_CODE
} from "../../src/trials/constants.mjs";
import { AUTOPSY_PRICE_CENTS } from "../../src/autopsy/fields.mjs";
import { COMMAS_FREQUENCY_DAYS } from "../../src/subscriptions/billing.mjs";
import { AUTOPSY_PRODUCT_CODE, autopsyPriceCents, runAutopsyCheckout } from "./decline-autopsy.mjs";

/**
 * $47/month. Spec docs/specs/W2-creative-intelligence.md A1, owner-set.
 *
 * THE FALLBACK, NOT THE SOURCE. src/config/offers.mjs now carries a
 * WINNERS_BOARD entry, and boardPriceCents() below reads it FIRST, so the
 * catalogue is the single source. This constant stays as the last resort for
 * the same reason src/autopsy/fields.mjs (AUTOPSY_PRICE_CENTS) and
 * src/trials/constants.mjs (LIVE_TRIAL_PRICE_CENTS) keep theirs: the price
 * lives beside the only code that charges it. src/http/funnel-checkout.test.mjs
 * fails if the two ever disagree. Two numbers that disagree is the bug; two
 * numbers a test holds together is a seam.
 */
export const WINNERS_BOARD_PRICE_CENTS = 4700;

/** products.code for the board. Already the spelling used by the partner
 *  revenue and recruit tests, so it is adopted rather than invented. */
export const WINNERS_BOARD_PRODUCT_CODE = "winners-board";

/* ─── prices ─────────────────────────────────────────────────────────────── */
/* Every resolver reads src/config/offers.mjs first and falls back to the
   constant that lives beside the charging code. None of them invents a price:
   a resolver that finds nothing usable returns null and the item is served
   `unavailable`, because a sales page with no price is a bug a human notices
   and a sales page with a GUESSED price is one nobody notices. */

const usable = (n) => (Number.isInteger(n) && n > 0 ? n : null);

export function boardPriceCents() {
  return usable(getOffer("WINNERS_BOARD")?.priceCents)
    ?? usable(getPartnerAddOn("WINNERS_BOARD")?.priceCents)
    ?? usable(WINNERS_BOARD_PRICE_CENTS);
}

export function trialPriceCents() {
  return usable(getOffer("LIVE_TRIAL")?.priceCents) ?? usable(LIVE_TRIAL_PRICE_CENTS);
}

export function entryPriceCents() {
  return usable(getOffer("PARTNER_ENTRY")?.priceCents) ?? usable(PARTNER_ENTRY_PRICE_CENTS);
}

/* ─── the catalogue ──────────────────────────────────────────────────────── */

/** Where an application belongs, and the ONLY item that still points at it. */
export const PARTNER_APPLY_URL = "/affiliates/?track=white_label";

/**
 * The four things the funnel sells, in ladder order.
 *
 * `selfServe` is the whole point of this table. Three of the four take money
 * on the page. The fourth does not, and that is not an oversight to be tidied
 * up later: the $10,000 entry is invite-only, decided by a person on a review
 * call (docs/specs/W0-decisions.md, "The review call decides"), so its CTA
 * stays an application and this endpoint refuses to charge for it.
 */
const ITEMS = Object.freeze([
  Object.freeze({
    slug: "autopsy",
    key: "DECLINE_AUTOPSY",
    name: "Decline Autopsy",
    productCode: AUTOPSY_PRODUCT_CODE,
    billing: "one_time",
    selfServe: true,
    page: "/partner/autopsy/",
    price: () => usable(autopsyPriceCents()) ?? usable(AUTOPSY_PRICE_CENTS),
    /* The upload page is where a paid buyer goes next, and it needs the ref. */
    next: "/partner/autopsy/"
  }),
  Object.freeze({
    slug: "board",
    key: "WINNERS_BOARD",
    name: "Winner's Board",
    productCode: WINNERS_BOARD_PRODUCT_CODE,
    billing: "monthly",
    selfServe: true,
    page: "/partner/board/",
    price: boardPriceCents,
    next: "/partner/board/"
  }),
  Object.freeze({
    slug: "trial",
    key: "LIVE_TRIAL",
    name: "Live Trial",
    productCode: LIVE_TRIAL_PRODUCT_CODE,
    billing: "one_time",
    selfServe: true,
    page: "/partner/trial/",
    price: trialPriceCents,
    next: "/partner/trial/"
  }),
  Object.freeze({
    slug: "partner",
    key: "PARTNER_ENTRY",
    name: "White-Label Partnership",
    productCode: PARTNER_ENTRY_PRODUCT_CODE,
    billing: "one_time",
    selfServe: false,
    page: "/partner/",
    price: entryPriceCents,
    next: PARTNER_APPLY_URL
  })
]);

export const FUNNEL_SLUGS = Object.freeze(ITEMS.map((i) => i.slug));

export function getFunnelItem(slug) {
  const want = String(slug ?? "").trim().toLowerCase();
  if (!want) return null;
  return ITEMS.find((i) => i.slug === want) || null;
}

/**
 * RENEWAL IS WIRED, AND COMMAS OWNS IT.
 *
 * COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7) — payment rails and fee timing.
 *
 * THIS USED TO CHARGE ONE MONTH. The board is $47 a MONTH and this endpoint
 * minted a one-time checkout for it, on the finding that Commas had no
 * subscription primitive. That finding was wrong. POST /checkout-sessions
 * takes type "subscription" with `subscription.frequency_days`
 * (createCheckoutSession in src/payments/commas-api.mjs), and Commas then holds
 * the card, charges every cadence and fires `subscription.renewed`. A page
 * showing "$47/month" beside a till that took one payment was a fee-timing
 * misstatement, and it is fixed by minting the real thing rather than by
 * softening the words.
 *
 * OUR SWEEPER IS NOT INVOLVED AND MUST NEVER BE. The local `subscriptions` row
 * this creates (src/handlers/commas-subscriptions.mjs, on the webhook) is a
 * MIRROR carrying `provider = 'commas_subscription'`, which four independent
 * locks in src/subscriptions/billing*.mjs and charger.mjs refuse to bill.
 * Charging the buyer on both rails is the worst outcome available here.
 */
export const BOARD_RENEWAL_STATE = "commas_subscription";

/**
 * A monthly item cannot be sold through the query-link fallback, and this is
 * a fee-timing decision, not a limitation to work around.
 *
 * buildCommasCheckoutUrl() builds a hosted URL with an amount on the query
 * string. It has no way to say "and again every 30 days", so a board sold
 * through it would take exactly one $47 payment while the page said
 * "$47/month". Refusing is the honest half of that choice: the board is
 * unavailable until FANBASIS_CHECKOUT_API_KEY is set, and the catalogue says
 * so, rather than the page quietly overstating what the buyer signed up for.
 */
export const SUBSCRIPTION_CHECKOUT_ERROR = "subscription_checkout_unavailable";

/** One catalogue row, as JSON a public page can render. Prices only — never a
 *  figure describing what a buyer might earn. */
function itemForPage(item, env) {
  const cents = item.price();
  return {
    slug: item.slug,
    key: item.key,
    name: item.name,
    productCode: item.productCode,
    billing: item.billing,
    selfServe: item.selfServe,
    page: item.page,
    priceCents: cents,
    priceDisplay: formatCents(cents),
    priceLabel: priceLabel(cents, item.billing),
    available: cents != null && (!item.selfServe || checkoutReady(env, item)),
    applyUrl: item.selfServe ? null : PARTNER_APPLY_URL,
    renewal: item.billing === "monthly" ? BOARD_RENEWAL_STATE : null,
    /* The cadence the buyer is agreeing to, in days, straight off the number
       the session is minted with. A page that says "$47/month" beside a till
       that bills every 30 days should be able to read the 30 rather than be
       told it. Null for anything that does not renew. */
    frequencyDays: item.billing === "monthly" ? COMMAS_FREQUENCY_DAYS : null
  };
}

/** "$27 once" · "$47/month". Composed from the one price, never a second copy
 *  of it. Returns null when the price is unknown rather than inventing a free
 *  one — NULL MEANS UNKNOWN AND MUST SURVIVE. */
export function priceLabel(cents, billing) {
  const display = formatCents(cents);
  if (!display) return null;
  return billing === "monthly" ? `${display}/month` : `${display} once`;
}

/**
 * Can we actually take money right now?
 *
 * For a one-time item, either Commas door counts. For a MONTHLY one, only the
 * checkout-session API does: see SUBSCRIPTION_CHECKOUT_ERROR. The query-link
 * fallback cannot carry a cadence, so a board sold through it would take one
 * payment while the page promised a subscription. Reporting the board as
 * unavailable is the honest answer; selling it anyway is a fee-timing
 * misstatement on a public page.
 */
export function checkoutReady(env = process.env, item = null) {
  const sessionApi = checkoutConfig(env).ok === true;
  if (item && item.billing === "monthly") return sessionApi;
  if (sessionApi) return true;
  return Boolean(String(env?.COMMAS_CHECKOUT_BASE_URL || "").trim());
}

/** GET body. Everything the five funnel pages need to render a price and a
 *  working button, and nothing else. */
export function funnelCatalogue(env = process.env) {
  return {
    ok: true,
    checkout: { ready: checkoutReady(env) },
    applyUrl: PARTNER_APPLY_URL,
    items: ITEMS.map((i) => itemForPage(i, env)),
    /* Said on the page, not only in a comment. See BOARD_RENEWAL_STATE.
       WHAT THE BUYER IS AGREEING TO, IN THE WORDS THEY WILL READ. The card is
       charged today for the first month and again on the same cadence until
       they stop it. Fee timing stated up front is the whole point of this
       string; no earnings figure appears in it, and none may. */
    notices: {
      board_renewal:
        `Your card is charged today for the first month, then every `
        + `${COMMAS_FREQUENCY_DAYS} days until you cancel. It renews on its own. `
        + `Cancel any time and the next charge stops.`
    }
  };
}

/* ─── request parsing ────────────────────────────────────────────────────── */

function readBody(req) {
  if (req?.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const raw = typeof req?.body === "string" ? req.body : (typeof req?.rawBody === "string" ? req.rawBody : "");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const cleanStr = (v, max = 200) => (v == null ? "" : String(v).trim().slice(0, max));
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** Attribution codes are opaque and come off a query string, so they are
 *  length-capped and stripped of anything that is not a code character rather
 *  than trusted. Same cap the affiliate-click door uses. */
const cleanCode = (v) => cleanStr(v, 40).replace(/[^A-Za-z0-9_.:-]/g, "");

export function parseFunnelCheckoutBody(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_json" };

  const item = getFunnelItem(body.item);
  if (!item) return { ok: false, error: "unknown_item" };

  const email = cleanStr(body.email, 160).toLowerCase();
  if (!isEmail(email)) return { ok: false, error: "email_required" };

  const first = cleanStr(body.first_name ?? body.firstName, 80);
  const last = cleanStr(body.last_name ?? body.lastName, 80);
  const name = [first, last].filter(Boolean).join(" ").trim() || null;

  return {
    ok: true,
    item,
    email,
    name,
    firstName: first || null,
    lastName: last || null,
    /* Which funnel page sent them. Free text from a query string, so capped. */
    track: cleanCode(body.track) || null,
    a1: cleanCode(body.a1 ?? body.ref ?? body.code) || null,
    a2: cleanCode(body.a2) || null
  };
}

/** An opaque reference for this ask. `fn_` and not `pl_` on purpose: a `pl_`
 *  ref promises a payment_links row, and this one deliberately has none. */
export function newFunnelRef() {
  return `fn_${crypto.randomBytes(12).toString("hex")}`;
}

/* ─── the checkout ───────────────────────────────────────────────────────── */

/**
 * runFunnelCheckout — record the ask, then mint the link.
 *
 * THAT ORDER IS DELIBERATE. Minting first and recording second means a crash
 * between the two leaves a payable URL in the wild that this system has never
 * heard of. Recording first, at worst, leaves a record of an ask that was
 * never paid — which is what an unpaid ask looks like anyway.
 *
 * Returns { ok, checkoutUrl, ref, priceCents, renewal } or a named failure.
 */
export async function runFunnelCheckout(parsed, deps = {}) {
  const { item } = parsed;
  const dbh = deps.db || db;
  const env = deps.env || process.env;

  if (!item.selfServe) {
    return { ok: false, error: "not_self_serve", applyUrl: PARTNER_APPLY_URL };
  }

  const amountCents = item.price();
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, error: "price_missing" };
  }

  /* The autopsy already has a working public till with its own record. Use it
     rather than opening a second door onto the same $27. */
  if (item.slug === "autopsy") {
    const out = await (deps.runAutopsyCheckout || runAutopsyCheckout)(
      { ok: true, email: parsed.email, name: parsed.name },
      deps
    );
    if (!out?.ok) return out || { ok: false, error: "checkout_failed" };
    return {
      ok: true,
      item: item.slug,
      checkoutUrl: out.checkoutUrl,
      ref: out.ref,
      priceCents: out.priceCents ?? amountCents,
      renewal: null,
      next: item.next
    };
  }

  if (!checkoutReady(env)) return { ok: false, error: "checkout_not_configured" };

  /* A MONTHLY ITEM NEEDS THE SUBSCRIPTION API, NOT JUST A CHECKOUT DOOR.
     Refused here, before anything is recorded and before a payable URL exists,
     because the alternative is a buyer paying $47 once against a page that
     promised a subscription. See SUBSCRIPTION_CHECKOUT_ERROR. */
  const monthly = item.billing === "monthly";
  if (monthly && (deps.checkoutConfig || checkoutConfig)(env).ok !== true) {
    return { ok: false, error: SUBSCRIPTION_CHECKOUT_ERROR };
  }

  const ref = deps.ref || newFunnelRef();
  const orgId = deps.orgId || (await resolveDefaultOrg(dbh));

  /* THE RECORD. There is no table a stranger's purchase can land in — see the
     header — so the append-only event log is the record, which is the same
     place every other thing that happens in this system is written first. */
  await (deps.emit || emit)(
    dbh,
    "funnel.checkout_started",
    {
      ref,
      item: item.slug,
      offer_key: item.key,
      product_code: item.productCode,
      amount_cents: amountCents,
      currency: "USD",
      billing: item.billing,
      /* The cadence Commas is being handed, recorded with the ask. This is the
         row src/handlers/commas-subscriptions.mjs reads back by `ref` when the
         subscription webhook arrives, because a public funnel purchase has no
         payment_links row for the adapter to resolve a product code from. */
      frequency_days: monthly ? COMMAS_FREQUENCY_DAYS : null,
      email: parsed.email,
      name: parsed.name,
      track: parsed.track,
      a1: parsed.a1,
      a2: parsed.a2,
      occurredAt: new Date().toISOString()
    },
    { orgId, allowNonCanonical: true, idempotencyKey: `funnel-checkout:${ref}` }
  );

  const productTitle = commasProductTitleFor({ productCode: item.productCode });
  const metadata = {
    link_ref: ref,
    source: "partner-funnel",
    item: item.slug,
    product_code: item.productCode,
    track: parsed.track,
    a1: parsed.a1,
    a2: parsed.a2
  };

  let checkoutUrl = null;

  if ((deps.checkoutConfig || checkoutConfig)(env).ok === true) {
    const mintOpts = { amountCents, productTitle, metadata, env };
    /* THE ONE LINE THAT MAKES THE BOARD A SUBSCRIPTION. type "subscription"
       plus a cadence hands Commas the card, the schedule, the retries and the
       dunning; createCheckoutSession() refuses the type without the cadence,
       so a missing number cannot become a silent one-off. Our own recurring
       sweeper is not involved and is structurally barred from these rows —
       see BOARD_RENEWAL_STATE. */
    if (monthly) {
      mintOpts.type = "subscription";
      mintOpts.frequencyDays = COMMAS_FREQUENCY_DAYS;
    }
    if (deps.fetchImpl) mintOpts.fetchImpl = deps.fetchImpl;
    const minted = await (deps.createCheckoutSession || createCheckoutSession)(mintOpts);
    if (!minted?.ok || !minted.paymentLink) {
      return { ok: false, error: "checkout_failed", ref };
    }
    checkoutUrl = String(minted.paymentLink);
  } else {
    /* The query-link fallback, byte-identical to the one createPaymentLink
       falls back to when the checkout-session key is absent. ONE-TIME ITEMS
       ONLY — a monthly one was refused above, before this branch. */
    checkoutUrl = (deps.buildCommasCheckoutUrl || buildCommasCheckoutUrl)({
      baseUrl: String(env.COMMAS_CHECKOUT_BASE_URL).trim(),
      linkRef: ref,
      amountCents,
      description: productTitle
    });
  }

  return {
    ok: true,
    item: item.slug,
    checkoutUrl,
    ref,
    priceCents: amountCents,
    renewal: item.billing === "monthly" ? BOARD_RENEWAL_STATE : null,
    next: item.next
  };
}

const STATUS_BY_ERROR = Object.freeze({
  invalid_json: 400,
  unknown_item: 400,
  email_required: 400,
  price_missing: 500,
  offer_missing: 500,
  not_self_serve: 409,
  checkout_not_configured: 503,
  /* 503, same as an unconfigured till: the offer is real and the door is shut,
     which is a "come back later", not a bad request from the buyer. */
  [SUBSCRIPTION_CHECKOUT_ERROR]: 503
});

export default async function handler(req, res, deps = {}) {
  res.setHeader("Cache-Control", "no-store");
  const method = String(req.method || "GET").toUpperCase();
  const env = deps.env || process.env;

  if (method === "GET") {
    return res.status(200).json(funnelCatalogue(env));
  }
  if (method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const parsed = parseFunnelCheckoutBody(readBody(req));
  if (!parsed.ok) {
    return res.status(STATUS_BY_ERROR[parsed.error] || 400).json({ ok: false, error: parsed.error });
  }

  try {
    const result = await runFunnelCheckout(parsed, deps);
    if (!result.ok) {
      return res.status(STATUS_BY_ERROR[result.error] || 502).json(result);
    }
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
