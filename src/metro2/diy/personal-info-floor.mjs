// The personal-information FLOOR — the cleanup every repair-path client gets,
// on every round, whatever else the file holds.
//
// ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
// COMPLIANCE REVIEW REQUIRED — dispute logic.
//
// OWNER DECISION, 2026-09-03, FINAL: "On EVERY customer on the credit-repair
// path, on EVERY round, clean file or not, ALWAYS run personal-information
// cleanup: consolidate to exactly 1 name, consolidate to exactly 1 address, and
// dispute every credit inquiry that has no matching open account. That is the
// FLOOR — it happens even when the file is completely clean and there is
// nothing else to dispute."
//
// Before this, a repair client whose file was tidy got NOTHING. The Metro 2
// engine fires only on a reporting defect (../diy/from-crs.mjs) and the
// derogatory pass (./derogatory.mjs) fires only on a derogatory account, so a
// spotless file walked straight into `no_violations` in ../../repair/analyze.mjs
// and the Repair desk stayed empty for a paying customer. This module is the
// floor under both of those.
//
// ── THE ONE RULE THAT MATTERS HERE: NEVER INVENT A VARIANT ────────────────
// A dispute letter is a statement of fact mailed to a credit bureau under the
// consumer's own name. So a consolidation claim is only truthful when the file
// GENUINELY carries two or more distinct names, or two or more distinct
// addresses.
//
// An earlier attempt at this floor compared the bureau file against
// clients.first_name + clients.last_name, which never carries a middle name,
// while a real bureau file routinely does. On a file carrying the single name
// "Barbara M Doty" it generated a dispute asserting the file reported more than
// one name and demanding deletion of the consumer's own correctly-reported
// name. That is a false statement of fact in a mailed dispute, and it is the
// exact failure this file is written to make impossible.
//
// So distinctness is measured ONLY over the labels the file itself reports.
// The client record supplies the name to KEEP — a consumer assertion about
// themselves, never an assertion about what the bureau reported. Where the file
// carries exactly one name, the claim CONFIRMS that one name should remain
// (PI-NAME-CONFIRM). It never disputes a second name that was never there.
//
// The same discipline governs the inquiry claim. src/metro2/normalize.mjs marks
// `consumerAuthorized` not_visible on purpose — nothing in a credit report says
// whether the consumer authorised an inquiry. So this file never asserts that
// they did not. It asserts only what it can see: an inquiry from a company that
// reports no account anywhere on the pull, and asks for the permissible purpose.
//
// ── WHY THESE ARE NOT M2- RULES ───────────────────────────────────────────
// M2-001 … M2-038 is a closed, pinned catalogue (../checks/index.test.mjs
// asserts exactly 38). These claims assert no Metro 2 format defect. They rest
// on the consumer's § 1681e(b) right to maximum possible accuracy, the
// § 1681i(a)(1) reinvestigation duty, and — for inquiries — § 1681b's
// permissible-purpose limit. Every statute and case string below is taken from
// ../rules/citations.mjs; none is written from memory.
//
// Severity is SUPPORTING for all of them. Knowledge base § 5.8 tier 4 is
// "Personal info errors, inquiry challenges" by name, so this is the placement
// the spec gives, not a downward guess.
//
// PURE. No clock, no network, no database.

import { normalizeFromCrs } from "../normalize.mjs";
import { STATUTES, CASES } from "../rules/citations.mjs";
import { SEVERITY } from "../checks/severity.mjs";
import { bureauReportsFromMergedCrs, reportAsOf } from "./from-crs.mjs";

const S = STATUTES;
const C = CASES;

/** Every rule id this module can emit. */
export const PERSONAL_INFO_RULE_IDS = Object.freeze([
  "PI-NAME-CONSOLIDATE",
  "PI-NAME-CONFIRM",
  "PI-ADDRESS-CONSOLIDATE",
  "PI-ADDRESS-CONFIRM",
  "PI-INQUIRY-UNMATCHED"
]);

/**
 * ruleId → the plain name a letter prints and the authority it rests on.
 * `scope` matches the shape ../../metro2/letters/generate.mjs already handles.
 */
