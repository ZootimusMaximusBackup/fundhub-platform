// Closer-deck / CRM offer catalog. Prices, names, and financing flags live HERE.
// Screens read this module (or GET /api/read/closer-deck). Do not hardcode them
// in HTML/JS. Change a number here and it changes everywhere.
//
// Owner-set. Subject to change. COMPLIANCE REVIEW REQUIRED — fee timing.

export const UWIQ_DELIVERABLES_CONTENTS = Object.freeze([
  "Credit Analysis Report",
  "Dispute Letter Pack",
  "Credit Optimization Roadmap",
  "Funding Snapshot",
  "Bank & Lender Match List",
  "How To Use This mini course"
]);

/** @typedef {"SOFT_PULL"|"FUNDING_DFY"|"REPAIR_DFY"|"REPAIR_TRIAL"|"UWIQ_DELIVERABLES"|"FUNDING_MASTERY"} OfferKey */

/**
 * @typedef {object} Offer
 * @property {OfferKey} key
 * @property {string} name
 * @property {number} priceCents  amount charged on the pay link (deposit for FUNDING_DFY)
 * @property {number} [priceMinCents]
 * @property {number} [priceMaxCents]
 * @property {number} [successFeePercent]  10 = 10%
 * @property {boolean} financing  Commas financing offered
 * @property {boolean} letters  DS-02 / letter pack may fire for this offer
 * @property {"diagnostic"|"deposit"|"repair"|"custom"} paymentPurpose
 * @property {string} productCode  products.code; durable identity for payment links
 * @property {string} commasProductTitle  vendor checkout title only — consulting language, no credit/finance
 * @property {string} [contractTemplateKey]  contract_templates.template_key to send on close
 * @property {string[]} [contents]
 */

export const COMMAS_DEFAULT_PRODUCT_TITLE = "Consulting Services Package";

export const COMMAS_INVOICE_PRODUCT_TITLE = "Consulting Services Completion";

const COMMAS_TITLE_BY_PRODUCT_CODE = Object.freeze({
  diagnostic: "Consulting Services Assessment",
  "card-stacking-dfy": "Consulting Services Engagement",
  "consulting-package": "Consulting Services Package",
  "repair-bundle": "Consulting Services Standard",
  "repair-trial": "Consulting Services Trial",
  "funding-mastery": "Consulting Services Program",
  "inquiry-removal": "Consulting Services Records",
  // The white-label partner add-ons (PARTNER_ADD_ONS below). Listed here as
  // well as on the add-on so a resolve that only knows the product code still
  // lands on the right vendor title.
  "creative-intelligence": "Consulting Services Insights",
  "dfy-marketing": "Consulting Services Retainer",
  "lead-flow": "Consulting Services Introductions"
});

const COMMAS_TITLE_BY_PURPOSE = Object.freeze({
  diagnostic: "Consulting Services Assessment",
  deposit: "Consulting Services Engagement",
  repair: "Consulting Services Standard",
  custom: COMMAS_DEFAULT_PRODUCT_TITLE
});

/** Resolve the Commas-facing product title — never staff free text. */
export function commasProductTitleFor({
  offerKey = null,
  productCode = null,
  purpose = null,
  commasProductTitle = null,
  invoiceId = null
} = {}) {
  if (invoiceId) return COMMAS_INVOICE_PRODUCT_TITLE;
  if (commasProductTitle) return String(commasProductTitle).trim();
  const offer = getOffer(offerKey) || getPartnerAddOn(offerKey);
  if (offer?.commasProductTitle) return offer.commasProductTitle;
  const code = String(productCode || offer?.productCode || "").trim().toLowerCase();
  if (code && COMMAS_TITLE_BY_PRODUCT_CODE[code]) return COMMAS_TITLE_BY_PRODUCT_CODE[code];
  const p = String(purpose || offer?.paymentPurpose || "").trim().toLowerCase();
  if (p && COMMAS_TITLE_BY_PURPOSE[p]) return COMMAS_TITLE_BY_PURPOSE[p];
  return COMMAS_DEFAULT_PRODUCT_TITLE;
}

