// Where a push subscription lives, and the only code that may read one back.
//
// A SUBSCRIPTION IS A CREDENTIAL. Endpoint plus p256dh plus auth is everything
// needed to put a banner on that person's lock screen with our name on it.
// db/migrations/352_client_push_subscriptions.sql explains the storage shape;
// this file is the half that encrypts and decrypts it.
//
// THE ENCRYPTION IS COPIED FROM src/banking/plaid.mjs ON PURPOSE, down to the
// "v1:<iv>:<tag>:<ct>" ciphertext format and the row id as additional
// authenticated data. Two different at-rest formats in one repository means two
// different rotation stories and two chances to get one wrong. The key is a
// SEPARATE variable — PUSH_SUB_ENC_KEY, not PLAID_TOKEN_ENC_KEY — for the reason
// that file states about its own separation: a phone endpoint and a bank
// credential should not share a blast radius, and rotating one must not force
// rotating the other.
//
// THE ROW ID IS THE AAD, WHICH FORCES THE ID TO EXIST BEFORE THE INSERT. So this
// module generates the uuid in JavaScript rather than letting the column default
// fire. That is deliberate and it is what makes a ciphertext copied from one
// client's row into another's fail to decrypt instead of quietly working — the
// exact protection encryptPlaidToken() exists for, and the one thing the
// database cannot check for itself.
//
// NOTHING HERE LOGS A SUBSCRIPTION, A KEY OR AN ENDPOINT. Not at debug level,
// not in an error message, not in a thrown Error's text. The failures below name
// columns and row ids and stop there.

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class PushStoreError extends Error {
  constructor(message, { status = 500 } = {}) {
    super(message);
    this.name = "PushStoreError";
    this.status = status;
  }
}

/* ── the key ──────────────────────────────────────────────────────────────
   32 bytes, base64, from env only. Unset means the feature is off, and off
   means REFUSE — never "store it in the clear this once". */
