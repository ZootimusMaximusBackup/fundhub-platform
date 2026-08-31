// Buying a white-label add-on — the rules that must hold without a database.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): payment rails and fee timing. Every
// assertion below is about who gets asked for money, how much, and when the next
// ask falls due.
//
// WHY A FAKE db AND NOT A REAL ONE. The behaviour against Postgres is proved in
// partner-addons.pg.test.mjs, which SKIPS without DATABASE_URL — and a guard that
// skips is not a guard (the same reason partner-subscriptions.test.mjs exists
// beside its .pg. twin). What is checked here is the shape of the SQL and the
// arithmetic in front of it, both of which are wrong in silent ways:
//
//   * a partner-scoped cancel that forgets the tier closes EVERY add-on they
//     hold and reports one row. Nothing raises.
//   * a monthly add-on activated with next_charge_at set to the payment date is
//     billed again for the month just paid, the moment the sweeper wakes.
//   * a 31 January purchase that does not clamp lands on 2 or 3 March.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveAddOn, addOnAmountCents, purchaseDescription, isMonthly,
  ADD_ON_CODES, buyAddOn, activateFromLink, cancelAddOn, listAddOns
} from "./partner-addons.mjs";
import { PARTNER_ADD_ONS } from "../config/offers.mjs";
import { startSubscription, cancelSubscription, getSubscriptionAt, listSubscriptions } from "./store.mjs";
import { notBillableReason } from "./billing.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATION = path.join(ROOT, "db", "migrations", "277_partner_payment_links.sql");

const ORG = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";

/* fakeDb — a router, not a database. Each entry is [matcher, responder]; the
   first match wins and the call is recorded so a test can assert on the SQL and
   the parameters that were actually sent. Anything unmatched THROWS rather than
   returning an empty result: a silent empty result is how a test passes while
   the query it was meant to check never ran. */
function fakeDb(routes = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      for (const [match, rows] of routes) {
        if (match instanceof RegExp ? match.test(sql) : match(sql, params)) {
          const out = typeof rows === "function" ? rows(sql, params) : rows;
          return { rows: out || [] };
        }
      }
      throw new Error(`fakeDb: no route for SQL:\n${sql}`);
    }
  };
}

describe("migration 277 — a payment link may ask a PARTNER for money", () => {
  const sql = () => fs.readFileSync(MIGRATION, "utf8");

  test("the file is still there", () => {
    assert.ok(
      fs.existsSync(MIGRATION),
      "db/migrations/277_partner_payment_links.sql is gone — a partner add-on becomes "
      + "unpurchasable. Supersede it with a new numbered migration rather than deleting it: "
      + "db/migrate.mjs keys schema_migrations by '<dir>/<file>', so editing or removing an "
      + "applied file is a silent no-op."
    );
  });

  test("partner_id exists and client_id stopped being mandatory", () => {
    const s = sql();
    assert.match(s, /ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners\(id\)/);
    assert.match(s, /ALTER COLUMN client_id DROP NOT NULL/);
  });

  test("exactly one owner — never both, never neither", () => {
    const s = sql();
    assert.match(s, /payment_links_client_or_partner_chk/);
    assert.match(s, /client_id IS NOT NULL AND partner_id IS NULL/);
    assert.match(s, /client_id IS NULL AND partner_id IS NOT NULL/);
  });

  test("a partner ask can never carry a client's sale or invoice", () => {
    // sales.client_id is NOT NULL, so a sale_id on a partner row could only ever
    // point at somebody else's sale. Losing this check is silent.
    const s = sql();
    const i = s.indexOf("ADD CONSTRAINT payment_links_partner_no_sale_chk");
    assert.ok(i > 0, "no partner_no_sale check — a partner ask could carry a client's sale");
    const block = s.slice(i, i + 240);
    for (const col of ["sale_id IS NULL", "sale_motion IS NULL", "invoice_id IS NULL"]) {
      assert.ok(block.includes(col), `partner_no_sale check no longer covers ${col}`);
    }
  });

  test("it deletes nothing and rewrites nothing", () => {
    const s = sql().replace(/^\s*--.*$/gm, "");
    assert.ok(!/\bDELETE\s+FROM\b/i.test(s), "277 must not delete data");
    assert.ok(!/\bUPDATE\s+payment_links\b/i.test(s), "277 must not rewrite an existing ask");
    assert.ok(!/\bDROP\s+TABLE\b/i.test(s), "277 must not drop a table");
  });
});

