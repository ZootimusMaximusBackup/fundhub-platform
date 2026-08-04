// Staff telemetry — the writer for `staff_events`, a table that has never had one.
//
// `staff_events` has existed since db/schema/001_init.sql:404. Nothing wrote to
// it. This module is that writer, and nothing more: one function that appends
// one row saying "this person did this thing, at this time, on this shift".
//
// THE COLUMNS ARE kind AND detail. Not event_type / event_data. Every statement
// below uses the real names, and telemetry.test.mjs asserts on the text of the
// SQL specifically so a later rename-by-assumption fails loudly instead of
// producing an INSERT that Postgres rejects at runtime in production.
//
// *** TELEMETRY MUST NEVER FAIL THE BUSINESS ACTION IT IS OBSERVING. ***
// This is the whole design constraint. A `staff_events` row is a record of work
// that already happened; the work is the fact, the row is an index over it. If
// this module throws into a call site, then a bad shift_id, a dropped
// connection or a typo in a `kind` takes down the letter that was issued, the
// call that was logged or the pull that was run — the thing the observer exists
// to observe. So logStaffEvent() DOES NOT THROW. Ever. It returns a verdict
// object and writes the failure to console.error, exactly as
// src/handlers/comms.mjs threadMessage() already does for conversation
// threading and for the same reason spelled out in its header.
//
// The consequence, stated plainly so nobody is surprised by it: a call site
// that ignores the return value cannot tell a written row from a swallowed
// failure. That is the correct trade for telemetry and the wrong one for
// anything that is itself the record — hours (src/shifts/store.mjs) and money
// (src/shifts/timesheet.mjs, src/commissions/) both throw, deliberately.
// assertKind() is exported for tests and dev-time checks that DO want a throw.
//
// NO EVENT IS EMITTED HERE. `staff_events` is a table written directly, not a
// bus stream — the same split src/auth/PROPOSED-EVENTS.md describes ("`staff_events`
// (001_init.sql) is a table written directly, not an event stream"). There is
// no canonical event whose subject is a staff member, and per the repo
// convention names are not added to src/events/canonical.mjs unilaterally. No
// new name is needed for this module, so none is proposed.
//
// NOTHING HERE RESOLVES THE OPEN SHIFT. shift_id is passed in or it is NULL.
// Looking up the caller's open shift inside this function would attach work to
// a shift the caller never named, which is a guess about whose clock the work
// belongs on — and `staff_events.shift_id` is nullable precisely because "not
// linked to a shift" is a legitimate, honest state. A caller that wants the
// link reads currentShift() from ./store.mjs and passes the id.

/**
 * EVENT_KINDS — the exact vocabulary from the `kind` column comment in
 * db/schema/001_init.sql:408:
 *
 *   kind text NOT NULL,   -- file_touched | pull_run | letter_issued | text_sent | call_made | ...
 *
 * The original five names plus Hubstaff monitor kinds. The trailing `...` in that comment is an ellipsis, not a sixth
 * kind, and it is NOT read here as licence to mint new ones: there is no CHECK
 * constraint and no catalog table on `kind`, so this array is the only thing
 * standing between the column and free text. A vocabulary that grows by
 * accident is a vocabulary nothing can be counted by.
 *
 * Adding a name here is a deliberate act that belongs to whoever owns the
 * telemetry spec, not to a call site that needed a word. If you need a kind
 * that is not in this list, report it rather than appending it.
 *
 * KNOWN GAP: db/migrations/060 / src/shifts/store.mjs autoCloseStale() writes
 * kind = 'shift_auto_closed' straight through its own SQL. That token is not in
 * this list and is deliberately not added — it is a different module's, it is
 * not in the 001_init.sql comment, and inventing agreement between two writers
 * by copying a string is how vocabularies drift. The consequence is real and
 * intended: logStaffEvent() would refuse to write that kind. Reconciling the
 * two lists is a decision for whoever owns the vocabulary.
 */
export const EVENT_KINDS = Object.freeze([
  "file_touched",
  "pull_run",
  "letter_issued",
  "text_sent",
  "call_made",
  "monitor_activity",
  "monitor_screenshot"
]);

const KIND_SET = new Set(EVENT_KINDS);

/** Is this one of the catalogued kinds? Pure, total, no throw. */
export const isEventKind = (kind) => KIND_SET.has(kind);

/**
 * assertKind — the throwing half of the validation, for tests and for dev-time
 * checks at a call site that wants to fail fast. logStaffEvent() does NOT use
 * this; it refuses quietly, because a throw here would defeat the entire point
 * of the module (see the header).
 */
