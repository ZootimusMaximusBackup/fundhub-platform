// What a real CRS payload actually tells us, field by field.
//
// The normalizer states which Metro 2 fields it can read. This measures whether
// that claim holds against a payload in hand, and it is the difference between
// "the engine has thirty-eight checks" and "the engine has thirty-eight checks
// and eleven of them can fire on this data source."
//
// It is a reporting tool, not a rule. It never produces a violation. Its output
// feeds docs/metro2/CRS-FIELD-COVERAGE.md and answers, before a single letter is
// written, the question that decides whether this product works on soft-pull
// data at all: which checks are inert, and what would have to change to wake
// them up.
//
// Pure. No I/O.

import { FIELD_SOURCES, normalizeTradeline, extractTradelineRecords, normalizeContext } from "./normalize.mjs";
import { isObserved, isAbsent, isNotVisible } from "./provenance.mjs";
import { IMPLEMENTED_RULE_IDS } from "./checks/index.mjs";

/** The fields the normalizer emits, in the order the knowledge base lists them. */
export const COVERED_FIELDS = Object.freeze(Object.keys(FIELD_SOURCES));

/**
 * Which Metro 2 fields each rule reads.
 *
 * Hand-maintained, and it has to be: a rule reads its fields by property access
 * inside a function body, and nothing short of running it can tell you which.
 * `checkRuleFieldsAreKnown` in the test file fails if a rule ID appears here
 * that the engine does not implement, or the other way round, so this cannot
 * silently drift out of step with the registry.
 */
export const RULE_INPUTS = Object.freeze({
  "M2-001": ["account_number_last4"],
  "M2-002": ["date_opened"],
  "M2-003": ["portfolio_type"],
  "M2-004": ["account_type"],
  "M2-005": ["field_24_date_of_account_info"],
  "M2-006": ["field_25_dofd", "field_17A_account_status"],
  "M2-007": ["field_25_dofd", "field_18_payment_history"],
  "M2-008": ["field_37_ecoa"],
  "M2-009": ["field_38_cii"],
  "M2-010": ["field_20_compliance_condition", "field_26_date_closed"],
  "M2-011": ["field_17A_account_status", "field_21_current_balance"],
  "M2-012": ["field_17A_account_status", "field_22_amount_past_due"],
  "M2-013": ["field_17A_account_status", "field_17B_payment_rating"],
  "M2-014": ["field_17A_account_status", "field_18_payment_history"],
  "M2-015": ["field_17A_account_status"],
  "M2-016": ["field_19_special_comment"],
  "M2-017": ["furnisher_is_third_party_collector", "field_17A_account_status"],
  "M2-018": ["k2_sold_to", "field_21_current_balance"],
  "M2-019": ["k1_original_creditor", "field_17A_account_status"],
  "M2-020": ["field_17A_account_status", "field_23_original_chargeoff_amount"],
  "M2-021": ["creditor", "field_21_current_balance"],
  "M2-022": ["is_medical_debt", "field_21_current_balance"],
  "M2-023": ["is_medical_debt", "field_25_dofd"],
  "M2-024": ["field_38_cii"],
  "M2-025": ["field_38_cii", "field_21_current_balance"],
  "M2-026": ["field_37_ecoa", "field_38_cii"],
  "M2-027": ["field_17A_account_status", "field_38_cii"],
  "M2-028": ["field_20_compliance_condition"],
  "M2-029": ["field_20_compliance_condition"],
  "M2-030": ["field_20_compliance_condition"],
  // The file-level rules read the context, not a tradeline. They are listed with
  // the context path they depend on so the coverage report can say the same
  // thing about them.
  "M2-031": ["context.file.addresses"],
  "M2-032": ["context.file.names"],
  "M2-033": ["context.file.dateOfBirth"],
  "M2-034": ["context.file.employments"],
  "M2-035": ["context.inquiries.hard"],
  "M2-036": ["context.inquiries"],
  "M2-037": ["context.inquiries"],
  "M2-038": ["context.inquiries.hard"]
});

/**
 * Context paths this module can fill from a credit report, and those it cannot.
 * A rule whose input is on the second list needs intake data before it can fire,
 * no matter how good the credit report is.
 */
