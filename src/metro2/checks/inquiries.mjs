// § 5.7 — Inquiry checks. Rules M2-035 … M2-038.
//
// Like the personal-information checks these describe the FILE, not a tradeline,
// so they take (context) alone and run once per report.
//
// § 1681b lets a company pull a credit report only for a permissible purpose,
// and the list is short: the consumer applied, the consumer owes them money, or
// the consumer told them to. A hard inquiry with none of those behind it is an
// unauthorised pull, and § 5.8 puts inquiry challenges in the supporting tier —
// they help a letter, they do not carry one.
//
// ── WHAT A CREDIT REPORT CANNOT TELL US ───────────────────────────────────
//
// Whether the consumer applied, and whether they recognise the company, are
// facts only the consumer has. So `consumerAuthorized` and `consumerRecognizes`
// are provenance-wrapped per inquiry, and M2-035 and M2-037 stay silent without
// them. That silence is the design: "I do not recognise this company" is a
// consumer's statement, and the engine must never make it on their behalf.
//
// M2-036 and M2-038 need nothing but the inquiry list and the report date, so
// they work on a bare pull.

import { isObserved } from "../provenance.mjs";
import { violation, list, isFalse, normalizeText, opt } from "./violation.mjs";
import { addYears, compareIso } from "../dates.mjs";

/** A stable label for an inquiry, for the violation's `subject`. */
export function inquiryLabel(inquiry) {
  const creditor = inquiry?.creditor ?? "unnamed company";
  const date = inquiry?.inquiryDate ?? "unknown date";
  return `${creditor} (${date})`;
}

/** Only hard inquiries are in scope; a soft pull is not visible to lenders. */
function isHard(inquiry) {
  return isObserved(inquiry?.hard) ? inquiry.hard.value === true : false;
}

/** Check 35 — Hard inquiry with no permissible purpose under § 1681b. */
export function checkInquiryWithoutPermissiblePurpose(context) {
  const inquiries = list(context?.inquiries);
  const reportedCreditors = list(context?.reportedCreditors);
  if (inquiries === null || reportedCreditors === null) return [];

  const openedWith = reportedCreditors.map((c) => normalizeText(c));

  return inquiries
    .filter((inquiry) => {
      if (!isHard(inquiry)) return false;
      // § 5.7's trigger is the conjunction: no account opened AND no
      // application on file. Both arms are required.
      if (!isFalse(inquiry?.consumerAuthorized)) return false;
      const creditor = normalizeText(inquiry?.creditor);
      if (creditor === "") return false;
      return !openedWith.includes(creditor);
    })
    .map((inquiry) =>
      violation({
        ruleId: "M2-035",
        scope: "report",
        subject: inquiryLabel(inquiry),
        field: "inquiry",
        observed: { creditor: inquiry.creditor, inquiryDate: inquiry.inquiryDate ?? null },
        expected: "the inquiry removed",
        reason:
          `${inquiry.creditor} pulled the consumer's credit on ${inquiry.inquiryDate ?? "an unstated date"}. ` +
          `The consumer never applied to them and no account with them appears anywhere in this file, ` +
          `so there was no permissible purpose for the pull.`
      })
    );
}

/** Check 36 — Same-day duplicate inquiries from one application. */
export function checkDuplicateSameDayInquiries(context) {
  const inquiries = list(context?.inquiries);
  if (inquiries === null) return [];

  const seen = new Map();
  const found = [];
  for (const inquiry of inquiries) {
    const date = typeof inquiry?.inquiryDate === "string" ? inquiry.inquiryDate : null;
    const creditor = normalizeText(inquiry?.creditor);
    if (date === null || creditor === "") continue;
    const key = `${normalizeText(inquiry?.bureau)}|${creditor}|${date}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    // The first pull of the day is the legitimate one; every further pull from
    // the same company on the same day is the duplicate.
    if (count === 1) continue;
    found.push(
      violation({
        ruleId: "M2-036",
        scope: "report",
        subject: inquiryLabel(inquiry),
        field: "inquiry",
        observed: { creditor: inquiry.creditor, inquiryDate: date, occurrence: count },
        expected: "one inquiry per application",
        reason:
          `${inquiry.creditor} appears ${count} times on ${date}` +
          `${inquiry.bureau ? ` at ${inquiry.bureau}` : ""}. One application produced more than one ` +
          `entry, so the extra entries overstate how many times the consumer sought credit.`
      })
    );
  }
  return found;
}

/** Check 37 — Inquiry from an entity the consumer does not recognise. */
export function checkUnrecognisedInquiry(context) {
  const inquiries = list(context?.inquiries);
  if (inquiries === null) return [];

  return inquiries
    .filter((inquiry) => isFalse(inquiry?.consumerRecognizes))
    .map((inquiry) =>
      violation({
        ruleId: "M2-037",
        scope: "report",
        subject: inquiryLabel(inquiry),
        field: "inquiry",
        observed: { creditor: inquiry.creditor, inquiryDate: inquiry.inquiryDate ?? null },
        expected: "the inquiry removed, or the permissible purpose evidenced",
        reason:
          `The consumer does not recognise ${inquiry.creditor}, which pulled their credit on ` +
          `${inquiry.inquiryDate ?? "an unstated date"}. A pull by a company the consumer has never ` +
          `dealt with needs a permissible purpose the consumer knows nothing about, and can be a sign ` +
          `someone used their identity.`
      })
    );
}

/** Check 38 — Hard inquiry older than the permitted window. */
export function checkInquiryTooOld(context) {
  const inquiries = list(context?.inquiries);
  const asOf = typeof context?.asOf === "string" ? context.asOf : null;
  if (inquiries === null || asOf === null) return [];

  const years = opt(context, "inquiryMaxAgeYears");
  return inquiries
    .filter((inquiry) => {
      if (!isHard(inquiry)) return false;
      const date = typeof inquiry?.inquiryDate === "string" ? inquiry.inquiryDate : null;
      if (date === null) return false;
      const expiry = addYears(date, years);
      return expiry !== null && compareIso(expiry, asOf) === -1;
    })
    .map((inquiry) =>
      violation({
        ruleId: "M2-038",
        scope: "report",
        subject: inquiryLabel(inquiry),
        field: "inquiry",
        observed: { creditor: inquiry.creditor, inquiryDate: inquiry.inquiryDate },
        expected: `no hard inquiry older than ${years} years as of ${asOf}`,
        reason:
          `${inquiry.creditor} pulled the consumer's credit on ${inquiry.inquiryDate}, more than ` +
          `${years} years before this report. Hard inquiries come off the file after ${years} years ` +
          `and this one should already be gone.`
      })
    );
}

/** § 5.7's four checks. These take the context alone — they describe the file. */
export const INQUIRY_CHECKS = Object.freeze([
  ["M2-035", checkInquiryWithoutPermissiblePurpose],
  ["M2-036", checkDuplicateSameDayInquiries],
  ["M2-037", checkUnrecognisedInquiry],
  ["M2-038", checkInquiryTooOld]
]);
