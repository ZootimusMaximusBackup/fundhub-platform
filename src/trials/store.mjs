// Reads and writes for live_trials and live_trial_events.
//
// EVERY QUERY CARRIES org_id AND, WHERE THERE IS ONE, partner_id. These tables
// have no row-level security — 280_live_trials.sql says why — so the predicate
// written here IS the tenancy boundary. A read that forgets it returns another
// buyer's dashboard, which is the worst bug this module can produce.
//
// PARAMETERISED, NEVER INTERPOLATED. No identifier and no value is built by
// string concatenation anywhere below.
//
// NULL SURVIVES. started_at NULL means "the ads have not served yet" and is
// never coalesced to now(); remedy NULL means "not evaluated" and is never
// coalesced to an empty grant. Both distinctions are load-bearing on the
// dashboard and on the day-8 call.

import { TRIAL_STATUS, TRIAL_STATUSES, FREEZE_DAYS, TRIAL_DAYS } from "./constants.mjs";
import { startClock, frozenUntil } from "./clock.mjs";

const COLUMNS = `
  id, org_id, partner_id, affiliate_id, contact_email, status, price_cents,
  held_start, eligibility, paid_at, provisioned_at, verification_confirmed_at,
  started_at, ends_at, frozen_until, converted_at, declined_at, refunded_at,
  remedy, notes, created_at, updated_at`;

function requireOrg(orgId, where) {
  if (!orgId) throw new TypeError(`${where}: orgId is required`);
}

function assertStatus(status, where) {
  if (!TRIAL_STATUSES.includes(status)) {
    throw new TypeError(`${where}: unknown trial status "${status}"`);
  }
}

/** getTrialByPartner(db, { orgId, partnerId }) → row | null */
export async function getTrialByPartner(db, { orgId, partnerId } = {}) {
  requireOrg(orgId, "getTrialByPartner");
  if (!partnerId) throw new TypeError("getTrialByPartner: partnerId is required");
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM live_trials WHERE org_id = $1 AND partner_id = $2 LIMIT 1`,
    [orgId, partnerId]
  );
  return (rows && rows[0]) || null;
}

/** getTrial(db, { orgId, id }) → row | null. Org-scoped, so an id copied from
    somewhere else answers "not found" rather than handing over a record. */
export async function getTrial(db, { orgId, id } = {}) {
  requireOrg(orgId, "getTrial");
  if (!id) throw new TypeError("getTrial: id is required");
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM live_trials WHERE org_id = $1 AND id = $2 LIMIT 1`,
    [orgId, id]
  );
  return (rows && rows[0]) || null;
}

/** listTrials(db, { orgId, status, limit }) → rows. Staff view. */
export async function listTrials(db, { orgId, status = null, limit = 100 } = {}) {
  requireOrg(orgId, "listTrials");
  const params = [orgId];
  let where = "org_id = $1";
  if (status) {
    assertStatus(status, "listTrials");
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  const n = Number(limit);
  const capped = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 500) : 100;
  params.push(capped);
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM live_trials
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return rows || [];
}

/**
 * createTrial(db, {...}) → row.
 *
 * Written inside the provisioning transaction. A second call for the same
 * partner does not create a second trial — live_trials_partner_uniq forbids it,
 * and the existing row is returned instead, so a retried checkout webhook is
 * harmless.
 */
export async function createTrial(db, {
  orgId,
  partnerId,
  affiliateId = null,
  contactEmail,
  status = TRIAL_STATUS.PROVISIONED,
  priceCents,
  heldStart = false,
  eligibility = {},
  paidAt = null,
  provisionedAt = null,
  notes = null
} = {}) {
  requireOrg(orgId, "createTrial");
  if (!partnerId) throw new TypeError("createTrial: partnerId is required");
  if (!contactEmail) throw new TypeError("createTrial: contactEmail is required");
  assertStatus(status, "createTrial");
  if (priceCents == null || !Number.isInteger(priceCents) || priceCents < 0) {
    throw new TypeError("createTrial: priceCents must be a non-negative integer number of cents");
  }

  const { rows } = await db.query(
    `INSERT INTO live_trials
       (org_id, partner_id, affiliate_id, contact_email, status, price_cents,
        held_start, eligibility, paid_at, provisioned_at, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
     ON CONFLICT (partner_id) DO UPDATE SET
       -- A repeat provision fills in what was missing and changes nothing that
       -- was already true. It must never re-open a converted or declined trial.
       affiliate_id  = COALESCE(live_trials.affiliate_id, EXCLUDED.affiliate_id),
       paid_at       = COALESCE(live_trials.paid_at, EXCLUDED.paid_at),
       provisioned_at = COALESCE(live_trials.provisioned_at, EXCLUDED.provisioned_at),
       updated_at    = now()
     RETURNING ${COLUMNS}`,
    [
      orgId, partnerId, affiliateId, String(contactEmail).trim().toLowerCase(),
      status, priceCents, !!heldStart, JSON.stringify(eligibility || {}),
      paidAt, provisionedAt, notes
    ]
  );
  return (rows && rows[0]) || null;
}

/**
 * startTrialClock(db, { orgId, partnerId, firstImpressionAt }) → row | null.
 *
 * THE ONLY PLACE started_at IS EVER SET. Called from the platform sync when the
 * first impression is recorded — not from checkout, not from provisioning.
 *
 * IDEMPOTENT AND ONE-WAY. The WHERE clause requires started_at IS NULL, so a
 * second sync of the same day's metrics cannot re-date a trial that is already
 * on day four. Returns null when there was nothing to start, which the caller
 * should treat as "already running", not as a failure.
 */
