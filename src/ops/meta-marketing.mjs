// Meta = marketing ads. Read only.
// Does not create campaigns. Does not buy, pause, or scale ads.
// Special ad category is mandatory and fail-closed in src/adplatforms/meta.mjs
// via ad_platform_category_map.

import { MIN_N_RATE } from "./discoveries.mjs";

export function specialAdCategoryRule() {
  return {
    required: true,
    fail_closed: true,
    source: "ad_platform_category_map",
    note: "Category map must be set before any Meta write. The brain does not create campaigns."
  };
}

export function costPerBooked({ spendCents, bookedN } = {}) {
  const n = Number(bookedN);
  const spend = Number(spendCents);
  if (!Number.isFinite(n) || n < MIN_N_RATE) {
    return {
      status: "INSUFFICIENT",
      cost_cents: null,
      n: Number.isFinite(n) ? n : 0,
      note: `Need ${MIN_N_RATE} booked calls. Have ${Number.isFinite(n) ? n : 0}. Do not invent a cost.`
    };
  }
  if (spendCents == null || spendCents === "") {
    return {
      status: "INSUFFICIENT",
      cost_cents: null,
      n,
      note: "Ad spend is missing. Do not invent a cost."
    };
  }
  if (!Number.isFinite(spend) || spend < 0) {
    return {
      status: "INSUFFICIENT",
      cost_cents: null,
      n,
      note: "Ad spend is missing. Do not invent a cost."
    };
  }
  return {
    status: "MEASURED",
    cost_cents: Math.round(spend / n),
    n,
    note: "Spend divided by booked calls. Read only."
  };
}

export function marketingSnapshot({ ads = {}, bookedN = null } = {}) {
  return {
    spend_cents: ads.spend_cents ?? null,
    spend_status: ads.status || "missing",
    cost_per_booked: costPerBooked({ spendCents: ads.spend_cents, bookedN }),
    special_ad_category: specialAdCategoryRule(),
    note: "Live Marketing API write is unverified. The brain does not buy, pause, or scale ads. Category map must be set before any spend write."
  };
}

export default { specialAdCategoryRule, costPerBooked, marketingSnapshot };
