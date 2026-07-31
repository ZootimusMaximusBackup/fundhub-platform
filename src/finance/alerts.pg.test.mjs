// Real-Postgres integration test for the alert store and the 079 rule rows.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// What this proves that the unit tests cannot:
//
//   * the 078 dedupe guard is a real index and actually fires. A fake that
//     models the schema you wish you had cannot fail when the schema moves —
//     AUDIT-FINDINGS.md's first lesson — and this repository already shipped two
//     money bugs whose ON CONFLICT guard was inert against real data;
//   * acknowledging an alert frees the (client, kind) slot, so the same
//     condition can be raised again later rather than being suppressed forever;
//   * the 078 CHECK constraints refuse a bad severity, a blank kind and an
//     acknowledgement that predates the raise;
//   * the five 079 rules really do ship inactive with every threshold null, and
//     v_upsell_config_gaps really does report each missing number;
//   * the whole path — rows in, evaluate, alert written — works against the real
//     schema with the real column names.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  raiseAlert, raiseAlerts, acknowledgeAlert, listAlerts,
  loadUpsellRules, unconfiguredUpsellRules
} from "./alerts.mjs";
import { evaluate, firedAlerts } from "./upsell.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "finance_alerts_pg_test@example.com";
const SLUG = "finance-alerts-pg-test";

let defaultOrgId = null;   // read-only: the org 079 seeds
let orgId = null;          // a scratch org this test owns outright
let clientId = null;

async function wipe() {
  await db.query(`DELETE FROM alerts WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email = $1`, [EMAIL]);
  await db.query(`DELETE FROM upsell_trigger_rules WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [SLUG]);
  await db.query(`DELETE FROM orgs WHERE slug = $1`, [SLUG]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  defaultOrgId = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0]?.id;
  assert.ok(defaultOrgId, "a default org must exist — run the migrations");
  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'Finance alerts pg test') RETURNING id`, [SLUG]
  )).rows[0].id;
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Alert','Store') RETURNING id`,
    [orgId, EMAIL]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

const payload = (over = {}) => ({ reason: "measured", metrics: { utilization_bp: 2500 }, rule_snapshot: { utilization_ceiling_pct: 30 }, ...over });

test("raising the same open alert twice refreshes one row instead of stacking two", { skip: !HAS_DB }, async () => {
  await raiseAlert(db, { orgId, clientId, kind: "utilization_drop_clean_pull", severity: "info", payload: payload() });
  const second = await raiseAlert(db, {
    orgId, clientId, kind: "utilization_drop_clean_pull", severity: "warning",
    payload: payload({ metrics: { utilization_bp: 2000 } })
  });

  const open = await listAlerts(db, { orgId, clientId });
  assert.equal(open.length, 1, "the partial unique index must absorb the re-raise");
  assert.equal(open[0].id, second.id);
  assert.equal(open[0].severity, "warning", "the newer severity wins");
  assert.equal(open[0].payload.metrics.utilization_bp, 2000, "the newer evidence wins");
});

test("an out-of-order replay cannot drag raised_at backwards", { skip: !HAS_DB }, async () => {
  const fresh = await raiseAlert(db, {
    orgId, clientId, kind: "replay_order", severity: "info", payload: payload(),
    raisedAt: "2026-07-31T12:00:00Z"
  });
  const stale = await raiseAlert(db, {
    orgId, clientId, kind: "replay_order", severity: "info", payload: payload(),
    raisedAt: "2026-07-01T00:00:00Z"
  });
  assert.equal(stale.id, fresh.id);
  assert.equal(new Date(stale.raised_at).toISOString(), "2026-07-31T12:00:00.000Z");
});

test("acknowledging frees the slot, so the same condition can be raised again later", { skip: !HAS_DB }, async () => {
  const first = await raiseAlert(db, { orgId, clientId, kind: "reraise_after_ack", severity: "info", payload: payload() });
  const acked = await acknowledgeAlert(db, { orgId, id: first.id });
  assert.ok(acked.acknowledged_at, "acknowledging stamps a time");

  const again = await raiseAlert(db, { orgId, clientId, kind: "reraise_after_ack", severity: "info", payload: payload() });
  assert.notEqual(again.id, first.id, "a closed alert must not block the next one");

  const open = await listAlerts(db, { orgId, clientId });
  assert.equal(open.filter((a) => a.kind === "reraise_after_ack").length, 1, "exactly one is open");
  const all = await listAlerts(db, { orgId, clientId, includeAcknowledged: true });
  assert.equal(all.filter((a) => a.kind === "reraise_after_ack").length, 2, "the acknowledged one is still on the record");
});

