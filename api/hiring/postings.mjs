// GET /api/hiring/postings — job postings and their sync state.
//
//   ?state=draft|posted|paused|closed|failed|all   ?channel=linkedin|facebook|job_board|internal
//
// last_error is returned verbatim. A LinkedIn posting rejection is the only thing
// that tells you why the job is not live, and paraphrasing it into "posting failed"
// strips the one detail that makes it fixable — same reasoning as the ad platform
// errors in api/campaigns/.
//
// NO TOKENS. hiring_channel_connections holds the ciphertext and is not joined here
// at all; the connection's health is reported as booleans by
// api/hiring/channels.mjs.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

const STATES = ["draft", "posted", "paused", "closed", "failed"];
const CHANNELS = ["linkedin", "facebook", "job_board", "internal"];

export const fetchRows = (db, { limit, offset, query }) => {
  const params = [limit + 1, offset];
  const where = [];
  const state = String(query.state || "all").toLowerCase();
  if (state !== "all" && STATES.includes(state)) {
    params.push(state); where.push(`p.status = $${params.length}`);
  }
  if (CHANNELS.includes(String(query.channel))) {
    params.push(query.channel); where.push(`p.channel = $${params.length}`);
  }

  return db.query(
    `SELECT p.id, p.channel, p.title, p.location, p.apply_url, p.status,
            p.posted_at, p.closed_at, p.last_error, p.last_synced_at, p.created_at,
            (p.external_id IS NOT NULL) AS is_published,
            r.key AS role_key, r.name AS role_name,
            (SELECT count(*)::int FROM candidate_applications a WHERE a.job_posting_id = p.id)
              AS applications,
            (SELECT count(*)::int FROM candidate_applications a
              WHERE a.job_posting_id = p.id AND a.applied_at > now() - interval '7 days')
              AS applications_7d
       FROM hiring_job_postings p
       JOIN hiring_roles r ON r.id = p.role_id
      WHERE p.org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1)
        ${where.length ? "AND " + where.join(" AND ") : ""}
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2`,
    params
  ).then((r) => r.rows);
};

const run = readHandler({ roles: ROLE_SETS.HIRING, fetch: fetchRows });

export default (req, res) => run(req, res, { db, requireAuth });
