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
 * @property {string} [contractTemplateKey]  contract_templates.template_key to send on close
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
    paymentPurpose: "diagnostic",
    productCode: "diagnostic",
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
    contractTemplateKey: "FUNDING-MASTERY-AGREEMENT"
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
    return {
      ...base,
      monthly_fee: price || "$1,000",
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
