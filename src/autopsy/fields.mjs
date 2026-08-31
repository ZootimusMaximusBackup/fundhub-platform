// Decline Autopsy — the field contract, and the boundary identity never crosses.
//
// COMPLIANCE REVIEW REQUIRED. Spec: docs/specs/W3-decline-autopsy.md §5.
//
// THE ONE RULE THIS FILE EXISTS FOR. The people on a broker's declined list
// never agreed to give FundHub anything. So FundHub never learns who they are.
// The broker strips identifiers before he uploads and this module refuses
// anything that still looks like a person — in the column names AND in the cell
// values — BEFORE a byte is written to storage.
//
// Everything here is pure. No clock, no I/O, no database. src/autopsy/parse.mjs
// applies it; src/autopsy/score.mjs consumes what survives.

/** $27, once. Integer cents, per src/commissions/money.mjs. Spec §7.1 (A1).
 *
 *  NOT in src/config/offers.mjs. That file is owned by another workflow in this
 *  batch and is not editable from here, so the price lives beside the only code
 *  that charges it. When the DECLINE_AUTOPSY entry lands in OFFERS, delete this
 *  constant and read getOffer("DECLINE_AUTOPSY").priceCents instead — the
 *  handler already routes every read through autopsyPriceCents(). */
export const AUTOPSY_PRICE_CENTS = 2700;

/** Marketing says "your last 20". The cap is 25 (spec A2). */
export const MAX_ROWS = 25;

/** A row_label is the broker's own key. 32 characters, his wording, never joined
 *  to a person by us. Spec §5.1. */
export const MAX_ROW_LABEL = 32;

/* FICO BANDS, NOT SCORES. A band is not a credit-file value, which is the whole
   reason the field list looks like this. The midpoint is what the underwriting
   engine is fed, and it is printed in the report next to the number it produced
   so a reader can see it was assumed rather than measured. "unknown" has NO
   midpoint — null, not a guess, not an average. */
export const FICO_BANDS = Object.freeze({
  "<560": 530,
  "560-599": 580,
  "600-639": 620,
  "640-679": 660,
  "680-719": 700,
  "720+": 740,
  unknown: null
});

export const FICO_BAND_KEYS = Object.freeze(Object.keys(FICO_BANDS));

/** Band midpoint, or null when the band is "unknown" or not a band at all.
 *  NULL MEANS UNKNOWN AND MUST SURVIVE — it never becomes 0 and never becomes
 *  an average. */
export function ficoMidpoint(band) {
  const key = String(band ?? "").trim();
  return Object.prototype.hasOwnProperty.call(FICO_BANDS, key) ? FICO_BANDS[key] : null;
}

/* The decline reasons a broker picks from. Free text is NOT accepted here: a
   notes box is where a name always ends up (spec §5.1). "other" carries no
   detail on purpose. */
export const DECLINE_REASONS = Object.freeze([
  "credit_score",
  "derogatory_marks",
  "high_utilization",
  "thin_file",
  "too_many_inquiries",
  "recent_delinquency",
  "insufficient_revenue",
  "time_in_business",
  "industry_restricted",
  "bankruptcy",
  "other"
]);

/* Which of those a credit-repair engagement can actually move. Used ONLY to
   split "fundable after repair" from "not fundable through our stack" — it is
   never rendered as a promise that repair will succeed. */
export const REPAIRABLE_DECLINE_REASONS = Object.freeze([
  "credit_score",
  "derogatory_marks",
  "high_utilization",
  "thin_file",
  "too_many_inquiries",
  "recent_delinquency"
]);

export const BUCKETS = Object.freeze({
  FUNDABLE_NOW: "fundable_now",
  FUNDABLE_AFTER_REPAIR: "fundable_after_repair",
  NOT_FUNDABLE: "not_fundable",
  NOT_ENOUGH_INFORMATION: "not_enough_information"
});

export const BUCKET_KEYS = Object.freeze(Object.values(BUCKETS));

