// Buying a white-label add-on, against a real Postgres. Skipped without
// DATABASE_URL.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): payment rails and fee timing.
//
// WHAT IS BEING ATTACKED HERE, rather than demonstrated. Every failure mode in
// this path is silent:
//
//   * 277 makes payment_links.client_id nullable. If its exactly-one-owner
//     CHECK is lost, an ask can be addressed to nobody and still show a payable
//     URL, or to a client AND a partner at once.
//   * 271's partner no-overlap key includes the add-on. If a write forgets the
//     add-on, cancelling Lead Flow closes Creative Intelligence and DFY
//     Marketing with it and reports one row — nothing raises.
//   * the three add-ons must STACK (W6: "monthly, stack freely, cancel
//     freely"), so a constraint that is too tight is as wrong as one too loose.
//   * an add-on activated on the wrong cycle bills a month that is already paid
//     for, and 276's sweeper is what would do it.
//
// Fixtures are this file's own partner and its own rows, deleted on the way
// out. Nothing here touches a real partner, a real client or a real payment.
//
// Run it against a scratch database:
//   DATABASE_URL="postgres://…/scratch" node --test src/subscriptions/partner-addons.pg.test.mjs

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  buyAddOn, activateFromLink, cancelAddOn, listAddOns, resolveAddOn
} from "./partner-addons.mjs";
import { getSubscriptionAt } from "./store.mjs";
import { notBillableReason } from "./billing.mjs";
import { listDueSubscriptions } from "./billing-store.mjs";
import { instrumentRefusal } from "./charger.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SLUG = "addon-purchase-test-partner";
const ENV = { COMMAS_CHECKOUT_BASE_URL: "https://pay.example.test/checkout" };

