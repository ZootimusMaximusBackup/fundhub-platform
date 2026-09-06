// Mail suppression — the gate that decides a record may NOT be mailed.
//
// *** NOTHING HERE MAILS, AND NOTHING HERE CAN BE MADE TO. ***
// There is no send function, no scheduler, no drop path and no activation flag
// in this module, this directory, or this repo. assertDroppable() below is the
// function a future drop path MUST call before it does anything; calling it
// does not mail, it only refuses. See src/mail/README.md for the three FCRA
// gate conditions (research report, Deluxe compliance review, legal sign-off on
// lender-of-record) and db/migrations/065_mail_campaigns.sql for why the schema
// has no `enabled` boolean anywhere near mail.
//
//
// WHY THIS FILE IS THE COMPLIANCE-CRITICAL ONE. The plan's wording is
// "suppression is enforced BEFORE every drop, in code, at the same gate as
// compliance checks". Mail is the one channel with no recall: an SMS sent to
// someone who said STOP is a violation you can at least stop repeating within
// the minute; a hundred thousand envelopes are in a truck. So every decision
// below is biased the same way.
//
//
// *** FAIL CLOSED. THIS IS THE WHOLE DESIGN. ***
// An unknown record, a database error, a record we cannot identify, a campaign
// with no row behind it, a bad argument — every one of them returns SUPPRESSED
// or throws. There is no path through this file where a failure reads as
// "clear to mail". The asymmetry is the point:
//
//   false positive (we suppress someone we could have mailed) = one lost lead
//   false negative (we mail someone we should have suppressed) = an FCRA problem
//
// Concretely, `catch` blocks in this file do NOT re-raise and do NOT return a
// neutral answer; they return { suppressed: true, reason: "check_failed" }.
// A caught error means we do not know, and "we do not know" must never be
// spelled the same way as "yes".
//
//
// WHAT IS SUPPRESSED, AND WHERE EACH RULE'S SOURCE ACTUALLY LIVES.
//
//   existing_client  — the record matches a row in `clients` for this org. The
//                      match keys are email and phone, because those are the
//                      only identity columns `clients` has that a mail file
//                      could also carry (001_init.sql:47-56: ghl_contact_id,
//                      client_master_key, first_name, last_name, email, phone).
//                      *** THERE IS NO ADDRESS MATCH AND THAT IS A REPORTED GAP,
//                      NOT AN OVERSIGHT. *** `clients` has no address columns at
//                      all; the only addresses in the schema are
//                      pii_identity.addresses, a free-form jsonb array whose
//                      shape nothing in this repo defines or writes structurally
//                      (src/pii/index.mjs stores whatever array it is handed).
//                      A prescreen file is name-and-address data, so this is the
//                      match key the rule most wants and the one the schema
//                      cannot supply. Guessing an address-comparison rule
//                      against an undefined jsonb shape would be exactly the
//                      invented-value failure HANDOFF.md prohibits. Name-only
//                      matching is deliberately NOT done either: it would
//                      suppress every John Smith in the file.
//
//   opt_out          — the matched client has a live row in `opt_outs`. That
//                      table is the authoritative opt-out store (008_opt_out.sql:
//                      "dnd_sms on clients is a CRM mirror field; this table is
//                      the authoritative opt-out record"), it is what
//                      src/handlers/comms.mjs writes on a TCPA STOP keyword, and
//                      it is read here through the same sanctioned helper —
//                      isOptedOut() from src/lib/opt-out.mjs — rather than with
//                      a second hand-rolled query. No second opt-out store is
//                      created here and clients.dnd_* is not consulted, because
//                      it is a mirror and because anything it could tell us is
//                      already true of an existing client.
//
//   prior_responder  — `mail_universe.responded_at IS NOT NULL`, per the list
//                      reuse terms. Checked on the record itself AND across the
//                      org's other mail_universe rows by identity, since the
//                      point of the rule is that a responder to LAST drop is not
//                      re-mailed on the next reuse of the list.
//
//   unidentifiable   — no usable identity value could be read off the record, so
//                      NONE of the three rules above could be evaluated. This is
//                      the fail-closed default and it is the one that will bite:
//                      see "THE UNIDENTIFIABLE PROBLEM" below.
//
//   check_failed     — the check itself errored. Suppressed, and persisted as
//                      suppressed, because a row left unsuppressed is a row a
//                      bulk export hands to a printer.
//
//
// THE UNIDENTIFIABLE PROBLEM, STATED PLAINLY SO NOBODY IS SURPRISED BY IT.
// A prescreen mail file is typically name + address, with an email or phone only
// sometimes. Every record with neither is suppressed as `unidentifiable`,
// because we cannot prove they are not already a client and cannot prove they
// did not opt out. On a real vendor file that may suppress most of the universe.
//
// THAT IS THE CORRECT ANSWER FOR TODAY, not a bug to tune away. It is an honest
// statement that this codebase cannot currently clear those records, and it is
// loud rather than silent. The fix is an address match key — which needs a real
// Deluxe file layout and a defined address shape on `clients`, neither of which
// exists in this repo — NOT a relaxation of the default. Nothing mails today, so
// the practical cost of the strict default is zero and the cost of the lax one
// would only ever be discovered afterwards.
//
//
// HOW A RECORD'S IDENTITY IS READ, AND WHY BY VALUE RATHER THAN BY COLUMN NAME.
// mail_universe.fields is jsonb keyed by THE VENDOR'S OWN COLUMN HEADERS —
// src/mail/ingest.mjs keeps them verbatim and says so ("THERE IS NO DELUXE FILE
// LAYOUT IN THIS REPO"). So there is no column called `email` to read. Rather
// than guess a list of header names, this module recognises identity by the
// SHAPE OF THE VALUE: a value that is an email address is an email, a value
// that is a phone number and nothing else is a phone. That guesses nothing about
// a vendor we have no spec for, and it errs toward finding MORE match keys,
// which errs toward more suppression.

