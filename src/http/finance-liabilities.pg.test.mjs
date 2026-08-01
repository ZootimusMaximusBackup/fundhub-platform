/* /api/finance/liabilities against REAL Postgres.
 *
 * WHY THIS FILE EXISTS ALONGSIDE finance-liabilities.test.mjs. The stubbed test
 * next door proves every refusal — the role gate, both tenancy checks and every
 * field parser — because all of those happen before a write is attempted. It
 * cannot prove the write itself, for a specific and correct reason:
 * recordLiability() reaches past the shared `{ query }` handle for the pool it
 * fronts (src/liabilities/store.mjs:134) so its three statements land in ONE
 * transaction, and a stubbed handle never sees them.
 *
 * AND A FAKE CANNOT FAIL WHEN THE SCHEMA MOVES. AUDIT-FINDINGS.md's most
 * expensive entry is src/invoices/index.mjs writing to columns a migration had
 * renamed, with every test passing against an in-memory model of the old names.
 * So the things that actually protect a consumer's money here — that a
 * percentage reaches numeric(6,5) as a fraction and survives the 0..1 CHECK,
 * that dollars land as integer cents, that an unknown stays NULL through a real
 * column, and that the projection refuses to move backwards on a backfill — are
 * asserted against a live database or they are not asserted at all.
 *
 * Run live:
 *   DATABASE_URL=postgres://... node db/migrate.mjs
 *   DATABASE_URL=postgres://... node --test src/http/finance-liabilities.pg.test.mjs
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import handler from "../../api/finance/liabilities.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const STAFF_EMAIL_LIKE = "cardstack_http_test_%@example.com";
const CLIENT_EMAIL_LIKE = "cardstack.http.test.%@example.com";
const FOREIGN_ORG_SLUG = "cardstack-http-test-other-co";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/finance/liabilities (real postgres)", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client;
  let foreignOrg, foreignClient, foreignOwner;
  let owner;

  const call = async (method, { body, query = {}, token } = {}) => {
    const r = res();
    await handler({
      method, query, body,
      headers: token ? { authorization: "Bearer " + token } : {}
    }, r);
    return r;
  };

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      // 083/084 both cascade from clients, but the deletes are explicit so a
      // failure names the table it happened in.
      await db.query(`DELETE FROM card_liability_history WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM card_liabilities WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM tradelines WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
    await db.query(`DELETE FROM orgs WHERE slug = $1`, [FOREIGN_ORG_SLUG]);
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();

    {
      const id = (await db.query(
        `INSERT INTO staff (org_id, name, role, email, status)
         VALUES ($1,'Cardstack Httptest Owner','owner',$2,'active') RETURNING id`,
        [org, "cardstack_http_test_owner@example.com"])).rows[0].id;
      owner = { id, token: (await createSession(db, { staffId: id, orgId: org })).token };
    }

    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Cardstack','Subject','cardstack.http.test.subject@example.com') RETURNING id`,
      [org])).rows[0].id;

    /* A SECOND COMPANY. Everything above shares one org, and on a one-org
       database a cross-tenant read is invisible — which is exactly how the same
       hole survived on the tradelines and bank_accounts paths. */
    foreignOrg = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'Cardstack Httptest Other Co') RETURNING id`,
      [FOREIGN_ORG_SLUG])).rows[0].id;
    foreignClient = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Cardstack','Otherco','cardstack.http.test.otherco@example.com') RETURNING id`,
      [foreignOrg])).rows[0].id;
    {
      const id = (await db.query(
        `INSERT INTO staff (org_id, name, role, email, status)
         VALUES ($1,'Cardstack Httptest Otherco Owner','owner',$2,'active') RETURNING id`,
        [foreignOrg, "cardstack_http_test_otherco_owner@example.com"])).rows[0].id;
      foreignOwner = { id, token: (await createSession(db, { staffId: id, orgId: foreignOrg })).token };
    }
  });

  after(async () => { await purge(); await close(); });

  /* ── the whole round trip, in the order a person does it ─────────────────── */

  test("a card typed by hand becomes a real row, with the rate as a fraction", async () => {
    const r = await call("POST", {
      token: owner.token,
      body: {
        action: "add_card", client_id: client,
        lender: "Chase Ink Business", last4: "4417",
        credit_limit: "$10,000.00", balance: "2,500.55", apr: "24.99", opened_on: "2019-04-02"
      }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));

    const row = (await db.query(
      `SELECT * FROM tradelines WHERE client_id = $1 AND lender = 'Chase Ink Business'`, [client])).rows[0];
    assert.ok(row, "the card was reported saved and is not in the database");
    assert.equal(String(row.credit_limit_cents), "1000000", "dollars did not land as integer cents");
    assert.equal(String(row.balance_cents), "250055");
    assert.equal(Number(row.apr), 0.2499,
      "24.99 reached numeric(6,5) unconverted — every derived dollar figure would be 100x out (audit m4)");
    assert.equal(row.last4, "4417");
    assert.equal(row.source, "manual", "a hand-typed card must be tagged as one");
    assert.equal(row.org_id, org);
  });

  test("a card with nothing but a name is stored with UNKNOWNS, not zeroes", async () => {
    const r = await call("POST", {
      token: owner.token,
      body: { action: "add_card", client_id: client, lender: "Unknown Limit Card" }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const row = (await db.query(
      `SELECT * FROM tradelines WHERE client_id = $1 AND lender = 'Unknown Limit Card'`, [client])).rows[0];
    assert.equal(row.credit_limit_cents, null, "an unreported limit was written as 0");
    assert.equal(row.balance_cents, null);
    assert.equal(row.apr, null);
    assert.equal(row.opened_on, null);
  });

  test("a position is recorded, and the series and the projection both land", async () => {
    const card = (await db.query(
      `SELECT id FROM tradelines WHERE client_id = $1 AND lender = 'Chase Ink Business'`, [client])).rows[0].id;

    const r = await call("POST", {
      token: owner.token,
      body: {
        action: "upsert", client_id: client, tradeline_id: card,
        as_of: "2026-07-15", current_balance: "3000", statement_balance: "2950",
        minimum_payment: "90", payment_due_date: "2026-08-04", payment_status: "current"
      }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.current.current_balance, "3000.00");
    assert.equal(r.body.superseded, false);

    const hist = (await db.query(
      `SELECT * FROM card_liability_history WHERE tradeline_id = $1`, [card])).rows;
    assert.equal(hist.length, 1, "the durable series did not get the observation");
    assert.ok(hist[0].liability_id, "the series row was left unlinked to its projection (audit m10)");

    const cur = (await db.query(`SELECT * FROM card_liabilities WHERE tradeline_id = $1`, [card])).rows;
    assert.equal(cur.length, 1);
    assert.equal(String(cur[0].current_balance_cents), "300000");
    assert.equal(String(cur[0].minimum_payment_cents), "9000");
    assert.equal(cur[0].id, hist[0].liability_id, "the two writes describe different rows");
  });

  test("backfilling an OLDER statement lands in the series and leaves the current position alone", async () => {
    const card = (await db.query(
      `SELECT id FROM tradelines WHERE client_id = $1 AND lender = 'Chase Ink Business'`, [client])).rows[0].id;

    const r = await call("POST", {
      token: owner.token,
      body: {
        action: "upsert", client_id: client, tradeline_id: card,
        as_of: "2026-06-15", current_balance: "1000"
      }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.current.current_balance, "3000.00",
      "a backfill of last month's statement was crowned current — the client would be shown a stale balance");
    assert.equal(r.body.superseded, true,
      "the screen has no way to say why the headline number did not move");

    const hist = (await db.query(
      `SELECT * FROM card_liability_history WHERE tradeline_id = $1 ORDER BY as_of DESC`, [card])).rows;
    assert.equal(hist.length, 2, "the backfilled observation was dropped rather than kept");
  });

  test("an unknown minimum payment stays unknown through a real column", async () => {
    const card = (await db.query(
      `SELECT id FROM tradelines WHERE client_id = $1 AND lender = 'Unknown Limit Card'`, [client])).rows[0].id;
    const r = await call("POST", {
      token: owner.token,
      body: { action: "upsert", client_id: client, tradeline_id: card, as_of: "2026-07-20", current_balance: "500" }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const cur = (await db.query(`SELECT * FROM card_liabilities WHERE tradeline_id = $1`, [card])).rows[0];
    assert.equal(cur.minimum_payment_cents, null,
      'an unreported minimum became $0 — "this card requires no payment" is a claim we cannot make');
    assert.equal(r.body.current.minimum_payment, null);
  });

  test("the stack reads back with both sources named and the disagreement reported", async () => {
    const r = await call("GET", { token: owner.token, query: { client_id: client } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.source, "card_liabilities+tradelines");
    assert.equal(r.body.cards.length, 2);

    const chase = r.body.cards.find((c) => c.lender === "Chase Ink Business");
    assert.equal(chase.balance, "3000.00");
    assert.equal(chase.balance_source, "card_liabilities");
    assert.equal(chase.credit_limit, "10000.00");
    assert.equal(chase.headroom, "7000.00");
    assert.equal(chase.apr_display, "24.99%");
    assert.equal(chase.utilization_display, "30.0%");
    assert.equal(chase.observations, 2);
    assert.ok(chase.disagreement, "the facility says 2500.55 and the position says 3000 — that must be visible");
    assert.equal(chase.disagreement.tradelines, "2500.55");
    assert.equal(chase.opened_on, "2019-04-02", "the opening date shifted by a day or was lost");

    const unknown = r.body.cards.find((c) => c.lender === "Unknown Limit Card");
    assert.equal(unknown.credit_limit, null, "an unknown limit came back as a number");
    assert.equal(unknown.utilization, null, "utilization against an unknown limit is not 0%");

    // The most expensive money first, and a card with no rate is not "the most
    // expensive" — it is unpriced, and it sorts last.
    assert.deepEqual(r.body.cards.map((c) => c.lender), ["Chase Ink Business", "Unknown Limit Card"]);

    const limit = r.body.totals.find((t) => t.key === "credit_limit");
    assert.equal(limit.display, "10000.00");
    assert.equal(limit.basis.partial, true, "a floor was presented as a total");
  });

  test("the series reads back newest first", async () => {
    const card = (await db.query(
      `SELECT id FROM tradelines WHERE client_id = $1 AND lender = 'Chase Ink Business'`, [client])).rows[0].id;
    const r = await call("GET", { token: owner.token, query: { tradeline_id: card } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.count, 2);
    assert.deepEqual(r.body.observations.map((o) => o.as_of), ["2026-07-15", "2026-06-15"],
      "the series is out of order, or a date shifted by a day");
    assert.equal(r.body.observations[0].payment_due_date, "2026-08-04");
    assert.equal(r.body.observations[1].minimum_payment, null);
  });

  test("an edit puts a limit back to UNKNOWN rather than to zero", async () => {
    const card = (await db.query(
      `SELECT id FROM tradelines WHERE client_id = $1 AND lender = 'Unknown Limit Card'`, [client])).rows[0].id;
    let r = await call("POST", {
      token: owner.token,
      body: { action: "edit_card", client_id: client, tradeline_id: card, credit_limit: "5000" }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.card.credit_limit, "5000.00");

    r = await call("POST", {
      token: owner.token,
      body: { action: "edit_card", client_id: client, tradeline_id: card, credit_limit: "" }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const row = (await db.query(`SELECT credit_limit_cents FROM tradelines WHERE id = $1`, [card])).rows[0];
    assert.equal(row.credit_limit_cents, null, "a retracted limit became $0, which is a claim rather than a retraction");
  });

  test("the database refuses a full card number even if every parser above is bypassed", async () => {
    /* 095's CHECK is the backstop, not the only line. Written directly, so this
       fails if a future migration drops the constraint quietly. */
    await assert.rejects(
      () => db.query(
        `INSERT INTO tradelines (org_id, client_id, lender, last4) VALUES ($1,$2,'PAN Test','4111111111111111')`,
        [org, client]),
      (e) => e.code === "23514",
      "a sixteen-digit number was accepted into the last-4 column"
    );
  });

  /* ── the tenancy line, with a real second company ────────────────────────── */

  describe("a second company cannot read this consumer's balances", () => {

    test("another company's owner is refused the stack", async () => {
      const r = await call("GET", { token: foreignOwner.token, query: { client_id: client } });
      assert.equal(r.code, 403, "an owner of another company read this consumer's card stack");
    });

    test("another company's owner is refused a card's series by id", async () => {
      const card = (await db.query(
        `SELECT id FROM tradelines WHERE client_id = $1 LIMIT 1`, [client])).rows[0].id;
      const r = await call("GET", { token: foreignOwner.token, query: { tradeline_id: card } });
      assert.equal(r.code, 403,
        "getLiabilityHistory() filters on tradeline_id ALONE — the handler's check is the only guard and it did not hold");
    });

    test("another company's owner cannot write a position onto this consumer's card", async () => {
      const card = (await db.query(
        `SELECT id FROM tradelines WHERE client_id = $1 LIMIT 1`, [client])).rows[0].id;
      const r = await call("POST", {
        token: foreignOwner.token,
        body: { action: "upsert", client_id: client, tradeline_id: card, as_of: "2026-07-31", current_balance: "1" }
      });
      assert.equal(r.code, 403);
    });

    test("naming your own client while pointing at somebody else's card is refused", async () => {
      const card = (await db.query(
        `SELECT id FROM tradelines WHERE client_id = $1 LIMIT 1`, [client])).rows[0].id;
      const r = await call("POST", {
        token: foreignOwner.token,
        body: { action: "upsert", client_id: foreignClient, tradeline_id: card, as_of: "2026-07-31", current_balance: "1" }
      });
      assert.equal(r.code, 403,
        "a position was written under one company's client naming another company's card");
    });

    test("no session at all reads nothing", async () => {
      const r = await call("GET", { query: { client_id: client } });
      assert.equal(r.code, 401);
    });
  });
});
