/* api/finance/bills.mjs and api/finance/cashflow.mjs against REAL Postgres.
 *
 * WHY THIS EXISTS ALONGSIDE THE UNIT TEST. src/http/bills-cashflow-endpoints.test.mjs
 * stubs `db.query` and proves what the handlers DECIDE — which statement runs,
 * what it is bound to, which refusal comes back. It cannot prove that the
 * statements are correct, because a fake answers whatever it is told to.
 *
 * AUDIT-FINDINGS' most expensive single entry is 031_invoices.sql: a migration
 * renamed three columns, the only writer of the table was never updated, and
 * `createInvoice()` threw SQLSTATE 42703 on every call for months while the unit
 * tests stayed green against an in-memory fake that still modelled the old
 * columns. Two whole workflows died mid-run and nobody noticed.
 *
 * These two handlers touch six tables by name — bank_accounts, bank_transactions,
 * recurring_bills, recurring_bill_transactions, card_liabilities and
 * cashflow_settings — and cashflow_settings' NINE sign-off columns do not share
 * the names of the values they sign (`min_buffer_cents` is signed by
 * `min_buffer_signed_off_at`, `settlement_lead_days` by
 * `settlement_lead_signed_off_at`). Exactly one thing catches a mistake in that
 * mapping, and it is a real database.
 *
 * SKIPS WITHOUT DATABASE_URL, which is most passes — see CLAUDE.md's traps note.
 * Run it with:
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fundhub_main \
 *     node --test src/http/bills-cashflow-endpoints.pg.test.mjs
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";

import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import bills from "../../api/finance/bills.mjs";
import cashflow from "../../api/finance/cashflow.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

/* Everything this file creates is findable by these, so a failed run leaves no
   rows behind for the next one to trip over. */
const STAFF_EMAIL = "bcf_http_test_owner@example.com";
const CLIENT_EMAIL = "bcf.http.test.subject@example.com";

const res = () => ({
  statusCode: 0, body: null, headers: {},
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
  status(c) { this.statusCode = c; return this; },
  json(p) { this.body = p; return this; }
});

