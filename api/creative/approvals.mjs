// GET /api/creative/approvals — the approval and review queue.
//
//   ?state=blocked|pending|awaiting_approval|all   ?limit= ?offset=
//
// TWO THINGS IN ONE LIST, because they are one job for the person doing it:
//   assets that are BLOCKED or PENDING compliance, with their reasons
//   campaigns AWAITING_APPROVAL, with what they are and what they will spend
//
// blocked_reasons is the load-bearing column here. The spec's rule is that a
// blocked asset is never silently dropped — it lands in a review queue WITH its
// reasons so the partner can see why. An endpoint that returned the asset without
// the reasons would satisfy the letter of that and none of the point.
import { db } from "../../src/db.mjs";
import { partnerReadHandler } from "../../src/http/partner-read-api.mjs";

/* fetchRows is exported so the SQL can be executed directly by
   src/http/creative-endpoints.pg.test.mjs. An endpoint whose query only ever runs
   behind an HTTP handler is one whose column names go unchecked until a partner
   opens the screen. */
export const fetchRows = (tx, { limit, offset, query }) => {
  const want = String(query.state || "all").toLowerCase();
  const wantAssets = want === "all" || want === "blocked" || want === "pending";
  const wantCampaigns = want === "all" || want === "awaiting_approval";

  // UNION ALL of two shapes, normalised to one row type so the screen renders a
  // single ordered queue rather than stitching two lists together by timestamp.
  return tx.query(
    `SELECT * FROM (
       SELECT 'creative_asset'::text AS item_type, a.id, a.compliance_state AS state,
              a.kind::text AS subtype, a.format AS detail,
              a.blocked_reasons AS reasons, NULL::bigint AS budget_cents,
              NULL::text AS offer_type, NULL::text AS platform,
              a.ai_generated, a.synthetic_performer, a.updated_at
         FROM creative_assets a
        WHERE $3 AND a.archived_at IS NULL
          AND a.compliance_state IN ('pending','blocked')
          AND ($5::text = 'all' OR a.compliance_state = $5)
       UNION ALL
       SELECT 'campaign'::text, c.id, c.approval_state,
              c.strategy_key, c.name,
              COALESCE(
                (SELECT jsonb_agg(jsonb_build_object('code', s.state, 'message', s.reasons))
                   FROM compliance_screenings s
                  WHERE s.subject_id = c.id AND s.subject_type = 'campaign'),
                '[]'::jsonb),
              c.budget_cents, c.offer_type, c.platform,
              NULL::boolean, NULL::boolean, c.updated_at
         FROM campaigns c
        WHERE $4 AND c.approval_state = 'awaiting_approval'
     ) q
     ORDER BY q.updated_at DESC
     LIMIT $1 OFFSET $2`,
    [limit + 1, offset, wantAssets, wantCampaigns,
     want === "blocked" || want === "pending" ? want : "all"]
  ).then((r) => r.rows);
};

const run = partnerReadHandler({
  fetch: fetchRows,

});

export default (req, res) => run(req, res, { db });
