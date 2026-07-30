// GET /api/hiring/candidates — the pipeline board.
//
//   ?state=applied|screening|group_interview|one_on_one|offer|hired|onboarding|ramp|performing|rejected|withdrawn|all
//   ?role=closer|setter|sales_coordinator   ?source=   ?flagged=1   ?limit= ?offset=
//
// ROLE-GATED TO HIRING, not STAFF. This carries applicant PII and the scoring trail
// of an automated employment decision tool.
//
// THE SCORE IS SHOWN WITH ITS FLAGS AND ITS RUBRIC VERSION, always together. A
// reviewer who sees "2.1" and decides is exactly the rubber-stamping that turns a
// decision-support tool into a de-facto automated decision — the thing NYC Local
// Law 144 and Title VII adverse-impact analysis are aimed at. So the flags travel
// with the number, and `recommendation` is rendered as advice rather than a verdict.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

const STAGES = ["applied", "screening", "group_interview", "one_on_one", "offer",
                "hired", "onboarding", "ramp", "performing", "rejected", "withdrawn"];
const ROLES = ["closer", "setter", "sales_coordinator"];

/* Exported so src/hiring/hiring-endpoints.pg.test.mjs can execute the SQL. */
export const fetchRows = (db, { limit, offset, query }) => {
  const params = [limit + 1, offset];
  const where = [];

  const state = String(query.state || "all").toLowerCase();
  if (state !== "all" && STAGES.includes(state)) {
    params.push(state); where.push(`s.key = $${params.length}`);
  }
  if (ROLES.includes(String(query.role))) {
    params.push(query.role); where.push(`r.key = $${params.length}`);
  }
  if (query.source) { params.push(query.source); where.push(`c.source = $${params.length}`); }
  // The review queue: anything the grader flagged for a human, or that it could
  // not score. Both need a person, which is the whole point of the column.
  if (query.flagged === "1" || query.flagged === "true") {
    where.push(`(jsonb_array_length(COALESCE(sc.flags,'[]'::jsonb)) > 0 OR sc.average IS NULL)`);
  }

  return db.query(
    `SELECT a.id AS application_id, a.status, a.applied_at, a.entered_stage_at,
            c.id AS candidate_id, c.full_name, c.email, c.phone, c.source, c.source_detail,
            c.disc_profile, c.linkedin_profile_url,
            r.key AS role_key, r.name AS role_name,
            s.key AS stage_key, s.name AS stage_name, s.sort_order,
            sc.average, sc.recommendation, sc.flags, sc.rubric_version, sc.is_automated,
            (a.video_url IS NOT NULL) AS has_video,
            (a.resume_document_id IS NOT NULL) AS has_resume,
            -- Rendered next to the score so nobody reads a number as a decision.
            'advisory — a human decides' AS recommendation_status
       FROM candidate_applications a
       JOIN candidates c    ON c.id = a.candidate_id
       JOIN hiring_roles r  ON r.id = a.role_id
       JOIN pipeline_stages s ON s.id = a.stage_id
       LEFT JOIN LATERAL (
         SELECT average, recommendation, flags, rubric_version, is_automated
           FROM application_scores x
          WHERE x.application_id = a.id
          ORDER BY x.created_at DESC LIMIT 1
       ) sc ON true
      WHERE a.org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1)
        ${where.length ? "AND " + where.join(" AND ") : ""}
      ORDER BY s.sort_order, a.entered_stage_at DESC
      LIMIT $1 OFFSET $2`,
    params
  ).then((r) => r.rows);
};

const run = readHandler({ roles: ROLE_SETS.HIRING, fetch: fetchRows });

export default (req, res) => run(req, res, { db, requireAuth });