describe("the menu", () => {
  test("three add-ons, at the owner-set prices", () => {
    assert.deepEqual(ADD_ON_CODES, ["creative-intelligence", "dfy-marketing", "lead-flow"]);
    assert.equal(PARTNER_ADD_ONS.CREATIVE_INTELLIGENCE.priceCents, 29700);
    assert.equal(PARTNER_ADD_ONS.DFY_MARKETING.priceCents, 249700);
    assert.equal(PARTNER_ADD_ONS.LEAD_FLOW.priceCents, 9900);
  });

  test("an add-on resolves by key, by product code, and by a scruffy tier", () => {
    assert.equal(resolveAddOn("LEAD_FLOW").productCode, "lead-flow");
    assert.equal(resolveAddOn("lead-flow").productCode, "lead-flow");
    // 271 keys its no-overlap constraint on lower(btrim(tier)) so 'Lead Flow'
    // and 'lead-flow  ' cannot both be live. A resolver that disagreed with the
    // constraint would hand back two different answers for one arrangement.
    assert.equal(resolveAddOn("  Lead-Flow  ").productCode, "lead-flow");
    assert.equal(resolveAddOn("does-not-exist"), null);
    assert.equal(resolveAddOn(null), null);
  });

  test("only two of the three are monthly", () => {
    assert.equal(isMonthly(resolveAddOn("creative-intelligence")), true);
    assert.equal(isMonthly(resolveAddOn("dfy-marketing")), true);
    assert.equal(isMonthly(resolveAddOn("lead-flow")), false);
  });
});

describe("what a purchase asks for", () => {
  test("a monthly add-on asks for one month", () => {
    assert.equal(addOnAmountCents(resolveAddOn("creative-intelligence")), 29700);
    assert.equal(addOnAmountCents(resolveAddOn("dfy-marketing")), 249700);
  });

  test("units on a monthly add-on are refused, never multiplied", () => {
    // Three months up front is a prepayment with a fee-timing question attached
    // (when is the next charge due?). Multiplying answers it silently.
    assert.throws(
      () => addOnAmountCents(resolveAddOn("dfy-marketing"), 3),
      /billed monthly/
    );
    // 1 is the same as omitting it and must not raise.
    assert.equal(addOnAmountCents(resolveAddOn("dfy-marketing"), 1), 249700);
  });

  test("Lead Flow is $99 times the booked calls", () => {
    assert.equal(addOnAmountCents(resolveAddOn("lead-flow"), 1), 9900);
    assert.equal(addOnAmountCents(resolveAddOn("lead-flow"), 12), 118800);
  });

  test("Lead Flow without a unit count is refused, not assumed to be one", () => {
    assert.throws(() => addOnAmountCents(resolveAddOn("lead-flow")), RangeError);
    assert.throws(() => addOnAmountCents(resolveAddOn("lead-flow"), 0), RangeError);
    assert.throws(() => addOnAmountCents(resolveAddOn("lead-flow"), 2.5), RangeError);
    assert.throws(() => addOnAmountCents(resolveAddOn("lead-flow"), -3), RangeError);
  });

  test("the description says the unit price and the count, not just a total", () => {
    assert.equal(
      purchaseDescription(resolveAddOn("lead-flow"), 4),
      "Lead Flow — 4 booked calls at $99.00 each"
    );
    assert.equal(
      purchaseDescription(resolveAddOn("creative-intelligence")),
      "Creative Intelligence — $297.00/month"
    );
  });
});

