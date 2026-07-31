// Mail ingestion — a file lands, and becomes mail_universe rows.
//
// This is the INTAKE half of the mail pipeline and nothing else. It parses,
// it normalizes, it writes. It does not send, schedule, suppress, or decide
// anything about a record's fate.
//
// *** NOTHING HERE MAILS. ***
// There is no send path, no scheduler, no outbound call, no activation flag,
// and no reachable code that could acquire one. The whole repo is like this
// (AUDIT-FINDINGS: "nothing transmits" — there is no outbound fetch in
// src/adapters/ or src/lib/), and mail is the one channel where a mistake costs
// postage and cannot be recalled. Intake is deliberately a dead end: rows land
// in a table and stop.
//
// *** SUPPRESSION IS NOT DECIDED HERE. ***
// Records arrive with mail_universe.suppressed at its schema default (false).
// The suppression pass is a separate concern with a separate owner, and it runs
// AFTER ingest against rows that already exist. So the INSERT below never names
// `suppressed` or `suppression_reason`, and — this is the part that matters —
// neither does the ON CONFLICT branch. Re-ingesting a file must not quietly
// un-suppress a record that a later pass suppressed, which is exactly what a
// naive "upsert everything" would do. Same for `responded_at` and
// `outcome_tier`: those belong to the response path, and a re-ingest must not
// erase the fact that somebody responded.
//
// WHY THERE IS NO SFTP CLIENT AND NO UPLOAD ENDPOINT HERE.
// Deliberately out of scope. Nothing in this repo does outbound network I/O,
// and adding an SFTP dependency (or any dependency — the manifest is `pg` and
// `inngest`, full stop) is a decision above this module. The entry point takes
// text or rows that somebody else has already read off disk, off a queue, or
// out of a request body. That also makes the whole parse/normalize surface
// pure, and therefore testable without a network, a fixture server, or a mock.
//
// WHY THE CSV PARSER IS WRITTEN OUT LONGHAND.
// `scripts/marketing/lib/csv.mjs` has a streaming RFC-4180 reader, but it lives
// under scripts/ (a data-warehouse tool, not a platform module) and it is an
// async generator built for 1.8GB federal files. Importing scripts/ from src/
// inverts the layering, and the streaming shape is the wrong ergonomics for a
// mail file that arrives whole. This one is synchronous, total, and hostile-
// input tested. If the two ever need to converge, converge them deliberately.
//
// THE SCHEMA THIS WRITES TO (db/schema/001_init.sql:349) HAS NO PER-RECORD
// COLUMNS. mail_universe is org_id, campaign_id, record_slug, fields (jsonb),
// suppressed, suppression_reason, responded_at, outcome_tier. Every per-record
// value — name, address, city, state, zip, phone, anything else the vendor
// shipped — goes into `fields`. There is nowhere else to put it and no
// migration is needed to hold it, which is why this module adds none.

/* ------------------------------------------------------------------------- *
 * Errors
 * ------------------------------------------------------------------------- */

/** Every failure this module raises on its own. `.code` is a stable snake_case
 *  string, because it is what ends up in ingestBatch's per-row `reason` and
 *  callers will branch on it. `.message` is for a human reading a log. */