export const BUCKET_LABELS = Object.freeze({
  fundable_now: "Fundable now",
  fundable_after_repair: "Fundable after repair",
  not_fundable: "Not fundable through our stack",
  not_enough_information: "Not enough information"
});

/* ---------------------------------------------------------------------------
   THE REFUSAL. Two layers, both in code, neither of them a note in the terms.
--------------------------------------------------------------------------- */

/* 1. HEADER REJECTION. A CSV column whose name contains any of these is DROPPED
      before the file is stored, and the count of dropped columns is shown back
      to the broker so the loss is visible rather than silent. Spec §5.1. */
export const REFUSED_HEADER_WORDS = Object.freeze([
  "name", "ssn", "social", "dob", "birth", "address", "email", "phone",
  "mobile", "account", "note", "notes", "comment"
]);

/** True when a column name must be dropped. Substring match, case-insensitive,
 *  because "client_name" and "Primary E-Mail" are the shapes that actually
 *  arrive. Punctuation is stripped first so "e-mail" and "e mail" both hit. */
export function isRefusedHeader(header) {
  const h = String(header ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return REFUSED_HEADER_WORDS.some((w) => h.includes(w));
}

/* 2. VALUE REJECTION. A cell that looks like an SSN, an e-mail or a phone number
      REFUSES THE WHOLE UPLOAD. Not the cell, not the row — the upload. Dropping
      it quietly would teach the broker nothing and would leave us guessing what
      else was in there.

      Ordered most specific first so the message names the right thing. */
const PII_PATTERNS = Object.freeze([
  { kind: "ssn", label: "a Social Security number", re: /(?:^|\D)\d{3}-\d{2}-\d{4}(?:\D|$)/ },
  { kind: "ssn", label: "a Social Security number", re: /(?:^|\D)\d{9}(?:\D|$)/ },
  { kind: "email", label: "an e-mail address", re: /[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}/i },
  { kind: "phone", label: "a phone number", re: /(?:^|\D)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\D|$)/ }
]);

/**
 * scanCellForPii(value) — { kind, label } for the first thing that looks like a
 * person, or null.
 *
 * A bare 9-digit run counts as an SSN. That is deliberate over-refusal: a
 * 9-digit number in a declined-deal file is far more likely to be a stripped
 * SSN than a revenue figure, and the cost of a false refusal is one message
 * asking the broker to re-export. The cost of a false accept is holding a
 * consumer's SSN we had no right to.
 *
 * Amount and count fields are exempted by the CALLER, not here — see
 * parse.mjs's NUMERIC_FIELDS. This function judges a string, nothing else.
 */
export function scanCellForPii(value) {
  if (value === null || value === undefined) return null;
  const s = String(value);
  if (!s.trim()) return null;
  for (const p of PII_PATTERNS) {
    if (p.re.test(s)) return { kind: p.kind, label: p.label };
  }
  return null;
}

/* The accepted columns, and the aliases a real CRM export uses for each. Order
   is the order the manual-entry grid and the report show them in. */