describe("buying — the ask", () => {
  const productRow = [{ id: "33333333-3333-4333-8333-333333333333", code: "lead-flow" }];

  const routes = (extra = []) => [
    ...extra,
    [/FROM subscriptions/i, []],
    [/FROM products/i, productRow],
    [/INSERT INTO payment_links/i, (sql, params) => [{
      id: "44444444-4444-4444-8444-444444444444",
      org_id: params[0], client_id: params[1], partner_id: params[16],
      amount_cents: params[4], link_ref: params[6], status: "created"
    }]]
  ];

  const env = { COMMAS_CHECKOUT_BASE_URL: "https://pay.example.test/checkout" };

  test("the ask is addressed to the partner and to no client", async () => {
    const db = fakeDb(routes());
    const out = await buyAddOn(db, {
      orgId: ORG, partnerId: PARTNER, addOn: "lead-flow", units: 3, env
    });
    assert.equal(out.amountCents, 29700);          // 9900 x 3
    assert.equal(out.monthly, false);
    assert.equal(out.link.partner_id, PARTNER);
    assert.equal(out.link.client_id, null);
  });

  test("no client-scoped lookup is even attempted for a partner", async () => {
    // sales.client_id and call_outcomes.client_id are both NOT NULL, so these
    // queries could only ever return nothing. Running them with a NULL would
    // work by accident; not running them is the decision.
    const db = fakeDb(routes());
    await buyAddOn(db, { orgId: ORG, partnerId: PARTNER, addOn: "lead-flow", units: 1, env });
    const sqls = db.calls.map((c) => c.sql).join("\n");
    assert.ok(!/FROM sales/i.test(sqls), "a partner purchase must not read the sales table");
    assert.ok(!/FROM call_outcomes/i.test(sqls), "a partner purchase must not read call outcomes");
  });

  test("a monthly add-on checks for one already running BEFORE asking for money", async () => {
    const live = [{
      id: "55555555-5555-4555-8555-555555555555",
      org_id: ORG, partner_id: PARTNER, client_id: null,
      tier: "creative-intelligence", price_cents: 29700,
      effective_from: new Date(Date.now() - 86400000).toISOString(),
      effective_to: null, cancelled_at: null, status: "active"
    }];
    const db = fakeDb([[/FROM subscriptions/i, live], ...routes()]);
    await assert.rejects(
      () => buyAddOn(db, { orgId: ORG, partnerId: PARTNER, addOn: "creative-intelligence", env }),
      (e) => e.status === 409 && /already has Creative Intelligence/.test(e.message)
    );
    // And nothing was asked for.
    assert.ok(!db.calls.some((c) => /INSERT INTO payment_links/i.test(c.sql)));
  });

  test("an unknown add-on is refused by name", async () => {
    const db = fakeDb(routes());
    await assert.rejects(
      () => buyAddOn(db, { orgId: ORG, partnerId: PARTNER, addOn: "winners-board", env }),
      /is not one of the add-ons/
    );
  });
});

