// GET /api/campaigns/spend — today's spend against every applicable ceiling.
//
//   ?state=breached|ok|all
//
// Reads v_partner_spend_vs_ceiling from 046. The view is SECURITY INVOKER, so RLS
// applies to the caller — a partner sees only their own ceilings through it.
//
// WHAT THIS VIEW IS NOT. It reports our MIRROR's spend, which is what the
// pre-flight budget check uses. The kill switch deliberately does not read it: it
// queries the platform directly, so a sync failure that made this number look
// healthy cannot also disable the last line of defence. A screen showing green
// here is therefore not proof that spend is under control — which is why
// breached_at, set by the kill switch from platform truth, is surfaced alongside.
import { db } from "../../src/db.mjs";
import { partnerReadHandler } from "../../src/http/partner-read-api.mjs";

/* fetchRows is exported so the SQL can be executed directly by
   src/http/creative-endpoints.pg.test.mjs. An endpoint whose query only ever runs
   behind an HTTP handler is one whose column names go unchecked until a partner
   opens the screen. */
export const fetchRows = (tx, { limit, offset, query }) => {
  const params = [limit + 1, offset];
  const where = [];
  const state = String(query.state || "all").toLowerCase();
  if (state === "breached") where.push("v.breached_at IS NOT NULL");
  else if (state === "ok")  where.push("v.breached_at IS NULL");

  return tx.query(
    `SELECT v.ceiling_id, v.scope, v.campaign_id, v.platform,
            v.daily_limit_cents, v.max_daily_increase_pct,
            v.spend_today_cents, v.headroom_cents, v.pct_of_ceiling,
            v.breached_at,
            c.name AS campaign_name,
            -- Named here rather than left to the screen so every reader agrees
            -- on what "nearly out of room" means.
            (v.breached_at IS NOT NULL)        AS breached,
            (v.headroom_cents = 0)             AS exhausted,
            (v.pct_of_ceiling >= 80)           AS approaching_ceiling
       FROM v_partner_spend_vs_ceiling v
       LEFT JOIN campaigns c ON c.id = v.campaign_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY v.scope, v.pct_of_ceiling DESC NULLS LAST
      LIMIT $1 OFFSET $2`,
    params
  ).then((r) => r.rows);
};

const run = partnerReadHandler({
  fetch: fetchRows,

});

export default (req, res) => run(req, res, { db });
