// § 5.6 — Personal information checks. Rules M2-031 … M2-034.
//
// These describe the FILE, not an account. Their signature is (context) alone,
// and index.mjs runs them once per report rather than once per tradeline —
// otherwise a file with twelve tradelines would report the same misspelled name
// twelve times and the letter would read as generated, which is the one thing
// § 4.6 says it must not.
//
// § 5.8 puts these in the supporting tier. They rarely move a score on their own.
// They matter for a different reason: an address the consumer never lived at or a
// name that is not theirs is how two people's files get mixed together, and a
// mixed file is where a stranger's charge-off arrives on your report.
//
// ── EVERY ONE OF THESE NEEDS THE CONSUMER TO SAY WHAT IS TRUE ─────────────
//
// A credit report cannot be checked against itself for whether a name is right.
// So each rule compares two sides:
//
//   context.file      what the bureau's file says   (names, DOB, addresses, employers)
//   context.consumer  what the consumer says is true
//
// Both are provenance-wrapped. Missing either side means the rule cannot fire,
// and that is the correct outcome — with nothing to compare against, calling the
// bureau wrong would be a guess.

import { violation, str, list, normalizeText, opt } from "./violation.mjs";
import { isObserved, valueOf } from "../provenance.mjs";
import { monthsBetween } from "../dates.mjs";

/**
 * Are two structured names the same person?
 *
 * Compares first and last name only. THE MIDDLE NAME IS DELIBERATELY IGNORED:
 * "BARBARA M DOTY" and "BARBARA DOTY" are the same consumer with and without a
 * middle initial, and a check that called that a mixed-file signal would fire on
 * most files in the country. A different first name or a different surname is a
 * real signal; a dropped initial is a formatting difference.
 */
export function sameName(a, b) {
  if (!a || !b) return false;
  const first = normalizeText(a.first);
  const last = normalizeText(a.last);
  if (first === "" || last === "") return false;
  return first === normalizeText(b.first) && last === normalizeText(b.last);
}

/** A one-line label for an address, for the letter and for the violation subject. */
export function addressLabel(address) {
  if (!address) return null;
  return [address.line1, address.city, address.state, address.postal]
    .filter((p) => p != null && String(p).trim() !== "")
    .join(", ");
}

/** Check 31 — Address fields. Old addresses more than the permitted number of cycles old. */
export function checkStaleAddresses(context) {
  const addresses = list(context?.file?.addresses);
  const asOf = typeof context?.asOf === "string" ? context.asOf : null;
  if (addresses === null || asOf === null) return [];

  const cycles = opt(context, "addressStaleCycles");
  return addresses
    .map((address) => {
      if (address?.isCurrent === true) return null;
      const reportedOn = typeof address?.reportedOn === "string" ? address.reportedOn : null;
      if (reportedOn === null) return null;
      const age = monthsBetween(reportedOn, asOf);
      if (age === null || age <= cycles) return null;
      const label = addressLabel(address);
      return violation({
        ruleId: "M2-031",
        scope: "report",
        subject: label,
        field: "address",
        observed: { address: label, reportedOn, monthsOld: age },
        expected: `no former address older than ${cycles} reporting cycles`,
        reason:
          `The file still carries the former address ${label}, last reported ${reportedOn} — ` +
          `${age} months before this report. An old address that is no longer the consumer's serves no ` +
          `purpose in the file and can attach another person's records to it.`
      });
    })
    .filter(Boolean);
}

/** Check 32 — Name fields. Name variants not matching the consumer's legal name. */
export function checkNameVariants(context) {
  const names = list(context?.file?.names);
  const legalField = context?.consumer?.legalName;
  if (names === null || !isObserved(legalField)) return [];
  const legalName = valueOf(legalField);
  if (!legalName || typeof legalName !== "object") return [];

  const legalLabel = [legalName.first, legalName.middle, legalName.last]
    .filter((p) => p != null && String(p).trim() !== "")
    .join(" ");

  return names
    .filter((n) => !sameName(n, legalName))
    .map((n) => {
      const label = [n?.first, n?.middle, n?.last].filter((p) => p != null && String(p).trim() !== "").join(" ");
      return violation({
        ruleId: "M2-032",
        scope: "report",
        subject: label,
        field: "33",
        observed: label,
        expected: legalLabel,
        reason:
          `The file reports the name "${label}". The consumer's legal name is "${legalLabel}". A name ` +
          `that is not the consumer's is how another person's records get attached to this file.`
      });
    });
}

