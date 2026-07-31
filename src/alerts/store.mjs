// Alerts — the store. The write and read path for `alerts` (078) and
// `upsell_triggers` (079), and the one place the pure rules in evaluate.mjs are
// actually called.
//
// *** WHY THIS FILE EXISTS. ***
//
// 078 and 079 shipped two tables. evaluate.mjs shipped four rules and 57 tests.
// Nothing joined them: no query in this repo touched either table, and no file
// outside src/alerts/ imported an evaluator. An owner setting
// `upsell_triggers.enabled = true` got nothing, ever — the feature read as
// configurable while being entirely inert. This module is the missing middle,
// and it is deliberately the ONLY thing added: the rules did not change, the
// tables did not change.
//
// *** NOTHING HERE TRANSMITS. ***
//
// An alert is a ROW. There is no email, no SMS, no push, no webhook and no
// outbound fetch in this file, and none may be added to it. 078's header says
// it plainly and store.test.mjs asserts it: this records that a human should
// look, it does not notify anybody. Same shape of honesty as
// src/banking/reminders.mjs and src/mail/.
//
// *** NOTHING HERE SCHEDULES. ***
//
// There is no cron, no next_run_at, no sweep. `evaluateAndRaise` runs when a
// caller calls it and takes its `asOf` as an argument. A store whose behaviour
// depends on the wall clock cannot be tested at a boundary.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠️ NOTHING THIS FILE WRITES IS CUSTOMER-FACING.
//
// `alerts.title` is a sentence for the person reading the internal queue. It is
// never shown to a consumer and nothing here may start doing so. This is a
// regulated consumer-finance product: a sentence about somebody's credit, shown
// to that person, is a claim about a credit outcome and needs compliance
// sign-off, not a commit. The titles below are therefore arithmetic statements
// about data already on file — a percentage, a threshold, a reason code — and
// carry no adjective, no recommendation and no projection. evaluate.mjs refuses
// to produce judgements for exactly this reason; this file does not add them
// back on the way to the database.
// ═══════════════════════════════════════════════════════════════════════════════
//
// UNKNOWN IS NOT FALSE, AND UNKNOWN NEVER RAISES. The evaluators return
// true | false | null and null means "we could not tell". A null NEVER produces
// an alert here: a card we cannot read is not evidence that a client is over the
// line, and it is not evidence that they are under it. Those cases come back in
// `skipped` with a reason so the gap is countable instead of invisible.
//
// AN UNSET THRESHOLD REFUSES TO FIRE. 079 ships every rule with `threshold_bps`
// and `threshold_score` NULL on purpose — a threshold nobody approved is a guess
// with a database row around it. `thresholdFromBps` returns null for an unset
// column and this module treats that as "do not fire", never as "use 0.30".
// Falling back to the default would defeat the entire point of that migration.

import {
  thresholdFromBps,
  evaluateUtilization,
  evaluateScore,
  suggestCardUpgrade
} from "./evaluate.mjs";

/**
 * AlertError — a domain failure carrying the HTTP status it should surface as.
 * Same shape as ReminderError (src/banking/reminders.mjs) and ShiftError
 * (src/shifts/store.mjs). 400 by default, because the common case is a caller
 * that left out an id.
 */
export class AlertError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "AlertError";
    this.status = status;
  }
}

/* The vocabularies, frozen. These MUST match the CHECK constraints in
   db/migrations/078_alerts.sql and 079_upsell_triggers.sql; store.pg.test.mjs
   asserts that they do against the live constraints rather than against this
   list, so a new value added to one side and not the other fails a test instead
   of failing a write in production. */
export const ALERT_KINDS = Object.freeze(["utilization_threshold", "score_band", "upsell_opportunity"]);
export const ALERT_STATES = Object.freeze(["open", "acknowledged", "resolved", "dismissed"]);
export const SEVERITIES = Object.freeze(["info", "warning", "critical"]);
export const TRIGGER_RULES = Object.freeze([
  "utilization_over_threshold",
  "score_below_threshold",
  "card_upgrade_case"
]);

/* Which alert kind each configured rule raises. 079's own comments name this
   mapping in prose; here it is once, as data, so the two cannot drift. */
export const RULE_ALERT_KIND = Object.freeze({
  utilization_over_threshold: "utilization_threshold",
  score_below_threshold: "score_band",
  card_upgrade_case: "upsell_opportunity"
});