export const PERSONAL_INFO_CLAIMS = Object.freeze({
  "PI-NAME-CONSOLIDATE": Object.freeze({
    plainName: "More than one name on the file — consolidate to one",
    severity: SEVERITY.SUPPORTING,
    citations: Object.freeze([S.FCRA_1681E_B, S.FCRA_1681I_A1, S.FCRA_1681I_A5A, C.SESSA])
  }),
  "PI-NAME-CONFIRM": Object.freeze({
    plainName: "One name only on the file — confirm and hold it there",
    severity: SEVERITY.SUPPORTING,
    citations: Object.freeze([S.FCRA_1681E_B, S.FCRA_1681I_A1])
  }),
  "PI-ADDRESS-CONSOLIDATE": Object.freeze({
    plainName: "More than one address on the file — consolidate to one",
    severity: SEVERITY.SUPPORTING,
    citations: Object.freeze([S.FCRA_1681E_B, S.FCRA_1681I_A1, S.FCRA_1681I_A5A, C.SESSA])
  }),
  "PI-ADDRESS-CONFIRM": Object.freeze({
    plainName: "One address only on the file — confirm and hold it there",
    severity: SEVERITY.SUPPORTING,
    citations: Object.freeze([S.FCRA_1681E_B, S.FCRA_1681I_A1])
  }),
  "PI-INQUIRY-UNMATCHED": Object.freeze({
    plainName: "Inquiry with no account reported on the file",
    severity: SEVERITY.SUPPORTING,
    citations: Object.freeze([S.FCRA_1681B, S.FCRA_1681E_B, S.FCRA_1681I_A1])
  })
});

