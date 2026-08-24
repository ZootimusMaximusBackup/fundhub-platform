// Pre-qual amount and portal credit scores — same readers staff already use.

import { businessCredit, triMerge } from "./client-detail.mjs";

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

/** Client-safe scores. Null stays null. Nothing is invented. */
export function portalCreditScores({ client = {}, crsResults = [], businesses = [] } = {}) {
  const tri = triMerge(crsResults);
  const biz = businessCredit({ client, businesses });
  return {
    experian: tri.experian,
    equifax: tri.equifax,
    transunion: tri.transunion,
    experian_business: biz.intelliscore
  };
}

export function portalHasScore(scores = {}) {
  return scores.experian != null
    || scores.equifax != null
    || scores.transunion != null
    || scores.experian_business != null;
}
