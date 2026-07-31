// Bank linking — the store behind Plaid Link.
//
// src/adapters/plaid.mjs is the only thing in this repository that talks to
// Plaid. This module is the only thing that writes what Plaid said into the
// database, and the only thing that ever holds a bank access token in plaintext
// — for the few statements it takes to encrypt it.
//
// FOUR RULES, ENFORCED HERE RATHER THAN REMEMBERED BY CALLERS. Same structure as
// src/pii/index.mjs, and for the same reason: a rule a caller has to remember is
// a rule that holds until the second caller.
//
//   1. ENCRYPTED, OR NOT STORED. AES-256-GCM with the CLIENT ID as additional
//      authenticated data, exactly as src/pii/index.mjs does for an SSN and
//      src/adplatforms/tokens.mjs does for an OAuth token. An unset key stops the
//      feature; it never falls back to plaintext. The AAD binding means a token
//      copied into another client's row FAILS to decrypt rather than silently
//      becoming a working credential for someone else's bank account — which is
//      a mistake the database cannot catch and the cipher can.
//
//   2. THE TOKEN NEVER LEAVES. No function in this module returns a decrypted
//      access token to its caller. There is no revealAccessToken(), on purpose:
//      an SSN has a legitimate reveal path because a human occasionally has to
//      read one to a bureau, and a bank token has no equivalent — nothing but
//      this module has any use for it. It is decrypted inside syncItem(), used
//      in one call, and goes out of scope.
//
//   3. NO AUDIT ROW, NO SYNC. Every use of the token writes a plaid_sync_audit
//      row: who asked, which item, what came back, when. Written on failure as
//      well as success — a sync that errored is still somebody asking to read a
//      client's finances, and that attempt is exactly what an audit wants to see.
//      Reading someone's bank data is an event, not a page load.
//
//   4. A RE-SYNC NEVER OVERWRITES A HUMAN'S CLASSIFICATION. entity_kind and
//      business_id are absent from every INSERT and every ON CONFLICT DO UPDATE
//      in this file. Plaid does not know whose money an account holds (see
//      082_bank_account_entity_kind.sql), so a sync that touched that column
//      could only ever reset a considered answer back to 'unknown'.
//
// WHAT THIS MODULE DOES NOT DO. No transactions (W7), no liabilities or card
// terms (W6), no projections or reminders (W8), no scheduler. syncItem() runs
// when somebody asks it to, and the person who asked is written down.

import crypto from "node:crypto";
import {
  createLinkToken,
  exchangePublicToken,
  fetchAccounts,
  isPlaidConfigured,
  PlaidNotConfiguredError,
  PlaidApiError
} from "../adapters/plaid.mjs";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const ENTITY_KINDS = Object.freeze(["personal", "business", "unknown"]);

export class BankingError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "BankingError";
    this.status = status;
  }
}

/* keyFor — 32 bytes, base64, from env.
   A SEPARATE KEY from PII_ENC_KEY and AD_TOKEN_ENC_KEY, on purpose. A social
   security number, an ad account token and a live bank credential should not
   share a blast radius, and rotating one must not force rotating the others. */
function keyFor(keyId = "v1", { env = process.env } = {}) {
  const varName = keyId === "v1" ? "BANK_TOKEN_ENC_KEY" : `BANK_TOKEN_ENC_KEY_${keyId.toUpperCase()}`;
  const raw = env[varName];
  if (!raw) {
    // Named, never valued. And never a fallback: an unset key must stop the
    // feature, not quietly store a bank credential in plaintext.
    throw new BankingError(`${varName} is not set — refusing to store a bank access token unencrypted`, { status: 503 });
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new BankingError(`${varName} must be 32 bytes base64-encoded (got ${key.length})`, { status: 503 });
  }
  return key;
}

