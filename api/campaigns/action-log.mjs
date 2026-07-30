// GET /api/campaigns/action-log — every automated and human action, newest first.
//
//   ?state=agent|human|revertible|failed|all  ?target_type=  ?rule_key=  ?limit= ?offset=
//
// THIS IS THE PARTNER'S DEFENCE against their own autopilot, so it returns the
// whole story of each action rather than a summary: which rule fired, the metric
// values that triggered it, the before and after state, whether it actually
// executed, and whether it can still be reverted.
//
// undo_payload itself is NOT returned — only `revertible`. The payload is an
// instruction set for the revert endpoint, and publishing it invites a caller to
// construct their own. What the screen needs is a button, not the mechanism.
import { db } from "../../src/db.mjs";
import { partnerReadHandler } from "../../src/http/partner-read-api.mjs";

const TARGETS = ["campaign", "ad_set", "ad", "creative_asset", "connection", "social_post", "autopilot"];

/* fetchRows is exported so the SQL can be executed directly by
   src/http/creative-endpoints.pg.test.mjs. An endpoint whose query only ever runs
   behind an HTTP handler is one whose column names go unchecked until a partner
   opens the screen. */
export const fetchRows = (tx, { limit, offset, query }) => {
  const params = [limit + 1, offset];
  const where = [];

  switch (String(query.state || "all").toLowerCase()) {
    case "agent":      where.push("l.actor = 'agent'"); break;
    case "human":      where.push("l.actor = 'human'"); break;
    case "revertible": where.push("l.undo_payload IS NOT NULL AND l.undone_at IS NULL"); break;
    // Actions logged but never executed, or executed with a platform error.
    // This is the queue somebody has to look at, so it is a first-class filter.
    case "failed":     where.push("(l.execute_error IS NOT NULL OR l.executed_at IS NULL)"); break;
    default: break;
  }
  if (TARGETS.includes(String(query.target_type))) {
    params.push(query.target_type); where.push(`l.target_type = $${params.length}`);
  }
  if (query.rule_key) { params.push(query.rule_key); where.push(`l.rule_key = $${params.length}`); }

  return tx.query(
    `SELECT l.id, l.actor, l.agent_id, l.target_type, l.target_id, l.rule_key,
            l.reason, l.metrics_snapshot, l.before, l.after,
            l.executed_at, l.execute_error, l.undone_at, l.created_at,
            (l.undo_payload IS NOT NULL AND l.undone_at IS NULL) AS revertible,
            g.name AS agent_name,
            acct.name AS user_name
       FROM action_log l
       LEFT JOIN agents   g    ON g.id = l.agent_id
       LEFT JOIN accounts acct ON acct.id = l.user_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY l.created_at DESC
      LIMIT $1 OFFSET $2`,
    params
  ).then((r) => r.rows);
};

const run = partnerReadHandler({
  fetch: fetchRows,

});

export default (req, res) => run(req, res, { db });
