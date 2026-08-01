// A stand-in bank provider. NOT A BANK. NOT REAL MONEY.
//
// WHY THIS EXISTS. src/banking/plaid.mjs's getAccounts() is a deliberately
// unclosed seam: reading a real person's accounts needs a SOC 2 review of
// storing bank credentials, a compliance-signed consent flow, and a human
// decision — and "an agent must not close this seam". None of that blocks
// BUILDING the half of the system that stores accounts, and until something can
// hand that half a list, four sections of the Money Map are permanently empty
// and cannot be exercised at all.
//
// So this provider answers the same question with made-up data, in exactly the
// shape the real one will. When Plaid is turned on, the provider swaps and
// nothing downstream changes.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THE ONLY THING THAT MAKES THIS SAFE: THE ROWS ARE MARKED, IN THE DATABASE
// ═══════════════════════════════════════════════════════════════════════════
// Migration 091 adds bank_accounts.provider, and everything written through this
// module carries `provider = 'mock'`. That marker is not decoration:
//
//   * it is a NOT NULL column with a CHECK, so a row cannot lose it;
//   * uq_bank_accounts_provider_ref keys on it, so a mock and a real account can
//     never collide into one row;
//   * api/read/money-map.mjs returns it and the screen prints a warning when any
//     account carries it.
//
// Without that marker this file would be the single most dangerous thing in the
// repository: invented balances, on a funding screen, indistinguishable from a
// bank read. With it, a made-up number is a made-up number that says so
// everywhere it appears.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT IT DELIBERATELY DOES NOT DO
// ═══════════════════════════════════════════════════════════════════════════
// * NO CLOCK AND NO RANDOMNESS. `asOf` is a parameter and the figures are fixed.
//   A provider whose answer changes between two calls cannot be tested, and a
//   screen showing a balance that drifts on refresh is worse than one showing
//   nothing.
// * IT DOES NOT SET entity_kind. Neither does the real one — accounts arriving
//   from a bank carry no ownership this product can trust. The store refuses to
//   accept one at all.
// * IT INCLUDES A CREDIT LINE AND AN ACCOUNT WITH AN UNKNOWN BALANCE, on
//   purpose. A fixture where everything is a tidy chequing account with a known
//   balance would exercise none of the rules that matter — that a credit line's
//   "available" is headroom and not cash, and that one unknown balance refuses
//   the whole cash-flow projection rather than understating it. The mock is
//   there to prove the screen tells the truth, not to make it look full.

/** The reason strings a caller branches on. Same vocabulary as the Plaid seam,
    so a caller written against one works against the other. */
export const MOCK_REASONS = Object.freeze({
  NOT_ENABLED: "mock_provider_not_enabled"
});

export const PROVIDER_NAME = "mock";

/* The fixture. Fixed values, written out rather than generated, so the numbers
   in a test are the numbers on the screen. Amounts are INTEGER CENTS. */
const FIXTURE = Object.freeze([
  {
    providerAccountId: "mock-checking-1",
    name: "Everyday Checking",
    officialName: "Mock Bank Everyday Checking",
    mask: "1234",
    accountType: "depository",
    accountSubtype: "checking",
    currencyCode: "USD",
    availableBalanceCents: 412_37,
    currentBalanceCents: 486_12,
    creditLimitCents: null
  },
  {
    providerAccountId: "mock-savings-1",
    name: "Savings",
    officialName: "Mock Bank Savings",
    mask: "5678",
    accountType: "depository",
    accountSubtype: "savings",
    currencyCode: "USD",
    availableBalanceCents: 3_150_00,
    currentBalanceCents: 3_150_00,
    creditLimitCents: null
  },
  {
    /* A CREDIT LINE. Its "available" is HEADROOM, not cash, and the Money Map
       must leave it out of the cash total. If a change ever folds this $9,000
       into the client's money, the screen is wrong and this row is what shows
       it. The current balance is NEGATIVE — money owed. */
    providerAccountId: "mock-card-1",
    name: "Mock Rewards Card",
    officialName: "Mock Bank Rewards Visa",
    mask: "9012",
    accountType: "credit",
    accountSubtype: "credit card",
    currencyCode: "USD",
    availableBalanceCents: 9_000_00,
    currentBalanceCents: -1_000_00,
    creditLimitCents: 10_000_00
  },
  {
    /* AN ACCOUNT THE BANK REPORTED WITHOUT A BALANCE. This is the row that
       proves the honesty rule: one unknown balance must refuse the whole
       cash-flow projection with a stated reason, rather than quietly summing the
       accounts we DO know and presenting a confident number that is too low. */
    providerAccountId: "mock-checking-2",
    name: "Second Checking",
    officialName: null,
    mask: "3456",
    accountType: "depository",
    accountSubtype: "checking",
    currencyCode: "USD",
    availableBalanceCents: null,
    currentBalanceCents: null,
    creditLimitCents: null
  }
]);

/**
 * isMockEnabled(env) → boolean
 *
 * OFF UNLESS EXPLICITLY TURNED ON. `BANKING_MOCK_PROVIDER` must be the exact
 * string "1". Not "true", not "yes", not "any non-empty value" — a fixture that
 * can be switched on by a typo in an unrelated environment variable is a fixture
 * that will eventually be on in production.
 *
 * It never throws. A caller asking whether something is enabled should not have
 * to wrap the question in a try block — same contract as isPlaidEnabled().
 */
export function isMockEnabled(env = process.env) {
  try {
    return env?.BANKING_MOCK_PROVIDER === "1";
  } catch {
    return false;
  }
}

/**
 * getAccounts({ clientId, asOf, env }) → the Plaid seam's shape, exactly.
 *
 *   { ok, reason, accounts, provider, missing[] }
 *
 * `accounts` IS null WHEN THIS REFUSES, NOT []. This is the line plaid.mjs calls
 * the important one in its own file, and it is copied here on purpose: [] means
 * "this client has no bank accounts", which is a finding a funding decision
 * would act on. null means "we did not ask".
 *
 * `asOf` is required. There is no clock in this file, so the stamp on every
 * balance is the caller's and a test can pin it.
 */
export async function getAccounts({ clientId = null, asOf = null, env = process.env } = {}) {
  if (!isMockEnabled(env)) {
    return {
      ok: false,
      reason: MOCK_REASONS.NOT_ENABLED,
      accounts: null,
      provider: PROVIDER_NAME,
      clientId,
      // Names only, never values — the same rule plaidConfigFromEnv() follows.
      missing: ["BANKING_MOCK_PROVIDER"]
    };
  }

  if (!asOf) {
    return {
      ok: false,
      reason: "as_of_is_required",
      accounts: null,
      provider: PROVIDER_NAME,
      clientId,
      missing: []
    };
  }

  return {
    ok: true,
    reason: null,
    provider: PROVIDER_NAME,
    clientId,
    accounts: FIXTURE.map((a) => ({
      ...a,
      balanceAsOf: asOf,
      /* The unparsed record, as the real provider would carry it. Kept verbatim
         so that a disputed figure can be settled — and so that anybody reading
         a row's `raw` in the database sees the word "mock" in it without having
         to know which column to check. */
      raw: { provider: "mock", fixture: a.providerAccountId, note: "NOT REAL — generated by src/banking/providers/mock.mjs" }
    })),
    missing: []
  };
}

export default { PROVIDER_NAME, MOCK_REASONS, isMockEnabled, getAccounts };