/** encryptAccessToken → `v1:<iv>:<tag>:<ct>`, base64 parts. */
export function encryptAccessToken(plaintext, { clientId, keyId = "v1", env } = {}) {
  if (plaintext == null || plaintext === "") return null;
  if (!clientId) throw new BankingError("encryptAccessToken: clientId is required — it binds the ciphertext to one client");

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, keyFor(keyId, { env }), iv);
  cipher.setAAD(Buffer.from(String(clientId), "utf8"));
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);

  return [keyId, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

/** decryptAccessToken — throws on tampering, on the wrong client id, on an unknown key. */
export function decryptAccessToken(stored, { clientId, env } = {}) {
  if (stored == null || stored === "") return null;
  if (!clientId) throw new BankingError("decryptAccessToken: clientId is required");

  const parts = String(stored).split(":");
  if (parts.length !== 4) throw new BankingError("malformed ciphertext");
  const [keyId, iv, tag, ct] = parts;

  const decipher = crypto.createDecipheriv(ALGO, keyFor(keyId, { env }), Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(String(clientId), "utf8"));
  const tagBuf = Buffer.from(tag, "base64");
  if (tagBuf.length !== TAG_BYTES) throw new BankingError("malformed ciphertext");
  decipher.setAuthTag(tagBuf);

  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

/* ITEM_COLUMNS — the projection every read in this file uses.
   access_token_enc IS NOT IN IT, and must never be added. `SELECT *` is banned
   from this module for exactly that reason: the ciphertext has no business
   travelling back through the application on a read path. */
const ITEM_COLUMNS = `
  id, org_id, client_id, item_id, institution_id, institution_name, status,
  last_error_code, last_error_message, consent_expires_at, last_synced_at,
  (access_token_enc IS NOT NULL) AS has_access_token,
  created_at, updated_at`;

/**
 * writeSyncAudit — rule 3. Append-only, and written on both outcomes.
 *
 * Exported so the endpoint can record an attempt that never reached this
 * module's happy path (an unconfigured deploy, a refused role). Takes an
 * explicit `db` so it can run inside a transaction or outside one.
 */
export async function writeSyncAudit(db, {
  orgId,
  plaidItemId = null,
  clientId = null,
  action,
  triggeredBy,
  triggeredByKind = "staff",
  outcome,
  accountCount = null,
  requestId = null,
  errorCode = null,
  errorMessage = null,
  summary = {}
} = {}) {
  if (!orgId) throw new BankingError("writeSyncAudit: orgId is required");
  if (!triggeredBy) {
    // An unattributed row is not an audit row. Same rule as revealSsn().
    throw new BankingError("writeSyncAudit: triggeredBy is required — an unattributed sync is not loggable", { status: 401 });
  }
  const res = await db.query(
    `INSERT INTO plaid_sync_audit
       (org_id, plaid_item_id, client_id, action, triggered_by, triggered_by_kind,
        outcome, account_count, request_id, error_code, error_message, summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, created_at`,
    [
      orgId, plaidItemId, clientId, action, String(triggeredBy), triggeredByKind,
      outcome, accountCount, requestId, errorCode,
      // Belt to the adapter's braces: the adapter already scrubs its secrets out
      // of every message it raises, and this truncation stops an enormous
      // provider error from filling a column either way.
      errorMessage == null ? null : String(errorMessage).slice(0, 2000),
      JSON.stringify(summary ?? {})
    ]
  );
  return res.rows[0];
}

/**
 * linkItem — the moment a bank connection comes into existence.
 *
 * Trades the client's short-lived public_token for a standing access token,
 * encrypts it, stores the item, and immediately pulls the accounts so the link
 * is useful rather than merely recorded.
 *
 * `publicToken` is NEVER stored. It is single-use and worthless after the
 * exchange, and keeping it would add a second credential to protect for no gain.
 */
export async function linkItem(db, {
  orgId,
  clientId,
  publicToken,
  institutionId = null,
  institutionName = null,
  triggeredBy,
  triggeredByKind = "staff",
  env = process.env,
  fetchImpl
} = {}) {
  if (!orgId || !clientId) throw new BankingError("orgId and clientId are required");
  if (!publicToken) throw new BankingError("public_token is required");
  if (!triggeredBy) throw new BankingError("triggeredBy is required", { status: 401 });

  /* Rule 1 before rule anything-else: refuse if we could not encrypt what we are
     about to be handed. Discovering the key is missing AFTER the exchange would
     leave a live credential at Plaid that this platform cannot store and cannot
     revoke, because it never wrote down the item id. */
  keyFor("v1", { env });

  let exchanged;
  try {
    exchanged = await exchangePublicToken(publicToken, { env, fetchImpl });
  } catch (err) {
    // Rule 3: the attempt is audited even though no item exists to point at.
    await writeSyncAudit(db, {
      orgId, clientId, action: "exchange", triggeredBy, triggeredByKind,
      outcome: "error",
      requestId: err?.requestId ?? null,
      errorCode: err?.errorCode ?? (err instanceof PlaidNotConfiguredError ? "NOT_CONFIGURED" : null),
      errorMessage: err?.message ?? null
    });
    throw err;
  }

  const enc = encryptAccessToken(exchanged.accessToken, { clientId, env });

  const item = (await db.query(
    `INSERT INTO plaid_items
       (org_id, client_id, item_id, access_token_enc, institution_id, institution_name, status)
     VALUES ($1,$2,$3,$4,$5,$6,'active')
     ON CONFLICT (org_id, item_id) DO UPDATE SET
       -- Re-linking the same institution REPLACES the credential rather than
       -- adding a second live one. The old token is overwritten, not archived:
       -- a superseded bank credential is a liability with no use.
       access_token_enc = EXCLUDED.access_token_enc,
       client_id        = EXCLUDED.client_id,
       -- COALESCE both ways round: Plaid does not always return institution
       -- metadata on exchange, and an absent name must not erase one we already
       -- have. Same rule as storeIdentity()'s ssn_enc.
       institution_id   = COALESCE(EXCLUDED.institution_id, plaid_items.institution_id),
       institution_name = COALESCE(EXCLUDED.institution_name, plaid_items.institution_name),
       -- A successful re-link clears the error that prompted it.
       status             = 'active',
       last_error_code    = NULL,
       last_error_message = NULL,
       updated_at         = now()
     RETURNING ${ITEM_COLUMNS}`,
    [orgId, clientId, exchanged.itemId, enc, institutionId, institutionName]
  )).rows[0];

  await writeSyncAudit(db, {
    orgId, clientId, plaidItemId: item.id, action: "exchange", triggeredBy, triggeredByKind,
    outcome: "ok",
    requestId: exchanged.requestId,
    // The item id is not a secret; the access token is, and is not here.
    summary: { item_id: exchanged.itemId, institution_id: institutionId }
  });

  // Pull the accounts now. A link that records a connection but shows no
  // accounts reads to the operator as a failure, and they re-link — producing a
  // second exchange for a connection that was fine.
  const sync = await syncItem(db, { itemRowId: item.id, triggeredBy, triggeredByKind, env, fetchImpl });

  return { item: sync.item, accounts: sync.accounts };
}

/**
 * syncItem — refresh balances for one linked item.
 *
 * The ONLY place a stored access token is decrypted. It is used for one call and
 * goes out of scope; it is not returned, not logged, and not put in an error.
 */
export async function syncItem(db, {
  itemRowId,
  triggeredBy,
  triggeredByKind = "staff",
  env = process.env,
  fetchImpl
} = {}) {
  if (!itemRowId) throw new BankingError("itemRowId is required");
  if (!triggeredBy) throw new BankingError("triggeredBy is required", { status: 401 });

  const row = (await db.query(
    `SELECT id, org_id, client_id, item_id, access_token_enc FROM plaid_items WHERE id = $1`,
    [itemRowId]
  )).rows[0];
  if (!row) throw new BankingError("no such linked bank item", { status: 404 });
  if (!row.access_token_enc) {
    // The item survives its credential being destroyed on purpose (see 080), so
    // this is a real state, not a corrupt row. It needs a re-link, not a retry.
    throw new BankingError("this bank link has no stored credential — the client must link again", { status: 409 });
  }

  const accessToken = decryptAccessToken(row.access_token_enc, { clientId: row.client_id, env });

  let result;
  try {
    result = await fetchAccounts(accessToken, { env, fetchImpl });
  } catch (err) {
    await markItemError(db, row.id, err);
    await writeSyncAudit(db, {
      orgId: row.org_id, clientId: row.client_id, plaidItemId: row.id,
      action: "accounts_sync", triggeredBy, triggeredByKind,
      outcome: "error",
      requestId: err?.requestId ?? null,
      errorCode: err?.errorCode ?? (err instanceof PlaidNotConfiguredError ? "NOT_CONFIGURED" : null),
      errorMessage: err?.message ?? null
    });
    throw err;
  }

  for (const account of result.accounts) {
    if (!account.account_id) continue;   // nothing to key on; nothing to store
    await db.query(
      `INSERT INTO bank_accounts
         (org_id, client_id, plaid_item_id, account_id, mask, name, official_name, type, subtype,
          current_balance_cents, available_balance_cents, iso_currency_code, unofficial_currency_code,
          balance_as_of, synced_at, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now(), $15)
       ON CONFLICT (org_id, account_id) DO UPDATE SET
         plaid_item_id            = EXCLUDED.plaid_item_id,
         mask                     = EXCLUDED.mask,
         name                     = EXCLUDED.name,
         official_name            = EXCLUDED.official_name,
         type                     = EXCLUDED.type,
         subtype                  = EXCLUDED.subtype,
         current_balance_cents    = EXCLUDED.current_balance_cents,
         available_balance_cents  = EXCLUDED.available_balance_cents,
         iso_currency_code        = EXCLUDED.iso_currency_code,
         unofficial_currency_code = EXCLUDED.unofficial_currency_code,
         balance_as_of            = EXCLUDED.balance_as_of,
         synced_at                = now(),
         raw                      = EXCLUDED.raw,
         -- An account Plaid is reporting again is not closed.
         closed_at                = NULL,
         updated_at               = now()
         -- RULE 4. entity_kind, business_id, entity_kind_source, entity_kind_set_by
         -- and entity_kind_set_at are DELIBERATELY ABSENT from this SET list. A
         -- balance refresh must never undo a person's classification, and Plaid
         -- has no opinion to overwrite it with.
      `,
      [
        row.org_id, row.client_id, row.id, account.account_id, account.mask, account.name,
        account.official_name, account.type, account.subtype,
        account.current_balance_cents, account.available_balance_cents,
        account.iso_currency_code, account.unofficial_currency_code,
        account.balance_as_of, JSON.stringify(account.raw ?? {})
      ]
    );
  }

  /* Accounts that vanished from the response have been closed or de-authorised.
     They are MARKED, not deleted, so their history survives.

     GUARDED ON A NON-EMPTY RESPONSE. If Plaid returns zero accounts, closing
     everything would be the correct reading of "the client removed them all" and
     the wrong reading of a transient — and the two are indistinguishable from
     here. Marking nothing is recoverable; marking everything closed on a blip
     silently empties a client's finances. The zero-account case is recorded in
     the audit summary instead, where a human can see it. */
  const seen = result.accounts.map((a) => a.account_id).filter(Boolean);
  let closed = 0;
  if (seen.length) {
    closed = (await db.query(
      `UPDATE bank_accounts SET closed_at = now(), updated_at = now()
        WHERE plaid_item_id = $1 AND closed_at IS NULL AND NOT (account_id = ANY($2::text[]))`,
      [row.id, seen]
    )).rowCount;
  }

  const itemError = result.item?.error ?? null;
  const item = (await db.query(
    `UPDATE plaid_items SET
       last_synced_at     = now(),
       institution_id     = COALESCE($2, institution_id),
       consent_expires_at = COALESCE($3, consent_expires_at),
       status             = $4,
       last_error_code    = $5,
       last_error_message = $6,
       updated_at         = now()
     WHERE id = $1
     RETURNING ${ITEM_COLUMNS}`,
    [
      row.id,
      result.item?.institutionId ?? null,
      result.item?.consentExpiresAt ?? null,
      itemError ? statusForPlaidCode(itemError.errorCode) : "active",
      itemError?.errorCode ?? null,
      itemError?.errorMessage ?? null
    ]
  )).rows[0];

  await writeSyncAudit(db, {
    orgId: row.org_id, clientId: row.client_id, plaidItemId: row.id,
    action: "accounts_sync", triggeredBy, triggeredByKind,
    outcome: "ok",
    accountCount: result.accounts.length,
    requestId: result.requestId,
    /* WHAT CAME BACK, redacted to shape. Ids, masks and types — enough to answer
       "which accounts did we read" months later — and never a balance figure:
       an audit trail is not a second copy of the client's finances. */
    summary: {
      accounts: result.accounts.map((a) => ({
        account_id: a.account_id, mask: a.mask, type: a.type, subtype: a.subtype,
        had_current_balance: a.current_balance_cents !== null,
        had_available_balance: a.available_balance_cents !== null
      })),
      closed_marked: closed,
      // Recorded rather than acted on — see the guard above.
      zero_accounts_returned: seen.length === 0
    }
  });

  return { item, accounts: await listAccounts(db, { clientId: row.client_id, itemRowId: row.id }) };
}

/* markItemError — a failed sync is a fact about the link, not just about the
   request. Written before the audit row so an operator reading the item sees the
   same story the audit tells. */
async function markItemError(db, itemRowId, err) {
  await db.query(
    `UPDATE plaid_items
        SET status = $2, last_error_code = $3, last_error_message = $4, updated_at = now()
      WHERE id = $1`,
    [
      itemRowId,
      statusForPlaidCode(err?.errorCode),
      err?.errorCode ?? null,
      err?.message == null ? null : String(err.message).slice(0, 2000)
    ]
  );
}

/* statusForPlaidCode — Plaid's error vocabulary mapped onto the five states
   080 defines. The mapping is deliberately small: only codes whose remedy is
   genuinely different get their own status, and everything else is 'error' with
   Plaid's own code stored beside it. Inventing a status per error code would
   produce a taxonomy nobody maintains. */
function statusForPlaidCode(code) {
  switch (code) {
    case "ITEM_LOGIN_REQUIRED":
    case "PENDING_DISCONNECT":
      return "login_required";
    case "PENDING_EXPIRATION":
      return "pending_expiration";
    case "ITEM_NOT_FOUND":
    case "ACCESS_NOT_GRANTED":
      return "revoked";
    case null:
    case undefined:
      return "error";
    default:
      return "error";
  }
}

/**
 * classifyAccount — a named human says whose money this is.
 *
 * The only writer of entity_kind. 'unknown' is an ALLOWED answer here, not just
 * a starting state: "somebody looked and could not tell" is a real outcome and
 * is materially different from "nobody has looked", which is why the row still
 * records who said so and when.
 */
export async function classifyAccount(db, {
  accountRowId,
  entityKind,
  businessId = null,
  setBy
} = {}) {
  if (!accountRowId) throw new BankingError("accountRowId is required");
  if (!setBy) throw new BankingError("setBy is required — a classification with no author is not reviewable", { status: 401 });
  if (!ENTITY_KINDS.includes(entityKind)) {
    throw new BankingError(`entity_kind must be one of: ${ENTITY_KINDS.join(", ")}`);
  }
  if (businessId && entityKind !== "business") {
    // The database constraint says the same thing. Saying it here too gives the
    // caller a sentence instead of a SQLSTATE.
    throw new BankingError("a business can only be named on an account classified as business");
  }

  const res = await db.query(
    `UPDATE bank_accounts SET
       entity_kind        = $2,
       -- Cleared whenever the kind is not 'business', so an account demoted from
       -- business to personal cannot keep pointing at a company.
       business_id        = CASE WHEN $2 = 'business' THEN $3::uuid ELSE NULL END,
       entity_kind_source = 'staff',
       entity_kind_set_by = $4,
       entity_kind_set_at = now(),
       updated_at         = now()
     WHERE id = $1
     RETURNING id, org_id, client_id, account_id, entity_kind, business_id,
               entity_kind_source, entity_kind_set_by, entity_kind_set_at`,
    [accountRowId, entityKind, businessId, String(setBy)]
  );
  if (!res.rows[0]) throw new BankingError("no such bank account", { status: 404 });
  return res.rows[0];
}

/** listItems — a client's bank links. Never the token. */
export async function listItems(db, { clientId } = {}) {
  if (!clientId) throw new BankingError("clientId is required");
  const res = await db.query(
    `SELECT ${ITEM_COLUMNS} FROM plaid_items WHERE client_id = $1 ORDER BY created_at DESC`,
    [clientId]
  );
  return res.rows;
}

/** listAccounts — a client's accounts. Open ones first; closed ones survive. */
export async function listAccounts(db, { clientId, itemRowId = null } = {}) {
  if (!clientId) throw new BankingError("clientId is required");
  const res = await db.query(
    `SELECT a.id, a.org_id, a.client_id, a.plaid_item_id, a.account_id, a.mask, a.name,
            a.official_name, a.type, a.subtype,
            a.current_balance_cents, a.available_balance_cents,
            a.iso_currency_code, a.unofficial_currency_code,
            a.balance_as_of, a.synced_at, a.closed_at,
            a.entity_kind, a.business_id, a.entity_kind_source,
            a.entity_kind_set_by, a.entity_kind_set_at,
            b.name AS business_name,
            i.institution_name, i.status AS item_status
       FROM bank_accounts a
       JOIN plaid_items i ON i.id = a.plaid_item_id
       LEFT JOIN businesses b ON b.id = a.business_id
      WHERE a.client_id = $1
        AND ($2::uuid IS NULL OR a.plaid_item_id = $2::uuid)
      ORDER BY a.closed_at NULLS FIRST, a.created_at`,
    [clientId, itemRowId]
  );
  return res.rows;
}

/** syncHistory — who has read this client's bank data, newest first. */
export async function syncHistory(db, { clientId, limit = 100 } = {}) {
  if (!clientId) throw new BankingError("clientId is required");
  const res = await db.query(
    `SELECT id, plaid_item_id, action, triggered_by, triggered_by_kind, outcome,
            account_count, request_id, error_code, error_message, summary, created_at
       FROM plaid_sync_audit
      WHERE client_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [clientId, Math.max(1, Math.min(Number(limit) || 100, 500))]
  );
  return res.rows;
}

/* Re-exported so an endpoint can answer "is bank linking available on this
   deploy" — and open a Link session — without importing the adapter directly
   and without a second copy of the rule.

   createLinkToken touches no table and writes no audit row, which is why it
   passes straight through rather than getting a wrapper here. Opening a Link
   session reads none of the client's financial data; it only asks their bank
   for permission to ask. The step AFTER it — linkItem() — is the moment a
   standing credential exists, and that one is audited. */
export { createLinkToken, isPlaidConfigured, PlaidNotConfiguredError, PlaidApiError };