const ALERT_COLUMNS = `id, org_id, client_id, tradeline_id, assigned_to, kind, severity, state,
                       title, detail, dedupe_key, as_of, raised_at,
                       acknowledged_at, acknowledged_by, resolved_at, resolved_by,
                       dismissed_reason, trigger_id, created_at, updated_at`;

const TRIGGER_COLUMNS = `id, org_id, rule, enabled, threshold_bps, threshold_score, severity,
                         notes, signed_off_at, signed_off_by, created_at, updated_at`;

/* ─────────────────────────── argument reading ─────────────────────────── */

function requireId(value, field) {
  if (value === null || value === undefined || value === "") {
    throw new AlertError(`${field} is required`);
  }
  return value;
}

function requireText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AlertError(`${field} is required and must be a non-empty string`);
  }
  return value.trim();
}

function requireOneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new AlertError(`${field} must be one of ${allowed.join(", ")} — got ${JSON.stringify(value)}`);
  }
  return value;
}

/* A timestamp for the database. Refuses a bare number for the same reason
   src/banking/reminders.mjs does: an epoch in seconds and an epoch in
   milliseconds are indistinguishable at a glance, and guessing wrong dates an
   alert fifty years away from when the data was true. */
function readInstant(value, field, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new AlertError(`${field} is required`);
    return null; // NULL means unknown. It is never coerced to now().
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new AlertError(`${field} is an Invalid Date`);
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new AlertError(`${field} is not a valid timestamp: ${JSON.stringify(value)}`);
    }
    return parsed.toISOString();
  }
  throw new AlertError(`${field} must be a Date or an ISO timestamp string, got ${JSON.stringify(value)}`);
}

/* A whole number inside the column's own CHECK range, or null for unset.
   Refused here rather than left to the constraint so the caller gets a 400 that
   names the field instead of a 500 that names an index. */
function readBoundedInt(value, field, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new AlertError(`${field} must be a whole number between ${min} and ${max}, got ${JSON.stringify(value)}`);
  }
  return n;
}

function readLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new AlertError(`limit must be a positive whole number, got ${JSON.stringify(limit)}`);
  }
  return limit;
}

/* uq_alerts_open_condition is the only unique constraint on `alerts` other than
   the gen_random_uuid() primary key, so a 23505 can only be that index. Matching
   on the SQLSTATE rather than the constraint name means an index created under a
   different name still reads as "already written". Same reasoning as
   src/shifts/store.mjs. */
const isUniqueViolation = (e) => e?.code === "23505";

/* ─────────────────────────── the dedupe key ─────────────────────────── */

/**
 * dedupeKeyFor — a stable string naming the CONDITION, not the occurrence.
 *
 * 078's partial unique index allows exactly one OPEN alert per (org, key), so
 * re-evaluating unchanged data updates nothing instead of stacking a fourth
 * identical row. That only works if the same condition produces the same string
 * every time, which is why this is one function and not a template literal
 * written out at three call sites.
 *
 * The threshold is PART of the condition: a client over a 30% line and the same
 * client over a 50% line are different observations, and an owner who moves the
 * threshold should get a new alert rather than silence.
 */
export function dedupeKeyFor({ kind, clientId, tradelineId, thresholdBps, thresholdScore } = {}) {
  requireOneOf(kind, ALERT_KINDS, "kind");
  const threshold = thresholdBps ?? thresholdScore ?? "";
  return `${kind}:${clientId ?? ""}:${tradelineId ?? ""}:${threshold}`;
}

/* ─────────────────────────── alerts: write ─────────────────────────── */

/**
 * raiseAlert(db, {...}) — write one alert, or return the one already open for
 * that condition.
 *
 * IDEMPOTENT BY THE DATABASE, NOT BY A GUARD SELECT. A check followed by an
 * insert is two statements with a window between them, and two overlapping runs
 * both read "nothing open" and both insert. Only the index settles a race
 * between two writers, so the insert is unconditional with ON CONFLICT DO
 * NOTHING and the read happens only when nothing was written.
 *
 * The conflict target repeats the index's own predicate because
 * uq_alerts_open_condition is PARTIAL — inference will not match it otherwise.
 *
 * @returns {{alert: object, created: boolean}} `created: false` means an alert
 *          for this condition was already open and this call changed nothing.
 */
