// Stored payment credentials: encryption at rest, and the refusal that matters.
//
// THE THREAT. client_cards (db/migrations/076_client_cards.sql) holds a
// processor token for a card the client has authorised us to bill. A token IS
// the ability to charge somebody's card. A database dump, a log line, a stack
// trace, or one over-eager SELECT * in a read API each turn that into an
// incident with a regulator attached. So: encrypted at rest, scoped to one
// client, never logged, never returned by any API response, never included in an
// error message.
//
// AES-256-GCM, from node:crypto — the identical construction to
// src/adplatforms/tokens.mjs (OAuth tokens, partner id as AAD) and
// src/pii/index.mjs (SSNs, client id as AAD). Deliberately not a new pattern:
// three encryption schemes in one repo is two more than anybody can audit.
//
// THE CLIENT ID IS ADDITIONAL AUTHENTICATED DATA. A ciphertext copied from
// client A's row into client B's row FAILS TO DECRYPT rather than silently
// becoming a working credential for the wrong person's card. A mis-joined
// UPDATE or a bad backfill would otherwise let us bill one client for another
// client's plan, and every downstream check would pass, because the token really
// is valid. The database cannot catch that; the cipher can.
//
// ===========================================================================
// THE PART THAT IS NOT LIKE THE OTHER TWO MODULES: WE REFUSE PANs.
// ===========================================================================
// encryptCardToken() throws if the value it is handed looks like a card number —
// 13 to 19 digits that pass the Luhn check. Encrypting a PAN is still storing a
// PAN, and "it was encrypted" is not a defence for holding card numbers you were
// never supposed to hold. The tokenization boundary is that a processor takes
// the card and hands back a token; the number never reaches this system. This
// function is where that boundary is enforced in code, and
// client_cards_token_is_ciphertext is where it is enforced in the database.
//
// A CVV IS NEVER STORED, ENCRYPTED OR OTHERWISE. There is no column for one and
// no function here that would take one. That is a card-network rule, not a
// preference.
//
// KEY. CARD_TOKEN_ENC_KEY, 32 bytes base64, from the environment only. A
// SEPARATE KEY from AD_TOKEN_ENC_KEY and PII_ENC_KEY on purpose: an ad token, a
// social security number and a billable credential should not share a blast
// radius or a rotation. An unset key stops the feature — it never falls back to
// plaintext. The key id travels in the ciphertext, so a rotation re-encrypts on
// next use instead of needing a flag day; an unknown key id is a hard failure.
//
// ===========================================================================
// THE PROVIDER SEAM IS EMPTY, ON PURPOSE.
// ===========================================================================
// There is no processor client here and no outbound request anywhere in this
// module. NOTHING TRANSMITS: there is no outbound fetch in src/adapters/ or
// src/lib/, and adding one is a separate, deliberate build with a compliance
// review in front of it. When a processor is chosen, the seam is:
//
//   1. the browser (or a hosted field) sends the card straight to the processor;
//   2. the processor returns a token — the PAN never touches this system;
//   3. that token is passed to encryptCardToken() and the ciphertext is written
//      to client_cards.token_enc.
//
// Step 1 and 2 are the parts that do not exist. Nothing in this repo should
// call step 3 with a value a human typed into our own form.

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;   // GCM standard nonce length
const TAG_BYTES = 16;

/** The envelope shape the 076 CHECK constraint also enforces, kept here so the
 *  two cannot drift apart silently. */
export const TOKEN_ENVELOPE_RE = /^v[0-9]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

export class CardTokenError extends Error {
  constructor(message, { status = 400, code } = {}) {
    super(message);
    this.name = "CardTokenError";
    this.status = status;
    if (code) this.code = code;
  }
}

