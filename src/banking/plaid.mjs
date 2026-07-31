// Plaid adapter — the seam, and nothing behind it.
//
// *** THIS MODULE MAKES NO NETWORK CALL AND WILL NOT MAKE ONE. ***
// There is no outbound fetch anywhere in src/adapters/ or src/lib/, and this
// file does not become the first one. `linkAccount()` and `getAccounts()` are
// documented, empty seams: they validate their inputs, prove the configuration
// gate works, and then refuse with a named, catchable error that says exactly
// what is missing. A caller can be written and tested against them today; the
// day the Plaid SDK is added, one function body changes and every caller and
// every test still holds.
//
// WHY A SEAM RATHER THAN THE REAL THING. Three reasons, in order:
//
//   1. SOC 2 IS NOT DONE. 080's header lists what is missing — no access log for
//      bank data, no retention decision, no vendor review. Shipping a working
//      pull of consumer bank data ahead of those controls is the wrong order.
//   2. `plaid` IS NOT A DEPENDENCY. This repo has exactly two, `pg` and
//      `inngest`, and adding a third is not this workflow's call to make.
//   3. THE INTERESTING PART IS NOT THE HTTP CALL. It is what happens to the
//      data afterwards — the entity_kind rule (082), the null-balance rule
//      (081), the timestamp rule. Those are built and tested now, against a seam,
//      which is the correct order.
//
//
// THE TOKEN. A Plaid access token is a long-lived credential to a real person's
// bank account and is the most dangerous value this system could hold. It is
// encrypted with AES-256-GCM before storage, using the same construction as
// src/adplatforms/tokens.mjs and src/pii/index.mjs:
//
//   * The key comes from an environment variable, never from the database and
//     never from a caller. It has its OWN variable, not shared with ad tokens or
//     PII, so rotating one does not force rotating the others and a compromise
//     of one does not spread.
//   * The plaid_items row id is bound in as additional authenticated data. A
//     ciphertext copied into another client's row FAILS to decrypt rather than
//     silently granting one client read access to another person's bank. The
//     database cannot catch that mistake; the cipher can.
//   * An unset key STOPS THE FEATURE. It never falls back to plaintext.
//
// Nothing in this module logs a token, returns one in an error message, or puts
// one in a thrown error's properties.

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/* The configuration Plaid needs before any of this could function. All three,
   because two out of three is a misconfiguration that fails at request time
   rather than at startup. */
const REQUIRED_ENV = ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV"];

/* Plaid's environments. 'production' touches real consumer accounts. Listed as
   data so an unrecognised value is caught here rather than by a 400 from Plaid
   after a token has already been minted. */
const VALID_ENVS = new Set(["sandbox", "development", "production"]);

export class PlaidError extends Error {
  constructor(message, { status = 400, code = null } = {}) {
    super(message);
    this.name = "PlaidError";
    this.status = status;
    this.code = code;
  }
}

/** Thrown by every seam. A distinct class so a caller can tell "not built yet"
 *  from "built, and it failed" — the two need completely different handling and
 *  a screen must never render the first as an outage. */
export class PlaidNotImplementedError extends PlaidError {
  constructor(what) {
    super(
      `${what} is not implemented: this repository has no Plaid client and makes no outbound network call. ` +
      `See src/banking/plaid.mjs and the SOC 2 note in db/migrations/080_plaid_items.sql.`,
      { status: 501, code: "PLAID_SEAM_NOT_IMPLEMENTED" }
    );
    this.name = "PlaidNotImplementedError";
  }
}

/**
 * isPlaidEnabled — is Plaid configured at all?
 *
 * Reads env only. No I/O, no caching, no module-level state: a test can flip the
 * environment between calls and a deploy that sets a variable does not need a
 * restart to be noticed.
 *
 * Returns false rather than throwing. "Not configured" is the NORMAL state of
 * this system today, not an error, and every read path is expected to ask this
 * first and degrade gracefully. A screen whose bank tile says "not connected" is
 * correct; one that shows an error banner because a feature was never turned on
 * is not.
 */
export function isPlaidEnabled({ env = process.env } = {}) {
  return missingConfig({ env }).length === 0;
}

/**
 * missingConfig — WHICH pieces are absent, in order.
 *
 * Exists because "Plaid is disabled" is useless to whoever has to fix it. Names
 * variables, never values: a configuration report that echoes a secret is how
 * secrets reach logs.
 */
export function missingConfig({ env = process.env } = {}) {
  const missing = REQUIRED_ENV.filter((k) => !env[k] || String(env[k]).trim() === "");
  const plaidEnv = env.PLAID_ENV && String(env.PLAID_ENV).trim();
  if (plaidEnv && !VALID_ENVS.has(plaidEnv) && !missing.includes("PLAID_ENV")) {
    missing.push("PLAID_ENV (must be sandbox, development or production)");
  }
  if (!env.PLAID_TOKEN_ENC_KEY || String(env.PLAID_TOKEN_ENC_KEY).trim() === "") {
    // Deliberately part of "enabled". Being able to talk to Plaid without being
    // able to store the resulting token safely is not a working state; it is the
    // state where somebody writes a plaintext token "just for now".
    missing.push("PLAID_TOKEN_ENC_KEY");
  }
  return missing;
}

