// POST /api/repair/generate — analyse a client's stored credit file and store
// the dispute letters it supports. Body: { client_id, round? }.
//
// THIS ENDPOINT MAILS NOTHING. It writes dispute_cases / dispute_items /
// dispute_letters and moves the optimization card so the client appears on the
// Repair desk with a Send available. Actually mailing is a separate, human
// action: POST /api/repair/send.
//
// Role gate: owner, admin, inquiry_specialist — the same three as
// api/repair/exceptions.mjs. Written as requireAuth followed by a SEPARATE
// requireRole call, because requireAuth forwards its third argument to
// authenticate(), which reads only { db, env } — a `roles` key there is
// silently dropped and the endpoint ends up with no gate at all
// (CLAUDE.md §12, src/http/auth-gate.test.mjs).

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid } from "../../src/http/read-api.mjs";
import { analyzeAndGenerate, ROUNDS } from "../../src/repair/analyze.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

/* Matches the enroll + Present fire path: owner, admin, closer, Specialist.
   Closers must be able to stage letters on the call (repair-build-spec §4.4).
   Written as requireAuth followed by a SEPARATE requireRole call. */
const REPAIR_ROLES = new Set(["owner", "admin", "closer", "inquiry_specialist"]);

/* Refusals that describe the client's real situation rather than a bad request.
   They answer 200 with ok:false, the shape src/repair/analyze.mjs returns, so a
   caller can show "no credit file on record" instead of an error. */
const HONEST_REFUSALS = new Set([
  "no_credit_file",
  "no_violations",
  "missing_identity",
  "no_authorization"
]);

const HONEST_MESSAGES = Object.freeze({
  no_credit_file: "No credit file on record for this client.",
  no_violations: "The credit file looks clean — nothing to dispute.",
  missing_identity: "Client is missing a legal name on the record.",
  no_authorization: "No signed dispute authorization on file."
});

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const auth = deps.requireAuth ?? requireAuth;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, REPAIR_ROLES)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  let body = {};
  try {
    body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
  } catch {
    return res.status(400).json({ ok: false, error: "invalid_json" });
  }

  const clientId = body.client_id || body.clientId;
  if (!isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "client_id_required" });
  }

  const round = body.round || body.round_key || "R1";
  if (!ROUNDS.includes(round)) {
    return res.status(400).json({ ok: false, error: "invalid_round", allowed: [...ROUNDS] });
  }

  try {
    const owned = await database.query(
      `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    );
    if (!owned.rows.length) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const result = await analyzeAndGenerate(database, {
      orgId,
      clientId,
      round,
      staffId: staff.id
    });

    if (!result.ok && !HONEST_REFUSALS.has(result.reason)) {
      return res.status(400).json({ ok: false, error: result.reason, ...result });
    }
    if (!result.ok && HONEST_REFUSALS.has(result.reason)) {
      return res.status(200).json({
        ...result,
        message: HONEST_MESSAGES[result.reason] || result.reason
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
