// Plaid — THE FIRST OUTBOUND HTTP CALL IN src/adapters/.
//
// Every other file in this directory parses something that arrived: commas,
// twilio, mailgun, calcom, bland, clickfunnels and lendflow all take a signed
// webhook body and turn it into canonical events. None of them dials out. This
// one does, and that is a different kind of code with a different set of ways to
// hurt someone, so it is fenced off in one module and the fence is the point.
//
// (For accuracy: the platform is not entirely without outbound calls —
// api/inquiry.mjs proxies an inquiry-removal service and src/adplatforms/_api.mjs
// calls Meta and TikTok. What is new here is outbound in src/adapters/, and
// outbound carrying a credential that reads a named person's bank account.)
//
// THE FENCE. Nothing outside this file may call fetch against Plaid. Two
// operations exist and no more:
//
//   exchangePublicToken()  public_token -> access_token   (POST /item/public_token/exchange)
//   fetchAccounts()        access_token -> accounts       (POST /accounts/balance/get)
//
// Transactions, liabilities, identity, income, link-token creation: none of them
// are here. Adding one means adding it HERE, where the credential handling, the
// scrubbing, the timeout and the refusal-when-unconfigured already apply, rather
// than in a second place where they would have to be remembered.
//
// PLAID LINK ONLY. There is no code path in this module that accepts a bank
// username or password, and none may be added. The client authenticates inside
// their own bank's flow and we receive an opaque token. Credential scraping and
// browser extensions are not a fallback for an institution Plaid does not cover;
// they are out of bounds permanently.
//
// ABSENT CONFIG MEANS DISABLED, NOT UNGATED. This is AUDIT-FINDINGS.md's
// recorded lesson number three — "'Absent config' must never mean 'no gate'" —
// which that document earned by finding a webhook adapter that skipped signature
// verification whenever its signing key happened to be unset, and answered 200.
// So: config is resolved BEFORE any network work, by plaidConfig(), which THROWS
// when PLAID_CLIENT_ID, PLAID_SECRET or PLAID_ENV is missing. An unconfigured
// deploy cannot reach Plaid at all — not with a default host, not against
// sandbox, not with an empty secret that Plaid would reject anyway. It refuses,
// with a 503 that says which variable is missing by NAME and never by value.
//
// PLAID_ENV IS AN ALLOW-LIST OF TWO. sandbox and production. Plaid retired the
// old `development` environment, so accepting it would mean either guessing a
// hostname that no longer resolves or silently routing a production request at
// sandbox data. Neither is a thing to do quietly, so an unrecognised PLAID_ENV
// is refused exactly like an absent one. There is no default: "which Plaid
// environment is this deploy talking to" is not a question this module should
// answer on the operator's behalf.
//
// THE ACCESS TOKEN NEVER SURVIVES CONTACT WITH A STRING. It is a standing key to
// a named human's bank account. Every error raised here runs through scrub()
// first, so a token cannot ride out inside a message that then lands in a log,
// a database column, an API response or a Sentry breadcrumb. The same applies to
// PLAID_SECRET, which travels in every request body. There is no debug flag that
// turns this off, and there is no console.* call anywhere in this file.
//
// MONEY IS INTEGER CENTS AND A MISSING BALANCE STAYS MISSING. Plaid sends
// floating-point dollars. They cross into cents here, once, via
// src/commissions/money.mjs. A balance Plaid did not send is null — never 0.
// Telling a funding advisor that a client with an unknown balance has nothing is
// wrong in the direction that denies somebody funding.

import { toCents } from "../commissions/money.mjs";

/* Hosts, exhaustively. No default branch, deliberately — see the header. */
const HOSTS = Object.freeze({
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com"
});

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Unconfigured, or configured with something we refuse to interpret.
 *
 * status 503 rather than 500, matching api/inquiry.mjs: unconfigured is a
 * deployment state, not a crash. The code is fine and there is nothing to retry
 * until an operator sets a variable. A 500 here reads as a bug and sends whoever
 * is holding the pager down the wrong path.
 */
export class PlaidNotConfiguredError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlaidNotConfiguredError";
    this.status = 503;
    this.configured = false;
  }
}

/** Plaid answered, and said no. Carries Plaid's own vocabulary, never ours. */
export class PlaidApiError extends Error {
  constructor(message, { status = 502, errorCode = null, errorType = null, requestId = null, retryable = false } = {}) {
    super(message);
    this.name = "PlaidApiError";
    this.status = status;
    this.errorCode = errorCode;
    this.errorType = errorType;
    this.requestId = requestId;
    this.retryable = retryable;
  }
}

/**
 * scrub — remove every secret from a string before it can become a message.
 *
 * Called on the way OUT of every failure path, including the ones that report a
 * network error we never inspected. A DNS failure message can contain the URL,
 * a proxy error can echo a request body, and neither is a place to discover that
 * a bank credential was quoted verbatim.
 *
 * Exported because the tests assert on it directly: "the token is not in the
 * message" is the kind of guarantee that has to be checked, not asserted in a
 * comment.
 */
