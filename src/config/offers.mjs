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
 * @property {string[]} [contents]
 */

/** @type {Readonly<Record<OfferKey, Offer>>} */
export const OFFERS = Object.freeze({
  SOFT_PULL: Object.freeze({
    key: "SOFT_PULL",
    name: "UnderwriteIQ soft-pull assessment",
    priceCents: 3200,
    financing: false,
    letters: false,
    paymentPurpose: "diagnostic"
  }),
  FUNDING_DFY: Object.freeze({
    key: "FUNDING_DFY",
    name: "Funding, done-for-you",
    priceCents: 300000,
    successFeePercent: 10,
    financing: false,
    letters: false,
    paymentPurpose: "deposit"
  }),
  REPAIR_DFY: Object.freeze({
    key: "REPAIR_DFY",
    name: "Credit repair, done-for-you",
    priceCents: 100000,
    financing: true,
    letters: true,
    paymentPurpose: "repair"
  }),
  REPAIR_TRIAL: Object.freeze({
    key: "REPAIR_TRIAL",
    name: "Repair test run (first round, done for you)",
    priceCents: 20000,
    financing: true,
    letters: true,
    paymentPurpose: "repair"
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
    contents: UWIQ_DELIVERABLES_CONTENTS
  }),
  FUNDING_MASTERY: Object.freeze({
    key: "FUNDING_MASTERY",
    name: "Funding Mastery course (A to Z)",
    priceCents: 500000,
    financing: true,
    letters: false,
    paymentPurpose: "custom"
  })
});

export const OFFER_KEYS = Object.freeze(Object.keys(OFFERS));

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
      contents: o.contents ? [...o.contents] : null
    };
  });
}
