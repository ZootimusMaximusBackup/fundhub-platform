/* Postgres-backed tests for /api/finance/bank-accounts.
 *
 * WHAT THIS PINS THAT THE STUBBED TESTS CANNOT. Its sibling,
 * src/http/bank-accounts-endpoints.test.mjs, runs the handler against a fake
 * `db.query` and proves the DECISIONS: who is refused, what is bound, which
 * statement runs. It cannot prove that any of those statements is legal SQL
 * against the real schema, that 082's provenance CHECK actually fires, that a
 * NULL balance survives a round trip through a bigint column instead of coming
 * back as a string that formats to "0.00", or that `raw` accepts the provenance
 * object this endpoint writes into it.
 *
 * SO THE ASSERTIONS HERE ARE AGAINST THE ROWS, NOT THE RESPONSES, wherever the
 * two could disagree. A response is the endpoint's account of what it did; the
 * row is what it did.
 *
 * AND ONE MORE THING ONLY A DATABASE CAN SHOW: that a row written HERE is read
 * back correctly by api/read/banking-surface.mjs, which is the endpoint the
 * existing Banking Surface screen uses. Both are driven against the same rows at
 * the bottom of this file, because "the writer works" and "the screen that reads
 * it works" are two claims and only one of them was asked for.
 *
 * It lives under src/http/ and not next to the handler because package.json's
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
import handler from "../../api/finance/bank-accounts.mjs";
import surfaceHandler from "../../api/read/banking-surface.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const STAFF_EMAIL_LIKE = "bank_acct_http_test_%@example.com";
const CLIENT_EMAIL_LIKE = "bank.acct.http.test.%@example.com";
const FOREIGN_ORG_SLUG = "bank-acct-http-test-other-co";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/finance/bank-accounts", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, foreignOrg, foreignClient;
  let owner, closer, foreignOwner;

  const call = async (h, { method = "POST", body, query = {}, token } = {}) => {
    const r = res();
    await h({ method, query, body, headers: token ? { authorization: "Bearer " + token } : {} }, r);
    return r;
  };

  const api = (opts) => call(handler, opts);

  const rows = async (clientId = client) => (await db.query(
    `SELECT * FROM bank_accounts WHERE client_id = $1 ORDER BY created_at, id`, [clientId])).rows;

  const wipe = async () => {
    const ids = [client, foreignClient].filter(Boolean);
    await db.query(`DELETE FROM bank_accounts WHERE client_id = ANY($1)`, [ids]);
  };

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      await db.query(`DELETE FROM bank_accounts WHERE client_id = ANY($1)`, [ids]);
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

    owner = await mkStaff(org, "owner", "bank_acct_http_test_owner@example.com", "Bank Httptest Owner");
    // A role inside ROLE_SETS.STAFF but outside ROLE_SETS.FINANCE. Without one of
    // these, "the gate works" only means "a signed-in person gets in".
    closer = await mkStaff(org, "closer", "bank_acct_http_test_closer@example.com", "Bank Httptest Closer");

    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Bank','Subject','bank.acct.http.test.subject@example.com') RETURNING id`,
      [org])).rows[0].id;

    /* A SECOND COMPANY. Everything else here shares one org, and on a one-org
       database every tenancy bug in this endpoint is invisible — which is
       exactly how the identical hole survived on the banking-surface read until
       audit M15 found it. */
    foreignOrg = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'Bank Httptest Other Co') RETURNING id`,
      [FOREIGN_ORG_SLUG])).rows[0].id;
    foreignClient = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Bank','Otherco','bank.acct.http.test.otherco@example.com') RETURNING id`,
      [foreignOrg])).rows[0].id;
    foreignOwner = await mkStaff(foreignOrg, "owner", "bank_acct_http_test_otherco@example.com", "Bank Httptest Otherco Owner");
  });

  after(async () => { await purge(); await close(); });

  /* ── the statements are legal, and they write what they claim ───────────── */

  describe("adding an account by hand", () => {

    test("a client with no accounts reads as no accounts, not as an error", async () => {
      await wipe();
      const r = await api({ method: "GET", query: { client_id: client }, token: owner.token });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.surface.accounts, 0);
      assert.equal(r.body.surface.needs_classification, false);
      // An empty group totals to UNKNOWN, not to 0.00.
      for (const g of r.body.surface.groups) assert.strictEqual(g.available.display, null);
    });

    test("one INSERT, under the caller's org, at integer cents", async () => {
      await wipe();
      const r = await api({
        body: {
          action: "add", client_id: client,
          name: "Business Checking", mask: "1234",
          account_type: "depository", account_subtype: "checking",
          currency_code: "usd",
          available: "1,204.50", current: "1250.00",
          balance_as_of: "2026-07-01"
        },
        token: owner.token
      });
      assert.equal(r.code, 201, JSON.stringify(r.body));

      const [row] = await rows();
      assert.equal(row.org_id, org);
      assert.equal(row.client_id, client);
      assert.equal(row.name, "Business Checking");
      assert.equal(row.mask, "1234");
      assert.equal(row.currency_code, "USD");
      // bigint columns come back as strings; the VALUE is what matters.
      assert.equal(Number(row.available_balance_cents), 120450);
      assert.equal(Number(row.current_balance_cents), 125000);
      assert.strictEqual(row.credit_limit_cents, null);
      assert.ok(row.balance_as_of instanceof Date);

      /* 081:41 — a NULL plaid_item_id means "entered by hand rather than read
         from a bank connection ... It is NOT 'we lost the link'". That NULL is
         the provenance marker and it must survive. */
      assert.strictEqual(row.plaid_item_id, null);
      assert.strictEqual(row.plaid_account_id, null);
      assert.equal(row.raw.entry, "manual");
      assert.equal(row.raw.entered_by_staff_id, owner.id);
    });

    /* 082's whole argument: an account nobody has classified arrives 'unknown',
       which is a REAL value and not a null stand-in, and it must not be folded
       into the client's own money. */
    test("a new account is unclassified, with no basis and no decision date", async () => {
      await wipe();
      await api({ body: { action: "add", client_id: client, name: "Some account" }, token: owner.token });
      const [row] = await rows();
      assert.equal(row.entity_kind, "unknown");
      assert.strictEqual(row.entity_kind_source, null);
      assert.strictEqual(row.entity_kind_set_at, null);
    });

    /* 081:30 — a NULL balance is "the bank did not tell us", which is a different
       answer from a zero balance, "and the difference decides whether someone
       gets funded". This is the round trip that proves it: NULL in the column,
       null on the wire, an em dash on the screen. */
    test("an empty money box is NULL in the column and null on the wire", async () => {
      await wipe();
      const r = await api({ body: { action: "add", client_id: client, name: "No figures yet" }, token: owner.token });
      const [row] = await rows();
      assert.strictEqual(row.available_balance_cents, null);
      assert.strictEqual(row.current_balance_cents, null);
      assert.strictEqual(row.balance_as_of, null);

      const acct = r.body.surface.groups.find((g) => g.key === "unknown").accounts[0];
      assert.strictEqual(acct.available_display, null);
      assert.strictEqual(acct.current_display, null);
    });

    /* 081:26 — "A CHECK (>= 0) here would reject the exact accounts a funding
       decision most needs to see ... The sign is data." */
    test("an overdrawn account is storable and is flagged as overdrawn", async () => {
      await wipe();
      const r = await api({
        body: { action: "add", client_id: client, name: "Overdrawn", account_type: "depository", current: "-412.19" },
        token: owner.token
      });
      const [row] = await rows();
      assert.equal(Number(row.current_balance_cents), -41219);
      const acct = r.body.surface.groups.find((g) => g.key === "unknown").accounts[0];
      assert.equal(acct.overdrawn, true);
    });

    test("a full account number is refused and nothing is stored", async () => {
      await wipe();
      const r = await api({
        body: { action: "add", client_id: client, mask: "4011223344556677" },
        token: owner.token
      });
      assert.equal(r.code, 400);
      assert.equal((await rows()).length, 0);
    });

    test("a closer cannot add an account", async () => {
      await wipe();
      const r = await api({ body: { action: "add", client_id: client, name: "Nope" }, token: closer.token });
      assert.equal(r.code, 403);
      assert.equal((await rows()).length, 0);
    });

    test("another company's owner cannot add an account to this client", async () => {
      await wipe();
      const r = await api({ body: { action: "add", client_id: client, name: "Theirs" }, token: foreignOwner.token });
      assert.equal(r.code, 403);
      assert.equal((await rows()).length, 0);
    });
  });

  /* ── classify ───────────────────────────────────────────────────────────── */

  describe("saying whose money it is", () => {

    const addOne = async (extra = {}) => {
      await wipe();
      const r = await api({
        body: { action: "add", client_id: client, name: "Account", account_type: "depository", available: "500", ...extra },
        token: owner.token
      });
      return r.body.account_id;
    };

    test("classifying writes the kind, the basis and the date together", async () => {
      const id = await addOne();
      const r = await api({
        body: { action: "classify", account_id: id, entity_kind: "business", entity_kind_source: "document_verified" },
        token: owner.token
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      const [row] = await rows();
      assert.equal(row.entity_kind, "business");
      assert.equal(row.entity_kind_source, "document_verified");
      assert.ok(row.entity_kind_set_at instanceof Date);
    });

    /* 082's bank_accounts_entity_kind_provenance_check would refuse this in SQL
       and the caller would see a 500. The endpoint answers first, with a
       sentence naming the field — and this test proves the row is untouched
       either way. */
    test("a classification with no basis is refused, and the row does not move", async () => {
      const id = await addOne();
      const r = await api({ body: { action: "classify", account_id: id, entity_kind: "personal" }, token: owner.token });
      assert.equal(r.code, 400);
      assert.match(r.body.error, /entity_kind_source/);
      const [row] = await rows();
      assert.equal(row.entity_kind, "unknown");
    });

    test("going back to unclassified clears the basis and the date", async () => {
      const id = await addOne();
      await api({
        body: { action: "classify", account_id: id, entity_kind: "personal", entity_kind_source: "client_stated" },
        token: owner.token
      });
      await api({ body: { action: "classify", account_id: id, entity_kind: "unknown" }, token: owner.token });
      const [row] = await rows();
      assert.equal(row.entity_kind, "unknown");
      assert.strictEqual(row.entity_kind_source, null);
      assert.strictEqual(row.entity_kind_set_at, null);
    });

    test("another company's owner cannot classify this client's account", async () => {
      const id = await addOne();
      const r = await api({
        body: { action: "classify", account_id: id, entity_kind: "business", entity_kind_source: "staff_reviewed" },
        token: foreignOwner.token
      });
      assert.equal(r.code, 403);
      assert.equal((await rows())[0].entity_kind, "unknown");
    });
  });

  /* ── close ──────────────────────────────────────────────────────────────── */

  describe("closing an account", () => {

    test("close stamps closed_at, keeps the row, and keeps the FIRST date", async () => {
      await wipe();
      const add = await api({
        body: { action: "add", client_id: client, name: "Old account", account_type: "depository", available: "10" },
        token: owner.token
      });
      const id = add.body.account_id;

      const first = await api({ body: { action: "close", account_id: id }, token: owner.token });
      assert.equal(first.code, 200);
      const closedAt = (await rows())[0].closed_at;
      assert.ok(closedAt instanceof Date);

      // A second press is a double-click far more often than a correction.
      const second = await api({
        body: { action: "close", account_id: id, at: "2030-01-01" },
        token: owner.token
      });
      assert.equal(second.code, 200);
      const after = await rows();
      assert.equal(after.length, 1, "closing never deletes");
      assert.equal(after[0].closed_at.getTime(), closedAt.getTime(), "the first close date stands");
    });

    /* banking-surface.mjs:158 — "a closed account's last known balance is not
       money anybody can reach". It is still COUNTED, because "this client had
       six accounts and two are closed" is a different fact from "has four". */
    test("a closed account still counts, but its balance leaves the total", async () => {
      await wipe();
      const a = await api({
        body: {
          action: "add", client_id: client, name: "Open one", account_type: "depository",
          available: "100", entity_kind: "personal", entity_kind_source: "staff_reviewed"
        },
        token: owner.token
      });
      const b = await api({
        body: {
          action: "add", client_id: client, name: "Closing one", account_type: "depository",
          available: "900", entity_kind: "personal", entity_kind_source: "staff_reviewed"
        },
        token: owner.token
      });
      assert.equal(b.body.surface.groups.find((g) => g.key === "personal").available.display, "1000.00");

      const closed = await api({ body: { action: "close", account_id: b.body.account_id }, token: owner.token });
      const personal = closed.body.surface.groups.find((g) => g.key === "personal");
      assert.equal(personal.count, 2, "still counted");
      assert.equal(personal.open_count, 1);
      assert.equal(personal.available.display, "100.00", "the closed balance is out of the total");
      assert.ok(a.body.account_id);
    });
  });

  /* ── the totals, and the rule they exist to enforce ─────────────────────── */

  describe("unknown is not personal, and a credit line is not cash", () => {

    test("an unclassified account is never added to the client's own money", async () => {
      await wipe();
      await api({
        body: {
          action: "add", client_id: client, name: "Theirs", account_type: "depository",
          available: "100", entity_kind: "personal", entity_kind_source: "client_stated"
        },
        token: owner.token
      });
      const r = await api({
        body: { action: "add", client_id: client, name: "Nobody asked", account_type: "depository", available: "5000" },
        token: owner.token
      });

      const by = Object.fromEntries(r.body.surface.groups.map((g) => [g.key, g]));
      assert.equal(by.personal.available.display, "100.00");
      assert.equal(by.unknown.available.display, "5000.00");
      assert.equal(r.body.surface.needs_classification, true);
      assert.equal(r.body.surface.unclassified, 1);
      // No combined figure anywhere. See banking-surface.mjs:20.
      assert.equal(r.body.surface.total, undefined);
      assert.equal(r.body.surface.available, undefined);
    });

    /* Audit M10 in one assertion. 081:85-87: on a card `available` is remaining
       HEADROOM, not cash. banking-surface.mjs:165 totals depository accounts
       only, so a credit line's headroom must not reach a cash total. */
    test("a credit line's headroom stays out of the cash total", async () => {
      await wipe();
      await api({
        body: {
          action: "add", client_id: client, name: "Chequing", account_type: "depository",
          available: "250", entity_kind: "personal", entity_kind_source: "staff_reviewed"
        },
        token: owner.token
      });
      const r = await api({
        body: {
          action: "add", client_id: client, name: "Amex", account_type: "credit",
          available: "7500", current: "1200", credit_limit: "8700",
          entity_kind: "personal", entity_kind_source: "staff_reviewed"
        },
        token: owner.token
      });
      const personal = r.body.surface.groups.find((g) => g.key === "personal");
      assert.equal(personal.count, 2);
      assert.equal(personal.available.display, "250.00", "the card's 7,500 headroom is not cash");
      assert.equal(personal.available.basis.lines, 1, "one deposit account was in scope");
    });

    /* A total over a set with holes in it is a FLOOR and must say so. sumKnown()
       is the shared rule (os-grid.mjs:71) and this is it firing on real rows. */
    test("a group with a missing balance reports partial, not a smaller total", async () => {
      await wipe();
      await api({
        body: {
          action: "add", client_id: client, name: "Known", account_type: "depository",
          available: "300", entity_kind: "business", entity_kind_source: "staff_reviewed"
        },
        token: owner.token
      });
      const r = await api({
        body: {
          action: "add", client_id: client, name: "Nobody typed it in", account_type: "depository",
          entity_kind: "business", entity_kind_source: "staff_reviewed"
        },
        token: owner.token
      });
      const business = r.body.surface.groups.find((g) => g.key === "business");
      assert.equal(business.available.display, "300.00");
      assert.equal(business.available.basis.partial, true);
      assert.equal(business.available.basis.unknown, 1);
      assert.equal(business.available.basis.counted, 1);
    });
  });

  /* ── does it show up on the screen that already reads this table? ────────── */

  describe("what this writes is what api/read/banking-surface serves", () => {

    /* THE EXISTING BANKING SURFACE SCREEN READS A DIFFERENT ENDPOINT, and that
       endpoint refuses everybody unless three PLAID_* environment variables are
       set (api/read/banking-surface.mjs:70). Those variables describe a bank
       connection that does not exist in this product, and the accounts this
       endpoint writes have nothing to do with one — so on any deploy without
       them, a hand-entered account is stored correctly and the Banking Surface
       screen still shows nothing.

       That is a real defect and it is NOT fixed here: api/read/banking-surface.mjs
       belongs to another pass and six agents share this tree. It is named in the
       track report. This test sets the variables so the rest of the assertion —
       that the row itself reads back correctly through the OTHER endpoint — can
       be made at all. The key is 32 bytes of base64 so it is well formed; it is a
       test constant and unlocks nothing. */
    const PLAID_KEYS = ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_TOKEN_ENC_KEY", "PLAID_ENV"];
    const saved = {};

    test("the same row, read through the Banking Surface endpoint, groups identically", async () => {
      await wipe();
      await api({
        body: {
          action: "add", client_id: client, name: "Business Checking", mask: "1234",
          account_type: "depository", currency_code: "USD", available: "1204.50",
          entity_kind: "business", entity_kind_source: "document_verified"
        },
        token: owner.token
      });
      const mine = await api({ method: "GET", query: { client_id: client }, token: owner.token });

      for (const k of PLAID_KEYS) saved[k] = process.env[k];
      process.env.PLAID_CLIENT_ID = "test-client-id";
      process.env.PLAID_SECRET = "test-secret";
      process.env.PLAID_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
      process.env.PLAID_ENV = "sandbox";
      let theirs;
      try {
        theirs = await call(surfaceHandler, {
          method: "GET", query: { client_id: client }, token: owner.token
        });
      } finally {
        for (const k of PLAID_KEYS) {
          if (saved[k] === undefined) delete process.env[k];
          else process.env[k] = saved[k];
        }
      }

      assert.equal(theirs.code, 200, JSON.stringify(theirs.body));
      assert.equal(theirs.body.accounts, 1);
      assert.equal(theirs.body.unclassified, 0);
      const b = theirs.body.groups.find((g) => g.key === "business");
      assert.equal(b.count, 1);
      assert.equal(b.accounts[0].name, "Business Checking");
      assert.equal(b.accounts[0].mask, "1234");
      assert.equal(b.available.display, "1204.50");

      // And the two endpoints agree, because they call the same module over the
      // same columns. If they ever stop agreeing, one of them has grown a second
      // answer to a question that has one.
      assert.deepEqual(
        mine.body.surface.groups.map((g) => [g.key, g.count, g.available.display]),
        theirs.body.groups.map((g) => [g.key, g.count, g.available.display])
      );
    });

    test("without the PLAID_* variables the Banking Surface screen sees nothing", async () => {
      for (const k of PLAID_KEYS) delete process.env[k];
      const theirs = await call(surfaceHandler, {
        method: "GET", query: { client_id: client }, token: owner.token
      });
      assert.equal(theirs.code, 403, "this is the gap named in the track report");
      // The hand-entry endpoint is unaffected: it never asks about Plaid.
      const mine = await api({ method: "GET", query: { client_id: client }, token: owner.token });
      assert.equal(mine.code, 200);
      assert.equal(mine.body.surface.accounts, 1);
    });
  });
});