/** @type {Readonly<Record<OfferKey, Offer>>} */
export const OFFERS = Object.freeze({
  SOFT_PULL: Object.freeze({
    key: "SOFT_PULL",
    name: "UnderwriteIQ soft-pull assessment",
    priceCents: 3200,
    financing: false,
    letters: false,
    paymentPurpose: "diagnostic",
    productCode: "diagnostic",
    commasProductTitle: "Consulting Services Assessment",
    contractTemplateKey: "SOFT-PULL-CONSENT"
  }),
  FUNDING_DFY: Object.freeze({
    key: "FUNDING_DFY",
    name: "Funding, done-for-you",
    priceCents: 300000,
    successFeePercent: 10,
    financing: false,
    letters: false,
    paymentPurpose: "deposit",
    productCode: "card-stacking-dfy",
    commasProductTitle: "Consulting Services Engagement",
    contractTemplateKey: "FUNDING-AGREEMENT"
  }),
  REPAIR_DFY: Object.freeze({
    key: "REPAIR_DFY",
    name: "Credit repair, done-for-you",
    priceCents: 100000,
    financing: true,
    letters: true,
    paymentPurpose: "repair",
    productCode: "repair-bundle",
    commasProductTitle: "Consulting Services Standard",
    contractTemplateKey: "CREDIT-REPAIR-AGREEMENT"
  }),
  REPAIR_TRIAL: Object.freeze({
    key: "REPAIR_TRIAL",
    name: "Repair test run (first round, done for you)",
    priceCents: 20000,
    financing: true,
    letters: true,
    paymentPurpose: "repair",
    productCode: "repair-trial",
    commasProductTitle: "Consulting Services Trial",
    contractTemplateKey: "REPAIR-TRIAL-AGREEMENT"
  }),
  UWIQ_DELIVERABLES: Object.freeze({
    key: "UWIQ_DELIVERABLES",
    name: "UnderwriteIQ Deliverables Package",
    priceCents: 100000,
    priceMinCents: 100000,
    priceMaxCents: 500000,
    financing: true,
    letters: true,
    paymentPurpose: "custom",
    productCode: "consulting-package",
    commasProductTitle: "Consulting Services Package",
    contents: UWIQ_DELIVERABLES_CONTENTS
  }),
  FUNDING_MASTERY: Object.freeze({
    key: "FUNDING_MASTERY",
    name: "Funding Mastery course (A to Z)",
    priceCents: 500000,
    financing: true,
    letters: false,
    paymentPurpose: "custom",
    productCode: "funding-mastery",
    commasProductTitle: "Consulting Services Program",
    contractTemplateKey: "FUNDING-MASTERY-AGREEMENT"
  })
});

export const OFFER_KEYS = Object.freeze(Object.keys(OFFERS));

// ───────────────────────────────────────────────────────────────────────────
// THE WHITE-LABEL PARTNER ADD-ON MENU (docs/specs/W6-pricing-menu.md).
// Owner-set 2026-08-31. COMPLIANCE REVIEW REQUIRED — recurring fee timing.
//
// A partner pays $10,000 once to join and nothing monthly. These three are the
// menu on top of that: stack freely, cancel freely, none a prerequisite for
// another. The 50/50 split never moves for any of them.
//
// WHY THESE ARE NOT IN `OFFERS`, AND WHY THAT IS NOT A STYLE CHOICE. `OFFERS`
// is the CLIENT catalogue — line 1 of this file calls it the closer-deck
// catalog, src/sales/closer-deck.mjs feeds every entry of it to the client
// present page through offersForClient(), sendDeckPayLink() will build a
// client pay link for any key in it, and api/pipeline-clients.mjs accepts any
// productCode in it as a product to put a CLIENT on a board. Dropping three
// partner-only add-ons in there would offer a client "Done-For-You Marketing,
// $2,497/month" on the deck. Same shape, same Object.freeze, same integer
// cents, same commasProductTitleFor resolution — separate map, because the
// audience is different.
//
// THE SHAPE GAINS ONE FIELD THE Offer SHAPE HAS NO WAY TO SAY: `billing`.
// Every existing Offer is a single charge on a pay link, so nothing in the
// Offer typedef can express "every month" or "each time one is delivered".
// `billing` says which, and `unitLabel` says what one unit is when the answer
// is per_unit. priceCents stays what it is everywhere else — integer cents for
// ONE billing unit. Nothing existing was bent to fit.
//
// `financing` IS DELIBERATELY ABSENT. Whether FundHub finances a monthly
// add-on the way it finances the $10,000 entry is an owner decision nobody has
// made. Absent means not recorded. It is not false.
//
// NONE OF THESE EVER PAYS A PARTNER. They are FundHub revenue: `partnerShare`
// is false on all three, their products.code must never join the partner
// accrual allow-list W1-money-model.md §7 specifies, and no partner_revenue
// row may be written for one. src/config/partner-add-ons.test.mjs holds that.
// ───────────────────────────────────────────────────────────────────────────

