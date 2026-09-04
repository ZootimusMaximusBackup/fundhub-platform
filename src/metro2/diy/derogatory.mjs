// Derogatory-item dispute claims — the product rule, deliberately NOT a Metro 2 check.
//
// ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
// The 38 Metro 2 checks only fire on a reporting DEFECT: two fields that
// contradict each other, a date that cannot be true, a required segment left
// empty. A collection that is reported cleanly and completely trips none of
// them. On a consumer soft pull, fifteen of the thirty-eight read Field 17A,
// which a soft pull never carries, so they cannot fire at all.
//
// The result was a repair client whose whole file is collections and a
// charge-off receiving ZERO letters. The engine was working exactly as written
// and the product was not working at all.
//
// OWNER DECISION, 2026-09-03: "any derogatory deserves a letter, but only if
// they are in the correct offer path." So every derogatory item — collection,
// charge-off, late — on a repair-path client produces a claim, and a client who
// is not on a repair path produces none regardless of what the file holds. The
// offer-path half of that gate lives in src/repair/analyze.mjs, which is the
// only place that knows the client. This file is the item half, and it is pure.
//
// ── WHY THESE ARE NOT M2- RULES ───────────────────────────────────────────
// M2-001 … M2-038 is a closed, pinned catalogue: src/metro2/checks/index.test.mjs
// asserts there are exactly 38 and that they match the citation table key for
// key. Adding to it would be a lie about what the Metro 2 knowledge base
// contains. These claims assert no format defect. They assert the consumer's
// § 1681i(a)(1) right to have a disputed item reinvestigated and, under
// § 1681i(a)(5)(A), deleted when it cannot be verified. Nothing in the letter
// is stated as a Metro 2 finding, and each claim quotes the bureau's OWN label
// for the account rather than translating it into a Metro 2 code we cannot see.
//
// They carry their own `citations`, `severity` and plain name, all built from
// strings that already exist in src/metro2/rules/citations.mjs. Nothing is
// invented here and nothing in the Metro 2 closed world moves.
//
// PURE. No clock, no network, no database.

import { normalizeFromCrs } from "../normalize.mjs";
import { isCollectionAccount } from "../checks/chargeoff-collection.mjs";
import { valueOf } from "../provenance.mjs";
import { STATUTES, CASES } from "../rules/citations.mjs";
import { SEVERITY } from "../checks/severity.mjs";
import { bureauReportsFromMergedCrs, reportAsOf } from "./from-crs.mjs";

const S = STATUTES;
const C = CASES;

/** The three claims, strongest first. One account yields at most one of them. */
export const DEROGATORY_RULE_IDS = Object.freeze([
  "DEROG-COLLECTION",
  "DEROG-CHARGEOFF",
  "DEROG-LATE"
]);

/**
 * ruleId → the plain name a letter prints, the tier it argues at, and the
 * authority it rests on. Every statute and case string is taken from
 * src/metro2/rules/citations.mjs; none is written from memory here.
 *
 * Severity follows severity.mjs's downward tie-break. None of these is tier 1:
 * tier 1 ("likely deletion") is an enumerated list in knowledge base § 5.8 and
 * "an accurate collection the consumer wants gone" is not on it. Claiming
 * deletion tier for an item we have no defect evidence against is exactly the
 * over-claim that turns into a refund.
 */
export const DEROGATORY_CLAIMS = Object.freeze({
  "DEROG-COLLECTION": Object.freeze({
    plainName: "Collection account — reinvestigation demanded",
    severity: SEVERITY.STRONG,
    citations: Object.freeze([
      S.FCRA_1681I_A1,
      S.FCRA_1681I_A5A,
      S.FCRA_1681E_B,
      S.FCRA_1681S2_B,
      C.HINKLE
    ])
  }),
  "DEROG-CHARGEOFF": Object.freeze({
    plainName: "Charged-off account — reinvestigation demanded",
    severity: SEVERITY.STRONG,
    citations: Object.freeze([
      S.FCRA_1681I_A1,
      S.FCRA_1681I_A5A,
      S.FCRA_1681E_B,
      S.FCRA_1681S2_B,
      C.SAUNDERS
    ])
  }),
  "DEROG-LATE": Object.freeze({
    plainName: "Late payment reporting — reinvestigation demanded",
    severity: SEVERITY.MODERATE,
    citations: Object.freeze([
      S.FCRA_1681I_A1,
      S.FCRA_1681E_B,
      S.FCRA_1681S2_A1A,
      C.PITTMAN
    ])
  })
});

