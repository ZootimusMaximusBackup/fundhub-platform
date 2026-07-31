// Plaid adapter tests — the network is stubbed at the module boundary and there
// is no live call anywhere in this file.
//
// EVERY TEST PASSES ITS OWN `fetchImpl` AND ITS OWN `env`. Nothing here reads
// process.env and nothing falls back to globalThis.fetch, so this suite cannot
// reach Plaid even if someone runs it on a machine with real keys exported. That
// is deliberate: a test that would make a real bank-data call under the wrong
// conditions is a test that eventually does.
//
// THE MOST IMPORTANT TEST IN THIS FILE is "unconfigured refuses BEFORE fetch".
// AUDIT-FINDINGS.md's third recorded lesson is "'Absent config' must never mean
// 'no gate'", earned from a webhook adapter that skipped signature verification
// whenever its key was unset and cheerfully answered 200. The mutation this file
// has to catch is the same shape: someone gives PLAID_ENV a default, or moves
// the config resolution below the fetch call, and an unconfigured deploy starts
// making real requests. Asserting on the thrown error alone would NOT catch it —
// a call that fires and then throws still fired. So the spy counts invocations
// and the assertion is that the count is zero.

import { test, describe } from "node:test";
import assert from "node:assert";

import {
  plaidConfig,
  isPlaidConfigured,
  exchangePublicToken,
  fetchAccounts,
  normalizeAccount,
  normalizeItem,
  centsOrNull,
  scrub,
  PlaidNotConfiguredError,
  PlaidApiError
} from "./plaid.mjs";

const ENV = Object.freeze({
  PLAID_CLIENT_ID: "test_client_id_0123456789",
  PLAID_SECRET: "test_secret_abcdefghijklmnop",
  PLAID_ENV: "sandbox"
});

const PUBLIC_TOKEN = "public-sandbox-11111111-2222-3333-4444-555555555555";
const ACCESS_TOKEN = "access-sandbox-99999999-8888-7777-6666-555555555555";

/* thrown / rejected — capture the error object.

   assert.throws() and assert.rejects() answer "did it fail", not "with what",
   and both resolve to undefined. Several assertions below are about the CONTENT
   of a failure — that a bank credential is not inside the message — so the error
   itself has to be in hand. */
function thrown(fn, Kind) {
  try {
    fn();
  } catch (e) {
    if (Kind) assert.ok(e instanceof Kind, `expected ${Kind.name}, got ${e?.name}: ${e?.message}`);
    return e;
  }
  assert.fail("expected a throw, got a return");
}

async function rejected(fn, Kind) {
  try {
    await fn();
  } catch (e) {
    if (Kind) assert.ok(e instanceof Kind, `expected ${Kind.name}, got ${e?.name}: ${e?.message}`);
    return e;
  }
  assert.fail("expected a rejection, got a resolve");
}

/* spy — a stand-in for fetch that records what it was asked to do and returns
   whatever the test says. `calls` is the whole point: several assertions below
   are about a call NOT happening. */
function spy(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler ? handler(url, init) : jsonResponse(200, {});
  };
  fn.calls = calls;
  return fn;
}

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body)
});

const exploding = () =>
  spy(() => {
    throw new Error("the network was touched — an unconfigured adapter must never dial out");
  });

// ---------------------------------------------------------------------------
// Configuration — absent config means DISABLED, not ungated
// ---------------------------------------------------------------------------

