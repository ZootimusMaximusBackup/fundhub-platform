// POST /api/banking/sync-accounts — endpoint tests.
//
// STUBBED db, STUBBED requireAuth, STUBBED clock, NO DATABASE_URL — and under
// src/ because npm test's glob is `src/**` and `scripts/**` only. A gate proved
// by a test that skips is not proved.
//
// This is the first WRITE endpoint that touches bank_accounts, so the gate is
// the point of the file: who may call it, whose rows they may write, and what
// happens when the provider says no.

import { test, describe } from "node:test";
import assert from "node:assert";

import handler, { readBody } from "../../api/banking/sync-accounts.mjs";

function makeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const OWNER = { id: "s1", role: "owner", org_id: "org-1" };

function makeDb({ clientRows = [{ id: CLIENT_ID }] } = {}) {
  const calls = [];
  return {
    calls,
    query(sql, params) {
      calls.push({ sql, params });
      if (/FROM clients/.test(sql)) return Promise.resolve({ rows: clientRows });
      return Promise.resolve({ rows: [] });
    }
  };
}

const authAs = (staff) => async () => staff;
const authDenies = () => async (req, res) => {
  res.status(401).json({ ok: false, error: "unauthorized" });
  return null;
};

/* A sync stub, so these tests exercise the ENDPOINT and not the provider —
   src/banking/accounts-sync.test.mjs covers that half. */
const syncOk = (over = {}) => {
  const calls = [];
  const fn = async (db, args) => {
    calls.push(args);
    return {
      ok: true, reason: null, provider: "mock", real: false, written: 2,
      accounts: [
        { id: "a1", name: "Everyday Checking", mask: "1234", account_type: "depository",
          current_balance_cents: 48612, provider: "mock", entity_kind: "unknown" },
        { id: "a2", name: "Second Checking", mask: "3456", account_type: "depository",
          current_balance_cents: null, provider: "mock", entity_kind: "unknown" }
      ],
      vanished: [],
      ...over
    };
  };
  fn.calls = calls;
  return fn;
};

const syncRefuses = (reason, extra = {}) => {
  const calls = [];
  const fn = async (db, args) => {
    calls.push(args);
    return { ok: false, reason, written: 0, accounts: [], vanished: [], provider: "mock", ...extra };
  };
  fn.calls = calls;
  return fn;
};

async function call({
  staff = OWNER, body = { client_id: CLIENT_ID, provider: "mock" },
  method = "POST", db, auth, sync = syncOk(), query = {}
} = {}) {
  const res = makeRes();
  const database = db ?? makeDb();
  await handler({ method, body, query }, res, {
    db: database,
    requireAuth: auth ?? authAs(staff),
    syncBankAccounts: sync,
    now: () => new Date("2026-07-31T12:00:00Z"),
    env: { BANKING_MOCK_PROVIDER: "1" }
  });
  return { res, db: database, sync };
}

