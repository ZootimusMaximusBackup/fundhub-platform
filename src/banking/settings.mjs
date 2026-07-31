// Cash-flow thresholds — the one place that reads `cashflow_settings` and turns
// it into the `thresholds` argument src/banking/cashflow.mjs takes.
//
// WHY THIS IS A SEPARATE FILE. cashflow.mjs is pure: no I/O, no database, no
// clock. That is what makes a projection testable at a boundary and what let it
// be finished before the tables it consumes existed. Reading a row is I/O, so it
// cannot live there. This module is the seam, and it is deliberately thin —
// it reads one row and reshapes it. It contains no arithmetic and no policy.
//
// *** NULL IN THE COLUMN MEANS THE KEY IS ABSENT FROM THE OBJECT. ***
// This is the whole point of the file and the easiest thing to get wrong. A NULL
// `settlement_lead_days` must NOT arrive at the model as `settlementLeadDays: 0`,
// because zero is a decision — it asserts a payment posts the same day, which is
// a claim about payment rails that is often false and whose cost is a missed
// payment. An absent key makes the model report the gap; a zero makes it answer
// confidently and possibly wrongly. Deleting a value has to return the system to
// "nobody has decided this".
//
// NUMERIC COLUMNS COME BACK FROM node-postgres AS STRINGS. `confidence_floor` is
// numeric(4,3) and arrives as "0.800"; `min_buffer_cents` is bigint and arrives
// as "0". cashflow.mjs REFUSES strings for money on purpose — money.mjs reads
// "1050" as a thousand and fifty dollars, and two readings of one string a
// factor of 100 apart is exactly the hazard it is guarding. So the conversion
// happens here, at the boundary, deliberately, and it is the reason this file
// exists rather than the caller passing the row straight through.

/** Thrown when a stored setting is not the kind of thing the column promised. */
export class SettingsError extends Error {
  constructor(message, { status = 500 } = {}) {
    super(message);
    this.name = "SettingsError";
    this.status = status;
  }
}

/* A bigint column arrives as a string. Anything with a fraction in it is not a
   count of cents and must not be rounded into one silently. */
function centsFromColumn(value, field) {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(n)) {
    throw new SettingsError(`cashflow_settings.${field} is not an integer number of cents: ${JSON.stringify(value)}`);
  }
  return n;
}

function fractionFromColumn(value, field) {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new SettingsError(`cashflow_settings.${field} is not a fraction between 0 and 1: ${JSON.stringify(value)}`);
  }
  return n;
}

function daysFromColumn(value, field) {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new SettingsError(`cashflow_settings.${field} is not a whole number of days: ${JSON.stringify(value)}`);
  }
  return n;
}

/**
 * loadThresholds(db, { orgId }) — the `thresholds` object for cashflow.mjs.
 *
 * An org with no row gets `{}`, which is the same thing an org whose every value
 * is NULL gets, and it is the correct answer for both: nothing has been decided,
 * so the model reports every threshold as a gap. NO ROW IS CREATED HERE — a read
 * that writes a default row would bake "somebody decided zero" into the database
 * on first read, which is the exact failure this module is shaped to avoid.
 *
 * @returns {{minBufferCents?: number, confidenceFloor?: number, settlementLeadDays?: number}}
 *          Keys are ABSENT, not null, when unset. cashflow.mjs treats both the
 *          same way, but an absent key cannot be mistaken for a decision by
 *          anything else that reads this object.
 */
export async function loadThresholds(db, { orgId } = {}) {
  if (!orgId) throw new SettingsError("orgId is required", { status: 400 });
  const { rows } = await db.query(
    `SELECT min_buffer_cents, confidence_floor, settlement_lead_days
       FROM cashflow_settings WHERE org_id = $1`,
    [orgId]
  );
  if (rows.length === 0) return {};

  const row = rows[0];
  const out = {};
  const buffer = centsFromColumn(row.min_buffer_cents, "min_buffer_cents");
  if (buffer !== null) out.minBufferCents = buffer;
  const floor = fractionFromColumn(row.confidence_floor, "confidence_floor");
  if (floor !== null) out.confidenceFloor = floor;
  const lead = daysFromColumn(row.settlement_lead_days, "settlement_lead_days");
  if (lead !== null) out.settlementLeadDays = lead;
  return out;
}

/**
 * configGaps(db, { orgId? }) — every threshold that is unset, or set but not yet
 * signed off by a human, with what being wrong about it costs.
 *
 * Reads `v_cashflow_config_gaps`. A value is reported even when it HAS one,
 * until somebody signs it off — 052's rule, that a default which stops being
 * visible is a default nobody re-examines.
 */
export async function configGaps(db, { orgId } = {}) {
  const params = [];
  let scope = "";
  if (orgId) {
    params.push(orgId);
    scope = ` WHERE org_id = $1`;
  }
  const { rows } = await db.query(
    `SELECT org_id, setting, value, status, consequence
       FROM v_cashflow_config_gaps${scope}
      ORDER BY setting`,
    params
  );
  return rows;
}
