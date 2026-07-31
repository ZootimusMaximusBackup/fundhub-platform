// Unit tests for the alerts store — the piece that was missing.
//
// *** WHAT THIS FILE IS ANSWERING. ***
//
// src/alerts/evaluate.mjs holds four rules and 57 tests. db/migrations/078 and
// 079 hold two tables. Until src/alerts/store.mjs existed there was nothing in
// between: no query anywhere in this repo touched `alerts` or
// `upsell_triggers`, and no file outside src/alerts/ imported the evaluators.
// An owner switching `upsell_triggers.enabled` to true changed nothing, ever.
// The rules were excellently tested and completely unreachable.
//
// So these tests are about the CROSSING, not about the rules:
//   * an enabled rule with NO threshold must refuse to fire, not fall back to
//     the 0.30 default — that is the whole reason 079 ships every row unset;
//   * an UNKNOWN utilization (a card we cannot read) must not raise an alert,
//     because `over === null` is not `over === false` and it is not `true`;
//   * a disabled rule must not fire;
//   * the dedupe key must name the CONDITION, so re-running unchanged data
//     hits the same key rather than stacking rows.
//
// *** WHAT THIS FAKE IS ALLOWED TO ASSERT. ***
//
// AUDIT-FINDINGS' first lesson: "A fake that models the schema you wish you had
// cannot fail when the schema moves." The fake below therefore stores NOTHING
// and models NO SCHEMA. It records the SQL it was handed and the parameters
// that came with it, and returns a canned row. Every claim about what POSTGRES
// does with any of it — the columns exist, the CHECKs fire, the partial unique
// index really does dedupe — lives in store.pg.test.mjs against real Postgres,
// and nowhere else.

import { test } from "node:test";
import assert from "node:assert";

import {
  AlertError,
  ALERT_KINDS,
  SEVERITIES,
  TRIGGER_RULES,
  RULE_ALERT_KIND,
  dedupeKeyFor,
  raiseAlert,
  enabledTriggers,
  evaluateAndRaise
} from "./store.mjs";
import { DEFAULT_UTILIZATION_THRESHOLD } from "./evaluate.mjs";

const ORG = "44444444-4444-4444-8444-444444444444";
const CLIENT = "11111111-1111-4111-8111-111111111111";

/**
 * Records calls. Stores nothing, models nothing.
 *
 * `rows` is a queue of canned results, consumed in order; anything past the end
 * of the queue comes back empty. `calls` is the whole record of what was sent.
 */
function fakeDb(rows = []) {
  const queue = [...rows];
  const calls = [];
  return {
    calls,
    query(sql, params) {
      calls.push({ sql, params });
      return Promise.resolve(queue.length ? queue.shift() : { rows: [] });
    }
  };
}

/** A trigger configuration row, in the shape 079 stores it. */
function trigger(overrides = {}) {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    org_id: ORG,
    rule: "utilization_over_threshold",
    enabled: true,
    threshold_bps: 3000,
    threshold_score: null,
    severity: "warning",
    notes: null,
    signed_off_at: null,
    ...overrides
  };
}

/** A `tradelines` row (054 shape), in integer cents. */
function line(overrides = {}) {
  return {
    id: "aaaaaaaa-0000-4000-8000-00000000a001",
    lender: "Amex Blue Business",
    kind: "revolving",
    credit_limit_cents: 1_000_000,
    balance_cents: 200_000,
    apr: null,
    closed_at: null,
    ...overrides
  };
}

/* ─────────────────── the vocabularies match the CHECK constraints ─────────────────── */

test("the exported vocabularies are the ones 078 and 079 accept", () => {
  assert.deepStrictEqual(
    [...ALERT_KINDS].sort(),
    ["score_band", "upsell_opportunity", "utilization_threshold"]
  );
  assert.deepStrictEqual([...SEVERITIES].sort(), ["critical", "info", "warning"]);
  assert.deepStrictEqual(
    [...TRIGGER_RULES].sort(),
    ["card_upgrade_case", "score_below_threshold", "utilization_over_threshold"]
  );
  // Every rule maps to exactly one alert kind, and every mapped kind is real.
  for (const rule of TRIGGER_RULES) {
    assert.ok(ALERT_KINDS.includes(RULE_ALERT_KIND[rule]), `${rule} maps to a real alert kind`);
  }
  assert.strictEqual(Object.keys(RULE_ALERT_KIND).length, TRIGGER_RULES.length);
});

test("the constant lists are frozen — a caller cannot widen them", () => {
  assert.ok(Object.isFrozen(ALERT_KINDS));
  assert.ok(Object.isFrozen(SEVERITIES));
  assert.ok(Object.isFrozen(TRIGGER_RULES));
});