import { isOptedOut } from "../lib/opt-out.mjs";

/* ------------------------------------------------------------------------- *
 * The closed vocabulary
 * ------------------------------------------------------------------------- */

/**
 * SUPPRESSION_REASONS — the closed vocabulary for
 * `mail_universe.suppression_reason`, which is free text in the schema.
 *
 * WHY IT IS CONSTRAINED HERE AND NOT WITH A DATABASE CHECK. The column already
 * exists (001_init.sql:355) and may already hold values written by a human or
 * by a thread that is not this one. A CHECK constraint added now would either
 * fail to apply against existing rows or start rejecting other people's writes,
 * and migration 066 deliberately does not add one (see its header). So the
 * vocabulary is enforced at the only place that can enforce it safely: the
 * single writer, applySuppression(), below.
 *
 * Readers must therefore tolerate out-of-vocabulary text. isSuppressionReason()
 * is how you tell the difference; nothing in this file treats an unrecognised
 * reason as "not really suppressed".
 */
export const SUPPRESSION_REASONS = Object.freeze({
  EXISTING_CLIENT: "existing_client",
  OPT_OUT: "opt_out",
  PRIOR_RESPONDER: "prior_responder",
  UNIDENTIFIABLE: "unidentifiable",
  CHECK_FAILED: "check_failed"
});

export const SUPPRESSION_REASON_VALUES = Object.freeze(Object.values(SUPPRESSION_REASONS));

export function isSuppressionReason(value) {
  return typeof value === "string" && SUPPRESSION_REASON_VALUES.includes(value);
}

/**
 * DROP_BLOCK_REASONS — reasons assertDroppable refuses that are NOT per-record
 * suppression and must never be written to suppression_reason.
 *
 *   unknown_record        — no such row. A drop path holding an id we cannot
 *                           resolve is holding a bug, and a bug is not permission.
 *   campaign_not_approved — the record's campaign is not `approved`. That status
 *                           means all three gate conditions were signed off by a
 *                           human, by hand (065_mail_campaigns.sql). A record
 *                           with no campaign row behind it at all lands here too.
 *   suppressed            — the row is flagged suppressed with no reason stored.
 */
export const DROP_BLOCK_REASONS = Object.freeze({
  UNKNOWN_RECORD: "unknown_record",
  CAMPAIGN_NOT_APPROVED: "campaign_not_approved",
  SUPPRESSED: "suppressed"
});