export function assertKind(kind) {
  if (!isEventKind(kind)) {
    throw new TypeError(
      `assertKind: unknown staff_events kind: ${JSON.stringify(kind)} ` +
      `(known: ${EVENT_KINDS.join(", ")})`
    );
  }
  return kind;
}

/* The INSERT reads org_id off the staff row rather than writing the caller's.
   Same reasoning as clockIn() in ./store.mjs: both columns are plain FKs, so a
   mismatched (org_id, staff_id) pair inserts happily and files one person's
   activity under an org they do not work for. The caller's orgId is used as a
   FILTER when supplied — it must agree — and the value stored is always the one
   the staff row itself carries.

   orgId is optional for exactly one reason: several of the call sites this
   module exists for (see TELEMETRY-CALLSITES.md) have a staff id in hand and no
   org, and requiring them to fetch one would make them invent it. Omitting it
   is safe here in a way it is not in clockIn(), because the stored value never
   came from the argument in the first place. */
const INSERT_SQL = `
  INSERT INTO staff_events (org_id, staff_id, shift_id, kind, detail)
  SELECT s.org_id, s.id, $3::uuid, $4::text, $5::jsonb
    FROM staff s
   WHERE s.id = $1::uuid
     AND ($2::uuid IS NULL OR s.org_id = $2::uuid)
  RETURNING id, org_id, staff_id, shift_id, kind, detail, created_at`;

/** A plain JSON object — not null, not an array, not a scalar. `detail` is
 *  `jsonb NOT NULL DEFAULT '{}'::jsonb`; a bare string or number is valid jsonb
 *  but would make every reader of this column handle two shapes. */
const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** One place that decides how a swallowed failure is announced, so the prefix
 *  and the shape cannot drift between the six exits below. */
function swallow(reason, context, err) {
  console.error(
    `[telemetry] staff_events write skipped (${reason})` +
    (context ? ` ${context}` : "") +
    (err ? `: ${err.message}` : "")
  );
  return { logged: false, reason };
}

/**
 * logStaffEvent(db, { orgId, staffId, shiftId, kind, detail }) — append one
 * `staff_events` row.
 *
 * Returns `{ logged: true, event }` or `{ logged: false, reason }`.
 * NEVER THROWS and never rejects. See the header.
 *
 *   orgId    optional. A filter only; the org stored is the staff row's own.
 *   staffId  required — staff_events.staff_id is NOT NULL.
 *   shiftId  optional — the column is a nullable FK, and "not on a shift" is a
 *            real answer, not a missing one.
 *   kind     required, must be one of EVENT_KINDS.
 *   detail   optional plain object, defaults to {} (the column's own default).
 *
 * Reasons a write is skipped, all logged:
 *   missing_staff_id | unknown_kind | invalid_detail | undetailable
 *   staff_not_found  | write_failed
 *
 * `staff_not_found` covers both "no such staff id" and "that staff member is
 * not in the org you named" — the two are one zero-row result and are not
 * distinguished, because a telemetry writer has no business being an oracle for
 * which staff ids exist in which org.
 */
export async function logStaffEvent(db, { orgId, staffId, shiftId, kind, detail } = {}) {
  try {
    if (!staffId) {
      return swallow("missing_staff_id", `kind=${JSON.stringify(kind)}`);
    }
    if (!isEventKind(kind)) {
      return swallow("unknown_kind", `kind=${JSON.stringify(kind)} staff=${staffId}`);
    }

    const payload = detail === undefined || detail === null ? {} : detail;
    if (!isPlainObject(payload)) {
      return swallow("invalid_detail", `kind=${kind} staff=${staffId}`);
    }

    // Serialised before the query so a circular or unserialisable detail is a
    // skipped row rather than a throw out of db.query's parameter binding.
    let json;
    try {
      json = JSON.stringify(payload);
    } catch (err) {
      return swallow("undetailable", `kind=${kind} staff=${staffId}`, err);
    }

    const res = await db.query(INSERT_SQL, [
      staffId,
      orgId ?? null,
      shiftId ?? null,
      kind,
      json
    ]);

    const event = (res && res.rows ? res.rows[0] : null) || null;
    if (!event) {
      return swallow("staff_not_found", `kind=${kind} staff=${staffId}`);
    }
    return { logged: true, event };
  } catch (err) {
    // Everything reaches here: a dropped connection, a shift_id that does not
    // exist (23503), a statement timeout. None of them is the caller's problem.
    return swallow("write_failed", `kind=${String(kind)} staff=${String(staffId)}`, err);
  }
}