export class MailIngestError extends Error {
  constructor(message, { code = "mail_ingest_error" } = {}) {
    super(message);
    this.name = "MailIngestError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------------- *
 * parseDelimited
 * ------------------------------------------------------------------------- */

/**
 * setOwn — assign a key that came from an untrusted file.
 *
 * `obj[key] = value` is not safe when `key` came from a vendor's header row.
 * A column literally named `__proto__` hits Object.prototype's setter: the
 * assignment silently succeeds, creates no own property, and the record loses a
 * column with no error anywhere. `constructor` is the same shape of problem.
 * defineProperty writes an own data property whatever the name is, so nothing
 * is lost and nothing is reachable through the prototype chain.
 */
function setOwn(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * tokenize — text in, array-of-arrays-of-cells out.
 *
 * A single pass, one character at a time, holding only the current field and
 * the current row. It handles what a real vendor file actually contains:
 *
 *   - a UTF-8 BOM on the first byte (stripped by the caller, before this runs);
 *   - CRLF, bare LF and bare CR line endings, mixed within one file;
 *   - quoted fields containing the delimiter;
 *   - quoted fields containing newlines, preserved BYTE FOR BYTE — a CRLF
 *     inside quotes stays a CRLF, because rewriting the contents of a field is
 *     the parser inventing data. normalizeRecord collapses it later, on
 *     purpose and visibly;
 *   - "" as an escaped quote;
 *   - text after a closing quote (`"a"b`), appended rather than rejected.
 *
 * AN UNTERMINATED QUOTE THROWS RATHER THAN RETURNING WHAT IT MANAGED TO READ.
 * A file truncated mid-quote has no row boundaries after the break — every
 * remaining line folds into one enormous field. Returning the salvage would
 * turn "the transfer was cut short" into "the campaign has 4,000 records
 * instead of 10,000", which is silent, plausible, and expensive. The loud
 * failure is the safe one; the caller can catch it and report the file.
 */
function tokenize(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let quoteJustClosed = false;
  let lastWasCR = false;

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const afterCR = lastWasCR;
    lastWasCR = false;

    // The \n of a CRLF pair was already consumed as a row break by the \r.
    if (afterCR && c === "\n") continue;

    if (inQuotes && !quoteJustClosed) {
      if (c === '"') quoteJustClosed = true;
      else field += c;                       // includes \r, \n and the delimiter
      continue;
    }

    if (quoteJustClosed) {
      quoteJustClosed = false;
      if (c === '"') { field += '"'; continue; }   // "" -> a literal quote
      inQuotes = false;                            // the quote really did close
      // fall through and reprocess c as an ordinary unquoted character
    }

    // A quote only opens a quoted field at the START of a field. Anywhere else
    // it is a literal character, which is what a vendor exporting `5" pipe`
    // without escaping means.
    if (c === '"' && field === "") { inQuotes = true; continue; }
    if (c === delimiter) { endField(); continue; }
    if (c === "\r") { lastWasCR = true; endRow(); continue; }
    if (c === "\n") { endRow(); continue; }
    field += c;
  }

  if (inQuotes && !quoteJustClosed) {
    throw new MailIngestError(
      "parseDelimited: the file ends inside a quoted field — it is truncated or the quoting is broken",
      { code: "unterminated_quote" }
    );
  }
  // A trailing row with no line terminator. If the file ended ON a terminator,
  // field is "" and row is empty, so no phantom record is emitted.
  if (field !== "" || row.length > 0) endRow();

  return rows;
}

/** A line that yields exactly one empty cell is a blank line, not a record.
 *  Note the consequence in a single-column file: a genuinely empty value is
 *  indistinguishable from a blank line and is dropped. That is the standard
 *  reading and it costs nothing here, because an all-empty record has no
 *  record_slug and ingestBatch would refuse it anyway. */
const isBlankLine = (cells) => cells.length === 1 && cells[0].trim() === "";

/**
 * parseDelimited(text, { delimiter }) — header row plus data rows, as objects.
 *
 * PURE. No I/O, no clock, no randomness, no mutation of its argument.
 *
 * Returns [] for an empty file, a whitespace-only file, and a header-only file.
 * Those are three different situations and all three mean "no records", so the
 * caller gets one answer rather than a special case to forget.
 *
 * KEYS ARE THE HEADER CELLS, TRIMMED. Values are NOT trimmed — trimming is
 * normalizeRecord's job, and keeping the parser faithful means the caller can
 * still tell "the cell was blank" from "the column was not on this row".
 *
 * A SHORT ROW LEAVES THE KEY ABSENT rather than setting it to "". A ragged file
 * — the vendor dropped a trailing column halfway through — must not turn a
 * column nobody sent into a column that arrived empty. Those are different
 * facts and only one of them is true.
 *
 * A LONG ROW KEEPS ITS EXTRA CELLS under positional keys (`column_7`), because
 * a parser that silently drops the cells it has no name for is how a file
 * quietly loses its last column. The name is synthesized; the VALUE is not,
 * which is the line that matters.
 *
 * DUPLICATE HEADERS BOTH SURVIVE. The first occurrence keeps the plain name and
 * later ones are suffixed with their column index (`Zip`, `Zip__6`). Last-wins
 * — the obvious implementation — hands you the wrong value with no signal,
 * which is worse than an ugly key. A blank header cell becomes `column_<i>` for
 * the same reason.
 */
export function parseDelimited(text, { delimiter = "," } = {}) {
  if (typeof text !== "string") {
    throw new MailIngestError(
      "parseDelimited: text must be a string — decode the file as utf8 before calling",
      { code: "text_not_a_string" }
    );
  }
  if (typeof delimiter !== "string" || delimiter.length !== 1) {
    throw new MailIngestError("parseDelimited: delimiter must be exactly one character", { code: "bad_delimiter" });
  }
  if (delimiter === '"' || delimiter === "\r" || delimiter === "\n") {
    throw new MailIngestError(
      "parseDelimited: a quote or a line terminator cannot be the delimiter",
      { code: "bad_delimiter" }
    );
  }

  // A UTF-8 BOM is the single most common reason a first column is unreachable
  // by name: without this the header reads "﻿record_slug".
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows = tokenize(body, delimiter).filter((cells) => !isBlankLine(cells));
  if (rows.length === 0) return [];

  const taken = new Set();
  const claim = (name) => {
    let key = name;
    while (taken.has(key)) key += "_";
    taken.add(key);
    return key;
  };

  const keys = rows[0].map((cell, i) => {
    const base = String(cell).trim() || `column_${i}`;
    return claim(taken.has(base) ? `${base}__${i}` : base);
  });

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const record = {};
    for (let i = 0; i < cells.length; i++) {
      if (i >= keys.length) keys.push(claim(`column_${i}`));   // grows in index order, stays stable
      setOwn(record, keys[i], cells[i]);
    }
    out.push(record);
  }
  return out;
}

/* ------------------------------------------------------------------------- *
 * normalizeRecord
 * ------------------------------------------------------------------------- */

/**
 * fieldToken — reduce a column name to a match token: letters and digits only,
 * uppercased. "Zip Code", "zip_code" and "ZIPCODE" all reduce to ZIPCODE, so
 * one rule survives the vendor renaming a column between drops. This is the
 * same idea as headerToken() in scripts/marketing/lib/csv.mjs, restated here
 * rather than imported across the scripts/src boundary.
 */
export function fieldToken(name) {
  return String(name ?? "").normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
}

/**
 * WHICH COLUMNS GET WHICH TREATMENT — AND WHY THIS LIST IS SHORT.
 *
 * *** THERE IS NO DELUXE FILE LAYOUT IN THIS REPO. *** Nothing in db/, docs/,
 * or any spec here names the columns a mail file arrives with; 001_init.sql
 * says "Deluxe records (Section 13). Scaffold now" and stops. So this list is
 * the small set of names that could not plausibly mean anything else, and it
 * is deliberately NOT padded out with guesses. A column this does not
 * recognise is still kept — it is just kept verbatim (trimmed and
 * whitespace-collapsed) instead of being reformatted.
 *
 * "ST" is NOT treated as a state, though plenty of mail files use it, because
 * in an address file it is at least as likely to be a street. Uppercasing a
 * street name is harmless; the point is that a coin-flip mapping does not
 * belong in a module whose rule is "never invent". When the real layout lands,
 * pass `kinds` or extend this constant with the actual names.
 */
export const FIELD_KINDS = {
  state: new Set(["STATE"]),
  zip: new Set(["ZIP", "ZIPCODE", "POSTALCODE"]),
  phone: new Set(["PHONE", "PHONENUMBER"])
};

/**
 * normalizeRecord(row, { required, kinds }) -> { normalized, warnings }
 *
 * PURE. Does not mutate `row`. Idempotent: normalizing an already-normalized
 * record returns the same record and no new warnings.
 *
 * What it does:
 *   - trims every value and collapses internal runs of whitespace to one space
 *     (which is how an address field carrying an embedded newline from a quoted
 *     CSV cell becomes one line);
 *   - uppercases a state;
 *   - strips every non-digit from a zip and a phone.
 *
 * *** WHAT IT NEVER DOES IS FILL ANYTHING IN. ***
 * A field with no usable value is ABSENT from `normalized` and produces a
 * warning. Not "", not "N/A", not a default state, not a placeholder name, not
 * a synthesized address. This is the headline rule of the repo (HANDOFF.md) and
 * mail is where breaking it is most expensive: a guessed state prints on an
 * envelope, goes in a truck, and arrives at somebody's house. A blank gets
 * caught by whoever reviews the warnings; a guess never gets caught at all.
 *
 * A phone or zip that survives stripping as an empty string (an "N/A", a "none
 * on file") is likewise dropped rather than stored as "", and says so with its
 * own warning code so the reason is visible.
 *
 * `required` is an OPT-IN list of field names the caller knows should be there.
 * It defaults to empty, because — see FIELD_KINDS — this repo does not say what
 * a mail record must contain, and inventing a required set would reject real
 * records for failing a rule nobody wrote.
 *
 * Warnings are { field, code } with codes:
 *   missing               — no usable value (absent, null, blank, or all-whitespace)
 *   zip_no_digits         — a zip with nothing numeric in it; dropped
 *   phone_no_digits       — a phone with nothing numeric in it; dropped
 *   state_not_two_letters — kept verbatim (uppercased), NOT corrected
 *   unsupported_value     — a value that is not text or a finite number; dropped
 *   blank_field_name      — a column whose name is empty; dropped
 *   duplicate_field       — two column names that are the same once trimmed
 */
export function normalizeRecord(row, { required = [], kinds = FIELD_KINDS } = {}) {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new MailIngestError("normalizeRecord: row must be a plain object", { code: "row_not_an_object" });
  }