/** Is this rule id one of ours rather than a Metro 2 check? */
export function isDerogatoryRuleId(ruleId) {
  return Object.prototype.hasOwnProperty.call(DEROGATORY_CLAIMS, String(ruleId || ""));
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function count(value) {
  const n = Number(text(value));
  return Number.isFinite(n) ? n : 0;
}

/**
 * The bureau's own words for this account's condition, or "" when it said
 * nothing. Quoted verbatim in the letter — never translated.
 */
export function reportedCondition(record) {
  return text(record?.currentRatingType) || text(record?.paymentStatus);
}

/**
 * Does the vendor's own record corroborate that this furnisher is a collection
 * agency or debt buyer? `businessType` and `loanType` are the vendor's fields
 * and say so outright, so reading them is not the name-guessing that
 * src/metro2/diy/collectors.mjs refuses to do.
 */
export function reportedAsCollection(record, tradeline) {
  if (/collection/i.test(text(record?.businessType))) return true;
  if (/collection/i.test(text(record?.loanType))) return true;
  // The Metro 2 status, on the rare file that carries it.
  return isCollectionAccount(tradeline) === true;
}

/**
 * Which derogatory claim, if any, this account supports. At most one per
 * account: one account is one dispute, and three claims about the same
 * tradeline read as padding to a bureau.
 *
 * Order is strongest evidence first. A collection is only called a collection
 * where the vendor said so; an account the bureau labels "CollectionOrChargeOff"
 * without that corroboration falls to the charge-off claim, whose letter quotes
 * that exact label rather than picking a side.
 */
export function classifyDerogatory(record, tradeline) {
  const condition = reportedCondition(record);

  if (reportedAsCollection(record, tradeline)) return "DEROG-COLLECTION";
  if (/chargeoff|charge-off|charged off/i.test(condition)) return "DEROG-CHARGEOFF";

  const lates = count(record?._30DayLates) + count(record?._60DayLates) + count(record?._90DayLates);
  const pastDueCents = valueOf(tradeline?.field_22_amount_past_due);
  if (lates > 0) return "DEROG-LATE";
  if (/\blate\b|delinquen|past due/i.test(condition)) return "DEROG-LATE";
  if (typeof pastDueCents === "number" && pastDueCents > 0) return "DEROG-LATE";

  return null;
}

/** Integer cents → "$1,840.00". Grouped, because a letter is read by a person. */
function money(cents) {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return null;
  const [whole, frac] = (cents / 100).toFixed(2).split(".");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

function reasonFor(ruleId, { creditor, condition, balanceCents, pastDueCents, lates }) {
  const who = creditor || "This furnisher";
  const balance = money(balanceCents);
  const owed = balance ? ` with a balance of ${balance} still reported` : "";
  const quoted = condition ? ` The report labels the account "${condition}".` : "";

  if (ruleId === "DEROG-COLLECTION") {
    return (
      `${who} is reported as a collection account${owed}.${quoted} I dispute this item as ` +
      `inaccurate. Reinvestigate it and obtain from the furnisher the documents that prove the ` +
      `debt is mine, that the amount is correct, and that this company holds it. If any part of ` +
      `that cannot be verified, the item must be deleted rather than left on the file.`
    );
  }
  if (ruleId === "DEROG-CHARGEOFF") {
    return (
      `${who} is reported as a charged-off account${owed}.${quoted} I dispute this item as ` +
      `inaccurate. Reinvestigate it and obtain from the furnisher the documents that prove the ` +
      `charge-off, the amount, and the date it happened. If any part of that cannot be verified, ` +
      `the item must be deleted rather than left on the file.`
    );
  }
  const howMany = lates > 0 ? ` ${lates} late payment${lates === 1 ? "" : "s"} are reported.` : "";
  const due = money(pastDueCents);
  const dueLine = due ? ` An amount past due of ${due} is reported.` : "";
  return (
    `${who} is reported as delinquent.${howMany}${dueLine}${quoted} I dispute the late payment ` +
    `history on this account as inaccurate. Reinvestigate it and obtain from the furnisher the ` +
    `payment records that prove each late month reported. Any month that cannot be verified must ` +
    `be corrected to current.`
  );
}

/**
 * One derogatory claim, shaped exactly like a Metro 2 violation so the letter
 * generator, the dispute_items writer and the collector grouper all take it
 * without a special case.
 *
 * `field` is null on purpose: these claims name no Metro 2 field, because they
 * assert no Metro 2 defect. The letter generator omits the field line when
 * there is nothing honest to put in it.
 */
export function derogatoryClaim(ruleId, { record, tradeline, bureau }) {
  const spec = DEROGATORY_CLAIMS[ruleId];
  if (!spec) return null;

  const creditor = valueOf(tradeline?.creditor) || text(record?.creditorName) || null;
  const balanceCents = valueOf(tradeline?.field_21_current_balance);
  const pastDueCents = valueOf(tradeline?.field_22_amount_past_due);
  const lates =
    count(record?._30DayLates) + count(record?._60DayLates) + count(record?._90DayLates);
  const condition = reportedCondition(record);

  return Object.freeze({
    ruleId,
    severity: spec.severity,
    field: null,
    observed: {
      reportedCondition: condition || null,
      balanceCents: typeof balanceCents === "number" ? balanceCents : null,
      pastDueCents: typeof pastDueCents === "number" ? pastDueCents : null,
      latePaymentsReported: lates
    },
    expected: "an item the furnisher can prove, or deletion under FCRA § 1681i(a)(5)(A)",
    reason: reasonFor(ruleId, { creditor, condition, balanceCents, pastDueCents, lates }),
    citations: spec.citations,
    metro2Ref: null,
    plainName: spec.plainName,
    subcase: null,
    scope: "tradeline",
    subject: null,
    creditor,
    account_last4: valueOf(tradeline?.account_number_last4) || null,
    bureau: String(bureau || "").toUpperCase() || null,
    // src/metro2/diy/collectors.mjs reads this to decide furnisher validation letters.
    collection: ruleId === "DEROG-COLLECTION"
  });
}

/**
 * Every derogatory claim in a stored CRS result, grouped by bureau.
 * A bureau with no derogatory account is absent from the object, matching
 * violationsByBureauFromMergedCrs's shape.
 *
 * @param {object} merged  crs_results.result
 * @returns {Record<string, object[]>}
 */
export function derogatoryClaimsByBureau(merged) {
  const reports = bureauReportsFromMergedCrs(merged);
  const out = {};

  for (const [code, report] of Object.entries(reports)) {
    const { tradelines } = normalizeFromCrs(report, { asOf: reportAsOf(report) });
    const claims = [];
    for (const tradeline of tradelines) {
      const record = tradeline?.raw;
      const ruleId = classifyDerogatory(record, tradeline);
      if (!ruleId) continue;
      const claim = derogatoryClaim(ruleId, { record, tradeline, bureau: code });
      if (claim) claims.push(claim);
    }
    if (claims.length) out[code] = claims;
  }
  return out;
}

/**
 * Metro 2 violations first, then the derogatory claims the engine did not
 * already cover. Metro 2 findings lead because they carry evidence of a defect;
 * the derogatory claim on the same account would only repeat it.
 *
 * "Same account" is creditor plus last four. Where the sim (or a real file)
 * gives no last four, creditor alone decides, which is the conservative side:
 * it drops a duplicate rather than mailing two claims about one tradeline.
 */
export function mergeDerogatoryClaims(violationsByBureau = {}, claimsByBureau = {}) {
  const out = {};
  const bureaus = new Set([
    ...Object.keys(violationsByBureau || {}),
    ...Object.keys(claimsByBureau || {})
  ]);

  for (const bureau of bureaus) {
    const engine = (violationsByBureau || {})[bureau] || [];
    const claims = (claimsByBureau || {})[bureau] || [];
    const covered = new Set(
      engine
        .map((v) => accountKey(v))
        .filter(Boolean)
    );
    const extra = claims.filter((c) => {
      const key = accountKey(c);
      return !key || !covered.has(key);
    });
    const merged = [...engine, ...extra];
    if (merged.length) out[bureau] = merged;
  }
  return out;
}

function accountKey(v) {
  const creditor = text(v?.creditor).toLowerCase();
  if (!creditor) return null;
  const last4 = text(v?.account_last4 || v?.accountLast4).replace(/\D/g, "").slice(-4);
  return `${creditor}|${last4}`;
}
