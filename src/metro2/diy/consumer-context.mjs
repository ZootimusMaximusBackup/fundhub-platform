// Turn a VERIFIED identity into the consumer side of the engine context.
//
// COMPLIANCE REVIEW REQUIRED — dispute logic.
//
// ── THE HOLE THIS FILLS ───────────────────────────────────────────────────
// ../checks/personal-info.mjs holds four file-level rules. Three of them —
// M2-032 name variants, M2-033 date of birth, M2-034 employment — compare the
// bureau's file against WHAT THE CONSUMER SAYS IS TRUE, and read that side out
// of `context.consumer`. ../normalize.mjs sets every field of `context.consumer`
// to notVisible() because nothing in a credit report carries it, and the only
// production caller (./from-crs.mjs) never overrode it. So on origin/main those
// three rules could not fire at all, ever, and the single personal-information
// rule that ran was M2-031 — delete addresses older than two reporting cycles.
//
// That is age-based cleanup. The product sells identity-based cleanup: the name
// and the address read off the client's own uploaded ID and proof of address
// stay, and every other name and address on the report is disputed off.
//
// ── WHERE THE CONSUMER SIDE IS ALLOWED TO COME FROM ───────────────────────
// The verified identity ONLY — src/identity/, built from the government ID and
// the proof of address the client uploaded, after an agent has read both images
// and confirmed the two addresses match.
//
// NOT clients.first_name / clients.last_name. NOT pii_identity.addresses[0].
// NOT the letterhead return address, which is allowed to fall back to the
// client's business address. A CRM field is what somebody typed; it is not
// evidence, and a dispute letter mailed in a real person's name may not assert a
// name or an address on the strength of a typed field.
//
// So: no verified identity → this module returns {} → `context.consumer` stays
// notVisible() → the three rules stay dark, exactly as they are today. Unknown
// stays unknown. It is never filled in from a neighbouring field.
//
// PURE. No clock, no network, no database.

import { observed } from "../provenance.mjs";

/* Generational and professional suffixes. Kept out of the surname so that
   "JOHN SMITH JR" and "JOHN SMITH" are read as the same surname — ../checks/
   personal-info.mjs sameName() compares first and last only. */
const SUFFIXES = new Set(["JR", "SR", "I", "II", "III", "IV", "V", "MD", "DDS", "PHD", "ESQ", "DO"]);

function clean(value) {
  return value == null ? "" : String(value).trim();
}

/* Case is PRESERVED. The parts end up printed verbatim in a mailed letter —
   ../checks/personal-info.mjs writes "The consumer's legal name is ..." — and
   shouting the consumer's own name back at a credit bureau reads as machine
   output. Matching is case-insensitive anyway (sameName normalises both sides),
   so nothing is lost by keeping what the document said. */
function tokens(value) {
  return clean(value)
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function isSuffix(token) {
  return SUFFIXES.has(String(token).toUpperCase());
}

/**
 * "Sim M Repair" → { first: "Sim", middle: "M", last: "Repair" }.
 *
 * Returns NULL — not a guess — when the value cannot yield both a first and a
 * last name. A single token ("Madonna", or a first name with the surname
 * missing) is not enough to say what the consumer's legal name is, and a rule
 * that fired off half a name would ask a bureau to delete the other half.
 *
 * An object that already carries first/last is passed through, because
 * src/identity/ may hand back structured parts rather than one string.
 */
export function splitLegalName(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const first = clean(value.first ?? value.firstName ?? value.given);
    const last = clean(value.last ?? value.lastName ?? value.surname ?? value.family);
    if (!first || !last) return null;
    return { first, middle: clean(value.middle ?? value.middleName) || null, last };
  }

  const raw = clean(value);
  if (!raw) return null;

  /* "Repair, Sim M" — the surname-first form a scanned document often carries. */
  const comma = raw.split(",");
  let parts;
  if (comma.length === 2 && clean(comma[0]) && clean(comma[1])
      && !isSuffix(clean(comma[1]))) {
    parts = [...tokens(comma[1]), ...tokens(comma[0])];
  } else {
    parts = tokens(raw);
  }

  while (parts.length && isSuffix(parts[parts.length - 1])) parts.pop();
  if (parts.length < 2) return null;

  return {
    first: parts[0],
    middle: parts.length > 2 ? parts.slice(1, -1).join(" ") : null,
    last: parts[parts.length - 1]
  };
}

/**
 * The consumer half of the engine context, provenance-wrapped.
 *
 * Every field is included ONLY when the verified identity actually carries it.
 * A field left out stays notVisible() after ../normalize.mjs merges this over
 * the derived context, and a rule with a notVisible consumer side returns no
 * violation — which is the right answer when we do not know.
 *
 * @param {{legalName?, dateOfBirth?, employers?}|null} verified
 * @returns {{consumer?: object}} suitable as normalizeFromCrs's consumerContext
 */
export function consumerContextFrom(verified) {
  if (!verified || typeof verified !== "object") return {};

  const consumer = {};

  const legal = splitLegalName(verified.legalName ?? verified.name ?? null);
  if (legal) consumer.legalName = observed(legal);

  const dob = clean(verified.dateOfBirth ?? verified.dob);
  if (dob) consumer.dateOfBirth = observed(dob);

  /* Nothing in the product supplies a verified employer today, so this is
     plumbing rather than a live input — M2-034 stays dark until something does.
     It is wired anyway because leaving the one field out is how the next person
     concludes the rule is unreachable and writes a second copy of it. */
  const employers = Array.isArray(verified.employers)
    ? verified.employers.map((e) => (typeof e === "string" ? { name: e } : e)).filter(Boolean)
    : null;
  if (employers && employers.length) consumer.employers = observed(employers);

  return Object.keys(consumer).length ? { consumer } : {};
}
