/* /api/finance/alerts against REAL Postgres.
 *
 * WHY THIS FILE EXISTS ALONGSIDE finance-alerts.test.mjs. The stubbed test next
 * door proves every refusal and every shape, because all of those happen in
 * JavaScript. It cannot prove the one fact this endpoint's most dangerous button
 * depends on:
 *
 *   *** A DRY RUN MUST LEAVE THE DATABASE EXACTLY AS IT FOUND IT. ***
 *
 * The preview runs the REAL evaluator — the same evaluateAndRaise() a real run
 * calls, deliberately, so the preview cannot disagree with the run it is
 * previewing — inside a transaction that is always rolled back. Whether that
 * rollback actually happens is a property of Postgres and of the pooled
 * connection, not of any object this repo can fake, so it is asserted here or it
 * is not asserted at all. The stubbed test proves the other half: that when no
 * transaction can be pinned, the preview REFUSES rather than running unpinned
 * and writing (audit M7's trap, which four other files in this repo shipped).
 *
 * AND A FAKE CANNOT FAIL WHEN THE SCHEMA MOVES. AUDIT-FINDINGS.md's most
 * expensive entry is a module writing to columns a migration had renamed, with
 * every test passing against an in-memory model of the old names. So the things
 * that decide whether a real person gets flagged — that an empty threshold box
 * lands in the column as NULL and not as 0, that one open alert per condition is
 * enforced by the index rather than by a hopeful SELECT, and that an alert
 * carries the as-of date of the data behind it — are asserted against a live
 * database.
 *
 * Run live:
 *   DATABASE_URL=postgres://... node db/migrate.mjs
 *   DATABASE_URL=postgres://... node --test src/http/finance-alerts.pg.test.mjs
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import handler from "../../api/finance/alerts.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const ORG_SLUG = "alerts-http-test-co";
const OTHER_ORG_SLUG = "alerts-http-test-other-co";
const STAFF_EMAIL_LIKE = "alerts_http_test_%@example.com";
const CLIENT_EMAIL_LIKE = "alerts.http.test.%@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/finance/alerts (real postgres)", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, owner, advisor;
  let otherOrg, otherClient, otherOwner;

  const call = async (method, { body, query = {}, token } = {}) => {
    const r = res();
    await handler({
      method, query, body,
      headers: token ? { authorization: "Bearer " + token } : {}
    }, r);
    return r;
  };

  const countAlerts = async () =>
    Number((await db.query(`SELECT count(*)::int AS n FROM alerts WHERE org_id = $1`, [org])).rows[0].n);

  async function purge() {
    const orgs = (await db.query(`SELECT id FROM orgs WHERE slug = ANY($1)`, [[ORG_SLUG, OTHER_ORG_SLUG]]))
      .rows.map((r) => r.id);
    if (orgs.length) {
      // Explicit, table by table, so a failure names where it happened rather
      // than arriving as a cascade nobody can read.
      await db.query(`DELETE FROM alerts WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM upsell_triggers WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM snapshots WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM tradelines WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM clients WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
      await db.query(`DELETE FROM orgs WHERE id = ANY($1)`, [orgs]);
    }
  }

  const makeStaff = async (orgId, name, role, email) => {
    const id = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [orgId, name, role, email])).rows[0].id;
    return { id, token: (await createSession(db, { staffId: id, orgId })).token };
  };

  before(async () => {
    await purge();

    /* ITS OWN COMPANY, NOT THE DEFAULT ONE. Everything this suite writes is
       configuration that changes which clients get flagged, and leaving a
       switched-on rule behind on the shared default org would quietly change
       what every other suite sees. */
    org = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'Alerts Httptest Co') RETURNING id`, [ORG_SLUG])).rows[0].id;
    owner = await makeStaff(org, "Alerts Httptest Owner", "owner", "alerts_http_test_owner@example.com");
    advisor = await makeStaff(org, "Alerts Httptest Advisor", "funding_advisor", "alerts_http_test_advisor@example.com");

    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Alerts','Subject','alerts.http.test.subject@example.com') RETURNING id`,
      [org])).rows[0].id;

    /* One card, 80% used, dated. 80% is over any threshold this suite sets, and
       the as-of date is what an alert must carry through to its own column. */
    await db.query(
      `INSERT INTO tradelines (org_id, client_id, lender, kind, credit_limit_cents, balance_cents, apr, as_of, source)
       VALUES ($1,$2,'Alerts Test Card','revolving',1000000,800000,0.24990,'2026-07-01T00:00:00Z','manual')`,
      [org, client]);

    await db.query(
      `INSERT INTO snapshots (org_id, client_id, source, is_primary, bureau, score)
       VALUES ($1,$2,'crs',true,'Equifax',640)`,
      [org, client]);

    /* A SECOND COMPANY. On a one-org database a cross-tenant read is invisible,
       which is exactly how the same hole survived on the tradelines and
       bank_accounts paths. */
    otherOrg = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'Alerts Httptest Other Co') RETURNING id`,
      [OTHER_ORG_SLUG])).rows[0].id;
    otherClient = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Alerts','Otherco','alerts.http.test.otherco@example.com') RETURNING id`,
      [otherOrg])).rows[0].id;
    otherOwner = await makeStaff(otherOrg, "Alerts Httptest Otherco Owner", "owner",
      "alerts_http_test_otherco_owner@example.com");
  });

  after(async () => { await purge(); await close(); });

  /* ── configuration lands in the columns it says it does ──────────────────── */

  test("a fresh company has no rules at all, and every rule is still offered", async () => {
    const r = await call("GET", { token: owner.token, query: { view: "triggers" } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.triggers.length, 3);
    for (const t of r.body.triggers) {
      assert.equal(t.configured, false);
      assert.equal(t.enabled, false, "a rule arrived switched on, on a company nobody has configured");
      assert.strictEqual(t.threshold_display, null);
    }
    assert.equal(await countAlerts(), 0);
  });

  test("an empty threshold box reaches the column as NULL, not as zero", async () => {
    const r = await call("POST", {
      token: owner.token,
      body: { action: "set_trigger", rule: "utilization_over_threshold", enabled: true, threshold_pct: "" }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const row = (await db.query(
      `SELECT threshold_bps, enabled FROM upsell_triggers WHERE org_id = $1 AND rule = 'utilization_over_threshold'`,
      [org])).rows[0];
    assert.strictEqual(row.threshold_bps, null,
      "an unset threshold became a number in the column — 0 fires on every client with a balance");
    assert.equal(row.enabled, true);
  });

  test("an enabled rule with no threshold refuses to fire, against real data", async () => {
    const r = await call("POST", { token: owner.token, body: { action: "evaluate", client_id: client } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const rule = r.body.rules.find((x) => x.rule === "utilization_over_threshold");
    assert.equal(rule.outcome, "not_run");
    assert.equal(rule.reason, "threshold_unset");
    assert.equal(await countAlerts(), 0, "a rule with no threshold wrote an alert about a real person");
  });

  test("saving the same rule twice is one row, not two thresholds", async () => {
    await call("POST", {
      token: owner.token,
      body: { action: "set_trigger", rule: "utilization_over_threshold", enabled: true, threshold_pct: 40 }
    });
    const r = await call("POST", {
      token: owner.token,
      body: { action: "set_trigger", rule: "utilization_over_threshold", enabled: true, threshold_pct: 30 }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const rows = (await db.query(
      `SELECT threshold_bps FROM upsell_triggers WHERE org_id = $1 AND rule = 'utilization_over_threshold'`,
      [org])).rows;
    assert.equal(rows.length, 1, "a second row would be a second threshold and nothing could say which applied");
    assert.equal(rows[0].threshold_bps, 3000);
  });

  /* ── THE DRY RUN. The reason this file exists. ───────────────────────────── */

  test("a dry run says what WOULD fire and leaves the database untouched", async () => {
    const before = await countAlerts();
    const r = await call("POST", {
      token: owner.token,
      body: { action: "evaluate", client_id: client, dry_run: true }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.dry_run, true);
    assert.equal(r.body.wrote, false);

    const rule = r.body.rules.find((x) => x.rule === "utilization_over_threshold");
    assert.equal(rule.outcome, "would_raise",
      "the preview did not report the condition this client is plainly in");
    assert.ok(/80%/.test(rule.alert.title), "the preview lost the figures behind the decision");
    assert.strictEqual(rule.alert.id, null,
      "the preview handed back the id of a row it rolled away — a button pointing at nothing");

    assert.equal(await countAlerts(), before,
      "THE DRY RUN WROTE AN ALERT. The transaction was not rolled back.");
  });

  test("a dry run can be repeated and still writes nothing", async () => {
    const before = await countAlerts();
    await call("POST", { token: owner.token, body: { action: "evaluate", client_id: client, dry_run: true } });
    await call("POST", { token: owner.token, body: { action: "evaluate", client_id: client, dry_run: true } });
    assert.equal(await countAlerts(), before);
  });

  /* ── the real run ────────────────────────────────────────────────────────── */

  test("a real run writes one alert, carrying the date the data was true", async () => {
    const r = await call("POST", { token: owner.token, body: { action: "evaluate", client_id: client } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.wrote, true);
    assert.equal(r.body.as_of, "2026-07-01T00:00:00.000Z");

    const rows = (await db.query(
      `SELECT * FROM alerts WHERE org_id = $1 AND client_id = $2`, [org, client])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "utilization_threshold");
    assert.equal(rows[0].state, "open");
    assert.equal(new Date(rows[0].as_of).toISOString(), "2026-07-01T00:00:00.000Z",
      "the alert is dated when it was written rather than when the balances were true");
    assert.ok(rows[0].trigger_id, "the alert does not name the rule that raised it");
    assert.match(rows[0].title, /^Total utilization is 80%/);
  });

  test("running it again does not stack a second identical alert", async () => {
    const r = await call("POST", { token: owner.token, body: { action: "evaluate", client_id: client } });
    const rule = r.body.rules.find((x) => x.rule === "utilization_over_threshold");
    assert.equal(rule.outcome, "already_open");
    const n = Number((await db.query(
      `SELECT count(*)::int AS n FROM alerts WHERE org_id = $1 AND client_id = $2`, [org, client])).rows[0].n);
    assert.equal(n, 1);
  });

  test("the queue read returns it with the client's name and the numbers behind it", async () => {
    const r = await call("GET", { token: owner.token });
    assert.equal(r.code, 200);
    assert.equal(r.body.alerts.length, 1);
    const a = r.body.alerts[0];
    assert.equal(a.client_name, "Alerts Subject");
    const byLabel = Object.fromEntries(a.figures.map((f) => [f.label, f]));
    assert.equal(byLabel["Total balance"].display, "8000.00");
    assert.equal(byLabel["Card use"].display, "80%");
  });

  test("acknowledging moves the row and records who did it; a second one changes nothing", async () => {
    const id = (await db.query(`SELECT id FROM alerts WHERE org_id = $1 LIMIT 1`, [org])).rows[0].id;

    const first = await call("POST", { token: owner.token, body: { action: "acknowledge", alert_id: id } });
    assert.equal(first.code, 200, JSON.stringify(first.body));
    assert.equal(first.body.changed, true);

    const row = (await db.query(`SELECT state, acknowledged_by, acknowledged_at FROM alerts WHERE id = $1`, [id])).rows[0];
    assert.equal(row.state, "acknowledged");
    assert.equal(row.acknowledged_by, owner.id);
    assert.ok(row.acknowledged_at);

    const second = await call("POST", { token: advisor.token, body: { action: "acknowledge", alert_id: id } });
    assert.equal(second.code, 200);
    assert.equal(second.body.changed, false, "a second acknowledgement overwrote the first");
    assert.equal(second.body.reason, "already_acknowledged");
    const after = (await db.query(`SELECT acknowledged_by FROM alerts WHERE id = $1`, [id])).rows[0];
    assert.equal(after.acknowledged_by, owner.id, "the first acknowledgement did not win");
  });

  /* ── one company cannot see or touch another's ───────────────────────────── */

  test("another company's owner sees none of these alerts", async () => {
    const r = await call("GET", { token: otherOwner.token });
    assert.equal(r.code, 200);
    assert.equal(r.body.alerts.length, 0, "an alert about another company's client was served");
  });

  test("another company's owner cannot evaluate this company's client", async () => {
    const r = await call("POST", {
      token: otherOwner.token,
      body: { action: "evaluate", client_id: client }
    });
    assert.equal(r.code, 403);
  });

  test("another company's owner cannot acknowledge this company's alert", async () => {
    const id = (await db.query(`SELECT id FROM alerts WHERE org_id = $1 LIMIT 1`, [org])).rows[0].id;
    const r = await call("POST", { token: otherOwner.token, body: { action: "resolve", alert_id: id } });
    assert.equal(r.code, 404, "an id from another company was accepted as an authorisation");
  });

  test("a rule switched on for one company is not switched on for another", async () => {
    const r = await call("GET", { token: otherOwner.token, query: { view: "triggers" } });
    for (const t of r.body.triggers) {
      assert.equal(t.enabled, false, "another company's configuration leaked across the tenancy line");
      assert.equal(t.configured, false);
    }
  });

  /* ── the score rule, end to end ──────────────────────────────────────────── */

  test("the score on file is read from this org's snapshot and the rule fires on it", async () => {
    await call("POST", {
      token: owner.token,
      body: { action: "set_trigger", rule: "score_below_threshold", enabled: true, threshold_score: 700 }
    });
    const r = await call("POST", { token: owner.token, body: { action: "evaluate", client_id: client } });
    assert.equal(r.body.inputs.score.known, true);
    assert.equal(r.body.inputs.score.score, 640);
    const rule = r.body.rules.find((x) => x.rule === "score_below_threshold");
    assert.equal(rule.outcome, "raised");
    const row = (await db.query(
      `SELECT title, kind FROM alerts WHERE org_id = $1 AND kind = 'score_band'`, [org])).rows[0];
    assert.ok(row, "the score rule reported firing and wrote nothing");
    assert.ok(!/\b(good|bad|poor|excellent)\b/i.test(row.title),
      "an alert title judged somebody's credit");
  });

  test("switching a rule off stops it, and says so rather than saying the client is fine", async () => {
    await call("POST", {
      token: owner.token,
      body: { action: "set_trigger", rule: "score_below_threshold", enabled: false, threshold_score: 700 }
    });
    const r = await call("POST", { token: owner.token, body: { action: "evaluate", client_id: client } });
    const rule = r.body.rules.find((x) => x.rule === "score_below_threshold");
    assert.equal(rule.outcome, "not_run");
    assert.equal(rule.reason, "rule_disabled");
    assert.equal(rule.threshold_display, "700", "the threshold was wiped by switching the rule off");
  });
});
