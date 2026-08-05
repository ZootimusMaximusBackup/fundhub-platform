// GET /api/read/invoices — invoices with balance_due COMPUTED by v_invoice_balance, never stored
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
  roles: ROLE_SETS.FINANCE,
  fetch: (db, { limit, offset, query, staff }) =>
    db.query(`SELECT v.invoice_id AS id, v.client_id, v.source, v.status, v.currency,
           v.amount_due, v.amount_paid, v.balance_due, v.open_balance, v.settlement_state,
           v.payment_count, v.last_payment_at, v.due_at, v.sent_at, v.paid_at,
           v.reminder_count, v.escalated_at, v.written_off_at, v.voided_at, v.created_at
      FROM v_invoice_balance v
      JOIN invoices i ON i.id = v.invoice_id
     WHERE v.org_id = $5::uuid
       AND ($3::uuid IS NULL OR v.client_id = $3)
       AND ($4::text IS NULL OR v.status = $4)
       AND COALESCE(i.is_demo, false) = false
     ORDER BY v.created_at DESC
     LIMIT $1 OFFSET $2`, [limit + 1, offset, query.client_id || null, query.status || null, orgOf(staff)]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });
