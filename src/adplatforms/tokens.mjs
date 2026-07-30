// OAuth token encryption at rest.
//
// THE THREAT. ad_platform_connections holds a partner's access to their own ad
// account — the ability to spend their money. A database dump, a log line, a
// stack trace, or an over-eager SELECT * in a read API each turn that into an
// incident. So: encrypted at rest, scoped to one partner, never logged, never
// returned by any API response, never included in an error message.
//
// AES-256-GCM, from node:crypto. Authenticated encryption, so a tampered
// ciphertext fails to decrypt rather than decrypting to garbage that then gets
// sent to a platform as a bearer token.
//
// THE PARTNER ID IS ADDITIONAL AUTHENTICATED DATA. This is the part worth
// reading. Binding the partner id into the AAD means a ciphertext copied from
// partner A's row into partner B's row FAILS TO DECRYPT. Without it, a
// row-level mixup — a bad backfill, a mis-joined UPDATE — would silently give one
// partner a working token for another partner's ad account, and every downstream
// check would pass because the token really is valid. The database cannot catch
// that; the cipher can.
//
// KEY ROTATION. The key id is stored alongside the ciphertext, so a rotation
// re-encrypts on next use rather than requiring a flag day. Unknown key id is a
// hard failure, never a fallback to plaintext.

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;   // GCM standard nonce length
const TAG_BYTES = 16;

/* keyFor — the encryption key, from env.
   AD_TOKEN_ENC_KEY is 32 bytes, base64. Fundhub-level, never partner-supplied. */
function keyFor(keyId = "v1", { env = process.env } = {}) {
  const varName = keyId === "v1" ? "AD_TOKEN_ENC_KEY" : `AD_TOKEN_ENC_KEY_${keyId.toUpperCase()}`;
  const raw = env[varName];
  if (!raw) {
    // Named, never valued. And never a fallback: an unset key must stop the
    // feature, not silently store plaintext.
    throw new Error(`${varName} is not set — refusing to store an ad platform token unencrypted`);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`${varName} must be 32 bytes base64-encoded (got ${key.length})`);
  }
  return key;
}

/* encryptToken(plaintext, { partnerId }) → string

   Returns `v1:<iv>:<tag>:<ciphertext>`, all base64. Self-describing so decrypt
   needs nothing but the string and the partner id. */
export function encryptToken(plaintext, { partnerId, keyId = "v1", env } = {}) {
  if (plaintext === null || plaintext === undefined || plaintext === "") return null;
  if (!partnerId) {
    // Without it the AAD binding is absent, and the cross-partner protection this
    // module exists for silently does not apply.
    throw new Error("encryptToken: partnerId is required — it binds the ciphertext to one partner");
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, keyFor(keyId, { env }), iv);
  cipher.setAAD(Buffer.from(String(partnerId), "utf8"));

  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [keyId, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/* decryptToken(stored, { partnerId }) → string

   Throws on tampering, on a wrong partner id, and on an unknown key id. Never
   returns a partial or a placeholder: a caller that got a value must be able to
   trust it is the real token for the partner it asked about. */
export function decryptToken(stored, { partnerId, env } = {}) {
  if (stored === null || stored === undefined || stored === "") return null;
  if (!partnerId) throw new Error("decryptToken: partnerId is required");

  const parts = String(stored).split(":");
  if (parts.length !== 4) throw new Error("decryptToken: malformed ciphertext");
  const [keyId, ivB64, tagB64, ctB64] = parts;

  const decipher = crypto.createDecipheriv(ALGO, keyFor(keyId, { env }), Buffer.from(ivB64, "base64"));
  decipher.setAAD(Buffer.from(String(partnerId), "utf8"));
  const tag = Buffer.from(tagB64, "base64");
  if (tag.length !== TAG_BYTES) throw new Error("decryptToken: malformed auth tag");
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Deliberately opaque and deliberately not distinguishing the causes. "wrong
    // partner" vs "tampered" is information an attacker can use to probe, and the
    // caller's correct response is identical either way.
    const e = new Error("decryptToken: authentication failed — ciphertext does not belong to this partner or has been modified");
    e.code = "TOKEN_AUTH_FAILED";
    throw e;
  }
}

/* redactConnection — the shape any connection row must take before it can reach a
   response body, a log, or an error.

   Used by the read APIs. The columns are named encrypted_* partly so
   src/http/read-api.mjs's redact() catches them by pattern too, but relying on a
   regex alone would be one rename away from a leak — so this is explicit. */
export function redactConnection(row) {
  if (!row || typeof row !== "object") return row;
  const {
    encrypted_access_token, encrypted_refresh_token, ...safe
  } = row;
  return {
    ...safe,
    // The screens need to know a token EXISTS and when it expires, never its value.
    has_access_token: Boolean(encrypted_access_token),
    has_refresh_token: Boolean(encrypted_refresh_token)
  };
}

export default { encryptToken, decryptToken, redactConnection };
