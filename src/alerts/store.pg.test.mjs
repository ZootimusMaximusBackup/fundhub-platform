// Real-Postgres integration test for the alerts store.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// WHY THIS FILE EXISTS. Migrations 078 (`alerts`) and 079 (`upsell_triggers`)
// shipped without a single query against either table anywhere in the repo. Two
// tables, four rules, no store — so nothing had ever proved that the columns
// named in those migrations are the columns this code writes, or that the
// vocabularies in store.mjs are the ones the CHECK constraints accept.
//
// WHAT THIS PROVES THAT THE FAKE CANNOT. Every load-bearing claim below is a
// claim about POSTGRES, not about JavaScript:
//
//   * that re-running an unchanged evaluation cannot stack a second alert —
//     enforced by uq_alerts_open_condition, not by a guard in raiseAlert();
//   * that resolving an alert RELEASES the condition, so the same client going
//     back over the line next quarter raises a new alert rather than being
//     silently suppressed forever by a dedupe key nobody can clear;
//   * that the kind / severity / state vocabularies in store.mjs are the ones
//     078 accepts;
//   * that one org cannot read or resolve another org's alerts;
//   * that deleting a client takes its alerts with it.
//
// The dedupe case is attacked TWICE — once through raiseAlert(), and once with
// a raw INSERT that bypasses every line of application code — because only the
// second one is a statement about the database.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  AlertError,
  ALERT_KINDS,
  SEVERITIES,
  TRIGGER_RULES,
  setTrigger,
  listTriggers,
  enabledTriggers,
  raiseAlert,
  openAlerts,
  alertsForClient,
  getAlert,
  acknowledgeAlert,
  resolveAlert,
  dismissAlert,
  evaluateAndRaise
} from "./store.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

const EMAIL_A = "alerts_store_pg_a@example.com";
const EMAIL_B = "alerts_store_pg_b@example.com";
const EMAILS = [EMAIL_A, EMAIL_B];
const ORG_NAME = "Alerts Store PG Other Org";

let orgId = null;
let otherOrgId = null;
let clientA = null;
let clientB = null;
let staffId = null;

/** A `tradelines` row shape, in integer cents. */
function line(overrides = {}) {
  return {
    id: null,
    lender: "Amex Blue Business",
    kind: "revolving",
    credit_limit_cents: 1_000_000,
    balance_cents: 200_000,
    apr: null,
    closed_at: null,
    ...overrides
  };
}

async function wipe() {
  await db.query(
    `DELETE FROM alerts WHERE client_id IN (SELECT id FROM clients WHERE email = ANY($1))`,
    [EMAILS]
  );
  await db.query(`DELETE FROM clients WHERE email = ANY($1)`, [EMAILS]);
  await db.query(`DELETE FROM alerts WHERE org_id IN (SELECT id FROM orgs WHERE name = $1)`, [ORG_NAME]);
  await db.query(`DELETE FROM upsell_triggers WHERE org_id IN (SELECT id FROM orgs WHERE name = $1)`, [ORG_NAME]);
  if (orgId) {
    await db.query(`DELETE FROM alerts WHERE org_id = $1 AND client_id IS NULL`, [orgId]);
    await db.query(`DELETE FROM upsell_triggers WHERE org_id = $1`, [orgId]);
  }
  await db.query(`DELETE FROM orgs WHERE name = $1`, [ORG_NAME]);
}

before(async () => {
  if (!HAS_DB) return;
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  await wipe();

  otherOrgId = (await db.query(
    `INSERT INTO orgs (name, slug) VALUES ($1, $2) RETURNING id`,
    [ORG_NAME, "alerts-store-pg-other-org"]
  )).rows[0].id;
  clientA = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Alert','One') RETURNING id`,
    [orgId, EMAIL_A]
  )).rows[0].id;
  clientB = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Alert','Two') RETURNING id`,
    [orgId, EMAIL_B]
  )).rows[0].id;
  staffId = (await db.query(`SELECT id FROM staff WHERE org_id = $1 LIMIT 1`, [orgId])).rows[0]?.id ?? null;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

/* ═════════════════════════ the tables are reachable at all ═════════════════════════ */