export const CONTEXT_FROM_REPORT = Object.freeze([
  "context.file.addresses",
  "context.file.names",
  "context.file.dateOfBirth",
  "context.file.employments",
  "context.inquiries"
]);

export const CONTEXT_FROM_INTAKE = Object.freeze(["context.inquiries.hard"]);

const STATUS = Object.freeze({ OBSERVED: "observed", ABSENT: "absent", NOT_VISIBLE: "not_visible" });

function statusOf(field) {
  if (isObserved(field)) return STATUS.OBSERVED;
  if (isAbsent(field)) return STATUS.ABSENT;
  if (isNotVisible(field)) return STATUS.NOT_VISIBLE;
  return "malformed";
}

/**
 * Count how each field came out across every tradeline in a payload.
 *
 * @param {object} payload a CRS response
 * @returns {{tradelineCount: number, fields: object, notVisibleFields: string[], observedFields: string[]}}
 */
export function crsFieldCoverage(payload) {
  const records = extractTradelineRecords(payload);
  const tradelines = records.map(normalizeTradeline).filter(Boolean);

  const fields = {};
  for (const name of COVERED_FIELDS) {
    const counts = { observed: 0, absent: 0, not_visible: 0, malformed: 0 };
    for (const tradeline of tradelines) counts[statusOf(tradeline[name])] += 1;
    const declared = FIELD_SOURCES[name];
    fields[name] = {
      metro2Field: declared.field,
      declaredVisible: Boolean(declared.visible),
      source: declared.source ?? null,
      reason: declared.reason ?? null,
      counts,
      /* "Ever readable" is the useful verdict, not "always readable". A field
         observed on one account and absent on another is a working field; the
         absences are the furnisher's, and several of them are themselves the
         violation. */
      everObserved: counts.observed > 0,
      alwaysNotVisible: tradelines.length > 0 && counts.not_visible === tradelines.length
    };
  }

  return {
    tradelineCount: tradelines.length,
    fields,
    observedFields: COVERED_FIELDS.filter((n) => fields[n].everObserved),
    notVisibleFields: COVERED_FIELDS.filter((n) => !fields[n].declaredVisible)
  };
}

/**
 * Which rules can fire on this payload, and which are silent because a field
 * they need is not there.
 *
 * "Can fire" is the weaker claim it sounds like: it means no input is invisible,
 * so the rule is capable of speaking. It does not mean the rule will find
 * anything.
 */
export function ruleReadiness(payload, { consumerContextFields = [] } = {}) {
  const coverage = crsFieldCoverage(payload);
  const available = new Set([
    ...COVERED_FIELDS.filter((n) => FIELD_SOURCES[n].visible),
    ...CONTEXT_FROM_REPORT,
    ...consumerContextFields
  ]);

  const live = [];
  const inert = [];
  for (const [ruleId, inputs] of Object.entries(RULE_INPUTS)) {
    const missing = inputs.filter((i) => !available.has(i));
    (missing.length === 0 ? live : inert).push({ ruleId, inputs, missing });
  }

  return {
    tradelineCount: coverage.tradelineCount,
    live,
    inert,
    liveCount: live.length,
    inertCount: inert.length
  };
}

/**
 * Coverage of the file-level context: what the report gave us versus what still
 * has to come from the consumer.
 */
export function contextCoverage(payload, options = {}) {
  const context = normalizeContext(payload, options);
  return {
    file: {
      names: statusOf(context.file.names),
      dateOfBirth: statusOf(context.file.dateOfBirth),
      addresses: statusOf(context.file.addresses),
      employments: statusOf(context.file.employments)
    },
    inquiries: statusOf(context.inquiries),
    inquiryCount: isObserved(context.inquiries) ? context.inquiries.value.length : 0,
    inquiryTypeKnown: false,
    consumerAssertionsPresent: false
  };
}

/**
 * Every rule ID the engine implements, for the drift check in the test file.
 * Read off the registries rather than restated, so it cannot fall behind.
 */
export function implementedRuleIds() {
  return [...IMPLEMENTED_RULE_IDS];
}
