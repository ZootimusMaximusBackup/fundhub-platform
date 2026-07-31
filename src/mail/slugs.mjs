// Mail slugs — the per-record PURL/QR identifier printed on a mail piece.
//
// *** NOTHING HERE MAILS. ***
// A slug is a name for a row. Minting one does not put anything in the post,
// and there is no send path in this module, this directory, or this repo — see
// src/mail/README.md for the FCRA gate and db/migrations/065_mail_campaigns.sql
// for why there is deliberately no activation flag anywhere near mail.
//
// WHAT A SLUG IS FOR. `mail_universe.record_slug` (001_init.sql:353) is
// commented "per-record PURL/QR slug" and is `text UNIQUE`. It is the whole
// linkage between a piece of paper and a database row: it is printed in a
// personalised URL, encoded in a QR code, and comes back as untrusted text off
// a public request. lookupBySlug() below is the reverse direction and is
// written for that hostility.
//
// THIS MODULE MINTS; INGEST DOES NOT. src/mail/ingest.mjs deliberately refuses
// a row whose file carried no slug ("minting an identifier the vendor never
// issued ... would then be printed on a mail piece as a PURL that resolves to
// nothing"), and that is correct for its direction of travel: when the VENDOR
// numbers the pieces, the file is the authority and inventing a slug produces a
// dead PURL. This module is the other direction — when WE supply the print file
// and therefore the slugs, something has to issue them before the file goes to
// the printer. assignSlugs() is that step, and it only ever fills a NULL.
//
// A SLUG IS NEVER REWRITTEN. Once assigned it may already be on paper, in a
// truck, or in somebody's hand, and a database that changes its mind about a
// slug turns a real QR code into a 404. Every write below is guarded on
// `record_slug IS NULL`; there is no update path and no "regenerate" function.

import { randomBytes } from "node:crypto";

/* ------------------------------------------------------------------------- *
 * The alphabet
 * ------------------------------------------------------------------------- */

/**
 * SLUG_ALPHABET — 30 symbols. Crockford's base32 (0-9 plus A-Z minus I, L, O
 * and U) with 0 and 1 removed as well.
 *
 * WHY THESE EXCLUSIONS, AND ONLY THESE. This string gets read off a printed
 * page by a member of the public and typed into a phone. Every excluded glyph
 * is a documented misread:
 *
 *   O / 0   — both dropped. Keeping either one means the other is a plausible
 *             typo for it. Crockford solves this by DECODING O as 0; that only
 *             works if you own the decoder, and here the "decoder" is a
 *             Postgres unique index doing exact text equality.
 *   1 / I / L — all three dropped, same reason. In most print faces a capital I
 *             and a lowercase l are the same rectangle.
 *   U       — dropped, Crockford's rule: it is what stops a random 12-character
 *             string from spelling something that gets the piece thrown away.
 *
 * WHY UPPERCASE ONLY, WHICH IS A QR DECISION RATHER THAN A LEGIBILITY ONE. A QR
 * code's alphanumeric mode encodes 0-9, A-Z UPPERCASE and nine punctuation
 * marks at 5.5 bits per character; byte mode costs 8. A single lowercase
 * character in the slug forces the whole slug segment into byte mode, which
 * means a denser symbol at the same physical size on the piece, which means a
 * worse scan rate off a page somebody is holding at arm's length. Uppercase is
 * also the case a person types by default on a phone keyboard's first tap.
 *
 * ALL 30 SYMBOLS ARE RFC 3986 "unreserved", so a slug needs no percent-encoding
 * in a path or a query string and survives being copied out of an email client
 * that helpfully linkifies things.
 */
export const SLUG_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * SLUG_LENGTH — 12.
 *
 * THE COLLISION MATH, WRITTEN OUT BECAUSE THE NUMBER 12 IS OTHERWISE A GUESS.
 *
 *   keyspace  N = 30^12 = 531,441,000,000,000,000  (~5.31e17, ~58.9 bits)
 *
 * Birthday approximation for the probability that ANY two of n slugs collide:
 *
 *   p ~= n^2 / (2N)
 *
 *   n =    100,000 records  ->  p ~= 9.4e-9   (about 1 in 106 million)
 *   n =  1,000,000 records  ->  p ~= 9.4e-7   (about 1 in 1.06 million)
 *   n = 10,000,000 records  ->  p ~= 9.4e-5   (about 1 in 10,600)
 *
 * A drop is hundreds of thousands of pieces, so the practical answer is that a
 * collision does not happen. It is nevertheless HANDLED rather than assumed
 * away — assignSlugs retries on SQLSTATE 23505 — because the cost of being
 * wrong is a batch of a hundred thousand records aborting on record 40,000,
 * and because a unique index is the only thing that can actually adjudicate a
 * collision between two concurrent writers.
 *
 * Shorter was tempting (10 chars is 2 fewer to type, ~49 bits, p ~= 8.5e-6 at a
 * million) and longer buys nothing anyone can measure. 12 characters chunk
 * cleanly as XXXX-XXXX-XXXX if a piece ever wants to print them grouped —
 * though the hyphens are NOT part of the slug and normalizeSlug does not strip
 * them, because inventing a grouping convention nobody has specified would
 * silently make "ABCD-EFGH-JKMN" and "ABCDEFGHJKMN" the same identifier.
 */
