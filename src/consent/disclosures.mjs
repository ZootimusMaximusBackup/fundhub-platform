// The words a consumer is shown before they consent — held on the SERVER.
//
// *** OWNER-SET: wording approved as written — Chris, 2026-07-31. ***
// `soft-pull-v1` below is the approved text. Settled.
//
// THAT APPROVAL IS FOR THIS EXACT STRING AND NO OTHER. It does not extend to a
// future edit of it, and there must never be one — see WHY VERSIONS ARE
// APPEND-ONLY below. New wording is a NEW version key and needs its own
// approval before it is used. Changing an approved string in place would mean
// people are recorded as having agreed to an approved paragraph while having
// been shown an unapproved one.
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

/* Every version ever shown for dispute-letter authorization. Add to this map;
   never edit an entry. Owner-set 2026-08-15 (W2a). No credit-outcome promises. */
export const DISPUTE_AUTH_DISCLOSURES = Object.freeze({
  "dispute-auth-v1": Object.freeze({
    version: "dispute-auth-v1",
    title: "Dispute letter authorization",
    text: [
      "I authorize Fundhub to prepare credit dispute letters and complaint drafts from my credit file for my review.",
      "",
      "Letters and complaints are not mailed or filed until I send or file them, or until staff I authorize send or file them.",
      "",
      "I must sign CFPB and state AG complaints myself before filing.",
      "",
      "I may withdraw this authorization at any time.",
      "",
      "Withdrawing this authorization does not undo letters already prepared.",
      "",
      "This authorization makes no promise about deletions, scores, funding, or legal outcomes."
    ].join("\n")
  })
});

/** The version new dispute-authorization captures default to. */
export const CURRENT_DISPUTE_AUTH_VERSION = "dispute-auth-v1";

/* CALL RECORDING. Added 2026-09-05 with the CSM role (db/migrations/290).
   Append-only like the rest of this file: new wording is a NEW version key.

   DELIBERATELY NARROW. This permits recording and nothing else. It does not
   permit advertising — that is marketing_use below, a separate consent a
   client can refuse while still agreeing to be recorded. Collapsing the two
   would make the second one unaskable, which is the whole reason 291 added
   two kinds instead of one. */
export const CALL_RECORDING_DISCLOSURES = Object.freeze({
  "call-recording-v1": Object.freeze({
    version: "call-recording-v1",
    title: "Permission to record this call",
    text: [
      "I agree that Fundhub may record this call, including my voice and what I say on it.",
      "",
      "Fundhub uses the recording to keep an accurate record of the conversation and to improve how it serves clients.",
      "",
      "This permission is only about recording. It does not allow Fundhub to use the recording, my voice, or my likeness in advertising or marketing. That is a separate permission I would be asked for on its own.",
      "",
      "I may tell Fundhub to stop recording at any time, and I may withdraw this permission at any time, for any reason, without giving a reason.",
      "",
      "I understand that withdrawing it does not erase a recording already made."
    ].join("\n")
  })
});

/** The version new call-recording captures default to. */
export const CURRENT_CALL_RECORDING_VERSION = "call-recording-v1";

/* MARKETING USE. Added 2026-09-05 with the CSM role.

   This is the one that lets a clip become an ad, and it is the one a client is
   most likely to refuse, so it is asked separately and plainly.

   NO CLAIM ABOUT OUTCOMES anywhere in it (CLAUDE.md §7), and no suggestion
   that agreeing affects the service they receive. It also states the payment
   position rather than leaving it unsaid, because a right-of-publicity release
   that is silent on compensation is the one people dispute later. */
export const MARKETING_USE_DISCLOSURES = Object.freeze({
  "marketing-use-v1": Object.freeze({
    version: "marketing-use-v1",
    title: "Permission to use what I said in advertising",
    text: [
      "I allow Fundhub to use my name, my voice, my picture, and what I said in this conversation in its advertising and marketing.",
      "",
      "This includes paid ads, its website, social media, and material shown to other people who are considering Fundhub.",
      "",
      "I understand people who see it may recognise me.",
      "",
      "I will not be paid for this unless Fundhub and I agree otherwise in writing.",
      "",
      "Saying no changes nothing about the service I receive, and I may say no now or withdraw this permission later, at any time, for any reason, without giving a reason.",
      "",
      "I understand that withdrawing it stops Fundhub using my words in anything new, but does not pull back material already published or already running."
    ].join("\n")
  })
});

/** The version new marketing-use captures default to. */
export const CURRENT_MARKETING_USE_VERSION = "marketing-use-v1";

/** Which disclosure applies to which consent kind. The map exists so a second
 *  kind cannot quietly reuse the first one's words. */
const BY_KIND = Object.freeze({
  call_recording: Object.freeze({
    versions: CALL_RECORDING_DISCLOSURES,
    current: CURRENT_CALL_RECORDING_VERSION
  }),
  marketing_use: Object.freeze({
    versions: MARKETING_USE_DISCLOSURES,
    current: CURRENT_MARKETING_USE_VERSION
  }),
  soft_pull_consent: Object.freeze({
    versions: SOFT_PULL_DISCLOSURES,
    current: CURRENT_SOFT_PULL_VERSION
  }),
  dispute_authorization: Object.freeze({
    versions: DISPUTE_AUTH_DISCLOSURES,
    current: CURRENT_DISPUTE_AUTH_VERSION
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
