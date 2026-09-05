// GET /api/read/client-progress — every fact the client progress page draws.
//
// The page is a client-side renderer over this JSON. NOTHING SERVER-RENDERED IS
// STORED — that is the pattern public/contract.html already uses and explains at
// :14-24, and it is why the stored-HTML hardening on api/documents/[id].mjs does
// not have to be repeated here.
//
// AUTH IS PORTAL-SUMMARY'S, LINE FOR LINE (api/read/portal-summary.mjs:43-51). A
// client principal is pinned to its own file and may not name another; staff
// must pass ?client_id=. Copied deliberately rather than paraphrased: that block
// is pinned by src/http/simplify-implementation.test.mjs as the proof this class
// of endpoint reads the SESSION's client, and a paraphrase is how the two drift.
//
// FACTS, NOT COPY. See src/progress/read.mjs — the words a client reads are the
// front end's.
//
// COMPLIANCE REVIEW REQUIRED — fee timing. The payload quotes a price for a
// self-serve dispute round. It charges nobody: no processor call, no stored card
// token, and nothing here mints a checkout link.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, redact } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { readClientProgress } from "../../src/progress/read.mjs";

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["staff", "client"], { db });
  if (!principal) return;

  let orgId = null;
  let clientId = null;

  if (principal.kind === "client") {
    /* PINNED TO SELF. The client_id comes off the SESSION and a `client_id` in
       the query string is not read at all — not validated and then ignored, not
       compared, just never consulted. There is no branch here in which a client
       reaches another client's file. */
    clientId = principal.clientId || null;
    orgId = principal.orgId || null;
    if (!clientId || !orgId) {
      return res.status(403).json({
        ok: false,
        error: "forbidden",
        message: "Your login is not attached to a client file."
      });
    }
  } else {
    const staff = principal.staff || { role: principal.role };
    if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;
    orgId = staff.org_id || null;
    if (!orgId) {
      return res.status(400).json({ ok: false, error: "org_required" });
    }
    const qid = req.query && req.query.client_id;
    if (qid != null && qid !== "" && !isUuid(qid)) {
      return res.status(400).json({ ok: false, error: "invalid_client_id" });
    }
    clientId = qid || null;
    if (!clientId) {
      return res.status(400).json({
        ok: false,
        error: "client_id_required",
        message: "Pick a client to load their progress."
      });
    }
  }

  try {
    /* THE CLIENT MUST EXIST IN THIS ORG. Without this a staff member of org A
       naming a uuid from org B gets a 200 with an empty page rather than a 404,
       and "empty" is indistinguishable from "new client". */
    const exists = await db.query(
      `SELECT 1 FROM clients WHERE id = $1::uuid AND org_id = $2::uuid`,
      [clientId, orgId]
    );
    if (!exists.rows.length) {
      return res.status(404).json({ ok: false, error: "client_not_found" });
    }

    const payload = await readClientProgress(db, { orgId, clientId });
    return res.status(200).json(redact({ ok: true, ...payload }));
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "read_failed",
      message: "Something went wrong loading your progress.",
      detail: safeError(err)
    });
  }
}