/* ─────────────────── the dedupe key names the condition ─────────────────── */

test("dedupeKeyFor names the condition, not the occurrence", () => {
  const a = dedupeKeyFor({ kind: "utilization_threshold", clientId: CLIENT, thresholdBps: 3000 });
  const b = dedupeKeyFor({ kind: "utilization_threshold", clientId: CLIENT, thresholdBps: 3000 });
  assert.strictEqual(a, b, "the same condition twice is the same key");
  assert.strictEqual(a, "utilization_threshold:11111111-1111-4111-8111-111111111111::3000");
});

test("dedupeKeyFor separates a per-card condition from the aggregate one", () => {
  const aggregate = dedupeKeyFor({ kind: "utilization_threshold", clientId: CLIENT, thresholdBps: 3000 });
  const perCard = dedupeKeyFor({
    kind: "utilization_threshold",
    clientId: CLIENT,
    tradelineId: "aaaaaaaa-0000-4000-8000-00000000a001",
    thresholdBps: 3000
  });
  assert.notStrictEqual(aggregate, perCard);
});

test("a different threshold is a different condition", () => {
  const at30 = dedupeKeyFor({ kind: "utilization_threshold", clientId: CLIENT, thresholdBps: 3000 });
  const at50 = dedupeKeyFor({ kind: "utilization_threshold", clientId: CLIENT, thresholdBps: 5000 });
  assert.notStrictEqual(at30, at50);
});

/* ─────────────────── validation refuses rather than guesses ─────────────────── */

test("raiseAlert refuses an unknown kind instead of writing it and letting the CHECK decide", async () => {
  const db = fakeDb();
  await assert.rejects(
    () => raiseAlert(db, { orgId: ORG, kind: "made_up_kind", title: "x" }),
    (e) => e instanceof AlertError && e.status === 400
  );
  assert.strictEqual(db.calls.length, 0, "nothing was sent to the database");
});

test("raiseAlert refuses a missing orgId", async () => {
  const db = fakeDb();
  await assert.rejects(
    () => raiseAlert(db, { kind: "score_band", title: "x" }),
    (e) => e instanceof AlertError && /orgId/.test(e.message)
  );
  assert.strictEqual(db.calls.length, 0);
});

test("raiseAlert refuses an empty title — a queue row nobody can read is not a record", async () => {
  const db = fakeDb();
  await assert.rejects(
    () => raiseAlert(db, { orgId: ORG, kind: "score_band", title: "   " }),
    (e) => e instanceof AlertError && /title/.test(e.message)
  );
  assert.strictEqual(db.calls.length, 0);
});

test("raiseAlert sends one INSERT that leans on the index rather than a SELECT-then-INSERT", async () => {
  const db = fakeDb([{ rows: [{ id: "alert-1", state: "open" }] }]);
  const out = await raiseAlert(db, {
    orgId: ORG,
    clientId: CLIENT,
    kind: "utilization_threshold",
    severity: "warning",
    title: "Utilization is over the configured threshold.",
    detail: { utilization: 0.42 },
    dedupeKey: "utilization_threshold:c:3000"
  });

  assert.strictEqual(out.created, true);
  assert.strictEqual(db.calls.length, 1, "one statement, not a read followed by a write");
  assert.match(db.calls[0].sql, /INSERT INTO alerts/);
  assert.match(db.calls[0].sql, /ON CONFLICT/, "the database settles the race, not a guard SELECT");
});

test("raiseAlert reports created:false and does not invent a second row when the condition is already open", async () => {
  // INSERT ... DO NOTHING returns no row; the follow-up SELECT finds the open one.
  const db = fakeDb([{ rows: [] }, { rows: [{ id: "alert-1", state: "open" }] }]);
  const out = await raiseAlert(db, {
    orgId: ORG,
    clientId: CLIENT,
    kind: "utilization_threshold",
    title: "Utilization is over the configured threshold.",
    dedupeKey: "utilization_threshold:c:3000"
  });
  assert.strictEqual(out.created, false);
  assert.strictEqual(out.alert.id, "alert-1");
});

/* ─────────────────── reads are scoped to the org, always ─────────────────── */

test("enabledTriggers filters on org_id and on enabled", async () => {
  const db = fakeDb([{ rows: [trigger()] }]);
  await enabledTriggers(db, { orgId: ORG });
  assert.strictEqual(db.calls.length, 1);
  assert.match(db.calls[0].sql, /FROM upsell_triggers/);
  assert.match(db.calls[0].sql, /org_id = \$1/);
  assert.match(db.calls[0].sql, /enabled/);
  assert.deepStrictEqual(db.calls[0].params, [ORG]);
});

