// GET/POST /api/social/posts — list the marketing post queue; queue or discard.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid } from "../../src/http/read-api.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { safeError } from "../../src/http/health.mjs";
import { schedule } from "../../src/social/scheduler.mjs";
import { SUITE_OFF, assertSuiteEnabled } from "../../src/brand/meter.mjs";

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db });
  if (!principal) return;

  const partnerId = resolvePartnerId(principal, {
    partner_id: (req.body && req.body.partner_id) || (req.query || {}).partner_id
  });
  if (!partnerId) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }

  try {
    if (req.method === "GET") {
      const items = await withPartnerScope({ kind: "partner", partnerId }, async (tx) => {
        const r = await tx.query(
          `SELECT id, caption, offer_type, scheduled_for, status, social_post_id,
                  blocked_reasons, created_at, updated_at
             FROM marketing_content_queue
            WHERE partner_id = $1
            ORDER BY created_at DESC
            LIMIT 100`,
          [partnerId]
        );
        return r.rows;
      });
      return res.status(200).json({ ok: true, items });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const action = String(body.action || "queue");
      if (!isUuid(body.id)) return res.status(400).json({ ok: false, error: "id_required" });

      const out = await withPartnerScope({ kind: "partner", partnerId }, async (tx) => {
        await assertSuiteEnabled(tx, partnerId);
        const row = (await tx.query(
          `SELECT * FROM marketing_content_queue WHERE id = $1 AND partner_id = $2`,
          [body.id, partnerId]
        )).rows[0];
        if (!row) {
          const e = new Error("not found");
          e.code = "NOT_FOUND";
          throw e;
        }

        if (action === "discard") {
          const u = await tx.query(
            `UPDATE marketing_content_queue
                SET status = 'discarded', updated_at = now()
              WHERE id = $1 RETURNING *`,
            [row.id]
          );
          return u.rows[0];
        }

        const channelId = body.channel_id;
        if (!channelId) {
          const when = body.scheduled_for || row.scheduled_for;
          const u = await tx.query(
            `UPDATE marketing_content_queue
                SET status = 'queued',
                    scheduled_for = COALESCE($2::timestamptz, scheduled_for),
                    updated_at = now()
              WHERE id = $1 RETURNING *`,
            [row.id, when || null]
          );
          return u.rows[0];
        }

        const org = (await tx.query(
          `SELECT org_id FROM partners WHERE id = $1`, [partnerId]
        )).rows[0];
        const scheduled = await schedule(tx, {
          orgId: org.org_id,
          partnerId,
          channelId,
          caption: row.caption,
          offerType: row.offer_type,
          scheduledFor: body.scheduled_for || row.scheduled_for
        });
        /* THREE ENDINGS, NOT TWO. src/social/scheduler.mjs returns 'blocked',
           'needs_approval' or 'passed', and 240 made the middle one real: that
           post is sitting in social_posts.status = 'awaiting_approval' and the
           sender cannot see it. Recording it here as 'scheduled' told the partner
           it was lined up to go out when nothing will ever send it — two tables
           saying different things about the same post, and the partner reading
           the wrong one. 243 adds the word this line needs. */
        const status =
          scheduled.state === "blocked" ? "blocked"
            : scheduled.state === "needs_approval" ? "awaiting_approval"
              : "scheduled";
        const u = await tx.query(
          `UPDATE marketing_content_queue
              SET status = $2,
                  social_post_id = $3,
                  blocked_reasons = $4::jsonb,
                  scheduled_for = COALESCE($5::timestamptz, scheduled_for),
                  updated_at = now()
            WHERE id = $1 RETURNING *`,
          [row.id, status, scheduled.post?.id || null,
           JSON.stringify(scheduled.reasons || []),
           body.scheduled_for || row.scheduled_for || null]
        );
        return { ...u.rows[0], social: scheduled };
      });
      return res.status(200).json({ ok: true, item: out });
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ ok: false, error: "not_found" });
    if (err.code === SUITE_OFF) {
      return res.status(403).json({ ok: false, error: "suite_off",
        message: "The owner has not turned this on for this partner." });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