function keyFor(keyId = "v1", { env = process.env } = {}) {
  const varName = keyId === "v1" ? "PUSH_SUB_ENC_KEY" : `PUSH_SUB_ENC_KEY_${String(keyId).toUpperCase()}`;
  const raw = env[varName];
  if (!raw) {
    throw new PushStoreError(
      `${varName} is not set — refusing to store a push subscription unencrypted`,
      { status: 503 }
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new PushStoreError(`${varName} must be 32 bytes base64-encoded (got ${key.length})`, { status: 503 });
  }
  return key;
}

/** isPushStorageConfigured(env) → boolean. Reports; never throws; never gates a
    half-built path. Same contract as isPlaidEnabled(). */
export function isPushStorageConfigured(env = process.env) {
  try { keyFor("v1", { env }); return true; } catch { return false; }
}

export function encryptField(plaintext, { rowId, keyId = "v1", env } = {}) {
  if (plaintext == null || plaintext === "") return null;
  if (!rowId) throw new PushStoreError("encryptField: rowId is required — it binds the ciphertext to one row", { status: 400 });
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, keyFor(keyId, { env }), iv);
  cipher.setAAD(Buffer.from(String(rowId), "utf8"));
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return [keyId, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptField(stored, { rowId, env } = {}) {
  if (stored == null || stored === "") return null;
  if (!rowId) throw new PushStoreError("decryptField: rowId is required", { status: 400 });
  const parts = String(stored).split(":");
  if (parts.length !== 4) throw new PushStoreError("decryptField: malformed ciphertext", { status: 400 });
  const [keyId, ivB64, tagB64, ctB64] = parts;
  const decipher = crypto.createDecipheriv(ALGO, keyFor(keyId, { env }), Buffer.from(ivB64, "base64"));
  decipher.setAAD(Buffer.from(String(rowId), "utf8"));
  const tag = Buffer.from(tagB64, "base64");
  if (tag.length !== TAG_BYTES) throw new PushStoreError("decryptField: malformed auth tag", { status: 400 });
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Opaque on purpose, and it does not distinguish "wrong row" from "tampered":
    // the caller's correct response is identical either way, and the difference
    // is information worth having only to somebody probing.
    const e = new PushStoreError("push subscription failed to decrypt — it does not belong to this row or has been modified");
    e.code = "SUBSCRIPTION_AUTH_FAILED";
    throw e;
  }
}

/** A one-way equality token over the endpoint. Not reversible, not sendable. */
export function endpointHash(endpoint) {
  return crypto.createHash("sha256").update(String(endpoint), "utf8").digest("hex");
}

/* ── shape checks, before anything touches the database ───────────────────
   Everything below arrives from a browser over the wire. */
const ALLOWED_LABELS = new Set(["iphone", "ipad", "android", "desktop", "other"]);

export function normalizeSubscription(input) {
  const sub = input && typeof input === "object" ? input : {};
  const endpoint = String(sub.endpoint || "").trim();
  const keys = sub.keys && typeof sub.keys === "object" ? sub.keys : {};
  const p256dh = String(keys.p256dh || sub.p256dh || "").trim();
  const auth = String(keys.auth || sub.auth || "").trim();

  if (!endpoint) throw new PushStoreError("subscription has no endpoint", { status: 400 });
  let url;
  try { url = new URL(endpoint); } catch { throw new PushStoreError("subscription endpoint is not a URL", { status: 400 }); }
  if (url.protocol !== "https:") throw new PushStoreError("subscription endpoint must be https", { status: 400 });
  // Bounded so a caller cannot use this table as free storage.
  if (endpoint.length > 2048) throw new PushStoreError("subscription endpoint is too long", { status: 400 });

  // Decoded lengths, not string lengths: browsers differ on padding.
  const p256dhBytes = Buffer.from(p256dh, "base64url");
  const authBytes = Buffer.from(auth, "base64url");
  if (p256dhBytes.length !== 65 || p256dhBytes[0] !== 0x04) {
    throw new PushStoreError("subscription p256dh key is not a 65-byte uncompressed P-256 point", { status: 400 });
  }
  if (authBytes.length !== 16) {
    throw new PushStoreError("subscription auth secret must be 16 bytes", { status: 400 });
  }

  return { endpoint, p256dh, auth };
}

export function normalizeDeviceLabel(label) {
  const s = String(label || "").trim().toLowerCase();
  return ALLOWED_LABELS.has(s) ? s : (s ? "other" : null);
}

/* ── writes ───────────────────────────────────────────────────────────────── */

/**
 * saveSubscription(db, { orgId, clientId, accountId, subscription, deviceLabel })
 *
 * RE-REGISTERING THE SAME DEVICE IS THE NORMAL CASE, not the exception. A
 * browser mints a fresh subscription whenever permission is re-granted, storage
 * is cleared, or the service worker is replaced — and it hands back the SAME
 * endpoint with fresh keys often enough that a plain INSERT would collide within
 * a week of shipping. So the live-row unique index is the adjudicator and the
 * conflict path rewrites the keys rather than erroring.
 *
 * Returns { id, created } — `created` false means an existing device was
 * refreshed, which the endpoint reports as 200 rather than 201.
 */
export async function saveSubscription(db, {
  orgId, clientId, accountId = null, subscription, deviceLabel = null, env
} = {}) {
  if (!orgId || !clientId) throw new PushStoreError("saveSubscription: orgId and clientId are required", { status: 400 });
  const { endpoint, p256dh, auth } = normalizeSubscription(subscription);
  const hash = endpointHash(endpoint);

  // Is this device already on file, live, for this org? Read first so the
  // ciphertext can be bound to the id that will actually hold it — a ciphertext
  // encrypted against a new uuid and then written onto an existing row by an
  // ON CONFLICT clause would be undecryptable forever.
  const existing = await db.query(
    `SELECT id, client_id FROM client_push_subscriptions
      WHERE org_id = $1 AND endpoint_hash = $2
        AND expired_at IS NULL AND revoked_at IS NULL
      LIMIT 1`,
    [orgId, hash]
  );

  if (existing.rows[0]) {
    const row = existing.rows[0];
    /* THE SAME PHYSICAL DEVICE, NOW SIGNED IN AS SOMEBODY ELSE. Two people
       share a tablet; the second one registers. Handing the row to the new
       client would silently move the first client's notifications. Retiring the
       old row and writing a fresh one keeps each client's history honest and
       stops the old client being sent to on a device they no longer hold. */
    if (String(row.client_id) !== String(clientId)) {
      await db.query(
        `UPDATE client_push_subscriptions
            SET revoked_at = now(), updated_at = now()
          WHERE id = $1`,
        [row.id]
      );
    } else {
      const id = row.id;
      await db.query(
        `UPDATE client_push_subscriptions
            SET encrypted_endpoint = $2,
                encrypted_p256dh   = $3,
                encrypted_auth     = $4,
                account_id         = COALESCE($5, account_id),
                device_label       = COALESCE($6, device_label),
                failure_count      = 0,
                updated_at         = now()
          WHERE id = $1`,
        [
          id,
          encryptField(endpoint, { rowId: id, env }),
          encryptField(p256dh, { rowId: id, env }),
          encryptField(auth, { rowId: id, env }),
          accountId,
          normalizeDeviceLabel(deviceLabel)
        ]
      );
      return { id, created: false };
    }
  }

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO client_push_subscriptions
       (id, org_id, client_id, account_id, endpoint_hash,
        encrypted_endpoint, encrypted_p256dh, encrypted_auth, device_label)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id, orgId, clientId, accountId, hash,
      encryptField(endpoint, { rowId: id, env }),
      encryptField(p256dh, { rowId: id, env }),
      encryptField(auth, { rowId: id, env }),
      normalizeDeviceLabel(deviceLabel)
    ]
  );
  return { id, created: true };
}

