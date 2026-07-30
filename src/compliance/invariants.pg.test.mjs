// The module's non-negotiable invariants, asserted directly against the database.
//
// Skipped without DATABASE_URL.
//
// The other test files prove behaviour. This one proves STRUCTURE — the
// properties that must hold for every table in the module, including tables that
// do not exist yet. A future migration that adds a partner-scoped table and
// forgets its policy fails here rather than in production, which is the only way
// a rule like "every table in this module carries partner_id and passes through
// scope.mjs" stays true after the person who wrote it has moved on.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { asStaff, asPartner } from "../partners/rls.mjs";
import { PARTNER_SCOPED_TABLES } from "../partners/scope.mjs";
import { screen, clearRuleCache } from "./screen.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SLUG = "inv-test-";

// Every table 045-050 created that carries partner_id. Kept as a literal rather
// than derived, so ADDING a table to the module is a deliberate edit here too —
// a derived list would silently accept a new table with no policy.
const MODULE_TABLES = [
  "brand_kits", "brand_kit_sources", "creative_assets", "generation_jobs",
  "generation_job_assets", "ad_platform_connections", "campaigns", "ad_sets", "ads",
  "ad_metrics_daily", "action_log", "spend_ceilings", "partner_module_settings",
  "partner_onboarding_tasks", "compliance_screenings", "social_channels", "social_posts",
  "creative_usage_events"
];