describe("method and gate", () => {

  test("only POST — this writes", async () => {
    for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
      const { res } = await call({ method });
      assert.equal(res.statusCode, 405, `${method} was accepted`);
      assert.equal(res.headers.allow, "POST");
    }
  });

  test("no session: 401, nothing written", async () => {
    const db = makeDb();
    const sync = syncOk();
    const { res } = await call({ auth: authDenies(), db, sync });
    assert.equal(res.statusCode, 401);
    assert.equal(db.calls.length, 0);
    assert.equal(sync.calls.length, 0);
  });

  /* NARROWER THAN THE READS NEXT DOOR, ON PURPOSE. read/money-map serves
     ROLE_SETS.STAFF — six roles — because a closer working a file needs to see
     it. This CREATES the rows those screens total. */
  test("only owner and admin may write; the other four staff roles get 403", async () => {
    for (const role of ["owner", "admin"]) {
      const { res } = await call({ staff: { id: "s", role, org_id: "org-1" } });
      assert.equal(res.statusCode, 200, `${role} was refused`);
    }
    for (const role of ["funding_advisor", "closer", "inquiry_specialist", "setter", "partner", "client"]) {
      const db = makeDb();
      const sync = syncOk();
      const { res } = await call({ staff: { id: "s", role, org_id: "org-1" }, db, sync });
      assert.equal(res.statusCode, 403, `${role} was allowed to write bank accounts`);
      assert.equal(db.calls.length, 0);
      assert.equal(sync.calls.length, 0);
    }
  });

  test("a session with no org is refused before anything happens", async () => {
    const db = makeDb();
    const sync = syncOk();
    const { res } = await call({ staff: { id: "s1", role: "owner" }, db, sync });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "no_org_scope");
    assert.equal(db.calls.length, 0);
    assert.equal(sync.calls.length, 0);
  });

  test("the org passed to the writer is the SESSION's, never the body's", async () => {
    const sync = syncOk();
    await call({ body: { client_id: CLIENT_ID, provider: "mock", org_id: "org-2" }, sync });
    assert.equal(sync.calls[0].orgId, "org-1");
  });

  test("a client in another org is 404, and nothing is written", async () => {
    const db = makeDb({ clientRows: [] });
    const sync = syncOk();
    const { res } = await call({ db, sync });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "no_such_client");
    assert.equal(sync.calls.length, 0, "the writer ran for a client outside the org");
  });

  test("the scope check is org-scoped SQL, not a filter in JavaScript", async () => {
    const { db } = await call();
    const check = db.calls.find((c) => /FROM clients/.test(c.sql));
    assert.match(check.sql, /WHERE id = \$1 AND org_id = \$2/);
    assert.deepEqual(check.params, [CLIENT_ID, "org-1"]);
  });
});

describe("parameters", () => {

  test("client_id is required and must be a uuid", async () => {
    for (const bad of [undefined, "", "nope", 12]) {
      const { res } = await call({ body: { client_id: bad, provider: "mock" } });
      assert.equal(res.statusCode, 400, `client_id=${JSON.stringify(bad)} was accepted`);
    }
  });

  /* A DEFAULT PROVIDER IS HOW A MOCK ENDS UP RUNNING IN PRODUCTION. */
  test("provider is required — there is no default", async () => {
    const sync = syncOk();
    const { res } = await call({ body: { client_id: CLIENT_ID }, sync });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "provider is required");
    assert.deepEqual(res.body.known.sort(), ["mock", "plaid"]);
    assert.equal(sync.calls.length, 0);
  });

  test("an unknown provider is refused, including prototype keys", async () => {
    for (const provider of ["wishful", "__proto__", "constructor", "toString"]) {
      const sync = syncOk();
      const { res } = await call({ body: { client_id: CLIENT_ID, provider }, sync });
      assert.equal(res.statusCode, 400, `${provider} was accepted as a provider`);
      assert.equal(sync.calls.length, 0);
    }
  });

  test("item_id must be a uuid when given", async () => {
    const { res } = await call({ body: { client_id: CLIENT_ID, provider: "plaid", item_id: "nope" } });
    assert.equal(res.statusCode, 400);
  });

  test("readBody handles a parsed object, a JSON string, nothing, and rubbish", () => {
    assert.deepEqual(readBody({ a: 1 }), { a: 1 });
    assert.deepEqual(readBody('{"a":1}'), { a: 1 });
    assert.deepEqual(readBody(""), {});
    assert.deepEqual(readBody(undefined), {});
    assert.deepEqual(readBody("[1,2]"), [1, 2]);
    assert.equal(readBody("not json at all"), null);
  });

  test("a body that is not JSON is a clear 400, not a crash", async () => {
    const res = makeRes();
    await handler({ method: "POST", body: "not json at all", query: {} }, res, {
      db: makeDb(), requireAuth: authAs(OWNER), syncBankAccounts: syncOk()
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /JSON/);
  });

  test("the balance timestamp is set once, at the edge", async () => {
    const sync = syncOk();
    const { res } = await call({ sync });
    assert.equal(sync.calls[0].asOf, "2026-07-31T12:00:00.000Z");
    assert.equal(res.body.as_of, "2026-07-31T12:00:00.000Z");
  });
});