test("the alerts table can be written and read back by this store", { skip: !HAS_DB }, async () => {
  const { alert, created } = await raiseAlert(db, {
    orgId,
    clientId: clientA,
    kind: "utilization_threshold",
    severity: "warning",
    title: "Utilization is over the configured threshold.",
    detail: { utilization: 0.42, threshold: 0.3 },
    // A key of this test's own. NOT the one dedupeKeyFor() would build for a
    // real 30% rule — leaving an open alert on the real key would suppress the
    // write the evaluateAndRaise test further down is trying to prove happens.
    dedupeKey: `manual-write-probe:${clientA}`,
    asOf: "2026-07-01T00:00:00.000Z"
  });

  assert.strictEqual(created, true);
  assert.ok(alert.id, "a row came back");
  assert.strictEqual(alert.org_id, orgId);
  assert.strictEqual(alert.client_id, clientA);
  assert.strictEqual(alert.state, "open");
  assert.strictEqual(alert.severity, "warning");
  // The evaluator's own numbers survive the round trip as numbers, not strings.
  assert.strictEqual(alert.detail.utilization, 0.42);
  assert.ok(alert.as_of instanceof Date, "as_of came back as a timestamp");
  assert.strictEqual(alert.resolved_at, null, "NULL survived — unresolved is not a zero");
});

test("every kind and severity this module exports is one the CHECK constraints accept", { skip: !HAS_DB }, async () => {
  for (const kind of ALERT_KINDS) {
    for (const severity of SEVERITIES) {
      const { alert } = await raiseAlert(db, {
        orgId,
        clientId: clientB,
        kind,
        severity,
        title: `vocabulary probe ${kind}/${severity}`,
        dedupeKey: `probe:${kind}:${severity}`
      });
      assert.strictEqual(alert.kind, kind);
      assert.strictEqual(alert.severity, severity);
    }
  }
});

/* ═════════════════════════ dedupe is the database's job ═════════════════════════ */

