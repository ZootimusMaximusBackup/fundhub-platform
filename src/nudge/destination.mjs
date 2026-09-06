// Where a nudge actually lands, as one comparable string.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Client-facing messaging cadence on
// a consumer-finance file. NOTHING IN THIS FILE SENDS ANYTHING: it has no
// database, no provider and no network. It is two pure functions over a string.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS
//
// The one-message-a-day cap in db/migrations/365 counts RECORDS: UNIQUE
// (client_id, client_local_date). A person with two client rows on the same
// phone is two records, so they got two texts in a day and both caps reported
// themselves satisfied. Measured on a scratch database on 2026-09-06: two
// client rows, '+15550004000' and '+1 (555) 000-4000', one overdue checklist
// item each, one pass, two outbound messages.
//
// db/migrations/369 adds a second cap keyed on the destination. This file
// produces the key, and its whole job is to make two spellings of one phone
// number collide.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT NORMALISATION DOES AND DOES NOT CLAIM
//
// It is deliberately blunt, because the cost of the two mistakes is not
// symmetrical:
//
//   two spellings that SHOULD collide and do not  → a person gets two messages
//                                                   in a day. This is the bug.
//   two numbers that should NOT collide and do    → one of two people does not
//                                                   get chased today. They are
//                                                   still overdue tomorrow.
//
// So it errs toward collapsing. It is NOT a phone number parser and it does not
// pretend to be one: there is no libphonenumber in this repo, no new dependency
// was added for this, and nothing here knows what a valid number is in any
// country.
//
// THE ONE COUNTRY RULE IT DOES APPLY, AND ITS LIMIT. An 11-digit string
// beginning '1' has that '1' removed, so '+1 555 000 4000' and '5550004000'
// are one key. That is the North American Numbering Plan and it is the only
// place this platform sends today. A UK number written '+44 20 7946 0000'
// (12 digits) and the same number written '020 7946 0000' (11 digits, leading
// '0') will NOT collide — the second is not an NANP number and the '0' is not
// stripped. That is a known gap, written down rather than guessed at, and it
// fails in the safe direction: an extra message is possible for a non-US number
// entered two ways, never a missed stop.
//
// SHORT STRINGS ARE UNKNOWN, NOT EMPTY. Fewer than ten digits is not a phone
// number we can compare, so the key is null and 369's partial index skips the
// row — the client-row cap still applies. NULL means unknown (CLAUDE.md §12);
// it is never '' and never a placeholder.

/** How many digits a string needs before it is treated as a comparable phone
    number. The same floor contactFor() in ./exits.mjs uses to decide an SMS
    address is usable at all, so the two cannot disagree about what a number is. */
export const MIN_PHONE_DIGITS = 10;

/**
 * destinationKey(channel, address) → a comparable string, or null.
 *
 * NULL means "we cannot compare this", and a null key joins no cap. It is never
 * an empty string: 369's CHECK refuses a blank one so that nothing downstream
 * can read whitespace as an address.
 */
export function destinationKey(channel, address) {
  if (address == null) return null;
  const raw = String(address).trim();
  if (raw === "") return null;

  if (channel === "sms") {
    let digits = raw.replace(/\D+/g, "");
    /* NANP country code. See the header for the limit of this rule. */
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    return digits.length >= MIN_PHONE_DIGITS ? digits : null;
  }

  if (channel === "email") {
    /* Lowercased whole, including the local part. RFC 5321 says the local part
       MAY be case sensitive, and in practice no mail host this platform sends
       to treats it that way. Collapsing is the safe direction here for the same
       reason it is above: the worst case is one person not chased today. */
    const email = raw.toLowerCase();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
  }

  /* An unknown channel has no destination we can name. Not a guess, not a
     fallback to the raw string — null, meaning unknown. */
  return null;
}

/** sameDestination(channel, a, b) → true only when both normalise to the same
    non-null key. Two unknowns are NOT the same destination; unknown is unknown.
    Exported for the tests, and for any later reader who wants the comparison
    rather than the key. */
export function sameDestination(channel, a, b) {
  const ka = destinationKey(channel, a);
  const kb = destinationKey(channel, b);
  return ka !== null && ka === kb;
}

export default { destinationKey, sameDestination, MIN_PHONE_DIGITS };