/**
 * revokeSubscription — the client turning notifications off.
 *
 * BY ENDPOINT, SCOPED TO THE CALLER'S OWN client_id. Both keys are in the WHERE
 * clause, not one: an endpoint hash is guessable only by whoever already has the
 * endpoint, but "only whoever already has it" is not an access rule, and every
 * read in this file is two-key scoped for the same reason
 * src/http/read-api.mjs records ten endpoints being fixed for.
 *
 * Returns the number of rows retired — 0 is a normal answer (already off).
 */
export async function revokeSubscription(db, { orgId, clientId, endpoint, all = false } = {}) {
  if (!orgId || !clientId) throw new PushStoreError("revokeSubscription: orgId and clientId are required", { status: 400 });
  if (all) {
    const r = await db.query(
      `UPDATE client_push_subscriptions
          SET revoked_at = now(), updated_at = now()
        WHERE org_id = $1 AND client_id = $2
          AND revoked_at IS NULL AND expired_at IS NULL`,
      [orgId, clientId]
    );
    return r.rowCount || 0;
  }
  const r = await db.query(
    `UPDATE client_push_subscriptions
        SET revoked_at = now(), updated_at = now()
      WHERE org_id = $1 AND client_id = $2 AND endpoint_hash = $3
        AND revoked_at IS NULL AND expired_at IS NULL`,
    [orgId, clientId, endpointHash(endpoint)]
  );
  return r.rowCount || 0;
}

/** The push service said this endpoint is gone for good (404 / 410). Terminal.
    Not a delete: "we lost this client's phone on the 14th" is worth keeping. */
export async function markExpired(db, id, { reason = null } = {}) {
  await db.query(
    `UPDATE client_push_subscriptions
        SET expired_at = COALESCE(expired_at, now()), updated_at = now()
      WHERE id = $1`,
    [id]
  );
  return reason;
}

