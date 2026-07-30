// Adversarial tests for the partner scope boundary.
//
// A partner seeing another partner's client is the worst bug this system can have,
// so these tests are written to BREAK the predicate, not to confirm it works. Each
// one is an attack: a missing principal, a malformed one, a guessed uuid, a
// cross-partner join, a payout that pays out of someone else's revenue.
//
// Skipped without DATABASE_URL, like the other *.pg.test.mjs files.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  scopeFor, where, assertCanReadClient, clientIdsFor,
  partnerPrincipal, staffPrincipal
} from "./scope.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SLUG_A = "scope-test-alpha";
const SLUG_B = "scope-test-beta";

describe("partner scope", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, pA, pB, cA, cB, cDirect;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();

    pA = (await db.query(
      `INSERT INTO partners (org_id, name, brand_name, slug, status, agreement_signed_at)
       VALUES ($1,'Alpha Partner','Alpha Credit',$2,'active',now()) RETURNING id`,
      [org, SLUG_A])).rows[0].id;
    pB = (await db.query(
      `INSERT INTO partners (org_id, name, brand_name, slug, status)
       VALUES ($1,'Beta Partner','Beta Credit',$2,'active') RETURNING id`,
      [org, SLUG_B])).rows[0].id;

    cA = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, partner_id)
       VALUES ($1,'Alpha','Client',$2) RETURNING id`, [org, pA])).rows[0].id;
    cB = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, partner_id)
       VALUES ($1,'Beta','Client',$2) RETURNING id`, [org, pB])).rows[0].id;
    cDirect = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name)
       VALUES ($1,'Direct','Client') RETURNING id`, [org])).rows[0].id;
  });

  async function cleanup() {
    await db.query(`ALTER TABLE partner_revenue DISABLE TRIGGER trg_partner_revenue_no_delete`);
    await db.query(
      `DELETE FROM partner_payout_lines WHERE org_id = $1 AND payout_id IN
         (SELECT id FROM partner_payouts WHERE partner_id IN
            (SELECT id FROM partners WHERE slug = ANY($2)))`, [org, [SLUG_A, SLUG_B]]);
    await db.query(
      `DELETE FROM partner_payouts WHERE partner_id IN
         (SELECT id FROM partners WHERE slug = ANY($1))`, [[SLUG_A, SLUG_B]]);
    await db.query(
      `DELETE FROM partner_revenue WHERE partner_id IN
         (SELECT id FROM partners WHERE slug = ANY($1))`, [[SLUG_A, SLUG_B]]);
    await db.query(`ALTER TABLE partner_revenue ENABLE TRIGGER trg_partner_revenue_no_delete`);
    await db.query(
      `DELETE FROM clients WHERE org_id = $1 AND partner_id IN
         (SELECT id FROM partners WHERE slug = ANY($2))`, [org, [SLUG_A, SLUG_B]]);
    await db.query(`DELETE FROM clients WHERE org_id = $1 AND first_name = 'Direct'
                      AND last_name = 'Client'`, [org]);
    await db.query(`DELETE FROM partners WHERE slug = ANY($1)`, [[SLUG_A, SLUG_B]]);
  }

  // Money assertions must not inherit another test's accruals. Clears only the
  // revenue/payout rows, keeping the partners and clients the fixtures created.
  beforeEach(async () => {
    await db.query(`ALTER TABLE partner_revenue DISABLE TRIGGER trg_partner_revenue_no_delete`);
    await db.query(
      `DELETE FROM partner_payout_lines WHERE payout_id IN
         (SELECT id FROM partner_payouts WHERE partner_id = ANY($1))`, [[pA, pB]]);
    await db.query(`DELETE FROM partner_payouts WHERE partner_id = ANY($1)`, [[pA, pB]]);
    await db.query(`DELETE FROM partner_revenue WHERE partner_id = ANY($1)`, [[pA, pB]]);
    await db.query(`ALTER TABLE partner_revenue ENABLE TRIGGER trg_partner_revenue_no_delete`);
  });

  after(async () => { await cleanup(); await close(); });

  // ══════════ ATTACK 1: get an unscoped query out of the helper ══════════

  test("ATTACK: no principal at all → refuses, does not fall back to unscoped", () => {
    for (const bad of [undefined, null, "", 0, false, "partner"]) {
      assert.throws(() => scopeFor(bad), /principal is required|unknown principal/,
        `scopeFor(${JSON.stringify(bad)}) did not throw`);
    }
  });

  test("ATTACK: unrecognised kind → refuses rather than defaulting to everything", () => {
    for (const kind of ["admin", "owner", "superuser", "", null, 1]) {
      assert.throws(() => scopeFor({ kind }), /unknown principal kind|does not read/,
        `kind=${JSON.stringify(kind)} did not throw`);
    }
  });

  test("the kind is folded, but a folded partner still needs a partnerId", () => {
    // Leniency on case and whitespace is deliberate; leniency on SCOPE is not.
    assert.throws(() => scopeFor({ kind: "PARTNER " }), /no partnerId/);
    const s = scopeFor({ kind: " Partner ", partnerId: pA });
    assert.deepEqual(s.params, [pA]);
    assert.equal(s.unrestricted, false);
    assert.equal(scopeFor({ kind: " STAFF " }).unrestricted, true);
  });

  test("ATTACK: partner principal with no partnerId → refuses", () => {
    for (const p of [{ kind: "partner" }, { kind: "partner", partnerId: null },
                     { kind: "partner", partnerId: "" }, { kind: "partner", partnerID: pA }]) {
      assert.throws(() => scopeFor(p), /no partnerId/,
        `${JSON.stringify(p)} did not throw — partnerID typo must not slip through`);
    }
  });

  test("ATTACK: client and affiliate principals cannot read the book at all", () => {
    assert.throws(() => scopeFor({ kind: "client", clientId: cA }), /does not read the client book/);
    assert.throws(() => scopeFor({ kind: "affiliate", affiliateId: "x" }), /does not read the client book/);
  });

  test("ATTACK: a hostile alias cannot inject SQL", () => {
    for (const alias of ["c; DROP TABLE clients", "c OR 1=1", "c.partner_id --", "1", "c-x"]) {
      assert.throws(() => scopeFor(partnerPrincipal(pA), { alias }), /not a valid table alias/,
        `alias ${JSON.stringify(alias)} was accepted`);
    }
  });

  test("the partner id is parameterised, never interpolated", () => {
    const s = scopeFor(partnerPrincipal(pA), { startIndex: 3 });
    assert.equal(s.sql, "c.partner_id = $4", "numbering must continue from startIndex");
    assert.deepEqual(s.params, [pA]);
    assert.equal(s.sql.includes(pA), false, "the uuid must not appear in the SQL text");
  });

  // ══════════ ATTACK 2: read across the boundary ══════════

  test("ATTACK: partner A's list query cannot return partner B's client", async () => {
    const w = where(partnerPrincipal(pA), { alias: "c", extra: ["c.org_id = $1"], params: [org] });
    const { rows } = await db.query(`SELECT c.id FROM clients c ${w.sql}`, w.params);
    const ids = rows.map((r) => r.id);
    assert.ok(ids.includes(cA), "A must see their own client");
    assert.equal(ids.includes(cB), false, "LEAK: A saw B's client");
    assert.equal(ids.includes(cDirect), false, "LEAK: A saw a direct fundhub client");
    assert.equal(ids.length, 1);
  });

  test("ATTACK: and the mirror — B cannot see A's", async () => {
    const w = where(partnerPrincipal(pB), { alias: "c", extra: ["c.org_id = $1"], params: [org] });
    const { rows } = await db.query(`SELECT c.id FROM clients c ${w.sql}`, w.params);
    assert.deepEqual(rows.map((r) => r.id), [cB]);
  });

  test("ATTACK: guessing another partner's client uuid directly → not found", async () => {
    // The realistic attack: the partner knows or guesses the id and asks for it.
    await assert.rejects(
      () => assertCanReadClient(db, partnerPrincipal(pA), cB),
      (e) => {
        assert.equal(e.code, "NOT_FOUND");
        // Must not confirm existence — "exists but not yours" is a disclosure.
        assert.doesNotMatch(e.message, /forbidden|not yours|other partner/i);
        return true;
      }
    );
    // And their own still resolves.
    const own = await assertCanReadClient(db, partnerPrincipal(pA), cA);
    assert.equal(own.id, cA);
  });

  test("ATTACK: a partner cannot reach a DIRECT fundhub client either", async () => {
    await assert.rejects(() => assertCanReadClient(db, partnerPrincipal(pA), cDirect),
      /client not found/);
  });

  test("assertCanReadClient throws rather than returning null", async () => {
    // A caller that forgets to branch on null would render someone else's client.
    await assert.rejects(() => assertCanReadClient(db, partnerPrincipal(pA), cB));
    await assert.rejects(() => assertCanReadClient(db, partnerPrincipal(pA), null),
      /clientId is required/);
  });

  test("clientIdsFor is scoped the same way", async () => {
    assert.deepEqual(await clientIdsFor(db, partnerPrincipal(pA), { orgId: org }), [cA]);
    assert.deepEqual(await clientIdsFor(db, partnerPrincipal(pB), { orgId: org }), [cB]);
    const staffIds = await clientIdsFor(db, staffPrincipal(), { orgId: org });
    assert.ok(staffIds.includes(cA) && staffIds.includes(cB) && staffIds.includes(cDirect));
  });

  test("staff see the whole book, and that is explicit not accidental", async () => {
    const s = scopeFor(staffPrincipal());
    assert.equal(s.unrestricted, true, "the unrestricted case must announce itself");
    assert.equal(s.sql, "TRUE");
    const w = where(staffPrincipal(), { alias: "c", extra: ["c.org_id = $1"], params: [org] });
    // TRUE is dropped rather than concatenated, so the clause stays readable.
    assert.equal(w.sql, "WHERE c.org_id = $1");
  });

  // ══════════ ATTACK 3: cross the boundary through money ══════════

  test("ATTACK: a payout line cannot settle another partner's revenue", async () => {
    const rev = (await db.query(
      `INSERT INTO partner_revenue
         (org_id, partner_id, client_id, gross_amount, share_pct_applied, share_amount)
       VALUES ($1,$2,$3,1000,50,500) RETURNING id`, [org, pB, cB])).rows[0].id;
    const payout = (await db.query(
      `INSERT INTO partner_payouts (org_id, partner_id, period_start, period_end)
       VALUES ($1,$2, now() - interval '7 days', now()) RETURNING id`, [org, pA])).rows[0].id;

    await assert.rejects(
      () => db.query(
        `INSERT INTO partner_payout_lines (org_id, payout_id, revenue_id, amount)
         VALUES ($1,$2,$3,500)`, [org, payout, rev]),
      /crosses partners/,
      "LEAK: partner A was paid out of partner B's revenue"
    );
  });

  test("ATTACK: an accrual cannot be settled twice across runs", async () => {
    const rev = (await db.query(
      `INSERT INTO partner_revenue
         (org_id, partner_id, client_id, gross_amount, share_pct_applied, share_amount)
       VALUES ($1,$2,$3,1000,50,500) RETURNING id`, [org, pA, cA])).rows[0].id;
    const mk = async () => (await db.query(
      `INSERT INTO partner_payouts (org_id, partner_id, period_start, period_end)
       VALUES ($1,$2, now() - interval '7 days', now()) RETURNING id`, [org, pA])).rows[0].id;
    const p1 = await mk(), p2 = await mk();

    await db.query(`INSERT INTO partner_payout_lines (org_id, payout_id, revenue_id, amount)
                    VALUES ($1,$2,$3,500)`, [org, p1, rev]);
    await assert.rejects(
      () => db.query(`INSERT INTO partner_payout_lines (org_id, payout_id, revenue_id, amount)
                      VALUES ($1,$2,$3,500)`, [org, p2, rev]),
      /partner_payout_lines_revenue_once|duplicate key/,
      "double-pay guard did not hold"
    );
  });

  test("ATTACK: an unsigned partner cannot be paid, however the row is written", async () => {
    // pB deliberately has no agreement_signed_at.
    await assert.rejects(
      () => db.query(
        `INSERT INTO partner_payouts (org_id, partner_id, period_start, period_end, status, paid_at)
         VALUES ($1,$2, now() - interval '7 days', now(), 'paid', now())`, [org, pB]),
      /has not signed an agreement/
    );
    const held = (await db.query(
      `INSERT INTO partner_payouts (org_id, partner_id, period_start, period_end)
       VALUES ($1,$2, now() - interval '7 days', now()) RETURNING id`, [org, pB])).rows[0].id;
    await assert.rejects(
      () => db.query(`UPDATE partner_payouts SET status='processing' WHERE id=$1`, [held]),
      /has not signed an agreement/
    );
    // Revenue still accrues — the hold blocks release, not earning.
    await db.query(
      `INSERT INTO partner_revenue
         (org_id, partner_id, client_id, gross_amount, share_pct_applied, share_amount)
       VALUES ($1,$2,$3,200,50,100)`, [org, pB, cB]);
    const bal = (await db.query(
      `SELECT balance_accrued, agreement_signed FROM v_partner_balance WHERE partner_id = $1`,
      [pB])).rows[0];
    assert.equal(Number(bal.balance_accrued), 100);
    assert.equal(bal.agreement_signed, false);
  });

  test("ATTACK: a paused partner cannot be paid even having signed", async () => {
    await db.query(`UPDATE partners SET status='paused' WHERE id=$1`, [pA]);
    try {
      await assert.rejects(
        () => db.query(
          `INSERT INTO partner_payouts (org_id, partner_id, period_start, period_end, status, paid_at)
           VALUES ($1,$2, now() - interval '7 days', now(), 'paid', now())`, [org, pA]),
        /not active/
      );
    } finally {
      await db.query(`UPDATE partners SET status='active' WHERE id=$1`, [pA]);
    }
  });

  // ══════════ the rate is configuration, and history is immutable ══════════

  test("the revenue share default is 50 and is per-partner configurable", async () => {
    const p = (await db.query(
      `INSERT INTO partners (org_id, name, slug) VALUES ($1,'Defaulted','scope-test-alpha-2')
       RETURNING revenue_share_pct`, [org])).rows[0];
    assert.equal(Number(p.revenue_share_pct), 50);
    await db.query(`UPDATE partners SET revenue_share_pct = 62.5 WHERE slug = 'scope-test-alpha-2'`);
    const after = (await db.query(
      `SELECT revenue_share_pct FROM partners WHERE slug = 'scope-test-alpha-2'`)).rows[0];
    assert.equal(Number(after.revenue_share_pct), 62.5);
    await db.query(`DELETE FROM partners WHERE slug = 'scope-test-alpha-2'`);
  });

  test("changing the rate does NOT restate revenue already accrued", async () => {
    await db.query(`UPDATE partners SET revenue_share_pct = 50 WHERE id = $1`, [pA]);
    const rev = (await db.query(
      `INSERT INTO partner_revenue
         (org_id, partner_id, client_id, gross_amount, share_pct_applied, share_amount)
       VALUES ($1,$2,$3,1000,50,500) RETURNING id`, [org, pA, cA])).rows[0].id;

    await db.query(`UPDATE partners SET revenue_share_pct = 80 WHERE id = $1`, [pA]);
    const row = (await db.query(
      `SELECT share_pct_applied, share_amount FROM partner_revenue WHERE id = $1`, [rev])).rows[0];
    assert.equal(Number(row.share_pct_applied), 50, "history was restated by a rate change");
    assert.equal(Number(row.share_amount), 500);
    await db.query(`UPDATE partners SET revenue_share_pct = 50 WHERE id = $1`, [pA]);
  });

  test("an out-of-range share is rejected", async () => {
    await assert.rejects(
      () => db.query(`UPDATE partners SET revenue_share_pct = 140 WHERE id = $1`, [pA]),
      /partners_share_ck/);
    await assert.rejects(
      () => db.query(`UPDATE partners SET revenue_share_pct = -1 WHERE id = $1`, [pA]),
      /partners_share_ck/);
  });

  // ══════════ structural guards ══════════

  test("accrual is idempotent per event and per transaction", async () => {
    const ev = (await db.query(
      `INSERT INTO events (org_id, name, payload) VALUES ($1,'payment.received','{}')
       RETURNING id`, [org])).rows[0].id;
    const ins = () => db.query(
      `INSERT INTO partner_revenue
         (org_id, partner_id, client_id, source_event_id, gross_amount, share_pct_applied, share_amount)
       VALUES ($1,$2,$3,$4,1000,50,500) ON CONFLICT DO NOTHING RETURNING id`,
      [org, pA, cA, ev]);
    const a = await ins(), b = await ins();
    assert.equal(a.rows.length, 1);
    assert.equal(b.rows.length, 0, "same event twice created a second accrual");
  });

  test("revenue rows cannot be deleted — void them", async () => {
    const rev = (await db.query(
      `INSERT INTO partner_revenue
         (org_id, partner_id, client_id, gross_amount, share_pct_applied, share_amount)
       VALUES ($1,$2,$3,10,50,5) RETURNING id`, [org, pA, cA])).rows[0].id;
    await assert.rejects(() => db.query(`DELETE FROM partner_revenue WHERE id = $1`, [rev]),
      /not deletable/);
    await assert.rejects(
      () => db.query(`UPDATE partner_revenue SET status='void' WHERE id=$1`, [rev]),
      /partner_revenue_void_ck/, "a void must carry a reason");
    await db.query(`UPDATE partner_revenue SET status='void', void_reason='chargeback' WHERE id=$1`,
      [rev]);
  });

  test("deleting a partner cannot orphan or silently reassign their clients", async () => {
    await assert.rejects(() => db.query(`DELETE FROM partners WHERE id = $1`, [pA]),
      /violates foreign key|clients_partner_fk/);
    const still = (await db.query(`SELECT partner_id FROM clients WHERE id = $1`, [cA])).rows[0];
    assert.equal(still.partner_id, pA);
  });

  test("slugs are unique per org and URL-safe", async () => {
    await assert.rejects(
      () => db.query(`INSERT INTO partners (org_id, name, slug) VALUES ($1,'Dup',$2)`,
        [org, SLUG_A]), /partners_slug_uniq|duplicate key/);
    for (const bad of ["Has Space", "UPPER", "-leading", "trailing-", "a--", "-"]) {
      await assert.rejects(
        () => db.query(`INSERT INTO partners (org_id, name, slug) VALUES ($1,'X',$2)`, [org, bad]),
        /partners_slug/, `slug ${JSON.stringify(bad)} was accepted`);
    }
  });

  test("v_partner_book counts each partner's own clients only", async () => {
    const { rows } = await db.query(
      `SELECT partner_id, clients FROM v_partner_book WHERE partner_id = ANY($1)`, [[pA, pB]]);
    const byId = Object.fromEntries(rows.map((r) => [r.partner_id, r.clients]));
    assert.equal(byId[pA], 1);
    assert.equal(byId[pB], 1);
  });
});