  const normalized = {};
  const warnings = [];
  const warn = (field, code) => warnings.push({ field, code });

  for (const rawKey of Object.keys(row)) {
    const field = String(rawKey).trim();
    if (!field) { warn(rawKey, "blank_field_name"); continue; }
    if (hasOwn(normalized, field)) { warn(field, "duplicate_field"); continue; }

    const raw = row[rawKey];
    if (raw === null || raw === undefined) { warn(field, "missing"); continue; }

    let text;
    if (typeof raw === "string") text = raw;
    else if (typeof raw === "bigint") text = String(raw);
    else if (typeof raw === "boolean") text = String(raw);
    else if (typeof raw === "number") {
      // NaN and Infinity stringify to "NaN" and "Infinity", which is garbage
      // wearing the costume of a value. Drop it and say so.
      if (!Number.isFinite(raw)) { warn(field, "unsupported_value"); continue; }
      text = String(raw);
    } else { warn(field, "unsupported_value"); continue; }

    let value = text.replace(/\s+/g, " ").trim();
    if (value === "") { warn(field, "missing"); continue; }

    const token = fieldToken(field);
    if (kinds.state && kinds.state.has(token)) {
      value = value.toUpperCase();
      // Reported, never rewritten. "California" and "CAL" stay exactly as sent,
      // because the correct two-letter code is a lookup this module has no
      // source for and no business guessing.
      if (!/^[A-Z]{2}$/.test(value)) warn(field, "state_not_two_letters");
    } else if (kinds.zip && kinds.zip.has(token)) {
      const digits = value.replace(/\D+/g, "");
      if (digits === "") { warn(field, "zip_no_digits"); continue; }
      value = digits;   // "12345-6789" -> "123456789"; the +4 is kept, not truncated
    } else if (kinds.phone && kinds.phone.has(token)) {
      const digits = value.replace(/\D+/g, "");
      if (digits === "") { warn(field, "phone_no_digits"); continue; }
      // Digits only. NOT E.164: prefixing a country code onto a 10-digit
      // number is assuming a country the file never stated.
      value = digits;
    }

    setOwn(normalized, field, value);
  }

