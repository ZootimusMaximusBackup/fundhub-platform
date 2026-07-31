// Plaid bank-connection adapter — configuration, credential encryption, and two
// EMPTY SEAMS.
//
// WHY THIS LIVES IN src/banking/ AND NOT src/adapters/. src/adapters/ is a CLOSED
// SET with a generated diagram behind it: scripts/diagrams/extract.mjs walks that
// directory to build "the adapter boundary — what each adapter accepts, how it
// authenticates, and which canonical events it emits", and generate.test.mjs
// asserts the population is exactly 8. This module accepts no webhook, verifies
// no signature and emits no canonical event, so filing it there would add a node
// to a boundary map claiming an inbound edge that does not exist — and would
// force an edit to a shared test and to generated docs that ten parallel
// branches would then conflict over. Same contract, honest location.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ NOTHING HERE TRANSMITS. There is no fetch(), no http client, no webhook   │
// │ route and no scheduler in this file, and none may be added. Every adapter │
// │ in src/adapters/ is an INBOUND PARSER; the outbound half of a bank        │
// │ connection is a credentialled call against a real person's bank account   │
// │ and it does not ship on an agent's say-so.                                │
// │                                                                           │
// │ linkAccount() and getAccounts() are SEAMS: named, shaped, tested, and     │
// │ deliberately empty. Each returns an honest "not implemented" answer and   │
// │ marks, in its own comment, the exact line where a real Plaid client would │
// │ plug in. Same discipline as src/workflows/messaging.mjs sendTemplated(),  │
// │ which writes a queued row and stops rather than inventing a send.         │
// │                                                                           │
// │ WHAT MUST HAPPEN FIRST: SOC 2 review of storing bank credentials, a       │
// │ consent-capture flow reviewed by compliance, and a human decision to turn │
// │ it on. Not a code change. Not a flag flip by an agent.                    │
// └───────────────────────────────────────────────────────────────────────────┘
//
// isPlaidEnabled() IS NOT A FEATURE FLAG. It does not gate half-built behaviour
// and it does not switch anything on. It answers one question — "is the
// credential material for a bank connection present and well-formed?" — and
// returns a boolean. When the answer is no, the seams say so instead of
// pretending. When the answer is yes, the seams STILL say they are not
// implemented, because configuration is not implementation.
//
// FAIL CLOSED WHEN UNCONFIGURED. AUDIT-FINDINGS.md records
// `POST /api/webhooks/mailgun accepts unsigned requests ... when
// MAILGUN_SIGNING_KEY is unset` — one adapter treated a missing key as "no check
// needed" while five siblings failed closed, and an unauthenticated caller could
// drive a client's funding state. Absent config must never mean no gate. Unset
// here means disabled, every time.

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;   // GCM standard nonce length
const TAG_BYTES = 16;

/** Plaid's own environment names. An unrecognised value is a misconfiguration,
 *  not a new environment — and the safe reading of a misconfiguration is off. */
export const PLAID_ENVIRONMENTS = ["sandbox", "development", "production"];
export const DEFAULT_PLAID_ENV = "sandbox";

/** Every credential this adapter needs before a bank connection could exist.
 *  PLAID_TOKEN_ENC_KEY is in this list on purpose: without somewhere safe to put
 *  the access token, having the API credentials is worse than not having them. */
export const REQUIRED_ENV = ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_TOKEN_ENC_KEY"];

export class PlaidConfigError extends Error {
  constructor(message, { status = 503 } = {}) {
    super(message);
    this.name = "PlaidConfigError";
    this.status = status;
  }
}

/* ---------------------------------------------------------------------------
   1. Configuration — read env, report honestly, never throw.
   ------------------------------------------------------------------------ */