/**
 * Thrown by assertDroppable. `.reason` is a stable snake_case string from
 * SUPPRESSION_REASONS or DROP_BLOCK_REASONS (or whatever free text a previous
 * writer stored). `.status` is 409 because "this record is not in a state that
 * permits a drop" is a conflict, not a validation error — there is no route
 * serving this today and none is proposed.
 *
 * NO PII IN THE MESSAGE. Same discipline as ingest.mjs's rowErrorReason: the
 * values in this table are consumers' names, addresses and phone numbers, and
 * an error string ends up in a log.
 */
export class NotDroppableError extends Error {
  constructor(reason, message) {
    super(message || `record is not droppable: ${reason}`);
    this.name = "NotDroppableError";
    this.reason = reason;
    this.status = 409;
  }
}

/* ------------------------------------------------------------------------- *
 * Identity extraction (pure)
 * ------------------------------------------------------------------------- */

/**
 * An email, recognised by shape. Requires a dot in the domain so that a value
 * like "n/a@none" is not mistaken for a contactable address and does not count
 * toward making a record identifiable.
 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * A value that is a phone number AND NOTHING ELSE: digits plus the punctuation
 * a phone is written with. The "and nothing else" is load-bearing — without it,
 * "123 Main Street Apt 4567890" strips to ten digits and becomes a phone
 * number, which would make an address-only record look identifiable and let it
 * through as clear to mail. Letters anywhere disqualify the value.
 */
const PHONE_SHAPE_RE = /^[+()\-.\s]*\d[\d+()\-.\s]*$/;

const digitsOf = (s) => s.replace(/\D+/g, "");

/**
 * Phone candidates for one value: 10 digits (NANP national), or 11 beginning
 * with 1 (NANP with country code). Both forms are emitted for either input,
 * because `clients.phone` is raw text with no normalisation anywhere in this
 * repo and may hold "+15551234567" or "(555) 123-4567" for the same person.
 * Emitting both is a comparison-time widening, not a rewrite of stored data.
 *
 * Anything shorter is refused: a 7-digit local number cannot be matched
 * reliably across area codes, and a 5-digit zip must never be read as a phone.
 * Anything longer is refused too — this repo states no international dialling
 * convention anywhere, and inventing one to parse a 13-digit string would be
 * guessing at a country the file never named (ingest.mjs makes the same call:
 * "NOT E.164: prefixing a country code onto a 10-digit number is assuming a
 * country the file never stated").
 */
// EXPORTED since 2026-08-18 (T5-07), previously module-private. The inbound-SMS
// client lookup in src/handlers/comms.mjs has exactly this problem — Twilio
// always sends E.164, clients.phone is raw text, and two live records are not
// E.164 — so a client's STOP resolved to nobody. A second copy of this rule
// would be two things that must stay in step forever. One function, two callers.
export function phoneCandidates(value) {
  if (!PHONE_SHAPE_RE.test(value)) return [];
  const d = digitsOf(value);
  if (d.length === 10) return [d, `1${d}`];
  if (d.length === 11 && d.startsWith("1")) return [d, d.slice(1)];
  return [];
}

/**
 * recordIdentity(record) -> { emails: string[], phones: string[], usable: boolean }
 *
 * PURE. No database, no mutation of the input.
 *
 * Reads `record.fields` when it is a plain object (every mail_universe row has
 * one — jsonb NOT NULL DEFAULT '{}'), otherwise treats the record itself as the
 * bag of vendor values. One level deep and strings/finite numbers only, because
 * that is exactly what ingest.mjs writes.
 *
 * `usable` is false when nothing identity-shaped was found — which is what makes
 * a record `unidentifiable` and therefore suppressed.
 */