test("acknowledging an already-acknowledged alert returns null rather than restamping it", { skip: !HAS_DB }, async () => {
  const a = await raiseAlert(db, { orgId, clientId, kind: "ack_twice", severity: "info", payload: payload() });
  assert.ok(await acknowledgeAlert(db, { orgId, id: a.id }));
  assert.equal(await acknowledgeAlert(db, { orgId, id: a.id }), null);
});

test("another org cannot acknowledge this org's alert", { skip: !HAS_DB }, async () => {
  const a = await raiseAlert(db, { orgId, clientId, kind: "tenancy", severity: "info", payload: payload() });
  assert.equal(await acknowledgeAlert(db, { orgId: defaultOrgId, id: a.id }), null);
});

test("the schema refuses a severity outside the ladder, a blank kind, and an ack before the raise", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => db.query(`INSERT INTO alerts (org_id, client_id, kind, severity) VALUES ($1,$2,'x','urgent')`, [orgId, clientId]),
    /violates check constraint/
  );
  await assert.rejects(
    () => db.query(`INSERT INTO alerts (org_id, client_id, kind, severity) VALUES ($1,$2,'   ','info')`, [orgId, clientId]),
    /violates check constraint/
  );
  await assert.rejects(
    () => db.query(
      `INSERT INTO alerts (org_id, client_id, kind, severity, raised_at, acknowledged_at)
       VALUES ($1,$2,'backwards','info','2026-07-31T00:00:00Z','2026-07-01T00:00:00Z')`, [orgId, clientId]),
    /violates check constraint/
  );
});

test("the store refuses a null severity by name rather than letting the driver report a not-null violation", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => raiseAlert(db, { orgId, clientId, kind: "no_severity", severity: null, payload: payload() }),
    /severity must be one of/
  );
});

test("the five 079 rules ship inactive, flagged, and with every threshold null", { skip: !HAS_DB }, async () => {
  const rules = await loadUpsellRules(db, { orgId: defaultOrgId });
  const keys = Object.keys(rules).sort();
  assert.deepEqual(keys, [
    "card_upgrade_candidate", "score_improvement", "seasoned_tradelines",
    "strength_signals", "utilization_drop_clean_pull"
  ]);

  for (const [key, r] of Object.entries(rules)) {
    assert.equal(r.active, false, `${key} must not be live`);
    assert.equal(r.needs_config, true, `${key} must be flagged as awaiting a decision`);
    assert.ok(Object.keys(r.params).length > 0, `${key} must show which numbers it wants`);
    for (const [p, v] of Object.entries(r.params)) {
      assert.equal(v, null, `${key}.${p} must ship unset — no threshold in this repository has a source`);
    }
  }
});

test("nothing fires against the rules exactly as they ship, and every blank says why", { skip: !HAS_DB }, async () => {
  const rules = await loadUpsellRules(db, { orgId: defaultOrgId });
  const results = evaluate({
    clientId,
    tradelines: [{ kind: "revolving", credit_limit_cents: 1_000_000, balance_cents: 250_000, closed_at: null }],
    previousTradelines: [{ kind: "revolving", credit_limit_cents: 1_000_000, balance_cents: 500_000, closed_at: null }],
    pull: { crs_inquiries_ex: 0, crs_inquiries_eq: 0, crs_inquiries_tu: 0, crs_late_payments_count: 0 },
    rules,
    now: "2026-07-31T00:00:00Z"
  });
  assert.equal(firedAlerts(results).length, 0);
  assert.equal(results.length, 5);
  for (const r of results) assert.match(r.reason, /inactive/);
});

