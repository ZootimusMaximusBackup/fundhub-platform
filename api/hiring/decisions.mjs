// GET /api/hiring/decisions — the AEDT audit trail.
//
//   ?state=reject|advance|offer|all   ?role=   ?days=<n, default 90, cap 730>
//
// THIS ENDPOINT EXISTS FOR THE BIAS AUDIT. NYC Local Law 144 requires an annual
// independent audit of any automated employment decision tool, and Title VII
// adverse-impact analysis requires being able to compare how similar candidates
// were treated. Neither is possible without a queryable record of what the tool
// recommended and what the human then did.
//
// So `recommendation_at_decision` sits next to `decision` in the same row, and
// `followed_recommendation` is derived here rather than left to a spreadsheet — the
// override rate is the single most useful number in an AEDT review, and it should
// not require somebody to reconstruct it by hand.
//
// NOTE ON WHAT IS *NOT* HERE. This returns no protected characteristics, because
// none are collected (see src/hiring/grading.mjs — the intake path strips them
// before storage). That means an adverse-impact analysis by race or sex cannot be
// run from this data alone and would need a separate, voluntary,
// self-identification survey held apart from the hiring record — which is the
// legally correct way to do it. Flagging it rather than implying this endpoint is
// sufficient on its own.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

const DECISIONS = ["advance", "reject", "offer", "offer_accepted", "offer_declined", "withdraw", "hold"];

export const fetchRows = (db, { limit, offset, query }) => {
  const days = Math.min(Math.max(parseInt(query.days ?? "90", 10) || 90, 1), 730);
  const params = [limit + 1, offset, days];
  const where = [];

  const state = String(query.state || "all").toLowerCase();
  if (state !== "all" && DECISIONS.includes(state)) {
    params.push(state); where.push(`d.decision = $${params.length}`);
  }
  if (query.role) { params.push(query.role); where.push(`r.key = $${params.length}`); }

  return db.query(
    `SELECT d.id, d.decision, d.from_stage_key, d.to_stage_key, d.reason,
            d.recommendation_at_decision, d.candidate_notified_at, d.created_at,
            r.key AS role_key,
            c.source,
            st.name AS decided_by_name,
            (d.decided_by IS NOT NULL) AS human_decided,
            sc.average AS score_at_decision, sc.rubric_version,
            -- The override rate, derived once here. A reviewer who always agrees
            -- with the machine is not a safeguard, and that is only visible if the
            -- comparison is a column rather than a manual exercise.
            CASE
              WHEN d.recommendation_at_decision IS NULL THEN NULL
              WHEN d.decision = 'reject'
                THEN d.recommendation_at_decision IN ('review_likely_no', 'incomplete')
              WHEN d.decision IN ('advance', 'offer')
                THEN d.recommendation_at_decision IN ('advance', 'advance_priority', 'review_maybe')
              ELSE NULL
            END AS followed_recommendation
       FROM hiring_decisions d
       JOIN candidate_applications a ON a.id = d.application_id
       JOIN candidates c    ON c.id = a.candidate_id
       JOIN hiring_roles r  ON r.id = a.role_id
       LEFT JOIN staff st   ON st.id = d.decided_by
       LEFT JOIN application_scores sc ON sc.id = d.score_id
      WHERE d.org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1)
        AND d.created_at > now() - ($3::int || ' days')::interval
        ${where.length ? "AND " + where.join(" AND ") : ""}
      ORDER BY d.created_at DESC
      LIMIT $1 OFFSET $2`,
    params
  ).then((r) => r.rows);
};

const run = readHandler({ roles: ROLE_SETS.HIRING, fetch: fetchRows });

export default (req, res) => run(req, res, { db, requireAuth });