test("enabledTriggers refuses to run without an org", async () => {
  const db = fakeDb();
  await assert.rejects(
    () => enabledTriggers(db, {}),
    (e) => e instanceof AlertError && /orgId/.test(e.message)
  );
  assert.strictEqual(db.calls.length, 0);
});

/* ═════════════════ the crossing: enabled=true now does something ═════════════════ */

test("an enabled utilization rule over its threshold raises exactly one alert", async () => {
  const db = fakeDb([
    { rows: [trigger({ threshold_bps: 3000 })] },          // enabledTriggers
    { rows: [{ id: "alert-1", state: "open" }] }           // the INSERT
  ]);

  const report = await evaluateAndRaise(db, {
    orgId: ORG,
    clientId: CLIENT,
    // 800,000 of 1,000,000 = 80%, well over 30%.
    tradelines: [line({ balance_cents: 800_000 })]
  });

  assert.strictEqual(report.raised.length, 1);
  assert.strictEqual(report.raised[0].rule, "utilization_over_threshold");
  assert.strictEqual(report.raised[0].kind, "utilization_threshold");
  assert.strictEqual(report.raised[0].created, true);

  const insert = db.calls.find((c) => /INSERT INTO alerts/.test(c.sql));
  assert.ok(insert, "an alert row was actually written");
  assert.ok(insert.params.includes(ORG), "the write is scoped to the org");
});

test("THE POINT OF 079: an enabled rule with NO threshold refuses to fire", async () => {
  const db = fakeDb([{ rows: [trigger({ threshold_bps: null })] }]);

  const report = await evaluateAndRaise(db, {
    orgId: ORG,
    clientId: CLIENT,
    // 80% utilization — this WOULD fire on the 0.30 default.
    tradelines: [line({ balance_cents: 800_000 })]
  });

  assert.strictEqual(report.raised.length, 0, "an unset threshold is not a default");
  assert.deepStrictEqual(report.skipped, [
    { rule: "utilization_over_threshold", reason: "threshold_unset" }
  ]);
  assert.ok(
    !db.calls.some((c) => /INSERT INTO alerts/.test(c.sql)),
    "nothing was written"
  );
  // Guards against the specific regression: silently reaching for the default.
  assert.strictEqual(DEFAULT_UTILIZATION_THRESHOLD, 0.30);
});

test("a disabled rule fires nothing even when the condition is true", async () => {
  // enabledTriggers already filters in SQL; this asserts the runner does not
  // then go on and use a row that arrived disabled anyway.
  const db = fakeDb([{ rows: [trigger({ enabled: false })] }]);
  const report = await evaluateAndRaise(db, {
    orgId: ORG,
    clientId: CLIENT,
    tradelines: [line({ balance_cents: 800_000 })]
  });
  assert.strictEqual(report.raised.length, 0);
  assert.ok(!db.calls.some((c) => /INSERT INTO alerts/.test(c.sql)));
});

test("UNKNOWN utilization raises nothing — a card we cannot read is not a clean bill of health", async () => {
  const db = fakeDb([{ rows: [trigger({ threshold_bps: 3000 })] }]);
  const report = await evaluateAndRaise(db, {
    orgId: ORG,
    clientId: CLIENT,
    // One maxed card we can read, one card with no limit at all. The aggregate
    // answer is genuinely unknown; `over` is null, which is not true.
    tradelines: [line({ balance_cents: 800_000 }), line({ id: "b", credit_limit_cents: null })]
  });
  assert.strictEqual(report.raised.length, 0);
  assert.deepStrictEqual(report.skipped, [
    { rule: "utilization_over_threshold", reason: "utilization_unknown" }
  ]);
});

test("at-or-under the threshold raises nothing", async () => {
  const db = fakeDb([{ rows: [trigger({ threshold_bps: 3000 })] }]);
  const report = await evaluateAndRaise(db, {
    orgId: ORG,
    clientId: CLIENT,
    tradelines: [line({ balance_cents: 300_000 })] // exactly 30% — not over
  });
  assert.strictEqual(report.raised.length, 0);
  assert.deepStrictEqual(report.skipped, [
    { rule: "utilization_over_threshold", reason: "condition_false" }
  ]);
});

test("a score under the configured score raises a score_band alert", async () => {
  const db = fakeDb([
    { rows: [trigger({ rule: "score_below_threshold", threshold_bps: null, threshold_score: 680 })] },
    { rows: [{ id: "alert-2", state: "open" }] }
  ]);
  const report = await evaluateAndRaise(db, { orgId: ORG, clientId: CLIENT, score: 610 });
  assert.strictEqual(report.raised.length, 1);
  assert.strictEqual(report.raised[0].kind, "score_band");
});

