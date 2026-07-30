// /api/pii — identity data, per the Item 2 visibility spec.
//
//   GET  ?client_id=<uuid>              → { ok, identity }  masked: ssn_last4 only
//   GET  ?client_id=<uuid>&history=1    → { ok, access }     who has revealed it
//   POST { client_id, action: "reveal", reason }  → { ok, ssn }   ACCESS-LOGGED
//   POST { client_id, action: "store", ssn?, dob?, addresses? } → { ok, identity }
//
// THE ROLE GATE IS NARROWER THAN ROLE_SETS.STAFF, DELIBERATELY. STAFF includes
// setters and closers, who have no reason to see a client's social security
// number; the inquiry specialist does, because disputing an inquiry with a
// bureau requires identifying the consumer. Widening this set is a decision
// someone should have to make on purpose, in this file, rather than inherit by
// reusing a convenient constant.
//
// The reveal is a POST even though it reads. It is a disclosure with a
// side effect — a log row — and GETs get retried, prefetched, cached and
// logged with their query strings.
import { db } from "../src/db.mjs";
import { requirePrincipal } from "../src/http/middleware/requirePrincipal.mjs";
import { isUuid, CLIENT_DATA_ERRORS } from "../src/http/read-api.mjs";
import { readIdentity, revealSsn, storeIdentity, accessHistory, PiiError } from "../src/pii/index.mjs";

const IDENTITY_ROLES = new Set(["owner", "admin", "inquiry_specialist", "funding_advisor"]);

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["staff"], { db });
  if (!principal) return;

  if (!IDENTITY_ROLES.has(String(principal.role || "").toLowerCase())) {
    // 403, not 404: the caller is authenticated and the resource exists. Hiding
    // that fact from a logged-in employee buys nothing and confuses the person
    // who has to explain why the button did nothing.
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (!isUuid(q.client_id)) return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      if (q.history === "1" || q.history === "true") {
        return res.status(200).json({ ok: true, access: await accessHistory(db, { clientId: q.client_id }) });
      }
      const identity = await readIdentity(db, { clientId: q.client_id });
      return res.status(200).json({ ok: true, identity });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      if (!isUuid(body.client_id)) return res.status(400).json({ ok: false, error: "client_id must be a uuid" });

      if (body.action === "reveal") {
        const { ssn } = await revealSsn(db, {
          clientId: body.client_id,
          // The session's staff id, never a name from the request body: an
          // attributable log entry cannot let the caller choose its own
          // attribution.
          accessedBy: principal.staffId,
          reason: body.reason ?? null
        });
        return res.status(200).json({ ok: true, ssn });
      }

      if (body.action === "store") {
        if (!isUuid(body.org_id) && !principal.orgId) {
          return res.status(400).json({ ok: false, error: "org_id is required" });
        }
        const identity = await storeIdentity(db, {
          orgId: principal.orgId || body.org_id,
          clientId: body.client_id,
          ssn: body.ssn ?? null,
          dob: body.dob ?? null,
          addresses: body.addresses ?? []
        });
        return res.status(200).json({ ok: true, identity });
      }

      return res.status(400).json({ ok: false, error: "action must be one of: reveal, store" });
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (e) {
    if (e instanceof PiiError) return res.status(e.status).json({ ok: false, error: e.message });
    if (CLIENT_DATA_ERRORS.has(e.code)) return res.status(400).json({ ok: false, error: "bad request parameter" });
    throw e;
  }
}