export function recordIdentity(record) {
  const empty = { emails: [], phones: [], usable: false };
  if (!record || typeof record !== "object" || Array.isArray(record)) return empty;

  const source =
    record.fields && typeof record.fields === "object" && !Array.isArray(record.fields)
      ? record.fields
      : record;

  const emails = new Set();
  const phones = new Set();

  for (const key of Object.keys(source)) {
    const raw = source[key];
    let text;
    if (typeof raw === "string") text = raw.trim();
    else if (typeof raw === "number" && Number.isFinite(raw)) text = String(raw);
    else continue;
    if (text === "") continue;

    if (EMAIL_RE.test(text)) { emails.add(text.toLowerCase()); continue; }
    for (const p of phoneCandidates(text)) phones.add(p);
  }

  return {
    emails: [...emails],
    phones: [...phones],
    usable: emails.size > 0 || phones.size > 0
  };
}

/* ------------------------------------------------------------------------- *
 * checkSuppression
 * ------------------------------------------------------------------------- */

/** The channels `opt_outs.channel` is documented to hold (008_opt_out.sql:11).
 *  THERE IS NO 'mail' CHANNEL, and none is invented here — see the note in
 *  hasActiveOptOut. */
const OPT_OUT_CHANNELS = ["sms", "email", "voice"];

const suppressed = (reason) => ({ suppressed: true, reason });
const clear = () => ({ suppressed: false, reason: null });

/**
 * checkSuppression(db, { orgId, record }) -> { suppressed, reason|null }
 *
 * Decides, live, whether one record may be mailed. Does not write anything.
 *
 * ORDER OF THE RULES, WHICH DETERMINES WHICH REASON GETS REPORTED WHEN SEVERAL
 * APPLY. Cheapest and most specific first:
 *
 *   1. already flagged suppressed  — a decision someone already made stands, and
 *                                    its stored reason is returned verbatim even
 *                                    if it is out-of-vocabulary free text.
 *   2. this record already responded — a fact on the row, no query needed.
 *   3. no usable identity          — nothing further CAN be evaluated.
 *   4. matches a client            — then `opt_out` if that client has a live
 *                                    opt-out, else `existing_client`. Opt-out is
 *                                    the more specific reading of the same row.
 *   5. matches a prior responder elsewhere in the org.
 *   6. clear.
 *
 * NOTE THAT AN OPT-OUT CAN ONLY EVER BE FOUND FOR AN EXISTING CLIENT, because
 * opt_outs.client_id is a NOT NULL foreign key to clients(id). A stranger on a
 * mail list who has asked not to be contacted has NOWHERE in this schema to be
 * recorded. That is a real gap and it is reported rather than papered over with
 * a second opt-out store built here.
 *
 * EVERY FAILURE PATH RETURNS SUPPRESSED. Missing db, missing orgId, a record
 * that is not an object, a thrown query — all `check_failed`. None of them
 * throw, because a caller that wraps this in a try/catch and treats the catch as
 * "no suppression found" is the exact accident this is written to prevent.
 */
export async function checkSuppression(db, { orgId, record } = {}) {
  if (!db || typeof db.query !== "function") return suppressed(SUPPRESSION_REASONS.CHECK_FAILED);
  if (!orgId) return suppressed(SUPPRESSION_REASONS.CHECK_FAILED);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return suppressed(SUPPRESSION_REASONS.CHECK_FAILED);
  }

  if (record.suppressed === true) {
    const stored = typeof record.suppression_reason === "string" ? record.suppression_reason.trim() : "";
    return suppressed(stored || DROP_BLOCK_REASONS.SUPPRESSED);
  }

  if (record.responded_at != null) return suppressed(SUPPRESSION_REASONS.PRIOR_RESPONDER);

  const identity = recordIdentity(record);
  if (!identity.usable) return suppressed(SUPPRESSION_REASONS.UNIDENTIFIABLE);

  try {
    const clientId = await matchClient(db, orgId, identity);
    if (clientId) {
      const opted = await hasActiveOptOut(db, clientId);
      return suppressed(opted ? SUPPRESSION_REASONS.OPT_OUT : SUPPRESSION_REASONS.EXISTING_CLIENT);
    }
    // Only a real uuid excludes "this row"; a vendor file with its own `id`
    // column would otherwise be cast to uuid by Postgres and raise 22P02, which
    // this function's own catch would then report as check_failed — a spurious
    // suppression caused by the shape of a column name.
    const selfId = typeof record.id === "string" && UUID_RE.test(record.id) ? record.id : null;
    if (await matchPriorResponder(db, orgId, identity, selfId)) {
      return suppressed(SUPPRESSION_REASONS.PRIOR_RESPONDER);
    }
  } catch {
    // Deliberately swallowed and converted, not re-raised. See the header.
    return suppressed(SUPPRESSION_REASONS.CHECK_FAILED);
  }

  return clear();
}

