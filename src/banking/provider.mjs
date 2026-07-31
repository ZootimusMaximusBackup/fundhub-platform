// THE BANKING PROVIDER SEAM. Every caller that wants bank data imports THIS
// file, never plaid.mjs and never mock.mjs.
//
// *** THE ONE RULE. ***
//
// Going live must be an ENV CHANGE, not a code change. If closing this seam
// against a real bank required editing a call site, the seam would be in the
// wrong place. So call sites see one module with one shape, and which
// implementation answers is decided here, from the environment, at call time.
//
// TO SWITCH FROM MOCK TO PLAID, IN FULL:
//
//     netlify env:set BANKING_PROVIDER "plaid" --context production
//     netlify env:set PLAID_CLIENT_ID "..." --secret
//     netlify env:set PLAID_SECRET    "..." --secret
//     netlify env:set PLAID_TOKEN_ENC_KEY "<32 bytes base64>" --secret
//
// Zero lines of application code change. Nothing imports mock.mjs except this
// file, so the mock does not need deleting either.
//
// BUT READ THIS BEFORE BELIEVING THE FLIP IS ENOUGH. plaid.mjs's linkAccount()
// and getAccounts() are DELIBERATELY EMPTY SEAMS that return
// reason:"not_implemented" even when fully configured — see that file's header.
// Flipping BANKING_PROVIDER to "plaid" switches which module answers; it does
// NOT conjure a Plaid client into existence. Closing that seam is gated on a SOC
// 2 review, a compliance-approved consent flow and a human decision, and an agent
// must not do it. The honest statement is: this seam costs nothing to switch, and
// the thing it switches to is still unbuilt on purpose.
//
//
// *** FAIL CLOSED ON A VALUE WE DO NOT RECOGNISE. ***
//
// Unset means "mock". A value we know means that provider. A value we do NOT
// know — "Plaid", "plad", "production" — means REFUSE, and specifically it does
// not mean fall back to the mock.
//
// The reasoning is plaidConfigFromEnv()'s, verbatim: the two plausible readings
// of a typo are "the safest one" and "the one they meant", and they are
// opposites. Someone who typed BANKING_PROVIDER=Plaid meant to hit a real bank.
// Silently serving them invented mock balances instead would put fabricated
// numbers on a screen that says "your accounts", and every downstream check would
// pass. Refusing is loud, and loud is recoverable.
//
// This is the same failure AUDIT-FINDINGS records for the Mailgun webhook, where
// one adapter read a missing key as "no check needed" while five siblings failed
// closed. Absent or unrecognised config must never mean "proceed".

import * as plaid from "./plaid.mjs";
import * as mock from "./mock.mjs";

export const BANKING_PROVIDERS = ["mock", "plaid"];
export const DEFAULT_BANKING_PROVIDER = "mock";

/** Refusal reasons, extending plaid.mjs's set rather than inventing a parallel
 *  vocabulary — a caller already branches on SEAM_REASONS and should not have to
 *  learn a second one because the answer came from the selector. */
export const PROVIDER_REASONS = {
  ...plaid.SEAM_REASONS,
  UNKNOWN_PROVIDER: "unknown_provider"
};

const IMPLEMENTATIONS = { mock, plaid };

/**
 * bankingProviderFromEnv(env) → { name, ready, missing[], problems[] }
 *
 * Same shape and same contract as plaidConfigFromEnv(): callers branch on
 * `ready`, nothing throws, and NO SECRET VALUE IS EVER RETURNED — `missing` and
 * `problems` carry env var NAMES only, so this object is safe to log.
 *
 * `name` is null when the configured value is not one we recognise. It is never
 * silently corrected to the default.
 */
export function bankingProviderFromEnv(env = process.env) {
  const raw = env.BANKING_PROVIDER ? String(env.BANKING_PROVIDER).trim() : DEFAULT_BANKING_PROVIDER;

  if (!BANKING_PROVIDERS.includes(raw)) {
    return {
      name: null,
      ready: false,
      missing: [],
      problems: [`BANKING_PROVIDER must be one of ${BANKING_PROVIDERS.join(", ")}`]
    };
  }

  // The mock needs no credentials, and saying it does would be a lie that sends
  // someone hunting for env vars that do not exist. It is ready by construction.
  if (raw === "mock") {
    return { name: "mock", ready: true, missing: [], problems: [] };
  }

  // Plaid answers for itself. Delegating rather than re-deriving means the
  // key-length check and the PLAID_ENV whitelist live in exactly one place.
  const cfg = plaid.plaidConfigFromEnv(env);
  return { name: "plaid", ready: cfg.ready, missing: cfg.missing, problems: cfg.problems };
}

/**
 * bankingProviderName(env) → "mock" | "plaid" | null
 *
 * For screens and logs that want to print which source a number came from. A
 * dashboard showing mock balances MUST say so; a screen that cannot tell the
 * difference is how invented data gets treated as real.
 */
export function bankingProviderName(env = process.env) {
  return bankingProviderFromEnv(env).name;
}

/** isBankingEnabled(env) → boolean. "Is a usable provider selected and
 *  configured?" Mirrors isPlaidEnabled() exactly, including never throwing. */
export function isBankingEnabled(env = process.env) {
  return bankingProviderFromEnv(env).ready === true;
}

/* -------------------------------------------------------------------------- *
 * The dispatched surface. Identical signatures and identical return shapes to
 * plaid.mjs — that identity is the whole point and a test asserts it.
 * -------------------------------------------------------------------------- */

function refuseUnknown(extraKey) {
  return {
    ok: false,
    reason: PROVIDER_REASONS.UNKNOWN_PROVIDER,
    [extraKey]: null,
    // Names only, never values.
    missing: [`BANKING_PROVIDER must be one of ${BANKING_PROVIDERS.join(", ")}`]
  };
}

/**
 * linkAccount({ clientId, publicToken, env }) → { ok, reason, item, clientId, missing[] }
 *
 * `item` is null on every refusal, never an empty object — a caller must not be
 * able to mistake a refusal for a link that produced nothing. plaid.mjs makes the
 * same promise in its own header and this seam does not weaken it.
 */
export async function linkAccount({ clientId = null, publicToken = null, env = process.env } = {}) {
  const sel = bankingProviderFromEnv(env);
  if (!sel.name) return { ...refuseUnknown("item"), clientId };
  return IMPLEMENTATIONS[sel.name].linkAccount({ clientId, publicToken, env });
}

/**
 * getAccounts({ itemId, env }) → { ok, reason, accounts, itemId, missing[] }
 *
 * `accounts` is null on refusal, NOT []. This is the important line in the file,
 * inherited word for word from plaid.mjs: [] means "this client has no bank
 * accounts", which is a finding a funding decision would act on, and null means
 * "we did not ask". Unknown must survive.
 */
export async function getAccounts({ itemId = null, env = process.env } = {}) {
  const sel = bankingProviderFromEnv(env);
  if (!sel.name) return { ...refuseUnknown("accounts"), itemId };
  return IMPLEMENTATIONS[sel.name].getAccounts({ itemId, env });
}

export default {
  BANKING_PROVIDERS,
  DEFAULT_BANKING_PROVIDER,
  PROVIDER_REASONS,
  bankingProviderFromEnv,
  bankingProviderName,
  isBankingEnabled,
  linkAccount,
  getAccounts
};
