// /api/banking/plaid — bank linking through Plaid Link.
//
//   GET  ?client_id=<uuid>            → { ok, configured, items, accounts }
//   GET  ?client_id=<uuid>&history=1  → { ok, syncs }   who has read this client's bank data
//   POST { action: "link",     client_id, public_token, institution_id?, institution_name? }
//   POST { action: "sync",     item_id }        — refresh balances for one link
//   POST { action: "classify", account_id, entity_kind, business_id? }
//
// THIS ENDPOINT NEVER RETURNS AN ACCESS TOKEN. Not masked, not partially, not
// behind a flag. src/banking/index.mjs has no function that would produce one,
// and the reads here project a `has_access_token` boolean instead. There is no
// equivalent of /api/pii's reveal action, deliberately: a human occasionally has
// to read an SSN aloud to a bureau, and nobody ever has to read a bank token.
//
// THE ROLE GATE IS NARROWER THAN ROLE_SETS.STAFF, DELIBERATELY, and for the same
// reason /api/pii's is. A setter or a closer has no reason to see how much money
// is in a client's chequing account. Widening this set should be a decision
// somebody makes on purpose, in this file, rather than inherits by reusing a
// convenient constant.
//
// WHY LINKING IS STAFF-ONLY TODAY. The real-world flow is the client opening
// Plaid Link themselves, and this endpoint would then accept a client principal
// exchanging their own public_token. That is not built here because W5's fence
// excludes UI, and shipping a client-facing write path with no screen to exercise
// it would be a hole nobody is looking at. Recorded on the board.
//
// WHAT IS MISSING TO MAKE THIS USABLE END TO END: /link/token/create. A client's
// browser needs a link_token before Plaid Link will open, and the W5 brief scopes
// the adapter to exchange + balances only. Until that exists, `public_token` has
// to come from somewhere else — Plaid's sandbox helper, or a later workflow. This
// is a real gap, not an oversight, and it is written down on the board.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import {
  linkItem,
  syncItem,
  listItems,
  listAccounts,
  syncHistory,
  classifyAccount,
  isPlaidConfigured,
  ENTITY_KINDS,
  BankingError,
  PlaidNotConfiguredError,
  PlaidApiError
} from "../../src/banking/index.mjs";