/**
 * The existing-client match. Two indexed lookups, whatever the number of
 * candidate values, via `= ANY`.
 *
 * Email uses lower(email), which is what idx_clients_email is built on
 * (001_init.sql:75) and what src/handlers/comms.mjs already matches on.
 *
 * Phone compares DIGITS ON BOTH SIDES. `clients.phone` is raw text and nothing
 * in this repo normalises it, while ingest.mjs stores a recognised phone column
 * as digits only — so an exact-text comparison against idx_clients_phone would
 * miss "(555) 123-4567" for "5551234567" and read as "not an existing client",
 * which is the false negative that matters. The expression index that makes
 * this cheap is db/migrations/066_mail_suppression_indexes.sql.
 */
async function matchClient(db, orgId, identity) {
  if (identity.emails.length) {
    const r = await db.query(
      `SELECT id FROM clients WHERE org_id = $1 AND lower(email) = ANY($2::text[]) LIMIT 1`,
      [orgId, identity.emails]
    );
    if (r.rows[0]) return r.rows[0].id;
  }
  if (identity.phones.length) {
    const r = await db.query(
      `SELECT id FROM clients
        WHERE org_id = $1
          AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($2::text[])
        LIMIT 1`,
      [orgId, identity.phones]
    );
    if (r.rows[0]) return r.rows[0].id;
  }
  return null;
}

/**
 * A live opt-out on ANY channel suppresses.
 *
 * `opt_outs.channel` holds 'sms' | 'email' | 'voice'. There is no 'mail'
 * channel and this module does not invent one — writing a value the schema's
 * own documentation does not list would put a fourth vocabulary item into a
 * table two other modules read. Instead, any live opt-out is read as a
 * do-not-contact signal that covers postal mail too. That is the conservative
 * reading and it may over-suppress: a person who texted STOP has not, strictly,
 * opted out of receiving post. Over-suppressing is the direction this file is
 * allowed to be wrong in.
 *
 * Read through isOptedOut() from src/lib/opt-out.mjs, which is documented as
 * the only sanctioned path to opt_outs, so the "row exists AND opted_in_at IS
 * NULL" invariant lives in exactly one place and a START keyword un-suppresses
 * here for free. Three indexed lookups at worst, and only ever for a record
 * that already matched a client — which is already suppressed regardless, so
 * this only ever refines the REASON.
 */
async function hasActiveOptOut(db, clientId) {
  for (const channel of OPT_OUT_CHANNELS) {
    if (await isOptedOut(db, clientId, channel)) return true;
  }
  return false;
}

/**
 * The prior-responder match across the org's other records (list reuse terms).
 *
 * MATCHED BY VALUE, NOT BY COLUMN NAME, for the reason in the header: fields is
 * keyed by the vendor's own headers and two drops from two vendors will not
 * agree on them. jsonb_each_text unrolls every value of a responder's record
 * and compares it to this record's identity values, so an email or a phone
 * finds its match whatever column it happens to live in.
 *
 * SCOPED TO RESPONDERS, which is what keeps it affordable: the scan is over
 * `responded_at IS NOT NULL` only — a low single-digit percentage of any
 * universe — and 066 adds the partial index for it. Excludes the record itself
 * so a row cannot suppress itself here (rule 2 in checkSuppression covers that
 * case and reports it more precisely).
 */
async function matchPriorResponder(db, orgId, identity, selfId) {
  if (!identity.emails.length && !identity.phones.length) return false;
  const r = await db.query(
    `SELECT 1 FROM mail_universe mu
      WHERE mu.org_id = $1
        AND mu.responded_at IS NOT NULL
        AND ($4::uuid IS NULL OR mu.id <> $4::uuid)
        AND EXISTS (
              SELECT 1 FROM jsonb_each_text(mu.fields) AS kv(k, v)
               WHERE lower(btrim(kv.v)) = ANY($2::text[])
                  OR regexp_replace(kv.v, '[^0-9]', '', 'g') = ANY($3::text[])
            )
      LIMIT 1`,
    [orgId, identity.emails, identity.phones, selfId]
  );
  return r.rows.length > 0;
}