export async function markSuccess(db, id) {
  await db.query(
    `UPDATE client_push_subscriptions
        SET last_success_at = now(), failure_count = 0, updated_at = now()
      WHERE id = $1`,
    [id]
  );
}

export async function markFailure(db, id) {
  await db.query(
    `UPDATE client_push_subscriptions
        SET failure_count = failure_count + 1, updated_at = now()
      WHERE id = $1`,
    [id]
  );
}

/* ── reads ────────────────────────────────────────────────────────────────── */

/**
 * listLiveSubscriptions — every device this client can be reached on.
 *
 * RETURNS DECRYPTED CREDENTIALS. Only the send path may call it. It is not a
 * read for a screen: everything a screen needs is in listSubscriptionsForClient
 * below, which returns no key material at all.
 *
 * A ROW THAT WILL NOT DECRYPT IS SKIPPED, NOT THROWN. One row encrypted under a
 * rotated key must not stop the client's other three phones getting the message.
 * The row id is warned about so it can be found; the ciphertext never is.
 */
export async function listLiveSubscriptions(db, { orgId, clientId, env } = {}) {
  if (!orgId || !clientId) throw new PushStoreError("listLiveSubscriptions: orgId and clientId are required", { status: 400 });
  const r = await db.query(
    `SELECT id, encrypted_endpoint, encrypted_p256dh, encrypted_auth, device_label
       FROM client_push_subscriptions
      WHERE org_id = $1 AND client_id = $2
        AND expired_at IS NULL AND revoked_at IS NULL
      ORDER BY created_at ASC`,
    [orgId, clientId]
  );
  const out = [];
  for (const row of r.rows) {
    try {
      out.push({
        id: row.id,
        deviceLabel: row.device_label,
        endpoint: decryptField(row.encrypted_endpoint, { rowId: row.id, env }),
        keys: {
          p256dh: decryptField(row.encrypted_p256dh, { rowId: row.id, env }),
          auth: decryptField(row.encrypted_auth, { rowId: row.id, env })
        }
      });
    } catch (err) {
      console.warn(`[push/store] subscription ${row.id} could not be decrypted:`, err && err.code);
    }
  }
  return out;
}

/**
 * listSubscriptionsForClient — the SCREEN's read. No endpoint, no keys, ever.
 * A client needs to know how many devices are on and when each last worked;
 * nothing on that screen needs a value that could be used to send.
 */
export async function listSubscriptionsForClient(db, { orgId, clientId } = {}) {
  if (!orgId || !clientId) throw new PushStoreError("listSubscriptionsForClient: orgId and clientId are required", { status: 400 });
  const r = await db.query(
    `SELECT id, device_label, created_at, last_success_at, failure_count
       FROM client_push_subscriptions
      WHERE org_id = $1 AND client_id = $2
        AND expired_at IS NULL AND revoked_at IS NULL
      ORDER BY created_at ASC`,
    [orgId, clientId]
  );
  return r.rows.map((row) => ({
    id: row.id,
    device_label: row.device_label,
    created_at: row.created_at,
    // NULL means "never successfully sent to". It is not a date and it is not a
    // zero — it must reach the screen as null so the screen can say "not yet".
    last_success_at: row.last_success_at,
    failure_count: row.failure_count
  }));
}

/** The shape a row must take before it can reach a response body or a log. */
export function redactSubscriptionRow(row) {
  if (!row || typeof row !== "object") return row;
  const {
    encrypted_endpoint, encrypted_p256dh, encrypted_auth, endpoint_hash, ...safe
  } = row;
  return { ...safe, has_credentials: Boolean(encrypted_endpoint) };
}

export default {
  saveSubscription,
  revokeSubscription,
  listLiveSubscriptions,
  listSubscriptionsForClient,
  markExpired,
  markSuccess,
  markFailure,
  endpointHash,
  encryptField,
  decryptField,
  normalizeSubscription,
  isPushStorageConfigured,
  redactSubscriptionRow
};
