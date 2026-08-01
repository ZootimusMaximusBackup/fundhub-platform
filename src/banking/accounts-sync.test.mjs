// Bank account sync + the mock provider — unit tests. No Postgres, no network.
//
// The two things worth proving here are both about NOT WRITING:
//   * a mock that is not explicitly switched on writes nothing, and
//   * a provider that refuses leaves the database exactly as it was.
//
// A stand-in provider that can be switched on by accident, or that leaves half
// a sync behind when it fails, would put invented balances on an owner's
// funding screen. That is the worst outcome available in this repository, so it
// is the thing with the most assertions on it.

import { test, describe } from "node:test";
import assert from "node:assert";

import { syncBankAccounts, PROVIDERS, SYNC_REASONS } from "./accounts-sync.mjs";
import { getAccounts as mockGetAccounts, isMockEnabled, MOCK_REASONS } from "./providers/mock.mjs";

const ON = { BANKING_MOCK_PROVIDER: "1" };
const AS_OF = "2026-07-31T00:00:00.000Z";

function makeDb() {
  const calls = [];
  return {
    calls,
    query(sql, params) {
      calls.push({ sql, params });
      if (/^\s*SELECT/.test(sql)) return Promise.resolve({ rows: [] });
      if (/INSERT INTO bank_accounts/.test(sql)) {
        const cols = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map((s) => s.trim());
        const row = {};
        cols.forEach((c, i) => { row[c] = params[i]; });
        return Promise.resolve({ rows: [{ id: "row-" + row.provider_account_id, entity_kind: "unknown", ...row }] });
      }
      return Promise.resolve({ rows: [] });
    }
  };
}

const base = { orgId: "org-1", clientId: "c-1", asOf: AS_OF };

describe("the mock provider is off unless explicitly switched on", () => {

  test("only the exact string '1' enables it", () => {
    assert.equal(isMockEnabled({ BANKING_MOCK_PROVIDER: "1" }), true);
    for (const v of [undefined, "", "0", "true", "yes", "TRUE", " 1", "1 ", "on"]) {
      assert.equal(isMockEnabled({ BANKING_MOCK_PROVIDER: v }), false,
        `${JSON.stringify(v)} enabled the mock provider`);
    }
    assert.equal(isMockEnabled({}), false);
    assert.equal(isMockEnabled(undefined), false);
  });

  test("disabled: accounts is null, NOT an empty array", async () => {
    const out = await mockGetAccounts({ clientId: "c-1", asOf: AS_OF, env: {} });
    assert.equal(out.ok, false);
    assert.equal(out.reason, MOCK_REASONS.NOT_ENABLED);
    // [] would mean "this client has no bank accounts" — a finding a funding
    // decision would act on. null means "we did not ask".
    assert.equal(out.accounts, null);
    assert.deepEqual(out.missing, ["BANKING_MOCK_PROVIDER"]);
  });

  test("disabled: the sync writes NOTHING at all", async () => {
    const db = makeDb();
    const out = await syncBankAccounts(db, { ...base, providerName: "mock", env: {} });
    assert.equal(out.ok, false);
    assert.equal(out.reason, MOCK_REASONS.NOT_ENABLED);
    assert.equal(out.written, 0);
    assert.equal(db.calls.length, 0, "a refused sync touched the database");
  });

  test("it has no clock — asOf is required and is what gets stamped", async () => {
    const refused = await mockGetAccounts({ clientId: "c-1", asOf: null, env: ON });
    assert.equal(refused.ok, false);
    assert.equal(refused.accounts, null);

    const out = await mockGetAccounts({ clientId: "c-1", asOf: AS_OF, env: ON });
    for (const a of out.accounts) assert.equal(a.balanceAsOf, AS_OF);
  });

  test("it returns the same answer twice — no randomness", async () => {
    const a = await mockGetAccounts({ clientId: "c-1", asOf: AS_OF, env: ON });
    const b = await mockGetAccounts({ clientId: "c-1", asOf: AS_OF, env: ON });
    assert.deepEqual(a.accounts, b.accounts);
  });

  /* The fixture is shaped to prove the screen tells the truth, not to make it
     look full. These two rows are the ones that matter. */
  test("the fixture includes a credit line and an account with no balance", async () => {
    const out = await mockGetAccounts({ clientId: "c-1", asOf: AS_OF, env: ON });
    const credit = out.accounts.filter((a) => a.accountType === "credit");
    assert.equal(credit.length, 1, "no credit line — the headroom-is-not-cash rule is untested");
    assert.ok(credit[0].availableBalanceCents > 0, "the credit line has no headroom to mistake for cash");

    const unknown = out.accounts.filter((a) => a.currentBalanceCents === null);
    assert.equal(unknown.length, 1, "no unknown balance — the projection refusal is untested");
  });

  test("the fixture never carries an ownership claim", async () => {
    const out = await mockGetAccounts({ clientId: "c-1", asOf: AS_OF, env: ON });
    for (const a of out.accounts) {
      assert.equal(a.entityKind, undefined);
      assert.equal(a.entity_kind, undefined);
    }
  });

  test("every fixture row says NOT REAL in its raw payload", async () => {
    const out = await mockGetAccounts({ clientId: "c-1", asOf: AS_OF, env: ON });
    for (const a of out.accounts) {
      assert.equal(a.raw.provider, "mock");
      assert.match(a.raw.note, /NOT REAL/);
    }
  });
});