test("an UNKNOWN score raises nothing — unknown is not below", async () => {
  const db = fakeDb([
    { rows: [trigger({ rule: "score_below_threshold", threshold_bps: null, threshold_score: 680 })] }
  ]);
  const report = await evaluateAndRaise(db, { orgId: ORG, clientId: CLIENT, score: null });
  assert.strictEqual(report.raised.length, 0);
  assert.deepStrictEqual(report.skipped, [
    { rule: "score_below_threshold", reason: "score_unknown" }
  ]);
});

test("a score at the configured threshold raises nothing — the boundary does not fire", async () => {
  const db = fakeDb([
    { rows: [trigger({ rule: "score_below_threshold", threshold_bps: null, threshold_score: 680 })] }
  ]);
  const report = await evaluateAndRaise(db, { orgId: ORG, clientId: CLIENT, score: 680 });
  assert.strictEqual(report.raised.length, 0);
});

test("a card-upgrade case raises an upsell_opportunity carrying the reason codes", async () => {
  const db = fakeDb([
    { rows: [trigger({ rule: "card_upgrade_case", threshold_bps: 3000 })] },
    { rows: [{ id: "alert-3", state: "open" }] }
  ]);
  const report = await evaluateAndRaise(db, {
    orgId: ORG,
    clientId: CLIENT,
    tradelines: [line({ balance_cents: 800_000 })]
  });
  assert.strictEqual(report.raised.length, 1);
  assert.strictEqual(report.raised[0].kind, "upsell_opportunity");

  const insert = db.calls.find((c) => /INSERT INTO alerts/.test(c.sql));
  const detail = insert.params.find((p) => typeof p === "string" && p.startsWith("{"));
  assert.ok(detail, "the evaluator's own output was stored verbatim as JSON");
  assert.match(detail, /AGGREGATE_UTILIZATION_OVER_THRESHOLD/);
});

test("no enabled rules means no queries past the read and no alerts", async () => {
  const db = fakeDb([{ rows: [] }]);
  const report = await evaluateAndRaise(db, {
    orgId: ORG,
    clientId: CLIENT,
    tradelines: [line({ balance_cents: 900_000 })]
  });
  assert.deepStrictEqual(report.raised, []);
  assert.deepStrictEqual(report.skipped, []);
  assert.strictEqual(db.calls.length, 1, "only the trigger read happened");
});

test("every raised alert carries the trigger that raised it, so a bad threshold is traceable", async () => {
  const db = fakeDb([
    { rows: [trigger({ id: "trig-77" })] },
    { rows: [{ id: "alert-1", state: "open" }] }
  ]);
  await evaluateAndRaise(db, {
    orgId: ORG,
    clientId: CLIENT,
    tradelines: [line({ balance_cents: 800_000 })]
  });
  const insert = db.calls.find((c) => /INSERT INTO alerts/.test(c.sql));
  assert.ok(insert.params.includes("trig-77"), "trigger_id was written");
});

test("the severity written is the one the owner configured, not one this module chose", async () => {
  const db = fakeDb([
    { rows: [trigger({ severity: "critical" })] },
    { rows: [{ id: "alert-1", state: "open" }] }
  ]);
  await evaluateAndRaise(db, {
    orgId: ORG,
    clientId: CLIENT,
    tradelines: [line({ balance_cents: 800_000 })]
  });
  const insert = db.calls.find((c) => /INSERT INTO alerts/.test(c.sql));
  assert.ok(insert.params.includes("critical"));
});

test("evaluateAndRaise refuses without an org or a client rather than writing an unattributed row", async () => {
  const db = fakeDb();
  await assert.rejects(
    () => evaluateAndRaise(db, { clientId: CLIENT }),
    (e) => e instanceof AlertError && /orgId/.test(e.message)
  );
  await assert.rejects(
    () => evaluateAndRaise(db, { orgId: ORG }),
    (e) => e instanceof AlertError && /clientId/.test(e.message)
  );
  assert.strictEqual(db.calls.length, 0);
});

test("NOTHING TRANSMITS: the store contains no outbound call of any kind", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./store.mjs", import.meta.url), "utf8");
  // Same negative assertion src/banking keeps: a store that grows a send path
  // has stopped being a record and become a delivery mechanism, and delivery in
  // this repo needs sign-off, not a commit.
  assert.ok(!/\bfetch\s*\(/.test(src), "no outbound fetch");
  assert.ok(!/require\(['"]https?['"]\)|from ['"]node:https?['"]/.test(src), "no http client");
  assert.ok(!/sendTemplated|sendMail|nodemailer/.test(src), "no send path");
});