test("v_upsell_config_gaps names every unset number and the schema block on seasoning", { skip: !HAS_DB }, async () => {
  const gaps = await unconfiguredUpsellRules(db, { orgId: defaultOrgId });
  const configs = gaps.map((g) => g.config);

  for (const expected of [
    "upsell_trigger_rules.utilization_drop_clean_pull.utilization_ceiling_pct",
    "upsell_trigger_rules.utilization_drop_clean_pull.clean_pull_max_inquiries_per_bureau",
    "upsell_trigger_rules.utilization_drop_clean_pull.clean_pull_max_late_payments",
    "upsell_trigger_rules.utilization_drop_clean_pull.min_drop_basis_points",
    "upsell_trigger_rules.seasoned_tradelines.min_age_months",
    "upsell_trigger_rules.seasoned_tradelines.min_seasoned_lines",
    "upsell_trigger_rules.strength_signals.min_total_limit_cents",
    "upsell_trigger_rules.strength_signals.min_open_revolving_lines",
    "upsell_trigger_rules.strength_signals.max_utilization_pct",
    "upsell_trigger_rules.score_improvement.min_score_gain",
    "upsell_trigger_rules.score_improvement.min_score",
    "upsell_trigger_rules.card_upgrade_candidate.apr_at_or_above",
    "upsell_trigger_rules.card_upgrade_candidate.min_balance_cents"
  ]) {
    assert.ok(configs.includes(expected), `${expected} must be reported as an open decision`);
  }

  const blocked = gaps.find((g) => g.config === "tradelines.opened_at");
  assert.ok(blocked, "the missing opened date must be reported as a schema block, not as a config gap");
  assert.match(blocked.status, /BLOCKED/);
});

test("a configured rule writes an alert carrying the frozen thresholds", { skip: !HAS_DB }, async () => {
  // Configured on THIS TEST'S OWN ORG. The seeded rules on the default org are
  // read-only here: a test that edits shared config leaves the next reader with
  // a threshold nobody decided.
  await db.query(
    `INSERT INTO upsell_trigger_rules (org_id, rule_key, name, params, severity, active, needs_config)
     VALUES ($1, 'utilization_drop_clean_pull', 'test rule', $2::jsonb, 'warning', true, false)`,
    [orgId, JSON.stringify({
      utilization_ceiling_pct: 30, min_drop_basis_points: null,
      clean_pull_max_inquiries_per_bureau: 2, clean_pull_max_late_payments: 0
    })]
  );

  const rules = await loadUpsellRules(db, { orgId });
  const results = evaluate({
    clientId,
    tradelines: [{ kind: "revolving", credit_limit_cents: 1_000_000, balance_cents: 250_000, closed_at: null }],
    previousTradelines: [{ kind: "revolving", credit_limit_cents: 1_000_000, balance_cents: 500_000, closed_at: null }],
    pull: { crs_inquiries_ex: 1, crs_inquiries_eq: 0, crs_inquiries_tu: 0, crs_late_payments_count: 0 },
    rules,
    now: "2026-07-31T00:00:00Z"
  });

  const stored = await raiseAlerts(db, { orgId, clientId, alerts: firedAlerts(results), raisedAt: "2026-07-31T00:00:00Z" });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].severity, "warning", "the severity came off the rule row");
  assert.equal(stored[0].payload.rule_snapshot.utilization_ceiling_pct, 30,
    "the threshold in force is frozen into the alert, so editing the rule later cannot restate why it fired");
  assert.equal(stored[0].payload.metrics.headroom_increase_cents, 250_000);

  // And editing the rule afterwards does not rewrite the alert that already fired.
  await db.query(
    `UPDATE upsell_trigger_rules SET params = jsonb_set(params, '{utilization_ceiling_pct}', '10')
      WHERE org_id = $1 AND rule_key = 'utilization_drop_clean_pull'`, [orgId]);
  const after = await listAlerts(db, { orgId, clientId });
  const same = after.find((a) => a.kind === "utilization_drop_clean_pull");
  assert.equal(same.payload.rule_snapshot.utilization_ceiling_pct, 30);
});

test("rule keys are scoped per org, so two orgs can hold the same key with different numbers", { skip: !HAS_DB }, async () => {
  const mine = await loadUpsellRules(db, { orgId });
  const theirs = await loadUpsellRules(db, { orgId: defaultOrgId });
  assert.ok(mine.utilization_drop_clean_pull, "this org has its own row for the key");
  assert.ok(theirs.utilization_drop_clean_pull, "so does the default org");
  assert.notEqual(mine.utilization_drop_clean_pull.active, theirs.utilization_drop_clean_pull.active);
});

test("the store refuses a missing org, client or kind rather than writing a half-identified row", { skip: !HAS_DB }, async () => {
  await assert.rejects(() => raiseAlert(db, { clientId, kind: "x", severity: "info" }), /orgId and clientId are required/);
  await assert.rejects(() => raiseAlert(db, { orgId, clientId, kind: "  ", severity: "info" }), /kind is required/);
  await assert.rejects(() => raiseAlert(db, { orgId, clientId, kind: "x", severity: "info", payload: [1] }), /payload must be an object/);
});
