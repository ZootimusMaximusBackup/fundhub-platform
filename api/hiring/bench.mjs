// GET /api/hiring/bench — the always-on bench, per role.
//
// This is the screen that makes "always be recruiting" visible. Doc 10: "If you
// only recruit when you're in NEED you're more likely to have lower standards…
// ideally have 4-5 potential reps on your bench."
//
// bench_count deliberately counts only candidates past the group interview — the
// definition lives in v_hiring_bench so no caller re-derives it. A dashboard
// counting everyone who applied would show a healthy bench built from unscreened
// applications, which is the same as having no bench and believing you do.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

export const fetchRows = (db, { limit, offset }) =>
  db.query(
    `SELECT b.role_key, b.role_name, b.bench_target, b.bench_count, b.bench_shortfall,
            b.open_applications,
            st.name AS hiring_manager,
            (b.bench_shortfall > 0) AS short,
            (b.hiring_manager_staff_id IS NULL) AS unrouted,
            -- Where the shortfall actually is, so "go recruit" has a direction.
            (SELECT count(*)::int FROM candidate_applications a
               JOIN pipeline_stages s ON s.id = a.stage_id
              WHERE a.role_id = b.role_id AND a.status = 'open' AND s.key = 'applied')
              AS awaiting_screen,
            (SELECT count(*)::int FROM candidate_applications a
               JOIN pipeline_stages s ON s.id = a.stage_id
              WHERE a.role_id = b.role_id AND a.status = 'open' AND s.key = 'group_interview')
              AS awaiting_group_interview
       FROM v_hiring_bench b
       LEFT JOIN staff st ON st.id = b.hiring_manager_staff_id
      WHERE b.org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1)
      ORDER BY b.bench_shortfall DESC, b.role_key
      LIMIT $1 OFFSET $2`,
    [limit + 1, offset]
  ).then((r) => r.rows);

const run = readHandler({ roles: ROLE_SETS.HIRING, fetch: fetchRows });

export default (req, res) => run(req, res, { db, requireAuth });