describe("buying a partner add-on", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, partnerId;

  const wipe = async () => {
    if (!partnerId) return;
    await db.query(`DELETE FROM subscriptions WHERE partner_id = $1`, [partnerId]);
    await db.query(`DELETE FROM payment_links WHERE partner_id = $1`, [partnerId]);
  };

  /* markPaid — what src/handlers/payment-links.mjs does when Commas says the
     money cleared. Done directly here so this file tests the ACTIVATION, not
     the settle handler, which has its own tests. */
  const markPaid = (linkId, at) => db.query(
    `UPDATE payment_links SET status = 'paid', paid_at = $2 WHERE id = $1`,
    [linkId, at]
  );

  before(async () => {
    if (!HAVE_DB) return;
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0]?.id
      || (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
    assert.ok(org, "no org to test against");
    await db.query(`DELETE FROM partners WHERE slug = $1 AND org_id = $2`, [SLUG, org]);
    partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
      [org, "Add-on purchase test partner", SLUG]
    )).rows[0].id;
  });

  after(async () => {
    if (!HAVE_DB) return;
    await wipe();
    if (partnerId) await db.query(`DELETE FROM partners WHERE id = $1`, [partnerId]);
    await close();
  });

  test("the ask is addressed to the partner and to no client", async () => {
    await wipe();
    const out = await buyAddOn(db, {
      orgId: org, partnerId, addOn: "creative-intelligence", env: ENV
    });
    assert.equal(out.link.partner_id, partnerId);
    assert.equal(out.link.client_id, null);
    assert.equal(Number(out.link.amount_cents), 29700);
    assert.equal(out.link.status, "created");
    // The link is a request. Nothing recurs yet.
    const live = await getSubscriptionAt(db, { orgId: org, partnerId, tier: "creative-intelligence" });
    assert.equal(live, null, "an unpaid ask must not create an arrangement");
  });

  test("277: an ask cannot be addressed to both, or to neither", async () => {
    const clientId = (await db.query(`SELECT id FROM clients WHERE org_id = $1 LIMIT 1`, [org])).rows[0]?.id;
    const attempt = (cid, pid) => db.query(
      `INSERT INTO payment_links (org_id, client_id, partner_id, purpose, amount_cents, link_ref, checkout_url)
       VALUES ($1, $2, $3, 'custom', 100, $4, 'https://example.test/x')`,
      [org, cid, pid, `pl_chk_${Math.random().toString(16).slice(2)}`]
    );
    await assert.rejects(() => attempt(null, null), /payment_links_client_or_partner_chk/);
    if (clientId) {
      await assert.rejects(() => attempt(clientId, partnerId), /payment_links_client_or_partner_chk/);
    }
  });

  test("a paid link starts the add-on on the cycle the payment bought", async () => {
    await wipe();
    const paidAt = new Date("2026-01-31T15:00:00.000Z");
    const { link } = await buyAddOn(db, { orgId: org, partnerId, addOn: "dfy-marketing", env: ENV });
    await markPaid(link.id, paidAt);

    const out = await activateFromLink(db, { orgId: org, linkId: link.id });
    assert.equal(out.activated, true);
    const sub = out.subscription;
    assert.equal(sub.partner_id, partnerId);
    assert.equal(sub.client_id, null);
    assert.equal(sub.tier, "dfy-marketing");
    assert.equal(Number(sub.price_cents), 249700);
    assert.equal(sub.billing_interval, "monthly");
    // Charging in advance: the payment bought [31 Jan, 28 Feb) and the next
    // charge falls on the end of it — not on the day they just paid, and not on
    // 3 March, which is where an unclamped +1 month lands.
    assert.equal(new Date(sub.next_charge_at).toISOString(), "2026-02-28T15:00:00.000Z");
    assert.equal(new Date(sub.current_period_start).toISOString(), paidAt.toISOString());
  });

  test("the sweeper can see it, and honestly refuses to charge it", async () => {
    // 271's subscriptions_partner_card_chk forbids a card on a partner row
    // because there is no partner instrument table. That is a SKIP, never a
    // failure: burning a retry and flipping a partner to past_due would blame
    // them for a gap in our schema.
    const sub = await getSubscriptionAt(db, { orgId: org, partnerId, tier: "dfy-marketing" });
    assert.ok(sub, "no live add-on to sweep");
    assert.equal(notBillableReason(sub, { now: new Date("2026-03-01T00:00:00Z") }), null);
    assert.equal(instrumentRefusal(sub), "no_partner_instrument");

    const due = await listDueSubscriptions(db, { orgId: org, now: new Date("2026-03-01T00:00:00Z") });
    assert.ok(due.some((r) => String(r.id) === String(sub.id)), "the sweeper cannot see the add-on");
  });

  test("replaying the webhook does not start a second monthly bill", async () => {
    const link = (await db.query(
      `SELECT id FROM payment_links WHERE partner_id = $1 AND status = 'paid' ORDER BY created_at DESC LIMIT 1`,
      [partnerId]
    )).rows[0];
    const again = await activateFromLink(db, { orgId: org, linkId: link.id });
    assert.equal(again.activated, false);
    assert.equal(again.reason, "already_active");
    const rows = await db.query(
      `SELECT count(*)::int AS n FROM subscriptions
        WHERE partner_id = $1 AND lower(btrim(tier)) = 'dfy-marketing'`,
      [partnerId]
    );
    assert.equal(rows.rows[0].n, 1);
  });

  test("the add-ons stack — all three at once, W6's own worked example", async () => {
    await wipe();
    const paidAt = new Date("2026-02-10T12:00:00.000Z");
    for (const code of ["creative-intelligence", "dfy-marketing"]) {
      const { link } = await buyAddOn(db, { orgId: org, partnerId, addOn: code, env: ENV });
      await markPaid(link.id, paidAt);
      const out = await activateFromLink(db, { orgId: org, linkId: link.id });
      assert.equal(out.activated, true, `${code} did not activate`);
    }
    const view = await listAddOns(db, { orgId: org, partnerId, now: new Date("2026-02-15T00:00:00Z") });
    assert.equal(view.current.length, 2);
    const status = Object.fromEntries(view.catalog.map((c) => [c.code, c.status]));
    assert.equal(status["creative-intelligence"], "active");
    assert.equal(status["dfy-marketing"], "active");
    assert.equal(status["lead-flow"], "available");
  });

  test("cancelling ONE add-on leaves the other running", async () => {
    // THE SILENT ONE. A cancel that forgot the add-on would close both and
    // report one row, and nothing in the database would object.
    const at = new Date("2026-02-20T00:00:00.000Z");
    const out = await cancelAddOn(db, { orgId: org, partnerId, addOn: "dfy-marketing", at });
    assert.ok(out.subscription, "nothing was cancelled");
    assert.equal(out.subscription.tier, "dfy-marketing");

    const still = await getSubscriptionAt(db, {
      orgId: org, partnerId, tier: "creative-intelligence", at: new Date("2026-02-21T00:00:00Z")
    });
    assert.ok(still, "cancelling DFY Marketing also closed Creative Intelligence");
    assert.equal(still.cancelled_at, null);
  });

  test("a cancelled add-on stays answerable, and stops billing", async () => {
    const view = await listAddOns(db, { orgId: org, partnerId, now: new Date("2026-02-21T00:00:00Z") });
    const dfy = view.history.find((r) => r.tier === "dfy-marketing");
    assert.ok(dfy, "the cancelled add-on vanished from history");
    assert.equal(Number(dfy.price_cents), 249700, "the price it was on is still readable");
    assert.ok(dfy.effective_to, "a cancelled row must close, or it blocks every future signup");
    assert.equal(notBillableReason(dfy, { now: new Date("2026-04-01T00:00:00Z") }), "closed");

    const due = await listDueSubscriptions(db, { orgId: org, now: new Date("2026-04-01T00:00:00Z") });
    assert.ok(!due.some((r) => String(r.id) === String(dfy.id)), "a cancelled add-on is still being swept");
  });

  test("a cancelled add-on can be bought again", async () => {
    // A cancelled row is closed, so 271's exclusion constraint no longer covers
    // that window and the partner is a customer again rather than locked out.
    const out = await buyAddOn(db, {
      orgId: org, partnerId, addOn: "dfy-marketing", env: ENV, now: new Date("2026-03-01T00:00:00Z")
    });
    assert.equal(out.link.partner_id, partnerId);
    await markPaid(out.link.id, new Date("2026-03-02T09:00:00.000Z"));
    const act = await activateFromLink(db, { orgId: org, linkId: out.link.id });
    assert.equal(act.activated, true);
    assert.equal(new Date(act.subscription.next_charge_at).toISOString(), "2026-04-02T09:00:00.000Z");
  });

  test("Lead Flow is a one-time charge and never becomes a subscription", async () => {
    await wipe();
    const out = await buyAddOn(db, { orgId: org, partnerId, addOn: "lead-flow", units: 7, env: ENV });
    assert.equal(Number(out.link.amount_cents), 69300);   // 9900 x 7
    assert.match(out.link.description, /7 booked calls at \$99\.00 each/);

    await markPaid(out.link.id, new Date("2026-03-05T00:00:00.000Z"));
    const act = await activateFromLink(db, { orgId: org, linkId: out.link.id });
    assert.equal(act.activated, false);
    assert.equal(act.reason, "per_unit_charge");

    const rows = await db.query(
      `SELECT count(*)::int AS n FROM subscriptions WHERE partner_id = $1 AND lower(btrim(tier)) = 'lead-flow'`,
      [partnerId]
    );
    assert.equal(rows.rows[0].n, 0, "a per-unit charge must never be put on a cycle");

    // It is still on the record — as the ask it was.
    const view = await listAddOns(db, { orgId: org, partnerId });
    assert.ok(view.orders.some((o) => String(o.id) === String(out.link.id)));
  });

  test("Lead Flow can be bought again immediately — there is nothing to conflict with", async () => {
    const second = await buyAddOn(db, { orgId: org, partnerId, addOn: "lead-flow", units: 2, env: ENV });
    assert.equal(Number(second.link.amount_cents), 19800);
  });

  test("a second live copy of the SAME add-on is impossible", async () => {
    await wipe();
    const paidAt = new Date("2026-05-01T00:00:00.000Z");
    const first = await buyAddOn(db, { orgId: org, partnerId, addOn: "creative-intelligence", env: ENV });
    await markPaid(first.link.id, paidAt);
    await activateFromLink(db, { orgId: org, linkId: first.link.id });

    // The ask is refused before any money is asked for.
    await assert.rejects(
      () => buyAddOn(db, {
        orgId: org, partnerId, addOn: "creative-intelligence", env: ENV, now: new Date("2026-05-02T00:00:00Z")
      }),
      (e) => e.status === 409
    );

    // And the database refuses it even if something bypasses that check.
    await assert.rejects(
      () => db.query(
        `INSERT INTO subscriptions (org_id, partner_id, tier, price_cents, effective_from)
         VALUES ($1, $2, 'Creative-Intelligence  ', 29700, $3)`,
        [org, partnerId, new Date("2026-05-03T00:00:00Z")]
      ),
      /subscriptions_partner_no_overlap/
    );
  });

  test("the add-on never becomes client revenue", async () => {
    // 271 note 3 and W1 §2: these three are FundHub revenue. products.category
    // is 'partner_service', which is outside every funding/repair allow-list,
    // and 277 forbids a sale on a partner ask outright.
    const cat = (await db.query(
      `SELECT category FROM products WHERE org_id = $1 AND code = ANY($2)`,
      [org, ["creative-intelligence", "dfy-marketing", "lead-flow"]]
    )).rows;
    assert.ok(cat.length >= 1, "the add-ons are not in products");
    for (const r of cat) assert.equal(r.category, "partner_service");

    const links = (await db.query(
      `SELECT sale_id, invoice_id, client_id FROM payment_links WHERE partner_id = $1`,
      [partnerId]
    )).rows;
    for (const l of links) {
      assert.equal(l.sale_id, null);
      assert.equal(l.invoice_id, null);
      assert.equal(l.client_id, null);
    }
  });

  test("resolveAddOn agrees with the products rows the migration seeded", async () => {
    const codes = (await db.query(
      `SELECT code FROM products WHERE org_id = $1 AND category = 'partner_service' ORDER BY code`,
      [org]
    )).rows.map((r) => r.code);
    for (const code of codes) {
      assert.ok(resolveAddOn(code), `products has ${code} but the catalogue does not`);
    }
  });
});