export async function raiseAlert(
  db,
  { orgId, clientId = null, tradelineId = null, kind, severity = "info", title,
    detail = {}, dedupeKey = null, asOf = null, triggerId = null, assignedTo = null } = {}
) {
  requireId(orgId, "orgId");
  requireOneOf(kind, ALERT_KINDS, "kind");
  requireOneOf(severity, SEVERITIES, "severity");
  const text = requireText(title, "title");
  const at = readInstant(asOf, "asOf");
  const key = dedupeKey === undefined || dedupeKey === "" ? null : dedupeKey;

  const params = [
    orgId, clientId, tradelineId, assignedTo, kind, severity, text,
    JSON.stringify(detail ?? {}), key, at, triggerId
  ];

  let inserted;
  try {
    inserted = await db.query(
      `INSERT INTO alerts
         (org_id, client_id, tradeline_id, assigned_to, kind, severity, title, detail, dedupe_key, as_of, trigger_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
       ON CONFLICT (org_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND state = 'open'
         DO NOTHING
       RETURNING ${ALERT_COLUMNS}`,
      params
    );
  } catch (e) {
    /* ON CONFLICT already covers the only unique index on this table, so a 23505
       escaping it means a DIFFERENT constraint was violated — a schema change
       nobody told this module about. Reported, not swallowed. */
    if (isUniqueViolation(e)) {
      throw new AlertError("that alert conflicts with an existing row", { status: 409 });
    }
    throw e;
  }

  if (inserted.rows.length === 1) return { alert: inserted.rows[0], created: true };

  const existing = await db.query(
    `SELECT ${ALERT_COLUMNS} FROM alerts
      WHERE org_id = $1 AND dedupe_key = $2 AND state = 'open'`,
    [orgId, key]
  );
  if (existing.rows.length === 0) {
    /* DO NOTHING fired but the row is not there — a concurrent resolve between
       the two statements. Saying so beats returning undefined and letting the
       caller dereference it. */
    throw new AlertError("the conflicting alert changed state mid-write — retry", { status: 409 });
  }
  return { alert: existing.rows[0], created: false };
}

/* ─────────────────────────── alerts: read ─────────────────────────── */

/**
 * openAlerts(db, { orgId, limit? }) — the queue screen's read: everything still
 * open in one org, newest first. Backed by idx_alerts_open.
 *
 * READING AN ALERT CHANGES NOTHING. No "surfaced_at" is stamped and no state
 * moves: this is a SELECT. Reading is not acknowledging.
 */
export async function openAlerts(db, { orgId, limit = 100 } = {}) {
  requireId(orgId, "orgId");
  const { rows } = await db.query(
    `SELECT ${ALERT_COLUMNS} FROM alerts
      WHERE org_id = $1 AND state = 'open'
      ORDER BY raised_at DESC, created_at DESC
      LIMIT $2`,
    [orgId, readLimit(limit)]
  );
  return rows;
}

/**
 * alertsForClient(db, { orgId, clientId, limit? }) — one client's alert history,
 * every state, newest first. The client-detail read.
 */
export async function alertsForClient(db, { orgId, clientId, limit = 100 } = {}) {
  requireId(orgId, "orgId");
  requireId(clientId, "clientId");
  const { rows } = await db.query(
    `SELECT ${ALERT_COLUMNS} FROM alerts
      WHERE org_id = $1 AND client_id = $2
      ORDER BY raised_at DESC, created_at DESC
      LIMIT $3`,
    [orgId, clientId, readLimit(limit)]
  );
  return rows;
}

/**
 * getAlert(db, { orgId, alertId }) — one alert, or null.
 *
 * SCOPED TO THE ORG, always. Every read in this module carries org_id in its
 * WHERE clause; an id on its own is not an authorisation to read a row.
 */
export async function getAlert(db, { orgId, alertId } = {}) {
  requireId(orgId, "orgId");
  requireId(alertId, "alertId");
  const { rows } = await db.query(
    `SELECT ${ALERT_COLUMNS} FROM alerts WHERE id = $1 AND org_id = $2`,
    [alertId, orgId]
  );
  return rows[0] ?? null;
}

/* ─────────────────────────── alerts: state ─────────────────────────── */

/* Shared tail for the three transitions: nothing was updated, so say WHICH of
   the two reasons it was. A 404 and a no-op are not the same answer. */
