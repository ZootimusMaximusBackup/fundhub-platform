// Revoking a bank login — remove the credential, drop the accounts it exposed,
// and make a deliberate decision about the transactions rather than an accidental
// one.
//
// NO DELETE OF A BANK LOGIN EXISTED ANYWHERE IN THIS REPOSITORY BEFORE THIS FILE.
// plaid_items has had a 'revoked' link_state since 080 and nothing could ever set
// it, and nothing could remove a stored credential. A product that can store a
// person's bank access and cannot give it back is not one you can turn on.
//
// ============================================================================
// WHAT HAPPENS, IN ORDER, IN ONE TRANSACTION
// ============================================================================
//
//   1. Find the login, scoped to the caller's org. Fail closed if it is not there.
//   2. Count what is about to go, and what is about to stay. BEFORE anything is
//      removed — a count taken afterwards counts nothing.
//   3. Write the audit row (102) with both manifests.
//   4. Delete the plaid_items row. bank_accounts cascades (081).
//
// The audit row is written BEFORE the delete and in the same transaction. If the
// audit write fails, the delete does not happen. Same rule src/pii/index.mjs
// states for its access log: an audited action whose auditing is best-effort is
// an unaudited action with paperwork.
//
// ============================================================================
// THE TRANSACTIONS ARE KEPT. THIS IS A DECISION, NOT AN OVERSIGHT.
// ============================================================================
//
// Deleting the plaid_items row cascades bank_accounts (081, ON DELETE CASCADE).
// bank_transactions has NO foreign key to bank_accounts (085 section 4), so the
// ledger does not cascade with it — and this module does not delete it either.
//
// WHY KEEP IT. Revoking a bank login means "stop reading my account". It does not
// mean "forget that I was ever paid". Those are different requests and a person
// who makes the first has not made the second. Silently destroying months of cash
// flow history because somebody clicked disconnect would be unrecoverable, would
// happen without being asked for, and would break the one thing 085 exists to do
// — place money in time. If they DO want the history gone, that is an erasure
// request, it goes through src/privacy/erasure.mjs, and it produces its own audit
// record naming what went.
//
// WHY THIS IS SAFE TO KEEP. Because migration 101 gave those rows a durable
// anchor back to the person. Before 101 this decision would have been indefensible
// — the accounts vanish, bank_account_id points at nothing, and a later erasure
// request could never find the rows to honour it. The ledger would be permanent
// and invisible. The anchor is what makes "keep it" a choice rather than a leak.
//
// So the two are one change: the count of kept transactions goes into the audit
// row's `kept` manifest with that reason written out, and this module refuses to
// run against a database where the anchor column is missing.
//
// ============================================================================
// NOTHING HERE TALKS TO PLAID
// ============================================================================
//
// Revoking at the provider — POST /item/remove — is an outbound credentialled
// call and there is no outbound fetch in this repository. This removes OUR copy
// of the credential and OUR record of the accounts. The provider-side revoke is a
// named seam below and it is deliberately empty, exactly as linkAccount() and
// getAccounts() are in plaid.mjs.
//
// That gap is stated in the return value rather than hidden: `providerRevoked` is
// false and `providerReason` says why. A caller must not be able to read "we
// deleted our row" as "the bank connection is torn down at Plaid".

import { withTransaction } from "../db/with-transaction.mjs";
import { SEAM_REASONS, plaidConfigFromEnv } from "./plaid.mjs";

export class RevokeError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "RevokeError";
    this.status = status;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v.trim());

/* The reason string that goes into the audit record's `kept` manifest. Written
   here as a constant so the same sentence appears on every revoke and a reader
   comparing two audit rows is not left wondering whether the difference in
   wording meant a difference in policy. 102's CHECK requires 20+ characters. */
export const TRANSACTIONS_KEPT_REASON =
  "Revoking a bank login withdraws ongoing access; it is not a request to erase " +
  "financial history. The ledger stays, anchored to the client by " +
  "bank_transactions.subject_client_id (migration 101), so a later erasure " +
  "request can still find and honour it. To remove these, make an erasure request.";

/**
 * listBankLogins(db, { orgId, clientId }) → rows
 *
 * The screen's read: every bank login for one client, with a count of what sits
 * under each. NEVER returns the credential — the SELECT does not name
 * encrypted_access_token at all, which is a stronger guarantee than redacting it
 * afterwards, because there is no line to forget to add.
 */