/* keyFor — 32 bytes, base64, from env. Its own variable, never shared. */
function keyFor(keyId = "v1", { env = process.env } = {}) {
  const varName = keyId === "v1" ? "PLAID_TOKEN_ENC_KEY" : `PLAID_TOKEN_ENC_KEY_${keyId.toUpperCase()}`;
  const raw = env[varName];
  if (!raw) {
    // Named, never valued, and never a fallback.
    throw new PlaidError(`${varName} is not set — refusing to store a bank access token unencrypted`, { status: 503 });
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new PlaidError(`${varName} must be 32 bytes base64-encoded (got ${key.length})`, { status: 503 });
  }
  return key;
}

/**
 * encryptAccessToken(plaintext, { itemRowId }) → `v1:<iv>:<tag>:<ct>`, base64 parts.
 *
 * itemRowId is the plaid_items primary key and is REQUIRED: it is the AAD
 * binding, and without it the cross-client protection this function exists for
 * silently does not apply.
 */
export function encryptAccessToken(plaintext, { itemRowId, keyId = "v1", env } = {}) {
  if (plaintext == null || plaintext === "") return null;
  if (!itemRowId) {
    throw new PlaidError("encryptAccessToken: itemRowId is required — it binds the ciphertext to one connection");
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, keyFor(keyId, { env }), iv);
  cipher.setAAD(Buffer.from(String(itemRowId), "utf8"));

  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [keyId, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/**
 * decryptAccessToken(stored, { itemRowId }) → the token, or null.
 *
 * Throws on tampering, on the wrong itemRowId, and on an unknown key id. Never
 * returns a partial or a placeholder: a caller holding a value must be able to
 * trust it is the real token for the connection it asked about.
 */
export function decryptAccessToken(stored, { itemRowId, env } = {}) {
  if (stored == null || stored === "") return null;
  if (!itemRowId) throw new PlaidError("decryptAccessToken: itemRowId is required");

  const parts = String(stored).split(":");
  if (parts.length !== 4) throw new PlaidError("decryptAccessToken: malformed ciphertext");

  const [keyId, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new PlaidError("decryptAccessToken: malformed ciphertext");
  }

  const decipher = crypto.createDecipheriv(ALGO, keyFor(keyId, { env }), iv);
  decipher.setAAD(Buffer.from(String(itemRowId), "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

/**
 * linkAccount — SEAM. Would exchange a Plaid Link public token for an access
 * token and record a plaid_items row.
 *
 * Validates and refuses. The validation is real and is kept ahead of the
 * not-implemented throw on purpose: when the body is filled in, the argument
 * contract is already proven, and a caller written today against this seam does
 * not change.
 *
 * @param {object}  opts
 * @param {string}  opts.orgId          required
 * @param {string}  opts.clientId       required
 * @param {string}  opts.publicToken    required — from Plaid Link, exchanged once
 * @throws {PlaidError} when configuration is missing (503) or arguments are bad (400)
 * @throws {PlaidNotImplementedError} always, once the above pass (501)
 */
export async function linkAccount({ orgId, clientId, publicToken, env = process.env } = {}) {
  if (!orgId) throw new PlaidError("linkAccount: orgId is required");
  if (!clientId) throw new PlaidError("linkAccount: clientId is required");
  if (!publicToken) throw new PlaidError("linkAccount: publicToken is required");

  // The gate before the seam: a caller must not be told "not implemented" when
  // the real answer is "nobody configured this", and must not be told
  // "configured" when it is not.
  const missing = missingConfig({ env });
  if (missing.length) {
    throw new PlaidError(`Plaid is not configured: ${missing.join(", ")} not set`, { status: 503, code: "PLAID_NOT_CONFIGURED" });
  }

  throw new PlaidNotImplementedError("linkAccount");
}

/**
 * getAccounts — SEAM. Would fetch balances for one connection.
 *
 * Same shape and the same reasoning as linkAccount. When implemented, the
 * returned accounts must obey 081 and 082:
 *   * a balance Plaid omits stays null and is NEVER coerced to 0;
 *   * balance_as_of is the moment of the read, and no balance is stored without
 *     one;
 *   * entity_kind is 'unknown' with source 'unset' unless the institution
 *     actually said otherwise — an account name containing "Business" is at most
 *     source 'inferred', and never 'personal' by omission.
 *
 * @param {object} opts
 * @param {string} opts.itemRowId  required — the plaid_items row, also the AAD
 * @throws {PlaidError} configuration (503) or arguments (400)
 * @throws {PlaidNotImplementedError} always, once the above pass (501)
 */
export async function getAccounts({ itemRowId, env = process.env } = {}) {
  if (!itemRowId) throw new PlaidError("getAccounts: itemRowId is required");

  const missing = missingConfig({ env });
  if (missing.length) {
    throw new PlaidError(`Plaid is not configured: ${missing.join(", ")} not set`, { status: 503, code: "PLAID_NOT_CONFIGURED" });
  }

  throw new PlaidNotImplementedError("getAccounts");
}