describe("configuration refuses rather than falling through", () => {
  test("with no config at all, plaidConfig throws and names every missing variable", () => {
    const err = thrown(() => plaidConfig({ env: {} }), PlaidNotConfiguredError);
    assert.match(err.message, /PLAID_CLIENT_ID/);
    assert.match(err.message, /PLAID_SECRET/);
    assert.match(err.message, /PLAID_ENV/);
    assert.equal(err.status, 503, "unconfigured is a deployment state (503), not a crash (500)");
  });

  for (const missing of ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV"]) {
    test(`${missing} alone being unset is enough to refuse`, () => {
      const env = { ...ENV };
      delete env[missing];
      const err = thrown(() => plaidConfig({ env }), PlaidNotConfiguredError);
      assert.match(err.message, new RegExp(missing));
    });

    test(`${missing} set to blank counts as unset`, () => {
      const err = thrown(() => plaidConfig({ env: { ...ENV, [missing]: "   " } }), PlaidNotConfiguredError);
      assert.match(err.message, new RegExp(missing));
    });
  }

  test("an unrecognised PLAID_ENV is refused, not guessed at", () => {
    // Plaid retired `development`. Accepting it would mean either a hostname
    // that no longer resolves or silently serving sandbox data to production.
    for (const value of ["development", "staging", "prod", "SANDBOX_2"]) {
      const err = thrown(() => plaidConfig({ env: { ...ENV, PLAID_ENV: value } }), PlaidNotConfiguredError);
      assert.match(err.message, /PLAID_ENV must be one of/);
    }
  });

  test("PLAID_ENV is case-insensitive but the host is never invented", () => {
    assert.equal(plaidConfig({ env: { ...ENV, PLAID_ENV: "SANDBOX" } }).baseUrl, "https://sandbox.plaid.com");
    assert.equal(plaidConfig({ env: { ...ENV, PLAID_ENV: "production" } }).baseUrl, "https://production.plaid.com");
  });

  test("isPlaidConfigured answers the same question without throwing", () => {
    assert.equal(isPlaidConfigured({ env: {} }), false);
    assert.equal(isPlaidConfigured({ env: { ...ENV, PLAID_ENV: "development" } }), false);
    assert.equal(isPlaidConfigured({ env: ENV }), true);
  });

  test("the refusal names variables and never quotes their values", () => {
    const err = thrown(() => plaidConfig({ env: { PLAID_CLIENT_ID: ENV.PLAID_CLIENT_ID, PLAID_ENV: "sandbox" } }));
    assert.ok(!err.message.includes(ENV.PLAID_CLIENT_ID), "variables are named, never valued");
  });

  test("a bad PLAID_TIMEOUT_MS falls back to the default rather than disabling the timeout", () => {
    assert.equal(plaidConfig({ env: { ...ENV, PLAID_TIMEOUT_MS: "banana" } }).timeoutMs, 10_000);
    assert.equal(plaidConfig({ env: { ...ENV, PLAID_TIMEOUT_MS: "0" } }).timeoutMs, 10_000);
    assert.equal(plaidConfig({ env: { ...ENV, PLAID_TIMEOUT_MS: "-5" } }).timeoutMs, 10_000);
    assert.equal(plaidConfig({ env: { ...ENV, PLAID_TIMEOUT_MS: "2500" } }).timeoutMs, 2500);
  });
});