/** @typedef {"CREATIVE_INTELLIGENCE"|"DFY_MARKETING"|"LEAD_FLOW"} PartnerAddOnKey */

/**
 * @typedef {object} PartnerAddOn
 * @property {PartnerAddOnKey} key
 * @property {string} name
 * @property {number} priceCents  integer cents for ONE billing unit
 * @property {"monthly"|"per_unit"} billing  how often priceCents is charged
 * @property {string|null} unitLabel  what one unit is, when billing is per_unit
 * @property {"partner"} audience  sold to a partner, never to a client
 * @property {boolean} partnerShare  false: FundHub revenue, never a partner_revenue row
 * @property {boolean} letters  DS-02 / letter pack may never fire for these
 * @property {string} productCode  products.code (db/migrations/271), and the
 *   `tier` written on the partner's `subscriptions` row
 * @property {string} commasProductTitle  vendor checkout title only
 * @property {string} summary  one plain line, for a menu screen
 */

/** @type {Readonly<Record<PartnerAddOnKey, PartnerAddOn>>} */
export const PARTNER_ADD_ONS = Object.freeze({
  CREATIVE_INTELLIGENCE: Object.freeze({
    key: "CREATIVE_INTELLIGENCE",
    name: "Creative Intelligence",
    priceCents: 29700,
    billing: "monthly",
    unitLabel: null,
    audience: "partner",
    partnerShare: false,
    letters: false,
    productCode: "creative-intelligence",
    commasProductTitle: "Consulting Services Insights",
    summary:
      "Hooks written for their offer, their own segment so partners never bid against each other, the Winner's Board, and their numbers read back to them."
  }),
  DFY_MARKETING: Object.freeze({
    key: "DFY_MARKETING",
    name: "Done-For-You Marketing",
    priceCents: 249700,
    billing: "monthly",
    unitLabel: null,
    audience: "partner",
    partnerShare: false,
    letters: false,
    productCode: "dfy-marketing",
    commasProductTitle: "Consulting Services Retainer",
    // The partner's own ad spend is theirs and never lands on FundHub's books,
    // so it is not a price here and must not be added to one.
    summary:
      "FundHub builds the creative, runs the campaigns and manages the ad account. The partner still pays for their own ads on top."
  }),
  LEAD_FLOW: Object.freeze({
    key: "LEAD_FLOW",
    name: "Lead Flow",
    priceCents: 9900,
    billing: "per_unit",
    unitLabel: "booked call",
    audience: "partner",
    partnerShare: false,
    letters: false,
    productCode: "lead-flow",
    commasProductTitle: "Consulting Services Introductions",
    summary:
      "Booked, screened calls with business owners handed straight to the partner."
  })
});

export const PARTNER_ADD_ON_KEYS = Object.freeze(Object.keys(PARTNER_ADD_ONS));

/** One add-on by key, or null. Deliberately separate from getOffer(): a client
 *  offer and a partner add-on must never resolve through the same door. */
export function getPartnerAddOn(key) {
  if (!key) return null;
  return PARTNER_ADD_ONS[String(key)] || null;
}

/** "$297/month" · "$99 per booked call". Composed, never a second copy of a
 *  price. Returns null when the price is not a number rather than inventing a
 *  free one. */
export function partnerAddOnPriceLabel(addOn) {
  const a = typeof addOn === "string" ? getPartnerAddOn(addOn) : addOn;
  const price = formatCents(a && a.priceCents);
  if (!price) return null;
  if (a.billing === "per_unit") {
    return a.unitLabel ? `${price} per ${a.unitLabel}` : `${price} per unit`;
  }
  if (a.billing === "monthly") return `${price}/month`;
  return price;
}

/** The menu, as JSON a partner screen can render. No internals. */
export function partnerAddOnsForMenu() {
  return PARTNER_ADD_ON_KEYS.map((k) => {
    const a = PARTNER_ADD_ONS[k];
    return {
      key: a.key,
      name: a.name,
      summary: a.summary,
      priceCents: a.priceCents,
      priceDisplay: formatCents(a.priceCents),
      priceLabel: partnerAddOnPriceLabel(a),
      billing: a.billing,
      unitLabel: a.unitLabel,
      productCode: a.productCode
    };
  });
}