/* ------------------------------------------------------------------------- *
 * applySuppression
 * ------------------------------------------------------------------------- */

/** Rows per page. Keyset paginated by id, not OFFSET, because the pass CHANGES
 *  the predicate it is paginating over — a suppressed row leaves the
 *  `suppressed = false` set and every OFFSET after it would skip a record. */
const SCAN_BATCH = 500;

/**
 * applySuppression(db, { orgId, campaignId }) ->
 *   { scanned, suppressed, byReason }
 *
 * Runs the pass over one campaign and persists the verdict into
 * `mail_universe.suppressed` / `suppression_reason`. Writes nothing else, and
 * emits no event — there is no event name in src/events/canonical.mjs for this
 * and this module does not unilaterally add one.
 *
 * *** IT IS A ONE-WAY RATCHET. IT NEVER UN-SUPPRESSES. ***
 * Only rows currently at `suppressed = false` are even read, and the UPDATE only
 * ever sets the flag true. Nothing here clears a suppression, for two reasons:
 * a suppression may have been set by a human or by another thread and a batch
 * job must not overrule it; and un-suppressing IS THE DECISION TO MAIL SOMEBODY,
 * which is not a decision a re-runnable script gets to make on its own. Clearing
 * a stale reason — including a `check_failed` left by a transient outage — is a
 * deliberate human UPDATE, and deliberately has no function here.
 *
 * IDEMPOTENT AND RE-RUNNABLE, which follows from the ratchet: the second run
 * reads only the rows the first left clear and suppresses none of them again.
 * The UPDATE re-asserts `AND suppressed = false` so two passes racing cannot
 * double-count, and re-running after fixing data reclassifies whatever is still
 * clear.
 *
 * NOT ATOMIC, same trade as ingestBatch: no transaction wraps the loop, so an
 * interrupted pass leaves the records it reached suppressed and the rest
 * untouched. That is safe ONLY because assertDroppable re-checks live and never
 * trusts this flag on its own — which is the reason it re-checks.
 */
export async function applySuppression(db, { orgId, campaignId } = {}) {
  if (!db || typeof db.query !== "function") throw new TypeError("applySuppression: db is required");
  if (!orgId) throw new TypeError("applySuppression: orgId is required");
  const campaign = campaignId == null ? "" : String(campaignId).trim();
  if (!campaign) throw new TypeError("applySuppression: campaignId is required");

  const result = { scanned: 0, suppressed: 0, byReason: {} };
  let cursor = null;

  for (;;) {
    const page = await db.query(
      `SELECT id, org_id, campaign_id, fields, suppressed, suppression_reason, responded_at
         FROM mail_universe
        WHERE org_id = $1
          AND campaign_id = $2
          AND suppressed = false
          AND ($3::uuid IS NULL OR id > $3::uuid)
        ORDER BY id
        LIMIT $4`,
      [orgId, campaign, cursor, SCAN_BATCH]
    );
    if (page.rows.length === 0) break;

    for (const row of page.rows) {
      result.scanned++;
      cursor = row.id;
      const verdict = await checkSuppression(db, { orgId, record: row });
      if (!verdict.suppressed) continue;

      const reason = isSuppressionReason(verdict.reason)
        ? verdict.reason
        : SUPPRESSION_REASONS.CHECK_FAILED;   // never write free text of our own

      const upd = await db.query(
        `UPDATE mail_universe
            SET suppressed = true, suppression_reason = $2, updated_at = now()
          WHERE id = $1 AND suppressed = false
          RETURNING id`,
        [row.id, reason]
      );
      if (upd.rows.length === 0) continue;    // another pass got there first
      result.suppressed++;
      result.byReason[reason] = (result.byReason[reason] || 0) + 1;
    }

    if (page.rows.length < SCAN_BATCH) break;
  }

  return result;
}

