// /api/finance/bank-accounts — the client's bank accounts, entered by hand.
//
//   GET  ?client_id=<uuid>                              → { ok, accounts, surface }
//   POST { action: "add",      client_id, name, ... }
//   POST { action: "classify", account_id, entity_kind } → personal | business | unknown
//   POST { action: "close",    account_id, at? }
//
// *** SCAFFOLD STUB — TRACK 3 OWNS THIS FILE. ***
// Auth, role gate, org scoping, method switch and error mapping are finished and
// are the contract. Track 3 replaces the `not_implemented` bodies.
//
// *** BY HAND IS THE PRODUCT, NOT A PLACEHOLDER. ***
// src/banking/plaid.mjs is a deliberate empty seam: linkAccount() and
// getAccounts() return `not_implemented` and there is no outbound fetch behind
// them, because storing bank credentials is behind a SOC 2 review and a consent
// flow that are both open (public/app/shell.js:33 records the same decision on
// the nav side). So the balances on this screen are typed in by a person. That
// is a real feature — it is the only way this data exists today — and this
// endpoint must not grow a "sync" action to compensate.
//
// *** THERE IS NO STORE MODULE BEHIND THIS ONE. *** Every other endpoint in this
// batch calls a tested module; this one does not, because nothing in src/ writes
// `bank_accounts`. src/finance/banking-surface.mjs READS them (bankingSurface()
// groups stored rows and is pure), and src/banking/store.mjs owns recurring
// bills, not accounts. Track 3 therefore writes SQL in this file — carefully:
//
//   • org_id AND client_id on every statement, from the session and from the
//     ownership check, never from the body.
//   • balances are INTEGER CENTS (available_balance_cents, current_balance_cents,
//     credit_limit_cents are bigint). NULL means UNKNOWN and must stay NULL — an
//     account whose balance nobody has typed in yet is not an account with no
//     money in it, and src/finance/os-grid.mjs:71 sumKnown() is the shared rule
//     for totalling a set with holes in it. Reuse it; do not write a second one.
//   • entity_kind is 'unknown' by DEFAULT and 'unknown' is a real value in 082's
//     CHECK, not a null stand-in. Classifying is a human act; leaving it unknown
//     is the honest state, and 082's header explains why guessing from the
//     account name was rejected.
//   • closing sets closed_at. It does not DELETE — a closed account still
//     explains the transactions and bills attached to it.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { ENTITY_KINDS } from "../../src/finance/banking-surface.mjs";

/* ROLE_SETS.FINANCE — {owner, admin}. The same gate api/read/banking-surface.mjs
   already carries over these exact rows, and shell.js:33 records why the screen
   is owner/admin too: offering an employee a screen whose endpoint refuses them
   is the failure the nav gate exists to prevent. */
const BANK_ROLES = ROLE_SETS.FINANCE;

const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  // Second call, deliberately — requireAuth ignores a `roles` key.
  if (!requireRole(res, staff, BANK_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) return res.status(403).json({ ok: false, error: "org_required" });

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, q.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      // TODO(track 3): SELECT the client's bank_accounts scoped by org_id AND
      // client_id, then hand the rows to bankingSurface() from
      // src/finance/banking-surface.mjs for the grouped totals. Compute the
      // grouping ONCE, here — a second implementation in a <script> block is a
      // second answer that goes stale (src/finance/os-grid.mjs:3).
      return res.status(501).json({ ok: false, error: "not_implemented" });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }

      switch (body.action) {
        case "add": {
          if (!isUuid(body.client_id)) {
            return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
          }
          if (!(await ownsClient(orgId, body.client_id))) {
            return res.status(403).json({ ok: false, error: "forbidden" });
          }
          // TODO(track 3): INSERT one bank_accounts row. plaid_item_id and
          // plaid_account_id stay NULL — this account came from a person, not a
          // provider, and pretending otherwise would make a hand-typed balance
          // indistinguishable from a fetched one.
          return res.status(501).json({ ok: false, error: "not_implemented" });
        }
        case "classify": {
          if (!isUuid(body.account_id)) {
            return res.status(400).json({ ok: false, error: "account_id must be a uuid" });
          }
          // Checked here rather than left to 082's CHECK so the caller gets a
          // 400 naming the field instead of a 500 naming a constraint.
          if (!ENTITY_KINDS.includes(String(body.entity_kind || ""))) {
            return res.status(400).json({
              ok: false,
              error: `entity_kind must be one of ${ENTITY_KINDS.join(", ")}`
            });
          }
          if (!(await ownsAccount(orgId, body.account_id))) {
            return res.status(403).json({ ok: false, error: "forbidden" });
          }
          // TODO(track 3): UPDATE entity_kind and entity_kind_source. The source
          // column exists so "a human said so" and "we inferred it" never become
          // the same record.
          return res.status(501).json({ ok: false, error: "not_implemented" });
        }
        case "close": {
          if (!isUuid(body.account_id)) {
            return res.status(400).json({ ok: false, error: "account_id must be a uuid" });
          }
          if (!(await ownsAccount(orgId, body.account_id))) {
            return res.status(403).json({ ok: false, error: "forbidden" });
          }
          // TODO(track 3): UPDATE ... SET closed_at = COALESCE(closed_at, $when).
          // COALESCE keeps the FIRST close date; re-closing must not move a date
          // somebody may have to explain later.
          return res.status(501).json({ ok: false, error: "not_implemented" });
        }
        default:
          return res.status(400).json({ ok: false, error: "invalid_action" });
      }
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    if (e instanceof TypeError) {
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    throw e;
  }
}

async function ownsClient(orgId, clientId) {
  const r = await db.query(
    `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
    [String(clientId).trim(), orgId]
  );
  return r.rows.length > 0;
}

/* ownsAccount — the account is this company's. bank_accounts carries its own
   org_id (081:36), so this is a direct match rather than a join. */
async function ownsAccount(orgId, accountId) {
  const r = await db.query(
    `SELECT 1 FROM bank_accounts WHERE id = $1 AND org_id = $2`,
    [String(accountId).trim(), orgId]
  );
  return r.rows.length > 0;
}