/** Is this rule id one of the personal-information floor's rather than Metro 2's? */
export function isPersonalInfoRuleId(ruleId) {
  return Object.prototype.hasOwnProperty.call(PERSONAL_INFO_CLAIMS, String(ruleId || ""));
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

/** "Sim", "M", "Repair" → "Sim M Repair". Empty parts drop out. */
export function nameLabel(name) {
  return [name?.first, name?.middle, name?.last].map(text).filter(Boolean).join(" ");
}

/** Case, punctuation and spacing folded away. Two labels that differ only in
    those are the same reported name and must NOT be called two names. */
export function normalizeLabel(label) {
  return text(label).toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** "412 Pecan St, Austin, TX, 78701" — what a letter prints. */
export function addressLabel(address) {
  const street = [address?.line1, address?.line2].map(text).filter(Boolean).join(" ");
  const tail = [address?.city, address?.state, address?.postal].map(text).filter(Boolean).join(", ");
  return [street, tail].filter(Boolean).join(", ");
}

/** ZIP+4 folded to five digits, so "78701" and "78701-1234" are one address. */
export function normalizeAddress(address) {
  const zip5 = text(address?.postal).replace(/\D/g, "").slice(0, 5);
  return normalizeLabel(
    [address?.line1, address?.line2, address?.city, address?.state, zip5].map(text)
      .filter(Boolean).join(" ")
  );
}

/**
 * Distinct labels in first-seen order. `key` folds the noise; the label kept is
 * the one the file actually printed, because that is what a letter may quote.
 */
function distinctBy(items, toLabel, toKey) {
  const seen = new Map();
  for (const item of items || []) {
    const label = toLabel(item);
    if (!label) continue;
    const key = toKey(item);
    if (!key || seen.has(key)) continue;
    seen.set(key, { key, label, item });
  }
  return [...seen.values()];
}

/* Corporate boilerplate that appears on one spelling of a company and not the
   other. Dropped ONLY for the inquiry↔account comparison, never from anything a
   letter prints. "CREDIT" is deliberately not on this list: dropping it would
   fold "Credit One" into "One". */
const CORPORATE_NOISE = new Set([
  "BANK", "BANKS", "NA", "NATIONAL", "ASSOCIATION", "ASSN", "INC", "INCORPORATED",
  "LLC", "LLP", "LP", "CORP", "CORPORATION", "CO", "COMPANY", "FSB", "SSB",
  "CU", "UNION", "FEDERAL", "FED", "FINANCIAL", "FINANCE", "SERVICES", "SERVICE",
  "SVCS", "SVC", "USA", "US", "THE", "GROUP", "HOLDINGS", "OF", "AND"
]);

/**
 * A creditor name reduced to the part that identifies the company.
 *
 * If every token is boilerplate ("US Bank NA") the tokens are kept rather than
 * collapsing to the empty string — an empty key would match everything and
 * silence every claim.
 */
export function creditorKey(name) {
  const tokens = normalizeLabel(name).split(" ").filter(Boolean);
  if (tokens.length === 0) return "";
  const kept = tokens.filter((t) => !CORPORATE_NOISE.has(t));
  return (kept.length ? kept : tokens).join("");
}

/**
 * Does any account reported anywhere on this pull explain this inquiry?
 *
 * Deliberately GENEROUS, and deliberately across every bureau on the pull. A
 * claim that says "no account from this company is reported" must be true, so
 * an uncertain match counts as a match and the claim is not made. Under-firing
 * costs a dispute the consumer could have made; over-firing puts a false
 * statement in a mailed letter.
 */
export function inquiryHasAccount(inquiryCreditor, accountKeys) {
  const key = creditorKey(inquiryCreditor);
  if (!key || key.length < 3) return true; // unreadable name — never claim
  for (const account of accountKeys) {
    if (!account || account.length < 3) return true;
    if (key === account) return true;
    if (key.includes(account) || account.includes(key)) return true;
  }
  return false;
}

/** Every account key on the whole pull, all bureaus. */
export function accountKeysFromPull(merged) {
  const keys = new Set();
  for (const report of Object.values(bureauReportsFromMergedCrs(merged))) {
    const records = Array.isArray(report?.tradelines) ? report.tradelines : [];
    for (const record of records) {
      const key = creditorKey(record?.creditorName);
      if (key) keys.add(key);
    }
  }
  return [...keys];
}

function quoteList(labels) {
  return labels.map((l) => `"${l}"`).join(", ");
}

function claim(ruleId, { bureau, subject, reason, observed, expected, creditor = null }) {
  const spec = PERSONAL_INFO_CLAIMS[ruleId];
  if (!spec) return null;
  return Object.freeze({
    ruleId,
    severity: spec.severity,
    /* No Metro 2 field, because no Metro 2 defect is asserted. The letter writer
       drops the field line rather than naming one (../letters/generate.mjs
       fieldLine). */
    field: null,
    observed,
    expected,
    reason,
    citations: spec.citations,
    metro2Ref: null,
    plainName: spec.plainName,
    subcase: null,
    scope: "file",
    subject,
    creditor,
    account_last4: null,
    bureau: String(bureau || "").toUpperCase() || null,
    collection: false
  });
}

/**
 * The name half of the floor.
 *
 * TWO NAMES OR MORE  → PI-NAME-CONSOLIDATE. Every name it quotes as being on
 *                      the file really is on the file.
 * ONE NAME           → PI-NAME-CONFIRM. Quotes that one name and asks the
 *                      bureau to hold the file to it. Disputes nothing that is
 *                      not there.
 * NO NAME VISIBLE    → PI-NAME-CONFIRM, wording that asserts NOTHING about what
 *                      the file contains — a soft pull may simply not carry the
 *                      alias block, and "the file reports no name" would then be
 *                      a claim we cannot stand behind.
 */
export function nameClaim({ namesOnFile, legalName, bureau }) {
  const legal = text(legalName);
  const labels = namesOnFile.map((n) => n.label);
  const legalKey = normalizeLabel(legal);
  const onFile = namesOnFile.find((n) => n.key === legalKey);
  const keep = onFile ? onFile.label : legal;

  if (labels.length >= 2) {
    const remove = namesOnFile.filter((n) => n.key !== legalKey).map((n) => n.label);
    return claim("PI-NAME-CONSOLIDATE", {
      bureau,
      subject: keep || null,
      observed: { namesReportedOnFile: labels, keepOnly: keep || null },
      expected: "one name on the file",
      reason:
        `This file reports more than one name: ${quoteList(labels)}. ` +
        `My name is ${keep}. More than one name on a single consumer file is how ` +
        `another person's records get attached to it, and it is a failure of ` +
        `maximum possible accuracy. Consolidate this file to the single name ` +
        `${keep} and delete ${quoteList(remove)} from my personal information.`
    });
  }

  if (labels.length === 1) {
    return claim("PI-NAME-CONFIRM", {
      bureau,
      subject: keep || labels[0],
      observed: { namesReportedOnFile: labels, keepOnly: keep || labels[0] },
      expected: "one name on the file",
      reason:
        `This file reports one name: "${labels[0]}". My name is ${keep}. ` +
        `Confirm in writing that my personal information carries this one name ` +
        `and no other, and add no further name or spelling to it. If any other ` +
        `name is or becomes attached to this file it is not mine and must be deleted.`
    });
  }

  return claim("PI-NAME-CONFIRM", {
    bureau,
    subject: keep || null,
    observed: { namesReportedOnFile: [], keepOnly: keep || null },
    expected: "one name on the file",
    reason:
      `My name is ${keep}. Report my personal information under that one name ` +
      `only. Confirm in writing which names are attached to this file, and if ` +
      `any name or spelling other than ${keep} is attached to it, delete it.`
  });
}

/**
 * The address half. Same rule as the name half: two or more addresses genuinely
 * on the file is a consolidation; one is a confirmation; none asserts nothing.
 *
 * The address to KEEP is the client's own — a consumer assertion. Where the
 * client record has none, the file's own "Current" address is used, and failing
 * that the first one listed, which is what the bureau is showing anyway.
 */
export function addressClaim({ addressesOnFile, currentAddress, bureau }) {
  const labels = addressesOnFile.map((a) => a.label);
  const stated = text(currentAddress);
  const statedKey = normalizeLabel(stated);
  const matched = addressesOnFile.find((a) => normalizeLabel(a.label) === statedKey);
  const fileCurrent = addressesOnFile.find((a) => a.item?.isCurrent === true);
  const keep = stated
    ? (matched ? matched.label : stated)
    : (fileCurrent?.label || labels[0] || null);
  const keepKey = normalizeLabel(keep);

  if (labels.length >= 2) {
    const remove = addressesOnFile
      .filter((a) => normalizeLabel(a.label) !== keepKey)
      .map((a) => a.label);
    return claim("PI-ADDRESS-CONSOLIDATE", {
      bureau,
      subject: keep,
      observed: { addressesReportedOnFile: labels, keepOnly: keep },
      expected: "one address on the file",
      reason:
        `This file reports more than one address: ${quoteList(labels)}. ` +
        `My address is ${keep}. Old and duplicated addresses are how another ` +
        `person's records get attached to a file and how a file is mixed with a ` +
        `relative's. Consolidate my personal information to ${keep} and delete ` +
        `${quoteList(remove)}.`
    });
  }

  if (labels.length === 1) {
    return claim("PI-ADDRESS-CONFIRM", {
      bureau,
      subject: keep,
      observed: { addressesReportedOnFile: labels, keepOnly: keep },
      expected: "one address on the file",
      reason:
        `This file reports one address: "${labels[0]}". My address is ${keep}. ` +
        `Confirm in writing that my personal information carries this one address ` +
        `and no other, and add no further address to it. If any other address is ` +
        `or becomes attached to this file it is not mine and must be deleted.`
    });
  }

  return claim("PI-ADDRESS-CONFIRM", {
    bureau,
    subject: keep,
    observed: { addressesReportedOnFile: [], keepOnly: keep },
    expected: "one address on the file",
    reason: keep
      ? `My address is ${keep}. Report my personal information under that one ` +
        `address only. Confirm in writing which addresses are attached to this ` +
        `file, and if any address other than ${keep} is attached to it, delete it.`
      : `Confirm in writing which addresses are attached to my personal ` +
        `information on this file. Any address that is not my own must be deleted, ` +
        `and my file must carry one address only.`
  });
}

/**
 * One claim per inquiry whose furnisher reports no account anywhere on the pull.
 *
 * It asserts ONLY what the report shows. It does not say the consumer never
 * authorised the inquiry — nothing in a credit report carries that, and
 * ../normalize.mjs marks it not_visible for exactly that reason.
 */
export function inquiryClaims({ inquiries, accountKeys, bureau }) {
  const out = [];
  const seen = new Set();
  for (const inquiry of inquiries || []) {
    const creditor = text(inquiry?.creditor);
    if (!creditor) continue;
    const when = text(inquiry?.inquiryDate);
    const dedupe = `${normalizeLabel(creditor)}|${when}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    if (inquiryHasAccount(creditor, accountKeys)) continue;
    const dated = when ? ` dated ${when}` : "";
    out.push(claim("PI-INQUIRY-UNMATCHED", {
      bureau,
      subject: creditor,
      creditor,
      observed: { inquiryCreditor: creditor, inquiryDate: when || null, accountOnFile: false },
      expected: "a permissible purpose on the record, or deletion of the inquiry",
      reason:
        `An inquiry from ${creditor}${dated} appears on this file, and no account ` +
        `from ${creditor} is reported anywhere on this credit file alongside it. ` +
        `A consumer report may only be furnished for a permissible purpose. ` +
        `Provide the permissible purpose this inquiry was made under and the ` +
        `identity of the party that made it. If a permissible purpose cannot be ` +
        `verified, delete the inquiry from my file.`
    }));
  }
  return out.filter(Boolean);
}

/**
 * The floor, per bureau.
 *
 * EVERY bureau with a report on the pull gets at least the name claim and the
 * address claim. That is the owner rule literally: cleanup happens even when
 * the file is completely clean, so this function never returns an empty list
 * for a bureau that has a file.
 *
 * @param {object} merged  crs_results.result
 * @param {{ legalName?: string|null, currentAddress?: string|null }} consumer
 *        What the CLIENT RECORD says about the client. Never used to decide
 *        whether the file carries a variant — only to name what to keep.
 * @returns {Record<string, object[]>}
 */
export function personalInfoFloorByBureau(merged, { legalName = null, currentAddress = null } = {}) {
  const reports = bureauReportsFromMergedCrs(merged);
  const accountKeys = accountKeysFromPull(merged);
  const out = {};

  for (const [code, report] of Object.entries(reports)) {
    const { context } = normalizeFromCrs(report, { asOf: reportAsOf(report) });
    const rawNames = context?.file?.names?.value || [];
    const rawAddresses = context?.file?.addresses?.value || [];
    const rawInquiries = context?.inquiries?.value || [];

    const namesOnFile = distinctBy(rawNames, nameLabel, (n) => normalizeLabel(nameLabel(n)));
    const addressesOnFile = distinctBy(rawAddresses, addressLabel, normalizeAddress);

    const claims = [
      nameClaim({ namesOnFile, legalName, bureau: code }),
      addressClaim({ addressesOnFile, currentAddress, bureau: code }),
      ...inquiryClaims({ inquiries: rawInquiries, accountKeys, bureau: code })
    ].filter(Boolean);

    out[code] = claims;
  }
  return out;
}

/**
 * Everything already found, then the floor beneath it.
 *
 * Concatenates rather than de-duplicating: a floor claim is about the file's
 * personal information, and no Metro 2 or derogatory claim covers the same
 * ground, so there is nothing here that could be a duplicate to drop.
 */
export function mergePersonalInfoClaims(byBureau = {}, floorByBureau = {}) {
  const out = {};
  const bureaus = new Set([
    ...Object.keys(byBureau || {}),
    ...Object.keys(floorByBureau || {})
  ]);
  for (const bureau of bureaus) {
    const merged = [
      ...((byBureau || {})[bureau] || []),
      ...((floorByBureau || {})[bureau] || [])
    ];
    if (merged.length) out[bureau] = merged;
  }
  return out;
}
