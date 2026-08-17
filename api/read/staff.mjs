// GET /api/read/staff — staff directory — password_hash is stripped by redact() and never selected
//
// Read-only. Auth + role gate + pagination + redaction all come from
// src/http/read-api.mjs; this file is its SQL and nothing else. See that module
// for why the role default is deny and what redact() strips.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";
import { SEED_FURNITURE_EMAILS } from "../../src/auth/seed-staff.mjs";
import { orgDemoModeEnabled } from "../../src/demo/exclude-demo.mjs";

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
  fetch: async (db, { limit, offset, query, staff }) => {
    const demoOn = await orgDemoModeEnabled(db, orgOf(staff));
    const demoHide = demoOn ? "" : `
       AND s.name NOT ILIKE 'DEMO %'
       AND s.email NOT LIKE '%@demo.fundhub.local'
       AND s.email NOT LIKE '%@example.com'`;
    return db.query(`SELECT s.id, s.name, s.email, s.role, s.status, s.assignment_order,
           s.last_assigned_at, s.created_at,
           s.monitoring_consent_at, s.hubstaff_user_id,
           (SELECT count(*)::int FROM tasks t
             WHERE t.assignee_staff_id = s.id AND t.done = false) AS open_tasks,
           (SELECT count(*)::int FROM shifts sh
             WHERE sh.staff_id = s.id AND sh.ended_at IS NULL) AS open_shift,
           (SELECT count(*)::int FROM staff_events se
             WHERE se.staff_id = s.id
               AND se.kind IN ('monitor_activity','monitor_screenshot')
               AND se.created_at >= date_trunc('day', now())) AS monitor_events_today
      FROM staff s
     WHERE s.org_id = $4::uuid
       AND ($3::text IS NULL OR s.role = $3)
       AND s.role <> 'owner'
       AND lower(s.email) <> ALL($5::text[])
       AND s.name NOT ILIKE 'TEST —%'
       ${demoHide}
     ORDER BY s.name
     LIMIT $1 OFFSET $2`, [
      limit + 1, offset, query.role || null, orgOf(staff),
      SEED_FURNITURE_EMAILS.map((e) => e.toLowerCase())
    ]).then((r) => r.rows);
  }
});

export default (req, res) => run(req, res, { db, requireAuth });
