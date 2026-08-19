// GET /api/social/channels — the social accounts a partner has connected.
//
//   ?state=pending|active|expired|revoked|all
//
// WHY THIS FILE EXISTS. api/social/oauth.mjs has always written social_channels
// rows and nothing has ever been able to read them back, so Social Studio's
// connected-accounts tile counted zero however many accounts were connected. The
// screen was already written against this payload (public/app/social-studio.html
// renders has_access_token, has_refresh_token, token_expires_at, scopes,
// best_times, timezone and last_error); it was simply never handed one.
//
// NO TOKEN LEAVES THIS ENDPOINT. Same posture as api/campaigns/connections.mjs,
// which this is modelled on: the ciphertext columns are not selected, and
// redactConnection() runs over every row as a second pass — so even a future
// `SELECT c.*` added here cannot carry one out. Presence booleans only.
//
// THE GATE is partnerReadHandler's, not a hand-rolled one: requirePrincipal
// refuses any kind other than partner or staff, a partner principal is pinned to
// its own id (a partner_id in the query string is ignored, never honoured), and a
// staff caller must name a ?partner_id=. Every row then comes out of a
// withPartnerScope transaction, so the row-level policies apply as well.
import { db } from "../../src/db.mjs";
import { partnerReadHandler, stateFilter, redactConnection } from "../../src/http/partner-read-api.mjs";

const STATES = ["pending", "active", "expired", "revoked"];

/* fetchRows is exported so the SQL can be executed directly by
   src/http/social-channels.pg.test.mjs. An endpoint whose query only ever runs
   behind an HTTP handler is one whose column names go unchecked until a partner
   opens the screen. */
export const fetchRows = (tx, { limit, offset, query }) => {
  const state = stateFilter(query, "c.connection_state", STATES);
  const params = [limit + 1, offset, ...state.params];
  return tx.query(
    `SELECT c.id, c.channel, c.external_account_id, c.handle,
            c.connection_state, c.last_error, c.token_expires_at,
            c.scopes, c.best_times, c.timezone, c.created_at, c.updated_at,
            -- Presence, never value. redactConnection derives the same booleans
            -- from the ciphertext columns; these exist so the SQL is honest about
            -- what the screen gets even though those columns are not selected.
            (c.encrypted_access_token  IS NOT NULL) AS has_access_token,
            (c.encrypted_refresh_token IS NOT NULL) AS has_refresh_token,
            (c.token_expires_at IS NOT NULL AND c.token_expires_at < now()) AS token_expired,
            -- Can this account actually post? One rule, resolved here so no
            -- screen re-derives it from connection_state and gets it wrong.
            (c.connection_state = 'active') AS can_post
       FROM social_channels c
      WHERE ${state.sql.replace("$$", `$${params.length}`)}
      ORDER BY c.channel, c.created_at
      LIMIT $1 OFFSET $2`,
    params
  ).then((r) => r.rows);
};

const run = partnerReadHandler({
  mapRow: redactConnection,
  fetch: fetchRows,
});

export default (req, res) => run(req, res, { db });