  for (const name of required) {
    const field = String(name).trim();
    if (!field || hasOwn(normalized, field)) continue;
    if (!warnings.some((w) => w.field === field)) warn(field, "missing");
  }

  return { normalized, warnings };
}

/* ------------------------------------------------------------------------- *
 * ingestBatch
 * ------------------------------------------------------------------------- */

/**
 * Which column carries the per-record PURL/QR slug. Same caveat as FIELD_KINDS:
 * the repo does not say, so this is the set of names that can only mean the
 * slug, and a caller who knows the real column passes `slugField` instead.
 */
export const SLUG_TOKENS = new Set(["RECORDSLUG", "SLUG", "PURL"]);

/** First slug-ish column wins, in the file's own column order. */
function findSlug(record, slugField) {
  if (slugField) {
    const v = hasOwn(record, slugField) ? record[slugField] : null;
    return typeof v === "string" && v !== "" ? v : null;
  }
  for (const key of Object.keys(record)) {
    if (!SLUG_TOKENS.has(fieldToken(key))) continue;
    const v = record[key];
    if (typeof v === "string" && v !== "") return v;
  }
  return null;
}

/**
 * Turn a thrown row failure into a stable snake_case reason.
 *
 * NO MESSAGE TEXT IS CARRIED OUT OF HERE. A Postgres error message quotes the
 * offending value, and the offending value in this table is a consumer's name,
 * address or phone number. A SQLSTATE identifies the fault precisely and cannot
 * leak a single character of anyone's data, so that is what the caller gets.
 */
