// THE SECOND TIER, END TO END: a client becomes an affiliate, and the person
// who referred THEM starts earning the downline rate on what they bring in.
//
// WHY THIS FILE EXISTS. Until 2026-09-20 the 5% downline rate was defined
// (db/migrations/261_affiliate_tier1_20pct_20260824.sql), computed correctly
// (src/affiliates/economics.mjs), covered by its own unit tests — and
// unreachable. `grep -rn 'tier: "downline"' src/ api/ scripts/` matched test
// files ONLY, and affiliates.recruited_by had no production writer anywhere:
// economics.mjs read it, api/read/affiliates.mjs read it, nothing set it. So
// every affiliate's recruiter was NULL forever and the tier could not pay.
//
// Two changes closed it, and this file is what stops them regressing:
//   api/affiliates/refer.mjs   — sets recruited_by from the presser's own
//                                direct-referral row when they enrol
//   economics.mjs              — attributeWithUpline(), called by AF-02
//
// OWNER-SET 2026-09-20: the upline is whoever referred that client. NOT the a2
// URL parameter — a2 is editable by the person who profits from editing it.
// The test named "the a2 URL parameter cannot buy a downline" is that rule.
//
// Under src/ and not api/ on purpose — CLAUDE.md §12: npm test's glob is
// src/** and scripts/** only.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createAccount, createAccountSession } from "../auth/account-session.mjs";
import { attributeWithUpline } from "./economics.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