/**
 * plaidConfigFromEnv(env) → { environment, ready, missing[], problems[] }
 *
 * Same shape as lendflowConfigFromEnv(): callers branch on `ready` so an
 * unconfigured deploy degrades instead of crashing. NO SECRET VALUE IS EVER
 * RETURNED — `missing` and `problems` carry env var NAMES only, so this object
 * is safe to log, and a caller cannot accidentally hand a credential to a
 * response body by spreading it.
 */
export function plaidConfigFromEnv(env = process.env) {
  const missing = [];
  for (const name of REQUIRED_ENV) {
    if (!env[name]) missing.push(name);
  }

  const problems = [];

  // The encryption key must be usable, not merely present. A 12-byte key set by
  // a well-meaning copy/paste would otherwise pass the presence check and blow
  // up later, at the exact moment a real credential is in memory.
  if (env.PLAID_TOKEN_ENC_KEY) {
    let bytes = 0;
    try { bytes = Buffer.from(env.PLAID_TOKEN_ENC_KEY, "base64").length; } catch { bytes = 0; }
    if (bytes !== 32) problems.push("PLAID_TOKEN_ENC_KEY must be 32 bytes base64-encoded");
  }

  // Unset is fine and means sandbox. A value we do not recognise is NOT fine:
  // "prod", "Production" or a typo would otherwise be treated as some default,
  // and the two plausible defaults are "the safest one" and "the one they meant",
  // which are opposites. So an unrecognised value disables the adapter.
  const rawEnvironment = env.PLAID_ENV ? String(env.PLAID_ENV).trim() : DEFAULT_PLAID_ENV;
  const environment = PLAID_ENVIRONMENTS.includes(rawEnvironment) ? rawEnvironment : null;
  if (!environment) problems.push(`PLAID_ENV must be one of ${PLAID_ENVIRONMENTS.join(", ")}`);

  return {
    environment,
    ready: missing.length === 0 && problems.length === 0,
    missing,
    problems
  };
}

/**
 * isPlaidEnabled(env) → boolean
 *
 * "Do we hold complete, well-formed credential material for a bank connection?"
 * Nothing more. It reports; it does not gate a half-built path, and it never
 * throws — a caller asking whether something is configured should not have to
 * wrap the question in a try block.
 *
 * Unset, partially set, or malformed all return FALSE. That is the safe answer:
 * the failure mode of a wrong `false` is a feature that stays off, and the
 * failure mode of a wrong `true` is code proceeding as if it may touch a real
 * person's bank account.
 */
export function isPlaidEnabled(env = process.env) {
  return plaidConfigFromEnv(env).ready === true;
}

/* ---------------------------------------------------------------------------
   2. Credential encryption — AES-256-GCM, bound to the plaid_items row.
   ------------------------------------------------------------------------ */

/* keyFor — 32 bytes, base64, from env only.
   A SEPARATE KEY FROM AD_TOKEN_ENC_KEY AND PII_ENC_KEY, deliberately. A bank
   access token, an ad-account token and a social security number should not
   share a blast radius, and rotating one must not force rotating the others —
   src/pii/index.mjs made the same call for the same reason.

   Duplicated from src/adplatforms/tokens.mjs rather than imported: that module's
   key lookup is hard-wired to AD_TOKEN_ENC_KEY and its errors name that variable,
   so reusing it would either share the key (wrong) or print a misleading name
   during an incident. The right long-term fix is one AEAD helper parameterised by
   key-env-name, which is a cross-module refactor and out of this unit's scope —
   recorded in docs/workflows/finish-the-build/W5.md as a finding. */
function keyFor(keyId = "v1", { env = process.env } = {}) {
  const varName = keyId === "v1" ? "PLAID_TOKEN_ENC_KEY" : `PLAID_TOKEN_ENC_KEY_${keyId.toUpperCase()}`;
  const raw = env[varName];
  if (!raw) {
    // Named, never valued. And never a fallback: an unset key must stop the
    // feature, not silently store a live bank credential in plaintext.
    throw new PlaidConfigError(`${varName} is not set — refusing to store a bank access token unencrypted`);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new PlaidConfigError(`${varName} must be 32 bytes base64-encoded (got ${key.length})`);
  }
  return key;
}

