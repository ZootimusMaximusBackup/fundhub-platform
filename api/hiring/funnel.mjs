// GET /api/hiring/funnel — conversion by stage and by source.
//
//   ?role=closer|setter|sales_coordinator   ?days=<n, default 90, cap 730>
//
// WHY BY SOURCE. Doc 10 prescribes an order — "Referrals → Client Base → Audience
// → Broad Social Media → Ads & Job Boards" — on the argument that the earlier
// sources yield better-aligned candidates. That is a testable claim, and this is
// what tests it. If job-board applicants convert as well as referrals, the
// prescribed order is costing effort for nothing; if they convert far worse, the
// order is doing real work. Either way it should be measured rather than assumed.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

export const fetchRows = (db, { limit, offset, query }) => {
  const days = Math.min(Math.max(parseInt(query.days ?? "90", 10) || 90, 1), 730);
  const params = [limit + 1, offset, days];
  const where = [];
  if (query.role) { params.push(query.role); where.push(`r.key = $${params.length}`); }

  return db.query(
    `WITH scoped AS (
       SELECT c.source, r.key AS role_key, s.key AS stage_key, s.sort_order, a.status
         FROM candidate_applications a
         JOIN candidates c    ON c.id = a.candidate_id
         JOIN hiring_roles r  ON r.id = a.role_id
         JOIN pipeline_stages s ON s.id = a.stage_id
        WHERE a.org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1)
          AND a.applied_at > now() - ($3::int || ' days')::interval
          ${where.length ? "AND " + where.join(" AND ") : ""}
     )
     SELECT source, role_key,
            count(*)::int AS applications,
            count(*) FILTER (WHERE sort_order >= 2)::int AS reached_group_interview,
            count(*) FILTER (WHERE sort_order >= 3)::int AS reached_one_on_one,
            count(*) FILTER (WHERE sort_order >= 4 AND stage_key <> 'rejected')::int AS reached_offer,
            count(*) FILTER (WHERE status = 'hired')::int AS hired,
            count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
            -- Doc 10: "Typically 10% or less of potential candidates will be
            -- A-Players." This is the column that says whether that holds here.
            CASE WHEN count(*) = 0 THEN NULL
                 ELSE round(100.0 * count(*) FILTER (WHERE status = 'hired') / count(*), 1)
            END AS hire_rate_pct
       FROM scoped
      GROUP BY source, role_key
      ORDER BY applications DESC
      LIMIT $1 OFFSET $2`,
    params
  ).then((r) => r.rows);
};

const run = readHandler({ roles: ROLE_SETS.HIRING, fetch: fetchRows });

export default (req, res) => run(req, res, { db, requireAuth });