export function getOffer(key) {
  if (!key) return null;
  return OFFERS[String(key)] || null;
}

export function offerAllowsLetters(key) {
  const o = getOffer(key);
  return !!(o && o.letters);
}

export function formatCents(cents) {
  if (cents == null || !Number.isFinite(Number(cents))) return null;
  return (Number(cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
}

/** Which contract wording matches the deck path (offer + tier). */
export function resolveContractTemplateKey({ offerKey = null, tier = null } = {}) {
  if (tier === "FUNDING_PLUS_REPAIR") return "REPAIR-AND-FUNDING-AGREEMENT";
  const o = getOffer(offerKey);
  return (o && o.contractTemplateKey) || null;
}

/** Default blank-field values for a contract send from the present deck. */
export function defaultContractValues({ offerKey = null, tier = null } = {}) {
  const templateKey = resolveContractTemplateKey({ offerKey, tier });
  const o = getOffer(offerKey);
  const price = formatCents(o && o.priceCents);
  const company = "Fundhub";
  const base = { company_name: company, company_email: "support@fundhub.ai" };

  if (templateKey === "SOFT-PULL-CONSENT") {
    return { ...base, consent_days: "90" };
  }
  if (templateKey === "REPAIR-TRIAL-AGREEMENT") {
    return {
      ...base,
      trial_fee: price || "$200",
      scope: "One done-for-you dispute round (bureaus and creditors on your file). You watch progress in your portal."
    };
  }
  if (templateKey === "CREDIT-REPAIR-AGREEMENT") {
    /* one_time_fee, NOT monthly_fee. REPAIR_DFY is $1,000 charged once (owner
       decision 2026-08-31), and the blank this fills used to be called
       monthly_fee inside a template sentence reading "per month while services
       are active" — so the same $1,000 rendered as $1,000 a month for the
       180-day term. db/migrations/273_repair_fee_charged_once.sql rewrites that
       sentence and renames the blank; this is the other half of that rename.
       src/contracts/offer-fee-language.test.mjs fails if the two drift apart
       again. term_days stays: it is how long the work runs, not a billing
       period, and the corrected copy says so. */
    return {
      ...base,
      one_time_fee: price || "$1,000",
      term_days: "180",
      scope: "Done-for-you credit repair: forensic review, dispute rounds, creditor escalations, and live dashboard access."
    };
  }
  if (templateKey === "FUNDING-AGREEMENT") {
    const pct = (o && o.successFeePercent) || 10;
    return {
      ...base,
      deposit: price || "$3,000",
      success_fee: `${pct}% of funded amount`,
      fee_due: "within 7 days of funding",
      term_days: "180",
      scope: "Done-for-you funding: lender matching, strategic application rounds, and inquiry sweeps between rounds."
    };
  }
  if (templateKey === "REPAIR-AND-FUNDING-AGREEMENT") {
    const fund = getOffer("FUNDING_DFY");
    const repair = getOffer("REPAIR_DFY");
    const pct = (fund && fund.successFeePercent) || 10;
    return {
      ...base,
      deposit: formatCents(fund && fund.priceCents) || "$3,000",
      repair_fee: formatCents(repair && repair.priceCents) || "$1,000",
      success_fee: `${pct}% of funded amount`,
      fee_due: "within 7 days of funding",
      term_days: "180",
      repair_scope: "Parallel credit repair on limiting bureaus while funding rounds run.",
      funding_scope: "Full done-for-you funding program: matching, rounds, and inquiry sweeps."
    };
  }
  if (templateKey === "FUNDING-MASTERY-AGREEMENT") {
    return {
      ...base,
      program_fee: price || "$5,000",
      term_days: "365",
      scope: "Funding Mastery program access: the full A-to-Z course on your own file. This is education. You do the work."
    };
  }
  return base;
}

/** Public JSON for the present page — no internals. */
export function offersForClient() {
  return OFFER_KEYS.map((k) => {
    const o = OFFERS[k];
    return {
      key: o.key,
      name: o.name,
      priceCents: o.priceCents,
      priceDisplay: formatCents(o.priceCents),
      priceMinCents: o.priceMinCents ?? null,
      priceMaxCents: o.priceMaxCents ?? null,
      successFeePercent: o.successFeePercent ?? null,
      financing: o.financing,
      letters: o.letters,
      productCode: o.productCode,
      contractTemplateKey: o.contractTemplateKey ?? null,
      contents: o.contents ? [...o.contents] : null
    };
  });
}