test("re-raising the same condition does not stack a second row", { skip: !HAS_DB }, async () => {
  const key = `utilization_threshold:${clientA}::3000:dedupe`;
  const first = await raiseAlert(db, {
    orgId, clientId: clientA, kind: "utilization_threshold",
    title: "Utilization is over the configured threshold.", dedupeKey: key
  });
  const second = await raiseAlert(db, {
    orgId, clientId: clientA, kind: "utilization_threshold",
    title: "Utilization is over the configured threshold.", dedupeKey: key
  });

  assert.strictEqual(first.created, true);
  assert.strictEqual(second.created, false, "the second call changed nothing");
  assert.strictEqual(second.alert.id, first.alert.id, "and returned the row that is already there");

  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM alerts WHERE org_id = $1 AND dedupe_key = $2`,
    [orgId, key]
  );
  assert.strictEqual(rows[0].n, 1);
});

test("THE INDEX, NOT THE CODE: a raw INSERT bypassing this module is refused too", { skip: !HAS_DB }, async () => {
  const key = `raw:${clientA}:index-probe`;
  await raiseAlert(db, {
    orgId, clientId: clientA, kind: "score_band", title: "index probe", dedupeKey: key
  });

  await assert.rejects(
    () => db.query(
      `INSERT INTO alerts (org_id, client_id, kind, title, dedupe_key)
       VALUES ($1, $2, 'score_band', 'index probe again', $3)`,
      [orgId, clientA, key]
    ),
    (e) => e.code === "23505",
    "uq_alerts_open_condition is what actually prevents the duplicate"
  );
});

test("a NULL dedupe_key opts out of dedupe — NULLs do not collide", { skip: !HAS_DB }, async () => {
  const a = await raiseAlert(db, {
    orgId, clientId: clientB, kind: "score_band", title: "no dedupe 1", dedupeKey: null
  });
  const b = await raiseAlert(db, {
    orgId, clientId: clientB, kind: "score_band", title: "no dedupe 2", dedupeKey: null
  });
  assert.strictEqual(a.created, true);
  assert.strictEqual(b.created, true);
  assert.notStrictEqual(a.alert.id, b.alert.id);
});

test("resolving RELEASES the condition, so it can be raised again later", { skip: !HAS_DB }, async () => {
  const key = `utilization_threshold:${clientA}::3000:release`;
  const first = await raiseAlert(db, {
    orgId, clientId: clientA, kind: "utilization_threshold", title: "over the line", dedupeKey: key
  });

  const resolved = await resolveAlert(db, {
    orgId, alertId: first.alert.id, at: "2026-07-02T00:00:00.000Z", byId: staffId
  });
  assert.strictEqual(resolved.ok, true);
  assert.strictEqual(resolved.alert.state, "resolved");
  assert.ok(resolved.alert.resolved_at instanceof Date);

  // Next quarter, same condition. This must be a NEW alert, not a suppressed one.
  const again = await raiseAlert(db, {
    orgId, clientId: clientA, kind: "utilization_threshold", title: "over the line again", dedupeKey: key
  });
  assert.strictEqual(again.created, true, "a resolved alert must not block the condition forever");
  assert.notStrictEqual(again.alert.id, first.alert.id);
});

/* ═════════════════════════ state transitions ═════════════════════════ */

test("the first acknowledgement wins and a second call is a true no-op, not an error", { skip: !HAS_DB }, async () => {
  const { alert } = await raiseAlert(db, {
    orgId, clientId: clientB, kind: "score_band", title: "ack probe", dedupeKey: `ack:${clientB}`
  });

  const first = await acknowledgeAlert(db, {
    orgId, alertId: alert.id, at: "2026-07-03T00:00:00.000Z", byId: staffId
  });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.alert.state, "acknowledged");

  const second = await acknowledgeAlert(db, {
    orgId, alertId: alert.id, at: "2026-07-04T00:00:00.000Z", byId: staffId
  });
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.reason, "already_acknowledged");
  assert.deepStrictEqual(
    second.alert.acknowledged_at, first.alert.acknowledged_at,
    "the second call did not overwrite who got there first"
  );
});

test("dismissing keeps the reason, and dismissed is not resolved", { skip: !HAS_DB }, async () => {
  const { alert } = await raiseAlert(db, {
    orgId, clientId: clientB, kind: "upsell_opportunity", title: "dismiss probe", dedupeKey: `dis:${clientB}`
  });
  // No `at` and no `byId`: 078 has no dismissed_at and no dismissed_by column.
  // The store does not invent either — updated_at records when, and who is an
  // absence worth leaving visible rather than filling in with resolved_by.
  const out = await dismissAlert(db, { orgId, alertId: alert.id, reason: "client already declined" });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.alert.state, "dismissed");
  assert.strictEqual(out.alert.dismissed_reason, "client already declined");
  assert.strictEqual(out.alert.resolved_at, null, "dismissed is a different answer from resolved");
});

test("a dismissal with no reason stores NULL rather than an invented one", { skip: !HAS_DB }, async () => {
  const { alert } = await raiseAlert(db, {
    orgId, clientId: clientB, kind: "upsell_opportunity", title: "dismiss no reason", dedupeKey: `dis2:${clientB}`
  });
  const out = await dismissAlert(db, { orgId, alertId: alert.id });
  assert.strictEqual(out.alert.dismissed_reason, null);
});

/* ═════════════════════════ tenancy ═════════════════════════ */

test("another org cannot read one of these alerts", { skip: !HAS_DB }, async () => {
  const { alert } = await raiseAlert(db, {
    orgId, clientId: clientA, kind: "score_band", title: "tenancy probe", dedupeKey: `ten:${clientA}`
  });
  assert.ok(await getAlert(db, { orgId, alertId: alert.id }));
  assert.strictEqual(await getAlert(db, { orgId: otherOrgId, alertId: alert.id }), null);
});

test("another org cannot resolve one of these alerts", { skip: !HAS_DB }, async () => {
  const { alert } = await raiseAlert(db, {
    orgId, clientId: clientA, kind: "score_band", title: "tenancy resolve probe", dedupeKey: `ten2:${clientA}`
  });
  await assert.rejects(
    () => resolveAlert(db, { orgId: otherOrgId, alertId: alert.id, at: "2026-07-06T00:00:00.000Z", byId: staffId }),
    (e) => e instanceof AlertError && e.status === 404
  );
  const still = await getAlert(db, { orgId, alertId: alert.id });
  assert.strictEqual(still.state, "open", "it was not touched");
});

test("openAlerts and alertsForClient are both scoped to the org", { skip: !HAS_DB }, async () => {
  const mine = await openAlerts(db, { orgId });
  assert.ok(mine.length > 0);
  assert.ok(mine.every((a) => a.org_id === orgId));
  assert.ok(mine.every((a) => a.state === "open"), "resolved and dismissed rows are not in the open queue");

  assert.deepStrictEqual(await openAlerts(db, { orgId: otherOrgId }), []);

  const forA = await alertsForClient(db, { orgId, clientId: clientA });
  assert.ok(forA.length > 0);
  assert.ok(forA.every((a) => a.client_id === clientA));
  assert.deepStrictEqual(await alertsForClient(db, { orgId: otherOrgId, clientId: clientA }), []);
});

test("deleting a client takes its alerts with it", { skip: !HAS_DB }, async () => {
  const gone = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,'alerts_cascade_pg@example.com','Gone','Client') RETURNING id`,
    [orgId]
  )).rows[0].id;
  await raiseAlert(db, {
    orgId, clientId: gone, kind: "score_band", title: "cascade probe", dedupeKey: `casc:${gone}`
  });
  await db.query(`DELETE FROM clients WHERE id = $1`, [gone]);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM alerts WHERE client_id = $1`, [gone]);
  assert.strictEqual(rows[0].n, 0);
});

/* ═════════════════════════ trigger configuration ═════════════════════════ */

test("every rule this module exports is one 079's CHECK accepts", { skip: !HAS_DB }, async () => {
  for (const rule of TRIGGER_RULES) {
    const row = await setTrigger(db, { orgId: otherOrgId, rule, enabled: false });
    assert.strictEqual(row.rule, rule);
  }
  const all = await listTriggers(db, { orgId: otherOrgId });
  assert.strictEqual(all.length, TRIGGER_RULES.length);
});

test("a trigger ships OFF and UNSET unless the caller says otherwise", { skip: !HAS_DB }, async () => {
  const row = await setTrigger(db, { orgId: otherOrgId, rule: "utilization_over_threshold" });
  assert.strictEqual(row.enabled, false, "079's whole posture: a rule arrives switched off");
  assert.strictEqual(row.threshold_bps, null, "and with no threshold — NULL is unset, not zero");
  assert.strictEqual(row.signed_off_at, null);
});

test("setting the same rule twice updates in place rather than creating a second threshold", { skip: !HAS_DB }, async () => {
  const first = await setTrigger(db, {
    orgId: otherOrgId, rule: "utilization_over_threshold", enabled: true, thresholdBps: 3000, severity: "warning"
  });
  const second = await setTrigger(db, {
    orgId: otherOrgId, rule: "utilization_over_threshold", enabled: true, thresholdBps: 5000, severity: "critical"
  });
  assert.strictEqual(second.id, first.id);
  assert.strictEqual(second.threshold_bps, 5000);
  assert.strictEqual(second.severity, "critical");

  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM upsell_triggers WHERE org_id = $1 AND rule = 'utilization_over_threshold'`,
    [otherOrgId]
  );
  assert.strictEqual(rows[0].n, 1);
});

