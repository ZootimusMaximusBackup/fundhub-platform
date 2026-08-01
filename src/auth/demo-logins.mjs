// The switch that turns the nine seeded demo logins on, and off.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ FAILS CLOSED. DEMO_LOGINS_ENABLED unset means DISABLED, every time. Not   │
// │ "no gate needed", not "probably a dev box" — disabled.                    │
// │                                                                           │
// │ This is the same discipline as isPlaidEnabled() in src/banking/plaid.mjs, │
// │ and it is written against the same recorded failure: AUDIT-FINDINGS.md    │
// │ records `POST /api/webhooks/mailgun accepts unsigned requests ... when    │
// │ MAILGUN_SIGNING_KEY is unset` — one adapter read a missing key as "no     │
// │ check required" while five siblings failed closed, and an unauthenticated │
// │ caller could drive a client's funding state. Absent config must never     │
// │ mean no gate.                                                             │
// │                                                                           │
// │ What it costs the owner today: one env var. What it buys: these accounts  │
// │ cannot quietly become live logins on a system holding real consumer-      │
// │ finance customers. A demo password is printed on the login page. If the   │
// │ flag is not set in production, that printed password opens nothing.       │
// └───────────────────────────────────────────────────────────────────────────┘
//
// THIS IS NOT A BYPASS AND ADDS NO NEW AUTH PATH. Demo rows are ordinary rows.
// They hold a real scrypt verifier written by src/auth/hash.mjs:hashPassword and
// they are checked by the same verifyPassword() as everybody else. This module
// only ever REMOVES access — it can refuse a login that would otherwise have
// succeeded, and it can never grant one that would otherwise have failed. Read
// the call sites and confirm that: src/auth/login.mjs and
// src/auth/account-session.mjs both consult it AFTER the password has already
// verified, never instead of verifying.
//
// REAL ACCOUNTS ARE UNTOUCHED EITHER WAY. Nothing here looks at a row that is
// not flagged is_demo (or addressed on the demo domain), so chris@fundhub.ai
// signs in identically with the flag set, unset, or set to nonsense.

import { DEMO_EMAIL_DOMAIN } from "./demo-roster.mjs";

export { DEMO_EMAIL_DOMAIN };

/** The one env var. Named in full here so a grep for the string finds the gate
 *  before it finds a call site. */
export const DEMO_ENV_VAR = "DEMO_LOGINS_ENABLED";

// The only values that mean yes. An unrecognised value is a misconfiguration,
// and the safe reading of a misconfiguration is off — same call
// PLAID_ENVIRONMENTS makes about an unknown environment name. Deliberately
// strict: "false", "0", "no", "off", "" and "maybe" all mean disabled, so a
// typo cannot turn nine published-password accounts on.
const TRUTHY = new Set(["1", "true", "yes", "on", "enabled"]);

/**
 * demoLoginsEnabled(env) → boolean.
 *
 * Never throws, never logs, and never reports the value of anything other than
 * this flag — it is safe to call on every login attempt.
 */
export function demoLoginsEnabled(env = process.env) {
  const raw = env && env[DEMO_ENV_VAR];
  if (typeof raw !== "string") return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * isDemoEmail(email) → boolean. Address-shaped half of the check.
 *
 * Belt to the is_demo column's braces. The column is the authority (it survives
 * somebody changing an address); this catches a demo-domain row created by hand
 * that nobody remembered to flag. Either one being true is enough to require
 * the switch, because the failure being prevented — a demo login working in
 * production — is far more expensive than a real account on a .local address
 * being refused, which cannot happen: nothing legitimate uses that domain.
 */
export function isDemoEmail(email) {
  if (typeof email !== "string") return false;
  return email.trim().toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

/**
 * isDemoIdentity({ email, is_demo }) → boolean.
 *
 * `is_demo` is read loosely on purpose. The login queries pull it through
 * `to_jsonb(row) ->> 'is_demo'` — the same trick src/auth/session.mjs uses for
 * staff.active — so that a database which has not yet applied migration 094
 * returns undefined here instead of erroring on a missing column. undefined is
 * simply "not flagged", and the email check still applies.
 */
export function isDemoIdentity({ email = null, is_demo = undefined } = {}) {
  const flagged = is_demo === true || is_demo === "true" || is_demo === "t";
  return flagged || isDemoEmail(email);
}

/**
 * demoLoginRefusal(identity, env) → null when this login may proceed, or the
 * refusal to return.
 *
 * The shape matches what src/auth/login.mjs already returns for a suspended
 * account, so a caller does nothing but pass it straight back. 403, not 401:
 * the credential was correct and the account is real — what is missing is the
 * switch, and an operator staring at "invalid_credentials" would spend an hour
 * resetting a password that was never wrong.
 */
export function demoLoginRefusal(identity, env = process.env) {
  if (!isDemoIdentity(identity || {})) return null;      // not a demo row — no opinion
  if (demoLoginsEnabled(env)) return null;               // switch is on — allowed
  return {
    ok: false,
    status: 403,
    error: "demo_logins_disabled",
    message: `demo accounts are switched off — set ${DEMO_ENV_VAR}=1 to enable them`
  };
}

export default demoLoginRefusal;