/* ------------------------------------------------------------------------- *
 * assertDroppable
 * ------------------------------------------------------------------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * assertDroppable(db, { recordId }) -> { recordId, orgId, campaignId, recordSlug }
 *
 * *** THIS FUNCTION DOES NOT MAIL ANYTHING. *** It is the gate a future drop
 * path MUST call first, and its only powers are to throw or to return quietly.
 * If you are reading this because you are building that path: this returning
 * successfully is a necessary condition, never a sufficient one — the FCRA gate
 * in src/mail/README.md is above it and is not a code check.
 *
 * THROWS NotDroppableError UNLESS EVERY ONE OF THESE HOLDS:
 *   - recordId is a well-formed uuid and resolves to a row;
 *   - the row's campaign has a mail_campaigns row with status = 'approved'
 *     (which means a human signed off all three gate conditions by hand);
 *   - the row is not flagged suppressed;
 *   - a LIVE re-check of the suppression rules comes back clear.
 *
 * WHY IT RE-CHECKS INSTEAD OF TRUSTING `suppressed`. The stored flag is only as
 * fresh as the last applySuppression run. A person can become a client, or text
 * STOP, or respond to a different piece, in the window between the pass and the
 * drop — and applySuppression is explicitly not atomic, so a half-finished pass
 * leaves real records still reading `suppressed = false`. Trusting the flag
 * would make the gate exactly as stale as the last batch job, so the flag is
 * treated as a fast NO and never as a YES.
 *
 * EVERY ERROR IS A REFUSAL. A database failure throws `check_failed` rather than
 * propagating, so a caller cannot accidentally distinguish "the gate said no"
 * from "the gate fell over" and retry its way past it.
 *
 * The return value carries no consumer data — id, org, campaign key and slug
 * only — so a drop path logging it cannot log somebody's address.
 */
export async function assertDroppable(db, { recordId } = {}) {
  if (!db || typeof db.query !== "function") {
    throw new NotDroppableError(SUPPRESSION_REASONS.CHECK_FAILED, "assertDroppable: db is required");
  }
  if (typeof recordId !== "string" || !UUID_RE.test(recordId)) {
    throw new NotDroppableError(DROP_BLOCK_REASONS.UNKNOWN_RECORD, "assertDroppable: recordId must be a uuid");
  }

  let row;
  try {
    // LEFT JOIN on the soft link documented in 065: mail_universe.campaign_id is
    // text and equals mail_campaigns.campaign_key. LEFT so that "no campaign row
    // at all" arrives here as a NULL status and is refused below, rather than as
    // an empty result indistinguishable from "no such record".
    const res = await db.query(
      `SELECT mu.id, mu.org_id, mu.campaign_id, mu.record_slug, mu.fields,
              mu.suppressed, mu.suppression_reason, mu.responded_at,
              mc.status AS campaign_status
         FROM mail_universe mu
         LEFT JOIN mail_campaigns mc
                ON mc.campaign_key = mu.campaign_id
               AND mc.org_id = mu.org_id
        WHERE mu.id = $1
        LIMIT 1`,
      [recordId]
    );
    row = res.rows[0] || null;
  } catch {
    throw new NotDroppableError(SUPPRESSION_REASONS.CHECK_FAILED, "assertDroppable: suppression check failed");
  }

  if (!row) throw new NotDroppableError(DROP_BLOCK_REASONS.UNKNOWN_RECORD);

  // The FCRA gate first: if the campaign is not approved, nothing in it is
  // droppable and no per-record detail changes that.
  if (row.campaign_status !== "approved") {
    throw new NotDroppableError(DROP_BLOCK_REASONS.CAMPAIGN_NOT_APPROVED);
  }

  if (row.suppressed === true) {
    const stored = typeof row.suppression_reason === "string" ? row.suppression_reason.trim() : "";
    throw new NotDroppableError(stored || DROP_BLOCK_REASONS.SUPPRESSED);
  }

  const verdict = await checkSuppression(db, { orgId: row.org_id, record: row });
  if (verdict.suppressed) throw new NotDroppableError(verdict.reason);

  return {
    recordId: row.id,
    orgId: row.org_id,
    campaignId: row.campaign_id,
    recordSlug: row.record_slug
  };
}
