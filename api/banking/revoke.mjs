// /api/banking/revoke — disconnect a bank login.
//
//   GET  ?client_id=<uuid>            → { ok, logins }   what is connected
//   POST { item_id, reason }          → { ok, revoked, removed, kept, ... }
//
// *** THIS DOES NOT REVOKE ACCESS AT THE BANK. *** It removes this system's
// stored credential and its record of the accounts. Nothing in this repository
// transmits, so the provider-side revoke is a named empty seam in
// src/banking/revoke.mjs. The response says so on every call — `provider_revoked`
// is false with a reason — because a caller reading "revoked: true" as "the bank
// connection is torn down" would be wrong in the one direction that matters.
//
// A POST, NOT A GET, AND NOT IDEMPOTENT-BY-METHOD. Same reasoning as
// api/finance/soft-pull.mjs and api/pii.mjs: this permanently removes a
// credential and a set of account records. GETs get prefetched, retried, cached
// and logged with their query strings, and a link scanner must not be able to
// disconnect somebody's bank.
//
// THE REASON IS REQUIRED HERE, IN THE HANDLER, NOT IN THE BROWSER. curl and a
// script have to obey it too, so the check is on this side of the wire, the
// service module checks it again, and migration 102's column is NOT NULL with a
// length CHECK besides.
//
// THE ROLE GATE IS TWO CALLS, AND THAT IS THE POINT. requireAuth's third
// argument is `opts`, forwarded to authenticate(), which reads only { db, env }.
// A `roles` key there is silently dropped — that is the exact bug
// src/http/auth-gate.test.mjs exists to catch, and it shipped once on
// api/read/tradelines.mjs with a client's credit limits behind it. So: one call
// to authenticate, a SECOND call to requireRole() that actually gates.
//
// THE SET IS OWNER AND ADMIN ONLY, NARROWER THAN ROLE_SETS.STAFF, and it is
// spelled out here rather than inherited from a convenient constant — the same
// choice api/finance/soft-pull.mjs makes. A closer working a file has no reason
// to be able to destroy the bank connection behind it. Widening this should cost
// somebody an edit to this line and a sentence explaining it.
//
// ORG SCOPE COMES FROM THE SESSION. staff.org_id, never a request body. A body
// field cannot redirect this at another org's bank login, and the service module
// puts the org in the WHERE clause rather than checking it afterwards.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole } from "../../src/http/read-api.mjs";
import { revokeBankLogin, listBankLogins, RevokeError } from "../../src/banking/revoke.mjs";

/* Employees who may disconnect a bank login. Deny by default: an endpoint that
   does not list roles admits nobody. `owner` is listed explicitly rather than
   relied on as a super-role, because an implicit super-role is exactly the kind
   of thing that should not be implicit on a destructive endpoint. */
const REVOKE_ROLES = new Set(["owner", "admin"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v.trim());

export default async function handler(req, res) {
  // 1. Authenticate.
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;

  // 2. THE SECOND CALL. This is the one that gates. See the header.
  if (!requireRole(res, staff, REVOKE_ROLES)) return;

  // FAIL CLOSED ON A SESSION WITH NO ORG. Without it every query below would be
  // unscoped, and an unscoped revoke is a revoke of somebody else's bank login.
  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden", message: "this session has no organisation" });
  }

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      const logins = await listBankLogins(db, { orgId, clientId: String(q.client_id).trim() });
      return res.status(200).json({ ok: true, logins });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      if (!isUuid(body.item_id)) {
        return res.status(400).json({ ok: false, error: "item_id must be a uuid" });
      }

      const out = await revokeBankLogin(db, {
        orgId,
        itemId: String(body.item_id).trim(),
        // ATTRIBUTION FROM THE SESSION, NEVER FROM THE BODY. A caller choosing
        // its own attribution is a caller with no attribution.
        requestedBy: {
          staffId: staff.id,
          label: `${staff.name || "unnamed staff"} <${staff.id}>`
        },
        reason: body.reason
      });

      return res.status(200).json({
        ok: true,
        revoked: out.revoked,
        audit_id: out.auditId,
        item: out.item,
        removed: out.removed,
        kept: out.kept,
        // Stated on every successful call. See the header.
        provider_revoked: out.providerRevoked,
        provider_reason: out.providerReason,
        provider_note: out.providerNote
      });
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (e) {
    if (e instanceof RevokeError) return res.status(e.status).json({ ok: false, error: e.message });
    throw e;
  }
}