test("a threshold outside the column's range is refused before it reaches the CHECK", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => setTrigger(db, { orgId: otherOrgId, rule: "utilization_over_threshold", thresholdBps: 200_000 }),
    (e) => e instanceof AlertError
  );
  await assert.rejects(
    () => setTrigger(db, { orgId: otherOrgId, rule: "score_below_threshold", thresholdScore: 900 }),
    (e) => e instanceof AlertError
  );
});

test("enabledTriggers returns only the switched-on rules for that org", { skip: !HAS_DB }, async () => {
  await setTrigger(db, { orgId: otherOrgId, rule: "utilization_over_threshold", enabled: true, thresholdBps: 3000 });
  await setTrigger(db, { orgId: otherOrgId, rule: "score_below_threshold", enabled: false, thresholdScore: 680 });
  const live = await enabledTriggers(db, { orgId: otherOrgId });
  assert.deepStrictEqual(live.map((t) => t.rule), ["utilization_over_threshold"]);
  assert.deepStrictEqual(await enabledTriggers(db, { orgId }), [], "the other org's rules are not ours");
});

/* ═════════ THE FINDING ITSELF: enabled=true now produces a row ═════════ */

test("an owner switching a rule on gets an alert; switching it off gets nothing", { skip: !HAS_DB }, async () => {
  await setTrigger(db, {
    orgId, rule: "utilization_over_threshold", enabled: false, thresholdBps: 3000, severity: "warning"
  });

  const off = await evaluateAndRaise(db, {
    orgId, clientId: clientA, tradelines: [line({ balance_cents: 800_000 })]
  });
  assert.deepStrictEqual(off.raised, [], "switched off — nothing happens, which was the old behaviour");

  await setTrigger(db, {
    orgId, rule: "utilization_over_threshold", enabled: true, thresholdBps: 3000, severity: "warning"
  });

  const on = await evaluateAndRaise(db, {
    orgId, clientId: clientA, tradelines: [line({ balance_cents: 800_000 })], asOf: "2026-07-10T00:00:00.000Z"
  });
  assert.strictEqual(on.raised.length, 1);
  assert.strictEqual(on.raised[0].kind, "utilization_threshold");
  assert.strictEqual(on.raised[0].created, true, "a genuinely new row, not one left open by an earlier test");

  const stored = await getAlert(db, { orgId, alertId: on.raised[0].alert.id });
  assert.ok(stored, "the alert is really in the table");
  assert.strictEqual(stored.severity, "warning");
  assert.strictEqual(stored.detail.utilizationPct, 80, "the numbers that caused it were kept");
  assert.ok(stored.trigger_id, "and the rule that raised it is traceable");
});