export async function listBankLogins(db, { orgId, clientId } = {}) {
  if (!isUuid(orgId)) throw new RevokeError("orgId must be a uuid", { status: 400 });
  if (!isUuid(clientId)) throw new RevokeError("clientId must be a uuid", { status: 400 });

  const res = await db.query(
    `SELECT i.id,
            i.client_id,
            i.institution_name,
            i.link_state,
            i.consent_granted_at,
            i.created_at,
            -- Presence, never the value. The column itself is not selected.
            (i.encrypted_access_token IS NOT NULL) AS has_access_token,
            (SELECT count(*) FROM bank_accounts a WHERE a.plaid_item_id = i.id) AS account_count
       FROM plaid_items i
      WHERE i.org_id = $1 AND i.client_id = $2
      ORDER BY i.created_at DESC`,
    [String(orgId).trim(), String(clientId).trim()]
  );
  return res.rows;
}

/**
 * revokeBankLogin(db, { orgId, itemId, requestedBy, reason, env }) →
 *   { revoked, item, removed[], kept[], auditId, providerRevoked, providerReason }
 *
 * ORG SCOPING COMES FROM THE SESSION AND FAILS CLOSED. `orgId` is the caller's
 * own org from staff.org_id, and it is in the WHERE clause of the SELECT, not
 * checked in JavaScript afterwards. A login belonging to another org is simply
 * not found — the caller gets a 404 and learns nothing about whether it exists.
 * A missing orgId throws rather than matching everything.
 */