describe("activating — what the payment bought", () => {
  const PAID_AT = new Date("2026-01-31T15:00:00.000Z");

  const paidLink = (over = {}) => ({
    id: "44444444-4444-4444-8444-444444444444",
    org_id: ORG, partner_id: PARTNER, client_id: null,
    status: "paid", paid_at: PAID_AT.toISOString(),
    amount_cents: "29700",                   // bigint arrives as a STRING
    currency: "USD", link_ref: "pl_deadbeef",
    product_code: "creative-intelligence",
    ...over
  });

  const activationRoutes = (link, { live = [] } = {}) => {
    let inserted = null;
    const routes = [
      [/FROM payment_links/i, [link]],
      [/^\s*SELECT[\s\S]*FROM subscriptions\s+WHERE id = \$1 AND org_id = \$2/i,
        () => (inserted ? [inserted] : [])],
      [/FROM subscriptions/i, live],
      [/INSERT INTO subscriptions/i, (sql, params) => {
        inserted = {
          id: "66666666-6666-4666-8666-666666666666",
          org_id: params[0], client_id: params[1], partner_id: params[13],
          tier: params[2], status: "active", price_cents: params[4],
          currency: params[5] || "USD", card_id: params[6],
          current_period_start: params[9], current_period_end: params[10],
          effective_from: params[11], effective_to: null, cancelled_at: null,
          billing_interval: null, next_charge_at: null
        };
        return [inserted];
      }],
      [/UPDATE subscriptions/i, (sql, params) => {
        inserted = { ...inserted, next_charge_at: params[2], billing_interval: params[3] };
        return [inserted];
      }]
    ];
    return routes;
  };

  test("a paid monthly link becomes a subscription for that partner", async () => {
    const link = paidLink();
    const db = fakeDb(activationRoutes(link));
    const out = await activateFromLink(db, { orgId: ORG, link });
    assert.equal(out.activated, true);
    assert.equal(out.subscription.partner_id, PARTNER);
    assert.equal(out.subscription.client_id, null);
    assert.equal(out.subscription.tier, "creative-intelligence");
    // Price comes off the LINK, not the catalogue, and the bigint STRING is
    // turned into an integer exactly once.
    assert.equal(out.subscription.price_cents, 29700);
    assert.equal(typeof out.subscription.price_cents, "number");
  });

  test("the month just paid for is not billed again, and 31 Jan clamps to 28 Feb", async () => {
    const link = paidLink();
    const db = fakeDb(activationRoutes(link));
    const out = await activateFromLink(db, { orgId: ORG, link });
    // Charging in advance: the payment bought [31 Jan, 28 Feb) and the next
    // charge falls on the END of it. Setting it to the payment date instead has
    // the sweeper ask for the same month again the moment it wakes.
    const next = new Date(out.subscription.next_charge_at);
    assert.equal(next.toISOString(), "2026-02-28T15:00:00.000Z");
    assert.equal(out.subscription.billing_interval, "monthly");
    assert.equal(new Date(out.subscription.current_period_start).toISOString(), PAID_AT.toISOString());
  });

  test("an unpaid link creates nothing", async () => {
    const link = paidLink({ status: "sent", paid_at: null });
    const db = fakeDb(activationRoutes(link));
    const out = await activateFromLink(db, { orgId: ORG, link });
    assert.equal(out.activated, false);
    assert.equal(out.reason, "not_paid");
    assert.ok(!db.calls.some((c) => /INSERT INTO subscriptions/i.test(c.sql)));
  });

  test("Lead Flow never becomes a subscription", async () => {
    // $99 per booked call has no cycle. A subscriptions row for it would have
    // 276's sweeper asking for $99 every month regardless of calls delivered.
    const link = paidLink({ product_code: "lead-flow", amount_cents: "29700" });
    const db = fakeDb(activationRoutes(link));
    const out = await activateFromLink(db, { orgId: ORG, link });
    assert.equal(out.activated, false);
    assert.equal(out.reason, "per_unit_charge");
    assert.ok(!db.calls.some((c) => /INSERT INTO subscriptions/i.test(c.sql)));
  });

  test("a client's payment is ignored, not thrown on", async () => {
    // Every client payment in the system passes through this handler. A throw
    // would land a successful client payment in the dead-letter table.
    const db = fakeDb([[/FROM payment_links/i, []]]);
    const out = await activateFromLink(db, { orgId: ORG, linkRef: "pl_someclient" });
    assert.equal(out.activated, false);
    assert.equal(out.reason, "not_a_partner_add_on");
  });

  test("a replayed webhook does not create a second monthly bill", async () => {
    const link = paidLink();
    const live = [{
      id: "66666666-6666-4666-8666-666666666666",
      org_id: ORG, partner_id: PARTNER, client_id: null,
      tier: "creative-intelligence", price_cents: 29700, cancelled_at: null,
      effective_from: PAID_AT.toISOString(), effective_to: null, status: "active"
    }];
    const db = fakeDb(activationRoutes(link, { live }));
    const out = await activateFromLink(db, { orgId: ORG, link });
    assert.equal(out.activated, false);
    assert.equal(out.reason, "already_active");
    assert.ok(!db.calls.some((c) => /INSERT INTO subscriptions/i.test(c.sql)));
  });
});