/* keyFor — the encryption key, from env. Named, never valued. */
function keyFor(keyId = "v1", { env = process.env } = {}) {
  const varName = keyId === "v1" ? "CARD_TOKEN_ENC_KEY" : `CARD_TOKEN_ENC_KEY_${keyId.toUpperCase()}`;
  const raw = env[varName];
  if (!raw) {
    throw new CardTokenError(
      `${varName} is not set — refusing to store a payment credential unencrypted`,
      { status: 503 }
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new CardTokenError(`${varName} must be 32 bytes base64-encoded (got ${key.length})`, { status: 503 });
  }
  return key;
}

/**
 * looksLikePan — is this a card number?
 *
 * Digits only after stripping spaces and dashes, 13–19 of them, passing Luhn.
 * That is the same test the networks use, so a real PAN cannot slip past it by
 * being formatted differently. A processor token is opaque and alphanumeric and
 * will not match; a token that somehow does match is one we refuse to store,
 * which is the safe direction to be wrong in.
 */
export function looksLikePan(value) {
  if (value === null || value === undefined) return false;
  const s = String(value);
  // A token with letters in it is not a card number. Checked first so a long
  // alphanumeric token never reaches the digit stripper and gets misread.
  if (/[^0-9 \-]/.test(s)) return false;
  const digits = s.replace(/[ \-]/g, "");
  if (!/^[0-9]{13,19}$/.test(digits)) return false;

  // Luhn.
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * encryptCardToken(token, { clientId }) → Buffer for the bytea column.
 *
 * Returns `v1:<iv>:<tag>:<ciphertext>` (base64 parts) as UTF-8 bytes,
 * self-describing so decrypt needs nothing but the value and the client id.
 */
export function encryptCardToken(plaintext, { clientId, keyId = "v1", env } = {}) {
  if (plaintext === null || plaintext === undefined || plaintext === "") return null;
  if (!clientId) {
    // Without it the AAD binding is absent and the cross-client protection this
    // module exists for silently does not apply.
    throw new CardTokenError("encryptCardToken: clientId is required — it binds the ciphertext to one client");
  }
  if (looksLikePan(plaintext)) {
    // Deliberately loud, and deliberately without echoing the value.
    throw new CardTokenError(
      "encryptCardToken: refusing to store a value that looks like a card number — store the processor's token, never the PAN",
      { code: "PAN_REFUSED" }
    );
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, keyFor(keyId, { env }), iv);
  cipher.setAAD(Buffer.from(String(clientId), "utf8"));

  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.from(
    [keyId, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":"),
    "utf8"
  );
}

/**
 * decryptCardToken(stored, { clientId }) → string
 *
 * Throws on tampering, on the wrong client id, and on an unknown key id. Never
 * returns a partial or a placeholder: a caller that got a value must be able to
 * trust it is the real token for the client it asked about.
 */
export function decryptCardToken(stored, { clientId, env } = {}) {
  if (stored === null || stored === undefined || stored === "") return null;
  if (!clientId) throw new CardTokenError("decryptCardToken: clientId is required");

  const text = Buffer.isBuffer(stored) ? stored.toString("utf8") : String(stored);
  const parts = text.split(":");
  if (parts.length !== 4) throw new CardTokenError("decryptCardToken: malformed ciphertext");
  const [keyId, ivB64, tagB64, ctB64] = parts;

  const decipher = crypto.createDecipheriv(ALGO, keyFor(keyId, { env }), Buffer.from(ivB64, "base64"));
  decipher.setAAD(Buffer.from(String(clientId), "utf8"));
  const tag = Buffer.from(tagB64, "base64");
  if (tag.length !== TAG_BYTES) throw new CardTokenError("decryptCardToken: malformed auth tag");
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Opaque on purpose, and deliberately not distinguishing the causes. "wrong
    // client" vs "tampered" is information an attacker can use to probe, and the
    // caller's correct response is identical either way.
    throw new CardTokenError(
      "decryptCardToken: authentication failed — ciphertext does not belong to this client or has been modified",
      { code: "TOKEN_AUTH_FAILED" }
    );
  }
}

/**
 * redactCard — the shape a client_cards row must take before it can reach a
 * response body, a log, or an error.
 *
 * Explicit rather than relying on src/http/read-api.mjs's redact() pattern
 * match: a regex on column names is one rename away from a leak.
 */
export function redactCard(row) {
  if (!row || typeof row !== "object") return row;
  const { token_enc, ...safe } = row;
  return {
    ...safe,
    // Screens need to know a credential EXISTS. They never need its value.
    has_token: Boolean(token_enc)
  };
}

export default { encryptCardToken, decryptCardToken, looksLikePan, redactCard, TOKEN_ENVELOPE_RE };