function rowErrorReason(err) {
  if (err instanceof MailIngestError) return err.code;
  const code = err && err.code;
  if (typeof code === "string" && /^[0-9A-Za-z]{5}$/.test(code)) return `db_error_${code.toLowerCase()}`;
  return "unexpected_error";
}

/* THE UPSERT, LINE BY LINE, BECAUSE EVERY CLAUSE IS LOAD-BEARING.
 *
 * ON CONFLICT (record_slug) — record_slug is declared `text UNIQUE` in
 * 001_init.sql, so the constraint is a valid arbiter. This is what makes
 * re-ingesting a file idempotent: the second run finds the row rather than
 * minting a second copy of the same household.
 *
 * campaign_id = COALESCE(EXCLUDED.campaign_id, existing) — absence is not a
 * correction. A re-ingest that forgot to pass a campaign must not blank the
 * campaign already recorded.
 *
 * fields = existing || EXCLUDED.fields — a jsonb merge, incoming wins per key.
 * A corrected drop that carries only the columns it fixed updates those and
 * leaves the rest standing. The alternative (assign) means any partial file
 * silently empties every column it happens not to contain.
 *
 * suppressed / suppression_reason / responded_at / outcome_tier ARE NOT NAMED.
 * Not in the insert, not in the update. Re-ingesting a file must not
 * un-suppress a record or forget that somebody responded. Those columns belong
 * to passes that run after this one.
 *
 * WHERE mail_universe.org_id = EXCLUDED.org_id — record_slug is UNIQUE GLOBALLY
 * in the schema, not per org. Without this guard, org B ingesting a file that
 * happens to reuse org A's slug would overwrite org A's record and read back as
 * a successful ingest. With it, the update matches nothing, RETURNING yields no
 * row, and the row is refused and reported. (Reported upward too: a global
 * unique on a per-tenant identifier is a schema fact worth someone's attention.)
 *
 * (xmax = 0) — the standard way to tell an INSERT from a DO UPDATE in one round
 * trip. On the insert path xmax is 0; on the update path it holds the locking
 * transaction. Without it, "inserted" and "already there" are indistinguishable
 * and the idempotency claim is untestable.
 */
