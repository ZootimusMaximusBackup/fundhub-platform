// /api/finance/soft-pull — the one-tap soft pull for a client already on file.
//
//   POST { client_id, reason, cost_cents?, subscription_id?, idempotency_key? }
//        → { ok, created, request }
//   GET  ?client_id=<uuid>[&limit=]
//        → { ok, requests }   the pull history for that client
//
// *** THIS ENDPOINT DOES NOT PULL ANYBODY'S CREDIT. ***
// It writes one row to `soft_pull_requests` with status='queued' and returns.
// Nothing in this repository transmits — there is no outbound fetch in
// src/adapters/ or src/lib/ — and the provider seam is named and empty in
// src/finance/soft-pulls.mjs. "created: true" means "recorded", not "requested
// at a bureau".
//
// A POST, NOT A GET, AND NOT IDEMPOTENT-BY-METHOD. Same reasoning as the SSN
// reveal in api/pii.mjs: this is an action with a permanent side effect on a
// consumer-credit record. GETs get prefetched, retried, cached and logged with
// their query strings, and a link-scanner must not be able to enter a person
// into a credit-pull ledger.
//
// THE REASON IS REQUIRED HERE, IN THE HANDLER, NOT IN THE BROWSER. api/pii.mjs
// carries the same paragraph and it was written after the identical rule lived
// only in a screen for as long as the route was unreachable. curl and a script
// have to obey it too, so the check is on this side of the wire and the column
// in 077 is NOT NULL besides.
//
// THE ROLE GATE IS NARROWER THAN ROLE_SETS.STAFF, DELIBERATELY, and it is
// spelled out here rather than inherited from a convenient constant — the same
// choice api/pii.mjs makes and for the same reason. A setter qualifying a lead
// has no business pulling that lead's credit, and an inquiry specialist works
// disputes off the file that already exists. Widening this set should cost
// somebody an edit to this line and a sentence explaining it.
//
// A CLIENT MAY REQUEST THEIR OWN, AND ONLY THEIR OWN. That is the "taps once"
// path in the portal. The client_id is checked against the session's own
// clientId — a body field cannot redirect a client principal at somebody else's
// credit file, exactly as a body field cannot redirect the SSN access log at
// another employee.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import {
  requestSoftPull,
  listSoftPullRequests,
  boundedLimit,
  SoftPullError
} from "../../src/finance/soft-pulls.mjs";

/* Employees who may ask for a client's credit to be pulled. `owner` is listed
   explicitly: this file does not go through requireRole(), so it does not get
   SUPER_ROLES for free, and an implicit super-role is exactly the kind of thing
   that should not be implicit on a credit-pull endpoint. */
const SOFT_PULL_ROLES = new Set(["owner", "admin", "closer", "funding_advisor"]);

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["staff", "client"], { db });
  if (!principal) return;

  if (principal.kind === "staff" && !SOFT_PULL_ROLES.has(String(principal.role || "").toLowerCase())) {
    // 403, not 404. The caller is a signed-in employee and the endpoint exists;
    // pretending otherwise only confuses the person who has to explain why the
    // button did nothing.
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!(await ownsClient(principal, q.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      const requests = await listSoftPullRequests(db, {
        clientId: String(q.client_id).trim(),
        limit: boundedLimit(q.limit)
      });
      return res.status(200).json({ ok: true, requests });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      if (!isUuid(body.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!(await ownsClient(principal, body.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }

      const orgId = principal.orgId;
      if (!orgId) {
        // A principal with no org cannot have a row written for them; refusing
        // beats picking a default org and filing the pull under the wrong one.
        return res.status(400).json({ ok: false, error: "org_id is required" });
      }

      const out = await requestSoftPull(db, {
        orgId,
        clientId: String(body.client_id).trim(),
        // Attribution comes from the SESSION, never from the body. A caller
        // choosing its own attribution is a caller with no attribution.
        requestedBy: principal.kind === "staff"
          ? { kind: "staff", id: principal.staffId }
          : { kind: "client", id: principal.accountId },
        reason: body.reason,
        // Cents in, cents stored, NULL preserved. Absent stays unknown; it is
        // not read as free.
        costCents: body.cost_cents ?? null,
        // W2 owns subscriptions. This endpoint takes the id as an opaque value
        // and imports nothing from that build.
        subscriptionId: isUuid(body.subscription_id) ? String(body.subscription_id).trim() : null,
        idempotencyKey: typeof body.idempotency_key === "string" ? body.idempotency_key : null
      });

      // 200 for both outcomes, with `created` telling them apart. A second tap
      // is not an error — the client's request IS recorded, which is what they
      // asked about — and answering 409 would put a red banner in front of
      // somebody whose pull is already in hand.
      return res.status(200).json({ ok: true, created: out.created, reason: out.reason ?? null, request: out.request });
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (e) {
    if (e instanceof SoftPullError) return res.status(e.status).json({ ok: false, error: e.message });
    if (CLIENT_DATA_ERRORS.has(e.code)) return res.status(400).json({ ok: false, error: "bad request parameter" });
    throw e;
  }
}

/* ownsClient — a staff principal may act on any client in their org, and the org
   is CHECKED, not assumed; a client principal may act only on themself.
   accounts.client_id is the binding, and it is the session's copy of it, not the
   body's.

   THE ORG CHECK IS THE POINT, NOT A FORMALITY. The write stamps the CALLER's
   org onto the row. Without this comparison, an employee at org A naming org B's
   consumer gets a credit pull filed in org A's compliance ledger against a
   person org A has no relationship with, while org B — the company that consumer
   actually signed with — has no record of it at all. A clients row that does not
   match the caller's org is refused rather than filed under the wrong one, the
   same instinct as the "org_id is required" refusal above. */
async function ownsClient(principal, clientId) {
  if (principal.kind === "staff") {
    if (!principal.orgId) return false;
    const r = await db.query(
      `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
      [String(clientId).trim(), principal.orgId]
    );
    return r.rows.length > 0;
  }
  return !!principal.clientId && String(principal.clientId) === String(clientId).trim();
}