/**
 * encryptPlaidToken(plaintext, { itemId }) → "v1:<iv>:<tag>:<ct>" (base64 parts)
 *
 * THE ITEM ID IS ADDITIONAL AUTHENTICATED DATA. Binding plaid_items.id into the
 * AAD means a ciphertext copied from one client's row into another's FAILS to
 * decrypt. Without it, a bad backfill or a mis-joined UPDATE would silently give
 * one client a working credential for another person's bank account, and every
 * downstream check would pass because the token really is valid. The database
 * cannot catch that; the cipher can.
 */
export function encryptPlaidToken(plaintext, { itemId, keyId = "v1", env } = {}) {
  if (plaintext === null || plaintext === undefined || plaintext === "") return null;
  if (!itemId) {
    // Without it the AAD binding is absent and the cross-client protection this
    // function exists for silently does not apply.
    throw new PlaidConfigError("encryptPlaidToken: itemId is required — it binds the ciphertext to one plaid_items row", { status: 400 });
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, keyFor(keyId, { env }), iv);
  cipher.setAAD(Buffer.from(String(itemId), "utf8"));

  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [keyId, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/**
 * decryptPlaidToken(stored, { itemId }) → string
 *
 * Throws on tampering, on the wrong item id and on an unknown key id. Never
 * returns a partial or a placeholder: a caller that got a value must be able to
 * trust it is the real credential for the row it asked about.
 */
export function decryptPlaidToken(stored, { itemId, env } = {}) {
  if (stored === null || stored === undefined || stored === "") return null;
  if (!itemId) throw new PlaidConfigError("decryptPlaidToken: itemId is required", { status: 400 });

  const parts = String(stored).split(":");
  if (parts.length !== 4) throw new PlaidConfigError("decryptPlaidToken: malformed ciphertext", { status: 400 });
  const [keyId, ivB64, tagB64, ctB64] = parts;

  const decipher = crypto.createDecipheriv(ALGO, keyFor(keyId, { env }), Buffer.from(ivB64, "base64"));
  decipher.setAAD(Buffer.from(String(itemId), "utf8"));
  const tag = Buffer.from(tagB64, "base64");
  if (tag.length !== TAG_BYTES) throw new PlaidConfigError("decryptPlaidToken: malformed auth tag", { status: 400 });
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Deliberately opaque and deliberately not distinguishing the causes. "wrong
    // item" vs "tampered" is information an attacker can use to probe, and the
    // caller's correct response is identical either way.
    const e = new Error("decryptPlaidToken: authentication failed — ciphertext does not belong to this item or has been modified");
    e.code = "TOKEN_AUTH_FAILED";
    throw e;
  }
}

/**
 * redactPlaidItem(row) — the shape a plaid_items row must take before it can
 * reach a response body, a log, or an error message.
 *
 * The column is named encrypted_* partly so src/http/read-api.mjs's redact()
 * catches it by pattern too, but relying on a regex alone would be one rename
 * away from a leak — so this is explicit. Screens need to know a credential
 * EXISTS, never its value.
 */
export function redactPlaidItem(row) {
  if (!row || typeof row !== "object") return row;
  const { encrypted_access_token, ...safe } = row;
  return { ...safe, has_access_token: Boolean(encrypted_access_token) };
}

/* ---------------------------------------------------------------------------
   3. The seams. Both empty. Both honest.
   ------------------------------------------------------------------------ */

/** Why a seam refused. Returned, never thrown — a caller asking an unbuilt
 *  integration to do something is a normal state here, not an exception. */
export const SEAM_REASONS = {
  NOT_CONFIGURED: "not_configured",   // credential material absent or malformed
  NOT_IMPLEMENTED: "not_implemented"  // configured, and the client still does not exist
};

/**
 * linkAccount({ clientId, publicToken, env }) → { ok:false, reason, item:null, missing[] }
 *
 * SEAM — DELIBERATELY EMPTY. In a built system this is where a Plaid public_token
 * from Link is exchanged for a long-lived access_token, the token is encrypted
 * with encryptPlaidToken() above and written to plaid_items.encrypted_access_token,
 * and link_state moves 'pending' → 'active'.
 *
 * ▶ THE REAL PLAID CLIENT WOULD PLUG IN HERE — one POST to /item/public_token/
 *   exchange, and nothing else in this file changes.
 *
 * WHY IT IS NOT HERE. That call sends a credential to a third party and receives
 * standing read access to a real person's bank account. Three things gate it and
 * none of them are code: a SOC 2 review of storing bank credentials in this
 * system, a consent-capture flow that compliance has signed off (plaid_items.
 * consent_granted_at exists and is NULL on every row for exactly this reason),
 * and a human decision to turn it on. An agent must not close this seam.
 *
 * `item` IS null, NOT AN EMPTY OBJECT. A caller must not be able to mistake a
 * refusal for a successful link that produced nothing.
 */
export async function linkAccount({ clientId = null, publicToken = null, env = process.env } = {}) {
  // publicToken is accepted so the signature is the real one, and immediately
  // dropped: it is credential material and nothing in this file may retain,
  // log or echo it. Referencing it only to void it is intentional.
  void publicToken;

  const cfg = plaidConfigFromEnv(env);
  if (!cfg.ready) {
    return {
      ok: false,
      reason: SEAM_REASONS.NOT_CONFIGURED,
      item: null,
      clientId,
      // Names only, never values.
      missing: [...cfg.missing, ...cfg.problems]
    };
  }

  // Configured is not implemented. Saying "not_configured" here would be a lie
  // that sends someone off to set env vars that are already set.
  return {
    ok: false,
    reason: SEAM_REASONS.NOT_IMPLEMENTED,
    item: null,
    clientId,
    missing: []
  };
}

/**
 * getAccounts({ itemId, env }) → { ok:false, reason, accounts:null, missing[] }
 *
 * SEAM — DELIBERATELY EMPTY. In a built system this is where the item's access
 * token is decrypted with decryptPlaidToken() and the institution's account list
 * is read, then upserted into bank_accounts by a separate store module.
 *
 * ▶ THE REAL PLAID CLIENT WOULD PLUG IN HERE — one POST to /accounts/get.
 *
 * `accounts` IS null, NOT []. This is the important line in the file. An empty
 * array means "this client has no bank accounts", which is a finding a funding
 * decision would act on. null means "we did not ask" — NULL means unknown and
 * unknown must survive. Handing back [] from an unbuilt integration would let a
 * refusal be read as a fact about someone's finances.
 *
 * NOTE FOR WHOEVER BUILDS THIS: accounts arriving from a bank carry no ownership
 * information this product can trust. Every row written must keep
 * bank_accounts.entity_kind at its 'unknown' default until a human or a document
 * establishes otherwise. Do not map a Plaid subtype onto 'personal' — see the
 * header of db/migrations/082_bank_account_entity_kind.sql.
 */
export async function getAccounts({ itemId = null, env = process.env } = {}) {
  const cfg = plaidConfigFromEnv(env);
  if (!cfg.ready) {
    return {
      ok: false,
      reason: SEAM_REASONS.NOT_CONFIGURED,
      accounts: null,
      itemId,
      missing: [...cfg.missing, ...cfg.problems]
    };
  }

  return {
    ok: false,
    reason: SEAM_REASONS.NOT_IMPLEMENTED,
    accounts: null,
    itemId,
    missing: []
  };
}

export default {
  PLAID_ENVIRONMENTS,
  REQUIRED_ENV,
  SEAM_REASONS,
  plaidConfigFromEnv,
  isPlaidEnabled,
  encryptPlaidToken,
  decryptPlaidToken,
  redactPlaidItem,
  linkAccount,
  getAccounts
};