export async function startTrialClock(db, {
  orgId, partnerId, firstImpressionAt, days = TRIAL_DAYS, freezeDays = FREEZE_DAYS
} = {}) {
  requireOrg(orgId, "startTrialClock");
  if (!partnerId) throw new TypeError("startTrialClock: partnerId is required");
  const clock = startClock(firstImpressionAt, { days });
  if (!clock) throw new TypeError("startTrialClock: firstImpressionAt must be a real moment");
  const freeze = frozenUntil(clock.endsAt, { days: freezeDays });

  const { rows } = await db.query(
    `UPDATE live_trials
        SET started_at = $3,
            ends_at = $4,
            frozen_until = $5,
            status = 'running',
            verification_confirmed_at = COALESCE(verification_confirmed_at, now()),
            updated_at = now()
      WHERE org_id = $1
        AND partner_id = $2
        AND started_at IS NULL
        AND status IN ('held_start', 'provisioned')
      RETURNING ${COLUMNS}`,
    [orgId, partnerId, clock.startsAt, clock.endsAt, freeze]
  );
  return (rows && rows[0]) || null;
}

/**
 * setTrialStatus(db, { orgId, id, status, ... }) → row | null.
 *
 * The stamps travel with the status because the CHECK constraints in
 * 280_live_trials.sql refuse a status without its moment. Passing them
 * separately would let a caller write 'converted' with no converted_at and get
 * a constraint error instead of a record.
 */
export async function setTrialStatus(db, {
  orgId, id, status, at = null, remedy = undefined, notes = undefined
} = {}) {
  requireOrg(orgId, "setTrialStatus");
  if (!id) throw new TypeError("setTrialStatus: id is required");
  assertStatus(status, "setTrialStatus");

  const stamp = at || new Date();
  const params = [orgId, id, status, stamp];
  const sets = [
    "status = $3",
    "converted_at = CASE WHEN $3 = 'converted' THEN COALESCE(converted_at, $4) ELSE converted_at END",
    "declined_at  = CASE WHEN $3 = 'declined'  THEN COALESCE(declined_at, $4)  ELSE declined_at END",
    "refunded_at  = CASE WHEN $3 = 'refunded'  THEN COALESCE(refunded_at, $4)  ELSE refunded_at END",
    "updated_at = now()"
  ];
  if (remedy !== undefined) {
    params.push(remedy == null ? null : JSON.stringify(remedy));
    sets.push(`remedy = $${params.length}::jsonb`);
  }
  if (notes !== undefined) {
    params.push(notes);
    sets.push(`notes = $${params.length}`);
  }

  const { rows } = await db.query(
    `UPDATE live_trials SET ${sets.join(", ")}
      WHERE org_id = $1 AND id = $2
      RETURNING ${COLUMNS}`,
    params
  );
  return (rows && rows[0]) || null;
}

/** endTrial — the seventh live day is complete. Freezes the dashboard. */
export async function endTrial(db, { orgId, id, at = null } = {}) {
  requireOrg(orgId, "endTrial");
  if (!id) throw new TypeError("endTrial: id is required");
  const { rows } = await db.query(
    `UPDATE live_trials
        SET status = 'ended', updated_at = now(),
            frozen_until = COALESCE(frozen_until, $3)
      WHERE org_id = $1 AND id = $2 AND status = 'running'
      RETURNING ${COLUMNS}`,
    [orgId, id, at || null]
  );
  return (rows && rows[0]) || null;
}

/** recordTrialEvent — append-only. Never updated, never deleted (the trigger in
    280 refuses a DELETE outright). */
export async function recordTrialEvent(db, {
  orgId, liveTrialId, kind, detail = {}, actorStaffId = null, occurredAt = null
} = {}) {
  requireOrg(orgId, "recordTrialEvent");
  if (!liveTrialId) throw new TypeError("recordTrialEvent: liveTrialId is required");
  if (!kind) throw new TypeError("recordTrialEvent: kind is required");
  const { rows } = await db.query(
    `INSERT INTO live_trial_events
       (org_id, live_trial_id, kind, detail, actor_staff_id, occurred_at)
     VALUES ($1,$2,$3,$4::jsonb,$5, COALESCE($6, now()))
     RETURNING id, kind, occurred_at`,
    [orgId, liveTrialId, String(kind).trim(), JSON.stringify(detail || {}), actorStaffId, occurredAt]
  );
  return (rows && rows[0]) || null;
}

/** listTrialEvents — newest first, for the dashboard's activity strip and for
    the audit answer. */
export async function listTrialEvents(db, { orgId, liveTrialId, limit = 50 } = {}) {
  requireOrg(orgId, "listTrialEvents");
  if (!liveTrialId) throw new TypeError("listTrialEvents: liveTrialId is required");
  const n = Number(limit);
  const capped = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 200) : 50;
  const { rows } = await db.query(
    `SELECT id, kind, detail, actor_staff_id, occurred_at
       FROM live_trial_events
      WHERE org_id = $1 AND live_trial_id = $2
      ORDER BY occurred_at DESC
      LIMIT $3`,
    [orgId, liveTrialId, capped]
  );
  return rows || [];
}

export default {
  getTrial,
  getTrialByPartner,
  listTrials,
  createTrial,
  startTrialClock,
  setTrialStatus,
  endTrial,
  recordTrialEvent,
  listTrialEvents
};