const UPSERT_SQL = `
  INSERT INTO mail_universe (org_id, campaign_id, record_slug, fields)
  VALUES ($1, $2, $3, $4::jsonb)
  ON CONFLICT (record_slug) DO UPDATE SET
    campaign_id = COALESCE(EXCLUDED.campaign_id, mail_universe.campaign_id),
    fields      = mail_universe.fields || EXCLUDED.fields,
    updated_at  = now()
  WHERE mail_universe.org_id = EXCLUDED.org_id
  RETURNING id, (xmax = 0) AS was_insert
`;

/**
 * ingestBatch(db, { orgId, campaignId, rows, slugField })
 *
 * Normalize and write one batch. Returns
 *   { inserted, updated, skipped, errors: [{ index, reason }], warnings: [{ index, warnings }] }
 *
 * `inserted` is rows that became a new mail_universe row. `updated` is rows
 * that matched an existing record_slug and refreshed it — the second run of an
 * idempotent ingest is all updates and no inserts. `skipped` is rows that
 * produced nothing, and every skip has a matching entry in `errors`, so
 * inserted + updated + skipped always equals rows.length.
 *
 * `updated` and `warnings` are additions to the three keys the task named. The
 * alternative was to compute normalization warnings and drop them on the floor,
 * and to make "already ingested" indistinguishable from "not ingested".
 *
 * *** ONE BAD ROW MUST NOT ABORT THE BATCH. ***
 * So there is deliberately NO transaction around the loop. Each row is its own
 * statement; a row that violates a constraint, carries a value Postgres cannot
 * store, or has no slug is caught, counted and reported, and the next row is
 * attempted. A 40,000-record drop that fails wholesale because one household
 * has a stray byte in it is a worse outcome than 39,999 records and a list of
 * one. The trade is explicit: this batch is NOT atomic, and a caller who needs
 * all-or-nothing must wrap it themselves.
 */
export async function ingestBatch(db, { orgId, campaignId = null, rows = [], slugField = null } = {}) {
  if (!db || typeof db.query !== "function") {
    throw new MailIngestError("ingestBatch: db is required", { code: "db_required" });
  }
  if (!orgId) throw new MailIngestError("ingestBatch: orgId is required", { code: "org_id_required" });
  if (!Array.isArray(rows)) throw new MailIngestError("ingestBatch: rows must be an array", { code: "rows_not_an_array" });

  // An empty campaign is unknown, and unknown is NULL. Storing "" would make
  // idx_mail_campaign index a value that means nothing and read back as a
  // campaign that exists.
  const campaign = campaignId == null ? null : String(campaignId).trim() || null;

  const result = { inserted: 0, updated: 0, skipped: 0, errors: [], warnings: [] };

  for (let index = 0; index < rows.length; index++) {
    try {
      const { normalized, warnings } = normalizeRecord(rows[index]);
      if (warnings.length > 0) result.warnings.push({ index, warnings });

      const slug = findSlug(normalized, slugField);
      if (!slug) {
        // Without a slug there is no idempotency key, so re-ingesting the file
        // would duplicate this household on every run. Refusing the row is the
        // only honest option: the alternative is minting an identifier the
        // vendor never issued, which would then be printed on a mail piece as
        // a PURL that resolves to nothing.
        throw new MailIngestError("row has no record_slug", { code: "missing_record_slug" });
      }

      const res = await db.query(UPSERT_SQL, [orgId, campaign, slug, JSON.stringify(normalized)]);
      if (res.rows.length === 0) {
        throw new MailIngestError("record_slug is already held by another org", {
          code: "record_slug_owned_by_another_org"
        });
      }
      if (res.rows[0].was_insert) result.inserted++;
      else result.updated++;
    } catch (err) {
      result.errors.push({ index, reason: rowErrorReason(err) });
      result.skipped++;
    }
  }

  return result;
}
