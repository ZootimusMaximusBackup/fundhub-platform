// Pre-qual amount on a client file — same field order as closer-deck and CCP.

function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function prequalFromCustomFields(cf = {}) {
  return numOrNull(
    cf.analyzer_prequal_amount
      ?? cf.cf_reanalyzer_prequal_amount
      ?? cf.total_funding_estimate
  );
}

export function formatPrequalUsd(amount) {
  if (amount == null) return null;
  return "$" + amount.toLocaleString("en-US");
}
