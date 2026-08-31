// @ts-check
// The $10,000 partner curriculum, as constants — thirteen modules and four gates.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): two of the four gates named here are
// compliance certifications, and G2 is what stands between a partner and publishing
// copy under FundHub's brand. The label is a marker, not a request to revisit an
// owner decision.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS FILE IS FOR
//
// docs/specs/W7-curriculum.md designs the training the $10,000 entry promises
// (docs/specs/W0-decisions.md: "the white-label program plus real education and
// training"). db/migrations/284_training_delivery.sql seeds it into
// `training_modules` and `training_gates`. This file is the same list in code, and
// it exists for two reasons that are not "convenience":
//
//   1. THE GATE CODES ARE A VOCABULARY THE REST OF THE SYSTEM WILL USE. Anything
//      that asks "has this partner passed G2 yet?" needs the four codes to be one
//      named thing rather than four string literals scattered across handlers.
//   2. A SEED AND A SCREEN CAN DRIFT. src/training/curriculum.test.mjs reads
//      284's SQL as text and fails if a code, title, week, gate or certified flag
//      here disagrees with what the migration seeds. One list, checked in two
//      places, so neither can move alone.
//
// WHAT IS DELIBERATELY NOT HERE: the module CONTENT. Not a summary, not a lesson
// body, not a slide list. W7 designs a live cohort — recordings are reference only
// — and writing the teaching material for a regulated consumer-finance product is
// a human authoring job. Inventing it would be fabrication (CLAUDE.md §2).
//
// TWO ORDERS, BOTH REAL. `code` is W7's own module number; `position` is the order
// a partner meets them. They differ: W7 teaches the two compliance modules (m7, m8)
// in week 3 and the call module (m6) in week 4, because G2 must clear before any
// public asset goes live and G3 before any live buyer call. Sorting a screen by
// module number would show the partner the wrong week.

/* The two code lists are typed as plain strings rather than as the literal union
   Object.freeze infers. Every caller reaches them holding a value off a query
   string or a request body, and a union type turns `includes(someString)` into a
   compile error at every one of those call sites — which is a type that makes the
   validating function unusable for validation. */

/** The four gates, in the order W7 requires them to be passed.
 *  @type {readonly string[]} */
export const GATE_CODES = Object.freeze(["G1", "G2", "G3", "G4"]);

/**
 * @typedef {object} TrainingGate
 * @property {string} code
 * @property {number} position
 * @property {string} title
 * @property {number} weekDue
 */

/** The four hard gates. W7: "FOUR HARD GATES, IN ORDER. NO GATE, NO SELLING." */
export const GATES = Object.freeze([
  Object.freeze({ code: "G1", position: 1, title: "Capital and Plan Gate", weekDue: 1 }),
  Object.freeze({ code: "G2", position: 2, title: "Compliance Certification", weekDue: 3 }),
  Object.freeze({ code: "G3", position: 3, title: "Call Certification", weekDue: 4 }),
  Object.freeze({ code: "G4", position: 4, title: "Supervised Production Release", weekDue: 5 })
]);

/**
 * @typedef {object} TrainingModule
 * @property {string} code      W7's module number, 'm1'..'m13'
 * @property {number} position  the order a partner meets them, 1..13
 * @property {string} title
 * @property {number|null} weekNo    the week W7 schedules it in; null where W7 does not say
 * @property {string|null} gateCode  the gate that closes at the end of that week
 * @property {boolean} certified     W7 marks exactly three headings "(certified)"
 */

/** The thirteen, in delivery order. Titles are W7's headings; nothing is added. */
export const MODULES = Object.freeze([
  Object.freeze({ code: "m1", position: 1, title: "Your Money Math", weekNo: 1, gateCode: "G1", certified: false }),
  Object.freeze({ code: "m2", position: 2, title: "The Belt: what FundHub does after the sale", weekNo: 1, gateCode: "G1", certified: false }),
  Object.freeze({ code: "m3", position: 3, title: "Reading a Credit File (the arithmetic)", weekNo: 2, gateCode: null, certified: false }),
  Object.freeze({ code: "m4", position: 4, title: "The Three Lanes and the Six Offers", weekNo: 2, gateCode: null, certified: false }),
  Object.freeze({ code: "m5", position: 5, title: "Why Repair Is Not An Upsell", weekNo: 2, gateCode: null, certified: false }),
  Object.freeze({ code: "m7", position: 6, title: "Compliance I: what you may never say", weekNo: 3, gateCode: "G2", certified: true }),
  Object.freeze({ code: "m8", position: 7, title: "Compliance II: what you may never do", weekNo: 3, gateCode: "G2", certified: true }),
  Object.freeze({ code: "m6", position: 8, title: "The Call", weekNo: 4, gateCode: "G3", certified: true }),
  Object.freeze({ code: "m9", position: 9, title: "Ads, and where the machine stops", weekNo: 4, gateCode: "G3", certified: false }),
  Object.freeze({ code: "m10", position: 10, title: "What you actually get, and what you don't", weekNo: 4, gateCode: "G3", certified: false }),
  Object.freeze({ code: "m11", position: 11, title: "The Stop List", weekNo: 4, gateCode: "G3", certified: false }),
  /* W7 does not schedule m12 in any week. NULL means UNKNOWN and it survives —
     CLAUDE.md §12. Its position follows W7's own numbering rather than a week
     this file invented. */
  Object.freeze({ code: "m12", position: 12, title: "Your Numbers and the Floor", weekNo: null, gateCode: null, certified: false }),
  Object.freeze({ code: "m13", position: 13, title: "First Three (supervised production)", weekNo: 5, gateCode: "G4", certified: false })
]);

/** Module codes, in delivery order.
 *  @type {readonly string[]} */
export const MODULE_CODES = Object.freeze(MODULES.map((m) => m.code));

/** The statuses a progress row may carry. No row at all means "not started" —
    284's header explains why that is not a third status. */
export const PROGRESS_STATUSES = Object.freeze(["attended", "complete"]);

/** The outcomes a gate decision may carry. 'revoked' is how a pass is taken back,
    because the pass row itself is immutable (284). */
export const GATE_OUTCOMES = Object.freeze(["passed", "failed", "revoked"]);

/** The whole programme, in weeks. W7: 4 weeks of teaching, 8 of supervised
    production, everything inside 90 days on purpose. */
export const TEACHING_WEEKS = 4;
export const TOTAL_WEEKS = 12;

export const isModuleCode = (code) => MODULE_CODES.includes(String(code || "").trim().toLowerCase());
export const isGateCode = (code) => GATE_CODES.includes(String(code || "").trim().toUpperCase());

/** The module rows a given gate depends on, in delivery order. W7 makes
    attendance a gate rather than a suggestion: "A partner who misses a live
    session sits it again in the next cohort before their gate clears." So the
    modules taught in a gate's week are the modules that gate waits on. */
export function modulesForGate(gateCode) {
  const code = String(gateCode || "").trim().toUpperCase();
  return MODULES.filter((m) => m.gateCode === code);
}

/** The gate immediately before this one, or null for G1. The ladder is ordered
    and src/training/gates.mjs refuses to record a pass out of order. */
export function previousGate(gateCode) {
  const i = GATE_CODES.indexOf(String(gateCode || "").trim().toUpperCase());
  return i > 0 ? GATE_CODES[i - 1] : null;
}