test("an enabled rule with an UNSET threshold writes nothing at all", { skip: !HAS_DB }, async () => {
  await setTrigger(db, { orgId, rule: "utilization_over_threshold", enabled: true, thresholdBps: null });
  const before = (await db.query(`SELECT count(*)::int AS n FROM alerts WHERE client_id = $1`, [clientB])).rows[0].n;

  const out = await evaluateAndRaise(db, {
    orgId, clientId: clientB, tradelines: [line({ balance_cents: 900_000 })]
  });
  assert.deepStrictEqual(out.raised, []);
  assert.deepStrictEqual(out.skipped, [{ rule: "utilization_over_threshold", reason: "threshold_unset" }]);

  const after = (await db.query(`SELECT count(*)::int AS n FROM alerts WHERE client_id = $1`, [clientB])).rows[0].n;
  assert.strictEqual(after, before, "not one row was written on an unapproved number");
});

test("running the same evaluation twice leaves one alert, not two", { skip: !HAS_DB }, async () => {
  await setTrigger(db, { orgId, rule: "utilization_over_threshold", enabled: true, thresholdBps: 3000 });
  const args = { orgId, clientId: clientB, tradelines: [line({ balance_cents: 900_000 })] };

  const first = await evaluateAndRaise(db, args);
  const second = await evaluateAndRaise(db, args);

  assert.strictEqual(first.raised[0].created, true);
  assert.strictEqual(second.raised[0].created, false);
  assert.strictEqual(second.raised[0].alert.id, first.raised[0].alert.id);

  // Counted on the CONDITION's own key. Counting every utilization alert on this
  // client would sweep up the vocabulary-probe rows from earlier in the file and
  // stop being a statement about dedupe.
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM alerts WHERE org_id = $1 AND dedupe_key = $2 AND state = 'open'`,
    [orgId, first.raised[0].alert.dedupe_key]
  );
  assert.strictEqual(rows[0].n, 1);
});

/* ═════════════════════════ the negative that holds the design ═════════════════════════ */

test("alerts has no delivery columns — this is a record, not a message", { skip: !HAS_DB }, async () => {
  const { rows } = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'alerts'`
  );
  const names = rows.map((r) => r.column_name);
  for (const forbidden of ["sent_at", "delivered_at", "status", "channel", "recipient", "next_run_at"]) {
    assert.ok(!names.includes(forbidden), `alerts.${forbidden} would make this a send queue`);
  }
});
