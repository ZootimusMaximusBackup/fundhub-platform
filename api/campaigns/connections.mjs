// GET /api/campaigns/connections — connected ad accounts and their verification
// state, plus the onboarding blockers that stop a launch.
//
//   ?state=pending|active|expired|revoked|needs_verification|all
//
// NO TOKEN LEAVES THIS ENDPOINT. The ciphertext columns are not selected, and
// redactConnection() runs over every row as a second pass — so even a future
// `SELECT a.*` added here cannot carry one out. Belt and braces because the spec
// is unambiguous: tokens are never returned by any API response.
//
// verification_state IS surfaced prominently, because it is the thing that blocks
// a credit-offer launch and the partner has to go and fix it on the platform. The
// blockers array is the same information as a task list, joined here so one call
// renders the whole onboarding panel.
import { db } from "../../src/db.mjs";
import { partnerReadHandler, stateFilter, redactConnection } from "../../src/http/partner-read-api.mjs";

const STATES = ["pending", "active", "expired", "revoked", "needs_verification"];

/* fetchRows is exported so the SQL can be executed directly by
   src/http/creative-endpoints.pg.test.mjs. An endpoint whose query only ever runs
   behind an HTTP handler is one whose column names go unchecked until a partner
   opens the screen. */
export const fetchRows = (tx, { limit, offset, query }) => {
  const state = stateFilter(query, "c.connection_state", STATES);
  const params = [limit + 1, offset, ...state.params];
  return tx.query(
    `SELECT c.id, c.platform, c.external_business_id, c.external_ad_account_id,
            c.connection_state, c.platform_verification_state, c.scopes,
            c.token_expires_at, c.last_error, c.last_synced_at, c.created_at,
            -- Presence, never value. redactConnection derives the same booleans
            -- from the ciphertext columns; these exist so the SQL is honest about
            -- what the screen gets even though those columns are not selected.
            (c.encrypted_access_token  IS NOT NULL) AS has_access_token,
            (c.encrypted_refresh_token IS NOT NULL) AS has_refresh_token,
            (c.token_expires_at IS NOT NULL AND c.token_expires_at < now()) AS token_expired,
            -- Can this connection launch a credit offer? Both facts, resolved
            -- here so no caller re-derives the rule.
            (c.connection_state = 'active') AS can_launch,
            (c.connection_state = 'active' AND c.platform_verification_state = 'approved')
              AS can_launch_credit_offer,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'task_key', t.task_key, 'title', t.title,
                       'detail', t.detail, 'severity', t.severity))
                FROM partner_onboarding_tasks t
               WHERE t.connection_id = c.id AND t.resolved_at IS NULL), '[]'::jsonb) AS blockers,
            (SELECT count(*)::int FROM campaigns cc WHERE cc.connection_id = c.id) AS campaign_count
       FROM ad_platform_connections c
      WHERE ${state.sql.replace("$$", `$${params.length}`)}
      ORDER BY c.platform, c.created_at
      LIMIT $1 OFFSET $2`,
    params
  ).then((r) => r.rows);
};

const run = partnerReadHandler({
  mapRow: redactConnection,
  fetch: fetchRows,

});

export default (req, res) => run(req, res, { db });