export const ACCEPTED_FIELDS = Object.freeze([
  { key: "row_label", required: true, aliases: ["row label", "label", "ref", "reference", "file", "deal", "id"] },
  { key: "fico_band", required: true, aliases: ["fico band", "fico", "band", "credit band", "score band"] },
  { key: "state", required: false, aliases: ["st", "state code"] },
  { key: "business_age_months", required: false, aliases: ["business age months", "business age", "tib months", "time in business months"] },
  { key: "annual_revenue_usd", required: false, aliases: ["annual revenue", "annual revenue usd", "revenue"] },
  { key: "requested_amount_usd", required: false, aliases: ["requested amount", "requested amount usd", "amount requested", "requested"] },
  { key: "declined_by", required: false, aliases: ["declined by", "lender", "declining lender"] },
  { key: "decline_reason", required: false, aliases: ["decline reason", "reason", "turn down reason"] },
  { key: "declined_on", required: false, aliases: ["declined on", "declined", "decline month", "month"] },
  { key: "bureaus_pulled", required: false, aliases: ["bureaus pulled", "bureaus", "bureau"] },
  { key: "open_tradelines", required: false, aliases: ["open tradelines", "tradelines", "open accounts"] },
  { key: "revolving_utilization_pct", required: false, aliases: ["revolving utilization pct", "utilization", "utilisation", "util", "revolving utilization"] },
  /* The two fields the engine actually needs to produce a capacity figure at
     all. Neither identifies anybody: a credit limit and the month an account
     opened are numbers off the application, not a person. Without BOTH there is
     no seasoned revolving limit, the vendored engine returns zero funding, and
     the row is honestly reported as "not enough information" rather than as a
     measured zero. See src/autopsy/score.mjs. */
  { key: "highest_revolving_limit_usd", required: false, aliases: ["highest revolving limit", "highest limit", "highest credit limit", "primary limit", "credit limit"] },
  { key: "revolving_opened_month", required: false, aliases: ["revolving opened month", "oldest revolving opened", "primary opened", "limit opened"] }
]);

export const ACCEPTED_KEYS = Object.freeze(ACCEPTED_FIELDS.map((f) => f.key));
export const REQUIRED_KEYS = Object.freeze(ACCEPTED_FIELDS.filter((f) => f.required).map((f) => f.key));

/** Canonical field key for a column header, or null when the column is not one
 *  we accept. Unknown-but-harmless columns are simply ignored; refused ones are
 *  caught by isRefusedHeader() first. */
export function fieldKeyFor(header) {
  const raw = String(header ?? "").trim().toLowerCase();
  if (!raw) return null;
  const norm = raw.replace(/[^a-z0-9]+/g, " ").trim();
  const squashed = norm.replace(/\s+/g, "_");
  for (const f of ACCEPTED_FIELDS) {
    if (squashed === f.key) return f.key;
    if (norm === f.key.replace(/_/g, " ")) return f.key;
    if (f.aliases.some((a) => a === norm)) return f.key;
  }
  return null;
}

/* The exact disclosure the report carries at the TOP, not the bottom. Spec §9.1.
   No sentence here claims a credit outcome and none of them is a projection. */
export const REPORT_DISCLOSURE = Object.freeze([
  "We did not look at anyone's credit.",
  "These are estimates from the numbers you gave us.",
  "We removed nothing you did not send, and we will not contact any of these people.",
  "Every figure below is an estimate. None of it is a promise of a result."
]);

/* The merchant attestation. This is NOT a consumer consent and it is NOT stored
   in client_consents — CONSENT_KINDS is a closed set enforced by a CHECK, and it
   means "a consumer gave us permission about their own file". A broker's
   warranty about somebody else's file is a different record with a different
   name. Spec §8.1. Stored on the autopsy row. */
export const ATTESTATION_VERSION = "autopsy-attestation-v1";

export const ATTESTATION_TEXT = Object.freeze([
  "These are my own client records.",
  "I have the right to share this information for the purpose of getting an assessment.",
  "I have removed names and personal identifiers before uploading.",
  "FundHub will not contact any of these people.",
  "If I later want FundHub to work one of these deals, I will introduce the person myself and they will consent to FundHub directly."
]);

export default {
  AUTOPSY_PRICE_CENTS,
  MAX_ROWS,
  MAX_ROW_LABEL,
  FICO_BANDS,
  FICO_BAND_KEYS,
  ficoMidpoint,
  DECLINE_REASONS,
  REPAIRABLE_DECLINE_REASONS,
  BUCKETS,
  BUCKET_KEYS,
  BUCKET_LABELS,
  REFUSED_HEADER_WORDS,
  isRefusedHeader,
  scanCellForPii,
  ACCEPTED_FIELDS,
  ACCEPTED_KEYS,
  REQUIRED_KEYS,
  fieldKeyFor,
  REPORT_DISCLOSURE,
  ATTESTATION_VERSION,
  ATTESTATION_TEXT
};
