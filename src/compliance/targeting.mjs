// The Meta targeting validator — the special-ad-category restrictions, as code.
//
// Meta enforces these server-side for campaigns in a special ad category, and a
// violation comes back as an opaque rejection at create time. We reject first, so
// the partner gets a sentence they can act on instead of an API error code.
//
// EVERY RULE HERE IS A REJECTION, NOT A CORRECTION. A builder that silently
// widened a 5-mile radius to 15 would be making a targeting decision on the
// partner's behalf and spending their money differently than they asked. The
// spec says "the targeting builder must REJECT", and rejecting is also the only
// behaviour that teaches the partner what is not allowed.
//
// The banned set is not configurable. These are not fundhub preferences that
// might be relaxed for a good customer — they are the terms on which Meta permits
// credit advertising at all, so they live in code next to the reasons rather than
// in a table someone can edit at 2am.

// 18-65+ is the only permitted range. Meta expresses "65+" as age_max 65 with no
// upper bound, so both 65 and null are accepted for the top of the range.
const REQUIRED_AGE_MIN = 18;
const REQUIRED_AGE_MAX = 65;
const MIN_RADIUS_MILES = 15;

/* screenTargeting(targeting, opts) → { ok, reasons[] }

   `targeting` is the payload as the partner supplied it. Unknown keys are ignored
   rather than rejected: Meta adds targeting surfaces regularly, and failing on an
   unrecognised key would break every campaign the week they ship one. The keys
   that are banned are named explicitly.

   Fails closed on a non-object: a targeting spec we cannot read is one we cannot
   certify, and "no targeting supplied" must not silently mean "no restrictions
   apply". */
export function screenTargeting(targeting, { platform = "meta" } = {}) {
  const reasons = [];

  if (targeting === null || targeting === undefined) {
    return { ok: false, reasons: [reason("targeting_missing",
      "A targeting payload is required. An empty spec cannot be certified against the special ad category rules.")] };
  }
  if (typeof targeting !== "object" || Array.isArray(targeting)) {
    return { ok: false, reasons: [reason("targeting_malformed",
      "Targeting must be an object.")] };
  }

  // These restrictions are Meta's. TikTok has its own, and applying Meta's rules
  // to a TikTok payload would reject things TikTok permits.
  if (platform !== "meta") return { ok: true, reasons: [] };

  const t = targeting;

  // --- Geography -----------------------------------------------------------
  // ZIP / postal targeting. Meta disallows it outright in credit; it is also the
  // classic redlining proxy, which is why it is banned rather than bounded.
  if (present(t.zips) || present(t.zip_codes) || present(t.postal_codes)) {
    reasons.push(reason("zip_targeting",
      "ZIP/postal-code targeting is not permitted for credit offers. Target by city, state or country."));
  }
  if (Array.isArray(t.geo_locations?.zips) && t.geo_locations.zips.length) {
    reasons.push(reason("zip_targeting",
      "geo_locations.zips is not permitted for credit offers. Target by city, state or country."));
  }

  // Radius floor. Anything tighter than 15 miles is a neighbourhood, and a
  // neighbourhood is a demographic.
  for (const r of collectRadii(t)) {
    if (r.value < MIN_RADIUS_MILES) {
      reasons.push(reason("radius_too_small",
        `A ${r.value}-mile radius is below the ${MIN_RADIUS_MILES}-mile minimum for credit offers (${r.where}).`));
    }
  }

  // Exclusions. Excluding a place is targeting the complement of it.
  if (present(t.excluded_geo_locations) || present(t.geo_locations?.excluded_geo_locations)
      || present(t.exclusions) || present(t.excluded_zips)) {
    reasons.push(reason("location_exclusion",
      "Location exclusions are not permitted for credit offers."));
  }

  // --- Age -----------------------------------------------------------------
  const ageMin = num(t.age_min);
  const ageMax = t.age_max === null || t.age_max === undefined ? null : num(t.age_max);
  if (ageMin !== null && ageMin !== REQUIRED_AGE_MIN) {
    reasons.push(reason("age_range",
      `age_min must be ${REQUIRED_AGE_MIN} for credit offers; got ${ageMin}.`));
  }
  if (ageMax !== null && ageMax !== REQUIRED_AGE_MAX) {
    reasons.push(reason("age_range",
      `age_max must be ${REQUIRED_AGE_MAX} ("65+") for credit offers; got ${ageMax}.`));
  }

  // --- Gender --------------------------------------------------------------
  // Meta encodes "all" as [1,2] or an absent key. Anything narrower is a
  // restriction.
  if (t.genders !== undefined && t.genders !== null) {
    const g = Array.isArray(t.genders) ? t.genders.map(Number) : [Number(t.genders)];
    const isAll = g.length === 0 || (g.includes(1) && g.includes(2));
    if (!isAll) {
      reasons.push(reason("gender_restriction",
        "Gender restrictions are not permitted for credit offers."));
    }
  }

  // --- Audiences -----------------------------------------------------------
  // Lookalikes are built from a seed list, so they inherit whatever bias the seed
  // carried — which is why they are banned in this category rather than reviewed.
  if (present(t.lookalike_audiences) || present(t.lookalikes)) {
    reasons.push(reason("lookalike_audience",
      "Lookalike audiences are not permitted for credit offers."));
  }
  for (const a of asArray(t.custom_audiences)) {
    const subtype = String(a?.subtype || a?.type || "").toUpperCase();
    if (subtype.includes("LOOKALIKE")) {
      reasons.push(reason("lookalike_audience",
        "A lookalike custom audience is not permitted for credit offers."));
    }
  }

  // --- Detailed targeting expansion ---------------------------------------
  // Expansion lets Meta reach beyond the stated interests. In a special ad
  // category that means delivery we did not certify.
  if (t.targeting_automation?.detailed_targeting_expansion === 1
      || t.targeting_automation?.advantage_audience === 1
      || t.detailed_targeting_expansion === true
      || t.targeting_optimization === "expansion_all") {
    reasons.push(reason("detailed_targeting_expansion",
      "Detailed-targeting expansion must be off for credit offers."));
  }

  return { ok: reasons.length === 0, reasons };
}

