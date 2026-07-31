// GET /api/read/funding-rounds — funding rounds — submitted, approved and funded amounts
//
// Read-only. Auth + role gate + pagination + redaction all come from
// src/http/read-api.mjs; this file is its SQL and nothing else. See that module
// for why the role default is deny and what redact() strips.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

/* THE ORG COMES FROM THE SESSION AND IS REQUIRED (audit C1).
   A session with no org binds NULL, and `org_id = NULL::uuid` matches no row —
   it fails CLOSED. That is deliberate: the alternative, omitting the clause when
   the org is unknown, turns a broken session into a firehose over every
   company's rows. See src/http/read-api.mjs:150-153, which records the decision
   to leave scoping to each endpoint's own SQL — a decision that then went
   unimplemented in ten endpoints while the comment stayed. */
const orgOf = (staff) => (staff && staff.org_id) || null;

const run = readHandler({
  roles: ROLE_SETS.STAFF,
  fetch: (db, { limit, offset, query, staff }) =>
    db.query(`SELECT id, client_id, round_number, status, product, submitted_amount,
           approved_amount, funded_amount, hold_reason, conditions, created_at
      FROM funding_rounds
     WHERE org_id = $5::uuid
       AND ($3::uuid IS NULL OR client_id = $3)
       AND ($4::text IS NULL OR status = $4)
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`, [limit + 1, offset, query.client_id || null, query.status || null, orgOf(staff)]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });
