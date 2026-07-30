// Social scheduler, onboarding blockers, and metering — against a real Postgres.
//
// Skipped without DATABASE_URL.
//
// The metering tests are the important ones in this file. The spec says not to pick
// the two billing rates, and the only way to honour that safely is for billing to
// FAIL LOUDLY while they are unset — because a metering row written against a
// guessed rate is indistinguishable from a real one and would not be noticed until
// an invoice went out.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { asStaff, asPartner } from "../partners/rls.mjs";
import { schedule, publishDue, registerAdapter, nextBestTime } from "./scheduler.mjs";
import { openOnboardingTask, resolveOnboardingTask, checkLaunchReadiness } from "../partners/onboarding.mjs";
import { clearRuleCache } from "../compliance/screen.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SLUG = "soc-test-";

describe("social, onboarding and metering", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();
    clearRuleCache();
  });
  after(async () => { await cleanup(); await close(); });

  // ------------------------------------------------------------------ social

  test("a clean post is screened and queued", async () => {
    const { partnerId, channelId } = await fixture("clean");
    const out = await asPartner(partnerId, (tx) => schedule(tx, {
      orgId: org, partnerId, channelId, offerType: "funding",
      caption: "Business funding for qualified applicants. See if you prequalify.",
      scheduledFor: new Date(Date.now() - 1000).toISOString()
    }));
    assert.notStrictEqual(out.state, "blocked");
    assert.strictEqual(out.post.status, "queued");
  });

  test("banned copy is stored as blocked WITH reasons, not rejected and forgotten", async () => {
    const { partnerId, channelId } = await fixture("blocked");
    const out = await asPartner(partnerId, (tx) => schedule(tx, {
      orgId: org, partnerId, channelId, offerType: "funding",
      caption: "Guaranteed approval, everyone is approved!"
    }));
    assert.strictEqual(out.state, "blocked");
    assert.strictEqual(out.post.status, "blocked");
    assert.ok(out.post.blocked_reasons.length > 0);
  });

  test("organic copy is screened by the SAME rules as paid", async () => {
    // A CROA violation in a caption is the same violation it would be in an ad.
    const { partnerId, channelId } = await fixture("croa");
    const out = await asPartner(partnerId, (tx) => schedule(tx, {
      orgId: org, partnerId, channelId, offerType: "credit_repair",
      caption: "We delete late payments and collections. Get a CPN today."
    }));
    assert.strictEqual(out.state, "blocked");
    const codes = out.post.blocked_reasons.map((r) => r.code);
    assert.ok(codes.includes("remove-late-payments-collections") || codes.includes("file-segregation-cpn"),
      `expected a CROA block, got ${JSON.stringify(codes)}`);
  });

  test("an unscreened post cannot be queued — the engine refuses it", async () => {
    const { partnerId, channelId } = await fixture("unscreened");
    const id = await asStaff((tx) => tx.query(
      `INSERT INTO social_posts (org_id, partner_id, channel_id, caption, offer_type, status)
       VALUES ($1,$2,$3,'x','funding','draft') RETURNING id`,
      [org, partnerId, channelId]).then((r) => r.rows[0].id));

    await assert.rejects(
      () => asStaff((tx) => tx.query(`UPDATE social_posts SET status='queued' WHERE id=$1`, [id])),
      /has not passed the guardrail engine/);
  });

  test("a post cannot use another partner's channel", async () => {
    const a = await fixture("crossA");
    const b = await fixture("crossB");
    await assert.rejects(
      () => asStaff((tx) => tx.query(
        `INSERT INTO social_posts (org_id, partner_id, channel_id, caption, offer_type)
         VALUES ($1,$2,$3,'x','funding')`, [org, a.partnerId, b.channelId])),
      /crosses partners/);
  });

  test("publishing writes an action_log row and stamps the post", async () => {
    const { partnerId, channelId } = await fixture("publish");
    registerAdapter("instagram", { post: async () => ({ external_post_id: "ig-1" }) });

    await asPartner(partnerId, (tx) => schedule(tx, {
      orgId: org, partnerId, channelId, offerType: "funding",
      caption: "Business funding for qualified applicants.",
      scheduledFor: new Date(Date.now() - 1000).toISOString()
    }));
    const results = await asPartner(partnerId, (tx) => publishDue(tx, { orgId: org, partnerId }));
    assert.strictEqual(results[0].ok, true);

    const log = await asPartner(partnerId, (tx) => tx.query(
      `SELECT rule_key, executed_at, undo_payload FROM action_log
        WHERE partner_id = $1 AND target_type = 'social_post'`, [partnerId]).then((r) => r.rows[0]));
    assert.strictEqual(log.rule_key, "social_publish");
    assert.ok(log.executed_at);
    assert.ok(log.undo_payload);
  });

  test("a repeatedly failing post gives up and surfaces as a task", async () => {
    const { partnerId, channelId } = await fixture("failing");
    registerAdapter("instagram", { post: async () => { throw new Error("channel rate limited"); } });

    await asPartner(partnerId, (tx) => schedule(tx, {
      orgId: org, partnerId, channelId, offerType: "funding",
      caption: "Business funding for qualified applicants.",
      scheduledFor: new Date(Date.now() - 1000).toISOString()
    }));
    // Three attempts: retried, retried, gave up.
    for (let i = 0; i < 3; i++) {
      await asPartner(partnerId, (tx) => publishDue(tx, { orgId: org, partnerId }));
    }

    const post = await asPartner(partnerId, (tx) => tx.query(
      `SELECT status, attempt, last_error FROM social_posts WHERE partner_id = $1`, [partnerId])
      .then((r) => r.rows[0]));
    assert.strictEqual(post.status, "failed");
    assert.ok(post.last_error);

    const task = await asPartner(partnerId, (tx) => tx.query(
      `SELECT task_key FROM partner_onboarding_tasks
        WHERE partner_id = $1 AND task_key = 'social_post_failed'`, [partnerId]).then((r) => r.rows[0]));
    assert.ok(task, "a post that gave up must reach a person, not just a status column");
  });

  test("nextBestTime returns null rather than inventing a time", () => {
    // Guessing "now" would publish at whatever hour the job happened to run.
    assert.strictEqual(nextBestTime({ best_times: {} }), null);
    assert.strictEqual(nextBestTime({}), null);
    const when = nextBestTime(
      { best_times: { mon: ["09:00"], tue: ["09:00"], wed: ["09:00"], thu: ["09:00"],
                      fri: ["09:00"], sat: ["09:00"], sun: ["09:00"] } },
      { from: new Date("2026-07-01T06:00:00Z") });
    assert.strictEqual(when, "2026-07-01T09:00:00.000Z");
  });

  // ------------------------------------------------------------------ onboarding

  test("a launch blocker lands on BOTH surfaces", async () => {
    // The partner-visible row is the point; the internal staff task is the mirror.
    const { partnerId, campaignId } = await fixture("blockers", { verification: "unverified" });
    const res = await asPartner(partnerId, (tx) =>
      checkLaunchReadiness(tx, { orgId: org, partnerId, campaignId }));

    assert.strictEqual(res.ready, false);
    assert.ok(res.blockers.some((b) => b.task_key === "verify_business"));

    const visible = await asPartner(partnerId, (tx) => tx.query(
      `SELECT task_key, severity FROM partner_onboarding_tasks
        WHERE partner_id = $1 AND resolved_at IS NULL`, [partnerId]).then((r) => r.rows));
    assert.ok(visible.some((t) => t.task_key === "verify_business"),
      "the partner must be able to see the blocker they have to fix");
  });

  test("an approved, active connection is launch-ready", async () => {
    const { partnerId, campaignId } = await fixture("ready", { verification: "approved" });
    const res = await asPartner(partnerId, (tx) =>
      checkLaunchReadiness(tx, { orgId: org, partnerId, campaignId }));
    assert.strictEqual(res.ready, true, JSON.stringify(res.blockers));
  });

  test("opening the same blocker twice keeps one open row", async () => {
    const { partnerId } = await fixture("dedupe");
    for (let i = 0; i < 3; i++) {
      await asPartner(partnerId, (tx) => openOnboardingTask(tx, {
        orgId: org, partnerId, taskKey: "verify_business", title: "Verify", detail: `attempt ${i}` }));
    }
    const rows = await asPartner(partnerId, (tx) => tx.query(
      `SELECT id, detail FROM partner_onboarding_tasks
        WHERE partner_id = $1 AND resolved_at IS NULL`, [partnerId]).then((r) => r.rows));
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].detail, "attempt 2", "the detail is refreshed");
  });

  test("a resolved blocker does not prevent the same problem recurring later", async () => {
    // Why the unique index is partial on resolved_at IS NULL.
    const { partnerId } = await fixture("recur");
    await asPartner(partnerId, (tx) => openOnboardingTask(tx, {
      orgId: org, partnerId, taskKey: "verify_business", title: "Verify" }));
    await asPartner(partnerId, (tx) => resolveOnboardingTask(tx, { partnerId, taskKey: "verify_business" }));
    await asPartner(partnerId, (tx) => openOnboardingTask(tx, {
      orgId: org, partnerId, taskKey: "verify_business", title: "Verify again" }));

    const all = await asPartner(partnerId, (tx) => tx.query(
      `SELECT resolved_at FROM partner_onboarding_tasks WHERE partner_id = $1`, [partnerId])
      .then((r) => r.rows));
    assert.strictEqual(all.length, 2);
  });

  // ------------------------------------------------------------------ metering

  test("accruing usage RAISES while the rate is unset, rather than billing zero", async () => {
    // The spec said not to pick these numbers. This is what makes that safe.
    const { partnerId } = await fixture("norate");
    await assert.rejects(
      () => asStaff((tx) => tx.query(
        `SELECT accrue_creative_usage($1,$2,'generation',1,1000,'evt-1')`, [org, partnerId])),
      /generation_markup_pct is not set/);
  });

  test("both rates ship unset and flagged", async () => {
    const rows = (await db.query(
      `SELECT rate_key, rate, notes FROM creative_billing_rates WHERE org_id = $1 ORDER BY rate_key`,
      [org])).rows;
    assert.strictEqual(rows.length, 2);
    for (const r of rows) {
      assert.strictEqual(r.rate, null, `${r.rate_key} must ship unset`);
      assert.match(r.notes, /FLAGGED/);
    }
  });

  test("once a rate is set, accrual is idempotent on source_event_id", async () => {
    const { partnerId } = await fixture("meter");
    await db.query(
      `UPDATE creative_billing_rates SET rate = 25 WHERE org_id = $1 AND rate_key = 'generation_markup_pct'`,
      [org]);
    try {
      const first = await asStaff((tx) => tx.query(
        `SELECT accrue_creative_usage($1,$2,'generation',1,1000,'evt-dup') AS id`, [org, partnerId])
        .then((r) => r.rows[0].id));
      const second = await asStaff((tx) => tx.query(
        `SELECT accrue_creative_usage($1,$2,'generation',1,1000,'evt-dup') AS id`, [org, partnerId])
        .then((r) => r.rows[0].id));

      assert.strictEqual(first, second, "same event twice must be one row");
      const n = await asPartner(partnerId, (tx) => tx.query(
        `SELECT count(*)::int AS n, min(total_cents) AS total FROM creative_usage_events
          WHERE partner_id = $1`, [partnerId]).then((r) => r.rows[0]));
      assert.strictEqual(n.n, 1);
      assert.strictEqual(Number(n.total), 250, "25% of 1000 cents");
    } finally {
      await db.query(
        `UPDATE creative_billing_rates SET rate = NULL WHERE org_id = $1 AND rate_key = 'generation_markup_pct'`,
        [org]);
    }
  });

  test("the rate is stored AS APPLIED so a later change cannot restate history", async () => {
    const { partnerId } = await fixture("asapplied");
    await db.query(
      `UPDATE creative_billing_rates SET rate = 10 WHERE org_id = $1 AND rate_key = 'generation_markup_pct'`,
      [org]);
    try {
      await asStaff((tx) => tx.query(
        `SELECT accrue_creative_usage($1,$2,'generation',1,1000,'evt-rate')`, [org, partnerId]));
      await db.query(
        `UPDATE creative_billing_rates SET rate = 80 WHERE org_id = $1 AND rate_key = 'generation_markup_pct'`,
        [org]);

      const row = await asPartner(partnerId, (tx) => tx.query(
        `SELECT rate_pct_applied, total_cents FROM creative_usage_events WHERE partner_id = $1`,
        [partnerId]).then((r) => r.rows[0]));
      assert.strictEqual(Number(row.rate_pct_applied), 10);
      assert.strictEqual(Number(row.total_cents), 100, "already-accrued money must not be restated");
    } finally {
      await db.query(
        `UPDATE creative_billing_rates SET rate = NULL WHERE org_id = $1 AND rate_key = 'generation_markup_pct'`,
        [org]);
    }
  });

  test("usage events cannot be deleted, only voided", async () => {
    const { partnerId } = await fixture("novoid");
    await db.query(
      `UPDATE creative_billing_rates SET rate = 10 WHERE org_id = $1 AND rate_key = 'managed_spend_pct'`,
      [org]);
    try {
      const id = await asStaff((tx) => tx.query(
        `SELECT accrue_creative_usage($1,$2,'managed_spend',1,5000,'evt-void') AS id`, [org, partnerId])
        .then((r) => r.rows[0].id));
      await assert.rejects(
        () => asStaff((tx) => tx.query(`DELETE FROM creative_usage_events WHERE id = $1`, [id])),
        /not deletable/);
      await assert.rejects(
        () => asStaff((tx) => tx.query(`UPDATE creative_usage_events SET status='void' WHERE id=$1`, [id])),
        /creative_usage_events_void_ck/);
      await asStaff((tx) => tx.query(
        `UPDATE creative_usage_events SET status='void', void_reason='test' WHERE id=$1`, [id]));
    } finally {
      await db.query(
        `UPDATE creative_billing_rates SET rate = NULL WHERE org_id = $1 AND rate_key = 'managed_spend_pct'`,
        [org]);
    }
  });

  test("usage events are partner-isolated", async () => {
    const a = await fixture("isoA");
    const b = await fixture("isoB");
    await db.query(
      `UPDATE creative_billing_rates SET rate = 10 WHERE org_id = $1 AND rate_key = 'generation_markup_pct'`,
      [org]);
    try {
      await asStaff((tx) => tx.query(
        `SELECT accrue_creative_usage($1,$2,'generation',1,1000,'evt-iso')`, [org, a.partnerId]));
      const seen = await asPartner(b.partnerId, (tx) => tx.query(
        `SELECT id FROM creative_usage_events`).then((r) => r.rows));
      assert.deepStrictEqual(seen, [], "partner B read partner A's billing rows");
    } finally {
      await db.query(
        `UPDATE creative_billing_rates SET rate = NULL WHERE org_id = $1 AND rate_key = 'generation_markup_pct'`,
        [org]);
    }
  });

  // ------------------------------------------------------------------ fixture

  let n = 0;
  async function fixture(name, { verification = "approved" } = {}) {
    // Lowercased: partners_slug_fmt_ck restricts a slug to a URL key, and a
    // fixture name like "crossA" would otherwise fail the constraint rather than
    // the test.
    const slug = `${SLUG}${name}-${n++}`.toLowerCase();
    const partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at)
       VALUES ($1,$2,$3,'active',now()) RETURNING id`, [org, name, slug])).rows[0].id;

    return asStaff(async (tx) => {
      await tx.query(
        `INSERT INTO partner_module_settings (org_id, partner_id, approve_before_launch)
         VALUES ($1,$2,false)`, [org, partnerId]);

      const channelId = (await tx.query(
        `INSERT INTO social_channels
           (org_id, partner_id, channel, external_account_id, connection_state, encrypted_access_token)
         VALUES ($1,$2,'instagram',$3,'active','v1:a:b:c') RETURNING id`,
        [org, partnerId, `ig-${slug}`])).rows[0].id;

      const connId = (await tx.query(
        `INSERT INTO ad_platform_connections
           (org_id, partner_id, platform, external_ad_account_id, connection_state,
            platform_verification_state, encrypted_access_token)
         VALUES ($1,$2,'tiktok',$3,'active',$4,'v1:a:b:c') RETURNING id`,
        [org, partnerId, `acct-${slug}`, verification])).rows[0].id;

      const campaignId = (await tx.query(
        `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type, approval_state)
         VALUES ($1,$2,$3,'C','funding','draft') RETURNING id`,
        [org, partnerId, connId])).rows[0].id;

      return { partnerId, channelId, connId, campaignId };
    });
  }

  async function cleanup() {
    const ids = (await db.query(
      `SELECT id FROM partners WHERE slug LIKE $1`, [`${SLUG}%`])).rows.map((r) => r.id);
    if (!ids.length) return;
    const OFF = [["action_log", "trg_action_log_no_delete"],
                 ["compliance_screenings", "trg_compliance_screenings_no_delete"],
                 ["creative_usage_events", "trg_creative_usage_events_no_delete"]];
    for (const [t, trg] of OFF) await db.query(`ALTER TABLE ${t} DISABLE TRIGGER ${trg}`);
    await asStaff(async (tx) => {
      for (const t of ["action_log", "compliance_screenings", "creative_usage_events",
                       "social_posts", "social_channels", "partner_onboarding_tasks",
                       "campaigns", "partner_module_settings", "ad_platform_connections"]) {
        await tx.query(`DELETE FROM ${t} WHERE partner_id = ANY($1)`, [ids]);
      }
    });
    for (const [t, trg] of OFF) await db.query(`ALTER TABLE ${t} ENABLE TRIGGER ${trg}`);
    await db.query(`DELETE FROM tasks WHERE source_workflow = 'creative-factory-onboarding'`);
    await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [ids]);
  }
});