describe("the store, now that a partner can own a row", () => {
  const capture = (rows = [{ id: "x" }]) => fakeDb([[() => true, rows]]);

  test("a subscription belongs to a client or a partner, never both", async () => {
    await assert.rejects(
      () => startSubscription(capture(), { orgId: ORG, clientId: "c", partnerId: PARTNER, tier: "t" }),
      /never both/
    );
    await assert.rejects(
      () => startSubscription(capture(), { orgId: ORG, tier: "t" }),
      /clientId or partnerId is required/
    );
  });

  test("a partner subscription cannot carry a card", async () => {
    // 271's subscriptions_partner_card_chk. There is no partner instrument
    // table, so a card_id on a partner row could only point at a client's.
    await assert.rejects(
      () => startSubscription(capture(), {
        orgId: ORG, partnerId: PARTNER, tier: "dfy-marketing", cardId: "77777777-7777-4777-8777-777777777777"
      }),
      /cannot carry a card/
    );
  });

  test("cancelling a partner add-on WITHOUT naming it is refused", async () => {
    // THE SILENT ONE. `WHERE partner_id = $2 AND effective_to IS NULL` matches
    // every add-on they hold. Without this refusal, cancelling Lead Flow closes
    // Creative Intelligence and DFY Marketing too and reports one row.
    await assert.rejects(
      () => cancelSubscription(capture(), { orgId: ORG, partnerId: PARTNER }),
      /needs the add-on's code/
    );
  });

  test("a partner cancel is scoped to one add-on, by the constraint's own comparison", async () => {
    const db = capture();
    await cancelSubscription(db, { orgId: ORG, partnerId: PARTNER, tier: "Lead-Flow " });
    const { sql, params } = db.calls[0];
    assert.match(sql, /partner_id = \$2 AND client_id IS NULL/);
    // lower(btrim(...)) on both sides, matching 271's key exactly. A raw
    // comparison would miss the row the constraint considers the same one.
    assert.match(sql, /lower\(btrim\(tier\)\) = lower\(btrim\(\$5::text\)\)/);
    assert.equal(params[4], "Lead-Flow");
  });

  test("a client cancel is unchanged — no tier needed, no partner rows reachable", async () => {
    const db = capture();
    await cancelSubscription(db, { orgId: ORG, clientId: "88888888-8888-4888-8888-888888888888" });
    const { sql, params } = db.calls[0];
    assert.match(sql, /client_id = \$2 AND partner_id IS NULL/);
    assert.ok(!/lower\(btrim\(tier\)\)/.test(sql), "a client holds one subscription, not one per tier");
    assert.equal(params.length, 4);
  });

  test("a partner read without a tier answers, rather than refusing", async () => {
    const db = capture([]);
    await getSubscriptionAt(db, { orgId: ORG, partnerId: PARTNER });
    assert.match(db.calls[0].sql, /partner_id = \$2 AND client_id IS NULL/);
    await listSubscriptions(db, { orgId: ORG, partnerId: PARTNER });
    assert.match(db.calls[1].sql, /partner_id = \$2 AND client_id IS NULL/);
  });
});

describe("a cancelled add-on stays answerable, and stays unbilled", () => {
  test("cancelAddOn returns the closed row rather than deleting it", async () => {
    const closed = {
      id: "66666666-6666-4666-8666-666666666666",
      org_id: ORG, partner_id: PARTNER, client_id: null, tier: "dfy-marketing",
      price_cents: 249700, status: "cancelled",
      cancelled_at: "2026-03-01T00:00:00.000Z",
      effective_from: "2026-01-31T15:00:00.000Z",
      effective_to: "2026-03-01T00:00:00.000Z",
      billing_interval: "monthly", next_charge_at: "2026-02-28T15:00:00.000Z"
    };
    const db = fakeDb([[/UPDATE subscriptions|WITH cancelled/i, [closed]]]);
    const out = await cancelAddOn(db, { orgId: ORG, partnerId: PARTNER, addOn: "dfy-marketing" });
    assert.equal(out.addOn.productCode, "dfy-marketing");
    assert.equal(out.subscription.price_cents, 249700);
    assert.equal(out.subscription.effective_to, "2026-03-01T00:00:00.000Z");

    /* AND THE SWEEPER WILL NOT TOUCH IT, even though next_charge_at is still
       written on the row. billing.mjs refuses a closed or cancelled row before
       it ever looks at the schedule. The date is left in place on purpose: it
       is evidence of what the arrangement was. */
    assert.equal(notBillableReason(out.subscription, { now: new Date("2026-04-01T00:00:00Z") }), "closed");
  });

  test("the menu shows cancelled apart from never-bought", async () => {
    const history = [{
      id: "a", org_id: ORG, partner_id: PARTNER, client_id: null, tier: "dfy-marketing",
      price_cents: 249700, status: "cancelled", cancelled_at: "2026-03-01T00:00:00.000Z",
      effective_from: "2026-01-31T15:00:00.000Z", effective_to: "2026-03-01T00:00:00.000Z"
    }];
    const db = fakeDb([
      [/FROM subscriptions/i, history],
      [/FROM payment_links/i, []]
    ]);
    const view = await listAddOns(db, { orgId: ORG, partnerId: PARTNER, now: new Date("2026-04-01T00:00:00Z") });
    const by = Object.fromEntries(view.catalog.map((c) => [c.code, c.status]));
    assert.equal(by["dfy-marketing"], "cancelled");
    assert.equal(by["creative-intelligence"], "available");
    assert.equal(view.current.length, 0);
    assert.equal(view.history.length, 1);
  });
});
