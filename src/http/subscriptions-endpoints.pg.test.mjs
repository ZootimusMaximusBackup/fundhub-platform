/* Postgres-backed tests for /api/finance/subscriptions and /api/finance/cards.
 *
 * WHAT THIS PINS THAT THE STUBBED TESTS CANNOT. Its sibling,
 * src/http/subscriptions-endpoints.test.mjs, runs both handlers against a fake
 * `db.query` and proves the decisions: who is refused, what is bound, which
 * statement runs. It cannot prove that any of those statements is legal SQL
 * against the real schema, that the exclusion constraint in 075 actually fires,
 * or that a NULL price survives a round trip through a bigint column instead of
 * arriving back as a string that formats to "0.00". Those need a database.
 *
 * SO THE ASSERTIONS HERE ARE AGAINST THE ROWS, NOT THE RESPONSES, wherever the
 * two could disagree. A response is the endpoint's account of what it did; the
 * row is what it did. "The card was taken off file" is only true if removed_at
 * is set; "nothing was charged" is only true because there is nothing in this
 * repository that could charge anything, which is itself asserted by the absence
 * of any outbound call — see the header of src/subscriptions/store.mjs.
 *
 * It lives under src/http/ and not next to the handlers because package.json's
 * glob walks src/ and scripts/ only; a test in api/ is never collected and
 * passes forever by never running (CLAUDE.md, traps).
 *
 * Skipped without DATABASE_URL, like every other *.pg.test.mjs.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import subscriptionsHandler from "../../api/finance/subscriptions.mjs";
import cardsHandler from "../../api/finance/cards.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const STAFF_EMAIL_LIKE = "subs_http_test_%@example.com";
const CLIENT_EMAIL_LIKE = "subs.http.test.%@example.com";
const FOREIGN_ORG_SLUG = "subs-http-test-other-co";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/finance/subscriptions + /api/finance/cards", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, foreignOrg, foreignClient;
  let owner, closer, foreignOwner;

  const call = async (handler, { method = "POST", body, query = {}, token }) => {
    const r = res();
    await handler({ method, query, body, headers: token ? { authorization: "Bearer " + token } : {} }, r);
    return r;
  };

  const subs = (h = { method: "POST" }) => call(subscriptionsHandler, h);
  const cards = (h = { method: "POST" }) => call(cardsHandler, h);

  const subRows = async (clientId = client) => (await db.query(
    `SELECT * FROM subscriptions WHERE client_id = $1 ORDER BY effective_from, created_at`,
    [clientId])).rows;

  const cardRows = async (clientId = client) => (await db.query(
    `SELECT * FROM client_cards WHERE client_id = $1 ORDER BY created_at`, [clientId])).rows;

  const wipe = async () => {
    const ids = [client, foreignClient].filter(Boolean);
    // subscriptions first: 076's foreign key onto client_cards is ON DELETE
    // RESTRICT, so a card cannot go while a subscription still points at it.
    await db.query(`DELETE FROM subscriptions WHERE client_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM client_cards WHERE client_id = ANY($1)`, [ids]);
  };

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      await db.query(`DELETE FROM subscriptions WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM client_cards WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
    await db.query(`DELETE FROM orgs WHERE slug = $1`, [FOREIGN_ORG_SLUG]);
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();

    const mkStaff = async (orgId, role, email, name) => {
      const id = (await db.query(
        `INSERT INTO staff (org_id, name, role, email, status)
         VALUES ($1,$2,$3,$4,'active') RETURNING id`, [orgId, name, role, email])).rows[0].id;
      return { id, token: (await createSession(db, { staffId: id, orgId })).token };
    };

    owner = await mkStaff(org, "owner", "subs_http_test_owner@example.com", "Subs Httptest Owner");
    // A role inside ROLE_SETS.STAFF but outside ROLE_SETS.FINANCE. Without one
    // of these, "the gate works" only means "a signed-in person gets in".
    closer = await mkStaff(org, "closer", "subs_http_test_closer@example.com", "Subs Httptest Closer");

    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Subs','Subject','subs.http.test.subject@example.com') RETURNING id`,
      [org])).rows[0].id;

    /* A SECOND COMPANY. Everything else here shares one org, and on a one-org
       database every tenancy bug in this endpoint is invisible — which is
       exactly how the identical hole survived on the banking-surface read until
       audit M15 found it. */
    foreignOrg = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'Subs Httptest Other Co') RETURNING id`,
      [FOREIGN_ORG_SLUG])).rows[0].id;
    foreignClient = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Subs','Otherco','subs.http.test.otherco@example.com') RETURNING id`,
      [foreignOrg])).rows[0].id;
    foreignOwner = await mkStaff(foreignOrg, "owner", "subs_http_test_otherco@example.com", "Subs Httptest Otherco Owner");
  });

  after(async () => { await purge(); await close(); });

  /* ── the lifecycle, in the order a person actually does it ──────────────── */

  describe("the plan lifecycle", () => {

    test("a client with no plan reads as no plan, not as an error", async () => {
      await wipe();
      const r = await subs({ method: "GET", query: { client_id: client }, token: owner.token });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.current, null);
      assert.deepEqual(r.body.history, []);
    });

    test("starting a plan writes one row, at integer cents, under the caller's org", async () => {
      await wipe();
      const r = await subs({
        body: { action: "start", client_id: client, tier: "gold", price: "49.00" },
        token: owner.token
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));

      const rows = await subRows();
      assert.equal(rows.length, 1, "a plan start did not write exactly one row");
      assert.equal(String(rows[0].price_cents), "4900",
        "the price did not land as integer cents — money.mjs's rule is broken at this boundary");
      assert.equal(rows[0].org_id, org, "the row was not filed under the caller's company");
      assert.equal(rows[0].tier, "gold");
      assert.equal(rows[0].effective_to, null, "a brand new plan was written already closed");
      assert.equal(r.body.subscription.price_display, "49.00");
    });

    test("a second plan for the same client is refused in a sentence, not a constraint name", async () => {
      const r = await subs({
        body: { action: "start", client_id: client, tier: "platinum", price: "99.00" },
        token: owner.token
      });
      assert.equal(r.code, 409, JSON.stringify(r.body));
      assert.match(String(r.body.error), /already has a subscription/i);
      assert.ok(!/23P01|subscriptions_no_overlap/.test(String(r.body.error)),
        "the caller was handed a Postgres constraint name to act on");
      assert.equal((await subRows()).length, 1, "the refused signup wrote a row anyway");
    });

    test("a plan change closes the old version and opens the new one with no gap and no overlap", async () => {
      const r = await subs({
        body: { action: "change", client_id: client, tier: "platinum", price: "99.00" },
        token: owner.token
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));

      const rows = await subRows();
      assert.equal(rows.length, 2, "a change did not leave exactly two versions");
      const [old_, now_] = rows;
      assert.ok(old_.effective_to, "the old version was left open — the client is on two plans");
      assert.equal(new Date(old_.effective_to).getTime(), new Date(now_.effective_from).getTime(),
        "there is a gap or an overlap between the two versions: the old one ends at " +
        old_.effective_to + " and the new one starts at " + now_.effective_from);
      assert.equal(String(now_.price_cents), "9900");
      assert.equal(now_.tier, "platinum");
    });

    test("the card binding is carried across a change, not dropped", async () => {
      // Put a card on the live plan first, then change the tier.
      await cards({ body: { action: "add", client_id: client, provider_token: "tok_carry_1", brand: "Visa", last4: "4242" }, token: owner.token });
      const cardId = (await cardRows()).find((c) => c.provider_token === "tok_carry_1").id;
      await cards({ body: { action: "attach", client_id: client, card_id: cardId }, token: owner.token });

      const r = await subs({ body: { action: "change", client_id: client, tier: "titanium", price: "149.00" }, token: owner.token });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.subscription.card_id, cardId,
        "the new version lost the card that pays for it — the client would be recorded as paying with nothing");
    });

    test("a change that changes nothing is refused", async () => {
      const r = await subs({ body: { action: "change", client_id: client, tier: "titanium", price: "149.00" }, token: owner.token });
      assert.equal(r.code, 400, JSON.stringify(r.body));
      assert.match(String(r.body.error), /unchanged/i);
    });

    test("the version history reads newest first and every version keeps its own price", async () => {
      const r = await subs({ method: "GET", query: { client_id: client }, token: owner.token });
      assert.equal(r.code, 200);
      const prices = r.body.history.map((h) => h.price_display);
      assert.deepEqual(prices, ["149.00", "99.00", "49.00"],
        "the chain does not explain the price changes in order — got " + JSON.stringify(prices));
      assert.equal(r.body.current.tier, "titanium");
    });

    test("cancelling closes the row and keeps the two dates apart", async () => {
      const endsAt = new Date(Date.now() + 60_000).toISOString();
      const r = await subs({
        body: { action: "cancel", client_id: client, ends_at: endsAt },
        token: owner.token
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));

      const live = (await subRows()).find((s) => s.tier === "titanium");
      assert.equal(live.status, "cancelled");
      assert.ok(live.cancelled_at, "no record of when the client asked");
      assert.ok(live.effective_to,
        "a cancelled plan was left open-ended — audit M16: that blocks every future signup forever");
      assert.notEqual(new Date(live.cancelled_at).getTime(), new Date(live.effective_to).getTime(),
        "the asked-on date and the runs-until date were collapsed into one");
    });

    test("cancelling twice does not move the date a dispute turns on", async () => {
      const before_ = (await subRows()).find((s) => s.tier === "titanium").cancelled_at;
      const r = await subs({ body: { action: "cancel", client_id: client }, token: owner.token });
      assert.equal(r.code, 200);
      const after_ = (await subRows()).find((s) => s.tier === "titanium").cancelled_at;
      assert.equal(new Date(after_).getTime(), new Date(before_).getTime(),
        "a second cancellation moved the date the client asked");
    });

    test("a cancelled client can be signed up again — the M16 regression", async () => {
      const startAt = new Date(Date.now() + 120_000).toISOString();
      const r = await subs({
        body: { action: "start", client_id: client, tier: "gold", price: "49.00", at: startAt },
        token: owner.token
      });
      assert.equal(r.code, 200,
        "a client who cancelled cannot be signed up again: " + JSON.stringify(r.body));
    });

    test("cancelling a client who has no plan is a 404, not a cheerful 200", async () => {
      await wipe();
      const r = await subs({ body: { action: "cancel", client_id: client }, token: owner.token });
      assert.equal(r.code, 404, JSON.stringify(r.body));
    });
  });

  /* ── an unknown price is not zero, all the way through Postgres ─────────── */

  describe("an unrecorded price", () => {

    test("is stored as NULL and comes back as null, never as 0.00", async () => {
      await wipe();
      const r = await subs({
        body: { action: "start", client_id: client, tier: "undecided", price: "" },
        token: owner.token
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal((await subRows())[0].price_cents, null,
        "an undecided price was written as a number — the client is on a plan that reads as free");
      assert.equal(r.body.subscription.price_display, null);

      const g = await subs({ method: "GET", query: { client_id: client }, token: owner.token });
      assert.equal(g.body.current.price_display, null,
        "the unknown price came back as a figure on the read path");
      assert.notEqual(g.body.current.price_display, "0.00");
    });

    test("a negative price is a 400 with the reason and writes nothing", async () => {
      await wipe();
      const r = await subs({
        body: { action: "start", client_id: client, tier: "gold", price: "-49.00" },
        token: owner.token
      });
      assert.equal(r.code, 400, JSON.stringify(r.body));
      assert.deepEqual(await subRows(), []);
    });
  });

  /* ── cards ──────────────────────────────────────────────────────────────── */

  describe("cards on file", () => {

    test("a card is stored as a token reference, and the token never comes back", async () => {
      await wipe();
      const r = await cards({
        body: {
          action: "add", client_id: client, provider_token: "tok_pg_1",
          brand: "Visa", last4: "4242", exp_month: 11, exp_year: 2029
        },
        token: owner.token
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));

      const rows = await cardRows();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].provider_token, "tok_pg_1", "the token was not stored");
      assert.equal(rows[0].last4, "4242");
      assert.ok(!JSON.stringify(r.body).includes("tok_pg_1"),
        "the response handed the processor token back to the browser");
      assert.equal(r.body.card.token_present, true);
    });

    test("a card number is refused at every door", async () => {
      const before_ = (await cardRows()).length;
      for (const body of [
        { provider_token: "tok_ok_a", pan: "4111111111111111" },
        { provider_token: "tok_ok_b", cvv: "123" },
        { provider_token: "4111111111111111" },
        { provider_token: "tok_ok_c", last4: "4111111111111111" }
      ]) {
        const r = await cards({ body: { action: "add", client_id: client, ...body }, token: owner.token });
        assert.equal(r.code, 400, "accepted: " + JSON.stringify(body) + " → " + JSON.stringify(r.body));
      }
      assert.equal((await cardRows()).length, before_,
        "a request carrying card data still wrote a row");
    });

    test("re-adding the same token refreshes the metadata and does not duplicate the card", async () => {
      const r = await cards({
        body: { action: "add", client_id: client, provider_token: "tok_pg_1", exp_year: 2031 },
        token: owner.token
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      const rows = await cardRows();
      assert.equal(rows.length, 1, "the same card is now on file twice");
      assert.equal(rows[0].exp_year, 2031, "the refreshed expiry was not stored");
      assert.equal(rows[0].brand, "Visa",
        "a refresh that did not mention the brand erased the brand — absence is not a correction");
    });

    test("attaching points the live plan at the card", async () => {
      await subs({ body: { action: "start", client_id: client, tier: "gold", price: "49.00" }, token: owner.token });
      const cardId = (await cardRows())[0].id;
      const r = await cards({ body: { action: "attach", client_id: client, card_id: cardId }, token: owner.token });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal((await subRows()).find((s) => s.effective_to === null).card_id, cardId);
    });

    test("removing stamps the card and never deletes it", async () => {
      const cardId = (await cardRows())[0].id;
      const r = await cards({ body: { action: "remove", client_id: client, card_id: cardId }, token: owner.token });
      assert.equal(r.code, 200, JSON.stringify(r.body));

      const rows = await cardRows();
      assert.equal(rows.length, 1, "the card was deleted — the plan that used it is no longer explainable");
      assert.ok(rows[0].removed_at, "the card was not stamped removed");
      assert.ok(r.body.card.removed_at);
    });

    test("a removed card cannot be attached, and says why", async () => {
      const cardId = (await cardRows())[0].id;
      const r = await cards({ body: { action: "attach", client_id: client, card_id: cardId }, token: owner.token });
      assert.equal(r.code, 409, JSON.stringify(r.body));
      assert.match(String(r.body.error), /removed|no live subscription/i);
    });

    test("adding the token again does NOT put a removed card back on file", async () => {
      const r = await cards({
        body: { action: "add", client_id: client, provider_token: "tok_pg_1" },
        token: owner.token
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.ok((await cardRows())[0].removed_at,
        "a metadata refresh brought a removed instrument back to life");
    });

    test("removed cards are readable, because the plan that used one has to stay explainable", async () => {
      const hidden = await cards({ method: "GET", query: { client_id: client }, token: owner.token });
      assert.equal(hidden.body.cards.length, 0, "a removed card is in the default list");
      const shown = await cards({ method: "GET", query: { client_id: client, include_removed: "1" }, token: owner.token });
      assert.equal(shown.body.cards.length, 1);
      assert.ok(shown.body.cards[0].removed_at);
    });

    test("removing a card that is not this client's is a 404 and stamps nothing", async () => {
      // The foreign client's card, asked for under this client's id, by an owner
      // of the foreign org's counterpart — the same org, different client, is
      // the case removeClientCard cannot see on its own.
      const r = await cards({
        body: { action: "remove", client_id: client, card_id: "99999999-9999-4999-8999-999999999999" },
        token: owner.token
      });
      assert.equal(r.code, 404, JSON.stringify(r.body));
    });
  });

  /* ── who may do any of this ─────────────────────────────────────────────── */

  describe("the gate", () => {

    test("no session gets nothing from either endpoint", async () => {
      for (const [h, q] of [[subscriptionsHandler, {}], [cardsHandler, {}]]) {
        const r = await call(h, { method: "GET", query: { client_id: client, ...q } });
        assert.equal(r.code, 401);
      }
    });

    test("a closer is inside ROLE_SETS.STAFF and still cannot see a price", async () => {
      const r = await subs({ method: "GET", query: { client_id: client }, token: closer.token });
      assert.equal(r.code, 403,
        "a role outside ROLE_SETS.FINANCE read a client's subscription price");
    });

    test("a closer cannot list, add or remove a payment instrument", async () => {
      assert.equal((await cards({ method: "GET", query: { client_id: client }, token: closer.token })).code, 403);
      assert.equal((await cards({ body: { action: "add", client_id: client, provider_token: "tok_x" }, token: closer.token })).code, 403);
    });

    test("another company's owner cannot read this company's client", async () => {
      const r = await subs({ method: "GET", query: { client_id: client }, token: foreignOwner.token });
      assert.equal(r.code, 403,
        "an owner at another company read a named client's plan — the ownership check is not holding");
    });

    test("another company's owner cannot write to this company's client", async () => {
      const before_ = (await subRows()).length;
      const r = await subs({
        body: { action: "start", client_id: client, tier: "smuggled", price: "1.00" },
        token: foreignOwner.token
      });
      assert.equal(r.code, 403, JSON.stringify(r.body));
      assert.equal((await subRows()).length, before_, "a cross-company write landed a row");
    });

    test("an org_id in the body is refused rather than obeyed or ignored", async () => {
      const r = await subs({
        body: { action: "start", client_id: client, org_id: foreignOrg, tier: "gold", price: "49.00" },
        token: owner.token
      });
      assert.equal(r.code, 400);
      assert.equal(r.body.error, "org_id_not_accepted");
    });
  });
});