async function explainNoUpdate(db, { orgId, alertId, reason }) {
  const found = await db.query(
    `SELECT ${ALERT_COLUMNS} FROM alerts WHERE id = $1 AND org_id = $2`,
    [alertId, orgId]
  );
  if (found.rows.length === 0) {
    throw new AlertError("no such alert in this org", { status: 404 });
  }
  return { ok: false, reason, alert: found.rows[0] };
}

/**
 * acknowledgeAlert — somebody has seen it and is on it.
 *
 * THE FIRST ACKNOWLEDGEMENT WINS: `acknowledged_at IS NULL` is in the WHERE
 * clause, so a second call cannot overwrite who got there first and two racing
 * calls cannot both claim it. A repeat returns
 * `{ ok: false, reason: "already_acknowledged" }` with the row as it stands —
 * a true answer rather than an error, since the caller's intent is satisfied.
 *
 * ⚠️ CONSEQUENCE WORTH KNOWING: uq_alerts_open_condition is partial on
 * state = 'open', so acknowledging an alert also releases its dedupe key. A
 * later run over the same unchanged data will raise a fresh alert rather than
 * being suppressed. That is 078's decision, recorded here rather than worked
 * around, because the alternative — suppressing on an acknowledged row — would
 * silence a condition that is still true.
 */
export async function acknowledgeAlert(db, { orgId, alertId, at, byId = null } = {}) {
  requireId(orgId, "orgId");
  requireId(alertId, "alertId");
  const when = readInstant(at, "at", { required: true });

  const { rows } = await db.query(
    `UPDATE alerts
        SET state = 'acknowledged', acknowledged_at = $1, acknowledged_by = $2
      WHERE id = $3 AND org_id = $4 AND acknowledged_at IS NULL AND state = 'open'
      RETURNING ${ALERT_COLUMNS}`,
    [when, byId, alertId, orgId]
  );
  if (rows.length === 1) return { ok: true, alert: rows[0] };
  return explainNoUpdate(db, { orgId, alertId, reason: "already_acknowledged" });
}

/**
 * resolveAlert — the underlying condition was dealt with.
 *
 * This is what RELEASES the condition: once state leaves 'open' the partial
 * unique index no longer holds the dedupe key, so the same client going back
 * over the line next quarter raises a new alert instead of being silently
 * suppressed forever. store.pg.test.mjs asserts that against real Postgres.
 */
export async function resolveAlert(db, { orgId, alertId, at, byId = null } = {}) {
  requireId(orgId, "orgId");
  requireId(alertId, "alertId");
  const when = readInstant(at, "at", { required: true });

  const { rows } = await db.query(
    `UPDATE alerts
        SET state = 'resolved', resolved_at = $1, resolved_by = $2
      WHERE id = $3 AND org_id = $4 AND resolved_at IS NULL
      RETURNING ${ALERT_COLUMNS}`,
    [when, byId, alertId, orgId]
  );
  if (rows.length === 1) return { ok: true, alert: rows[0] };
  return explainNoUpdate(db, { orgId, alertId, reason: "already_resolved" });
}

/**
 * dismissAlert — a human decided it did not matter.
 *
 * NOT THE SAME AS RESOLVED, and the difference is the whole point (078's words):
 * a pile of dismissed alerts of one kind is the signal that the threshold behind
 * it is wrong. `resolved_at` is therefore left NULL here.
 *
 * NO `at` AND NO `byId`. 078 has no dismissed_at and no dismissed_by column.
 * Writing the actor into `resolved_by` to have somewhere to put it would make
 * the two states indistinguishable in the data, which is exactly what the table
 * was built to avoid. `updated_at` records when. Who is an absence — reported,
 * not filled in.
 *
 * `reason` is optional and NULL when omitted: a dismissal nobody explained is
 * itself worth being able to count.
 */
export async function dismissAlert(db, { orgId, alertId, reason = null } = {}) {
  requireId(orgId, "orgId");
  requireId(alertId, "alertId");
  const why = reason === null || reason === undefined || String(reason).trim() === ""
    ? null
    : String(reason).trim();

  const { rows } = await db.query(
    `UPDATE alerts
        SET state = 'dismissed', dismissed_reason = $1
      WHERE id = $2 AND org_id = $3 AND state <> 'dismissed' AND resolved_at IS NULL
      RETURNING ${ALERT_COLUMNS}`,
    [why, alertId, orgId]
  );
  if (rows.length === 1) return { ok: true, alert: rows[0] };
  return explainNoUpdate(db, { orgId, alertId, reason: "not_dismissable" });
}

