// Spend ceilings and the daily loop, against a real Postgres.
//
// Skipped without DATABASE_URL.
//
// The simulated-overspend test is the one the spec asks for by name. It proves
// the two enforcement points are genuinely INDEPENDENT: the kill switch trips on
// actual platform spend even when ad_metrics_daily says everything is fine, which
// is exactly the failure a single combined check would miss.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { asStaff, asPartner } from "../partners/rls.mjs";
import { checkBudgetWrite, runKillSwitch, capIncrease } from "./ceilings.mjs";
import { runDailyOptimization } from "./run.mjs";
import { undo } from "../adplatforms/index.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SLUG = "ceil-test-";

describe("spend ceilings", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();
      // The category map is seeded with real values by 052_config_defaults.sql, so no
      // fixture row is needed. It used to insert TEST_CATEGORY here with ON CONFLICT
      // DO NOTHING, which meant whichever ran first won — and on a database where the
      // tests had run, the fixture value shadowed the migration's. A test fixture must
      // not compete with a migration for the same config row.
  });
  after(async () => { await cleanup(); await close(); });

  // ---------------------------------------------------------------- pre-flight

  test("no configured ceiling is a DENY, not an allow", async () => {
    const { partnerId } = await fixture("noceiling", { ceiling: null });
    const res = await asPartner(partnerId, (tx) =>
      checkBudgetWrite(tx, { partnerId, currentBudgetCents: 1000, proposedBudgetCents: 2000 }));
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.reasons[0].code, "no_ceiling_configured");
  });

  test("a write under every ceiling is allowed", async () => {
    const { partnerId, campaignId } = await fixture("under", { ceiling: 1_000_00 });
    const res = await asPartner(partnerId, (tx) =>
      checkBudgetWrite(tx, { partnerId, campaignId, platform: "meta",
                             currentBudgetCents: 10_00, proposedBudgetCents: 11_00 }));
    assert.strictEqual(res.allowed, true, JSON.stringify(res.reasons));
  });

  test("a write over the partner ceiling is denied", async () => {
    const { partnerId, campaignId } = await fixture("overpartner", { ceiling: 50_00 });
    const res = await asPartner(partnerId, (tx) =>
      checkBudgetWrite(tx, { partnerId, campaignId, platform: "meta",
                             currentBudgetCents: 10_00, proposedBudgetCents: 100_00 }));
    assert.strictEqual(res.allowed, false);
    assert.ok(res.reasons.some((r) => r.code === "over_ceiling"));
  });

  test("all three scopes are evaluated, not just the first match", async () => {
    const { partnerId, campaignId } = await fixture("threescope", {
      ceiling: 1_000_00, campaignCeiling: 20_00, platformCeiling: 30_00 });
    const res = await asPartner(partnerId, (tx) =>
      checkBudgetWrite(tx, { partnerId, campaignId, platform: "meta",
                             currentBudgetCents: 0, proposedBudgetCents: 100_00 }));
    assert.strictEqual(res.allowed, false);
    const scopes = res.reasons.filter((r) => r.code === "over_ceiling").map((r) => r.scope).sort();
    assert.deepStrictEqual(scopes, ["campaign", "platform"]);
  });

  test("an increase over max_daily_increase_pct is denied even under the ceiling", async () => {
    // Well inside the daily limit, but a 100% jump in one step.
    const { partnerId, campaignId } = await fixture("bigjump", { ceiling: 10_000_00, increasePct: 20 });
    const res = await asPartner(partnerId, (tx) =>
      checkBudgetWrite(tx, { partnerId, campaignId, platform: "meta",
                             currentBudgetCents: 100_00, proposedBudgetCents: 200_00 }));
    assert.strictEqual(res.allowed, false);
    assert.ok(res.reasons.some((r) => r.code === "increase_too_large"));
  });

  test("exactly max_daily_increase_pct is allowed — the boundary is inclusive", async () => {
    const { partnerId, campaignId } = await fixture("exactpct", { ceiling: 10_000_00, increasePct: 20 });
    const res = await asPartner(partnerId, (tx) =>
      checkBudgetWrite(tx, { partnerId, campaignId, platform: "meta",
                             currentBudgetCents: 100_00, proposedBudgetCents: 120_00 }));
    assert.strictEqual(res.allowed, true, JSON.stringify(res.reasons));
  });

  test("the 30% hard cap cannot be exceeded by config", async () => {
    // The CHECK in 046 refuses the row outright.
    const { partnerId } = await fixture("hardcap", { ceiling: 100_00 });
    await assert.rejects(
      () => asStaff((tx) => tx.query(
        `UPDATE spend_ceilings SET max_daily_increase_pct = 50 WHERE partner_id = $1`, [partnerId])),
      /spend_ceilings_increase_ck/);
  });

  test("capIncrease never returns more than 30% above current", () => {
    assert.strictEqual(capIncrease(10000, 20), 12000);
    assert.strictEqual(capIncrease(10000, 80), 13000);
  });

  test("a breached ceiling blocks every further write", async () => {
    const { partnerId, campaignId } = await fixture("breached", { ceiling: 1_000_00 });
    await asStaff((tx) => tx.query(
      `UPDATE spend_ceilings SET breached_at = now(), breach_reason = 'test' WHERE partner_id = $1`,
      [partnerId]));
    const res = await asPartner(partnerId, (tx) =>
      checkBudgetWrite(tx, { partnerId, campaignId, platform: "meta",
                             currentBudgetCents: 10_00, proposedBudgetCents: 11_00 }));
    assert.strictEqual(res.allowed, false);
    assert.ok(res.reasons.some((r) => r.code === "ceiling_breached"));
  });

  // ---------------------------------------------------------------- kill switch

  test("SIMULATED OVERSPEND: the kill switch trips on ACTUAL platform spend even when our mirror looks clean", async () => {
    // The independence test. ad_metrics_daily reports well under the ceiling — a
    // dropped sync, a timezone bug at the day boundary, whatever — so the
    // pre-flight check would happily allow more spend. The kill switch reads the
    // platform instead and stops it.
    const { partnerId, campaignId, adId } = await fixture("overspend", { ceiling: 100_00 });
    await asStaff((tx) => tx.query(
      `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, spend_cents)
       VALUES ($1,$2,$3,CURRENT_DATE,$4)`, [org, partnerId, adId, 10_00]));

    const preflight = await asPartner(partnerId, (tx) =>
      checkBudgetWrite(tx, { partnerId, campaignId, platform: "meta",
                             currentBudgetCents: 10_00, proposedBudgetCents: 11_00 }));
    assert.strictEqual(preflight.allowed, true, "our mirror says everything is fine");

    const paused = [];
    const res = await asStaff((tx) => runKillSwitch(tx, {
      partnerId,
      // The platform's truth: five times the ceiling.
      fetchActualSpend: async () => 500_00,
      pausePlatform: async (a) => { paused.push(a); }
    }));

    assert.strictEqual(res.tripped.length, 1);
    assert.ok(res.tripped[0].reason.includes("exceeded"));
    assert.strictEqual(paused.length, 1, "the platform must actually be paused");

    // And the ceiling now blocks further writes.
    const after = await asPartner(partnerId, (tx) =>
      checkBudgetWrite(tx, { partnerId, campaignId, platform: "meta",
                             currentBudgetCents: 10_00, proposedBudgetCents: 11_00 }));
    assert.strictEqual(after.allowed, false);

    // The live campaign is paused in our mirror too, so no reader disagrees with
    // the platform.
    const camp = await asPartner(partnerId, (tx) =>
      tx.query(`SELECT approval_state FROM campaigns WHERE id = $1`, [campaignId]).then((r) => r.rows[0]));
    assert.strictEqual(camp.approval_state, "paused");

    // And it left an action_log row saying why.
    const log = await asPartner(partnerId, (tx) =>
      tx.query(`SELECT rule_key, actor, undo_payload FROM action_log
                 WHERE partner_id = $1 AND rule_key = 'kill_switch_ceiling'`, [partnerId])
        .then((r) => r.rows[0]));
    assert.strictEqual(log.actor, "agent");
    assert.ok(log.undo_payload, "every automated action carries an undo payload");
  });

  test("a platform we cannot read is recorded, never treated as zero spend", async () => {
    const { partnerId } = await fixture("unreadable", { ceiling: 100_00 });
    const res = await asStaff((tx) => runKillSwitch(tx, {
      partnerId, fetchActualSpend: async () => { throw new Error("insights API down"); }
    }));
    assert.strictEqual(res.tripped[0].reason, "unreadable");
  });

  test("runKillSwitch refuses to run without an actual-spend source", async () => {
    const { partnerId } = await fixture("nosource", { ceiling: 100_00 });
    await assert.rejects(
      () => asStaff((tx) => runKillSwitch(tx, { partnerId })),
      /fetchActualSpend is required/);
  });

  // ---------------------------------------------------------------- daily loop

  test("autopilot is OFF by default — no settings row means no automated spending", async () => {
    const { partnerId } = await fixture("nopilot", { ceiling: 100_00, settings: false });
    const res = await asPartner(partnerId, (tx) => runDailyOptimization(tx, { orgId: org, partnerId }));
    assert.strictEqual(res.ran, false);
    assert.strictEqual(res.skipped, "autopilot_disabled");
  });

  test("a paused autopilot stops the whole loop", async () => {
    const { partnerId } = await fixture("paused", { ceiling: 100_00, autopilot: true });
    await asStaff((tx) => tx.query(
      `UPDATE partner_module_settings SET autopilot_paused_at = now() WHERE partner_id = $1`, [partnerId]));
    const res = await asPartner(partnerId, (tx) => runDailyOptimization(tx, { orgId: org, partnerId }));
    assert.strictEqual(res.skipped, "autopilot_paused");
  });

  test("scale_winner logs its action_log row and the undo restores the budget", async () => {
    const { partnerId, adSetId, adId } = await fixture("scale", { ceiling: 10_000_00, autopilot: true });

    // Three consecutive days above a ROAS target of 2.
    await asStaff(async (tx) => {
      await tx.query(
        `UPDATE optimization_rules SET params = jsonb_set(params,'{target_roas}','2')
          WHERE org_id = $1 AND rule_key = 'scale_winner'`, [org]);
      for (let i = 3; i >= 1; i--) {
        await tx.query(
          `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, spend_cents, conversions, roas, ctr, frequency, cpa_cents)
           VALUES ($1,$2,$3,CURRENT_DATE - $4::int, 1000, 5, 4.0, 3.0, 1.2, 200)`,
          [org, partnerId, adId, i]);
      }
    });

    const res = await asPartner(partnerId, (tx) =>
      runDailyOptimization(tx, { orgId: org, partnerId }));

    const scale = res.actions.find((a) => a.rule_key === "scale_winner");
    assert.ok(scale, `expected scale_winner to fire, got ${JSON.stringify(res.actions.map((a) => a.rule_key))}`);
    assert.strictEqual(scale.ok, true, JSON.stringify(scale.reasons));

    const budgetAfter = await asPartner(partnerId, (tx) =>
      tx.query(`SELECT budget_cents FROM ad_sets WHERE id = $1`, [adSetId]).then((r) => Number(r.rows[0].budget_cents)));
    assert.strictEqual(budgetAfter, 12000, "20% of 10000");

    // The action_log row: rule, metrics, before/after, undo payload.
    const log = await asPartner(partnerId, (tx) =>
      tx.query(`SELECT * FROM action_log WHERE id = $1`, [scale.actionLogId]).then((r) => r.rows[0]));
    assert.strictEqual(log.rule_key, "scale_winner");
    assert.strictEqual(log.actor, "agent");
    assert.ok(log.executed_at, "executed_at must be stamped after the action");
    assert.strictEqual(Number(log.before.budget_cents), 10000);
    assert.strictEqual(Number(log.after.budget_cents), 12000);
    assert.ok(log.metrics_snapshot.roas_window, "the triggering metrics must be recorded");

    // THE UNDO.
    await asPartner(partnerId, (tx) => undo(tx, scale.actionLogId, {
      execute: async (payload) => {
        await tx.query(`UPDATE ad_sets SET budget_cents = $2 WHERE id = $1`,
          [payload.ad_set_id, payload.budget_cents]);
      }
    }));

    const restored = await asPartner(partnerId, (tx) =>
      tx.query(`SELECT budget_cents FROM ad_sets WHERE id = $1`, [adSetId]).then((r) => Number(r.rows[0].budget_cents)));
    assert.strictEqual(restored, 10000, "the undo must restore the exact prior budget");

    // Undo is idempotent — a double click cannot double-revert.
    const again = await asPartner(partnerId, (tx) => undo(tx, scale.actionLogId, {}));
    assert.strictEqual(again.alreadyUndone, true);
  });

  test("the loop is idempotent — a second run the same day acts once", async () => {
    const { partnerId, adSetId, adId } = await fixture("idem", { ceiling: 10_000_00, autopilot: true });
    await asStaff(async (tx) => {
      await tx.query(
        `UPDATE optimization_rules SET params = jsonb_set(params,'{target_roas}','2')
          WHERE org_id = $1 AND rule_key = 'scale_winner'`, [org]);
      for (let i = 3; i >= 1; i--) {
        await tx.query(
          `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, spend_cents, conversions, roas, ctr, frequency, cpa_cents)
           VALUES ($1,$2,$3,CURRENT_DATE - $4::int, 1000, 5, 4.0, 3.0, 1.2, 200)`,
          [org, partnerId, adId, i]);
      }
    });

    await asPartner(partnerId, (tx) => runDailyOptimization(tx, { orgId: org, partnerId }));
    const second = await asPartner(partnerId, (tx) => runDailyOptimization(tx, { orgId: org, partnerId }));

    const scale = second.actions.find((a) => a.rule_key === "scale_winner");
    assert.strictEqual(scale?.skipped, "already_acted_today");

    const budget = await asPartner(partnerId, (tx) =>
      tx.query(`SELECT budget_cents FROM ad_sets WHERE id = $1`, [adSetId]).then((r) => Number(r.rows[0].budget_cents)));
    assert.strictEqual(budget, 12000, "a second run must not raise the budget twice");
  });

  test("action_log is append-only and immutable", async () => {
    const { partnerId } = await fixture("append", { ceiling: 100_00 });
    const id = await asStaff((tx) => tx.query(
      `INSERT INTO action_log (org_id, partner_id, actor, target_type, reason)
       VALUES ($1,$2,'human','campaign','test') RETURNING id`, [org, partnerId]).then((r) => r.rows[0].id));

    await assert.rejects(
      () => asStaff((tx) => tx.query(`DELETE FROM action_log WHERE id = $1`, [id])), /append-only/);
    await assert.rejects(
      () => asStaff((tx) => tx.query(`UPDATE action_log SET reason = 'rewritten' WHERE id = $1`, [id])),
      /immutable/);
    // But the outcome stamps are allowed.
    await asStaff((tx) => tx.query(`UPDATE action_log SET executed_at = now() WHERE id = $1`, [id]));
  });

  test("an agent action without a rule_key or undo payload is rejected at the engine", async () => {
    const { partnerId } = await fixture("agentck", { ceiling: 100_00 });
    await assert.rejects(
      () => asStaff((tx) => tx.query(
        `INSERT INTO action_log (org_id, partner_id, actor, target_type, reason)
         VALUES ($1,$2,'agent','campaign','no rule, no undo')`, [org, partnerId])),
      /action_log_agent_ck/);
  });

  // ---------------------------------------------------------------- fixture

  let n = 0;
  async function fixture(name, { ceiling, campaignCeiling, platformCeiling, increasePct = 20,
                                 settings = true, autopilot = false } = {}) {
    const slug = `${SLUG}${name}-${n++}`;
    const partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at)
       VALUES ($1,$2,$3,'active',now()) RETURNING id`, [org, name, slug])).rows[0].id;

    return asStaff(async (tx) => {
      if (settings) {
        await tx.query(
          `INSERT INTO partner_module_settings (org_id, partner_id, autopilot_enabled, launch_enabled)
           VALUES ($1,$2,$3,true)`, [org, partnerId, autopilot]);
      }
      const connId = (await tx.query(
        `INSERT INTO ad_platform_connections
           (org_id, partner_id, platform, external_ad_account_id, connection_state,
            platform_verification_state, encrypted_access_token)
         VALUES ($1,$2,'meta',$3,'active','approved','v1:x:y:z') RETURNING id`,
        [org, partnerId, `acct-${slug}`])).rows[0].id;

      const campaignId = (await tx.query(
        `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type, budget_cents,
                                approval_state, approved_by, approved_at)
         VALUES ($1,$2,$3,'C','funding',10000,'live',NULL,now()) RETURNING id`,
        [org, partnerId, connId])).rows[0].id;

      const adSetId = (await tx.query(
        `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name, budget_cents, approval_state)
         VALUES ($1,$2,$3,$4,'AS',10000,'live') RETURNING id`,
        [org, partnerId, connId, campaignId])).rows[0].id;

      const adId = (await tx.query(
        `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id, name, approval_state)
         VALUES ($1,$2,$3,$4,$5,'AD','live') RETURNING id`,
        [org, partnerId, connId, campaignId, adSetId])).rows[0].id;

      if (ceiling !== null && ceiling !== undefined) {
        await tx.query(
          `INSERT INTO spend_ceilings (org_id, partner_id, scope, daily_limit_cents, max_daily_increase_pct)
           VALUES ($1,$2,'partner',$3,$4)`, [org, partnerId, ceiling, increasePct]);
      }
      if (campaignCeiling) {
        await tx.query(
          `INSERT INTO spend_ceilings (org_id, partner_id, scope, campaign_id, daily_limit_cents, max_daily_increase_pct)
           VALUES ($1,$2,'campaign',$3,$4,$5)`, [org, partnerId, campaignId, campaignCeiling, increasePct]);
      }
      if (platformCeiling) {
        await tx.query(
          `INSERT INTO spend_ceilings (org_id, partner_id, scope, platform, daily_limit_cents, max_daily_increase_pct)
           VALUES ($1,$2,'platform','meta',$3,$4)`, [org, partnerId, platformCeiling, increasePct]);
      }
      return { partnerId, connId, campaignId, adSetId, adId };
    });
  }

  async function cleanup() {
    const ids = (await db.query(
      `SELECT id FROM partners WHERE slug LIKE $1`, [`${SLUG}%`])).rows.map((r) => r.id);
    if (!ids.length) return;
    await db.query(`ALTER TABLE action_log DISABLE TRIGGER trg_action_log_no_delete`);
    await asStaff(async (tx) => {
      for (const t of ["action_log", "ad_metrics_daily", "ads", "ad_sets", "campaigns",
                       "spend_ceilings", "partner_module_settings", "ad_platform_connections"]) {
        await tx.query(`DELETE FROM ${t} WHERE partner_id = ANY($1)`, [ids]);
      }
    });
    await db.query(`ALTER TABLE action_log ENABLE TRIGGER trg_action_log_no_delete`);
    await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [ids]);
    await db.query(
      `UPDATE optimization_rules SET params = jsonb_set(params,'{target_roas}','null')
        WHERE rule_key = 'scale_winner'`);
  }
});
