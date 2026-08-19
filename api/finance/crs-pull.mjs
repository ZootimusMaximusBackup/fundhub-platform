// POST /api/finance/crs-pull — queue a soft-pull row, then run CRS for ONE bureau.
//
//   POST { client_id, bureau: "TU"|"EX"|"EQ", idempotency_key?, simulate? }
//        → { ok, bureau, simulated, request, crsResultId, bureausPulled }
//        or { ok: false, error, code, simulated }
//
// /api/finance/soft-pull ONLY records the request. This is the staff button
// that actually orders TransUnion, Experian, or Equifax. One bureau per tap.
// Scores are whatever CRS stored — this handler does not invent them.
//
// `simulate: true` REHEARSES THE PULL WITHOUT CONTACTING A BUREAU. The consent
// gate and the identity gate still run and still refuse first; only the vendor
// call is replaced. The whole design, and every place the result is stamped, is
// documented in src/finance/crs-pull.mjs — read that header before changing
// anything here.
//
// WHICH WAY EACH MISTAKE FALLS, stated plainly because it is the point:
//
//   simulate absent          → a REAL pull. Unchanged, and it has to stay that
//                              way: public/app/client-control-panel.html posts
//                              to this endpoint today without the field.
//   simulate: false          → a REAL pull.
//   simulate: true           → simulated. Nothing reaches a bureau.
//   simulate: anything else  → 400, and NO ledger row is created. Not a real
//                              pull, not a simulated one. "true" the string, 1
//                              and "yes" all land here on purpose: a value the
//                              server has to guess at is a value it refuses.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requestSoftPull, SoftPullError } from "../../src/finance/soft-pulls.mjs";
import { runCrsPull, simulationModeFor, SIMULATED_MARKER } from "../../src/finance/crs-pull.mjs";

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

  /* Read the simulate flag with the other body checks — BEFORE requestSoftPull,
     so an unreadable value never opens a ledger row it will not close. A queued
     row left behind blocks every later pull for that client. */
  const mode = simulationModeFor(body.simulate);
  if (mode === "refuse") {
    return res.status(400).json({
      ok: false,
      error: "simulate must be true or false",
      code: "simulate_invalid"
    });
  }
  const simulate = mode === "simulated";

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
      /* The ledger row's own reason says it too. soft_pull_requests.reason is
         what the pull history shows a human, and it is read straight out of the
         table long before anybody opens the jsonb payload. */
      reason: simulate
        ? `staff ${bureau} bureau pull from client control panel — ${SIMULATED_MARKER}`
        : `staff ${bureau} bureau pull from client control panel`,
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
      simulate,
      accessedBy: principal.staffId ? `staff:${principal.staffId}` : "staff:crs-pull"
    });

    if (!pulled || pulled.ok === false) {
      return res.status(422).json({
        ok: false,
        error: pulled?.reason || "the bureau pull did not complete",
        code: pulled?.code || "failed",
        bureau,
        simulated: pulled?.simulated === true
      });
    }

    return res.status(200).json({
      ok: true,
      bureau,
      /* Read off the run's own answer, not off the request body. The run reads
         it off the stored row, so a replay reports what was actually stored
         rather than what this caller asked for. */
      simulated: pulled.simulated === true,
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