export function scrub(text, ...secrets) {
  let out = String(text ?? "");
  for (const s of secrets) {
    if (typeof s !== "string" || s.length < 4) continue;
    out = out.split(s).join("[redacted]");
  }
  return out;
}

/**
 * plaidConfig — resolve config or REFUSE. Never returns a partial.
 *
 * Every variable is named in the error and none is valued. "PLAID_SECRET is not
 * set" is actionable; echoing what it was set to is an incident.
 */
export function plaidConfig({ env = process.env } = {}) {
  const clientId = str(env.PLAID_CLIENT_ID);
  const secret = str(env.PLAID_SECRET);
  const envName = str(env.PLAID_ENV).toLowerCase();

  const missing = [];
  if (!clientId) missing.push("PLAID_CLIENT_ID");
  if (!secret) missing.push("PLAID_SECRET");
  if (!envName) missing.push("PLAID_ENV");
  if (missing.length) {
    throw new PlaidNotConfiguredError(
      `Plaid is not configured — ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set. ` +
      "Bank linking is disabled until an operator sets them."
    );
  }

  const baseUrl = HOSTS[envName];
  if (!baseUrl) {
    throw new PlaidNotConfiguredError(
      `PLAID_ENV must be one of: ${Object.keys(HOSTS).join(", ")} (got "${envName}"). ` +
      "Bank linking is disabled rather than guessing which Plaid environment to call."
    );
  }

  const timeoutMs = Number(env.PLAID_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return {
    clientId,
    secret,
    envName,
    baseUrl,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
  };
}

/**
 * isPlaidConfigured — the same question, without the throw.
 *
 * For callers that need to render "bank linking is unavailable" rather than
 * handle an exception. It answers by ASKING plaidConfig, so the two can never
 * disagree about what "configured" means — a second copy of the rule is a second
 * rule, and one of them eventually gets edited alone.
 */
export function isPlaidConfigured({ env = process.env } = {}) {
  try {
    plaidConfig({ env });
    return true;
  } catch {
    return false;
  }
}

/**
 * callPlaid — the only place in this repository that talks to Plaid.
 *
 * Private. Not exported: an exported escape hatch is how a second caller ends up
 * making a Plaid request that skips the scrubbing.
 */
async function callPlaid(path, body, { env, fetchImpl } = {}) {
  // FIRST, before anything can dial out. An unconfigured deploy stops here.
  const cfg = plaidConfig({ env });

  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new PlaidNotConfiguredError("no fetch implementation available in this runtime");
  }

  // Every string that must never appear in an error, gathered once.
  const secrets = [cfg.secret, cfg.clientId, ...Object.values(body || {}).filter((v) => typeof v === "string")];

  /* A timeout, for the same reason src/db.mjs sets one: with none, a host that
     drops packets rather than refusing them hangs until the platform kills the
     function, and the caller gets a 502 with no JSON body at all. */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  let res;
  try {
    res = await doFetch(`${cfg.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Plaid accepts credentials in the body; the headers are the documented
        // form and keep them out of anything that logs a JSON payload.
        "plaid-client-id": cfg.clientId,
        "plaid-secret": cfg.secret
      },
      body: JSON.stringify({ ...body }),
      signal: controller.signal
    });
  } catch (err) {
    const aborted = err?.name === "AbortError";
    throw new PlaidApiError(
      aborted
        ? `Plaid did not answer within ${cfg.timeoutMs}ms`
        : `Plaid is unreachable: ${scrub(err?.message || String(err), ...secrets)}`,
      { status: 504, retryable: true }
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => "");
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    /* Plaid's own words survive. A policy or consent rejection reworded by us is
       a rejection the client cannot act on — "bank sync failed" is exactly that
       rewording, and it is what a support call then has to unpick. */
    const code = parsed?.error_code ?? null;
    const type = parsed?.error_type ?? null;
    const requestId = parsed?.request_id ?? null;
    const said = parsed?.error_message || parsed?.display_message || text || `HTTP ${res.status}`;
    throw new PlaidApiError(scrub(`Plaid ${res.status} ${code || ""}: ${said}`.trim(), ...secrets), {
      status: res.status,
      errorCode: code,
      errorType: type,
      requestId,
      // 429 and 5xx are worth another go. A 400 is a real refusal and retrying
      // it just repeats the same refusal.
      retryable: res.status === 429 || res.status >= 500
    });
  }

  if (parsed === null) {
    throw new PlaidApiError("Plaid returned a body that is not JSON", { status: 502, retryable: true });
  }
  return parsed;
}

/**
 * exchangePublicToken — trade the short-lived public_token the client's Link
 * session produced for the standing access_token.
 *
 * THIS IS THE MOMENT A CREDENTIAL COMES INTO EXISTENCE. The return value is the
 * only time the plaintext token is ever in memory; the caller's job is to hand
 * it straight to src/banking/index.mjs, which encrypts it before it touches a
 * column. It must not be logged, echoed, returned from an endpoint, or written
 * anywhere but the ciphertext column in 080_plaid_items.sql.
 */
export async function exchangePublicToken(publicToken, { env, fetchImpl } = {}) {
  const token = str(publicToken);
  if (!token) {
    // Refuse locally rather than spending a round trip to be told the same
    // thing, and — more importantly — so the failure cannot be confused with a
    // Plaid outage.
    throw new PlaidApiError("public_token is required", { status: 400 });
  }

  const out = await callPlaid("/item/public_token/exchange", { public_token: token }, { env, fetchImpl });

  const accessToken = str(out.access_token);
  const itemId = str(out.item_id);
  if (!accessToken || !itemId) {
    throw new PlaidApiError("Plaid's exchange response was missing access_token or item_id", {
      status: 502,
      requestId: out.request_id ?? null
    });
  }
  return { accessToken, itemId, requestId: out.request_id ?? null };
}

/**
 * fetchAccounts — the accounts under one Item, with balances.
 *
 * /accounts/balance/get rather than /accounts/get: the former forces a live
 * refresh at the institution, the latter can serve a cached figure. A balance
 * used to decide funding should be the bank's answer today, not last week's.
 */
export async function fetchAccounts(accessToken, { env, fetchImpl } = {}) {
  const token = str(accessToken);
  if (!token) throw new PlaidApiError("access_token is required", { status: 400 });

  const out = await callPlaid("/accounts/balance/get", { access_token: token }, { env, fetchImpl });

  const accounts = Array.isArray(out.accounts) ? out.accounts : [];
  return {
    accounts: accounts.map(normalizeAccount),
    item: normalizeItem(out.item),
    requestId: out.request_id ?? null
  };
}

/**
 * normalizeAccount — Plaid's account object, in this platform's vocabulary.
 *
 * NOTHING IS INVENTED HERE. Every field maps to something Plaid actually sent;
 * anything it did not send is null and stays null. There is no name derived
 * from another name, no currency defaulted to USD, no balance defaulted to zero,
 * and no guess at whether the account is personal or business — that last one is
 * 082's entity_kind, it defaults to 'unknown', and this function must never set
 * it. Plaid does not know whose money it is, so neither does this code.
 */
export function normalizeAccount(a = {}) {
  const balances = a.balances || {};
  return {
    account_id: str(a.account_id) || null,
    mask: str(a.mask) || null,
    name: str(a.name) || null,
    official_name: str(a.official_name) || null,
    type: str(a.type) || null,
    subtype: str(a.subtype) || null,

    current_balance_cents: centsOrNull(balances.current),
    available_balance_cents: centsOrNull(balances.available),

    // Exactly one of these is non-null on a well-formed Plaid account. Both are
    // carried across rather than collapsed — see 081_bank_accounts.sql.
    iso_currency_code: str(balances.iso_currency_code) || null,
    unofficial_currency_code: str(balances.unofficial_currency_code) || null,

    // When the balance was true, per the institution. Frequently absent, and an
    // absent one must not become now(): that would assert the figure is current
    // when nobody said so.
    balance_as_of: str(balances.last_updated_datetime) || null,

    raw: a
  };
}

/** normalizeItem — the item metadata that rides along with a balance call. */
export function normalizeItem(item = {}) {
  if (!item || typeof item !== "object") return { itemId: null, institutionId: null, consentExpiresAt: null, error: null };
  return {
    itemId: str(item.item_id) || null,
    institutionId: str(item.institution_id) || null,
    // NULL means Plaid did not give us one. It does not mean "never expires".
    consentExpiresAt: str(item.consent_expiration_time) || null,
    error: item.error
      ? {
          errorCode: str(item.error.error_code) || null,
          errorType: str(item.error.error_type) || null,
          // Plaid's message. Never contains a token — the credential travels in
          // the request, not the reply — but it is scrubbed on the way into a
          // database column by the caller regardless.
          errorMessage: str(item.error.error_message) || null
        }
      : null
  };
}

/**
 * centsOrNull — dollars to integer cents, with "unknown" preserved.
 *
 * WHY NOT toCents() DIRECTLY. toCents(null) returns 0, and that is correct for
 * its own callers — "no payments yet" is a legitimate zero base. It is exactly
 * wrong here. Plaid returns `available: null` constantly, and a null that
 * becomes 0 tells a funding advisor a client has no money when the truth is that
 * nobody knows. So null and undefined are preserved as null, and everything else
 * goes through the shared money module.
 *
 * A value that is present but not a number THROWS rather than quietly becoming
 * null. "Plaid sent something we cannot read" is a provider change or a mapping
 * bug, and it should stop the sync and write an error into the audit trail —
 * not disappear into a column that reads as "unknown" forever.
 */
export function centsOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PlaidApiError(`Plaid returned a balance that is not a number: ${JSON.stringify(value)}`, { status: 502 });
  }
  return toCents(value);
}

function str(v) {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}