describe("two-tier affiliate chain", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, handler, staffId;
  const MARK = "twotier";

  const post = async (path, token) =>
    handler(new Request("https://x" + path, {
      method: "POST",
      headers: Object.assign({ host: "x" }, token ? { authorization: "Bearer " + token } : {})
    }), {});
  const json = async (r) => { try { return JSON.parse(await r.text()); } catch { return null; } };

  const mkClient = async (n) => (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email)
     VALUES ($1,'Tier',$2,$3) RETURNING id`,
    [org, n, `${MARK}.${n}@example.com`.toLowerCase()])).rows[0].id;

  const mkAffiliate = async (n) => (await db.query(
    `INSERT INTO affiliates (org_id, name, status) VALUES ($1,$2,'active')
     RETURNING id, tracking_id`,
    [org, `${MARK} ${n}`])).rows[0];

  const tokenFor = async (clientId, n) => {
    const a = await createAccount(db, {
      orgId: org, kind: "client", email: `${MARK}.${n}@example.com`,
      password: "a-long-enough-password-1", invitedBy: staffId, clientId
    });
    return (await createAccountSession(db, { accountId: a.id, orgId: org })).token;
  };

  const referralsFor = async (clientId) => (await db.query(
    `SELECT tier, affiliate_id, status, detail FROM affiliate_referrals
      WHERE client_id = $1 ORDER BY tier`, [clientId])).rows;

  before(async () => {
    ({ default: handler } = await import("../../netlify/functions/api.mjs"));
    org = await resolveDefaultOrg(db);
    await purge();
    staffId = (await db.query(
      `SELECT id FROM staff WHERE org_id = $1 AND role = 'owner' LIMIT 1`, [org])).rows[0].id;
  });

  async function purge() {
    /* THE AFFILIATE ROWS THIS TEST CREATES DO NOT ALL CARRY THE MARK. The ones
       the endpoint mints are named after the CLIENT (displayName() in
       api/affiliates/refer.mjs), so they are called "Tier sarah-c" and a
       name LIKE 'twotier%' purge walks straight past them. Collect them from
       the accounts BEFORE the accounts are deleted, or the recruited_by edges
       they hold turn into a foreign-key failure on the way out. */
    const minted = (await db.query(
      `SELECT affiliate_id FROM accounts
        WHERE email LIKE $1 AND affiliate_id IS NOT NULL`, [`${MARK}%`]
    )).rows.map(r => r.affiliate_id);

    await db.query(`DELETE FROM account_sessions WHERE account_id IN
      (SELECT id FROM accounts WHERE email LIKE $1)`, [`${MARK}%`]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [`${MARK}%`]);
    const cids = (await db.query(
      `SELECT id FROM clients WHERE email LIKE $1`, [`${MARK}%`])).rows.map(r => r.id);
    // An attribution row is voided, never deleted (trg_affiliate_referrals_no_delete,
    // 033_affiliates.sql). Right for production, wrong for a scratch fixture.
    await db.query(`ALTER TABLE affiliate_referrals DISABLE TRIGGER trg_affiliate_referrals_no_delete`);
    try {
      if (cids.length) await db.query(`DELETE FROM affiliate_referrals WHERE client_id = ANY($1)`, [cids]);
      await db.query(`DELETE FROM affiliate_referrals WHERE affiliate_id IN
        (SELECT id FROM affiliates WHERE name LIKE $1)`, [`${MARK}%`]);
    } finally {
      await db.query(`ALTER TABLE affiliate_referrals ENABLE TRIGGER trg_affiliate_referrals_no_delete`);
    }
    if (cids.length) await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [cids]);

    /* recruited_by is a self-FK. Clear every edge POINTING AT anything about to
       go, not just the edges held by marked rows — the child is usually the
       minted one, which is not marked. */
    const doomed = (await db.query(
      `SELECT id FROM affiliates WHERE name LIKE $1 OR id = ANY($2)`,
      [`${MARK}%`, minted]
    )).rows.map(r => r.id);
    if (doomed.length) {
      await db.query(`UPDATE affiliates SET recruited_by = NULL WHERE recruited_by = ANY($1)`, [doomed]);
      await db.query(`ALTER TABLE affiliate_referrals DISABLE TRIGGER trg_affiliate_referrals_no_delete`);
      try {
        await db.query(`DELETE FROM affiliate_referrals WHERE affiliate_id = ANY($1)`, [doomed]);
      } finally {
        await db.query(`ALTER TABLE affiliate_referrals ENABLE TRIGGER trg_affiliate_referrals_no_delete`);
      }
      await db.query(`DELETE FROM affiliates WHERE id = ANY($1)`, [doomed]);
    }
  }

  after(async () => { await purge(); await close(); });

  // ── the chain forms ──────────────────────────────────────────────────────

  test("pressing the button links the new affiliate to whoever referred them", async () => {
    const mike = await mkAffiliate("mike-a");
    const sarahClient = await mkClient("sarah-a");
    // Mike referred Sarah as a client. This is the row the endpoint reads.
    await attributeWithUpline(db, {
      orgId: org, affiliateId: mike.id, clientId: sarahClient,
      trackingIdUsed: mike.tracking_id, source: "test"
    });

    const tok = await tokenFor(sarahClient, "sarah-a");
    const r = await post("/api/affiliates/refer", tok);
    assert.equal(r.status, 201, "enrolment was refused");
    const b = await json(r);
    assert.equal(b.ok, true);
    assert.equal(String(b.recruitedBy), String(mike.id),
      "the new affiliate was not linked to the person who referred them");

    const row = (await db.query(
      `SELECT recruited_by, recruited_at FROM affiliates WHERE id =
         (SELECT affiliate_id FROM accounts WHERE client_id = $1)`, [sarahClient])).rows[0];
    assert.equal(String(row.recruited_by), String(mike.id), "recruited_by was not written");
    assert.ok(row.recruited_at, "the trigger did not stamp recruited_at");
  });

  test("a client nobody referred becomes an affiliate with no upline", async () => {
    const walkIn = await mkClient("walkin");
    const tok = await tokenFor(walkIn, "walkin");
    const b = await json(await post("/api/affiliates/refer", tok));
    assert.equal(b.ok, true);
    assert.equal(b.recruitedBy, null,
      "an upline was invented for a client who was never referred");
  });

  test("gaining a recruit unlocks tier 2 for the recruiter", async () => {
    const mike = await mkAffiliate("mike-b");
    const before2 = (await db.query(
      `SELECT tier_level, tier2_unlocked_at FROM affiliates WHERE id = $1`, [mike.id])).rows[0];
    // tier_level is TEXT — 'tier1' / 'tier2' (033_affiliates.sql:62), not 1 / 2.
    assert.notEqual(before2.tier_level, "tier2", "fixture started already on tier 2");

    const sarahClient = await mkClient("sarah-b");
    await attributeWithUpline(db, {
      orgId: org, affiliateId: mike.id, clientId: sarahClient, source: "test"
    });
    await post("/api/affiliates/refer", await tokenFor(sarahClient, "sarah-b"));

    const after2 = (await db.query(
      `SELECT tier_level, tier2_unlocked_at FROM affiliates WHERE id = $1`, [mike.id])).rows[0];
    assert.equal(after2.tier_level, "tier2", "the recruiter was not moved to tier 2");
    assert.ok(after2.tier2_unlocked_at, "tier2_unlocked_at was not stamped");
  });

  // ── the chain pays ───────────────────────────────────────────────────────

  test("a referral by the new affiliate credits BOTH tiers", async () => {
    const mike = await mkAffiliate("mike-c");
    const sarahClient = await mkClient("sarah-c");
    await attributeWithUpline(db, {
      orgId: org, affiliateId: mike.id, clientId: sarahClient, source: "test"
    });
    await post("/api/affiliates/refer", await tokenFor(sarahClient, "sarah-c"));
    const sarahAff = (await db.query(
      `SELECT affiliate_id FROM accounts WHERE client_id = $1`, [sarahClient])).rows[0].affiliate_id;

    // Sarah now refers somebody of her own. This is the moment the second
    // tier either works or silently does not.
    const dave = await mkClient("dave");
    const out = await attributeWithUpline(db, {
      orgId: org, affiliateId: sarahAff, clientId: dave, source: "test"
    });

    assert.equal(out.attributed, true, "the direct referral was not recorded");
    assert.equal(out.downline.attributed, true, "NO DOWNLINE ROW — the 5% tier is dead again");

    const rows = await referralsFor(dave);
    assert.equal(rows.length, 2, `expected a direct and a downline row, got ${rows.length}`);
    const direct = rows.find(r => r.tier === "direct");
    const down = rows.find(r => r.tier === "downline");
    assert.equal(String(direct.affiliate_id), String(sarahAff), "the direct row went to the wrong affiliate");
    assert.equal(String(down.affiliate_id), String(mike.id),
      "the downline row did not go to the recruiter");
    assert.equal(String(down.detail.viaAffiliateId), String(sarahAff),
      "the downline row does not record who it came through");
  });

  test("the downline row carries no tracking code, because none was used", async () => {
    const mike = await mkAffiliate("mike-d");
    const sarahClient = await mkClient("sarah-d");
    await attributeWithUpline(db, { orgId: org, affiliateId: mike.id, clientId: sarahClient, source: "test" });
    await post("/api/affiliates/refer", await tokenFor(sarahClient, "sarah-d"));
    const sarahAff = (await db.query(
      `SELECT affiliate_id FROM accounts WHERE client_id = $1`, [sarahClient])).rows[0].affiliate_id;
    const sarahCode = (await db.query(
      `SELECT tracking_id FROM affiliates WHERE id = $1`, [sarahAff])).rows[0].tracking_id;

    const erin = await mkClient("erin");
    await attributeWithUpline(db, {
      orgId: org, affiliateId: sarahAff, clientId: erin,
      trackingIdUsed: sarahCode, source: "test"
    });
    const rows = await referralsFor(erin);
    const down = rows.find(r => r.tier === "downline");
    assert.equal(down.tracking_id_used ?? null, null,
      "the downline row claims the recruiter's code was on the link — it was not");
  });

  // ── the rules that stop it being gamed ───────────────────────────────────

  test("an affiliate with no recruiter produces no downline row", async () => {
    const solo = await mkAffiliate("solo");
    const c = await mkClient("solo-client");
    const out = await attributeWithUpline(db, { orgId: org, affiliateId: solo.id, clientId: c, source: "test" });
    assert.equal(out.attributed, true);
    assert.equal(out.downline.attributed, false);
    assert.equal(out.downline.reason, "no_recruiter");
    assert.equal((await referralsFor(c)).length, 1, "a downline row was written with nobody to pay");
  });

  test("a repeat attribution does not write a second downline row", async () => {
    const mike = await mkAffiliate("mike-e");
    const sarahClient = await mkClient("sarah-e");
    await attributeWithUpline(db, { orgId: org, affiliateId: mike.id, clientId: sarahClient, source: "test" });
    await post("/api/affiliates/refer", await tokenFor(sarahClient, "sarah-e"));
    const sarahAff = (await db.query(
      `SELECT affiliate_id FROM accounts WHERE client_id = $1`, [sarahClient])).rows[0].affiliate_id;

    const frank = await mkClient("frank");
    await attributeWithUpline(db, { orgId: org, affiliateId: sarahAff, clientId: frank, source: "test" });
    const second = await attributeWithUpline(db, { orgId: org, affiliateId: sarahAff, clientId: frank, source: "test" });

    assert.equal(second.attributed, false, "first touch was not sticky");
    assert.equal(second.downline.reason, "direct_not_new");
    assert.equal((await referralsFor(frank)).length, 2, "a duplicate row was written");
  });

  test("pressing the button twice does not re-point an existing upline", async () => {
    const mike = await mkAffiliate("mike-f");
    const sarahClient = await mkClient("sarah-f");
    await attributeWithUpline(db, { orgId: org, affiliateId: mike.id, clientId: sarahClient, source: "test" });
    const tok = await tokenFor(sarahClient, "sarah-f");

    const first = await json(await post("/api/affiliates/refer", tok));
    const again = await json(await post("/api/affiliates/refer", tok));
    assert.equal(again.created, false, "a second affiliate row was minted");
    assert.equal(again.code, first.code, "the second press handed back a different code");

    const n = (await db.query(
      `SELECT count(*)::int AS n FROM affiliates WHERE recruited_by = $1`, [mike.id])).rows[0].n;
    assert.equal(n, 1, "the second press created a second downline under the recruiter");
  });

  test("the a2 URL parameter cannot buy a downline", async () => {
    // OWNER-SET 2026-09-20. AF-02 still mirrors a2 into the client's
    // custom_fields as the CRM record of what the link claimed. What gets PAID
    // comes from recruited_by, which the browser cannot reach. An attacker who
    // sets a2 to a stranger's code must not move money.
    const stranger = await mkAffiliate("stranger");
    const solo = await mkAffiliate("solo-b");
    const victim = await mkClient("victim");

    await attributeWithUpline(db, {
      orgId: org, affiliateId: solo.id, clientId: victim,
      source: "test", detail: { a2: stranger.tracking_id }
    });

    const rows = await referralsFor(victim);
    assert.equal(rows.length, 1, "a downline row appeared from a URL parameter");
    assert.ok(!rows.some(r => String(r.affiliate_id) === String(stranger.id)),
      "a stranger named in a2 was credited");
  });

  test("the two tiers are priced 20% and 5%", async () => {
    // The rates are data, not code (261_affiliate_tier1_20pct_20260824.sql),
    // and affiliate_id NULL means every affiliate (033_affiliates.sql:211-214).
    // If somebody changes the schedule, this says so out loud.
    const { rows } = await db.query(
      `SELECT tier, percent FROM affiliate_commission_rules
        WHERE org_id = $1 AND affiliate_id IS NULL AND active
          AND (effective_to IS NULL OR effective_to > now())`, [org]);
    const pct = (t) => [...new Set(rows.filter(r => r.tier === t).map(r => Number(r.percent)))];
    assert.deepEqual(pct("direct"), [20], `direct rate is not 20%: ${pct("direct")}`);
    assert.deepEqual(pct("downline"), [5], `downline rate is not 5%: ${pct("downline")}`);
  });
});
