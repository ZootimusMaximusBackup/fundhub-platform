// The hook taxonomy. Five axes, every one a fixed list.
//
// docs/specs/W2-creative-intelligence.md §7.2.
//
// WHY ENUMS AND NOT PROSE. The model picks from these lists; it does not write
// sentences. Prose cannot be cross-tabulated, so a prose classifier makes the
// saturation map — the one screen that turns a swipe file into a decision tool —
// impossible to build. Every axis below is closed, and an out-of-list value from
// the model is a rejected row rather than a new category.
//
// THE ONE FREE-TEXT FIELD IS hook_line, and it is COPIED VERBATIM. It is the
// opening line of the ad exactly as it ran. A paraphrase teaches nobody
// anything, so nothing in the write path is allowed to rewrite it.
//
// TAXONOMY_VERSION IS THE RE-CLASSIFY TRIGGER. One model call per creative,
// ever, keyed on (content_hash, taxonomy_version). Bump the version and the
// classifier re-runs; leave it alone and a creative already classified costs
// nothing forever. Changing a list below WITHOUT bumping the version means old
// rows and new rows describe different things under the same label — so the two
// go together, and the test in taxonomy.test.mjs asserts the version is an
// integer that someone chose.

export const TAXONOMY_VERSION = 1;

/* Axis 1 — Angle. Why should I care?
   This is the axis the saturation map and the territory assignment both read,
   which makes it the load-bearing one. */
export const ANGLES = Object.freeze([
  "speed_of_money",
  "amount_of_money",
  "approval_without_credit",
  "lender_secret",
  "business_growth",
  "debt_rescue",
  "status_lifestyle",
  "credentialing",
  "anti_guru_contrarian",
  "case_study_receipt"
]);

/* Axis 2 — Format. What the ad physically is. */
export const AD_FORMATS = Object.freeze([
  "talking_head_ugc",
  "screen_record_proof",
  "text_on_image",
  "carousel",
  "whiteboard_explainer",
  "meme_static",
  "testimonial_montage",
  "faceless_voiceover"
]);

/* Axis 3 — Promise shape. How hard the ad commits. */
export const PROMISE_SHAPES = Object.freeze([
  "specific_dollar",
  "specific_timeframe",
  "guarantee_language",
  "curiosity_no_promise"
]);

/* Axis 4 — Compliance risk. THIS AXIS IS WHY THE BOARD IS SAFE TO SELL.
   A partner who copies a competitor's "guaranteed approval, no credit check"
   ad gets FundHub's ad accounts banned and FundHub's name on a complaint. So
   every creative on the board carries a badge, and the two dangerous values
   below render greyed with a do-not-copy banner rather than as inspiration. */
export const COMPLIANCE_RISKS = Object.freeze([
  "names_a_credit_outcome",
  "implies_guaranteed_approval",
  "uses_no_credit_check",
  "clean"
]);

/* The values that must never be presented as something to copy. Exported so the
   board projection and the screen agree on one list. */
export const DO_NOT_COPY_RISKS = Object.freeze([
  "names_a_credit_outcome",
  "implies_guaranteed_approval"
]);

/* Axis 5 — Funnel. Where the click goes. */
export const FUNNELS = Object.freeze([
  "free_lead_magnet",
  "webinar",
  "book",
  "call_booking",
  "low_ticket_slo",
  "direct_application"
]);

export const AXES = Object.freeze({
  angle: ANGLES,
  ad_format: AD_FORMATS,
  promise_shape: PROMISE_SHAPES,
  compliance_risk: COMPLIANCE_RISKS,
  funnel: FUNNELS
});

export const AXIS_KEYS = Object.freeze(Object.keys(AXES));

/* Platforms Layer 1 rents from. Deliberately NOT src/compliance/screen.mjs's
   PLATFORMS — that set is "platforms FundHub may advertise on" and this one is
   "platforms FundHub buys observations about". They overlap and they are not the
   same question; youtube is here and is not there. */
export const OBSERVED_PLATFORMS = Object.freeze(["meta", "google", "youtube", "tiktok"]);

export const WATCH_GROUPS = Object.freeze(["direct", "adjacent", "upstream", "own"]);

/* validateClassification(row) → { ok, errors[] }

   Structural only. It does not decide whether the model was RIGHT, it decides
   whether what came back is representable. An unrepresentable row is dropped —
   never coerced to a default — because a silently defaulted angle would put a
   creative in the wrong cell of the saturation map and nothing would report it. */
export function validateClassification(row = {}) {
  const errors = [];
  for (const key of AXIS_KEYS) {
    const value = row[key];
    if (value === undefined || value === null || value === "") {
      errors.push(`${key} is missing`);
      continue;
    }
    if (!AXES[key].includes(value)) {
      errors.push(`${key}="${value}" is not in the taxonomy`);
    }
  }
  if (row.hook_line !== undefined && row.hook_line !== null && typeof row.hook_line !== "string") {
    errors.push("hook_line must be a string when present");
  }
  return { ok: errors.length === 0, errors };
}

/* taxonomyPromptBlock() — the enum lists as the model sees them.

   Built from the arrays above rather than written out again, so a value added
   to a list cannot be missing from the prompt. Two copies of a taxonomy drift,
   and the drift is invisible: the model keeps returning the old value and the
   validator keeps rejecting it, and the only symptom is a classification rate
   that quietly falls. */
export function taxonomyPromptBlock() {
  return AXIS_KEYS.map((key) => `${key}: ${AXES[key].join(" | ")}`).join("\n");
}