const BANKING_ROLES = new Set(["owner", "admin", "funding_advisor"]);

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["staff"], { db });
  if (!principal) return;

  if (!BANKING_ROLES.has(String(principal.role || "").toLowerCase())) {
    // 403, not 404: the caller is authenticated and the resource exists. Hiding
    // that from a logged-in employee buys nothing and confuses whoever has to
    // explain why the button did nothing.
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  try {
    if (req.method === "GET") return await get(req, res, principal);
    if (req.method === "POST") return await post(req, res, principal);
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (e) {
    return fail(res, e);
  }
}

async function get(req, res, principal) {
  const q = req.query || {};
  if (!isUuid(q.client_id)) return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
  if (!(await clientInOrg(q.client_id, principal.orgId))) {
    return res.status(404).json({ ok: false, error: "no such client" });
  }

  if (q.history === "1" || q.history === "true") {
    return res.status(200).json({ ok: true, syncs: await syncHistory(db, { clientId: q.client_id }) });
  }

  /* `configured` is reported on the read so a screen can say "bank linking is
     unavailable on this deploy" instead of showing a button that 503s. An
     unconfigured platform is a deployment state, and the caller is entitled to
     know it before spending a client's time on a Link session. */
  return res.status(200).json({
    ok: true,
    configured: isPlaidConfigured(),
    items: await listItems(db, { clientId: q.client_id }),
    accounts: await listAccounts(db, { clientId: q.client_id })
  });
}

async function post(req, res, principal) {
  const body = req.body || {};

  if (body.action === "link") {
    if (!isUuid(body.client_id)) return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
    if (typeof body.public_token !== "string" || !body.public_token.trim()) {
      return res.status(400).json({ ok: false, error: "public_token is required" });
    }
    if (!(await clientInOrg(body.client_id, principal.orgId))) {
      return res.status(404).json({ ok: false, error: "no such client" });
    }

    const out = await linkItem(db, {
      orgId: principal.orgId,
      clientId: body.client_id,
      publicToken: body.public_token,
      institutionId: str(body.institution_id),
      institutionName: str(body.institution_name),
      // The session's staff id, never a name from the request body: an
      // attributable audit row cannot let the caller choose its own attribution.
      triggeredBy: principal.staffId
    });
    return res.status(200).json({ ok: true, item: out.item, accounts: out.accounts });
  }

  if (body.action === "sync") {
    if (!isUuid(body.item_id)) return res.status(400).json({ ok: false, error: "item_id must be a uuid" });
    if (!(await rowInOrg("plaid_items", body.item_id, principal.orgId))) {
      return res.status(404).json({ ok: false, error: "no such linked bank item" });
    }
    const out = await syncItem(db, { itemRowId: body.item_id, triggeredBy: principal.staffId });
    return res.status(200).json({ ok: true, item: out.item, accounts: out.accounts });
  }

  if (body.action === "classify") {
    if (!isUuid(body.account_id)) return res.status(400).json({ ok: false, error: "account_id must be a uuid" });
    if (body.business_id != null && !isUuid(body.business_id)) {
      return res.status(400).json({ ok: false, error: "business_id must be a uuid" });
    }
    if (!ENTITY_KINDS.includes(body.entity_kind)) {
      return res.status(400).json({ ok: false, error: `entity_kind must be one of: ${ENTITY_KINDS.join(", ")}` });
    }
    if (!(await rowInOrg("bank_accounts", body.account_id, principal.orgId))) {
      return res.status(404).json({ ok: false, error: "no such bank account" });
    }
    const account = await classifyAccount(db, {
      accountRowId: body.account_id,
      entityKind: body.entity_kind,
      businessId: body.business_id ?? null,
      setBy: principal.staffId
    });
    return res.status(200).json({ ok: true, account });
  }

  return res.status(400).json({ ok: false, error: "action must be one of: link, sync, classify" });
}

/* TENANCY. Every id in a request body is attacker-chosen. Without these checks a
   funding advisor at one org could name another org's client uuid and read — or
   sync — their bank accounts, because the service functions take the ids they are
   given. 404 rather than 403 here on purpose: a caller who is not in the org
   should not learn that the row exists. */
async function clientInOrg(clientId, orgId) {
  if (!orgId) return false;
  const r = await db.query(`SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`, [clientId, orgId]);
  return r.rowCount > 0;
}

async function rowInOrg(table, id, orgId) {
  if (!orgId) return false;
  // The table name is never caller-supplied — both call sites pass a literal.
  const r = await db.query(`SELECT 1 FROM ${table} WHERE id = $1 AND org_id = $2`, [id, orgId]);
  return r.rowCount > 0;
}

function fail(res, e) {
  if (e instanceof PlaidNotConfiguredError) {
    /* 503, matching api/inquiry.mjs. Unconfigured is a deployment state, not a
       crash: the code is fine and there is nothing to retry until an operator
       sets a variable. The message names variables and never values. */
    return res.status(503).json({ ok: false, error: "not_configured", message: e.message });
  }

  if (e instanceof PlaidApiError) {
    /* PLAID'S STATUS IS NEVER MIRRORED BACK. Plaid answering 401 means our keys
       are wrong; returning 401 to this caller would tell a signed-in employee
       they are signed out and send them to re-authenticate a session that is
       perfectly good. An upstream refusal is a 502 with Plaid's own code
       attached, which is the thing support can actually act on. The message has
       already been scrubbed of every credential by the adapter. */
    const ourOwnValidation = e.status === 400 && !e.errorCode;
    if (ourOwnValidation) return res.status(400).json({ ok: false, error: "bad_request", message: e.message });
    return res.status(502).json({
      ok: false,
      error: "plaid_error",
      plaid_error_code: e.errorCode,
      retryable: !!e.retryable,
      message: e.message
    });
  }

  if (e instanceof BankingError) return res.status(e.status).json({ ok: false, error: e.message });
  if (CLIENT_DATA_ERRORS.has(e.code)) return res.status(400).json({ ok: false, error: "bad request parameter" });
  throw e;
}

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