export const SLUG_LENGTH = 12;

/**
 * Rejection-sampling threshold. 256 is not a multiple of 30, so mapping a raw
 * byte with `b % 30` hands the first 16 symbols of the alphabet a 9/256 chance
 * and the other 14 an 8/256 chance — a ~12% bias toward "2" through "H" that
 * would be invisible in any test that only counts collisions. Bytes at or above
 * 240 (= 30 * 8) are discarded and redrawn instead.
 */
const REJECT_AT = Math.floor(256 / 30) * 30;   // 240

export class SlugError extends Error {
  constructor(message, { code = "slug_error" } = {}) {
    super(message);
    this.name = "SlugError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------------- *
 * generateSlug
 * ------------------------------------------------------------------------- */

/**
 * generateSlug({ length }) -> "7KQ2M9XBTDVF"
 *
 * PURE-ISH: no arguments beyond a length, no database, no clock, no counter.
 * A slug carries NO information about the record — not the campaign, not the
 * ingest order, not the date. That is deliberate: the slug appears in a URL on
 * a public page, and a sequential or encoded identifier lets anyone who
 * receives one piece of mail enumerate the rest of the list. The list is a
 * prescreened consumer file. Enumerability is the failure mode to design out,
 * and randomness is how you do it.
 *
 * randomBytes, not Math.random: this is an identifier that gates access to a
 * consumer record via a public URL, so it needs a CSPRNG. node:crypto is in
 * the standard library, which keeps the dependency manifest at `pg` + `inngest`.
 *
 * Over-draws by 25% up front so the common case is one randomBytes call; the
 * loop tops up if rejection sampling eats through the buffer.
 */
export function generateSlug({ length = SLUG_LENGTH, alphabet = SLUG_ALPHABET } = {}) {
  if (!Number.isInteger(length) || length < 1) {
    throw new SlugError("generateSlug: length must be a positive integer", { code: "bad_length" });
  }
  if (typeof alphabet !== "string" || alphabet.length < 2 || alphabet.length > 256) {
    throw new SlugError("generateSlug: alphabet must be 2-256 characters", { code: "bad_alphabet" });
  }
  const n = alphabet.length;
  const rejectAt = n === SLUG_ALPHABET.length ? REJECT_AT : Math.floor(256 / n) * n;

  let out = "";
  let buf = randomBytes(Math.ceil(length * 1.25));
  let i = 0;
  while (out.length < length) {
    if (i >= buf.length) { buf = randomBytes(Math.ceil((length - out.length) * 1.25) + 1); i = 0; }
    const b = buf[i++];
    if (b >= rejectAt) continue;          // biased tail — redraw
    out += alphabet[b % n];
  }
  return out;
}

/* ------------------------------------------------------------------------- *
 * Reading a slug back off a piece of paper
 * ------------------------------------------------------------------------- */

/**
 * isValidSlug — does this string look like something WE minted?
 *
 * Strict: exactly SLUG_LENGTH characters, all from SLUG_ALPHABET. Used to check
 * our own output. NOT used to gate lookupBySlug — see the note there, because
 * mail_universe also holds VENDOR-issued slugs that obey none of these rules
 * and rejecting them would strand a real respondent.
 */
export function isValidSlug(value, { length = SLUG_LENGTH, alphabet = SLUG_ALPHABET } = {}) {
  if (typeof value !== "string" || value.length !== length) return false;
  for (const ch of value) if (!alphabet.includes(ch)) return false;
  return true;
}

/**
 * normalizeSlug — trim and uppercase, or null.
 *
 * WHAT IT DOES NOT DO IS REPAIR. Crockford's decoder maps a typed O to 0 and a
 * typed I or L to 1; that mapping has no target here because 0 and 1 are not in
 * the alphabet, so "repairing" an O would mean guessing which of the 30 real
 * symbols the person meant. A wrong guess resolves a stranger's URL to a
 * different household's record. Unrecoverable input stays unrecoverable and
 * lookupBySlug returns null, which is the honest answer.
 */
export function normalizeSlug(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.toUpperCase();
}

/**
 * The shape a slug is ALLOWED to have when it arrives from a public URL.
 *
 * This is a hostile-input guard, not a format check. It exists so that a
 * request carrying 40kB of SQL, a path traversal, a NUL byte or a percent-
 * encoded payload never reaches the database at all. The query is parameterised
 * regardless (see lookupBySlug) — this is the belt to that pair of braces.
 *
 * Deliberately permissive about FORMAT — any URL-safe token up to 128
 * characters — because mail_universe holds vendor-issued slugs from
 * src/mail/ingest.mjs as well as ones minted here, and this repo has no source
 * describing what a Deluxe slug looks like. Rejecting on our own format would
 * mean a real respondent's PURL resolving to nothing.
 */
const LOOKUP_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;

export function isLookupCandidate(value) {
  return typeof value === "string" && LOOKUP_SHAPE.test(value.trim());
}

/* ------------------------------------------------------------------------- *
 * assignSlugs
 * ------------------------------------------------------------------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How many times one record may lose a collision race before we give up. At
 *  ~1e-9 per draw, five consecutive losses is not a collision — it is a sign
 *  that something else is wrong (a duplicated generator, a clamped alphabet),
 *  and looping forever would hide it. */
const MAX_SLUG_ATTEMPTS = 5;

/**
 * assignSlugs(db, { campaignId, recordIds, generate }) ->
 *   { assigned, skipped, retries }
 *
 * Fills `mail_universe.record_slug` for records that do not have one.
 *
 * ONLY EVER FILLS A NULL. Every write is
 *   UPDATE ... WHERE id = $1 AND record_slug IS NULL
 * so a vendor-issued slug already on the row survives, a re-run assigns
 * nothing, and two passes racing each other cannot both win — the second one's
 * RETURNING comes back empty and the row is counted as skipped rather than
 * overwritten. That guard is the whole idempotency story; there is no
 * "regenerate" and no update path, because the slug may already be printed.
 *
 * RETRIES ON 23505 RATHER THAN FAILING THE BATCH. record_slug is UNIQUE
 * globally (not per org — a schema fact ingest.mjs also flags). A duplicate is
 * a ~1e-9 event, but the index is the only authority that can settle a race
 * between two concurrent writers, so its verdict is handled: regenerate and try
 * again, up to MAX_SLUG_ATTEMPTS, and only then throw. Any OTHER SQLSTATE
 * propagates immediately — swallowing an unrelated database error here would
 * report "assigned: 0" for a table that is actually unreachable.
 *
 * ONE STATEMENT PER RECORD, ON PURPOSE. A set-based
 * `UPDATE ... SET record_slug = <expression>` cannot retry an individual
 * collision, and generating slugs in SQL would put the CSPRNG and the alphabet
 * somewhere no unit test can reach them. This is not the drop path and it is
 * not on a request; throughput is not the constraint.
 *
 * SUPPRESSED RECORDS ARE STILL ASSIGNED SLUGS. A slug is an identifier, not a
 * decision to mail — suppression is enforced at the gate (assertDroppable in
 * ./suppression.mjs), never by withholding a name. A suppressed record that
 * somehow reaches a printer would then be traceable rather than anonymous.
 *
 * `generate` is a seam so the collision-retry path can be tested against a real
 * unique index instead of being asserted about in a comment. It defaults to
 * generateSlug and nothing in production passes it.
 */
export async function assignSlugs(db, { campaignId = null, recordIds = null, generate = generateSlug } = {}) {
  if (!db || typeof db.query !== "function") {
    throw new SlugError("assignSlugs: db is required", { code: "db_required" });
  }
  const campaign = campaignId == null ? null : String(campaignId).trim() || null;
  if (campaign === null && recordIds === null) {
    throw new SlugError("assignSlugs: campaignId or recordIds is required", { code: "target_required" });
  }
  if (recordIds !== null && !Array.isArray(recordIds)) {
    throw new SlugError("assignSlugs: recordIds must be an array", { code: "record_ids_not_an_array" });
  }
  if (typeof generate !== "function") {
    throw new SlugError("assignSlugs: generate must be a function", { code: "bad_generator" });
  }

  // A malformed id is a caller bug, and Postgres would report it as SQLSTATE
  // 22P02 halfway through a batch with some rows already written. Caught here
  // so the batch is refused whole, before anything is assigned.
  if (recordIds) {
    for (const id of recordIds) {
      if (typeof id !== "string" || !UUID_RE.test(id)) {
        throw new SlugError("assignSlugs: recordIds must be uuids", { code: "record_id_not_a_uuid" });
      }
    }
  }

  const targets = recordIds ?? (await selectUnslugged(db, campaign));
  const result = { assigned: 0, skipped: 0, retries: 0 };

  for (const id of targets) {
    let attempt = 0;
    for (;;) {
      attempt++;
      const slug = generate();
      try {
        const res = await db.query(
          `UPDATE mail_universe
              SET record_slug = $2, updated_at = now()
            WHERE id = $1
              AND record_slug IS NULL
              AND ($3::text IS NULL OR campaign_id = $3)
            RETURNING id`,
          [id, slug, campaign]
        );
        if (res.rows.length === 0) result.skipped++;   // already slugged, gone, or another campaign
        else result.assigned++;
        break;
      } catch (err) {
        if (err && err.code === "23505" && attempt < MAX_SLUG_ATTEMPTS) {
          result.retries++;
          continue;
        }
        if (err && err.code === "23505") {
          throw new SlugError(
            `assignSlugs: ${MAX_SLUG_ATTEMPTS} consecutive slug collisions — check the generator`,
            { code: "slug_collision_exhausted" }
          );
        }
        throw err;
      }
    }
  }
  return result;
}

/** The rows in a campaign still waiting for a name. */
async function selectUnslugged(db, campaign) {
  const res = await db.query(
    `SELECT id FROM mail_universe
      WHERE campaign_id = $1 AND record_slug IS NULL
      ORDER BY created_at, id`,
    [campaign]
  );
  return res.rows.map((r) => r.id);
}

/* ------------------------------------------------------------------------- *
 * lookupBySlug
 * ------------------------------------------------------------------------- */

/**
 * lookupBySlug(db, { slug }) -> mail_universe row | null
 *
 * The response path's reverse lookup: a slug arrives off a public URL or a QR
 * scan and has to become a record. THE INPUT IS UNTRUSTED, and this function
 * treats it that way:
 *
 *   - shape-checked before anything else, so a hostile string never reaches the
 *     database (isLookupCandidate above);
 *   - parameterised — the value is a bind parameter, never concatenated;
 *   - UNKNOWN RETURNS null, IT DOES NOT THROW. A stranger typing a wrong
 *     character is the single most likely thing to happen to a printed URL, and
 *     it is not an exception, it is a 404. A caller can tell "no such slug"
 *     from "the database is down" because the latter still throws.
 *
 * CASE. Slugs minted here are uppercase, and a person typing one off paper may
 * not be. The raw, uppercased and lowercased forms are all tried in one indexed
 * lookup, which recovers the common miss without a scan. AMBIGUITY FAILS
 * CLOSED: if two rows somehow match (a lowercase vendor slug coexisting with an
 * uppercase minted one), this returns null rather than picking one, because
 * picking one means showing a stranger somebody else's record.
 *
 * SUPPRESSED AND ALREADY-RESPONDED RECORDS STILL RESOLVE. Suppression governs
 * whether a piece may be MAILED; it says nothing about whether a person who is
 * holding one may be answered. A record that responds twice must resolve both
 * times or the second response is lost. Filtering here would silently drop real
 * responses, so the filter is the caller's if it ever wants one.
 *
 * The returned row carries `fields`, which is consumer PII. It is returned
 * because the response path needs the record, NOT because it is safe to render:
 * do not put it in a public response body.
 */
export async function lookupBySlug(db, { slug } = {}) {
  if (!db || typeof db.query !== "function") {
    throw new SlugError("lookupBySlug: db is required", { code: "db_required" });
  }
  if (!isLookupCandidate(slug)) return null;

  const raw = slug.trim();
  const candidates = [...new Set([raw, raw.toUpperCase(), raw.toLowerCase()])];

  const res = await db.query(
    `SELECT id, org_id, campaign_id, record_slug, fields,
            suppressed, suppression_reason, responded_at, outcome_tier,
            created_at, updated_at
       FROM mail_universe
      WHERE record_slug = ANY($1::text[])
      LIMIT 2`,
    [candidates]
  );
  if (res.rows.length !== 1) return null;   // 0 = unknown, 2 = ambiguous; both are "no"
  return res.rows[0];
}
