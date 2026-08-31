// Retention policy reader — the one place that reads `retention_policy` and
// turns it into something the purge runner can act on.
//
// WHY THIS IS A SEPARATE FILE, and why it is thin. Same seam as
// src/banking/settings.mjs: reading a row is I/O, deciding what to purge is
// policy, and running the purge is a command. Keeping the read here means the
// class rules in src/retention/classes.mjs stay pure and testable without a
// database, and the runner in scripts/retention-purge.mjs stays a CLI.
//
// *** NULL IN retain_days MEANS THE KEY IS ABSENT FROM THE OBJECT. ***
// This is the whole point of the file and the easiest thing to get wrong. A NULL
// retention period must NOT arrive at the runner as `retainDays: 0`, because
// zero is a decision — it says "everything older than right now is expired",
// which would purge the entire table on the first --apply. An absent key makes
// the runner SKIP the class and report it; a zero makes it destroy consumer
// records. src/banking/settings.mjs guards the identical hazard for cash-flow
// thresholds and the reasoning transfers exactly.
//
// integer columns come back from node-postgres as numbers, but `retain_days` is
// read through the same defensive conversion the settings reader uses, because a
// value that is not a whole number of days is not a retention period and must not
// be rounded into one silently.

/** Thrown when a stored policy is not the kind of thing the column promised. */
export class RetentionError extends Error {
  constructor(message, { status = 500 } = {}) {
    super(message);
    this.name = "RetentionError";
    this.status = status;
  }
}

/* The six classes, in the order a report should read them: most sensitive
   first. These strings are the same closed set the CHECK constraint in
   db/migrations/100_retention_policy.sql enforces — widened to six by
   db/migrations/275_decline_autopsy.sql. scripts/retention-purge.pg.test.mjs
   fails if this list and the constraint ever disagree, because a class that
   exists in only one of the two places is a policy that governs nothing.

   broker_upload_rows is REGISTERED BUT NEVER PURGED. Owner-set 2026-08-31
   (docs/specs/W0-decisions.md): declined-deal rows a broker uploads are retained
   in full and no purge schedule is configured. Its policy row carries
   action = 'retain' with retain_days NULL, which loadPolicy() reports as ABSENT,
   so the runner skips it and removes nothing. It is here so it is counted and
   auditable, not so it is destroyed on a clock. */
export const DATA_CLASSES = Object.freeze([
  "crs_raw_payloads",
  "pii_access_log",
  "soft_pull_ledger",
  "bank_transactions",
  "mock_data",
  "broker_upload_rows"
]);

/* A retention period is a whole number of days, at least one. Anything else is
   refused rather than coerced. Zero is refused here as well as by the column's
   CHECK, because this reader is what the runner trusts and a zero that reached it
   would mean "purge everything". */
function daysFromColumn(value, dataClass) {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new RetentionError(
      `retention_policy.retain_days for ${dataClass} is not a whole number of days >= 1: ${JSON.stringify(value)}`
    );
  }
  return n;
}

/**
 * loadPolicy(db, { orgId }) — every retention policy row for one org.
 *
 * @returns {Map<string, {dataClass: string, action: string, retainDays?: number,
 *                        signedOffAt: Date|null, signedOffBy: string|null}>}
 *
 * `retainDays` is ABSENT, not null, when unset. That is deliberate and it is the
 * contract the runner depends on: `"retainDays" in policy` is the question "has
 * anybody decided this", and it must not be answerable by a zero.
 *
 * An org with no rows gets an empty Map, which is the same answer an org whose
 * every period is NULL effectively gets: nothing has been decided, so nothing is
 * purged. NO ROW IS CREATED HERE. A read that writes a default row would bake
 * "somebody decided" into the database on first read — the exact failure
 * src/banking/settings.mjs is shaped to avoid.
 */
export async function loadPolicy(db, { orgId } = {}) {
  if (!orgId) throw new RetentionError("orgId is required", { status: 400 });

  const { rows } = await db.query(
    `SELECT data_class, retain_days, action, signed_off_at, signed_off_by
       FROM retention_policy
      WHERE org_id = $1`,
    [orgId]
  );

  const out = new Map();
  for (const row of rows) {
    const entry = {
      dataClass: row.data_class,
      action: row.action,
      signedOffAt: row.signed_off_at ?? null,
      signedOffBy: row.signed_off_by ?? null
    };
    const days = daysFromColumn(row.retain_days, row.data_class);
    // Absent, not null. See the header.
    if (days !== null) entry.retainDays = days;
    out.set(row.data_class, entry);
  }
  return out;
}

/**
 * policyGaps(db, { orgId? }) — every class that is unset, or set but not signed
 * off, or missing a policy row entirely, with what being wrong about it costs.
 *
 * Reads `v_retention_policy_gaps`. A class is reported even when it HAS a period,
 * until somebody signs it off — 052's rule, that a default which stops being
 * visible is a default nobody re-examines.
 */
export async function policyGaps(db, { orgId } = {}) {
  const params = [];
  let scope = "";
  if (orgId) {
    params.push(orgId);
    scope = ` WHERE org_id = $1`;
  }
  const { rows } = await db.query(
    `SELECT org_id, data_class, setting, value, action, status, consequence
       FROM v_retention_policy_gaps${scope}
      ORDER BY data_class, setting`,
    params
  );
  return rows;
}
