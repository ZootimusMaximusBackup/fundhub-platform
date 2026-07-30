// GET /api/hiring/application?id=<uuid> — one application, everything about it.
//
// THE REVIEW SCREEN. This is what a person reads before deciding, so it carries the
// whole record rather than a summary: the answers as submitted, every score with its
// rubric version and flags, the interview outcomes, and the full decision history.
//
// SCORE HISTORY IS A LIST, NOT THE LATEST. If the grader scored an application and a
// human then re-scored it, both are shown. An override is a data point in any bias
// review, and showing only the final number would hide exactly the thing an audit
// looks for.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

export const fetchRows = async (db, { query }) => {
  const id = query.id;
  if (!id) { const e = new Error("id is required"); e.code = "BAD_REQUEST"; throw e; }

  const { rows } = await db.query(
    `SELECT a.id AS application_id, a.status, a.answers, a.applied_at, a.entered_stage_at,
            a.video_url, (a.resume_document_id IS NOT NULL) AS has_resume,
            c.id AS candidate_id, c.full_name, c.email, c.phone, c.source, c.source_detail,
            c.disc_profile, c.linkedin_profile_url, c.notes,
            r.key AS role_key, r.name AS role_name, r.scorecard, r.comp,
            s.key AS stage_key, s.name AS stage_name,
            p.title AS posting_title, p.channel AS posting_channel
       FROM candidate_applications a
       JOIN candidates c      ON c.id = a.candidate_id
       JOIN hiring_roles r    ON r.id = a.role_id
       JOIN pipeline_stages s ON s.id = a.stage_id
       LEFT JOIN hiring_job_postings p ON p.id = a.job_posting_id
      WHERE a.id = $1
        AND a.org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1)`,
    [id]);
  const application = rows[0];
  if (!application) return null;

  const [scores, interviews, decisions] = await Promise.all([
    db.query(
      `SELECT sc.id, sc.stage_key, sc.rubric_version, sc.category_scores, sc.average,
              sc.recommendation, sc.flags, sc.is_automated, sc.created_at,
              st.name AS scored_by_name
         FROM application_scores sc
         LEFT JOIN staff st ON st.id = sc.scored_by_staff_id
        WHERE sc.application_id = $1 ORDER BY sc.created_at ASC`, [id]).then((r) => r.rows),

    db.query(
      `SELECT i.id, i.kind, i.scheduled_for, i.status, i.meeting_url,
              at.attended, at.outcome, at.notes,
              st.name AS host_name
         FROM hiring_interview_attendees at
         JOIN hiring_interviews i ON i.id = at.interview_id
         LEFT JOIN staff st ON st.id = i.host_staff_id
        WHERE at.application_id = $1 ORDER BY i.scheduled_for ASC`, [id]).then((r) => r.rows),

    db.query(
      `SELECT d.id, d.decision, d.from_stage_key, d.to_stage_key, d.reason,
              d.recommendation_at_decision, d.candidate_notified_at, d.created_at,
              st.name AS decided_by_name, (d.decided_by IS NOT NULL) AS human_decided
         FROM hiring_decisions d
         LEFT JOIN staff st ON st.id = d.decided_by
        WHERE d.application_id = $1 ORDER BY d.created_at ASC`, [id]).then((r) => r.rows)
  ]);

  return {
    ...application,
    scores,
    interviews,
    decisions,
    // Rendered on the screen next to the score, so the reviewer is told in words
    // that the number is not the decision they are about to make.
    scoring_notice:
      "Scores are advisory. No candidate may be rejected without a named human and a " +
      "written reason; the database enforces this."
  };
};

const run = readHandler({ roles: ROLE_SETS.HIRING, fetch: fetchRows, single: true });

export default (req, res) => run(req, res, { db, requireAuth });