function isoDay(year, month, day) {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * EVERY DAY THIS STRING COULD MEAN, as YYYY-MM-DD. Empty when it means nothing
 * this can read.
 *
 * COMPLIANCE REVIEW REQUIRED — dispute logic.
 *
 * "1985-03-02" means one day. "03/22/1985" means one day, because 22 is not a
 * month. "02/03/1985" means TWO days — 3 February and 2 March — and nothing in
 * a credit file or on a driving licence says which. Both are returned, and the
 * caller may only speak when no reading of one side matches any reading of the
 * other.
 *
 * WHY THIS IS NOT A DEFAULT TO US MONTH-FIRST ORDER. Until 2026-09-06 the
 * ambiguous case was resolved month-first by choice. MEASURED BY RUNNING THE
 * REAL FUNCTION: a file date of birth of "1985-03-02" against a consumer date of
 * birth of "02/03/1985" — the same day, 2 March 1985, written two ways — fired
 * M2-033, and M2-033 tells a credit bureau that a wrong date of birth is one of
 * the strongest signs somebody else's records have been merged into this file.
 * That is an accusation built out of a formatting difference and mailed in a real
 * person's name. Every other claim in this lane refuses on ambiguity; this one
 * refuses too.
 */
export function dobCandidates(value) {
  const raw = value == null ? "" : String(value).trim();
  if (raw === "") return [];
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/.exec(raw);
  if (iso) {
    const one = isoDay(iso[1], Number(iso[2]), Number(iso[3]));
    return one ? [one] : [];
  }
  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (!slash) return [];
  const a = Number(slash[1]);
  const b = Number(slash[2]);
  const year = slash[3];
  /* Month-first and day-first, de-duplicated. When only one of the two halves
     can be a month, isoDay drops the other reading and one candidate is left. */
  const out = [];
  for (const day of [isoDay(year, a, b), isoDay(year, b, a)]) {
    if (day && !out.includes(day)) out.push(day);
  }
  return out;
}

/**
 * A date of birth reduced to the ONE day it can only mean, or NULL.
 *
 * The two sides of check 33 come from different places and are written
 * differently: a bureau file carries "1985-03-02T00:00:00Z" or "1985-03-02",
 * while a verified identity read off a government ID carries whatever that
 * document printed — commonly "03/02/1985". Comparing those as raw strings
 * makes every consumer look like a mixed file and would mail a bureau the claim
 * that the consumer's own correct date of birth belongs to somebody else.
 *
 * A value this cannot read returns NULL, and so does a value that could be read
 * two ways. Null means unknown, and unknown may not be turned into a claim.
 */
export function dobKey(value) {
  const candidates = dobCandidates(value);
  return candidates.length === 1 ? candidates[0] : null;
}

/** Check 33 — DOB field. Date of birth mismatch. */
export function checkDateOfBirthMismatch(context) {
  const fileDob = str(context?.file?.dateOfBirth);
  const consumerDob = str(context?.consumer?.dateOfBirth);
  if (fileDob === null || consumerDob === null) return [];
  const fileDays = dobCandidates(fileDob);
  const consumerDays = dobCandidates(consumerDob);
  /* Either side unreadable is unknown, and unknown makes no claim. */
  if (fileDays.length === 0 || consumerDays.length === 0) return [];
  /* The claim is made ONLY when no reading of the file's date can be the same
     day as any reading of the consumer's. One shared reading is enough doubt to
     stay silent — the two sides may be the same day written two ways. A date
     that disagrees however it is read is a real mismatch and still fires. */
  if (fileDays.some((d) => consumerDays.includes(d))) return [];

  return [
    violation({
      ruleId: "M2-033",
      scope: "report",
      subject: fileDob,
      field: "dob",
      observed: fileDob,
      expected: consumerDob,
      reason:
        `The file reports a date of birth of ${fileDob}. The consumer's date of birth is ` +
        `${consumerDob}. A wrong date of birth is one of the strongest signs that records belonging ` +
        `to a different person have been merged into this file.`
    })
  ];
}

/** Check 34 — N1 Segment. Employment information out of date. */
export function checkOutdatedEmployment(context) {
  const employments = list(context?.file?.employments);
  const current = list(context?.consumer?.employers);
  if (employments === null || current === null) return [];

  const currentNames = current.map((e) => normalizeText(e?.name ?? e));
  return employments
    .filter((e) => {
      const name = normalizeText(e?.name);
      return name !== "" && !currentNames.includes(name);
    })
    .map((e) =>
      violation({
        ruleId: "M2-034",
        scope: "report",
        subject: e.name,
        field: "N1",
        observed: { employer: e.name, reportedOn: e.reportedOn ?? null },
        expected: current.map((c) => c?.name ?? c),
        reason:
          `The file reports employment with ${e.name}` +
          `${e.reportedOn ? `, last reported ${e.reportedOn}` : ""}. The consumer does not work there. ` +
          `Employment the consumer has left should not still be reported as current.`
      })
    );
}

/** § 5.6's four checks. These take the context alone — they describe the file. */
export const PERSONAL_INFO_CHECKS = Object.freeze([
  ["M2-031", checkStaleAddresses],
  ["M2-032", checkNameVariants],
  ["M2-033", checkDateOfBirthMismatch],
  ["M2-034", checkOutdatedEmployment]
]);