export async function revokeBankLogin(db, { orgId, itemId, requestedBy, reason, env = process.env } = {}) {
  if (!isUuid(orgId)) throw new RevokeError("orgId must be a uuid", { status: 400 });
  if (!isUuid(itemId)) throw new RevokeError("itemId must be a uuid", { status: 400 });

  // Attribution and reason are checked here, not only at the endpoint, so a
  // script or a curl reaches the same wall. 102's columns are NOT NULL besides.
  const label = requestedBy && typeof requestedBy.label === "string" ? requestedBy.label.trim() : "";
  if (!label) {
    throw new RevokeError("requestedBy.label is required — an unattributed revoke is not auditable", { status: 400 });
  }
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length < 10) {
    throw new RevokeError("reason is required and must say something — at least 10 characters", { status: 400 });
  }

  return withTransaction(db, async (tx) => {
    // 1. Find it, org-scoped. The credential column is not selected: this
    //    function has no reason to hold a bank access token in memory, and the
    //    safest place for a secret is a query that never asked for it.
    const item = (await tx.query(
      `SELECT id, org_id, client_id, institution_name, link_state,
              (encrypted_access_token IS NOT NULL) AS has_access_token
         FROM plaid_items
        WHERE id = $1 AND org_id = $2
        FOR UPDATE`,
      [String(itemId).trim(), String(orgId).trim()]
    )).rows[0];

    if (!item) {
      // 404, and deliberately the same answer for "does not exist" and "belongs
      // to another org". The difference is only useful to somebody probing.
      throw new RevokeError("bank login not found", { status: 404 });
    }

    // 2. Count BEFORE removing. Afterwards there is nothing left to count, and a
    //    manifest of zeroes would be a false audit record rather than an empty one.
    const accounts = (await tx.query(
      `SELECT id FROM bank_accounts WHERE plaid_item_id = $1 AND org_id = $2`,
      [item.id, item.org_id]
    )).rows;
    const accountIds = accounts.map((a) => a.id);

    const txnCount = accountIds.length === 0
      ? 0
      : Number((await tx.query(
          `SELECT count(*)::bigint AS n FROM bank_transactions
            WHERE org_id = $1 AND bank_account_id = ANY($2::uuid[])`,
          [item.org_id, accountIds]
        )).rows[0].n);

    // THE GUARD THAT MAKES "KEEP THE LEDGER" DEFENSIBLE. If migration 101 has not
    // been applied, those transactions are about to become unreachable the moment
    // the accounts cascade away — no anchor, and a bank_account_id pointing at a
    // deleted row. Refusing is the only safe answer: proceeding would create
    // exactly the orphans this batch exists to prevent, and it would do it while
    // writing an audit record that says the data was kept safely.
    if (txnCount > 0) {
      const anchored = Number((await tx.query(
        `SELECT count(*)::bigint AS n FROM bank_transactions
          WHERE org_id = $1 AND bank_account_id = ANY($2::uuid[])
            AND subject_client_id IS NULL`,
        [item.org_id, accountIds]
      )).rows[0].n);

      if (anchored > 0) {
        throw new RevokeError(
          `refusing to revoke: ${anchored} of ${txnCount} bank transactions under this login have no ` +
          `subject_client_id anchor, so removing the accounts would leave them with no route back to ` +
          `the client and no route to an account. Apply migration 101 and re-run.`,
          { status: 409 }
        );
      }
    }

    const removed = [
      {
        table: "plaid_items",
        rows: 1,
        detail: item.has_access_token
          ? "the bank login and its stored access token"
          : "the bank login; no access token was stored on it"
      },
      {
        table: "bank_accounts",
        rows: accountIds.length,
        detail: "accounts exposed by this login, removed by cascade from plaid_items"
      }
    ];

    const kept = [
      { table: "bank_transactions", rows: txnCount, reason: TRANSACTIONS_KEPT_REASON }
    ];

    // 3. Audit FIRST, same transaction. If this fails, nothing is deleted.
    const audit = (await tx.query(
      `INSERT INTO erasure_requests
         (org_id, kind, subject_client_id, subject_item_id,
          requested_by_staff_id, requested_by_label, reason,
          status, removed, kept, completed_at)
       VALUES ($1, 'bank_revoke', $2, $3, $4, $5, $6, 'completed', $7::jsonb, $8::jsonb, now())
       RETURNING id, created_at`,
      [
        item.org_id,
        item.client_id,
        item.id,
        isUuid(requestedBy?.staffId) ? String(requestedBy.staffId).trim() : null,
        label,
        why,
        JSON.stringify(removed),
        JSON.stringify(kept)
      ]
    )).rows[0];

    // 4. Now remove it. bank_accounts cascades from here (081). The credential
    //    goes with the row — there is no separate "clear the token" step because
    //    there is no row left to hold one.
    const gone = (await tx.query(
      `DELETE FROM plaid_items WHERE id = $1 AND org_id = $2 RETURNING id`,
      [item.id, item.org_id]
    )).rowCount;

    if (gone !== 1) {
      // Cannot normally happen — the row is held by FOR UPDATE above. If it does,
      // the transaction rolls back and takes the audit row with it, which is
      // correct: an audit record for a removal that did not happen is worse than
      // none.
      throw new RevokeError("the bank login changed underneath this revoke; nothing was removed", { status: 409 });
    }

    return {
      revoked: true,
      auditId: audit.id,
      item: {
        id: item.id,
        client_id: item.client_id,
        institution_name: item.institution_name,
        previous_link_state: item.link_state
      },
      removed,
      kept,
      // THE SEAM, STATED IN THE RETURN VALUE. See the header. A caller must not
      // read "our row is gone" as "access is torn down at the provider".
      ...providerRevokeSeam(env)
    };
  });
}

/* providerRevokeSeam — SEAM, DELIBERATELY EMPTY.
 *
 * ▶ THE REAL PLAID CLIENT WOULD PLUG IN HERE — one POST to /item/remove, before
 *   the local delete, using the token decrypted from the row we are about to
 *   remove.
 *
 * It is not here for the same reason linkAccount() and getAccounts() are not:
 * nothing in this repository transmits, and the outbound half of a bank
 * connection does not ship on an agent's say-so.
 *
 * WHAT THIS MEANS IN PRACTICE, AND IT IS NOT COSMETIC: until this is built,
 * revoking removes our stored credential but the Item may remain live at Plaid.
 * That is a real gap in a real revoke and it is reported on every call rather
 * than discovered later.
 */
function providerRevokeSeam(env) {
  const cfg = plaidConfigFromEnv(env);
  return {
    providerRevoked: false,
    providerReason: cfg.ready ? SEAM_REASONS.NOT_IMPLEMENTED : SEAM_REASONS.NOT_CONFIGURED,
    providerNote:
      "The stored credential and the account rows are removed from this system. " +
      "Access has NOT been revoked at the provider — there is no outbound call in " +
      "this repository. Revoke at the institution or at Plaid separately."
  };
}

export default { revokeBankLogin, listBankLogins, RevokeError, TRANSACTIONS_KEPT_REASON };