/* ─────────────────────────── upsell_triggers ─────────────────────────── */

/**
 * setTrigger(db, {...}) — the owner's configuration surface for one rule.
 *
 * ONE ROW PER RULE PER ORG, enforced by uq_upsell_triggers_org_rule; a second
 * row would be a second threshold and nothing could say which one applied. So
 * this upserts rather than inserting.
 *
 * SHIPS OFF AND UNSET. Omitting `enabled` gives false and omitting a threshold
 * gives NULL, matching 079's own defaults: a rule that arrived switched on would
 * start flagging real clients' credit on a number nobody chose.
 */
export async function setTrigger(
  db,
  { orgId, rule, enabled = false, thresholdBps = null, thresholdScore = null,
    severity = "info", notes = null, signedOffAt = null, signedOffBy = null } = {}
) {
  requireId(orgId, "orgId");
  requireOneOf(rule, TRIGGER_RULES, "rule");
  requireOneOf(severity, SEVERITIES, "severity");
  if (typeof enabled !== "boolean") {
    throw new AlertError(`enabled must be true or false, got ${JSON.stringify(enabled)}`);
  }
  // The same ranges 079's CHECKs enforce, refused here so the caller gets a 400
  // naming the field rather than a 500 naming a constraint.
  const bps = readBoundedInt(thresholdBps, "thresholdBps", 0, 100_000);
  const score = readBoundedInt(thresholdScore, "thresholdScore", 300, 850);
  const signedAt = readInstant(signedOffAt, "signedOffAt");

  const { rows } = await db.query(
    `INSERT INTO upsell_triggers
       (org_id, rule, enabled, threshold_bps, threshold_score, severity, notes, signed_off_at, signed_off_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (org_id, rule) DO UPDATE
       SET enabled = EXCLUDED.enabled,
           threshold_bps = EXCLUDED.threshold_bps,
           threshold_score = EXCLUDED.threshold_score,
           severity = EXCLUDED.severity,
           notes = EXCLUDED.notes,
           signed_off_at = EXCLUDED.signed_off_at,
           signed_off_by = EXCLUDED.signed_off_by
     RETURNING ${TRIGGER_COLUMNS}`,
    [orgId, rule, enabled, bps, score, severity, notes, signedAt, signedOffBy]
  );
  return rows[0];
}

/** listTriggers(db, { orgId }) — every configured rule for an org, on or off. */
export async function listTriggers(db, { orgId } = {}) {
  requireId(orgId, "orgId");
  const { rows } = await db.query(
    `SELECT ${TRIGGER_COLUMNS} FROM upsell_triggers WHERE org_id = $1 ORDER BY rule ASC`,
    [orgId]
  );
  return rows;
}

/** enabledTriggers(db, { orgId }) — the live rules for one org. Backed by
 *  idx_upsell_triggers_enabled. */
export async function enabledTriggers(db, { orgId } = {}) {
  requireId(orgId, "orgId");
  const { rows } = await db.query(
    `SELECT ${TRIGGER_COLUMNS} FROM upsell_triggers WHERE org_id = $1 AND enabled ORDER BY rule ASC`,
    [orgId]
  );
  return rows;
}

/* ─────────────────────────── the crossing ─────────────────────────── */

/* The titles. Internal queue text — see the banner at the top of this file. Each
   one restates numbers already on file and nothing else: no adjective about the
   client's credit, no recommendation, no projection. */
const pct = (n) => (n === null || n === undefined ? "unknown" : `${n}%`);

function utilizationTitle(result, thresholdBps) {
  return `Total utilization is ${pct(result.utilizationPct)}, over the configured ${pct(thresholdBps / 100)} threshold.`;
}

function scoreTitle(result, thresholdScore) {
  const band = result.band ? ` (band ${result.band})` : "";
  return `Credit score on file is ${result.score}${band}, below the configured threshold of ${thresholdScore}.`;
}

function upsellTitle(result) {
  const codes = result.reasons.map((r) => r.code).join(", ");
  return `Card-upgrade case on file: ${codes}.`;
}