/* buildTargeting — the builder the campaign path uses. Returns a payload with the
   category-mandated values forced, or throws with every reason at once.

   Forcing age/gender rather than merely validating them is safe in a way that
   forcing a radius is not: 18-65+ and all-genders are the ONLY legal values, so
   there is no partner intent to override — whereas a radius has many legal
   values and picking one would be us choosing. */
export function buildTargeting(input = {}, { platform = "meta" } = {}) {
  const base = (input && typeof input === "object" && !Array.isArray(input)) ? { ...input } : {};

  if (platform === "meta") {
    base.age_min = REQUIRED_AGE_MIN;
    base.age_max = REQUIRED_AGE_MAX;
    base.genders = [1, 2];
    base.targeting_automation = { ...(base.targeting_automation || {}), detailed_targeting_expansion: 0 };
  }

  const { ok, reasons } = screenTargeting(base, { platform });
  if (!ok) {
    const e = new Error(`targeting rejected: ${reasons.map((r) => r.message).join(" ")}`);
    e.code = "TARGETING_REJECTED";
    e.reasons = reasons;
    throw e;
  }
  return base;
}

// --- helpers ---------------------------------------------------------------

const reason = (code, message) => ({ code, message, rule_set: "platform" });
const asArray = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const present = (v) => Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== "";
const num = (v) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

// Radii appear in several shapes across Meta's payloads. Kilometres are converted
// rather than compared directly — a 20km radius is 12.4 miles and would otherwise
// slip under a naive numeric check.
function collectRadii(t) {
  const out = [];
  const push = (v, unit, where) => {
    const n = num(v);
    if (n === null) return;
    const miles = String(unit || "mile").toLowerCase().startsWith("k") ? n * 0.621371 : n;
    out.push({ value: Math.round(miles * 100) / 100, where });
  };
  push(t.radius, t.distance_unit, "radius");
  for (const [i, c] of asArray(t.custom_locations).entries()) {
    push(c?.radius, c?.distance_unit, `custom_locations[${i}]`);
  }
  for (const [i, c] of asArray(t.geo_locations?.custom_locations).entries()) {
    push(c?.radius, c?.distance_unit, `geo_locations.custom_locations[${i}]`);
  }
  for (const [i, p] of asArray(t.geo_locations?.places).entries()) {
    push(p?.radius, p?.distance_unit, `geo_locations.places[${i}]`);
  }
  return out;
}

export const TARGETING_LIMITS = Object.freeze({
  REQUIRED_AGE_MIN, REQUIRED_AGE_MAX, MIN_RADIUS_MILES
});
