// POST /api/finance/crs-pull — queue a soft-pull row, then run CRS for ONE bureau.
//
//   POST { client_id, bureau: "TU"|"EX"|"EQ", idempotency_key? }
//        → { ok, bureau, request, crsResultId, bureausPulled }
//        or { ok: false, error, code }
//
// /api/finance/soft-pull ONLY records the request. This is the staff button
// that actually orders TransUnion, Experian, or Equifax. One bureau per tap.
// Scores are whatever CRS stored — this handler does not invent them.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requestSoftPull, SoftPullError } from "../../src/finance/soft-pulls.mjs";
import { runCrsPull } from "../../src/finance/crs-pull.mjs";

const CRS_PULL_ROLES = new Set(["owner", "admin", "closer", "funding_advisor"]);
const BUREAUS = new Set(["TU", "EX", "EQ"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const requirePrincipalFn = deps.requirePrincipal ?? requirePrincipal;
  const requestSoftPullFn = deps.requestSoftPull ?? requestSoftPull;
  const runCrsPullFn = deps.runCrsPull ?? runCrsPull;

  const principal = await requirePrincipalFn(req, res, ["staff"], { db: database });
  if (!principal) return;

  if (principal.kind !== "staff" || !CRS_PULL_ROLES.has(String(principal.role || "").toLowerCase())) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  }

  const body = req.body || {};
  if (!isUuid(body.client_id)) {
    return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
  }
  const bureau = String(body.bureau || "").trim().toUpperCase();
  if (!BUREAUS.has(bureau)) {
    return res.status(400).json({ ok: false, error: "bureau must be TU, EX, or EQ" });
  }

  const orgId = principal.orgId;
  if (!orgId) {
    return res.status(400).json({ ok: false, error: "org_id is required" });
  }

  try {
    if (!(await ownsClient(database, principal, body.client_id))) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    const queued = await requestSoftPullFn(database, {
      orgId,
      clientId: String(body.client_id).trim(),
      requestedBy: { kind: "staff", id: principal.staffId },
      reason: `staff ${bureau} bureau pull from client control panel`,
      idempotencyKey: typeof body.idempotency_key === "string" ? body.idempotency_key : null
    });

    const request = queued && queued.request;
    if (!request || !request.id) {
      return res.status(409).json({ ok: false, error: "the pull could not be recorded" });
    }

    const pulled = await runCrsPullFn(database, {
      orgId,
      clientId: String(body.client_id).trim(),
      requestId: request.id,
      bureaus: [bureau],
      accessedBy: principal.staffId ? `staff:${principal.staffId}` : "staff:crs-pull"
    });

    if (!pulled || pulled.ok === false) {
      return res.status(422).json({
        ok: false,
        error: pulled?.reason || "the bureau pull did not complete",
        code: pulled?.code || "failed",
        bureau
      });
    }

    return res.status(200).json({
      ok: true,
      bureau,
      request: pulled.request || request,
      crsResultId: pulled.crsResultId || null,
      bureausPulled: pulled.bureausPulled || [bureau]
    });
  } catch (e) {
    if (e instanceof SoftPullError) {
      const out = { ok: false, error: e.message };
      if (e.code) out.code = e.code;
      return res.status(e.status).json(out);
    }
    if (CLIENT_DATA_ERRORS.has(e.code)) return res.status(400).json({ ok: false, error: "bad request parameter" });
    throw e;
  }
}

async function ownsClient(database, principal, clientId) {
  if (principal.kind !== "staff" || !principal.orgId) return false;
  const r = await database.query(
    `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
    [String(clientId).trim(), principal.orgId]
  );
  return r.rows.length > 0;
}