/**
 * evaluateAndRaise(db, {...}) — read the org's ENABLED rules, run the pure
 * evaluators against the data the caller passed, and write an alert for each
 * rule whose condition is definitely true.
 *
 * THIS IS THE FUNCTION THE FINDING WAS ABOUT. Before it existed, `enabled = true`
 * changed nothing anywhere in the system.
 *
 * PURE IN, ROWS OUT. It does not go and fetch the client's tradelines or score —
 * the caller passes them, exactly as evaluate.mjs's own functions take their
 * inputs. That keeps the only I/O in this file the two tables it owns, and keeps
 * this testable without standing up every upstream table.
 *
 * NOTHING FIRES ON AN UNKNOWN AND NOTHING FIRES ON AN UNSET THRESHOLD. Both come
 * back in `skipped` with a reason rather than as silence, so "no alerts" can be
 * told apart from "we could not tell".
 *
 * @param {object} db
 * @param {object} args
 * @param {string} args.orgId
 * @param {string} args.clientId
 * @param {Array}  [args.tradelines]  `tradelines` rows for the client
 * @param {number|string|null} [args.score]
 * @param {number|null} [args.targetAmountCents]  only used by card_upgrade_case
 * @param {string|Date|null} [args.asOf]  when the underlying data was true.
 *        NULL means the source carried no as-of date — unknown, not "now".
 * @returns {{raised: Array, skipped: Array}}
 */
export async function evaluateAndRaise(
  db,
  { orgId, clientId, tradelines = [], score = null, targetAmountCents = null, asOf = null } = {}
) {
  requireId(orgId, "orgId");
  requireId(clientId, "clientId");

  const triggers = await enabledTriggers(db, { orgId });
  const raised = [];
  const skipped = [];

  const skip = (rule, reason) => { skipped.push({ rule, reason }); };

  for (const t of triggers) {
    // enabledTriggers already filters in SQL. Checked again because a row that
    // arrived disabled must not fire on the strength of the query alone.
    if (t.enabled !== true) continue;
    if (!TRIGGER_RULES.includes(t.rule)) continue;

    const kind = RULE_ALERT_KIND[t.rule];
    const severity = SEVERITIES.includes(t.severity) ? t.severity : "info";

    if (t.rule === "utilization_over_threshold" || t.rule === "card_upgrade_case") {
      const threshold = thresholdFromBps(t.threshold_bps);
      if (threshold === null) { skip(t.rule, "threshold_unset"); continue; }

      if (t.rule === "utilization_over_threshold") {
        const result = evaluateUtilization(tradelines, { threshold });
        if (result.over === null) { skip(t.rule, "utilization_unknown"); continue; }
        if (result.over === false) { skip(t.rule, "condition_false"); continue; }
        const out = await raiseAlert(db, {
          orgId, clientId, kind, severity, triggerId: t.id, asOf,
          title: utilizationTitle(result, t.threshold_bps),
          detail: result,
          dedupeKey: dedupeKeyFor({ kind, clientId, thresholdBps: t.threshold_bps })
        });
        raised.push({ rule: t.rule, kind, ...out });
        continue;
      }

      const result = suggestCardUpgrade({ tradelines }, { threshold, targetAmountCents });
      if (result.suggest === null) { skip(t.rule, "upsell_unknown"); continue; }
      if (result.suggest === false) { skip(t.rule, "condition_false"); continue; }
      const out = await raiseAlert(db, {
        orgId, clientId, kind, severity, triggerId: t.id, asOf,
        title: upsellTitle(result),
        detail: result,
        dedupeKey: dedupeKeyFor({ kind, clientId, thresholdBps: t.threshold_bps })
      });
      raised.push({ rule: t.rule, kind, ...out });
      continue;
    }

    // score_below_threshold
    const thresholdScore = t.threshold_score;
    if (thresholdScore === null || thresholdScore === undefined) { skip(t.rule, "threshold_unset"); continue; }
    const result = evaluateScore(score);
    // A score we do not have is not a score below the line. It gets a reason,
    // not an alert.
    if (!result.known) { skip(t.rule, "score_unknown"); continue; }
    // Strictly below, so a score sitting exactly ON the threshold does not fire —
    // the same boundary convention isOver() uses for utilization.
    if (result.score >= thresholdScore) { skip(t.rule, "condition_false"); continue; }
    const out = await raiseAlert(db, {
      orgId, clientId, kind, severity, triggerId: t.id, asOf,
      title: scoreTitle(result, thresholdScore),
      detail: result,
      dedupeKey: dedupeKeyFor({ kind, clientId, thresholdScore })
    });
    raised.push({ rule: t.rule, kind, ...out });
  }

  return { raised, skipped };
}
