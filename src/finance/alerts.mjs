// Alerts — the database half of "there is something worth saying". The deciding
// half is next door in upsell.mjs and stays pure, so the rules can be tested to
// their boundaries without a database.
//
// NOTHING IN THIS FILE SENDS ANYTHING. `raiseAlert` writes a row and stops.
// There is no outbound fetch anywhere in this repository's adapters or lib
// (AUDIT-FINDINGS.md, "Nothing transmits"), no scheduler, and no delivery path,
// and none is added here. An alert is a row a screen reads. Turning one into an
// email or an SMS is a separate decision with a separate compliance answer.
//
// UPSERT, NOT INSERT, AND THE GUARD IS THE INDEX. The conflict target is the
// partial unique index from 078 — (org_id, client_id, kind) WHERE
// acknowledged_at IS NULL — so re-raising a condition that is still open
// refreshes the row instead of stacking a second copy in front of the person
// reading the list. Enforced in the engine rather than by a "have we already
// raised this" read, because this repository has two recorded money bugs whose
// root cause was a dedupe guard that was inert at exactly the moment it mattered:
// `ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL` against a
// NULL ref, and invoices written with a NULL idempotency_key.
//
// RAISED_AT NEVER GOES BACKWARDS. The bus is at-least-once and a redelivery can
// arrive out of order; GREATEST() means a late replay of an older observation
// cannot make an alert look fresher or staler than the newest one that was true.

const SEVERITIES = Object.freeze(["info", "warning", "critical"]);

/**
 * raiseAlert — write or refresh one open alert.
 * Returns the stored row.
 */
export async function raiseAlert(db, { orgId, clientId, kind, severity, payload = {}, raisedAt = null } = {}) {
  if (!orgId || !clientId) throw new TypeError("raiseAlert: orgId and clientId are required");
  const k = String(kind ?? "").trim();
  if (!k) throw new TypeError("raiseAlert: kind is required");
  // A null severity would be rejected by the column anyway; refusing it here
  // names the actual cause — a 079 rule row with no severity — rather than
  // surfacing a not-null violation from the driver.
  if (!SEVERITIES.includes(severity)) {
    throw new TypeError(`raiseAlert: severity must be one of ${SEVERITIES.join(", ")}, got ${JSON.stringify(severity)}`);
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("raiseAlert: payload must be an object");
  }

  const { rows } = await db.query(
    `INSERT INTO alerts (org_id, client_id, kind, severity, payload, raised_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, now()))
     ON CONFLICT (org_id, client_id, kind) WHERE acknowledged_at IS NULL
     DO UPDATE SET
       severity   = EXCLUDED.severity,
       payload    = EXCLUDED.payload,
       raised_at  = GREATEST(alerts.raised_at, EXCLUDED.raised_at),
       updated_at = now()
     RETURNING *`,
    [orgId, clientId, k, severity, JSON.stringify(payload), raisedAt]
  );
  return rows[0];
}

/**
 * raiseAlerts — the batch form, for the output of upsell.firedAlerts().
 * Sequential rather than a single multi-row INSERT so that one bad alert names
 * itself instead of failing the whole set anonymously.
 */
export async function raiseAlerts(db, { orgId, clientId, alerts = [], raisedAt = null } = {}) {
  if (!Array.isArray(alerts)) throw new TypeError("raiseAlerts: alerts must be an array");
  const out = [];
  for (const a of alerts) {
    out.push(await raiseAlert(db, {
      orgId, clientId, kind: a?.kind, severity: a?.severity, payload: a?.payload ?? {}, raisedAt
    }));
  }
  return out;
}

/** acknowledgeAlert — close one open alert, freeing the (client, kind) slot so
 *  the same condition can legitimately be raised again later.
 *  Returns the row, or null when the id is unknown or already acknowledged. */
export async function acknowledgeAlert(db, { orgId, id, acknowledgedAt = null } = {}) {
  if (!orgId || !id) throw new TypeError("acknowledgeAlert: orgId and id are required");
  const { rows } = await db.query(
    `UPDATE alerts
        SET acknowledged_at = GREATEST(raised_at, COALESCE($3::timestamptz, now())),
            updated_at = now()
      WHERE org_id = $1 AND id = $2 AND acknowledged_at IS NULL
      RETURNING *`,
    [orgId, id, acknowledgedAt]
  );
  return rows[0] ?? null;
}

/** listAlerts — one client's alerts, newest first. Open only unless asked. */
export async function listAlerts(db, { orgId, clientId, includeAcknowledged = false } = {}) {
  if (!orgId || !clientId) throw new TypeError("listAlerts: orgId and clientId are required");
  const { rows } = await db.query(
    `SELECT * FROM alerts
      WHERE org_id = $1 AND client_id = $2
        AND ($3::boolean OR acknowledged_at IS NULL)
      ORDER BY raised_at DESC, kind ASC`,
    [orgId, clientId, includeAcknowledged]
  );
  return rows;
}

/**
 * loadUpsellRules — the 079 rows, in the shape evaluate() takes.
 *
 * Returns EVERY row, active or not, including the ones still awaiting their
 * numbers. The evaluator reports an inactive rule as a stated blank; filtering
 * them out here would turn "nobody has decided this threshold" into silence,
 * which is the failure this whole table exists to prevent.
 */
export async function loadUpsellRules(db, { orgId } = {}) {
  if (!orgId) throw new TypeError("loadUpsellRules: orgId is required");
  const { rows } = await db.query(
    `SELECT rule_key, name, description, params, severity, active, needs_config
       FROM upsell_trigger_rules
      WHERE org_id = $1
      ORDER BY rule_key`,
    [orgId]
  );
  const out = {};
  for (const r of rows) {
    out[r.rule_key] = {
      name: r.name,
      description: r.description,
      params: r.params ?? {},
      severity: r.severity,
      active: r.active === true,
      needs_config: r.needs_config === true
    };
  }
  return out;
}

/**
 * unconfiguredUpsellRules — the reporting surface for the gap 079 leaves open:
 * which thresholds a human still owes. Follows the convention already in this
 * repository — unmappedProducts() (src/entitlements/entitlements.mjs),
 * unratedConversions() (src/affiliates/economics.mjs), needsAttention()
 * (src/agents/registry.mjs) — where the gap is a row somebody can look at rather
 * than a comment nobody reads.
 *
 * Until this returns empty, no upsell condition can fire.
 */
export async function unconfiguredUpsellRules(db, { orgId } = {}) {
  if (!orgId) throw new TypeError("unconfiguredUpsellRules: orgId is required");
  const { rows } = await db.query(
    `SELECT rule_key, config, detail, status, consequence
       FROM v_upsell_config_gaps
      WHERE org_id = $1
      ORDER BY rule_key, config`,
    [orgId]
  );
  return rows;
}

export { SEVERITIES };
