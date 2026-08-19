// GET/POST /api/social/settings — the "does a person have to approve a post"
// switch, plus the other partner_module_settings values Social Studio shows.
//
// WHY THIS FILE EXISTS. Social Studio read the setting off the partner row it got
// from /api/read/partners, and that endpoint has never carried one — so the
// approval card said "setting not read" for every partner, for both the owner and
// the partner. api/read/partners.mjs is finance-gated and shared with other
// screens, so the value is surfaced here instead of widening it.
//
// WHAT THE SETTING DOES TODAY, stated plainly because the screen has to say it:
// src/social/scheduler.mjs reads approve_before_launch and passes it to the
// guardrail screen, which turns it into a "needs approval" verdict. Nothing then
// waits for an approval — a needs-approval post is still queued and still sent.
// So this value changes what gets written down, not whether a post goes out.
// Returning it is what lets the screen tell the truth about that.
//
// GET  — the owning partner, or an owner/admin naming a partner_id.
// POST — the owner only. Same rule as api/partner-marketing/enable.mjs, which
//        governs the sibling switch on the same table.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { canAccessPartnerMarketing, isOwner } from "../../src/brand/meter.mjs";

/* readSettings is exported so the SQL can be executed directly by
   src/http/social-channels.pg.test.mjs, the same reason every fetchRows is.

   `stored` is the honest half of the answer. With no row on file nothing has been
   saved, and the screen must not print "your saved setting" over a default it
   invented. approve_before_launch still comes back as true in that case, because
   true is what src/social/scheduler.mjs falls back to — so the number the screen
   shows is the number the engine uses. */
export async function readSettings(tx, partnerId) {
  const r = await tx.query(
    `SELECT approve_before_launch, weekly_asset_target, max_concurrent_jobs,
            autopilot_enabled, launch_enabled, marketing_suite_enabled, updated_at
       FROM partner_module_settings
      WHERE partner_id = $1`,
    [partnerId]
  );
  const row = r.rows[0];
  if (!row) {
    return {
      stored: false,
      approve_before_launch: true,
      weekly_asset_target: null,
      max_concurrent_jobs: null,
      autopilot_enabled: false,
      launch_enabled: false,
      marketing_suite_enabled: false,
      updated_at: null
    };
  }
  return {
    stored: true,
    approve_before_launch: row.approve_before_launch === true,
    weekly_asset_target: row.weekly_asset_target,
    max_concurrent_jobs: row.max_concurrent_jobs,
    autopilot_enabled: row.autopilot_enabled === true,
    launch_enabled: row.launch_enabled === true,
    marketing_suite_enabled: row.marketing_suite_enabled === true,
    updated_at: row.updated_at
  };
}

/* writeApproval — upsert of the one column this endpoint may change. Every other
   column on the row is left alone; a settings write that quietly reset the token
   cap or the autopilot switch would be a different endpoint wearing this one's
   name. */
export async function writeApproval(tx, { orgId, partnerId, approve }) {
  if (!orgId || !partnerId) throw new Error("writeApproval: orgId and partnerId are required");
  const r = await tx.query(
    `INSERT INTO partner_module_settings (org_id, partner_id, approve_before_launch)
     VALUES ($1,$2,$3)
     ON CONFLICT (partner_id) DO UPDATE
       SET approve_before_launch = EXCLUDED.approve_before_launch,
           updated_at = now()
     RETURNING approve_before_launch`,
    [orgId, partnerId, approve === true]
  );
  return r.rows[0].approve_before_launch === true;
}

function partnerIdOf(req) {
  return (req.query && req.query.partner_id) || (req.body && req.body.partner_id);
}

function scopeFor(principal) {
  return principal.kind === "partner"
    ? { kind: "partner", partnerId: principal.partnerId }
    : { kind: "staff" };
}

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["staff", "partner"], { db });
  if (!principal) return;

  const partnerId = partnerIdOf(req);
  if (!isUuid(partnerId)) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }
  if (!canAccessPartnerMarketing(principal, partnerId)) {
    return res.status(403).json({ ok: false, error: "forbidden",
      message: "only the owning partner or an admin may read this" });
  }

  try {
    if (req.method === "GET") {
      const settings = await withPartnerScope(scopeFor(principal), (tx) =>
        readSettings(tx, partnerId));
      return res.status(200).json({ ok: true, partner_id: partnerId, settings });
    }

    if (req.method === "POST") {
      // The owner only, matching enable.mjs. This switch is the record of who has
      // to look at a post before it goes out; an admin flipping it off would be a
      // compliance change nobody asked for.
      if (!isOwner(principal)) {
        return res.status(403).json({ ok: false, error: "forbidden",
          message: "only the owner can change who has to approve a post" });
      }
      const approve = req.body && req.body.approve_before_launch;
      if (typeof approve !== "boolean") {
        return res.status(400).json({ ok: false, error: "approve_before_launch_required",
          message: "say true or false for approve_before_launch" });
      }
      const settings = await withPartnerScope({ kind: "staff" }, async (tx) => {
        const partner = (await tx.query(
          `SELECT org_id FROM partners WHERE id = $1`, [partnerId]
        )).rows[0];
        if (!partner) {
          const e = new Error("partner not found");
          e.code = "NOT_FOUND";
          throw e;
        }
        await writeApproval(tx, { orgId: partner.org_id, partnerId, approve });
        return readSettings(tx, partnerId);
      });
      return res.status(200).json({ ok: true, partner_id: partnerId, settings });
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
