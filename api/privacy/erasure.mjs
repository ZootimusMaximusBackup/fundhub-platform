// /api/privacy/erasure — erase a person, on an explicit request, with a record.
//
//   GET  ?client_id=<uuid>       → { ok, requests }  what has been done, and for whom
//   POST { client_id, reason }   → { ok, erased, removed, kept, audit_id }
//
// *** THERE IS NO SCHEDULE BEHIND THIS ENDPOINT. *** No retention sweep, no cron,
// no TTL, no background job. The only way anything is erased in this system is a
// named human calling this route with a written reason, and the audit row is
// written before anything is touched. See src/privacy/erasure.mjs section 1.
//
// IT DE-IDENTIFIES; IT DOES NOT DELETE THE PERSON'S ROW. Two reasons, both in
// that module's header: pii_access_log.client_id references clients(id) with no
// cascade so Postgres would refuse the delete outright, and a hard delete is
// itself the orphan bug — it would strand this person's bank transactions where
// no later request could ever find them. The response says exactly what was
// removed and exactly what was kept, with a written reason for each.
//
// A POST, NOT A GET. This is the most destructive action the product has. GETs
// get prefetched, retried and cached; a link scanner must not be able to erase a
// client. Same reasoning as api/pii.mjs and api/finance/soft-pull.mjs.
//
// THE ROLE GATE IS TWO CALLS. requireAuth's third argument is `opts`, forwarded
// to authenticate(), which reads only { db, env } — a `roles` key there is
// silently dropped, which is the bug src/http/auth-gate.test.mjs exists to catch.
// So: authenticate, then a SECOND requireRole() call that actually gates.
//
// OWNER AND ADMIN ONLY, and spelled out here rather than inherited. This is
// narrower than ROLE_SETS.STAFF on purpose and it should stay that way: erasure
// is irreversible, and the set of people who can perform one is a decision that
// deserves to cost an edit to this line.
//
// ORG SCOPE COMES FROM THE SESSION. staff.org_id, never a request body, and it
// goes into the WHERE clause rather than being checked afterwards.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole } from "../../src/http/read-api.mjs";
import { eraseClient, listErasureRequests, ErasureError } from "../../src/privacy/erasure.mjs";

/* Deny by default. `owner` listed explicitly rather than relied on as an
   implicit super-role — see api/finance/soft-pull.mjs for the same call. */
const ERASURE_ROLES = new Set(["owner", "admin"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v.trim());

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;

  // THE SECOND CALL. This is the one that gates.
  if (!requireRole(res, staff, ERASURE_ROLES)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden", message: "this session has no organisation" });
  }

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      // client_id is optional here: with it, "what was done about this person";
      // without it, "what removals has this org performed", which is the read a
      // periodic compliance review needs.
      const clientId = q.client_id === undefined || q.client_id === "" ? null : String(q.client_id).trim();
      if (clientId !== null && !isUuid(clientId)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      const requests = await listErasureRequests(db, { orgId, clientId, limit: q.limit });
      return res.status(200).json({ ok: true, requests });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      if (!isUuid(body.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }

      // CONFIRMATION IS REQUIRED AND IT IS NOT A BOOLEAN. `confirm: true` is one
      // typo in a script away from being sent by accident, and a JSON body with a
      // stray truthy value would erase somebody. Requiring the client's own id to
      // be repeated means the caller had to know which record they were erasing.
      if (String(body.confirm_client_id || "").trim() !== String(body.client_id).trim()) {
        return res.status(400).json({
          ok: false,
          error: "confirm_client_id must repeat client_id — erasure is irreversible and is not confirmed by a boolean"
        });
      }

      const out = await eraseClient(db, {
        orgId,
        clientId: String(body.client_id).trim(),
        // From the SESSION. Never from the body.
        requestedBy: {
          staffId: staff.id,
          label: `${staff.name || "unnamed staff"} <${staff.id}>`
        },
        reason: body.reason
      });

      return res.status(200).json({
        ok: true,
        erased: out.erased,
        audit_id: out.auditId,
        client_id: out.clientId,
        removed: out.removed,
        kept: out.kept
      });
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (e) {
    if (e instanceof ErasureError) return res.status(e.status).json({ ok: false, error: e.message });
    throw e;
  }
}
