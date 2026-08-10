// Payment Rating (Field 17B) — knowledge base § 1.5.
//
// 17B says what condition the account was in AT the moment its final status
// was reported. It is a nine-value alphabet and nothing else is valid, which
// makes it one of the few fields where "this code does not exist" is itself the
// finding.
//
// Note the alphabet does NOT overlap the rating scales consumer report vendors
// hand out (C / N / - / 1–9). That non-overlap is why the CRS normalizer marks
// 17B `not_visible` rather than translating — see src/metro2/normalize.mjs.

export const PAYMENT_RATINGS = Object.freeze({
  "0": { meaning: "Current", late: false },
  "1": { meaning: "30–59 days past due", late: true, daysMin: 30, daysMax: 59 },
  "2": { meaning: "60–89 days past due", late: true, daysMin: 60, daysMax: 89 },
  "3": { meaning: "90–119 days past due", late: true, daysMin: 90, daysMax: 119 },
  "4": { meaning: "120–149 days past due", late: true, daysMin: 120, daysMax: 149 },
  "5": { meaning: "150–179 days past due", late: true, daysMin: 150, daysMax: 179 },
  "6": { meaning: "180+ days past due", late: true, daysMin: 180, daysMax: null },
  G: { meaning: "Collection", late: false, derogatory: true },
  L: { meaning: "Charge-off", late: false, derogatory: true }
});

/** The statuses that require 17B at all, quoted from § 1.5 for the agreement test. */
export const PAYMENT_RATING_REQUIRED_TEXT =
  "Required when Account Status Code is 05, 13, 61–65, or 88–97.";

export function isPaymentRating(code) {
  return typeof code === "string" && Object.hasOwn(PAYMENT_RATINGS, code);
}

export function isLateRating(code) {
  return isPaymentRating(code) && PAYMENT_RATINGS[code].late === true;
}