describe("what comes back", () => {

  test("a mock sync is flagged not-real, in a field a caller cannot miss", async () => {
    const { res } = await call();
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.real, false);
    assert.match(res.body.warning, /NOT REAL/);
    assert.equal(res.body.written, 2);
  });

  test("a real provider carries no warning", async () => {
    const { res } = await call({ sync: syncOk({ provider: "plaid", real: true }) });
    assert.equal(res.body.real, true);
    assert.equal(res.body.warning, null);
  });

  test("an unknown balance is summarised as a dash, never 0.00", async () => {
    const { res } = await call();
    const blank = res.body.accounts.find((a) => /Second Checking/.test(a.summary));
    assert.match(blank.summary, /—/);
    assert.ok(!blank.summary.includes("0.00"));
  });

  test("every written account comes back with ownership unestablished", async () => {
    const { res } = await call();
    for (const a of res.body.accounts) assert.equal(a.entity_kind, "unknown");
  });

  test("it points at where to go and see the result", async () => {
    const { res } = await call();
    assert.match(res.body.next, /money-map\.html\?client_id=/);
  });

  test("accounts that stopped appearing are reported, not silently dropped", async () => {
    const vanished = [{ id: "old-2", name: "Closed?", note: "this account was stored before…" }];
    const { res } = await call({ sync: syncOk({ vanished }) });
    assert.deepEqual(res.body.vanished, vanished);
  });

  /* ok:true with written:0 is a REAL answer — the provider was asked and said
     this client has no accounts — and it must not read as a failure. */
  test("a provider that reports no accounts is a success, not an error", async () => {
    const { res } = await call({ sync: syncOk({ written: 0, accounts: [] }) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.written, 0);
  });
});

describe("refusals", () => {

  /* 409, not 500: the thing asked for is not in a state where it can happen.
     Keeping a real 500 meaning "something broke" is the point. */
  test("a provider refusal is a 409 carrying the provider's own reason", async () => {
    for (const reason of ["mock_provider_not_enabled", "not_configured", "not_implemented"]) {
      const { res } = await call({ sync: syncRefuses(reason) });
      assert.equal(res.statusCode, 409, `${reason} did not come back as 409`);
      assert.equal(res.body.error, reason);
      assert.equal(res.body.written, 0);
    }
  });

  test("missing configuration is reported by NAME, never by value", async () => {
    const { res } = await call({
      sync: syncRefuses("not_configured", { missing: ["PLAID_CLIENT_ID", "PLAID_TOKEN_ENC_KEY"] })
    });
    assert.deepEqual(res.body.missing, ["PLAID_CLIENT_ID", "PLAID_TOKEN_ENC_KEY"]);
    for (const m of res.body.missing) assert.match(m, /^[A-Z0-9_]+$/);
  });

  test("a bad-parameter database error is a 400, not a 500", async () => {
    const db = {
      calls: [],
      query() {
        const e = new Error("invalid input syntax for type uuid");
        e.code = "22P02";
        return Promise.reject(e);
      }
    };
    const { res } = await call({ db });
    assert.equal(res.statusCode, 400);
  });

  test("an unexpected database error is re-thrown for the adapter to shape", async () => {
    const db = { calls: [], query() { return Promise.reject(new Error("connection refused to db://u:p@host")); } };
    await assert.rejects(
      () => handler({ method: "POST", body: { client_id: CLIENT_ID, provider: "mock" }, query: {} }, makeRes(),
                    { db, requireAuth: authAs(OWNER), syncBankAccounts: syncOk() }),
      /connection refused/
    );
  });
});

describe("routing — the failure this repo has shipped twice", () => {

  test("the handler is in the hardcoded ROUTES map", async () => {
    const { ROUTES, routePath } = await import("../../netlify/functions/api.mjs");
    assert.ok(
      Object.prototype.hasOwnProperty.call(ROUTES, "banking/sync-accounts"),
      "banking/sync-accounts is absent from ROUTES — it 404s locally and deployed"
    );
    assert.equal(ROUTES["banking/sync-accounts"], handler);
    assert.equal(routePath("/api/banking/sync-accounts"), "banking/sync-accounts");
    assert.equal(routePath("/.netlify/functions/api/banking/sync-accounts"), "banking/sync-accounts");
  });
});
