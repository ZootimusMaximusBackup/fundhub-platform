// The words a consumer is shown before they consent — held on the SERVER.
//
// *** THE WORDING BELOW IS DRAFT AND HAS NOT BEEN REVIEWED BY COUNSEL. ***
// It is written to be factual and to promise nothing, but it is a
// customer-facing authorization statement in a regulated consumer-finance
// product and it ships only after a lawyer has signed it off. CLAUDE.md §7
// flags consent capture as COMPLIANCE REVIEW REQUIRED and this file is the part
// a reviewer should read first. Changing these words is a compliance decision,
// not a copy edit — see WHY VERSIONS ARE APPEND-ONLY below.
//
//
// WHY THE TEXT IS NOT ACCEPTED FROM THE REQUEST BODY.
//
// The obvious shape is: the screen shows a paragraph, the person agrees, and
// the screen POSTs the paragraph back to be stored. That shape is worthless as
// evidence. A body field is written by the caller, so anybody who can reach the
// endpoint can record that a consumer agreed to any sentence they like —
// including one the consumer never saw and would never have accepted.
//
// So: the server owns the words. The screen asks for them (GET), renders
// exactly what it was given, and POSTs back only the VERSION it displayed. The
// row stores the server's own copy of that version's text. The one thing a
// caller can influence is which version they were shown, and an unknown version
// is refused rather than guessed at.
//
// This is the same reasoning that puts attribution in the session rather than
// the body in api/finance/soft-pull.mjs: a caller choosing its own attribution
// is a caller with no attribution, and a caller choosing its own consent text is
// a caller with no consent.
//
//
// WHY VERSIONS ARE APPEND-ONLY.
//
// Editing the string for an existing version silently rewrites what every
// person who consented under it is recorded as having agreed to — thousands of
// rows changed by a one-line diff that reads like a typo fix. 099 defends
// against this by copying the words into each row at capture time, so an edit
// here cannot reach rows already written. That defence only works if this file
// is also treated as append-only: a new wording is a NEW version key, always.
//
// The row keeps its own copy regardless. This map is what NEW captures use.

/* Every version ever shown, keyed by the string stored in
   client_consents.consent_version. Add to this map; never edit an entry. */
export const SOFT_PULL_DISCLOSURES = Object.freeze({
  "soft-pull-v1": Object.freeze({
    version: "soft-pull-v1",
    title: "Soft Pull Authorization",
    // No claim about what the pull will find, what it will change, or what
    // funding it may lead to. It says what we will do and what it costs the
    // person — nothing else. Any sentence about credit OUTCOMES belongs
    // nowhere near a consent form, and CLAUDE.md §7 forbids drafting one.
    text: [
      "I authorize Fundhub to obtain my consumer credit report through a soft inquiry.",
      "",
      "A soft inquiry does not affect my credit score and is not visible to lenders reviewing my file.",
      "",
      "I understand this authorization stays in effect until it expires or until I withdraw it, and that I may withdraw it at any time, for any reason, without giving a reason.",
      "",
      "I understand that withdrawing it does not undo a report already obtained, and does not affect anything already done with a report obtained while this authorization was in effect."
    ].join("\n")
  })
});

/** The version new captures default to when the caller names none. */
export const CURRENT_SOFT_PULL_VERSION = "soft-pull-v1";

/** Which disclosure applies to which consent kind. One kind today; the map
 *  exists so a second kind cannot quietly reuse the first one's words. */
const BY_KIND = Object.freeze({
  soft_pull_consent: Object.freeze({
    versions: SOFT_PULL_DISCLOSURES,
    current: CURRENT_SOFT_PULL_VERSION
  })
});

/**
 * disclosureFor — the words to show, and to store.
 *
 * Returns { version, title, text } or null. A null is a refusal, not a default:
 * the caller must not fall back to some other wording, because the wording IS
 * the consent. An unknown version returns null rather than the current one —
 * silently upgrading somebody to a paragraph they did not read is exactly the
 * substitution this file exists to prevent.
 */
export function disclosureFor(kind, version = null) {
  const entry = BY_KIND[kind];
  if (!entry) return null;
  const key = version === null || version === undefined || version === ""
    ? entry.current
    : String(version).trim();
  return entry.versions[key] ?? null;
}

/** Every version on file for a kind, newest-first by insertion order reversed.
 *  Used by the screen only to show which wording is current. */
export function versionsFor(kind) {
  const entry = BY_KIND[kind];
  return entry ? Object.keys(entry.versions) : [];
}