describe("the provider is always named — there is no default", () => {

  test("an unknown provider is refused and nothing is written", async () => {
    const db = makeDb();
    const out = await syncBankAccounts(db, { ...base, providerName: "wishful", env: ON });
    assert.equal(out.ok, false);
    assert.equal(out.reason, SYNC_REASONS.UNKNOWN_PROVIDER);
    assert.deepEqual(out.known.sort(), ["mock", "plaid"]);
    assert.equal(db.calls.length, 0);
  });

  test("a missing provider name is refused, not defaulted", async () => {
    const db = makeDb();
    for (const providerName of [undefined, null, "", "__proto__", "constructor"]) {
      const out = await syncBankAccounts(db, { ...base, providerName, env: ON });
      assert.equal(out.ok, false, `${JSON.stringify(providerName)} resolved to a provider`);
      assert.equal(db.calls.length, 0);
    }
  });

  test("org, client and asOf are each required before anything happens", async () => {
    const db = makeDb();
    for (const missing of [{ orgId: null }, { clientId: null }, { asOf: null }]) {
      const out = await syncBankAccounts(db, { ...base, ...missing, providerName: "mock", env: ON });
      assert.equal(out.ok, false);
      assert.equal(out.written, 0);
    }
    assert.equal(db.calls.length, 0);
  });
});

describe("the plaid seam stays unclosed and says so honestly", () => {

  test("unconfigured plaid reports not_configured and names only variables", async () => {
    const db = makeDb();
    const out = await syncBankAccounts(db, { ...base, providerName: "plaid", itemId: "item-1", env: {} });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "not_configured");
    // Names only. A secret value must never reach a response body.
    for (const m of out.missing) assert.match(m, /^[A-Z0-9_]+$/);
    assert.equal(db.calls.length, 0);
  });

  /* "not_configured" sends somebody to set an environment variable;
     "not_implemented" tells them the code does not exist. Collapsing them into
     one "sync failed" sends people to fix the wrong thing. */
  test("configured plaid reports not_implemented, which is a different problem", async () => {
    const db = makeDb();
    const out = await syncBankAccounts(db, {
      ...base,
      providerName: "plaid",
      itemId: "item-1",
      /* A well-formed 32-byte base64 key, because plaidConfigFromEnv checks the
         key is USABLE and not merely present — a short one would come back as
         not_configured and this test would pass for the wrong reason. Not a
         credential: 32 zero bytes. */
      env: {
        PLAID_CLIENT_ID: "test-client",
        PLAID_SECRET: "test-secret",
        PLAID_TOKEN_ENC_KEY: Buffer.alloc(32).toString("base64"),
        PLAID_ENV: "sandbox"
      }
    });
    assert.equal(out.ok, false);
    assert.notEqual(out.reason, "not_configured");
    assert.equal(out.written, 0);
    assert.equal(db.calls.length, 0);
  });

  test("plaid is registered as real, mock is not", () => {
    assert.equal(PROVIDERS.plaid.real, true);
    assert.equal(PROVIDERS.mock.real, false);
    assert.match(PROVIDERS.mock.label, /NOT REAL/);
  });
});

describe("a successful mock sync", () => {

  test("writes every fixture account, marked as mock, ownership unestablished", async () => {
    const db = makeDb();
    const out = await syncBankAccounts(db, { ...base, providerName: "mock", env: ON });
    assert.equal(out.ok, true);
    assert.equal(out.real, false);
    assert.equal(out.written, 4);
    for (const a of out.accounts) {
      assert.equal(a.provider, "mock");
      assert.equal(a.plaid_item_id, null);
      assert.equal(a.entity_kind, "unknown");
      assert.ok(a.provider_account_id, "a mock row landed with no provider key");
    }
  });

  test("the unknown balance is written as null, not zero", async () => {
    const db = makeDb();
    const out = await syncBankAccounts(db, { ...base, providerName: "mock", env: ON });
    const blank = out.accounts.find((a) => a.provider_account_id === "mock-checking-2");
    assert.equal(blank.current_balance_cents, null);
    assert.equal(blank.available_balance_cents, null);
  });

  test("running it twice writes the same rows, via ON CONFLICT", async () => {
    const db = makeDb();
    await syncBankAccounts(db, { ...base, providerName: "mock", env: ON });
    const first = db.calls.filter((c) => /INSERT/.test(c.sql)).length;
    await syncBankAccounts(db, { ...base, providerName: "mock", env: ON });
    const total = db.calls.filter((c) => /INSERT/.test(c.sql)).length;
    assert.equal(total, first * 2, "the second run issued a different number of writes");
    for (const c of db.calls.filter((x) => /INSERT/.test(x.sql))) {
      assert.match(c.sql, /ON CONFLICT/, "a mock write had no conflict target — a re-sync would duplicate it");
    }
  });

  test("the org is what the caller passed, never anything from the fixture", async () => {
    const db = makeDb();
    const out = await syncBankAccounts(db, { ...base, orgId: "org-9", providerName: "mock", env: ON });
    for (const a of out.accounts) assert.equal(a.org_id, "org-9");
  });
});
