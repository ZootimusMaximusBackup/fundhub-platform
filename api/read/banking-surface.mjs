// GET /api/read/banking-surface?client_id=<uuid> — bank accounts, split by
// whose money it is.
//
// The companion to /api/read/finance-os. That one answers "what credit does this
// client have" from `tradelines`; this one answers "what cash is there, and
// whose is it" from `bank_accounts`. Both name their own source in the response
// so a screen can print what it is looking at rather than implying it is looking
// at everything.
//
// UNKNOWN IS NOT PERSONAL. The grouping is done by
// src/finance/banking-surface.mjs and the rule lives there; what matters here is
// that this endpoint returns no combined balance across the three groups, by
// construction rather than by omission. A single "total cash" figure would be
// read as the client's money, and for business and unclassified accounts that is
// not established.
//
// client_id IS REQUIRED, for the same reason api/read/tradelines.mjs requires
// it: this is per-person financial detail, and a paginated firehose of
// everybody's bank balances is not a screen anyone asked for — it is the kind of
// endpoint that becomes a breach.
//
// THE ROLE GATE IS TWO CALLS, NOT ONE ARGUMENT. requireAuth's third parameter is
// { db, env }, passed straight to authenticate(), which destructures exactly
// those two names — a `roles` key there is accepted by the object literal and
// silently dropped. api/read/tradelines.mjs shipped that once and the effective
// rule became "any authenticated staff session, any role" on an endpoint serving
// a named client's balances.
//
// ROLE_SETS.FINANCE, NOT STAFF — AND THAT IS THE SECOND APPROVAL (audit M9).
// This endpoint used to admit the whole staff set, on the argument that bank
// balances are no more sensitive than the credit limits finance-os and
// tradelines already serve to that set. The difference is where the data comes
// from. Those read what this system was told; this reads a bank connection, and
// bank connections are not approved: src/banking/plaid.mjs is two empty seams
// waiting on a SOC 2 review of storing bank credentials and a consent-capture
// flow compliance has signed off (docs/workflows/finish-the-build/W5.md, still
// open). isPlaidEnabled() below asks whether the credentials exist; it cannot
// ask whether anyone agreed to this. So setting three environment variables for
// one test client must not put that person's real balances on every employee's
// desk — configuration is not consent and it is not an approval. Owner/admin
// only until a human widens it deliberately, which is a one-word edit here.
//
// SELECTED COLUMNS, NOT `SELECT *`. `plaid_items.encrypted_access_token` lives
// one join away and there is no reason for a read endpoint to be one typo from
// it. bank_accounts holds no full account number by design (081 stores a mask
// only), and this list keeps it that way.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { bankingSurface } from "../../src/finance/banking-surface.mjs";
import { isPlaidEnabled } from "../../src/banking/plaid.mjs";

const COLUMNS = `
  id, client_id, name, official_name, mask,
  account_type, account_subtype, currency_code,
  available_balance_cents, current_balance_cents, credit_limit_cents,
  balance_as_of, entity_kind, entity_kind_source, entity_kind_set_at,
  closed_at, created_at, updated_at`;

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return;

  if (!isPlaidEnabled()) {
    return res.status(403).json({ ok: false, error: "banking surface requires plaid configuration" });
  }

  const query = req.query || {};
  if (!isUuid(query.client_id)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }

  try {
    /* Closed accounts are fetched, not filtered out here. "This client had six
       accounts and two are closed" is a different fact from "this client has
       four accounts", and the grouping module is what decides that a closed
       account's last known balance is not reachable money. */
    const rows = (await db.query(
      `SELECT ${COLUMNS} FROM bank_accounts
        WHERE client_id = $1
        ORDER BY entity_kind, name NULLS LAST, id`,
      [String(query.client_id).trim()]
    )).rows;

    return res.status(200).json({ ok: true, ...bankingSurface(rows) });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e.code)) {
      return res.status(400).json({ ok: false, error: "bad request parameter" });
    }
    throw e;
  }
}