describe("bills + cashflow endpoints against real Postgres", { skip: !HAS_DB && "DATABASE_URL not set" }, () => {
  let org, client, account, token;

  /* The handlers run the real requireAuth against the real sessions table, so
     every call below carries a token minted for a real row. There is no
     injection seam, deliberately. */
  const call = async (handler, { method = "GET", query = {}, body = null } = {}) => {
    const r = res();
    await handler({ method, query, body, headers: { authorization: "Bearer " + token } }, r);
    return r;
  };

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email = $1`, [CLIENT_EMAIL]))
      .rows.map((r) => r.id);
    if (ids.length) {
      // recurring_bill_transactions hangs off recurring_bills; drop the leaves
      // first rather than relying on a cascade this test did not write.
      await db.query(
        `DELETE FROM recurring_bill_transactions
          WHERE recurring_bill_id IN (SELECT id FROM recurring_bills WHERE client_id = ANY($1))`,
        [ids]
      );
      await db.query(`DELETE FROM recurring_bills WHERE client_id = ANY($1)`, [ids]);
      await db.query(
        `DELETE FROM bank_transactions
          WHERE bank_account_id IN (SELECT id FROM bank_accounts WHERE client_id = ANY($1))`,
        [ids]
      );
      await db.query(`DELETE FROM bank_accounts WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM staff WHERE email = $1`, [STAFF_EMAIL]);
  }

  before(async () => {
    if (!HAS_DB) return;
    org = await resolveDefaultOrg(db);
    await purge();

    const staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1, 'BCF Httptest Owner', 'owner', $2, 'active') RETURNING id`,
      [org, STAFF_EMAIL]
    )).rows[0].id;
    token = (await createSession(db, { staffId, orgId: org })).token;

    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1, 'BCF', 'Subject', $2) RETURNING id`,
      [org, CLIENT_EMAIL]
    )).rows[0].id;

    account = (await db.query(
      `INSERT INTO bank_accounts
         (org_id, client_id, name, mask, account_type, account_subtype, entity_kind,
          entity_kind_source, entity_kind_set_at, currency_code,
          current_balance_cents, available_balance_cents, balance_as_of)
       VALUES ($1, $2, 'BCF Everyday Checking', '1234', 'depository', 'checking',
               'personal', 'staff_reviewed', now(), 'USD', 250000, 250000, now())
       RETURNING id`,
      [org, client]
    )).rows[0].id;

    /* SIX MONTHLY CHARGES, all on the 12th. This is a real cadence the detector
       should find with high confidence, and the dates are relative to today so
       the "next expected" date is in the future whenever this runs — a fixture
       pinned to 2026 would start reporting the bill as stopped. */
    const today = new Date();
    for (let k = 6; k >= 1; k -= 1) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - k, 12));
      await db.query(
        `INSERT INTO bank_transactions
           (org_id, bank_account_id, client_id, amount_cents, posted_on,
            merchant_name, category, is_pending, provider_transaction_id, provider)
         VALUES ($1, $2, $3, -1599, $4, 'NETFLIX.COM', 'subscriptions', false, $5, 'manual')`,
        [org, account, client, d.toISOString().slice(0, 10), `bcf-http-test-px-${k}`]
      );
    }
  });

  after(async () => {
    if (!HAS_DB) return;
    await purge();
    await close();
  });

  test("redetect writes a bill and its evidence, and the bill carries the org and the client", async () => {
    const r = await call(bills, { method: "POST", body: { action: "redetect", client_id: client } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(r.body.ran, true);
    assert.equal(r.body.transactions_read, 6);
    assert.ok(r.body.bills + r.body.candidates >= 1, "six monthly charges detected nothing");

    const stored = (await db.query(
      `SELECT * FROM recurring_bills WHERE client_id = $1`, [client]
    )).rows;
    assert.equal(stored.length, 1, "expected exactly one detected bill");
    assert.equal(stored[0].org_id, org);
    assert.equal(stored[0].client_id, client,
      "the stored bill has no client — bank_transactions.client_id is nullable and a bill " +
      "with a NULL client is a bill no client-scoped read ever returns");
    assert.equal(Number(stored[0].typical_amount_cents), -1599,
      "the amount changed sign or scale on the way into the column");

    const links = (await db.query(
      `SELECT count(*)::int AS n FROM recurring_bill_transactions WHERE recurring_bill_id = $1`,
      [stored[0].id]
    )).rows[0].n;
    assert.equal(links, 6,
      "the bill landed without its evidence — a bill asserting a payment with nothing " +
      "behind it is indistinguishable from a well-evidenced one at every call site that " +
      "does not join");
  });

  test("running it twice does not duplicate the bill", async () => {
    await call(bills, { method: "POST", body: { action: "redetect", client_id: client } });
    await call(bills, { method: "POST", body: { action: "redetect", client_id: client } });
    const n = (await db.query(
      `SELECT count(*)::int AS n FROM recurring_bills WHERE client_id = $1`, [client]
    )).rows[0].n;
    assert.equal(n, 1,
      "detection is a standing inference, not an event — without the upsert, running this " +
      "weekly leaves fifty-two rows for one subscription and any SUM reports the client's " +
      "outgoings at fifty-two times their true value");
  });

  test("the bill reads back with a formatted amount and an ISO next-expected date", async () => {
    const r = await call(bills, { query: { client_id: client } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(r.body.bills.length, 1);
    const b = r.body.bills[0];
    assert.equal(b.typical_amount_display, "-15.99");
    assert.equal(b.transaction_count, undefined);
    assert.equal(r.body.transaction_count, 6);
    if (b.next_expected_on !== null) {
      assert.match(b.next_expected_on, /^\d{4}-\d{2}-\d{2}$/,
        "a `date` column reached the wire as a timestamp — east of Greenwich that renders " +
        "as the day BEFORE the day that was stored");
    }
  });

  test("the evidence read returns the six charges behind it", async () => {
    const list = await call(bills, { query: { client_id: client } });
    const billId = list.body.bills[0].id;
    const r = await call(bills, { query: { bill_id: billId } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(r.body.count, 6);
    assert.equal(r.body.evidence[0].amount_display, "-15.99");
    assert.match(r.body.evidence[0].posted_on, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!("raw" in r.body.evidence[0]), "the unparsed provider record is on the wire");
  });

  test("the projection sees the detected bill and the real balance", async () => {
    const r = await call(cashflow, { query: { client_id: client, horizon_days: "60" } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(r.body.projection.ok, true, JSON.stringify(r.body.projection.reason));
    assert.equal(r.body.projection.openingBalance, "2500.00");
    assert.equal(r.body.bills_projected, 1,
      "the stored bill did not survive the crossing from the store's snake_case rows into " +
      "the projector's camelCase — the failure that reads as 'this client has no bills'");
    assert.ok(JSON.stringify(r.body.projection.days).includes("NETFLIX"),
      "the bill is in the projection but carries no label");
  });

  test("the three thresholds save, read back, and a cleared one comes back UNSET", async () => {
    let r = await call(cashflow, {
      method: "POST",
      body: {
        action: "save_settings",
        min_buffer_cents: 25000,
        settlement_lead_days: 3,
        sign_off: ["settlement_lead_days"]
      }
    });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(r.body.thresholds.minBufferCents, 25000);
    assert.equal(r.body.thresholds.settlementLeadDays, 3);

    const row = (await db.query(
      `SELECT min_buffer_cents, min_buffer_signed_off_at,
              settlement_lead_days, settlement_lead_signed_off_at, settlement_lead_signed_off_by
         FROM cashflow_settings WHERE org_id = $1`, [org]
    )).rows[0];
    assert.ok(row.settlement_lead_signed_off_at, "the sign-off was not stamped");
    assert.equal(row.settlement_lead_signed_off_by, "BCF Httptest Owner",
      "nobody's name was recorded against the sign-off");
    assert.equal(row.min_buffer_signed_off_at, null,
      "a value that was changed kept its old signature — one edit now carries somebody " +
      "else's approval onto a figure they never saw");

    // Clearing it must return the system to "nobody has decided this", which
    // loadThresholds reports as an ABSENT key rather than a zero.
    r = await call(cashflow, {
      method: "POST", body: { action: "save_settings", min_buffer_cents: "" }
    });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.ok(!("minBufferCents" in r.body.thresholds),
      "a cleared threshold came back as a number — 'nobody has decided this' has become " +
      "'somebody decided zero', permanently");

    r = await call(cashflow, { query: { view: "settings" } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.set.min_buffer_cents, false);
    assert.ok(Array.isArray(r.body.gaps));
    assert.ok(r.body.gaps.some((g) => /min_buffer_cents/.test(g.setting)),
      "an unset threshold is not being reported as a gap");
  });
});