describe("module invariants", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, pA, pB;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();
    pA = await mkPartner("alpha");
    pB = await mkPartner("beta");
    clearRuleCache();
  });
  after(async () => { await cleanup(); await close(); });

  // ---------------------------------------------------------------- ISOLATION

  test("every module table carries partner_id NOT NULL", async () => {
    const { rows } = await db.query(
      `SELECT table_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'partner_id'
          AND table_name = ANY($1)`, [MODULE_TABLES]);
    const found = new Map(rows.map((r) => [r.table_name, r.is_nullable]));

    const missing = MODULE_TABLES.filter((t) => !found.has(t));
    assert.deepStrictEqual(missing, [], `these module tables have no partner_id: ${missing}`);

    const nullable = MODULE_TABLES.filter((t) => found.get(t) === "YES");
    // A nullable partner_id is a row no policy matches and nobody owns — an orphan
    // only staff could ever see.
    assert.deepStrictEqual(nullable, [], `partner_id must be NOT NULL on: ${nullable}`);
  });

  test("every module table has RLS ENABLED and FORCED", async () => {
    const { rows } = await db.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1)`, [MODULE_TABLES]);
    const byName = new Map(rows.map((r) => [r.relname, r]));

    for (const t of MODULE_TABLES) {
      const r = byName.get(t);
      assert.ok(r, `${t} does not exist`);
      assert.strictEqual(r.relrowsecurity, true, `${t} does not have RLS enabled`);
      // FORCE is the one that is easy to omit and impossible to notice: without
      // it the owning role — which is what the app connects as — is exempt from
      // its own policies and the table only LOOKS protected.
      assert.strictEqual(r.relforcerowsecurity, true, `${t} does not FORCE RLS`);
    }
  });

  test("every module table has an isolation policy covering ALL commands", async () => {
    const { rows } = await db.query(
      `SELECT tablename, policyname, cmd, qual, with_check
         FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1)`, [MODULE_TABLES]);
    const byTable = new Map();
    for (const r of rows) byTable.set(r.tablename, r);

    for (const t of MODULE_TABLES) {
      const p = byTable.get(t);
      assert.ok(p, `${t} has no RLS policy — RLS with no policy denies everything, which fails closed but breaks the app`);
      // ALL, not SELECT: a read-only policy leaves INSERT and UPDATE unguarded,
      // which is how a partner writes a row into another partner's book.
      assert.strictEqual(p.cmd, "ALL", `${t}'s policy covers ${p.cmd}, not ALL`);
      assert.ok(p.qual?.includes("partner_id"), `${t}'s USING clause does not mention partner_id`);
      assert.ok(p.with_check?.includes("partner_id"),
        `${t} has no WITH CHECK — a row could be inserted or moved out of scope`);
    }
  });

  test("every module table is registered in PARTNER_SCOPED_TABLES", async () => {
    // scope.mjs's allowlist is what assertCanReadRow validates against. A table
    // missing from it fails loudly on a point read instead of going unscoped.
    const missing = MODULE_TABLES.filter((t) => !PARTNER_SCOPED_TABLES.has(t));
    assert.deepStrictEqual(missing, [],
      `add these to PARTNER_SCOPED_TABLES in src/partners/scope.mjs: ${missing}`);
  });

  test("THE LEAK TEST: an unscoped session reads zero rows from every module table", async () => {
    // The definition-of-done requirement, applied to all eighteen tables at once.
    // db.query() with no scope is exactly what a forgotten withPartnerScope looks
    // like, and every one of these must come back empty rather than whole.
    await seedOneRowEverywhere(pA);
    for (const t of MODULE_TABLES) {
      const { rows } = await db.query(`SELECT 1 FROM ${t} LIMIT 1`);
      assert.deepStrictEqual(rows, [], `${t} leaked rows to an unscoped session`);
    }
  });

  test("THE LEAK TEST: partner B reads zero rows of partner A's data", async () => {
    for (const t of MODULE_TABLES) {
      const rows = await asPartner(pB, (tx) =>
        tx.query(`SELECT 1 FROM ${t} LIMIT 1`).then((r) => r.rows));
      assert.deepStrictEqual(rows, [], `${t} leaked partner A's rows to partner B`);
    }
  });

  test("partner A can read its own rows — the policies are not simply denying everything", async () => {
    // Without this, the two tests above would pass on a table nobody can read at
    // all, and "fails closed" would be indistinguishable from "broken".
    const seen = [];
    for (const t of MODULE_TABLES) {
      const rows = await asPartner(pA, (tx) =>
        tx.query(`SELECT 1 FROM ${t} LIMIT 1`).then((r) => r.rows));
      if (rows.length) seen.push(t);
    }
    assert.deepStrictEqual(seen.sort(), [...MODULE_TABLES].sort(),
      "partner A could not read tables it owns rows in");
  });

  // ---------------------------------------------------------------- COMPLIANCE

  describe("TikTok + credit repair fails at BOTH layers", () => {
    // The definition-of-done item, stated as two tests because the point is that
    // neither layer is load-bearing alone.

    test("layer 1: the DATABASE rejects it", async () => {
      const conn = await asStaff((tx) => tx.query(
        `INSERT INTO ad_platform_connections
           (org_id, partner_id, platform, external_ad_account_id, connection_state,
            platform_verification_state, encrypted_access_token)
         VALUES ($1,$2,'tiktok',$3,'active','approved','v1:a:b:c') RETURNING id`,
        [org, pA, `tt-${Date.now()}`]).then((r) => r.rows[0].id));

      await assert.rejects(
        () => asStaff((tx) => tx.query(
          `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type)
           VALUES ($1,$2,$3,'CR on TikTok','credit_repair')`, [org, pA, conn])),
        /campaigns_tiktok_credit_repair_ck/,
        "the row must be impossible to store");
    });

    test("layer 2: the API/guardrail rejects it, with clean copy and every gate satisfied", async () => {
      const verdict = await screen(db, {
        orgId: org, partnerId: pA,
        offerType: "credit_repair", platform: "tiktok",
        text: "Consumer Credit File Rights Under State and Federal Law. We dispute inaccurate items.",
        hasDisclosureAsset: true, approveBeforeLaunch: false
      });
      assert.strictEqual(verdict.state, "blocked");
      assert.ok(verdict.reasons.some((r) => r.code === "tiktok_credit_repair_prohibited"));
    });

    test("the block survives deleting the config row that describes it", async () => {
      // Proving it is structural, not configuration. An operator deactivating the
      // rule row changes the message source, not the outcome.
      await db.query(
        `UPDATE compliance_rules SET active = false
          WHERE org_id = $1 AND rule_key = 'tiktok-credit-repair-prohibited'`, [org]);
      clearRuleCache();
      try {
        const verdict = await screen(db, {
          orgId: org, partnerId: pA, offerType: "credit_repair", platform: "tiktok",
          text: "Clean copy.", hasDisclosureAsset: true, approveBeforeLaunch: false
        });
        assert.strictEqual(verdict.state, "blocked");
      } finally {
        await db.query(
          `UPDATE compliance_rules SET active = true
            WHERE org_id = $1 AND rule_key = 'tiktok-credit-repair-prohibited'`, [org]);
        clearRuleCache();
      }
    });

    test("TikTok + funding is unaffected — the block is offer-specific", async () => {
      const verdict = await screen(db, {
        orgId: org, partnerId: pA, offerType: "funding", platform: "tiktok",
        text: "Business funding for qualified applicants.", approveBeforeLaunch: false
      });
      assert.strictEqual(verdict.state, "passed");
    });
  });

  test("there is no compliance override column anywhere in the module", async () => {
    // The spec says not to build one. This is the tripwire if somebody does.
    const { rows } = await db.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1)
          AND (column_name ~* '(override|bypass|skip|force|ignore).*(complian|screen|guard|rule|check)'
            OR column_name ~* '(complian|screen|guard).*(override|bypass|skip|disabled)')`,
      [MODULE_TABLES]);
    assert.deepStrictEqual(rows, [], `compliance override columns found: ${JSON.stringify(rows)}`);
  });

  // ---------------------------------------------------------------- helpers

  async function mkPartner(name) {
    const { rows } = await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at)
       VALUES ($1,$2,$3,'active',now()) RETURNING id`, [org, name, `${SLUG}${name}`]);
    return rows[0].id;
  }

  /* One row in every module table, so the leak tests have something to leak. */
  async function seedOneRowEverywhere(p) {
    return asStaff(async (tx) => {
      await tx.query(`INSERT INTO partner_module_settings (org_id, partner_id) VALUES ($1,$2)
                      ON CONFLICT (partner_id) DO NOTHING`, [org, p]);

      const kit = (await tx.query(
        `INSERT INTO brand_kits (org_id, partner_id, name) VALUES ($1,$2,'K') RETURNING id`,
        [org, p])).rows[0].id;
      await tx.query(
        `INSERT INTO brand_kit_sources (org_id, partner_id, brand_kit_id, source_url)
         VALUES ($1,$2,$3,'https://example.test')`, [org, p, kit]);

      const asset = (await tx.query(
        `INSERT INTO creative_assets (org_id, partner_id, brand_kit_id, kind, format, ai_generated)
         VALUES ($1,$2,$3,'static','1x1',true) RETURNING id`, [org, p, kit])).rows[0].id;
      const job = (await tx.query(
        `INSERT INTO generation_jobs (org_id, partner_id, brand_kit_id, spec, idempotency_key)
         VALUES ($1,$2,$3,'{"assetKind":"static"}'::jsonb,$4) RETURNING id`,
        [org, p, kit, `inv-${p}`])).rows[0].id;
      await tx.query(
        `INSERT INTO generation_job_assets (org_id, partner_id, job_id, asset_id)
         VALUES ($1,$2,$3,$4)`, [org, p, job, asset]);

      const conn = (await tx.query(
        `INSERT INTO ad_platform_connections
           (org_id, partner_id, platform, external_ad_account_id, connection_state,
            platform_verification_state, encrypted_access_token)
         VALUES ($1,$2,'meta',$3,'active','approved','v1:a:b:c') RETURNING id`,
        [org, p, `inv-acct-${p}`])).rows[0].id;

      // A Meta campaign needs a configured category; seed one for the fixture.
      await tx.query(
        `INSERT INTO ad_platform_category_map (org_id, platform, offer_type, special_ad_category, notes)
         VALUES ($1,'meta','funding','TEST_CATEGORY','fixture only')
         ON CONFLICT (org_id, platform, offer_type) DO NOTHING`, [org]);

      const camp = (await tx.query(
        `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type)
         VALUES ($1,$2,$3,'C','funding') RETURNING id`, [org, p, conn])).rows[0].id;
      const set = (await tx.query(
        `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name)
         VALUES ($1,$2,$3,$4,'AS') RETURNING id`, [org, p, conn, camp])).rows[0].id;
      const ad = (await tx.query(
        `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id, name)
         VALUES ($1,$2,$3,$4,$5,'AD') RETURNING id`, [org, p, conn, camp, set])).rows[0].id;

      await tx.query(
        `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date) VALUES ($1,$2,$3,CURRENT_DATE)
         ON CONFLICT (ad_id, date) DO NOTHING`, [org, p, ad]);
      await tx.query(
        `INSERT INTO action_log (org_id, partner_id, actor, target_type, reason)
         VALUES ($1,$2,'human','campaign','fixture')`, [org, p]);
      await tx.query(
        `INSERT INTO spend_ceilings (org_id, partner_id, scope, daily_limit_cents)
         VALUES ($1,$2,'partner',100000) ON CONFLICT DO NOTHING`, [org, p]);
      await tx.query(
        `INSERT INTO partner_onboarding_tasks (org_id, partner_id, task_key, title)
         VALUES ($1,$2,'fixture','Fixture')`, [org, p]);
      await tx.query(
        `INSERT INTO compliance_screenings (org_id, partner_id, subject_type, subject_id, state)
         VALUES ($1,$2,'creative_asset',$3,'passed')`, [org, p, asset]);

      const chan = (await tx.query(
        `INSERT INTO social_channels (org_id, partner_id, channel, external_account_id,
                                      connection_state, encrypted_access_token)
         VALUES ($1,$2,'instagram',$3,'active','v1:a:b:c') RETURNING id`,
        [org, p, `inv-ig-${p}`])).rows[0].id;
      await tx.query(
        `INSERT INTO social_posts (org_id, partner_id, channel_id, caption, offer_type)
         VALUES ($1,$2,$3,'hello','funding')`, [org, p, chan]);

      await tx.query(
        `INSERT INTO creative_usage_events
           (org_id, partner_id, event_type, quantity, unit_cost_cents, rate_pct_applied,
            total_cents, source_event_id)
         VALUES ($1,$2,'generation',1,1000,10,100,$3)`, [org, p, `inv-evt-${p}`]);
    });
  }

  async function cleanup() {
    const ids = (await db.query(
      `SELECT id FROM partners WHERE slug LIKE $1`, [`${SLUG}%`])).rows.map((r) => r.id);
    if (!ids.length) return;
    const OFF = [["action_log", "trg_action_log_no_delete"],
                 ["creative_assets", "trg_creative_assets_no_delete"],
                 ["brand_kit_sources", "trg_brand_kit_sources_no_delete"],
                 ["compliance_screenings", "trg_compliance_screenings_no_delete"],
                 ["creative_usage_events", "trg_creative_usage_events_no_delete"]];
    for (const [t, trg] of OFF) await db.query(`ALTER TABLE ${t} DISABLE TRIGGER ${trg}`);
    await asStaff(async (tx) => {
      for (const t of ["creative_usage_events", "social_posts", "social_channels",
                       "compliance_screenings", "partner_onboarding_tasks", "spend_ceilings",
                       "action_log", "ad_metrics_daily", "ads", "ad_sets", "campaigns",
                       "generation_job_assets", "generation_jobs", "creative_assets",
                       "brand_kit_sources", "brand_kits", "partner_module_settings",
                       "ad_platform_connections"]) {
        await tx.query(`DELETE FROM ${t} WHERE partner_id = ANY($1)`, [ids]);
      }
    });
    for (const [t, trg] of OFF) await db.query(`ALTER TABLE ${t} ENABLE TRIGGER ${trg}`);
    await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [ids]);
  }
});
