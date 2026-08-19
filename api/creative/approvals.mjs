// GET /api/creative/approvals — the approval and review queue.
//
//   ?state=blocked|pending|awaiting_approval|all   ?limit= ?offset=
//
// THREE THINGS IN ONE LIST, because they are one job for the person doing it:
//   assets that are BLOCKED or PENDING compliance, with their reasons
//   campaigns AWAITING_APPROVAL, with what they are and what they will spend
//   partner BRANDS sent for review, which api/brand/review.mjs puts there
//
// THE BRAND ARM CARRIES ITS OWN partner_id PREDICATE, and it is not decoration.
// partner_brand is NOT one of the nineteen tables 045 isolates with RLS, so the
// scoped transaction does nothing for it — the WHERE clause is the only thing
// keeping one partner out of another's brand row. The two arms above it can lean
// on the policy; this one cannot.
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
export const fetchRows = (tx, { limit, offset, query, partnerId }) => {
  const want = String(query.state || "all").toLowerCase();
  const wantAssets = want === "all" || want === "blocked" || want === "pending";
  const wantCampaigns = want === "all" || want === "awaiting_approval";
  // A brand sitting in 'review' is waiting on the same person as a campaign
  // awaiting approval, so it answers to the same ?state= value.
  const wantBrands = want === "all" || want === "awaiting_approval";

  // UNION ALL of three shapes, normalised to one row type so the screen renders a
  // single ordered queue rather than stitching lists together by timestamp.
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
       UNION ALL
       SELECT 'partner_brand'::text, b.id, b.approval_status,
              'brand'::text, b.entity_name,
              '[]'::jsonb,
              NULL::bigint, NULL::text, NULL::text,
              NULL::boolean, NULL::boolean,
              -- Sort by when it was SENT, not when it was last edited, so the
              -- oldest wait sits where a reviewer looks first. Older rows have
              -- no submitted_at at all; fall back rather than drop them.
              COALESCE(b.submitted_at, b.updated_at)
         FROM partner_brand b
        WHERE $6 AND b.partner_id = $7 AND b.approval_status = 'review'
     ) q
     ORDER BY q.updated_at DESC
     LIMIT $1 OFFSET $2`,
    [limit + 1, offset, wantAssets, wantCampaigns,
     want === "blocked" || want === "pending" ? want : "all",
     wantBrands, partnerId]
  ).then((r) => r.rows);
};

const run = partnerReadHandler({
  fetch: fetchRows,

});

export default (req, res) => run(req, res, { db });