describe("unconfigured refuses BEFORE the network is touched", () => {
  test("exchangePublicToken makes no request when config is absent", async () => {
    const fetchImpl = exploding();
    await rejected(() => exchangePublicToken(PUBLIC_TOKEN, { env: {}, fetchImpl }), PlaidNotConfiguredError);
    // The assertion that actually catches the regression: not "it threw", but
    // "it never dialled". A call that fires and then throws still fired.
    assert.equal(fetchImpl.calls.length, 0);
  });

  test("fetchAccounts makes no request when config is absent", async () => {
    const fetchImpl = exploding();
    await rejected(() => fetchAccounts(ACCESS_TOKEN, { env: {}, fetchImpl }), PlaidNotConfiguredError);
    assert.equal(fetchImpl.calls.length, 0);
  });

  test("a bad PLAID_ENV makes no request either", async () => {
    const fetchImpl = exploding();
    await rejected(
      () => fetchAccounts(ACCESS_TOKEN, { env: { ...ENV, PLAID_ENV: "development" }, fetchImpl }),
      PlaidNotConfiguredError
    );
    assert.equal(fetchImpl.calls.length, 0);
  });

  test("a partially-configured deploy — client id but no secret — still makes no request", async () => {
    const fetchImpl = exploding();
    await rejected(
      () => exchangePublicToken(PUBLIC_TOKEN, { env: { PLAID_CLIENT_ID: "abc", PLAID_ENV: "sandbox" }, fetchImpl }),
      PlaidNotConfiguredError
    );
    assert.equal(fetchImpl.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// The token exchange
// ---------------------------------------------------------------------------

describe("exchangePublicToken", () => {
  test("posts the public token to the right host and path, with credentials in headers", async () => {
    const fetchImpl = spy(() =>
      jsonResponse(200, { access_token: ACCESS_TOKEN, item_id: "item-abc", request_id: "req-1" })
    );
    const out = await exchangePublicToken(PUBLIC_TOKEN, { env: ENV, fetchImpl });

    assert.equal(fetchImpl.calls.length, 1);
    const { url, init } = fetchImpl.calls[0];
    assert.equal(url, "https://sandbox.plaid.com/item/public_token/exchange");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["plaid-client-id"], ENV.PLAID_CLIENT_ID);
    assert.equal(init.headers["plaid-secret"], ENV.PLAID_SECRET);
    assert.deepEqual(JSON.parse(init.body), { public_token: PUBLIC_TOKEN });

    assert.deepEqual(out, { accessToken: ACCESS_TOKEN, itemId: "item-abc", requestId: "req-1" });
  });

  test("production config talks to the production host", async () => {
    const fetchImpl = spy(() => jsonResponse(200, { access_token: ACCESS_TOKEN, item_id: "i" }));
    await exchangePublicToken(PUBLIC_TOKEN, { env: { ...ENV, PLAID_ENV: "production" }, fetchImpl });
    assert.match(fetchImpl.calls[0].url, /^https:\/\/production\.plaid\.com\//);
  });

  test("an empty public token is refused locally, without a round trip", async () => {
    const fetchImpl = exploding();
    await rejected(() => exchangePublicToken("", { env: ENV, fetchImpl }), PlaidApiError);
    assert.equal(fetchImpl.calls.length, 0);
  });

  test("a response missing access_token is an error, not a half-built item", async () => {
    const fetchImpl = spy(() => jsonResponse(200, { item_id: "item-abc", request_id: "req-2" }));
    const err = await rejected(() => exchangePublicToken(PUBLIC_TOKEN, { env: ENV, fetchImpl }), PlaidApiError);
    assert.equal(err.requestId, "req-2");
  });

  test("a response missing item_id is an error too", async () => {
    const fetchImpl = spy(() => jsonResponse(200, { access_token: ACCESS_TOKEN }));
    await rejected(() => exchangePublicToken(PUBLIC_TOKEN, { env: ENV, fetchImpl }), PlaidApiError);
  });
});

// ---------------------------------------------------------------------------
// Secrets never reach a message
// ---------------------------------------------------------------------------

describe("no credential ever reaches an error message", () => {
  test("scrub replaces every secret it is given", () => {
    assert.equal(scrub(`token=${ACCESS_TOKEN} ok`, ACCESS_TOKEN), "token=[redacted] ok");
    assert.equal(scrub("nothing to do", ACCESS_TOKEN), "nothing to do");
    assert.equal(scrub(null, ACCESS_TOKEN), "");
  });

  test("a Plaid error that echoes the secret back is scrubbed before it becomes a message", async () => {
    // Providers do echo request material into error text. This is the case that
    // would otherwise put a bank credential into last_error_message, a log line
    // and an API response in one step.
    const fetchImpl = spy(() =>
      jsonResponse(400, {
        error_code: "INVALID_API_KEYS",
        error_type: "INVALID_INPUT",
        error_message: `bad secret ${ENV.PLAID_SECRET} for client ${ENV.PLAID_CLIENT_ID}`,
        request_id: "req-3"
      })
    );
    const err = await rejected(() => exchangePublicToken(PUBLIC_TOKEN, { env: ENV, fetchImpl }), PlaidApiError);
    assert.ok(!err.message.includes(ENV.PLAID_SECRET), "PLAID_SECRET leaked into an error message");
    assert.ok(!err.message.includes(ENV.PLAID_CLIENT_ID), "PLAID_CLIENT_ID leaked into an error message");
    assert.match(err.message, /INVALID_API_KEYS/, "Plaid's own code survives");
    assert.equal(err.errorCode, "INVALID_API_KEYS");
    assert.equal(err.errorType, "INVALID_INPUT");
    assert.equal(err.requestId, "req-3");
    assert.equal(err.retryable, false, "a 400 is a refusal; retrying repeats it");
  });

  test("an error echoing the ACCESS TOKEN is scrubbed", async () => {
    const fetchImpl = spy(() =>
      jsonResponse(400, { error_code: "ITEM_LOGIN_REQUIRED", error_message: `item ${ACCESS_TOKEN} needs re-auth` })
    );
    const err = await rejected(() => fetchAccounts(ACCESS_TOKEN, { env: ENV, fetchImpl }), PlaidApiError);
    assert.ok(!err.message.includes(ACCESS_TOKEN), "the access token leaked into an error message");
    assert.match(err.message, /ITEM_LOGIN_REQUIRED/);
  });

  test("a network failure whose message quotes the request is scrubbed", async () => {
    const fetchImpl = spy(() => {
      throw new Error(`socket hang up while sending access_token=${ACCESS_TOKEN}`);
    });
    const err = await rejected(() => fetchAccounts(ACCESS_TOKEN, { env: ENV, fetchImpl }), PlaidApiError);
    assert.ok(!err.message.includes(ACCESS_TOKEN));
    assert.equal(err.status, 504);
    assert.equal(err.retryable, true, "unreachable is worth another go");
  });

  test("a 500 and a 429 are retryable; a 400 and a 401 are not", async () => {
    for (const [status, retryable] of [[500, true], [429, true], [400, false], [401, false]]) {
      const fetchImpl = spy(() => jsonResponse(status, { error_code: "X", error_message: "no" }));
      const err = await rejected(() => fetchAccounts(ACCESS_TOKEN, { env: ENV, fetchImpl }), PlaidApiError);
      assert.equal(err.retryable, retryable, `status ${status}`);
      assert.equal(err.status, status);
    }
  });

  test("a non-JSON body is an error rather than a silently empty account list", async () => {
    const fetchImpl = spy(() => ({ ok: true, status: 200, text: async () => "<html>maintenance</html>" }));
    await rejected(() => fetchAccounts(ACCESS_TOKEN, { env: ENV, fetchImpl }), PlaidApiError);
  });

  test("a timeout aborts and reports the budget, not the token", async () => {
    const fetchImpl = spy(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        })
    );
    const err = await rejected(
      () => fetchAccounts(ACCESS_TOKEN, { env: { ...ENV, PLAID_TIMEOUT_MS: "20" }, fetchImpl }),
      PlaidApiError
    );
    assert.match(err.message, /did not answer within 20ms/);
    assert.ok(!err.message.includes(ACCESS_TOKEN));
  });
});

// ---------------------------------------------------------------------------
// Accounts and balances
// ---------------------------------------------------------------------------

const ACCOUNT_FIXTURE = {
  account_id: "acc-1",
  mask: "4021",
  name: "Everyday Checking",
  official_name: "Chase Total Checking",
  type: "depository",
  subtype: "checking",
  balances: {
    current: 1234.56,
    available: 1200.0,
    iso_currency_code: "USD",
    unofficial_currency_code: null,
    last_updated_datetime: "2026-07-30T12:00:00Z"
  }
};

describe("fetchAccounts", () => {
  test("calls the balance endpoint, which forces a live refresh at the institution", async () => {
    const fetchImpl = spy(() => jsonResponse(200, { accounts: [ACCOUNT_FIXTURE], item: {}, request_id: "req-9" }));
    const out = await fetchAccounts(ACCESS_TOKEN, { env: ENV, fetchImpl });

    assert.equal(fetchImpl.calls[0].url, "https://sandbox.plaid.com/accounts/balance/get");
    assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), { access_token: ACCESS_TOKEN });
    assert.equal(out.requestId, "req-9");
    assert.equal(out.accounts.length, 1);
  });

  test("dollars become integer cents", async () => {
    const fetchImpl = spy(() => jsonResponse(200, { accounts: [ACCOUNT_FIXTURE] }));
    const { accounts } = await fetchAccounts(ACCESS_TOKEN, { env: ENV, fetchImpl });
    assert.equal(accounts[0].current_balance_cents, 123456);
    assert.equal(accounts[0].available_balance_cents, 120000);
    assert.ok(Number.isInteger(accounts[0].current_balance_cents));
  });

  test("an empty accounts array is an empty list, not an error", async () => {
    const fetchImpl = spy(() => jsonResponse(200, { accounts: [] }));
    const { accounts } = await fetchAccounts(ACCESS_TOKEN, { env: ENV, fetchImpl });
    assert.deepEqual(accounts, []);
  });

  test("item metadata comes back, including a consent expiry that may be absent", async () => {
    const fetchImpl = spy(() =>
      jsonResponse(200, {
        accounts: [],
        item: { item_id: "item-1", institution_id: "ins_3", consent_expiration_time: "2026-12-01T00:00:00Z" }
      })
    );
    const { item } = await fetchAccounts(ACCESS_TOKEN, { env: ENV, fetchImpl });
    assert.equal(item.itemId, "item-1");
    assert.equal(item.institutionId, "ins_3");
    assert.equal(item.consentExpiresAt, "2026-12-01T00:00:00Z");
    assert.equal(item.error, null);
  });
});

describe("a missing balance stays missing", () => {
  test("available: null becomes null, NOT zero", () => {
    const acc = normalizeAccount({ ...ACCOUNT_FIXTURE, balances: { current: 500, available: null } });
    assert.equal(acc.available_balance_cents, null);
    assert.notEqual(acc.available_balance_cents, 0, "unknown is not empty — this decides whether someone gets funded");
    assert.equal(acc.current_balance_cents, 50000);
  });

  test("an absent balances object leaves every money field null", () => {
    const acc = normalizeAccount({ account_id: "a" });
    assert.equal(acc.current_balance_cents, null);
    assert.equal(acc.available_balance_cents, null);
    assert.equal(acc.iso_currency_code, null);
    assert.equal(acc.balance_as_of, null);
  });

  test("a real zero balance is preserved as zero", () => {
    const acc = normalizeAccount({ account_id: "a", balances: { current: 0, available: 0 } });
    assert.equal(acc.current_balance_cents, 0);
    assert.equal(acc.available_balance_cents, 0);
  });

  test("a negative balance survives — overdrafts and credit cards are ordinary", () => {
    const acc = normalizeAccount({ account_id: "a", balances: { current: -240.15 } });
    assert.equal(acc.current_balance_cents, -24015);
  });

  test("centsOrNull, directly", () => {
    assert.equal(centsOrNull(null), null);
    assert.equal(centsOrNull(undefined), null);
    assert.equal(centsOrNull(0), 0);
    assert.equal(centsOrNull(1234.56), 123456);
    assert.equal(centsOrNull(-0.01), -1);
    // Present but unreadable is a provider change or a mapping bug. It must stop
    // the sync, not disappear into a column that reads as "unknown" forever.
    thrown(() => centsOrNull("1234.56"), PlaidApiError);
    thrown(() => centsOrNull(NaN), PlaidApiError);
    thrown(() => centsOrNull({}), PlaidApiError);
  });
});

describe("nothing is invented", () => {
  test("absent optional fields stay null instead of being derived from a sibling", () => {
    const acc = normalizeAccount({ account_id: "a", name: "Checking", balances: {} });
    assert.equal(acc.name, "Checking");
    assert.equal(acc.official_name, null, "official_name must not be copied from name");
    assert.equal(acc.mask, null);
    assert.equal(acc.type, null);
    assert.equal(acc.subtype, null);
  });

  test("currency is not defaulted to USD", () => {
    const acc = normalizeAccount({ account_id: "a", balances: { current: 10 } });
    assert.equal(acc.iso_currency_code, null);
    assert.equal(acc.unofficial_currency_code, null);
  });

  test("an unofficial currency is carried across rather than collapsed", () => {
    const acc = normalizeAccount({
      account_id: "a",
      balances: { current: 10, iso_currency_code: null, unofficial_currency_code: "BTC" }
    });
    assert.equal(acc.iso_currency_code, null);
    assert.equal(acc.unofficial_currency_code, "BTC");
  });

  test("the adapter NEVER decides whether an account is personal or business", () => {
    // 082's entity_kind defaults to 'unknown' in the database and only a named
    // human moves it. Plaid does not know whose money it is, and a heuristic
    // here — matching "business" in official_name, say — is exactly how a
    // client's personal savings ends up filed under their company.
    const business = normalizeAccount({
      account_id: "a",
      name: "Business Complete Checking",
      official_name: "Chase Business Complete Banking",
      type: "depository",
      subtype: "checking",
      balances: { current: 100 }
    });
    assert.ok(!Object.keys(business).includes("entity_kind"));
    assert.ok(!Object.keys(business).includes("business_id"));
  });

  test("the raw account object is kept verbatim so a mapping dispute can be settled", () => {
    const acc = normalizeAccount(ACCOUNT_FIXTURE);
    assert.deepEqual(acc.raw, ACCOUNT_FIXTURE);
  });

  test("normalizeItem on junk returns nulls rather than throwing", () => {
    assert.deepEqual(normalizeItem(null), { itemId: null, institutionId: null, consentExpiresAt: null, error: null });
    assert.equal(normalizeItem({}).consentExpiresAt, null, "an absent expiry is null, never 'never expires'");
  });

  test("an item error is carried across in Plaid's own vocabulary", () => {
    const item = normalizeItem({
      item_id: "i",
      error: { error_code: "ITEM_LOGIN_REQUIRED", error_type: "ITEM_ERROR", error_message: "the user must re-auth" }
    });
    assert.equal(item.error.errorCode, "ITEM_LOGIN_REQUIRED");
    assert.equal(item.error.errorType, "ITEM_ERROR");
    assert.equal(item.error.errorMessage, "the user must re-auth");
  });
});

// ---------------------------------------------------------------------------
// The fence
// ---------------------------------------------------------------------------

describe("the outbound surface is two operations and no more", () => {
  test("the module exports no generic request helper", async () => {
    const mod = await import("./plaid.mjs");
    const exported = Object.keys(mod).sort();
    // An exported escape hatch is how a second caller ends up making a Plaid
    // request that skips the scrubbing and the config gate. If this assertion
    // fails because an export was ADDED, the question to answer is whether the
    // new thing belongs behind this fence or should not exist.
    assert.ok(!exported.includes("callPlaid"));
    assert.deepEqual(exported, [
      "PlaidApiError",
      "PlaidNotConfiguredError",
      "centsOrNull",
      "exchangePublicToken",
      "fetchAccounts",
      "isPlaidConfigured",
      "normalizeAccount",
      "normalizeItem",
      "plaidConfig",
      "scrub"
    ]);
  });
});
