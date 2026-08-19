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

/* mapRow — redact, THEN put back the two booleans the SQL worked out.

   redactConnection is the safety net and stays in the chain: it destructures
   encrypted_access_token / encrypted_refresh_token off the row, so no ciphertext
   can leave here even if somebody later adds `SELECT c.*` above.

   But it also derives has_access_token / has_refresh_token from those same two
   columns — and this endpoint deliberately never selects them, so on its own it
   wrote Boolean(undefined) = false over the correct answer. Every connected
   account then told the owner it had no sign-in key, which is the opposite of the
   truth and would have sent somebody re-connecting working accounts.

   The SQL values win because the SQL is the only one that looked at the columns.
   `=== true` rather than a plain read: a driver that ever hands back null or a
   string must not turn into a truthy "yes".

   mapRow is exported so src/http/social-channels.pg.test.mjs can assert against
   the rows this endpoint really ships, rather than against the raw rows — where
   the presence booleans are trivially right and the bug is invisible. */
export const mapRow = (row) => ({
  ...redactConnection(row),
  has_access_token: row.has_access_token === true,
  has_refresh_token: row.has_refresh_token === true,
});

const run = partnerReadHandler({
  mapRow,
  fetch: fetchRows,
});

export default (req, res) => run(req, res, { db });
